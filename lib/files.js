'use strict';
// Shared file helpers for generated outputs and uploads.
const fs = require('fs');
const path = require('path');
const store = require('./store');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
};
const EXT_FOR = Object.fromEntries(Object.entries(MIME).filter(([e]) => !['jpeg'].includes(e)).map(([e, m]) => [m, e]));

const kindOf = (name) => { const m = MIME[path.extname(name).slice(1).toLowerCase()] || ''; return m.split('/')[0] || 'file'; };

/** Provider output URLs expire, so always keep our own copy. Extension comes from the URL, else the content type. */
async function materialize(out, base) {
  if (out.local) return out.local;
  const res = await fetch(out.url);
  if (!res.ok) throw new Error(`Could not download result (${res.status})`);
  let ext = path.extname(new URL(out.url).pathname).toLowerCase();
  if (!MIME[ext.slice(1)]) ext = '.' + (EXT_FOR[String(res.headers.get('content-type') || '').split(';')[0].trim()] || 'bin');
  const name = base + ext;
  fs.writeFileSync(path.join(store.OUTPUTS, name), Buffer.from(await res.arrayBuffer()));
  return name;
}

function dataUrl(dir, name) {
  const file = path.join(dir, path.basename(name));
  const mime = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}
const outputDataUrl = (name) => dataUrl(store.OUTPUTS, name);
const uploadDataUrl = (name) => dataUrl(store.UPLOADS, name);

module.exports = { materialize, outputDataUrl, uploadDataUrl, kindOf, MIME };
