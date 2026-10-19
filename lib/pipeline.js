'use strict';
// Ad job state machine: keyframe image -> (optional) video. Every stage persists its task id,
// so a restart resumes where it left off, and each finished stage is charged to the ledger once.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const catalog = require('./catalog');
const engines = require('./engines');
const ledger = require('./ledger');
const composer = require('./composer');

const RATIOS = ['9:16', '16:9', '1:1', '3:4'];
const running = new Set();
const POLL_MS = Number(process.env.POLL_MS || 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function plan(input) {
  const duration = Math.min(15, Math.max(2, Number(input.duration) || 5));
  return { duration, withVideo: !!input.withVideo };
}

function quoteFor(input) {
  const { duration, withVideo } = plan(input);
  return catalog.quote({ imageModel: input.imageModel, videoModel: input.videoModel, withVideo, duration, scenes: input.scenes || 1 });
}

function create(input) {
  const product = store.db.products.find((p) => p.id === input.productId);
  const actor = store.db.actors.find((a) => a.id === input.actorId);
  if (!product) throw Object.assign(new Error('Pick a product'), { code: 400 });
  if (!actor) throw Object.assign(new Error('Pick an actor'), { code: 400 });
  if (!RATIOS.includes(input.ratio)) throw Object.assign(new Error('Unsupported aspect ratio'), { code: 400 });
  const { duration, withVideo } = plan(input);
  const scene = input.scene || composer.template({ product, actor, brief: input.brief, format: input.format, scenes: 1, sceneSeconds: duration }).scenes[0];
  if (!scene.imagePrompt || !String(scene.imagePrompt).trim()) throw Object.assign(new Error('Write an image prompt'), { code: 400 });
  const quote = quoteFor(input);
  ledger.assertBudget(quote.usd);

  const job = {
    id: store.id('job'), createdAt: new Date().toISOString(), status: 'queued', stage: 'image',
    productId: product.id, productName: product.name, actorId: actor.id, actorName: actor.name,
    title: String(input.title || '').slice(0, 120), campaignId: input.campaignId || null,
    imageModel: input.imageModel, videoModel: withVideo ? input.videoModel : null,
    ratio: input.ratio, duration, withVideo,
    scene: { imagePrompt: String(scene.imagePrompt), motionPrompt: String(scene.motionPrompt || ''), voiceover: String(scene.voiceover || '') },
    image: {}, video: {}, estimate: quote,
  };
  store.db.jobs.unshift(job);
  store.save();
  run(job.id);
  return job;
}

function run(jobId) {
  if (running.has(jobId)) return;
  running.add(jobId);
  step(jobId).finally(() => running.delete(jobId));
}

async function step(jobId) {
  const job = store.db.jobs.find((j) => j.id === jobId);
  if (!job) return;
  const save = () => store.save();
  try {
    job.status = 'running';
    const product = store.db.products.find((p) => p.id === job.productId);
    const actor = store.db.actors.find((a) => a.id === job.actorId);

    if (!job.image.file) {
      job.stage = 'image'; save();
      const model = catalog.get(job.imageModel);
      if (!job.image.taskId) {
        if (!product || !actor) throw new Error('Product or actor was deleted');
        const refs = [
          { tag: 'actor', uri: store.readUploadAsDataUrl(actor.images[0]) },
          { tag: 'product', uri: store.readUploadAsDataUrl(product.images[0]) },
        ];
        const r = await engines.start(model, 'image', { prompt: job.scene.imagePrompt, ratio: job.ratio, refs });
        job.image.taskId = r.taskId; job.image.reportedUsd = r.usd == null ? null : r.usd; save();
      }
      const out = await waitFor(model, job.image.taskId);
      job.image.file = await materialize(out, `${job.id}_image`);
      charge(job, 'image', model, job.image.reportedUsd, {});
      save();
    }

    if (job.withVideo && !job.video.file) {
      job.stage = 'video'; save();
      const model = catalog.get(job.videoModel);
      if (!job.video.taskId) {
        const r = await engines.start(model, 'video', { prompt: job.scene.motionPrompt, ratio: job.ratio, duration: job.duration, imageUri: localDataUrl(job.image.file) });
        job.video.taskId = r.taskId; job.video.reportedUsd = r.usd == null ? null : r.usd; save();
      }
      const out = await waitFor(model, job.video.taskId);
      job.video.file = await materialize(out, `${job.id}_video`);
      charge(job, 'video', model, job.video.reportedUsd, { seconds: job.duration });
      save();
    }

    job.stage = 'done'; job.status = 'done'; job.error = null; save();
  } catch (e) {
    job.status = 'failed'; job.error = e.message; save();
  }
}

/** Record the stage's cost once: the provider's own figure if it gave one, else the model's configured price. */
function charge(job, kind, model, reported, opts) {
  const key = job[kind];
  if (key.charged) return;
  const est = catalog.cost(model, opts);
  const usd = reported != null ? reported : est;
  if (usd == null) return;
  ledger.record({ kind, model: model.id, usd, basis: reported != null ? 'actual' : 'estimate', ref: job.id, note: job.title || `${job.productName} × ${job.actorName}` });
  key.charged = true; key.usd = usd; key.basis = reported != null ? 'actual' : 'estimate';
}

async function waitFor(model, taskId) {
  for (;;) {
    const r = await engines.poll(model, taskId);
    if (r.status === 'SUCCEEDED') return r;
    if (r.status === 'FAILED') throw new Error(`Generation failed: ${r.error}`);
    await sleep(POLL_MS);
  }
}

/** Provider output URLs expire, so always keep our own copy. */
async function materialize(out, base) {
  if (out.local) return out.local;
  const res = await fetch(out.url);
  if (!res.ok) throw new Error(`Could not download result (${res.status})`);
  const ext = path.extname(new URL(out.url).pathname) || '.bin';
  const name = base + ext;
  fs.writeFileSync(path.join(store.OUTPUTS, name), Buffer.from(await res.arrayBuffer()));
  return name;
}

function localDataUrl(name) {
  const ext = path.extname(name).slice(1).replace('jpg', 'jpeg').replace('svg', 'svg+xml');
  return `data:image/${ext};base64,${fs.readFileSync(path.join(store.OUTPUTS, name)).toString('base64')}`;
}

function resumeAll() {
  for (const j of store.db.jobs) if (j.status === 'queued' || j.status === 'running') run(j.id);
}

function retry(jobId) {
  const job = store.db.jobs.find((j) => j.id === jobId);
  if (!job || job.status !== 'failed') throw Object.assign(new Error('Only failed jobs can be retried'), { code: 400 });
  // A provider task that FAILED must be restarted; finished stages keep their files.
  if (!job.image.file) job.image = {};
  else if (!job.video.file) job.video = {};
  job.status = 'queued'; job.error = null;
  store.save(); run(job.id);
  return job;
}

function remove(jobId) {
  const i = store.db.jobs.findIndex((j) => j.id === jobId);
  if (i < 0) return;
  const [j] = store.db.jobs.splice(i, 1);
  for (const f of [j.image && j.image.file, j.video && j.video.file]) if (f) try { fs.unlinkSync(path.join(store.OUTPUTS, path.basename(f))); } catch {}
  store.save(); // ledger entries stay: the money was spent even if the file is deleted
}

/** A concept's scenes become one job each, priced and budget-checked together before any starts. */
function createBatch(b) {
  const scenes = Array.isArray(b.scenes) ? b.scenes.slice(0, 8) : [];
  if (!scenes.length) throw Object.assign(new Error('No scenes to generate'), { code: 400 });
  const total = scenes.reduce((n, sc) => n + quoteFor({ ...b, duration: sc.seconds || b.duration }).usd, 0);
  ledger.assertBudget(total);
  const campaignId = store.id('camp');
  return scenes.map((sc, i) => create({ ...b, scene: sc, duration: sc.seconds || b.duration, campaignId, title: `${b.title || 'Ad'} · scene ${i + 1}` }));
}

module.exports = { create, createBatch, retry, remove, resumeAll, quoteFor, RATIOS };
