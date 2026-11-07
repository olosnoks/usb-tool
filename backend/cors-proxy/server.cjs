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
//   - Placeholder: http://localhost:8080/fetch?url={url}
//   - Prefix:      http://localhost:8080/   -> /http://target/path
//
// No npm dependencies: Node standard library only.

const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORT = Number(process.env.PORT) || 8080;
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

  const lib = parsed.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  delete headers.host; delete headers.origin; delete headers.referer;
  delete headers['content-length']; // let the client set it from the piped body

  const upstream = lib.request(
    parsed,
    { method: req.method, headers, rejectUnauthorized: false },
    (up) => {
      cors(res);
      const out = { ...up.headers };
      // strip hop-by-hop / CORS-conflicting headers from upstream
      delete out['access-control-allow-origin'];
      delete out['content-security-policy'];
      delete out['transfer-encoding'];
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => sendJson(res, 502, { error: `Upstream request failed: ${e.message}` }));
  req.pipe(upstream);
});

server.listen(PORT, () => console.log(`cors-proxy listening on :${PORT}${ALLOW_HOSTS.length ? ` (allow: ${ALLOW_HOSTS.join(',')})` : ''}`));
