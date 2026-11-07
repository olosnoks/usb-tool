# Port Scanner Workbench

**Purpose**: Scan a host for open TCP ports from the browser.

**How it works**: Browsers cannot open raw sockets, so by default this uses a
**connect-timing heuristic** over `fetch` (`src/utils/portScan.js`):

- The fetch resolves (opaque response) → **open** (an HTTP service answered).
- It is refused quickly (TCP RST) → **closed**.
- It stalls until timeout → **open|filtered** (handshake stalled or packets
  dropped; the two are indistinguishable from a page).

If a WebAssembly engine is present at `public/wasm/portscanner.wasm`, it is used
instead for real results. See [docs/WASM_ENGINES.md](../../docs/WASM_ENGINES.md).

**Usage**:
- Optionally set a proxy (empty = direct).
- Enter a target host (e.g. `scanme.nmap.org` or `127.0.0.1`).
- Enter ports as a list and/or ranges (e.g. `80,443,8000-8100`).
- Click **Scan**. Open and browser-blocked ports are listed with timing; the run
  shows progress and can be stopped.

**Implementation Details**:
- `scanHost` probes with bounded concurrency (8 at a time).
- Default ports target web services Chrome permits (80, 443, 8080, 8443, 8000,
  3000, 5000, 5173, 9000).
- `parsePorts` accepts comma lists and `a-b` ranges.

**Honest limitations**:
- **Browser-restricted ports**: Chrome refuses `fetch` to many classic service
  ports (21, 22, 23, 25, 110, 143, 993, 995, …). These are reported as **blocked**,
  not scanned. Use the WASM engine or a proxy for them.
- **Mixed content**: from an HTTPS page, only HTTPS targets and `localhost` can be
  probed; plain-HTTP targets are blocked by the browser.
- **Private Network Access**: Chrome blocks pages from probing `localhost` /
  private IPs, so local scans may all show as closed.
- **Non-HTTP services** on allowed ports look the same as filtered (timeout).
- No service/version banner detection without the WASM engine.
