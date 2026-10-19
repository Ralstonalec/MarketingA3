'use strict';
// Runway developer API: https://docs.dev.runwayml.com
const settings = require('../settings');

const BASE = 'https://api.dev.runwayml.com/v1';
const VERSION = '2024-11-06';

// Our UI aspect ratios -> Runway pixel ratios.
const IMAGE_RATIOS = { '9:16': '1080:1920', '16:9': '1920:1080', '1:1': '1080:1080', '3:4': '1080:1440' };
const VIDEO_RATIOS = { '9:16': '720:1280', '16:9': '1280:720', '1:1': '960:960', '3:4': '832:1104' };

async function call(method, path, body) {
  const key = settings.getKey('runway');
  if (!key) throw new Error('No Runway API key set (Settings, or RUNWAY_API_KEY).');
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'X-Runway-Version': VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const e = new Error(`Runway ${res.status}: ${json.error || json.message || text.slice(0, 200)}`);
    e.status = res.status;
    throw e;
  }
  return json;
}

module.exports = {
  name: 'runway',
  label: 'Runway (gen4_image + gen4_turbo)',
  supportsVideo: true,

  /** refs: [{ tag, uri }] — the prompt can mention them as @tag. */
  async startImage({ prompt, ratio, refs }) {
    const r = await call('POST', '/text_to_image', {
      model: 'gen4_image',
      promptText: prompt,
      ratio: IMAGE_RATIOS[ratio],
      referenceImages: refs.map((x) => ({ uri: x.uri, tag: x.tag })),
    });
    return { taskId: r.id };
  },

  async startVideo({ prompt, ratio, duration, imageUri }) {
    const r = await call('POST', '/image_to_video', {
      model: 'gen4_turbo',
      promptImage: imageUri,
      promptText: prompt,
      ratio: VIDEO_RATIOS[ratio],
      duration,
    });
    return { taskId: r.id };
  },

  async poll(taskId) {
    const t = await call('GET', `/tasks/${taskId}`);
    if (t.status === 'SUCCEEDED') return { status: 'SUCCEEDED', url: (t.output || [])[0] };
    if (t.status === 'FAILED' || t.status === 'CANCELLED') {
      return { status: 'FAILED', error: t.failure || t.failureCode || t.status };
    }
    return { status: 'RUNNING', progress: t.progress };
  },
};
