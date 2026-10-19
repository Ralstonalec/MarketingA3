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
    textModel: p.textModel || undefined, imageModel: p.imageModel, videoModel: p.videoModel, withVideo: p.withVideo,
    sceneSeconds: Array(p.variants * p.scenes).fill(SCENE_SECONDS),
  });
}

async function run(input) {
  const p = plan(input);
  const q = quote(p);          // throws if any chosen model has no price
  ledger.assertBudget(q.usd);  // refuses before the writing model is even called
  const written = await composer.compose({
    textModel: p.textModel || undefined, productId: input.productId, actorId: input.actorId, brief: input.brief,
    format: input.format || 'ugc', platform: p.platform, tone: input.tone, cta: input.cta,
    variants: p.variants, scenes: p.scenes, sceneSeconds: SCENE_SECONDS,
  });
  const ratio = composer.PLATFORM_RATIO[p.platform];
  const jobs = [];
  for (const c of written.concepts) {
    jobs.push(...pipeline.createBatch({
      productId: input.productId, actorId: input.actorId, imageModel: p.imageModel, videoModel: p.videoModel,
      withVideo: p.withVideo, ratio, title: c.title, scenes: c.scenes,
    }));
  }
  return { concepts: written.concepts, jobs, quote: q, writtenBy: written.source };
}

module.exports = { run, plan, quote };
