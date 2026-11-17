# WASM Engines

Some security workbenches can use a native engine compiled to WebAssembly, because
the task cannot be done from a browser page alone (no raw TCP sockets, and
cross-origin reads are blocked by CORS).

Engines are loaded from `public/wasm/` at runtime (`src/utils/wasmLoader.js`). Only
`aircrack.wasm` ships today; `portscanner.wasm` and `zap.wasm` are interfaces for
engines that are not built. When a binary is absent the tool falls back to what it can
do in the browser or reports that the engine is missing; it never fabricates results.

The `emsdk/`, `aircrack-js/` and `aircrack-ng/` directories at the repo root are
toolchain/source checkouts (not git submodules; there is no `.gitmodules`), and are
excluded from Vitest. Build engines with `emsdk` and drop the output into
`public/wasm/`.

Not covered here: `sql.js` (DB Browser) loads `public/sql/sql-wasm.wasm`, and the
Realtek capture driver comes from the `@openipc-rs/web` npm package. Both ship with
the app.

## Port scanner — `public/wasm/portscanner.wasm` (optional)

The Port Scanner workbench (`NmapScannerWorkbench.jsx`) works without this engine,
using a connect-timing heuristic over `fetch` (`src/utils/portScan.js`). That approach
cannot reach Chrome-restricted ports (21, 22, 25, …) or non-HTTP services. The
workbench can instead use the local Docker `nmap` service from `backend/` (real
`nmap` scans), or this optional engine; because a browser cannot open raw TCP
connections, the engine must carry its own transport (for example a
WebSocket/WebTransport relay it connects to). The loader checks
`/wasm/portscanner.wasm`; none is built yet.

Exports:

```
memory : WebAssembly.Memory
malloc(size:i32) -> ptr:i32
free(ptr:i32) -> void
scan(targetPtr:i32, targetLen:i32, portsPtr:i32, portsLen:i32) -> resultPtr:i32
```

`scan` returns a pointer to a null-terminated UTF-8 JSON string:

```json
[{ "port": 80, "state": "open", "service": "http" }]
```

## Web scanner — `public/wasm/zap.wasm` (currently unused)

Expected by `OwaspZapWorkbench.jsx` through `src/utils/zapWrapper.js`
(`loadZapEngine()`), but that workbench is no longer routed: the `owasp-zap`,
`nikto-scanner` and `url-inspector` tool ids now open the Web Analyzer, which does its
passive and path checks in plain JavaScript. The interface is kept for reference.
Active scanning of arbitrary origins is blocked by CORS, so such an engine would have
to route HTTP through a transport it controls.

Exports:

```
memory : WebAssembly.Memory
malloc(size:i32) -> ptr:i32
free(ptr:i32) -> void
scan(urlPtr:i32, urlLen:i32) -> resultPtr:i32
```

`scan` returns a pointer to a null-terminated UTF-8 JSON string:

```json
[{ "severity": "High", "cwe": "79", "desc": "Reflected XSS in q parameter" }]
```

Adapter: `src/utils/zapWrapper.js` (`loadZapEngine()`).

## WPA PMKID accelerator — `public/wasm/aircrack.wasm` (optional)

The WPA PMKID Cracker works today in pure Web Crypto (`src/utils/aircrackWrapper.js`),
so no WASM is required. The present `public/wasm/aircrack.wasm` (from the `aircrack-js`
checkout) is an optional SIMD accelerator.

Its real exports are **not** the generic `malloc`/`scan` ABI:

```
memory : WebAssembly.Memory
pbkdf2_pmkid(pass1Len:i32, pass2Len:i32) -> matchLane:i32   // dual-lane SIMD
pbkdf1_eapol(...)
// fixed global buffer pointers written before each call:
SSID_BUF1, SSID_BUF2, PMK_NAME_BUF, EXPECTED_PMKID, password1, password2
```

To wire it as an accelerator, follow `aircrack-js/cpu/wasm-simd.js`: precompute the
ESSID SHA-1 block buffers and the "PMK Name"+MAC buffer, write them into the
exported globals, then call `pbkdf2_pmkid` with two candidate lengths. This is a
future optimization; correctness is already provided by the Web Crypto path.
