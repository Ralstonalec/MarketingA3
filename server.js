'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch {}

const store = require('./lib/store');
const settings = require('./lib/settings');
const providers = require('./lib/providers');
const pipeline = require('./lib/pipeline');
const copywriter = require('./lib/copywriter');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PASSWORD = process.env.APP_PASSWORD || '';
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

function authorized(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const pass = Buffer.from(h.slice(6), 'base64').toString().split(':').slice(1).join(':');
  return pass === PASSWORD;
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

// ---- router -----------------------------------------------------------------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [root, idPart, action] = parts;
  const m = req.method;

  if (root === 'settings') {
    if (m === 'GET') return send(res, 200, { ...settings.publicSettings(), providers: providers.list() });
    if (m === 'PUT') return send(res, 200, { ...settings.update(await readJson(req)), providers: providers.list() });
  }
  if (entities[root]) {
    if (m === 'GET' && !idPart) return send(res, 200, entities[root].list());
    if (m === 'POST' && !idPart) return send(res, 201, await entities[root].create(await readJson(req)));
    if (m === 'DELETE' && idPart) return send(res, entities[root].remove(idPart) ? 200 : 404, { ok: true });
  }
  if (root === 'copy' && m === 'POST') {
    const b = await readJson(req);
    const product = store.db.products.find((p) => p.id === b.productId);
    const actor = store.db.actors.find((a) => a.id === b.actorId);
    if (!product || !actor) throw Object.assign(new Error('Pick a product and an actor'), { code: 400 });
    return send(res, 200, await copywriter.write({ product, actor, brief: b.brief, format: b.format }));
  }
  if (root === 'estimate' && m === 'POST') return send(res, 200, pipeline.estimate(await readJson(req)));
  if (root === 'jobs') {
    if (m === 'GET') return send(res, 200, store.db.jobs);
    if (m === 'POST' && !idPart) return send(res, 201, pipeline.create(await readJson(req)));
    if (m === 'POST' && action === 'retry') return send(res, 200, pipeline.retry(idPart));
    if (m === 'DELETE' && idPart) { pipeline.remove(idPart); return send(res, 200, { ok: true }); }
  }
  if (root === 'meta' && m === 'GET') {
    return send(res, 200, { formats: Object.fromEntries(Object.entries(copywriter.FORMATS).map(([k, v]) => [k, v.label])), ratios: pipeline.RATIOS });
  }
  send(res, 404, { error: 'Not found' });
}

const server = http.createServer(async (req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Marketing A3"' });
    return res.end('Authentication required');
  }
  const url = new URL(req.url, 'http://x');
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
  server.listen(PORT, HOST, () => {
    console.log(`Marketing A3 running at http://${HOST}:${PORT}`);
    if (HOST !== '127.0.0.1' && !PASSWORD) console.warn('WARNING: listening on a non-local address without APP_PASSWORD');
    pipeline.resumeAll();
  });
}
module.exports = { server };
