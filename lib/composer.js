'use strict';
// Ad Composer: an OpenRouter text model turns product + actor + brief into ready-to-render
// ad concepts (hook, script, per-scene image/motion prompts, caption, hashtags).
const store = require('./store');
const openrouter = require('./openrouter');
const catalog = require('./catalog');
const ledger = require('./ledger');

const FORMATS = {
  ugc: { label: 'UGC testimonial', look: 'handheld smartphone selfie style, natural light, casual authentic home setting', move: 'subtle handheld camera movement, the person smiles and gestures toward the product' },
  showcase: { label: 'Product showcase', look: 'clean studio, soft key light, shallow depth of field, premium commercial look', move: 'slow cinematic push-in, the person presents the product to camera' },
  lifestyle: { label: 'Lifestyle', look: 'bright candid lifestyle photography in a real-world setting, golden hour light', move: 'gentle camera drift, the person uses the product naturally' },
  luxury: { label: 'Luxury / cinematic', look: 'moody cinematic lighting, rich contrast, high-end campaign look', move: 'slow dolly with elegant movement, dramatic lighting shifts' },
};
const PLATFORMS = { tiktok: 'TikTok (vertical, hook in first 2 seconds)', reels: 'Instagram Reels', shorts: 'YouTube Shorts', meta: 'Meta feed ad', youtube: 'YouTube pre-roll' };

const PLATFORM_RATIO = { tiktok: '9:16', reels: '9:16', shorts: '9:16', meta: '1:1', youtube: '16:9' };

const tag = (s) => (s.includes('@actor') && s.includes('@product') ? s : `@actor with @product. ${s}`);

function template({ product, actor, brief, format, scenes, sceneSeconds }) {
  const f = FORMATS[format] || FORMATS.ugc;
  const extra = brief ? `, ${brief}` : '';
  return {
    title: `${product.name} — ${f.label}`,
    hook: `Stop scrolling: ${product.name}.`,
    angle: f.label,
    script: `${actor.name} here. I've been using ${product.name} and I'm honestly obsessed. ${product.description || ''}`.trim(),
    scenes: Array.from({ length: scenes }, (_, i) => ({
      seconds: sceneSeconds,
      imagePrompt: tag(`@actor holding @product, ${f.look}${extra}. Photorealistic, product label clearly visible.${scenes > 1 ? ` Scene ${i + 1} of ${scenes}.` : ''}`),
      motionPrompt: `${f.move}. Natural, realistic motion.`,
      voiceover: i === 0 ? `I've been using ${product.name} and I'm obsessed.` : 'Try it for yourself.',
    })),
    caption: `${product.name} — you need this.`, hashtags: ['#ad'], cta: 'Shop now',
  };
}

/** First balanced {...} in text; tolerates code fences and chatter around the JSON. */
function extractJson(text) {
  const s = text.replace(/```(?:json)?/g, '');
  const start = s.indexOf('{');
  if (start < 0) throw new Error('The model did not return JSON. Try a stronger model.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) return JSON.parse(s.slice(start, i + 1));
  }
  throw new Error('The model returned incomplete JSON (output was cut off). Try fewer variants or a larger model.');
}

function normaliseConcept(c, { sceneSeconds }) {
  const scenes = (Array.isArray(c.scenes) ? c.scenes : []).filter((s) => s && s.imagePrompt).map((s) => ({
    seconds: Math.min(15, Math.max(2, Number(s.seconds) || sceneSeconds)),
    imagePrompt: tag(String(s.imagePrompt)), motionPrompt: String(s.motionPrompt || ''), voiceover: String(s.voiceover || ''),
  }));
  if (!scenes.length) throw new Error('A concept came back without usable scenes. Try again.');
  return {
    title: String(c.title || 'Untitled concept'), hook: String(c.hook || ''), angle: String(c.angle || ''), script: String(c.script || ''),
    scenes, caption: String(c.caption || ''), hashtags: (Array.isArray(c.hashtags) ? c.hashtags : []).map(String).slice(0, 12), cta: String(c.cta || ''),
  };
}

async function compose(input) {
  const product = store.db.products.find((p) => p.id === input.productId);
  const actor = store.db.actors.find((a) => a.id === input.actorId);
  if (!product || !actor) throw Object.assign(new Error('Pick a product and an actor'), { code: 400 });
  const variants = Math.min(4, Math.max(1, Number(input.variants) || 1));
  const scenes = Math.min(5, Math.max(1, Number(input.scenes) || 1));
  const sceneSeconds = Math.min(15, Math.max(2, Number(input.sceneSeconds) || 5));
  const ctx = { product, actor, brief: String(input.brief || '').slice(0, 1500), format: input.format, scenes, sceneSeconds };

  if (!input.textModel) { // free template path
    return { source: 'template', usd: 0, concepts: Array.from({ length: variants }, () => template(ctx)) };
  }
  const model = catalog.get(input.textModel);
  if (model.kind !== 'text') throw Object.assign(new Error(`${model.label} is not a text model`), { code: 400 });
  const estimate = catalog.cost(model);
  if (estimate == null) throw Object.assign(new Error(`${model.label} has no price yet. Set one in Models so your spend is known.`), { code: 400 });
  ledger.assertBudget(estimate);

  const f = FORMATS[input.format] || FORMATS.ugc;
  const system = 'You are a senior direct-response creative director who writes short-form video ad concepts for AI video tools. Reply with a single JSON object and nothing else.';
  const user = `Create ${variants} distinct ad concept(s).

Product: ${product.name} — ${product.description || 'no description'}
Presenter: ${actor.name} — ${actor.description || 'no description'}
Platform: ${PLATFORMS[input.platform] || PLATFORMS.tiktok}
Visual style: ${f.label} (${f.look})
Tone: ${String(input.tone || 'energetic, authentic').slice(0, 120)}
Call to action: ${String(input.cta || 'Shop now').slice(0, 120)}
Advertiser brief: ${ctx.brief || '(none)'}
Each concept has exactly ${scenes} scene(s) of about ${sceneSeconds} seconds.

Return JSON: {"concepts":[{"title":str,"angle":str (the persuasion angle),"hook":str (first line, under 12 words),"script":str (full spoken script),"scenes":[{"seconds":number,"imagePrompt":str,"motionPrompt":str,"voiceover":str}],"caption":str,"hashtags":[str],"cta":str}]}
Rules: in every imagePrompt refer to the presenter as @actor and the product as @product (literally those tags), describe one concrete still frame in under 60 words, and keep the product label visible. motionPrompt describes the movement over the scene in under 30 words. Do not invent claims, prices or statistics that are not in the brief.`;

  const r = await openrouter.chat({ model: model.orId, json: true, maxTokens: 800 + variants * scenes * 450,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
  // The call has been paid for whether or not the reply parses, so record it first.
  const usd = r.usd != null ? r.usd : estimate;
  ledger.record({ kind: 'text', model: model.id, usd, basis: r.usd != null ? 'actual' : 'estimate', note: 'ad composer' });
  const parsed = extractJson(r.text);
  const raw = Array.isArray(parsed.concepts) ? parsed.concepts : parsed.title ? [parsed] : [];
  if (!raw.length) throw new Error('The model returned no concepts. Try again or pick another model.');
  return { source: model.label, usd, basis: r.usd != null ? 'actual' : 'estimate', concepts: raw.slice(0, variants).map((c) => normaliseConcept(c, ctx)) };
}

module.exports = { compose, template, extractJson, FORMATS, PLATFORMS, PLATFORM_RATIO };
