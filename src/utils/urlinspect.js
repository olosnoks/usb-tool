// Pure HTML extractors for the URL / Link Analyzer. Regex-based (not a full DOM)
// so they run anywhere and stay testable; the component fetches the page and
// feeds the HTML + base URL here. Best-effort, read-only.

/** Resolve a possibly-relative URL against a base; null if unresolvable. */
export function resolveUrl(base, rel) {
  try { return new URL(rel, base).href; } catch { return null; }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function allTags(html, tagName) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  return html.match(re) || [];
}

/** <title> text. */
export function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

/** Absolute, de-duplicated <a href> links. */
export function extractLinks(html, baseUrl) {
  const out = new Set();
  for (const tag of allTags(html, 'a')) {
    const href = attr(tag, 'href');
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) continue;
    const abs = resolveUrl(baseUrl, href);
    if (abs) out.add(abs);
  }
  return [...out].sort();
}

/** Scripts, stylesheets and images referenced by the page (absolute URLs). */
export function extractResources(html, baseUrl) {
  const scripts = new Set(); const styles = new Set(); const images = new Set();
  for (const tag of allTags(html, 'script')) { const s = attr(tag, 'src'); if (s) { const a = resolveUrl(baseUrl, s); if (a) scripts.add(a); } }
  for (const tag of allTags(html, 'link')) {
    const rel = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href');
    if (href && (rel.includes('stylesheet') || href.endsWith('.css'))) { const a = resolveUrl(baseUrl, href); if (a) styles.add(a); }
  }
  for (const tag of allTags(html, 'img')) { const s = attr(tag, 'src') || attr(tag, 'data-src'); if (s) { const a = resolveUrl(baseUrl, s); if (a) images.add(a); } }
  return { scripts: [...scripts].sort(), styles: [...styles].sort(), images: [...images].sort() };
}

/** <meta> name/property -> content (and charset). */
export function extractMeta(html) {
  const meta = {};
  for (const tag of allTags(html, 'meta')) {
    const key = attr(tag, 'name') || attr(tag, 'property') || (attr(tag, 'charset') !== null ? 'charset' : null) || (/(http-equiv)/i.test(tag) ? attr(tag, 'http-equiv') : null);
    const content = attr(tag, 'content') ?? attr(tag, 'charset');
    if (key && content) meta[key] = content;
  }
  return meta;
}

/** Forms with action/method and their input fields. */
export function extractForms(html, baseUrl) {
  const forms = [];
  const re = /<form\b[^>]*>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const open = m[0].slice(0, m[0].indexOf('>') + 1);
    const body = m[1];
    const action = attr(open, 'action');
    const inputs = [];
    for (const tag of [...allTags(body, 'input'), ...allTags(body, 'select'), ...allTags(body, 'textarea')]) {
      inputs.push({ name: attr(tag, 'name') || '', type: attr(tag, 'type') || (/<select/i.test(tag) ? 'select' : /<textarea/i.test(tag) ? 'textarea' : 'text') });
    }
    forms.push({
      action: action ? resolveUrl(baseUrl, action) : baseUrl,
      method: (attr(open, 'method') || 'GET').toUpperCase(),
      inputs,
    });
  }
  return forms;
}

// Security-relevant response headers to highlight (presence/absence).
export const SECURITY_HEADERS = [
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
];

/** Given a headers map (lowercased keys), report present/missing security headers. */
export function assessSecurityHeaders(headersObj) {
  const lower = {};
  Object.entries(headersObj || {}).forEach(([k, v]) => { lower[k.toLowerCase()] = v; });
  return SECURITY_HEADERS.map((h) => ({ header: h, present: h in lower, value: lower[h] || null }));
}
