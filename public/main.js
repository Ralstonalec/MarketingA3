'use strict';
async function viewSettings() {
  const s = state.settings;
  const accts = await api('GET', 'accounts');
  const key = (name, hint) => {
    const k = s.keys[name];
    const inp = h('input', { type: 'password', autocomplete: 'off', placeholder: k.set ? `${k.preview}${k.fromEnv ? ' (set by environment)' : ' (saved)'}` : 'Paste key' });
    const chk = accts[name] && accts[name].check, res = h('div', { class: 'small', style: 'margin-top:4px' });
    const draw = (c) => res.replaceChildren(...(c ? [h('span', { class: `tag ${c.ok === true ? 'live' : c.ok === false ? 'unset' : 'est'}` }, c.ok === true ? 'key works' : c.ok === false ? 'key problem' : 'untested'), ` ${c.detail} `, h('span', { class: 'small' }, `(${new Date(c.at).toLocaleString()})`)] : []));
    draw(chk);
    const test = h('button', { class: 'sec', type: 'button', style: 'margin-top:6px', disabled: !k.set, onclick: guard(async (e) => { e.target.disabled = true; e.target.textContent = 'Testing…'; try { draw(await api('POST', 'accounts/test', { provider: name })); } finally { e.target.disabled = !k.set; e.target.textContent = 'Test key'; } }) }, 'Test key');
    return { name, inp, el: h('div', {}, h('label', {}, `${k.label} API key`), inp, hint ? h('div', { class: 'small', style: 'margin-top:4px' }, hint) : null, test, res) };
  };
  const keys = [key('openrouter', 'Used for the writing models and OpenRouter image models.'), key('higgsfield', 'Create a key in console.higgsfield.ai. A credential is a key ID plus a secret; enter them as KEY_ID:SECRET. If requests return 401, compare with the format on Higgsfield\'s Authentication docs page.'), key('custom', 'Only needed for self-hosted or other APIs that use {{apiKey}}.')];
  const b = s.brand;
  const brand = { name: h('input', { value: b.name, placeholder: 'Your brand or business name' }), voice: h('input', { value: b.voice, placeholder: 'e.g. warm, witty, no hype, speaks like a friend' }),
    forbidden: h('input', { value: b.forbidden, placeholder: 'Words to never use in any ad, comma separated' }), defaultCta: h('input', { value: b.defaultCta, placeholder: 'e.g. Shop now at example.com' }) };
  let disclosure = b.disclosure, realism = b.realismBoost;
  const syncHours = h('input', { type: 'number', min: '0', max: '168', value: s.sync.autoRefreshHours });
  let learn = s.sync.learnCosts;
  const specUrl = h('input', { value: s.sync.higgsfieldSpecUrl, placeholder: 'https://docs.higgsfield.ai/docs/openapi.json' });
  const budget = h('input', { type: 'number', min: '0', step: '1', value: s.budget.monthlyUsd });
  const as = Object.fromEntries(Object.entries(s.assumptions).map(([k, v]) => [k, h('input', { type: 'number', min: '1', value: v })]));
  return h('div', { style: 'max-width:620px' }, h('h1', {}, 'Settings'), h('p', { class: 'sub' }, 'Keys are stored in data/db.json on the machine running this app and are never sent to the browser. Environment variables override them.'),
    h('div', { class: 'panel' }, h('h2', {}, 'API keys'), keys.map((k) => k.el)),
    h('div', { class: 'panel' }, h('h2', {}, 'Brand'), h('p', { class: 'small', style: 'margin-top:-8px' }, 'Applied to every ad the writer produces.'),
      h('label', {}, 'Brand name'), brand.name, h('label', {}, 'Voice'), brand.voice, h('label', {}, 'Never say (all ads)'), brand.forbidden, h('label', {}, 'Default call to action'), brand.defaultCta,
      h('label', {}, h('input', { type: 'checkbox', checked: b.disclosure, style: 'width:auto;margin-right:8px', onchange: (e) => (disclosure = e.target.checked) }), 'Add #ad disclosure hashtag automatically'),
      h('label', {}, h('input', { type: 'checkbox', checked: b.realismBoost, style: 'width:auto;margin-right:8px', onchange: (e) => (realism = e.target.checked) }), 'Add realism guards to prompts (correct hands, sharp product label, no watermark, no morphing)')),
    h('div', { class: 'panel' }, h('h2', {}, 'Model lists and prices'),
      h('p', { class: 'small', style: 'margin-top:-8px' }, 'The app re-reads OpenRouter\'s model list and the saved Higgsfield spec in the background, re-fetches exact prices, and tells you when one changes.'),
      h('label', {}, 'Refresh every (hours, 0 = off)'), syncHours,
      h('label', { style: 'display:flex;gap:8px;align-items:center;color:var(--text)' }, h('input', { type: 'checkbox', style: 'width:auto', checked: learn, onchange: (e) => (learn = e.target.checked) }), 'Quote from what the provider actually charged once there are 3 or more real runs'),
      h('label', {}, 'Higgsfield spec address (set automatically when you import)'), specUrl),
    h('div', { class: 'panel' }, h('h2', {}, 'Budget'), h('label', {}, 'Monthly cap in USD (0 = no cap)'), budget,
      h('p', { class: 'small' }, 'Jobs and composer runs that would push you past the cap (counting work already queued) are refused before they start.')),
    h('div', { class: 'panel' }, h('h2', {}, 'Estimate assumptions'),
      h('p', { class: 'small' }, 'Used only to turn per-token prices into a per-call price before you run something. Real cost is recorded afterwards when the provider reports it.'),
      h('div', { class: 'row' }, ['textInTokens', 'textOutTokens', 'imageOutTokens'].map((k) => h('div', {}, h('label', {}, { textInTokens: 'Text input tokens', textOutTokens: 'Text output tokens', imageOutTokens: 'Image output tokens' }[k]), as[k])))),
    h('div', { style: 'margin-top:16px' }, h('button', { class: 'primary', onclick: guard(async () => {
      await api('PUT', 'settings', {
        keys: Object.fromEntries(keys.map((k) => [k.name, k.inp.value])), budget: { monthlyUsd: budget.value },
        sync: { autoRefreshHours: syncHours.value, learnCosts: learn, higgsfieldSpecUrl: specUrl.value },
        brand: { name: brand.name.value, voice: brand.voice.value, forbidden: brand.forbidden.value, defaultCta: brand.defaultCta.value, disclosure, realismBoost: realism },
        assumptions: Object.fromEntries(Object.entries(as).map(([k, i]) => [k, i.value])),
      });
      toast('Saved'); await refreshLight(); render();
    }) }, 'Save settings')));
}

const NAV = [
  ['sec', 'Start'], ['setup', 'Setup'],
  ['sec', 'Create'], ['quick', 'Quick Ad'], ['compose', 'Ad Composer'], ['studio', 'Studio'], ['tools', 'Tools'], ['gallery', 'Gallery'],
  ['sec', 'Manage'], ['library', 'Library'], ['models', 'Models'], ['knowledge', 'Knowledge'], ['spend', 'Spend'], ['settings', 'Settings'],
];
const VIEWS = () => ({ setup: viewSetup, quick: viewQuick, tools: viewTools, compose: viewCompose, studio: viewStudio, gallery: viewGallery, library: viewLibrary, models: viewModels, knowledge: viewKnowledge, spend: viewSpend, settings: viewSettings });

const side = document.querySelector('.side'), menuBtn = document.getElementById('menu'), scrim = document.getElementById('scrim');
function setMenu(open) { side.classList.toggle('open', open); scrim.classList.toggle('on', open); menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.textContent = open ? '✕' : '☰'; }
menuBtn.addEventListener('click', () => setMenu(!side.classList.contains('open')));
scrim.addEventListener('click', () => setMenu(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

const skeleton = () => h('div', { class: 'skeleton', 'aria-busy': 'true', 'aria-label': 'Loading' }, h('i'), h('i'), h('i', { class: 'block' }), h('i'), h('i'));

async function render() {
  const prog = setupProgress();
  document.getElementById('nav').replaceChildren(...NAV.map(([k, label]) => k === 'sec' ? h('div', { class: 'sec' }, label)
    : h('button', { class: state.view === k ? 'on' : '', 'aria-current': state.view === k ? 'page' : null, onclick: () => { state.view = k; setMenu(false); render(); } }, label,
      k === 'setup' && !prog.complete ? h('span', { class: 'badge' }, `${prog.done}/${prog.total}`) : null)));
  const token = (render.token = (render.token || 0) + 1);
  const out = VIEWS()[state.view]();
  const main = document.getElementById('main');
  if (out && typeof out.then === 'function') main.replaceChildren(skeleton());   // data-backed screens show a placeholder while they load
  const el = await out;
  if (token !== render.token) return;
  main.replaceChildren(el);
  if (render.last !== state.view) { window.scrollTo(0, 0); render.last = state.view; }
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
  state.keyChecks = await api('GET', 'accounts').then((a) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v.check]))).catch(() => ({}));
  if (!setupProgress().complete) state.view = 'setup';   // first visit lands on guided setup
  render();
})();
