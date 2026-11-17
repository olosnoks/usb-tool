import { describe, it, expect, vi } from 'vitest';
import { RELAYS, crtshTarget, handleApi } from '../worker/index.js';
import { crtShUrl, crtShRelayUrl, extractSubdomains, extractCerts, issuerSummary, certsToCsv, safeFilename } from '../src/utils/crtsh.js';

const req = (path, init = {}) =>
  new Request(`https://usb-tool.example${path}`, { headers: { 'sec-fetch-site': 'same-origin' }, ...init });
const okJson = (body = '[]') => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });

describe('crtshTarget', () => {
  it('is not part of RELAYS', () => {
    expect(Object.keys(RELAYS).some((k) => k.includes('crtsh'))).toBe(false);
  });
  it('maps the documented query to crt.sh', () => {
    expect(crtshTarget('/api/crtsh', '?q=%25.example.com&output=json')).toBe('https://crt.sh/?q=%25.example.com&output=json');
  });
  it('always forces output=json and keeps exclude/deduplicate', () => {
    expect(crtshTarget('/api/crtsh', '?q=example.com')).toBe('https://crt.sh/?q=example.com&output=json');
    expect(crtshTarget('/api/crtsh', '?q=%25.a.io&exclude=expired&deduplicate=Y&output=json')).toBe('https://crt.sh/?q=%25.a.io&output=json&exclude=expired&deduplicate=Y');
  });
  it.each([
    ['/api/crtsh/extra', '?q=a.com'],
    ['/api/crtshx', '?q=a.com'],
    ['/api/crtsh', ''],
    ['/api/crtsh', '?q=a.com&foo=1'],
    ['/api/crtsh', '?q=a.com&output=csv'],
    ['/api/crtsh', '?q=a.com&exclude=all'],
    ['/api/crtsh', '?q=a.com&deduplicate=N'],
    ['/api/crtsh', '?q=a.com&q=b.com'],
    ['/api/crtsh', '?q=a.com%2Fb'],
    ['/api/crtsh', '?q=%25%25.a.com'],
    ['/api/crtsh', '?q=a.com%0d%0aHost:x'],
    ['/api/crtsh', `?q=${'a'.repeat(254)}`],
    ['/api/crtsh', '?q=a b.com'],
  ])('rejects %s%s', (p, s) => {
    expect(crtshTarget(p, s)).toBeNull();
  });
});

describe('worker /api/crtsh', () => {
  it('lists the route in the health probe', async () => {
    const r = await handleApi(req('/api/health'));
    expect((await r.json()).relays).toContain('/api/crtsh');
  });

  it('forwards a valid GET, no cookies, no-store, passes the body and type through', async () => {
    const f = vi.fn(async () => okJson('[{"id":1}]'));
    const r = await handleApi(req('/api/crtsh?q=%25.example.com&output=json', { headers: { 'sec-fetch-site': 'same-origin', cookie: 'a=b', authorization: 'x' } }), f);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('[{"id":1}]');
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-relay-upstream')).toBe('crt.sh');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://crt.sh/?q=%25.example.com&output=json');
    expect(init.method).toBe('GET');
    expect(init.headers.cookie).toBeUndefined();
    expect(init.headers.authorization).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('manual');
  });

  it('rejects an invalid query with 400 and does not call upstream', async () => {
    const f = vi.fn();
    for (const p of ['/api/crtsh', '/api/crtsh?q=a.com&evil=1', '/api/crtsh?q=a.com/../x', '/api/crtsh?q=a.com&output=csv']) {
      expect((await handleApi(req(p), f)).status).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('404s other paths under /api/crtsh', async () => {
    const f = vi.fn();
    expect((await handleApi(req('/api/crtsh/x?q=a.com'), f)).status).toBe(404);
    expect(f).not.toHaveBeenCalled();
  });

  it('rejects non-GET methods with 405', async () => {
    const f = vi.fn();
    for (const method of ['POST', 'PUT', 'DELETE']) {
      expect((await handleApi(req('/api/crtsh?q=a.com', { method, body: '{}' }), f)).status).toBe(405);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('refuses cross-site callers with 403', async () => {
    const f = vi.fn();
    const r = await handleApi(req('/api/crtsh?q=a.com', { headers: { 'sec-fetch-site': 'cross-site' } }), f);
    expect(r.status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it('turns an upstream failure into 502', async () => {
    const r = await handleApi(req('/api/crtsh?q=a.com'), async () => { throw new Error('boom'); });
    expect(r.status).toBe(502);
  });

  it('passes upstream status through (e.g. crt.sh 503)', async () => {
    const r = await handleApi(req('/api/crtsh?q=a.com'), async () => new Response('busy', { status: 503, headers: { 'content-type': 'text/html' } }));
    expect(r.status).toBe(503);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('does not disturb the hibp or shodan routes', async () => {
    const f = vi.fn(async () => okJson());
    expect((await handleApi(req('/api/hibp/breachedaccount/a%40b.com', { headers: { 'sec-fetch-site': 'same-origin', 'hibp-api-key': 'k' } }), f)).status).toBe(200);
    expect(f.mock.calls[0][0]).toMatch(/^https:\/\/haveibeenpwned\.com\/api\/v3\/breachedaccount\//);
    expect((await handleApi(req('/api/shodan/api-info?key=K'), f)).status).toBe(200);
    expect((await handleApi(req('/api/nope'), f)).status).toBe(404);
  });
});

const NOW = Date.parse('2026-06-01T00:00:00Z');
const LE = "C=US, O=Let's Encrypt, CN=R3";
const rows = [
  { id: 1, issuer_name: LE, common_name: 'old.example.com', name_value: 'old.example.com\nwww.example.com', entry_timestamp: '2025-01-01T00:00:00.000', not_before: '2025-01-01T00:00:00', not_after: '2025-04-01T00:00:00', serial_number: 'aa' },
  { id: 2, issuer_name: LE, common_name: 'www.example.com', name_value: 'www.example.com\n*.example.com\nother.net', entry_timestamp: '2026-05-01T00:00:00.000', not_before: '2026-05-01T00:00:00', not_after: '2026-06-20T00:00:00', serial_number: 'bb' },
  { id: 3, issuer_name: 'C=US, O=DigiCert Inc, CN=DigiCert TLS RSA', common_name: 'example.com', name_value: 'example.com', entry_timestamp: '2026-02-01T00:00:00.000', not_before: '2026-02-01T00:00:00', not_after: '2027-02-01T00:00:00', serial_number: 'cc' },
];

describe('extractCerts', () => {
  const certs = extractCerts(rows, 'example.com', NOW);
  const by = Object.fromEntries(certs.map((c) => [c.host, c]));

  it('lists in-scope hosts only, multi-SAN expanded, wildcard flagged', () => {
    expect(certs.map((c) => c.host)).toEqual(['example.com', 'old.example.com', 'www.example.com']);
    expect(by['example.com'].wildcard).toBe(true);
  });
  it('latest cert wins per host', () => {
    expect(by['www.example.com']).toMatchObject({ certId: 2, serial: 'bb', issuer: "Let's Encrypt", notAfter: '2026-06-20T00:00:00.000Z' });
  });
  it('flags expired and computes daysLeft', () => {
    expect(by['old.example.com']).toMatchObject({ expired: true });
    expect(by['old.example.com'].daysLeft).toBeLessThan(0);
    expect(by['www.example.com']).toMatchObject({ expired: false, daysLeft: 19 });
  });
  it('keeps extractSubdomains unchanged', () => {
    expect(extractSubdomains(rows, 'example.com').map((h) => h.host)).toEqual(['example.com', 'old.example.com', 'www.example.com']);
    expect(crtShUrl('example.com')).toBe('https://crt.sh/?q=%25.example.com&output=json');
  });
  it('tolerates garbage', () => {
    expect(extractCerts(null, 'a.com')).toEqual([]);
    expect(extractCerts([{}, { name_value: 'a.com' }], 'a.com', NOW)[0]).toMatchObject({ host: 'a.com', expired: false, daysLeft: null, notAfter: '' });
  });
});

describe('issuerSummary / relay url / csv', () => {
  it('counts rows per issuer', () => {
    expect(issuerSummary(rows)).toEqual([{ issuer: "Let's Encrypt", count: 2 }, { issuer: 'DigiCert Inc', count: 1 }]);
  });
  it('builds the relay url the worker accepts', () => {
    const u = crtShRelayUrl('example.com', { excludeExpired: true, dedupe: true });
    const parsed = new URL(u, 'https://x.test');
    expect(crtshTarget(parsed.pathname, parsed.search)).toBe('https://crt.sh/?q=%25.example.com&output=json&exclude=expired&deduplicate=Y');
    expect(crtShRelayUrl('*.example.com')).toBe('/api/crtsh?q=%25.example.com&output=json');
  });
  it('writes CSV with issuer and not-after columns, quoting and formula-safe', () => {
    const csv = certsToCsv(extractCerts(rows, 'example.com', NOW));
    const [head, ...lines] = csv.trim().split('\n');
    expect(head).toBe('host,wildcard,issuer,notBefore,notAfter,daysLeft,expired,loggedAt,certId,serial');
    expect(lines).toHaveLength(3);
    expect(lines.find((l) => l.startsWith('www.example.com'))).toContain("Let's Encrypt");
    expect(lines.find((l) => l.startsWith('old.example.com'))).toContain(',true,');
    const tricky = certsToCsv([{ host: 'a.com', issuer: 'Evil, "Inc"', serial: '=1+1', daysLeft: -5 }]);
    expect(tricky).toContain('"Evil, ""Inc"""');
    expect(tricky).toContain("'=1+1");
    expect(tricky).toContain(',-5,');
  });
  it('makes safe filenames', () => {
    expect(safeFilename('Example.com', 'csv')).toBe('example.com-certs.csv');
    expect(safeFilename('../../etc/passwd', 'json')).not.toMatch(/[\\/]/);
    expect(safeFilename('', 'csv')).toBe('crtsh-certs.csv');
  });
});
