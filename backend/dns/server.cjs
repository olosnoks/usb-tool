// DNS backend for Skon's USB Tool.
//
// DNS-over-HTTPS works from the browser for common record types, but is limited
// to CORS-enabled resolvers and cannot target an arbitrary nameserver. This
// service resolves any record type against the system resolver or a custom
// server and returns structured results.
//
// API:
//   GET /health
//   GET /resolve?name=example.com&type=A&server=1.1.1.1
//       -> { ok, name, type, server, records:[...] }
//
// No npm dependencies: Node standard library only.

const http = require('http');
const dns = require('dns');

const PORT = Number(process.env.PORT) || 8095;
const NAME_RE = /^[a-zA-Z0-9._-]{1,255}$/;
const IP_RE = /^[0-9a-fA-F.:]{1,45}$/;
const TYPES = new Set(['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'SRV', 'PTR', 'CAA', 'NAPTR', 'ANY']);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}
function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function resolve({ name, type, server }) {
  const resolver = new dns.promises.Resolver();
  if (server) resolver.setServers([server]);
  if (type === 'PTR') return resolver.reverse(name);
  if (type === 'ANY') return resolver.resolveAny(name);
  return resolver.resolve(name, type);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'dns', version: 1 });
  if (u.pathname !== '/resolve') return sendJson(res, 404, { error: 'GET /resolve?name=&type=' });

  const name = String(u.searchParams.get('name') || '').trim();
  const type = String(u.searchParams.get('type') || 'A').toUpperCase();
  const srv = String(u.searchParams.get('server') || '').trim();
  if (!NAME_RE.test(name)) return sendJson(res, 400, { error: 'Invalid name' });
  if (!TYPES.has(type)) return sendJson(res, 400, { error: `Unsupported type (${[...TYPES].join(', ')})` });
  if (srv && !IP_RE.test(srv)) return sendJson(res, 400, { error: 'Invalid server IP' });

  try {
    const records = await resolve({ name, type, server: srv });
    sendJson(res, 200, { ok: true, name, type, server: srv || 'system', records });
  } catch (e) {
    sendJson(res, 502, { error: `${e.code || ''} ${e.message}`.trim() });
  }
});

server.listen(PORT, () => console.log(`dns backend listening on :${PORT}`));
