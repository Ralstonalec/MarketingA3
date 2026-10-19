'use strict';
// Ad Composer. A text model (any OpenRouter model, including free ones) writes ad concepts.
// Because weak models break rules, nothing it returns is trusted:
//   one focused call per version (own framework + hook) -> normalise -> check -> repair by asking the
//   model to fix named problems (max 2, budget permitting) -> deterministic autofix -> optional polish.
const store = require('./store');
const openrouter = require('./openrouter');
const catalog = require('./catalog');
const ledger = require('./ledger');
const frameworks = require('./frameworks');
const presets = require('./presets');
const prompts = require('./prompts');
const adcheck = require('./adcheck');
const knowledge = require('./knowledge');

const MAX_REPAIRS = 2;
const formats = () => Object.fromEntries(Object.entries(frameworks.frameworksNow()).map(([k, v]) => [k, v.label]));
const PLATFORMS = { tiktok: 'TikTok', tiktok_shop: 'TikTok Shop (product video)', reels: 'Instagram / Facebook Reels', shorts: 'YouTube Shorts', meta: 'Meta feed ad', youtube: 'YouTube pre-roll' };
const PLATFORM_RATIO = { tiktok: '9:16', tiktok_shop: '9:16', reels: '9:16', shorts: '9:16', meta: '1:1', youtube: '16:9' };

const clamp = (n, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(n)) || d));
const splitList = (v) => (Array.isArray(v) ? v : String(v || '').split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean);

/** Everything the prompts and checks need, from the stored product/actor/brand. */
function context(input) {
  const product = store.db.products.find((p) => p.id === input.productId);
  const actor = store.db.actors.find((a) => a.id === input.actorId);
  if (!product || !actor) throw Object.assign(new Error('Pick a product and an actor'), { code: 400 });
  const brand = store.db.settings.brand;
  const scenes = clamp(input.scenes, 1, 5, 1), sceneSeconds = clamp(input.sceneSeconds, 2, 15, 5);
  const forbidden = [...splitList(brand.forbidden), ...splitList(product.forbidden)];
  const allowedText = [input.brief, product.name, product.description, ...(product.facts || []), product.audience, product.offer, product.price, brand.name].filter(Boolean).join(' \n ');
  const platform = PLATFORMS[input.platform] ? input.platform : 'tiktok';
  return {
    product, actor, brand: { ...brand, forbidden }, scenes, knowledge: knowledge.forPrompt(platform), extraClaims: knowledge.claimPatterns(platform), sceneSeconds,
    variants: clamp(input.variants, 1, 4, 1), platform,
    tone: String(input.tone || '').slice(0, 120), cta: String(input.cta || '').slice(0, 120), brief: String(input.brief || '').slice(0, 1500),
    camera: input.camera && presets.CAMERA[input.camera] ? input.camera : null, look: input.look && presets.LOOK[input.look] ? input.look : null,
    allowedText, forbidden, polish: !!input.polish, framework: input.framework || input.format,
    attested: actor.kind === 'real' && actor.attestUsed === true, // only a real, consenting person who used it may speak in first person
  };
}

const fixOpts = (ctx) => ({ disclosure: ctx.brand.disclosure !== false, realism: ctx.brand.realismBoost !== false, extraImage: (ctx.knowledge || {}).extraImage || [], extraMotion: (ctx.knowledge || {}).extraMotion || [] });

// ---- free template path (no model) ------------------------------------------------
function template(ctx, pair) {
  const f = frameworks.frameworksNow()[pair.id];
  const look = presets.LOOK[ctx.look || f.look].prompt;
  const beats = frameworks.mapBeats(f.beats, ctx.scenes);
  const name = ctx.product.name;
  const c = {
    title: `${name}: ${f.label}`, angle: f.label, hook: `Let me show you ${name}.`,
    scenes: beats.map((b, i) => ({
      seconds: ctx.sceneSeconds,
      imagePrompt: `@actor holding @product, ${look}. ${ctx.brief ? ctx.brief + '. ' : ''}Moment: ${b.split(':')[0].toLowerCase()}.`,
      motionPrompt: `${presets.CAMERA[ctx.camera || (i % 2 ? 'handheld' : 'dolly_in')].prompt}, the person smiles and shows the product to camera.`,
      voiceover: i === 0 ? `Let me show you ${name}.` : ctx.product.description ? ctx.product.description.split(/(?<=[.!?])\s/)[0] : '', onScreenText: '',
    })),
    caption: `${name}`, hashtags: [], cta: ctx.cta || 'Shop now',
  };
  return adcheck.autofix(adcheck.normalise(c, ctx), fixOpts(ctx));
}

// ---- model path -----------------------------------------------------------------------
/** First balanced {...} in text; tolerates code fences and chatter around the JSON. */
function extractJson(text) {
  const s = String(text).replace(/```(?:json)?/g, '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('The model did not return JSON.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('The model returned incomplete JSON (cut off).');
}

function parseConcept(text, ctx) {
  const j = extractJson(text);
  const raw = Array.isArray(j.concepts) ? j.concepts[0] : j; // some models wrap the object anyway
  return adcheck.normalise(raw, ctx);
}

async function writeOne(model, ctx, pair, i, tally) {
  const unit = catalog.cost(model);
  const messages = [{ role: 'system', content: prompts.SYSTEM }, { role: 'user', content: prompts.writer({ ...ctx, framework: pair }) }];
  const maxTokens = 700 + ctx.scenes * 380;
  const spend = async (kind) => {
    const r = await openrouter.chat({ model: model.orId, json: true, maxTokens, temperature: kind === 'polish' ? 0.5 : 0.85, messages });
    const usd = r.usd != null ? r.usd : unit;
    ledger.record({ kind: 'text', model: model.id, usd, basis: r.usd != null ? 'actual' : 'estimate', note: `ad composer v${i + 1}${kind === 'polish' ? ' polish' : ''}`, purpose: 'compose' });
    tally.usd += usd; tally.calls++; if (r.usd == null) tally.estimated = true;
    return r.text;
  };
  const checkCtx = { ...ctx, quiet: frameworks.frameworksNow()[pair.id].quiet };
  let concept = null, hard = [], soft = [], attempts = 0;
  for (let n = 0; n <= MAX_REPAIRS; n++) {
    attempts++;
    const text = await spend('write');
    try { concept = parseConcept(text, ctx); ({ hard, soft } = adcheck.check(concept, checkCtx)); }
    catch (e) { concept = null; hard = [`${e.message} Reply with ONLY one valid JSON object.`]; soft = []; }
    if (!hard.length) break;
    if (n === MAX_REPAIRS) break;
    try { ledger.assertBudget(unit); } catch { break; } // never retry past the budget cap
    messages.push({ role: 'assistant', content: text }, { role: 'user', content: prompts.repair(hard) });
  }
  if (!concept || !concept.scenes.length) throw new Error(`Version ${i + 1}: the model could not produce a usable ad after ${attempts} attempt(s): ${hard[0] || 'no output'}`);

  if (ctx.polish && !hard.length) {
    try {
      ledger.assertBudget(unit);
      messages.push({ role: 'assistant', content: JSON.stringify(concept) }, { role: 'user', content: prompts.polish(concept, ctx) });
      const better = parseConcept(await spend('polish'), ctx);
      const re = adcheck.check(better, checkCtx);
      if (!re.hard.length) { concept = better; soft = re.soft; } else soft.push('Polish pass was discarded because it broke a rule.');
    } catch { soft.push('Polish pass skipped.'); }
  }
  adcheck.autofix(concept, fixOpts(ctx));
  concept.framework = pair.id; concept.hookFormula = pair.hook; concept.attempts = attempts;
  concept.warnings = [...hard.map((text) => ({ level: 'error', text })), ...soft.map((text) => ({ level: 'note', text }))];
  return concept;
}

async function compose(input) {
  const ctx = context(input);
  const pairs = frameworks.pick(ctx.variants, { offer: ctx.product.offer, hasFacts: (ctx.product.facts || []).length > 0, platform: ctx.platform }, ctx.framework);

  if (!input.textModel) {
    const concepts = pairs.map((p) => Object.assign(template(ctx, p), { framework: p.id, hookFormula: p.hook, attempts: 0, warnings: [] }));
    return { source: 'template', usd: 0, basis: 'actual', concepts };
  }
  const model = catalog.get(input.textModel);
  if (model.kind !== 'text') throw Object.assign(new Error(`${model.label} is not a text model`), { code: 400 });
  const unit = catalog.cost(model);
  if (unit == null) throw Object.assign(new Error(`${model.label} has no price yet. Set one in Models so your spend is known.`), { code: 400 });
  ledger.assertBudget(unit * ctx.variants * (ctx.polish ? 2 : 1));

  const tally = { usd: 0, calls: 0, estimated: false };
  const results = await Promise.allSettled(pairs.map((p, i) => writeOne(model, ctx, p, i, tally)));
  const concepts = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!concepts.length) throw new Error(results[0].reason.message);
  const failed = results.length - concepts.length;
  return { source: model.label, usd: tally.usd, basis: tally.estimated ? 'estimate' : 'actual', calls: tally.calls, concepts, failed };
}

/** Alternative openings for one concept. One cheap call; only hooks that pass the same checks are returned. */
async function hookVariants(input) {
  const ctx = { ...context({ ...input, scenes: 1 }), scenes: 1 };
  const concept = input.concept;
  if (!concept || !Array.isArray(concept.scenes) || !concept.scenes[0]) throw Object.assign(new Error('Pick a concept first'), { code: 400 });
  if (!input.textModel) throw Object.assign(new Error('Pick a writing model to generate hooks'), { code: 400 });
  const count = clamp(input.count, 2, 5, 3);
  const model = catalog.get(input.textModel);
  const unit = catalog.cost(model, { purpose: 'hooks' });
  if (model.kind !== 'text') throw Object.assign(new Error(`${model.label} is not a text model`), { code: 400 });
  if (unit == null) throw Object.assign(new Error(`${model.label} has no price yet. Set one in Models so your spend is known.`), { code: 400 });
  ledger.assertBudget(unit);

  const hookText = frameworks.hooksNow();
  const ok = Object.keys(hookText).filter((id) => !(['proof'].includes(id) && !(ctx.product.facts || []).length) && !(id === 'offer' && !ctx.product.offer));
  const approaches = Array.from({ length: count }, (_, i) => ok[(i + Math.floor(Math.random() * ok.length)) % ok.length]);
  const unique = [...new Set(approaches)];
  while (unique.length < count && unique.length < ok.length) unique.push(ok.find((id) => !unique.includes(id)));
  const messages = [{ role: 'system', content: prompts.SYSTEM }, { role: 'user', content: prompts.hooks(concept, ctx, unique.slice(0, count)) }];
  const first = concept.scenes[0];
  const seconds = first.seconds || ctx.sceneSeconds;
  let usd = 0, estimated = false, good = [], issues = [];
  for (let attempt = 0; attempt < 2 && !good.length; attempt++) {
    const r = await openrouter.chat({ model: model.orId, json: true, maxTokens: 300 + count * 220, temperature: 0.9, messages });
    const cost = r.usd != null ? r.usd : unit; usd += cost; if (r.usd == null) estimated = true;
    ledger.record({ kind: 'text', model: model.id, usd: cost, basis: r.usd != null ? 'actual' : 'estimate', note: 'hook variants', purpose: 'hooks' });
    let raw = [];
    try { const j = extractJson(r.text); raw = Array.isArray(j.hooks) ? j.hooks : []; } catch (e) { issues = [e.message]; }
    const seen = new Set([String(concept.hook).toLowerCase()]);
    const found = [];
    for (const h of raw) {
      const c = adcheck.normalise({ title: 'hook', hook: h.hook, scenes: [{ seconds, imagePrompt: h.imagePrompt, motionPrompt: first.motionPrompt || 'subtle camera movement', voiceover: h.voiceover, onScreenText: h.onScreenText }] }, ctx);
      const { hard, soft } = adcheck.check(c, { ...ctx, quiet: true });
      const key = String(c.hook).toLowerCase();
      if (hard.length) { issues.push(...hard); continue; }
      if (!c.hook || seen.has(key)) continue;
      seen.add(key);
      adcheck.autofix(c, fixOpts(ctx));
      found.push({ approach: String(h.approach || '').slice(0, 40), hook: c.hook, voiceover: c.scenes[0].voiceover, onScreenText: c.scenes[0].onScreenText, imagePrompt: c.scenes[0].imagePrompt, notes: soft });
    }
    good = found.slice(0, count);
    if (!good.length && attempt === 0) { try { ledger.assertBudget(unit); } catch { break; } messages.push({ role: 'assistant', content: r.text }, { role: 'user', content: prompts.repair(issues.length ? [...new Set(issues)] : ['No usable hooks were returned.']) }); }
  }
  if (!good.length) throw Object.assign(new Error(`The model could not produce usable hooks: ${issues[0] || 'no output'}`), { code: 400 });
  return { hooks: good, usd, basis: estimated ? 'estimate' : 'actual', source: model.label };
}

module.exports = { compose, hookVariants, template, extractJson, formats, PLATFORMS, PLATFORM_RATIO, context };
