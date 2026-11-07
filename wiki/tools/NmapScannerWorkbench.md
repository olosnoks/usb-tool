# Port Scanner Workbench

**Purpose**: Front-end for a WebAssembly TCP port-scanning engine.

**Important limitation**: A browser cannot open raw TCP sockets, so port scanning
is not possible from the page alone. This tool is wired to a WASM engine that must
carry its own transport. Until that engine is built, the tool reports its absence
honestly and does not fabricate results.

**Usage**:
- Enter a target host (e.g. `example.com` or an IP).
- Provide a comma-separated list of ports (default `80,443,22,21,23,8080,8443`).
- Click **Scan**. The button is disabled until the engine loads. Results show
  `Port`, `State`, and `Service`.

**Implementation Details**:
- Loads `public/wasm/portscanner.wasm` via `loadWasmStatus` on mount.
- Required exports: `memory`, `malloc`, `free`, and `scan(targetPtr, targetLen, portsPtr, portsLen) -> resultPtr`
  (null-terminated UTF-8 JSON). See [docs/WASM_ENGINES.md](../../docs/WASM_ENGINES.md).
- When the binary is missing (404 or HTML fallback), an `EngineNotice` panel shows
  the build hint and the expected interface.

**Dependencies**: `src/utils/wasmLoader.js`, `src/components/tools/common/EngineNotice.jsx`.

**Status**: Engine not shipped in the build. Compile `portscanner.wasm` with the
`emsdk` submodule and place it in `public/wasm/`.
