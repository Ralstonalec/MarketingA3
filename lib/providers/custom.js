'use strict';
// Config-driven HTTP provider: point it at any image/video model API (hosted or self-hosted)
// by describing the request and how to read the response. See README "Bring your own models".
const store = require('../store');
const settings = require('../settings');

const SIZES = { '9:16': [720, 1280], '16:9': [1280, 720], '1:1': [960, 960], '3:4': [832, 1104] };
const DONE = ['completed', 'succeeded', 'success', 'done', 'finished'];
const FAIL = ['failed', 'error', 'canceled', 'cancelled'];

const get = (obj, p) => String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** "{{x}}" alone keeps the value's type; "{{x|string}}" stringifies; embedded use is text substitution. */
function fill(tpl, vars) {
  if (typeof tpl === 'string') {
    const whole = /^\{\{\s*([\w.]+)(\|string)?\s*\}\}$/.exec(tpl);
    if (whole) {
      const v = get(vars, whole[1]);
      return whole[2] ? String(v) : v;
    }
    return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => { const v = get(vars, k); return v == null ? '' : String(v); });
  }
  if (Array.isArray(tpl)) return tpl.map((x) => fill(x, vars));
  if (tpl && typeof tpl === 'object') return Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, fill(v, vars)]));
  return tpl;
}

function stage(name) {
  const c = store.db.settings.custom[name];
  if (!c || !c.submit || !c.submit.url) throw new Error(`Custom provider: the ${name} model is not configured (Settings → Custom models).`);
  return c;
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

async function start(name, extra) {
  const c = stage(name);
  const apiKey = settings.getKey('custom');
  const [w, h] = SIZES[extra.ratio] || SIZES['9:16'];
  const vars = { apiKey, width: w, height: h, ...extra };
  const headers = fill(c.submit.headers || {}, vars);
  const res = await http(c.submit.method || 'POST', fill(c.submit.url, vars), headers, fill(c.submit.body || {}, vars));
  // The whole submit response is the task handle so poll templates can use {{submit.status_url}} etc.
  return { taskId: JSON.stringify({ stage: name, submit: res }) };
}

async function poll(taskId) {
  const t = JSON.parse(taskId);
  const c = stage(t.stage);
  const apiKey = settings.getKey('custom');
  const vars = { apiKey, submit: t.submit };
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
  if (!url) return { status: 'FAILED', error: `No result URL found at "${c.resultPath}" in: ${JSON.stringify(body).slice(0, 200)}` };
  return { status: 'SUCCEEDED', url };
}

module.exports = {
  name: 'custom',
  preferLocalImage: true, // the next model may not be able to reach the previous model's output URL
  label: 'Custom models (your own endpoints)',
  get supportsVideo() { const v = store.db.settings.custom.video; return !!(v && v.submit && v.submit.url); },

  startImage({ prompt, ratio, refs }) {
    const by = Object.fromEntries(refs.map((r) => [r.tag + 'Image', r.uri]));
    return start('image', { prompt, ratio, ...by, images: refs.map((r) => r.uri) });
  },
  startVideo({ prompt, ratio, duration, imageUri }) {
    return start('video', { prompt, ratio, duration, image: imageUri });
  },
  poll,
};
