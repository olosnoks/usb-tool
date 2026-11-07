# Nmap Scanner Workbench

**Purpose**: Client‑side TCP port scanner using a WebAssembly‑compiled scanner (no backend server required).

**Usage**:
- Enter a target host (e.g. `example.com` or an IP address).
- Provide a comma‑separated list of ports to scan (default: `80,443,22,21,23,8080,8443`).
- Click **Scan**. Results are displayed in a table with `Port`, `State` (`open`/`closed`/`filtered`), and optional `Service` name.

**Implementation Details**:
- The WASM binary lives at `public/wasm/portscanner.wasm` and exports `malloc`, `free`, and `scan`.
- `loadWasm` utility loads the module on component mount.
- The component logs progress via `onLogMessage` (appears in the global log pane).

**Dependencies**: `src/utils/wasmLoader.js` for dynamic WASM loading.

**Notes**:
- Scanning large port ranges may be CPU intensive; the WASM engine can leverage WebGPU if compiled with it.
- Results are purely client‑side; no network traffic is sent beyond the target host.

