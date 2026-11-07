// Hydra backend for Skon's USB Tool — AUTHORIZED SECURITY TESTING ONLY.
//
// THC-Hydra performs online credential testing. Running it against systems you do
// not own or have explicit written permission to test is illegal in most
// jurisdictions. This service is deliberately disabled unless you opt in:
//
//   - It only starts under the Compose "offensive" profile
//     (docker compose --profile offensive up).
//   - It refuses every request unless the environment variable
//     I_HAVE_AUTHORIZATION=yes is set, confirming you have authorization for the
//     targets you will test.
//
// API:
//   GET  /health
//   POST /attack  { target, service, port?, username?, userlist?, password?,
//                   passlist?, threads?, stopOnFirst? }
//        -> { ok, found:[{user,pass}], raw }
//
// Wordlists are passed inline and written to a temp file; no filesystem browsing
// is exposed. No npm dependencies: Node standard library only.

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PORT = Number(process.env.PORT) || 47106;
const AUTHORIZED = String(process.env.I_HAVE_AUTHORIZATION || '').toLowerCase() === 'yes';
const MAX_RUNTIME_MS = Number(process.env.ATTACK_TIMEOUT_MS) || 180000;

const TARGET_RE = /^[a-zA-Z0-9._:-]{1,255}$/;
const SERVICE_RE = /^[a-z0-9-]{1,20}$/; // ssh, ftp, http-get, smb, ...
const SAFE_LINE = /^[^\r\n\0]{0,256}$/;

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

function writeList(lines) {
  const safe = (Array.isArray(lines) ? lines : String(lines).split('\n'))
    .map((l) => l.trim()).filter((l) => l && SAFE_LINE.test(l));
  if (!safe.length) return null;
  const f = path.join(os.tmpdir(), `h-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(f, safe.join('\n') + '\n');
  return f;
}

function runHydra(p) {
  const tmp = [];
  const args = [];
  try {
    if (p.username) { args.push('-l', String(p.username)); }
    else if (p.userlist) { const f = writeList(p.userlist); if (f) { tmp.push(f); args.push('-L', f); } }
    if (p.password) { args.push('-p', String(p.password)); }
    else if (p.passlist) { const f = writeList(p.passlist); if (f) { tmp.push(f); args.push('-P', f); } }
    const threads = Math.max(1, Math.min(64, Number(p.threads) || 16));
    args.push('-t', String(threads));
    if (p.stopOnFirst) args.push('-f');
    if (p.port) args.push('-s', String(Math.max(1, Math.min(65535, Number(p.port)))));
    args.push('-o', '-'); // results to stdout
    args.push(String(p.target));
    args.push(String(p.service));
    const r = spawnSync('hydra', args, { timeout: MAX_RUNTIME_MS, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' });
    if (r.error) throw new Error(r.error.message);
    const raw = (r.stdout || '') + (r.stderr ? `\n${r.stderr}` : '');
    const found = [];
    const re = /host:\s*\S+\s+login:\s*(\S+)\s+password:\s*(\S*)/gi;
    let m; while ((m = re.exec(r.stdout || ''))) found.push({ user: m[1], pass: m[2] });
    return { raw, found };
  } finally {
    tmp.forEach((f) => { try { fs.unlinkSync(f); } catch { /* ignore */ } });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  if (req.url === '/health') {
    return sendJson(res, 200, { ok: true, service: 'hydra', authorized: AUTHORIZED, version: 1 });
  }
  if (req.method !== 'POST' || req.url !== '/attack') return sendJson(res, 404, { error: 'POST /attack' });
  if (!AUTHORIZED) {
    return sendJson(res, 403, { error: 'Disabled. Set I_HAVE_AUTHORIZATION=yes to confirm you are authorized to test the targets.' });
  }

  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
  req.on('end', () => {
    let p;
    try { p = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }
    if (!TARGET_RE.test(String(p.target || ''))) return sendJson(res, 400, { error: 'Invalid target' });
    if (!SERVICE_RE.test(String(p.service || ''))) return sendJson(res, 400, { error: 'Invalid service' });
    if (!p.username && !p.userlist) return sendJson(res, 400, { error: 'Provide username or userlist' });
    if (!p.password && !p.passlist) return sendJson(res, 400, { error: 'Provide password or passlist' });
    try {
      const { raw, found } = runHydra(p);
      sendJson(res, 200, { ok: true, found, raw });
    } catch (e) {
      sendJson(res, 500, { error: e.message });
    }
  });
});

server.listen(PORT, () => console.log(`hydra backend listening on :${PORT} (authorized=${AUTHORIZED})`));
