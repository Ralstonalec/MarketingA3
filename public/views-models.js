'use strict';
const TOOL_KINDS = ['edit', 'upscale', 'lipsync', 'audio'];
const ui = { showHidden: false, showApi: false, apiDrafts: null, apiUrl: 'https://docs.higgsfield.ai/docs/openapi.json', apiProvider: 'higgsfield', modelKind: 'text', modelQuery: '', modelProvider: 'all', showAdd: false, editing: null };

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

/** Read a provider's OpenAPI spec from this computer and turn its endpoints into models. Review before adding. */
function openapiPanel() {
  const out = h('div', {});
  const url = h('input', { value: ui.apiUrl, oninput: (e) => (ui.apiUrl = e.target.value) });
  const prov = h('select', { onchange: (e) => (ui.apiProvider = e.target.value) }, [['higgsfield', 'Higgsfield'], ['custom', 'Other']].map(([v, l]) => h('option', { value: v, selected: ui.apiProvider === v }, l)));
  const drawDrafts = () => {
    const d = ui.apiDrafts;
    if (!d) { out.replaceChildren(); return; }
    const pick = d.drafts.map(() => true);
    const kinds = ['video', 'image', 'edit', 'upscale', 'lipsync', 'audio'];
    out.replaceChildren(
      h('p', { class: 'small' }, `${d.drafts.length} model endpoint(s) found at ${d.server}; ${d.skipped.length} shared endpoint(s) skipped. Check the type and notes, untick anything you do not want, then add.`),
      h('div', { class: 'panel', style: 'padding:0;overflow:auto;max-height:420px' }, table(h('tbody', {}, d.drafts.map((x, i) => h('tr', {},
        h('td', {}, h('input', { type: 'checkbox', style: 'width:auto', checked: true, onchange: (e) => (pick[i] = e.target.checked) })),
        h('td', {}, x.label, h('div', { class: 'small' }, x.path)),
        h('td', {}, h('select', { onchange: (e) => (x.kind = e.target.value) }, kinds.map((k) => h('option', { value: k, selected: k === x.kind }, k)))),
        h('td', { class: 'small' }, `inputs: ${x.inputs.join(', ')}`),
        h('td', { class: 'small' }, x.attention.length ? x.attention.map((a) => h('div', { class: 'warn' }, a)) : 'looks complete')))))),
      h('div', { class: 'row', style: 'margin-top:10px' }, h('button', { class: 'primary fit', onclick: guard(async () => {
        const r = await api('POST', 'models/openapi/import', { provider: ui.apiProvider, drafts: d.drafts.filter((_, i) => pick[i]) });
        toast(`Added ${r.added} model(s). Next: Get exact prices.`); ui.apiDrafts = null; ui.showApi = false; await refreshModels(); render();
      }) }, 'Add selected models')));
  };
  drawDrafts();
  return h('div', { class: 'panel', style: 'margin-bottom:16px' }, h('h2', {}, 'Import from an OpenAPI link'),
    h('p', { class: 'small', style: 'margin-top:-8px' }, 'Reads the provider\'s machine-readable API spec from this computer and builds a model for every endpoint, using the provider\'s own field names. Use the openapi.json link, not the docs page.'),
    h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Spec URL'), url), h('div', { class: 'fit' }, h('label', {}, 'Provider'), prov)),
    h('button', { class: 'primary', style: 'margin-top:10px', onclick: guard(async (e) => {
      e.target.disabled = true; e.target.textContent = 'Reading spec…';
      try { ui.apiDrafts = await api('POST', 'models/openapi/preview', { url: ui.apiUrl, provider: ui.apiProvider }); drawDrafts(); } finally { e.target.disabled = false; e.target.textContent = 'Read spec'; }
    }) }, 'Read spec'), out);
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

const fmtVal = (v) => (Number.isFinite(v) ? (v < 1 ? '$' + v.toFixed(4) : '$' + v.toFixed(2)) : String(v));
const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

/** Price moves seen on the last refreshes. A rise on a model you rely on is called out. */
function changesBanner() {
  const ch = state.priceChanges || [];
  if (!ch.length) return null;
  const mine = new Set([...Object.values(state.settings.defaults), ...state.models.filter((m) => m.favorite).map((m) => m.id)]);
  return h('div', { class: 'panel', style: 'margin-bottom:16px;border-color:var(--warn)' }, h('div', { class: 'row' }, h('h2', { style: 'margin:0' }, `${ch.length} price change${ch.length > 1 ? 's' : ''} since your last look`),
    h('button', { class: 'sec fit', onclick: guard(async () => { await api('DELETE', 'price-changes'); await refreshModels(); render(); }) }, 'Dismiss')),
    table(h('tbody', {}, ch.slice(0, 8).map((c) => h('tr', {},
      h('td', {}, c.label, mine.has(c.id) ? h('span', { class: 'tag est', style: 'margin-left:6px' }, 'you use this') : null, h('div', { class: 'small' }, c.field)),
      h('td', { class: 'num' }, `${fmtVal(c.from)} → ${fmtVal(c.to)}`),
      h('td', { class: 'num ' + (c.to > c.from ? 'warn' : '') }, c.pct == null ? '' : `${c.pct > 0 ? '+' : ''}${c.pct}%`),
      h('td', { class: 'small' }, ago(c.at)))))),
    ch.length > 8 ? h('div', { class: 'small' }, `and ${ch.length - 8} more`) : null);
}

function syncLine() {
  const info = state.syncInfo || {};
  const bit = (name, key) => info[key] ? h('div', { class: 'small' }, `${name}: ${info[key].ok === false ? '' : ''}`, info[key].ok === false ? h('span', { class: 'warn' }, `last attempt failed (${info[key].error}). `) : '', info[key].okAt ? `synced ${ago(info[key].okAt)}${info[key].summary ? ' · ' + info[key].summary : ''}` : 'never synced') : null;
  return [bit('OpenRouter', 'openrouter'), bit('Higgsfield', 'higgsfield')];
}

const unpricedWithEstimate = () => state.models.filter((m) => m.estimate && !m.priced).length;

function viewModels() {
  const d = state.settings.defaults;
  const rows = modelsOf(ui.modelKind === 'tools' ? TOOL_KINDS : ui.modelKind)
    .filter((m) => ui.showHidden || !m.hidden)
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
    changesBanner(),
    h('div', { class: 'row', style: 'margin-bottom:6px' }, h('div', {}, h('h1', {}, 'Models'), h('p', { class: 'sub', style: 'margin:0' }, `Every model you can use, with its price. ${state.modelsFetchedAt ? 'OpenRouter list updated ' + new Date(state.modelsFetchedAt).toLocaleString() + '.' : 'Add your OpenRouter key in Settings, then fetch the list.'}`)),
      h('div', { class: 'fit row', style: 'justify-content:flex-end' }, h('button', { class: 'sec', title: 'Re-read OpenRouter\'s list and the saved Higgsfield spec, and re-fetch prices', onclick: guard(async (e) => {
        e.target.disabled = true; e.target.textContent = 'Syncing…';
        try { const r = await api('POST', 'models/sync', { provider: 'all' }); state.models = r.models; state.priceChanges = r.changes; state.syncInfo = r.sync; const bad = Object.entries(r.results).filter(([, v]) => v.error); toast(bad.length ? `Sync problem: ${bad[0][1].error}` : 'Synced'); } finally { render(); }
      }) }, 'Sync now'), refresh, h('button', { class: 'sec', onclick: () => { ui.showApi = !ui.showApi; render(); } }, ui.showApi ? 'Close import' : 'Import from OpenAPI'), h('button', { class: 'primary', onclick: () => { ui.showAdd = !ui.showAdd; render(); } }, ui.showAdd ? 'Close' : 'Add one by hand'))),
    h('div', {}, syncLine()),
    h('div', { style: 'height:16px' }),
    ui.showApi ? openapiPanel() : null,
    ui.showAdd ? addModelPanel() : null,
    unpricedWithEstimate() ? h('div', { class: 'panel', style: 'margin-bottom:16px' }, h('b', {}, `${unpricedWithEstimate()} model(s) have no price yet. `), 'These providers can quote the exact cost of a request before you run it. ', h('button', { class: 'primary', style: 'margin-left:8px', onclick: guard(async (e) => {
      e.target.disabled = true; e.target.textContent = 'Asking the provider…';
      try { const r = await api('POST', 'models/estimate', { all: true }); const bad = r.results.filter((x) => !x.ok); toast(`${r.results.length - bad.length} priced${bad.length ? `, ${bad.length} failed (${bad[0].error})` : ''}`); await refreshModels(); render(); } finally { e.target.disabled = false; }
    }) }, 'Get exact prices')) : null,
    h('div', { class: 'tabs' }, ['text', 'image', 'video', 'tools'].map((k) => h('button', { class: 'chip' + (ui.modelKind === k ? ' sel' : ''), onclick: () => { ui.modelKind = k; render(); } }, `${k[0].toUpperCase() + k.slice(1)} (${modelsOf(k === 'tools' ? TOOL_KINDS : k).length})`))),
    h('div', { class: 'row', style: 'margin-bottom:12px' },
      h('input', { placeholder: 'Search models…', value: ui.modelQuery, oninput: (e) => { ui.modelQuery = e.target.value; const p = e.target.selectionStart; render(); const i = document.querySelector('#main input[placeholder^="Search"]'); i.focus(); i.setSelectionRange(p, p); } }),
      h('label', { class: 'fit', style: 'display:flex;gap:6px;align-items:center;margin:0;white-space:nowrap' }, h('input', { type: 'checkbox', style: 'width:auto', checked: ui.showHidden, onchange: (e) => { ui.showHidden = e.target.checked; render(); } }), 'Show hidden'),
      h('select', { class: 'fit', onchange: (e) => { ui.modelProvider = e.target.value; render(); } }, providers.map((p) => h('option', { value: p, selected: p === ui.modelProvider }, p === 'all' ? 'All providers' : p)))),
    h('div', { class: 'panel', style: 'padding:0;overflow:auto' }, shown.length ? stackTable(
      h('thead', {}, h('tr', {}, h('th', {}, 'Model'), h('th', {}, 'Provider'), h('th', {}, 'Price'), h('th', {}, ''), h('th', {}, ''))),
      h('tbody', {}, shown.map((m) => h('tr', {},
        h('td', {}, m.favorite ? '★ ' : '', m.label, m.missing ? h('span', { class: 'tag unset', style: 'margin-left:6px', title: 'The provider no longer lists this model. Your history and prices are kept.' }, 'removed by provider') : null, m.hidden ? h('span', { class: 'tag', style: 'margin-left:6px' }, 'hidden') : null, h('div', { class: 'small' }, m.id.replace(/^[a-z]+:/, '')), (m.notes && m.notes.length) ? h('details', {}, h('summary', { class: 'small' }, `${m.notes.length} note(s) from import`), m.notes.map((n) => h('div', { class: 'small' }, n))) : null),
        h('td', {}, m.provider, TOOL_KINDS.includes(m.kind) ? h('div', { class: 'small' }, m.kind) : null),
        h('td', {}, ui.editing === m.id ? priceEditor(m) : [priceText(m), ' ', basisTag(m)]),
        h('td', {}, TOOL_KINDS.includes(m.kind) ? null : d[m.kind] === m.id ? h('span', { class: 'tag live' }, 'default') : h('button', { class: 'ghost', onclick: guard(async () => {
          if (!m.priced) throw new Error('Set a price first so your spend is known.');
          await api('PUT', 'settings', { defaults: { [m.kind]: m.id } }); await refreshLight(); render(); toast(`${m.label} is now the default ${m.kind} model`);
        }) }, 'Make default')),
        h('td', { style: 'white-space:nowrap' },
          m.estimate ? h('button', { class: 'ghost', title: 'Asks the provider what this costs. Nothing is generated or charged.', onclick: guard(async (e) => {
            e.target.textContent = '…';
            try { const r = (await api('POST', 'models/estimate', { id: m.id })).results[0]; toast(r.ok ? `Price set: ${r.detail}` : r.error); await refreshModels(); render(); } finally { e.target.textContent = 'Get price'; }
          }) }, 'Get price') : null,
          h('button', { class: 'ghost', onclick: () => { ui.editing = ui.editing === m.id ? null : m.id; render(); } }, 'Price'),
          h('button', { class: 'ghost', title: m.hidden ? 'Show in pickers again' : 'Hide from pickers', onclick: guard(async () => { await api('POST', 'models/prefs', { id: m.id, hidden: !m.hidden }); await refreshModels(); render(); }) }, m.hidden ? 'Unhide' : 'Hide'),
          m.kind === 'text' || m.engine === 'http' ? h('button', { class: 'ghost', title: 'Sends one real request and may be billed', onclick: guard(async (e) => {
            e.target.textContent = '…';
            try { const r = await api('POST', 'models/test', { id: m.id }); alert(m.kind === 'text' ? `Reply: ${r.reply}\nCost: ${r.usd == null ? 'not reported' : money(r.usd)}` : `${r.note}\n\nResponse:\n${JSON.stringify(r.submitResponse, null, 2)}`); await refreshLight(); }
            finally { e.target.textContent = 'Test'; }
          }) }, 'Test') : null,
          m.engine === 'http' ? h('button', { class: 'ghost', onclick: guard(async () => { if (confirm(`Remove ${m.label}?`)) { await api('DELETE', `models?id=${encodeURIComponent(m.id)}`); await refreshModels(); render(); } }) }, 'Remove') : null))))
    ) : h('div', { class: 'empty' }, modelsOf(ui.modelKind === 'tools' ? TOOL_KINDS : ui.modelKind).length ? 'No matches.' : ui.modelKind === 'text' ? 'No text models yet. Add your OpenRouter key in Settings and refresh.' : 'No models of this type yet. Add one above.')),
    rows.length > shown.length ? h('p', { class: 'small' }, `Showing ${shown.length} of ${rows.length}. Search to narrow down.`) : null);
}
