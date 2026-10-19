'use strict';
const store = require('./store');

/** Env vars win over the Settings page, so deployments can keep keys out of data/. */
function getKey(name) {
  const env = { runway: process.env.RUNWAY_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY }[name];
  return env || store.db.settings.keys[name] || '';
}

function mask(k) {
  if (!k) return '';
  return k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`;
}

function publicSettings() {
  const s = store.db.settings;
  return {
    provider: s.provider,
    anthropicModel: s.anthropicModel,
    pricing: s.pricing,
    keys: {
      runway: { set: !!getKey('runway'), preview: mask(getKey('runway')), fromEnv: !!process.env.RUNWAY_API_KEY },
      anthropic: { set: !!getKey('anthropic'), preview: mask(getKey('anthropic')), fromEnv: !!process.env.ANTHROPIC_API_KEY },
    },
  };
}

function update(patch) {
  const s = store.db.settings;
  if (patch.provider) {
    if (!['mock', 'runway'].includes(patch.provider)) throw new Error('Unknown provider');
    s.provider = patch.provider;
  }
  if (typeof patch.anthropicModel === 'string' && patch.anthropicModel.trim()) s.anthropicModel = patch.anthropicModel.trim();
  for (const k of ['runway', 'anthropic']) {
    // Empty string means "leave unchanged"; send null to clear.
    const v = patch.keys && patch.keys[k];
    if (typeof v === 'string' && v.trim()) s.keys[k] = v.trim();
    if (v === null) s.keys[k] = '';
  }
  if (patch.pricing) {
    for (const k of Object.keys(s.pricing)) {
      const n = Number(patch.pricing[k]);
      if (Number.isFinite(n) && n >= 0) s.pricing[k] = n;
    }
  }
  store.save();
  return publicSettings();
}

module.exports = { getKey, publicSettings, update };
