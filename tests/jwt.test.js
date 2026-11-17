import { describe, it, expect } from 'vitest';
import {
  decodeJwt, analyzeClaims, verifyJwt, signJwt, selectJwk, secretToBytes, headerWarnings,
  b64urlToBytes, bytesToB64url, fetchJwks, fetchJwksForIssuer,
} from '../src/utils/jwt.js';

const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
// RFC 7515 appendix A.1 (HS256) and RFC 7519 section 6.1 (unsecured)
const RFC7515_A1 = 'eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC7515_A1_KEY = { kty: 'oct', k: 'AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow' };
const RFC7519_NONE = 'eyJhbGciOiJub25lIn0.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.';

const toPem = (label, buf) => {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/(.{64})/g, '$1\n');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`;
};

async function keyPair(algo, usages = ['sign', 'verify']) {
  const kp = await crypto.subtle.generateKey(algo, true, usages);
  return {
    privPem: toPem('PRIVATE KEY', await crypto.subtle.exportKey('pkcs8', kp.privateKey)),
    pubPem: toPem('PUBLIC KEY', await crypto.subtle.exportKey('spki', kp.publicKey)),
    privJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
    pubJwk: await crypto.subtle.exportKey('jwk', kp.publicKey),
  };
}

const NOW = 1_700_000_000;

describe('decodeJwt', () => {
  it('decodes the sample token and verifies it with the sample secret', async () => {
    const d = decodeJwt(SAMPLE);
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.payload.name).toBe('John Doe');
    const r = await verifyJwt(d, 'your-256-bit-secret');
    expect(r.ok).toBe(true);
    expect((await verifyJwt(d, 'wrong-secret')).ok).toBe(false);
  });

  it('verifies the RFC 7515 A.1 vector with a JWK and rejects a tampered payload', async () => {
    const d = decodeJwt(RFC7515_A1);
    expect(d.payload.iss).toBe('joe');
    expect((await verifyJwt(d, JSON.stringify(RFC7515_A1_KEY))).ok).toBe(true);
    const parts = RFC7515_A1.split('.');
    const forged = decodeJwt(`${parts[0]}.${bytesToB64url(new TextEncoder().encode('{"iss":"eve"}'))}.${parts[2]}`);
    expect((await verifyJwt(forged, JSON.stringify(RFC7515_A1_KEY))).ok).toBe(false);
  });

  it('decodes the RFC 7519 unsecured token and refuses to verify it', async () => {
    const d = decodeJwt(RFC7519_NONE);
    expect(d.header.alg).toBe('none');
    const r = await verifyJwt(d, 'anything');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/unsigned/);
  });

  it('gives a specific message for a 5-part JWE', () => {
    expect(() => decodeJwt('a.b.c.d.e')).toThrow(/JWE/);
    try { decodeJwt('a.b.c.d.e'); } catch (e) { expect(e.code).toBe('JWE'); }
  });

  it('rejects 2 and 4 segments, bad base64, and non-object payloads', () => {
    expect(() => decodeJwt('a.b')).toThrow(/got 2/);
    expect(() => decodeJwt('a.b.c.d')).toThrow(/got 4/);
    expect(() => decodeJwt('!!!.e30.sig')).toThrow(/Header/);
    const enc = (s) => bytesToB64url(new TextEncoder().encode(s));
    expect(() => decodeJwt(`${enc('{"alg":"HS256"}')}.${enc('"str"')}.x`)).toThrow(/not a JSON object/);
    expect(() => decodeJwt(`${enc('{"alg":"HS256"}')}.${enc('[1]')}.x`)).toThrow(/not a JSON object/);
    expect(() => decodeJwt(`${enc('{"alg":"HS256"}')}.${enc('not json')}.x`)).toThrow(/Payload/);
  });
});

describe('analyzeClaims', () => {
  it('flags expired, not-yet-valid and future iat independent of any signature', () => {
    const notes = analyzeClaims({ exp: NOW - 10, nbf: NOW + 60, iat: NOW + 5 }, NOW);
    const by = Object.fromEntries(notes.map((n) => [n.claim, n]));
    expect(by.exp.ok).toBe(false);
    expect(by.exp.detail).toMatch(/expired 10s ago/);
    expect(by.nbf.ok).toBe(false);
    expect(by.iat.ok).toBe(false);
  });

  it('counts down against the supplied clock', () => {
    const p = { exp: NOW + 3725 };
    expect(analyzeClaims(p, NOW)[0].detail).toBe('in 3725s');
    expect(analyzeClaims(p, NOW)[0].human).toBe('1h 2m 5s');
    expect(analyzeClaims(p, NOW + 5)[0].detail).toBe('in 3720s');
    expect(analyzeClaims(p, NOW + 5)[0].human).toBe('1h 2m 0s');
    expect(analyzeClaims(p, NOW + 3725 + 1)[0].ok).toBe(false);
  });

  it('applies leeway', () => {
    expect(analyzeClaims({ exp: NOW - 10 }, NOW, { leeway: 30 })[0].ok).toBe(true);
    expect(analyzeClaims({ exp: NOW - 100 }, NOW, { leeway: 30 })[0].ok).toBe(false);
    expect(analyzeClaims({ nbf: NOW + 20 }, NOW, { leeway: 30 })[0].ok).toBe(true);
  });

  it('checks expected iss / aud / sub per claim', () => {
    const payload = { iss: 'https://a', aud: ['x', 'y'], sub: 'u1' };
    const ok = analyzeClaims(payload, NOW, { iss: 'https://a', aud: 'y', sub: 'u1' });
    expect(ok.map((n) => n.ok)).toEqual([true, true, true]);
    const bad = analyzeClaims(payload, NOW, { iss: 'https://evil', aud: 'z', sub: 'u2' });
    expect(bad.map((n) => n.ok)).toEqual([false, false, false]);
    expect(analyzeClaims({}, NOW, { iss: 'x' })[0]).toMatchObject({ ok: false, when: '(missing)' });
    expect(analyzeClaims(payload, NOW, {})).toEqual([]);
  });

  it('rejects numeric strings and other non-NumericDate values', () => {
    const notes = analyzeClaims({ exp: '1700000000', nbf: null, iat: true }, NOW);
    expect(notes).toHaveLength(3);
    expect(notes.every((n) => n.ok === false && /must be a number/.test(n.detail))).toBe(true);
  });
});

describe('sign + verify round trips', () => {
  const payload = { sub: '42', iss: 'me', aud: 'you', iat: NOW };

  it.each(['HS256', 'HS384', 'HS512'])('%s with text, hex and base64 secrets', async (alg) => {
    const text = 'a-secret-of-reasonable-length';
    const bytes = new TextEncoder().encode(text);
    const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    const b64 = btoa(String.fromCharCode(...bytes));
    for (const [enc, secret] of [['text', text], ['hex', hex], ['base64', b64], ['base64url', bytesToB64url(bytes)]]) {
      const token = await signJwt({ alg, header: { typ: 'JWT' }, payload, key: secret, secretEncoding: enc });
      const d = decodeJwt(token);
      expect(d.header.alg).toBe(alg);
      expect((await verifyJwt(d, secret, { secretEncoding: enc })).ok).toBe(true);
      // the same token verifies with the plain-text secret when decoded bytes match
      expect((await verifyJwt(d, text, { secretEncoding: 'text' })).ok).toBe(true);
    }
    const t = await signJwt({ alg, payload, key: 'k1' });
    expect((await verifyJwt(decodeJwt(t), 'k2')).ok).toBe(false);
  });

  it('accepts an oct JWK as the HS key', async () => {
    const token = await signJwt({ alg: 'HS256', payload, key: JSON.stringify(RFC7515_A1_KEY) });
    expect((await verifyJwt(decodeJwt(token), JSON.stringify(RFC7515_A1_KEY))).ok).toBe(true);
  });

  it('RS256 with PEM keys, and PS256 / ES256 / ES384 / ES512 with JWKs', async () => {
    const rsa = await keyPair({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' });
    const rs = await signJwt({ alg: 'RS256', payload, key: rsa.privPem });
    expect((await verifyJwt(decodeJwt(rs), rsa.pubPem)).ok).toBe(true);
    expect((await verifyJwt(decodeJwt(rs), JSON.stringify(rsa.pubJwk))).ok).toBe(true);
    // a private JWK pasted into the verify box still works (private parts are dropped)
    expect((await verifyJwt(decodeJwt(rs), JSON.stringify(rsa.privJwk))).ok).toBe(true);

    const pss = await keyPair({ name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' });
    const ps = await signJwt({ alg: 'PS256', payload, key: JSON.stringify(pss.privJwk) });
    expect((await verifyJwt(decodeJwt(ps), pss.pubPem)).ok).toBe(true);

    for (const [alg, curve] of [['ES256', 'P-256'], ['ES384', 'P-384'], ['ES512', 'P-521']]) {
      const ec = await keyPair({ name: 'ECDSA', namedCurve: curve });
      const t = await signJwt({ alg, payload, key: ec.privPem });
      const d = decodeJwt(t);
      expect(b64urlToBytes(d.signature).length).toBe({ ES256: 64, ES384: 96, ES512: 132 }[alg]);
      expect((await verifyJwt(d, ec.pubPem)).ok).toBe(true);
      expect((await verifyJwt(d, JSON.stringify(ec.pubJwk))).ok).toBe(true);
      const other = await keyPair({ name: 'ECDSA', namedCurve: curve });
      expect((await verifyJwt(d, other.pubPem)).ok).toBe(false);
    }
  });

  it('EdDSA round trip where Web Crypto supports Ed25519, and a clear message otherwise', async () => {
    let supported = true;
    try { await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']); } catch { supported = false; }
    if (!supported) {
      await expect(signJwt({ alg: 'EdDSA', payload, key: 'x' })).rejects.toThrow(/not supported/);
      return;
    }
    const ed = await keyPair({ name: 'Ed25519' });
    const t = await signJwt({ alg: 'EdDSA', payload, key: ed.privPem });
    expect((await verifyJwt(decodeJwt(t), ed.pubPem)).ok).toBe(true);
    expect((await verifyJwt(decodeJwt(t), JSON.stringify(ed.pubJwk))).ok).toBe(true);
  });

  it('errors clearly for a bad key, a private key in the verify box, and a mismatched key type', async () => {
    const rsa = await keyPair({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' });
    const ec = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const t = decodeJwt(await signJwt({ alg: 'RS256', payload, key: rsa.privPem }));
    expect((await verifyJwt(t, rsa.privPem)).reason).toMatch(/private key/);
    expect((await verifyJwt(t, ec.pubPem)).ok).toBe(false);
    expect((await verifyJwt(t, JSON.stringify(ec.pubJwk))).reason).toMatch(/does not match alg/);
    expect((await verifyJwt(t, 'not a key')).ok).toBe(false);
    await expect(signJwt({ alg: 'RS256', payload, key: rsa.pubPem })).rejects.toThrow();
    await expect(signJwt({ alg: 'RS256', payload, key: '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----' })).rejects.toThrow(/PKCS#8/);
    await expect(signJwt({ alg: 'HS256', header: '{bad', payload, key: 'k' })).rejects.toThrow(/Header is not valid JSON/);
    await expect(signJwt({ alg: 'HS256', payload: '[1]', key: 'k' })).rejects.toThrow(/Payload must be/);
  });

  it('can emit an unsigned token for testing', async () => {
    const t = await signJwt({ alg: 'none', payload });
    expect(t.endsWith('.')).toBe(true);
    expect(decodeJwt(t).header.alg).toBe('none');
  });
});

describe('JWKS key selection', () => {
  it('picks the right key by kid and verifies', async () => {
    const a = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const b = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const jwks = { keys: [{ ...a.pubJwk, kid: 'key-a' }, { ...b.pubJwk, kid: 'key-b' }] };
    const tb = await signJwt({ alg: 'ES256', header: { kid: 'key-b' }, payload: {}, key: b.privPem });
    const ta = await signJwt({ alg: 'ES256', header: { kid: 'key-a' }, payload: {}, key: a.privPem });
    expect((await verifyJwt(decodeJwt(tb), JSON.stringify(jwks))).ok).toBe(true);
    expect((await verifyJwt(decodeJwt(ta), JSON.stringify(jwks))).ok).toBe(true);
    // key-b's token claiming key-a's kid must fail rather than silently succeed
    const swapped = await signJwt({ alg: 'ES256', header: { kid: 'key-a' }, payload: {}, key: b.privPem });
    expect((await verifyJwt(decodeJwt(swapped), JSON.stringify(jwks))).ok).toBe(false);
  });

  it('gives clear messages for an unknown kid and for a missing kid with several keys', async () => {
    const a = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const b = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const jwks = { keys: [{ ...a.pubJwk, kid: 'key-a' }, { ...b.pubJwk, kid: 'key-b' }] };
    const unknown = decodeJwt(await signJwt({ alg: 'ES256', header: { kid: 'nope' }, payload: {}, key: a.privPem }));
    expect((await verifyJwt(unknown, JSON.stringify(jwks))).reason).toMatch(/No key in the JWKS has kid "nope".*key-a, key-b/);
    const nokid = decodeJwt(await signJwt({ alg: 'ES256', payload: {}, key: a.privPem }));
    expect((await verifyJwt(nokid, JSON.stringify(jwks))).reason).toMatch(/no "kid"/);
    // a single-key JWKS needs no kid
    expect((await verifyJwt(nokid, JSON.stringify({ keys: [a.pubJwk] }))).ok).toBe(true);
    expect(selectJwk({ keys: [] }, {}).error).toMatch(/no keys/);
  });

  it('fetches a JWKS through the supplied fetch function (https only) and discovers it from iss', async () => {
    const calls = [];
    const doc = { keys: [{ kty: 'oct', kid: '1', k: 'AA' }] };
    const fetchImpl = async (url) => {
      calls.push(url);
      if (url.endsWith('/.well-known/openid-configuration')) return { ok: true, status: 200, text: async () => JSON.stringify({ jwks_uri: 'https://idp.example/keys' }) };
      if (url === 'https://idp.example/keys') return { ok: true, status: 200, text: async () => JSON.stringify(doc) };
      return { ok: false, status: 404, text: async () => '' };
    };
    expect(await fetchJwks('https://idp.example/keys', fetchImpl)).toEqual(doc);
    const r = await fetchJwksForIssuer('https://idp.example/', fetchImpl);
    expect(r.url).toBe('https://idp.example/keys');
    await expect(fetchJwks('http://idp.example/keys', fetchImpl)).rejects.toThrow(/https/);
    await expect(fetchJwks('https://idp.example/missing', fetchImpl)).rejects.toThrow(/404/);
    expect(calls.every((c) => c.startsWith('https://'))).toBe(true);
  });
});

describe('header warnings and attack patterns', () => {
  it('flags alg casing variants of none and still refuses to verify them', async () => {
    const enc = (o) => bytesToB64url(new TextEncoder().encode(JSON.stringify(o)));
    for (const alg of ['None', 'nOnE', 'NONE']) {
      const d = decodeJwt(`${enc({ alg })}.${enc({ a: 1 })}.`);
      expect(headerWarnings(d.header).join(' ')).toMatch(/casing variant/);
      const r = await verifyJwt(d, 'x');
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/unsigned/);
    }
    expect(headerWarnings({ alg: 'hs256' }).join(' ')).toMatch(/differs only by case/);
    expect(headerWarnings({ alg: 'HS256' })).toEqual([]);
  });

  it('warns on jku, x5u, embedded keys and suspicious kid', () => {
    const w = headerWarnings({ alg: 'RS256', jku: 'https://evil/jwks', x5u: 'https://evil/c.pem', jwk: {}, x5c: [], kid: '../../etc/passwd' });
    expect(w.some((x) => /jku/.test(x))).toBe(true);
    expect(w.some((x) => /x5u/.test(x))).toBe(true);
    expect(w.some((x) => /jwk header/.test(x))).toBe(true);
    expect(w.some((x) => /x5c/.test(x))).toBe(true);
    expect(w.some((x) => /kid/.test(x))).toBe(true);
    expect(headerWarnings({ alg: 'RS256', kid: 'abc-123' })).toEqual([]);
  });

  it('warns when an HS token is checked against a PEM-looking key (algorithm confusion)', async () => {
    const rsa = await keyPair({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' });
    // attacker signs HS256 using the public key text as the secret
    const forged = await signJwt({ alg: 'HS256', payload: { admin: true }, key: rsa.pubPem });
    const r = await verifyJwt(decodeJwt(forged), rsa.pubPem);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/algorithm confusion/);
  });

  it('rejects ECDSA signatures of the wrong length (DER) with an explanation', async () => {
    const ec = await keyPair({ name: 'ECDSA', namedCurve: 'P-256' });
    const t = await signJwt({ alg: 'ES256', payload: {}, key: ec.privPem });
    const parts = t.split('.');
    const d = decodeJwt(`${parts[0]}.${parts[1]}.${bytesToB64url(new Uint8Array(70))}`);
    expect((await verifyJwt(d, ec.pubPem)).reason).toMatch(/64 bytes/);
  });
});

describe('secrets', () => {
  it('decodes hex / base64 / base64url and rejects malformed input', () => {
    expect(Array.from(secretToBytes('0aff', 'hex'))).toEqual([10, 255]);
    expect(Array.from(secretToBytes('0xAAFF', 'hex'))).toEqual([170, 255]);
    expect(() => secretToBytes('abc', 'hex')).toThrow(/hex/);
    expect(() => secretToBytes('zz', 'hex')).toThrow(/hex/);
    expect(Array.from(secretToBytes('AP8=', 'base64'))).toEqual([0, 255]);
    expect(Array.from(secretToBytes('AP8', 'base64url'))).toEqual([0, 255]);
    expect(() => secretToBytes('***', 'base64')).toThrow(/base64/);
  });
});

describe('components render', () => {
  it('JwtInspectorWorkbench renders the sample', async () => {
    const React = (await import('react')).default;
    const { renderToString } = await import('react-dom/server');
    const mod = await import('../src/components/tools/JwtInspectorWorkbench.jsx');
    const html = renderToString(React.createElement(mod.default, {}));
    expect(html).toContain('Encoded token');
    expect(html).toContain('John Doe');
    expect(html).toContain('Sign');
  });
});
