# Port Scanner

**Purpose**: Discover open TCP ports on a host from the browser. Because a
browser cannot open raw sockets, this is a **connect-timing heuristic over
fetch**, not a SYN scan:
- **open** — an HTTP(S) service answered
- **closed** — connection refused quickly (TCP RST)
- **open|filtered** — the handshake stalled or packets were dropped
- **blocked** — a port Chrome refuses to fetch (ERR_UNSAFE_PORT), so it can't be
  probed from a browser

If `public/wasm/portscanner.wasm` is present, the real WASM engine is used
instead (see docs/WASM_ENGINES.md).

**Ports**:
- **Profiles** (toggle & combine): Top 20, Web, Databases, Remote/Admin, Mail,
  Well-known 1-1024, 1-10000, All 1-65535. Heavy sets are marked ⚠.
- **Custom ports** field (nmap syntax: `1-100,8080,9000`), unioned with the
  selected profiles. A live count warns when the selection is large.

**Flags**:
- **Timing templates** (nmap -T analog): Sneaky / Polite / Normal / Aggressive /
  Insane — tune per-port timeout, the closed-vs-filtered threshold, and default
  concurrency.
- **Concurrency** — parallel probes (1-64).
- **Scheme** — auto (https for 443/8443/9443, else http) or force http/https.
- **show closed/all** — include closed ports in the table.

**Output**: live table (port / state / service / latency) with a running
summary (open · open|filtered · closed · blocked · elapsed ms), and **export to
.txt or .md**.

**Implementation**: `src/utils/portScan.js` (profiles, timing templates,
`buildPortSpec`, `parsePorts`, `scanPort`/`scanHost`), verified in
`tests/portScan.test.js`.

**Notes**: From an HTTPS page only HTTPS targets and localhost are reachable
without a proxy (mixed-content blocks plain HTTP). Scan only hosts you own or
are authorized to test.
