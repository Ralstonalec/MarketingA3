'use strict';
// What separates a believable ad from AI slop, written as rules a weak model can follow, plus checks that do not need a model.
// Image-to-video models fail on: too much motion, impossible physics, hands and products merging, "beauty filter" skin,
// and prompts stuffed with quality buzzwords. Everything here pushes the other way: ordinary, physical, slow, specific.

const CRAFT = `REAL-AD CRAFT AND PHYSICS (applies to every imagePrompt and motionPrompt):
IMAGE PROMPTS, write a cinematographer's shot note, not a poster:
1. Name the lens and camera: a real focal length (24mm, 35mm, 50mm or 85mm), camera height (eye level, chest height, low), and the framing (close-up, medium, over-the-shoulder).
2. Light must have a visible, named source and direction: "soft daylight from a window on the left", "warm lamp on the desk behind her", "overcast light through a shop door". Never just "beautiful lighting".
3. Put the scene in an ordinary real place with two or three specific, mundane props (mug, laptop, towel, plant). A little clutter is realistic. Empty white voids look fake.
4. Add honest imperfections: visible skin pores, a few flyaway hairs, natural asymmetry, fabric creases, slight sensor grain. NEVER write "perfect", "flawless", "airbrushed" or "smooth skin".
5. Hands: a simple natural grip, the whole product visible, thumb and four fingers. Do not ask for hands doing two jobs, crossing over the label, or holding more than one object.
6. One person, one product, one location. No crowds, no mirrors or windows reflecting the scene, no screens or signs with readable content, no complex glass reflections.
MOTION PROMPTS, a 3-5 second clip is ONE camera move plus ONE human action:
7. One camera move at a slow or moderate speed ("slow push-in", "gentle handheld drift", "locked-off"), then one action a person can really do in that time: lift, turn the wrist, set down, pour, press, glance, smile, nod. Small and deliberate beats big and busy.
8. Physics must hold: gravity applies and nothing floats; an object only moves if a hand or force moves it; the product stays rigid and never passes through a hand or body; liquid pours in one steady stream and settles; hair and fabric trail behind body motion and settle after; steam rises; shadows and reflections move with the light; every movement has a small anticipation and follow-through at human speed.
9. Describe the action in order with timing words ("as she lifts it, ... then ...").
10. The product must not change shape, colour, size or label at any point. Keep it in one hand or on a surface.
11. Never ask for: transformations or morphing, objects appearing or vanishing, levitation, products spinning in the air, whip pans, speed ramps, slow-motion splashes, particles, sparks or explosions, a person turning all the way around, walking more than two steps, or talking to the camera (dialogue is added later as voiceover; keep the mouth closed or a small natural smile).
12. Do NOT use quality buzzwords: masterpiece, 8k, 4k, ultra-detailed, hyper-realistic, stunning, epic, breathtaking, flawless, perfect, ethereal, magical, award-winning, trending, best quality, highly detailed, intricate. They make output look synthetic. Specific physical detail replaces them.`;

// Terms that push generators toward the glossy "AI look". Removed deterministically, never worth a retry.
const SLOP = ['masterpiece', 'best quality', 'award[- ]winning', 'trending on \\w+', 'hyper-?realistic', 'ultra[- ]?realistic', 'ultra[- ]?detailed', 'highly detailed', 'extremely detailed', 'intricate details?', '[48]k(?: resolution)?', 'uhd', 'hdr', 'stunning', 'breathtaking', 'epic', 'flawless(?:ly)?', 'airbrushed', 'perfect skin', 'perfect(?:ly)?', 'ethereal', 'magical', 'dreamy', 'otherworldly', 'glowing aura'];
const SLOP_RE = new RegExp(`\\b(?:${SLOP.join('|')})\\b`, 'gi');

/** Remove glossy buzzwords and tidy the commas they leave behind. */
function scrub(text) {
  return String(text || '').replace(SLOP_RE, '').replace(/\s+,/g, ',').replace(/,(\s*,)+/g, ',').replace(/^[\s,]+/, '').replace(/[\s,]+$/, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/,\s*\./g, '.').trim();
}

// Motion that image-to-video models cannot do without warping the product or the person. Each entry: pattern, plain-English reason.
const RISKY_MOTION = [
  [/\b(morph(?:s|ing)?|transform(?:s|ing|ed)?|turns? into|melts?|dissolves?|shapeshift\w*)\b/i, 'objects must never morph or transform'],
  [/\b(levitat\w+|float(?:s|ing)?|hover(?:s|ing)?|defies? gravity|weightless)\b/i, 'nothing may float; gravity applies'],
  [/\b(appears?|vanish\w*|disappears?|materiali[sz]es?|teleport\w*|pops? up)\b/i, 'objects may not appear or vanish mid-clip'],
  [/\b(explod\w+|explosion|burst(?:s|ing)?|shatter\w*|sparks?|confetti|fireworks?|particles?)\b/i, 'no explosions, sparks or particle effects'],
  [/\b(whip[- ]?pan|speed[- ]?ramp|time[- ]?lapse|hyper[- ]?lapse|rapid(?:ly)?|fast|frantic\w*|spins?|spinning|twirl\w*|swirl\w*)\b/i, 'fast or spinning motion warps people and products; use slow human speeds'],
  [/\b(splash\w*|slow[- ]motion|super slow)\b/i, 'splashes and slow-motion liquids rarely render; pour in one steady stream instead'],
  [/\b(talks?|talking|speaks?|speaking|lip[- ]?sync\w*|says?|saying|mouths?)\b/i, 'do not ask the person to talk on camera; the voiceover is added later'],
  [/\b(runs?|running|jumps?|jumping|dances?|dancing|flips?|cartwheel\w*)\b/i, 'big body movement breaks anatomy; keep to small actions'],
];

/** Plain-English problems with a motion prompt, or []. */
function motionIssues(text) {
  const out = [];
  for (const [re, why] of RISKY_MOTION) { const m = String(text || '').match(re); if (m) out.push(`"${m[0]}": ${why}`); }
  return out;
}

const CAMERA_WORDS = /\b(push[- ]?in|pull[- ]?out|dolly|orbit|pan|tilt|crane|track(?:s|ing)?|zoom|handheld|locked[- ]off|static|rack focus|slide|drift)\b/gi;
/** Number of distinct camera moves named in a motion prompt (more than 2 is almost always a mess). */
const cameraMoves = (text) => new Set((String(text || '').match(CAMERA_WORDS) || []).map((x) => x.toLowerCase().replace(/[- ]/g, ''))).size;

module.exports = { CRAFT, scrub, motionIssues, cameraMoves, SLOP_RE };
