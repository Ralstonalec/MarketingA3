'use strict';
// Demo provider: no network, no cost. Produces SVG placeholders so the whole
// pipeline (jobs, gallery, polling) can be exercised before you add a real key.
const fs = require('fs');
const path = require('path');
const store = require('../store');

const tasks = new Map();

function svg(label, ratio) {
  const [w, h] = ratio.split(':').map(Number);
  const W = 720, H = Math.round((720 * h) / w);
  const esc = (s) => s.replace(/[<&>]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#ec4899"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>
<text x="50%" y="46%" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#fff" font-weight="700">DEMO PROVIDER</text>
<text x="50%" y="54%" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#fff" opacity=".85">${esc(label).slice(0, 48)}</text></svg>`;
}

module.exports = {
  name: 'mock',
  label: 'Demo (free, placeholder output)',
  supportsVideo: false,

  async startImage({ prompt, ratio }) {
    const t = { id: store.id('mock'), kind: 'image', ratio, prompt, polls: 0 };
    tasks.set(t.id, t);
    return { taskId: t.id };
  },
  async startVideo() {
    throw new Error('The demo provider cannot render video. Select Runway in Settings.');
  },
  async poll(taskId) {
    const t = tasks.get(taskId);
    if (!t) return { status: 'FAILED', error: 'Demo task lost after restart' };
    if (++t.polls < 2) return { status: 'RUNNING' };
    const name = `${taskId}.svg`;
    fs.writeFileSync(path.join(store.OUTPUTS, name), svg(t.prompt, t.ratio));
    return { status: 'SUCCEEDED', local: name };
  },
};
