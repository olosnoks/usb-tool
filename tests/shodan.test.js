import { describe, it, expect } from 'vitest';
import {
  buildQuery, parseQuery, normalizeQuery, buildFacets, buildShodanUrl, redactKey,
  parseShodanResponse, summarizeMatch, matchesToCsv, intToIp, SHODAN_FILTERS, filterInfo,
} from '../src/utils/shodan.js';

describe('shodan query builder', () => {
  it('formats filters, quoting values with spaces and negating', () => {
    const q = buildQuery([
      { type: 'filter', key: 'port', value: '14000' },
      { type: 'filter', key: 'http.title', value: 'Admin Panel' },
      { type: 'filter', key: 'tag', value: 'honeypot', negate: true },
      { type: 'term', value: 'camera' },
      { type: 'term', value: 'two words', negate: true },
    ]);
    expect(q).toBe('port:14000 http.title:"Admin Panel" -tag:honeypot camera -"two words"');
  });

  it('drops empty tokens', () => {
    expect(buildQuery([{ type: 'filter', key: '', value: 'x' }, { type: 'term', value: '  ' }, { type: 'filter', key: 'country', value: '' }])).toBe('');
  });

  it('escapes embedded quotes', () => {
    expect(buildQuery([{ type: 'filter', key: 'http.html', value: 'say "hi"' }])).toBe('http.html:"say \\"hi\\""');
  });

  it('parses a query back into tokens (round trip)', () => {
    const src = 'port:14000 http.title:"Admin Panel" -tag:honeypot camera -"two words" country:US,DE';
    const toks = parseQuery(src);
    expect(toks).toEqual([
      { type: 'filter', key: 'port', value: '14000', negate: false },
      { type: 'filter', key: 'http.title', value: 'Admin Panel', negate: false },
      { type: 'filter', key: 'tag', value: 'honeypot', negate: true },
      { type: 'term', value: 'camera', negate: false },
      { type: 'term', value: 'two words', negate: true },
      { type: 'filter', key: 'country', value: 'US,DE', negate: false },
    ]);
    expect(buildQuery(toks)).toBe(src);
  });

  it('normalizes sloppy input', () => {
    expect(normalizeQuery('  port:22   org:"Foo Bar"  ')).toBe('port:22 org:"Foo Bar"');
    expect(normalizeQuery('')).toBe('');
  });

  it('builds a facet spec', () => {
    expect(buildFacets([{ key: 'country', count: 10 }, { key: 'org' }, { key: '', count: 3 }])).toBe('country:10,org');
  });

  it('knows its filter catalogue', () => {
    expect(SHODAN_FILTERS.length).toBeGreaterThan(50);
    expect(filterInfo('port').type).toBe('number');
    expect(filterInfo('nope')).toBeNull();
  });
});

describe('shodan urls', () => {
  it('builds search urls with only the set params', () => {
    const u = buildShodanUrl('search', { query: 'port:14000', facets: 'country:5', page: 2, minify: true }, 'K');
    expect(u).toBe('https://api.shodan.io/shodan/host/search?key=K&query=port%3A14000&facets=country%3A5&page=2&minify=true');
    const u2 = buildShodanUrl('count', { query: 'port:22', facets: '' }, 'K');
    expect(u2).toBe('https://api.shodan.io/shodan/host/count?key=K&query=port%3A22');
  });

  it('encodes path params and rejects missing ones', () => {
    expect(buildShodanUrl('host', { ip: '8.8.8.8', history: true }, 'K')).toBe('https://api.shodan.io/shodan/host/8.8.8.8?key=K&history=true');
    expect(buildShodanUrl('host', { ip: 'port:14000' }, 'K')).toBe('https://api.shodan.io/shodan/host/port%3A14000?key=K');
    expect(() => buildShodanUrl('host', {}, 'K')).toThrow(/ip/);
    expect(() => buildShodanUrl('bogus', {}, 'K')).toThrow(/Unknown/);
  });

  it('joins list params and uses the exploits host', () => {
    expect(buildShodanUrl('dnsResolve', { hostnames: ['a.com', 'b.com'] }, 'K')).toBe('https://api.shodan.io/dns/resolve?key=K&hostnames=a.com%2Cb.com');
    expect(buildShodanUrl('exploits', { query: 'apache' }, 'K')).toBe('https://exploits.shodan.io/api/search?key=K&query=apache');
  });

  it('redacts the key', () => {
    expect(redactKey('https://api.shodan.io/api-info?key=SECRET&x=1')).toBe('https://api.shodan.io/api-info?key=••••&x=1');
  });
});

describe('shodan responses', () => {
  it('accepts JSON success', () => {
    const r = parseShodanResponse(200, '{"total":1,"matches":[]}');
    expect(r.ok).toBe(true);
    expect(r.data.total).toBe(1);
  });

  it('surfaces JSON error bodies with a status hint', () => {
    const r = parseShodanResponse(401, '{"error":"Invalid API key"}');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Invalid API key/);
    expect(r.error).toMatch(/401/);
  });

  it('explains HTML bodies instead of throwing', () => {
    const r = parseShodanResponse(404, '<html> <head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/HTTP 404/);
    expect(r.error).toMatch(/HTML page \("404 Not Found"\)/);
    expect(r.raw).toContain('<html>');
  });

  it('handles non-JSON text and 4xx JSON without error field', () => {
    expect(parseShodanResponse(502, 'bad gateway').error).toMatch(/HTTP 502.*Body: bad gateway/);
    expect(parseShodanResponse(429, '{"x":1}').error).toMatch(/rate limited/);
  });
});

describe('shodan result shaping', () => {
  const match = {
    ip: 134744072, ip_str: '8.8.8.8', port: 53, transport: 'udp', hostnames: ['dns.google'], domains: ['google.com'],
    org: 'Google LLC', isp: 'Google', asn: 'AS15169', location: { country_name: 'United States', city: 'Mountain View' },
    product: 'dnsmasq', version: '2.8', http: { title: 'A, "quoted" title' }, vulns: { 'CVE-1': {}, 'CVE-2': {} }, tags: ['dns'], timestamp: '2025-01-01T00:00:00',
  };

  it('summarizes a match', () => {
    const s = summarizeMatch(match);
    expect(s.ip).toBe('8.8.8.8');
    expect(s.country).toBe('United States');
    expect(s.vulnCount).toBe(2);
    expect(s.title).toBe('A, "quoted" title');
  });

  it('falls back to the integer ip', () => {
    expect(intToIp(134744072)).toBe('8.8.8.8');
    expect(summarizeMatch({ ip: 134744072 }).ip).toBe('8.8.8.8');
  });

  it('exports csv with proper quoting', () => {
    const csv = matchesToCsv([match]);
    const [header, row] = csv.split('\n');
    expect(header.startsWith('ip,port,transport')).toBe(true);
    expect(row).toContain('"A, ""quoted"" title"');
    expect(row).toContain('CVE-1 CVE-2');
  });
});
