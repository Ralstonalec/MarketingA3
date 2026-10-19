'use strict';
const fileKind = (name) => ({ png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image', mp4: 'video', webm: 'video', mov: 'video', mp3: 'audio', wav: 'audio', m4a: 'audio', ogg: 'audio' })[String(name).split('.').pop().toLowerCase()] || 'file';

/** Show any output file the right way (image / video / audio). */
function mediaFor(file, alt) {
  const src = `/files/outputs/${file}`, k = fileKind(file);
  if (k === 'video') return h('video', { src, controls: true, loop: true, playsinline: true, preload: 'metadata' });
  if (k === 'audio') return h('div', { style: 'padding:24px 12px;background:var(--panel2)' }, h('audio', { src, controls: true, style: 'width:100%' }));
  if (k === 'image') return h('img', { class: 'fit', src, alt: alt || 'result' });
  return h('div', { class: 'empty' }, file);
}

/** Send a finished file to the Tools page, where it fills the first matching input slot. */
function useInTools(file) {
  const kind = fileKind(file);
  if (!['image', 'video', 'audio'].includes(kind)) return null;
  return h('button', { onclick: () => { state.tools.preset = { kind, file }; state.view = 'tools'; render(); } }, 'Use in Tools');
}

function runCard(r) {
  const m = modelById(r.modelId);
  return h('div', { class: 'card' },
    r.file ? mediaFor(r.file, r.title) : h('div', { class: 'empty', style: 'aspect-ratio:1' }, r.status === 'failed' ? 'Failed' : 'Working…'),
    h('div', { class: 'body' }, h('h3', {}, r.title),
      h('p', {}, h('span', { class: `status ${r.status}` }, r.status), ' ', m ? m.kind : r.kind),
      r.prompt ? h('p', { class: 'small', style: 'margin-top:4px' }, r.prompt.slice(0, 120)) : null,
      h('p', { style: 'margin-top:4px' }, r.charged ? `Spent: ${money(r.usd)}${r.basis === 'estimate' ? ' (est.)' : ''}` : `Estimate: ${money(r.estimate.usd)}`),
      r.error ? h('div', { class: 'err' }, r.error) : null),
    h('div', { class: 'actions' },
      r.file ? h('a', { href: `/files/outputs/${r.file}`, download: r.file }, 'Download') : null, r.file ? useInTools(r.file) : null,
      r.status === 'failed' ? h('button', { onclick: guard(async () => { await api('POST', `runs/${r.id}/retry`); await refreshLight(); render(); }) }, 'Retry') : null,
      h('button', { onclick: guard(async () => { if (confirm('Delete this result? Spend stays on record.')) { await api('DELETE', `runs/${r.id}`); await refreshLight(); render(); } }) }, 'Delete')));
}

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
      file ? h('a', { href: `/files/outputs/${file}`, download: file }, 'Download') : null, file ? useInTools(file) : null,
      j.status === 'failed' ? h('button', { onclick: guard(async () => { await api('POST', `jobs/${j.id}/retry`); await refreshLight(); render(); }) }, 'Retry') : null,
      h('button', { onclick: guard(async () => { if (confirm('Delete this ad? Spend stays on record.')) { await api('DELETE', `jobs/${j.id}`); await refreshLight(); render(); } }) }, 'Delete')));
}

function viewGallery() {
  if (!state.jobs.length && !state.runs.length) return h('div', {}, h('h1', {}, 'Gallery'), h('div', { class: 'empty panel' }, h('div', {}, 'Nothing here yet.'), h('div', { class: 'btnrow' }, h('button', { class: 'primary', onclick: () => { state.view = 'quick'; render(); } }, 'Make your first ad'))));
  const groups = new Map();
  for (const j of state.jobs) { const k = j.campaignId || j.id; (groups.get(k) || groups.set(k, []).get(k)).push(j); }
  return h('div', {}, h('h1', {}, 'Gallery'), h('p', { class: 'sub' }, 'Scenes from the same concept are grouped together.'),
    [...groups.values()].map((js) => h('section', { style: 'margin-bottom:28px' },
      js.length > 1 ? h('h2', {}, (js[0].title || '').replace(/ · scene \d+$/, '') || 'Campaign', ' ', h('span', { class: 'small' }, `${js.length} scenes`)) : null,
      h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(260px,1fr))' }, [...js].reverse().map(jobCard)))),
    state.runs.length ? h('section', {}, h('h2', {}, 'Tool results'), h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(260px,1fr))' }, state.runs.map(runCard))) : null);
}
