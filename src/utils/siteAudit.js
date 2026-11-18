// Site-owner helpers for the Web Analyzer: SEO / accessibility hints from the
// fetched HTML, a link checker, and copy-paste header remediation snippets.
// Pure functions (the link checker takes an injected fetch) so they are testable.
// Regex-based like urlinspect.js: best-effort hints, not a full Lighthouse run.

function attr(tag, name) {
  const m = tag.match(new RegExp(`(?:^|[\\s<])${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}
const tagsOf = (html, name) => html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || [];
const stripTags = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

/**
 * SEO and accessibility hints. Returns { counts, issues: [{ id, area, severity, message }] }
 * area is 'seo' | 'a11y'; severity is 'warn' | 'info'.
 */
export function auditSeoA11y(html, baseUrl = '') {
  const issues = [];
  const add = (id, area, severity, message) => issues.push({ id, area, severity, message });
  const src = html || '';
  const htmlTag = (src.match(/<html\b[^>]*>/i) || [''])[0];
  if (!attr(htmlTag, 'lang')) add('html-lang', 'a11y', 'warn', 'The <html> element has no lang attribute; screen readers cannot pick the right voice.');

  const titleM = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : '';
  if (!title) add('title-missing', 'seo', 'warn', 'No <title> text.');
  else if (title.length > 60) add('title-long', 'seo', 'info', `Title is ${title.length} characters; search results usually cut it near 60.`);
  else if (title.length < 10) add('title-short', 'seo', 'info', `Title is only ${title.length} characters.`);

  const metas = tagsOf(src, 'meta');
  const metaByName = (n) => { const t = metas.find((m) => (attr(m, 'name') || '').toLowerCase() === n); return t ? (attr(t, 'content') || '') : null; };
  const desc = metaByName('description');
  if (desc === null || !desc.trim()) add('description-missing', 'seo', 'warn', 'No meta description.');
  else if (desc.length > 160) add('description-long', 'seo', 'info', `Meta description is ${desc.length} characters; about 160 is the usual display limit.`);

  const viewport = metaByName('viewport');
  if (viewport === null) add('viewport-missing', 'seo', 'warn', 'No viewport meta tag; the page will not scale on phones.');
  else if (/user-scalable\s*=\s*(no|0)/i.test(viewport) || /maximum-scale\s*=\s*1(\.0)?\b/i.test(viewport)) add('viewport-zoom', 'a11y', 'warn', 'The viewport disables pinch zoom (user-scalable=no or maximum-scale=1).');

  const robots = metaByName('robots');
  if (robots && /noindex/i.test(robots)) add('noindex', 'seo', 'warn', `Meta robots is "${robots}"; search engines are told not to index this page.`);

  if (!tagsOf(src, 'link').some((t) => /canonical/i.test(attr(t, 'rel') || ''))) add('canonical-missing', 'seo', 'info', 'No rel=canonical link.');
  if (!metas.some((m) => /^og:title$/i.test(attr(m, 'property') || ''))) add('og-missing', 'seo', 'info', 'No Open Graph tags (og:title); link previews will be generic.');

  const h1 = (src.match(/<h1\b/gi) || []).length;
  if (h1 === 0) add('h1-missing', 'seo', 'warn', 'No <h1> heading.');
  else if (h1 > 1) add('h1-multiple', 'seo', 'info', `${h1} <h1> headings; one is the usual convention.`);

  const imgs = tagsOf(src, 'img');
  const noAlt = imgs.filter((t) => attr(t, 'alt') === null);
  if (noAlt.length) add('img-alt', 'a11y', 'warn', `${noAlt.length} of ${imgs.length} image(s) have no alt attribute (use alt="" for decorative images).`);

  // Links with no accessible name
  let emptyLinks = 0;
  const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi; let m;
  while ((m = aRe.exec(src)) !== null) {
    const open = `<a ${m[1]}>`;
    if (attr(open, 'href') === null) continue;
    const hasImgAlt = /<img\b[^>]*\balt\s*=\s*["'][^"']+["']/i.test(m[2]);
    if (!stripTags(m[2]) && !hasImgAlt && !attr(open, 'aria-label') && !attr(open, 'aria-labelledby') && !attr(open, 'title')) emptyLinks++;
  }
  if (emptyLinks) add('link-name', 'a11y', 'warn', `${emptyLinks} link(s) have no text or aria-label.`);

  // Form controls without a label
  const labelFor = new Set(); const lre = /<label\b[^>]*>/gi; let lm;
  while ((lm = lre.exec(src)) !== null) { const f = attr(lm[0], 'for'); if (f) labelFor.add(f); }
  const wrapped = (src.match(/<label\b[^>]*>[\s\S]*?<\/label>/gi) || []).join(' ');
  let unlabeled = 0;
  for (const t of [...tagsOf(src, 'input'), ...tagsOf(src, 'select'), ...tagsOf(src, 'textarea')]) {
    const type = (attr(t, 'type') || 'text').toLowerCase();
    if (/^(hidden|submit|button|reset|image)$/.test(type)) continue;
    const id = attr(t, 'id');
    if (attr(t, 'aria-label') || attr(t, 'aria-labelledby') || attr(t, 'title')) continue;
    if (id && labelFor.has(id)) continue;
    if (wrapped.includes(t)) continue;
    unlabeled++;
  }
  if (unlabeled) add('form-label', 'a11y', 'warn', `${unlabeled} form control(s) have no label, aria-label or title.`);

  if (baseUrl && !/^https:/i.test(baseUrl)) add('not-https', 'seo', 'warn', 'The page was served over http, not https.');
  return { counts: { images: imgs.length, h1, title: title.length, description: desc ? desc.length : 0 }, issues };
}

const REMEDIATION = {
  'content-security-policy': { name: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'", note: 'Starting point sent as Report-Only so you can see what would break; adapt it to your scripts/styles, then rename to Content-Security-Policy.' },
  'strict-transport-security': { name: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains', note: 'Only send over HTTPS. Add "preload" only after reading the hstspreload.org requirements.' },
  'x-frame-options': { name: 'X-Frame-Options', value: 'DENY', note: 'Use SAMEORIGIN if you frame your own pages. CSP frame-ancestors is the modern equivalent.' },
  'x-content-type-options': { name: 'X-Content-Type-Options', value: 'nosniff' },
  'referrer-policy': { name: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  'permissions-policy': { name: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()', note: 'Disables the listed features; remove any you use.' },
  'cross-origin-opener-policy': { name: 'Cross-Origin-Opener-Policy', value: 'same-origin', note: 'Can break OAuth popups that rely on window.opener.' },
  'cross-origin-resource-policy': { name: 'Cross-Origin-Resource-Policy', value: 'same-origin', note: 'Blocks other sites embedding your resources; use same-site or cross-origin if you serve a CDN.' },
};

/** Headers from a gradeSecurityHeaders() result that are absent/weak and have a snippet. */
export function remediationItems(gradeHeaders) {
  return (gradeHeaders || [])
    .filter((h) => h.status !== 'good' && REMEDIATION[h.header])
    .map((h) => ({ header: h.header, status: h.status, ...REMEDIATION[h.header] }));
}

/** Render snippets: format is 'nginx' | 'apache' | 'headers' (Cloudflare Pages / Netlify _headers file). */
export function remediationSnippet(items, format = 'nginx') {
  if (!items.length) return '';
  const q = (v) => v.replace(/"/g, '\\"');
  const lines = [];
  if (format === 'nginx') { lines.push('# inside your server { } or location { } block'); items.forEach((i) => lines.push(`add_header ${i.name} "${q(i.value)}" always;`)); }
  else if (format === 'apache') { lines.push('# needs mod_headers'); items.forEach((i) => lines.push(`Header always set ${i.name} "${q(i.value)}"`)); }
  else { lines.push('/*'); items.forEach((i) => lines.push(`  ${i.name}: ${i.value}`)); }
  return lines.join('\n');
}

/**
 * Check links with up to `concurrency` requests at a time.
 * fetchFn(url, init) -> Promise<{ status, url? }>; tries HEAD, then GET on 403/405/501 or a failed HEAD.
 * Returns [{ url, status, ok, error, redirected }] in input order (status 0 = no response).
 */
export async function checkLinks(urls, fetchFn, opts = {}) {
  const { concurrency = 4, signal, onResult } = opts;
  const results = new Array(urls.length);
  let next = 0;
  const one = async (url) => {
    const attempt = (method) => fetchFn(url, { method, redirect: 'follow', signal });
    try {
      let r = await attempt('HEAD').catch(() => null);
      if (!r || [403, 405, 501].includes(r.status)) r = await attempt('GET');
      return { url, status: r.status, ok: r.status >= 200 && r.status < 400, error: '', redirected: !!r.url && r.url !== url };
    } catch (e) {
      if (signal?.aborted) return { url, status: 0, ok: false, error: 'cancelled', redirected: false };
      return { url, status: 0, ok: false, error: e?.message || 'request failed', redirected: false };
    }
  };
  const worker = async () => {
    while (next < urls.length && !signal?.aborted) {
      const i = next++;
      results[i] = await one(urls[i]);
      onResult?.(results[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, worker));
  return results.filter(Boolean);
}

export function summarizeLinks(results) {
  const s = { total: results.length, ok: 0, redirected: 0, broken: 0, unreachable: 0 };
  for (const r of results) {
    if (r.status === 0) s.unreachable++;
    else if (r.status >= 400) s.broken++;
    else { s.ok++; if (r.redirected) s.redirected++; }
  }
  return s;
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function linksToCsv(results) {
  return ['url,status,redirected,error', ...results.map((r) => [r.url, r.status, r.redirected ? 'yes' : 'no', r.error].map(csvCell).join(','))].join('\n');
}
