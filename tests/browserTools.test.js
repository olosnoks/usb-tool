import { describe, it, expect } from 'vitest';
import { computeCidr, parseIpv4, ipv4ToStr, parseIpv6, ipv6ToStr, v4Contains } from '../src/utils/ipcalc.js';
import { md5Hex } from '../src/utils/md5.js';
import { extractSubdomains, crtShUrl } from '../src/utils/crtsh.js';

describe('ipcalc v4', () => {
  it('round-trips dotted quad', () => {
    expect(ipv4ToStr(parseIpv4('192.168.1.1'))).toBe('192.168.1.1');
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv4('nope')).toBeNull();
  });

  it('computes a /24', () => {
    const r = computeCidr('192.168.1.10/24');
    expect(r).toMatchObject({
      network: '192.168.1.0', broadcast: '192.168.1.255', netmask: '255.255.255.0',
      wildcard: '0.0.0.255', firstHost: '192.168.1.1', lastHost: '192.168.1.254',
      totalAddresses: 256, usableHosts: 254, isPrivate: true,
    });
  });

  it('handles /31 and /32 edge cases', () => {
    expect(computeCidr('10.0.0.0/31').usableHosts).toBe(2);
    expect(computeCidr('10.0.0.5/32')).toMatchObject({ usableHosts: 1, network: '10.0.0.5', broadcast: '10.0.0.5' });
  });

  it('computes a /0 and public flag', () => {
    const r = computeCidr('8.8.8.8/16');
    expect(r.network).toBe('8.8.0.0');
    expect(r.isPrivate).toBe(false);
    expect(computeCidr('0.0.0.0/0').totalAddresses).toBe(2 ** 32);
  });

  it('containment', () => {
    const net = parseIpv4('10.1.2.0');
    expect(v4Contains(net, 24, parseIpv4('10.1.2.200'))).toBe(true);
    expect(v4Contains(net, 24, parseIpv4('10.1.3.1'))).toBe(false);
  });
});

describe('ipcalc v6', () => {
  it('parses and compresses', () => {
    expect(ipv6ToStr(parseIpv6('2001:0db8:0000:0000:0000:0000:0000:0001'))).toBe('2001:db8::1');
    expect(ipv6ToStr(parseIpv6('::1'))).toBe('::1');
    expect(ipv6ToStr(parseIpv6('fe80::'))).toBe('fe80::');
  });

  it('parses embedded IPv4', () => {
    expect(ipv6ToStr(parseIpv6('::ffff:192.168.0.1'))).toBe('::ffff:c0a8:1');
  });

  it('rejects malformed', () => {
    expect(parseIpv6('2001::db8::1')).toBeNull();
    expect(parseIpv6('gggg::1')).toBeNull();
  });

  it('computes a /64', () => {
    const r = computeCidr('2001:db8:abcd:0012::1/64');
    expect(r.network).toBe('2001:db8:abcd:12::');
    expect(r.totalAddresses).toBe(2n ** 64n);
    expect(r.version).toBe(6);
  });
});

describe('md5', () => {
  const enc = (s) => new TextEncoder().encode(s);
  it('matches RFC 1321 vectors', () => {
    expect(md5Hex(enc(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(enc('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(enc('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5Hex(enc('The quick brown fox jumps over the lazy dog'))).toBe('9e107d9d372bb6826bd81d3542a419d6');
  });
  it('handles multi-block input', () => {
    expect(md5Hex(enc('a'.repeat(1000)))).toBe('cabe45dcc9ae5b66ba86600cca6b8ba8');
  });
});

describe('crtsh', () => {
  it('builds the query url', () => {
    expect(crtShUrl('example.com')).toContain('q=%25.example.com');
    expect(crtShUrl('*.example.com')).toContain('q=%25.example.com');
  });
  it('dedupes, scopes, and marks wildcards', () => {
    const rows = [
      { name_value: 'www.example.com\n*.example.com' },
      { name_value: 'api.example.com' },
      { name_value: 'www.example.com' },
      { name_value: 'evil.com' },            // out of scope, dropped
      { common_name: 'mail.example.com' },
    ];
    const out = extractSubdomains(rows, 'example.com');
    const hosts = out.map((o) => o.host);
    expect(hosts).toEqual(['api.example.com', 'example.com', 'mail.example.com', 'www.example.com']);
    expect(out.find((o) => o.host === 'example.com').wildcard).toBe(true);
    expect(hosts).not.toContain('evil.com');
  });
});
