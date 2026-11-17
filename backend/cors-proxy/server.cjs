// Generic CORS-forwarding proxy for Skon's USB Tool.
//
// The web app is static and runs in the browser, where CORS blocks most
// cross-origin requests. This service forwards an HTTP(S) request to any target
// and returns the response with permissive CORS headers so the browser tools
// (Web Analyzer, HTTP Workbench, API Client, URL Inspector, OSINT clients,
// crt.sh/Cert Inspect, Pwned Passwords, etc.) can read it.
//
// Because it runs on the Docker network it can also reach sibling services by
// name, e.g. the ZAP daemon at http://zap:8090 — the browser calls this proxy
// and the proxy calls ZAP.
//
// Supported URL styles (match src/utils/netClient.js):
//   - Placeholder: http://localhost:47101/fetch?url={url}
//   - Prefix:      http://localhost:47101/   -> /http://target/path
//
// No npm dependencies: Node standard library only.

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 47101;
// Optional comma-separated allowlist of target hosts. Empty = allow any.
const ALLOW_HOSTS = (process.env.ALLOW_HOSTS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '600');
}

function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function targetFromReq(req) {
  // /fetch?url=ENCODED  or  /<raw target url>
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/fetch') return u.searchParams.get('url');
  // prefix style: everything after the leading slash, keep query string
  let rest = req.url.replace(/^\/+/, '');
  if (!rest) return null;
  return decodeURIComponent(rest.startsWith('http') ? rest : '') || rest;
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'cors-proxy', version: 1 });

  const target = targetFromReq(req);
  if (!target || !/^https?:\/\//i.test(target)) {
    return sendJson(res, 400, { error: 'Provide a target: /fetch?url=<encoded> or /<http(s) url>' });
  }

  let parsed;
  try { parsed = new URL(target); } catch { return sendJson(res, 400, { error: 'Invalid target URL' }); }
  if (ALLOW_HOSTS.length && !ALLOW_HOSTS.includes(parsed.hostname.toLowerCase())) {
    return sendJson(res, 403, { error: `Host not allowed: ${parsed.hostname}` });
  }

  const headers = { ...req.headers };
  delete headers.host; delete headers.origin; delete headers.referer;
  delete headers['content-length']; // let the client set it from the piped body

  const noBody = req.method === 'GET' || req.method === 'HEAD';
  const cookies = [];
  const chain = [];

  // One upstream hop. Redirects are followed manually (GET/HEAD only, max 10) so
  // the browser can be told the chain and every hop's Set-Cookie.
  const hop = (url, count) => {
    const lib = url.protocol === 'https:' ? https : http;
    const upstream = lib.request(
      url,
      { method: req.method, headers: { ...headers, host: url.host }, rejectUnauthorized: false },
      (up) => {
        const sc = up.headers['set-cookie'];
        if (sc) cookies.push(...(Array.isArray(sc) ? sc : [sc]));
        chain.push({ status: up.statusCode || 0, url: url.href });
        const loc = up.headers.location;
        if (noBody && loc && [301, 302, 303, 307, 308].includes(up.statusCode) && count < 10) {
          let next;
          try { next = new URL(loc, url); } catch { next = null; }
          if (next && /^https?:$/.test(next.protocol)
            && (!ALLOW_HOSTS.length || ALLOW_HOSTS.includes(next.hostname.toLowerCase()))) {
            up.resume();
            return hop(next, count + 1);
          }
        }
        cors(res);
        const out = { ...up.headers };
        // strip hop-by-hop / CORS-conflicting headers from upstream
        delete out['access-control-allow-origin'];
        delete out['content-security-policy'];
        delete out['transfer-encoding'];
        delete out['set-cookie']; // browsers hide it from fetch(); expose a copy instead
        if (cookies.length) out['x-proxy-set-cookie'] = asciiJson(cookies);
        if (chain.length > 1) out['x-proxy-redirects'] = asciiJson(chain);
        res.writeHead(up.statusCode || 502, out);
        up.pipe(res);
      },
    );
    upstream.on('error', (e) => { if (!res.headersSent) sendJson(res, 502, { error: `Upstream request failed: ${e.message}` }); else res.destroy(); });
    if (noBody) upstream.end(); else req.pipe(upstream);
  };
  hop(parsed, 0);
});

// JSON safe for an HTTP header value (non-ASCII escaped).
function asciiJson(v) {
  return JSON.stringify(v).replace(/[^\x20-\x7e]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

if (require.main === module) {
  server.listen(PORT, () => console.log(`cors-proxy listening on :${PORT}${ALLOW_HOSTS.length ? ` (allow: ${ALLOW_HOSTS.join(',')})` : ''}`));
}
module.exports = { server };
