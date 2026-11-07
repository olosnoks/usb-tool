// TLS / certificate inspector backend for Skon's USB Tool.
//
// A browser cannot open a raw TLS socket, so the Cert Inspect tool can only read
// certificates from Certificate Transparency logs (what was issued), not what a
// server actually serves right now. This service performs a live TLS handshake
// and returns the server's current certificate chain.
//
// API:
//   GET /health
//   GET /cert?host=example.com&port=443&servername=example.com
//       -> { ok, host, port, peer:{subject,issuer,validFrom,validTo,...}, chain:[...], pem }
//
// No npm dependencies: Node standard library only.

const http = require('http');
const tls = require('tls');

const PORT = Number(process.env.PORT) || 47103;
const HOST_RE = /^[a-zA-Z0-9._-]{1,255}$/;

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

function flattenCert(c, seen = new Set()) {
  if (!c || !c.subject) return [];
  const fp = c.fingerprint256 || c.fingerprint;
  if (fp && seen.has(fp)) return [];
  if (fp) seen.add(fp);
  const node = {
    subject: c.subject, issuer: c.issuer,
    subjectaltname: c.subjectaltname || '',
    validFrom: c.valid_from, validTo: c.valid_to,
    serialNumber: c.serialNumber,
    fingerprint256: c.fingerprint256, fingerprint: c.fingerprint,
    bits: c.bits, pubkeyAlgorithm: c.asn1Curve || c.nistCurve || undefined,
  };
  const chain = [node];
  if (c.issuerCertificate && c.issuerCertificate !== c) {
    chain.push(...flattenCert(c.issuerCertificate, seen));
  }
  return chain;
}

function getCert({ host, port, servername }, cb) {
  const socket = tls.connect(
    { host, port, servername: servername || host, rejectUnauthorized: false, timeout: 10000 },
    () => {
      const peer = socket.getPeerCertificate(true);
      let pem = '';
      try {
        const raw = socket.getPeerX509Certificate ? socket.getPeerX509Certificate() : null;
        if (raw && raw.toString) pem = raw.toString();
      } catch { /* older node: no X509 object */ }
      const chain = flattenCert(peer);
      cb(null, { peer: chain[0] || null, chain, protocol: socket.getProtocol(), cipher: socket.getCipher(), pem });
      socket.end();
    },
  );
  socket.on('timeout', () => { socket.destroy(); cb(new Error('TLS handshake timed out')); });
  socket.on('error', (e) => cb(e));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') return sendJson(res, 200, { ok: true, service: 'tls-inspector', version: 1 });
  if (u.pathname !== '/cert') return sendJson(res, 404, { error: 'GET /cert?host=&port=' });

  const host = String(u.searchParams.get('host') || '').trim();
  const port = Number(u.searchParams.get('port') || 443);
  const servername = String(u.searchParams.get('servername') || '').trim();
  if (!HOST_RE.test(host)) return sendJson(res, 400, { error: 'Invalid host' });
  if (!(port > 0 && port < 65536)) return sendJson(res, 400, { error: 'Invalid port' });

  getCert({ host, port, servername }, (err, data) => {
    if (err) return sendJson(res, 502, { error: err.message });
    sendJson(res, 200, { ok: true, host, port, ...data });
  });
});

server.listen(PORT, () => console.log(`tls-inspector listening on :${PORT}`));
