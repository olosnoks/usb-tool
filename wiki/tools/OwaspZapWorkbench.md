# Web Scanner Workbench (OWASP ZAP-style)

**Purpose**: Front-end for a WebAssembly web-vulnerability-scanning engine.

**Important limitation**: Active scanning of arbitrary origins is blocked by the
browser's same-origin/CORS policy, so it cannot be done from the page alone. The
WASM engine must carry the scanning logic and its own transport. Until the engine
is built, the tool reports its absence honestly and never fabricates alerts.

**Usage**:
- Enter a target URL.
- Click **Start Scan** (disabled until the engine loads). Alerts display severity,
  CWE, and description.

**Implementation Details**:
- Adapter `src/utils/zapWrapper.js` (`loadZapEngine()`) loads `public/wasm/zap.wasm`.
- Required exports: `memory`, `malloc`, `free`, and `scan(urlPtr, urlLen) -> resultPtr`
  (null-terminated UTF-8 JSON of alert objects). See
  [docs/WASM_ENGINES.md](../../docs/WASM_ENGINES.md).
- When the binary is missing, an `EngineNotice` panel shows the build hint and the
  expected interface.

**Dependencies**: `src/utils/zapWrapper.js`, `src/utils/wasmLoader.js`,
`src/components/tools/common/EngineNotice.jsx`.

**Status**: Engine not shipped. Compile `zap.wasm` with the `emsdk` submodule and
place it in `public/wasm/`.
