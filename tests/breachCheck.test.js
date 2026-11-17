import { describe, it, expect, vi } from 'vitest';
import {
  isValidEmail, maskEmail, parseEmailInput, MAX_EMAILS, parseXonCheck, parseXonCatalog, xonRows,
  parseHibpAccount, parseHibpCatalog, filterCatalog, statusMessage,
} from '../src/utils/breachCheck.js';
import { hibpTarget, handleApi } from '../worker/index.js';

const req = (path, headers = {}) => new Request(`https://usb-tool.example${path}`, { headers: { 'sec-fetch-site': 'same-origin', ...headers } });

describe('email validation and masking', () => {
  it('validates addresses', () => {
    expect(isValidEmail('john@example.com')).toBe(true);
    expect(isValidEmail('a.b+c@sub.example.co.uk')).toBe(true);
    for (const bad of ['john', 'john@', '@example.com', 'a b@example.com', 'a@b', 'a@@b.com', 'a@b.c']) expect(isValidEmail(bad)).toBe(false);
  });
  it('masks the local part', () => {
    expect(maskEmail('john@example.com')).toBe('j•••@example.com');
    expect(maskEmail('weird')).toBe('w•••');
  });
  it('parses, dedupes and caps the list', () => {
    const r = parseEmailInput('a@x.com\r\nA@x.com\nbad\n\nb@x.com');
    expect(r.valid).toEqual(['a@x.com', 'b@x.com']);
    expect(r.invalid).toEqual(['bad']);
    const many = Array.from({ length: 25 }, (_, i) => `u${i}@x.com`).join('\n');
    const m = parseEmailInput(many);
    expect(m.valid).toHaveLength(MAX_EMAILS);
    expect(m.tooMany).toBe(true);
    expect(m.total).toBe(25);
  });
});

describe('response parsing', () => {
  it('parses XposedOrNot check + catalog', () => {
    const names = parseXonCheck({ breaches: [['Adobe', 'Dropbox']], email: 'x@y.com', status: 'success' });
    expect(names).toEqual(['Adobe', 'Dropbox']);
    expect(parseXonCheck({ Error: 'Not found', email: null })).toEqual([]);
    const cat = parseXonCatalog({ exposedBreaches: [{ breachID: 'Adobe', domain: 'adobe.com', breachedDate: '2013-10-04T00:00:00+00:00', exposedData: ['Emails', 'Passwords'], verified: true, exposedRecords: 5 }] });
    const rows = xonRows(names, cat);
    expect(rows[0]).toMatchObject({ name: 'Adobe', domain: 'adobe.com', date: '2013-10-04', dataClasses: ['Emails', 'Passwords'], verified: true });
    expect(rows[1]).toMatchObject({ name: 'Dropbox', domain: '', verified: null });
  });
  it('parses HIBP account and catalog bodies', () => {
    const body = [{ Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', IsVerified: true, PwnCount: 152445165, DataClasses: ['Email addresses'], Description: 'A <a href="x">breach</a> &amp; more' }];
    expect(parseHibpAccount(body)[0]).toMatchObject({ name: 'Adobe', verified: true, dataClasses: ['Email addresses'] });
    expect(parseHibpAccount({ nope: 1 })).toEqual([]);
    const cat = parseHibpCatalog(body);
    expect(cat[0].description).toBe('A breach & more');
    expect(filterCatalog(cat, 'ADOBE.com')).toHaveLength(1);
    expect(filterCatalog(cat, 'zzz')).toHaveLength(0);
    expect(filterCatalog(cat, '')).toHaveLength(1);
  });
  it('explains rate limits', () => {
    expect(statusMessage('XposedOrNot', 429)).toMatch(/rate limit/i);
  });
});

describe('HIBP relay allowlisting', () => {
  it('maps only the exact allowed paths', () => {
    expect(hibpTarget('/api/hibp/breachedaccount/a%40b.com', '?truncateResponse=false')).toBe('https://haveibeenpwned.com/api/v3/breachedaccount/a%40b.com?truncateResponse=false');
    expect(hibpTarget('/api/hibp/pasteaccount/a%40b.com', '?truncateResponse=false&x=1')).toBe('https://haveibeenpwned.com/api/v3/pasteaccount/a%40b.com');
    expect(hibpTarget('/api/hibp/breachedaccount/a%40b.com', '?evil=1&domain=x.com')).toBe('https://haveibeenpwned.com/api/v3/breachedaccount/a%40b.com?domain=x.com');
    for (const p of ['/api/hibp/breaches', '/api/hibp/breachedaccount/', '/api/hibp/breachedaccount/a%40b.com/extra', '/api/hibp/breachedaccount/notanemail', '/api/hibp/range/ABCDE', '/api/hibp/breachedaccount/..%2Fx%40b.com']) {
      expect(hibpTarget(p)).toBeNull();
    }
  });
  it('requires the key, forwards it, stays read-only', async () => {
    const noKey = await handleApi(req('/api/hibp/breachedaccount/a%40b.com'), vi.fn());
    expect(noKey.status).toBe(401);
    const f = vi.fn(async () => new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }));
    const r = await handleApi(req('/api/hibp/breachedaccount/a%40b.com?truncateResponse=false', { 'hibp-api-key': 'K', cookie: 'c=1' }), f);
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://haveibeenpwned.com/api/v3/breachedaccount/a%40b.com?truncateResponse=false');
    expect(init.headers['hibp-api-key']).toBe('K');
    expect(init.headers['user-agent']).toBeTruthy();
    expect(init.headers.cookie).toBeUndefined();
    const post = await handleApi(new Request('https://usb-tool.example/api/hibp/breachedaccount/a%40b.com', { method: 'POST', headers: { 'hibp-api-key': 'K' } }), f);
    expect(post.status).toBe(405);
    const bad = await handleApi(req('/api/hibp/breaches', { 'hibp-api-key': 'K' }), f);
    expect(bad.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DAT-4: password audit (CSV import, prefix cache, cancel, NTLM, report)
// ---------------------------------------------------------------------------
import {
  maskPassword, sha1Upper, ntlmUpper, parseCsv, parsePasswordCsv, parseHashList, parseRangeBody,
  makeRangeFetcher, checkEntries, resultsToCsv, sortCatalogNewest, hibpRelayAvailable,
} from '../src/utils/breachCheck.js';

describe('hashing for the range API', () => {
  it('SHA-1 and NTLM known vectors', async () => {
    expect(await sha1Upper('password')).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    expect(ntlmUpper('password')).toBe('8846F7EAEE8FB117AD06BDD830B7586C');
    expect(ntlmUpper('')).toBe('31D6CFE0D16AE931B73C59D7E0C089C0');
  });
  it('masks without the plaintext', () => {
    expect(maskPassword('hunter2')).toBe('h•••(7)');
  });
  it('parses range bodies including padding rows', () => {
    const m = parseRangeBody('0018A45C4D1DEF81644B54AB7F969B88D65:1\r\nABCDEF:0\nGARBAGE\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:2');
    expect(m.get('0018A45C4D1DEF81644B54AB7F969B88D65')).toBe(1);
    expect(m.get('ABCDEF')).toBe(0);
    expect(m.get('00D4F6E8FA6EECAD2A3AA415EEC418D38EC')).toBe(2);
    expect(m.has('GARBAGE')).toBe(false);
  });
  it('parses direct hash lists', () => {
    const sha = '5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8';
    const r = parseHashList(`${sha}\n${sha.toUpperCase()}\nnothex\n\n`, 'sha1');
    expect(r.valid).toEqual([sha.toUpperCase()]);
    expect(r.invalid).toEqual(['nothex']);
    expect(parseHashList('8846f7eaee8fb117ad06bdd830b7586c', 'ntlm').valid).toHaveLength(1);
    expect(parseHashList(sha, 'ntlm').valid).toHaveLength(0);
  });
});

describe('CSV parsing', () => {
  it('handles quotes, doubled quotes, embedded newlines, CRLF and a BOM', () => {
    const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","line1\nline2"\r\n\r\nlast,,');
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'line1\nline2'], ['last', '', '']]);
  });
  it('Bitwarden export', () => {
    const csv = 'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n'
      + ',0,login,Example,,,0,https://example.com/login,alice@example.com,password,\n'
      + ',0,note,Secret note,,,0,,,,\n'
      + ',0,login,No pass,,,0,https://x.test,bob,,\n';
    const r = parsePasswordCsv(csv);
    expect(r.format).toBe('Bitwarden');
    expect(r.entries).toEqual([{ site: 'Example', username: 'alice@example.com', password: 'password' }]);
    expect(r.skipped).toBe(2);
  });
  it('Chrome export', () => {
    const r = parsePasswordCsv('name,url,username,password,note\nexample.com,https://example.com/,carol,"p,w""d",\n');
    expect(r.format).toBe('Chrome');
    expect(r.entries[0]).toEqual({ site: 'example.com', username: 'carol', password: 'p,w"d' });
  });
  it('Firefox export (no name column: site comes from the URL host)', () => {
    const r = parsePasswordCsv('"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://www.example.org/signin","dave","hunter2",,"https://www.example.org","{abc}","1","2","3"\n');
    expect(r.format).toBe('Firefox');
    expect(r.entries[0]).toEqual({ site: 'www.example.org', username: 'dave', password: 'hunter2' });
  });
  it('1Password export', () => {
    const r = parsePasswordCsv('Title,Url,Username,Password,OTPAuth,Favorite,Archived,Tags,Notes\nMy Bank,https://bank.test,erin,s3cret,,0,0,,\n');
    expect(r.format).toBe('1Password');
    expect(r.entries[0]).toMatchObject({ site: 'My Bank', username: 'erin', password: 's3cret' });
  });
  it('rejects files with no password column', () => {
    expect(parsePasswordCsv('a,b\n1,2\n').error).toMatch(/No password column/);
    expect(parsePasswordCsv('only a header').error).toMatch(/no data rows/);
  });
});

describe('range checking with a mocked API', () => {
  const SECRET = 'hunter2-very-secret';

  // Distinct passwords until we hold exactly `n` different SHA-1 prefixes.
  async function passwordsWithPrefixes(n) {
    const byPrefix = new Map();
    for (let i = 0; byPrefix.size < n; i++) {
      const p = `pw-${i}`;
      const pre = (await sha1Upper(p)).slice(0, 5);
      if (!byPrefix.has(pre)) byPrefix.set(pre, p);
    }
    return [...byPrefix.values()];
  }

  it('100 entries over 20 distinct prefixes make exactly 20 range requests', async () => {
    const base = await passwordsWithPrefixes(20);
    const entries = Array.from({ length: 100 }, (_, i) => ({ password: base[i % 20] }));
    const fetchRange = vi.fn(async () => '0000000000000000000000000000000000A:0');
    const { results, requests, cancelled } = await checkEntries(entries, { fetchRange });
    expect(fetchRange).toHaveBeenCalledTimes(20);
    expect(requests).toBe(20);
    expect(results).toHaveLength(100);
    expect(cancelled).toBe(false);
    // each prefix is requested once and only the 5-char prefix is ever sent
    for (const [prefix] of fetchRange.mock.calls) expect(prefix).toMatch(/^[0-9A-F]{5}$/);
  });

  it('flags a known pwned password with its site and username, and never keeps the plaintext', async () => {
    const hash = await sha1Upper('password');
    const body = `${hash.slice(5)}:3861493\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0`;
    const parsed = parsePasswordCsv('name,url,username,password\nexample.com,https://example.com,alice,password\nother.com,https://other.com,bob,hunter2-very-secret\n');
    const fetchRange = vi.fn(async (prefix) => (prefix === hash.slice(0, 5) ? body : '0000000000000000000000000000000000A:1'));
    const { results } = await checkEntries(parsed.entries, { fetchRange });
    expect(results[0]).toMatchObject({ site: 'example.com', username: 'alice', count: 3861493 });
    expect(results[1]).toMatchObject({ site: 'other.com', username: 'bob', count: 0 });
    const dump = JSON.stringify(results) + resultsToCsv(results);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain('"password"'.slice(1, -1) + '"'); // no plaintext field
    expect(results[0]).not.toHaveProperty('password');
    expect(resultsToCsv(results)).toContain('example.com,alice,p•••(8),3861493,compromised,');
  });

  it('Cancel stops further requests', async () => {
    const base = await passwordsWithPrefixes(30);
    const ac = new AbortController();
    let calls = 0;
    const fetchRange = vi.fn(async () => { calls++; if (calls === 3) ac.abort(); return ''; });
    const { results, requests, cancelled } = await checkEntries(base.map((password) => ({ password })), { fetchRange, signal: ac.signal });
    expect(cancelled).toBe(true);
    expect(fetchRange).toHaveBeenCalledTimes(3);
    expect(requests).toBe(3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('an AbortError from fetch counts as a cancel, not a row error', async () => {
    const fetchRange = vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
    const r = await checkEntries([{ password: 'a' }, { password: 'b' }], { fetchRange });
    expect(r.cancelled).toBe(true);
    expect(r.results).toEqual([]);
  });

  it('a failing prefix is reported per row and not retried for the same prefix', async () => {
    const fetchRange = vi.fn(async () => { throw new Error('HTTP 429'); });
    const r = await checkEntries([{ password: 'same' }, { password: 'same' }], { fetchRange });
    expect(fetchRange).toHaveBeenCalledTimes(1);
    expect(r.results.map((x) => x.count)).toEqual([-1, -1]);
    expect(r.results[0].error).toMatch(/429/);
  });

  it('detects password reuse without exposing it', async () => {
    const r = await checkEntries([{ password: 'dup' }, { password: 'solo' }, { password: 'dup' }], { fetchRange: async () => '' });
    expect(r.results.map((x) => x.reuse)).toEqual([2, 1, 2]);
  });

  it('NTLM mode queries ?mode=ntlm and returns the count for a known NTLM hash', async () => {
    const f = vi.fn(async () => new Response('7EAEE8FB117AD06BDD830B7586C:12345\nAAAAAAAAAAAAAAAAAAAAAAAAAAA:0', { status: 200 }));
    const fetchRange = makeRangeFetcher(f);
    const byPassword = await checkEntries([{ password: 'password' }], { mode: 'ntlm', fetchRange });
    expect(byPassword.results[0].count).toBe(12345);
    const direct = await checkEntries([{ hash: '8846f7eaee8fb117ad06bdd830b7586c' }], { mode: 'ntlm', fetchRange });
    expect(direct.results[0].count).toBe(12345);
    expect(f.mock.calls[0][0]).toBe('https://api.pwnedpasswords.com/range/8846F?mode=ntlm');
  });

  it('range requests send Add-Padding and only the 5-char prefix', async () => {
    const f = vi.fn(async () => new Response('', { status: 200 }));
    await checkEntries([{ password: 'password' }], { fetchRange: makeRangeFetcher(f) });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(init.headers['Add-Padding']).toBe('true');
    expect(url).not.toContain('1E4C9B93F3F0682250B6CF8331B7EE68FD8');
  });

  it('non-OK responses become a readable row error', async () => {
    const fetchRange = makeRangeFetcher(async () => new Response('', { status: 429 }));
    const r = await checkEntries([{ password: 'x' }], { fetchRange });
    expect(r.results[0].error).toMatch(/rate limit/i);
  });
});

describe('report and catalog helpers', () => {
  it('CSV export neutralises spreadsheet formulas and quotes commas', () => {
    const csv = resultsToCsv([{ site: '=HYPERLINK("x")', username: 'a,b', masked: 'p•••(3)', count: 0, reuse: 1 }]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"a,b"');
    expect(csv.split('\n')[0]).toBe('site,username,password_masked,breach_count,status,reused_in_entries');
  });
  it('sorts the catalog newest first, undated last', () => {
    const l = [{ name: 'a', date: '2015-01-01' }, { name: 'b', date: '' }, { name: 'c', date: '2023-06-01' }, { name: 'd', date: '2015-01-01' }];
    expect(sortCatalogNewest(l).map((x) => x.name)).toEqual(['c', 'a', 'd', 'b']);
    const big = Array.from({ length: 120 }, (_, i) => ({ name: `n${i}`, date: `20${String(10 + (i % 10))}-01-01` }));
    expect(sortCatalogNewest(big)).toHaveLength(120);
  });
  it('detects whether the /api/hibp relay exists (no key, no email sent)', async () => {
    const live = vi.fn(async () => new Response('{"error":"hibp-api-key header required"}', { status: 401 }));
    expect(await hibpRelayAvailable(live)).toBe(true);
    expect(live.mock.calls[0][0]).not.toMatch(/@(?!example\.com)|%40(?!example\.com)/);
    expect(await hibpRelayAvailable(async () => new Response('<html></html>', { status: 200 }))).toBe(false);
    expect(await hibpRelayAvailable(async () => new Response('nope', { status: 404 }))).toBe(false);
    expect(await hibpRelayAvailable(async () => { throw new TypeError('offline'); })).toBe(false);
  });
});
