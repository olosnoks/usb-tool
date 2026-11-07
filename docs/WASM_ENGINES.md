# WASM Engines

Some security workbenches depend on a native engine compiled to WebAssembly,
because the task cannot be done from a browser page alone (no raw TCP sockets, no
WiFi monitor mode, and cross-origin reads are blocked by CORS).

These tools load their engine from `public/wasm/` at runtime. When the binary is
absent the tool shows an honest "engine not available" panel with the expected
interface; it never fabricates results.

Build engines with the `emsdk` submodule and drop the output into `public/wasm/`.

## Port scanner — `public/wasm/portscanner.wasm` (optional)

The Port Scanner workbench works without this engine, using a connect-timing
heuristic over `fetch` (`src/utils/portScan.js`). That approach cannot reach
Chrome-restricted ports (21, 22, 25, …) or non-HTTP services. This optional engine
replaces the heuristic with real scanning; because a browser cannot open raw TCP
connections, the engine must carry its own transport (for example a
WebSocket/WebTransport relay it connects to).

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

## Web scanner — `public/wasm/zap.wasm`

Used by the Web Scanner (OWASP ZAP-style) workbench. Active scanning of arbitrary
origins is blocked by CORS, so the engine must route HTTP through a transport it
controls.

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
so no WASM is required. The present `aircrack.wasm` (from the `aircrack-js`
submodule) is an optional SIMD accelerator.

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
