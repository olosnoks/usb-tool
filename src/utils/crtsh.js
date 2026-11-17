// Pure helpers for the crt.sh Certificate Transparency subdomain finder.
// The component fetches https://crt.sh/?q=%.<domain>&output=json (through the
// proxy, since crt.sh does not send CORS headers); these helpers turn that JSON
// into a clean, de-duplicated host list.

/**
 * Extract unique hostnames from crt.sh JSON rows for a base domain.
 * Each row has `name_value` which may contain several newline-separated names
 * and wildcards. Returns a sorted array of { host, wildcard } and ignores names
 * outside the base domain.
 */
export function extractSubdomains(rows, baseDomain) {
  const base = String(baseDomain || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const set = new Map();
  const consider = (raw) => {
    let host = String(raw).trim().toLowerCase().replace(/\.+$/, '');
    if (!host) return;
    const wildcard = host.startsWith('*.');
    if (wildcard) host = host.slice(2);
    if (!host) return;
    if (base && host !== base && !host.endsWith(`.${base}`)) return; // keep in-scope only
    const prev = set.get(host);
    set.set(host, { host, wildcard: wildcard || (prev?.wildcard ?? false) });
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    const nv = row?.name_value ?? row?.common_name ?? '';
    String(nv).split(/\n+/).forEach(consider);
    if (row?.common_name) consider(row.common_name);
  }
  return Array.from(set.values()).sort((a, b) => a.host.localeCompare(b.host));
}

/** Build the crt.sh query URL for a base domain. */
export function crtShUrl(baseDomain) {
  const base = String(baseDomain || '').trim().replace(/^\*?\.+/, '');
  return `https://crt.sh/?q=${encodeURIComponent('%.' + base)}&output=json`;
}

/** Same-origin Worker route (and Vite dev proxy) that relays crt.sh. */
export function crtShRelayUrl(baseDomain, { excludeExpired = false, dedupe = false } = {}) {
  const base = String(baseDomain || '').trim().replace(/^\*?\.+/, '');
  const p = new URLSearchParams({ q: `%.${base}`, output: 'json' });
  if (excludeExpired) p.set('exclude', 'expired');
  if (dedupe) p.set('deduplicate', 'Y');
  return `/api/crtsh?${p.toString()}`;
}

const parseTs = (s) => {
  if (!s) return NaN;
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : `${s}Z`);
  return t;
};
const iso = (s) => { const t = parseTs(s); return Number.isNaN(t) ? '' : new Date(t).toISOString(); };

/** Short issuer label: the O= (or CN=) value out of a DN string. */
export function issuerLabel(issuerName) {
  const s = String(issuerName || '');
  return /(?:^|,\s*)O=([^,]+)/.exec(s)?.[1]?.trim() || /(?:^|,\s*)CN=([^,]+)/.exec(s)?.[1]?.trim() || s || 'unknown';
}

/**
 * Per-host certificate metadata from crt.sh rows. Within the base domain, for
 * each host the most recently logged certificate wins. `now` is injectable.
 * -> [{ host, wildcard, issuer, issuerName, notBefore, notAfter, loggedAt, certId, serial, expired, daysLeft }]
 */
export function extractCerts(rows, baseDomain, now = Date.now()) {
  const base = String(baseDomain || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const names = new Set(String(row?.name_value ?? '').split(/\n+/));
    if (row?.common_name) names.add(row.common_name);
    const logged = parseTs(row?.entry_timestamp);
    const rank = Number.isNaN(logged) ? -Infinity : logged;
    const id = Number(row?.id) || 0;
    for (const raw of names) {
      let host = String(raw).trim().toLowerCase().replace(/\.+$/, '');
      if (!host) continue;
      const wildcard = host.startsWith('*.');
      if (wildcard) host = host.slice(2);
      if (!host) continue;
      if (base && host !== base && !host.endsWith(`.${base}`)) continue;
      const prev = map.get(host);
      const sawWildcard = wildcard || prev?.wildcard || false;
      if (prev && (rank < prev._rank || (rank === prev._rank && id <= prev._id))) { prev.wildcard = sawWildcard; continue; }
      const na = parseTs(row?.not_after);
      map.set(host, {
        host, wildcard: sawWildcard,
        issuer: issuerLabel(row?.issuer_name), issuerName: row?.issuer_name || '',
        notBefore: iso(row?.not_before), notAfter: iso(row?.not_after), loggedAt: iso(row?.entry_timestamp),
        certId: row?.id ?? null, serial: row?.serial_number || '',
        expired: Number.isNaN(na) ? false : na < now,
        daysLeft: Number.isNaN(na) ? null : Math.floor((na - now) / 86400000),
        _rank: rank, _id: id,
      });
    }
  }
  return Array.from(map.values())
    .map(({ _rank, _id, ...r }) => r)
    .sort((a, b) => a.host.localeCompare(b.host));
}

/** Count certificate rows per issuer, most common first. -> [{ issuer, count }] */
export function issuerSummary(rows) {
  const c = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const k = issuerLabel(row?.issuer_name);
    c.set(k, (c.get(k) || 0) + 1);
  }
  return Array.from(c, ([issuer, count]) => ({ issuer, count })).sort((a, b) => b.count - a.count || a.issuer.localeCompare(b.issuer));
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV for the cert table. */
export function certsToCsv(certs) {
  const cols = ['host', 'wildcard', 'issuer', 'notBefore', 'notAfter', 'daysLeft', 'expired', 'loggedAt', 'certId', 'serial'];
  return [cols.join(','), ...certs.map((c) => cols.map((k) => csvCell(c[k])).join(','))].join('\n') + '\n';
}

/** Filesystem-safe export filename. */
export function safeFilename(domain, ext) {
  const s = String(domain || '').toLowerCase().replace(/[^a-z0-9.-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 80) || 'crtsh';
  return `${s}-certs.${ext}`;
}
