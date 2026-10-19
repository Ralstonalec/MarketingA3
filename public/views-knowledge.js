'use strict';
const kui = { text: '', report: null, name: '' };

const SECTION_LABEL = { frameworks: 'Ad structures', hookFormulas: 'Hook formulas', platformRules: 'Platform rules', distributionSignals: 'Distribution signals', suppressors: 'Reach suppressors', claimPatterns: 'Claim checks', cliches: 'Clichés to avoid', aiFailureModes: 'AI failure fixes', disclosureRules: 'Disclosure rules', shopRules: 'Shop rules', categoryNotes: 'Category notes', benchmarks: 'Benchmarks' };

function reportView(r) {
  if (!r) return null;
  const acc = Object.entries(r.accepted || {});
  return h('div', { class: 'panel', style: 'margin-top:16px' }, h('h2', {}, 'Evidence check'),
    r.error ? h('div', { class: 'warn' }, r.error) : null,
    acc.length ? h('div', { class: 'chips', style: 'margin-bottom:10px' }, acc.map(([k, n]) => h('span', { class: 'tag live' }, `${SECTION_LABEL[k] || k}: ${n} accepted`))) : null,
    r.rejected.length ? [h('p', { class: 'small' }, `${r.rejected.length} item(s) rejected. They did not meet the evidence rules and will NOT be used:`),
      h('table', {}, h('tbody', {}, r.rejected.slice(0, 80).map((x) => h('tr', {}, h('td', { class: 'small' }, SECTION_LABEL[x.section] || x.section), h('td', {}, x.id), h('td', { class: 'warn' }, x.reason)))))] : h('p', { class: 'small' }, 'Nothing was rejected.'));
}

function packSummary(k) {
  const p = k.pack;
  const link = (s) => (/^https:\/\//.test(s || '') ? h('a', { href: s, target: '_blank', rel: 'noopener noreferrer', class: 'small' }, 'source') : null);
  const sec = (title, rows) => rows.length ? h('details', { style: 'margin-bottom:8px' }, h('summary', {}, `${title} (${rows.length})`), h('div', { style: 'padding:8px 0 0 12px' }, rows)) : null;
  const line = (text, src, sub) => h('div', { style: 'margin:4px 0' }, text, ' ', link(src), sub ? h('div', { class: 'small' }, sub) : null);
  return h('div', { class: 'panel' },
    h('div', { class: 'row' }, h('div', {}, h('h2', { style: 'margin:0' }, k.meta.name), h('div', { class: 'small' }, `Loaded ${new Date(k.meta.loadedAt).toLocaleString()} · ${k.meta.rejected} item(s) were rejected`)),
      h('button', { class: 'sec fit', onclick: guard(async () => { if (confirm('Remove this research pack? The writer goes back to the built-in defaults.')) { await api('DELETE', 'knowledge'); await loadKnowledge(); render(); } }) }, 'Remove pack')),
    h('div', { style: 'margin-top:12px' },
      sec('Ad structures', (p.frameworks || []).map((f) => line(`${f.label} (${f.beats.map((b) => b.name).join(' → ')})`, f.evidence.source, `${f.evidence.strength}, ${f.evidence.year}${f.platforms ? ' · ' + f.platforms.join(', ') : ''}`))),
      sec('Hook formulas', (p.hookFormulas || []).map((x) => line(`${x.id}: ${x.instruction}`, x.evidence.source, `${x.evidence.strength}, ${x.evidence.year}`))),
      sec('Platform rules', Object.entries(p.platformRules || {}).map(([pl, r]) => line(`${pl}${r.idealSeconds ? `: ${r.idealSeconds[0]}-${r.idealSeconds[1]}s` : ''}${r.hookWithinSeconds != null ? `, hook within ${r.hookWithinSeconds}s` : ''}`, r.source, [r.textAdvice, r.soundAdvice, r.styleAdvice, r.ctaAdvice, r.safeZone].filter(Boolean).join(' · ')))),
      sec('Claim checks', (p.claimPatterns || []).map((c) => line(`${c.severity === 'block' ? 'BLOCK' : 'warn'} /${c.regex}/ (${c.appliesTo}): ${c.reason}`, c.source, c.saferAlternative ? 'Try: ' + c.saferAlternative : ''))),
      sec('Disclosure rules', (p.disclosureRules || []).map((r) => line(`[${r.binding}] ${r.platform}: ${r.action} (${r.applies})`, r.source, String(r.year)))),
      sec('Shop rules', (p.shopRules || []).map((r) => line(`${r.platform}: ${r.rule}`, r.source, r.enforce))),
      sec('Reach suppressors', (p.suppressors || []).map((x) => line(`${x.platform}: ${x.behaviour} → ${x.avoid}`, x.source))),
      sec('Distribution signals', (p.distributionSignals || []).map((x) => line(`${x.platform}: ${x.signal} → ${x.advice}`, x.source))),
      sec('AI failure fixes', (p.aiFailureModes || []).map((m) => line(`${m.label || m.id}: ${m.promptAvoid || ''}${m.motionAvoid ? ' / ' + m.motionAvoid : ''}`, null, m.recognise))),
      sec('Clichés to avoid', [h('div', { class: 'small' }, (p.cliches || []).map((c) => c.phrase).join(' · '))]),
      sec('Benchmarks', (p.benchmarks || []).map((b) => line(`${b.platform ? b.platform + ': ' : ''}${b.metric} = ${b.value} (${b.context})`, b.source, `${b.strength}, ${b.year}`)))));
}

let knowledgeState = { loaded: false };
async function loadKnowledge() { knowledgeState = await api('GET', 'knowledge'); }

async function viewKnowledge() {
  await loadKnowledge();
  const ta = h('textarea', { style: 'min-height:180px;font-family:monospace;font-size:12px', spellcheck: 'false', placeholder: 'Paste the contents of ad-knowledge.json here, or choose the file below', oninput: (e) => (kui.text = e.target.value) }, kui.text);
  const file = h('input', { type: 'file', accept: '.json,application/json', onchange: guard(async (e) => { const f = e.target.files[0]; if (f) { kui.text = await f.text(); kui.name = f.name; ta.value = kui.text; } }) });
  const parse = () => { try { return JSON.parse(kui.text); } catch (e) { throw new Error('That is not valid JSON: ' + e.message); } };
  const out = h('div', {});
  const show = () => out.replaceChildren(...[reportView(kui.report)].filter(Boolean));
  show();
  return h('div', {}, h('h1', {}, 'Knowledge'), h('p', { class: 'sub' }, 'Load a research pack (platform rules, hook formulas, claim checks, disclosure and shop rules). Nothing is used unless it has a real source: items with no link, an internal or unpublished source, a bad year, or a broken pattern are rejected and listed here.'),
    knowledgeState.loaded ? packSummary(knowledgeState) : h('div', { class: 'panel' }, h('b', {}, 'No research pack loaded. '), 'The writer is using its built-in conservative defaults. They never claim facts you did not provide, and never let an AI presenter claim personal use.'),
    h('div', { class: 'panel', style: 'margin-top:16px' }, h('h2', {}, knowledgeState.loaded ? 'Replace the pack' : 'Load a pack'), ta, h('div', { style: 'margin-top:8px' }, file),
      h('div', { class: 'row', style: 'margin-top:12px' },
        h('button', { class: 'sec', onclick: guard(async () => { kui.report = await api('POST', 'knowledge/validate', { pack: parse() }); show(); }) }, 'Check only'),
        h('button', { class: 'primary', onclick: guard(async () => {
          const pack = parse();
          try { const r = await api('POST', 'knowledge', { pack, name: kui.name || 'Research pack' }); kui.report = r.report; toast(`Loaded ${Object.values(r.report.accepted).reduce((a, b) => a + b, 0)} rules`); await loadKnowledge(); render(); }
          catch (e) { kui.report = await api('POST', 'knowledge/validate', { pack }); show(); throw e; }
        }) }, 'Check and load'))),
    out);
}
