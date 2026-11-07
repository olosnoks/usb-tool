// Generic WebAssembly loader for the security workbenches.
//
// loadWasm(url, importObject) -> instance.exports | null   (back-compat)
// loadWasmStatus(url, importObject) -> { ok, exports, error, missing }
//
// `missing` is true when the .wasm file is not present (HTTP 404), so callers can
// show a "build the engine" message instead of a generic failure. The expected
// export contract for each engine is documented in docs/WASM_ENGINES.md.

export async function loadWasmStatus(url, importObject = {}) {
  let response;
  try {
    response = await fetch(url);
  } catch (e) {
    return { ok: false, exports: null, error: `Network error fetching ${url}: ${e.message}`, missing: false };
  }
  if (response.status === 404) {
    return { ok: false, exports: null, error: `${url} not found`, missing: true };
  }
  if (!response.ok) {
    return { ok: false, exports: null, error: `Failed to fetch ${url}: ${response.status} ${response.statusText}`, missing: false };
  }
  // A dev server / SPA fallback may return index.html for a missing asset.
  const type = response.headers.get('content-type') || '';
  if (type.includes('text/html')) {
    return { ok: false, exports: null, error: `${url} resolved to HTML, not a wasm binary (engine not built)`, missing: true };
  }
  try {
    const buffer = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buffer, importObject);
    return { ok: true, exports: instance.exports, error: null, missing: false };
  } catch (e) {
    return { ok: false, exports: null, error: `Instantiation failed: ${e.message}`, missing: false };
  }
}

export async function loadWasm(url, importObject = {}) {
  const { ok, exports } = await loadWasmStatus(url, importObject);
  return ok ? exports : null;
}
