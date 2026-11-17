// Passive web security scanner.
//
// A browser cannot run an active vulnerability scanner against cross-origin
// targets (CORS and the lack of raw sockets forbid it). It can, however, perform
// real passive checks on a response it is allowed to read: missing security
// headers, information-disclosure headers, insecure cookies, cleartext transport,
// and permissive CORS. Each finding maps to a severity and a CWE.
//
// Reading cross-origin response headers requires CORS, so for arbitrary targets
// route the request through a proxy (netClient). Same-origin and CORS-enabled
// targets work directly.

import { proxiedFetch, isProxyEnabled, describeNetworkError, getSetCookie } from './netClient';

const SEVERITY_ORDER = { High: 0, Medium: 1, Low: 2, Info: 3 };

function headerChecks(url, headers, setCookies = null) {
  const findings = [];
  const has = (name) => headers.has(name);
  const get = (name) => headers.get(name) || '';
  const isHttps = url.startsWith('https://');

  const add = (severity, cwe, desc) => findings.push({ severity, cwe, desc });

  // Transport
  if (!isHttps) add('High', '319', 'Site served over cleartext HTTP; traffic can be read or modified in transit.');
  if (isHttps && !has('strict-transport-security')) add('Medium', '319', 'Missing Strict-Transport-Security (HSTS); downgrade attacks are possible.');

  // Framing / clickjacking
  const csp = get('content-security-policy');
  if (!has('content-security-policy')) add('Medium', '693', 'Missing Content-Security-Policy; no defense-in-depth against injected content.');
  if (!has('x-frame-options') && !/frame-ancestors/i.test(csp)) add('Medium', '1021', 'No X-Frame-Options or CSP frame-ancestors; page can be framed (clickjacking).');

  // Sniffing / misc hardening
  if (get('x-content-type-options').toLowerCase() !== 'nosniff') add('Low', '693', 'Missing X-Content-Type-Options: nosniff; MIME sniffing allowed.');
  if (!has('referrer-policy')) add('Low', '200', 'Missing Referrer-Policy; full URLs may leak to third parties.');
  if (!has('permissions-policy')) add('Info', '693', 'Missing Permissions-Policy; browser features are not restricted.');

  // Information disclosure
  if (has('server') && /\d/.test(get('server'))) add('Low', '200', `Server header discloses software/version: "${get('server')}".`);
  if (has('x-powered-by')) add('Low', '200', `X-Powered-By discloses technology: "${get('x-powered-by')}".`);
  if (has('x-aspnet-version')) add('Low', '200', `X-AspNet-Version discloses framework version: "${get('x-aspnet-version')}".`);

  // CORS
  const acao = get('access-control-allow-origin');
  const acac = get('access-control-allow-credentials').toLowerCase() === 'true';
  if (acao === '*' && acac) add('High', '942', 'CORS allows any origin (*) with credentials; cross-site data theft is possible.');
  else if (acao === '*') add('Low', '942', 'CORS allows any origin (*); review whether this endpoint should be public.');

  // Cookies (browsers usually strip Set-Cookie from fetch; visible via a proxy)
  const setCookie = setCookies ? setCookies.join('\n') : get('set-cookie');
  if (setCookie) {
    if (!/;\s*secure/i.test(setCookie)) add('Medium', '614', 'Set-Cookie without the Secure flag; cookie can be sent over HTTP.');
    if (!/;\s*httponly/i.test(setCookie)) add('Medium', '1004', 'Set-Cookie without HttpOnly; cookie is readable by JavaScript.');
    if (!/;\s*samesite/i.test(setCookie)) add('Low', '1275', 'Set-Cookie without SameSite; cross-site request forgery risk.');
  }

  return findings;
}

/**
 * Pure: run passive checks on headers that were already fetched (a Headers
 * object). `setCookies` is the cookie array from netClient.getSetCookie, or null.
 * Returns { alerts, note }.
 */
export function scanHeaders(url, headers, { status, setCookies = null } = {}) {
  const headerNames = [...headers.keys()];
  const alerts = headerChecks(url, headers, setCookies);
  alerts.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  let note = `${status ? `HTTP ${status}. ` : ''}${headerNames.length} response header(s) readable.`;
  if (!isProxyEnabled() && headerNames.length <= 3) {
    note += ' Few headers are readable cross-origin without CORS; use a proxy for a complete passive scan.';
  }
  if (alerts.length === 0) {
    alerts.push({ severity: 'Info', cwe: '', desc: 'No passive issues found in readable headers.' });
  }
  return { alerts, note };
}

/**
 * Fetch a URL and run passive checks (thin wrapper for other callers).
 * Returns { ok, alerts, note } or { ok:false, error }.
 */
export async function runPassiveScan(url) {
  let resp;
  try {
    resp = await proxiedFetch(url, { method: 'GET', redirect: 'follow' });
  } catch (e) {
    return { ok: false, error: describeNetworkError(e) };
  }
  const { alerts, note } = scanHeaders(url, resp.headers, { status: resp.status, setCookies: getSetCookie(resp) });
  return { ok: true, alerts, note };
}
