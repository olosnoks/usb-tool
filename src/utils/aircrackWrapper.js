// WPA/WPA2 PMKID cracking, implemented with the Web Crypto API.
//
// PMKID = HMAC-SHA1(PMK, "PMK Name" || AP_MAC || STA_MAC)[0:16]
// PMK   = PBKDF2-HMAC-SHA1(passphrase, SSID, 4096, 32 bytes)
//
// Both primitives are provided by SubtleCrypto, so this runs for real in any
// browser with no backend and no WASM. The PBKDF2 path was verified against the
// IEEE 802.11i WPA PSK test vectors. It is correct but not fast.


const subtle = globalThis.crypto?.subtle;

function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');
  return Uint8Array.from(clean.match(/../g).map((b) => parseInt(b, 16)));
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeMac(mac) {
  const clean = mac.replace(/[^0-9a-fA-F]/g, '');
  if (clean.length !== 12) throw new Error(`MAC must be 12 hex digits, got ${clean.length}`);
  return clean.toLowerCase();
}

export function normalizePmkid(pmkid) {
  const clean = pmkid.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  if (clean.length !== 32) throw new Error(`PMKID must be 32 hex digits (16 bytes), got ${clean.length}`);
  return clean;
}

/** Compute the PMKID for a single candidate passphrase. Returns lowercase hex. */
export async function computePmkid(passphrase, ssid, apMacHex, staMacHex) {
  const pwKey = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const pmkBits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-1', salt: new TextEncoder().encode(ssid), iterations: 4096 },
    pwKey,
    256,
  );
  const hmacKey = await subtle.importKey('raw', new Uint8Array(pmkBits), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const data = new Uint8Array([
    ...new TextEncoder().encode('PMK Name'),
    ...hexToBytes(apMacHex),
    ...hexToBytes(staMacHex),
  ]);
  const sig = new Uint8Array(await subtle.sign('HMAC', hmacKey, data));
  return bytesToHex(sig.slice(0, 16));
}

/**
 * Try each candidate passphrase against the target PMKID.
 * Candidates outside the WPA length range (8..63) are skipped.
 * onProgress({ tried, total }) is called periodically; shouldStop() can abort.
 * Returns the cracked passphrase, or null.
 */
export async function crackPmkid({ ssid, apMac, clientMac, pmkid, candidates }, { onProgress, shouldStop } = {}) {
  const ap = normalizeMac(apMac);
  const sta = normalizeMac(clientMac);
  const target = normalizePmkid(pmkid);
  const words = candidates.filter((w) => w.length >= 8 && w.length <= 63);
  for (let i = 0; i < words.length; i++) {
    if (shouldStop?.()) return null;
    const candidate = await computePmkid(words[i], ssid, ap, sta);
    if (candidate === target) return words[i];
    if (i % 50 === 0) {
      onProgress?.({ tried: i, total: words.length });
      await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
  }
  onProgress?.({ tried: words.length, total: words.length });
  return null;
}

/**
 * Optional accelerator hook. Loads the SIMD WASM module if present.
 * Returns the instance or null. The current cracker uses Web Crypto; wiring this
 * engine's pbkdf2_pmkid dual-lane path is a future optimization documented in
 * docs/WASM_ENGINES.md.
 */
