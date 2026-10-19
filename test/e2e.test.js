'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-'));
process.env.POLL_MS = '10';
const { server } = require('../server');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let base;
const call = async (m, u, b) => {
  const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

test.before(() => new Promise((r) => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); })));
test.after(() => server.close());

test('product + actor -> demo ad job completes', async () => {
  const prod = (await call('POST', '/api/products', { name: 'Glow Serum', description: 'Vitamin C', images: [PNG] })).body;
  const act = (await call('POST', '/api/actors', { name: 'Maya', images: [PNG] })).body;
  assert.ok(prod.id && act.id);

  const job = (await call('POST', '/api/jobs', { productId: prod.id, actorId: act.id, format: 'ugc', ratio: '9:16', duration: 5, withVideo: false, brief: 'summer' })).body;
  assert.ok(['queued', 'running'].includes(job.status));

  let j;
  for (let i = 0; i < 100; i++) {
    j = (await call('GET', '/api/jobs')).body.find((x) => x.id === job.id);
    if (j.status === 'done' || j.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(j.status, 'done', j.error);
  assert.match(j.copy.imagePrompt, /@actor/);
  const img = await fetch(`${base}/files/outputs/${j.image.file}`);
  assert.equal(img.status, 200);
});

test('validation and safety', async () => {
  assert.equal((await call('POST', '/api/products', { name: '', images: [PNG] })).status, 400);
  assert.equal((await call('POST', '/api/products', { name: 'x', images: ['data:text/html;base64,AAAA'] })).status, 400);
  assert.equal((await fetch(`${base}/files/uploads/..%2f..%2fdb.json`)).status, 404);
  const s = (await call('PUT', '/api/settings', { keys: { runway: 'key_abcdefgh1234' } })).body;
  assert.equal(JSON.stringify(s).includes('abcdefgh1234'), false);
  const v = await call('POST', '/api/jobs', { productId: 'nope', actorId: 'nope', ratio: '9:16' });
  assert.equal(v.status, 400);
});

test('custom provider drives a self-hosted image + video model', async () => {
  const http = require('http');
  const seen = [];
  // Fake model server: POST /img|/vid -> job id; GET /status/:id -> running once, then done; GET /out/:id -> file.
  const polls = {};
  const fake = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      const port = fake.address().port;
      if (req.method === 'POST') {
        const j = JSON.parse(body); seen.push({ path: req.url, auth: req.headers.authorization, j });
        return send({ id: req.url.slice(1), status_url: `http://127.0.0.1:${port}/status${req.url}`, response_url: `http://127.0.0.1:${port}/out${req.url}` });
      }
      if (req.url.startsWith('/status')) { polls[req.url] = (polls[req.url] || 0) + 1; return send({ status: polls[req.url] < 2 ? 'IN_PROGRESS' : 'COMPLETED' }); }
      if (req.url.startsWith('/out')) return send({ result: { url: `http://127.0.0.1:${port}/file${req.url.slice(4)}.png` } });
      res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from(PNG.split(',')[1], 'base64'));
    });
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const root = `http://127.0.0.1:${fake.address().port}`;
  const stageCfg = (path, body) => ({
    submit: { url: root + path, headers: { Authorization: 'Key {{apiKey}}' }, body },
    poll: { url: '{{submit.status_url}}', statusPath: 'status', resultUrl: '{{submit.response_url}}' },
    resultPath: 'result.url',
  });
  const put = await call('PUT', '/api/settings', {
    provider: 'custom', keys: { custom: 'sekret' },
    custom: {
      image: stageCfg('/img', { prompt: '{{prompt}}', imgs: '{{images}}', size: '{{width}}x{{height}}' }),
      video: stageCfg('/vid', { prompt: '{{prompt}}', image: '{{image}}', seconds: '{{duration|string}}' }),
    },
  });
  assert.equal(put.status, 200);
  assert.equal(JSON.stringify(put.body).includes('sekret'), false);

  const prod = (await call('POST', '/api/products', { name: 'P', images: [PNG] })).body;
  const act = (await call('POST', '/api/actors', { name: 'A', images: [PNG] })).body;
  const job = (await call('POST', '/api/jobs', { productId: prod.id, actorId: act.id, format: 'ugc', ratio: '9:16', duration: 10, withVideo: true })).body;
  let j;
  for (let i = 0; i < 200; i++) {
    j = (await call('GET', '/api/jobs')).body.find((x) => x.id === job.id);
    if (j.status === 'done' || j.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(j.status, 'done', j.error);
  assert.ok(j.video.file);
  const [img, vid] = seen;
  assert.equal(img.auth, 'Key sekret');
  assert.equal(img.j.imgs.length, 2);              // actor + product references
  assert.equal(img.j.size, '720x1280');
  assert.match(vid.j.image, /^data:image\//);       // keyframe passed as data URI
  assert.equal(vid.j.seconds, '10');                // |string filter
  assert.equal(JSON.stringify(j).includes('sekret'), false); // key never persisted on the job
  fake.close();
  await call('PUT', '/api/settings', { provider: 'mock' });
});

test('custom config validation', async () => {
  const r = await call('PUT', '/api/settings', { custom: { image: { submit: { url: 'ftp://x' } } } });
  assert.equal(r.status, 400);
});
