import { describe, it, expect } from 'vitest';
import { normalizeHex, matchFingerprint, validityTimeline, certToText, certToJson, opensslCommands } from '../src/utils/certReport';

const fps = { sha256: 'AB:CD:EF:01', sha1: '11:22:33', sha512: '', pin: 'abc+/=' };
const parsed = {
  subject: 'CN=a', issuer: 'CN=b', notBefore: new Date('2026-01-01T00:00:00Z'), notAfter: new Date('2026-04-11T00:00:00Z'),
  version: 3, serial: '01', signatureAlgorithm: 'sha256WithRSA', publicKey: { algorithm: 'RSA', bits: 2048 },
  subjectAltNames: ['DNS:a'], ocsp: ['http://o'],
};

describe('certReport', () => {
  it('normalizes hex', () => {
    expect(normalizeHex('sha256: ab:cd ef')).toBe('ABCDEF');
  });
  it('matches fingerprints and pins', () => {
    expect(matchFingerprint('abcdef01', fps)).toEqual({ match: true, algorithm: 'SHA-256' });
    expect(matchFingerprint('11 22 33', fps).algorithm).toBe('SHA-1');
    expect(matchFingerprint('pin-sha256="abc+/="', fps).match).toBe(true);
    expect(matchFingerprint('deadbeef', fps).match).toBe(false);
    expect(matchFingerprint('', fps)).toBeNull();
  });
  it('computes timeline', () => {
    const t = validityTimeline(parsed, new Date('2026-02-20T00:00:00Z'));
    expect(t.totalDays).toBe(100); expect(t.pct).toBe(50); expect(t.state).toBe('valid');
    expect(validityTimeline(parsed, new Date('2026-04-01T00:00:00Z')).state).toBe('expiring');
    expect(validityTimeline(parsed, new Date('2027-01-01T00:00:00Z')).state).toBe('expired');
    expect(validityTimeline(parsed, new Date('2025-01-01T00:00:00Z')).state).toBe('not-yet-valid');
  });
  it('builds reports', () => {
    expect(certToText(parsed, fps)).toContain('Subject: CN=a');
    expect(certToJson(parsed, fps).fingerprints.spkiPinSha256).toBe('abc+/=');
  });
  it('sanitizes host in openssl commands', () => {
    const c = opensslCommands({ host: 'a.com; rm -rf /' });
    expect(c.find((x) => x.label === 'Hostname check').cmd).toBe('openssl x509 -in cert.pem -noout -checkhost a.comrm-rf');
  });
});
