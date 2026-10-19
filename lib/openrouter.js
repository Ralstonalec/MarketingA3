'use strict';
// OpenRouter client: model list (with live prices), chat, and image generation via chat modalities.
// Base URL is overridable so tests (and proxies) can point elsewhere.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const settings = require('./settings');

const base = () => (process.env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const CACHE = () => path.join(store.DATA_DIR, 'openrouter-models.json');

async function call(method, route, body) {
  const key = settings.getKey('openrouter');
  if (!key) throw Object.assign(new Error('No OpenRouter API key set (Settings, or OPENROUTER_API_KEY).'), { code: 400 });
  const res = await fetch(base() + route, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Marketing A3' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(json.error && (json.error.message || JSON.stringify(json.error))) || text.slice(0, 200)}`);
  if (json.error) throw new Error(`OpenRouter: ${json.error.message || JSON.stringify(json.error)}`);
  return json;
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

async function refreshModels() {
  const j = await call('GET', '/models');
  const models = (j.data || []).map(normalise).filter(Boolean);
  fs.writeFileSync(CACHE(), JSON.stringify({ fetchedAt: new Date().toISOString(), models }));
  return models;
}

function cachedModels() {
  try { return JSON.parse(fs.readFileSync(CACHE(), 'utf8')); } catch { return { fetchedAt: null, models: [] }; }
}

/** Chat completion. Returns { text, usd, usage }. usd is the provider-reported cost, or null. */
async function chat({ model, messages, json = false, maxTokens = 3000 }) {
  const body = { model, messages, max_tokens: maxTokens, usage: { include: true } };
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

module.exports = { refreshModels, cachedModels, chat, image, base };
