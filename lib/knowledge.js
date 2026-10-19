'use strict';
// Research packs (ad-knowledge.json) are only useful if they are TRUE, so nothing enters the writer
// unless it passes this gate: a real https source, a plausible year, an honest strength rating,
// and (for claim patterns) a regex that compiles and cannot hang. Everything rejected is reported.
const vm = require('vm');
const store = require('./store');

const PLATFORMS = ['tiktok', 'tiktok_shop', 'reels', 'shorts', 'meta', 'youtube'];
const APPLIES = ['all', 'law', 'tiktok', 'tiktok_shop', 'meta', 'youtube'];
const STRENGTH = ['STRONG', 'MODERATE'];
const PLATFORM_APPLIES = { tiktok: ['tiktok'], tiktok_shop: ['tiktok_shop', 'tiktok'], reels: ['meta'], meta: ['meta'], shorts: ['youtube'], youtube: ['youtube'] };
const thisYear = () => new Date().getFullYear();

const clean = (s, max = 300) => String(s == null ? '' : s).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const isArr = (a) => Array.isArray(a);

/** An https URL on a real-looking host, and not described as an internal/unpublished document. */
function sourceProblem(src) {
  const text = String(src || '').trim();
  if (!text) return 'no source';
  if (/internal|confidential|unpublished|private (report|study)|leaked/i.test(text)) return 'source is an internal or unpublished document';
  let u; try { u = new URL(text); } catch { return 'source is not a URL'; }
  if (u.protocol !== 'https:') return 'source must be an https URL';
  if (!/\./.test(u.hostname) || /^(localhost|\d+\.\d+\.\d+\.\d+)$/.test(u.hostname)) return 'source host is not a public website';
  return null;
}
function evidenceProblem(ev) {
  if (!ev || typeof ev !== 'object') return 'no evidence block (strength, source, year)';
  if (!STRENGTH.includes(ev.strength)) return `strength must be STRONG or MODERATE (got "${ev.strength}")`;
  const sp = sourceProblem(ev.source); if (sp) return sp;
  const y = Number(ev.year);
  if (!Number.isInteger(y) || y < 2018 || y > thisYear() + 1) return `year looks wrong (${ev.year})`;
  return null;
}

/** Compile and stress-test a pattern in a sandbox with a hard timeout, so a bad regex can never freeze the server. */
function regexProblem(source) {
  if (typeof source !== 'string' || !source || source.length > 200) return 'regex missing or longer than 200 characters';
  let re; try { re = new RegExp(source, 'i'); } catch (e) { return `regex does not compile (${e.message})`; }
  if (re.test('')) return 'regex matches empty text';
  try {
    // Catastrophic patterns blow up on text that ALMOST matches and then fails, so probe with that shape.
    const probes = ['a'.repeat(40) + '!', ' '.repeat(40) + '!', '1'.repeat(40) + '!', 'ab'.repeat(20) + '!', 'x '.repeat(25) + '!', 'word '.repeat(2000), 'a'.repeat(4000)];
    for (const ch of new Set(source.toLowerCase().match(/[a-z0-9]/g) || [])) probes.push(ch.repeat(40) + '!'); // runs of every literal the pattern mentions
    for (const probe of probes) vm.runInNewContext('re.test(s)', { re, s: probe }, { timeout: 100 });
  } catch { return 'regex is too slow (possible catastrophic backtracking)'; }
  return null;
}

function validate(raw) {
  const report = { accepted: {}, rejected: [], notes: [] };
  const reject = (section, id, reason) => report.rejected.push({ section, id: String(id || '(unnamed)').slice(0, 60), reason });
  const pack = {};
  const keep = (section, item) => { (pack[section] = pack[section] || []).push(item); report.accepted[section] = (report.accepted[section] || 0) + 1; };
  if (!raw || typeof raw !== 'object' || isArr(raw)) { report.error = 'The file must be a JSON object.'; return { pack: null, report }; }

  const seen = new Set();
  for (const f of isArr(raw.frameworks) ? raw.frameworks : []) {
    const id = f && f.id;
    const ev = evidenceProblem(f && f.evidence);
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(id || '')) reject('frameworks', id, 'id must be snake_case, 3-41 chars');
    else if (seen.has('f:' + id)) reject('frameworks', id, 'duplicate id');
    else if (ev) reject('frameworks', id, ev);
    else if (!clean(f.label, 60)) reject('frameworks', id, 'no label');
    else if (!isArr(f.beats) || f.beats.length < 2 || f.beats.length > 8 || f.beats.some((b) => !b || !clean(b.name, 40) || !clean(b.goal, 160))) reject('frameworks', id, 'needs 2-8 beats, each with a name and goal');
    else if (isArr(f.platforms) && f.platforms.some((p) => !PLATFORMS.includes(p))) reject('frameworks', id, `platforms must be among ${PLATFORMS.join(', ')}`);
    else {
      seen.add('f:' + id);
      keep('frameworks', { id, label: clean(f.label, 60), platforms: isArr(f.platforms) && f.platforms.length ? f.platforms : undefined, bestFor: (isArr(f.bestFor) ? f.bestFor : []).map((x) => clean(x, 40)).slice(0, 6),
        beats: f.beats.map((b) => ({ name: clean(b.name, 40), goal: clean(b.goal, 160) })), hookFormulas: (isArr(f.hookFormulas) ? f.hookFormulas : []).map((x) => clean(x, 40)).slice(0, 6),
        voiceoverDensity: ['high', 'medium', 'low'].includes(f.voiceoverDensity) ? f.voiceoverDensity : 'medium', evidence: { strength: f.evidence.strength, source: f.evidence.source, year: Number(f.evidence.year) } });
    }
  }
  for (const h of isArr(raw.hookFormulas) ? raw.hookFormulas : []) {
    const id = h && h.id, ev = evidenceProblem(h && h.evidence), ins = clean(h && h.instruction, 240);
    if (!/^[a-z][a-z0-9_]{2,40}$/.test(id || '')) reject('hookFormulas', id, 'id must be snake_case');
    else if (seen.has('h:' + id)) reject('hookFormulas', id, 'duplicate id');
    else if (ev) reject('hookFormulas', id, ev);
    else if (ins.length < 12) reject('hookFormulas', id, 'instruction is too short to follow');
    else if (/\d+(\.\d+)?\s?%/.test(ins)) reject('hookFormulas', id, 'instruction contains a statistic; keep statistics in benchmarks with a source');
    else { seen.add('h:' + id); keep('hookFormulas', { id, instruction: ins, example: clean(h.example, 160), requires: ['none', 'facts', 'offer'].includes(h.requires) ? h.requires : 'none', evidence: { strength: h.evidence.strength, source: h.evidence.source, year: Number(h.evidence.year) } }); }
  }
  if (raw.platformRules && typeof raw.platformRules === 'object') {
    for (const [p, r] of Object.entries(raw.platformRules)) {
      const sp = r && sourceProblem(r.source);
      const secs = (v) => isArr(v) && v.length === 2 && v.every((n) => Number.isFinite(Number(n)) && n >= 0 && n <= 600) && v[0] <= v[1];
      if (!PLATFORMS.includes(p)) reject('platformRules', p, `unknown platform (use ${PLATFORMS.join(', ')})`);
      else if (sp) reject('platformRules', p, sp);
      else if (r.idealSeconds != null && !secs(r.idealSeconds)) reject('platformRules', p, 'idealSeconds must be [min, max] seconds, 0-600');
      else if (r.hookWithinSeconds != null && !(Number(r.hookWithinSeconds) >= 0 && Number(r.hookWithinSeconds) <= 10)) reject('platformRules', p, 'hookWithinSeconds must be 0-10');
      else {
        const o = { source: r.source }; for (const k of ['safeZone', 'textAdvice', 'soundAdvice', 'styleAdvice', 'hashtagAdvice', 'ctaAdvice', 'specs']) if (r[k]) o[k] = clean(r[k], 280);
        if (r.idealSeconds) o.idealSeconds = r.idealSeconds.map(Number); if (r.hookWithinSeconds != null) o.hookWithinSeconds = Number(r.hookWithinSeconds);
        if (isArr(r.requiredElements)) o.requiredElements = r.requiredElements.map((x) => clean(x, 160)).slice(0, 10);
        (pack.platformRules = pack.platformRules || {})[p] = o; report.accepted.platformRules = (report.accepted.platformRules || 0) + 1;
      }
    }
  }
  const sourced = (section, list, required, build) => {
    for (const x of isArr(list) ? list : []) {
      const label = clean(x && (x.signal || x.behaviour || x.rule || x.metric || x.action || x.applies), 60);
      const sp = sourceProblem(x && x.source), y = Number(x && x.year);
      if (!x || !label) reject(section, '', 'empty item');
      else if (sp) reject(section, label, sp);
      else if (!Number.isInteger(y) || y < 2018 || y > thisYear() + 1) reject(section, label, `year looks wrong (${x.year})`);
      else if (required && !required(x)) reject(section, label, 'missing a required field');
      else keep(section, build(x, label));
    }
  };
  sourced('distributionSignals', raw.distributionSignals, (x) => PLATFORMS.concat('all').includes(x.platform) && x.advice, (x, l) => ({ platform: x.platform, signal: l, advice: clean(x.advice, 220), officiallyConfirmed: !!x.officiallyConfirmed, source: x.source, year: Number(x.year) }));
  sourced('suppressors', raw.suppressors, (x) => PLATFORMS.concat('all').includes(x.platform) && x.avoid, (x, l) => ({ platform: x.platform, behaviour: l, avoid: clean(x.avoid, 220), source: x.source, year: Number(x.year) }));
  sourced('shopRules', raw.shopRules, (x) => x.platform && x.enforce, (x, l) => ({ platform: clean(x.platform, 30), rule: clean(x.rule, 260), enforce: clean(x.enforce, 200), source: x.source, year: Number(x.year) }));
  sourced('disclosureRules', raw.disclosureRules, (x) => PLATFORMS.concat('all').includes(x.platform) && ['law', 'policy', 'good_practice'].includes(x.binding) && x.action && x.applies,
    (x) => ({ platform: x.platform, applies: clean(x.applies, 220), action: clean(x.action, 240), binding: x.binding, source: x.source, year: Number(x.year) }));
  for (const b of isArr(raw.benchmarks) ? raw.benchmarks : []) {
    const sp = sourceProblem(b && b.source), y = Number(b && b.year);
    if (!b || !clean(b.metric, 80) || b.value == null || b.value === '') reject('benchmarks', b && b.metric, 'needs a metric and a value');
    else if (sp) reject('benchmarks', b.metric, sp);
    else if (!STRENGTH.includes(b.strength)) reject('benchmarks', b.metric, 'strength must be STRONG or MODERATE');
    else if (!Number.isInteger(y) || y < 2018 || y > thisYear() + 1) reject('benchmarks', b.metric, `year looks wrong (${b.year})`);
    else keep('benchmarks', { platform: clean(b.platform, 30), metric: clean(b.metric, 80), value: clean(b.value, 60), context: clean(b.context, 200), source: b.source, year: y, strength: b.strength });
  }

  const regexes = new Map();
  for (const c of isArr(raw.claimPatterns) ? raw.claimPatterns : []) {
    const reason = clean(c && c.reason, 200), rp = regexProblem(c && c.regex);
    const severity = c && c.severity;
    if (!c || !reason) reject('claimPatterns', c && c.regex, 'needs a reason');
    else if (rp) reject('claimPatterns', c.regex, rp);
    else if (!['block', 'warn'].includes(severity)) reject('claimPatterns', c.regex, 'severity must be block or warn');
    else if (!APPLIES.includes(c.appliesTo)) reject('claimPatterns', c.regex, `appliesTo must be one of ${APPLIES.join(', ')}`);
    else if (severity === 'block' && sourceProblem(c.source)) reject('claimPatterns', c.regex, `a blocking rule needs a source: ${sourceProblem(c.source)}`);
    else if (regexes.has(c.regex + '|' + c.appliesTo) && regexes.get(c.regex + '|' + c.appliesTo) !== severity) reject('claimPatterns', c.regex, 'contradicts another rule with the same pattern (different severity)');
    else {
      regexes.set(c.regex + '|' + c.appliesTo, severity);
      keep('claimPatterns', { regex: c.regex, reason, appliesTo: c.appliesTo, jurisdiction: clean(c.jurisdiction, 10) || 'all', severity, unlessProvided: c.unlessProvided !== false, saferAlternative: clean(c.saferAlternative, 200), source: c.source || '', year: Number(c.year) || null });
    }
  }
  for (const c of isArr(raw.cliches) ? raw.cliches : []) { const p = clean(c && c.phrase, 40); if (p.length >= 3) keep('cliches', { phrase: p, why: clean(c.why, 120) }); else reject('cliches', c && c.phrase, 'phrase too short'); }
  for (const m of isArr(raw.aiFailureModes) ? raw.aiFailureModes : []) {
    const id = clean(m && m.id, 40), pa = clean(m && m.promptAvoid, 140), ma = clean(m && m.motionAvoid, 140);
    if (!id || !(pa || ma)) reject('aiFailureModes', id, 'needs an id and promptAvoid or motionAvoid wording');
    else keep('aiFailureModes', { id, label: clean(m.label, 60), recognise: clean(m.recognise, 200), promptAvoid: pa, motionAvoid: ma, fallback: clean(m.fallback, 160) });
  }
  if (raw.categoryNotes && typeof raw.categoryNotes === 'object') {
    for (const [k, v] of Object.entries(raw.categoryNotes)) {
      if (!v || typeof v !== 'object') { reject('categoryNotes', k, 'not an object'); continue; }
      (pack.categoryNotes = pack.categoryNotes || {})[clean(k, 40)] = Object.fromEntries(['works', 'restricted', 'extraChecks'].map((f) => [f, (isArr(v[f]) ? v[f] : []).map((x) => clean(x, 200)).slice(0, 12)]));
      report.accepted.categoryNotes = (report.accepted.categoryNotes || 0) + 1;
    }
  }
  report.total = Object.values(report.accepted).reduce((a, b) => a + b, 0);
  if (!report.total) report.error = 'Nothing in the file passed the evidence check.';
  return { pack: report.total ? pack : null, report };
}

// ---- store + consumption --------------------------------------------------------------
const current = () => (store.db.knowledge && store.db.knowledge.pack) || null;

function save(raw, name) {
  const { pack, report } = validate(raw);
  if (!pack) throw Object.assign(new Error(report.error), { code: 400, report });
  store.db.knowledge = { meta: { name: clean(name, 80) || 'Research pack', loadedAt: new Date().toISOString(), counts: report.accepted, rejected: report.rejected.length }, pack };
  store.save();
  return { meta: store.db.knowledge.meta, report };
}
function clear() { store.db.knowledge = null; store.save(); }

/** Claim patterns that apply to this platform, compiled once per call. */
function claimPatterns(platform) {
  const ok = new Set(['all', 'law', ...(PLATFORM_APPLIES[platform] || [])]);
  return ((current() || {}).claimPatterns || []).filter((c) => ok.has(c.appliesTo)).map((c) => ({ ...c, re: new RegExp(c.regex, 'i') }));
}

/** Everything the prompts need from the pack for one platform. */
function forPrompt(platform) {
  const p = current();
  if (!p) return null;
  const rule = (p.platformRules || {})[platform] || null;
  const modes = p.aiFailureModes || [];
  return {
    platformRule: rule,
    cliches: (p.cliches || []).slice(0, 25).map((c) => c.phrase),
    extraImage: [...new Set(modes.map((m) => m.promptAvoid).filter(Boolean))].slice(0, 3),
    extraMotion: [...new Set(modes.map((m) => m.motionAvoid).filter(Boolean))].slice(0, 3),
  };
}

/** Disclosure and shop rules for a platform, for the Post kit checklist. */
function checklistRules(platform) {
  const p = current() || {};
  return [...(p.disclosureRules || []).filter((r) => r.platform === 'all' || r.platform === platform).map((r) => ({ text: `${r.action} (${r.applies})`, level: r.binding, source: r.source })),
    ...(p.shopRules || []).filter((r) => r.platform.startsWith(platform.split('_')[0]) || platform === 'tiktok_shop' && r.platform === 'tiktok_shop').map((r) => ({ text: `${r.rule} — ${r.enforce}`, level: 'policy', source: r.source }))];
}

module.exports = { validate, save, clear, current, claimPatterns, forPrompt, checklistRules, PLATFORMS };
