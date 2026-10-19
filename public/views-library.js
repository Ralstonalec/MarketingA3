'use strict';
/** Extra product details. Only facts listed here may be stated in an ad, so this is what keeps ads honest. */
function productDetails(p = {}) {
  const f = {
    facts: h('textarea', { placeholder: 'One true, provable fact per line, e.g. "Contains 15% vitamin C", "Fragrance free", "Ships in 2 days". Ads can only claim what is listed here.' }, (p.facts || []).join('\n')),
    audience: h('input', { placeholder: 'e.g. busy parents, first-time runners', value: p.audience || '' }),
    offer: h('input', { placeholder: 'e.g. 20% off until Sunday (leave empty if none)', value: p.offer || '' }),
    price: h('input', { placeholder: 'e.g. $29', value: p.price || '' }),
    forbidden: h('input', { placeholder: 'Words to never use, comma separated', value: p.forbidden || '' }),
  };
  return {
    el: h('div', {}, h('label', {}, 'Facts the ad may state (one per line)'), f.facts,
      h('div', { class: 'row' }, h('div', {}, h('label', {}, 'Audience'), f.audience), h('div', {}, h('label', {}, 'Price'), f.price)),
      h('label', {}, 'Current offer'), f.offer, h('label', {}, 'Never say'), f.forbidden),
    fill: (d) => { f.facts.value = (d.facts || []).join('\n'); f.audience.value = d.audience || ''; f.offer.value = d.offer || ''; f.price.value = d.price || ''; },
    read: () => ({ facts: f.facts.value, audience: f.audience.value, offer: f.offer.value, price: f.price.value, forbidden: f.forbidden.value }),
  };
}

/** Who the presenter is matters legally: an AI character cannot give a first-person testimonial. */
function actorDetails(a = {}) {
  let kind = a.kind === 'real' ? 'real' : 'ai', attest = !!a.attestUsed;
  const box = h('div', {});
  const draw = () => box.replaceChildren(
    h('label', {}, 'Who is this presenter?'),
    h('select', { onchange: (e) => { kind = e.target.value; if (kind === 'ai') attest = false; draw(); } },
      h('option', { value: 'ai', selected: kind === 'ai' }, 'An AI-generated character (not a real person)'), h('option', { value: 'real', selected: kind === 'real' }, 'A real person who has agreed to appear')),
    kind === 'real' ? h('label', { style: 'display:flex;gap:8px;align-items:flex-start;color:var(--text)' }, h('input', { type: 'checkbox', style: 'width:auto;margin-top:3px', checked: attest, onchange: (e) => (attest = e.target.checked) }),
      h('span', {}, 'This person has genuinely used the product and the opinions are theirs. (Only then may ads say "I tried it" or describe personal results.)')) : null,
    h('p', { class: 'small' }, kind === 'ai' ? 'An AI character has not used your product, so its ads are written as demos or recommendations, never as a personal review (FTC endorsement rules). Posts should use the platform\'s AI label.' : 'Keep written consent from this person, including for use of their likeness in AI-generated video.'));
  draw();
  return { el: box, read: () => ({ kind, attestUsed: kind === 'real' && attest }) };
}

function librarySection(kind, noun, hint) {
  const draft = { name: '', description: '', images: [] };
  const thumbs = h('div', { class: 'thumbs' });
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: guard(async (e) => {
    for (const f of [...e.target.files].slice(0, 4 - draft.images.length)) draft.images.push(await fileToDataUrl(f));
    redraw();
  }) });
  const name = h('input', { placeholder: `${noun} name` });
  const desc = h('textarea', { placeholder: kind === 'actors' ? 'Look, age, vibe, voice… (helps the composer write for them)' : 'What it is, key benefits, who it is for…' });
  const details = kind === 'products' ? productDetails() : actorDetails();
  const redraw = () => thumbs.replaceChildren(...draft.images.map((u) => h('img', { src: u, alt: '' })));
  const importer = kind !== 'products' ? null : (() => {
    const url = h('input', { placeholder: 'https://yourshop.com/products/your-product' });
    const out = h('div', { class: 'small', style: 'margin-top:8px' });
    const wm = state.settings.defaults.text && modelById(state.settings.defaults.text);
    return h('div', { class: 'panel', style: 'max-width:520px;margin-bottom:16px' }, h('h2', {}, 'Import from a link'),
      h('p', { class: 'small', style: 'margin-top:-8px' }, 'Paste a product page. You get a draft to review below. Only facts the page actually states are kept.'),
      url, h('div', { class: 'small', style: 'margin:6px 0' }, wm ? `Uses ${wm.label} (small cost, shown in Spend).` : 'No default writing model set, so only the page\'s own details are read.'),
      h('button', { class: 'primary', onclick: guard(async (e) => {
        e.target.disabled = true; e.target.textContent = 'Reading page…';
        try {
          const r = await api('POST', 'products/import', { url: url.value });
          name.value = r.draft.name; desc.value = r.draft.description; details.fill(r.draft); draft.images = r.draft.images; draft.url = r.draft.url; redraw();
          out.replaceChildren(h('div', {}, `Draft ready (read by ${r.extractedBy}${r.usd ? ', ' + money(r.usd) : ''}). Review it below, then save.`), ...r.notes.map((n) => h('div', { class: 'warn' }, n)));
          await refreshLight();
        } finally { e.target.disabled = false; e.target.textContent = 'Import'; }
      }) }, 'Import'), out);
  })();
  const form = h('div', { class: 'panel', style: 'max-width:520px;margin-bottom:16px' },
    h('label', {}, 'Name'), name, h('label', {}, 'Description'), desc, details.el,
    h('label', {}, 'Images (up to 4, first one is used for generation)'),
    h('div', { class: 'dz', role: 'button', tabindex: '0', onclick: () => input.click() }, 'Click to choose images'), input, thumbs,
    h('p', { class: 'small' }, hint),
    h('button', { class: 'primary', onclick: guard(async () => {
      await api('POST', kind, { name: name.value, description: desc.value, images: draft.images, url: draft.url, ...details.read() });
      toast(`${noun} saved`); await refreshLight(); render();
    }) }, `Save ${noun.toLowerCase()}`));
  const items = state[kind];
  let editing = null;
  const host = h('section', { style: 'margin-bottom:32px' });
  const rerender = () => host.replaceChildren(...build().children);
  const editForm = (it) => {
    const d = kind === 'products' ? productDetails(it) : actorDetails(it), nm = h('input', { value: it.name }), ds = h('textarea', {}, it.description || '');
    return h('div', { class: 'body' }, h('label', {}, 'Name'), nm, h('label', {}, 'Description'), ds, d.el,
      h('button', { class: 'primary', style: 'margin-top:10px', onclick: guard(async () => { await api('PUT', `${kind}/${it.id}`, { name: nm.value, description: ds.value, ...d.read() }); toast('Saved'); await refreshLight(); render(); }) }, 'Save'));
  };
  const build = () => h('div', {},
    h('h2', {}, kind === 'actors' ? 'Actors' : 'Products'), importer, form,
    items.length ? h('div', { class: 'grid' }, items.map((it) => h('div', { class: 'card' },
      h('img', { src: `/files/uploads/${it.images[0]}`, alt: it.name }),
      h('div', { class: 'body' }, h('h3', {}, it.name), kind === 'actors' ? h('span', { class: 'tag ' + (it.kind === 'real' ? (it.attestUsed ? 'live' : 'est') : '') }, it.kind === 'real' ? (it.attestUsed ? 'Real person · has used it' : 'Real person') : 'AI character') : null, h('p', {}, it.description || '')),
      editing === it.id ? editForm(it) : null,
      h('div', { class: 'actions' }, h('button', { onclick: () => { editing = editing === it.id ? null : it.id; rerender(); } }, 'Edit details'), h('button', { onclick: guard(async () => {
        if (!confirm(`Delete ${it.name}?`)) return;
        await api('DELETE', `${kind}/${it.id}`); await refreshLight(); render();
      }) }, 'Delete'))))) : h('div', { class: 'empty' }, `No ${kind} yet.`));
  rerender();
  return host;
}

function viewLibrary() {
  return h('div', {}, h('h1', {}, 'Library'), h('p', { class: 'sub' }, 'Your products and actors. Only upload people who have consented to appear in your ads.'),
    librarySection('products', 'Product', 'Use a clean product shot, ideally on a plain background with the label visible.'),
    librarySection('actors', 'Actor', 'Use a clear, well-lit photo of the face and body. Only use people who have consented to being used in ads.'));
}
