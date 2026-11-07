// Browser-based TCP connect scanner using fetch timing.
//
// A browser cannot open raw sockets, but it can attempt an HTTP(S) connection to
// host:port and infer the port state from how the attempt fails:
//   - the fetch resolves (opaque)         -> open (an HTTP service answered)
//   - it rejects quickly (TCP RST)        -> closed (connection refused)
//   - it times out / rejects slowly       -> open|filtered (handshake stalled or
//                                            packets dropped; indistinguishable)
//
// This is a heuristic, not a SYN scan. Limitations:
//   - From an HTTPS page, only HTTPS targets and localhost can be probed
//     (mixed-content blocks plain-HTTP requests).
//   - Open-but-non-HTTP ports look the same as filtered ports.
// Configure a proxy (netClient) to reach hosts the browser can't contact directly.

import { proxiedFetch } from './netClient';

const SERVICES = {
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 80: 'http',
  110: 'pop3', 143: 'imap', 443: 'https', 445: 'smb', 587: 'smtp', 993: 'imaps',
  995: 'pop3s', 3000: 'http-alt', 3306: 'mysql', 3389: 'rdp', 5432: 'postgres',
  5900: 'vnc', 6379: 'redis', 8000: 'http-alt', 8080: 'http-proxy', 8443: 'https-alt',
  9200: 'elasticsearch', 27017: 'mongodb',
};

const HTTPS_PORTS = new Set([443, 8443, 9443]);

// Ports Chrome refuses to fetch (ERR_UNSAFE_PORT). A browser cannot probe these,
// so they are reported as "blocked" rather than falsely "closed". Covers the
// classic service ports (ftp/ssh/telnet/smtp/imap/pop3/etc.).
const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540,
  548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

export function isBrowserBlockedPort(port) {
  return BLOCKED_PORTS.has(port);
}

export function guessService(port) {
  return SERVICES[port] || '';
}

export function parsePorts(input) {
  const ports = new Set();
  for (const part of input.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map((n) => parseInt(n, 10));
      if (Number.isInteger(a) && Number.isInteger(b)) {
        for (let p = Math.min(a, b); p <= Math.max(a, b) && p <= 65535; p++) ports.add(p);
      }
    } else {
      const p = parseInt(trimmed, 10);
      if (Number.isInteger(p)) ports.add(p);
    }
  }
  return [...ports].filter((p) => p > 0 && p <= 65535);
}

export async function scanPort(host, port, { timeoutMs = 2000, closedThresholdMs = 1200 } = {}) {
  if (BLOCKED_PORTS.has(port)) {
    return { port, state: 'blocked', service: guessService(port), ms: null };
  }
  const scheme = HTTPS_PORTS.has(port) ? 'https' : 'http';
  const url = `${scheme}://${host}:${port}/`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = performance.now();
  try {
    await proxiedFetch(url, { mode: 'no-cors', signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    return { port, state: 'open', service: guessService(port), ms: Math.round(performance.now() - start) };
  } catch {
    clearTimeout(timer);
    const elapsed = performance.now() - start;
    if (ctrl.signal.aborted) return { port, state: 'open|filtered', service: guessService(port), ms: Math.round(elapsed) };
    if (elapsed < closedThresholdMs) return { port, state: 'closed', service: guessService(port), ms: Math.round(elapsed) };
    return { port, state: 'open|filtered', service: guessService(port), ms: Math.round(elapsed) };
  }
}

/**
 * Scan a host across many ports with bounded concurrency.
 * onResult(result) is called as each port finishes; shouldStop() can abort.
 */
export async function scanHost(host, ports, { concurrency = 8, onResult, shouldStop, ...opts } = {}) {
  const queue = [...ports];
  const results = [];
  async function worker() {
    while (queue.length) {
      if (shouldStop?.()) return;
      const port = queue.shift();
      const res = await scanPort(host, port, opts);
      results.push(res);
      onResult?.(res);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, ports.length) }, worker));
  return results.sort((a, b) => a.port - b.port);
}
