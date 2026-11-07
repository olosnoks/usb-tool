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
    title: 'HTTP/HTTPS Repeater — Repeater, Intruder, Comparer & Decoder',
    summary: 'A Burp-style request toolkit: craft and replay HTTP/HTTPS requests with a multi-view response panel, fuzz with four Intruder attack types, diff responses, and encode/decode payloads.',
    tags: ['HTTP', 'HTTPS', 'Repeater', 'Intruder', 'Decoder', 'Comparer', 'Burp', 'Fuzzing', 'JWT'],
    readTime: '6 min read',
    content: `
# HTTP/HTTPS Repeater

A compact, Burp-style web request toolkit with four tabs. Everything runs in the browser; requests go through \`fetch\` and are CORS-limited.
${CORS_NOTE}
---

### Import a request
Both Repeater and Intruder have an **Import request** box. Paste a \`curl\` command (from your browser devtools "Copy as cURL") or a raw HTTP request, and it is parsed into method, URL, headers and body. **Copy as curl** does the reverse.

### Repeater
Choose a method, enter a URL (HTTP or HTTPS; a scheme-less URL defaults to \`https://\`), add headers (one \`Key: Value\` per line) and a body. **Send** shows the response with switchable views:

- **Pretty** — formatted JSON.
- **Raw** — the body verbatim.
- **Hex** — a hex + ASCII dump.
- **Render** — the HTML response in a sandboxed, script-disabled iframe.

A response search highlights matches, **Copy as curl** copies the request, and the response can be pushed into the Comparer. Every send is kept in **History**.

### Intruder
Mark fuzz positions with \`{{value}}\` anywhere in the URL, headers or body, then choose an attack:

- **Sniper** — one position at a time (positions × payloads).
- **Battering ram** — the same payload in every position.
- **Pitchfork** — parallel payload sets, one list per position, advanced together.
- **Cluster bomb** — every combination across the positions' sets.

Load payloads from **SecLists** with the wordlist picker, or paste your own. A **grep-match** box flags responses containing a string; the results table is sortable and filterable, and any row can be sent to the Comparer.

### Comparer
Paste or send two responses into A and B and **Compare** for a line-level diff (added / removed / unchanged) with counts.

### Decoder
Encode/decode **Base64, URL, Hex, HTML**; **JWT decode** (header + payload, signature not verified); **Smart decode** (auto-detect); and **MD5 / SHA-1 / SHA-256** hashing. "output → input" chains steps.

**Limits:** a browser cannot set some headers (Host, Content-Length) and cannot act as a transparent intercepting proxy — use a real proxy for live interception.
`,
  },
  {
    id: 'api-client-openapi',
    toolId: 'api-client',
    category: 'webapp',
    title: 'API Client — OpenAPI/Swagger explorer with schema fuzzing',
    summary: 'Import an OpenAPI 3 / Swagger 2 spec, browse endpoints with auto-generated forms, send requests with variables and auth, and run Schemathesis-style negative fuzzing.',
    tags: ['API', 'OpenAPI', 'Swagger', 'REST', 'Fuzzing', 'Postman', 'Hoppscotch', 'Schema'],
    readTime: '6 min read',
    content: `
# API Client (OpenAPI)

Spec-driven REST testing, inspired by Hoppscotch, Swagger UI and Schemathesis. Fully client-side; requests go through the configurable proxy.
${CORS_NOTE}
---

### Import a spec
Paste an **OpenAPI 3** or **Swagger 2** spec (JSON, or a common subset of YAML) and click **Load spec**, or enter a spec URL and **Fetch** it (through the proxy if set). The base URL comes from the spec's \`servers\` (OpenAPI 3) or \`host\`/\`basePath\` (Swagger 2) and is editable; a dropdown appears when several servers exist.

### Browse and send
Pick an endpoint from the filterable list (method + path + summary). Parameter inputs are generated from the spec — path, query and header params, with required ones flagged — and the request body is prefilled with an example built from the schema.

- **Variables:** define \`NAME=value\` lines and use \`{{NAME}}\` anywhere (base URL, params, body, auth token).
- **Auth:** Bearer, Basic, or API-key header injection.
- **Send** shows status, timing and body.

### Schema fuzzing
**Fuzz endpoint** generates negative test cases from the operation's schema: omitting each required parameter, wrong-typed values, injection payloads in string parameters, and malformed / empty JSON bodies. Every case is sent and the results are listed; **5xx responses and request errors are highlighted**, because a well-behaved API should reject bad input with a 4xx, not crash with a 5xx.

**Limits:** YAML support is a subset (complex specs are best supplied as JSON); OAuth2 interactive flows are not supported — supply a token via Bearer or a variable.
`,
  },
  {
    id: 'web-security-scanner',
    toolId: 'owasp-zap',
    category: 'webapp',
    title: 'Web Scanner — passive security posture check',
    summary: 'Inspect a target\'s HTTP response for missing security headers, information disclosure, insecure cookies, cleartext transport and permissive CORS, each mapped to a severity and CWE.',
    tags: ['OWASP', 'ZAP', 'Passive scan', 'Security headers', 'CORS', 'Cookies', 'CWE'],
    readTime: '4 min read',
    content: `
# Web Scanner

A real **passive** web security scan. Active scanning of arbitrary origins is impossible from a browser, so this inspects the response the target returns and reports findings with a severity and CWE.
${CORS_NOTE}
---

### What it checks
- **Transport:** cleartext HTTP, missing HSTS (CWE-319).
- **Defense-in-depth:** missing Content-Security-Policy, clickjacking exposure (no X-Frame-Options / frame-ancestors), missing X-Content-Type-Options / Referrer-Policy / Permissions-Policy (CWE-693, 1021).
- **Information disclosure:** Server, X-Powered-By, X-AspNet-Version version banners (CWE-200).
- **CORS:** \`Access-Control-Allow-Origin: *\`, and the high-severity case of \`*\` with credentials (CWE-942).
- **Cookies:** Set-Cookie missing Secure / HttpOnly / SameSite (CWE-614, 1004, 1275).

Findings are ranked High → Info.

### Limits
Reading cross-origin response headers requires CORS, so without a proxy most targets expose only a few headers and the scan is incomplete — a proxy returns the full response. Browsers also strip \`Set-Cookie\` from \`fetch\`, so cookie-flag checks only fire through a proxy. If a WebAssembly engine is later built at \`public/wasm/zap.wasm\`, its active-scan findings merge in; see the WASM Engines doc.
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
    title: 'DNS Toolkit — DoH records, email auth & subdomain brute-force',
    summary: 'Resolve A/AAAA/MX/TXT/NS/CNAME/SOA/CAA records over DNS-over-HTTPS, and brute-force subdomains from a SecLists wordlist.',
    tags: ['DNS', 'DoH', 'Subdomains', 'Recon', 'SecLists'],
    readTime: '3 min read',
    content: `
# DNS Enumerator

Query DNS over **DNS-over-HTTPS** (Google's resolver). DoH is CORS-enabled, so this works directly from the browser; a proxy is still honored.

---

### Records
Enter a domain, tick the record types you want (A, AAAA, MX, TXT, NS, CNAME, SOA, CAA) and **Resolve**. Answers are listed with name, data and TTL.

### Subdomain brute-force
Load a **subdomain wordlist** (SecLists, via the picker), enter a domain and **Brute subdomains**. Each \`word.domain\` is resolved over DoH with bounded concurrency; subdomains that resolve are listed with their A records. A stop button cancels the run.

### Limits
True AXFR zone transfers need a TCP connection to the authoritative server and cannot be done from a browser. Wordlists load from the SecLists jsDelivr CDN.
`,
  },
  {
    id: 'certificate-inspector',
    toolId: 'cert-inspect',
    category: 'webapp',
    title: 'Certificate Inspector — X.509 PEM/DER viewer',
    summary: 'Parse an X.509 certificate (PEM or DER) and show subject, issuer, validity, serial, algorithms, SANs and fingerprints — entirely client-side.',
    tags: ['Certificate', 'X.509', 'TLS', 'SSL', 'PEM', 'DER', 'Fingerprint'],
    readTime: '3 min read',
    content: `
# Certificate Inspector

Parse and display the fields of an X.509 certificate. The file never leaves the browser.

---

### Usage
Load a certificate file (\`.pem\`, \`.crt\`, \`.cer\` or \`.der\`); PEM and DER are detected automatically. The tool shows:

- **Subject** and **Issuer** distinguished names.
- **Validity** window, with an EXPIRED / NOT YET VALID status.
- **Version**, **serial**, **signature algorithm**, **public-key algorithm**.
- **subjectAltName** entries (DNS / IP / email).
- **SHA-256** and **SHA-1** fingerprints and the DER size.

### Notes
Parsing is a dependency-free DER/ASN.1 reader targeting the RFC 5280 structure, verified against OpenSSL-generated certificates. It reads fields only; it does not validate chains or signatures.
`,
  },
  {
    id: 'pwned-passwords',
    toolId: 'pwned-passwords',
    category: 'webapp',
    title: 'Pwned Passwords — HaveIBeenPwned k-anonymity check',
    summary: 'Check passwords against the HaveIBeenPwned breach corpus without sending the password: only the first 5 characters of its SHA-1 hash leave the browser.',
    tags: ['Pwned', 'HIBP', 'Breach', 'Password', 'k-anonymity'],
    readTime: '3 min read',
    content: `
# Pwned Passwords Checker

Check passwords against the **HaveIBeenPwned** breach database using the k-anonymity range API.

---

### How the privacy model works
Each password is SHA-1 hashed **in the browser**. Only the first 5 hex characters of the hash (the prefix) are sent to the API, which returns every hash suffix sharing that prefix; the match is found locally. The password and its full hash never leave your browser. The \`Add-Padding\` header is sent so the response size does not reveal how many matches the prefix had.

### Usage
Paste one password per line and **Check Passwords**. Each row shows the breach count: a non-zero count (red) means the password appears in known breaches and should never be used; green means not found. The HIBP API is CORS-enabled, so this works directly; a proxy is honored.
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
    title: 'PCAP Viewer — parse & filter packet captures',
    summary: 'Upload a classic libpcap (.pcap) file and decode Ethernet/IPv4/IPv6/TCP/UDP/ICMP into a filterable packet list, entirely client-side.',
    tags: ['PCAP', 'tcpdump', 'Packets', 'Ethernet', 'TCP', 'Wireshark'],
    readTime: '3 min read',
    content: `
# PCAP Viewer

Parse and browse a packet capture. The file never leaves the browser.

---

### Usage
Upload a classic **libpcap** file (\`.pcap\` / \`.cap\`). The tool shows the link type and packet count, then a table of packets — index, time, source and destination (with ports), protocol, info and length. A filter box narrows by protocol, port or address.

### What it decodes
The parser reads the pcap global header (both byte orders and the nanosecond magic variants) and per-packet records, then decodes Ethernet II, Raw IP and BSD loopback link types, IPv4/IPv6, and TCP/UDP/ICMP/ICMPv6, including TCP flags. Up to 5000 packets are parsed by default.

### Notes
pcapng (\`.pcapng\`) is detected and reported as unsupported — convert first with \`editcap -F pcap in.pcapng out.pcap\`.
`,
  },
];
