'use strict';
// "Before you post": the copy to paste plus a checklist. The built-in items are deliberately conservative and
// avoid specifics that change often (exact label wording, thresholds); a loaded research pack adds sourced rules.
const store = require('./store');
const knowledge = require('./knowledge');
const { PLATFORMS } = require('./composer');

function build({ platform, concept, actorId, sponsored = true }) {
  const plat = PLATFORMS[platform] ? platform : 'tiktok';
  const actor = store.db.actors.find((a) => a.id === actorId);
  if (!concept || !Array.isArray(concept.scenes)) throw Object.assign(new Error('No ad to build a post kit from'), { code: 400 });
  const hashtags = (concept.hashtags || []).filter((h) => sponsored || !/^#(ad|sponsored)$/i.test(h));
  if (sponsored && !hashtags.some((h) => /^#(ad|sponsored)$/i.test(h))) hashtags.unshift('#ad');

  const list = [];
  const add = (text, level, source) => list.push({ text, level, ...(source ? { source } : {}) });
  const errs = (concept.warnings || []).filter((w) => w.level === 'error');
  if (errs.length) add(`Fix before posting: ${errs.map((w) => w.text).join(' ')}`, 'fix');
  add('Check every claim against your product facts. If you cannot prove it, cut it.', 'good_practice');
  add('This video uses AI-generated visuals. Turn on the platform\'s AI-generated content label when you post (where it is and what it is called changes often, so check the platform\'s current rules).', 'policy');
  if (!actor || actor.kind !== 'real' || !actor.attestUsed) add('Your presenter is an AI character who has not used the product. Do not present the video as a real customer\'s review or personal experience (FTC endorsement principles, 16 CFR Part 255: an endorsement must reflect an honest, real experience).', 'law');
  else add('Keep the written consent of the person shown, including consent to use their likeness in AI-generated video.', 'good_practice');
  if (sponsored) add('If this is a paid ad, a paid partnership, an affiliate link or gifted product, use the platform\'s paid-partnership / branded-content label and keep a clear disclosure such as #ad visible.', 'law');
  add('Upload the original video file, not a screen recording or a download carrying another app\'s watermark.', 'good_practice');
  add('These videos have no music. If you add music, use the platform\'s licensed library for business accounts.', 'policy');
  if (plat === 'tiktok_shop') add('Confirm your product category is allowed on TikTok Shop, and tag the product to the video.', 'policy');
  for (const r of knowledge.checklistRules(plat)) add(r.text, r.level, r.source);

  const lines = [`# Post kit: ${concept.title || 'Ad'} (${PLATFORMS[plat]})`, '', '## Caption', concept.caption || '', '', '## Hashtags', hashtags.join(' '), '',
    '## On-screen text', ...concept.scenes.map((s, i) => `Scene ${i + 1}: ${s.onScreenText || '(none)'}`), '', '## Call to action', concept.cta || '', '', '## Script', concept.script || '', '',
    '## Before you post', ...list.map((c) => `- [ ] ${c.text}${c.source ? ` (${c.source})` : ''}`)];
  return { platform: plat, caption: concept.caption || '', hashtags, cta: concept.cta || '', checklist: list, text: lines.join('\n') };
}

module.exports = { build };
