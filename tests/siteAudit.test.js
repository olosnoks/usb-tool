import { describe, it, expect } from 'vitest';
import { auditSeoA11y, remediationItems, remediationSnippet, checkLinks, summarizeLinks, linksToCsv } from '../src/utils/siteAudit.js';

const ids = (r) => r.issues.map((i) => i.id);

describe('auditSeoA11y', () => {
  it('flags a bare page', () => {
    const r = auditSeoA11y('<html><body><img src=a.png><a href="/x"></a><input name=q></body></html>', 'http://x.test/');
    expect(ids(r)).toEqual(expect.arrayContaining(['html-lang', 'title-missing', 'description-missing', 'viewport-missing', 'h1-missing', 'img-alt', 'link-name', 'form-label', 'not-https']));
  });
  it('passes a good page', () => {
    const html = '<html lang="en"><head><title>A decent title here</title><meta name="description" content="d"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="/"><meta property="og:title" content="t"></head><body><h1>Hi</h1><img src=a alt=""><a href="/x">go</a><label for=q>Q</label><input id=q name=q></body></html>';
    expect(auditSeoA11y(html, 'https://x.test/').issues).toEqual([]);
  });
  it('detects zoom block and noindex', () => {
    const r = auditSeoA11y('<html lang=en><head><meta name="viewport" content="width=device-width, user-scalable=no"><meta name="robots" content="noindex,nofollow"></head></html>');
    expect(ids(r)).toEqual(expect.arrayContaining(['viewport-zoom', 'noindex']));
  });
  it('accepts wrapped labels', () => {
    expect(ids(auditSeoA11y('<label>Name <input name=n></label>'))).not.toContain('form-label');
  });
});

describe('remediation', () => {
  const hs = [{ header: 'x-content-type-options', status: 'absent' }, { header: 'referrer-policy', status: 'good' }, { header: 'mixed-content', status: 'bad' }];
  it('lists only failing headers with snippets', () => {
    expect(remediationItems(hs).map((i) => i.header)).toEqual(['x-content-type-options']);
  });
  it('renders formats', () => {
    const items = remediationItems(hs);
    expect(remediationSnippet(items, 'nginx')).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(remediationSnippet(items, 'apache')).toContain('Header always set X-Content-Type-Options "nosniff"');
    expect(remediationSnippet(items, 'headers')).toContain('  X-Content-Type-Options: nosniff');
    expect(remediationSnippet([], 'nginx')).toBe('');
  });
});

describe('checkLinks', () => {
  it('falls back to GET and summarises', async () => {
    const calls = [];
    const fetchFn = async (url, init) => {
      calls.push(`${init.method} ${url}`);
      if (url.includes('nohead') && init.method === 'HEAD') return { status: 405 };
      if (url.includes('dead')) return { status: 404 };
      if (url.includes('boom')) throw new Error('net');
      if (url.includes('moved')) return { status: 200, url: 'https://a.test/new' };
      return { status: 200, url };
    };
    const urls = ['https://a.test/ok', 'https://a.test/nohead', 'https://a.test/dead', 'https://a.test/boom', 'https://a.test/moved'];
    const res = await checkLinks(urls, fetchFn, { concurrency: 2 });
    expect(res.map((r) => r.status)).toEqual([200, 200, 404, 0, 200]);
    expect(calls).toContain('GET https://a.test/nohead');
    expect(summarizeLinks(res)).toEqual({ total: 5, ok: 3, redirected: 1, broken: 1, unreachable: 1 });
    expect(linksToCsv(res).split('\n')[0]).toBe('url,status,redirected,error');
  });
});
