'use strict';
const state = {
  view: 'quick', products: [], actors: [], jobs: [], models: [], modelsFetchedAt: null, settings: null, spend: null, meta: null,
  compose: { productId: null, actorId: null, platform: 'tiktok', format: 'ugc', tone: 'energetic, authentic', cta: 'Shop now', brief: '', variants: 2, scenes: 2, sceneSeconds: 5, textModel: null, result: null, busy: false },
  studio: { productId: null, actorId: null, imagePrompt: '', motionPrompt: '', ratio: '9:16', duration: 5, withVideo: false, imageModel: null, videoModel: null },
};

// ---- helpers -----------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k));
  return el;
}
async function api(method, url, body) {
  const res = await fetch('/api/' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || res.statusText);
  return j;
}
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 4500);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function money(n) {
  if (n == null) return '—';
  if (n === 0) return '$0';
  return '$' + (Math.abs(n) < 0.1 ? n.toFixed(4) : n.toFixed(2));
}

/** Downscale in the browser so uploads stay small. */
function fileToDataUrl(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.9));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error(`${file.name} is not a readable image`));
    img.src = URL.createObjectURL(file);
  });
}

// ---- data --------------------------------------------------------------------
async function refreshLight() {
  [state.products, state.actors, state.jobs, state.settings, state.spend] = await Promise.all([
    api('GET', 'products'), api('GET', 'actors'), api('GET', 'jobs'), api('GET', 'settings'), api('GET', 'spend')]);
  renderSpendPill();
}
async function refreshModels() {
  const r = await api('GET', 'models');
  state.models = r.models; state.modelsFetchedAt = r.fetchedAt;
}
const modelById = (id) => state.models.find((m) => m.id === id);
const modelsOf = (kind) => state.models.filter((m) => m.kind === kind);

function renderSpendPill() {
  const s = state.spend, el = document.getElementById('spendpill');
  if (!s) return;
  const cap = s.budget.monthlyUsd;
  el.replaceChildren(h('small', {}, 'Spent this month'), h('b', {}, money(s.month)),
    ...(cap > 0 ? [h('small', {}, `of ${money(cap)} budget`), h('div', { class: 'bar' + (s.month / cap > 0.85 ? ' hot' : '') }, h('i', { style: `width:${Math.min(100, (s.month / cap) * 100)}%` }))] : [h('small', {}, 'No budget cap set')]));
}

// ---- price display -----------------------------------------------------------
function priceText(m) {
  const p = m.price, a = (state.settings && state.settings.assumptions) || { imageOutTokens: 1300 };
  if (!m.priced) return 'no price set';
  if (p.unit === 'tokens') return `${money(p.in)} in · ${money(p.out)} out per 1M tokens`;
  if (p.unit === 'image') return Number.isFinite(p.usd) ? `${money(p.usd)} / image` : `≈${money((p.completionPerM * a.imageOutTokens) / 1e6)} / image`;
  if (p.unit === 'second') return `${money(p.usd)} / second`;
  return `${money(p.usd)} / video`;
}
function basisTag(m) {
  const b = !m.priced ? 'unset' : m.price.basis;
  const text = { live: 'live price', 'live-estimate': 'estimate', manual: 'your price', unset: 'set price' }[b] || b;
  const cls = { live: 'live', 'live-estimate': 'est', manual: 'manual', unset: 'unset' }[b] || '';
  return h('span', { class: `tag ${cls}`, title: b === 'live-estimate' ? 'Billed per output token; the real cost is recorded after each generation' : '' }, text);
}

// ---- model picker ------------------------------------------------------------
function modelPicker({ kind, value, onChange, noneLabel }) {
  let open = false, q = '';
  const favs = () => new Set(lsGet('a3.favs', []));
  const root = h('div', { class: 'mp' });
  const cur = () => modelById(value);

  function pick(id) { value = id; open = false; q = ''; draw(); onChange(id); }
  function toggleFav(id, ev) {
    ev.stopPropagation();
    const f = favs(); f.has(id) ? f.delete(id) : f.add(id); lsSet('a3.favs', [...f]); draw();
  }
  function items() {
    const f = favs(), needle = q.trim().toLowerCase();
    return modelsOf(kind)
      .filter((m) => !needle || (m.label + ' ' + m.id).toLowerCase().includes(needle))
      .sort((a, b) => (f.has(b.id) - f.has(a.id)) || (b.priced - a.priced) || a.label.localeCompare(b.label))
      .slice(0, 80);
  }
  function draw() {
    const m = cur();
    const btn = h('button', { type: 'button', class: 'mp-btn', 'aria-haspopup': 'listbox', 'aria-expanded': String(open), onclick: () => { open = !open; draw(); if (open) root.querySelector('input').focus(); } },
      h('span', {}, m ? m.label : (noneLabel || `Choose a ${kind} model`), h('small', {}, m ? priceText(m) : kind === 'text' && noneLabel ? 'Free, no AI' : 'Price shows here')),
      m ? basisTag(m) : h('span', {}, '▾'));
    root.replaceChildren(btn);
    if (!open) return;
    const f = favs();
    const list = h('div', { class: 'mp-list', role: 'listbox' });
    if (noneLabel) list.append(h('div', { class: 'mp-item', onclick: () => pick(null) }, h('span', {}, noneLabel, h('small', {}, 'Free, no AI'))));
    for (const it of items()) {
      list.append(h('div', { class: 'mp-item' + (it.id === value ? ' sel' : ''), role: 'option', onclick: () => pick(it.id) },
        h('span', {}, h('button', { type: 'button', class: 'star' + (f.has(it.id) ? ' on' : ''), title: 'Favorite', 'aria-label': 'Toggle favorite', onclick: (e) => toggleFav(it.id, e) }, f.has(it.id) ? '★' : '☆'), it.label,
          h('small', {}, `${it.provider} · ${it.id.replace(/^[a-z]+:/, '')}`)),
        h('span', { class: 'px' }, priceText(it), h('div', {}, basisTag(it)))));
    }
    if (!list.children.length) list.append(h('div', { class: 'empty' }, state.models.some((x) => x.kind === kind) ? 'No matches' : `No ${kind} models yet. Add keys in Settings, then refresh in Models.`));
    root.append(h('div', { class: 'mp-pop' }, h('input', { placeholder: `Search ${kind} models…`, value: q, oninput: (e) => { q = e.target.value; const pos = e.target.selectionStart; draw(); const i = root.querySelector('input'); i.focus(); i.setSelectionRange(pos, pos); } }), list));
  }
  // composedPath: the clicked node may already have been replaced by draw(), so root.contains() would misjudge it.
  document.addEventListener('click', (e) => { if (open && !e.composedPath().includes(root)) { open = false; draw(); } });
  draw();
  return root;
}

// ---- live quote --------------------------------------------------------------
/** Shows an itemised price for whatever getParams() returns; calls onQuote(quote|null) on change. */
function quoteBox(getParams, onQuote = () => {}) {
  const el = h('div', { class: 'quote' });
  let t, seq = 0;
  async function update() {
    const my = ++seq;
    const p = getParams();
    if (!p) { el.replaceChildren(h('div', { class: 'small' }, 'Pick models to see the price.')); onQuote(null); return; }
    let q;
    try { q = await api('POST', 'quote', p); } catch (e) { q = { error: e.message }; }
    if (my !== seq) return; // a newer request superseded this one
    if (q.error) { el.replaceChildren(h('div', { class: 'warn' }, q.error)); onQuote(null); return; }
    el.replaceChildren(
      ...q.lines.map((l) => h('div', { class: 'ln' }, h('span', {}, `${l.label} × ${l.qty}`, ' ', h('span', { class: 'small' }, l.kind)), h('span', {}, money(l.usd)))),
      h('div', { class: 'tot' }, h('span', {}, 'Estimated total'), h('span', {}, money(q.usd))),
      h('div', { class: 'small' }, 'Actual cost is recorded after each step; estimates are marked in Spend.'));
    onQuote(q);
  }
  const debounced = () => { clearTimeout(t); t = setTimeout(update, 200); };
  debounced.now = update;
  return { el, update: debounced };
}

function chips(options, get, set, fmt = (x) => x) {
  const wrap = h('div', { class: 'chips' });
  const draw = () => wrap.replaceChildren(...options.map((o) => h('button', { type: 'button', class: 'chip' + (get() === o ? ' sel' : ''), onclick: () => { set(o); draw(); } }, fmt(o))));
  draw();
  return wrap;
}

function entityPicker(items, get, set, emptyHint) {
  if (!items.length) return h('div', { class: 'small' }, emptyHint);
  const wrap = h('div', { class: 'picker' });
  const draw = () => wrap.replaceChildren(...items.map((it) => h('div', { class: 'pick' + (get() === it.id ? ' sel' : ''), role: 'button', tabindex: '0', onclick: () => { set(it.id); draw(); }, onkeydown: (e) => { if (e.key === 'Enter') { set(it.id); draw(); } } },
    h('img', { src: `/files/uploads/${it.images[0]}`, alt: '' }), h('span', {}, it.name))));
  draw();
  return wrap;
}
