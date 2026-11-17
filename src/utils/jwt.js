// Dependency-free JWT decoding, signing and signature verification (jwt.io-style),
// using the Web Crypto API. Fully client-side; nothing is sent anywhere unless the
// caller explicitly fetches a JWKS through a fetch function it passes in.

import { parseCertificate, toDER } from './x509.js';

/** base64url -> Uint8Array. Throws on invalid input. */
export function b64urlToBytes(s) {
  const clean = String(s).replace(/\s+/g, '');
  if (/[^A-Za-z0-9_\-+/=]/.test(clean)) throw new Error('Invalid base64url character.');
  const noPad = clean.replace(/=+$/, '');
  if (noPad.length % 4 === 1) throw new Error('Invalid base64url length.');
  const pad = noPad.length % 4 === 0 ? '' : '='.repeat(4 - (noPad.length % 4));
  const bin = atob(noPad.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Uint8Array -> base64url (no padding). */
export function bytesToB64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url -> UTF-8 string. */
export function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Split and decode a JWT into { header, payload, signature, parts, raw }.
 * Throws if the structure is not three dot-separated segments or the header /
 * payload are not JSON objects. A 5-part token is reported as a JWE.
 */
export function decodeJwt(token) {
  const raw = (token || '').trim();
  const parts = raw.split('.');
  if (parts.length === 5) {
    const e = new Error('This looks like a JWE (5 segments: encrypted JWT). The payload is encrypted, so it cannot be decoded here without the decryption key.');
    e.code = 'JWE';
    throw e;
  }
  if (parts.length !== 3) throw new Error(`Expected 3 segments (header.payload.signature), got ${parts.length}.`);
  let header; let payload;
  try { header = JSON.parse(b64urlToString(parts[0])); } catch { throw new Error('Header is not valid base64url JSON.'); }
  try { payload = JSON.parse(b64urlToString(parts[1])); } catch { throw new Error('Payload is not valid base64url JSON.'); }
  if (!isPlainObject(header)) throw new Error('Header is not a JSON object.');
  if (!isPlainObject(payload)) throw new Error('Payload is not a JSON object (claims must be an object).');
  return { header, payload, signature: parts[2], parts, raw };
}

function fmtDuration(sec) {
  const s = Math.abs(Math.round(sec));
  const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const bits = [];
  if (d) bits.push(`${d}d`);
  if (d || h) bits.push(`${h}h`);
  if (d || h || m) bits.push(`${m}m`);
  bits.push(`${r}s`);
  return bits.join(' ');
}
export { fmtDuration };

const isNumericDate = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Human-readable view of the time claims and optional expected iss / aud / sub,
 * evaluated at `nowSec`. Independent of the signature result.
 * options: { leeway (seconds), iss, aud, sub } (empty expectations are skipped).
 */
export function analyzeClaims(payload, nowSec = Math.floor(Date.now() / 1000), options = {}) {
  const notes = [];
  const leeway = Number.isFinite(Number(options.leeway)) ? Math.max(0, Number(options.leeway)) : 0;
  const fmt = (t) => { try { return new Date(t * 1000).toISOString().replace('.000', ''); } catch { return String(t); } };
  const bad = (claim, label, v) => notes.push({ claim, label, when: String(JSON.stringify(v)), ok: false, detail: `invalid: must be a number (NumericDate), got ${typeof v === 'string' ? `string "${v}"` : typeof v}` });

  if ('exp' in payload) {
    const v = payload.exp;
    if (!isNumericDate(v)) bad('exp', 'Expires', v);
    else {
      const ok = nowSec - leeway < v;
      notes.push({ claim: 'exp', label: 'Expires', when: fmt(v), ok, detail: v > nowSec ? `in ${v - nowSec}s` : `expired ${nowSec - v}s ago${ok ? ' (within leeway)' : ''}`, human: fmtDuration(v - nowSec) });
    }
  }
  if ('nbf' in payload) {
    const v = payload.nbf;
    if (!isNumericDate(v)) bad('nbf', 'Not before', v);
    else {
      const ok = v - leeway <= nowSec;
      notes.push({ claim: 'nbf', label: 'Not before', when: fmt(v), ok, detail: v <= nowSec ? 'active' : `not valid for ${v - nowSec}s${ok ? ' (within leeway)' : ''}`, human: fmtDuration(v - nowSec) });
    }
  }
  if ('iat' in payload) {
    const v = payload.iat;
    if (!isNumericDate(v)) bad('iat', 'Issued at', v);
    else {
      const ok = v - leeway <= nowSec;
      notes.push({ claim: 'iat', label: 'Issued at', when: fmt(v), ok, detail: v <= nowSec ? `${Math.max(0, nowSec - v)}s ago` : `${v - nowSec}s in the future`, human: fmtDuration(nowSec - v) });
    }
  }

  const expect = (claim, label, wanted, check) => {
    if (wanted === undefined || wanted === null || String(wanted).trim() === '') return;
    const w = String(wanted).trim();
    if (!(claim in payload)) { notes.push({ claim, label, when: '(missing)', ok: false, detail: `claim missing, expected "${w}"` }); return; }
    const got = payload[claim];
    const ok = check(got, w);
    notes.push({ claim, label, when: Array.isArray(got) ? got.join(', ') : String(got), ok, detail: ok ? 'matches' : `expected "${w}"` });
  };
  expect('iss', 'Issuer', options.iss, (got, w) => got === w);
  expect('aud', 'Audience', options.aud, (got, w) => (Array.isArray(got) ? got.includes(w) : got === w));
  expect('sub', 'Subject', options.sub, (got, w) => got === w);
  return notes;
}

/** Security warnings about the header (alg casing, jku/x5u/kid risks, embedded keys). */
export function headerWarnings(header) {
  const w = [];
  const alg = header?.alg;
  if (typeof alg === 'string') {
    if (alg.toLowerCase() === 'none' && alg !== 'none') w.push(`alg "${alg}" is a casing variant of "none": a classic bypass of naive "none" filters. Reject it.`);
    else if (alg !== 'none' && !(alg in ALG_FAMILY) && ALG_LOWER[alg.toLowerCase()]) w.push(`alg "${alg}" differs only by case from "${ALG_LOWER[alg.toLowerCase()]}". Algorithm names are case-sensitive; strict verifiers must reject it.`);
  } else if (alg !== undefined) w.push('alg is not a string.');
  if ('jku' in header) w.push(`jku header present (${String(header.jku).slice(0, 80)}): the token tells the verifier where to fetch keys. Only fetch from an allow-listed URL; attacker-controlled jku is a known key-substitution attack.`);
  if ('x5u' in header) w.push(`x5u header present (${String(header.x5u).slice(0, 80)}): same risk as jku.`);
  if ('jwk' in header) w.push('jwk header embeds a public key in the token itself. Never trust an embedded key without pinning.');
  if ('x5c' in header) w.push('x5c header embeds a certificate chain in the token. Do not trust it without validating the chain to a pinned root.');
  if ('kid' in header) {
    const kid = String(header.kid);
    if (/[\\/]|\.\.|['"`;|&<>$]|\s|--/.test(kid)) w.push(`kid "${kid.slice(0, 60)}" contains path, quote or SQL/shell characters: it must never be used in a file path, query or command.`);
  }
  return w;
}

// ---------------------------------------------------------------------------
// Algorithm tables
// ---------------------------------------------------------------------------

const HMAC_HASH = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
const RSA_HASH = { RS256: 'SHA-256', RS384: 'SHA-384', RS512: 'SHA-512', PS256: 'SHA-256', PS384: 'SHA-384', PS512: 'SHA-512' };
const EC_PARAMS = { ES256: { namedCurve: 'P-256', hash: 'SHA-256', size: 32 }, ES384: { namedCurve: 'P-384', hash: 'SHA-384', size: 48 }, ES512: { namedCurve: 'P-521', hash: 'SHA-512', size: 66 } };
const SALT = { PS256: 32, PS384: 48, PS512: 64 };
const ALG_FAMILY = Object.fromEntries([...Object.keys(HMAC_HASH), ...Object.keys(RSA_HASH), ...Object.keys(EC_PARAMS), 'EdDSA', 'none'].map((a) => [a, true]));
const ALG_LOWER = Object.fromEntries(Object.keys(ALG_FAMILY).map((a) => [a.toLowerCase(), a]));

/** Algorithms the Sign tab can produce. */
export const SIGN_ALGS = [...Object.keys(HMAC_HASH), ...Object.keys(RSA_HASH), ...Object.keys(EC_PARAMS), 'EdDSA'];

let ed25519Probe = null;
/** Runtime feature check: does this browser's Web Crypto support Ed25519? */
export function supportsEd25519() {
  if (!ed25519Probe) {
    ed25519Probe = (async () => {
      try { await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']); return true; } catch { return false; }
    })();
  }
  return ed25519Probe;
}

// ---------------------------------------------------------------------------
// Key handling
// ---------------------------------------------------------------------------

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

const looksLikePem = (s) => /-----BEGIN [A-Z0-9 ]+-----/.test(s);

/** Decode an HS secret typed as text / hex / base64 / base64url into bytes. */
export function secretToBytes(input, encoding = 'text') {
  if (encoding === 'text') return new TextEncoder().encode(input);
  const clean = String(input).replace(/\s+/g, '');
  if (encoding === 'hex') {
    const h = clean.replace(/^0x/i, '');
    if (h.length === 0 || h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error('Secret is not valid hex (need an even number of 0-9 a-f characters).');
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  if (encoding === 'base64' || encoding === 'base64url') {
    try { return b64urlToBytes(clean); } catch { throw new Error(`Secret is not valid ${encoding}.`); }
  }
  throw new Error(`Unknown secret encoding: ${encoding}`);
}

/** Remove private members from a JWK so it can be imported for verification. */
function publicJwk(jwk) {
  const out = { ...jwk };
  for (const k of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'key_ops', 'use', 'alg']) delete out[k];
  return out;
}

/**
 * Pick a key from a JWKS by the token header's `kid`.
 * Returns { jwk } or { error }.
 */
export function selectJwk(jwks, header) {
  const keys = Array.isArray(jwks?.keys) ? jwks.keys : [];
  if (keys.length === 0) return { error: 'The JWKS contains no keys.' };
  const kid = header?.kid;
  const ids = keys.map((k) => k.kid).filter((x) => x !== undefined);
  if (kid !== undefined) {
    const hit = keys.find((k) => k.kid === kid);
    if (hit) return { jwk: hit, note: `Selected JWKS key kid "${kid}".` };
    return { error: `No key in the JWKS has kid "${kid}". Available kids: ${ids.length ? ids.join(', ') : '(none have a kid)'}.` };
  }
  if (keys.length === 1) return { jwk: keys[0], note: 'Token has no kid; used the only key in the JWKS.' };
  return { error: `The token header has no "kid" and the JWKS has ${keys.length} keys (${ids.length ? ids.join(', ') : 'none have a kid'}), so the key cannot be chosen. Paste a single key instead.` };
}

function parseJsonKey(text) {
  try { return JSON.parse(text); } catch { throw new Error('Key looks like JSON but is not valid JSON.'); }
}

async function importVerifyKey(alg, keyInput, header, enc) {
  const subtle = crypto.subtle;
  const trimmed = keyInput.trim();
  const notes = [];
  let jwk = null;
  if (trimmed.startsWith('{')) {
    const parsed = parseJsonKey(trimmed);
    if (Array.isArray(parsed.keys)) {
      const sel = selectJwk(parsed, header);
      if (sel.error) throw new Error(sel.error);
      jwk = sel.jwk; notes.push(sel.note);
    } else jwk = parsed;
  }
  if (alg in HMAC_HASH) {
    let bytes;
    if (jwk) {
      if (jwk.kty !== 'oct' || typeof jwk.k !== 'string') throw new Error('HS* needs an "oct" JWK with a "k" member.');
      bytes = b64urlToBytes(jwk.k);
    } else bytes = secretToBytes(keyInput, enc);
    return { key: await subtle.importKey('raw', bytes, { name: 'HMAC', hash: HMAC_HASH[alg] }, false, ['verify']), notes };
  }
  if (!jwk && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed)) throw new Error('That is a private key. Paste the public key (PEM SPKI or certificate) or a public JWK.');
  let spki = null;
  if (!jwk) {
    if (!looksLikePem(trimmed)) throw new Error('Key is not PEM or JSON. Paste a PEM public key, certificate, JWK or JWKS.');
    if (/BEGIN CERTIFICATE/.test(trimmed)) {
      spki = parseCertificate(toDER(trimmed)).spkiDer; notes.push('Used the public key of the pasted certificate.');
    } else if (/BEGIN PUBLIC KEY/.test(trimmed)) spki = pemToArrayBuffer(trimmed);
    else if (/BEGIN RSA PUBLIC KEY/.test(trimmed)) throw new Error('PKCS#1 "RSA PUBLIC KEY" is not supported. Convert: openssl rsa -RSAPublicKey_in -pubout.');
    else throw new Error('Unsupported PEM block; expected PUBLIC KEY or CERTIFICATE.');
  } else if (jwk.kty && ((alg in RSA_HASH && jwk.kty !== 'RSA') || (alg in EC_PARAMS && jwk.kty !== 'EC') || (alg === 'EdDSA' && jwk.kty !== 'OKP'))) {
    throw new Error(`Key type ${jwk.kty} does not match alg ${alg}.`);
  }
  const imp = (algo) => (jwk ? subtle.importKey('jwk', publicJwk(jwk), algo, false, ['verify']) : subtle.importKey('spki', spki, algo, false, ['verify']));
  if (alg in RSA_HASH) return { key: await imp({ name: alg.startsWith('PS') ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5', hash: RSA_HASH[alg] }), notes };
  if (alg in EC_PARAMS) {
    if (jwk && jwk.crv && jwk.crv !== EC_PARAMS[alg].namedCurve) throw new Error(`Key curve ${jwk.crv} does not match ${alg} (needs ${EC_PARAMS[alg].namedCurve}).`);
    return { key: await imp({ name: 'ECDSA', namedCurve: EC_PARAMS[alg].namedCurve }), notes };
  }
  if (alg === 'EdDSA') {
    if (jwk && jwk.crv && jwk.crv !== 'Ed25519') throw new Error(`EdDSA curve ${jwk.crv} is not supported by Web Crypto (only Ed25519).`);
    return { key: await imp({ name: 'Ed25519' }), notes };
  }
  throw new Error(`Unsupported algorithm: ${alg}`);
}

/**
 * Verify a decoded token's signature. `keyInput` is the HMAC secret (HS), or a
 * PEM public key / certificate / JWK / JWKS (RS / PS / ES / EdDSA).
 * options: { secretEncoding: 'text'|'hex'|'base64'|'base64url' }
 * Returns { ok, alg, reason, warnings, notes }.
 */
export async function verifyJwt(decoded, keyInput, options = {}) {
  const alg = decoded.header?.alg;
  const warnings = headerWarnings(decoded.header || {});
  const fail = (reason, extra = {}) => ({ ok: false, alg, reason, warnings, notes: [], ...extra });
  if (!alg) return fail('No "alg" in header.');
  if (typeof alg === 'string' && alg.toLowerCase() === 'none') return fail(`"alg":"${alg}" is an unsigned token. Never accept these in production.`);
  if (typeof alg !== 'string' || !(alg in HMAC_HASH || alg in RSA_HASH || alg in EC_PARAMS || alg === 'EdDSA')) {
    return fail(`Algorithm ${typeof alg === 'string' ? alg : JSON.stringify(alg)} not supported by this tool.`);
  }
  if (!keyInput || !keyInput.trim()) return fail('Provide a secret (HS*) or public key (RS*/PS*/ES*/EdDSA) to verify.');
  if (alg === 'EdDSA' && !(await supportsEd25519())) return fail('EdDSA (Ed25519) is not supported by this browser\'s Web Crypto. Try a current Chrome, Edge, Safari or Firefox.');
  if (alg in HMAC_HASH && looksLikePem(keyInput)) {
    warnings.push('HS* token checked against a PEM-looking key. If a server verifies HS tokens with its RSA/EC public key as the HMAC secret, anyone can forge tokens (algorithm confusion). The PEM text was used as the secret as typed.');
  }
  let sig; let signingInput;
  try {
    sig = b64urlToBytes(decoded.signature);
    signingInput = new TextEncoder().encode(`${decoded.parts[0]}.${decoded.parts[1]}`);
  } catch (e) { return fail(`Signature segment is not valid base64url: ${e.message}`); }
  if (alg in EC_PARAMS && sig.length !== EC_PARAMS[alg].size * 2) {
    return fail(`${alg} signatures must be ${EC_PARAMS[alg].size * 2} bytes (r||s); this one is ${sig.length}. It may be DER-encoded, which JWS does not allow.`);
  }
  try {
    const { key, notes } = await importVerifyKey(alg, keyInput, decoded.header, options.secretEncoding || 'text');
    let verifyAlgo;
    if (alg in HMAC_HASH) verifyAlgo = { name: 'HMAC' };
    else if (alg.startsWith('PS')) verifyAlgo = { name: 'RSA-PSS', saltLength: SALT[alg] };
    else if (alg.startsWith('RS')) verifyAlgo = { name: 'RSASSA-PKCS1-v1_5' };
    else if (alg === 'EdDSA') verifyAlgo = { name: 'Ed25519' };
    else verifyAlgo = { name: 'ECDSA', hash: EC_PARAMS[alg].hash };
    const ok = await crypto.subtle.verify(verifyAlgo, key, sig, signingInput);
    return { ok, alg, reason: ok ? 'Signature valid.' : 'Signature does NOT match.', warnings, notes };
  } catch (e) {
    return fail(`Verification error: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

async function importSignKey(alg, keyInput, enc) {
  const subtle = crypto.subtle;
  const trimmed = keyInput.trim();
  if (alg in HMAC_HASH) {
    let bytes;
    if (trimmed.startsWith('{')) {
      const jwk = parseJsonKey(trimmed);
      if (jwk.kty !== 'oct' || typeof jwk.k !== 'string') throw new Error('HS* needs an "oct" JWK with a "k" member.');
      bytes = b64urlToBytes(jwk.k);
    } else bytes = secretToBytes(keyInput, enc);
    if (bytes.length === 0) throw new Error('Secret is empty.');
    return subtle.importKey('raw', bytes, { name: 'HMAC', hash: HMAC_HASH[alg] }, false, ['sign']);
  }
  const algo = alg in RSA_HASH
    ? { name: alg.startsWith('PS') ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5', hash: RSA_HASH[alg] }
    : alg in EC_PARAMS ? { name: 'ECDSA', namedCurve: EC_PARAMS[alg].namedCurve } : { name: 'Ed25519' };
  if (trimmed.startsWith('{')) {
    const jwk = parseJsonKey(trimmed);
    if (!jwk.d) throw new Error('This JWK has no private member "d"; signing needs a private key.');
    const clean = { ...jwk }; delete clean.key_ops; delete clean.use; delete clean.alg;
    return subtle.importKey('jwk', clean, algo, false, ['sign']);
  }
  if (/BEGIN PRIVATE KEY/.test(trimmed)) return subtle.importKey('pkcs8', pemToArrayBuffer(trimmed), algo, false, ['sign']);
  if (/BEGIN (RSA|EC) PRIVATE KEY/.test(trimmed)) throw new Error('Traditional RSA/EC private keys are not supported. Convert to PKCS#8: openssl pkcs8 -topk8 -nocrypt -in key.pem');
  if (/ENCRYPTED PRIVATE KEY/.test(trimmed)) throw new Error('Encrypted private keys are not supported. Decrypt first (openssl pkcs8 -in key.pem -out plain.pem).');
  throw new Error('Key must be a PKCS#8 PEM private key ("BEGIN PRIVATE KEY") or a private JWK.');
}

/**
 * Create a signed token. `header` and `payload` are objects (or JSON strings);
 * header.alg is forced to `alg`. `key` is a secret (HS*), PKCS#8 PEM or private JWK.
 * alg "none" yields an unsigned token (empty third segment) for testing only.
 */
export async function signJwt({ alg, header = {}, payload = {}, key = '', secretEncoding = 'text' }) {
  const parse = (v, what) => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { throw new Error(`${what} is not valid JSON.`); }
  };
  const h = parse(header, 'Header');
  const p = parse(payload, 'Payload');
  if (!isPlainObject(h)) throw new Error('Header must be a JSON object.');
  if (!isPlainObject(p)) throw new Error('Payload must be a JSON object.');
  const fullHeader = { ...h, alg };
  const enc = new TextEncoder();
  const signingInput = `${bytesToB64url(enc.encode(JSON.stringify(fullHeader)))}.${bytesToB64url(enc.encode(JSON.stringify(p)))}`;
  if (alg === 'none') return `${signingInput}.`;
  if (!SIGN_ALGS.includes(alg)) throw new Error(`Unsupported algorithm: ${alg}`);
  if (!key || !key.trim()) throw new Error(alg in HMAC_HASH ? 'Enter a secret.' : 'Enter a private key (PKCS#8 PEM or JWK).');
  if (alg === 'EdDSA' && !(await supportsEd25519())) throw new Error('EdDSA (Ed25519) is not supported by this browser\'s Web Crypto.');
  const k = await importSignKey(alg, key, secretEncoding);
  let signAlgo;
  if (alg in HMAC_HASH) signAlgo = { name: 'HMAC' };
  else if (alg.startsWith('PS')) signAlgo = { name: 'RSA-PSS', saltLength: SALT[alg] };
  else if (alg.startsWith('RS')) signAlgo = { name: 'RSASSA-PKCS1-v1_5' };
  else if (alg === 'EdDSA') signAlgo = { name: 'Ed25519' };
  else signAlgo = { name: 'ECDSA', hash: EC_PARAMS[alg].hash };
  const sig = new Uint8Array(await crypto.subtle.sign(signAlgo, k, enc.encode(signingInput)));
  return `${signingInput}.${bytesToB64url(sig)}`;
}

// ---------------------------------------------------------------------------
// JWKS fetching (caller supplies the fetch function, e.g. proxiedFetch)
// ---------------------------------------------------------------------------

function assertHttps(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error(`Not a valid URL: ${url}`); }
  if (u.protocol !== 'https:') throw new Error('Only https:// URLs are fetched.');
  return u.toString();
}

/** Fetch and validate a JWKS document from `url`. */
export async function fetchJwks(url, fetchImpl) {
  const target = assertHttps(url);
  const resp = await fetchImpl(target, { headers: { accept: 'application/json' } });
  if (!resp.ok) throw new Error(`JWKS request failed: HTTP ${resp.status}.`);
  let doc;
  try { doc = JSON.parse(await resp.text()); } catch { throw new Error('JWKS response was not JSON.'); }
  if (!doc || !Array.isArray(doc.keys)) throw new Error('Response is JSON but has no "keys" array, so it is not a JWKS.');
  return doc;
}

/** Fetch the JWKS for an issuer via OIDC discovery, falling back to /.well-known/jwks.json. */
export async function fetchJwksForIssuer(iss, fetchImpl) {
  const base = assertHttps(String(iss)).replace(/\/+$/, '');
  try {
    const resp = await fetchImpl(`${base}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
    if (resp.ok) {
      const conf = JSON.parse(await resp.text());
      if (conf.jwks_uri) return { jwks: await fetchJwks(conf.jwks_uri, fetchImpl), url: conf.jwks_uri };
    }
  } catch { /* fall through to the well-known JWKS path */ }
  const url = `${base}/.well-known/jwks.json`;
  return { jwks: await fetchJwks(url, fetchImpl), url };
}
