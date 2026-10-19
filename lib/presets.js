'use strict';
// Camera moves and looks written the way video/image models respond best: one clear move, plain words.

const CAMERA = {
  dolly_in: { label: 'Slow dolly in', prompt: 'slow smooth dolly in toward the subject' },
  dolly_out: { label: 'Dolly out reveal', prompt: 'slow dolly out revealing more of the scene' },
  orbit: { label: 'Orbit', prompt: 'camera slowly orbits around the subject, subject stays centered' },
  handheld: { label: 'Handheld', prompt: 'natural handheld camera with subtle sway, selfie-style framing' },
  crane_up: { label: 'Crane up', prompt: 'camera cranes upward and tilts down, revealing the scene' },
  tracking: { label: 'Tracking shot', prompt: 'camera tracks sideways, keeping pace with the subject' },
  whip_pan: { label: 'Whip pan', prompt: 'fast whip pan to the subject, settling into a steady frame' },
  macro_slide: { label: 'Macro slide', prompt: 'macro lens, camera slides slowly across the surface detail' },
  rack_focus: { label: 'Rack focus', prompt: 'rack focus from foreground to the product' },
  push_in_tilt: { label: 'Push-in + tilt up', prompt: 'slow push-in while tilting up to the subject\'s face' },
  fpv: { label: 'FPV fly-through', prompt: 'smooth first-person fly-through toward the subject' },
  static: { label: 'Locked-off', prompt: 'static locked-off camera, only the subject moves' },
};

const LOOK = {
  ugc: { label: 'UGC smartphone', prompt: 'shot on a smartphone, natural light, casual authentic setting, slight handheld imperfection' },
  natural: { label: 'Natural window light', prompt: 'soft natural window light, real-life setting, true-to-life colors' },
  studio: { label: 'Clean studio', prompt: 'clean studio, soft key light with gentle fill, shallow depth of field, premium commercial look' },
  golden: { label: 'Golden hour', prompt: 'warm golden hour sunlight, soft long shadows, candid lifestyle feel' },
  neon: { label: 'Neon night', prompt: 'night scene with colorful neon practical lights, cinematic contrast' },
  luxe: { label: 'Luxury cinematic', prompt: 'moody cinematic lighting, rich contrast, high-end fashion campaign look' },
  macro: { label: 'Macro detail', prompt: 'macro photography, crisp texture detail, soft background blur' },
  bright: { label: 'Bright & airy', prompt: 'bright airy interior, white and pastel tones, soft diffused light' },
};

// Appended (visibly, so you can edit them) to every generated prompt to cut common model failures.
const IMAGE_SUFFIX = 'photorealistic, natural skin texture, anatomically correct hands, product label sharp and facing the camera, no text overlays, no watermark';
const MOTION_SUFFIX = 'natural realistic motion, product shape and label stay stable, no morphing, no flicker';

const list = (o) => Object.entries(o).map(([id, v]) => ({ id, label: v.label }));
module.exports = { CAMERA, LOOK, IMAGE_SUFFIX, MOTION_SUFFIX, list };
