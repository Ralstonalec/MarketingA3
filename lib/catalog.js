'use strict';
// One list of every model you can pick (OpenRouter live list + your own Higgsfield/HTTP models),
// each with an effective price. Prices that are unknown stay "unset" and block generation,
// so spend is never a guess you didn't see.
const store = require('./store');
const openrouter = require('./openrouter');

const MOCK = { id: 'mock:image', provider: 'demo', kind: 'image', label: 'Demo (free placeholder)', engine: 'mock', price: { unit: 'image', usd: 0, basis: 'manual' } };

function builtins() { return [MOCK]; }

function all() {
  const seen = new Map();
  for (const m of [...builtins(), ...openrouter.cachedModels().models, ...store.db.models]) seen.set(m.id, m);
  return [...seen.values()].map(withPrice);
}

function get(id) {
  const m = all().find((x) => x.id === id);
  if (!m) throw Object.assign(new Error(`Unknown model "${id}". Refresh the model list or pick another.`), { code: 400 });
  return m;
}

/** Apply the user's price override and, for estimates, the token assumptions. */
function withPrice(m) {
  const o = store.db.priceOverrides[m.id];
  const price = o ? { ...o, basis: 'manual' } : { ...m.price };
  return { ...m, price, priced: isPriced(price) };
}

function isPriced(p) {
  if (!p) return false;
  if (p.unit === 'tokens') return Number.isFinite(p.in) && Number.isFinite(p.out);
  return Number.isFinite(p.usd) || (p.unit === 'image' && Number.isFinite(p.completionPerM));
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/** USD for one use of a model. For video, `seconds` applies to per-second pricing. */
function cost(m, { seconds = 5 } = {}) {
  const p = m.price;
  const a = store.db.settings.assumptions;
  if (!isPriced(p)) return null;
  switch (p.unit) {
    case 'tokens': return round((p.in * a.textInTokens + p.out * a.textOutTokens) / 1e6);
    case 'image': return round(Number.isFinite(p.usd) ? p.usd : (p.completionPerM * a.imageOutTokens) / 1e6);
    case 'second': return round(p.usd * seconds);
    case 'video': return round(p.usd);
    default: return null;
  }
}

/**
 * Itemised price for a planned generation. Throws if a chosen model has no price.
 * input: { textModel?, imageModel, videoModel?, withVideo, duration, scenes = 1, sceneSeconds?: number[] }
 * With sceneSeconds, scenes = its length and per-second video prices are summed scene by scene.
 */
function quote(input) {
  const lines = [];
  const secs = Array.isArray(input.sceneSeconds) && input.sceneSeconds.length ? input.sceneSeconds.map((n) => Number(n) || 5) : null;
  const scenes = secs ? secs.length : Math.max(1, Number(input.scenes) || 1);
  const add = (kind, id, qty, opts) => {
    const m = get(id);
    if (m.kind !== kind) throw Object.assign(new Error(`${m.label} is a ${m.kind} model, not ${kind}`), { code: 400 });
    const unit = cost(m, opts);
    if (unit == null) throw Object.assign(new Error(`${m.label} has no price yet. Set one in Models so your spend is known.`), { code: 400 });
    const usd = kind === 'video' && secs ? round(secs.reduce((n, sec) => n + cost(m, { seconds: sec }), 0)) : round(unit * qty);
    lines.push({ kind, model: m.id, label: m.label, qty, unitUsd: round(usd / qty), usd, basis: m.price.basis });
  };
  if (input.textModel) add('text', input.textModel, Math.max(1, Number(input.textCalls) || 1));
  if (input.imageModel) add('image', input.imageModel, scenes);
  if (input.withVideo) {
    if (!input.videoModel) throw Object.assign(new Error('Pick a video model or turn video off'), { code: 400 });
    add('video', input.videoModel, scenes, { seconds: Number(input.duration) || 5 });
  }
  return { lines, usd: round(lines.reduce((s, l) => s + l.usd, 0)) };
}

// ---- user models -------------------------------------------------------------
const PROVIDERS = new Set(['higgsfield', 'openrouter', 'custom']);

function addModel(b) {
  const provider = PROVIDERS.has(b.provider) ? b.provider : 'custom';
  const kind = b.kind === 'video' ? 'video' : b.kind === 'image' ? 'image' : null;
  if (!kind) throw Object.assign(new Error('Kind must be image or video'), { code: 400 });
  const label = String(b.label || '').trim();
  if (!label) throw Object.assign(new Error('Give the model a name'), { code: 400 });
  const h = b.http;
  if (!h || !h.submit || !/^https?:\/\//.test(h.submit.url || '')) throw Object.assign(new Error('Call config needs submit.url starting with http(s)://'), { code: 400 });
  if (!h.resultPath) throw Object.assign(new Error('Call config needs resultPath (where the output URL is in the response)'), { code: 400 });
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'model';
  const id = `${provider === 'custom' ? 'x' : provider === 'higgsfield' ? 'hf' : 'orv'}:${slug}`;
  const price = parsePrice(b.price, kind);
  const entry = { id, provider, kind, label, engine: 'http', http: h, price };
  store.db.models = store.db.models.filter((m) => m.id !== id);
  store.db.models.push(entry);
  store.save();
  return withPrice(entry);
}

function parsePrice(p, kind) {
  if (!p) return { unit: kind === 'video' ? 'second' : 'image', basis: 'unset' };
  const unit = kind === 'video' ? (p.unit === 'video' ? 'video' : 'second') : 'image';
  const usd = Number(p.usd);
  if (p.usd === '' || p.usd == null || !Number.isFinite(usd) || usd < 0) return { unit, basis: 'unset' };
  return { unit, usd, basis: 'manual' };
}

function setPrice(id, p) {
  const m = get(id);
  if (p === null) delete store.db.priceOverrides[id];
  else if (m.kind === 'text') {
    const i = Number(p.in), o = Number(p.out);
    if (![i, o].every((n) => Number.isFinite(n) && n >= 0)) throw Object.assign(new Error('Enter USD per 1M tokens for input and output'), { code: 400 });
    store.db.priceOverrides[id] = { unit: 'tokens', in: i, out: o };
  } else {
    const usd = Number(p.usd);
    if (!Number.isFinite(usd) || usd < 0) throw Object.assign(new Error('Enter a price in USD'), { code: 400 });
    const unit = m.kind === 'video' && p.unit === 'video' ? 'video' : m.kind === 'video' ? 'second' : 'image';
    store.db.priceOverrides[id] = { unit, usd };
  }
  store.save();
  return get(id);
}

function removeModel(id) {
  const n = store.db.models.length;
  store.db.models = store.db.models.filter((m) => m.id !== id);
  delete store.db.priceOverrides[id];
  store.save();
  return store.db.models.length < n;
}

module.exports = { all, get, quote, cost, addModel, setPrice, removeModel, isPriced };
