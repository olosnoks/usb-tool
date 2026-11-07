import { describe, it, expect } from 'vitest';
import { webcrypto } from 'node:crypto';
import { decodeJwt, analyzeClaims, verifyJwt, b64urlToString } from '../src/utils/jwt.js';
import { parseSpf, parseDmarc, classifyTxt, reverseIpv4, dnsblName, interpretDnsbl } from '../src/utils/mailDns.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// HS256 of the classic jwt.io sample, secret "your-256-bit-secret".
const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

describe('jwt', () => {
  it('decodes header and payload', () => {
    const d = decodeJwt(SAMPLE);
    expect(d.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(d.payload.name).toBe('John Doe');
    expect(d.payload.iat).toBe(1516239022);
  });

  it('rejects malformed tokens', () => {
    expect(() => decodeJwt('a.b')).toThrow(/3 segments/);
    expect(() => decodeJwt('!!!.!!!.x')).toThrow(/base64url/);
  });

  it('analyzes nbf and iat against a fixed now', () => {
    const notes = analyzeClaims({ exp: 2000, nbf: 500, iat: 100 }, 1000);
    expect(notes.find((n) => n.claim === 'exp').ok).toBe(true);  // 2000 > 1000: not expired
    expect(notes.find((n) => n.claim === 'nbf').ok).toBe(true);  // 500 <= 1000: active
    expect(notes.find((n) => n.claim === 'iat').detail).toBe('900s ago');
  });

  it('flags expiry correctly', () => {
    const future = analyzeClaims({ exp: 5000 }, 1000);
    expect(future[0].ok).toBe(true);
    const past = analyzeClaims({ exp: 500 }, 1000);
    expect(past[0].ok).toBe(false);
  });

  it('verifies a correct HS256 signature and rejects a wrong secret', async () => {
    const good = await verifyJwt(decodeJwt(SAMPLE), 'your-256-bit-secret');
    expect(good.ok).toBe(true);
    const bad = await verifyJwt(decodeJwt(SAMPLE), 'wrong-secret');
    expect(bad.ok).toBe(false);
  });

  it('refuses alg:none', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ a: 1 })).toString('base64url');
    const res = await verifyJwt(decodeJwt(`${header}.${payload}.`), 'x');
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/none/);
  });

  it('round-trips base64url', () => {
    expect(b64urlToString(Buffer.from('héllo').toString('base64url'))).toBe('héllo');
  });
});

describe('mailDns parsers', () => {
  it('parses SPF with all qualifier and lookup count', () => {
    const spf = parseSpf('v=spf1 include:_spf.google.com include:mailgun.org ip4:1.2.3.4 ~all');
    expect(spf.all).toEqual({ qualifier: '~', meaning: 'softfail' });
    expect(spf.lookups).toBe(2);
    expect(parseSpf('not spf')).toBeNull();
  });

  it('parses DMARC policy strength', () => {
    expect(parseDmarc('v=DMARC1; p=reject; rua=mailto:x@y.com').strength).toBe('strong');
    expect(parseDmarc('v=DMARC1; p=none').strength).toBe('weak');
    expect(parseDmarc('v=DMARC1; p=quarantine; pct=50').pct).toBe(50);
    expect(parseDmarc('v=spf1 foo')).toBeNull();
  });

  it('classifies TXT records', () => {
    expect(classifyTxt('v=spf1 -all')).toBe('SPF');
    expect(classifyTxt('v=DMARC1; p=none')).toBe('DMARC');
    expect(classifyTxt('google-site-verification=abc')).toBe('verification');
    expect(classifyTxt('random note')).toBe('other');
  });

  it('reverses IPv4 and builds DNSBL names', () => {
    expect(reverseIpv4('1.2.3.4')).toBe('4.3.2.1');
    expect(reverseIpv4('999.1.1.1')).toBeNull();
    expect(dnsblName('1.2.3.4', 'zen.spamhaus.org')).toBe('4.3.2.1.zen.spamhaus.org');
  });

  it('interprets DNSBL answers', () => {
    expect(interpretDnsbl('127.0.0.2').listed).toBe(true);
    expect(interpretDnsbl('1.2.3.4')).toBeNull();
  });
});
