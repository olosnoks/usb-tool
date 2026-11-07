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
  20: 'ftp-data', 21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'dns', 67: 'dhcp',
  69: 'tftp', 80: 'http', 88: 'kerberos', 110: 'pop3', 111: 'rpcbind', 123: 'ntp',
  135: 'msrpc', 137: 'netbios-ns', 139: 'netbios-ssn', 143: 'imap', 161: 'snmp',
  389: 'ldap', 443: 'https', 445: 'smb', 465: 'smtps', 500: ' isakmp', 514: 'syslog',
  587: 'smtp-sub', 631: 'ipp', 636: 'ldaps', 873: 'rsync', 989: 'ftps-data', 990: 'ftps',
  993: 'imaps', 995: 'pop3s', 1025: 'msrpc', 1080: 'socks', 1433: 'mssql', 1434: 'mssql-m',
  1521: 'oracle', 1723: 'pptp', 2049: 'nfs', 2082: 'cpanel', 2083: 'cpanel-ssl',
  2181: 'zookeeper', 2375: 'docker', 2376: 'docker-ssl', 3000: 'http-alt', 3306: 'mysql',
  3389: 'rdp', 3690: 'svn', 4444: 'metasploit', 4786: 'cisco-smi', 5000: 'http-alt',
  5173: 'vite', 5432: 'postgres', 5601: 'kibana', 5672: 'amqp', 5900: 'vnc', 5984: 'couchdb',
  6379: 'redis', 6443: 'kube-api', 7001: 'weblogic', 8000: 'http-alt', 8008: 'http-alt',
  8080: 'http-proxy', 8081: 'http-alt', 8086: 'influxdb', 8088: 'http-alt', 8443: 'https-alt',
  8500: 'consul', 8888: 'http-alt', 9000: 'http-alt', 9042: 'cassandra', 9092: 'kafka',
  9200: 'elasticsearch', 9300: 'elasticsearch', 11211: 'memcached', 15672: 'rabbitmq-mgmt',
  27017: 'mongodb', 27018: 'mongodb', 50070: 'hadoop',
};

/**
 * Named port profiles the UI can toggle on/off. Each `spec` is a port string in
 * parsePorts() syntax; the UI unions the selected profiles with any custom
 * ports. `heavy` marks sets that probe a lot of ports (slow in a browser).
 */
export const PORT_PROFILES = [
  { id: 'top20', label: 'Top 20', spec: '21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1723,3306,3389,5900,8080' },
  { id: 'web', label: 'Web', spec: '80,81,443,591,2082,2083,3000,5000,5173,8000,8008,8080,8081,8088,8443,8888,9000' },
  { id: 'db', label: 'Databases', spec: '1433,1521,3306,5432,5984,6379,7000,9042,9200,9300,11211,15672,27017' },
  { id: 'remote', label: 'Remote / Admin', spec: '22,23,3389,5900,5985,5986,2375,2376,6443' },
  { id: 'mail', label: 'Mail', spec: '25,110,143,465,587,993,995' },
  { id: 'wellknown', label: 'Well-known 1-1024', spec: '1-1024', heavy: true },
  { id: 'registered', label: '1-10000', spec: '1-10000', heavy: true },
  { id: 'full', label: 'All 1-65535', spec: '1-65535', heavy: true },
];

/**
 * Timing templates (nmap -T analog). Tune per-port timeout, the fast-refusal
 * threshold that distinguishes "closed" from "open|filtered", and concurrency.
 */
export const TIMINGS = {
  sneaky:   { label: 'Sneaky (T1)',   timeoutMs: 6000, closedThresholdMs: 3500, concurrency: 2 },
  polite:   { label: 'Polite (T2)',   timeoutMs: 4000, closedThresholdMs: 2500, concurrency: 4 },
  normal:   { label: 'Normal (T3)',   timeoutMs: 2000, closedThresholdMs: 1200, concurrency: 8 },
  aggressive: { label: 'Aggressive (T4)', timeoutMs: 1200, closedThresholdMs: 700, concurrency: 16 },
  insane:   { label: 'Insane (T5)',   timeoutMs: 700,  closedThresholdMs: 400, concurrency: 32 },
};

/** Union selected profile specs with a custom port string into one spec. */
export function buildPortSpec(selectedProfileIds = [], customText = '') {
  const specs = [];
  for (const id of selectedProfileIds) {
    const prof = PORT_PROFILES.find((p) => p.id === id);
    if (prof) specs.push(prof.spec);
  }
  if (customText && customText.trim()) specs.push(customText.trim());
  return specs.join(',');
}

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

export async function scanPort(host, port, { timeoutMs = 2000, closedThresholdMs = 1200, forceScheme } = {}) {
  if (BLOCKED_PORTS.has(port)) {
    return { port, state: 'blocked', service: guessService(port), ms: null };
  }
  const scheme = forceScheme === 'http' || forceScheme === 'https'
    ? forceScheme
    : (HTTPS_PORTS.has(port) ? 'https' : 'http');
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
