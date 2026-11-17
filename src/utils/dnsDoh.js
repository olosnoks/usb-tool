// DNS-over-HTTPS (JSON API) client for the DNS Toolkit. The fetch function is
// injectable so tests (and the proxy-aware workbench) can supply their own.

export const RESOLVERS = {
  google: { label: 'dns.google', url: 'https://dns.google/resolve' },
  cloudflare: { label: 'cloudflare-dns.com', url: 'https://cloudflare-dns.com/dns-query' },
  quad9: { label: 'dns.quad9.net', url: 'https://dns.quad9.net:5053/dns-query' },
};

export const RRTYPE = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 15: 'MX', 16: 'TXT', 28: 'AAAA', 43: 'DS', 48: 'DNSKEY', 257: 'CAA' };

/** DNS RCODE (the DoH `Status` field) -> short name. */
export const RCODE_NAME = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };

/** A Status that means "the resolver could not answer" (NXDOMAIN is a valid empty answer). */
export const isResolverError = (status) => status !== 0 && status !== 3;

/**
 * One DoH query. Resolves to { status, statusName, ad, answers, resolver }.
 * Throws on a network failure, a non-2xx HTTP response, or a non-JSON body.
 * A DNS-level failure (SERVFAIL/REFUSED) is reported in `status`, not thrown, so
 * callers can show a per-record-type error and carry on.
 */
export async function doh(name, type, { resolver = 'google', fetchImpl = globalThis.fetch } = {}) {
  const r = RESOLVERS[resolver];
  if (!r) throw new Error(`Unknown resolver: ${resolver}`);
  const url = `${r.url}?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`;
  const resp = await fetchImpl(url, { headers: { accept: 'application/dns-json' } });
  if (!resp.ok) throw new Error(`${r.label} returned HTTP ${resp.status}`);
  let data;
  try { data = await resp.json(); } catch { throw new Error(`${r.label} did not return JSON`); }
  const status = Number.isInteger(data?.Status) ? data.Status : 2;
  return {
    status,
    statusName: RCODE_NAME[status] || `RCODE ${status}`,
    ad: data?.AD === true,
    answers: (data?.Answer || []).map((a) => ({ ...a, typeName: RRTYPE[a.type] || a.type })),
    resolver,
  };
}

/** Message for a result that is a resolver error, or null when usable (incl. NXDOMAIN). */
export const dohProblem = (res) => (isResolverError(res.status) ? `${res.statusName} from ${RESOLVERS[res.resolver]?.label || res.resolver}` : null);

/** Strip the quotes DoH puts around TXT strings and join split segments. */
export const unquote = (s) => String(s).replace(/^"|"$/g, '').replace(/"\s+"/g, '');
