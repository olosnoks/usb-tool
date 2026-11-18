import { describe, it, expect } from 'vitest';
import { summarizeGetInfo, explainOptions, highestVersion, pinState, buildReport, reportToText } from '../src/utils/fido2Report';
import { derEcdsaToRaw, verifyAssertion } from '../src/utils/webauthnLab';

const info = {
  versions: ['U2F_V2', 'FIDO_2_0', 'FIDO_2_1'], options: { rk: true, clientPin: false, ep: true, madeUp: true },
  aaguid: 'aa', aaguidName: 'Test Key', algorithms: [{ name: 'ES256' }], extensions: [], remainingDiscoverableCredentials: 0, minPinLength: 4
};

describe('fido2Report', () => {
  it('picks the highest version and PIN state', () => {
    expect(highestVersion(info.versions)).toBe('FIDO_2_1');
    expect(highestVersion([])).toBeNull();
    expect(pinState({ clientPin: true })).toBe('set');
    expect(pinState({ clientPin: false })).toBe('not-set');
    expect(pinState({})).toBe('unsupported');
  });
  it('summarises only what the key reported', () => {
    const rows = Object.fromEntries(summarizeGetInfo(info).map((r) => [r.label, r]));
    expect(rows.PIN.tone).toBe('warn');
    expect(rows['Enterprise attestation'].tone).toBe('warn');
    expect(rows['Free passkey slots'].tone).toBe('warn');
    expect(rows.Fingerprints).toBeUndefined();
    expect(summarizeGetInfo(null)).toEqual([]);
  });
  it('explains options and flags unknown ones honestly', () => {
    const ex = explainOptions(info.options);
    expect(ex.find((e) => e.id === 'rk').help).toMatch(/discoverable/);
    expect(ex.find((e) => e.id === 'madeUp').help).toMatch(/not known/);
  });
  it('builds a report and text', () => {
    const r = buildReport({ protocolVersion: 2, deviceVersion: '5.4.3', capCbor: true }, info, new Date('2025-01-01T00:00:00Z'));
    expect(r.generatedAt).toBe('2025-01-01T00:00:00.000Z');
    const t = reportToText(r);
    expect(t).toContain('AAGUID: aa (Test Key)');
    expect(t).toContain('PIN: supported but NOT set');
  });
});

describe('assertion verification', () => {
  it('converts DER ECDSA to raw r||s', () => {
    const der = Uint8Array.from([0x30, 0x08, 0x02, 0x02, 0x00, 0x80, 0x02, 0x02, 0x01, 0x02]);
    const raw = derEcdsaToRaw(der, 4);
    expect(Array.from(raw)).toEqual([0, 0, 0, 0x80, 0, 0, 1, 2]);
    expect(() => derEcdsaToRaw(Uint8Array.of(1, 2, 3))).toThrow();
  });

  it('verifies a real ES256 assertion and rejects tampering', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', kp.publicKey));
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const b64u = btoa(String.fromCharCode(...challenge)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const origin = 'https://example.test';
    const cdj = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge: b64u, origin }));
    const rpHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('example.test')));
    const ad = new Uint8Array(37); ad.set(rpHash, 0); ad[32] = 0x01; ad[36] = 5;
    const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', cdj));
    const signed = new Uint8Array([...ad, ...cdHash]);
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, signed));
    // raw r||s -> DER (positive ints, minimal)
    const toInt = (b) => { let v = Array.from(b); while (v.length > 1 && v[0] === 0) v.shift(); if (v[0] & 0x80) v.unshift(0); return [0x02, v.length, ...v]; };
    const body = [...toInt(raw.slice(0, 32)), ...toInt(raw.slice(32))];
    const der = Uint8Array.from([0x30, body.length, ...body]);
    const exp = { challenge, rpId: 'example.test', origin, lastSignCount: 4 };
    const args = { publicKeySpki: spki, alg: -7, authenticatorData: ad, clientDataJSON: cdj, signature: der };
    const ok = await verifyAssertion(args, exp);
    expect(ok.checks.filter((c) => !c.ok)).toEqual([]);
    expect(ok.ok).toBe(true);
    const badOrigin = await verifyAssertion(args, { ...exp, origin: 'https://evil.test' });
    expect(badOrigin.ok).toBe(false);
    const replay = await verifyAssertion(args, { ...exp, lastSignCount: 5 });
    expect(replay.checks.find((c) => c.name === 'sign count increased').ok).toBe(false);
    const tampered = await verifyAssertion({ ...args, authenticatorData: Uint8Array.from(ad, (x, i) => (i === 36 ? 9 : x)) }, exp);
    expect(tampered.checks.find((c) => c.name === 'signature valid').ok).toBe(false);
    const unk = await verifyAssertion({ ...args, alg: -99 }, exp);
    expect(unk.ok).toBe(false);
  });
});
