'use strict';
// One-click ad: write concepts with the default writing model, then render every scene with the
// default image/video models. Price and budget are checked for the WHOLE run before anything is spent.
const store = require('./store');
const catalog = require('./catalog');
const ledger = require('./ledger');
const composer = require('./composer');
const pipeline = require('./pipeline');

const SCENE_SECONDS = 5;
const clamp = (n, lo, hi, d) => Math.min(hi, Math.max(lo, Number(n) || d));

/** Resolve which models a run will use: explicit choice, else the saved defaults. */
function plan(input) {
  const d = store.db.settings.defaults;
  const variants = clamp(input.variants, 1, 3, 1);
  const scenes = clamp(input.scenes, 1, 3, 1);
  const withVideo = input.withVideo !== undefined ? !!input.withVideo : !!d.video;
  const imageModel = input.imageModel || d.image;
  if (!imageModel) throw Object.assign(new Error('Set a default image model in Models first'), { code: 400 });
  if (withVideo && !(input.videoModel || d.video)) throw Object.assign(new Error('Set a default video model in Models, or turn video off'), { code: 400 });
  return {
    variants, scenes, withVideo, imageModel,
    textModel: input.textModel !== undefined ? input.textModel || null : d.text || null,
    videoModel: withVideo ? input.videoModel || d.video : undefined,
    platform: composer.PLATFORMS[input.platform] ? input.platform : 'tiktok',
  };
}

function quote(p) {
  return catalog.quote({
    textModel: p.textModel || undefined, textCalls: p.textModel ? p.variants * 2 : p.variants, imageModel: p.imageModel, videoModel: p.videoModel, withVideo: p.withVideo,
    sceneSeconds: Array(p.variants * p.scenes).fill(SCENE_SECONDS),
  });
}

async function run(input) {
  const p = plan(input);
  const q = quote(p);          // throws if any chosen model has no price
  ledger.assertBudget(q.usd);  // refuses before the writing model is even called
  const written = await composer.compose({
    textModel: p.textModel || undefined, productId: input.productId, actorId: input.actorId, brief: input.brief,
    framework: input.framework, platform: p.platform, tone: input.tone, cta: input.cta,
    variants: p.variants, scenes: p.scenes, sceneSeconds: SCENE_SECONDS, direct: p.textModel ? 'standard' : undefined,
  });
  const ratio = composer.PLATFORM_RATIO[p.platform];
  // Autopilot spends money without a human reviewing the copy, so it only renders concepts with NO unresolved problems.
  const clean = written.concepts.filter((c) => !(c.warnings || []).some((w) => w.level === 'error'));
  const skipped = written.concepts.filter((c) => !clean.includes(c)).map((c) => ({ title: c.title, problems: c.warnings.filter((w) => w.level === 'error').map((w) => w.text) }));
  if (!clean.length) {
    const first = skipped[0];
    throw Object.assign(new Error(`The writer could not produce an ad that passes the checks, so nothing was rendered (the writing cost is on your ledger). Problem: ${first.problems[0]} Try again, add facts to the product, or use the Ad Composer to edit it by hand.`), { code: 422 });
  }
  const jobs = [];
  for (const c of clean) {
    jobs.push(...pipeline.createBatch({
      productId: input.productId, actorId: input.actorId, imageModel: p.imageModel, videoModel: p.videoModel,
      withVideo: p.withVideo, ratio, title: c.title, scenes: c.scenes,
    }));
  }
  return { concepts: clean, skipped, jobs, quote: q, writtenBy: written.source };
}

module.exports = { run, plan, quote };
