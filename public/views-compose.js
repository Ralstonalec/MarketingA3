'use strict';
const PLATFORM_RATIO = { tiktok: '9:16', reels: '9:16', shorts: '9:16', meta: '1:1', youtube: '16:9' };
const copyText = (t) => navigator.clipboard.writeText(t).then(() => toast('Copied'), () => toast('Copy failed'));

function defaultRender(platform) {
  const d = state.settings.defaults;
  return { imageModel: d.image || null, videoModel: d.video || null, withVideo: !!d.video, ratio: PLATFORM_RATIO[platform] || '9:16' };
}

/** Image + optional video model pickers, ratio, live quote and a generate button. Shared by Composer and Studio. */
function renderControls(r, { getScenes, onGenerate, label }) {
  const btn = h('button', { class: 'primary', disabled: true, style: 'width:100%' }, label);
  const q = quoteBox(() => {
    const sc = getScenes();
    if (!r.imageModel || (r.withVideo && !r.videoModel)) return null;
    return { imageModel: r.imageModel, videoModel: r.withVideo ? r.videoModel : undefined, withVideo: r.withVideo, sceneSeconds: sc.map((s) => s.seconds) };
  }, (quote) => { btn.disabled = !quote; });
  btn.addEventListener('click', guard(async () => {
    btn.disabled = true;
    try { await onGenerate(); } finally { q.update(); }
  }));
  const videoBox = h('div', {});
  const drawVideo = () => videoBox.replaceChildren(...(r.withVideo ? [h('label', {}, 'Video model'), modelPicker({ kind: 'video', value: r.videoModel, onChange: (id) => { r.videoModel = id; q.update(); } })] : []));
  drawVideo();
  const root = h('div', {},
    h('label', {}, 'Image model (actor + product → still frame)'),
    modelPicker({ kind: 'image', value: r.imageModel, onChange: (id) => { r.imageModel = id; q.update(); } }),
    h('label', {}, 'Output'),
    h('div', { class: 'chips' }, [false, true].map((v) => h('button', { type: 'button', class: 'chip' + (r.withVideo === v ? ' sel' : ''), onclick: (e) => {
      r.withVideo = v; e.target.parentNode.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('sel', (i === 1) === v)); drawVideo(); q.update();
    } }, v ? 'Image + video' : 'Image only'))),
    videoBox,
    h('label', {}, 'Aspect ratio'), chips(state.meta.ratios, () => r.ratio, (v) => (r.ratio = v)),
    q.el, btn);
  q.update.now();
  root._q = q;
  return root;
}

function qualityBox(c) {
  const errs = (c.warnings || []).filter((w) => w.level === 'error'), notes = (c.warnings || []).filter((w) => w.level === 'note');
  if (!errs.length && !notes.length) return null;
  return h('div', { class: 'quote', style: 'margin:8px 0' },
    errs.length ? h('div', { class: 'warn' }, h('b', {}, 'Review before rendering: '), errs.map((w) => w.text).join(' ')) : null,
    notes.length ? h('div', { class: 'small' }, notes.map((w) => w.text).join(' · ')) : null);
}

function conceptCard(c, i) {
  const st = state.compose;
  const r = c.render || (c.render = defaultRender(st.platform));
  const tagsText = c.hashtags.join(' ');
  let ctrl;
  return h('div', { class: 'concept' },
    h('div', { class: 'row', style: 'margin-bottom:4px' }, h('h3', {}, `${i + 1}. ${c.title}`), h('div', { class: 'fit chips' }, c.framework ? h('span', { class: 'tag' }, (state.meta.formats[c.framework] || c.framework)) : null, c.angle ? h('span', { class: 'tag' }, c.angle) : null, c.attempts > 1 ? h('span', { class: 'tag est', title: 'The first draft broke a rule, so the writer was asked to fix it' }, `fixed in ${c.attempts} tries`) : null)),
    qualityBox(c),
    h('div', { class: 'hook' }, `“${c.hook}”`),
    h('label', {}, 'Script'), h('textarea', { oninput: (e) => (c.script = e.target.value) }, c.script),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Caption'), h('textarea', { style: 'min-height:56px', oninput: (e) => (c.caption = e.target.value) }, c.caption)),
      h('div', {}, h('label', {}, 'CTA'), h('input', { value: c.cta, oninput: (e) => (c.cta = e.target.value) }), h('div', { class: 'small', style: 'margin-top:6px' }, tagsText))),
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'ghost fit', onclick: () => copyText(`${c.script}\n\n${c.caption} ${tagsText}`) }, 'Copy script + caption')),
    c.scenes.map((s, n) => h('div', { class: 'scene' },
      h('div', { class: 'row' }, h('strong', {}, `Scene ${n + 1}`), h('div', { class: 'fit small' }, 'seconds ', h('input', { type: 'number', min: '2', max: '15', value: s.seconds, style: 'width:64px', oninput: (e) => { s.seconds = Number(e.target.value) || 5; c._q && c._q.update(); } }))),
      h('label', {}, 'Image prompt'), h('textarea', { oninput: (e) => (s.imagePrompt = e.target.value) }, s.imagePrompt),
      h('label', {}, 'Motion prompt'), h('textarea', { oninput: (e) => (s.motionPrompt = e.target.value) }, s.motionPrompt),
      s.voiceover ? [h('label', {}, 'Voiceover'), h('input', { value: s.voiceover, oninput: (e) => (s.voiceover = e.target.value) })] : null)),
    h('div', { class: 'panel', style: 'margin-top:14px;background:var(--panel2)' }, h('h3', {}, 'Render this concept'),
      (ctrl = renderControls(r, {
        getScenes: () => c.scenes,
        label: `Generate ${c.scenes.length} scene${c.scenes.length > 1 ? 's' : ''}`,
        onGenerate: async () => {
          await api('POST', 'jobs/batch', { productId: st.productId, actorId: st.actorId, imageModel: r.imageModel, videoModel: r.withVideo ? r.videoModel : undefined, withVideo: r.withVideo, ratio: r.ratio, title: c.title, scenes: c.scenes });
          toast('Started. Watch progress in the Gallery.'); state.view = 'gallery'; await refreshLight(); render();
        },
      }), (c._q = ctrl._q), ctrl)));
}

function viewCompose() {
  const c = state.compose;
  if (!c.textInit) { c.textModel = state.settings.defaults.text || null; c.textInit = true; }
  if (!c.productId && state.products.length === 1) c.productId = state.products[0].id;
  if (!c.actorId && state.actors.length === 1) c.actorId = state.actors[0].id;
  const noModels = !state.models.some((m) => m.kind === 'text');
  const textQuoteWrap = h('div', {});
  const drawTextQuote = () => {
    if (!c.textModel) { textQuoteWrap.replaceChildren(h('div', { class: 'quote' }, h('div', { class: 'ln' }, h('span', {}, 'Template composer'), h('span', {}, '$0')), h('div', { class: 'small' }, 'Free, but simple. Choose an OpenRouter model for original concepts.'))); return; }
    const qb = quoteBox(() => ({ textModel: c.textModel, textCalls: c.variants * (c.polish ? 2 : 1) })); textQuoteWrap.replaceChildren(qb.el); qb.update.now();
  };
  drawTextQuote();
  const go = h('button', { class: 'primary', style: 'width:100%', disabled: c.busy || !(c.productId && c.actorId), onclick: guard(async (e) => {
    c.busy = true; e.target.disabled = true; e.target.textContent = 'Composing…';
    try {
      const res = await api('POST', 'compose', { ...c, framework: c.framework || undefined, camera: c.camera || undefined, look: c.look || undefined, textModel: c.textModel || undefined });
      res.concepts.forEach((x) => (x.render = defaultRender(c.platform)));
      c.result = res; await refreshLight();
    } finally { c.busy = false; render(); }
  }) }, c.result ? 'Compose again' : 'Compose ads');

  const left = h('div', { class: 'panel' },
    h('label', {}, 'Product'), entityPicker(state.products, () => c.productId, (id) => { c.productId = id; go.disabled = !(c.productId && c.actorId); }, 'Add a product in the Library first.'),
    h('label', {}, 'Actor'), entityPicker(state.actors, () => c.actorId, (id) => { c.actorId = id; go.disabled = !(c.productId && c.actorId); }, 'Add an actor in the Library first.'),
    h('label', {}, 'Platform'), chips(Object.keys(state.meta.platforms), () => c.platform, (v) => (c.platform = v), (k) => state.meta.platforms[k].split(' (')[0]),
    h('label', {}, 'Ad structure'), chips(['', ...Object.keys(state.meta.formats)], () => c.framework, (v) => (c.framework = v), (k) => (k ? state.meta.formats[k] : 'Auto (mix)')),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Camera'), h('select', { onchange: (e) => (c.camera = e.target.value) }, h('option', { value: '' }, 'Auto'), state.meta.cameras.map((x) => h('option', { value: x.id, selected: c.camera === x.id }, x.label)))),
      h('div', {}, h('label', {}, 'Look'), h('select', { onchange: (e) => (c.look = e.target.value) }, h('option', { value: '' }, 'Auto (fits structure)'), state.meta.looks.map((x) => h('option', { value: x.id, selected: c.look === x.id }, x.label))))),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Tone'), h('input', { value: c.tone, oninput: (e) => (c.tone = e.target.value) })), h('div', {}, h('label', {}, 'Call to action'), h('input', { placeholder: 'from Brand settings', value: c.cta, oninput: (e) => (c.cta = e.target.value) }))),
    h('label', {}, 'Brief'), h('textarea', { placeholder: 'Offer, audience, what to emphasise, what to avoid…', oninput: (e) => (c.brief = e.target.value) }, c.brief),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Concepts'), h('input', { type: 'number', min: '1', max: '4', value: c.variants, oninput: (e) => { c.variants = Number(e.target.value) || 1; drawTextQuote(); } })),
      h('div', {}, h('label', {}, 'Scenes each'), h('input', { type: 'number', min: '1', max: '5', value: c.scenes, oninput: (e) => (c.scenes = Number(e.target.value) || 1) })),
      h('div', {}, h('label', {}, 'Seconds / scene'), h('input', { type: 'number', min: '2', max: '15', value: c.sceneSeconds, oninput: (e) => (c.sceneSeconds = Number(e.target.value) || 5) }))),
    h('label', {}, 'Quality'), chips([false, true], () => c.polish, (v) => { c.polish = v; drawTextQuote(); }, (v) => (v ? 'Polish pass (best, 2× writing cost)' : 'Standard')),
    h('label', {}, 'Writing model (OpenRouter)'),
    modelPicker({ kind: 'text', value: c.textModel, noneLabel: 'Free template (no AI)', onChange: (id) => { c.textModel = id; drawTextQuote(); } }),
    noModels ? h('p', { class: 'small' }, 'No text models loaded. Add your OpenRouter key in Settings, then press “Refresh OpenRouter list” in Models.') : null,
    textQuoteWrap, go);

  const right = c.result
    ? h('div', {}, h('div', { class: 'row', style: 'margin-bottom:12px' }, h('h2', { style: 'margin:0' }, `${c.result.concepts.length} concept${c.result.concepts.length > 1 ? 's' : ''}`),
        h('span', { class: 'small fit' }, `Written by ${c.result.source} · ${c.result.calls ? c.result.calls + ' call' + (c.result.calls > 1 ? 's' : '') + ' · ' : ''}cost ${money(c.result.usd)}${c.result.basis ? ` (${c.result.basis})` : ''}${c.result.failed ? ` · ${c.result.failed} version(s) failed` : ''}`)),
      c.result.concepts.map(conceptCard))
    : h('div', { class: 'panel empty' }, 'Pick a product and actor, describe the ad, and compose. You’ll get editable concepts with scripts, scene prompts and captions, each with a price before you render.');
  return h('div', {}, h('h1', {}, 'Ad Composer'), h('p', { class: 'sub' }, 'A text model of your choice writes the ad. You review it, pick image and video models, see the exact estimate, then render.'), h('div', { class: 'cols' }, left, right));
}

// Same wording the composer uses, so manual prompts get the same proven phrasing.
const CAMERA_TEXT = { dolly_in: 'slow smooth dolly in toward the subject', dolly_out: 'slow dolly out revealing more of the scene', orbit: 'camera slowly orbits around the subject, subject stays centered', handheld: 'natural handheld camera with subtle sway, selfie-style framing', crane_up: 'camera cranes upward and tilts down, revealing the scene', tracking: 'camera tracks sideways, keeping pace with the subject', whip_pan: 'fast whip pan to the subject, settling into a steady frame', macro_slide: 'macro lens, camera slides slowly across the surface detail', rack_focus: 'rack focus from foreground to the product', push_in_tilt: "slow push-in while tilting up to the subject's face", fpv: 'smooth first-person fly-through toward the subject', static: 'static locked-off camera, only the subject moves' };
const LOOK_TEXT = { ugc: 'shot on a smartphone, natural light, casual authentic setting', natural: 'soft natural window light, real-life setting, true-to-life colors', studio: 'clean studio, soft key light, shallow depth of field, premium commercial look', golden: 'warm golden hour sunlight, soft long shadows', neon: 'night scene with colorful neon practical lights, cinematic contrast', luxe: 'moody cinematic lighting, rich contrast, high-end campaign look', macro: 'macro photography, crisp texture detail, soft background blur', bright: 'bright airy interior, white and pastel tones, soft diffused light' };

function viewStudio() {
  const s = state.studio;
  if (!s.productId && state.products.length === 1) s.productId = state.products[0].id;
  if (!s.actorId && state.actors.length === 1) s.actorId = state.actors[0].id;
  if (!s.init) {
    const d = state.settings.defaults;
    Object.assign(s, { init: true, imageModel: d.image || null, videoModel: d.video || null, withVideo: !!d.video, imagePrompt: '@actor holding @product, bright studio, soft light, photorealistic, product label clearly visible.', motionPrompt: 'slow push-in, the person smiles and shows the product to camera.' });
  }
  const imgBox = h('textarea', { style: 'min-height:110px', oninput: (e) => (s.imagePrompt = e.target.value) }, s.imagePrompt);
  const motBox = h('textarea', { oninput: (e) => (s.motionPrompt = e.target.value) }, s.motionPrompt);
  const addTo = (box, key, text) => { s[key] = `${s[key].replace(/[.,\s]+$/, '')}, ${text}`; box.value = s[key]; };
  const controls = renderControls(s, {
    getScenes: () => [{ seconds: s.duration }],
    label: 'Generate',
    onGenerate: async () => {
      if (!s.productId || !s.actorId) throw new Error('Pick a product and an actor');
      await api('POST', 'jobs', { productId: s.productId, actorId: s.actorId, imageModel: s.imageModel, videoModel: s.withVideo ? s.videoModel : undefined, withVideo: s.withVideo, ratio: s.ratio, duration: s.duration, scene: { imagePrompt: s.imagePrompt, motionPrompt: s.motionPrompt } });
      toast('Started. Watch progress in the Gallery.'); state.view = 'gallery'; await refreshLight(); render();
    },
  });
  return h('div', {}, h('h1', {}, 'Studio'), h('p', { class: 'sub' }, 'One scene, full control: write the prompts yourself. Use @actor and @product to refer to your uploads.'),
    h('div', { class: 'cols' },
      h('div', { class: 'panel' },
        h('label', {}, 'Product'), entityPicker(state.products, () => s.productId, (id) => (s.productId = id), 'Add a product in the Library first.'),
        h('label', {}, 'Actor'), entityPicker(state.actors, () => s.actorId, (id) => (s.actorId = id), 'Add an actor in the Library first.'),
        h('label', {}, 'Image prompt'), imgBox,
        h('div', { class: 'chips', style: 'margin-top:6px' }, state.meta.looks.map((x) => h('button', { type: 'button', class: 'chip', title: LOOK_TEXT[x.id], onclick: () => addTo(imgBox, 'imagePrompt', LOOK_TEXT[x.id]) }, '+ ' + x.label))),
        h('label', {}, 'Motion prompt (video)'), motBox,
        h('div', { class: 'chips', style: 'margin-top:6px' }, state.meta.cameras.map((x) => h('button', { type: 'button', class: 'chip', title: CAMERA_TEXT[x.id], onclick: () => addTo(motBox, 'motionPrompt', CAMERA_TEXT[x.id]) }, '+ ' + x.label))),
        h('label', {}, 'Video length (seconds)'), h('input', { type: 'number', min: '2', max: '15', value: s.duration, oninput: (e) => { s.duration = Number(e.target.value) || 5; controls._q.update(); } })),
      h('div', { class: 'panel' }, controls)));
}
