'use strict';
function spendChart(days) {
  const W = 600, H = 120, max = Math.max(...days.map((d) => d.usd), 0.0001), bw = W / days.length;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 16}`); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Daily spend, last 30 days. Peak ${money(max)}`);
  svg.innerHTML = days.map((d, i) => {
    const bh = Math.max(d.usd > 0 ? 2 : 0, (d.usd / max) * H);
    return `<rect x="${i * bw + 2}" y="${H - bh}" width="${bw - 4}" height="${bh}" rx="2"><title>${d.date}: ${money(d.usd)}</title></rect>`;
  }).join('') + `<text x="0" y="${H + 12}">${days[0].date.slice(5)}</text><text x="${W}" y="${H + 12}" text-anchor="end">${days[days.length - 1].date.slice(5)}</text>`;
  return svg;
}

/** Ask OpenRouter what it thinks you have spent and compare it with this app's ledger. */
function reconcilePanel() {
  const out = h('div', {});
  const row = (label, v, note) => h('tr', {}, h('td', {}, label), h('td', { class: 'num' }, v == null ? '—' : money(v)), h('td', { class: 'small' }, note || ''));
  return h('div', { class: 'panel', style: 'margin-bottom:0' }, h('div', { class: 'row' }, h('div', {}, h('h2', { style: 'margin:0' }, 'Check against OpenRouter'), h('div', { class: 'small' }, 'Compares OpenRouter\'s own usage figure with what this app recorded.')),
    h('button', { class: 'sec fit', onclick: guard(async (e) => {
      e.target.disabled = true; e.target.textContent = 'Asking OpenRouter…';
      try {
        const r = await api('GET', 'accounts/reconcile');
        out.replaceChildren(h('table', {}, h('tbody', {},
          row(`OpenRouter says you used (${r.providerSource || 'n/a'})`, r.providerUsageUsd), row('This app recorded (OpenRouter models)', r.ledgerUsd, `${money(r.ledgerActualUsd)} actual, ${money(r.ledgerEstimatedUsd)} estimated`),
          row('Difference', r.driftUsd, r.driftUsd != null && Math.abs(r.driftUsd) > 0.01 ? (r.driftUsd > 0 ? 'OpenRouter shows more than this app recorded.' : 'This app recorded more than OpenRouter shows.') : 'Matches.'),
          row('Balance left', r.balanceUsd), r.keyLimitUsd != null ? row('Key spending limit', r.keyLimitUsd) : null)), h('p', { class: 'small' }, r.note));
      } catch (err) { out.replaceChildren(h('div', { class: 'warn' }, err.message)); } finally { e.target.disabled = false; e.target.textContent = 'Check now'; }
    }) }, 'Check now')), out);
}

async function viewSpend() {
  const [s, ledger] = await Promise.all([api('GET', 'spend'), api('GET', 'ledger')]);
  state.spend = s; renderSpendPill();
  const cap = s.budget.monthlyUsd;
  const name = (id) => { const m = modelById(id); return m ? m.label : id; };
  return h('div', {},
    h('div', { class: 'row', style: 'margin-bottom:16px' }, h('div', {}, h('h1', {}, 'Spend'), h('p', { class: 'sub', style: 'margin:0' }, 'Every charge this app makes, from the provider\'s reported cost where available, otherwise from the model\'s price.')),
      h('a', { class: 'sec fit', style: 'text-decoration:none;padding:9px 15px;border-radius:9px', href: '/api/ledger.csv', download: 'spend.csv' }, 'Export CSV')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('small', {}, 'Today'), h('b', {}, money(s.today))),
      h('div', { class: 'stat' }, h('small', {}, 'This month'), h('b', {}, money(s.month)), cap > 0 ? h('div', { class: 'bar' + (s.month / cap > 0.85 ? ' hot' : '') }, h('i', { style: `width:${Math.min(100, (s.month / cap) * 100)}%` })) : null),
      h('div', { class: 'stat' }, h('small', {}, cap > 0 ? 'Budget left this month' : 'Monthly budget'), h('b', {}, cap > 0 ? money(s.budget.remaining) : 'No cap'), h('small', {}, cap > 0 ? `of ${money(cap)}` : 'Set one in Settings')),
      h('div', { class: 'stat' }, h('small', {}, 'All time'), h('b', {}, money(s.total)), h('small', {}, `${money(s.estimatedShare)} of it estimated`))),
    reconcilePanel(),
    h('div', { class: 'panel', style: 'margin-top:16px' }, h('h2', {}, 'Last 30 days'), spendChart(s.days)),
    h('div', { class: 'cols', style: 'grid-template-columns:minmax(0,1fr) minmax(0,1fr);margin-top:16px' },
      h('div', { class: 'panel' }, h('h2', {}, 'By model (this month)'), s.byModel.length ? h('table', {}, h('tbody', {}, s.byModel.map((r) => h('tr', {}, h('td', {}, name(r.key)), h('td', { class: 'num' }, money(r.usd)))))) : h('div', { class: 'small' }, 'Nothing spent yet this month.')),
      h('div', { class: 'panel' }, h('h2', {}, 'By type (this month)'), s.byKind.length ? h('table', {}, h('tbody', {}, s.byKind.map((r) => h('tr', {}, h('td', {}, r.key), h('td', { class: 'num' }, money(r.usd)))))) : h('div', { class: 'small' }, '—'))),
    h('div', { class: 'panel', style: 'margin-top:16px;padding:0;overflow:auto' },
      h('div', { style: 'padding:14px 18px 0' }, h('h2', {}, 'Recent charges')),
      ledger.length ? h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, 'When'), h('th', {}, 'What'), h('th', {}, 'Model'), h('th', {}, 'Basis'), h('th', { class: 'num' }, 'Cost'))),
        h('tbody', {}, ledger.slice(0, 100).map((r) => h('tr', {}, h('td', {}, new Date(r.ts).toLocaleString()), h('td', {}, `${r.kind}${r.note ? ' · ' + r.note : ''}`), h('td', {}, name(r.model)),
          h('td', {}, h('span', { class: 'tag ' + (r.basis === 'actual' ? 'live' : 'est') }, r.basis)), h('td', { class: 'num' }, money(r.usd)))))) : h('div', { class: 'empty' }, 'No charges yet.')));
}
