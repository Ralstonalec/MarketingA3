'use strict';
const quick = { productId: null, actorId: null, brief: '', platform: 'tiktok', variants: 1, scenes: 1, withVideo: null };

function setupChecklist() {
  const prog = setupProgress();
  if (prog.complete) return null;
  return h('div', { class: 'panel', style: 'margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap' },
    h('div', { style: 'flex:1;min-width:200px' }, h('b', {}, `Setup ${prog.done} of ${prog.total}`), h('div', { class: 'bar' }, h('i', { style: `width:${(prog.done / prog.total) * 100}%` })), h('div', { class: 'small', style: 'margin-top:6px' }, 'Finish setup once, then every ad is one click.')),
    h('button', { class: 'primary', onclick: () => { state.view = 'setup'; render(); } }, 'Continue setup'));
}

function viewQuick() {
  const q = quick, s = state.settings, d = s.defaults;
  if (q.withVideo === null) q.withVideo = !!d.video;
  if (!q.productId && state.products.length === 1) q.productId = state.products[0].id;
  if (!q.actorId && state.actors.length === 1) q.actorId = state.actors[0].id;

  const names = [['Writes with', d.text, 'Free template'], ['Image', d.image, 'none'], ...(q.withVideo ? [['Video', d.video, 'none']] : [])]
    .map(([label, id, none]) => h('div', { class: 'ln', style: 'display:flex;justify-content:space-between;font-size:13px' }, h('span', { class: 'small' }, label), h('span', {}, id && modelById(id) ? modelById(id).label : none)));

  const btn = h('button', { class: 'primary', disabled: true, style: 'width:100%;font-size:16px;padding:13px' }, 'Write & render my ad');
  const qb = quoteBox(() => {
    if (!q.productId || !q.actorId || !d.image) return null;
    return { textModel: d.text || undefined, textCalls: q.variants, imageModel: d.image, videoModel: q.withVideo ? d.video : undefined, withVideo: q.withVideo, sceneSeconds: Array(q.variants * q.scenes).fill(5) };
  }, (quote) => { btn.disabled = !quote; });
  const refreshQuote = () => qb.update();
  btn.addEventListener('click', guard(async () => {
    btn.disabled = true; btn.textContent = 'Writing your ad…';
    try {
      await api('POST', 'autopilot', { productId: q.productId, actorId: q.actorId, brief: q.brief, platform: q.platform, variants: q.variants, scenes: q.scenes, withVideo: q.withVideo });
      toast('Ad written. Rendering now.'); state.view = 'gallery'; await refreshLight(); render();
    } catch (e) { btn.textContent = 'Write & render my ad'; refreshQuote(); throw e; }
  }));

  const panel = h('div', { class: 'panel', style: 'max-width:640px' },
    h('label', {}, '1. Product'), entityPicker(state.products, () => q.productId, (id) => { q.productId = id; refreshQuote(); }, 'Add a product in the Library first.'),
    h('label', {}, '2. Actor'), entityPicker(state.actors, () => q.actorId, (id) => { q.actorId = id; refreshQuote(); }, 'Add an actor in the Library first.'),
    h('label', {}, '3. Any idea? (optional)'), h('textarea', { style: 'min-height:60px', placeholder: 'e.g. 20% off this weekend, targeting busy moms. Leave blank and it will decide.', oninput: (e) => (q.brief = e.target.value) }, q.brief),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Platform'), chips(Object.keys(state.meta.platforms), () => q.platform, (v) => (q.platform = v), (k) => state.meta.platforms[k].split(' (')[0])),
      h('div', {}, h('label', {}, 'Versions'), chips([1, 2, 3], () => q.variants, (v) => { q.variants = v; refreshQuote(); })),
      h('div', {}, h('label', {}, 'Scenes each'), chips([1, 2, 3], () => q.scenes, (v) => { q.scenes = v; refreshQuote(); }))),
    d.video ? [h('label', {}, 'Include video'), chips([true, false], () => q.withVideo, (v) => { q.withVideo = v; render(); }, (v) => (v ? 'Image + video' : 'Image only'))] : null,
    h('div', { class: 'quote', style: 'margin-top:16px' }, names, h('div', { class: 'small', style: 'margin-top:6px' }, 'Models come from your defaults. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); state.view = 'models'; render(); } }, 'Change'))),
    qb.el, btn);
  qb.update.now();
  return h('div', {}, h('h1', {}, 'Quick Ad'), h('p', { class: 'sub' }, 'Pick a product and an actor. The app writes the ad and renders it. You see the full price first.'), setupChecklist(), panel);
}
