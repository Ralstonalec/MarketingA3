'use strict';
const TOOL_KINDS_UI = ['edit', 'upscale', 'lipsync', 'audio', 'image', 'video'];
const KIND_LABEL = { edit: 'Image edit', upscale: 'Upscale', lipsync: 'Lip-sync', audio: 'Audio', image: 'Image', video: 'Video' };

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  if (file.size > 25 * 1024 * 1024) return reject(new Error(`${file.name} is over 25 MB. Trim or compress it first.`));
  const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error(`Could not read ${file.name}`)); r.readAsDataURL(file);
});

/** One file input: pick from your Library or Gallery, or upload. Value is { upload } | { output } | { data }. */
function fileSlot(type, get, set) {
  const wrap = h('div', {});
  const preview = h('div', { style: 'margin-top:8px' });
  const outputs = [...state.jobs.flatMap((j) => [j.image && j.image.file, j.video && j.video.file]), ...state.runs.map((r) => r.file)].filter((f) => f && fileKind(f) === type);
  const lib = type === 'image' ? [...state.products.map((p) => ({ label: `Product: ${p.name}`, v: { upload: p.images[0] } })), ...state.actors.map((a) => ({ label: `Actor: ${a.name}`, v: { upload: a.images[0] } }))] : [];
  const options = [...lib.map((o, i) => ({ key: `lib${i}`, ...o })), ...outputs.map((f, i) => ({ key: `out${i}`, label: `Gallery: ${f}`, v: { output: f } }))];
  const draw = () => {
    const v = get();
    const url = !v ? null : v.data ? v.data : v.output ? `/files/outputs/${v.output}` : `/files/uploads/${v.upload}`;
    preview.replaceChildren(...(url ? [type === 'image' ? h('img', { src: url, style: 'max-height:120px;border-radius:8px', alt: '' }) : type === 'video' ? h('video', { src: url, controls: true, style: 'max-height:140px;max-width:100%' }) : h('audio', { src: url, controls: true })] : []));
  };
  const file = h('input', { type: 'file', accept: `${type}/*`, hidden: true, onchange: guard(async (e) => {
    const f = e.target.files[0]; if (!f) return;
    set({ data: type === 'image' ? await fileToDataUrl(f) : await readFileAsDataUrl(f) }); sel.value = 'upload'; draw();
  }) });
  const cur = get();
  const curKey = !cur ? '' : cur.data ? 'upload' : (options.find((o) => JSON.stringify(o.v) === JSON.stringify(cur)) || {}).key || '';
  const sel = h('select', { onchange: (e) => {
    const k = e.target.value;
    if (k === 'upload') { file.click(); return; }
    set(k ? options.find((o) => o.key === k).v : null); draw();
  } }, h('option', { value: '' }, `Choose ${type}…`), h('option', { value: 'upload' }, `Upload a ${type} file…`), options.map((o) => h('option', { value: o.key, selected: o.key === curKey }, o.label)));
  if (cur && cur.data) sel.value = 'upload';
  wrap.append(sel, file, preview); draw();
  return wrap;
}

function viewTools() {
  const t = state.tools;
  const model = t.modelId ? modelById(t.modelId) : null;
  const applyPreset = () => {
    const pre = t.preset, m = t.modelId && modelById(t.modelId);
    if (pre && m && (m.inputs || []).includes(pre.kind)) { t.slots[pre.kind] = { output: pre.file }; t.preset = null; }
  };
  applyPreset();

  const btn = h('button', { class: 'primary', style: 'width:100%', disabled: true }, 'Run');
  const body = h('div', {});
  let qb;
  const complete = () => {
    if (!model) return false;
    const need = model.inputs || [];
    return need.every((k) => (k === 'prompt' ? t.prompt.trim() : ['image', 'video', 'audio'].includes(k) ? t.slots[k] : true));
  };
  const drawBody = () => {
    if (!model) { body.replaceChildren(h('div', { class: 'small' }, 'Pick a model to see what it needs. Add models (Higgsfield edit, upscale, lip-sync, voice…) on the Models page.')); return; }
    const need = model.inputs || [];
    const nodes = [];
    if (need.includes('prompt')) nodes.push(h('label', {}, 'Prompt'), h('textarea', { oninput: (e) => { t.prompt = e.target.value; refresh(); } }, t.prompt));
    for (const k of ['image', 'video', 'audio']) if (need.includes(k)) nodes.push(h('label', {}, k[0].toUpperCase() + k.slice(1)), fileSlot(k, () => t.slots[k], (v) => { t.slots[k] = v; refresh(); }));
    const row = [];
    if (need.includes('duration')) row.push(h('div', {}, h('label', {}, 'Length (seconds)'), h('input', { type: 'number', min: '1', max: '60', value: t.duration, oninput: (e) => { t.duration = Number(e.target.value) || 5; refresh(); } })));
    if (need.includes('ratio')) row.push(h('div', {}, h('label', {}, 'Aspect ratio'), h('select', { onchange: (e) => (t.ratio = e.target.value) }, state.meta.ratios.map((r) => h('option', { value: r, selected: r === t.ratio }, r)))));
    if (row.length) nodes.push(h('div', { class: 'row' }, row));
    qb = quoteBox(() => ({ toolModel: model.id, duration: t.duration }), (quote) => { btn.disabled = !quote || !complete(); });
    nodes.push(qb.el);
    body.replaceChildren(...nodes);
    qb.update.now();
  };
  const refresh = () => { if (qb) qb.update(); };
  btn.addEventListener('click', guard(async () => {
    btn.disabled = true;
    const need = model.inputs || [];
    try {
      await api('POST', 'runs', { modelId: model.id, prompt: t.prompt, duration: t.duration, ratio: t.ratio, image: t.slots.image, video: t.slots.video, audio: t.slots.audio });
      toast('Started. The result appears below and in the Gallery.'); t.slots = {}; await refreshLight(); render();
    } catch (e) { btn.disabled = false; throw e; }
  }));
  drawBody();

  const noModels = !state.models.some((m) => TOOL_KINDS_UI.includes(m.kind) && m.engine === 'http');
  return h('div', {}, h('h1', {}, 'Tools'), h('p', { class: 'sub' }, 'Run any model you have registered on your own files: edit an image, upscale, lip-sync, make audio, transform a video. The price is shown before you run it.'),
    h('div', { class: 'cols' },
      h('div', { class: 'panel' },
        h('label', {}, 'Model'),
        modelPicker({ kind: TOOL_KINDS_UI, filter: (m) => m.engine === 'http', value: t.modelId, onChange: (id) => { t.modelId = id; render(); } }),
        noModels ? h('p', { class: 'small' }, 'No tool models yet. On the Models page, press “Add Higgsfield / custom model” and choose a type such as Image edit, Upscale, Lip-sync or Audio.') : null,
        t.preset ? h('p', { class: 'small' }, `Ready to use ${t.preset.file}. Pick a model that takes ${t.preset.kind} input.`) : null,
        body, btn),
      h('div', {}, h('h2', {}, 'Recent results'), state.runs.length ? h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(220px,1fr))' }, state.runs.slice(0, 6).map(runCard)) : h('div', { class: 'panel empty' }, 'Results show up here.'))));
}
