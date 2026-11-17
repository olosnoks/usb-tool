import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import { createRequire } from 'node:module';
import { gradeSecurityHeaders, assessSecurityHeaders } from '../src/utils/urlinspect.js';
import { scanHeaders, runPassiveScan } from '../src/utils/webScan.js';
import { detectTech } from '../src/utils/fingerprint.js';
import { getSetCookie, getRedirectChain } from '../src/utils/netClient.js';

const STRONG = {
  'content-security-policy': "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-embedder-policy': 'require-corp',
  'cross-origin-resource-policy': 'same-origin',
};
const st = (r, h) => r.headers.find((x) => x.header === h).status;

describe('gradeSecurityHeaders', () => {
  it('strong set grades A', () => {
    const r = gradeSecurityHeaders(STRONG, '<html></html>', { baseUrl: 'https://a.test/' });
    expect(r.grade).toBe('A');
    expect(st(r, 'content-security-policy')).toBe('good');
  });
  it.each([
    ["script-src 'unsafe-inline' *", 'bad'],
    ["default-src 'unsafe-inline'", 'bad'],
    ['script-src https:', 'bad'],
    ["script-src 'self' 'unsafe-inline' 'nonce-abc'; object-src 'none'; base-uri 'self'", 'good'],
    ["script-src 'self' 'unsafe-eval'; object-src 'none'; base-uri 'self'", 'warn'],
    ['img-src *', 'warn'],
  ])('CSP %s -> %s', (csp, status) => {
    expect(st(gradeSecurityHeaders({ 'content-security-policy': csp }), 'content-security-policy')).toBe(status);
  });
  it.each([
    ['max-age=0', 'bad'], ['includeSubDomains', 'bad'], ['max-age=3600', 'warn'],
    ['max-age=31536000', 'warn'], ['max-age=31536000; includeSubDomains', 'good'],
  ])('HSTS %s -> %s', (v, status) => {
    expect(st(gradeSecurityHeaders({ 'strict-transport-security': v }), 'strict-transport-security')).toBe(status);
  });
  it('weak CSP or HSTS max-age=0 never grades A/B even with everything else strong', () => {
    expect(['C', 'D', 'F']).toContain(gradeSecurityHeaders({ ...STRONG, 'content-security-policy': "script-src 'unsafe-inline' *" }).grade);
    expect(['C', 'D', 'F']).toContain(gradeSecurityHeaders({ ...STRONG, 'strict-transport-security': 'max-age=0' }).grade);
  });
  it('empty headers grade F; accepts Headers objects', () => {
    expect(gradeSecurityHeaders({}).grade).toBe('F');
    expect(gradeSecurityHeaders(new Headers(STRONG), '', { baseUrl: 'https://a.test' }).grade).toBe('A');
  });
  it('referrer, xfo, nosniff values', () => {
    const r = gradeSecurityHeaders({ 'referrer-policy': 'unsafe-url', 'x-frame-options': 'ALLOW-FROM x', 'x-content-type-options': 'sniff' });
    expect(st(r, 'referrer-policy')).toBe('bad');
    expect(st(r, 'x-frame-options')).toBe('warn');
    expect(st(r, 'x-content-type-options')).toBe('bad');
  });
  it('flags SRI missing and mixed content', () => {
    const html = '<script src="https://cdn.x/a.js"></script><script src="/own.js"></script><script src="http://m.x/b.js" integrity="sha384-x"></script>';
    const r = gradeSecurityHeaders(STRONG, html, { baseUrl: 'https://a.test/' });
    expect(st(r, 'subresource-integrity')).toBe('warn');
    expect(st(r, 'mixed-content')).toBe('bad');
    const ok = gradeSecurityHeaders(STRONG, '<script src="https://cdn.x/a.js" integrity="sha384-x"></script>', { baseUrl: 'https://a.test/' });
    expect(st(ok, 'subresource-integrity')).toBe('good');
  });
  it('keeps assessSecurityHeaders exported', () => {
    expect(assessSecurityHeaders({ 'X-Frame-Options': 'DENY' }).find((h) => h.header === 'x-frame-options').present).toBe(true);
  });
});

describe('fingerprint false positives', () => {
  const names = (ctx) => detectTech(ctx).map((t) => t.name);
  it('generic container/row classes are not Bootstrap', () => {
    expect(names({ headers: {}, html: '<div class="container"><div class="row col-md-6"></div></div>', cookieNames: [], scripts: [] })).not.toContain('Bootstrap');
  });
  it('Bootstrap asset detected with version', () => {
    const t = detectTech({ headers: {}, html: '', cookieNames: [], scripts: ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.min.js'] }).find((x) => x.name === 'Bootstrap');
    expect(t.evidence).toContain('5.3.2');
  });
  it('lone XSRF-TOKEN is not Laravel; laravel_session is', () => {
    expect(names({ headers: {}, html: '', cookieNames: ['XSRF-TOKEN'], scripts: [] })).not.toContain('Laravel');
    expect(names({ headers: {}, html: '', cookieNames: ['laravel_session'], scripts: [] })).toContain('Laravel');
  });
  it('AWS needs specific headers', () => {
    expect(names({ headers: { server: 'laws-of-physics' }, html: '', cookieNames: [], scripts: [] })).not.toContain('AWS');
    expect(names({ headers: { 'x-amz-cf-id': 'abc' }, html: '', cookieNames: [], scripts: [] })).toContain('AWS');
  });
});

describe('netClient helpers and scanHeaders', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('returns null when proxy headers absent, parsed arrays when present', () => {
    expect(getSetCookie(new Response('x'))).toBeNull();
    expect(getRedirectChain(new Response('x'))).toBeNull();
    const r = new Response('x', { headers: { 'x-proxy-set-cookie': JSON.stringify(['a=1; Secure']), 'x-proxy-redirects': JSON.stringify([{ status: 301, url: 'http://a' }]) } });
    expect(getSetCookie(r)).toEqual(['a=1; Secure']);
    expect(getRedirectChain(r)).toEqual([{ status: 301, url: 'http://a' }]);
  });
  it('scanHeaders is pure and uses supplied cookies', () => {
    const r = scanHeaders('https://a.test', new Headers({ server: 'x' }), { status: 200, setCookies: ['sid=1'] });
    expect(r.alerts.some((a) => /Secure flag/.test(a.desc))).toBe(true);
  });
  it('runPassiveScan issues exactly one request', async () => {
    const f = vi.fn(async () => new Response('', { headers: { a: 'b' } }));
    vi.stubGlobal('fetch', f);
    await runPassiveScan('https://a.test/');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('cors-proxy cookies and redirects', () => {
  it('exposes x-proxy-set-cookie and x-proxy-redirects', async () => {
    const target = http.createServer((req, res) => {
      if (req.url === '/start') { res.writeHead(302, { Location: '/end', 'Set-Cookie': 'a=1; HttpOnly' }); return res.end(); }
      res.writeHead(200, { 'Set-Cookie': ['b=2; Secure', 'c=3'], 'Content-Type': 'text/plain' });
      return res.end('done');
    });
    await new Promise((r) => target.listen(0, '127.0.0.1', r));
    const { server } = createRequire(import.meta.url)('../backend/cors-proxy/server.cjs');
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    try {
      const url = `http://127.0.0.1:${target.address().port}/start`;
      // Loopback connects occasionally time out on busy Windows CI boxes (not seen standalone); retry the whole call.
      let resp; let text = '';
      for (let attempt = 0; attempt < 4; attempt++) {
        resp = await fetch(`http://127.0.0.1:${server.address().port}/fetch?url=${encodeURIComponent(url)}`);
        text = await resp.text();
        if (resp.status !== 502) break;
      }
      expect(text, url).toBe('done');
      expect(getSetCookie(resp)).toEqual(['a=1; HttpOnly', 'b=2; Secure', 'c=3']);
      const chain = getRedirectChain(resp);
      expect(chain.map((c) => c.status)).toEqual([302, 200]);
      expect(chain[1].url).toMatch(/\/end$/);
    } finally { server.close(); target.close(); }
  });
});
