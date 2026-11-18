/**
 * Web App & API Testing Wiki Articles
 * Covering the browser-based web/security toolkit: HTTP/HTTPS Repeater, API Client,
 * Web Scanner, Web Path Prober, Basic-Auth Tester, Port Scanner, DNS Enumerator,
 * Certificate Inspector, Pwned Passwords, Hash Cracker, WPA PMKID Cracker, PCAP Viewer.
 *
 * Honest, browser-accurate: these run entirely client-side. Cross-origin requests
 * are limited by CORS, so each network tool offers a configurable proxy.
 */

const CORS_NOTE = `
> **Browser reality:** these tools run in the page with no backend. The browser's same-origin policy (CORS) means a page can only *read* a cross-origin response when the target sends permissive CORS headers. Each network tool has a **proxy bar**: leave it empty for direct requests (CORS-permissive targets only), or point it at a local proxy you run (mitmproxy, Burp, ZAP, or a small CORS relay) to reach any host. A proxy URL may use a \`{url}\` placeholder or be a prefix the target URL is appended to.
`;

export const WEBAPP_ARTICLES = [
  {
    id: 'web-request-toolkit',
    toolId: 'burp-proxy',
    category: 'webapp',
    title: 'HTTP Workbench — Repeater, Intruder, Comparer & Decoder',
    summary: 'Craft and replay HTTP/HTTPS requests with cancel and timeouts, exact byte sizes, binary-safe responses, copy-as snippets and HAR history; fuzz with Intruder, diff responses, and encode/decode payloads.',
    tags: ['HTTP', 'HTTPS', 'Repeater', 'Intruder', 'Decoder', 'Comparer', 'Burp', 'Fuzzing', 'HAR', 'curl'],
    readTime: '6 min read',
    content: `
# HTTP Workbench

The **HTTP Workbench** tool has two sections, switched with the buttons **Request Toolkit** and **API Client (OpenAPI)**; both stay loaded when you switch and share one proxy bar. This article covers the Request Toolkit (tabs **repeater**, **intruder**, **comparer**, **decoder**); the API Client has its own article. Requests go through \`fetch\` and are CORS-limited.
${CORS_NOTE}
---

### Import a request
Click **Import request (curl / raw HTTP)** (in Repeater and Intruder), paste a command or raw request, and press **Parse as curl** or **Parse as raw HTTP**. The method, URL, headers and body fill the editor. The curl parser understands \`-X\`, \`-H\`, \`-d\`/\`--data*\`, \`-b\`, \`-u\`, \`-A\`, \`-e\` and \`--url\`.

### Repeater
Choose a method, enter a URL (a scheme-less URL defaults to \`https://\`), add headers (one \`Key: Value\` per line) and a body, then **Send**.

- **Cancel** appears while a request is in flight. The **Timeout** box is in seconds (default 30; \`0\` disables it). A cancelled or timed-out request is reported as such rather than as a network failure.
- The status line shows the real UTF-8 **byte size** of the body (not a character count) and the time in ms.
- Responses are read as bytes. A response that is not text (by content type, or by NUL bytes / invalid UTF-8) is marked "binary", shows only the hex view, and offers **Save response** to download the raw bytes.
- Text responses have the views **pretty** (formatted JSON), **raw**, **hex** and **render** (HTML in a sandboxed iframe with scripts disabled). A search box highlights matches; **→ Comparer A** / **→ Comparer B** send the body to the Comparer.

#### Copy as
**Copy as ▾** copies the current request as **curl**, **fetch**, **PowerShell** (\`Invoke-WebRequest\`), **Python requests**, **HTTPie**, **Go net/http** or **Raw HTTP** (an HTTP/1.1 message with a Host header). HTTPie and Go output are text exports for those tools; nothing is run here. The curl output single-quotes every value so shell metacharacters stay inert, and uses \`--data-raw\` so a body starting with \`@\` is never read as a file.

#### Variables and extract
Open **Variables & extract** under the Send row. Enter \`NAME=value\` lines (blank lines and \`#\` comments are ignored) and use \`{{NAME}}\` in the URL, headers or body; values are substituted when you press **Send**, and history stores the substituted request. Unknown names are left as typed (and listed in the log), so Intruder's \`{{value}}\` markers are unaffected. After a JSON response, enter a path such as \`data.items[0].token\` (also \`$.a["b c"]\` and \`[*]\` for all elements), name a variable and press **Extract** to store the value as a variable for the next request. Without a name it only shows the value. Only JSON bodies are supported.

#### History and HAR
The History column keeps up to 100 requests. It is saved in this browser's local storage; header values for \`Authorization\`, \`Proxy-Authorization\`, \`Cookie\`, \`X-API-Key\`, \`X-Auth-Token\` and \`X-CSRF-Token\` are replaced with \`[redacted]\` before saving, and response bodies are not saved. Request bodies are stored as typed, so avoid putting secrets in them. **Export HAR** writes the listed entries as a HAR 1.2 file, **Import** adds requests from a HAR file, **Clear** empties the history.

> Review a HAR before sharing it. The redaction applies to what is saved between visits; entries from the current session still hold the headers and response as they were sent and received.

### Intruder
Mark fuzz positions with \`{{value}}\` in the URL, headers or body and choose an attack: **Sniper (one position at a time)**, **Battering ram (same payload, all positions)**, **Pitchfork (parallel sets)** or **Cluster bomb (all combinations)**. Load payloads with the SecLists picker or paste them, one per line. Set a **grep-match** string to flag responses that contain it. **Start attack** runs with bounded concurrency and a progress count; **Cancel** stops it and drops the in-flight request. Results are sortable and filterable, each row can go to the Comparer (**→cmp**), and the table exports to CSV (formula-looking cells are neutralised).

Run it only against systems you own or are authorised to test.

### Comparer
Paste or send two responses into A and B and press **Compare** for a line-level diff with counts.

### Decoder
Per-codec **enc** / **dec** buttons (Base64, URL, Hex, HTML), **JWT decode** (header and payload only, signature not verified), **Smart decode** (tries the codecs in turn), and hash buttons for MD5 and SHA. **↑ output → input** chains steps.

**Similar tools:** Burp Repeater/Comparer, Postman, Insomnia and Hoppscotch (variables, code generation, history).

**Limits:** a browser cannot set some headers (Host, Content-Length) and cannot be a transparent intercepting proxy; use a real proxy for live interception.
`,
  },
  {
    id: 'api-client-openapi',
    toolId: 'api-client',
    category: 'webapp',
    title: 'API Client — OpenAPI/Swagger explorer with schema fuzzing',
    summary: 'Import an OpenAPI 3 / Swagger 2 spec, browse endpoints with generated forms, send requests with variables and auth, cancel with a timeout, and run schema-based negative tests against your own API.',
    tags: ['API', 'OpenAPI', 'Swagger', 'REST', 'Fuzzing', 'Postman', 'Hoppscotch', 'Schema'],
    readTime: '6 min read',
    content: `
# API Client (OpenAPI)

Spec-driven REST testing, the **API Client (OpenAPI)** section of the HTTP Workbench. Fully client-side; requests go through the shared proxy bar.
${CORS_NOTE}
---

### Import a spec
Paste an **OpenAPI 3** or **Swagger 2** spec (JSON, or a common subset of YAML) and press **Load spec**, or enter a spec URL and press **Fetch** (through the proxy if set). **load another spec** returns to the import box.

### Base URL
The **Base URL** comes from the spec's \`servers\` (OpenAPI 3) or \`schemes\`/\`host\`/\`basePath\` (Swagger 2); a dropdown appears when several servers exist, and the field is editable. A relative server URL such as \`/api/v1\` is resolved against the spec URL when you fetched the spec from an absolute URL. If it is still relative, a warning asks for the full origin and **Send** and **Fuzz endpoint** stay disabled. This is deliberate: a relative base would otherwise send the request to this app's own origin.

### Browse and send
Pick an endpoint from the filterable list. Parameter inputs are generated from the spec (path, query, header; required ones flagged) and the body is prefilled with an example built from the schema.

- **Variables:** \`NAME=value\` lines, used as \`{{NAME}}\` in the base URL, parameters, body and auth.
- **Auth:** Bearer, Basic or API-key header.
- **Send** shows status, true byte size and timing. **Cancel** appears while a request runs, and **Timeout** (seconds, default 30, \`0\` disables) applies to each request. **Copy as curl** copies the request; binary responses offer **Save response**.

### Schema fuzzing
**Fuzz endpoint** asks for confirmation (it shows the number of requests and the base URL), then sends negative test cases built from the operation's schema: omitted required parameters, wrong-typed values, injection-style strings and malformed or empty JSON bodies. Results are listed with 5xx responses and errors highlighted, because a well-behaved API should answer bad input with a 4xx. **Export CSV** saves the table. **Cancel** stops the run. Only fuzz APIs you own or are authorised to test.

**Limits:** YAML support is a subset, so give complex specs as JSON. OAuth2 interactive flows are not supported; supply a token via Bearer or a variable.
`,
  },
  {
    id: 'web-security-scanner',
    toolId: 'web-analyzer',
    category: 'webapp',
    title: 'Web Analyzer — headers grade, cookies, tech, links & passive scan',
    summary: 'One fetch of a URL gives an A-F security-header grade, redirect chain, technology fingerprint, cookie flags, passive findings, links, resources and forms, with Markdown and JSON export.',
    tags: ['Web Analyzer', 'Security headers', 'CSP', 'HSTS', 'Cookies', 'CORS', 'CWE', 'Passive scan', 'OWASP', 'Redirects'],
    readTime: '4 min read',
    content: `
# Web Analyzer

Enter a URL and press **Analyze**. The tool fetches the page **once** and derives everything below from that single response, so it sends one request to the target, not a scan. Only analyze sites you own or are authorised to assess.
${CORS_NOTE}
---

### What you get
- **Summary:** status, size, time, final URL and page title.
- **Redirect chain:** each hop with its status. Shown only when the proxy reports it.
- **Security headers:** a letter grade **A to F** with a score out of 100. It grades header **values**, not just presence, across 11 weighted checks: Content-Security-Policy, Strict-Transport-Security, X-Frame-Options (or CSP \`frame-ancestors\`), X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener/Embedder/Resource-Policy, Subresource Integrity on external scripts and styles, and mixed content. Each row says why it passed or failed. A broken CSP or HSTS value, or active mixed content, caps the grade at C.
- **Technology:** frameworks, servers and CMSs matched from headers, HTML, cookies and script URLs, with the evidence on hover.
- **Cookies:** Secure / HttpOnly / SameSite flags with warnings.
- **Passive scan:** findings with severity and CWE for cleartext transport, missing HSTS/CSP, clickjacking exposure, version banners, permissive CORS and cookie flags.
- **Links, Scripts, Stylesheets, Images, Forms,** plus a collapsible list of response headers and meta tags.

**Export (.md)** and **Export (.json)** save the analysis (and any Path Prober / Crawler results you ran) to a file.

### Cookies and redirects need the proxy
Browsers hide \`Set-Cookie\` from \`fetch\`, and cross-origin pages expose few headers without CORS. The bundled local proxy (**Use localhost** in the proxy bar) forwards the real \`Set-Cookie\` values and the redirect chain. Without it the Cookies section says cookie flags cannot be seen, and the passive scan notes that few headers were readable. The grade then reflects only the headers the browser could read, so treat it as incomplete.

### Path Prober and Crawler
Two on-demand sections below the results, seeded with the same URL: **Path Prober (on-demand)** (see the Web Path Prober article) and **Crawler (on-demand)**. These send many requests.
`,
  },
  {
    id: 'web-path-prober',
    toolId: 'nikto-scanner',
    category: 'webapp',
    title: 'Web Path Prober — content discovery with SecLists',
    summary: 'Probe many URL paths from a SecLists wordlist and flag interesting responses (2xx/3xx, 401/403), with concurrency, progress and a stop button.',
    tags: ['Content discovery', 'Nikto', 'SecLists', 'Wordlist', 'Fuzzing', 'Paths'],
    readTime: '4 min read',
    content: `
# Web Path Prober

Content discovery: request a list of paths against a target and flag the interesting ones.
${CORS_NOTE}
---

### Wordlists (SecLists)
Load a path list with the **wordlist picker**: curated SecLists entries (common, quickhits, API endpoints, RAFT, big), a custom URL, or an uploaded file. SecLists are fetched from the **jsDelivr CDN**, which is CORS-enabled, so loading works directly from the browser. With no list loaded, a small built-in list of common sensitive paths is used.

### Scanning
Enter the target base URL and **Scan**. Requests run with bounded concurrency and a progress counter, and the run can be stopped. Only **interesting** responses are listed — any 2xx/3xx, or auth-gated 401/403 — and the summary shows total probed, interesting count, and blocked/unreachable count.

### Limits
Without a proxy, cross-origin responses are usually unreadable (counted as "blocked"); configure a proxy for real status codes. Very large lists are capped per run to keep the browser responsive.
`,
  },
  {
    id: 'basic-auth-tester',
    toolId: 'hydra-bruteforce',
    category: 'webapp',
    title: 'HTTP Basic Auth Tester',
    summary: 'Try username/password lists against an HTTP Basic-auth endpoint and report the first success. Load credential lists from SecLists.',
    tags: ['Hydra', 'Brute force', 'Basic auth', 'Credentials', 'SecLists'],
    readTime: '3 min read',
    content: `
# HTTP Basic Auth Tester

Try combinations of usernames and passwords against an HTTP **Basic** authentication endpoint.
${CORS_NOTE}
---

### Usage
Enter the target URL, then load **usernames** and **passwords** — paste them, or pull SecLists username/password lists with the wordlist pickers. **Start** tries each pair with an \`Authorization: Basic …\` header and stops at the first HTTP 2xx. A counter shows progress and the run can be stopped.

### Limits
Only HTTP Basic auth is covered (not form logins, tokens or other schemes). Direct from the browser this works only against CORS-permissive targets; use a proxy for others. A browser cannot tell a CORS rejection from a connection failure, so failures are reported honestly as "request failed."
`,
  },
  {
    id: 'port-scanner',
    toolId: 'nmap-scanner',
    category: 'webapp',
    title: 'Port Scanner — browser connect-timing scan',
    summary: 'Scan a host for open TCP ports using a fetch connect-timing heuristic. Honest about browser limits (restricted ports, mixed content, private-network access).',
    tags: ['Nmap', 'Port scan', 'Recon', 'TCP', 'WASM'],
    readTime: '4 min read',
    content: `
# Port Scanner

A browser cannot open raw TCP sockets, so this uses a **connect-timing heuristic** over \`fetch\`: a port that answers HTTP is *open*, a fast connection refusal is *closed*, and a stall is *open|filtered*.

---

### Usage
Enter a host and a port list or ranges (e.g. \`80,443,8000-8100\`). Scanning runs with bounded concurrency, a progress counter and a stop button. Open and browser-blocked ports are listed with timing.

### Honest limitations
- **Browser-restricted ports:** Chrome refuses \`fetch\` to many classic service ports (21, 22, 23, 25, 110, 143, 993, 995, …). These are reported as **blocked**, not scanned.
- **Mixed content:** from an HTTPS page only HTTPS targets and \`localhost\` can be probed.
- **Private Network Access:** Chrome blocks pages from probing \`localhost\` / private IPs, so local scans may all look closed.
- **No service/version detection** without a native engine.

For real scanning past these limits, build \`public/wasm/portscanner.wasm\` (the engine carries its own transport; see the WASM Engines doc) or route through a local proxy.
`,
  },
  {
    id: 'dns-enumerator',
    toolId: 'dns-toolkit',
    category: 'webapp',
    title: 'DNS Toolkit — records, email authentication, DNSSEC & subdomain brute-force',
    summary: 'One DNS-over-HTTPS lookup shows records, SPF (with include expansion), DMARC, DKIM, MTA-STS, TLS-RPT, BIMI, DNSSEC, multi-resolver agreement and DNSBL status, with Markdown/JSON export; plus subdomain brute-force.',
    tags: ['DNS', 'DoH', 'SPF', 'DMARC', 'DKIM', 'MTA-STS', 'DNSSEC', 'DNSBL', 'Subdomains', 'Recon', 'SecLists'],
    readTime: '3 min read',
    content: `
# DNS Toolkit

Enter a domain and press **Look up**. All queries use **DNS-over-HTTPS** through the proxy-aware fetch (direct when no proxy is set). The tool queries the domain's own public records and, for the DNSBL check, the public blocklists; use it on domains you own or are authorised to assess.

---

### What one lookup shows
- **Records:** A, AAAA, CNAME, MX, NS, SOA, CAA and TXT (TXT strings are labelled by type). A record type that fails shows an error chip and the others still render.
- **Resolver status:** a SERVFAIL or REFUSED from the resolver is reported as an error, not as "no records". NXDOMAIN is a valid empty answer.
- **SPF:** the record, its \`all\` qualifier (a \`+all\` is flagged), and the real **DNS lookup count** with \`include:\` and \`redirect=\` chains expanded recursively and checked against the limit of 10, with void-lookup counts, errors and warnings.
- **DMARC:** policy, strength, \`sp\`, \`adkim\`, \`aspf\`, \`pct\`, and the \`rua\` / \`ruf\` report addresses.
- **DKIM:** the selector in the **DKIM selector** box; tick **also try common selectors** to probe a built-in list (default, google, selector1, selector2, k1, mail and others). "Not found" only means not found for the selectors tried.
- **MTA-STS, TLS-RPT, BIMI:** published or not, with details. The MTA-STS policy file (\`mta-sts.<domain>/.well-known/mta-sts.txt\`) sends no CORS headers, so it is fetched only when a proxy is configured; otherwise the tool says a proxy is needed.
- **DNSSEC:** \`validated\`, \`unverified\`, \`incomplete\`, \`unsigned\` or \`error\`, from the DS and DNSKEY records and the resolver's AD flag.
- **Resolver agreement:** the A and NS answers from three resolvers (dns.google, cloudflare-dns.com, dns.quad9.net) are compared. A difference is often geo-DNS or load balancing, but can also indicate tampering; resolvers that failed are listed.
- **DNSBL reputation:** the mail servers' IPs are checked against zen.spamhaus.org, bl.spamcop.net and b.barracudacentral.org. A refused query (such as Spamhaus' \`127.255.255.25x\` codes from a public resolver) or a resolver error is shown as **inconclusive**, never as "listed" or "clean".

**Export (.md)** and **Export (.json)** save everything for the domain (the JSON includes resolver agreement).

### Subdomain brute-force
Load a **Subdomain list** with the SecLists picker (up to 20,000 words), then press **Brute subdomains**. Each \`word.domain\` is resolved over DoH with bounded concurrency; resolving names are listed with their A records. **Stop** cancels, and **verbose** shows the running log. Run it only against domains you are authorised to test.

### Limits
AXFR zone transfers need TCP to the authoritative server and cannot be done from a browser.
`,
  },
  {
    id: 'crtsh-finder',
    toolId: 'crtsh-finder',
    category: 'webapp',
    title: 'crt.sh Subdomain Finder — passive Certificate Transparency lookup',
    summary: 'List the hostnames in public Certificate Transparency logs for a domain, with issuer and expiry, via crt.sh and the site\'s /api/crtsh relay. The target is never contacted.',
    tags: ['crt.sh', 'Certificate Transparency', 'CT logs', 'Subdomains', 'Passive recon', 'OSINT', 'Wildcard'],
    readTime: '3 min read',
    content: `
# crt.sh Subdomain Finder

Passive subdomain discovery from **Certificate Transparency** logs. The tool asks crt.sh for every certificate logged under a domain and lists the unique hostnames with issuer and expiry. It never connects to the target itself, but it only shows names that appear on a certificate, so internal or never-certified hosts are missing. Use it on domains you own or are authorised to assess.

---

### Using it
Enter a base domain (a pasted URL, path or leading \`*.\` is stripped) and press **Find subdomains**. Two boxes shape the query: **exclude expired** and **dedupe** (both are passed to crt.sh).

For each host the most recently logged certificate wins. The table shows **Host**, **Issuer**, **Not after** and a badge (**expired**, or **expires in Nd** within 30 days). A star marks a name that also appeared as a wildcard (\`*.example.com\`). Only names inside the base domain are kept. A summary line gives unique hosts, cert records, expired count and the route used; below it are the top issuers. The **filter…** box narrows by host or issuer, and **.txt** (host list), **.csv** and **.json** export the filtered rows (CSV cells that look like formulas are neutralised).

### How the request travels
crt.sh sends no CORS headers, so a page cannot call it directly. The tool tries, in order:

1. The site's own relay, \`/api/crtsh\`, on the hosted site (or the dev server). The Worker accepts only GET/HEAD and rebuilds the crt.sh URL itself: the \`q\` value must look like a domain (\`%.example.com\`), only \`output=json\`, \`exclude=expired\` and \`deduplicate=Y\` are passed, anything else is rejected, and requests from other sites are refused.
2. If the relay is not served on this host, the **Proxy** bar (or a direct request when it is empty).

The summary shows which route answered ("site relay", "proxy" or "direct"). On a busy crt.sh (HTTP 429, 502, 503, 504) the tool retries up to twice with a growing delay, then reports that crt.sh is overloaded.

### Notes
- crt.sh can be slow or rate-limited; "did not return JSON" usually means that, or a proxy problem.
- CT data shows what was issued, not what is live. To inspect one certificate, use the Certificate Inspector.
`,
  },
  {
    id: 'ip-calculator',
    toolId: 'ip-calculator',
    category: 'webapp',
    title: 'IP / CIDR Calculator — subnets, split, VLSM, aggregate & overlap',
    summary: 'IPv4 and IPv6 subnet math fully offline: network details, split into smaller subnets, VLSM planning, aggregation, range to CIDRs, containment/overlap checks and reverse DNS names.',
    tags: ['CIDR', 'Subnet', 'IPv4', 'IPv6', 'VLSM', 'Netmask', 'Wildcard', 'Aggregate', 'Reverse DNS', 'Networking'],
    readTime: '3 min read',
    content: `
# IP / CIDR Calculator

A subnet calculator for **IPv4 and IPv6**. It runs entirely in the browser with no network access. Use the tabs **Calculate**, **Split**, **VLSM**, **Aggregate** and **Contains / overlap**.

---

### Calculate
Type an address with a prefix (\`192.168.1.10/24\`, \`10.0.0.1/255.255.255.0\`, \`2001:db8::/48\`) or click an example chip. An invalid entry shows the reason. The report gives:

- Network, broadcast (IPv4), netmask and wildcard (IPv4), first and last host, prefix, total addresses and usable hosts.
- A class/scope label (for example private ranges are highlighted).
- The **reverse DNS name** for the address (\`in-addr.arpa\` / \`ip6.arpa\`).
- A binary view with the network bits highlighted.

Each row has a copy button; **Copy all** and **Export (.md)** take the whole report.

### Split
Enter a network and a new prefix (**into /N**) to list the equal subnets it divides into. **max** caps the output (default 1024) so a huge split does not flood the page.

### VLSM
Enter an IPv4 parent network (VLSM is IPv4 only) and a comma-separated list of host counts, for example \`100, 50, 10\`. The tool allocates the smallest fitting subnet to each requirement, largest first, and lists each CIDR with requested hosts, usable hosts and first-last range. It reports an error if the requirements do not fit in the parent.

### Aggregate
Paste one CIDR per line to merge adjacent and overlapping networks into the smallest covering list. Below it, **Range to CIDRs** converts a start and end address into the minimal CIDR blocks.

### Contains / overlap
Give network A and a network or address B. The result is one of: identical, A contains B, B contains A, partial overlap, or no shared addresses.

### Notes
IPv6 results have no broadcast or netmask rows. The calculator does arithmetic only; it does not look anything up or check whether addresses are in use.
`,
  },
  {
    id: 'osint-clients',
    toolId: 'osint-clients',
    category: 'webapp',
    title: 'OSINT API Clients — Shodan, urlscan.io & HackerTarget with your own keys',
    summary: 'Front-ends for the Shodan REST API (search builder, host, DNS, exploits, account), urlscan.io search and HackerTarget lookups. You supply the API key; Shodan calls use the site relay automatically.',
    tags: ['OSINT', 'Shodan', 'urlscan.io', 'HackerTarget', 'API key', 'Recon', 'Relay', 'Proxy'],
    readTime: '5 min read',
    content: `
# OSINT API Clients

Three tabs, **Shodan**, **urlscan.io** and **HackerTarget**, that call each vendor's public API with **your own API key**. This app has no dataset of its own; it shows what the vendor returns. Query only hosts and domains you own or are authorised to assess, and respect each vendor's terms and rate limits.

---

### API keys
Each tab has an API key field with show/hide, copy, **Save** and a remove button. Keys are stored in this browser's local storage and sent only to that vendor (through the relay or proxy). urlscan.io and HackerTarget work without a key at lower limits; Shodan needs one.

### How requests reach the vendor
Most vendor APIs send no CORS headers, so a browser cannot call them directly. The proxy bar works as in other tools (**Use localhost** fills in the bundled local proxy). **Shodan** has an extra **Route** selector:

- **auto — site relay, then Proxy bar** (default): calls go to this site's own \`/api/shodan\` (and \`/api/shodan-exploits\`) routes, which the Cloudflare Worker forwards to \`api.shodan.io\` / \`exploits.shodan.io\`. If the relay is not served on this host, the tool falls back to the proxy bar or a direct request.
- **Proxy bar / direct only.**

The relay is narrow: GET/HEAD only, fixed upstreams, no cookies forwarded, nothing cached, and other sites are refused. It holds no key of its own: your key travels in the query string of the request, as the Shodan API expects, so treat the key as visible to anything that can see that request. Each result shows its route (via site relay, via proxy, direct), and non-JSON error pages are reported with the HTTP status.

### Shodan tab
Modes: **Search**, **Host**, **DNS**, **Exploits**, **Account & tools**.

- **Search:** a query builder with one row per filter (negatable, with filter descriptions and examples), plus an editable raw query string and presets. Facets can be added and their top values clicked to add them to the query. **Search** returns paged results (**‹ prev** / **next ›**), **Count only (free)** returns just the total, and results export with **CSV**, **Copy IPs** and **Copy query**. Searches that use filters cost Shodan query credits; the credit note appears in the endpoint tooltips.
- **Host:** everything Shodan knows about one IP, with history and minify options, and a **honeypot score**.
- **DNS:** **Domain info (1 credit)**, **Resolve hostnames** and **Reverse DNS**.
- **Exploits:** search the Exploit-DB / Metasploit / CVE index.
- **Account & tools:** API plan and credits, your IP, HTTP headers, crawled ports, crawler protocols, filter and facet lists, popular query tags, and **Community queries**.

Raw JSON can be copied or downloaded from each result.

### urlscan.io tab
Enter a search query such as \`domain:example.com\` and press **Search**. Up to 100 results are listed with the page URL (linking to the scan result), IP, server and date.

### HackerTarget tab
Pick **DNS lookup**, **Reverse IP**, **Host search**, **AS lookup**, **HTTP headers** or **Page links**, enter a domain or IP, and press **Run**. The raw text reply is shown.
`,
  },
  {
    id: 'certificate-inspector',
    toolId: 'cert-inspect',
    category: 'webapp',
    title: 'Certificate Inspector — X.509 viewer with chain, hostname and pin checks',
    summary: 'Inspect X.509 certificates from a URL (crt.sh), a file or pasted PEM: extensions, weakness hints, chain verification, hostname matching and SPKI pin, with client-side parsing.',
    tags: ['Certificate', 'X.509', 'TLS', 'SSL', 'PEM', 'DER', 'PKCS7', 'Chain', 'SPKI pin', 'Fingerprint'],
    readTime: '3 min read',
    content: `
# Certificate Inspector

Parse and display X.509 certificates. Parsing, fingerprints and signature checks run in the browser. The tool has three sources, chosen with the buttons **From URL**, **From file** and **Paste PEM**.

---

### From URL
Enter a host and press **Fetch certs**. The list comes from Certificate Transparency logs (crt.sh) through the proxy bar: the 25 most recently issued certificates for the host, newest first, and the newest is loaded. This is what was *issued*, which can differ from what the server serves right now. If you run the TLS inspector Docker backend, a **Live cert** button also appears and fetches the certificate the server presents at this moment.

### From file and Paste PEM
Choose a \`.pem\`, \`.crt\`, \`.cer\`, \`.der\`, \`.p7b\`, \`.p7c\` or \`.pb7\` file, or paste PEM text and press **Parse**. A PEM bundle or PKCS#7 file loads **every** certificate it contains.

### Chain verification
For a bundle the tool orders the certificates leaf to root and shows a panel marked "Chain complete and every signature verifies" or "Chain has problems", with each certificate tagged leaf, intermediate or root and \`signature OK\` / \`signature FAILED\` / \`signature unchecked\`, plus per-certificate notes. Certificates that are not part of the leaf's chain are listed separately. Click an entry to inspect it.

> Signatures are checked with Web Crypto between the certificates you supplied only. No trust store is consulted, so a self-signed root is reported but not trusted, and nothing here says a browser would accept the chain.

### Hostname check
The box "check hostname or IP against this certificate" matches the name against the SANs (wildcards and IP SANs included) and prints \`Match: <name> (<how>)\` or \`No match: <reason>\`.

### Details shown
Subject and issuer, self-signed flag, validity dates with an expired / not-yet-valid / days-left status, validity period, version, serial, signature algorithm, public key (type, size or curve), SAN, key usage, extended key usage, basic constraints, key identifiers, CRL / OCSP / CA Issuers URLs, critical extensions, policies, name constraints, TLS feature (must-staple), embedded SCTs, unknown extensions, **weakness hints** (for example short keys or weak signature algorithms), SHA-256 / SHA-1 / SHA-512 fingerprints, the **SPKI pin** (SHA-256, base64) and the DER size. A **PEM** link downloads the selected certificate.

The parser is a dependency-free DER/ASN.1 reader. It does not check revocation (OCSP/CRL URLs are shown, not queried).
`,
  },
  {
    id: 'pwned-passwords',
    toolId: 'pwned-passwords',
    category: 'webapp',
    title: 'Pwned Passwords — breach checks for passwords, emails and the breach catalog',
    summary: 'Check passwords (typed, password-manager CSV or hashes) with k-anonymity, check emails against breach sources, and browse the HIBP breach catalog. Passwords never leave the browser.',
    tags: ['Pwned', 'HIBP', 'Breach', 'Password', 'k-anonymity', 'NTLM', 'XposedOrNot', 'CSV'],
    readTime: '3 min read',
    content: `
# Pwned Passwords

The tool has three tabs: **Passwords**, **Email** and **Breach catalog**.

---

## Passwords tab

### Privacy model
Each password is hashed **in the browser** (SHA-1, or NTLM in NTLM mode). Only the first 5 hex characters of the hash are sent to the HaveIBeenPwned range API, which returns every suffix with that prefix; the match is made locally. The password and full hash never leave the page. The \`Add-Padding\` header hides how many matches a prefix had. Requests go through the proxy bar when one is set, otherwise directly. Passwords are never logged: logs and tables show a masked form such as \`p•••(12)\` (first character and length).

### Sources
Choose the source with the buttons **Type or paste**, **Password manager CSV** and **Hashes**.

- **Type or paste:** one password per line, with an optional **Trim whitespace** box. Results can be revealed per row with **show** / **hide**.
- **Password manager CSV:** **Choose password export (.csv)** reads a Bitwarden, 1Password, Chrome or Firefox export (up to 5,000 entries). The report shows site and username, never the password, and flags entries that share a password (\`reused ×N\`). The file stays in this tab, passwords are hashed locally and dropped from memory when the run ends. Delete the export file afterwards.
- **Hashes:** one 40-digit SHA-1 (or 32-digit NTLM) hash per line; invalid lines are skipped.

### Hash type and NTLM
The **Hash** selector offers **SHA-1 (standard)** and **NTLM (HIBP NTLM range)**. NTLM mode uses the same k-anonymity range API with \`?mode=ntlm\`; it only reports how often a hash appears in breaches and cannot recover a password.

### Running
**Check Passwords** (or **Check Hashes**) sends one request per distinct 5-character prefix (a per-run cache avoids repeats), sequentially. Progress shows entries checked and requests made; **Cancel** stops the run and keeps the rows already checked. The summary reports checked / compromised counts and reuse. A red count means the password appears in known breaches and should not be used. **Export masked report (CSV)** saves site, username, masked password, count and status (never the password).

---

## Email tab
Up to 20 addresses (one per line, validated). **XposedOrNot** is queried by default with no key. Tick **Also query Have I Been Pwned** and save your own HIBP key to add HIBP; the box is disabled with an explanation when the site's \`/api/hibp\` relay is not reachable (it needs the deployed site or the dev server). The key is stored only in this browser and forwarded through the relay in the \`hibp-api-key\` header; the email address is not logged. Results list breach name, domain, date, data classes and verified status, or "No known breaches". Logs show masked addresses (\`j•••@example.com\`). Rate limits are reported, and HIBP calls are paced.

## Breach catalog tab
**Load catalog** fetches the public HIBP breach list (no key). Search by name or domain; results are newest first, 50 at a time with **Show more**.

---

### Scope
Only breach **membership** is reported, never leaked records. Names, phone numbers, street addresses and usernames are not supported because no reputable breach-notification API accepts them.
`,
  },
  {
    id: 'hash-cracker',
    toolId: 'hashcat-cracker',
    category: 'webapp',
    title: 'Hash Cracker — dictionary attack (MD5/SHA)',
    summary: 'Run a wordlist dictionary attack against a hash using MD5 or SHA-1/256/384/512, entirely in the browser. Load wordlists from SecLists.',
    tags: ['Hashcat', 'Hash', 'MD5', 'SHA', 'Dictionary', 'SecLists'],
    readTime: '3 min read',
    content: `
# Hash Cracker

A client-side **dictionary** (wordlist) attack against a hash. Runs entirely in the browser; no backend.

---

### Usage
Pick the algorithm (**MD5**, **SHA-1**, **SHA-256**, **SHA-384**, **SHA-512**), paste the target hash, and provide a wordlist — paste candidates or load a SecLists **password list** with the picker. **Crack** hashes each candidate until it finds a match, with a progress percentage and a stop button.

### Notes
SHA variants use the browser's Web Crypto; MD5 is implemented locally (Web Crypto omits it) and verified against the RFC 1321 test vectors. This is a dictionary attack, not brute force over a keyspace, and throughput is JavaScript-bound — it suits testing and modest lists, not large cracking jobs.
`,
  },
  {
    id: 'wpa-pmkid-cracker',
    toolId: 'aircrack-wifi',
    category: 'rf',
    title: 'WPA PMKID Cracker — offline PMKID dictionary attack',
    summary: 'Offline dictionary attack on a captured WPA/WPA2 PMKID using Web Crypto (PBKDF2-HMAC-SHA1 + HMAC-SHA1). Load wordlists from SecLists.',
    tags: ['Aircrack', 'WPA', 'WPA2', 'PMKID', 'WiFi', 'PBKDF2', 'SecLists'],
    readTime: '4 min read',
    content: `
# WPA PMKID Cracker

Offline dictionary attack on a captured WPA/WPA2 **PMKID**. Runs entirely in the browser via Web Crypto; no backend.

> **Capture is not possible in a browser.** Capturing a PMKID needs monitor-mode WiFi hardware (for example \`hcxdumptool\`). This tool performs the offline *cracking* step on a PMKID you already captured.

---

### How it works
\`PMK = PBKDF2-HMAC-SHA1(passphrase, SSID, 4096, 32)\` and \`PMKID = HMAC-SHA1(PMK, "PMK Name" || AP_MAC || STA_MAC)[0:16]\`. Both primitives come from Web Crypto; the PBKDF2 path is verified against the IEEE 802.11i WPA test vectors.

### Usage
Enter the SSID, AP (BSSID) and client MACs (colons optional), the captured 32-hex PMKID, and a wordlist — paste passphrases or load a SecLists **WiFi/password list** with the picker. WPA passphrases must be 8–63 characters; others are skipped. **Crack** shows progress and a stop button.

### Notes
Web Crypto PBKDF2 is correct but not fast — use modest wordlists. Only the PMKID attack is implemented, not EAPOL 4-way handshake cracking.
`,
  },
  {
    id: 'pcap-viewer',
    toolId: 'tcpdump-viewer',
    category: 'analysis',
    title: 'PCAP Viewer — pcap/pcapng parsing, filters, conversations & export',
    summary: 'Open a .pcap or .pcapng capture and browse up to 200,000 decoded packets with paging, a display filter, conversation and protocol tables, per-packet layer detail, and CSV or filtered-PCAP export.',
    tags: ['PCAP', 'pcapng', 'tcpdump', 'Packets', 'Ethernet', 'TCP', 'Wireshark', 'Conversations'],
    readTime: '3 min read',
    content: `
# PCAP Viewer

Parse and browse a packet capture. The file is read and decoded in the browser and never uploaded.

---

### Opening a capture
Choose a \`.pcap\`, \`.cap\` or \`.pcapng\` file. The header line shows the format, packet count and link type. Both classic libpcap (either byte order, microsecond or nanosecond) and **pcapng** are supported. Up to **200,000 packets** are decoded; if the file has more, a banner reports "Showing first N of M packets (decode limit reached)". Parser warnings are shown under the banner.

### Packets view
A table of #, time (relative to the first packet), source and destination (with ports), protocol, info and length, shown **500 per page** with **Prev** / **Next**. Click a row for the decoded layers (Frame, Ethernet/VLAN/Linux cooked/radiotap/raw IP, IPv4/IPv6, TCP/UDP/ICMP, plus one-line DNS, HTTP, TLS SNI, DHCP and ARP summaries) next to a hex dump of the packet.

### Filter
The filter box ANDs space-separated terms (\`and\` is ignored): a protocol word such as \`tcp\`, \`udp\`, \`dns\`, \`tls\`, \`icmp\`, \`arp\`, \`http\`, \`dhcp\`, \`ipv4\`, \`ipv6\`, \`vlan\`; \`port N\`; \`host ADDRESS\`; or any other text, matched as a substring of the packet's addresses, ports, protocol and info text. Examples: \`tcp port 443\`, \`host 10.0.0.1\`, \`example.com\`. It is a simple display filter, not Wireshark or BPF syntax.

### Conversations and Protocols
The **Conversations** tab lists bidirectional address pairs with packet count, bytes and duration; **Protocols** lists packets and bytes per protocol. Both follow the current filter.

### Export
**CSV** saves the filtered packet table. **PCAP** writes the filtered packets as a classic pcap; packets with a different link type than the first are skipped (and the number skipped is logged).

### Notes
Decoding is best-effort: an unknown link type or truncated packet gives a partial decode rather than an error. Encrypted traffic is shown as such; this tool does not decrypt TLS.
`,
  },
  {
    id: 'docker-backends',
    toolId: 'web-analyzer',
    category: 'webapp',
    title: 'Docker Backends — local services for the web tools',
    summary: 'Optional local Docker containers that give the browser security tools capabilities a browser lacks: cross-origin fetches, real nmap scans, live TLS handshakes and arbitrary DNS. Each tool has a Docker backend button that hands you a ready-to-run compose file.',
    tags: ['Docker', 'docker-compose', 'Backend', 'CORS Proxy', 'nmap', 'OWASP ZAP', 'Hydra', 'TLS', 'DNS', 'Self-hosted'],
    readTime: '5 min read',
    content: `
# Docker Backends

The whole app runs in your browser, which is safe but limited: a page can't open raw sockets, do a TLS handshake, run \`nmap\`, or read most cross-origin responses (CORS). These **optional** local Docker services add exactly those abilities, each as its own small container, on your own machine. Nothing is sent anywhere — the containers run on \`localhost\`.

> Only use these against systems you own or are explicitly authorized to assess.

---

### Getting the files from a tool
There is no separate "Docker" page. Every tool that can use a backend has a **Docker backend** button in its **proxy bar** (the Port Scanner, Certificate Inspector, DNS Toolkit, Web Analyzer, HTTP Repeater, API Client, and so on). Click it to expand a small panel with two ways to get the files:

- **compose.yml** (or **Copy**) — a single, self-contained \`docker-compose.yml\`. Each Node service's source is embedded directly in the file, so there is nothing else to download. Best when you just want it running.
- **All files (.zip)** — the real project: a build-based \`docker-compose.yml\`, every \`Dockerfile\`, every \`server.cjs\`, and the README. Best if you want to read or modify the services.

### Running it
Save the file (or unzip the bundle), then from that folder:

\`\`\`bash
docker compose up -d                       # start the safe services
docker compose --profile offensive up -d   # also start Hydra (authorized use only)
docker compose down                        # stop everything
\`\`\`

### The services

| Service | Port | Image | Used by | What it adds |
|---|---|---|---|---|
| \`cors-proxy\` | 47101 | node:20-alpine | Web Analyzer, HTTP Repeater, API Client, URL Inspector, OSINT, crt.sh, DB Browser | Forwards HTTP(S) and adds permissive CORS so the page can read any target; also reaches the other services by name |
| \`nmap\` | 47102 | node:20-alpine + nmap | Port Scanner | Real \`nmap\` with service/version detection and non-HTTP ports |
| \`tls-inspector\` | 47103 | node:20-alpine | Certificate Inspector | Live TLS handshake — the certificate the server serves *right now* |
| \`dns\` | 47104 | node:20-alpine | DNS Toolkit | Any record type against any nameserver |
| \`zap\` | 47105 | ghcr.io/zaproxy/zaproxy:stable | OWASP ZAP | ZAP daemon + REST API (reached through the CORS proxy) |
| \`hydra\` | 47106 | node:20-alpine + hydra | HTTP Basic Auth Tester | Online credential testing. **Authorized testing only** — off by default |

Ports use an uncommon \`471xx\` block so they don't clash with common dev servers (3000/5000/8000/8080/9000) or anything already running.

### Wiring a tool to its service
Inside the same Docker backend panel you can:

- **Set the service URL** (defaults to \`http://localhost:<port>\`) and **Save** it.
- **Check** — a health probe that confirms the container is reachable.
- **Use as proxy for fetch tools** (CORS proxy only) — one click points every browser-fetch tool at the proxy.

The **Port Scanner** and **Certificate Inspector** call their services directly once configured (real scan results; the live certificate vs. the crt.sh history), and fall back to the in-browser behavior when no backend is set. The DNS, ZAP and Hydra services are provisioned and health-checked; their tool-side calls are being wired in.

### Safety
- **Hydra** performs online credential attacks. It only starts under the \`offensive\` Compose profile **and** refuses every request unless you set \`I_HAVE_AUTHORIZATION=yes\` (the panel's authorization checkbox writes this into the compose).
- \`cors-proxy\` accepts an optional \`ALLOW_HOSTS\` allowlist to restrict which targets it will forward to.
- Every service binds to its published port on your host. Don't expose these to untrusted networks.
`,
  },
];
