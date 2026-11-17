// Configurable network client for the security workbenches.
//
// The app is a static, client-side-only site. Browsers enforce CORS, so direct
// fetch() calls only succeed against CORS-permissive endpoints (public APIs such
// as HaveIBeenPwned and DNS-over-HTTPS, or servers that send
// Access-Control-Allow-Origin). To reach arbitrary targets (internal hosts,
// servers without CORS headers) the user can run a local proxy and point the
// tools at it here.
//
// Proxy URL formats supported:
//   - Placeholder style: "https://proxy.local/fetch?url={url}"  ({url} is
//     replaced with the URL-encoded target)
//   - Prefix style:      "https://proxy.local/"  (the raw target URL is appended,
//     e.g. cors-anywhere: https://proxy.local/https://target/path)
//
// The proxy setting is persisted in localStorage so it survives reloads.

const STORAGE_KEY = 'skon.net.proxyUrl';

export function getProxyUrl() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setProxyUrl(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore storage errors (private mode, etc.) */
  }
}

// Build the effective request URL given the configured proxy.
export function resolveUrl(targetUrl) {
  const proxy = getProxyUrl();
  if (!proxy) return targetUrl;
  if (proxy.includes('{url}')) {
    return proxy.replace('{url}', encodeURIComponent(targetUrl));
  }
  return proxy.replace(/\/+$/, '') + '/' + targetUrl;
}

export function isProxyEnabled() {
  return !!getProxyUrl();
}

/**
 * fetch() wrapper that routes through the configured proxy when one is set.
 * Returns the native Response. Throws on network errors (same as fetch).
 */
export async function proxiedFetch(targetUrl, options = {}) {
  const url = resolveUrl(targetUrl);
  return fetch(url, options);
}

/**
 * Classify a fetch failure so tools can give the user an honest explanation.
 * A browser cannot distinguish a CORS rejection from a DNS/connection failure;
 * both surface as a TypeError with no status. We report that ambiguity plainly.
 */
export function describeNetworkError(err) {
  if (err && err.name === 'TypeError') {
    return isProxyEnabled()
      ? 'Request failed (proxy unreachable, target down, or proxy rejected the request).'
      : 'Request failed. In a browser this is usually CORS blocking the response, or the host being unreachable. Configure a proxy to reach non-CORS targets.';
  }
  return err?.message || String(err);
}

function parseProxyJson(resp, name) {
  const raw = resp?.headers?.get?.(name);
  if (!raw) return null;
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : null; } catch { return null; }
}

/**
 * Set-Cookie strings forwarded by the bundled proxy in x-proxy-set-cookie
 * (JSON array). Returns null when the header is absent (browsers hide the real
 * Set-Cookie), so callers can tell "no cookies" from "cannot see cookies".
 */
export function getSetCookie(resp) {
  return parseProxyJson(resp, 'x-proxy-set-cookie');
}

/** Redirect chain [{ status, url }] from x-proxy-redirects, or null when absent. */
export function getRedirectChain(resp) {
  return parseProxyJson(resp, 'x-proxy-redirects');
}
