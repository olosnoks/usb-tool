// Dependency-free JWT decoding and signature verification (jwt.io-style),
// using the Web Crypto API. Fully client-side; nothing is sent anywhere.

/** base64url -> Uint8Array. */
export function b64urlToBytes(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64url -> UTF-8 string. */
export function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

/**
 * Split and decode a JWT into { header, payload, signature, parts, raw }.
 * Throws if the structure is not three dot-separated segments or the header /
 * payload are not valid JSON.
 */
export function decodeJwt(token) {
  const raw = (token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 3) throw new Error(`Expected 3 segments (header.payload.signature), got ${parts.length}.`);
  let header; let payload;
  try { header = JSON.parse(b64urlToString(parts[0])); } catch { throw new Error('Header is not valid base64url JSON.'); }
  try { payload = JSON.parse(b64urlToString(parts[1])); } catch { throw new Error('Payload is not valid base64url JSON.'); }
  return { header, payload, signature: parts[2], parts, raw };
}

/** Human-readable view of the standard time claims, with validity against now. */
export function analyzeClaims(payload, nowSec = Math.floor(Date.now() / 1000)) {
  const notes = [];
  const fmt = (t) => new Date(t * 1000).toISOString().replace('.000', '');
  if (typeof payload.exp === 'number') {
    notes.push({ claim: 'exp', label: 'Expires', when: fmt(payload.exp), ok: payload.exp > nowSec, detail: payload.exp > nowSec ? `in ${payload.exp - nowSec}s` : `expired ${nowSec - payload.exp}s ago` });
  }
  if (typeof payload.nbf === 'number') {
    notes.push({ claim: 'nbf', label: 'Not before', when: fmt(payload.nbf), ok: payload.nbf <= nowSec, detail: payload.nbf <= nowSec ? 'active' : `not valid for ${payload.nbf - nowSec}s` });
  }
  if (typeof payload.iat === 'number') {
    notes.push({ claim: 'iat', label: 'Issued at', when: fmt(payload.iat), ok: true, detail: `${Math.max(0, nowSec - payload.iat)}s ago` });
  }
  return notes;
}

const HMAC_HASH = { HS256: 'SHA-256', HS384: 'SHA-384', HS512: 'SHA-512' };
const RSA_HASH = { RS256: 'SHA-256', RS384: 'SHA-384', RS512: 'SHA-512', PS256: 'SHA-256', PS384: 'SHA-384', PS512: 'SHA-512' };
const EC_PARAMS = { ES256: { namedCurve: 'P-256', hash: 'SHA-256' }, ES384: { namedCurve: 'P-384', hash: 'SHA-384' }, ES512: { namedCurve: 'P-521', hash: 'SHA-512' } };

function pemToArrayBuffer(pem) {
  const b64 = pem.replace(/-----BEGIN [^-]+-----/g, '').replace(/-----END [^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

async function importKey(alg, keyInput) {
  const subtle = crypto.subtle;
  if (alg in HMAC_HASH) {
    return subtle.importKey('raw', new TextEncoder().encode(keyInput), { name: 'HMAC', hash: HMAC_HASH[alg] }, false, ['verify']);
  }
  const trimmed = keyInput.trim();
  const isJwk = trimmed.startsWith('{');
  if (alg in RSA_HASH) {
    const name = alg.startsWith('PS') ? 'RSA-PSS' : 'RSASSA-PKCS1-v1_5';
    const algo = { name, hash: RSA_HASH[alg] };
    if (isJwk) return subtle.importKey('jwk', JSON.parse(trimmed), algo, false, ['verify']);
    return subtle.importKey('spki', pemToArrayBuffer(trimmed), algo, false, ['verify']);
  }
  if (alg in EC_PARAMS) {
    const algo = { name: 'ECDSA', namedCurve: EC_PARAMS[alg].namedCurve };
    if (isJwk) return subtle.importKey('jwk', JSON.parse(trimmed), algo, false, ['verify']);
    return subtle.importKey('spki', pemToArrayBuffer(trimmed), algo, false, ['verify']);
  }
  throw new Error(`Unsupported algorithm: ${alg}`);
}

/**
 * Verify a decoded token's signature. `keyInput` is the HMAC secret (HS), or a
 * PEM/JWK public key (RS / PS / ES). Returns { ok, alg, reason }.
 */
export async function verifyJwt(decoded, keyInput) {
  const alg = decoded.header?.alg;
  if (!alg) return { ok: false, alg, reason: 'No "alg" in header.' };
  if (alg === 'none') return { ok: false, alg, reason: '"alg":"none" — unsigned token. Never accept these in production.' };
  if (!(alg in HMAC_HASH) && !(alg in RSA_HASH) && !(alg in EC_PARAMS)) {
    return { ok: false, alg, reason: `Algorithm ${alg} not supported by this tool.` };
  }
  if (!keyInput || !keyInput.trim()) return { ok: false, alg, reason: 'Provide a secret (HS*) or public key (RS*/ES*/PS*) to verify.' };
  const signingInput = new TextEncoder().encode(`${decoded.parts[0]}.${decoded.parts[1]}`);
  const sig = b64urlToBytes(decoded.signature);
  try {
    const key = await importKey(alg, keyInput);
    let verifyAlgo;
    if (alg in HMAC_HASH) verifyAlgo = { name: 'HMAC' };
    else if (alg.startsWith('PS')) verifyAlgo = { name: 'RSA-PSS', saltLength: { PS256: 32, PS384: 48, PS512: 64 }[alg] };
    else if (alg.startsWith('RS')) verifyAlgo = { name: 'RSASSA-PKCS1-v1_5' };
    else verifyAlgo = { name: 'ECDSA', hash: EC_PARAMS[alg].hash };
    const ok = await crypto.subtle.verify(verifyAlgo, key, sig, signingInput);
    return { ok, alg, reason: ok ? 'Signature valid.' : 'Signature does NOT match.' };
  } catch (e) {
    return { ok: false, alg, reason: `Verification error: ${e.message}` };
  }
}
