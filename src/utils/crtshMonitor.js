// Pure helpers for certificate monitoring on top of crt.sh JSON rows:
// expiry buckets, per-certificate grouping with duplicate/reissue detection,
// expected-issuer checks and a Markdown report. Used only by the crt.sh finder.
import { issuerLabel } from './crtsh.js';

const DAY = 86400000;
const ts = (s) => {
  if (!s) return NaN;
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : `${s}Z`);
};
const isoDay = (t) => (Number.isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10));

export const EXPIRY_BUCKETS = ['expired', '7d', '30d', '90d', 'later', 'unknown'];

/** Expiry bucket for a days-left value (null = unknown). 'expired' when negative. */
export function expiryBucket(daysLeft) {
  if (daysLeft == null || Number.isNaN(daysLeft)) return 'unknown';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 7) return '7d';
  if (daysLeft <= 30) return '30d';
  if (daysLeft <= 90) return '90d';
  return 'later';
}

/** Count items (anything with daysLeft) per expiry bucket. -> { expired, '7d', ... } */
export function expiryOverview(items) {
  const out = Object.fromEntries(EXPIRY_BUCKETS.map((b) => [b, 0]));
  for (const it of items || []) out[expiryBucket(it.daysLeft)]++;
  return out;
}

/**
 * Group crt.sh rows into distinct certificates. A precertificate and its final
 * certificate share issuer + serial, so they are merged. Names are limited to
 * the base domain. Each group: { key, certIds, issuer, serial, names, wildcardNames,
 * notBefore, notAfter, loggedAt, daysLeft, expired, bucket, entries }.
 */
export function groupCertificates(rows, baseDomain, now = Date.now()) {
  const base = String(baseDomain || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const names = new Set();
    for (const raw of String(row?.name_value ?? '').split(/\n+/).concat(row?.common_name ? [row.common_name] : [])) {
      const n = String(raw).trim().toLowerCase().replace(/\.+$/, '');
      if (!n) continue;
      const h = n.startsWith('*.') ? n.slice(2) : n;
      if (!h || (base && h !== base && !h.endsWith(`.${base}`))) continue;
      names.add(n);
    }
    if (!names.size) continue;
    const serial = String(row?.serial_number || '').toLowerCase();
    const key = serial ? `${row?.issuer_ca_id ?? row?.issuer_name ?? ''}|${serial}` : `id:${row?.id}`;
    const logged = ts(row?.entry_timestamp);
    const cur = map.get(key);
    if (cur) {
      names.forEach((n) => cur.names.add(n));
      if (row?.id != null) cur.certIds.push(row.id);
      cur.entries++;
      if (!Number.isNaN(logged) && (Number.isNaN(cur._logged) || logged < cur._logged)) cur._logged = logged;
      continue;
    }
    map.set(key, {
      key, certIds: row?.id != null ? [row.id] : [], issuer: issuerLabel(row?.issuer_name), issuerName: row?.issuer_name || '',
      serial, names, _nb: ts(row?.not_before), _na: ts(row?.not_after), _logged: logged, entries: 1,
    });
  }
  return Array.from(map.values()).map((g) => {
    const names = Array.from(g.names).sort();
    const daysLeft = Number.isNaN(g._na) ? null : Math.floor((g._na - now) / DAY);
    return {
      key: g.key, certIds: g.certIds, issuer: g.issuer, issuerName: g.issuerName, serial: g.serial, names,
      wildcardNames: names.filter((n) => n.startsWith('*.')),
      notBefore: isoDay(g._nb), notAfter: isoDay(g._na), loggedAt: isoDay(g._logged),
      loggedMs: Number.isNaN(g._logged) ? null : g._logged,
      daysLeft, expired: daysLeft != null && daysLeft < 0, bucket: expiryBucket(daysLeft), entries: g.entries,
    };
  }).sort((a, b) => (b.loggedMs ?? 0) - (a.loggedMs ?? 0) || a.names[0].localeCompare(b.names[0]));
}

/**
 * Certificates that cover exactly the same set of names (reissues / renewals /
 * duplicates). Only sets with 2+ certificates are returned, largest first.
 * -> [{ names, count, certs, issuers, activeCount }]
 */
export function duplicateGroups(certs) {
  const m = new Map();
  for (const c of certs || []) {
    const k = c.names.join('\n');
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(c);
  }
  return Array.from(m.values()).filter((l) => l.length > 1).map((l) => ({
    names: l[0].names, count: l.length, certs: l,
    issuers: Array.from(new Set(l.map((c) => c.issuer))).sort(),
    activeCount: l.filter((c) => !c.expired).length,
  })).sort((a, b) => b.count - a.count || a.names[0].localeCompare(b.names[0]));
}

/** Certificates first logged within the last `days` days (needs a log timestamp). */
export function recentlyLogged(certs, days = 30, now = Date.now()) {
  return (certs || []).filter((c) => c.loggedMs != null && now - c.loggedMs <= days * DAY && c.loggedMs <= now + DAY);
}

/** Parse a comma/newline separated list of expected issuers into lowercase terms. */
export function parseExpectedIssuers(text) {
  return Array.from(new Set(String(text || '').split(/[,\n;]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)));
}

/** True when the issuer label or DN contains none of the expected terms. Empty list = nothing is flagged. */
export function isUnexpectedIssuer(cert, expected) {
  if (!expected?.length) return false;
  const hay = `${cert.issuer} ${cert.issuerName || ''}`.toLowerCase();
  return !expected.some((e) => hay.includes(e));
}

const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Markdown monitoring report for a domain. */
export function monitorReport({ domain, certs, hosts = [], expected = [], now = Date.now() }) {
  const ov = expiryOverview(certs);
  const issuers = new Map();
  certs.forEach((c) => issuers.set(c.issuer, (issuers.get(c.issuer) || 0) + 1));
  const dups = duplicateGroups(certs);
  const soon = certs.filter((c) => c.daysLeft != null && c.daysLeft >= 0 && c.daysLeft <= 30).sort((a, b) => a.daysLeft - b.daysLeft);
  const odd = certs.filter((c) => isUnexpectedIssuer(c, expected));
  const L = [`# Certificate Transparency report: ${domain}`, '', `Generated ${new Date(now).toISOString()} from crt.sh. CT shows what was issued, not what is deployed.`, '',
    `- Certificates: ${certs.length}`, `- Hostnames: ${hosts.length}`,
    `- Expiry: ${ov.expired} expired, ${ov['7d']} within 7d, ${ov['30d']} within 30d, ${ov['90d']} within 90d, ${ov.later} later`, '',
    '## Issuers', ''];
  Array.from(issuers).sort((a, b) => b[1] - a[1]).forEach(([i, n]) => L.push(`- ${i}: ${n}`));
  L.push('', '## Expiring within 30 days', '');
  if (!soon.length) L.push('None.');
  soon.forEach((c) => L.push(`- ${c.notAfter} (${c.daysLeft}d) ${c.names.join(', ')} [${c.issuer}]`));
  if (expected.length) {
    L.push('', `## Issuers not in expected list (${expected.join(', ')})`, '');
    if (!odd.length) L.push('None.');
    odd.forEach((c) => L.push(`- ${c.issuer}: ${c.names.join(', ')} (logged ${c.loggedAt || 'unknown'})`));
  }
  L.push('', '## Duplicate certificates (same name set)', '');
  if (!dups.length) L.push('None.');
  dups.forEach((g) => L.push(`- ${g.count}x (${g.activeCount} unexpired): ${g.names.join(', ')}`));
  L.push('', '## Certificates', '', '| Names | Issuer | Not before | Not after | Logged |', '|---|---|---|---|---|');
  certs.forEach((c) => L.push(`| ${mdCell(c.names.join(', '))} | ${mdCell(c.issuer)} | ${c.notBefore} | ${c.notAfter} | ${c.loggedAt} |`));
  return L.join('\n') + '\n';
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of distinct certificates (one row per certificate). */
export function certificatesToCsv(certs) {
  const cols = ['names', 'issuer', 'notBefore', 'notAfter', 'daysLeft', 'expired', 'loggedAt', 'serial', 'certIds'];
  const val = (c, k) => (k === 'names' ? c.names.join(' ') : k === 'certIds' ? c.certIds.join(' ') : c[k]);
  return [cols.join(','), ...certs.map((c) => cols.map((k) => csvCell(val(c, k))).join(','))].join('\n') + '\n';
}
