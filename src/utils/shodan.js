// Shodan REST API helpers — pure functions (no fetch, no React) so they can be
// unit-tested. The workbench in components/tools/osint/ShodanClient.jsx wires
// these to the proxied fetch and the UI.
//
// Reference: https://developer.shodan.io/api  and the filter reference at
// https://www.shodan.io/search/filters

export const SHODAN_API = 'https://api.shodan.io';
export const SHODAN_EXPLOITS_API = 'https://exploits.shodan.io/api';

// Same-origin relay routes served by worker/index.js on the deployed site (and by
// the Vite dev server's proxy). Must match RELAYS in worker/index.js — a test
// checks that. Shodan sends no CORS headers, so the browser cannot call it
// directly; the relay makes the call server-side with no local proxy needed.
export const SHODAN_RELAYS = {
  '/api/shodan': SHODAN_API,
  '/api/shodan-exploits': SHODAN_EXPLOITS_API,
};

/** Absolute Shodan URL -> relative relay URL, or null when it is not a Shodan URL. */
export function toRelayUrl(url) {
  for (const [prefix, base] of Object.entries(SHODAN_RELAYS)) {
    if (url === base || url.startsWith(base + '/') || url.startsWith(base + '?')) return prefix + url.slice(base.length);
  }
  return null;
}

export const looksJson = (text) => { try { JSON.parse(text); return true; } catch { return false; } };

/* ------------------------------------------------------------------------ */
/* Search filters                                                           */
/* ------------------------------------------------------------------------ */

// Filter catalogue grouped for the query-builder dropdown. `example` doubles as
// the placeholder. `type` hints the input widget: text | number | bool | date | list.
export const SHODAN_FILTERS = [
  // General
  { key: 'port', group: 'General', label: 'Port', type: 'number', example: '14000', hint: 'Port the service listens on' },
  { key: 'product', group: 'General', label: 'Product', type: 'text', example: 'nginx', hint: 'Software / product name' },
  { key: 'version', group: 'General', label: 'Version', type: 'text', example: '1.18.0', hint: 'Product version' },
  { key: 'org', group: 'General', label: 'Organization', type: 'text', example: 'Google LLC', hint: 'Organization that owns the IP space' },
  { key: 'isp', group: 'General', label: 'ISP', type: 'text', example: 'Comcast', hint: 'Internet service provider' },
  { key: 'asn', group: 'General', label: 'ASN', type: 'text', example: 'AS15169', hint: 'Autonomous system number' },
  { key: 'net', group: 'General', label: 'Network (CIDR)', type: 'text', example: '192.168.0.0/16', hint: 'IP range in CIDR notation' },
  { key: 'ip', group: 'General', label: 'IP address', type: 'text', example: '8.8.8.8', hint: 'Exact IP' },
  { key: 'hostname', group: 'General', label: 'Hostname', type: 'text', example: 'example.com', hint: 'Full or partial hostname' },
  { key: 'os', group: 'General', label: 'Operating system', type: 'text', example: 'Windows', hint: 'Detected OS' },
  { key: 'device', group: 'General', label: 'Device type', type: 'text', example: 'webcam', hint: 'Device classification (router, webcam, printer…)' },
  { key: 'cpe', group: 'General', label: 'CPE', type: 'text', example: 'cpe:/a:openbsd:openssh', hint: 'Common Platform Enumeration' },
  { key: 'tag', group: 'General', label: 'Tag', type: 'text', example: 'ics', hint: 'Shodan tag: ics, iot, database, vpn, cloud, honeypot, cdn, tor…' },
  { key: 'shodan.module', group: 'General', label: 'Shodan module', type: 'text', example: 'http', hint: 'Crawler module that produced the banner' },
  { key: 'hash', group: 'General', label: 'Banner hash', type: 'number', example: '0', hint: 'Hash of the banner data (0 = empty banner)' },
  { key: 'link', group: 'General', label: 'Link type', type: 'text', example: 'Ethernet or modem', hint: 'Network link type' },
  { key: 'before', group: 'General', label: 'Seen before', type: 'date', example: '01/01/2025', hint: 'Only results collected before this date (DD/MM/YYYY)' },
  { key: 'after', group: 'General', label: 'Seen after', type: 'date', example: '01/01/2025', hint: 'Only results collected after this date (DD/MM/YYYY)' },
  { key: 'scan', group: 'General', label: 'Scan ID', type: 'text', example: 'abc123', hint: 'Results from a specific on-demand scan' },
  { key: 'has_ipv6', group: 'General', label: 'Has IPv6', type: 'bool', example: 'true' },
  { key: 'has_screenshot', group: 'General', label: 'Has screenshot', type: 'bool', example: 'true' },
  { key: 'has_vuln', group: 'General', label: 'Has vulnerability', type: 'bool', example: 'true' },
  { key: 'has_ssl', group: 'General', label: 'Has SSL', type: 'bool', example: 'true' },
  // Location
  { key: 'country', group: 'Location', label: 'Country', type: 'text', example: 'US', hint: '2-letter country code' },
  { key: 'city', group: 'Location', label: 'City', type: 'text', example: 'Berlin' },
  { key: 'region', group: 'Location', label: 'Region / state', type: 'text', example: 'CA' },
  { key: 'state', group: 'Location', label: 'State', type: 'text', example: 'Texas' },
  { key: 'postal', group: 'Location', label: 'Postal code', type: 'text', example: '94105' },
  { key: 'geo', group: 'Location', label: 'Geo (lat,lon[,radius])', type: 'text', example: '52.52,13.40,10', hint: 'Latitude,longitude and optional radius in km' },
  // Vulnerabilities
  { key: 'vuln', group: 'Vulnerabilities', label: 'CVE', type: 'text', example: 'CVE-2021-44228', hint: 'Requires a Small Business plan or higher' },
  { key: 'vuln.verified', group: 'Vulnerabilities', label: 'Vuln verified', type: 'bool', example: 'true' },
  // HTTP
  { key: 'http.title', group: 'HTTP', label: 'HTML title', type: 'text', example: 'Dashboard' },
  { key: 'http.html', group: 'HTTP', label: 'HTML body contains', type: 'text', example: 'login' },
  { key: 'http.html_hash', group: 'HTTP', label: 'HTML hash', type: 'number', example: '-1234567890' },
  { key: 'http.status', group: 'HTTP', label: 'HTTP status', type: 'number', example: '200' },
  { key: 'http.server', group: 'HTTP', label: 'Server header', type: 'text', example: 'Apache' },
  { key: 'http.component', group: 'HTTP', label: 'Web component', type: 'text', example: 'jQuery', hint: 'Technology detected on the page' },
  { key: 'http.component_category', group: 'HTTP', label: 'Component category', type: 'text', example: 'CMS' },
  { key: 'http.favicon.hash', group: 'HTTP', label: 'Favicon hash', type: 'number', example: '-335242539', hint: 'mmh3 hash of the favicon' },
  { key: 'http.headers_hash', group: 'HTTP', label: 'Headers hash', type: 'number', example: '123456' },
  { key: 'http.robots_hash', group: 'HTTP', label: 'robots.txt hash', type: 'number', example: '123456' },
  { key: 'http.securitytxt', group: 'HTTP', label: 'security.txt contains', type: 'text', example: 'Contact' },
  { key: 'http.waf', group: 'HTTP', label: 'WAF', type: 'text', example: 'Cloudflare' },
  { key: 'http.dom_hash', group: 'HTTP', label: 'DOM hash', type: 'number', example: '123456' },
  // SSL / TLS
  { key: 'ssl', group: 'SSL/TLS', label: 'SSL (any field)', type: 'text', example: 'Let\'s Encrypt', hint: 'Full-text search across certificate data' },
  { key: 'ssl.version', group: 'SSL/TLS', label: 'TLS version', type: 'text', example: 'TLSv1.2', hint: 'SSLv2, SSLv3, TLSv1, TLSv1.1, TLSv1.2, TLSv1.3' },
  { key: 'ssl.alpn', group: 'SSL/TLS', label: 'ALPN', type: 'text', example: 'h2' },
  { key: 'ssl.chain_count', group: 'SSL/TLS', label: 'Chain length', type: 'number', example: '2' },
  { key: 'ssl.cert.subject.cn', group: 'SSL/TLS', label: 'Cert subject CN', type: 'text', example: '*.example.com' },
  { key: 'ssl.cert.issuer.cn', group: 'SSL/TLS', label: 'Cert issuer CN', type: 'text', example: 'R3' },
  { key: 'ssl.cert.serial', group: 'SSL/TLS', label: 'Cert serial', type: 'text', example: '1234' },
  { key: 'ssl.cert.fingerprint', group: 'SSL/TLS', label: 'Cert fingerprint (SHA-1)', type: 'text', example: 'ab12…' },
  { key: 'ssl.cert.alg', group: 'SSL/TLS', label: 'Cert signature alg', type: 'text', example: 'sha256WithRSAEncryption' },
  { key: 'ssl.cert.expired', group: 'SSL/TLS', label: 'Cert expired', type: 'bool', example: 'true' },
  { key: 'ssl.cert.extension', group: 'SSL/TLS', label: 'Cert extension', type: 'text', example: 'subjectAltName' },
  { key: 'ssl.cert.pubkey.type', group: 'SSL/TLS', label: 'Pubkey type', type: 'text', example: 'rsa' },
  { key: 'ssl.cert.pubkey.bits', group: 'SSL/TLS', label: 'Pubkey bits', type: 'number', example: '2048' },
  { key: 'ssl.cipher.name', group: 'SSL/TLS', label: 'Cipher name', type: 'text', example: 'AES256-GCM-SHA384' },
  { key: 'ssl.cipher.version', group: 'SSL/TLS', label: 'Cipher version', type: 'text', example: 'TLSv1.2' },
  { key: 'ssl.cipher.bits', group: 'SSL/TLS', label: 'Cipher bits', type: 'number', example: '256' },
  { key: 'ssl.ja3s', group: 'SSL/TLS', label: 'JA3S', type: 'text', example: 'abc…' },
  { key: 'ssl.jarm', group: 'SSL/TLS', label: 'JARM', type: 'text', example: 'abc…' },
  // SSH
  { key: 'ssh.type', group: 'SSH', label: 'SSH key type', type: 'text', example: 'ssh-rsa' },
  { key: 'ssh.fingerprint', group: 'SSH', label: 'SSH fingerprint', type: 'text', example: 'ab:cd:…' },
  { key: 'ssh.hassh', group: 'SSH', label: 'HASSH', type: 'text', example: 'abc…' },
  // Telnet
  { key: 'telnet.option', group: 'Telnet', label: 'Telnet option', type: 'text', example: 'echo' },
  { key: 'telnet.do', group: 'Telnet', label: 'Telnet DO', type: 'text', example: 'echo' },
  { key: 'telnet.dont', group: 'Telnet', label: 'Telnet DONT', type: 'text', example: 'echo' },
  { key: 'telnet.will', group: 'Telnet', label: 'Telnet WILL', type: 'text', example: 'echo' },
  { key: 'telnet.wont', group: 'Telnet', label: 'Telnet WONT', type: 'text', example: 'echo' },
  // SNMP
  { key: 'snmp.contact', group: 'SNMP', label: 'SNMP contact', type: 'text', example: 'admin' },
  { key: 'snmp.location', group: 'SNMP', label: 'SNMP location', type: 'text', example: 'Server room' },
  { key: 'snmp.name', group: 'SNMP', label: 'SNMP name', type: 'text', example: 'core-sw' },
  // NTP
  { key: 'ntp.ip', group: 'NTP', label: 'NTP peer IP', type: 'text', example: '1.2.3.4' },
  { key: 'ntp.ip_count', group: 'NTP', label: 'NTP peer count', type: 'number', example: '10' },
  { key: 'ntp.more', group: 'NTP', label: 'NTP more', type: 'bool', example: 'true' },
  { key: 'ntp.port', group: 'NTP', label: 'NTP port', type: 'number', example: '123' },
  // Bitcoin
  { key: 'bitcoin.ip', group: 'Bitcoin', label: 'Bitcoin peer IP', type: 'text', example: '1.2.3.4' },
  { key: 'bitcoin.ip_count', group: 'Bitcoin', label: 'Bitcoin peer count', type: 'number', example: '8' },
  { key: 'bitcoin.port', group: 'Bitcoin', label: 'Bitcoin port', type: 'number', example: '8333' },
  { key: 'bitcoin.version', group: 'Bitcoin', label: 'Bitcoin version', type: 'text', example: '70015' },
  // Cloud
  { key: 'cloud.provider', group: 'Cloud', label: 'Cloud provider', type: 'text', example: 'Amazon' },
  { key: 'cloud.region', group: 'Cloud', label: 'Cloud region', type: 'text', example: 'us-east-1' },
  { key: 'cloud.service', group: 'Cloud', label: 'Cloud service', type: 'text', example: 'EC2' },
  // Screenshot
  { key: 'screenshot.label', group: 'Screenshot', label: 'Screenshot label', type: 'text', example: 'ics', hint: 'ML label: ics, login, terminal, webcam, windows…' },
  { key: 'screenshot.hash', group: 'Screenshot', label: 'Screenshot hash', type: 'number', example: '123456' },
];

export const SHODAN_FILTER_GROUPS = [...new Set(SHODAN_FILTERS.map((f) => f.group))];
const FILTER_BY_KEY = Object.fromEntries(SHODAN_FILTERS.map((f) => [f.key, f]));
export const filterInfo = (key) => FILTER_BY_KEY[key] || null;

// Facets the search/count endpoints can aggregate on.
export const SHODAN_FACETS = [
  'country', 'city', 'state', 'org', 'isp', 'asn', 'port', 'product', 'version', 'os',
  'domain', 'vuln', 'tag', 'link', 'cloud.provider', 'cloud.region', 'cloud.service',
  'http.title', 'http.component', 'http.server', 'http.status', 'http.waf',
  'ssl.version', 'ssl.cert.issuer.cn', 'ssl.cert.subject.cn', 'ssl.cipher.name', 'ssl.cipher.version', 'ssl.ja3s', 'ssl.jarm',
  'ssh.type', 'ssh.hassh', 'device', 'has_screenshot', 'has_vuln', 'has_ipv6', 'ip', 'uptime', 'screenshot.label', 'cpe',
];

// Handy starting points. Each costs one query credit when searched (filters are
// used), none when counted.
export const SHODAN_PRESETS = [
  { label: 'Services on a port', query: 'port:14000' },
  { label: 'Web servers in a country', query: 'http.status:200 country:US' },
  { label: 'HTML title search', query: 'http.title:"Dashboard" port:80,443,8080' },
  { label: 'Hosts in a network', query: 'net:192.0.2.0/24' },
  { label: 'Hostname wildcard', query: 'hostname:example.com' },
  { label: 'Product + version', query: 'product:"OpenSSH" version:"7.4"' },
  { label: 'Expired certificates', query: 'ssl.cert.expired:true country:DE' },
  { label: 'Favicon hash', query: 'http.favicon.hash:-335242539' },
  { label: 'ICS tagged', query: 'tag:ics country:NL' },
  { label: 'Honeypots excluded', query: 'port:3306 -tag:honeypot' },
];

/* ------------------------------------------------------------------------ */
/* Query string <-> tokens                                                  */
/* ------------------------------------------------------------------------ */

// Tokens: { type: 'term', value, negate } | { type: 'filter', key, value, negate }
// `negate` is the leading "-" that excludes matches.

const needsQuotes = (v) => /[\s"]/.test(v) || v === '';
const quote = (v) => `"${String(v).replace(/"/g, '\\"')}"`;

export function formatToken(t) {
  const neg = t.negate ? '-' : '';
  const value = String(t.value ?? '');
  if (t.type === 'filter') {
    const key = String(t.key || '').trim();
    // A row whose value is still empty is a work in progress — leave it out of
    // the query rather than sending key:"" to Shodan.
    if (!key || value === '') return '';
    return `${neg}${key}:${needsQuotes(value) ? quote(value) : value}`;
  }
  if (!value.trim()) return '';
  return `${neg}${/\s/.test(value) ? quote(value) : value}`;
}

// Build the Shodan query string from an ordered token list.
export function buildQuery(tokens) {
  return (tokens || []).map(formatToken).filter(Boolean).join(' ');
}

// Tokenise a Shodan query string back into tokens (quotes aware). Lossless for
// anything buildQuery produces, lenient for hand-typed input.
export function parseQuery(str) {
  const s = String(str || '');
  const words = [];
  let cur = '', inQ = false, hadQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '\\' && s[i + 1] === '"') { cur += '"'; i++; continue; }
      if (c === '"') { inQ = false; continue; }
      cur += c;
    } else if (c === '"') { inQ = true; hadQuote = true; }
    else if (/\s/.test(c)) { if (cur || hadQuote) { words.push({ w: cur, q: hadQuote }); cur = ''; hadQuote = false; } }
    else cur += c;
  }
  if (cur || hadQuote) words.push({ w: cur, q: hadQuote });

  return words.map(({ w, q }) => {
    let negate = false;
    let body = w;
    // A leading "-" outside quotes excludes the token.
    if (body.startsWith('-') && !(q && w === body && s.includes(`"${w}"`))) { negate = true; body = body.slice(1); }
    // key:value → filter. Covers both  key:"quoted value"  and a fully quoted
    // "key:quoted value" (the user wrapped the whole token; keep the intent).
    const m = /^([A-Za-z0-9_.]+):(.*)$/s.exec(body);
    if (m) return { type: 'filter', key: m[1], value: m[2], negate };
    return { type: 'term', value: body, negate };
  });
}

// Normalise (re-quote) a hand-typed query so it is safe to send.
export const normalizeQuery = (str) => buildQuery(parseQuery(str));

// Facet spec: [{ key, count }] -> "country:10,org:5"
export function buildFacets(facets) {
  return (facets || [])
    .filter((f) => f && f.key)
    .map((f) => (f.count && Number(f.count) > 0 ? `${f.key}:${Number(f.count)}` : f.key))
    .join(',');
}

/* ------------------------------------------------------------------------ */
/* Endpoints                                                                */
/* ------------------------------------------------------------------------ */

// Every endpoint exposed by the workbench. `credits` is informational.
export const SHODAN_ENDPOINTS = {
  search: { label: 'Search hosts', method: 'GET', path: '/shodan/host/search', credits: '1 query credit per page (filters used); free for plain text', params: ['query', 'facets', 'page', 'minify'] },
  count: { label: 'Count hosts', method: 'GET', path: '/shodan/host/count', credits: 'free', params: ['query', 'facets'] },
  host: { label: 'Host info', method: 'GET', path: '/shodan/host/{ip}', credits: 'free', params: ['ip', 'history', 'minify'] },
  honeyscore: { label: 'Honeypot score', method: 'GET', path: '/labs/honeyscore/{ip}', credits: 'free', params: ['ip'] },
  tokens: { label: 'Parse query (tokens)', method: 'GET', path: '/shodan/host/search/tokens', credits: 'free', params: ['query'] },
  searchFilters: { label: 'List search filters', method: 'GET', path: '/shodan/host/search/filters', credits: 'free', params: [] },
  searchFacets: { label: 'List search facets', method: 'GET', path: '/shodan/host/search/facets', credits: 'free', params: [] },
  ports: { label: 'Crawled ports', method: 'GET', path: '/shodan/ports', credits: 'free', params: [] },
  protocols: { label: 'Crawler protocols', method: 'GET', path: '/shodan/protocols', credits: 'free', params: [] },
  dnsDomain: { label: 'Domain info', method: 'GET', path: '/dns/domain/{domain}', credits: '1 query credit', params: ['domain', 'history', 'type', 'page'] },
  dnsResolve: { label: 'DNS resolve', method: 'GET', path: '/dns/resolve', credits: 'free', params: ['hostnames'] },
  dnsReverse: { label: 'Reverse DNS', method: 'GET', path: '/dns/reverse', credits: 'free', params: ['ips'] },
  apiInfo: { label: 'API plan & credits', method: 'GET', path: '/api-info', credits: 'free', params: [] },
  myip: { label: 'My IP', method: 'GET', path: '/tools/myip', credits: 'free', params: [] },
  httpHeaders: { label: 'My HTTP headers', method: 'GET', path: '/tools/httpheaders', credits: 'free', params: [] },
  savedQueries: { label: 'Community queries', method: 'GET', path: '/shodan/query/search', credits: 'free', params: ['query', 'page'] },
  queryTags: { label: 'Popular query tags', method: 'GET', path: '/shodan/query/tags', credits: 'free', params: ['size'] },
  exploits: { label: 'Exploit search', method: 'GET', base: SHODAN_EXPLOITS_API, path: '/search', credits: '1 query credit', params: ['query', 'facets', 'page'] },
};

const PATH_PARAMS = ['ip', 'domain'];

/**
 * Build the full request URL for an endpoint.
 * Path params ({ip}, {domain}) are substituted and URL-encoded; every other
 * param is sent as a query-string value. Empty/false/undefined values are
 * omitted so defaults apply server-side. Lists (facets, hostnames, ips) may be
 * passed as arrays and are joined with commas.
 */
export function buildShodanUrl(endpointId, params = {}, key = '') {
  const ep = SHODAN_ENDPOINTS[endpointId];
  if (!ep) throw new Error(`Unknown Shodan endpoint: ${endpointId}`);
  let path = ep.path;
  for (const p of PATH_PARAMS) {
    if (path.includes(`{${p}}`)) {
      const v = String(params[p] ?? '').trim();
      if (!v) throw new Error(`Missing required parameter "${p}"`);
      path = path.replace(`{${p}}`, encodeURIComponent(v));
    }
  }
  const qs = new URLSearchParams();
  if (key) qs.set('key', key);
  for (const name of ep.params) {
    if (PATH_PARAMS.includes(name)) continue;
    let v = params[name];
    if (Array.isArray(v)) v = v.join(',');
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (v === true) v = 'true';
    qs.set(name, String(v));
  }
  const q = qs.toString();
  return `${ep.base || SHODAN_API}${path}${q ? `?${q}` : ''}`;
}

// Hide the API key when echoing a request URL in the UI / session log.
export function redactKey(url) {
  return String(url).replace(/([?&]key=)[^&]*/g, '$1••••');
}

/* ------------------------------------------------------------------------ */
/* Responses                                                                */
/* ------------------------------------------------------------------------ */

const STATUS_HINTS = {
  400: 'bad request — check the query syntax and parameters',
  401: 'unauthorized — the API key is missing or invalid',
  402: 'payment required — this endpoint or filter needs a paid plan or more credits',
  403: 'forbidden — your plan does not allow this request (or the key lacks access)',
  404: 'not found — no data for that host/domain, or the endpoint path is wrong',
  429: 'rate limited — Shodan allows ~1 request/second; slow down',
  500: 'Shodan internal error — try again later',
  502: 'bad gateway — Shodan or the proxy is unavailable',
  503: 'service unavailable — Shodan or the proxy is down',
};

function htmlTitle(text) {
  const t = /<title[^>]*>([^<]*)<\/title>/i.exec(text) || /<h1[^>]*>([^<]*)<\/h1>/i.exec(text);
  return t ? t[1].trim() : '';
}

/**
 * Turn a raw HTTP reply into { ok, status, data, error }.
 * Shodan returns JSON for success and for most errors ({"error": "..."}),
 * but 404s/proxy failures come back as HTML — those used to crash the old
 * client with "Unexpected token '<' ... is not valid JSON".
 */
export function parseShodanResponse(status, text) {
  const body = String(text ?? '');
  let data = null;
  let json = false;
  try { data = JSON.parse(body); json = true; } catch { /* not JSON */ }

  if (json && data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string') {
    const hint = STATUS_HINTS[status];
    return { ok: false, status, data, error: `${data.error}${hint && status >= 400 ? ` (HTTP ${status}: ${hint})` : ''}` };
  }
  if (!json) {
    const isHtml = /^\s*<(!doctype|html|head|body|h1|title)/i.test(body);
    const title = isHtml ? htmlTitle(body) : '';
    const snippet = !isHtml ? body.trim().slice(0, 120) : '';
    const hint = STATUS_HINTS[status] || (status >= 400 ? 'request failed' : 'unexpected reply');
    let error = `HTTP ${status || '?'}: ${hint}.`;
    if (isHtml) error += ` The server returned an HTML page${title ? ` ("${title}")` : ''} instead of JSON — usually a wrong path, a proxy error page, or a login/CAPTCHA wall.`;
    else if (snippet) error += ` Body: ${snippet}`;
    return { ok: false, status, data: null, raw: body, error };
  }
  if (status >= 400) {
    return { ok: false, status, data, error: `HTTP ${status}: ${STATUS_HINTS[status] || 'request failed'}` };
  }
  return { ok: true, status, data, error: '' };
}

/* ------------------------------------------------------------------------ */
/* Result shaping                                                           */
/* ------------------------------------------------------------------------ */

const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);

// Flatten a search match into the columns the table / CSV export shows.
export function summarizeMatch(m) {
  const vulns = m?.vulns ? Object.keys(m.vulns) : [];
  return {
    ip: m?.ip_str || (typeof m?.ip === 'number' ? intToIp(m.ip) : '') || '',
    port: m?.port ?? '',
    transport: m?.transport || '',
    hostnames: (m?.hostnames || []).join(' '),
    domains: (m?.domains || []).join(' '),
    org: m?.org || '',
    isp: m?.isp || '',
    asn: m?.asn || '',
    country: get(m, 'location.country_name') || get(m, 'location.country_code') || '',
    city: get(m, 'location.city') || '',
    product: m?.product || '',
    version: m?.version || '',
    os: m?.os || '',
    title: get(m, 'http.title') || '',
    server: get(m, 'http.server') || '',
    cpe: (m?.cpe23 || m?.cpe || []).join(' '),
    vulns: vulns.join(' '),
    vulnCount: vulns.length,
    tags: (m?.tags || []).join(' '),
    timestamp: m?.timestamp || '',
  };
}

export function intToIp(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '';
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
}

export const MATCH_CSV_COLUMNS = ['ip', 'port', 'transport', 'hostnames', 'domains', 'org', 'isp', 'asn', 'country', 'city', 'product', 'version', 'os', 'title', 'server', 'cpe', 'vulns', 'tags', 'timestamp'];

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function matchesToCsv(matches) {
  const rows = (matches || []).map(summarizeMatch);
  return [MATCH_CSV_COLUMNS.join(','), ...rows.map((r) => MATCH_CSV_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n');
}

// Deep link to the same query on shodan.io for people who want the web UI.
export const shodanWebUrl = (query) => `https://www.shodan.io/search?query=${encodeURIComponent(query || '')}`;
