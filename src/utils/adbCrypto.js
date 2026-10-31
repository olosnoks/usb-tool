/**
 * adbCrypto.js — the RSA bits of ADB's USB authentication.
 *
 * When you plug into a device with USB debugging on, adbd challenges the host
 * with a 20-byte token; the host signs it with its RSA-2048 private key
 * (PKCS#1 v1.5 over the SHA-1 DigestInfo of the token) and, the first time,
 * also sends its public key in Android's custom format so the device can show
 * the "Allow USB debugging?" dialog and remember the key.
 *
 * Web Crypto can't help with the signing step: adbd's token is already a SHA-1
 * digest, and SubtleCrypto.sign would hash it again. So we generate the key
 * with SubtleCrypto (for a good RNG and storage as JWK) but do the actual
 * modular exponentiation with BigInt, which also lets us build the exact
 * `android_pubkey` blob adbd expects.
 *
 * References: AOSP system/core/libcrypto_utils/android_pubkey.c; adb/adb_auth*.
 */

const RSA_WORDS = 64; // 2048-bit key = 64 * 32-bit words
const SHA1_DIGEST_INFO = [
  0x30, 0x21, 0x30, 0x09, 0x06, 0x05, 0x2b, 0x0e, 0x03, 0x02,
  0x1a, 0x05, 0x00, 0x04, 0x14
]; // ASN.1 DigestInfo prefix for a SHA-1 hash

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const bytesToBigInt = (bytes) => {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
};

const bigIntToBytes = (v, length) => {
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
};

function modPow(base, exp, mod) {
  let result = 1n;
  base %= mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function modInverse(a, m) {
  let [old_r, r] = [a % m, m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % m) + m) % m;
}

/** Generate a fresh ADB RSA-2048 key, returned as a JWK pair. */
export async function generateAdbKey(subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Web Crypto is unavailable.');
  const pair = await subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-1' },
    true,
    ['sign', 'verify']
  );
  return {
    privateJwk: await subtle.exportKey('jwk', pair.privateKey),
    publicJwk: await subtle.exportKey('jwk', pair.publicKey)
  };
}

/** The (n, e, d) of a JWK as BigInts. */
export function jwkToRsa(jwk) {
  const n = bytesToBigInt(b64urlToBytes(jwk.n));
  const e = bytesToBigInt(b64urlToBytes(jwk.e));
  const d = jwk.d ? bytesToBigInt(b64urlToBytes(jwk.d)) : null;
  return { n, e, d };
}

/**
 * Sign a 20-byte adbd token: PKCS#1 v1.5 pad the SHA-1 DigestInfo of the token
 * to 256 bytes and raise it to the private exponent. Returns 256 bytes.
 */
export function signAdbToken(privateJwk, token) {
  const { n, d } = jwkToRsa(privateJwk);
  if (!d) throw new Error('A private key is required to sign.');
  const k = 256; // 2048 bits
  const t = [...SHA1_DIGEST_INFO, ...token]; // DigestInfo || token = 35 bytes
  if (t.length !== 35) throw new Error(`ADB token must be 20 bytes (got ${token.length}).`);
  const psLen = k - 3 - t.length; // 215
  const em = new Uint8Array(k);
  em[0] = 0x00; em[1] = 0x01;
  em.fill(0xff, 2, 2 + psLen);
  em[2 + psLen] = 0x00;
  em.set(t, 3 + psLen);
  const sig = modPow(bytesToBigInt(em), d, n);
  return bigIntToBytes(sig, k);
}

/**
 * Encode a public key in Android's `android_pubkey` format:
 *   uint32 modulus_words(=64) | uint32 n0inv | uint32 modulus[64]
 *   | uint32 rr[64] | uint32 exponent
 * all little-endian, base64-encoded, with a trailing " name" and NUL.
 */
export function encodeAdbPublicKey(publicJwk, name = 'web@adb') {
  const { n, e } = jwkToRsa(publicJwk);
  const R = 1n << BigInt(32 * RSA_WORDS);         // 2^2048
  const n0 = n & 0xffffffffn;
  const n0inv = (0x100000000n - modInverse(n0, 0x100000000n)) & 0xffffffffn; // -1/n[0] mod 2^32
  const rr = (R * R) % n;                           // R^2 mod n (Montgomery)

  const buf = new ArrayBuffer(4 + 4 + RSA_WORDS * 4 + RSA_WORDS * 4 + 4);
  const dv = new DataView(buf);
  let off = 0;
  dv.setUint32(off, RSA_WORDS, true); off += 4;
  dv.setUint32(off, Number(n0inv), true); off += 4;
  const writeWords = (value) => {
    let v = value;
    for (let i = 0; i < RSA_WORDS; i++) { dv.setUint32(off, Number(v & 0xffffffffn), true); off += 4; v >>= 32n; }
  };
  writeWords(n);
  writeWords(rr);
  dv.setUint32(off, Number(e), true); off += 4;

  const bytes = new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `${btoa(bin)} ${name}\u0000`;
}

export const _internal = { modPow, modInverse, bytesToBigInt, bigIntToBytes, RSA_WORDS, SHA1_DIGEST_INFO };
