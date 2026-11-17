// Cloudflare Worker in front of the static site (see wrangler.jsonc).
//
// The built site in _site/ is served by Cloudflare's asset layer directly; this
// code runs only for /api/* (`run_worker_first`). Its one job is to relay the
// Shodan REST API for the OSINT client: api.shodan.io sends no CORS headers, so
// a browser cannot call it from the page, but it can call this same-origin
// route and the Worker forwards the request server-side.
//
// Deliberately narrow: GET/HEAD only, only the upstreams listed in RELAYS, no
// cookies or auth forwarded, nothing cached. The caller's own Shodan key travels
// in the query string exactly as the client built it; the Worker holds none.

export const RELAYS = {
  '/api/shodan': 'https://api.shodan.io',
  '/api/shodan-exploits': 'https://exploits.shodan.io/api',
};

/** Map a relay path (+ query) to its upstream URL, or null if not a relay route. */
export function relayTarget(pathname, search = '') {
  for (const [prefix, base] of Object.entries(RELAYS)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) {
      return base + pathname.slice(prefix.length) + (search || '');
    }
  }
  return null;
}

// Have I Been Pwned v3 relay. Unlike Shodan the key travels in a header, so this
// is a separate, stricter route table: exact paths only, a fixed query allowlist,
// the caller's hibp-api-key forwarded and nothing else. The email is in the path
// and is never logged.
const HIBP_BASE = 'https://haveibeenpwned.com/api/v3';
const HIBP_EMAIL = /^[^\s@/?#%]{1,64}@[^\s@/?#%]{1,255}$/;
const HIBP_QUERY = { breachedaccount: ['truncateResponse', 'domain', 'includeUnverified'], pasteaccount: [] };

/** Map /api/hibp/(breachedaccount|pasteaccount)/:email to its upstream URL, or null. */
export function hibpTarget(pathname, search = '') {
  const m = /^\/api\/hibp\/(breachedaccount|pasteaccount)\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  let email;
  try { email = decodeURIComponent(m[2]); } catch { return null; }
  if (!HIBP_EMAIL.test(email)) return null;
  const allowed = HIBP_QUERY[m[1]];
  const q = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) {
    if (allowed.includes(k) && /^[A-Za-z0-9.\-]{1,100}$/.test(v)) q.set(k, v);
  }
  const qs = q.toString();
  return `${HIBP_BASE}/${m[1]}/${encodeURIComponent(email)}${qs ? '?' + qs : ''}`;
}

// crt.sh Certificate Transparency search. One exact path, a fixed query
// allowlist with validated values, and the upstream URL rebuilt from scratch so
// nothing else can be smuggled through. Deliberately NOT in RELAYS (that table
// is the Shodan prefix-relay and is asserted equal to the client's list).
export const CRTSH_BASE = 'https://crt.sh/';
const CRTSH_Q = /^%?\.?[A-Za-z0-9.-]{1,253}$/;
const CRTSH_VALUES = { output: /^json$/, exclude: /^expired$/, deduplicate: /^Y$/ };

/** Map /api/crtsh?q=… to the crt.sh URL, or null for any other path, key or value. */
export function crtshTarget(pathname, search = '') {
  if (pathname !== '/api/crtsh') return null;
  const params = new URLSearchParams(search);
  let q = null;
  const extra = new URLSearchParams();
  for (const [k, v] of params) {
    if (k === 'q') {
      if (q !== null || !CRTSH_Q.test(v)) return null;
      q = v;
    } else if (CRTSH_VALUES[k] && CRTSH_VALUES[k].test(v)) {
      extra.set(k, v);
    } else {
      return null;
    }
  }
  if (q === null) return null;
  const out = new URLSearchParams({ q, output: 'json' });
  if (extra.has('exclude')) out.set('exclude', extra.get('exclude'));
  if (extra.has('deduplicate')) out.set('deduplicate', extra.get('deduplicate'));
  return `${CRTSH_BASE}?${out.toString()}`;
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Handle one /api/* request. `fetchImpl` is injectable for tests. */
export async function handleApi(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') return json({ ok: true, relays: [...Object.keys(RELAYS), '/api/hibp', '/api/crtsh'] });

  const isHibp = url.pathname.startsWith('/api/hibp/');
  const isCrtsh = url.pathname === '/api/crtsh';
  const target = isHibp ? hibpTarget(url.pathname, url.search)
    : isCrtsh ? crtshTarget(url.pathname, url.search)
    : relayTarget(url.pathname, url.search);
  if (!target) return json({ error: isCrtsh ? 'Invalid crt.sh query' : 'Unknown API route' }, isHibp || isCrtsh ? 400 : 404);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, OPTIONS' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed: the relay is read-only' }, 405);
  }
  // Fetch Metadata: refuse other sites using this as their relay. Absent (curl,
  // older browsers) is allowed so the route stays debuggable.
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return json({ error: 'The relay only serves this site' }, 403);

  const fwd = { accept: 'application/json', 'user-agent': 'skons-usb-tool-relay' };
  if (isHibp) {
    const key = request.headers.get('hibp-api-key');
    if (!key) return json({ error: 'hibp-api-key header required' }, 401);
    fwd['hibp-api-key'] = key;
  }
  let upstream;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers: fwd,
      redirect: isHibp || isCrtsh ? 'manual' : 'follow',
      signal: AbortSignal.timeout(isHibp ? 10000 : 25000),
    });
  } catch (e) {
    return json({ error: `Upstream unreachable: ${e?.name === 'TimeoutError' ? 'timed out' : (e?.message || e)}` }, 502);
  }
  const headers = new Headers();
  headers.set('content-type', upstream.headers.get('content-type') || 'application/json');
  headers.set('cache-control', 'no-store');
  headers.set('x-relay-upstream', new URL(target).host);
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request);
    // Not reached for asset paths (run_worker_first is limited to /api/*), but
    // keep the fallback so a wider match still serves the site.
    if (env?.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
