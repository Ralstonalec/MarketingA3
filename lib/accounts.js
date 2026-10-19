'use strict';
// "Is this key good?" and "does the provider's idea of my spend match the app's ledger?"
const store = require('./store');
const settings = require('./settings');
const openrouter = require('./openrouter');
const catalog = require('./catalog');
const engines = require('./engines');

const round = (n) => Math.round(n * 1e6) / 1e6;
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);

function remember(provider, result) {
  store.db.keyChecks[provider] = { at: new Date().toISOString(), ...result };
  store.save();
  return store.db.keyChecks[provider];
}

/** Test one key. Never throws for a bad key: the answer is the point. */
async function test(provider) {
  if (!['openrouter', 'higgsfield', 'custom'].includes(provider)) throw Object.assign(new Error('Unknown provider'), { code: 400 });
  if (!settings.getKey(provider)) return remember(provider, { ok: false, detail: 'No key set.' });
  if (provider === 'openrouter') {
    try {
      const a = await openrouter.account();
      const k = a.key || {}, c = a.credits || {};
      const bits = [k.label ? `key "${k.label}"` : 'key accepted', num(k.usage) != null ? `used $${round(num(k.usage))}` : null, k.limit != null ? `limit $${k.limit}` : null,
        num(c.total_credits) != null ? `balance $${round(num(c.total_credits) - (num(c.total_usage) || 0))}` : null].filter(Boolean);
      return remember(provider, { ok: true, detail: bits.join(', ') });
    } catch (e) { return remember(provider, { ok: false, detail: e.message }); }
  }
  if (provider === 'higgsfield') {
    // Higgsfield's docs describe no account endpoint, so use the documented estimate call: it needs a valid key and does not generate anything.
    const probe = catalog.all().find((m) => m.provider === 'higgsfield' && m.estimate && !(m.inputs || []).some((i) => i === 'video' || i === 'audio'));
    if (!probe) return remember(provider, { ok: null, detail: 'Key saved. To test it, import Higgsfield models first (Models → Import from OpenAPI), then test again.' });
    try { const r = await engines.estimatePrice(probe); return remember(provider, { ok: true, detail: `accepted (estimate for ${probe.label}: ${r.detail})` }); }
    catch (e) { return remember(provider, { ok: /40[13]|unauthor|forbidden|key/i.test(e.message) ? false : null, detail: e.message.slice(0, 200) }); }
  }
  return remember(provider, { ok: null, detail: 'Keys for other APIs cannot be tested generically. Use Test on a model.' });
}

/** What each provider key looks like right now, without calling out. */
function status() {
  const pub = settings.publicSettings().keys;
  return Object.fromEntries(Object.keys(pub).map((p) => [p, { ...pub[p], check: store.db.keyChecks[p] || null }]));
}

/**
 * Compare OpenRouter's own usage figure with what this app recorded. They legitimately differ if the same key is used
 * elsewhere, so the drift is shown, not "fixed".
 */
async function reconcile() {
  const a = await openrouter.account();
  const k = a.key || {}, c = a.credits || {};
  const rows = store.db.ledger.filter((r) => /^or:/.test(r.model));
  const sum = (f) => round(rows.filter(f).reduce((n, r) => n + r.usd, 0));
  const providerUsage = num(k.usage) != null ? num(k.usage) : num(c.total_usage);
  const ledgerTotal = sum(() => true);
  return {
    provider: 'openrouter',
    providerUsageUsd: providerUsage, providerSource: num(k.usage) != null ? 'this key' : num(c.total_usage) != null ? 'whole account' : null,
    balanceUsd: num(c.total_credits) != null ? round(num(c.total_credits) - (num(c.total_usage) || 0)) : null, keyLimitUsd: num(k.limit),
    ledgerUsd: ledgerTotal, ledgerActualUsd: sum((r) => r.basis === 'actual'), ledgerEstimatedUsd: sum((r) => r.basis === 'estimate'),
    driftUsd: providerUsage != null ? round(providerUsage - ledgerTotal) : null,
    note: providerUsage == null ? 'OpenRouter did not report a usage figure for this key.' : 'OpenRouter counts every request made with this key, including any made outside this app, so a positive drift is not necessarily an error.',
  };
}

module.exports = { test, status, reconcile };
