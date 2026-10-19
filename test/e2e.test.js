'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'a3-'));
process.env.POLL_MS = '10';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---- fake OpenRouter: /models, /chat/completions (text + image) -------------------
const orSeen = [];
const orServer = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.headers.authorization !== 'Bearer or-key') return send({ error: { message: 'bad key' } }, 401);
    if (req.url === '/models') {
      return send({ data: [
        { id: 'acme/writer', name: 'Acme Writer', context_length: 8000, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.000003', completion: '0.000015' } },
        { id: 'acme/painter', name: 'Acme Painter', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] }, pricing: { prompt: '0.0000003', completion: '0.00003', image: '0.001' } },
        { id: 'acme/embed', name: 'Embedder', architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] }, pricing: { prompt: '0.1' } },
      ] });
    }
    const j = JSON.parse(body); orSeen.push(j);
    if (j.modalities) {
      return send({ choices: [{ message: { content: 'here', images: [{ image_url: { url: PNG } }] } }], usage: { cost: 0.0421 } });
    }
    const concept = (n) => ({ title: `Concept ${n}`, angle: 'social proof', hook: 'Hook', script: 'Script', scenes: [
      { seconds: 5, imagePrompt: 'Close up of @actor with @product', motionPrompt: 'push in', voiceover: 'vo1' },
      { seconds: 6, imagePrompt: 'Presenter smiling, product in hand', motionPrompt: 'drift', voiceover: 'vo2' }],
      caption: 'cap', hashtags: ['#ad'], cta: 'Buy' });
    const reply = 'Sure! ```json\n' + JSON.stringify({ concepts: [concept(1), concept(2)] }) + '\n``` hope that helps';
    send({ choices: [{ message: { content: reply } }], usage: { cost: 0.0123 } });
  });
});

// ---- fake queue-style video API (Higgsfield/fal shape) --------------------------------
const vidSeen = [];
const polls = {};
const vidServer = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    const port = vidServer.address().port;
    if (req.method === 'POST') {
      vidSeen.push({ auth: req.headers.authorization, j: JSON.parse(body) });
      return send({ request_id: 'r1', status_url: `http://127.0.0.1:${port}/status/r1`, response_url: `http://127.0.0.1:${port}/out/r1` });
    }
    if (req.url.startsWith('/status')) { polls[req.url] = (polls[req.url] || 0) + 1; return send({ status: polls[req.url] < 2 ? 'in_progress' : 'completed' }); }
    if (req.url.startsWith('/out')) return send({ video: { url: `http://127.0.0.1:${port}/file.mp4` } });
    res.writeHead(200, { 'content-type': 'video/mp4' }); res.end(Buffer.from('FAKEMP4'));
  });
});

let base;
const call = async (m, u, b) => {
  const r = await fetch(base + u, { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const waitJob = async (id) => {
  let j;
  for (let i = 0; i < 300; i++) {
    j = (await call('GET', '/api/jobs')).body.find((x) => x.id === id);
    if (j.status === 'done' || j.status === 'failed') break;
    await new Promise((r) => setTimeout(r, 20));
  }
  return j;
};

let server, prod, act;
test.before(async () => {
  await new Promise((r) => orServer.listen(0, '127.0.0.1', r));
  await new Promise((r) => vidServer.listen(0, '127.0.0.1', r));
  process.env.OPENROUTER_BASE = `http://127.0.0.1:${orServer.address().port}`;
  ({ server } = require('../server'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  prod = (await call('POST', '/api/products', { name: 'Glow Serum', description: 'Vitamin C serum', images: [PNG] })).body;
  act = (await call('POST', '/api/actors', { name: 'Maya', description: 'friendly, 30s', images: [PNG] })).body;
});
test.after(() => { server.close(); orServer.close(); vidServer.close(); });

test('OpenRouter catalog shows live per-model prices and drops non-text/image models', async () => {
  await call('PUT', '/api/settings', { keys: { openrouter: 'or-key', higgsfield: 'hf-secret' } });
  const r = await call('POST', '/api/models/refresh');
  assert.equal(r.status, 200);
  const byId = Object.fromEntries(r.body.models.map((m) => [m.id, m]));
  assert.ok(!byId['or:acme/embed']);
  assert.deepEqual([byId['or:acme/writer'].price.in, byId['or:acme/writer'].price.out], [3, 15]); // USD per 1M tokens
  assert.equal(byId['or:acme/writer'].price.basis, 'live');
  assert.equal(byId['or:acme/painter'].kind, 'image');
  assert.equal(byId['or:acme/painter'].price.basis, 'live-estimate');
});

test('quotes itemise cost; unpriced models are refused rather than guessed', async () => {
  const q = (await call('POST', '/api/quote', { textModel: 'or:acme/writer', imageModel: 'or:acme/painter', scenes: 2 })).body;
  // text: (3*1500 + 15*1200)/1e6 = 0.0225 ; image: 30*1300/1e6 = 0.039 each
  assert.equal(q.lines[0].usd, 0.0225);
  assert.equal(q.lines[1].usd, 0.078);
  assert.equal(q.usd, 0.1005);
  const bad = await call('POST', '/api/quote', { imageModel: 'or:acme/painter', withVideo: true, videoModel: 'nope' });
  assert.match(bad.body.error, /Unknown model/);
  const hf = (await call('POST', '/api/models', {
    provider: 'higgsfield', kind: 'video', label: 'Test Video', // no price on purpose
    http: { submit: { url: `http://127.0.0.1:${vidServer.address().port}/run`, headers: { Authorization: 'Key {{apiKey}}' }, body: { prompt: '{{prompt}}', image_url: '{{image}}', duration: '{{duration|string}}' } },
      poll: { url: '{{submit.status_url}}', statusPath: 'status', resultUrl: '{{submit.response_url}}' }, resultPath: 'video.url' },
  })).body;
  assert.equal(hf.id, 'hf:test-video');
  assert.equal(hf.priced, false);
  const noPrice = await call('POST', '/api/quote', { imageModel: 'mock:image', withVideo: true, videoModel: hf.id, duration: 5 });
  assert.match(noPrice.body.error, /no price yet/);
  const set = await call('PUT', '/api/models/price', { id: hf.id, price: { usd: 0.12, unit: 'second' } });
  assert.equal(set.body.priced, true);
  const ok = (await call('POST', '/api/quote', { imageModel: 'mock:image', withVideo: true, videoModel: hf.id, duration: 5 })).body;
  assert.equal(ok.usd, 0.6);
});

test('composer: text model writes concepts, actual cost goes to the ledger', async () => {
  const r = await call('POST', '/api/compose', { textModel: 'or:acme/writer', productId: prod.id, actorId: act.id, brief: 'summer', format: 'ugc', platform: 'tiktok', variants: 2, scenes: 2 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.concepts.length, 2);
  assert.equal(r.body.usd, 0.0123);
  assert.equal(r.body.basis, 'actual');
  for (const sc of r.body.concepts[0].scenes) assert.ok(sc.imagePrompt.includes('@actor') && sc.imagePrompt.includes('@product'));
  const sent = orSeen.find((j) => j.model === 'acme/writer');
  assert.match(sent.messages[1].content, /Glow Serum/);
  const sp = (await call('GET', '/api/spend')).body;
  assert.equal(sp.total, 0.0123);
});

test('free template composer needs no model and costs nothing', async () => {
  const r = await call('POST', '/api/compose', { productId: prod.id, actorId: act.id, variants: 1, scenes: 3 });
  assert.equal(r.body.usd, 0);
  assert.equal(r.body.concepts[0].scenes.length, 3);
});

test('image via OpenRouter + video via Higgsfield-style API: stages charged once, actual vs estimate', async () => {
  const before = (await call('GET', '/api/spend')).body.total;
  const job = (await call('POST', '/api/jobs', {
    productId: prod.id, actorId: act.id, imageModel: 'or:acme/painter', videoModel: 'hf:test-video', withVideo: true, ratio: '9:16', duration: 5,
    scene: { imagePrompt: '@actor holds @product', motionPrompt: 'slow push in' }, title: 'T',
  })).body;
  assert.equal(job.estimate.usd, 0.039 + 0.6);
  const j = await waitJob(job.id);
  assert.equal(j.status, 'done', j.error);
  assert.equal(j.image.basis, 'actual'); assert.equal(j.image.usd, 0.0421);
  assert.equal(j.video.basis, 'estimate'); assert.equal(j.video.usd, 0.6);
  assert.ok(j.video.file.endsWith('.mp4'));
  const after = (await call('GET', '/api/spend')).body;
  assert.equal(Math.round((after.total - before) * 1e4) / 1e4, 0.6421);
  assert.ok(after.estimatedShare >= 0.6);
  // request shape sent to the image model: aspect ratio + both references
  const img = orSeen.find((x) => x.modalities);
  assert.equal(img.image_config.aspect_ratio, '9:16');
  assert.equal(img.messages[0].content.filter((c) => c.type === 'image_url').length, 2);
  // key + keyframe reached the video model
  assert.equal(vidSeen.at(-1).auth, 'Key ' + 'hf-secret');
  assert.match(vidSeen.at(-1).j.image_url, /^data:image\//);
  assert.equal(vidSeen.at(-1).j.duration, '5');
  assert.equal(JSON.stringify(j).includes('hf-secret'), false);
});

test('monthly budget blocks jobs, counting work already queued', async () => {
  const spent = (await call('GET', '/api/spend')).body.month;
  await call('PUT', '/api/settings', { budget: { monthlyUsd: spent + 0.05 } });
  const body = { productId: prod.id, actorId: act.id, imageModel: 'or:acme/painter', ratio: '1:1', scene: { imagePrompt: 'x' } }; // est 0.039
  const first = await call('POST', '/api/jobs', body);
  assert.equal(first.status, 201);
  const second = await call('POST', '/api/jobs', body); // 0.039 pending + 0.039 > 0.05
  assert.equal(second.status, 402);
  assert.match(second.body.error, /budget/);
  await waitJob(first.body.id);
  await call('PUT', '/api/settings', { budget: { monthlyUsd: 0 } });
});

test('batch from a concept creates one job per scene under one campaign', async () => {
  const r = await call('POST', '/api/jobs/batch', { productId: prod.id, actorId: act.id, imageModel: 'mock:image', ratio: '9:16', title: 'Concept 1',
    scenes: [{ seconds: 5, imagePrompt: 'a' }, { seconds: 5, imagePrompt: 'b' }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.length, 2);
  assert.equal(new Set(r.body.map((j) => j.campaignId)).size, 1);
  for (const j of r.body) assert.equal((await waitJob(j.id)).status, 'done');
});

test('a hosted-provider model with no key fails clearly instead of sending an empty key', async () => {
  await call('PUT', '/api/settings', { keys: { higgsfield: null } });
  const job = (await call('POST', '/api/jobs', { productId: prod.id, actorId: act.id, imageModel: 'mock:image', videoModel: 'hf:test-video', withVideo: true, ratio: '9:16', scene: { imagePrompt: 'x' } })).body;
  const j = await waitJob(job.id);
  assert.equal(j.status, 'failed');
  assert.match(j.error, /No Higgsfield API key/);
  await call('PUT', '/api/settings', { keys: { higgsfield: 'hf-secret' } });
});

test('model test shows the raw submit response; validation and key safety', async () => {
  const t = await call('POST', '/api/models/test', { id: 'hf:test-video' });
  assert.equal(t.body.submitResponse.request_id, 'r1');
  assert.equal((await call('POST', '/api/models', { provider: 'higgsfield', kind: 'video', label: 'x', http: { submit: { url: 'ftp://x' }, resultPath: 'a' } })).status, 400);
  const s = (await call('PUT', '/api/settings', {})).body;
  assert.equal(JSON.stringify(s).includes('hf-secret'), false);
  assert.equal(s.keys.higgsfield.set, true);
  assert.equal((await call('POST', '/api/products', { name: '', images: [PNG] })).status, 400);
  assert.equal((await fetch(`${base}/files/uploads/..%2f..%2fdb.json`)).status, 404);
  const csv = await (await fetch(`${base}/api/ledger.csv`)).text();
  assert.match(csv, /^time,kind,model,usd,basis/);
});
