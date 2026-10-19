'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS = path.join(DATA_DIR, 'uploads');
const OUTPUTS = path.join(DATA_DIR, 'outputs');
const DB_FILE = path.join(DATA_DIR, 'db.json');
for (const d of [DATA_DIR, UPLOADS, OUTPUTS]) fs.mkdirSync(d, { recursive: true });

const DEFAULTS = {
  products: [],
  actors: [],
  jobs: [],
  settings: {
    provider: 'mock',
    anthropicModel: 'claude-sonnet-5-5',
    keys: { runway: '', anthropic: '' },
    // Used only for cost *estimates*. Check your provider's pricing page.
    pricing: { creditUsd: 0.01, imageCredits: 8, videoCreditsPerSec: 5 },
  },
};

let db = load();

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      ...DEFAULTS,
      ...raw,
      settings: {
        ...DEFAULTS.settings,
        ...raw.settings,
        keys: { ...DEFAULTS.settings.keys, ...(raw.settings || {}).keys },
        pricing: { ...DEFAULTS.settings.pricing, ...(raw.settings || {}).pricing },
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
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
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
