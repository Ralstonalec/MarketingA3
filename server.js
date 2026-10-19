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
const catalog = require('./lib/catalog');
const openrouter = require('./lib/openrouter');
const engines = require('./lib/engines');
const ledger = require('./lib/ledger');
const autopilot = require('./lib/autopilot');

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
function entityRoutes(kind) {
  const list = () => store.db[kind];
  return {
    list: () => list(),
    async create(body) {
      const name = String(body.name || '').trim();
      if (!name) throw Object.assign(new Error('Name is required'), { code: 400 });
      if (!Array.isArray(body.images) || !body.images.length) throw Object.assign(new Error('Add at least one image'), { code: 400 });
      const images = body.images.slice(0, 4).map(store.saveDataUrl);
      const item = { id: store.id(kind === 'products' ? 'prod' : 'act'), name, description: String(body.description || '').slice(0, 800), images, createdAt: new Date().toISOString() };
      list().unshift(item); store.save();
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
  if (entities[root]) {
    if (m === 'GET' && !idPart) return send(res, 200, entities[root].list());
    if (m === 'POST' && !idPart) return send(res, 201, await entities[root].create(await readJson(req)));
    if (m === 'DELETE' && idPart) return send(res, entities[root].remove(idPart) ? 200 : 404, { ok: true });
  }

  // Model ids contain "/" and ":", so they travel in the body or query string, not the path.
  if (root === 'models') {
    if (m === 'GET') return send(res, 200, { fetchedAt: openrouter.cachedModels().fetchedAt, models: catalog.all() });
    if (m === 'POST' && idPart === 'refresh') { await openrouter.refreshModels(); return send(res, 200, { fetchedAt: openrouter.cachedModels().fetchedAt, models: catalog.all() }); }
    if (m === 'POST' && !idPart) return send(res, 201, catalog.addModel(await readJson(req)));
    if (m === 'PUT' && idPart === 'price') { const b = await readJson(req); return send(res, 200, catalog.setPrice(b.id, b.price)); }
    if (m === 'DELETE') return send(res, 200, { ok: catalog.removeModel(url.searchParams.get('id')) });
    if (m === 'POST' && idPart === 'test') return send(res, 200, await testModel((await readJson(req)).id));
  }
  if (root === 'quote' && m === 'POST') {
    try { return send(res, 200, catalog.quote(await readJson(req))); }
    catch (e) { return send(res, 200, { error: e.message }); } // soft: the UI shows why there is no price yet
  }
  if (root === 'autopilot' && m === 'POST') return send(res, 201, await autopilot.run(await readJson(req)));
  if (root === 'compose' && m === 'POST') return send(res, 200, await composer.compose(await readJson(req)));
  if (root === 'ledger.csv' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="spend.csv"' });
    return res.end(ledger.csv());
  }
  if (root === 'spend' && m === 'GET') return send(res, 200, ledger.summary());
  if (root === 'ledger' && m === 'GET') return send(res, 200, store.db.ledger.slice(-500).reverse());
  if (root === 'jobs') {
    if (m === 'GET') return send(res, 200, store.db.jobs);
    if (m === 'POST' && idPart === 'batch') return send(res, 201, pipeline.createBatch(await readJson(req)));
    if (m === 'POST' && !idPart) return send(res, 201, pipeline.create(await readJson(req)));
    if (m === 'POST' && action === 'retry') return send(res, 200, pipeline.retry(idPart));
    if (m === 'DELETE' && idPart) { pipeline.remove(idPart); return send(res, 200, { ok: true }); }
  }
  if (root === 'meta' && m === 'GET') {
    return send(res, 200, { formats: Object.fromEntries(Object.entries(composer.FORMATS).map(([k, v]) => [k, v.label])), platforms: composer.PLATFORMS, ratios: pipeline.RATIOS });
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
  });
}
module.exports = { server };
