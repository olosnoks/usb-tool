/**
 * Small in-house algorithm implementations used by the CyberChef operations.
 * All functions are pure and operate on Uint8Array. Test vectors live in
 * tests/cyberchef/hashingCrypto.test.js.
 */

import CryptoJS from 'crypto-js';

const MASK64 = (1n << 64n) - 1n;

// ---------------------------------------------------------------------------
// CryptoJS bridges (MD5, SHA-1, SHA-224, SHA-256) on raw bytes
// ---------------------------------------------------------------------------

export function wordArrayFromBytes(bytes) {
  const words = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >>> 2] = (words[i >>> 2] || 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

export function bytesFromWordArray(wa) {
  const out = new Uint8Array(wa.sigBytes);
  for (let i = 0; i < out.length; i++) {
    out[i] = (wa.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

export const md5 = (b) => bytesFromWordArray(CryptoJS.MD5(wordArrayFromBytes(b)));
export const sha1 = (b) => bytesFromWordArray(CryptoJS.SHA1(wordArrayFromBytes(b)));
export const sha224 = (b) => bytesFromWordArray(CryptoJS.SHA224(wordArrayFromBytes(b)));
export const sha256 = (b) => bytesFromWordArray(CryptoJS.SHA256(wordArrayFromBytes(b)));

// ---------------------------------------------------------------------------
// SHA-512 family (SHA-512, SHA-384, SHA-512/t). Constants are derived from the
// fractional parts of square/cube roots of primes, exactly as FIPS 180-4 defines.
// ---------------------------------------------------------------------------

function iroot(n, k) {
  if (n < 2n) return n;
  const kb = BigInt(k);
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / k));
  for (;;) {
    const y = ((kb - 1n) * x + n / x ** (kb - 1n)) / kb;
    if (y >= x) return x;
    x = y;
  }
}

function firstPrimes(count) {
  const out = [];
  for (let n = 2; out.length < count; n++) {
    if (out.every((p) => n % p !== 0)) out.push(n);
  }
  return out;
}

let sha512Consts = null;
function getSha512Consts() {
  if (sha512Consts) return sha512Consts;
  const primes = firstPrimes(80);
  const frac = (p, k) => iroot(BigInt(p) << BigInt(64 * k), k) & MASK64;
  sha512Consts = {
    K: primes.map((p) => frac(p, 3)),
    IV512: primes.slice(0, 8).map((p) => frac(p, 2)),
    IV384: primes.slice(8, 16).map((p) => frac(p, 2))
  };
  return sha512Consts;
}

const rotr64 = (x, n) => ((x >> n) | (x << (64n - n))) & MASK64;

function sha512Core(bytes, iv) {
  const { K } = getSha512Consts();
  const h = iv.slice();
  const len = bytes.length;
  const padLen = Math.ceil((len + 17) / 128) * 128;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(padLen - 8, BigInt(len) * 8n);
  const w = new Array(80);
  for (let off = 0; off < padLen; off += 128) {
    for (let t = 0; t < 16; t++) w[t] = dv.getBigUint64(off + t * 8);
    for (let t = 16; t < 80; t++) {
      const s0 = rotr64(w[t - 15], 1n) ^ rotr64(w[t - 15], 8n) ^ (w[t - 15] >> 7n);
      const s1 = rotr64(w[t - 2], 19n) ^ rotr64(w[t - 2], 61n) ^ (w[t - 2] >> 6n);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let t = 0; t < 80; t++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ ((~e & MASK64) & g);
      const t1 = (hh + S1 + ch + K[t] + w[t]) & MASK64;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      hh = g; g = f; f = e; e = (d + t1) & MASK64;
      d = c; c = b; b = a; a = (t1 + t2) & MASK64;
    }
    const v = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = (h[i] + v[i]) & MASK64;
  }
  return h;
}

function wordsToBytes(words, outLen) {
  const out = new Uint8Array(64);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) dv.setBigUint64(i * 8, words[i]);
  return out.slice(0, outLen);
}

export const sha512Bytes = (b) => wordsToBytes(sha512Core(b, getSha512Consts().IV512), 64);
export const sha384Bytes = (b) => wordsToBytes(sha512Core(b, getSha512Consts().IV384), 48);

const sha512tIvCache = {};
function sha512tIv(t) {
  if (!sha512tIvCache[t]) {
    const seed = getSha512Consts().IV512.map((x) => x ^ 0xa5a5a5a5a5a5a5a5n);
    const name = new TextEncoder().encode(`SHA-512/${t}`);
    sha512tIvCache[t] = sha512Core(name, seed);
  }
  return sha512tIvCache[t];
}
export const sha512_256Bytes = (b) => wordsToBytes(sha512Core(b, sha512tIv(256)), 32);
export const sha512_224Bytes = (b) => wordsToBytes(sha512Core(b, sha512tIv(224)), 28);

// ---------------------------------------------------------------------------
// MD4 and NTLM
// ---------------------------------------------------------------------------

const rotl32 = (x, n) => (x << n) | (x >>> (32 - n));

function padMd(bytes) {
  const len = bytes.length;
  const padLen = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(padLen - 8, bits % 4294967296, true);
  dv.setUint32(padLen - 4, Math.floor(bits / 4294967296), true);
  return { buf, dv, padLen };
}

export function md4(bytes) {
  const { dv, padLen } = padMd(bytes);
  let a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
  const X = new Array(16);
  const r2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
  const r3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
  const s1 = [3, 7, 11, 19], s2 = [3, 5, 9, 13], s3 = [3, 9, 11, 15];
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);
    let v = [a0, b0, c0, d0];
    for (let i = 0; i < 48; i++) {
      const [A, B, C, D] = v;
      let f, k, s, K;
      if (i < 16) { f = (B & C) | (~B & D); k = i; s = s1[i % 4]; K = 0; }
      else if (i < 32) { const j = i - 16; f = (B & C) | (B & D) | (C & D); k = r2[j]; s = s2[j % 4]; K = 0x5a827999; }
      else { const j = i - 32; f = B ^ C ^ D; k = r3[j]; s = s3[j % 4]; K = 0x6ed9eba1; }
      const nA = rotl32((A + f + X[k] + K) | 0, s);
      v = [D, nA, B, C];
    }
    a0 = (a0 + v[0]) | 0; b0 = (b0 + v[1]) | 0; c0 = (c0 + v[2]) | 0; d0 = (d0 + v[3]) | 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((x, i) => odv.setUint32(i * 4, x >>> 0, true));
  return out;
}

export function utf16le(text) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return out;
}

export const ntlm = (text) => md4(utf16le(text));

// ---------------------------------------------------------------------------
// RIPEMD-160
// ---------------------------------------------------------------------------

const RMD_R = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13
];
const RMD_RP = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11
];
const RMD_S = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6
];
const RMD_SP = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11
];
const RMD_K = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const RMD_KP = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

function rmdF(j, x, y, z) {
  if (j < 16) return x ^ y ^ z;
  if (j < 32) return (x & y) | (~x & z);
  if (j < 48) return (x | ~y) ^ z;
  if (j < 64) return (x & z) | (y & ~z);
  return x ^ (y | ~z);
}

export function ripemd160(bytes) {
  const { dv, padLen } = padMd(bytes);
  let h0 = 0x67452301, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476, h4 = 0xc3d2e1f0 | 0;
  const X = new Array(16);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) X[i] = dv.getUint32(off + i * 4, true);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    let a2 = h0, b2 = h1, c2 = h2, d2 = h3, e2 = h4;
    for (let j = 0; j < 80; j++) {
      const rd = j >> 4;
      let t = (rotl32((a + rmdF(j, b, c, d) + X[RMD_R[j]] + RMD_K[rd]) | 0, RMD_S[j]) + e) | 0;
      a = e; e = d; d = rotl32(c, 10); c = b; b = t;
      t = (rotl32((a2 + rmdF(79 - j, b2, c2, d2) + X[RMD_RP[j]] + RMD_KP[rd]) | 0, RMD_SP[j]) + e2) | 0;
      a2 = e2; e2 = d2; d2 = rotl32(c2, 10); c2 = b2; b2 = t;
    }
    const t = (h1 + c + d2) | 0;
    h1 = (h2 + d + e2) | 0;
    h2 = (h3 + e + a2) | 0;
    h3 = (h4 + a + b2) | 0;
    h4 = (h0 + b + c2) | 0;
    h0 = t;
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((x, i) => odv.setUint32(i * 4, x >>> 0, true));
  return out;
}

// ---------------------------------------------------------------------------
// HMAC (generic over the hashes above)
// ---------------------------------------------------------------------------

export const HASH_FUNCTIONS = {
  'MD4': { fn: md4, block: 64 },
  'MD5': { fn: md5, block: 64 },
  'SHA-1': { fn: sha1, block: 64 },
  'SHA-224': { fn: sha224, block: 64 },
  'SHA-256': { fn: sha256, block: 64 },
  'SHA-384': { fn: sha384Bytes, block: 128 },
  'SHA-512': { fn: sha512Bytes, block: 128 },
  'SHA-512/256': { fn: sha512_256Bytes, block: 128 },
  'RIPEMD-160': { fn: ripemd160, block: 64 }
};

export function hmac(hashName, key, message) {
  const spec = HASH_FUNCTIONS[hashName];
  if (!spec) throw new Error(`Unsupported HMAC hash "${hashName}".`);
  const { fn, block } = spec;
  let k = key.length > block ? fn(key) : key;
  const kp = new Uint8Array(block);
  kp.set(k);
  const ipad = new Uint8Array(block + message.length);
  const opad = new Uint8Array(block);
  for (let i = 0; i < block; i++) {
    ipad[i] = kp[i] ^ 0x36;
    opad[i] = kp[i] ^ 0x5c;
  }
  ipad.set(message, block);
  const inner = fn(ipad);
  const outer = new Uint8Array(block + inner.length);
  outer.set(opad);
  outer.set(inner, block);
  return fn(outer);
}

// ---------------------------------------------------------------------------
// CRC (Rocksoft model, widths 1..64)
// ---------------------------------------------------------------------------

function reflectBits(value, width) {
  let r = 0n;
  let v = value;
  for (let i = 0; i < width; i++) {
    r = (r << 1n) | (v & 1n);
    v >>= 1n;
  }
  return r;
}

const crcTables = new Map();

/**
 * @param {Uint8Array} bytes
 * @param {{width:number, poly:bigint, init:bigint, refin:boolean, refout:boolean, xorout:bigint}} p
 * @returns {bigint}
 */
export function crc(bytes, p) {
  const { width, refin, refout } = p;
  if (!Number.isInteger(width) || width < 1 || width > 64) throw new Error('CRC width must be between 1 and 64.');
  const W = BigInt(width);
  const mask = (1n << W) - 1n;
  const poly = p.poly & mask;
  let reg = p.init & mask;

  if (width < 8) {
    for (let i = 0; i < bytes.length; i++) {
      let byte = bytes[i];
      if (refin) byte = Number(reflectBits(BigInt(byte), 8));
      for (let bit = 7; bit >= 0; bit--) {
        const top = ((reg >> (W - 1n)) & 1n) ^ BigInt((byte >> bit) & 1);
        reg = (reg << 1n) & mask;
        if (top) reg ^= poly;
      }
    }
  } else if (refin) {
    const key = `r${width}:${poly}`;
    let table = crcTables.get(key);
    if (!table) {
      const rpoly = reflectBits(poly, width);
      table = [];
      for (let i = 0; i < 256; i++) {
        let c = BigInt(i);
        for (let k = 0; k < 8; k++) c = c & 1n ? (c >> 1n) ^ rpoly : c >> 1n;
        table.push(c);
      }
      crcTables.set(key, table);
    }
    reg = reflectBits(reg, width);
    for (let i = 0; i < bytes.length; i++) {
      reg = (reg >> 8n) ^ table[Number((reg ^ BigInt(bytes[i])) & 0xffn)];
    }
  } else {
    const key = `n${width}:${poly}`;
    let table = crcTables.get(key);
    if (!table) {
      table = [];
      for (let i = 0; i < 256; i++) {
        let c = BigInt(i) << (W - 8n);
        for (let k = 0; k < 8; k++) c = (c >> (W - 1n)) & 1n ? ((c << 1n) ^ poly) & mask : (c << 1n) & mask;
        table.push(c);
      }
      crcTables.set(key, table);
    }
    for (let i = 0; i < bytes.length; i++) {
      reg = ((reg << 8n) & mask) ^ table[Number(((reg >> (W - 8n)) ^ BigInt(bytes[i])) & 0xffn)];
    }
  }
  // width >= 8 with refin keeps the register reflected; width < 8 keeps it normal.
  const reflectedDomain = width >= 8 && refin;
  if (reflectedDomain !== refout) reg = reflectBits(reg, width);
  return (reg ^ (p.xorout & mask)) & mask;
}

export function crcHex(bytes, p) {
  return crc(bytes, p).toString(16).padStart(Math.ceil(p.width / 4), '0');
}

/** Named CRC presets. check = result for ASCII "123456789". */
export const CRC_PRESETS = {
  8: {
    'CRC-8': { width: 8, poly: 0x07n, init: 0n, refin: false, refout: false, xorout: 0n, check: 'f4' },
    'CRC-8/CDMA2000': { width: 8, poly: 0x9bn, init: 0xffn, refin: false, refout: false, xorout: 0n, check: 'da' },
    'CRC-8/MAXIM (Dallas 1-Wire)': { width: 8, poly: 0x31n, init: 0n, refin: true, refout: true, xorout: 0n, check: 'a1' },
    'CRC-8/ROHC': { width: 8, poly: 0x07n, init: 0xffn, refin: true, refout: true, xorout: 0n, check: 'd0' }
  },
  16: {
    'CRC-16/ARC': { width: 16, poly: 0x8005n, init: 0n, refin: true, refout: true, xorout: 0n, check: 'bb3d' },
    'CRC-16/CCITT-FALSE': { width: 16, poly: 0x1021n, init: 0xffffn, refin: false, refout: false, xorout: 0n, check: '29b1' },
    'CRC-16/XMODEM': { width: 16, poly: 0x1021n, init: 0n, refin: false, refout: false, xorout: 0n, check: '31c3' },
    'CRC-16/KERMIT': { width: 16, poly: 0x1021n, init: 0n, refin: true, refout: true, xorout: 0n, check: '2189' },
    'CRC-16/MODBUS': { width: 16, poly: 0x8005n, init: 0xffffn, refin: true, refout: true, xorout: 0n, check: '4b37' },
    'CRC-16/X-25': { width: 16, poly: 0x1021n, init: 0xffffn, refin: true, refout: true, xorout: 0xffffn, check: '906e' },
    'CRC-16/USB': { width: 16, poly: 0x8005n, init: 0xffffn, refin: true, refout: true, xorout: 0xffffn, check: 'b4c8' },
    'CRC-16/GENIBUS': { width: 16, poly: 0x1021n, init: 0xffffn, refin: false, refout: false, xorout: 0xffffn, check: 'd64e' },
    'CRC-16/DNP': { width: 16, poly: 0x3d65n, init: 0n, refin: true, refout: true, xorout: 0xffffn, check: 'ea82' }
  },
  64: {
    'CRC-64/ECMA-182': { width: 64, poly: 0x42f0e1eba9ea3693n, init: 0n, refin: false, refout: false, xorout: 0n, check: '6c40df5f0b497347' },
    'CRC-64/XZ': { width: 64, poly: 0x42f0e1eba9ea3693n, init: 0xffffffffffffffffn, refin: true, refout: true, xorout: 0xffffffffffffffffn, check: '995dc9bbdf1939fa' },
    'CRC-64/GO-ISO': { width: 64, poly: 0x000000000000001bn, init: 0xffffffffffffffffn, refin: true, refout: true, xorout: 0xffffffffffffffffn, check: 'b90956c775a41001' }
  }
};

// ---------------------------------------------------------------------------
// Fletcher checksums
// ---------------------------------------------------------------------------

export function fletcher16(bytes) {
  let s1 = 0, s2 = 0;
  for (let i = 0; i < bytes.length; i++) {
    s1 = (s1 + bytes[i]) % 255;
    s2 = (s2 + s1) % 255;
  }
  return ((s2 << 8) | s1) >>> 0;
}

/** 16-bit little-endian words, odd trailing byte zero-padded. */
export function fletcher32(bytes) {
  let s1 = 0, s2 = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const word = bytes[i] | ((i + 1 < bytes.length ? bytes[i + 1] : 0) << 8);
    s1 = (s1 + word) % 65535;
    s2 = (s2 + s1) % 65535;
  }
  return ((s2 << 16) | s1) >>> 0;
}

// ---------------------------------------------------------------------------
// BLAKE2s (RFC 7693), unkeyed
// ---------------------------------------------------------------------------

const B2S_IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const B2_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0]
];
const rotr32 = (x, n) => (x >>> n) | (x << (32 - n));

export function blake2s(bytes, outLen = 32) {
  if (!Number.isInteger(outLen) || outLen < 1 || outLen > 32) throw new Error('BLAKE2s digest length must be 1-32 bytes.');
  const h = B2S_IV.slice();
  h[0] ^= 0x01010000 ^ outLen;
  const total = bytes.length;

  const compress = (block, t, last) => {
    const m = new Array(16);
    const dv = new DataView(block.buffer);
    for (let i = 0; i < 16; i++) m[i] = dv.getUint32(i * 4, true);
    const v = h.concat(B2S_IV);
    v[12] ^= t >>> 0;
    v[13] ^= Math.floor(t / 4294967296);
    if (last) v[14] = ~v[14];
    const G = (a, b, c, d, x, y) => {
      v[a] = (v[a] + v[b] + x) | 0; v[d] = rotr32(v[d] ^ v[a], 16);
      v[c] = (v[c] + v[d]) | 0; v[b] = rotr32(v[b] ^ v[c], 12);
      v[a] = (v[a] + v[b] + y) | 0; v[d] = rotr32(v[d] ^ v[a], 8);
      v[c] = (v[c] + v[d]) | 0; v[b] = rotr32(v[b] ^ v[c], 7);
    };
    for (let r = 0; r < 10; r++) {
      const s = B2_SIGMA[r];
      G(0, 4, 8, 12, m[s[0]], m[s[1]]);
      G(1, 5, 9, 13, m[s[2]], m[s[3]]);
      G(2, 6, 10, 14, m[s[4]], m[s[5]]);
      G(3, 7, 11, 15, m[s[6]], m[s[7]]);
      G(0, 5, 10, 15, m[s[8]], m[s[9]]);
      G(1, 6, 11, 12, m[s[10]], m[s[11]]);
      G(2, 7, 8, 13, m[s[12]], m[s[13]]);
      G(3, 4, 9, 14, m[s[14]], m[s[15]]);
    }
    for (let i = 0; i < 8; i++) h[i] = h[i] ^ v[i] ^ v[i + 8];
  };

  if (total === 0) {
    compress(new Uint8Array(64), 0, true);
  } else {
    for (let off = 0; off < total; off += 64) {
      const chunk = new Uint8Array(64);
      chunk.set(bytes.subarray(off, Math.min(off + 64, total)));
      compress(chunk, Math.min(off + 64, total), off + 64 >= total);
    }
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, h[i] >>> 0, true);
  return out.slice(0, outLen);
}

// ---------------------------------------------------------------------------
// ChaCha20 (RFC 8439; an 8-byte nonce selects the original 64-bit counter layout)
// and Poly1305
// ---------------------------------------------------------------------------

function chachaBlock(keyWords, counter, nonceWords, wideCounter) {
  const s = new Uint32Array(16);
  s[0] = 0x61707865; s[1] = 0x3320646e; s[2] = 0x79622d32; s[3] = 0x6b206574;
  s.set(keyWords, 4);
  if (wideCounter) {
    s[12] = counter % 4294967296;
    s[13] = Math.floor(counter / 4294967296);
    s[14] = nonceWords[0]; s[15] = nonceWords[1];
  } else {
    s[12] = counter;
    s[13] = nonceWords[0]; s[14] = nonceWords[1]; s[15] = nonceWords[2];
  }
  const x = Uint32Array.from(s);
  const qr = (a, b, c, d) => {
    x[a] += x[b]; x[d] = rotl32(x[d] ^ x[a], 16);
    x[c] += x[d]; x[b] = rotl32(x[b] ^ x[c], 12);
    x[a] += x[b]; x[d] = rotl32(x[d] ^ x[a], 8);
    x[c] += x[d]; x[b] = rotl32(x[b] ^ x[c], 7);
  };
  for (let i = 0; i < 10; i++) {
    qr(0, 4, 8, 12); qr(1, 5, 9, 13); qr(2, 6, 10, 14); qr(3, 7, 11, 15);
    qr(0, 5, 10, 15); qr(1, 6, 11, 12); qr(2, 7, 8, 13); qr(3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 16; i++) dv.setUint32(i * 4, (x[i] + s[i]) >>> 0, true);
  return out;
}

export function chacha20(key, nonce, counter, data) {
  if (key.length !== 32) throw new Error(`ChaCha20 key must be 32 bytes (got ${key.length}).`);
  if (nonce.length !== 12 && nonce.length !== 8) throw new Error(`ChaCha20 nonce must be 12 bytes (IETF) or 8 bytes (original); got ${nonce.length}.`);
  if (!Number.isInteger(counter) || counter < 0) throw new Error('ChaCha20 counter must be a non-negative integer.');
  const wide = nonce.length === 8;
  const kdv = new DataView(key.buffer, key.byteOffset, 32);
  const keyWords = [];
  for (let i = 0; i < 8; i++) keyWords.push(kdv.getUint32(i * 4, true));
  const ndv = new DataView(nonce.buffer, nonce.byteOffset, nonce.length);
  const nonceWords = [];
  for (let i = 0; i < nonce.length / 4; i++) nonceWords.push(ndv.getUint32(i * 4, true));
  const blocks = Math.ceil(data.length / 64);
  if (!wide && counter + blocks > 4294967296) throw new Error('ChaCha20 32-bit block counter would overflow for this input length.');
  const out = new Uint8Array(data.length);
  for (let b = 0; b < blocks; b++) {
    const ks = chachaBlock(keyWords, counter + b, nonceWords, wide);
    const base = b * 64;
    const n = Math.min(64, data.length - base);
    for (let i = 0; i < n; i++) out[base + i] = data[base + i] ^ ks[i];
  }
  return out;
}

function leToBig(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(bytes[i]);
  return n;
}

export function poly1305(key, msg) {
  if (key.length !== 32) throw new Error('Poly1305 key must be 32 bytes.');
  const r = leToBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leToBig(key.subarray(16, 32));
  const p = (1n << 130n) - 5n;
  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const chunk = msg.subarray(i, Math.min(i + 16, msg.length));
    const n = leToBig(chunk) | (1n << BigInt(8 * chunk.length));
    acc = ((acc + n) * r) % p;
  }
  acc = (acc + s) & ((1n << 128n) - 1n);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) { out[i] = Number(acc & 0xffn); acc >>= 8n; }
  return out;
}

function aeadMacData(aad, ct) {
  const pad = (n) => (16 - (n % 16)) % 16;
  const out = new Uint8Array(aad.length + pad(aad.length) + ct.length + pad(ct.length) + 16);
  out.set(aad, 0);
  out.set(ct, aad.length + pad(aad.length));
  const dv = new DataView(out.buffer);
  dv.setBigUint64(out.length - 16, BigInt(aad.length), true);
  dv.setBigUint64(out.length - 8, BigInt(ct.length), true);
  return out;
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function chacha20Poly1305Encrypt(key, nonce, aad, plaintext) {
  if (nonce.length !== 12) throw new Error(`ChaCha20-Poly1305 nonce must be 12 bytes (got ${nonce.length}).`);
  const otk = chacha20(key, nonce, 0, new Uint8Array(32));
  const ciphertext = chacha20(key, nonce, 1, plaintext);
  const tag = poly1305(otk, aeadMacData(aad, ciphertext));
  return { ciphertext, tag };
}

export function chacha20Poly1305Decrypt(key, nonce, aad, ciphertext, tag) {
  if (nonce.length !== 12) throw new Error(`ChaCha20-Poly1305 nonce must be 12 bytes (got ${nonce.length}).`);
  const otk = chacha20(key, nonce, 0, new Uint8Array(32));
  const expected = poly1305(otk, aeadMacData(aad, ciphertext));
  if (!constantTimeEqual(expected, tag)) {
    throw new Error('ChaCha20-Poly1305 authentication failed: tag mismatch (wrong key, nonce, AAD, or the data was modified).');
  }
  return chacha20(key, nonce, 1, ciphertext);
}
