import { describe, it, expect, vi } from 'vitest';
import {
  interpretDnsbl, parseDmarc, parseSpf, expandSpf, DNSBL_ZONES, parseMtaStsTxt, parseMtaStsPolicy,
  parseTlsRpt, parseBimi, compareResolvers, dnssecVerdict,
} from '../src/utils/mailDns.js';
import { doh, dohProblem, unquote } from '../src/utils/dnsDoh.js';

describe('interpretDnsbl', () => {
  it.each([
    ['127.0.0.2', { listed: true }],
    ['127.0.0.11', { listed: true }],
    ['127.255.255.252', { listed: false, inconclusive: true }],
    ['127.255.255.254', { listed: false, inconclusive: true }],
    ['127.255.255.255', { listed: false, inconclusive: true }],
  ])('%s', (ip, expected) => {
    expect(interpretDnsbl(ip)).toMatchObject(expected);
  });
  it('ignores non-127 answers and empty input', () => {
    expect(interpretDnsbl('8.8.8.8')).toBeNull();
    expect(interpretDnsbl('')).toBeNull();
  });
  it('a Spamhaus refusal is never a listing', () => {
    expect(interpretDnsbl('127.255.255.254').listed).toBe(false);
  });
  it('no longer checks dnsbl.sorbs.net', () => {
    expect(DNSBL_ZONES).not.toContain('dnsbl.sorbs.net');
  });
});

describe('parseDmarc', () => {
  it('keeps = inside values (rua with a query string)', () => {
    const d = parseDmarc('v=DMARC1; p=reject; rua=mailto:a@b.example?x=y; ruf=mailto:f@b.example; sp=none; adkim=s; aspf=s');
    expect(d.rua).toBe('mailto:a@b.example?x=y');
    expect(d).toMatchObject({ ruf: 'mailto:f@b.example', sp: 'none', adkim: 's', aspf: 's', policy: 'reject' });
  });
  it('defaults alignment to relaxed', () => {
    expect(parseDmarc('v=DMARC1; p=none')).toMatchObject({ adkim: 'r', aspf: 'r', sp: null, ruf: null });
  });
});

const txtMap = (m) => vi.fn(async (d) => m[d] ?? []);
const spf = (s) => [`v=spf1 ${s}`];

describe('expandSpf', () => {
  it('counts nested includes and not ip4/all', async () => {
    const f = txtMap({ 'x.test': spf('include:a.test ip4:1.2.3.4 -all'), 'a.test': spf('include:b.test a mx ~all'), 'b.test': spf('ip4:5.6.7.8 -all') });
    const r = await expandSpf('x.test', f);
    expect(r.lookups).toBe(4); // include:a, include:b, a, mx
    expect(r.overLimit).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it('10 lookups is fine, 11 is an error naming the chain', async () => {
    const exactly10 = txtMap({ 'x.test': spf('include:a.test a mx exists:e.test'), 'a.test': spf('a mx a:z.test a:y.test a:w.test include:b.test'), 'b.test': spf('-all') });
    const r10 = await expandSpf('x.test', exactly10);
    expect(r10.lookups).toBe(10);
    expect(r10.overLimit).toBe(false);
    expect(r10.errors).toEqual([]);

    const eleven = txtMap({ 'x.test': spf('include:a.test a mx exists:e.test'), 'a.test': spf('a mx a:z.test a:y.test a:w.test include:b.test'), 'b.test': spf('a -all') });
    const r11 = await expandSpf('x.test', eleven);
    expect(r11.lookups).toBe(11);
    expect(r11.overLimit).toBe(true);
    expect(r11.errors[0]).toMatch(/11/);
    expect(r11.errors[0]).toContain('x.test');
  });

  it('names the nested include path where the limit is crossed', async () => {
    const f = txtMap({
      'x.test': spf('include:a.test -all'),
      'a.test': spf('include:b.test -all'),
      'b.test': spf('a mx a:1.test a:2.test a:3.test a:4.test a:5.test a:6.test a:7.test a:8.test -all'),
    });
    const r = await expandSpf('x.test', f);
    expect(r.lookups).toBe(12);
    expect(r.errors[0]).toContain('x.test -> include:a.test -> include:b.test -> a:');
  });

  it('follows redirect=', async () => {
    const r = await expandSpf('x.test', txtMap({ 'x.test': spf('redirect=y.test'), 'y.test': spf('a mx -all') }));
    expect(r.lookups).toBe(3);
  });

  it('guards against include loops', async () => {
    const r = await expandSpf('x.test', txtMap({ 'x.test': spf('include:y.test'), 'y.test': spf('include:x.test') }));
    expect(r.errors.some((e) => /loop/i.test(e))).toBe(true);
    expect(r.lookups).toBe(2);
  });

  it('counts void lookups and flags a missing include target', async () => {
    const r = await expandSpf('x.test', txtMap({ 'x.test': spf('include:gone1.test include:gone2.test include:gone3.test -all') }));
    expect(r.voidLookups).toBe(3);
    expect(r.errors.some((e) => /gone1\.test/.test(e))).toBe(true);
    expect(r.warnings.some((w) => /void/.test(w))).toBe(true);
  });

  it('warns on ptr and on long records', async () => {
    const long = `ip4:1.1.1.1 ${Array.from({ length: 30 }, (_, i) => `ip4:10.0.0.${i}`).join(' ')} ptr -all`;
    const r = await expandSpf('x.test', txtMap({ 'x.test': spf(long) }));
    expect(r.warnings.some((w) => /ptr/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /255/.test(w))).toBe(true);
  });

  it('reports a failing lookup instead of throwing', async () => {
    const f = vi.fn(async (d) => { if (d === 'a.test') throw new Error('SERVFAIL'); return spf('include:a.test'); });
    const r = await expandSpf('x.test', f);
    expect(r.errors.some((e) => /a\.test.*SERVFAIL/.test(e))).toBe(true);
  });

  it('parseSpf counts qualified mechanisms and a/24', () => {
    expect(parseSpf('v=spf1 +include:a.test a/24 mx/24 ip4:1.1.1.1 -all').lookups).toBe(3);
  });
});

describe('MTA-STS / TLS-RPT / BIMI parsing', () => {
  it('parses each', () => {
    expect(parseMtaStsTxt('v=STSv1; id=2024')).toEqual({ raw: 'v=STSv1; id=2024', id: '2024' });
    expect(parseMtaStsTxt('v=spf1')).toBeNull();
    expect(parseMtaStsPolicy('version: STSv1\nmode: enforce\nmx: mx1.a.test\nmx: *.a.test\nmax_age: 86400\n')).toMatchObject({ mode: 'enforce', mx: ['mx1.a.test', '*.a.test'], maxAge: 86400 });
    expect(parseMtaStsPolicy('garbage')).toBeNull();
    expect(parseTlsRpt('v=TLSRPTv1; rua=mailto:t@a.test').rua).toBe('mailto:t@a.test');
    expect(parseBimi('v=BIMI1; l=https://a.test/l.svg; a=https://a.test/v.pem')).toMatchObject({ logo: 'https://a.test/l.svg', authority: 'https://a.test/v.pem' });
  });
});

describe('compareResolvers / dnssecVerdict', () => {
  it('detects agreement, disagreement and failures', () => {
    const agree = compareResolvers([{ resolver: 'g', ok: true, values: ['1.1.1.1', '2.2.2.2'] }, { resolver: 'c', ok: true, values: ['2.2.2.2', '1.1.1.1'] }]);
    expect(agree.agree).toBe(true);
    const diff = compareResolvers([{ resolver: 'g', ok: true, values: ['1.1.1.1'] }, { resolver: 'c', ok: true, values: ['9.9.9.9'] }, { resolver: 'q', ok: false, error: 'HTTP 500' }]);
    expect(diff.agree).toBe(false);
    expect(diff.groups).toHaveLength(2);
    expect(diff.failed).toEqual([{ resolver: 'q', error: 'HTTP 500' }]);
    expect(compareResolvers([{ resolver: 'g', ok: true, values: [] }]).comparable).toBe(false);
  });
  it('maps DS/DNSKEY/AD to a verdict', () => {
    expect(dnssecVerdict({ ad: true, hasDs: true, hasDnskey: true }).state).toBe('validated');
    expect(dnssecVerdict({ ad: false, hasDs: true, hasDnskey: true }).state).toBe('unverified');
    expect(dnssecVerdict({ ad: false, hasDs: false, hasDnskey: true }).state).toBe('incomplete');
    expect(dnssecVerdict({ ad: false, hasDs: false, hasDnskey: false }).state).toBe('unsigned');
  });
});

describe('doh', () => {
  const resp = (body, init = {}) => ({ ok: init.ok ?? true, status: init.status ?? 200, json: async () => body });

  it('returns status, AD flag and typed answers', async () => {
    const f = vi.fn(async () => resp({ Status: 0, AD: true, Answer: [{ name: 'a.test.', type: 1, TTL: 60, data: '1.2.3.4' }] }));
    const r = await doh('a.test', 'A', { fetchImpl: f });
    expect(r).toMatchObject({ status: 0, statusName: 'NOERROR', ad: true });
    expect(r.answers[0]).toMatchObject({ typeName: 'A', data: '1.2.3.4' });
    expect(f.mock.calls[0][0]).toBe('https://dns.google/resolve?name=a.test&type=A');
    expect(dohProblem(r)).toBeNull();
  });

  it('uses the requested resolver', async () => {
    const f = vi.fn(async () => resp({ Status: 0 }));
    await doh('a.test', 'TXT', { resolver: 'cloudflare', fetchImpl: f });
    await doh('a.test', 'TXT', { resolver: 'quad9', fetchImpl: f });
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/cloudflare-dns\.com\/dns-query\?/);
    expect(f.mock.calls[1][0]).toMatch(/^https:\/\/dns\.quad9\.net:5053\/dns-query\?/);
    await expect(doh('a.test', 'A', { resolver: 'nope', fetchImpl: f })).rejects.toThrow(/Unknown resolver/);
  });

  it('throws on a non-ok HTTP response', async () => {
    const f = vi.fn(async () => resp({}, { ok: false, status: 503 }));
    await expect(doh('a.test', 'A', { fetchImpl: f })).rejects.toThrow(/HTTP 503/);
  });

  it('maps Status 2/3/5: SERVFAIL and REFUSED are problems, NXDOMAIN is an empty answer', async () => {
    const mk = (s) => vi.fn(async () => resp({ Status: s }));
    const sf = await doh('a.test', 'A', { fetchImpl: mk(2) });
    expect(sf.statusName).toBe('SERVFAIL'); expect(dohProblem(sf)).toMatch(/SERVFAIL/);
    const nx = await doh('a.test', 'A', { fetchImpl: mk(3) });
    expect(nx.statusName).toBe('NXDOMAIN'); expect(dohProblem(nx)).toBeNull(); expect(nx.answers).toEqual([]);
    const rf = await doh('a.test', 'A', { fetchImpl: mk(5) });
    expect(rf.statusName).toBe('REFUSED'); expect(dohProblem(rf)).toMatch(/REFUSED/);
  });

  it('rejects a non-JSON body', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('x'); } }));
    await expect(doh('a.test', 'A', { fetchImpl: f })).rejects.toThrow(/JSON/);
  });

  it('one failing type does not abort Promise.allSettled over the others', async () => {
    const f = vi.fn(async (url) => (url.includes('type=MX') ? resp({ Status: 2 }) : resp({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] })));
    const out = await Promise.allSettled(['A', 'MX'].map((t) => doh('a.test', t, { fetchImpl: f })));
    expect(dohProblem(out[0].value)).toBeNull();
    expect(dohProblem(out[1].value)).toMatch(/SERVFAIL/);
  });

  it('unquote joins split TXT segments', () => {
    expect(unquote('"v=spf1 " "include:a.test"')).toBe('v=spf1 include:a.test');
  });
});
