'use strict';
const ui = { modelKind: 'text', modelQuery: '', modelProvider: 'all', showAdd: false, editing: null };

// Call-config starting points. Field names come from how each API is generally documented;
// ALWAYS check the provider's docs and use "Test" to see the real response before relying on one.
const TEMPLATES = {
  higgsfield: {
    note: 'Starting point only. Set the model path from Higgsfield\'s API docs, confirm the auth header format (your key may be KEY_ID:KEY_SECRET), then press Test to see the real response.',
    image: { submit: { url: 'https://platform.higgsfield.ai/<model-path>', headers: { Authorization: 'Key {{apiKey}}' }, body: { prompt: '{{prompt}}', image_urls: '{{images}}', aspect_ratio: '{{ratio}}' } }, poll: { url: '{{submit.status_url}}', statusPath: 'status', resultUrl: '{{submit.response_url}}' }, resultPath: 'images.0.url' },
    video: { submit: { url: 'https://platform.higgsfield.ai/<model-path>', headers: { Authorization: 'Key {{apiKey}}' }, body: { prompt: '{{prompt}}', image_url: '{{image}}', duration: '{{duration}}' } }, poll: { url: '{{submit.status_url}}', statusPath: 'status', resultUrl: '{{submit.response_url}}' }, resultPath: 'video.url' },
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

function addModelPanel() {
  const f = { provider: 'higgsfield', kind: 'video', label: '', unit: 'second', usd: '' };
  const cfg = h('textarea', { style: 'min-height:220px;font-family:monospace;font-size:12px', spellcheck: 'false' });
  const note = h('p', { class: 'small' });
  const loadTemplate = () => {
    const t = TEMPLATES[f.provider], c = t[f.kind];
    cfg.value = c ? JSON.stringify(c, null, 2) : '';
    note.textContent = t.note + (c ? '' : ` (No ${f.kind} template for this provider.)`);
  };
  loadTemplate();
  const unitRow = h('div', {});
  const drawUnit = () => unitRow.replaceChildren(f.kind === 'video'
    ? h('select', { onchange: (e) => (f.unit = e.target.value) }, h('option', { value: 'second' }, 'USD per second of video'), h('option', { value: 'video' }, 'USD per video'))
    : h('div', { class: 'small' }, 'USD per image'));
  drawUnit();
  return h('div', { class: 'panel', style: 'margin-bottom:16px' },
    h('h2', {}, 'Add a model'),
    h('div', { class: 'row' },
      h('div', {}, h('label', {}, 'Provider'), h('select', { onchange: (e) => { f.provider = e.target.value; loadTemplate(); } },
        h('option', { value: 'higgsfield' }, 'Higgsfield'), h('option', { value: 'openrouter' }, 'OpenRouter (video)'), h('option', { value: 'custom' }, 'Other / self-hosted'))),
      h('div', {}, h('label', {}, 'Type'), h('select', { onchange: (e) => { f.kind = e.target.value; drawUnit(); loadTemplate(); } }, h('option', { value: 'video' }, 'Video'), h('option', { value: 'image' }, 'Image'))),
      h('div', {}, h('label', {}, 'Name'), h('input', { placeholder: 'e.g. Kling 2.1 Pro', oninput: (e) => (f.label = e.target.value) }))),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Price (from the provider\'s pricing page)'), unitRow),
      h('div', {}, h('label', {}, 'USD'), h('input', { type: 'number', step: '0.0001', min: '0', placeholder: 'required before use', oninput: (e) => (f.usd = e.target.value) }))),
    h('label', {}, 'Call config (JSON)'), cfg, note,
    h('button', { class: 'primary', onclick: guard(async () => {
      let http; try { http = JSON.parse(cfg.value); } catch (e) { throw new Error('Call config is not valid JSON: ' + e.message); }
      await api('POST', 'models', { provider: f.provider, kind: f.kind, label: f.label, price: { unit: f.unit, usd: f.usd }, http });
      toast('Model added'); ui.showAdd = false; await refreshModels(); render();
    }) }, 'Add model'));
}

function priceEditor(m) {
  const isTok = m.kind === 'text';
  const a = h('input', { type: 'number', step: '0.0001', min: '0', placeholder: isTok ? 'in / 1M' : 'USD', value: isTok ? m.price.in ?? '' : m.price.usd ?? '' });
  const b = isTok ? h('input', { type: 'number', step: '0.0001', min: '0', placeholder: 'out / 1M', value: m.price.out ?? '' }) : null;
  const unit = m.kind === 'video' ? h('select', {}, h('option', { value: 'second', selected: m.price.unit !== 'video' }, 'per second'), h('option', { value: 'video', selected: m.price.unit === 'video' }, 'per video')) : null;
  return h('div', { class: 'row', style: 'min-width:260px' }, a, b, unit,
    h('button', { class: 'primary fit', onclick: guard(async () => {
      await api('PUT', 'models/price', { id: m.id, price: isTok ? { in: a.value, out: b.value } : { usd: a.value, unit: unit ? unit.value : 'image' } });
      ui.editing = null; await refreshModels(); render(); toast('Price saved');
    }) }, 'Save'),
    m.price.basis === 'manual' && m.provider === 'openrouter' ? h('button', { class: 'sec fit', title: 'Go back to the live price', onclick: guard(async () => { await api('PUT', 'models/price', { id: m.id, price: null }); ui.editing = null; await refreshModels(); render(); }) }, 'Reset') : null);
}

function viewModels() {
  const d = state.settings.defaults;
  const rows = modelsOf(ui.modelKind)
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
    h('div', { class: 'tabs' }, ['text', 'image', 'video'].map((k) => h('button', { class: 'chip' + (ui.modelKind === k ? ' sel' : ''), onclick: () => { ui.modelKind = k; render(); } }, `${k[0].toUpperCase() + k.slice(1)} (${modelsOf(k).length})`))),
    h('div', { class: 'row', style: 'margin-bottom:12px' },
      h('input', { placeholder: 'Search models…', value: ui.modelQuery, oninput: (e) => { ui.modelQuery = e.target.value; const p = e.target.selectionStart; render(); const i = document.querySelector('#main input[placeholder^="Search"]'); i.focus(); i.setSelectionRange(p, p); } }),
      h('select', { class: 'fit', onchange: (e) => { ui.modelProvider = e.target.value; render(); } }, providers.map((p) => h('option', { value: p, selected: p === ui.modelProvider }, p === 'all' ? 'All providers' : p)))),
    h('div', { class: 'panel', style: 'padding:0;overflow:auto' }, shown.length ? h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Provider'), h('th', {}, 'Price'), h('th', {}, ''), h('th', {}, ''))),
      h('tbody', {}, shown.map((m) => h('tr', {},
        h('td', {}, m.label, h('div', { class: 'small' }, m.id.replace(/^[a-z]+:/, ''))),
        h('td', {}, m.provider),
        h('td', {}, ui.editing === m.id ? priceEditor(m) : [priceText(m), ' ', basisTag(m)]),
        h('td', {}, d[m.kind] === m.id ? h('span', { class: 'tag live' }, 'default') : h('button', { class: 'ghost', onclick: guard(async () => {
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
    ) : h('div', { class: 'empty' }, state.models.some((m) => m.kind === ui.modelKind) ? 'No matches.' : ui.modelKind === 'text' ? 'No text models yet. Add your OpenRouter key in Settings and refresh.' : 'No models of this type yet. Add one above.')),
    rows.length > shown.length ? h('p', { class: 'small' }, `Showing ${shown.length} of ${rows.length}. Search to narrow down.`) : null);
}
