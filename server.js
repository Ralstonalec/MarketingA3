'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const store = require('./lib/store');
const settings = require('./lib/settings');
const pipeline = require('./lib/pipeline');
const composer = require('./lib/composer');
const presets = require('./lib/presets');
const catalog = require('./lib/catalog');
const openrouter = require('./lib/openrouter');
const engines = require('./lib/engines');
const ledger = require('./lib/ledger');
const autopilot = require('./lib/autopilot');
const importer = require('./lib/importer');
const runs = require('./lib/runs');
const knowledge = require('./lib/knowledge');
const openapi = require('./lib/openapi');
const accounts = require('./lib/accounts');
const sync = require('./lib/sync');
const { safeGet } = require('./lib/safefetch');
const postkit = require('./lib/postkit');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_BODY = 30 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

const send = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Upload too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { code: 400 })); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, root, rel, req) {
  const file = path.join(root, path.normalize(rel));
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404); return res.end('Not found');
  }
  const size = fs.statSync(file).size;
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (range) { // video seeking
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

// Login: HTTP basic auth (browser login prompt). Credentials come from APP_USERNAME / APP_PASSWORD,
// read per request. Compared in constant time, with a per-IP lockout against guessing.
const fails = new Map(); // ip -> { n, until }
const sha = (x) => crypto.createHash('sha256').update(String(x)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function authorize(req) {
  const password = process.env.APP_PASSWORD || '';
  if (!password) return 'ok';
  const ip = clientIp(req), f = fails.get(ip);
  if (f && f.until > Date.now()) return 'locked';
  const h = req.headers.authorization || '';
  if (h.startsWith('Basic ')) {
    const decoded = Buffer.from(h.slice(6), 'base64').toString();
    const i = decoded.indexOf(':');
    const user = decoded.slice(0, i), pass = decoded.slice(i + 1);
    const userOk = !process.env.APP_USERNAME || same(user, process.env.APP_USERNAME);
    if (i >= 0 && same(pass, password) && userOk) { fails.delete(ip); return 'ok'; }
    const n = ((f && f.n) || 0) + 1;
    fails.set(ip, { n, until: n >= 10 ? Date.now() + 5 * 60 * 1000 : 0 }); // 10 bad tries -> 5 minute lockout
    if (n >= 10) fails.set(ip, { n: 0, until: Date.now() + 5 * 60 * 1000 });
  }
  return 'denied';
}

// ---- entities (products and actors share the same shape) -------------------
const lines = (v, max = 12) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim().slice(0, 240)).filter(Boolean).slice(0, max);
/** Product details that make ads better: only facts listed here may be stated in an ad. */
function productFields(b) {
  return { facts: lines(b.facts), audience: String(b.audience || '').slice(0, 300), offer: String(b.offer || '').slice(0, 200), price: String(b.price || '').slice(0, 60), forbidden: String(b.forbidden || '').slice(0, 300), url: String(b.url || '').slice(0, 500) };
}
/** Who the presenter is matters legally: an AI character cannot give a first-person testimonial. */
function actorFields(b) {
  const kind = b.kind === 'real' ? 'real' : 'ai';
  return { kind, attestUsed: kind === 'real' && b.attestUsed === true };
}
function entityRoutes(kind) {
  const list = () => store.db[kind];
  return {
    list: () => list(),
    async create(body) {
      const name = String(body.name || '').trim();
      if (!name) throw Object.assign(new Error('Name is required'), { code: 400 });
      if (!Array.isArray(body.images) || !body.images.length) throw Object.assign(new Error('Add at least one image'), { code: 400 });
      const images = body.images.slice(0, 4).map(store.saveDataUrl);
      const item = { id: store.id(kind === 'products' ? 'prod' : 'act'), name, description: String(body.description || '').slice(0, 800), images, createdAt: new Date().toISOString(), ...(kind === 'products' ? productFields(body) : actorFields(body)) };
      list().unshift(item); store.save();
      return item;
    },
    update(id, body) {
      const item = list().find((x) => x.id === id);
      if (!item) return null;
      if (typeof body.name === 'string' && body.name.trim()) item.name = body.name.trim().slice(0, 120);
      if (typeof body.description === 'string') item.description = body.description.slice(0, 800);
      if (kind === 'products') Object.assign(item, productFields({ ...item, ...body }));
      else Object.assign(item, actorFields({ ...item, ...body }));
      store.save();
      return item;
    },
    remove(id) {
      const i = list().findIndex((x) => x.id === id);
      if (i < 0) return false;
      const [x] = list().splice(i, 1);
      x.images.forEach(store.removeUpload); store.save();
      return true;
    },
  };
}
const entities = { products: entityRoutes('products'), actors: entityRoutes('actors') };

// Submits one real request so you can see the provider's raw reply and fix the call config. May be billed.
async function testModel(id) {
  const model = catalog.get(id);
  if (model.kind === 'text') {
    const r = await openrouter.chat({ model: model.orId, messages: [{ role: 'user', content: 'Reply with the single word: ok' }], maxTokens: 16 });
    if (r.usd != null) ledger.record({ kind: 'text', model: model.id, usd: r.usd, basis: 'actual', note: 'model test' });
    return { ok: true, reply: r.text.slice(0, 80), usd: r.usd };
  }
  if (model.engine !== 'http') throw Object.assign(new Error('Only custom-call models can be tested here'), { code: 400 });
  const px = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const r = await engines.start(model, model.kind, { prompt: 'test', ratio: '1:1', duration: 5, imageUri: px, refs: [{ tag: 'actor', uri: px }, { tag: 'product', uri: px }], dryRun: true });
  return { ok: true, submitResponse: r.raw, note: 'Submitted. This may be billed by the provider; check your dashboard.' };
}

// ---- router -----------------------------------------------------------------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [root, idPart, action] = parts;
  const m = req.method;

  if (root === 'settings') {
    if (m === 'GET') return send(res, 200, settings.publicSettings());
    if (m === 'PUT') return send(res, 200, settings.update(await readJson(req)));
  }
  if (root === 'products' && idPart === 'import' && m === 'POST') return send(res, 200, await importer.importUrl(await readJson(req)));
  if (entities[root]) {
    if (m === 'GET' && !idPart) return send(res, 200, entities[root].list());
    if (m === 'POST' && !idPart) return send(res, 201, await entities[root].create(await readJson(req)));
    if (m === 'PUT' && idPart) { const u = entities[root].update(idPart, await readJson(req)); return send(res, u ? 200 : 404, u || { error: 'Not found' }); }
    if (m === 'DELETE' && idPart) return send(res, entities[root].remove(idPart) ? 200 : 404, { ok: true });
  }

  // Model ids contain "/" and ":", so they travel in the body or query string, not the path.
  if (root === 'models') {
    if (m === 'GET') return send(res, 200, { fetchedAt: openrouter.cachedModels().fetchedAt, models: catalog.all(), changes: store.db.priceChanges.slice(0, 30), sync: store.db.syncLog });
    if (m === 'POST' && idPart === 'openapi' && action === 'preview') {
      const b = await readJson(req);
      let spec = b.spec;
      if (!spec) {
        const r = await safeGet(String(b.url || ''), { maxBytes: 12 * 1024 * 1024, timeoutMs: 20000, accept: 'application/json,*/*' });
        try { spec = JSON.parse(r.body.toString('utf8')); } catch { throw Object.assign(new Error('That address did not return JSON. Use the openapi.json link, not the docs page.'), { code: 400 }); }
      }
      return send(res, 200, openapi.fromSpec(spec, { provider: b.provider || 'higgsfield' }));
    }
    if (m === 'POST' && idPart === 'openapi' && action === 'import') {
      const b = await readJson(req), added = [];
      for (const d of (Array.isArray(b.drafts) ? b.drafts : []).slice(0, 200)) {
        added.push(catalog.addModel({ provider: b.provider || 'higgsfield', kind: d.kind, label: d.label, price: null, inputs: d.inputs, http: d.http, estimate: d.estimate, limits: d.limits, notes: d.attention, source: b.specUrl ? { type: 'openapi', url: b.specUrl, path: d.path } : undefined }));
      }
      if (b.specUrl && (b.provider || 'higgsfield') === 'higgsfield') settings.update({ sync: { higgsfieldSpecUrl: b.specUrl } }); // remembered, so Sync can re-read it
      return send(res, 201, { added: added.length, models: added.map((x) => ({ id: x.id, label: x.label, kind: x.kind })) });
    }
    if (m === 'POST' && idPart === 'estimate') {
      const b = await readJson(req);
      const ids = b.all ? catalog.all().filter((x) => x.estimate && !x.priced).map((x) => x.id) : [b.id];
      const out = [];
      for (const id of ids.slice(0, 60)) {
        try { const r = await engines.estimatePrice(catalog.get(id)); catalog.setProviderPrice(id, r.price); out.push({ id, ok: true, price: r.price, detail: r.detail }); }
        catch (e) { out.push({ id, ok: false, error: e.message }); }
      }
      return send(res, 200, { results: out });
    }
    if (m === 'POST' && idPart === 'refresh') { const r = await sync.syncOpenRouter(); return send(res, 200, { fetchedAt: openrouter.cachedModels().fetchedAt, models: catalog.all(), changes: store.db.priceChanges.slice(0, 30), sync: store.db.syncLog, summary: r }); }
    if (m === 'POST' && idPart === 'sync') {
      const b = await readJson(req), want = b.provider || 'all', out = {};
      if (['openrouter', 'all'].includes(want) && settings.getKey('openrouter')) out.openrouter = await sync.syncOpenRouter().catch((e) => ({ error: e.message }));
      if (['higgsfield', 'all'].includes(want) && store.db.settings.sync.higgsfieldSpecUrl) out.higgsfield = await sync.syncHiggsfield().catch((e) => ({ error: e.message }));
      if (!Object.keys(out).length) throw Object.assign(new Error('Nothing to sync yet. Add an OpenRouter key, or import the Higgsfield spec once.'), { code: 400 });
      return send(res, 200, { results: out, models: catalog.all(), changes: store.db.priceChanges.slice(0, 30), sync: store.db.syncLog });
    }
    if (m === 'POST' && idPart === 'prefs') {
      const b = await readJson(req);
      if (typeof b.favorite === 'boolean') catalog.setPref(b.id, 'favorites', b.favorite);
      if (typeof b.hidden === 'boolean') catalog.setPref(b.id, 'hidden', b.hidden);
      return send(res, 200, catalog.get(b.id));
    }
    if (m === 'POST' && !idPart) return send(res, 201, catalog.addModel(await readJson(req)));
    if (m === 'PUT' && idPart === 'price') { const b = await readJson(req); return send(res, 200, catalog.setPrice(b.id, b.price)); }
    if (m === 'DELETE') return send(res, 200, { ok: catalog.removeModel(url.searchParams.get('id')) });
    if (m === 'POST' && idPart === 'test') return send(res, 200, await testModel((await readJson(req)).id));
  }
  if (root === 'accounts') {
    if (m === 'GET' && !idPart) return send(res, 200, accounts.status());
    if (m === 'POST' && idPart === 'test') return send(res, 200, await accounts.test((await readJson(req)).provider));
    if (m === 'GET' && idPart === 'reconcile') return send(res, 200, await accounts.reconcile());
  }
  if (root === 'price-changes' && m === 'DELETE') { store.db.priceChanges = []; store.save(); return send(res, 200, { ok: true }); }
  if (root === 'quote' && m === 'POST') {
    try { return send(res, 200, catalog.quote(await readJson(req))); }
    catch (e) { return send(res, 200, { error: e.message }); } // soft: the UI shows why there is no price yet
  }
  if (root === 'autopilot' && m === 'POST') return send(res, 201, await autopilot.run(await readJson(req)));
  if (root === 'hooks' && m === 'POST') return send(res, 200, await composer.hookVariants(await readJson(req)));
  if (root === 'postkit' && m === 'POST') return send(res, 200, postkit.build(await readJson(req)));
  if (root === 'compose' && m === 'POST') return send(res, 200, await composer.compose(await readJson(req)));
  if (root === 'ledger.csv' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="spend.csv"' });
    return res.end(ledger.csv());
  }
  if (root === 'spend' && m === 'GET') return send(res, 200, ledger.summary());
  if (root === 'ledger' && m === 'GET') return send(res, 200, store.db.ledger.slice(-500).reverse());
  if (root === 'knowledge') {
    if (m === 'GET' && !idPart) { const k = store.db.knowledge; return send(res, 200, k ? { loaded: true, meta: k.meta, pack: k.pack, status: knowledge.status() } : { loaded: false }); }
    if (m === 'POST' && idPart === 'verify') return send(res, 200, await knowledge.verifySources());
    if (m === 'POST' && idPart === 'approve') { const b = await readJson(req); return send(res, 200, knowledge.approve(b.key, b.approved !== false)); }
    if (m === 'POST' && idPart === 'validate') return send(res, 200, knowledge.validate((await readJson(req)).pack).report);
    if (m === 'GET' && idPart === 'starters') {
      const dir = path.join(__dirname, 'knowledge');
      return send(res, 200, fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ id: f.replace(/\.json$/, ''), about: (JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))._about || '').slice(0, 400) })) : []);
    }
    if (m === 'POST' && !idPart) {
      const b = await readJson(req);
      if (b.starter) { // packs shipped in knowledge/ (still go through the same evidence gate)
        const file = path.join(__dirname, 'knowledge', path.basename(String(b.starter)) + '.json');
        if (!fs.existsSync(file)) return send(res, 404, { error: 'Unknown starter pack' });
        b.pack = JSON.parse(fs.readFileSync(file, 'utf8')); b.name = b.name || String(b.starter);
      }
      try { return send(res, 201, knowledge.save(b.pack, b.name)); } catch (e) { return send(res, e.code || 400, { error: e.message, report: e.report }); } }
    if (m === 'DELETE') { knowledge.clear(); return send(res, 200, { ok: true }); }
  }
  if (root === 'runs') {
    if (m === 'GET') return send(res, 200, store.db.runs);
    if (m === 'POST' && !idPart) return send(res, 201, runs.create(await readJson(req)));
    if (m === 'POST' && action === 'retry') return send(res, 200, runs.retry(idPart));
    if (m === 'DELETE' && idPart) { runs.remove(idPart); return send(res, 200, { ok: true }); }
  }
  if (root === 'jobs') {
    if (m === 'GET') return send(res, 200, store.db.jobs);
    if (m === 'POST' && idPart === 'batch') return send(res, 201, pipeline.createBatch(await readJson(req)));
    if (m === 'POST' && !idPart) return send(res, 201, pipeline.create(await readJson(req)));
    if (m === 'POST' && action === 'retry') return send(res, 200, pipeline.retry(idPart));
    if (m === 'DELETE' && idPart) { pipeline.remove(idPart); return send(res, 200, { ok: true }); }
  }
  if (root === 'meta' && m === 'GET') {
    return send(res, 200, { formats: composer.formats(), platforms: composer.PLATFORMS, ratios: pipeline.RATIOS, cameras: presets.list(presets.CAMERA), looks: presets.list(presets.LOOK) });
  }
  send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); } // for host health checks; reveals nothing
  const auth = authorize(req);
  if (auth === 'locked') { res.writeHead(429, { 'Retry-After': '300' }); return res.end('Too many failed logins. Try again in a few minutes.'); }
  if (auth !== 'ok') {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Marketing A3", charset="UTF-8"' });
    return res.end('Authentication required');
  }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname.startsWith('/files/uploads/')) return serveFile(res, store.UPLOADS, url.pathname.slice(15), req);
    if (url.pathname.startsWith('/files/outputs/')) return serveFile(res, store.OUTPUTS, url.pathname.slice(15), req);
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    return serveFile(res, path.join(__dirname, 'public'), rel, req);
  } catch (e) {
    if (!res.headersSent) send(res, e.code >= 400 && e.code < 600 ? e.code : 400, { error: e.message });
  }
});

if (require.main === module) {
  const local = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
  if (!local && !process.env.APP_PASSWORD) {
    // This app spends real money on your API keys; never serve it to the network without a login.
    console.error(`Refusing to listen on ${HOST} without APP_PASSWORD set. Set APP_USERNAME and APP_PASSWORD.`);
    process.exit(1);
  }
  server.listen(PORT, HOST, () => {
    console.log(`Marketing A3 running at http://${HOST}:${PORT}`);
    pipeline.resumeAll();
    runs.resumeAll();
    sync.start(); // keeps model lists and prices current in the background
  });
}
module.exports = { server };
