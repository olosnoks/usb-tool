import { describe, it, expect } from 'vitest';
import { detectTech } from '../src/utils/fingerprint.js';
import { splitSetCookie, parseSetCookie, analyzeCookie, analyzeSetCookies, cookieNames } from '../src/utils/cookies.js';

describe('fingerprint', () => {
  it('detects server, language and CMS from headers/cookies/html', () => {
    const tech = detectTech({
      headers: { server: 'nginx/1.25', 'x-powered-by': 'PHP/8.2' },
      html: '<link href="/wp-content/themes/x/style.css">',
      cookieNames: ['PHPSESSID', 'wordpress_logged_in'],
      scripts: [],
    });
    const names = tech.map((t) => t.name);
    expect(names).toContain('Nginx');
    expect(names).toContain('PHP');
    expect(names).toContain('WordPress');
  });

  it('detects JS frameworks and CDNs', () => {
    const tech = detectTech({
      headers: { 'cf-ray': 'abc123-SJC' },
      html: '<script id="__NEXT_DATA__">{}</script>',
      cookieNames: [],
      scripts: ['https://cdnjs.cloudflare.com/jquery-3.6.0.min.js'],
    });
    const names = tech.map((t) => t.name);
    expect(names).toContain('Next.js');
    expect(names).toContain('Cloudflare');
    expect(names).toContain('jQuery');
  });

  it('reads meta generator', () => {
    const tech = detectTech({ headers: {}, html: '<meta name="generator" content="Hugo 0.120">', cookieNames: [], scripts: [] });
    expect(tech.find((t) => t.name === 'Hugo 0.120')).toBeTruthy();
  });

  it('returns nothing for a bare page', () => {
    expect(detectTech({ headers: {}, html: '<html></html>', cookieNames: [], scripts: [] })).toEqual([]);
  });
});

describe('cookies', () => {
  it('splits combined Set-Cookie respecting Expires commas', () => {
    const combined = 'a=1; Expires=Wed, 09 Jun 2025 10:18:14 GMT; Path=/, b=2; Secure';
    const parts = splitSetCookie(combined);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^a=1/);
    expect(parts[1]).toMatch(/^b=2/);
  });

  it('parses name/value/attrs', () => {
    const c = parseSetCookie('sid=xyz; Path=/; Secure; HttpOnly; SameSite=Lax');
    expect(c.name).toBe('sid');
    expect(c.value).toBe('xyz');
    expect(c.attrs.secure).toBe(true);
    expect(c.attrs.samesite).toBe('Lax');
  });

  it('flags insecure cookies', () => {
    const weak = analyzeCookie(parseSetCookie('token=abc'));
    expect(weak.secure).toBe(false);
    expect(weak.httpOnly).toBe(false);
    expect(weak.warnings.length).toBeGreaterThanOrEqual(3);
    expect(weak.ok).toBe(false);

    const strong = analyzeCookie(parseSetCookie('token=abc; Secure; HttpOnly; SameSite=Strict'));
    expect(strong.ok).toBe(true);
    expect(strong.warnings).toEqual([]);
  });

  it('flags SameSite=None without Secure', () => {
    const c = analyzeCookie(parseSetCookie('x=1; HttpOnly; SameSite=None'));
    expect(c.warnings.join(' ')).toMatch(/SameSite=None without Secure/);
  });

  it('analyzes a whole header and extracts names', () => {
    const header = 'PHPSESSID=abc; Path=/, prefs=dark; Secure';
    expect(analyzeSetCookies(header).map((c) => c.name)).toEqual(['PHPSESSID', 'prefs']);
    expect(cookieNames(header)).toEqual(['PHPSESSID', 'prefs']);
  });
});
