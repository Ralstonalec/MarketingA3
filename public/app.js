'use strict';
const $main = document.getElementById('main');
const state = { tab: 'studio', products: [], actors: [], jobs: [], settings: null, meta: null,
  form: { productId: null, actorId: null, format: 'ugc', ratio: '9:16', duration: 5, withVideo: true, brief: '', copy: null } };

// ---- helpers ---------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
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
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.style.display = 'none'), 3500);
}
const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

/** Downscale in the browser so uploads stay small and under provider limits. */
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

async function refresh() {
  [state.products, state.actors, state.jobs, state.settings] = await Promise.all([api('GET', 'products'), api('GET', 'actors'), api('GET', 'jobs'), api('GET', 'settings')]);
  const b = document.getElementById('providerBadge');
  const live = state.settings.provider !== 'mock';
  b.textContent = live ? `Provider: ${state.settings.provider}` : 'Demo mode (no real generation)';
  b.className = 'badge' + (live ? ' live' : '');
}

// ---- library tabs (products / actors share one UI) --------------------------
function library(kind, noun) {
  const draft = { name: '', description: '', images: [] };
  const items = state[kind];
  const thumbs = h('div', { class: 'thumbs' });
  const addImgs = async (files) => {
    for (const f of [...files].slice(0, 4 - draft.images.length)) draft.images.push(await fileToDataUrl(f));
    thumbs.replaceChildren(...draft.images.map((u) => h('img', { src: u })));
  };
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: guard((e) => addImgs(e.target.files)) });
  const hint = kind === 'actors'
    ? 'Upload a clear, well-lit photo of the face/body. The first image is the one used for generation. Only use people who have consented to being used in ads.'
    : 'Upload a clean product shot, ideally on a plain background with the label visible. The first image is used for generation.';
  const name = h('input', { placeholder: `${noun} name` });
  const desc = h('textarea', { placeholder: kind === 'actors' ? 'Look, age, vibe, voice…' : 'What it is, key benefits, who it is for…' });
  const form = h('div', { class: 'panel', style: 'margin-bottom:24px;max-width:520px' },
    h('h2', {}, `Add ${noun.toLowerCase()}`),
    name, h('label', {}, 'Description'), desc,
    h('label', {}, 'Images (up to 4)'),
    h('div', { class: 'dz', onclick: () => input.click() }, 'Click to choose images'), input, thumbs,
    h('p', { class: 'small' }, hint),
    h('button', { class: 'primary', onclick: guard(async () => {
      await api('POST', kind, { name: name.value, description: desc.value, images: draft.images });
      toast(`${noun} saved`); await refresh(); render();
    }) }, `Save ${noun.toLowerCase()}`));
  const grid = items.length
    ? h('div', { class: 'grid' }, items.map((it) => h('div', { class: 'card' },
        h('img', { src: `/files/uploads/${it.images[0]}`, alt: it.name }),
        h('div', { class: 'body' }, h('h3', {}, it.name), h('p', {}, it.description || '')),
        h('div', { class: 'actions' }, h('button', { onclick: guard(async () => {
          if (!confirm(`Delete ${it.name}?`)) return;
          await api('DELETE', `${kind}/${it.id}`); await refresh(); render();
        }) }, 'Delete')))))
    : h('div', { class: 'empty' }, `No ${kind} yet.`);
  return h('div', {}, form, grid);
}

// ---- studio ----------------------------------------------------------------
function picker(items, key) {
  if (!items.length) return h('div', { class: 'small' }, `None yet — add one in the ${key === 'productId' ? 'Products' : 'Actors'} tab.`);
  return h('div', { class: 'picker' }, items.map((it) => h('div', {
    class: 'pick' + (state.form[key] === it.id ? ' sel' : ''),
    onclick: () => { state.form[key] = it.id; state.form.copy = null; render(); },
  }, h('img', { src: `/files/uploads/${it.images[0]}` }), h('span', {}, it.name))));
}
function chips(options, key, fmt = (x) => x) {
  return h('div', { class: 'chips' }, options.map((o) => h('div', {
    class: 'chip' + (state.form[key] === o ? ' sel' : ''),
    onclick: () => { state.form[key] = o; if (key !== 'ratio' && key !== 'duration') state.form.copy = null; render(); },
  }, fmt(o))));
}

function studio() {
  const f = state.form;
  const p = state.settings.pricing;
  const credits = p.imageCredits + (f.withVideo ? p.videoCreditsPerSec * f.duration : 0);
  const canGo = f.productId && f.actorId;

  const brief = h('textarea', { placeholder: 'e.g. "Summer sale, energetic, shot outdoors, mention free shipping"', oninput: (e) => { f.brief = e.target.value; } });
  brief.value = f.brief;

  const copyBox = f.copy ? h('div', { class: 'panel', style: 'margin-top:16px' },
    h('div', { class: 'small' }, f.copy.source === 'claude' ? 'Written by Claude — edit freely' : 'Template (add an Anthropic key in Settings for AI-written concepts)'),
    h('label', {}, 'Image prompt (@actor and @product bind your uploads)'),
    h('textarea', { oninput: (e) => (f.copy.imagePrompt = e.target.value) }, f.copy.imagePrompt),
    h('label', {}, 'Motion prompt'),
    h('textarea', { oninput: (e) => (f.copy.motionPrompt = e.target.value) }, f.copy.motionPrompt),
    h('label', {}, 'Spoken line (for your voiceover / lip-sync tool)'),
    h('textarea', { oninput: (e) => (f.copy.script = e.target.value) }, f.copy.script)) : null;

  const left = h('div', { class: 'panel' },
    h('h2', {}, 'Create an ad'),
    h('label', {}, '1. Product'), picker(state.products, 'productId'),
    h('label', {}, '2. Actor'), picker(state.actors, 'actorId'),
    h('label', {}, '3. Style'), chips(Object.keys(state.meta.formats), 'format', (k) => state.meta.formats[k]),
    h('label', {}, '4. Creative brief (optional)'), brief,
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'sec', disabled: !canGo, onclick: guard(async () => {
        f.copy = await api('POST', 'copy', f); render();
      }) }, f.copy ? 'Rewrite concept' : 'Preview concept first')),
    copyBox);

  const right = h('div', { class: 'panel' },
    h('h2', {}, 'Output'),
    h('label', {}, 'Aspect ratio'), chips(state.meta.ratios, 'ratio'),
    h('label', {}, 'Render video'),
    h('div', { class: 'chips' }, [true, false].map((v) => h('div', { class: 'chip' + (f.withVideo === v ? ' sel' : ''), onclick: () => { f.withVideo = v; render(); } }, v ? 'Image + video' : 'Image only'))),
    f.withVideo ? [h('label', {}, 'Video length'), chips([5, 10], 'duration', (d) => `${d}s`)] : null,
    h('div', { class: 'est' }, `Estimated cost: ~${credits} credits ≈ $${(credits * p.creditUsd).toFixed(2)}`),
    h('button', { class: 'primary', style: 'width:100%', disabled: !canGo, onclick: guard(async () => {
      await api('POST', 'jobs', f);
      f.copy = null; toast('Started — watch it in the Gallery'); state.tab = 'gallery'; await refresh(); render();
    }) }, 'Generate ad'));
  return h('div', { class: 'studio' }, left, right);
}

// ---- gallery ---------------------------------------------------------------
function gallery() {
  if (!state.jobs.length) return h('div', { class: 'empty' }, 'No ads yet. Make one in the Ad Studio.');
  return h('div', { class: 'grid', style: 'grid-template-columns:repeat(auto-fill,minmax(260px,1fr))' }, state.jobs.map((j) => {
    const media = j.video && j.video.file ? h('video', { src: `/files/outputs/${j.video.file}`, controls: true, loop: true, playsinline: true })
      : j.image && j.image.file ? h('img', { class: 'fit', src: `/files/outputs/${j.image.file}` })
      : h('div', { class: 'empty', style: 'aspect-ratio:1' }, j.status === 'failed' ? '' : `${j.stage}…`);
    const file = (j.video && j.video.file) || (j.image && j.image.file);
    return h('div', { class: 'card' }, media,
      h('div', { class: 'body' },
        h('h3', {}, `${j.productName} × ${j.actorName}`),
        h('p', {}, h('span', { class: `status ${j.status}` }, j.status === 'running' ? `${j.stage}…` : j.status), ` ${j.ratio} · ~$${j.estimate.usd.toFixed(2)}`),
        j.error ? h('div', { class: 'err' }, j.error) : null,
        j.copy && j.copy.script ? h('p', { style: 'margin-top:6px' }, `“${j.copy.script}”`) : null),
      h('div', { class: 'actions' },
        file ? h('a', { href: `/files/outputs/${file}`, download: file }, 'Download') : null,
        j.status === 'failed' ? h('button', { onclick: guard(async () => { await api('POST', `jobs/${j.id}/retry`); await refresh(); render(); }) }, 'Retry') : null,
        h('button', { onclick: guard(async () => { if (confirm('Delete this ad?')) { await api('DELETE', `jobs/${j.id}`); await refresh(); render(); } }) }, 'Delete')));
  }));
}

// ---- settings --------------------------------------------------------------
function settingsView() {
  const s = state.settings;
  const keyRow = (name, label) => {
    const k = s.keys[name];
    const inp = h('input', { type: 'password', placeholder: k.set ? `${k.preview}${k.fromEnv ? ' (from environment)' : ''}` : 'Paste API key', autocomplete: 'off' });
    return { inp, el: h('div', {}, h('label', {}, label), inp) };
  };
  const runway = keyRow('runway', 'Runway API key (dev.runwayml.com)');
  const anth = keyRow('anthropic', 'Anthropic API key (optional — AI-written ad concepts)');
  const prov = h('select', {}, s.providers.map((p) => h('option', { value: p.name, selected: p.name === s.provider }, p.label)));
  const model = h('input', { value: s.anthropicModel });
  const price = (k, l) => { const i = h('input', { type: 'number', step: '0.01', value: s.pricing[k] }); return { k, i, el: h('div', {}, h('label', {}, l), i) }; };
  const prices = [price('creditUsd', '$ per credit'), price('imageCredits', 'Credits per image'), price('videoCreditsPerSec', 'Credits per video second')];
  return h('div', { class: 'panel', style: 'max-width:560px' },
    h('h2', {}, 'Settings'),
    h('label', {}, 'Generation provider'), prov,
    runway.el, anth.el,
    h('label', {}, 'Claude model for ad concepts'), model,
    h('h3', { style: 'margin-top:24px' }, 'Cost estimate rates'),
    h('p', { class: 'small' }, 'Estimates only — copy the numbers from your provider\'s pricing page.'),
    h('div', { class: 'row' }, prices.map((p) => p.el)),
    h('p', { class: 'small', style: 'margin-top:16px' }, 'Keys are stored in data/db.json on the machine running this server and are never sent to the browser. Environment variables override them.'),
    h('button', { class: 'primary', onclick: guard(async () => {
      await api('PUT', 'settings', {
        provider: prov.value, anthropicModel: model.value,
        keys: { runway: runway.inp.value, anthropic: anth.inp.value },
        pricing: Object.fromEntries(prices.map((p) => [p.k, p.i.value])),
      });
      toast('Saved'); await refresh(); render();
    }) }, 'Save settings'));
}

// ---- shell -----------------------------------------------------------------
function render() {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const views = { studio, products: () => library('products', 'Product'), actors: () => library('actors', 'Actor'), gallery, settings: settingsView };
  $main.replaceChildren(views[state.tab]());
}
document.getElementById('nav').addEventListener('click', (e) => {
  if (e.target.dataset.tab) { state.tab = e.target.dataset.tab; render(); }
});

// Poll while any job is active; skip re-render in the studio so typing is never interrupted.
setInterval(guard(async () => {
  if (!state.jobs.some((j) => j.status === 'queued' || j.status === 'running')) return;
  await refresh();
  if (state.tab === 'gallery') render();
}), 3000);

guard(async () => { state.meta = await api('GET', 'meta'); await refresh(); render(); })();
