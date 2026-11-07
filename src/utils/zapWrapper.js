// Adapter for a WebAssembly-compiled web-scanning engine (OWASP ZAP-style).
//
// The engine binary is expected at public/wasm/zap.wasm. A browser cannot run a
// full active web scanner against arbitrary origins (CORS and the lack of raw
// sockets forbid it), so a real engine must route its traffic through a transport
// it controls. Until the binary is built this adapter reports its absence; it
// never fabricates alerts. See docs/WASM_ENGINES.md for the contract.

import { loadWasmStatus } from './wasmLoader';

let cached = null;

/**
 * Load the ZAP engine. Returns { ok, error, missing, scan } where scan(targetUrl)
 * resolves to an array of alert objects: { severity, cwe, desc }.
 */
export async function loadZapEngine() {
  if (cached) return cached;
  const status = await loadWasmStatus('/wasm/zap.wasm', {});
  if (!status.ok) {
    cached = { ok: false, error: status.error, missing: status.missing, scan: null };
    return cached;
  }
  const exports = status.exports;
  if (typeof exports.scan !== 'function' || typeof exports.malloc !== 'function') {
    cached = { ok: false, error: 'zap.wasm is missing required exports (scan/malloc)', missing: false, scan: null };
    return cached;
  }
  const scan = async (targetUrl) => {
    const { memory, scan: scanFn, malloc, free } = exports;
    const bytes = new TextEncoder().encode(targetUrl);
    const ptr = malloc(bytes.length + 1);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    const resultPtr = scanFn(ptr, bytes.length);
    const memU8 = new Uint8Array(memory.buffer);
    let end = resultPtr;
    while (memU8[end] !== 0) end++;
    const json = new TextDecoder().decode(memU8.subarray(resultPtr, end));
    free(ptr); free(resultPtr);
    return JSON.parse(json);
  };
  cached = { ok: true, error: null, missing: false, scan };
  return cached;
}
