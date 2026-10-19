'use strict';
// Deterministic quality gate for model-written ad concepts. A free/weak model WILL sometimes break
// rules, so nothing it writes is trusted: normalise -> check -> (repair via the model) -> autofix.
const { IMAGE_SUFFIX, MOTION_SUFFIX } = require('./presets');

const WORDS_PER_SEC = 2.8;        // comfortable spoken pace; over ~3.6 it will not fit the scene
const words = (s) => (String(s || '').match(/\S+/g) || []).length;
const str = (v, max = 600) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

// Claims an ad must not make unless the advertiser's own product data contains them.
const RISKY = [
  /\bguarantee[ds]?\b/i, /\bclinically (proven|tested)\b/i, /\bdoctor[- ]recommended\b/i, /\bfda[- ]approved\b/i,
  /\b(cure[sd]?|heal[s]?|treat[s]?) (acne|anxiety|depression|cancer|diabetes|arthritis)\b/i, /\bmiracle\b/i, /\brisk[- ]free\b/i,
  /\b#1\b|\bnumber one\b|\bbest in the world\b/i, /\b(thousands|millions) of (customers|people|users|women|men|moms)\b/i,
  /\bas seen on\b/i, /\baward[- ]winning\b/i, /\bbest[- ]?sell(er|ing)\b/i, /\bsold out\b|\blimited stock\b|\bonly \d+ left\b/i,
  /\blose \d+ ?(lbs|pounds|kg)\b/i, /\bget rich\b|\bpassive income\b/i,
];
// An AI character has not used the product. Claiming it did is a fabricated endorsement (FTC endorsement principles:
// an endorsement must reflect the endorser's honest experience). Applies unless a real, consenting person vouches for it.
const FIRST_PERSON = [
  /\bI(?:'ve| have|'m| am)? (?:been )?(?:using|used|tried|try|bought|ordered|tested|loved?|swear by|started|switched to)\b/i,
  /\bmy (?:skin|hair|results?|routine|life|energy|sleep|nails?|face|before|after)\b/i,
  /\b(?:changed|saved|fixed) my\b/i, /\bI(?:'ve| have) never (?:felt|looked|had)\b/i,
];
const PLACEHOLDER = /\[[^\]]{1,40}\]|\{\{|\}\}|<[a-z][^>]*>|\blorem ipsum\b|\bINSERT\b|\bTBD\b/i;
const NUM = /\$?\d[\d,]*(?:\.\d+)?%?/g;

const numbersIn = (t) => new Set((String(t).match(NUM) || []).map((n) => n.replace(/[$,%]/g, '').replace(/,/g, '')));

/** Coerce whatever the model returned into the exact shape we need. Never throws on bad types. */
function normalise(raw, { scenes, sceneSeconds }) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(c.scenes) ? c.scenes : [];
  return {
    title: str(c.title, 90) || 'Untitled concept', angle: str(c.angle, 90), hook: str(c.hook, 200), script: str(c.script, 1200),
    scenes: list.filter((s) => s && typeof s === 'object').map((s) => ({
      seconds: Math.min(15, Math.max(2, Math.round(Number(s.seconds)) || sceneSeconds)),
      imagePrompt: str(s.imagePrompt, 900), motionPrompt: str(s.motionPrompt, 500), voiceover: str(s.voiceover, 400), onScreenText: str(s.onScreenText, 60),
    })),
    caption: str(c.caption, 300), hashtags: (Array.isArray(c.hashtags) ? c.hashtags : []).map((h) => str(h, 40)).filter(Boolean).slice(0, 12).map((h) => (h.startsWith('#') ? h : '#' + h.replace(/\s+/g, ''))),
    cta: str(c.cta, 100),
  };
}

/**
 * ctx: { scenes, allowedText, forbidden: string[], quiet }
 * Returns { hard, soft }. HARD issues are worth another (paid) model attempt; SOFT ones are only flagged.
 */
function check(c, ctx) {
  const hard = [], soft = [];
  const allowed = String(ctx.allowedText || '');
  const allowedNums = numbersIn(allowed);
  if (c.scenes.length !== ctx.scenes) hard.push(`Write exactly ${ctx.scenes} scene(s); you wrote ${c.scenes.length}.`);
  if (!c.hook) hard.push('The "hook" is empty.');
  if (!c.scenes.length) return { hard, soft };
  c.scenes.forEach((s, i) => {
    const n = i + 1;
    if (!s.imagePrompt) hard.push(`Scene ${n} has an empty imagePrompt.`);
    if (!s.motionPrompt) hard.push(`Scene ${n} has an empty motionPrompt.`);
    const vo = words(s.voiceover);
    if (vo > Math.ceil(s.seconds * 3.6)) hard.push(`Scene ${n} voiceover has ${vo} words but only ${s.seconds} seconds; keep it under ${Math.floor(s.seconds * WORDS_PER_SEC)} words.`);
    else if (vo > Math.ceil(s.seconds * WORDS_PER_SEC)) soft.push(`Scene ${n} voiceover is a little long for ${s.seconds}s.`);
    const iw = words(s.imagePrompt);
    if (s.imagePrompt && (iw < 10 || iw > 90)) soft.push(`Scene ${n} image prompt is ${iw} words (aim for 20-60).`);
    if (s.motionPrompt && words(s.motionPrompt) > 45) soft.push(`Scene ${n} motion prompt is long; one camera move plus one action works best.`);
  });
  const spoken = [c.hook, c.script, c.caption, c.cta, ...c.scenes.flatMap((s) => [s.voiceover, s.onScreenText])].join(' \n ');
  const everything = spoken + ' \n ' + c.scenes.map((s) => `${s.imagePrompt} ${s.motionPrompt}`).join(' \n ');
  if (PLACEHOLDER.test(everything)) hard.push('Remove placeholders like [product], <name> or {{...}}; write the real wording.');
  for (const re of RISKY) {
    const m = spoken.match(re);
    if (m && !re.test(allowed)) hard.push(`Remove the claim "${m[0]}": it is not in the product data.`);
  }
  for (const c of ctx.extraClaims || []) { // rules from a loaded, source-checked research pack
    const m = spoken.match(c.re);
    if (m && !(c.unlessProvided && c.re.test(allowed))) (c.severity === 'block' ? hard : soft).push(`Remove "${m[0]}": ${c.reason}.${c.saferAlternative ? ` Try: ${c.saferAlternative}` : ''}`);
  }
  if (!ctx.attested) {
    for (const re of FIRST_PERSON) {
      const m = spoken.match(re);
      if (m) { hard.push(`The presenter is an AI character, so it cannot claim personal use or results ("${m[0]}"). Rewrite as a demo, a recommendation, or a brand message, not a personal experience.`); break; }
    }
  }
  for (const term of ctx.forbidden || []) {
    if (term && new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(spoken)) hard.push(`Do not use the forbidden word "${term}".`);
  }
  const bad = [...new Set((spoken.match(NUM) || []).filter((t) => {
    const core = t.replace(/[$,%]/g, '').replace(/,/g, '');
    if (!/[$%]/.test(t) && /^\d$/.test(core)) return false; // "3 tips", "day 1"
    return !allowedNums.has(core);
  }))];
  if (bad.length) hard.push(`These numbers are not in the product data, so remove or rephrase them: ${bad.join(', ')}.`);
  if (!c.hashtags.length) soft.push('No hashtags.');
  if (words(c.hook) > 14) soft.push(`The hook is ${words(c.hook)} words; shorter hooks stop the scroll better.`);
  if (!ctx.quiet && !c.scenes.some((s) => s.voiceover)) soft.push('No voiceover in any scene.');
  return { hard, soft };
}

const hasTag = (p, t) => p.includes('@' + t);

/** Fixes that never need the model: tags, realism suffixes, disclosure, derived script, tidy text. */
function autofix(c, { disclosure = true, realism = true, extraImage = [], extraMotion = [] } = {}) {
  c.scenes.forEach((s) => {
    if (!hasTag(s.imagePrompt, 'actor') && !hasTag(s.imagePrompt, 'product')) s.imagePrompt = `@actor with @product, ${s.imagePrompt}`;
    if (realism) {
      if (!/no watermark/i.test(s.imagePrompt)) s.imagePrompt = `${s.imagePrompt.replace(/[.\s]+$/, '')}. ${IMAGE_SUFFIX}`;
      if (s.motionPrompt && !/no morphing/i.test(s.motionPrompt)) s.motionPrompt = `${s.motionPrompt.replace(/[.\s]+$/, '')}. ${MOTION_SUFFIX}`;
    }
    // Sourced wording from a research pack about known model failures; appended once, never duplicated.
    for (const x of extraImage) if (x && !s.imagePrompt.includes(x)) s.imagePrompt += `, ${x}`;
    for (const x of extraMotion) if (x && s.motionPrompt && !s.motionPrompt.includes(x)) s.motionPrompt += `, ${x}`;
  });
  // Across the whole concept both references must appear, or the render ignores one of your uploads.
  const first = c.scenes[0];
  if (first) {
    if (!c.scenes.some((s) => hasTag(s.imagePrompt, 'actor'))) first.imagePrompt = `@actor in frame. ${first.imagePrompt}`;
    if (!c.scenes.some((s) => hasTag(s.imagePrompt, 'product'))) first.imagePrompt = `@product clearly visible. ${first.imagePrompt}`;
  }
  if (!c.script) c.script = c.scenes.map((s) => s.voiceover).filter(Boolean).join(' ');
  if (disclosure && !c.hashtags.some((h) => /^#(ad|sponsored)$/i.test(h))) c.hashtags.unshift('#ad');
  return c;
}

module.exports = { normalise, check, autofix, words, numbersIn, WORDS_PER_SEC };
