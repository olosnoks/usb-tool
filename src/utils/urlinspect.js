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

// ---------------------------------------------------------------------------
// Value-aware security header grading
// ---------------------------------------------------------------------------

function normalizeHeaders(h) {
  const lower = {};
  if (!h) return lower;
  if (typeof h.forEach === 'function' && typeof h.get === 'function') h.forEach((v, k) => { lower[String(k).toLowerCase()] = v; });
  else Object.entries(h).forEach(([k, v]) => { lower[k.toLowerCase()] = v; });
  return lower;
}

/** Parse a CSP string into { directive: [sources] } (lowercased directive names). */
export function parseCsp(csp) {
  const out = {};
  String(csp || '').split(';').forEach((part) => {
    const toks = part.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return;
    const name = toks[0].toLowerCase();
    if (!(name in out)) out[name] = toks.slice(1);
  });
  return out;
}

function gradeCsp(value, reportOnly) {
  if (!value) {
    return reportOnly
      ? { status: 'warn', reason: 'Only Content-Security-Policy-Report-Only is set; it reports but does not enforce.' }
      : { status: 'absent', reason: 'No Content-Security-Policy; no defense-in-depth against injected content.' };
  }
  const d = parseCsp(value);
  const script = d['script-src'] || d['default-src'];
  const problems = []; const warnings = [];
  if (!script) {
    warnings.push('no script-src or default-src, so scripts are unrestricted');
  } else {
    const l = script.map((s) => s.toLowerCase());
    const strict = l.includes("'strict-dynamic'") || l.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
    if (l.includes('*')) problems.push('wildcard (*) source allows scripts from anywhere');
    if (l.some((s) => ['http:', 'https:', 'data:', 'blob:'].includes(s))) problems.push('scheme-only source (http:/https:/data:) allows scripts from any host or inline data');
    if (l.includes("'unsafe-inline'") && !strict) problems.push("'unsafe-inline' without a nonce or hash allows inline script injection");
    if (l.includes("'unsafe-eval'")) warnings.push("'unsafe-eval' permits eval()");
  }
  if (!('object-src' in d) && !(d['default-src'] || []).includes("'none'")) warnings.push("object-src is not restricted (consider object-src 'none')");
  if (!('base-uri' in d)) warnings.push('base-uri is not set');
  if (problems.length) return { status: 'bad', reason: `Weak CSP: ${problems.join('; ')}.` };
  if (warnings.length) return { status: 'warn', reason: `CSP present but: ${warnings.join('; ')}.` };
  return { status: 'good', reason: 'Enforced CSP with restrictive script sources.' };
}

function gradeHsts(value) {
  if (!value) return { status: 'absent', reason: 'No Strict-Transport-Security; HTTPS downgrade attacks are possible.' };
  const m = /max-age\s*=\s*"?(\d+)"?/i.exec(value);
  if (!m) return { status: 'bad', reason: 'HSTS header has no valid max-age, so browsers ignore it.' };
  const age = Number(m[1]);
  if (age === 0) return { status: 'bad', reason: 'max-age=0 disables HSTS (clears any stored policy).' };
  if (age < 15552000) return { status: 'warn', reason: `max-age=${age} is under 180 days; use at least 31536000.` };
  if (age < 31536000 || !/includesubdomains/i.test(value)) return { status: 'warn', reason: age < 31536000 ? `max-age=${age} is under one year.` : 'No includeSubDomains.' };
  return { status: 'good', reason: `max-age=${age} with includeSubDomains.` };
}

function gradeXfo(xfo, csp) {
  const fa = parseCsp(csp)['frame-ancestors'];
  if (fa) return { status: 'good', reason: `Framing restricted by CSP frame-ancestors ${fa.join(' ')}.` };
  if (!xfo) return { status: 'absent', reason: 'No X-Frame-Options or frame-ancestors; the page can be framed (clickjacking).' };
  const v = xfo.trim().toUpperCase();
  if (v === 'DENY' || v === 'SAMEORIGIN') return { status: 'good', reason: `X-Frame-Options: ${v}.` };
  if (v.startsWith('ALLOW-FROM')) return { status: 'warn', reason: 'ALLOW-FROM is obsolete and ignored by modern browsers; use CSP frame-ancestors.' };
  return { status: 'bad', reason: `Invalid X-Frame-Options value "${xfo}".` };
}

function gradeReferrer(v) {
  if (!v) return { status: 'absent', reason: 'No Referrer-Policy; full URLs may leak to third parties.' };
  const vals = v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const last = vals[vals.length - 1];
  if (['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin'].includes(last)) return { status: 'good', reason: `Referrer-Policy: ${last}.` };
  if (['origin', 'origin-when-cross-origin', 'no-referrer-when-downgrade'].includes(last)) return { status: 'warn', reason: `${last} leaks more referrer data than necessary.` };
  if (last === 'unsafe-url') return { status: 'bad', reason: 'unsafe-url sends the full URL to every destination.' };
  return { status: 'bad', reason: `Unrecognized Referrer-Policy "${v}".` };
}

const attrOf = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};

function gradeSri(html, baseUrl) {
  let origin = '';
  try { origin = new URL(baseUrl).origin; } catch { /* no base */ }
  const missing = [];
  for (const tag of (html || '').match(/<script\b[^>]*>/gi) || []) {
    const src = attrOf(tag, 'src');
    if (!src || !/^(https?:)?\/\//i.test(src)) continue;
    let abs = src;
    try { abs = new URL(src, baseUrl || 'https://x.invalid').href; } catch { /* keep */ }
    try { if (origin && new URL(abs).origin === origin) continue; } catch { /* keep */ }
    if (attrOf(tag, 'integrity') === null) missing.push(abs);
  }
  if (missing.length) return { status: 'warn', reason: `${missing.length} external script(s) without Subresource Integrity: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', ...' : ''}.`, items: missing };
  return { status: 'good', reason: 'No external scripts lacking integrity (or none present).' };
}

function gradeMixed(html, baseUrl) {
  if (!/^https:/i.test(baseUrl || '')) return { status: 'good', reason: 'Not applicable (page is not HTTPS).' };
  const active = []; const passive = [];
  for (const tag of (html || '').match(/<(script|iframe|img|link|audio|video|source|embed|object)\b[^>]*>/gi) || []) {
    const name = /^<(\w+)/.exec(tag)[1].toLowerCase();
    const u = attrOf(tag, name === 'link' ? 'href' : name === 'object' ? 'data' : 'src');
    if (!u || !/^http:\/\//i.test(u)) continue;
    if (name === 'link' && !/stylesheet/i.test(attrOf(tag, 'rel') || '')) continue;
    (['script', 'iframe', 'link', 'embed', 'object'].includes(name) ? active : passive).push(u);
  }
  if (active.length) return { status: 'bad', reason: `Active mixed content (${active.length} http:// script/frame/style resource(s)): ${active[0]}.` };
  if (passive.length) return { status: 'warn', reason: `Passive mixed content: ${passive.length} http:// media resource(s).` };
  return { status: 'good', reason: 'No http:// subresources found.' };
}

const GRADE_WEIGHTS = [
  ['content-security-policy', 25], ['strict-transport-security', 20], ['x-frame-options', 10],
  ['x-content-type-options', 10], ['referrer-policy', 10], ['permissions-policy', 5],
  ['cross-origin-opener-policy', 5], ['cross-origin-embedder-policy', 3], ['cross-origin-resource-policy', 2],
  ['subresource-integrity', 5], ['mixed-content', 5],
];

/**
 * Value-aware grading of response security headers and (optionally) the HTML.
 * `headers` is a Headers or a plain object. Returns
 * { grade: 'A'..'F', score (0-100), headers: [{ header, status, reason, value, weight }] }
 * where status is good | warn | bad | absent.
 */
export function gradeSecurityHeaders(headers, html = '', opts = {}) {
  const h = normalizeHeaders(headers);
  const g = (n) => (h[n] ?? '').toString();
  const simple = (name, goodRe, goodReason, absentReason, badReason, badStatus = 'bad') => {
    const v = g(name).trim();
    if (!v) return { status: 'absent', reason: absentReason };
    return goodRe.test(v) ? { status: 'good', reason: goodReason || v } : { status: badStatus, reason: badReason };
  };
  const checks = {
    'content-security-policy': gradeCsp(g('content-security-policy'), !!g('content-security-policy-report-only')),
    'strict-transport-security': gradeHsts(g('strict-transport-security')),
    'x-frame-options': gradeXfo(g('x-frame-options'), g('content-security-policy')),
    'x-content-type-options': simple('x-content-type-options', /^nosniff$/i, 'nosniff.', 'Missing nosniff; MIME sniffing is allowed.', `Value "${g('x-content-type-options')}" is not nosniff.`),
    'referrer-policy': gradeReferrer(g('referrer-policy')),
    'permissions-policy': g('permissions-policy') ? { status: 'good', reason: 'Browser features are restricted.' } : { status: 'absent', reason: 'Browser features are not restricted.' },
    'cross-origin-opener-policy': simple('cross-origin-opener-policy', /^same-origin/i, '', 'No COOP; window references can leak across origins.', `COOP "${g('cross-origin-opener-policy')}" gives no isolation.`),
    'cross-origin-embedder-policy': simple('cross-origin-embedder-policy', /^(require-corp|credentialless)/i, '', 'No COEP.', 'unsafe-none does not isolate the page.', 'warn'),
    'cross-origin-resource-policy': simple('cross-origin-resource-policy', /^same-(origin|site)/i, '', 'No CORP.', 'cross-origin allows any site to embed this resource.', 'warn'),
    'subresource-integrity': gradeSri(html, opts.baseUrl),
    'mixed-content': gradeMixed(html, opts.baseUrl),
  };
  let earned = 0;
  const list = GRADE_WEIGHTS.map(([header, weight]) => {
    const c = checks[header];
    earned += c.status === 'good' ? weight : c.status === 'warn' ? weight / 2 : 0;
    return { header, ...c, value: h[header] ?? null, weight };
  });
  const score = Math.round(earned);
  let grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';
  // A broken CSP/HSTS value (or active mixed content) must never look healthy: cap the grade.
  const isBad = (n) => checks[n].status === 'bad';
  if ((isBad('content-security-policy') || isBad('strict-transport-security') || isBad('mixed-content')) && 'AB'.includes(grade)) grade = 'C';
  return { grade, score, headers: list };
}
