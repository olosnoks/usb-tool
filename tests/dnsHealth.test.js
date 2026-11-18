import { describe, it, expect } from 'vitest';
import { ipToArpa, digCommand, rsaBitsFromSpki, parseDkim, healthFindings } from '../src/utils/dnsHealth.js';

// Build a minimal RSA SPKI with a modulus of `bits` bits.
function spki(bits) {
  const n = new Uint8Array(bits / 8 + 1); n[0] = 0; n[1] = 0x80; for (let i = 2; i < n.length; i++) n[i] = 1;
  const len = (l) => (l < 128 ? [l] : l < 256 ? [0x81, l] : [0x82, l >> 8, l & 255]);
  const tlv = (t, b) => [t, ...len(b.length), ...b];
  const rsa = tlv(0x30, [...tlv(0x02, [...n]), ...tlv(0x02, [1, 0, 1])]);
  const alg = tlv(0x30, [...tlv(0x06, [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]), 5, 0]);
  const der = tlv(0x30, [...alg, ...tlv(0x03, [0, ...rsa])]);
  return btoa(String.fromCharCode(...der));
}

describe('ipToArpa', () => {
  it('reverses IPv4', () => expect(ipToArpa('192.0.2.10')).toBe('10.2.0.192.in-addr.arpa'));
  it('rejects bad IPv4', () => { expect(ipToArpa('300.1.1.1')).toBeNull(); expect(ipToArpa('example.com')).toBeNull(); });
  it('reverses IPv6', () => expect(ipToArpa('2001:db8::1')).toBe('1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa'));
  it('rejects bad IPv6', () => { expect(ipToArpa('1::2::3')).toBeNull(); expect(ipToArpa('zz::1')).toBeNull(); });
});

describe('digCommand', () => {
  it('names the resolver server', () => expect(digCommand('example.com', 'MX', 'cloudflare')).toBe('dig @1.1.1.1 example.com MX'));
  it('supports +short', () => expect(digCommand('example.com', 'A', 'google', { short: true })).toBe('dig +short @8.8.8.8 example.com A'));
});

describe('DKIM analysis', () => {
  it('reads RSA key size', () => { expect(rsaBitsFromSpki(spki(2048))).toBe(2048); expect(rsaBitsFromSpki(spki(1024))).toBe(1024); });
  it('returns null for junk', () => expect(rsaBitsFromSpki('!!!')).toBeNull());
  it('flags a weak key and testing mode', () => {
    const d = parseDkim(`v=DKIM1; k=rsa; t=y; p=${spki(1024)}`);
    expect(d.bits).toBe(1024); expect(d.testing).toBe(true);
    expect(d.notes.length).toBe(2);
  });
  it('detects revoked keys', () => expect(parseDkim('v=DKIM1; p=').revoked).toBe(true));
  it('accepts a 2048-bit key without notes', () => expect(parseDkim(`v=DKIM1; p=${spki(2048)}`).notes).toEqual([]));
});

describe('healthFindings', () => {
  const base = {
    name: 'example.com', recErrors: {}, a: [{}], aaaa: [], cname: [], mx: [{ data: '10 mx.example.com.' }], ns: [{ data: 'a.' }, { data: 'b.' }], soa: [], caa: [{}],
    txtStrings: [], spf: null, dmarc: null, dkim: [], mxIps: [{ ip: '1.2.3.4' }], dnsbl: [], dnssec: { state: 'validated' }, resolverChecks: {},
  };
  it('returns nothing without info', () => expect(healthFindings(null)).toEqual([]));
  it('flags missing SPF and DMARC as errors first', () => {
    const f = healthFindings(base);
    expect(f[0].level).toBe('error');
    expect(f.some((x) => /No SPF/.test(x.text))).toBe(true);
    expect(f.some((x) => /No DMARC/.test(x.text))).toBe(true);
  });
  it('flags multiple SPF records and +all', () => {
    const f = healthFindings({ ...base, txtStrings: ['v=spf1 -all', 'v=spf1 +all'], spf: { raw: 'v=spf1 +all', all: { qualifier: '+' }, lookups: 0 } });
    expect(f.some((x) => /2 SPF records/.test(x.text))).toBe(true);
    expect(f.some((x) => /\+all/.test(x.text))).toBe(true);
  });
  it('reports p=none without rua', () => {
    const f = healthFindings({ ...base, dmarc: { policy: 'none', pct: 100 } });
    expect(f.filter((x) => /DMARC/.test(x.text)).length).toBe(2);
  });
  it('is all-clear when healthy', () => {
    const f = healthFindings({ ...base, spf: { raw: 'v=spf1 -all', all: { qualifier: '-' }, lookups: 1 }, dmarc: { policy: 'reject', pct: 100, rua: 'mailto:a@b' }, dkim: [{ selector: 's', raw: `v=DKIM1; p=${spki(2048)}` }], aaaa: [{}] });
    expect(f.some((x) => x.level === 'error' || x.level === 'warn')).toBe(false);
  });
});
