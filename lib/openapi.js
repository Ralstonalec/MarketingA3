'use strict';
// Turns an OpenAPI 3.x spec (e.g. Higgsfield's public openapi.json) into model drafts, so request shapes come from the
// provider's own machine-readable spec rather than anyone's retyping. Everything here is a DRAFT you review before adding.

const KIND_RULES = [
  ['upscale', /upscal|enhanc|restor/], ['lipsync', /lip.?sync|talking|avatar|speak/],
  ['edit', /\b(edit|inpaint|outpaint|background|product.?placement|recast|swap)\b/], ['audio', /speech|tts|voice|audio|music|sound/],
  ['video', /video|i2v|t2v|animate|kling|veo|wan|seedance|sora|hailuo|minimax|motion|dop\b/], ['image', /image|t2i|portrait|soul|flux|seedream|sdxl|nano|banana|photo|picture/],
];
const guessKind = (text) => { const t = text.toLowerCase(); for (const [k, re] of KIND_RULES) if (re.test(t)) return k; return null; };

const deref = (spec, node, depth = 0) => {
  if (!node || typeof node !== 'object' || depth > 12) return node;
  if (node.$ref) {
    const target = String(node.$ref).replace(/^#\//, '').split('/').reduce((o, k) => (o == null ? undefined : o[k.replace(/~1/g, '/').replace(/~0/g, '~')]), spec);
    return deref(spec, target, depth + 1);
  }
  if (node.allOf) { // merge object schemas
    const merged = { type: 'object', properties: {}, required: [] };
    for (const part of node.allOf) { const p = deref(spec, part, depth + 1) || {}; Object.assign(merged.properties, p.properties || {}); merged.required.push(...(p.required || [])); }
    return merged;
  }
  const alt = node.anyOf || node.oneOf;
  if (alt) return deref(spec, alt.find((x) => x && x.type !== 'null') || alt[0], depth + 1);
  return node;
};
const typeOf = (s) => (Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type) || (s.properties ? 'object' : undefined);

const IMAGE = new Set(['image_url', 'image', 'input_image', 'input_image_url', 'start_image', 'first_frame', 'init_image', 'source_image', 'reference_image', 'start_image_url']);
const IMAGES = new Set(['images', 'image_urls', 'reference_images', 'input_images', 'input_image_urls']);
const VIDEO = new Set(['video_url', 'video', 'input_video', 'source_video']);
const AUDIO = new Set(['audio_url', 'audio', 'input_audio', 'voice_url']);
const RATIOS = ['9:16', '16:9', '1:1', '3:4'];

/** Map one request schema onto our placeholders. Returns { body, inputs, attention, limits }. */
function mapSchema(spec, schema) {
  const s = deref(spec, schema) || {};
  const props = s.properties || {}, required = new Set(s.required || []);
  const body = {}, inputs = new Set(), attention = [], limits = {};
  for (const [name, raw] of Object.entries(props)) {
    const p = deref(spec, raw) || {}, n = name.toLowerCase(), t = typeOf(p), isReq = required.has(name);
    if (/^(prompt|text|description|caption)$/.test(n) && t === 'string') { body[name] = '{{prompt}}'; inputs.add('prompt'); }
    else if (IMAGE.has(n)) { body[name] = '{{image}}'; inputs.add('image'); }
    else if (IMAGES.has(n) && t === 'array') {
      const item = deref(spec, p.items) || {};
      if (typeOf(item) === 'object') attention.push(`"${name}" is a list of objects; the app sends plain image URLs, so check its shape`);
      body[name] = '{{images}}'; inputs.add('image');
    }
    else if (VIDEO.has(n)) { body[name] = '{{video}}'; inputs.add('video'); }
    else if (AUDIO.has(n)) { body[name] = '{{audio}}'; inputs.add('audio'); }
    else if (n === 'duration') {
      body[name] = t === 'string' ? '{{duration|string}}' : '{{duration}}'; inputs.add('duration');
      if (p.enum) { limits.durations = p.enum.map(Number).filter(Number.isFinite).sort((a, b) => a - b); attention.push(`duration must be one of ${p.enum.join(', ')}`); }
    }
    else if (/^(aspect_ratio|ratio)$/.test(n)) {
      if (!p.enum || RATIOS.some((r) => p.enum.includes(r))) { body[name] = '{{ratio}}'; inputs.add('ratio'); if (p.enum) limits.ratios = p.enum; if (p.enum && !RATIOS.every((r) => p.enum.includes(r))) attention.push(`allowed ratios: ${p.enum.join(', ')}`); }
      else { body[name] = p.default !== undefined ? p.default : p.enum[0]; attention.push(`ratio is fixed to ${body[name]} (allowed: ${p.enum.join(', ')})`); }
    }
    else if (isReq) { // a required field we do not recognise: use the spec's own default or a safe first choice, and say so
      if (p.default !== undefined) body[name] = p.default;
      else if (p.enum && p.enum.length) body[name] = p.enum[0];
      else if (t === 'boolean') body[name] = false;
      else if (t === 'integer' || t === 'number') body[name] = p.minimum != null ? p.minimum : 1;
      else if (t === 'string') body[name] = '';
      else body[name] = null;
      attention.push(`required field "${name}" set to ${JSON.stringify(body[name])}; check it`);
    }
  }
  return { body, inputs: [...inputs], attention, limits };
}

/** opts: { provider, estimate } */
function fromSpec(spec, opts = {}) {
  if (!spec || typeof spec !== 'object' || !spec.paths) throw Object.assign(new Error('That is not an OpenAPI document (no "paths").'), { code: 400 });
  const server = String(((spec.servers || [])[0] || {}).url || '').replace(/\/$/, '');
  if (!/^https?:\/\//.test(server)) throw Object.assign(new Error('The spec has no absolute server URL.'), { code: 400 });
  const schemes = (spec.components && spec.components.securitySchemes) || spec.securitySchemes || {};
  const scheme = Object.values(schemes).find((x) => x && x.type === 'apiKey' && x.in === 'header') || {};
  const authHeader = scheme.name || 'Authorization';
  // The scheme's own description says how the value is built (Higgsfield: "Key {api_key_id}:{api_key_secret}")
  const authValue = /Key \{/.test(scheme.description || '') || (opts.provider === 'higgsfield') ? 'Key {{apiKey}}' : /bearer/i.test(JSON.stringify(schemes)) ? 'Bearer {{apiKey}}' : '{{apiKey}}';
  const hasIdem = /idempotency-key/i.test(JSON.stringify(spec));
  const drafts = [], skipped = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    const op = item && item.post;
    if (!op) continue;
    if (/\{/.test(path) || /^\/(requests|estimate)\b/.test(path)) { skipped.push({ path, reason: 'shared operation, not a model' }); continue; }
    const label = String(op.summary || op.operationId || path.replace(/^\//, '')).slice(0, 80);
    const body = ((op.requestBody || {}).content || {})['application/json'];
    if (!body || !body.schema) { skipped.push({ path, reason: 'no JSON request body' }); continue; }
    const kind = guessKind(`${path} ${label} ${(op.tags || []).join(' ')} ${op.operationId || ''}`);
    const m = mapSchema(spec, body.schema);
    const attention = [...m.attention];
    if (!kind) attention.unshift('could not tell what this model makes; choose the type');
    if (!m.inputs.length) attention.unshift('no recognisable input fields; check the request body');
    const headers = { [authHeader]: authValue };
    if (hasIdem) headers['Idempotency-Key'] = '{{idempotencyKey}}';
    const outKind = kind || 'image';
    drafts.push({
      path, label, kind: outKind, guessedKind: !!kind, provider: opts.provider || 'custom', inputs: m.inputs.length ? m.inputs : ['prompt'], limits: m.limits, attention,
      http: { submit: { url: server + path, headers, body: m.body }, poll: { url: '{{submit.status_url}}', statusPath: 'status', doneValues: ['completed'] }, resultPath: outKind === 'video' || outKind === 'lipsync' ? 'video.url' : outKind === 'audio' ? 'audio.url' : 'images.0.url' },
      estimate: opts.estimate === false ? undefined : { url: `${server}/estimate${path}` },
    });
  }
  if (!drafts.length) throw Object.assign(new Error('No model endpoints were found in that spec.'), { code: 400 });
  return { server, drafts, skipped };
}

module.exports = { fromSpec, mapSchema, guessKind };
