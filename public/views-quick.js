'use strict';
const quick = { productId: null, actorId: null, brief: '', platform: 'tiktok', variants: 1, scenes: 1, withVideo: null };

function setupChecklist() {
  const s = state.settings, d = s.defaults;
  const items = [
    ['Add your OpenRouter key', s.keys.openrouter.set, 'settings'],
    ['Load models (Models → Refresh OpenRouter list)', state.models.some((m) => m.provider === 'openrouter'), 'models'],
    ['Choose a default image model (Models → Make default)', !!d.image && d.image !== 'mock:image', 'models'],
    ['Add a product', state.products.length > 0, 'library'],
    ['Add an actor', state.actors.length > 0, 'library'],
  ];
  if (items.every((i) => i[1])) return null;
  return h('div', { class: 'panel', style: 'margin-bottom:16px' }, h('h2', {}, 'Get ready'),
    h('p', { class: 'small', style: 'margin-top:-8px' }, 'Do these once, then every ad is one click.'),
    items.map(([label, ok, view]) => h('div', { class: 'row', style: 'padding:4px 0;gap:8px' },
      h('span', { class: 'fit', style: `color:var(--${ok ? 'ok' : 'mut'})` }, ok ? '✓' : '○'),
      h('span', { style: ok ? 'text-decoration:line-through;color:var(--mut)' : '' }, label),
      ok ? null : h('button', { class: 'ghost fit', onclick: () => { state.view = view; render(); } }, 'Go →'))));
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
    return { textModel: d.text || undefined, imageModel: d.image, videoModel: q.withVideo ? d.video : undefined, withVideo: q.withVideo, sceneSeconds: Array(q.variants * q.scenes).fill(5) };
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
