import { describe, it, expect } from 'vitest';
import { extractTitle, extractLinks, extractResources, extractMeta, extractForms, assessSecurityHeaders, resolveUrl } from '../src/utils/urlinspect.js';

const HTML = `
<!doctype html><html><head>
  <title>  Example  Page </title>
  <meta charset="utf-8">
  <meta name="description" content="a test page">
  <meta property="og:title" content="OG Title">
  <link rel="stylesheet" href="/css/site.css">
  <script src="https://cdn.example.net/app.js"></script>
</head><body>
  <a href="/about">About</a>
  <a href="https://other.com/x">Other</a>
  <a href="mailto:a@b.com">Mail</a>
  <a href="#frag">Frag</a>
  <a href="/about">About dup</a>
  <img src="/img/logo.png">
  <form action="/login" method="post">
    <input name="user" type="text"><input name="pass" type="password">
    <textarea name="note"></textarea>
  </form>
</body></html>`;

const BASE = 'https://site.example.com/page';

describe('urlinspect', () => {
  it('resolves relative urls', () => {
    expect(resolveUrl(BASE, '/about')).toBe('https://site.example.com/about');
    expect(resolveUrl(BASE, 'https://x.com/y')).toBe('https://x.com/y');
  });

  it('extracts and cleans the title', () => {
    expect(extractTitle(HTML)).toBe('Example Page');
  });

  it('extracts absolute, deduped links and skips mailto/#', () => {
    const links = extractLinks(HTML, BASE);
    expect(links).toContain('https://site.example.com/about');
    expect(links).toContain('https://other.com/x');
    expect(links).not.toContain('mailto:a@b.com');
    expect(links.filter((l) => l.endsWith('/about')).length).toBe(1);
  });

  it('extracts resources', () => {
    const r = extractResources(HTML, BASE);
    expect(r.scripts).toContain('https://cdn.example.net/app.js');
    expect(r.styles).toContain('https://site.example.com/css/site.css');
    expect(r.images).toContain('https://site.example.com/img/logo.png');
  });

  it('extracts meta', () => {
    const m = extractMeta(HTML);
    expect(m.description).toBe('a test page');
    expect(m['og:title']).toBe('OG Title');
    expect(m.charset).toBe('utf-8');
  });

  it('extracts forms with inputs', () => {
    const forms = extractForms(HTML, BASE);
    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({ action: 'https://site.example.com/login', method: 'POST' });
    expect(forms[0].inputs.map((i) => i.name)).toEqual(['user', 'pass', 'note']);
    expect(forms[0].inputs.find((i) => i.name === 'pass').type).toBe('password');
  });

  it('assesses security headers', () => {
    const a = assessSecurityHeaders({ 'Content-Security-Policy': "default-src 'self'", 'X-Frame-Options': 'DENY' });
    expect(a.find((h) => h.header === 'content-security-policy').present).toBe(true);
    expect(a.find((h) => h.header === 'strict-transport-security').present).toBe(false);
  });
});
