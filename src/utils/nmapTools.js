// Pure helpers for the Nmap workbench: command builder/explainer and parsers for
// nmap XML (-oX) and grepable (-oG) output the user produced themselves.

export const SCAN_TYPES = [
  { flag: '-sT', label: 'TCP connect', desc: 'Full TCP connect scan; works without raw-socket privileges.' },
  { flag: '-sS', label: 'TCP SYN', desc: 'Half-open SYN scan; needs root/administrator.' },
  { flag: '-sU', label: 'UDP', desc: 'UDP scan; slow, needs root/administrator.' },
  { flag: '-sn', label: 'Ping only', desc: 'Host discovery only, no port scan.' },
];

const FLAG_DOCS = {
  '-sT': 'TCP connect scan.',
  '-sS': 'TCP SYN (half-open) scan; requires raw-socket privileges.',
  '-sU': 'UDP scan.',
  '-sn': 'Ping scan: host discovery only, no port scan.',
  '-sV': 'Probe open ports to determine service/version.',
  '-sC': 'Run the default NSE script set.',
  '-O': 'Enable OS detection.',
  '-A': 'Aggressive: OS detection, version detection, default scripts and traceroute.',
  '-Pn': 'Treat all hosts as online; skip host discovery.',
  '-n': 'Never do reverse DNS resolution.',
  '-R': 'Always resolve DNS.',
  '-v': 'Increase verbosity.',
  '-vv': 'Increase verbosity further.',
  '-F': 'Fast: scan the 100 most common ports.',
  '-6': 'Enable IPv6 scanning.',
  '--open': 'Only show open (or possibly open) ports.',
  '--reason': 'Show the reason a port is in its state.',
  '--traceroute': 'Trace the hop path to each host.',
  '-T0': 'Timing template 0 (paranoid, slowest).',
  '-T1': 'Timing template 1 (sneaky, slow).',
  '-T2': 'Timing template 2 (polite).',
  '-T3': 'Timing template 3 (normal, the default).',
  '-T4': 'Timing template 4 (aggressive; fine on fast, reliable networks).',
  '-T5': 'Timing template 5 (insane; may miss ports).',
};
const VALUE_FLAGS = {
  '-p': 'Ports to scan',
  '--top-ports': 'Scan the N most common ports',
  '-oX': 'Write XML output to file',
  '-oN': 'Write normal output to file',
  '-oG': 'Write grepable output to file',
  '-oA': 'Write all three output formats with this basename',
  '--script': 'Run the named NSE scripts/categories',
  '-iL': 'Read targets from a file',
  '--max-retries': 'Maximum probe retransmissions per port',
  '--host-timeout': 'Give up on a host after this long',
};

/** Build an nmap command line string from simple options. */
export function buildNmapCommand(o = {}) {
  const parts = ['nmap'];
  if (o.scanType) parts.push(o.scanType);
  if (o.serviceVersion) parts.push('-sV');
  if (o.defaultScripts) parts.push('-sC');
  if (o.osDetect) parts.push('-O');
  if (o.skipDiscovery) parts.push('-Pn');
  if (o.noDns) parts.push('-n');
  if (o.openOnly) parts.push('--open');
  if (o.reason) parts.push('--reason');
  if (o.timing !== undefined && o.timing !== '' && o.timing !== null) parts.push(`-T${Number(o.timing)}`);
  if (o.topPorts) parts.push('--top-ports', String(parseInt(o.topPorts, 10)));
  else if (o.ports && String(o.ports).trim()) parts.push('-p', String(o.ports).trim().replace(/\s+/g, ''));
  if (o.xmlOut) parts.push('-oX', o.xmlOut);
  parts.push(String(o.target || '<target>').trim());
  return parts.join(' ');
}

/** Tokenise a command and explain each flag. Returns {tokens:[{text,explain}], warnings}. */
export function explainNmapCommand(cmd) {
  const words = String(cmd || '').trim().split(/\s+/).filter(Boolean);
  const tokens = []; const warnings = [];
  let i = 0;
  if (words[i] === 'sudo') { tokens.push({ text: 'sudo', explain: 'Run with elevated privileges.' }); i++; }
  if (words[i] === 'nmap') { tokens.push({ text: 'nmap', explain: 'The Nmap network scanner.' }); i++; }
  for (; i < words.length; i++) {
    const w = words[i];
    const pm = /^-p(.+)$/.exec(w);
    if (FLAG_DOCS[w]) tokens.push({ text: w, explain: FLAG_DOCS[w] });
    else if (VALUE_FLAGS[w]) {
      const v = words[i + 1];
      if (v === undefined) { warnings.push(`${w} needs a value.`); tokens.push({ text: w, explain: VALUE_FLAGS[w] }); }
      else { tokens.push({ text: `${w} ${v}`, explain: `${VALUE_FLAGS[w]}: ${v}` }); i++; }
    } else if (pm && /^[\d,\-TUS:]+$/.test(pm[1])) tokens.push({ text: w, explain: `Ports to scan: ${pm[1]}` });
    else if (w.startsWith('--script=')) tokens.push({ text: w, explain: `Run NSE scripts: ${w.slice(9)}` });
    else if (w.startsWith('-')) tokens.push({ text: w, explain: 'Not in this explainer; see `nmap --help` or the man page.' });
    else tokens.push({ text: w, explain: 'Target (host, IP, CIDR range or hostname).' });
  }
  if (!tokens.some((t) => t.explain.startsWith('Target') || t.text.startsWith('-iL'))) warnings.push('No target given.');
  if (tokens.some((t) => ['-sS', '-sU', '-O'].includes(t.text.split(' ')[0]))) warnings.push('This option needs root/administrator privileges.');
  return { tokens, warnings };
}

const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function attrs(tag) {
  const out = {}; const re = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g; let m;
  while ((m = re.exec(tag))) out[m[1]] = unesc(m[2] ?? m[3]);
  return out;
}

/** Parse nmap XML (-oX). Returns {args, hosts:[{addr, hostname, status, os, ports:[...]}]}. */
export function parseNmapXml(text) {
  const src = String(text || '');
  if (!/<nmaprun[\s>]/.test(src)) throw new Error('Not nmap XML output (no <nmaprun> element).');
  const run = attrs((/<nmaprun\b[^>]*>/.exec(src) || [''])[0]);
  const hosts = [];
  const hostRe = /<host\b[^>]*>([\s\S]*?)<\/host>/g; let hm;
  while ((hm = hostRe.exec(src))) {
    const body = hm[1];
    const status = attrs((/<status\b[^>]*>/.exec(body) || [''])[0]).state || 'unknown';
    const addrs = [...body.matchAll(/<address\b[^>]*>/g)].map((m) => attrs(m[0]));
    const ip = addrs.find((a) => a.addrtype === 'ipv4' || a.addrtype === 'ipv6') || addrs[0] || {};
    const hn = /<hostname\b[^>]*>/.exec(body);
    const osm = /<osmatch\b[^>]*>/.exec(body);
    const ports = [];
    const portRe = /<port\b([^>]*)>([\s\S]*?)<\/port>/g; let pm;
    while ((pm = portRe.exec(body))) {
      const pa = attrs(pm[1]);
      const st = attrs((/<state\b[^>]*>/.exec(pm[2]) || [''])[0]);
      const sv = attrs((/<service\b[^>]*>/.exec(pm[2]) || [''])[0]);
      ports.push({
        port: Number(pa.portid), proto: pa.protocol || 'tcp', state: st.state || 'unknown',
        service: sv.name || '', product: sv.product || '', version: sv.version || '',
      });
    }
    hosts.push({ addr: ip.addr || '', hostname: hn ? attrs(hn[0]).name || '' : '', status, os: osm ? attrs(osm[0]).name || '' : '', ports });
  }
  return { args: run.args || '', hosts };
}

/** Parse grepable output (-oG). */
export function parseGrepable(text) {
  const hosts = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^Host:\s+(\S+)\s+\(([^)]*)\)\s+(.*)$/.exec(line);
    if (!m) continue;
    const rest = m[3];
    const status = /Status:\s*(\w+)/.exec(rest);
    const pf = /Ports:\s*(.*?)(?:\t[A-Z][\w ]*:|$)/.exec(rest);
    if (!pf && !status) continue;
    const ports = [];
    if (pf) {
      for (const ent of pf[1].split(/,\s*/)) {
        const f = ent.split('/');
        if (f.length < 5 || !/^\d+$/.test(f[0])) continue;
        ports.push({ port: Number(f[0]), state: f[1], proto: f[2], service: f[4], product: f[6] || '', version: '' });
      }
    }
    let h = hosts.find((x) => x.addr === m[1]);
    if (!h) { h = { addr: m[1], hostname: m[2], status: 'up', os: '', ports: [] }; hosts.push(h); }
    if (status) h.status = status[1].toLowerCase();
    h.ports.push(...ports);
  }
  if (!hosts.length) throw new Error('No "Host:" lines found; is this -oG output?');
  return { args: '', hosts };
}

/** Auto-detect format and parse. */
export function parseNmapOutput(text) {
  return /<nmaprun[\s>]/.test(String(text)) ? parseNmapXml(text) : parseGrepable(text);
}

export function flattenScan(scan) {
  const rows = [];
  for (const h of scan.hosts) for (const p of h.ports) rows.push({ host: h.addr, hostname: h.hostname, ...p });
  return rows;
}

export function summarizeScan(scan) {
  const rows = flattenScan(scan);
  return {
    hosts: scan.hosts.length,
    up: scan.hosts.filter((h) => h.status === 'up').length,
    open: rows.filter((r) => r.state === 'open').length,
    filtered: rows.filter((r) => r.state.includes('filtered')).length,
    closed: rows.filter((r) => r.state === 'closed').length,
  };
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function scanToCsv(scan) {
  const head = ['host', 'hostname', 'port', 'proto', 'state', 'service', 'product', 'version'];
  const lines = [head.join(',')];
  for (const r of flattenScan(scan)) lines.push(head.map((k) => csvCell(r[k])).join(','));
  return lines.join('\n') + '\n';
}

/** Compare two scans: ports newly open, no longer open, and changed service. */
export function diffScans(a, b) {
  const key = (r) => `${r.host}|${r.proto}|${r.port}`;
  const open = (s) => new Map(flattenScan(s).filter((r) => r.state === 'open').map((r) => [key(r), r]));
  const A = open(a); const B = open(b);
  const opened = []; const closed = []; const changed = [];
  const f = (x) => [x.service, x.product, x.version].filter(Boolean).join(' ');
  for (const [k, r] of B) {
    if (!A.has(k)) opened.push(r);
    else if (f(A.get(k)) !== f(r)) changed.push({ ...r, before: f(A.get(k)), after: f(r) });
  }
  for (const [k, r] of A) if (!B.has(k)) closed.push(r);
  return { opened, closed, changed };
}
