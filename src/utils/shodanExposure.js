// Pure helpers for reading Shodan host data as an exposure review of your OWN
// assets: finding rules, Markdown report, target-list parsing, saved queries,
// quota summary. No fetch, no React.

/* ----------------------------- exposure rules ----------------------------- */

// Ports that are rarely meant to face the internet. `sev`: high | medium | info.
export const PORT_RISKS = {
  21: { sev: 'medium', name: 'FTP', why: 'FTP sends credentials in clear text. Prefer SFTP or restrict by IP.' },
  23: { sev: 'high', name: 'Telnet', why: 'Telnet is unencrypted and a common target for default-password attacks. Disable it or close the port.' },
  69: { sev: 'medium', name: 'TFTP', why: 'TFTP has no authentication. It should be internal only.' },
  111: { sev: 'medium', name: 'RPC portmapper', why: 'Exposes RPC services and can be abused for amplification. Block at the firewall.' },
  135: { sev: 'high', name: 'MS RPC', why: 'Windows RPC should not be reachable from the internet.' },
  139: { sev: 'high', name: 'NetBIOS', why: 'NetBIOS/SMB over the internet is a frequent attack path. Close it.' },
  445: { sev: 'high', name: 'SMB', why: 'SMB exposed to the internet is a major ransomware entry point. Close it and use a VPN.' },
  161: { sev: 'medium', name: 'SNMP', why: 'SNMP can leak device details and has weak default community strings. Restrict by IP.' },
  1433: { sev: 'high', name: 'MS SQL', why: 'A database should not be directly reachable. Put it behind a VPN or private network.' },
  1521: { sev: 'high', name: 'Oracle DB', why: 'A database should not be directly reachable. Put it behind a VPN or private network.' },
  2375: { sev: 'high', name: 'Docker API (no TLS)', why: 'An open Docker API gives full control of the host. Close it immediately.' },
  3306: { sev: 'high', name: 'MySQL', why: 'A database should not be directly reachable. Put it behind a VPN or private network.' },
  3389: { sev: 'high', name: 'RDP', why: 'Exposed Remote Desktop is heavily brute-forced. Use a VPN or gateway with MFA.' },
  5432: { sev: 'high', name: 'PostgreSQL', why: 'A database should not be directly reachable. Put it behind a VPN or private network.' },
  5900: { sev: 'high', name: 'VNC', why: 'VNC often has weak or no authentication. Tunnel it or close it.' },
  5984: { sev: 'medium', name: 'CouchDB', why: 'Databases should be private. Check that authentication is on.' },
  6379: { sev: 'high', name: 'Redis', why: 'Redis often runs without authentication. Keep it on a private network.' },
  9200: { sev: 'high', name: 'Elasticsearch', why: 'Open Elasticsearch has leaked many datasets. Keep it private and enable auth.' },
  11211: { sev: 'high', name: 'Memcached', why: 'Memcached has no authentication and is abused for amplification. Keep it private.' },
  27017: { sev: 'high', name: 'MongoDB', why: 'Open MongoDB has leaked many datasets. Keep it private and enable auth.' },
  22: { sev: 'info', name: 'SSH', why: 'SSH is fine if hardened: key-only login, no root login, patched version.' },
  80: { sev: 'info', name: 'HTTP', why: 'Plain HTTP. Redirect to HTTPS where possible.' },
  443: { sev: 'info', name: 'HTTPS', why: 'Expected for web services. Check the certificate and TLS version.' },
};

const SEV_ORDER = { high: 0, medium: 1, info: 2 };
const SEV_POINTS = { high: 3, medium: 1, info: 0 };

export const vulnIds = (host) => {
  const v = host?.vulns;
  if (!v) return [];
  return Array.isArray(v) ? v.map(String) : Object.keys(v);
};

/**
 * Turn a Shodan host reply into plain-language findings, sorted by severity.
 * Findings are hints from what Shodan last saw, not a vulnerability scan.
 * Returns { findings: [{sev,title,detail,port?}], level: 'high'|'medium'|'low' }.
 */
export function assessHost(host) {
  const findings = [];
  const banners = Array.isArray(host?.data) ? host.data : [];
  const ports = new Set([...(host?.ports || []), ...banners.map((b) => b.port)].filter((p) => p !== undefined));

  for (const p of ports) {
    const r = PORT_RISKS[p];
    if (r) findings.push({ sev: r.sev, port: p, title: `${r.name} on port ${p}`, detail: r.why });
  }
  if (ports.size >= 10) findings.push({ sev: 'medium', title: `${ports.size} open ports`, detail: 'A large number of exposed ports widens the attack surface. Close what is not needed.' });

  const vulns = vulnIds(host);
  if (vulns.length) {
    findings.push({
      sev: 'high', title: `${vulns.length} CVE${vulns.length > 1 ? 's' : ''} matched`,
      detail: `Shodan matched these from banner versions (${vulns.slice(0, 8).join(', ')}${vulns.length > 8 ? ', ...' : ''}). Matches can be false positives when a vendor backports fixes; confirm the real version and patch.`,
    });
  }

  for (const b of banners) {
    const ssl = b.ssl;
    if (ssl?.cert?.expired) findings.push({ sev: 'medium', port: b.port, title: `Expired certificate on port ${b.port}`, detail: 'Renew the certificate. Clients will show warnings or refuse to connect.' });
    const bad = (ssl?.versions || []).filter((v) => /^(SSLv2|SSLv3|TLSv1(\.1)?)$/.test(v));
    if (bad.length) findings.push({ sev: 'medium', port: b.port, title: `Old TLS on port ${b.port}`, detail: `Offers ${bad.join(', ')}. Disable versions below TLS 1.2.` });
    const sk = String(b.http?.server || '');
    if (/\/\d/.test(sk)) findings.push({ sev: 'info', port: b.port, title: `Server version disclosed on port ${b.port}`, detail: `Header reads "${sk}". Hiding version numbers makes fingerprinting slightly harder.` });
  }

  const tags = host?.tags || [];
  if (tags.includes('database')) findings.push({ sev: 'high', title: 'Tagged as database', detail: 'Shodan tags this host as exposing a database service.' });
  if (tags.includes('ics')) findings.push({ sev: 'high', title: 'Tagged as industrial control', detail: 'Control systems should not be internet-facing. Put them behind a VPN.' });

  findings.sort((a, b) => SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  const points = findings.reduce((n, f) => n + SEV_POINTS[f.sev], 0);
  const level = findings.some((f) => f.sev === 'high') ? 'high' : points >= 1 ? 'medium' : 'low';
  return { findings, level };
}

/** Short one-row summary of a host reply, for the batch table and CSV. */
export function summarizeHost(host, assessment = assessHost(host)) {
  return {
    ip: host?.ip_str || '',
    org: host?.org || '',
    hostnames: (host?.hostnames || []).join(' '),
    ports: (host?.ports || []).slice().sort((a, b) => a - b).join(' '),
    vulns: vulnIds(host).join(' '),
    level: assessment.level,
    high: assessment.findings.filter((f) => f.sev === 'high').length,
    medium: assessment.findings.filter((f) => f.sev === 'medium').length,
    lastUpdate: host?.last_update || '',
  };
}

const csvCell = (v) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const HOST_CSV_COLUMNS = ['ip', 'org', 'hostnames', 'ports', 'vulns', 'level', 'high', 'medium', 'lastUpdate'];
export function hostRowsToCsv(rows) {
  return [HOST_CSV_COLUMNS.join(','), ...(rows || []).map((r) => HOST_CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n');
}

/** Markdown exposure report for one host. */
export function hostReportMarkdown(host, assessment = assessHost(host), now = new Date()) {
  const s = summarizeHost(host, assessment);
  const L = [
    `# Exposure review: ${s.ip || 'unknown host'}`,
    '',
    `Generated ${now.toISOString().slice(0, 10)} from Shodan data (last indexed ${s.lastUpdate || 'unknown'}). This is what Shodan saw, not a live scan.`,
    '',
    `- Overall: **${assessment.level}**`,
    `- Organization: ${s.org || 'n/a'}`,
    `- Hostnames: ${s.hostnames || 'none'}`,
    `- Open ports: ${s.ports || 'none'}`,
    '',
    '## Findings',
    '',
  ];
  if (!assessment.findings.length) L.push('No findings from the built-in rules.');
  for (const f of assessment.findings) L.push(`- **[${f.sev}] ${f.title}**: ${f.detail}`);
  return L.join('\n') + '\n';
}

/* ------------------------------ target lists ------------------------------ */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
export const isIp = (s) => IPV4.test(s) || (s.includes(':') && IPV6.test(s) && s.split(':').length >= 3 && s.split(':').length <= 9);

/** Split pasted text into unique IPs and the rest (domains/invalid), order kept. */
export function parseTargets(text) {
  const seen = new Set();
  const ips = []; const others = [];
  for (const raw of String(text || '').split(/[\s,;]+/)) {
    const t = raw.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    (isIp(t) ? ips : others).push(t);
  }
  return { ips, others };
}

/* ----------------------------- saved queries ------------------------------ */

export const SAVED_LIMIT = 50;

/** Add (or rename-in-place, keyed by query) a saved search. Newest first. */
export function addSavedQuery(list, name, query) {
  const q = String(query || '').trim();
  if (!q) return list || [];
  const n = String(name || '').trim() || q.slice(0, 40);
  const rest = (list || []).filter((s) => s.query !== q);
  return [{ name: n, query: q }, ...rest].slice(0, SAVED_LIMIT);
}
export const removeSavedQuery = (list, query) => (list || []).filter((s) => s.query !== query);

/** Defensive parse of the stored JSON (corrupt storage yields []). */
export function parseSavedQueries(json) {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((s) => s && typeof s.query === 'string' && s.query.trim()).map((s) => ({ name: String(s.name || s.query).slice(0, 80), query: s.query })).slice(0, SAVED_LIMIT) : [];
  } catch { return []; }
}

/** Starter queries for checking your own assets. Placeholders must be replaced. */
export const OWN_ASSET_PRESETS = [
  { label: 'My network range', query: 'net:203.0.113.0/24' },
  { label: 'My domain (hostname)', query: 'hostname:example.com' },
  { label: 'My org: exposed databases', query: 'org:"My Company" tag:database' },
  { label: 'My ASN: expired certs', query: 'asn:AS64496 ssl.cert.expired:true' },
  { label: 'My network: has CVEs', query: 'net:203.0.113.0/24 has_vuln:true' },
];

/* --------------------------------- quota ---------------------------------- */

/** Summarise an /api-info reply for a compact badge. */
export function quotaSummary(info) {
  if (!info || typeof info !== 'object') return null;
  const q = info.query_credits;
  const s = info.scan_credits;
  const low = typeof q === 'number' && q <= 5;
  return {
    plan: info.plan || 'unknown',
    query: typeof q === 'number' ? q : null,
    scan: typeof s === 'number' ? s : null,
    monitored: info.monitored_ips ?? null,
    monitoredLimit: info.usage_limits?.monitored_ips ?? null,
    low,
    text: `${info.plan || 'plan ?'} · ${typeof q === 'number' ? q : '?'} query / ${typeof s === 'number' ? s : '?'} scan credits`,
  };
}
