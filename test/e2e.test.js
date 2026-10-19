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
