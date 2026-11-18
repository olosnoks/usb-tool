import { describe, it, expect } from 'vitest';
import {
  assessHost, summarizeHost, hostRowsToCsv, hostReportMarkdown, parseTargets, isIp,
  addSavedQuery, removeSavedQuery, parseSavedQueries, quotaSummary,
} from '../src/utils/shodanExposure.js';

const host = {
  ip_str: '203.0.113.5', org: 'Example Co', ports: [22, 80, 445, 3389], hostnames: ['a.example.com'],
  vulns: { 'CVE-2021-1': {}, 'CVE-2021-2': {} }, last_update: '2026-01-01',
  data: [{ port: 443, ssl: { cert: { expired: true }, versions: ['TLSv1', 'TLSv1.2'] }, http: { server: 'nginx/1.18.0' } }],
};

describe('assessHost', () => {
  it('flags risky ports, CVEs, expired certs and old TLS, high first', () => {
    const a = assessHost(host);
    expect(a.level).toBe('high');
    expect(a.findings[0].sev).toBe('high');
    const titles = a.findings.map((f) => f.title).join('|');
    expect(titles).toMatch(/SMB on port 445/);
    expect(titles).toMatch(/RDP/);
    expect(titles).toMatch(/2 CVEs/);
    expect(titles).toMatch(/Expired certificate on port 443/);
    expect(titles).toMatch(/Old TLS on port 443/);
    expect(titles).toMatch(/Server version disclosed/);
  });
  it('reports low for a plain web host', () => {
    expect(assessHost({ ports: [443] }).level).toBe('low');
    expect(assessHost({}).findings).toEqual([]);
  });
  it('summarises and exports CSV with escaping', () => {
    const s = summarizeHost(host);
    expect(s.ports).toBe('22 80 445 3389');
    expect(s.level).toBe('high');
    const csv = hostRowsToCsv([{ ...s, org: 'A, "B"' }]);
    expect(csv.split('\n')[0]).toBe('ip,org,hostnames,ports,vulns,level,high,medium,lastUpdate');
    expect(csv).toContain('"A, ""B"""');
  });
  it('writes a markdown report', () => {
    const md = hostReportMarkdown(host, undefined, new Date('2026-02-03T00:00:00Z'));
    expect(md).toContain('# Exposure review: 203.0.113.5');
    expect(md).toContain('Generated 2026-02-03');
    expect(md).toContain('**[high] SMB on port 445**');
  });
});

describe('parseTargets', () => {
  it('splits ips from others, dedupes, strips urls', () => {
    const r = parseTargets('1.2.3.4, 1.2.3.4\nhttps://example.com/x\n999.1.1.1 2001:db8::1');
    expect(r.ips).toEqual(['1.2.3.4', '2001:db8::1']);
    expect(r.others).toEqual(['example.com', '999.1.1.1']);
    expect(isIp('8.8.8.8')).toBe(true);
    expect(isIp('abc')).toBe(false);
  });
});

describe('saved queries', () => {
  it('adds newest first, dedupes by query, removes, and survives bad storage', () => {
    let l = addSavedQuery([], 'web', 'port:80');
    l = addSavedQuery(l, '', 'net:10.0.0.0/8');
    l = addSavedQuery(l, 'web2', 'port:80');
    expect(l.map((x) => x.name)).toEqual(['web2', 'net:10.0.0.0/8']);
    expect(addSavedQuery(l, 'x', '  ')).toBe(l);
    expect(removeSavedQuery(l, 'port:80')).toHaveLength(1);
    expect(parseSavedQueries('not json')).toEqual([]);
    expect(parseSavedQueries(JSON.stringify([{ query: 'a' }, { name: 'b' }, null]))).toEqual([{ name: 'a', query: 'a' }]);
  });
});

describe('quotaSummary', () => {
  it('summarises api-info and flags low credits', () => {
    const q = quotaSummary({ plan: 'dev', query_credits: 3, scan_credits: 100, monitored_ips: 1, usage_limits: { monitored_ips: 16 } });
    expect(q.low).toBe(true);
    expect(q.text).toBe('dev · 3 query / 100 scan credits');
    expect(q.monitoredLimit).toBe(16);
    expect(quotaSummary(null)).toBeNull();
  });
});
