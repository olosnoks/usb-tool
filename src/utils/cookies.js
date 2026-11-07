// Set-Cookie parsing and security analysis (OWASP PTK / ZAP-style), pure.
//
// NOTE: browsers normally hide the Set-Cookie response header from fetch() (it
// is a forbidden response-header name). These helpers analyze whatever
// Set-Cookie value is available — e.g. when reached through a proxy that
// forwards it — and the UI states that caveat.

/**
 * Split a combined Set-Cookie header into individual cookie strings. Cookies
 * are comma-joined, but an `Expires=Wed, 09 Jun 2025 ...` date also contains a
 * comma; split only on commas that start a new `name=` pair.
 */
export function splitSetCookie(headerValue) {
  if (Array.isArray(headerValue)) return headerValue;
  const s = String(headerValue || '');
  const parts = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === ',') {
      // look ahead: a new cookie starts with optional spaces then token`=`
      const rest = s.slice(i + 1);
      if (/^\s*[^=;,\s]+=/.test(rest) && !/^\s*\d{1,2}[ -]/.test(rest)) { parts.push(cur); cur = ''; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parse one Set-Cookie string into { name, value, attrs }. */
export function parseSetCookie(str) {
  const segs = String(str).split(';').map((x) => x.trim()).filter(Boolean);
  if (segs.length === 0) return null;
  const [nv, ...rest] = segs;
  const eq = nv.indexOf('=');
  const name = eq >= 0 ? nv.slice(0, eq).trim() : nv.trim();
  const value = eq >= 0 ? nv.slice(eq + 1) : '';
  const attrs = {};
  for (const seg of rest) {
    const i = seg.indexOf('=');
    if (i >= 0) attrs[seg.slice(0, i).trim().toLowerCase()] = seg.slice(i + 1).trim();
    else attrs[seg.trim().toLowerCase()] = true;
  }
  return { name, value, attrs };
}

/** Security verdict for one parsed cookie. Returns flags + warnings. */
export function analyzeCookie(cookie) {
  const a = cookie.attrs || {};
  const secure = 'secure' in a;
  const httpOnly = 'httponly' in a;
  const sameSite = (a.samesite || '').toString() || null;
  const session = !('expires' in a) && !('max-age' in a);
  const warnings = [];
  if (!secure) warnings.push('No Secure flag — may be sent over plaintext HTTP.');
  if (!httpOnly) warnings.push('No HttpOnly flag — readable by JavaScript (XSS theft risk).');
  if (!sameSite) warnings.push('No SameSite attribute — defaults vary; CSRF exposure.');
  else if (/^none$/i.test(sameSite) && !secure) warnings.push('SameSite=None without Secure — rejected by modern browsers.');
  return {
    name: cookie.name,
    secure, httpOnly, sameSite, session,
    path: a.path || '/', domain: a.domain || null,
    expires: a.expires || null, maxAge: a['max-age'] || null,
    warnings,
    ok: warnings.length === 0,
  };
}

/** Analyze a Set-Cookie header value (string or array) into per-cookie reports. */
export function analyzeSetCookies(headerValue) {
  return splitSetCookie(headerValue).map((s) => analyzeCookie(parseSetCookie(s))).filter(Boolean);
}

/** Extract just the cookie names (for fingerprinting). */
export function cookieNames(headerValue) {
  return splitSetCookie(headerValue).map((s) => parseSetCookie(s)?.name).filter(Boolean);
}
