'use strict';
// One-off tool runs: any registered model (edit, upscale, lip-sync, audio, video-to-video...) on inputs you choose.
// Same guarantees as ad jobs: priced up front, budget-checked, resumable, charged once on success.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const catalog = require('./catalog');
const engines = require('./engines');
const ledger = require('./ledger');
const files = require('./files');

const running = new Set();
const POLL_MS = Number(process.env.POLL_MS || 4000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bad = (m) => Object.assign(new Error(m), { code: 400 });

/** A file input is either { output: 'name' } (from the Gallery), { upload: 'name' } (Library) or { data: 'data:...' }. */
function resolveInput(src, kind) {
  if (!src) return null;
  let uri;
  if (src.output) uri = files.outputDataUrl(src.output);
  else if (src.upload) uri = files.uploadDataUrl(src.upload);
  else if (typeof src.data === 'string' && /^data:(image|video|audio)\/[\w.+-]+;base64,/.test(src.data)) uri = src.data;
  else throw bad(`Invalid ${kind} input`);
  if (!uri.startsWith(`data:${kind}/`)) throw bad(`The ${kind} input is not a ${kind} file`);
  return uri;
}

function create(input) {
  const model = catalog.get(input.modelId);
  if (!catalog.TOOL_KINDS.includes(model.kind) && model.kind !== 'image' && model.kind !== 'video') throw bad(`${model.label} cannot be run from Tools`);
  if (model.engine !== 'http') throw bad(`${model.label} is used through Quick Ad, Composer or Studio, not Tools.`);
  const wants = model.inputs || [];
  const vars = {};
  for (const k of ['image', 'video', 'audio']) {
    if (wants.includes(k)) {
      vars[k] = resolveInput(input[k], k);
      if (!vars[k]) throw bad(`${model.label} needs a ${k}`);
    }
  }
  if (wants.includes('prompt')) { vars.prompt = String(input.prompt || '').trim().slice(0, 4000); if (!vars.prompt) throw bad('Write a prompt'); }
  if (wants.includes('duration')) vars.duration = Math.min(60, Math.max(1, Number(input.duration) || 5));
  if (wants.includes('ratio')) vars.ratio = ['9:16', '16:9', '1:1', '3:4'].includes(input.ratio) ? input.ratio : '9:16';
  const quote = catalog.quote({ toolModel: model.id, duration: vars.duration });
  ledger.assertBudget(quote.usd);

  const names = Object.fromEntries(['image', 'video', 'audio'].filter((k) => vars[k]).map((k) => [k, (input[k] && (input[k].output || input[k].upload)) || 'uploaded file']));
  const run = {
    id: store.id('run'), createdAt: new Date().toISOString(), status: 'queued', stage: 'run',
    modelId: model.id, kind: model.kind, title: String(input.title || model.label).slice(0, 120),
    prompt: vars.prompt || '', duration: vars.duration || null, ratio: vars.ratio || null, inputNames: names,
    estimate: quote, task: {},
  };
  store.db.runs.unshift(run);
  // Inputs can be large (video/audio). Keep them on disk next to the run, not in db.json.
  fs.writeFileSync(path.join(store.DATA_DIR, `${run.id}.inputs.json`), JSON.stringify(vars));
  store.save();
  go(run.id);
  return run;
}

const inputsFile = (id) => path.join(store.DATA_DIR, `${id}.inputs.json`);
function go(id) { if (running.has(id)) return; running.add(id); step(id).finally(() => running.delete(id)); }

async function step(id) {
  const run = store.db.runs.find((r) => r.id === id);
  if (!run) return;
  try {
    run.status = 'running'; store.save();
    const model = catalog.get(run.modelId);
    if (!run.task.id) {
      const vars = JSON.parse(fs.readFileSync(inputsFile(id), 'utf8'));
      const r = await engines.start(model, model.kind, { prompt: vars.prompt, ratio: vars.ratio, duration: vars.duration, imageUri: vars.image, vars });
      run.task.id = r.taskId; run.task.reportedUsd = r.usd == null ? null : r.usd; store.save();
    }
    for (;;) {
      const r = await engines.poll(model, run.task.id);
      if (r.status === 'SUCCEEDED') { run.file = await files.materialize(r, `${run.id}_out`); break; }
      if (r.status === 'FAILED') throw new Error(`Run failed: ${r.error}`);
      await sleep(POLL_MS);
    }
    const est = catalog.cost(model, { seconds: run.duration || 5 });
    const reported = run.task.reportedUsd;
    const usd = reported != null ? reported : est;
    if (usd != null && !run.charged) {
      ledger.record({ kind: model.kind, model: model.id, usd, basis: reported != null ? 'actual' : 'estimate', ref: run.id, note: run.title });
      run.charged = true; run.usd = usd; run.basis = reported != null ? 'actual' : 'estimate';
    }
    run.status = 'done'; run.error = null;
    try { fs.unlinkSync(inputsFile(id)); } catch {} // big inputs are no longer needed
  } catch (e) { run.status = 'failed'; run.error = e.message; }
  store.save();
}

function resumeAll() { for (const r of store.db.runs) if (r.status === 'queued' || r.status === 'running') go(r.id); }

function retry(id) {
  const run = store.db.runs.find((r) => r.id === id);
  if (!run || run.status !== 'failed') throw bad('Only failed runs can be retried');
  if (!fs.existsSync(inputsFile(id))) throw bad('The inputs for this run are gone. Start a new run.');
  run.task = {}; run.status = 'queued'; run.error = null; store.save(); go(id);
  return run;
}

function remove(id) {
  const i = store.db.runs.findIndex((r) => r.id === id);
  if (i < 0) return;
  const [r] = store.db.runs.splice(i, 1);
  if (r.file) try { fs.unlinkSync(path.join(store.OUTPUTS, path.basename(r.file))); } catch {}
  try { fs.unlinkSync(inputsFile(id)); } catch {}
  store.save();
}

module.exports = { create, retry, remove, resumeAll };
