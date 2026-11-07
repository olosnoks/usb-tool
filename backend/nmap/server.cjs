// Nmap backend for Skon's USB Tool.
//
// The browser Nmap tool can only infer port state from fetch timing. This
// service runs the real nmap binary and returns structured results, so the tool
// can do true service/version detection and scan non-HTTP ports.
//
// Only scan hosts you own or are explicitly authorized to assess.
//
// API:
//   GET  /health
//   POST /scan   { "target": "host|ip", "ports": "22,80,1-1000", "profile": "default|version|quick" }
//        -> { ok, target, ports, raw, hosts:[{port,proto,state,service,version}] }
//
// No npm dependencies: Node standard library only.

const http = require('http');
const { spawnSync } = require('child_process');

const PORT = Number(process.env.PORT) || 8091;
const MAX_RUNTIME_MS = Number(process.env.SCAN_TIMEOUT_MS) || 120000;

// Reject anything that is not a plain hostname or IPv4/IPv6 literal.
const TARGET_RE = /^[a-zA-Z0-9._:-]{1,255}$/;
// Ports: digits, commas, dashes only.
const PORTS_RE = /^[0-9,\-]{1,400}$/;

const PROFILES = {
  quick: ['-T4', '-F'],
  default: ['-T4'],
  version: ['-T4', '-sV'],
};

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
}
function sendJson(res, code, obj) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function parseGreppable(raw) {
  // Parse nmap -oX is richer, but -oG is easy and dependency-free to read.
  const hosts = [];
  const re = /(\d+)\/(open|closed|filtered)\/(tcp|udp)\/\/([^\/]*)\/\/([^\/,]*)/g;
  let m;
  while ((m = re.exec(raw))) {
    hosts.push({ port: Number(m[1]), state: m[2], proto: m[3], service: m[4] || '', version: (m[5] || '').replace(/\|/g, ' ').trim() });
  }
  return hosts;
}

function runScan({ target, ports, profile }) {
  const args = [...(PROFILES[profile] || PROFILES.default)];
  if (ports) args.push('-p', ports);
  args.push('-oG', '-'); // greppable to stdout
  args.push('--', target);
  const r = spawnSync('nmap', args, { timeout: MAX_RUNTIME_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' });
  if (r.error) throw new Error(r.error.message);
  const raw = (r.stdout || '') + (r.stderr ? `\n${r.stderr}` : '');
  return { raw, hosts: parseGreppable(r.stdout || '') };
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (req.url === '/health') return sendJson(res, 200, { ok: true, service: 'nmap', version: 1 });
  if (req.method !== 'POST' || req.url !== '/scan') return sendJson(res, 404, { error: 'POST /scan' });

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    let p;
    try { p = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    const target = String(p.target || '').trim();
    const ports = p.ports ? String(p.ports).trim() : '';
    const profile = String(p.profile || 'default');
    if (!TARGET_RE.test(target)) return sendJson(res, 400, { error: 'Invalid target (hostname or IP only)' });
    if (ports && !PORTS_RE.test(ports)) return sendJson(res, 400, { error: 'Invalid ports (digits, commas, dashes only)' });
    try {
      const { raw, hosts } = runScan({ target, ports, profile });
      sendJson(res, 200, { ok: true, target, ports, profile, hosts, raw });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });
});

server.listen(PORT, () => console.log(`nmap backend listening on :${PORT}`));
