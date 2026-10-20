'use strict';
// Guided first-run setup. Every step reads its status from live state, so it is always accurate, and every action
// calls the same backend the rest of the app uses.
const setupUi = { open: undefined, hfUrl: 'https://docs.higgsfield.ai/docs/openapi.json', log: [], replacing: {} };
const budgetSkipped = () => lsGet('a3.setup.budgetSkipped', false);

function setupSteps() {
  const s = state.settings, d = s.defaults, orCount = state.models.filter((m) => m.provider === 'openrouter').length;
  return [
    { id: 'keys', title: 'Add your API keys', sub: s.keys.openrouter.set ? 'OpenRouter key saved' : 'OpenRouter writes the ads. Higgsfield is optional for now.', done: s.keys.openrouter.set },
    { id: 'models', title: 'Load models and prices', sub: orCount ? `${orCount} OpenRouter models loaded` : 'Pull every available model with its live price', done: orCount > 0 },
    { id: 'defaults', title: 'Choose your default models', sub: d.text && modelById(d.text) ? 'Writer and image model chosen' : 'These are used by Quick Ad', done: !!(d.text && d.image && d.image !== 'mock:image') },
    { id: 'budget', title: 'Set a monthly budget', sub: 'Optional. Blocks any run that would pass the cap.', optional: true, done: s.budget.monthlyUsd > 0 || budgetSkipped() },
    { id: 'library', title: 'Add a product and an actor', sub: `${state.products.length} product(s), ${state.actors.length} actor(s)`, done: state.products.length > 0 && state.actors.length > 0 },
  ];
}
function setupProgress() {
  const req = setupSteps().filter((x) => !x.optional);
  const done = req.filter((x) => x.done).length;
  return { done, total: req.length, complete: done === req.length };
}

function keyBox(name, label, hint, link, idx) {
  const k = state.settings.keys[name], chk = (state.keyChecks || {})[name];
  const input = h('input', { type: 'password', autocomplete: 'off', placeholder: `Paste your ${label} key` });
  const out = h('div', { class: 'kv' });
  const draw = (c) => out.replaceChildren(...(c ? [h('span', { class: `tag ${c.ok === true ? 'live' : c.ok === false ? 'unset' : 'est'}` }, c.ok === true ? 'works' : c.ok === false ? 'problem' : 'saved'), h('span', {}, c.detail)] : []));
  draw(chk);
  const save = h('button', { class: 'primary', onclick: guard(async (e) => {
    const v = input.value.trim();
    if (!v && !k.set) throw new Error(`Paste your ${label} key first`);
    e.target.disabled = true; e.target.textContent = 'Testing…';
    try {
      if (v) await api('PUT', 'settings', { keys: { [name]: v } });
      const c = await api('POST', 'accounts/test', { provider: name });
      state.keyChecks = { ...(state.keyChecks || {}), [name]: c };
      setupUi.replacing[name] = false; setupUi.open = idx; await refreshLight(); render();   // stay on this step so the result is visible
    } finally { e.target.disabled = false; }
  }) }, k.set && !setupUi.replacing[name] ? 'Test again' : 'Save and test');
  const replacing = !k.set || setupUi.replacing[name];
  return h('div', { style: 'margin-top:12px' }, h('label', {}, label),
    k.set && !replacing ? h('div', { class: 'kv' }, h('span', {}, `Saved: ${k.preview}${k.fromEnv ? ' (from environment)' : ''}`), h('button', { class: 'ghost', onclick: () => { setupUi.replacing[name] = true; render(); } }, 'Replace')) : input,
    h('div', { class: 'small', style: 'margin:4px 0 8px' }, hint, ' ', link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer' }, 'Get a key') : null),
    save, out);
}

async function setupHiggsfield(btn, idx) {
  const log = setupUi.log = [];
  setupUi.review = null;
  try {
    btn.disabled = true; btn.textContent = 'Reading the spec…';
    const prev = await api('POST', 'models/openapi/preview', { url: setupUi.hfUrl, provider: 'higgsfield' });
    const st = prev.stats, good = prev.drafts.filter((d) => d.guessedKind), rest = prev.drafts.filter((d) => !d.guessedKind);
    log.push(`The spec lists ${st.paths} endpoints: ${st.models} models, ${st.shared} shared by every model, ${st.skipped} skipped.`);
    const imp = await api('POST', 'models/openapi/import', { provider: 'higgsfield', specUrl: setupUi.hfUrl, drafts: good });
    log.push(`Added ${imp.added} model(s) whose type was clear.`);
    if (rest.length) log.push(`${rest.length} more need you to choose their type: ${rest.slice(0, 6).map((d) => d.label).join(', ')}${rest.length > 6 ? '…' : ''}.`);
    if (st.skipped) log.push(`${st.skipped} endpoint(s) were skipped; the review shows why.`);
    setupUi.review = prev;                                   // keep the full result so "Review all" shows everything, not a subset
    if (state.settings.keys.higgsfield.set) {
      btn.textContent = 'Asking Higgsfield for prices…';
      const est = await api('POST', 'models/estimate', { all: true });
      const ok = est.results.filter((r) => r.ok).length, bad = est.results.filter((r) => !r.ok);
      log.push(`Exact prices fetched for ${ok} model(s)${bad.length ? `; ${bad.length} need a hand-set price (${bad[0].error})` : ''}.`);
    } else log.push('Add your Higgsfield key (step 1) to fetch exact prices.');
  } catch (e) { log.push(`Problem: ${e.message}`); }
  finally { setupUi.open = idx; await refreshModels(); await refreshLight(); render(); }
}

function setStepBody(id, idx) {
  const s = state.settings, d = s.defaults;
  if (id === 'keys') return [
    h('p', { class: 'small' }, 'Keys are stored on this computer (data/db.json, owner-only) and never sent to the browser.'),
    keyBox('openrouter', 'OpenRouter API key', 'Used for the writing models and OpenRouter image models.', 'https://openrouter.ai/keys', idx),
    keyBox('higgsfield', 'Higgsfield API key (optional now)', 'Enter it as KEY_ID:SECRET from console.higgsfield.ai. You can add it later.', 'https://console.higgsfield.ai', idx)];
  if (id === 'models') {
    const orBtn = h('button', { class: 'primary', disabled: !s.keys.openrouter.set, onclick: guard(async (e) => {
      e.target.disabled = true; e.target.textContent = 'Loading…';
      try { const r = await api('POST', 'models/refresh'); state.models = r.models; state.syncInfo = r.sync; state.priceChanges = r.changes; toast(`Loaded ${r.models.filter((m) => m.provider === 'openrouter').length} models with live prices`); setupUi.open = idx; await refreshLight(); render(); }
      finally { e.target.disabled = false; e.target.textContent = 'Load OpenRouter models'; }
    }) }, 'Load OpenRouter models');
    const hfBtn = h('button', { class: 'sec', onclick: guard(() => setupHiggsfield(hfBtn, idx)) }, 'Import Higgsfield models');
    const hf = state.models.filter((m) => m.provider === 'higgsfield');
    return [
      h('label', {}, 'OpenRouter'), h('div', { class: 'small', style: 'margin-bottom:8px' }, s.keys.openrouter.set ? 'Loads every text and image model with its current price.' : 'Add your OpenRouter key first (step 1).'), orBtn,
      h('label', { style: 'margin-top:18px' }, 'Higgsfield (optional)'),
      h('div', { class: 'small', style: 'margin-bottom:8px' }, 'Reads Higgsfield\'s own API spec and builds a model for each endpoint, then asks Higgsfield for exact prices.'),
      h('input', { value: setupUi.hfUrl, 'aria-label': 'Higgsfield OpenAPI spec address', oninput: (e) => (setupUi.hfUrl = e.target.value) }), h('div', { style: 'margin-top:8px' }, hfBtn),
      hf.length ? h('div', { class: 'kv' }, h('span', { class: 'tag live' }, `${hf.length} Higgsfield model(s)`), h('span', {}, `${hf.filter((m) => m.priced).length} priced`)) : null,
      setupUi.log.length ? h('div', { class: 'small', style: 'margin-top:8px' }, setupUi.log.map((l) => h('div', { class: /^Problem/.test(l) ? 'warn' : '' }, l))) : null,
      setupUi.review ? h('div', { style: 'margin-top:8px' }, h('button', { class: 'sec', onclick: () => { ui.apiDrafts = setupUi.review; ui.apiUrl = setupUi.hfUrl; ui.apiProvider = 'higgsfield'; ui.showApi = true; state.view = 'models'; render(); } }, 'Review all endpoints and pick which to add')) : null];
  }
  if (id === 'defaults') {
    const set = (k) => guard(async (id2) => { await api('PUT', 'settings', { defaults: { [k]: id2 || '' } }); setupUi.open = idx; await refreshLight(); render(); });
    const box = h('div', {});
    const qb = quoteBox(() => (d.image && d.image !== 'mock:image' ? { textModel: d.text || undefined, textCalls: 1, imageModel: d.image, videoModel: d.video || undefined, withVideo: !!d.video, sceneSeconds: [5] } : null));
    box.append(qb.el); qb.update.now();
    return [
      h('label', {}, 'Writing model (writes the ad)'), modelPicker({ kind: 'text', value: d.text || null, noneLabel: 'Free template (no AI)', onChange: set('text') }),
      h('label', {}, 'Image model (actor + product → still frame)'), modelPicker({ kind: 'image', value: d.image && d.image !== 'mock:image' ? d.image : null, onChange: set('image') }),
      h('label', {}, 'Video model (optional)'), modelPicker({ kind: 'video', value: d.video || null, noneLabel: 'No video (images only)', onChange: set('video') }),
      h('p', { class: 'small', style: 'margin-top:12px' }, 'Estimated cost of a one-scene, 5-second ad with these choices:'), box];
  }
  if (id === 'budget') {
    const cap = h('input', { type: 'number', min: '0', step: '1', value: s.budget.monthlyUsd || '', placeholder: 'e.g. 25' });
    return [h('label', {}, 'Monthly cap in USD'), cap,
      h('p', { class: 'small' }, 'Any run that would push you past this (counting work already queued) is refused before it starts. Leave it empty for no cap.'),
      h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'primary fit', onclick: guard(async () => { await api('PUT', 'settings', { budget: { monthlyUsd: cap.value || 0 } }); setupUi.open = idx; await refreshLight(); toast('Budget saved'); render(); }) }, 'Save budget'),
        h('button', { class: 'ghost fit', onclick: () => { lsSet('a3.setup.budgetSkipped', true); setupUi.open = idx + 1; render(); } }, 'Skip for now'))];
  }
  return [h('p', {}, `You have ${state.products.length} product(s) and ${state.actors.length} actor(s).`),
    h('p', { class: 'small' }, 'Only upload people who have agreed to appear in your ads. The Library explains how AI characters and real people are handled differently.'),
    h('div', { class: 'row' }, h('button', { class: 'primary fit', onclick: () => { state.view = 'library'; render(); } }, state.products.length && state.actors.length ? 'Open the Library' : 'Add them in the Library'))];
}

function viewSetup() {
  const steps = setupSteps(), prog = setupProgress();
  const firstTodo = steps.findIndex((x) => !x.done && !x.optional);
  const open = setupUi.open === undefined ? firstTodo : setupUi.open;
  return h('div', {}, h('h1', {}, 'Setup'), h('p', { class: 'sub' }, 'Four required steps and one optional. Each one tells you what it did and what it found, and you can come back any time.'),
    h('div', { class: 'setup-progress' }, h('b', {}, `${prog.done} of ${prog.total}`), h('div', { class: 'bar' }, h('i', { style: `width:${(prog.done / prog.total) * 100}%` })), prog.complete ? h('span', { class: 'tag live' }, 'ready') : null),
    h('div', { class: 'steps' }, steps.map((st, i) => h('section', { class: `step${st.done ? ' done' : ''}${open === i ? ' open' : ''}` },
      h('button', { class: 'step-head', 'aria-expanded': String(open === i), onclick: () => { setupUi.open = open === i ? null : i; render(); } },
        h('span', { class: 'step-no' }, st.done ? '✓' : String(i + 1)), h('span', { class: 'step-title' }, st.title, h('small', {}, st.sub)),
        h('span', { class: `tag ${st.done ? 'live' : st.optional ? '' : 'est'}` }, st.done ? 'done' : st.optional ? 'optional' : 'to do')),
      open === i ? h('div', { class: 'step-body' }, setStepBody(st.id, i), st.done && i < steps.length - 1 ? h('div', { style: 'margin-top:16px' }, h('button', { class: 'sec', onclick: () => { setupUi.open = i + 1; render(); } }, 'Next step →')) : null) : null))),
    prog.complete ? h('div', { class: 'panel', style: 'max-width:760px;margin-top:16px' }, h('h2', {}, 'You are ready'), h('p', {}, 'Pick a product and an actor and Quick Ad does the rest. You see the price before anything runs.'),
      h('button', { class: 'primary', onclick: () => { state.view = 'quick'; render(); } }, 'Make your first ad')) : null);
}
