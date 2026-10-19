'use strict';
// Fetch a URL on behalf of a user without becoming a proxy into your own network (SSRF).
// - http/https only, no credentials in the URL
// - the hostname is resolved ONCE, every address must be public, and the socket is pinned to that address
//   (so DNS rebinding between "check" and "connect" cannot swap in an internal IP)
// - redirects are followed manually and re-validated at every hop
// - hard caps on time and bytes
const http = require('http');
const https = require('https');
const dns = require('dns').promises;
const net = require('net');

// Tests only: lets the importer reach a fake page on 127.0.0.1. Other private ranges stay blocked regardless.
const ALLOW_LOOPBACK = () => process.env.A3_ALLOW_LOOPBACK_URL_IMPORT === '1';
const isLoopback = (ip) => ip === '::1' || /^127\./.test(ip);
const blocked = (ip) => isPrivateIp(ip) && !(ALLOW_LOOPBACK() && isLoopback(ip));

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::') return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe[89ab])/.test(v) || v.startsWith('ff'); // unique-local, link-local, multicast
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
}

async function resolvePublic(host) {
  if (net.isIP(host)) { if (blocked(host)) throw bad('That address is not allowed.'); return { address: host, family: net.isIP(host) }; }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length) throw bad('Could not resolve that address.');
  if (addrs.some((a) => blocked(a.address))) throw bad('That address points to a private network and is not allowed.');
  return addrs[0];
}
const bad = (m) => Object.assign(new Error(m), { code: 400 });

function once(url, ip, { timeoutMs, maxBytes, accept }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET', timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MarketingA3/1.0)', Accept: accept, 'Accept-Encoding': 'identity' },
      lookup: (_h, _o, cb) => cb(null, ip.address, ip.family), // pinned: never re-resolved
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return resolve({ redirect: new URL(res.headers.location, url).href }); }
      if (res.statusCode < 200 || res.statusCode >= 300) { res.resume(); return reject(bad(`The page returned HTTP ${res.statusCode}.`)); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > maxBytes) { req.destroy(); reject(bad('The page is too large to import.')); } else chunks.push(c); });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), type: String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase() }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(bad('The page took too long to respond.')); });
    req.on('error', (e) => reject(e.code === 400 ? e : bad(`Could not fetch the page (${e.code || e.message}).`)));
    req.end();
  });
}

async function safeGet(rawUrl, { timeoutMs = 10000, maxBytes = 1.5 * 1024 * 1024, accept = 'text/html,*/*', maxRedirects = 4 } = {}) {
  let url;
  try { url = new URL(rawUrl); } catch { throw bad('That is not a valid web address.'); }
  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) throw bad('Only http and https addresses are allowed.');
    if (url.username || url.password) throw bad('Addresses with a username or password are not allowed.');
    const ip = await resolvePublic(url.hostname.replace(/^\[|\]$/g, ''));
    const r = await once(url, ip, { timeoutMs, maxBytes, accept });
    if (r.redirect) { url = new URL(r.redirect); continue; }
    return { ...r, url: url.href };
  }
  throw bad('Too many redirects.');
}

module.exports = { safeGet, isPrivateIp };
