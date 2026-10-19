'use strict';
const TOOL_KINDS = ['edit', 'upscale', 'lipsync', 'audio'];
const ui = { modelKind: 'text', modelQuery: '', modelProvider: 'all', showAdd: false, editing: null };

// Call-config starting points. Field names come from how each API is generally documented;
// ALWAYS check the provider's docs and use "Test" to see the real response before relying on one.
const TEMPLATES = {
  higgsfield: {
    note: 'From Higgsfield\'s docs (docs.higgsfield.ai): base URL https://api.higgsfield.ai, header Authorization: Key <key id>:<secret> (confirm the exact format on their Authentication page), statuses queued / in_progress / completed / failed / nsfw / canceled, and the finished video at video.url. Failed and moderated requests are not charged. The submit path and body are different for every model: copy them from that model\'s page under docs.higgsfield.ai/docs/models. The image result path is not confirmed; use Test to see the real response.',
    image: { submit: { url: 'https://api.higgsfield.ai/<model path from its docs page>', headers: { Authorization: 'Key {{apiKey}}', 'Idempotency-Key': '{{idempotencyKey}}' }, body: { prompt: '{{prompt}}' } }, poll: { url: '{{submit.status_url}}', statusPath: 'status', doneValues: ['completed'] }, resultPath: 'images.0.url' },
    video: { submit: { url: 'https://api.higgsfield.ai/<model path from its docs page>', headers: { Authorization: 'Key {{apiKey}}', 'Idempotency-Key': '{{idempotencyKey}}' }, body: { prompt: '{{prompt}}', image_url: '{{image}}' } }, poll: { url: '{{submit.status_url}}', statusPath: 'status', doneValues: ['completed'] }, resultPath: 'video.url' },
  },
  openrouter: {
    note: 'OpenRouter video models are asynchronous. Check the OpenRouter video docs for the exact request fields, status values and result path, then press Test.',
    image: null,
    video: { submit: { url: 'https://openrouter.ai/api/v1/videos', headers: { Authorization: 'Bearer {{apiKey}}' }, body: { model: '<model-slug>', prompt: '{{prompt}}', duration: '{{duration}}' } }, poll: { url: '{{submit.polling_url}}', statusPath: 'status', headers: {} }, resultPath: 'output.0' },
  },
  custom: {
    note: 'Any HTTP API, hosted or self-hosted. See the README for placeholders ({{prompt}}, {{image}}, {{images}}, {{ratio}}, {{duration}}, {{apiKey}}, {{submit.<field>}}).',
    image: { submit: { url: 'http://localhost:8000/image', body: { prompt: '{{prompt}}', images: '{{images}}' } }, resultPath: 'url' },
    video: { submit: { url: 'http://localhost:8000/video', body: { prompt: '{{prompt}}', image: '{{image}}', seconds: '{{duration}}' } }, resultPath: 'url' },
  },
};

const KIND_OPTIONS = [['video', 'Video (image → video)'], ['image', 'Image'], ['edit', 'Image edit / product placement'], ['upscale', 'Upscale / enhance'], ['lipsync', 'Lip-sync / talking avatar'], ['audio', 'Audio (voice, music, sound)']];
const UNIT_OPTIONS = { image: [['image', 'USD per image'], ['run', 'USD per run']], video: [['second', 'USD per second of video'], ['video', 'USD per video'], ['run', 'USD per run']], edit: [['run', 'USD per run'], ['image', 'USD per image']], upscale: [['run', 'USD per run'], ['image', 'USD per image']], lipsync: [['second', 'USD per second'], ['video', 'USD per video'], ['run', 'USD per run']], audio: [['run', 'USD per run'], ['second', 'USD per second']] };
const DEFAULT_INPUTS = { image: ['prompt'], video: ['prompt', 'image'], edit: ['prompt', 'image'], upscale: ['image'], lipsync: ['image', 'audio'], audio: ['prompt'] };
const ALL_INPUTS = ['prompt', 'image', 'video', 'audio', 'duration', 'ratio'];
const TOOL_BODY = { edit: { prompt: '{{prompt}}', image_url: '{{image}}' }, upscale: { image_url: '{{image}}' }, lipsync: { image_url: '{{image}}', audio_url: '{{audio}}' }, audio: { prompt: '{{prompt}}' } };
const TOOL_RESULT = { edit: 'images.0.url', upscale: 'image.url', lipsync: 'video.url', audio: 'audio.url' };

/** Provider-specific starting point if we have one, otherwise a generic queue-style skeleton for tool kinds. */
function templateFor(provider, kind) {
  const t = TEMPLATES[provider];
  if (t[kind]) return t[kind];
  if (!TOOL_BODY[kind]) return null;
  const base = (t.video || TEMPLATES.custom.video);
  return { submit: { url: base.submit.url.replace(/video$/, kind), headers: base.submit.headers || {}, body: TOOL_BODY[kind] }, poll: base.poll, resultPath: TOOL_RESULT[kind] };
}

function addModelPanel() {
  const f = { provider: 'higgsfield', kind: 'video', label: '', unit: 'second', usd: '', inputs: [...DEFAULT_INPUTS.video] };
  const cfg = h('textarea', { style: 'min-height:220px;font-family:monospace;font-size:12px', spellcheck: 'false' });
  const note = h('p', { class: 'small' });
  const unitRow = h('div', {}), inputRow = h('div', { class: 'chips' });
  const drawInputs = () => inputRow.replaceChildren(...ALL_INPUTS.map((k) => h('label', { style: 'display:inline-flex;gap:4px;align-items:center;margin:0' }, h('input', { type: 'checkbox', style: 'width:auto', checked: f.inputs.includes(k), onchange: (e) => { f.inputs = e.target.checked ? [...f.inputs, k] : f.inputs.filter((x) => x !== k); } }), k)));
  const drawUnit = () => { f.unit = UNIT_OPTIONS[f.kind][0][0]; unitRow.replaceChildren(h('select', { onchange: (e) => (f.unit = e.target.value) }, UNIT_OPTIONS[f.kind].map(([v, l]) => h('option', { value: v }, l)))); };
  const loadTemplate = () => {
    const c = templateFor(f.provider, f.kind);
    cfg.value = c ? JSON.stringify(c, null, 2) : '';
    note.textContent = TEMPLATES[f.provider].note + (c ? '' : ` (No ${f.kind} template for this provider.)`);
  };
  drawUnit(); drawInputs(); loadTemplate();
  return h('div', { class: 'panel', style: 'margin-bottom:16px' },
    h('h2', {}, 'Add a model'),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Provider'), h('select', { onchange: (e) => { f.provider = e.target.value; loadTemplate(); } },
        h('option', { value: 'higgsfield' }, 'Higgsfield'), h('option', { value: 'openrouter' }, 'OpenRouter (video)'), h('option', { value: 'custom' }, 'Other / self-hosted'))),
      h('div', {}, h('label', {}, 'Type'), h('select', { onchange: (e) => { f.kind = e.target.value; f.inputs = [...DEFAULT_INPUTS[f.kind]]; drawUnit(); drawInputs(); loadTemplate(); } }, KIND_OPTIONS.map(([v, l]) => h('option', { value: v }, l)))),
      h('div', {}, h('label', {}, 'Name'), h('input', { placeholder: 'e.g. Kling 2.1 Pro', oninput: (e) => (f.label = e.target.value) }))),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Price (from the provider\'s pricing page)'), unitRow),
      h('div', {}, h('label', {}, 'USD'), h('input', { type: 'number', step: '0.0001', min: '0', placeholder: 'required before use', oninput: (e) => (f.usd = e.target.value) }))),
    h('label', {}, 'Inputs this model needs (what Tools asks you for)'), inputRow,
    h('label', {}, 'Call config (JSON)'), cfg, note,
    h('button', { class: 'primary', onclick: guard(async () => {
      let http; try { http = JSON.parse(cfg.value); } catch (e) { throw new Error('Call config is not valid JSON: ' + e.message); }
      await api('POST', 'models', { provider: f.provider, kind: f.kind, label: f.label, price: { unit: f.unit, usd: f.usd }, inputs: f.inputs, http });
      toast('Model added'); ui.showAdd = false; await refreshModels(); render();
    }) }, 'Add model'));
}

function priceEditor(m) {
  const isTok = m.kind === 'text';
  const a = h('input', { type: 'number', step: '0.0001', min: '0', placeholder: isTok ? 'in / 1M' : 'USD', value: isTok ? m.price.in ?? '' : m.price.usd ?? '' });
  const b = isTok ? h('input', { type: 'number', step: '0.0001', min: '0', placeholder: 'out / 1M', value: m.price.out ?? '' }) : null;
  const unit = UNIT_OPTIONS[m.kind] && m.engine === 'http' ? h('select', {}, UNIT_OPTIONS[m.kind].map(([v, l]) => h('option', { value: v, selected: m.price.unit === v }, l.replace('USD ', '')))) : null;
  return h('div', { class: 'row', style: 'min-width:260px' }, a, b, unit,
    h('button', { class: 'primary fit', onclick: guard(async () => {
      await api('PUT', 'models/price', { id: m.id, price: isTok ? { in: a.value, out: b.value } : { usd: a.value, unit: unit ? unit.value : undefined } });
      ui.editing = null; await refreshModels(); render(); toast('Price saved');
    }) }, 'Save'),
    m.price.basis === 'manual' && m.provider === 'openrouter' ? h('button', { class: 'sec fit', title: 'Go back to the live price', onclick: guard(async () => { await api('PUT', 'models/price', { id: m.id, price: null }); ui.editing = null; await refreshModels(); render(); }) }, 'Reset') : null);
}

function viewModels() {
  const d = state.settings.defaults;
  const rows = modelsOf(ui.modelKind === 'tools' ? TOOL_KINDS : ui.modelKind)
    .filter((m) => ui.modelProvider === 'all' || m.provider === ui.modelProvider)
    .filter((m) => !ui.modelQuery || (m.label + m.id).toLowerCase().includes(ui.modelQuery.toLowerCase()))
    .sort((a, b) => (b.priced - a.priced) || a.label.localeCompare(b.label));
  const shown = rows.slice(0, 150);
  const providers = ['all', ...new Set(state.models.map((m) => m.provider))];
  const refresh = h('button', { class: 'sec', onclick: guard(async (e) => {
    e.target.disabled = true; e.target.textContent = 'Fetching…';
    try { const r = await api('POST', 'models/refresh'); state.models = r.models; state.modelsFetchedAt = r.fetchedAt; toast(`Loaded ${r.models.filter((m) => m.provider === 'openrouter').length} OpenRouter models with live prices`); }
    finally { render(); }
  }) }, 'Refresh OpenRouter list');
  return h('div', {},
    h('div', { class: 'row', style: 'margin-bottom:6px' }, h('div', {}, h('h1', {}, 'Models'), h('p', { class: 'sub', style: 'margin:0' }, `Every model you can use, with its price. ${state.modelsFetchedAt ? 'OpenRouter list updated ' + new Date(state.modelsFetchedAt).toLocaleString() + '.' : 'Add your OpenRouter key in Settings, then fetch the list.'}`)),
      h('div', { class: 'fit row', style: 'justify-content:flex-end' }, refresh, h('button', { class: 'primary', onclick: () => { ui.showAdd = !ui.showAdd; render(); } }, ui.showAdd ? 'Close' : 'Add Higgsfield / custom model'))),
    h('div', { style: 'height:16px' }),
    ui.showAdd ? addModelPanel() : null,
    h('div', { class: 'tabs' }, ['text', 'image', 'video', 'tools'].map((k) => h('button', { class: 'chip' + (ui.modelKind === k ? ' sel' : ''), onclick: () => { ui.modelKind = k; render(); } }, `${k[0].toUpperCase() + k.slice(1)} (${modelsOf(k === 'tools' ? TOOL_KINDS : k).length})`))),
    h('div', { class: 'row', style: 'margin-bottom:12px' },
      h('input', { placeholder: 'Search models…', value: ui.modelQuery, oninput: (e) => { ui.modelQuery = e.target.value; const p = e.target.selectionStart; render(); const i = document.querySelector('#main input[placeholder^="Search"]'); i.focus(); i.setSelectionRange(p, p); } }),
      h('select', { class: 'fit', onchange: (e) => { ui.modelProvider = e.target.value; render(); } }, providers.map((p) => h('option', { value: p, selected: p === ui.modelProvider }, p === 'all' ? 'All providers' : p)))),
    h('div', { class: 'panel', style: 'padding:0;overflow:auto' }, shown.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Provider'), h('th', {}, 'Price'), h('th', {}, ''), h('th', {}, ''))),
      h('tbody', {}, shown.map((m) => h('tr', {},
        h('td', {}, m.label, h('div', { class: 'small' }, m.id.replace(/^[a-z]+:/, ''))),
        h('td', {}, m.provider, TOOL_KINDS.includes(m.kind) ? h('div', { class: 'small' }, m.kind) : null),
        h('td', {}, ui.editing === m.id ? priceEditor(m) : [priceText(m), ' ', basisTag(m)]),
        h('td', {}, TOOL_KINDS.includes(m.kind) ? null : d[m.kind] === m.id ? h('span', { class: 'tag live' }, 'default') : h('button', { class: 'ghost', onclick: guard(async () => {
          if (!m.priced) throw new Error('Set a price first so your spend is known.');
          await api('PUT', 'settings', { defaults: { [m.kind]: m.id } }); await refreshLight(); render(); toast(`${m.label} is now the default ${m.kind} model`);
        }) }, 'Make default')),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'ghost', onclick: () => { ui.editing = ui.editing === m.id ? null : m.id; render(); } }, 'Price'),
          m.kind === 'text' || m.engine === 'http' ? h('button', { class: 'ghost', title: 'Sends one real request and may be billed', onclick: guard(async (e) => {
            e.target.textContent = '…';
            try { const r = await api('POST', 'models/test', { id: m.id }); alert(m.kind === 'text' ? `Reply: ${r.reply}\nCost: ${r.usd == null ? 'not reported' : money(r.usd)}` : `${r.note}\n\nResponse:\n${JSON.stringify(r.submitResponse, null, 2)}`); await refreshLight(); }
            finally { e.target.textContent = 'Test'; }
          }) }, 'Test') : null,
          m.engine === 'http' ? h('button', { class: 'ghost', onclick: guard(async () => { if (confirm(`Remove ${m.label}?`)) { await api('DELETE', `models?id=${encodeURIComponent(m.id)}`); await refreshModels(); render(); } }) }, 'Remove') : null))))
    ) : h('div', { class: 'empty' }, modelsOf(ui.modelKind === 'tools' ? TOOL_KINDS : ui.modelKind).length ? 'No matches.' : ui.modelKind === 'text' ? 'No text models yet. Add your OpenRouter key in Settings and refresh.' : 'No models of this type yet. Add one above.')),
    rows.length > shown.length ? h('p', { class: 'small' }, `Showing ${shown.length} of ${rows.length}. Search to narrow down.`) : null);
}
