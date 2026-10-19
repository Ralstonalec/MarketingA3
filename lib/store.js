'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const OUTPUTS = path.join(DATA_DIR, 'outputs');
const DB_FILE = path.join(DATA_DIR, 'db.json');
for (const d of [DATA_DIR, UPLOADS, OUTPUTS]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
try { fs.chmodSync(DATA_DIR, 0o700); if (fs.existsSync(DB_FILE)) fs.chmodSync(DB_FILE, 0o600); } catch { /* best effort (e.g. Windows) */ }

const DEFAULTS = {
  products: [],
  actors: [],
  jobs: [],
  runs: [],            // one-off tool runs (edit, upscale, lip-sync, audio, ...)
  models: [],          // user-added image/video models (Higgsfield, custom HTTP, ...)
  priceOverrides: {},  // modelId -> price, wins over live prices
  observed: {},        // modelId -> { n, sum, last, at }: what the provider ACTUALLY charged per call/image
  priceChanges: [],    // price moves seen when a provider's model list was refreshed
  keyChecks: {},       // provider -> { at, ok, detail } from the last key test
  syncLog: {},         // provider -> { at, ok, summary } from the last background sync
  modelPrefs: { favorites: [], hidden: [] },
  knowledge: null,     // validated research pack: { meta, pack } (see lib/knowledge.js)
  ledger: [],          // every charge: { id, ts, kind, model, usd, basis: 'actual'|'estimate', ref, note }
  settings: {
    keys: { openrouter: '', higgsfield: '', custom: '' },
    defaults: { text: '', image: 'mock:image', video: '' },
    budget: { monthlyUsd: 0 }, // 0 = no cap
    sync: { autoRefreshHours: 12, higgsfieldSpecUrl: '', learnCosts: true }, // learnCosts: quote from real charges once there are enough
    brand: { name: '', voice: '', forbidden: '', defaultCta: '', disclosure: true, realismBoost: true },
    // Token assumptions behind text/image price *estimates*; actual cost is recorded from the API when it reports it.
    assumptions: { textInTokens: 1500, textOutTokens: 1200, imageOutTokens: 1300 },
  },
};

let db = load();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      ...DEFAULTS,
      ...raw,
      modelPrefs: { ...DEFAULTS.modelPrefs, ...(raw.modelPrefs || {}) },
      settings: {
        ...DEFAULTS.settings,
        ...raw.settings,
        keys: { ...DEFAULTS.settings.keys, ...(raw.settings || {}).keys },
        defaults: { ...DEFAULTS.settings.defaults, ...(raw.settings || {}).defaults },
        budget: { ...DEFAULTS.settings.budget, ...(raw.settings || {}).budget },
        sync: { ...DEFAULTS.settings.sync, ...(raw.settings || {}).sync },
        brand: { ...DEFAULTS.settings.brand, ...(raw.settings || {}).brand },
        assumptions: { ...DEFAULTS.settings.assumptions, ...(raw.settings || {}).assumptions },
      },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 50);
}
function flush() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 }); // the file contains API keys: owner-only
  fs.renameSync(tmp, DB_FILE);
}
process.on('exit', () => { try { flush(); } catch {} });

const id = (p) => `${p}_${crypto.randomBytes(5).toString('hex')}`;

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** Save a data: URL into uploads/, return the relative file name. */
function saveDataUrl(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(dataUrl || '');
  if (!m) throw new Error('Image must be a PNG, JPEG or WebP data URL');
  const name = `${id('img')}.${EXT[m[1]]}`;
  fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(m[2], 'base64'));
  return name;
}

function readUploadAsDataUrl(name) {
  const file = path.join(UPLOADS, path.basename(name));
  const ext = path.extname(file).slice(1);
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function removeUpload(name) {
  try { fs.unlinkSync(path.join(UPLOADS, path.basename(name))); } catch {}
}

module.exports = {
  DATA_DIR, UPLOADS, OUTPUTS,
  get db() { return db; },
  save, flush, id, saveDataUrl, readUploadAsDataUrl, removeUpload,
};
