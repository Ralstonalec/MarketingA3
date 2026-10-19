'use strict';
// OpenRouter client: model list (with live prices), chat, and image generation via chat modalities.
// Base URL is overridable so tests (and proxies) can point elsewhere.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const settings = require('./settings');

const base = () => (process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const CACHE = () => path.join(store.DATA_DIR, 'openrouter-models.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRIES = Number(process.env.OPENROUTER_RETRIES || 2);

/**
 * One OpenRouter request. Transient failures are retried with backoff (honouring Retry-After):
 * GETs on any network error or 429/5xx; POSTs only on 429/503, which mean "not processed", so a retry cannot double-charge.
 */
async function call(method, route, body) {
  const key = settings.getKey('openrouter');
  if (!key) throw Object.assign(new Error('No OpenRouter API key set (Settings, or OPENROUTER_API_KEY).'), { code: 400 });
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    let res, text;
    try {
      res = await fetch(base() + route, {
        method,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Marketing A3' },
        body: body ? JSON.stringify(body) : undefined,
      });
      text = await res.text();
    } catch (e) {
      last = new Error(`OpenRouter is unreachable (${e.cause && e.cause.code || e.message})`);
      if (method === 'GET' && attempt < RETRIES) { await sleep(Math.min(5000, 600 * 2 ** attempt)); continue; }
      throw last;
    }
    let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
    const transient = method === 'GET' ? [429, 500, 502, 503, 504].includes(res.status) : [429, 503].includes(res.status);
    if (!res.ok && transient && attempt < RETRIES) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Math.min(5000, Number.isFinite(ra) && ra > 0 ? ra * 1000 : 600 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(json.error && (json.error.message || JSON.stringify(json.error))) || text.slice(0, 200)}`);
    if (json.error) throw new Error(`OpenRouter: ${json.error.message || JSON.stringify(json.error)}`);
    return json;
  }
  throw last || new Error('OpenRouter request failed');
}

const perMillion = (v) => { const n = Number(v); return Number.isFinite(n) ? n * 1e6 : 0; };

/** Normalise /models into catalog entries. Prices come straight from the API (USD per token). */
function normalise(m) {
  const out = (m.architecture && m.architecture.output_modalities) || [];
  const kind = out.includes('image') ? 'image' : out.includes('text') ? 'text' : null;
  if (!kind) return null; // audio/embedding-only models are out of scope
  const p = m.pricing || {};
  return {
    id: `or:${m.id}`, provider: 'openrouter', kind, label: m.name || m.id, orId: m.id,
    engine: kind === 'image' ? 'openrouter-image' : 'openrouter-chat',
    context: m.context_length || null,
    inputs: (m.architecture && m.architecture.input_modalities) || [],
    rawPricing: { prompt: p.prompt, completion: p.completion, image: p.image, request: p.request },
    price: kind === 'text'
      ? { unit: 'tokens', in: perMillion(p.prompt), out: perMillion(p.completion), basis: 'live' }
      // Output images are billed as completion tokens; per-image cost is therefore an estimate until a real run reports it.
      : { unit: 'image', completionPerM: perMillion(p.completion), basis: 'live-estimate' },
  };
}

const signature = (m) => (m.kind === 'text' ? `${m.price.in}|${m.price.out}` : `${m.price.completionPerM}`);

/** Compare two model lists and describe every price move, addition and removal. */
function diffModels(before, after) {
  const prev = new Map(before.map((m) => [m.id, m]));
  const changes = [], at = new Date().toISOString();
  for (const m of after) {
    const old = prev.get(m.id);
    if (!old) continue;
    const pairs = m.kind === 'text' ? [['input per 1M tokens', old.price.in, m.price.in], ['output per 1M tokens', old.price.out, m.price.out]] : [['output per 1M tokens', old.price.completionPerM, m.price.completionPerM]];
    for (const [field, from, to] of pairs) {
      if (Number.isFinite(from) && Number.isFinite(to) && Math.abs(to - from) > Math.max(1e-9, Math.abs(from) * 0.005)) {
        changes.push({ id: m.id, label: m.label, field, from, to, pct: from ? Math.round(((to - from) / from) * 1000) / 10 : null, at });
      }
    }
  }
  const ids = new Set(after.map((m) => m.id));
  return { changes, added: after.filter((m) => !prev.has(m.id)).length, removed: before.filter((m) => !ids.has(m.id)).length };
}

async function refreshModels() {
  const before = cachedModels();
  const j = await call('GET', '/models');
  const models = (j.data || []).map(normalise).filter(Boolean);
  if (!models.length) throw new Error('OpenRouter returned no models. The cached list was kept.');
  const diff = before.models.length ? diffModels(before.models, models) : { changes: [], added: models.length, removed: 0 };
  fs.writeFileSync(CACHE(), JSON.stringify({ fetchedAt: new Date().toISOString(), models }));
  if (diff.changes.length) { store.db.priceChanges = [...diff.changes, ...store.db.priceChanges].slice(0, 200); store.save(); }
  return { models, ...diff };
}

/** What OpenRouter itself says about this key and balance (used to reconcile against our ledger). Fields vary, so all optional. */
async function account() {
  const out = { key: null, credits: null };
  try { const j = await call('GET', '/auth/key'); out.key = j.data || j; } catch (e) { out.keyError = e.message; if (/401|403|No OpenRouter/.test(e.message)) throw e; }
  try { const j = await call('GET', '/credits'); out.credits = j.data || j; } catch (e) { out.creditsError = e.message; }
  return out;
}

function cachedModels() {
  try { return JSON.parse(fs.readFileSync(CACHE(), 'utf8')); } catch { return { fetchedAt: null, models: [] }; }
}

/** Chat completion. Returns { text, usd, usage }. usd is the provider-reported cost, or null. */
async function chat({ model, messages, json = false, maxTokens = 3000, temperature }) {
  const body = { model, messages, max_tokens: maxTokens, usage: { include: true } };
  if (temperature != null) body.temperature = temperature;
  if (json) body.response_format = { type: 'json_object' };
  let r;
  try { r = await call('POST', '/chat/completions', body); }
  catch (e) {
    // Not every model supports response_format; retry once without it.
    if (json && /response_format|json/i.test(e.message)) { delete body.response_format; r = await call('POST', '/chat/completions', body); }
    else throw e;
  }
  const msg = (r.choices && r.choices[0] && r.choices[0].message) || {};
  const text = Array.isArray(msg.content) ? msg.content.map((c) => c.text || '').join('') : msg.content || '';
  return { text, usd: r.usage && Number.isFinite(r.usage.cost) ? r.usage.cost : null, usage: r.usage || {} };
}

/** Image generation through chat completions with modalities. refs: [{tag, uri}] */
async function image({ model, prompt, ratio, refs }) {
  const intro = refs.length
    ? refs.map((r, i) => `Reference image ${i + 1} is @${r.tag}.`).join(' ') + ' Keep the people and products in the references recognisable. '
    : '';
  const content = [{ type: 'text', text: intro + prompt }, ...refs.map((r) => ({ type: 'image_url', image_url: { url: r.uri } }))];
  const r = await call('POST', '/chat/completions', {
    model, modalities: ['image', 'text'], image_config: { aspect_ratio: ratio },
    messages: [{ role: 'user', content }], usage: { include: true },
  });
  const msg = (r.choices && r.choices[0] && r.choices[0].message) || {};
  const url = msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
  if (!url) throw new Error(`Model returned no image${msg.content ? `: ${String(msg.content).slice(0, 160)}` : ''}`);
  return { url, usd: r.usage && Number.isFinite(r.usage.cost) ? r.usage.cost : null };
}

module.exports = { refreshModels, cachedModels, chat, image, account, diffModels, base };
