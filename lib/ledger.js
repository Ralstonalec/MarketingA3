'use strict';
// Every dollar the app spends is recorded here, so Spend shows real numbers.
// basis 'actual' = the provider reported the cost; 'estimate' = from the model's configured price.
const store = require('./store');

/** Remember what the provider actually charged, per model and purpose, so later quotes can use real numbers. */
function learn(model, purpose, usd) {
  if (!purpose || !/^or:/.test(model) || !(usd > 0)) return;
  const k = `${model}|${purpose}`, o = store.db.observed[k] || { n: 0, sum: 0 };
  o.n += 1; o.sum += usd; o.last = usd; o.at = new Date().toISOString();
  store.db.observed[k] = o;
}

function record({ kind, model, usd, basis, ref = null, note = '', purpose = null }) {
  if (basis === 'actual') learn(model, purpose, usd);
  const e = { id: store.id('chg'), ts: new Date().toISOString(), kind, model, usd: Math.round(usd * 1e6) / 1e6, basis, ref, note };
  store.db.ledger.push(e);
  store.save();
  return e;
}

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const sum = (rows) => Math.round(rows.reduce((s, r) => s + r.usd, 0) * 1e4) / 1e4;

function summary() {
  const L = store.db.ledger;
  const today = new Date().toISOString().slice(0, 10);
  const month = monthKey();
  const by = (rows, f) => Object.entries(rows.reduce((a, r) => ((a[f(r)] = (a[f(r)] || 0) + r.usd), a), {}))
    .map(([k, v]) => ({ key: k, usd: Math.round(v * 1e4) / 1e4 })).sort((a, b) => b.usd - a.usd);
  const monthRows = L.filter((r) => r.ts.startsWith(month));
  const days = {};
  for (let i = 29; i >= 0; i--) days[new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)] = 0;
  for (const r of L) { const d = r.ts.slice(0, 10); if (d in days) days[d] += r.usd; }
  const cap = store.db.settings.budget.monthlyUsd;
  return {
    today: sum(L.filter((r) => r.ts.startsWith(today))),
    month: sum(monthRows),
    total: sum(L),
    estimatedShare: sum(L.filter((r) => r.basis === 'estimate')),
    budget: { monthlyUsd: cap, remaining: cap > 0 ? Math.max(0, Math.round((cap - sum(monthRows)) * 1e4) / 1e4) : null },
    byModel: by(monthRows, (r) => r.model),
    byKind: by(monthRows, (r) => r.kind),
    days: Object.entries(days).map(([date, usd]) => ({ date, usd: Math.round(usd * 1e4) / 1e4 })),
  };
}

/** Estimated cost of stages in queued/running jobs that haven't been charged yet. */
function pending() {
  let usd = 0;
  for (const j of store.db.jobs) {
    if (j.status !== 'queued' && j.status !== 'running') continue;
    for (const l of (j.estimate && j.estimate.lines) || []) {
      if (l.kind === 'image' || l.kind === 'video') if (!(j[l.kind] && j[l.kind].charged)) usd += l.usd;
    }
  }
  for (const r of store.db.runs) if ((r.status === 'queued' || r.status === 'running') && !r.charged) usd += (r.estimate && r.estimate.usd) || 0;
  return usd;
}

/** Throws if spending `usd` more (on top of spend so far and work already in flight) would pass the monthly cap. */
function assertBudget(usd) {
  const cap = store.db.settings.budget.monthlyUsd;
  if (!(cap > 0)) return;
  const spent = sum(store.db.ledger.filter((r) => r.ts.startsWith(monthKey()))) + pending();
  if (spent + usd > cap + 1e-9) {
    throw Object.assign(new Error(`This would take you to $${(spent + usd).toFixed(2)} this month, over your $${cap.toFixed(2)} budget ($${spent.toFixed(2)} spent or already queued). Raise the budget in Settings to continue.`), { code: 402 });
  }
}

function csv() {
  const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return ['time,kind,model,usd,basis,ref,note', ...store.db.ledger.map((r) => [r.ts, r.kind, r.model, r.usd, r.basis, r.ref, r.note].map(esc).join(','))].join('\n');
}

module.exports = { record, summary, assertBudget, csv };
