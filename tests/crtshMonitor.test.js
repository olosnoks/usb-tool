import { describe, it, expect } from 'vitest';
import {
  expiryBucket, expiryOverview, groupCertificates, duplicateGroups, recentlyLogged,
  parseExpectedIssuers, isUnexpectedIssuer, monitorReport, certificatesToCsv,
} from '../src/utils/crtshMonitor.js';

const NOW = Date.parse('2025-06-01T00:00:00Z');
const LE = 'C=US, O=Lets Encrypt, CN=R11';
const row = (o) => ({ id: 1, issuer_name: LE, issuer_ca_id: 1, serial_number: 'aa', name_value: 'a.example.com', common_name: 'a.example.com',
  not_before: '2025-05-01T00:00:00', not_after: '2025-07-30T00:00:00', entry_timestamp: '2025-05-02T00:00:00', ...o });

describe('expiry', () => {
  it('buckets days left', () => {
    expect([-1, 0, 7, 8, 30, 31, 90, 91, null].map(expiryBucket)).toEqual(['expired', '7d', '7d', '30d', '30d', '90d', '90d', 'later', 'unknown']);
  });
  it('counts overview', () => {
    const o = expiryOverview([{ daysLeft: -3 }, { daysLeft: 5 }, { daysLeft: 200 }, {}]);
    expect(o).toMatchObject({ expired: 1, '7d': 1, later: 1, unknown: 1, '30d': 0 });
  });
});

describe('groupCertificates', () => {
  const rows = [
    row({ id: 1, entry_timestamp: '2025-05-02T00:00:00' }),
    row({ id: 2, entry_timestamp: '2025-05-03T00:00:00' }),
    row({ id: 3, serial_number: 'bb', not_after: '2025-05-20T00:00:00' }),
    row({ id: 4, serial_number: 'cc', name_value: 'other.com', common_name: 'other.com' }),
  ];
  const g = groupCertificates(rows, 'example.com', NOW);
  it('merges precert and cert by issuer+serial and drops out-of-scope', () => {
    expect(g).toHaveLength(2);
    const aa = g.find((c) => c.serial === 'aa');
    expect(aa.certIds).toEqual([1, 2]);
    expect(aa.loggedAt).toBe('2025-05-02');
    expect(aa.daysLeft).toBe(59);
    expect(aa.bucket).toBe('90d');
  });
  it('flags expired', () => {
    expect(g.find((c) => c.serial === 'bb').expired).toBe(true);
  });
  it('finds duplicate name sets', () => {
    const d = duplicateGroups(g);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ count: 2, activeCount: 1, issuers: ['Lets Encrypt'] });
  });
  it('lists recent issuance', () => {
    expect(recentlyLogged(g, 30, NOW)).toHaveLength(2);
    expect(recentlyLogged(g, 10, NOW)).toHaveLength(0);
  });
  it('tracks wildcard names', () => {
    const w = groupCertificates([row({ name_value: '*.example.com\nexample.com', common_name: 'example.com' })], 'example.com', NOW);
    expect(w[0].wildcardNames).toEqual(['*.example.com']);
  });
});

describe('issuer expectations', () => {
  it('parses and matches', () => {
    const exp = parseExpectedIssuers('Lets Encrypt, Google\n  ');
    expect(exp).toEqual(['lets encrypt', 'google']);
    expect(isUnexpectedIssuer({ issuer: 'Lets Encrypt', issuerName: '' }, exp)).toBe(false);
    expect(isUnexpectedIssuer({ issuer: 'ZeroSSL', issuerName: 'O=ZeroSSL' }, exp)).toBe(true);
    expect(isUnexpectedIssuer({ issuer: 'ZeroSSL' }, [])).toBe(false);
  });
});

describe('exports', () => {
  const g = groupCertificates([row({ name_value: '=evil.example.com', common_name: '' })], 'example.com', NOW);
  it('builds csv with formula neutralisation', () => {
    const csv = certificatesToCsv(g);
    expect(csv.split('\n')[0]).toContain('names,issuer');
    expect(csv).toContain("'=evil.example.com");
  });
  it('builds a markdown report', () => {
    const md = monitorReport({ domain: 'example.com', certs: g, hosts: ['a'], expected: ['digicert'], now: NOW });
    expect(md).toContain('# Certificate Transparency report: example.com');
    expect(md).toContain('Issuers not in expected list');
    expect(md).toContain('## Certificates');
  });
});
