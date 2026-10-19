'use strict';
// Ad job state machine: copy -> keyframe image -> (optional) video.
// All progress is persisted on the job, so a server restart resumes where it left off.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const providers = require('./providers');
const copywriter = require('./copywriter');

const RATIOS = ['9:16', '16:9', '1:1', '3:4'];
const running = new Set();
const POLL_MS = Number(process.env.POLL_MS || 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function estimate({ withVideo, duration }) {
  const p = store.db.settings.pricing;
  const credits = p.imageCredits + (withVideo ? p.videoCreditsPerSec * duration : 0);
  return { credits, usd: Math.round(credits * p.creditUsd * 100) / 100 };
}

function create(input) {
  const product = store.db.products.find((p) => p.id === input.productId);
  const actor = store.db.actors.find((a) => a.id === input.actorId);
  if (!product) throw new Error('Pick a product');
  if (!actor) throw new Error('Pick an actor');
  if (!RATIOS.includes(input.ratio)) throw new Error('Unsupported aspect ratio');
  const duration = Number(input.duration) === 10 ? 10 : 5;
  const withVideo = !!input.withVideo;
  const provider = providers.active();
  if (withVideo && !provider.supportsVideo) throw new Error(`${provider.label} cannot render video. Turn off video or switch provider.`);

  const job = {
    id: store.id('job'),
    createdAt: new Date().toISOString(),
    provider: provider.name,
    status: 'queued',
    stage: 'copy',
    productId: product.id, productName: product.name,
    actorId: actor.id, actorName: actor.name,
    format: input.format, ratio: input.ratio, duration, withVideo,
    brief: String(input.brief || '').slice(0, 1000),
    // The user may have edited the generated copy before submitting.
    copy: input.copy && input.copy.imagePrompt ? input.copy : null,
    image: {}, video: {},
    estimate: estimate({ withVideo, duration }),
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
    const provider = providers.all[job.provider];
    const product = store.db.products.find((p) => p.id === job.productId);
    const actor = store.db.actors.find((a) => a.id === job.actorId);
    if (!product || !actor) throw new Error('Product or actor was deleted');

    if (!job.copy) {
      job.stage = 'copy'; save();
      job.copy = await copywriter.write({ product, actor, brief: job.brief, format: job.format });
      save();
    }

    if (!job.image.file) {
      job.stage = 'image'; save();
      if (!job.image.taskId) {
        const refs = [
          { tag: 'actor', uri: store.readUploadAsDataUrl(actor.images[0]) },
          { tag: 'product', uri: store.readUploadAsDataUrl(product.images[0]) },
        ];
        const r = await provider.startImage({ prompt: job.copy.imagePrompt, ratio: job.ratio, refs });
        job.image.taskId = r.taskId; save();
      }
      const out = await waitFor(provider, job.image.taskId);
      job.image.remoteUrl = out.url || null;
      job.image.file = await materialize(out, `${job.id}_image`);
      save();
    }

    if (job.withVideo && !job.video.file) {
      job.stage = 'video'; save();
      if (!job.video.taskId) {
        // Prefer the provider's own URL (fresh, small); fall back to the local file.
        const imageUri = job.image.remoteUrl || localDataUrl(job.image.file);
        const r = await provider.startVideo({ prompt: job.copy.motionPrompt, ratio: job.ratio, duration: job.duration, imageUri });
        job.video.taskId = r.taskId; save();
      }
      const out = await waitFor(provider, job.video.taskId);
      job.video.file = await materialize(out, `${job.id}_video`);
      save();
    }

    job.stage = 'done'; job.status = 'done'; job.error = null; save();
  } catch (e) {
    job.status = 'failed'; job.error = e.message; save();
  }
}

async function waitFor(provider, taskId) {
  for (;;) {
    const r = await provider.poll(taskId);
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
  const ext = path.extname(name).slice(1).replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${fs.readFileSync(path.join(store.OUTPUTS, name)).toString('base64')}`;
}

function resumeAll() {
  for (const j of store.db.jobs) if (j.status === 'queued' || j.status === 'running') run(j.id);
}

function retry(jobId) {
  const job = store.db.jobs.find((j) => j.id === jobId);
  if (!job || job.status !== 'failed') throw new Error('Only failed jobs can be retried');
  // A task that FAILED at the provider must be restarted; keep finished stages.
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
  for (const f of [j.image && j.image.file, j.video && j.video.file]) {
    if (f) try { fs.unlinkSync(path.join(store.OUTPUTS, path.basename(f))); } catch {}
  }
  store.save();
}

module.exports = { create, retry, remove, resumeAll, estimate, RATIOS };
