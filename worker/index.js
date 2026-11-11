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

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

/** Handle one /api/* request. `fetchImpl` is injectable for tests. */
export async function handleApi(request, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') return json({ ok: true, relays: Object.keys(RELAYS) });

  const target = relayTarget(url.pathname, url.search);
  if (!target) return json({ error: 'Unknown API route' }, 404);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, HEAD, OPTIONS' } });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed: the relay is read-only' }, 405);
  }
  // Fetch Metadata: refuse other sites using this as their relay. Absent (curl,
  // older browsers) is allowed so the route stays debuggable.
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site' || site === 'same-site') return json({ error: 'The relay only serves this site' }, 403);

  let upstream;
  try {
    upstream = await fetchImpl(target, {
      method: request.method,
      headers: { accept: 'application/json', 'user-agent': 'skons-usb-tool-relay' },
      redirect: 'follow',
    });
  } catch (e) {
    return json({ error: `Upstream unreachable: ${e?.message || e}` }, 502);
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
