# Audit: Network & Web group

Scope: reliability, correctness, usability, reporting/export, defensive and diagnostic features.
Out of scope (deliberately not proposed): new exploitation, brute-force, evasion, scanning-at-scale.
Method: read each component and its utils, compared against the reference tools, judged against
browser limits (CORS, forbidden headers, no raw sockets) and the available relays
(`worker/index.js` Shodan/HIBP relay; local Docker `backend/cors-proxy`, `dns`, `nmap`, `tls-inspector`).
Audit only; no code was changed.

Legend: Effort S/M/L, Value H/M/L. "Feasible" means feasible in the browser, optionally with the
existing Worker or local Docker backend.

## Cross-cutting findings

- The Worker relay allows only Shodan and HIBP. Every other third-party fetch tool (crt.sh,
  urlscan, HackerTarget, Web Analyzer, API client) needs the user to run the local Docker
  cors-proxy. Out of the box on `usb-tool.olosnoks.com` they fail with the generic "CORS or
  unreachable" message.
- `Set-Cookie` is a forbidden response-header name. `fetch()` never exposes it, even through a
  proxy that sends `Access-Control-Expose-Headers: *`. The UI text "unless a proxy forwards it"
  (`WebAnalyzerWorkbench.jsx`, `webScan.js`, `cookies.js`) is wrong for the bundled proxy, so cookie
  analysis never has data. The proxy would have to rename the header.
- `size` is computed as `text.length` (UTF-16 units) in `BurpProxyWorkbench`/`ApiClientWorkbench`/
  `WebAnalyzer` but labelled "bytes". Bodies are always decoded as text, so binary responses are corrupted.
- Exports are inconsistent: Web Analyzer and DNS Toolkit export Markdown only; crt.sh exports a bare
  host list; HTTP Workbench exports nothing; nothing offers JSON/CSV/HAR.

## Bugs found (summary)

| # | Where | Bug | Severity |
|---|---|---|---|
| B1 | `PacketAnalyzerWorkbench.jsx` | The whole tool is five hardcoded `SAMPLE_FRAMES`. `useSerial().hexByteStream` is read but never ingested, `isSniffing` is never used, several imports are dead, yet the status badge reads "LIVE MONITORING" when a serial port is merely connected and the lab tab is titled "Wi-Fi & PCAP Analyzer". It cannot open a pcap. "Export Capture" exports the demo samples as JSON. Misleading. | High |
| B2 | `DnsToolkitWorkbench.jsx` + `mailDns.js` | `interpretDnsbl` treats any `127.*` answer as "listed". Spamhaus ZEN answers `127.255.255.252/254/255` to queries from public resolvers (dns.google), meaning "query refused", so the tool can report a false "listed on zen.spamhaus.org". Also `dnsbl.sorbs.net` was shut down and is a dead zone. | High |
| B3 | `DnsToolkitWorkbench.jsx` `doh()` | Ignores `resp.ok` and the DoH `Status` code (SERVFAIL/REFUSED look like "no records"). `Promise.all` over 8 types: one failed type aborts the entire lookup. | Medium |
| B4 | `mailDns.js` `parseSpf` | The "lookups" count is the number of mechanisms in the top-level record only; `include:`/`redirect=` targets are never expanded, so the 10-lookup warning under-reports (the main real-world SPF failure). `parseDmarc` splits on `=` and drops everything after a second `=`. | Medium |
| B5 | `ipcalc.js` `computeCidr` | `"10.0.0.1/"` gives `Number('') = 0`, so it silently computes `/0`. `isPrivateV4` omits 100.64/10, 192.0.0.0/24, TEST-NETs, multicast, 240/4; IPv6 has no classification at all. Leading-zero octets (`010.1.1.1`) accepted. | Medium |
| B6 | `httpImport.js` `toCurl` | Quotes with `JSON.stringify`, which leaves `$`, backticks and `!` live inside double quotes. A copied command with `$(...)` in a header/body executes locally when pasted. Should use single-quote escaping. | Medium |
| B7 | `ApiClientWorkbench.jsx` | `paramValues` keyed by `p.name` only: a path param and a query param of the same name share one value. Relative `servers[].url` (e.g. `/v1`) is used as-is so requests go to this site. Response headers are fetched but not displayed. | Medium |
| B8 | `pcap.js` | Silent 5000-packet cap (the header still says "N packets"); `fmtIPv6` regex mangles addresses with leading zero groups (`0:0:0:0:0:0:0:1` gives `0::1`); 802.1Q (0x8100), Linux cooked (113), radiotap (127), IPv6 extension headers are not decoded; pcapng (Wireshark's default) is rejected. No tests cover this file. | Medium |
| B9 | `WebAnalyzerWorkbench.jsx` | Header comment says "one Analyze does a single fetch" but `runPassiveScan(target)` performs a second fetch. Security headers are presence-only (an `unsafe-inline` CSP or `max-age=0` HSTS counts as present/green). Fingerprint false positives: Bootstrap matches generic `container`/`row`/`col-md` classes, Laravel matches any `XSRF-TOKEN` cookie, AWS matches `x-amz-*`/"aws" substrings. | Medium |
| B10 | `HydraBruteforceWorkbench.jsx` | When every request errors (CORS/network) the result says "No credentials succeeded" instead of "all N requests failed"; only the first error is logged; no 429/lockout detection. | Low |
| B11 | `NmapScannerWorkbench.jsx` | Without the Docker backend it is an HTTP-fetch timing heuristic (open-but-non-HTTP ports look filtered); the helper text is honest but the tool name is not. Backend scans cannot be cancelled (Stop sets a flag the backend path never reads); exports omit the scan method. | Low |
| B12 | `OsintClientsWorkbench.jsx` | urlscan and HackerTarget tabs do not check `resp.ok`/429; HackerTarget returns errors as plain text with HTTP 200 and they are shown as results. | Low |
| B13 | `CrtShFinderWorkbench.jsx` | `.txt` export filename uses the raw input (may contain `https://`, `/`); no retry handling for crt.sh's frequent 502/timeouts beyond a message. | Low |

---

## 1. http-workbench (Request Toolkit + OpenAPI client)

Files: `HttpWorkbench.jsx` (shell + shared proxy bar), `BurpProxyWorkbench.jsx` (Repeater, Intruder,
Comparer, Decoder), `ApiClientWorkbench.jsx`, `utils/{netClient,httpImport,intruder,openapi,diff,codec}.js`.

### Does today
- Repeater: method/URL/headers/body editor, 25-entry in-memory history, Send, Copy-as-curl, import from
  curl or raw HTTP, response in pretty/raw/hex/render (sandboxed iframe) views, in-response search,
  "send to Comparer".
- Intruder with marker positions and four attack modes, grep-match, sortable results (payload-driven
  fuzzing; not extended here).
- Comparer (line diff), Decoder (Base64/URL/Hex/HTML, JWT, MD5/SHA, smart decode).
- API Client: import OpenAPI 3/Swagger 2 (JSON/YAML) by paste or URL, endpoint filter, params,
  example body, `{{var}}` substitution, none/bearer/basic/api-key auth, Send, and "Fuzz endpoint"
  (schema-based negative cases, 5xx highlighted).
- All via `proxiedFetch`; one global proxy bar.

### Reference tools
Postman, Insomnia, HTTPie/Hoppscotch (collections, environments, tests, code generation, HAR import/
export, cookie jar, timing breakdown, binary and streaming responses, cancel), Schemathesis.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Correct size in bytes and binary-safe bodies (arrayBuffer, hex/preview, "save as file") | Yes, pure fetch | S | H |
| Cancel / timeout (AbortController) on Repeater, API client, fuzz | Yes | S | H |
| Fix `toCurl` shell quoting (B6); code generation for fetch/Python/PowerShell | Yes | S | H |
| Export history as HAR / JSON; import HAR | Yes, pure JS | M | H |
| API client: show response headers, copy-as-curl, param key collision (B7), resolve relative servers, export fuzz results CSV | Yes | M | H |
| Environments / variables in Repeater (conflicts with Intruder `{{marker}}` syntax; needs a different delimiter) | Yes | M | M |
| Persist history/collections in localStorage/IndexedDB | Yes | M | M |
| Cookie jar, redirect-chain inspection, per-phase timings | No in-browser: forbidden headers, redirects opaque, no cross-origin Resource Timing without `Timing-Allow-Origin`. Only via the Docker proxy | L | M |
| Response assertions (declarative status/body/header checks, no `eval`) | Yes | M | M |
| WebSocket / SSE client | Partly: browser WebSocket works for `ws(s)://` without proxy; no custom headers | M | L |
| Custom Host/Origin headers, HTTP/2 specifics, gRPC | No: forbidden request headers in browsers | - | - |

---

## 2. web-analyzer

Files: `WebAnalyzerWorkbench.jsx`, `webanalyzer/*`, `NiktoScannerWorkbench.jsx` (Path Prober),
`utils/{urlinspect,fingerprint,cookies,webScan}.js`.

### Does today
One page fetch, then: status/timing/final URL, six security-header present/absent chips, ~45-rule
technology fingerprint (headers, HTML, script URLs, cookie names, meta generator), Set-Cookie flag
analysis (effectively empty, see cross-cutting), a passive header scan with severity+CWE (HSTS, CSP,
framing, nosniff, referrer, server/X-Powered-By disclosure, CORS `*`, insecure cookies), link/script/
style/image extraction, forms, raw headers/meta; on-demand Path Prober and Crawler; one Markdown export.

### Reference tools
Mozilla Observatory and securityheaders.com (graded A-F with per-header value checks, redirect and
HTTPS behaviour, CSP evaluator), Wappalyzer (large signature base with versions/confidence), SSL Labs
(TLS), Lighthouse best-practices.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Single fetch: feed the first response into the passive scan (B9) | Yes | S | H |
| Value-aware header grading + overall letter score: CSP (`unsafe-inline`, `unsafe-eval`, wildcard/`data:` sources, missing `object-src`/`base-uri`/`frame-ancestors`), HSTS (`max-age`, `includeSubDomains`, `preload`), XFO values, Referrer-Policy values, COOP/COEP/CORP, Cache-Control on sensitive pages, mixed content in HTML | Yes, pure parsing | M | H |
| Real Set-Cookie analysis (proxy must rename to `x-proxy-set-cookie`) | Yes with the Docker proxy; No direct | S | H |
| Fingerprint false-positive fixes, version extraction, confidence | Yes | M | M |
| `security.txt`, `robots.txt`, `sitemap.xml`, `/.well-known/*` presence checks (single GETs, passive) | Yes with CORS/proxy | S | M |
| HTTP to HTTPS redirect, redirect chain, HSTS preload status | Partly: needs the proxy to report the chain; `redirect:'manual'` is opaque in browsers | M | M |
| TLS protocol/cipher/cert grade | Via `backend/tls-inspector` (already used by Certificate Inspector), not in a browser alone | M | M |
| SRI check on external scripts, third-party domain list | Yes (HTML parse) | S | M |
| JSON / SARIF export, diff against a previous run | Yes | M | M |
| Server-side fetch relay in the Worker so the tool works without Docker | Partly: an open fetch relay is an SSRF/abuse risk; if ever built it must be GET-only, public-IP-only, rate limited. Not recommended without auth | L | M |

---

## 3. dns-toolkit

Files: `DnsToolkitWorkbench.jsx`, `utils/mailDns.js`; `backend/dns/server.cjs` (exists, not called by the tool).

### Does today
One lookup via `dns.google` DoH: A/AAAA/CNAME/MX/NS/SOA/CAA/TXT, SPF/DMARC/DKIM (one selector),
MX to IP resolution (first 5 hosts), DNSBL check on 4 zones, TXT classification, Markdown export,
plus a subdomain wordlist brute-force section (not extended here).
`ProxyConfig backend="dns"` offers a local DNS backend but the code never calls `dnsResolve`.

### Reference tools
`dig`, DNSViz (DNSSEC chain), MXToolbox (SPF/DKIM/DMARC/MTA-STS/blacklist), Google Admin Toolbox dig,
dnschecker.org (multi-resolver propagation).

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Fix DNSBL false positives and dead zone (B2); show "inconclusive: resolver refused" | Yes | S | H |
| Check DoH `Status`, `Promise.allSettled`, per-type error display (B3) | Yes | S | H |
| Recursive SPF evaluation: expand `include`/`redirect`, count real DNS lookups and void lookups, flag `ptr`, over-long records (B4) | Yes (more DoH calls, bounded depth) | M | H |
| MTA-STS (`_mta-sts` TXT + policy file), TLS-RPT, BIMI, DANE/TLSA, multiple DKIM selectors | Yes: TXT via DoH; policy file needs CORS/proxy | M | H |
| DNSSEC status (`AD` flag, DS/DNSKEY presence) | Yes: dns.google returns `AD`; full chain validation no | S | M |
| Multi-resolver comparison (dns.google, Cloudflare, Quad9 DoH endpoints with CORS): spot split-horizon/stale answers | Yes | M | M |
| PTR for A/MX IPs, SOA serial consistency across authoritative NS | PTR yes; per-NS queries need the Docker `dns` backend | M | M |
| Wire `backend/dns` for custom server / non-DoH queries | Yes with Docker | M | L |
| JSON export, copy dig-style output | Yes | S | M |
| Zone transfer (AXFR) | No: TCP | - | - |

---

## 4. crtsh-finder

Files: `CrtShFinderWorkbench.jsx`, `utils/crtsh.js`.

### Does today
Queries `https://crt.sh/?q=%.<domain>&output=json` via the proxy (crt.sh sends no CORS), extracts a
sorted de-duplicated host list with wildcard marker, text filter, `.txt` export.

### Reference tools
crt.sh web UI (cert id, logged-at, not-before/after, issuer, SANs, `exclude=expired`,
`deduplicate=Y`), certspotter / Facebook CT monitor.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Works out of the box: narrow `/api/crtsh` read-only Worker route (fixed upstream, strict query allowlist), tried first like Shodan | Yes | S | H |
| Keep cert metadata: issuer, not_before, not_after, logged-at, serial, cert id; expired/expiring-soon badges; issuer summary (spot unexpected CAs, a defensive CT-monitoring use) | Yes (fields already in the JSON) | M | H |
| Table + CSV/JSON export with wildcard and expiry columns, correct filename | Yes | S | M |
| Retry/backoff and clear 502/429/timeout messaging; `exclude=expired`, `deduplicate=Y` toggles | Yes | S | M |
| Compare CAs seen in CT with the domain's CAA record | Yes, reuses DoH | M | M |
| "Resolves now?" liveness column | Partly: DoH lookups per host, capped and user-triggered; do not scale | M | L |
| Alternative CT sources (certspotter) | Partly: needs key/CORS check | M | L |

---

## 5. osint-clients (Shodan relay, urlscan, HackerTarget)

Files: `OsintClientsWorkbench.jsx`, `osint/ShodanClient.jsx`, `osint/apiKeys.jsx`, `utils/shodan.js`,
`worker/index.js`.

### Does today
Shodan client (mature): query builder with ~100 filters, facets, presets, count-only, host (history,
honeypot score), DNS (domain/resolve/reverse), exploits, account/credits; CSV and JSON export, key
redaction in logs, relay auto/manual transport. The Worker relay is GET-only, upstream-pinned, rejects
cross-site fetch metadata, forwards no cookies, and observability is disabled so keys in the query string are
not logged. urlscan search and HackerTarget wrappers show raw results.

### Reference tools
Shodan web UI/CLI and Monitor, Censys, urlscan.io web UI (verdicts, screenshots, requests).

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Fix urlscan/HackerTarget error handling (B12); label HackerTarget "needs proxy" or relay it | Yes | S | M |
| Keyless Shodan InternetDB (`internetdb.shodan.io/<ip>`: ports, CPEs, vulns, tags) for a quick own-IP exposure check | Yes (verify CORS; else a second Worker route) | S | M |
| "My exposure" workflow: saved queries/targets (own `net:`/`hostname:` only), snapshot locally and diff against last run, flag new ports/CVEs | Yes (localStorage + existing endpoints) | M | M |
| urlscan result detail (verdict, screenshot URL, contacted domains); submitting scans | Partly: submit is POST + key; relay is intentionally GET-only | M | L |
| Shodan alerts / on-demand scan submit | No: POST, outside the read-only relay design | - | - |
| Multi-page export with credit warning | Yes but consumes query credits | S | L |

No ticket: the Shodan client is the most complete tool in the group; gaps are incremental.

---

## 6. ip-calculator

Files: `IpCalculatorWorkbench.jsx`, `utils/ipcalc.js` (tests in `tests/browserTools.test.js`).

### Does today
IPv4/IPv6 CIDR report: network, broadcast, netmask, wildcard, first/last host, total/usable counts,
private flag (v4 only), copy per row, example chips.

### Reference tools
`ipcalc`, sipcalc, subnet-calculator.com, Python `ipaddress`.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Fix empty prefix, leading-zero octets, richer classification (loopback, link-local, CGNAT, documentation, multicast, reserved; IPv6 ULA/link-local/documentation/mapped) (B5) | Yes | S | H |
| Binary view with network bits highlighted; netmask/wildcard as prefix input | Yes | S | M |
| Subnet splitter, VLSM by host requirements | Yes | M | H |
| Supernet/aggregate a CIDR list, range-to-CIDR, contains/overlap check (firewall rule review) | Yes (`v4Contains` exists) | M | H |
| Reverse DNS names (`in-addr.arpa`, `ip6.arpa`), IPv6 expanded/compressed forms | Yes | S | M |
| Copy-all / Markdown+JSON export, shareable URL hash | Yes | S | L |

---

## 7. packet-analyzer (Packet & Protocol Lab)

Files: `ProtocolPacketLab.jsx` (tabs), `PacketAnalyzerWorkbench.jsx`, `KismetStudioWorkbench.jsx`,
`common/HexViewer`, `PacketFramer`, `utils/{pcapReader,layer3Parser,pcapExporter,livePcapWriter}.js`.

### Does today
The default "Wi-Fi & PCAP Analyzer" tab shows five static hardcoded frames with a text filter and a
type filter; Export dumps those samples as JSON (B1). The other tabs are real: Kismet Studio, hex stream
viewer, SLIP/COBS framer. Real parsing code exists and is tested elsewhere (`pcapReader.js` for radiotap
pcap, `layer3Parser.js` for ARP/DHCP) but is used only by the Alfa Wi-Fi workbench.

### Reference tools
Wireshark (dissection tree, display filters, follow stream, statistics), Kismet, Scapy.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Make the default tab real or honest: label samples as demo, open real capture files, ingest the live serial hex stream | Yes (parsers exist) | M | H |
| Frame detail tree (radiotap, 802.11 header fields, beacon IEs: SSID/rates/RSN, EAPOL key info) instead of hex only | Yes | M | H |
| Display-filter syntax (`wlan.ssid == "x"`, `eapol`) | Yes (small expression parser) | M | M |
| Export real captured frames as .pcap (`pcapExporter.js` exists) and CSV | Yes | S | M |
| Per-BSSID/client summary (beacons, probe requests, handshake completeness) as defensive WLAN audit | Yes | M | M |
| Live monitor-mode capture | No: browsers cannot capture; needs the hardware tools in other tabs | - | - |

---

## 8. tcpdump-viewer (pcap viewer)

Files: `TcpdumpViewerWorkbench.jsx`, `utils/pcap.js` (note: a second, unrelated `parsePcap` exists in
`utils/pcapReader.js`; no tests cover `utils/pcap.js`).

### Does today
Loads classic .pcap (LE/BE, micro/nano), decodes Ethernet/IPv4/IPv6/TCP/UDP/ICMP/ARP to a table
(#, UTC time-of-day, src, dst, proto, flags/info, length) with one substring filter; first 5000 packets.

### Reference tools
Wireshark file view / tshark, `tcpdump -r`, NetworkMiner, Zeek.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| pcapng reader (SHB/IDB/EPB), more linktypes (802.1Q, SLL 113, radiotap 127) (B8) | Yes | M | H |
| Remove silent 5000 cap: virtualised/paged table with explicit "truncated" banner | Yes | M | H |
| Packet detail pane with layered field tree and hex dump | Yes | M | H |
| Application-layer one-liners: DNS names, HTTP request line/Host, TLS ClientHello SNI/version, DHCP | Yes (pure parsing) | M | H |
| Conversations/endpoints, protocol hierarchy, top talkers; TCP anomaly counts (RST/retransmit/zero-window) as diagnostics | Yes | M | H |
| Relative/delta time, BPF-like filter (`tcp port 443 and host 1.2.3.4`) | Yes | M | M |
| Export filtered subset as .pcap / CSV | Yes | S | M |
| TLS decryption, TCP stream reassembly | Plaintext follow-stream yes (L); decryption needs keylog, out of scope | L | M |

---

## 9. nmap-scanner and hydra-bruteforce (bugs/usability only)

- nmap-scanner: see B11. Usability: show the scan method (heuristic vs real nmap) in the title and exports;
  make the Docker path cancellable; include nmap version strings in md/txt exports (they are in the table);
  keep the HTTPS-page mixed-content warning.
- hydra-bruteforce: see B10. Usability: show "N/M tried, K errors", detect HTTP 429/lockout and pause,
  and require an explicit "I am authorised to test this target" checkbox before Start (the backend already
  requires `I_HAVE_AUTHORIZATION=yes`). No new capability is proposed.

---

# Implementation tickets

Seven self-contained tickets with disjoint file sets. NET-1 imports `utils/pcapReader.js`,
`layer3Parser.js`, `pcapExporter.js` read-only and does not depend on NET-2.

## NET-1: Make the Packet Analyzer real and honest
Value H, effort M. Fixes B1.
Files: `src/components/tools/PacketAnalyzerWorkbench.jsx`, new `src/utils/packetFrames.js`,
new `tests/packetFrames.test.js`.

Work:
- Start with an empty capture. Move the samples behind a labelled "Load demo frames" button and show a
  "DEMO DATA" badge whenever sample frames are loaded.
- "Open capture" accepts .pcap (radiotap/802.11 via `readPcapFile`, reuse `extractLayer3Metadata` for ARP/DHCP);
  `packetFrames.js` holds `recordToFrame`, `classifyFrame`, `frameToCsvRow`.
- Ingest `hexByteStream` only when the user enables "Follow serial stream"; badge shows LIVE only while enabled
  and bytes are arriving, else IDLE.
- Remove dead state/imports (`isSniffing`, unused icons). Export produces a real .pcap (via `pcapExporter`) and a
  CSV of the loaded frames, not the samples.
- Frame detail shows decoded 802.11 fields (type/subtype, addr1-3, SSID, channel when present) above the hex.

Acceptance criteria:
1. Fresh open shows 0 frames and no "LIVE MONITORING" text; demo requires a click and is badged.
2. A known radiotap .pcap fixture lists N frames with correct subtype/SSID/BSSID; a non-pcap file shows an error, not a crash.
3. Exported .pcap re-parses with the same frame count; CSV has one row per loaded frame.
4. With no serial port connected the status is never LIVE.

Test plan: unit tests for `recordToFrame`/`classifyFrame` using a synthesised radiotap beacon and EAPOL frame built in
the test; export-then-parse round trip; a new render test (do not edit `componentsRender.test.jsx`) asserting the
empty state and absence of the LIVE text.

## NET-2: PCAP viewer: pcapng, more link types, truncation notice, summaries
Value H, effort M. Fixes B8.
Files: `src/utils/pcap.js`, `src/components/tools/TcpdumpViewerWorkbench.jsx`, new `tests/pcapViewer.test.js`.

Work:
- `pcap.js`: parse pcapng (SHB, IDB with if_tsresol, EPB, SPB) into the existing record shape; add linktypes 113 (SLL),
  127 (radiotap: label, decode IP when present), 802.1Q VLAN, IPv6 extension-header walk, IPv4 fragment flag; fix
  `fmtIPv6` canonical compression; return `{ truncated, totalPackets }` instead of silently stopping at 5000
  (raise the cap and virtualise or page the table).
- App-layer one-liners: DNS (qname/type/rcode), HTTP request/status line, TLS ClientHello SNI+version, DHCP/ARP.
- Viewer: truncated banner, packet detail pane (layer tree + hex), conversations table (pair, packets, bytes,
  duration), protocol hierarchy counts, relative-time column, filter supporting `tcp`, `udp`, `port N`, `host X`,
  `dns` plus the current substring; export filtered rows to CSV and filtered pcap (via `pcapExporter`).

Acceptance criteria:
1. A pcapng capture (LE, one IDB) opens and shows the same packets as its classic conversion.
2. A 20k-packet file shows all packets or an explicit "showing first N of M" banner; header count equals parsed count.
3. `::1`, `fe80::1`, `2001:db8::1:0:0:1` render canonically.
4. A DNS query packet shows `A example.com` in Info; a TLS ClientHello shows its SNI.
5. Conversation totals match the packet list.

Test plan: build fixtures in-test as byte arrays (pcap, pcapng, Ethernet/VLAN/SLL frames with DNS and TLS payloads);
unit tests per decoder, IPv6 formatter, filter parser, conversation aggregation; truncated/garbage input must give a
clear error or partial decode without exceptions.

## NET-3: DNS Toolkit correctness and mail/DNS posture
Value H, effort M. Fixes B2, B3, B4.
Files: `src/components/tools/DnsToolkitWorkbench.jsx`, `src/utils/mailDns.js`, new `src/utils/dnsDoh.js`,
new `tests/dnsToolkit.test.js`. (`tests/webTools.test.js` asserts the old `interpretDnsbl` behaviour; update only
those assertions.)

Work:
- `dnsDoh.js`: `doh(name, type, {resolver})` returning `{status, ad, answers}`; check `resp.ok`; map Status 0/2/3/5;
  resolvers dns.google / cloudflare-dns.com / dns.quad9.net.
- Use `Promise.allSettled`; show per-type error chips instead of aborting the lookup.
- `interpretDnsbl`: treat `127.255.255.252/254/255` as `{listed:false, inconclusive:true}`; show "inconclusive
  (resolver refused)" in UI and Markdown; drop `dnsbl.sorbs.net`.
- `expandSpf(domain, fetchTxt)`: recursive include/redirect expansion (depth <= 10, loop guard), real lookup count,
  void-lookup count, `ptr` warning, TXT length warning; over-limit shown as an error naming the include path.
- Fix `parseDmarc` truncation; display `sp`, `adkim`, `aspf`, `ruf`.
- Add MTA-STS (TXT; policy file via proxy if available, else "needs proxy"), TLS-RPT, BIMI, DNSSEC `AD` flag,
  multi-resolver agreement row, optional multi-selector DKIM (common list). JSON export beside Markdown.

Acceptance criteria:
1. A Spamhaus `127.255.255.254` answer never produces a "listed" finding.
2. `include:` chains totalling 11 lookups produce an over-limit error naming the chain; 10 does not.
3. A SERVFAIL for one record type shows an error chip and the other types still render.
4. DMARC `rua=mailto:a@b.example?x=y` is preserved intact.
5. Markdown and JSON exports contain the new sections.

Test plan: pure-function tests with a stubbed `fetchTxt` map for `expandSpf` (nested includes, loops, redirect, void
lookups); table-driven `interpretDnsbl` and `parseDmarc` tests; `doh` tests with a mocked `fetch` for ok/not-ok/Status.

## NET-4: crt.sh through the Worker, with certificate metadata
Value H, effort M. Fixes B13.
Files: `worker/index.js`, `vite.config.js` (dev-server proxy entry only), `src/utils/crtsh.js`,
`src/components/tools/CrtShFinderWorkbench.jsx`, new `tests/crtshRelay.test.js`.
(Do not add the route to `RELAYS`: `tests/shodanRelay.test.js` asserts `RELAYS` equals `SHODAN_RELAYS`. Use a separate
`CRTSH_BASE` and exported `crtshTarget()`.)

Work:
- Worker: `crtshTarget(pathname, search)` for `/api/crtsh` only; allowed query keys `q` (pattern
  `^%?\.?[A-Za-z0-9.-]{1,253}$`), `output=json`, `exclude=expired`, `deduplicate=Y`; GET/HEAD only; same
  fetch-metadata check, 25 s timeout, no-store; list it in `/api/health`.
- `crtsh.js`: `extractCerts(rows, base)` returning per-host `{host, wildcard, issuer, notBefore, notAfter, loggedAt,
  certId, serial, expired, daysLeft}` (latest cert wins) and `issuerSummary(rows)`; keep `extractSubdomains`
  unchanged for existing tests.
- Workbench: try `/api/crtsh` first (same fall-through logic as `shodanFetch`), then the proxy; table with
  issuer/expiry columns, expired and expiring-in-30-days badges, issuer summary, toggles for exclude-expired and
  dedupe, retry with backoff on 502/timeout, CSV and JSON export, safe filename.

Acceptance criteria:
1. On a deployment without Docker, a lookup of a public domain returns hosts with no proxy configured.
2. `/api/crtsh?q=%25.example.com&output=json` maps to the crt.sh URL; any other path/param, a non-GET method or an
   invalid `q` is rejected (404/400/405).
3. The table shows issuer and not-after; an expired cert is badged; exports contain those columns.
4. Existing `extractSubdomains`/`crtShUrl` tests still pass.

Test plan: Worker tests with injected `fetchImpl` (pattern of `shodanRelay.test.js`) for route mapping, rejection cases
and header pass-through; `extractCerts` tests with fixture rows (multi-SAN, expired); CSV generation test.

## NET-5: Web Analyzer: single fetch, value-aware grading, honest cookies
Value H, effort M. Fixes B9 and the Set-Cookie cross-cutting issue.
Files: `src/components/tools/WebAnalyzerWorkbench.jsx`, `src/utils/urlinspect.js`, `src/utils/webScan.js`,
`src/utils/fingerprint.js`, `backend/cors-proxy/server.cjs`, `src/utils/netClient.js` (add helpers only),
new `tests/webAnalyzerGrade.test.js`.

Work:
- `webScan.js`: pure `scanHeaders(url, headers)` taking already-fetched headers; `runPassiveScan` stays as a thin
  wrapper for other callers. The workbench uses `scanHeaders` on the first response (no second fetch).
- `urlinspect.js`: `gradeSecurityHeaders(headers, html)` returning per-header `{status: good|warn|bad|absent, reason}`
  and an overall A-F (CSP weakness patterns, HSTS values, XFO, Referrer-Policy, COOP/COEP/CORP, SRI missing on
  external scripts, mixed content). Keep `assessSecurityHeaders` exported.
- `fingerprint.js`: tighten Bootstrap (require an asset URL), Laravel (require `laravel_session`), AWS (specific headers);
  capture versions where present.
- Proxy: in `server.cjs` copy upstream `set-cookie` into `x-proxy-set-cookie` (JSON array) and report the redirect
  chain (`x-proxy-redirects`, manual follow loop capped at 10). `netClient.js`: `getSetCookie(resp)` and
  `getRedirectChain(resp)` returning `null` when the proxy header is absent.
- Workbench: use the helpers; when cookies are unavailable say "Set-Cookie is hidden by browsers; run the bundled
  proxy to see cookie flags" (replace the misleading note); grade badge, per-header reasons, redirect-chain row,
  JSON export beside Markdown.

Acceptance criteria:
1. Analyze issues exactly one request to the target (fetch mock assertion).
2. `Content-Security-Policy: script-src 'unsafe-inline' *` grades bad; `Strict-Transport-Security: max-age=0` grades
   bad; a strong header set grades A.
3. Generic `container`/`row` classes without a Bootstrap asset no longer report Bootstrap; a lone `XSRF-TOKEN`
   cookie no longer reports Laravel.
4. Through the updated proxy cookie flags appear; without it the new note shows.
5. Markdown export includes grade, reasons and the redirect chain.

Test plan: table-driven grading tests; fingerprint regression tests for the three false positives; helper tests with a
fabricated `Response`; proxy test starting `server.cjs` against a local `node:http` server asserting
`x-proxy-set-cookie` and chain headers.

## NET-6: IP Calculator: correctness, classification, subnet tools
Value H, effort M. Fixes B5.
Files: `src/utils/ipcalc.js`, `src/components/tools/IpCalculatorWorkbench.jsx`, new `tests/ipcalcTools.test.js`.
(Existing `tests/browserTools.test.js` imports must keep working; do not edit it.)

Work:
- `computeCidr`: reject empty/non-numeric prefix, leading-zero octets, inner whitespace; accept a dotted netmask or
  wildcard as the prefix part.
- `classifyAddress(ip)`: v4 (loopback, private, link-local, CGNAT, documentation, benchmarking, multicast, reserved,
  broadcast) and v6 (loopback, unspecified, ULA, link-local, documentation, multicast, IPv4-mapped); show the label in
  the UI and keep `isPrivate` on the report.
- Pure helpers: `splitCidr(cidr, newPrefix, limit)`, `vlsm(parent, hostCounts[])`, `aggregate(cidrs[])`,
  `rangeToCidrs(a, b)`, `overlaps(a, b)`, `reverseName(ip)`.
- UI: binary view with network bits highlighted; tabs for Split / VLSM / Aggregate / Contains-overlap; copy-all and
  Markdown export.

Acceptance criteria:
1. `10.0.0.1/` throws "Invalid prefix"; `010.0.0.1` is rejected.
2. `100.64.1.1` is CGNAT; `fd00::1` ULA; `2001:db8::1` documentation.
3. `splitCidr('10.0.0.0/24', 26)` returns 4 correct networks and refuses outputs above the limit;
   `aggregate(['10.0.0.0/25','10.0.0.128/25'])` returns `10.0.0.0/24`; `rangeToCidrs('10.0.0.1','10.0.0.6')` returns
   the minimal list.
4. VLSM for hosts [100, 50, 10] fits in a /24 with no overlaps, largest first.

Test plan: table-driven unit tests for each helper including BigInt IPv6 cases and boundary prefixes (/0, /31, /32,
/127, /128); a render test for the new tabs.

## NET-7: HTTP Workbench: bytes, binary, cancel, HAR, curl quoting, API client fixes
Value H, effort M. Fixes B6, B7 and the size/binary cross-cutting item.
Files: `src/components/tools/BurpProxyWorkbench.jsx`, `src/components/tools/ApiClientWorkbench.jsx`,
`src/utils/httpImport.js`, `src/utils/openapi.js`, new `src/utils/httpHar.js`, new `tests/httpWorkbench.test.js`.
(`HttpWorkbench.jsx` is unchanged.)

Work:
- Shared send path: use `arrayBuffer()`; compute true byte size; decide text vs binary (content-type / UTF-8 validity);
  binary shows a hex view plus "Save response"; add `AbortController` with a Cancel button and configurable timeout
  (default 30 s) in Repeater, API client and the fuzz loop.
- `toCurl`: POSIX single-quote escaping (`'` becomes `'\''`); "Copy as" menu for fetch, PowerShell
  `Invoke-WebRequest`, Python `requests`.
- `httpHar.js`: `historyToHar(entries)` and `harToRequests(har)`; Repeater history export/import as HAR; persist history
  (cap 100) in localStorage with a Clear button.
- API client: key parameters by `${in}:${name}`; resolve relative `servers[].url` against the spec URL (or warn and
  require an absolute base); show response headers and copy-as-curl; export fuzz results as CSV; confirm "this sends N
  requests to the base URL" before fuzzing; honour non-JSON request body content types from the spec
  (`application/x-www-form-urlencoded`).

Acceptance criteria:
1. A response containing "héllo" reports 6 bytes (not 5); a PNG response shows a hex view and a downloadable file with
   identical bytes.
2. Cancel aborts an in-flight request and a running fuzz promptly; the UI returns to idle.
3. `toCurl` output for body `$(touch x)` and `it's` is inert and round-trips through `parseCurl`.
4. HAR export then import restores method/URL/headers/body of each entry.
5. A spec with `/items/{id}` and a query param `id` keeps two independent values; a relative server URL does not send
   requests to this origin.

Test plan: unit tests for byte counting and text/binary detection with `TextEncoder` fixtures; `toCurl`/`parseCurl`
round trip with hostile strings; HAR round trip; `buildRequest` collision test with a minimal spec; abort test with a
fetch mock that honours `signal`.

---

## Priority order
1. NET-1 (a demo presented as the default analyzer tab) and NET-4 (crt.sh unusable without Docker) are the largest
   correctness/usability wins per unit of effort.
2. NET-3 and NET-5 fix incorrect findings (DNSBL false positives, never-working cookie analysis, inflated header
   grades), which matter most for a defensive toolkit.
3. NET-2, NET-6, NET-7 are broad quality and reporting upgrades.
