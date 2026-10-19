'use strict';
// Keeps the model lists and prices matching what the providers say today. Runs on demand and in the background.
const store = require('./store');
const settings = require('./settings');
const openrouter = require('./openrouter');
const catalog = require('./catalog');
const engines = require('./engines');
const openapi = require('./openapi');
const { safeGet } = require('./safefetch');

const HOUR = 3600 * 1000;
const bad = (m) => Object.assign(new Error(m), { code: 400 });
const log = (provider, entry) => {
  const prev = store.db.syncLog[provider] || {};
  store.db.syncLog[provider] = { ...prev, at: new Date().toISOString(), ...entry, ...(entry.ok ? { okAt: new Date().toISOString() } : {}) };
  store.save();
};
const pushChanges = (list) => { if (list.length) { store.db.priceChanges = [...list, ...store.db.priceChanges].slice(0, 200); store.save(); } };

async function syncOpenRouter() {
  try {
    const r = await openrouter.refreshModels();
    const out = { models: r.models.length, changes: r.changes.length, added: r.added, removed: r.removed };
    log('openrouter', { ok: true, summary: `${out.models} models, ${out.changes} price change(s), ${out.added} new, ${out.removed} removed`, error: undefined });
    return out;
  } catch (e) { log('openrouter', { ok: false, error: e.message }); throw e; }
}

/** Ask the provider for fresh exact prices for every model that has an estimate endpoint and no hand-typed price. */
async function reprice(limit = 40) {
  const out = { priced: 0, failed: 0, changed: 0, firstError: null };
  if (!settings.getKey('higgsfield')) return { ...out, skipped: 'no Higgsfield key' };
  const targets = catalog.all().filter((m) => m.estimate && !m.missing && (!m.priced || m.price.basis === 'provider-estimate')).slice(0, limit);
  const changes = [];
  for (const m of targets) {
    try {
      const prev = m.priced ? m.price : null;
      const r = await engines.estimatePrice(m);
      catalog.setProviderPrice(m.id, r.price);
      out.priced++;
      if (prev && prev.unit === r.price.unit && Math.abs(r.price.usd - prev.usd) > Math.max(1e-9, prev.usd * 0.005)) {
        out.changed++;
        changes.push({ id: m.id, label: m.label, field: `price per ${r.price.unit}`, from: prev.usd, to: r.price.usd, pct: prev.usd ? Math.round(((r.price.usd - prev.usd) / prev.usd) * 1000) / 10 : null, at: new Date().toISOString() });
      }
    } catch (e) { out.failed++; out.firstError = out.firstError || `${m.label}: ${e.message}`; }
  }
  pushChanges(changes);
  return out;
}

/** Re-read the Higgsfield OpenAPI spec: add new endpoints, update changed ones, flag ones the provider removed. */
async function syncHiggsfield(urlOverride, { doReprice = true } = {}) {
  const url = urlOverride || store.db.settings.sync.higgsfieldSpecUrl;
  if (!url) throw bad('No Higgsfield spec address saved yet. Import from OpenAPI once and it is remembered.');
  try {
    const res = await safeGet(url, { maxBytes: 12 * 1024 * 1024, timeoutMs: 20000, accept: 'application/json,*/*' });
    let spec; try { spec = JSON.parse(res.body.toString('utf8')); } catch { throw bad('That address did not return JSON.'); }
    const { drafts } = openapi.fromSpec(spec, { provider: 'higgsfield' });
    const mine = store.db.models.filter((m) => m.source && m.source.type === 'openapi' && m.source.url === url);
    const byPath = new Map(mine.map((m) => [m.source.path, m]));
    const out = { added: 0, updated: 0, missing: 0, restored: 0 };
    for (const d of drafts) {
      const m = byPath.get(d.path);
      if (!m) {
        catalog.addModel({ provider: 'higgsfield', kind: d.kind, label: d.label, price: null, inputs: d.inputs, http: d.http, estimate: d.estimate, limits: d.limits, notes: d.attention, source: { type: 'openapi', url, path: d.path } });
        out.added++; continue;
      }
      const sig = () => JSON.stringify([m.http, m.inputs, m.limits, m.estimate]);
      const before = sig();
      Object.assign(m, { http: d.http, inputs: d.inputs, limits: d.limits, estimate: d.estimate, notes: d.attention.slice(0, 10) }); // your label, type and price are kept
      if (m.missing) { m.missing = false; out.restored++; }
      if (sig() !== before) out.updated++;
    }
    const live = new Set(drafts.map((d) => d.path));
    for (const m of mine) if (!live.has(m.source.path) && !m.missing) { m.missing = true; out.missing++; }
    store.db.settings.sync.higgsfieldSpecUrl = url;
    store.save();
    const prices = doReprice ? await reprice() : null;
    log('higgsfield', { ok: true, summary: `${drafts.length} endpoints: ${out.added} new, ${out.updated} changed, ${out.missing} removed${prices ? `, ${prices.priced} priced` : ''}`, error: undefined });
    return { ...out, endpoints: drafts.length, prices };
  } catch (e) { log('higgsfield', { ok: false, error: e.message }); throw e; }
}

/** Background pass: only does work that is due (older than the configured number of hours) and possible (key / address saved). */
async function runDue({ force = false, now = Date.now() } = {}) {
  const hours = store.db.settings.sync.autoRefreshHours;
  if (!force && !(hours > 0)) return { skipped: 'auto-refresh is off' };
  const due = (p) => force || !(store.db.syncLog[p] || {}).okAt || now - Date.parse(store.db.syncLog[p].okAt) >= hours * HOUR;
  const out = {};
  if (settings.getKey('openrouter') && due('openrouter')) out.openrouter = await syncOpenRouter().catch((e) => ({ error: e.message }));
  if (settings.getKey('higgsfield') && store.db.settings.sync.higgsfieldSpecUrl && due('higgsfield')) out.higgsfield = await syncHiggsfield().catch((e) => ({ error: e.message }));
  return out;
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => runDue().catch(() => {}), 30 * 60 * 1000);
  timer.unref();
  setTimeout(() => runDue().catch(() => {}), 10 * 1000).unref();
}

module.exports = { syncOpenRouter, syncHiggsfield, reprice, runDue, start };
