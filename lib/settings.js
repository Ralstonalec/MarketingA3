'use strict';
const store = require('./store');

const ENV = { openrouter: 'OPENROUTER_API_KEY', higgsfield: 'HIGGSFIELD_KEY', custom: 'CUSTOM_API_KEY' };
const LABELS = { openrouter: 'OpenRouter', higgsfield: 'Higgsfield', custom: 'Other HTTP APIs' };

/** Env vars win over the Settings page, so deployments can keep keys out of data/. */
function getKey(name) { return process.env[ENV[name]] || store.db.settings.keys[name] || ''; }

function mask(k) {
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

function publicSettings() {
  const s = store.db.settings;
  return {
    defaults: s.defaults,
    budget: s.budget,
    assumptions: s.assumptions,
    keys: Object.fromEntries(Object.keys(ENV).map((k) => [k, { label: LABELS[k], set: !!getKey(k), preview: mask(getKey(k)), fromEnv: !!process.env[ENV[k]] }])),
  };
}

function num(v, { min = 0, max = Infinity, label }) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw Object.assign(new Error(`${label} must be a number between ${min} and ${max}`), { code: 400 });
  return n;
}

function update(patch) {
  const s = store.db.settings;
  for (const k of Object.keys(ENV)) {
    // Empty string means "leave unchanged"; null clears.
    const v = patch.keys && patch.keys[k];
    if (typeof v === 'string' && v.trim()) s.keys[k] = v.trim();
    if (v === null) s.keys[k] = '';
  }
  if (patch.defaults) for (const k of ['text', 'image', 'video']) if (typeof patch.defaults[k] === 'string') s.defaults[k] = patch.defaults[k];
  if (patch.budget && 'monthlyUsd' in patch.budget) s.budget.monthlyUsd = num(patch.budget.monthlyUsd, { label: 'Monthly budget' });
  if (patch.assumptions) {
    for (const k of Object.keys(s.assumptions)) if (k in patch.assumptions) s.assumptions[k] = num(patch.assumptions[k], { min: 1, max: 1e6, label: k });
  }
  store.save();
  return publicSettings();
}

module.exports = { getKey, publicSettings, update };
