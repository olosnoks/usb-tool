import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildCreateOptions, buildGetOptions, decodeAttestationObject, decodeAuthenticatorData, parseCertificate,
  checkCapabilities, registerCredential
} from '../src/utils/webauthnLab';

// --- fixture builders (synthetic bytes, assembled here) ---------------------
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const head = (mt, n) => (n < 24 ? Uint8Array.of((mt << 5) | n) : n < 256 ? Uint8Array.of((mt << 5) | 24, n) : Uint8Array.of((mt << 5) | 25, n >> 8, n & 0xff));
const enc = (v) => {
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  if (typeof v === 'string') { const u = new TextEncoder().encode(v); return cat(head(3, u.length), u); }
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Array.isArray(v)) return cat(head(4, v.length), ...v.map(enc));
  if (v instanceof Map) return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [enc(k), enc(x)]));
  throw new Error('enc');
};
const der = (tag, ...c) => { const body = cat(...c); const n = body.length; return cat(Uint8Array.of(tag), n < 128 ? Uint8Array.of(n) : Uint8Array.of(0x81 + (n > 255 ? 1 : 0), ...(n > 255 ? [n >> 8, n & 0xff] : [n])), body); };
const text = (t) => new TextEncoder().encode(t);
const oid = (...bytes) => der(0x06, Uint8Array.from(bytes));
const rdn = (oidBytes, value) => der(0x31, der(0x30, oid(...oidBytes), der(0x0c, text(value))));
const name = (...rdns) => der(0x30, ...rdns);
const CN = [0x55, 0x04, 0x03];
const O = [0x55, 0x04, 0x0a];
function makeCert() {
  const tbs = der(0x30,
    der(0xa0, der(0x02, Uint8Array.of(2))), der(0x02, Uint8Array.of(0x01, 0x02)),
    der(0x30, oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02)),
    name(rdn(CN, 'Test Attestation CA'), rdn(O, 'Test Org')),
    der(0x30, der(0x17, text('240101000000Z')), der(0x17, text('340101000000Z'))),
    name(rdn(CN, 'Test Key Attestation')));
  return der(0x30, tbs, der(0x30, oid(0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x02)), der(0x03, Uint8Array.of(0, 1, 2, 3)));
}
const coseEc = () => enc(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(32).fill(0xaa)], [-3, new Uint8Array(32).fill(0xbb)]]));
const AAGUID = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
function authData({ flags, signCount = 7, attested = true }) {
  const parts = [new Uint8Array(32).fill(0x11), Uint8Array.of(flags, 0, 0, 0, signCount)];
  if (attested) parts.push(AAGUID, Uint8Array.of(0, 4), Uint8Array.of(0xde, 0xad, 0xbe, 0xef), coseEc());
  return cat(...parts);
}
const attObj = (fmt, attStmt, ad) => enc(new Map([['fmt', fmt], ['attStmt', attStmt], ['authData', ad]]));

afterEach(() => { vi.unstubAllGlobals(); });

describe('attestation decoding', () => {
  it('none', () => {
    const r = decodeAttestationObject(attObj('none', new Map(), authData({ flags: 0x45 })));
    expect(r.fmt).toBe('none');
    expect(r.attStmt.x5c).toEqual([]);
    expect(r.authData.flags).toMatchObject({ UP: true, UV: true, AT: true, ED: false });
    expect(r.authData.signCount).toBe(7);
    expect(r.authData.attestedCredential.aaguid).toBe('01020304-0506-0708-090a-0b0c0d0e0f10');
    expect(r.authData.attestedCredential.credentialId).toBe('deadbeef');
    expect(r.authData.attestedCredential.publicKey).toMatchObject({ kty: 'EC2', crv: 'P-256', algName: 'ES256' });
    expect(r.authData.attestedCredential.publicKey.x).toBe('aa'.repeat(32));
  });

  it('packed with an x5c certificate', () => {
    const stmt = new Map([['alg', -7], ['sig', new Uint8Array(70).fill(1)], ['x5c', [makeCert()]]]);
    const r = decodeAttestationObject(attObj('packed', stmt, authData({ flags: 0x41 })));
    expect(r.fmt).toBe('packed');
    expect(r.attStmt.algName).toBe('ES256');
    expect(r.attStmt.sigLength).toBe(70);
    expect(r.attStmt.x5c[0]).toMatchObject({
      subject: 'CN=Test Key Attestation',
      issuer: 'CN=Test Attestation CA, O=Test Org',
      notBefore: '2024-01-01T00:00:00.000Z',
      notAfter: '2034-01-01T00:00:00.000Z',
      serial: '0102'
    });
  });

  it('fido-u2f', () => {
    const stmt = new Map([['sig', new Uint8Array(71).fill(2)], ['x5c', [makeCert()]]]);
    const r = decodeAttestationObject(attObj('fido-u2f', stmt, authData({ flags: 0x41, signCount: 0 })));
    expect(r.fmt).toBe('fido-u2f');
    expect(r.attStmt.alg).toBeNull();
    expect(r.attStmt.x5c).toHaveLength(1);
    expect(r.authData.signCount).toBe(0);
  });

  it('malformed input gives a message, not an exception', () => {
    for (const bad of [Uint8Array.of(0xa3, 0x63), new Uint8Array(0), Uint8Array.of(0x01), attObj('none', new Map(), new Uint8Array(10))]) {
      let r;
      expect(() => { r = decodeAttestationObject(bad); }).not.toThrow();
      expect(typeof r.error).toBe('string');
    }
  });

  it('authenticatorData of an assertion (no attested data)', () => {
    const r = decodeAuthenticatorData(authData({ flags: 0x01, signCount: 42, attested: false }));
    expect(r.signCount).toBe(42);
    expect(r.attestedCredential).toBeNull();
    expect(() => parseCertificate(Uint8Array.of(0x30, 0x05, 1))).toThrow(/truncated|bad/);
  });
});

describe('option builders', () => {
  it('always uses the page hostname as RP ID and never asks for a discoverable credential by default', () => {
    vi.stubGlobal('location', { hostname: 'usb-tool.example' });
    const o = buildCreateOptions({ rpId: 'evil.example' });
    expect(o.publicKey.rp.id).toBe('usb-tool.example');
    expect(o.publicKey.authenticatorSelection.residentKey).toBe('discouraged');
    expect(o.publicKey.authenticatorSelection.requireResidentKey).toBe(false);
    expect(buildGetOptions({ rpId: 'evil.example' }).publicKey.rpId).toBe('usb-tool.example');
  });

  it('a discoverable credential needs the explicit confirmation', () => {
    vi.stubGlobal('location', { hostname: 'h.example' });
    expect(() => buildCreateOptions({ discoverable: true })).toThrow(/Confirm/);
    expect(buildCreateOptions({ discoverable: true, confirmed: true }).publicKey.authenticatorSelection.residentKey).toBe('required');
  });

  it('registerCredential does not call the browser when confirmation is missing', async () => {
    vi.stubGlobal('location', { hostname: 'h.example' });
    const create = vi.fn();
    await expect(registerCredential({ discoverable: true }, { create })).rejects.toThrow(/Confirm/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('capability checks', () => {
  it('reports what the browser answers, null when it cannot say', async () => {
    const PKC = { isUserVerifyingPlatformAuthenticatorAvailable: async () => true, getClientCapabilities: async () => ({ hybridTransport: true }) };
    const c = await checkCapabilities({ PublicKeyCredential: PKC, isSecureContext: true });
    expect(c).toMatchObject({ webauthn: true, platformAuthenticator: true, conditionalMediation: null, clientCapabilities: { hybridTransport: true } });
    expect((await checkCapabilities({})).webauthn).toBe(false);
  });
});
