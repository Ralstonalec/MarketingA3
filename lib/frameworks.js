'use strict';
// Proven short-form ad structures. The composer maps these beats onto the requested number of scenes,
// and each variant gets a different framework + hook formula so versions are genuinely different.

const BASE_HOOKS = {
  pain: 'Name one specific, relatable frustration the target viewer feels right now.',
  curiosity: 'Open a loop the viewer must close: tease a surprising outcome without stating it yet.',
  callout: 'Call out the exact viewer: "If you [specific situation], watch this."',
  contrarian: 'Challenge a common belief or habit the viewer currently holds.',
  pattern_interrupt: 'Start mid-action with something visually unexpected, no greeting, no intro.',
  question: 'Ask a question the target viewer would instantly answer "yes" to.',
  proof: 'Lead with a concrete result that is stated in the PRODUCT FACTS (never invent one).',
  offer: 'Lead with the offer exactly as provided in the brief (never invent discounts or deadlines).',
};

const BASE_FRAMEWORKS = {
  ugc_testimonial: {
    label: 'UGC testimonial', desc: 'Authentic first-person review, handheld selfie feel.',
    beats: [['Hook', 'Stop the scroll in the first 2 seconds.'], ['Problem', 'The frustration before the product.'], ['Discovery', 'How/why they tried it.'], ['Experience', 'Concrete sensory details of using it. No invented results.'], ['CTA', 'Natural, low-pressure next step.']],
    hooks: ['pain', 'callout', 'curiosity', 'proof'], look: 'ugc',
  },
  problem_solution: {
    label: 'Problem → Solution', desc: 'Problem, agitate, then the product as the fix.',
    beats: [['Hook', 'State the problem vividly.'], ['Agitate', 'Make the cost of the problem felt.'], ['Solution', 'Reveal the product as the fix.'], ['Proof', 'One supporting fact from PRODUCT FACTS.'], ['CTA', 'Clear single next step.']],
    hooks: ['pain', 'question', 'callout'], look: 'natural',
  },
  product_demo: {
    label: 'Product demo', desc: 'Show it working: feature, then the benefit it creates.',
    beats: [['Hook', 'Promise what the viewer is about to see.'], ['Feature 1 → benefit', 'Show one feature in use and the benefit.'], ['Feature 2 → benefit', 'A second, different feature and benefit.'], ['Result moment', 'The satisfying outcome.'], ['CTA', 'Clear next step.']],
    hooks: ['curiosity', 'pattern_interrupt', 'question'], look: 'studio',
  },
  unboxing: {
    label: 'Unboxing / first impressions', desc: 'Arrival, reveal, first reactions.',
    beats: [['Hook', 'The package arrives / big reveal tease.'], ['Unbox', 'Opening it, tactile detail.'], ['Details', 'Close-ups of what stands out.'], ['First use', 'Genuine first reaction.'], ['CTA', 'Soft invitation.']],
    hooks: ['curiosity', 'pattern_interrupt'], look: 'ugc',
  },
  lifestyle_story: {
    label: 'Day in the life', desc: 'The product woven into a real routine.',
    beats: [['Hook', 'A relatable routine moment.'], ['Routine', 'The ordinary part of the day.'], ['Product moment', 'The product slots in naturally.'], ['Payoff', 'How the moment feels better.'], ['CTA', 'Soft invitation.']],
    hooks: ['callout', 'pattern_interrupt', 'pain'], look: 'golden',
  },
  offer_announcement: {
    label: 'Offer announcement', desc: 'Lead with the deal. Needs an offer in the brief or product.',
    beats: [['Hook', 'The offer, exactly as provided.'], ['What it is', 'What the product is in one line.'], ['Why now', 'Only reasons/deadlines that were provided.'], ['CTA', 'Urgent, specific next step.']],
    hooks: ['offer'], look: 'studio', needs: 'offer',
  },
  comparison: {
    label: 'Old way vs new way', desc: 'Contrast the usual approach with the product. No competitor names.',
    beats: [['Hook', 'Challenge the old way.'], ['Old way', 'The annoying usual approach.'], ['New way', 'The same task with the product.'], ['Verdict', 'The clear difference.'], ['CTA', 'Clear next step.']],
    hooks: ['contrarian', 'question', 'pain'], look: 'natural',
  },
  sensory_asmr: {
    label: 'Sensory / ASMR', desc: 'Texture, sound and close-ups. Minimal voiceover.',
    beats: [['Hook', 'An irresistible texture or sound moment.'], ['Close-up 1', 'Macro detail.'], ['Close-up 2', 'A different tactile detail.'], ['Use moment', 'The product in use.'], ['CTA', 'A quiet, short call to action.']],
    hooks: ['pattern_interrupt', 'curiosity'], look: 'macro', quiet: true,
  },
};

// A loaded, validated knowledge pack (lib/knowledge.js) can add frameworks and hook formulas.
const store = require('./store');
const packData = () => (store.db.knowledge && store.db.knowledge.pack) || {};
const REQUIRES = { proof: 'facts', offer: 'offer' };

function frameworksNow() {
  const out = { ...BASE_FRAMEWORKS };
  for (const f of packData().frameworks || []) {
    if (out[f.id]) continue; // a pack never overrides a built-in
    out[f.id] = { label: f.label, desc: (f.bestFor || []).join(', '), beats: f.beats.map((b) => [b.name, b.goal]), hooks: f.hookFormulas || [], look: 'natural', quiet: f.voiceoverDensity === 'low', platforms: f.platforms, fromPack: true };
  }
  return out;
}
function hooksNow() {
  const out = { ...BASE_HOOKS };
  for (const h of packData().hookFormulas || []) if (!out[h.id]) out[h.id] = h.instruction;
  return out;
}
const requiresOf = (id) => REQUIRES[id] || ((packData().hookFormulas || []).find((h) => h.id === id) || {}).requires || 'none';

/** Which frameworks a product can honestly use (offer-led ads need an offer; platform-tagged ones need a match). */
function eligible(ctx) {
  return Object.entries(frameworksNow()).filter(([, f]) => !(f.needs === 'offer' && !ctx.offer) && !(f.platforms && ctx.platform && !f.platforms.includes(ctx.platform))).map(([id]) => id);
}

/** Spread beats across n scenes in order, merging neighbours when there are fewer scenes than beats. */
function mapBeats(beats, n) {
  const out = Array.from({ length: n }, () => []);
  beats.forEach((b, i) => out[Math.min(n - 1, Math.floor((i * n) / beats.length))].push(b));
  return out.map((g) => g.map(([name, goal]) => `${name}: ${goal}`).join(' + '));
}

/** Pick `count` distinct framework/hook pairs. A requested framework leads; the rest rotate through eligible ones. */
function pick(count, ctx, requested) {
  const fws = frameworksNow(), hookText = hooksNow();
  const ok = eligible(ctx);
  const order = [...(requested && ok.includes(requested) ? [requested] : []), ...ok.filter((id) => id !== requested)];
  return Array.from({ length: count }, (_, i) => {
    const id = order[i % order.length], f = fws[id];
    const hooks = f.hooks.filter((h) => hookText[h] && !(requiresOf(h) === 'facts' && !ctx.hasFacts) && !(requiresOf(h) === 'offer' && !ctx.offer));
    const hook = hooks[Math.floor(i / order.length) % hooks.length] || 'curiosity';
    return { id, hook };
  });
}

module.exports = { frameworksNow, hooksNow, eligible, mapBeats, pick, BASE_FRAMEWORKS, BASE_HOOKS };
