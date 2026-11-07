// Generic WebAssembly loader utility used by the security tool workbenches.
// Loads a .wasm file from the public/wasm/ directory and returns the instantiated module.
// The `importObject` can be used to provide any required imports (e.g., env, wasi, etc.).
// Returns the module instance with its exported functions and memory.
export async function loadWasm(url, importObject = {}) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error('Failed to fetch WASM:', response.status, response.statusText);
      return null;
    }
    const buffer = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buffer, importObject);
    return instance;
  } catch (e) {
    console.error('WASM load error:', e);
    return null;
  }
}

