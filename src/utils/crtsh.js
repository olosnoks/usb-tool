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
