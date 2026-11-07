# Hashcat Cracker Workbench

**Purpose**: Client‑side password hash cracking using the **hashcat** algorithm compiled to WebAssembly. No backend is required; all computation runs in the browser.

**Usage**:
- Provide a hash (e.g. MD5, SHA‑1, NTLM) in the *Hash* field.
- Select a *Wordlist* (plain‑text file) via the file picker.
- Choose a *Hash Mode* from the dropdown (default: `0 – MD5`).
- Click **Start** to begin cracking. Progress, speed, and found passwords appear in the log pane.

**Implementation Details**:
- The WASM binary (`public/wasm/hashcat.wasm`) exports `init`, `updateWordlist`, `crack`, and `terminate` functions.
- `src/utils/wasmLoader.js` loads the module lazily on component mount.
- The workbench streams the wordlist to the WASM module chunk‑by‑chunk to avoid loading the entire file into memory.

**Dependencies**: `src/utils/wasmLoader.js`, `src/utils/fileReader.js` (optional helper for streaming files).

**Notes**:
- Performance depends on the device’s CPU/GPU; WebGPU can be leveraged if the WASM build includes it.
- Only a subset of hashcat’s massive algorithm set is compiled; unsupported modes will show an error message.

