'use strict';
function jobCard(j) {
  const media = j.video && j.video.file ? h('video', { src: `/files/outputs/${j.video.file}`, controls: true, loop: true, playsinline: true, preload: 'metadata' })
    : j.image && j.image.file ? h('img', { class: 'fit', src: `/files/outputs/${j.image.file}`, alt: j.title || 'generated ad frame' })
    : h('div', { class: 'empty', style: 'aspect-ratio:1' }, j.status === 'failed' ? 'Failed' : `${j.stage}…`);
  const file = (j.video && j.video.file) || (j.image && j.image.file);
  const spent = [['Image', j.image], ['Video', j.video]].filter(([, s]) => s && s.charged)
    .map(([n, s]) => `${n} ${money(s.usd)}${s.basis === 'estimate' ? ' (est.)' : ''}`).join(' · ');
  const im = modelById(j.imageModel), vm = j.videoModel && modelById(j.videoModel);
  return h('div', { class: 'card' }, media,
    h('div', { class: 'body' },
      h('h3', {}, j.title || `${j.productName} × ${j.actorName}`),
      h('p', {}, h('span', { class: `status ${j.status}` }, j.status === 'running' ? `${j.stage}…` : j.status), ` ${j.ratio} · ${j.duration}s`),
      h('p', { class: 'small', style: 'margin-top:4px' }, `${im ? im.label : j.imageModel}${j.videoModel ? ' → ' + (vm ? vm.label : j.videoModel) : ''}`),
      h('p', { style: 'margin-top:4px' }, spent ? `Spent: ${spent}` : `Estimate: ${money(j.estimate.usd)}`),
      j.error ? h('div', { class: 'err' }, j.error) : null,
      j.scene && j.scene.voiceover ? h('p', { style: 'margin-top:6px' }, `“${j.scene.voiceover}”`) : null),
    h('div', { class: 'actions' },
      file ? h('a', { href: `/files/outputs/${file}`, download: file }, 'Download') : null,
      j.status === 'failed' ? h('button', { onclick: guard(async () => { await api('POST', `jobs/${j.id}/retry`); await refreshLight(); render(); }) }, 'Retry') : null,
      h('button', { onclick: guard(async () => { if (confirm('Delete this ad? Spend stays on record.')) { await api('DELETE', `jobs/${j.id}`); await refreshLight(); render(); } }) }, 'Delete')));
}

function viewGallery() {
  if (!state.jobs.length) return h('div', {}, h('h1', {}, 'Gallery'), h('div', { class: 'empty' }, 'No ads yet. Start in the Ad Composer.'));
  const groups = new Map();
  for (const j of state.jobs) { const k = j.campaignId || j.id; (groups.get(k) || groups.set(k, []).get(k)).push(j); }
  return h('div', {}, h('h1', {}, 'Gallery'), h('p', { class: 'sub' }, 'Scenes from the same concept are grouped together.'),
    [...groups.values()].map((js) => h('section', { style: 'margin-bottom:28px' },
      js.length > 1 ? h('h2', {}, (js[0].title || '').replace(/ · scene \d+$/, '') || 'Campaign', ' ', h('span', { class: 'small' }, `${js.length} scenes`)) : null,
      h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(260px,1fr))' }, [...js].reverse().map(jobCard)))));
}
