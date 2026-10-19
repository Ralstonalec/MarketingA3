'use strict';
// Turns a brief + product + actor into scene/motion prompts and a voiceover script.
// Uses Claude when an Anthropic key is present; otherwise falls back to a template.
const settings = require('./settings');
const store = require('./store');

const FORMATS = {
  ugc: { label: 'UGC testimonial', scene: 'handheld smartphone selfie style, natural lighting, casual authentic home setting', motion: 'subtle handheld camera movement, the person smiles and gestures toward the product' },
  showcase: { label: 'Product showcase', scene: 'clean studio, soft key light, shallow depth of field, premium commercial look', motion: 'slow cinematic push-in, the person presents the product to camera' },
  lifestyle: { label: 'Lifestyle', scene: 'bright candid lifestyle photography in a real-world environment, golden hour light', motion: 'gentle camera drift, the person uses the product naturally' },
  luxury: { label: 'Luxury / cinematic', scene: 'moody cinematic lighting, rich contrast, high-end fashion campaign look', motion: 'slow dolly with elegant movement, dramatic lighting shifts' },
};

function fallback({ product, actor, brief, format }) {
  const f = FORMATS[format] || FORMATS.ugc;
  const extra = brief ? `, ${brief}` : '';
  return {
    source: 'template',
    imagePrompt: `@actor holding @product, ${f.scene}${extra}. Photorealistic, the product label clearly visible.`,
    motionPrompt: `${f.motion}. Natural, realistic motion.`,
    script: `${actor.name} here — I've been using ${product.name} and I'm honestly obsessed. ${product.description || ''} Try it for yourself.`.trim(),
  };
}

async function write(input) {
  const key = settings.getKey('anthropic');
  if (!key) return fallback(input);
  const { product, actor, brief, format } = input;
  const f = FORMATS[format] || FORMATS.ugc;
  const prompt = `You write short-form video ad concepts for an AI ad generator.
Product: ${product.name} — ${product.description || 'no description'}
Presenter: ${actor.name} — ${actor.description || 'no description'}
Style: ${f.label} (${f.scene})
Creative brief from the advertiser: ${brief || '(none)'}

Return ONLY a JSON object with keys:
- imagePrompt: one still-frame description for an image model. Refer to the presenter as @actor and the product as @product (literally those tags). Under 60 words, concrete visuals only.
- motionPrompt: how that frame should move over 5-10 seconds, under 30 words.
- script: a punchy 15-25 word spoken line for the presenter. No hashtags.`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: store.db.settings.anthropicModel, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(body.error && body.error.message) || 'request failed'}`);
  const text = (body.content || []).map((c) => c.text || '').join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('Copywriter returned no JSON');
  const j = JSON.parse(m[0]);
  const out = { source: 'claude', imagePrompt: String(j.imagePrompt || ''), motionPrompt: String(j.motionPrompt || ''), script: String(j.script || '') };
  // The reference tags are what bind the actor/product images to the render.
  if (!out.imagePrompt.includes('@actor') || !out.imagePrompt.includes('@product')) {
    out.imagePrompt = `@actor with @product. ${out.imagePrompt}`;
  }
  return out;
}

module.exports = { write, fallback, FORMATS };
