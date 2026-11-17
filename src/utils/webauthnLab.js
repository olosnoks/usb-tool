/**
 * webauthnLab.js - a WebAuthn (navigator.credentials) test bench for security keys.
 *
 * Unlike the WebHID reader in fido2Driver.js this goes through the browser's own WebAuthn stack, so it works
 * with the normal (blocklisted) HID setup and needs no --disable-hid-blocklist flag. This module holds the
 * pure parts (option builders, attestation / authenticatorData / COSE / X.509 decoders, capability checks)
 * so they can be unit tested; the page wires them to navigator.credentials.
 *
 * Safety rules enforced here:
 *  - the RP ID is always the page's own hostname (callers cannot override it);
 *  - a discoverable (resident) credential is only requested when `discoverable` is true AND `confirmed` is
 *    true, because it consumes one of the key's limited credential slots.
 */
import { decodeCbor, aaguidToString, aaguidName, coseAlgName } from './fido2Driver';

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function currentRpId() {
  if (typeof location === 'undefined' || !location.hostname) throw new Error('WebAuthn needs a page with a hostname (https:// or localhost).');
  return location.hostname;
}

function randomBytes(n) {
  if (!(typeof crypto !== 'undefined' && crypto.getRandomValues)) throw new Error('This browser has no secure random source.');
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * PublicKeyCredentialCreationOptions for a throw-away test credential.
 * @param {{discoverable?: boolean, confirmed?: boolean, userVerification?: string, attestation?: string,
 *          timeoutMs?: number, hostname?: string, challenge?: Uint8Array}} o
 */
export function buildCreateOptions(o = {}) {
  const discoverable = !!o.discoverable;
  if (discoverable && !o.confirmed) throw new Error('A discoverable credential uses up a slot on the key. Confirm it first.');
  const rpId = currentRpId(); // never taken from the caller
  const userId = randomBytes(16);
  return {
    publicKey: {
      rp: { id: rpId, name: 'Skon USB Tool WebAuthn lab' },
      user: { id: userId, name: 'lab-test-user', displayName: 'Lab test user' },
      challenge: o.challenge || randomBytes(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }, { type: 'public-key', alg: -8 }],
      authenticatorSelection: {
        residentKey: discoverable ? 'required' : 'discouraged',
        requireResidentKey: discoverable,
        userVerification: o.userVerification || 'discouraged'
      },
      attestation: o.attestation || 'direct',
      timeout: o.timeoutMs || 60000
    }
  };
}

/** Assertion options; `credentialId` (Uint8Array) restricts to the credential made by the lab, else any resident key. */
export function buildGetOptions(o = {}) {
  const rpId = currentRpId();
  const publicKey = {
    rpId,
    challenge: o.challenge || randomBytes(32),
    userVerification: o.userVerification || 'discouraged',
    timeout: o.timeoutMs || 60000
  };
  if (o.credentialId) publicKey.allowCredentials = [{ type: 'public-key', id: o.credentialId }];
  return { publicKey };
}

/** What this browser / OS offers for WebAuthn. Each entry is a real answer from the browser or `null` if it cannot say. */
export async function checkCapabilities(env = globalThis) {
  const PKC = env.PublicKeyCredential;
  const out = { webauthn: !!PKC, platformAuthenticator: null, conditionalMediation: null, clientCapabilities: null, secureContext: env.isSecureContext ?? null };
  if (!PKC) return out;
  const ask = async (fn) => { try { return typeof fn === 'function' ? await fn.call(PKC) : null; } catch { return null; } };
  out.platformAuthenticator = await ask(PKC.isUserVerifyingPlatformAuthenticatorAvailable);
  out.conditionalMediation = await ask(PKC.isConditionalMediationAvailable);
  out.clientCapabilities = await ask(PKC.getClientCapabilities);
  return out;
}

// --- authenticatorData ------------------------------------------------------

export function decodeFlags(f) {
  return {
    raw: f,
    UP: !!(f & 0x01), UV: !!(f & 0x04), BE: !!(f & 0x08), BS: !!(f & 0x10), AT: !!(f & 0x40), ED: !!(f & 0x80)
  };
}

/** COSE_Key (Map) -> readable fields. */
export function describeCoseKey(map) {
  if (!(map instanceof Map)) return null;
  const kty = map.get(1);
  const alg = map.get(3);
  const crv = map.get(-1);
  const KTY = { 1: 'OKP', 2: 'EC2', 3: 'RSA' };
  const CRV = { 1: 'P-256', 2: 'P-384', 3: 'P-521', 6: 'Ed25519' };
  const out = { kty: KTY[kty] || String(kty), alg, algName: alg != null ? coseAlgName(alg) : null };
  if (kty === 3) {
    out.n = map.get(-1) instanceof Uint8Array ? hex(map.get(-1)) : null;
    out.e = map.get(-2) instanceof Uint8Array ? hex(map.get(-2)) : null;
  } else {
    out.crv = CRV[crv] || String(crv);
    out.x = map.get(-2) instanceof Uint8Array ? hex(map.get(-2)) : null;
    if (map.get(-3) instanceof Uint8Array) out.y = hex(map.get(-3));
  }
  return out;
}

/** Decode authenticatorData bytes. Throws a plain Error with a readable message when it is malformed. */
export function decodeAuthenticatorData(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 37) throw new Error('authenticatorData is shorter than 37 bytes.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = decodeFlags(bytes[32]);
  const out = { rpIdHash: hex(bytes.subarray(0, 32)), flags, signCount: dv.getUint32(33, false), attestedCredential: null, extensions: null };
  let o = 37;
  if (flags.AT) {
    if (bytes.length < o + 18) throw new Error('attested credential data is truncated.');
    const aaguid = aaguidToString(bytes.subarray(o, o + 16));
    const idLen = dv.getUint16(o + 16, false);
    o += 18;
    if (bytes.length < o + idLen) throw new Error('credential ID is truncated.');
    const credentialId = bytes.slice(o, o + idLen);
    o += idLen;
    const key = decodeCbor(bytes, o);
    o = key.offset;
    out.attestedCredential = { aaguid, aaguidName: aaguidName(aaguid), credentialId: hex(credentialId), credentialIdLength: idLen, publicKey: describeCoseKey(key.value) };
  }
  if (flags.ED) {
    const ext = decodeCbor(bytes, o);
    out.extensions = ext.value instanceof Map ? Object.fromEntries(ext.value) : ext.value;
  }
  return out;
}

// --- X.509 (just enough for attestation certificates) -----------------------

function tlv(b, o) {
  if (o + 2 > b.length) throw new Error('certificate is truncated.');
  const tag = b[o];
  let len = b[o + 1];
  let hl = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4 || o + 2 + n > b.length) throw new Error('certificate has a bad length.');
    len = 0;
    for (let i = 0; i < n; i++) len = (len * 256) + b[o + 2 + i];
    hl = 2 + n;
  }
  if (o + hl + len > b.length) throw new Error('certificate is truncated.');
  return { tag, start: o + hl, end: o + hl + len, next: o + hl + len };
}

const OID_NAMES = { '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST', '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber' };

function oidString(b, t) {
  const bytes = b.subarray(t.start, t.end);
  if (!bytes.length) return '';
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let v = 0;
  for (let i = 1; i < bytes.length; i++) {
    v = (v * 128) + (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) { parts.push(v); v = 0; }
  }
  return parts.join('.');
}

function parseName(b, t) {
  const rdns = [];
  let o = t.start;
  while (o < t.end) {
    const set = tlv(b, o);
    let p = set.start;
    while (p < set.end) {
      const seq = tlv(b, p);
      const oid = tlv(b, seq.start);
      const val = tlv(b, oid.next);
      const text = new TextDecoder().decode(b.subarray(val.start, val.end));
      const oidStr = oidString(b, oid);
      rdns.push(`${OID_NAMES[oidStr] || oidStr}=${text}`);
      p = seq.next;
    }
    o = set.next;
  }
  return rdns.join(', ');
}

function parseTime(b, t) {
  const s = new TextDecoder().decode(b.subarray(t.start, t.end));
  const m = t.tag === 0x17 ? s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/) : s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/);
  if (!m) return s;
  let y = Number(m[1]);
  if (t.tag === 0x17) y += y >= 50 ? 1900 : 2000;
  return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0))).toISOString();
}

/** Subject, issuer and validity of a DER X.509 certificate. Throws Error('...') when malformed. */
export function parseCertificate(der) {
  const cert = tlv(der, 0);
  if (cert.tag !== 0x30) throw new Error('certificate is not a DER SEQUENCE.');
  const tbs = tlv(der, cert.start);
  let o = tbs.start;
  let t = tlv(der, o);
  if (t.tag === 0xa0) { o = t.next; t = tlv(der, o); } // version
  const serial = hex(der.subarray(t.start, t.end));
  t = tlv(der, t.next); // signature algorithm
  const issuer = tlv(der, t.next);
  const validity = tlv(der, issuer.next);
  const subject = tlv(der, validity.next);
  const nb = tlv(der, validity.start);
  const na = tlv(der, nb.next);
  return { serial, issuer: parseName(der, issuer), subject: parseName(der, subject), notBefore: parseTime(der, nb), notAfter: parseTime(der, na) };
}

// --- attestation object -----------------------------------------------------

/** Decode a WebAuthn attestationObject. Never throws: malformed input yields `{ error }`. */
export function decodeAttestationObject(bytes) {
  try {
    const { value: map } = decodeCbor(bytes);
    if (!(map instanceof Map)) throw new Error('attestationObject is not a CBOR map.');
    const fmt = map.get('fmt');
    const attStmt = map.get('attStmt');
    const authData = map.get('authData');
    if (typeof fmt !== 'string' || !(authData instanceof Uint8Array)) throw new Error('attestationObject lacks fmt / authData.');
    const stmt = { alg: null, algName: null, sigLength: null, x5c: [] };
    if (attStmt instanceof Map) {
      if (attStmt.has('alg')) { stmt.alg = attStmt.get('alg'); stmt.algName = coseAlgName(stmt.alg); }
      if (attStmt.get('sig') instanceof Uint8Array) stmt.sigLength = attStmt.get('sig').length;
      const x5c = attStmt.get('x5c');
      if (Array.isArray(x5c)) {
        for (const der of x5c) {
          try { stmt.x5c.push(parseCertificate(der)); } catch (e) { stmt.x5c.push({ error: e.message }); }
        }
      }
    }
    return { fmt, attStmt: stmt, authData: decodeAuthenticatorData(authData) };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

/** Decode a created PublicKeyCredential (or a mock with the same shape) for display. */
export function describeRegistration(cred) {
  const att = decodeAttestationObject(new Uint8Array(cred.response.attestationObject));
  return {
    id: cred.id,
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? null,
    transports: typeof cred.response.getTransports === 'function' ? cred.response.getTransports() : [],
    attestation: att
  };
}

/** Decode an assertion PublicKeyCredential for display. */
export function describeAssertion(cred) {
  let authData;
  try { authData = decodeAuthenticatorData(new Uint8Array(cred.response.authenticatorData)); } catch (e) { authData = { error: e.message }; }
  return {
    id: cred.id,
    authenticatorAttachment: cred.authenticatorAttachment ?? null,
    authData,
    signatureLength: cred.response.signature ? cred.response.signature.byteLength : null,
    userHandle: cred.response.userHandle ? hex(new Uint8Array(cred.response.userHandle)) : null
  };
}

// --- thin wrappers over navigator.credentials -------------------------------

export async function registerCredential(opts, creds = globalThis.navigator?.credentials) {
  if (!creds) throw new Error('navigator.credentials is not available here (needs a secure context).');
  const cred = await creds.create(buildCreateOptions(opts));
  if (!cred) throw new Error('No credential was created.');
  return { credential: cred, rawId: new Uint8Array(cred.rawId), description: describeRegistration(cred) };
}

export async function authenticateCredential(opts, creds = globalThis.navigator?.credentials) {
  if (!creds) throw new Error('navigator.credentials is not available here (needs a secure context).');
  const cred = await creds.get(buildGetOptions(opts));
  if (!cred) throw new Error('No assertion was returned.');
  return { credential: cred, description: describeAssertion(cred) };
}
