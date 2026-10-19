'use strict';
// Runs one model call. start() returns { taskId, usd? } (usd = provider-reported cost, if known);
// poll() returns { status: RUNNING|SUCCEEDED|FAILED, url?|local?, error? }.
const fs = require('fs');
const path = require('path');
const store = require('./store');
const settings = require('./settings');
const openrouter = require('./openrouter');

const SIZES = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [960, 960], '3:4': [832, 1104] };
const DONE = ['completed', 'succeeded', 'success', 'done', 'finished'];
const FAIL = ['failed', 'error', 'canceled', 'cancelled'];
const KEY_FOR = { higgsfield: 'higgsfield', openrouter: 'openrouter' };

// ---- http engine ---------------------------------------------------------------
const get = (obj, p) => String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** "{{x}}" alone keeps the value's type; "{{x|string}}" stringifies; embedded use is text substitution. */
function fill(tpl, vars) {
  if (typeof tpl === 'string') {
    const whole = /^\{\{\s*([\w.]+)(\|string)?\s*\}\}$/.exec(tpl);
    if (whole) { const v = get(vars, whole[1]); return whole[2] ? String(v) : v; }
    return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => { const v = get(vars, k); return v == null ? '' : String(v); });
  }
  if (Array.isArray(tpl)) return tpl.map((x) => fill(x, vars));
  if (tpl && typeof tpl === 'object') return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fill(v, vars)]));
  return tpl;
}

async function http(method, url, headers, body) {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${(json.detail && JSON.stringify(json.detail)) || json.error || json.message || text.slice(0, 200)}`);
  return json;
}

function pickUrl(json, paths) {
  for (const p of String(paths || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    let v = get(json, p);
    if (Array.isArray(v)) v = v[0];
    if (v && typeof v === 'object') v = v.url;
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

const keyOf = (model) => {
  const name = KEY_FOR[model.provider];
  const key = settings.getKey(name || 'custom');
  // Hosted providers always need a key; "other" endpoints may be self-hosted without one.
  if (name && !key) throw Object.assign(new Error(`No ${settings.publicSettings().keys[name].label} API key set (Settings).`), { code: 400 });
  return key;
};

async function httpStart(model, extra, { dryRun = false } = {}) {
  const c = model.http;
  const [w, h] = SIZES[extra.ratio] || SIZES['9:16'];
  const vars = { apiKey: keyOf(model), width: w, height: h, model: model.label, ...extra };
  const headers = fill(c.submit.headers || {}, vars);
  const res = await http(c.submit.method || 'POST', fill(c.submit.url, vars), headers, fill(c.submit.body || {}, vars));
  return { taskId: JSON.stringify({ model: model.id, submit: res }), raw: dryRun ? res : undefined };
}

async function httpPoll(model, taskId) {
  const c = model.http;
  const t = JSON.parse(taskId);
  const vars = { apiKey: keyOf(model), submit: t.submit };
  const headers = fill(c.submit.headers || {}, vars);
  let body = t.submit;
  if (c.poll && c.poll.url) {
    body = await http(c.poll.method || 'GET', fill(c.poll.url, vars), headers);
    const status = String(get(body, c.poll.statusPath || 'status') || '').toLowerCase();
    if (FAIL.includes(status)) return { status: 'FAILED', error: JSON.stringify(get(body, c.poll.errorPath || 'error') || status).slice(0, 300) };
    if (!(c.poll.doneValues || DONE).map((s) => s.toLowerCase()).includes(status)) return { status: 'RUNNING' };
    if (c.poll.resultUrl) body = await http('GET', fill(c.poll.resultUrl, vars), headers);
  }
  const url = pickUrl(body, c.resultPath);
  if (!url) return { status: 'FAILED', error: `No result URL at "${c.resultPath}" in: ${JSON.stringify(body).slice(0, 200)}` };
  return { status: 'SUCCEEDED', url };
}

// ---- mock + openrouter-image (synchronous: result is written immediately) ----------
function placeholderSvg(label, ratio) {
  const [w, h] = ratio.split(':').map(Number);
  const W = 720, H = Math.round((720 * h) / w);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#fff" font-weight="700">DEMO MODEL</text><text x="50%" y="54%" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#fff" opacity=".85">${label.replace(/[<&>]/g, '').slice(0, 48)}</text></svg>`;
}

function writeOutput(name, buf) { fs.writeFileSync(path.join(store.OUTPUTS, name), buf); return name; }

async function start(model, kind, p) {
  if (model.engine === 'mock') {
    if (kind !== 'image') throw new Error('The demo model only makes images');
    return { taskId: 'sync:' + writeOutput(`${store.id('mock')}.svg`, Buffer.from(placeholderSvg(p.prompt, p.ratio))), usd: 0 };
  }
  if (model.engine === 'openrouter-image') {
    const r = await openrouter.image({ model: model.orId, prompt: p.prompt, ratio: p.ratio, refs: p.refs });
    const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(r.url);
    if (!m) throw new Error('Model returned a non-inline image URL');
    return { taskId: 'sync:' + writeOutput(`${store.id('or')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, Buffer.from(m[2], 'base64')), usd: r.usd };
  }
  if (model.engine === 'http') {
    const refs = p.refs || [];
    const by = Object.fromEntries(refs.map((r) => [r.tag + 'Image', r.uri]));
    return httpStart(model, { prompt: p.prompt, ratio: p.ratio, duration: p.duration, image: p.imageUri, images: refs.map((r) => r.uri), ...by }, { dryRun: p.dryRun });
  }
  throw new Error(`Model ${model.label} cannot generate ${kind}s`);
}

async function poll(model, taskId) {
  if (taskId.startsWith('sync:')) return { status: 'SUCCEEDED', local: taskId.slice(5) };
  if (model.engine === 'http') return httpPoll(model, taskId);
  return { status: 'FAILED', error: 'Unknown task' };
}

module.exports = { start, poll, fill };
