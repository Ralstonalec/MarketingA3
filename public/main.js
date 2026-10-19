'use strict';
function viewSettings() {
  const s = state.settings;
  const key = (name, hint) => {
    const k = s.keys[name];
    const inp = h('input', { type: 'password', autocomplete: 'off', placeholder: k.set ? `${k.preview}${k.fromEnv ? ' (set by environment)' : ' (saved)'}` : 'Paste key' });
    return { name, inp, el: h('div', {}, h('label', {}, `${k.label} API key`), inp, hint ? h('div', { class: 'small', style: 'margin-top:4px' }, hint) : null) };
  };
  const keys = [key('openrouter', 'Used for the writing models and OpenRouter image models.'), key('higgsfield', 'Check Higgsfield\'s dashboard for the exact key format (it may be KEY_ID:KEY_SECRET).'), key('custom', 'Only needed for self-hosted or other APIs that use {{apiKey}}.')];
  const b = s.brand;
  const brand = { name: h('input', { value: b.name, placeholder: 'Your brand or business name' }), voice: h('input', { value: b.voice, placeholder: 'e.g. warm, witty, no hype, speaks like a friend' }),
    forbidden: h('input', { value: b.forbidden, placeholder: 'Words to never use in any ad, comma separated' }), defaultCta: h('input', { value: b.defaultCta, placeholder: 'e.g. Shop now at example.com' }) };
  let disclosure = b.disclosure, realism = b.realismBoost;
  const budget = h('input', { type: 'number', min: '0', step: '1', value: s.budget.monthlyUsd });
  const as = Object.fromEntries(Object.entries(s.assumptions).map(([k, v]) => [k, h('input', { type: 'number', min: '1', value: v })]));
  return h('div', { style: 'max-width:620px' }, h('h1', {}, 'Settings'), h('p', { class: 'sub' }, 'Keys are stored in data/db.json on the machine running this app and are never sent to the browser. Environment variables override them.'),
    h('div', { class: 'panel' }, h('h2', {}, 'API keys'), keys.map((k) => k.el)),
    h('div', { class: 'panel' }, h('h2', {}, 'Brand'), h('p', { class: 'small', style: 'margin-top:-8px' }, 'Applied to every ad the writer produces.'),
      h('label', {}, 'Brand name'), brand.name, h('label', {}, 'Voice'), brand.voice, h('label', {}, 'Never say (all ads)'), brand.forbidden, h('label', {}, 'Default call to action'), brand.defaultCta,
      h('label', {}, h('input', { type: 'checkbox', checked: b.disclosure, style: 'width:auto;margin-right:8px', onchange: (e) => (disclosure = e.target.checked) }), 'Add #ad disclosure hashtag automatically'),
      h('label', {}, h('input', { type: 'checkbox', checked: b.realismBoost, style: 'width:auto;margin-right:8px', onchange: (e) => (realism = e.target.checked) }), 'Add realism guards to prompts (correct hands, sharp product label, no watermark, no morphing)')),
    h('div', { class: 'panel' }, h('h2', {}, 'Budget'), h('label', {}, 'Monthly cap in USD (0 = no cap)'), budget,
      h('p', { class: 'small' }, 'Jobs and composer runs that would push you past the cap (counting work already queued) are refused before they start.')),
    h('div', { class: 'panel' }, h('h2', {}, 'Estimate assumptions'),
      h('p', { class: 'small' }, 'Used only to turn per-token prices into a per-call price before you run something. Real cost is recorded afterwards when the provider reports it.'),
      h('div', { class: 'row' }, ['textInTokens', 'textOutTokens', 'imageOutTokens'].map((k) => h('div', {}, h('label', {}, { textInTokens: 'Text input tokens', textOutTokens: 'Text output tokens', imageOutTokens: 'Image output tokens' }[k]), as[k])))),
    h('div', { style: 'margin-top:16px' }, h('button', { class: 'primary', onclick: guard(async () => {
      await api('PUT', 'settings', {
        keys: Object.fromEntries(keys.map((k) => [k.name, k.inp.value])), budget: { monthlyUsd: budget.value },
        brand: { name: brand.name.value, voice: brand.voice.value, forbidden: brand.forbidden.value, defaultCta: brand.defaultCta.value, disclosure, realismBoost: realism },
        assumptions: Object.fromEntries(Object.entries(as).map(([k, i]) => [k, i.value])),
      });
      toast('Saved'); await refreshLight(); render();
    }) }, 'Save settings')));
}

const NAV = [
  ['sec', 'Create'], ['quick', 'Quick Ad'], ['compose', 'Ad Composer'], ['studio', 'Studio'], ['tools', 'Tools'], ['gallery', 'Gallery'],
  ['sec', 'Manage'], ['library', 'Library'], ['models', 'Models'], ['spend', 'Spend'], ['settings', 'Settings'],
];

async function render() {
  document.getElementById('nav').replaceChildren(...NAV.map(([k, label]) => k === 'sec' ? h('div', { class: 'sec' }, label)
    : h('button', { class: state.view === k ? 'on' : '', onclick: () => { state.view = k; render(); } }, label)));
  const views = { quick: viewQuick, tools: viewTools, compose: viewCompose, studio: viewStudio, gallery: viewGallery, library: viewLibrary, models: viewModels, spend: viewSpend, settings: viewSettings };
  const token = (render.token = (render.token || 0) + 1);
  const el = await views[state.view]();
  if (token === render.token) document.getElementById('main').replaceChildren(el);
}
document.getElementById('spendpill').addEventListener('click', () => { state.view = 'spend'; render(); });

// Poll while any job is active. Only the Gallery re-renders, so typing elsewhere is never interrupted.
setInterval(guard(async () => {
  if (![...state.jobs, ...state.runs].some((j) => j.status === 'queued' || j.status === 'running')) return;
  await refreshLight();
  if (state.view === 'gallery' || state.view === 'tools') render();
}), 3000);

guard(async () => {
  state.meta = await api('GET', 'meta');
  await Promise.all([refreshLight(), refreshModels()]);
  render();
})();
