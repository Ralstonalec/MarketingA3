'use strict';
function librarySection(kind, noun, hint) {
  const draft = { name: '', description: '', images: [] };
  const thumbs = h('div', { class: 'thumbs' });
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: guard(async (e) => {
    for (const f of [...e.target.files].slice(0, 4 - draft.images.length)) draft.images.push(await fileToDataUrl(f));
    thumbs.replaceChildren(...draft.images.map((u) => h('img', { src: u, alt: '' })));
  }) });
  const name = h('input', { placeholder: `${noun} name` });
  const desc = h('textarea', { placeholder: kind === 'actors' ? 'Look, age, vibe, voice… (helps the composer write for them)' : 'What it is, key benefits, who it is for…' });
  const form = h('div', { class: 'panel', style: 'max-width:520px;margin-bottom:16px' },
    h('label', {}, 'Name'), name, h('label', {}, 'Description'), desc,
    h('label', {}, 'Images (up to 4, first one is used for generation)'),
    h('div', { class: 'dz', role: 'button', tabindex: '0', onclick: () => input.click() }, 'Click to choose images'), input, thumbs,
    h('p', { class: 'small' }, hint),
    h('button', { class: 'primary', onclick: guard(async () => {
      await api('POST', kind, { name: name.value, description: desc.value, images: draft.images });
      toast(`${noun} saved`); await refreshLight(); render();
    }) }, `Save ${noun.toLowerCase()}`));
  const items = state[kind];
  return h('section', { style: 'margin-bottom:32px' },
    h('h2', {}, kind === 'actors' ? 'Actors' : 'Products'), form,
    items.length ? h('div', { class: 'grid' }, items.map((it) => h('div', { class: 'card' },
      h('img', { src: `/files/uploads/${it.images[0]}`, alt: it.name }),
      h('div', { class: 'body' }, h('h3', {}, it.name), h('p', {}, it.description || '')),
      h('div', { class: 'actions' }, h('button', { onclick: guard(async () => {
        if (!confirm(`Delete ${it.name}?`)) return;
        await api('DELETE', `${kind}/${it.id}`); await refreshLight(); render();
      }) }, 'Delete'))))) : h('div', { class: 'empty' }, `No ${kind} yet.`));
}

function viewLibrary() {
  return h('div', {}, h('h1', {}, 'Library'), h('p', { class: 'sub' }, 'Your products and actors. Only upload people who have consented to appear in your ads.'),
    librarySection('products', 'Product', 'Use a clean product shot, ideally on a plain background with the label visible.'),
    librarySection('actors', 'Actor', 'Use a clear, well-lit photo of the face and body. Only use people who have consented to being used in ads.'));
}
