import { loadWasm } from './wasmLoader';

let wasmModule = null;

/**
 * Initialise and cache the Aircrack WASM module.
 * Returns the instantiated module (or null on failure).
 */
export async function initAircrack() {
  if (!wasmModule) {
    wasmModule = await loadWasm('/wasm/aircrack.wasm', {});
  }
  return wasmModule;
}

/**
 * Run the PMKID cracking routine in the WASM module.
 * The WASM binary (`pbkdf2_eapol.wasm`) exports a function named `crack`
 * that follows the signature used by the original demo code:
 *   crack(ssidPtr, ssidLen, apPtr, apLen, clientPtr, clientLen,
 *         pmkidPtr, pmkidLen, wordlistPtr, wordlistLen) -> resultPtr
 * It returns a pointer to a null‑terminated UTF‑8 string containing the cracked
 * password or an empty string if not found.
 */
export async function crack_pmkid(ssid, apMac, clientMac, pmkidHex, wordlist) {
  const wasm = await initAircrack();
  if (!wasm) return null;
  const { memory, malloc, free, crack } = wasm;
  if (typeof crack !== 'function') return null;

  const encoder = new TextEncoder();
  const writeString = (str, ptr) => {
    const bytes = encoder.encode(str);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    return bytes.length;
  };

  const ssidPtr = malloc(ssid.length + 1);
  const apPtr = malloc(apMac.length + 1);
  const clientPtr = malloc(clientMac.length + 1);
  const pmkidPtr = malloc(pmkidHex.length + 1);
  const wordlistPtr = malloc(wordlist.length + 1);

  writeString(ssid, ssidPtr);
  writeString(apMac, apPtr);
  writeString(clientMac, clientPtr);
  writeString(pmkidHex, pmkidPtr);
  writeString(wordlist, wordlistPtr);

  const resultPtr = crack(ssidPtr, ssid.length, apPtr, apMac.length, clientPtr, clientMac.length,
    pmkidPtr, pmkidHex.length, wordlistPtr, wordlist.length);

  // read null‑terminated result string
  const memU8 = new Uint8Array(memory.buffer);
  let end = resultPtr;
  while (memU8[end] !== 0) end++;
  const pwd = new TextDecoder().decode(memU8.subarray(resultPtr, end));

  // clean up allocations
  free(ssidPtr);
  free(apPtr);
  free(clientPtr);
  free(pmkidPtr);
  free(wordlistPtr);
  free(resultPtr);

  return pwd || null;
}

