// Hash suite for the Hash & HMAC calculator. Pure JS plus Web Crypto where
// available. Everything is local: nothing here touches the network.
import CryptoJS from 'crypto-js';
import { md5Hex } from './md5.js';
import { md4Hex } from './md4.js';

const enc = new TextEncoder();

export function toHex(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

const asBytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

// ---------------------------------------------------------------- SHA-3 ----
// Keccak-f[1600] on 32-bit halves (NIST SHA-3 padding 0x06; crypto-js ships
// original Keccak, which differs, so this is implemented here).
const KECCAK = (() => {
  const rcHi = new Uint32Array(24);
  const rcLo = new Uint32Array(24);
  let R = 1;
  for (let t = 0; t < 24; t++) {
    let rc = 0n;
    for (let j = 0; j < 7; j++) {
      R = ((R << 1) ^ ((R >> 7) * 0x71)) % 256;
      if (R & 2) rc ^= 1n << BigInt((1 << j) - 1);
    }
    rcHi[t] = Number(rc >> 32n);
    rcLo[t] = Number(rc & 0xffffffffn);
  }
  const rot = new Array(25).fill(0);
  let x = 1;
  let y = 0;
  for (let t = 0; t < 24; t++) {
    rot[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
    [x, y] = [y, (2 * x + 3 * y) % 5];
  }
  return { rcHi, rcLo, rot };
})();

function keccakF(hi, lo) {
  const bh = new Uint32Array(25);
  const bl = new Uint32Array(25);
  const ch = new Uint32Array(5);
  const cl = new Uint32Array(5);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) {
      ch[x] = hi[x] ^ hi[x + 5] ^ hi[x + 10] ^ hi[x + 15] ^ hi[x + 20];
      cl[x] = lo[x] ^ lo[x + 5] ^ lo[x + 10] ^ lo[x + 15] ^ lo[x + 20];
    }
    for (let x = 0; x < 5; x++) {
      const nx = (x + 1) % 5;
      const px = (x + 4) % 5;
      // rotl64(C[nx], 1)
      const rh = ((ch[nx] << 1) | (cl[nx] >>> 31)) >>> 0;
      const rl = ((cl[nx] << 1) | (ch[nx] >>> 31)) >>> 0;
      const dh = ch[px] ^ rh;
      const dl = cl[px] ^ rl;
      for (let y = 0; y < 25; y += 5) { hi[x + y] ^= dh; lo[x + y] ^= dl; }
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const i = x + 5 * y;
        const n = KECCAK.rot[i];
        let h = hi[i];
        let l = lo[i];
        if (n === 32) { const t = h; h = l; l = t; }
        else if (n > 32) { const m = n - 32; const nh = (l << m) | (h >>> (32 - m)); const nl = (h << m) | (l >>> (32 - m)); h = nh; l = nl; }
        else if (n > 0) { const nh = (h << n) | (l >>> (32 - n)); const nl = (l << n) | (h >>> (32 - n)); h = nh; l = nl; }
        const j = y + 5 * ((2 * x + 3 * y) % 5);
        bh[j] = h; bl[j] = l;
      }
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) {
        const a = y + x;
        const b = y + ((x + 1) % 5);
        const c = y + ((x + 2) % 5);
        hi[a] = bh[a] ^ (~bh[b] & bh[c]);
        lo[a] = bl[a] ^ (~bl[b] & bl[c]);
      }
    }
    hi[0] ^= KECCAK.rcHi[round];
    lo[0] ^= KECCAK.rcLo[round];
  }
}

export function sha3Bytes(msg, bits) {
  const data = asBytes(msg);
  const rate = 200 - 2 * (bits / 8);
  const hi = new Uint32Array(25);
  const lo = new Uint32Array(25);
  const absorb = (buf, off) => {
    for (let i = 0; i < rate / 8; i++) {
      const p = off + i * 8;
      lo[i] ^= (buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16) | (buf[p + 3] << 24));
      hi[i] ^= (buf[p + 4] | (buf[p + 5] << 8) | (buf[p + 6] << 16) | (buf[p + 7] << 24));
    }
    keccakF(hi, lo);
  };
  const full = data.length - (data.length % rate);
  for (let off = 0; off < full; off += rate) absorb(data, off);
  const last = new Uint8Array(rate);
  last.set(data.subarray(full));
  last[data.length - full] ^= 0x06;
  last[rate - 1] ^= 0x80;
  absorb(last, 0);
  const out = new Uint8Array(bits / 8);
  for (let i = 0; i < out.length; i++) {
    const lane = i >> 3;
    const w = (i & 7) < 4 ? lo[lane] : hi[lane];
    out[i] = (w >>> (8 * (i & 3))) & 0xff;
  }
  return out;
}

// -------------------------------------------------------------- SHA-512 ----
const PRIMES = (() => {
  const p = [];
  for (let n = 2; p.length < 80; n++) if (p.every((q) => n % q)) p.push(n);
  return p;
})();

function iroot(n, k) {
  // floor(n^(1/k)) for BigInt
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / k) + 1);
  const kk = BigInt(k);
  for (;;) {
    const y = ((kk - 1n) * x + n / x ** (kk - 1n)) / kk;
    if (y >= x) return x;
    x = y;
  }
}

const M64 = (1n << 64n) - 1n;
const SHA512_K = PRIMES.map((p) => iroot(BigInt(p) << 192n, 3) & M64);
const SHA512_IV = PRIMES.slice(0, 8).map((p) => iroot(BigInt(p) << 128n, 2) & M64);

function sha512Raw(msg, iv) {
  const data = asBytes(msg);
  const H = new Uint32Array(16);
  iv.forEach((v, i) => { H[2 * i] = Number(v >> 32n); H[2 * i + 1] = Number(v & 0xffffffffn); });
  const KH = SHA512_K.map((v) => Number(v >> 32n));
  const KL = SHA512_K.map((v) => Number(v & 0xffffffffn));
  const W = new Uint32Array(160);
  let rh = 0;
  let rl = 0;
  const rotr = (h, l, n) => {
    if (n < 32) { rh = ((h >>> n) | (l << (32 - n))) >>> 0; rl = ((l >>> n) | (h << (32 - n))) >>> 0; }
    else { const m = n - 32; rh = ((l >>> m) | (h << (32 - m))) >>> 0; rl = ((h >>> m) | (l << (32 - m))) >>> 0; }
  };
  const bigSigma = (h, l, a, b, c) => {
    rotr(h, l, a); const h1 = rh; const l1 = rl;
    rotr(h, l, b); const h2 = rh; const l2 = rl;
    rotr(h, l, c); rh = (h1 ^ h2 ^ rh) >>> 0; rl = (l1 ^ l2 ^ rl) >>> 0;
  };
  const smallSigma = (h, l, a, b, s) => {
    rotr(h, l, a); const h1 = rh; const l1 = rl;
    rotr(h, l, b); const h2 = rh; const l2 = rl;
    const sh = h >>> s;
    const sl = ((l >>> s) | (h << (32 - s))) >>> 0;
    rh = (h1 ^ h2 ^ sh) >>> 0; rl = (l1 ^ l2 ^ sl) >>> 0;
  };
  const block = (buf, off) => {
    for (let i = 0; i < 32; i++) {
      const p = off + i * 4;
      W[i] = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      smallSigma(W[2 * (i - 15)], W[2 * (i - 15) + 1], 1, 8, 7); const s0h = rh; const s0l = rl;
      smallSigma(W[2 * (i - 2)], W[2 * (i - 2) + 1], 19, 61, 6); const s1h = rh; const s1l = rl;
      const lo = W[2 * (i - 16) + 1] + s0l + W[2 * (i - 7) + 1] + s1l;
      const hi = W[2 * (i - 16)] + s0h + W[2 * (i - 7)] + s1h + Math.floor(lo / 4294967296);
      W[2 * i] = hi >>> 0; W[2 * i + 1] = lo >>> 0;
    }
    let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
    let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
    for (let i = 0; i < 80; i++) {
      bigSigma(eh, el, 14, 18, 41); const S1h = rh; const S1l = rl;
      const chh = (eh & fh) ^ (~eh & gh);
      const chl = (el & fl) ^ (~el & gl);
      const t1l = hl + S1l + (chl >>> 0) + KL[i] + W[2 * i + 1];
      const t1h = hh + S1h + (chh >>> 0) + KH[i] + W[2 * i] + Math.floor(t1l / 4294967296);
      const T1l = t1l >>> 0; const T1h = t1h >>> 0;
      bigSigma(ah, al, 28, 34, 39); const S0h = rh; const S0l = rl;
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
      const mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      const t2l = S0l + (mjl >>> 0);
      const T2l = t2l >>> 0;
      const T2h = (S0h + (mjh >>> 0) + Math.floor(t2l / 4294967296)) >>> 0;
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      const nel = dl + T1l;
      eh = (dh + T1h + Math.floor(nel / 4294967296)) >>> 0; el = nel >>> 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      const nal = T1l + T2l;
      ah = (T1h + T2h + Math.floor(nal / 4294967296)) >>> 0; al = nal >>> 0;
    }
    const add = (idx, h, l) => {
      const lo = H[idx + 1] + l;
      H[idx] = (H[idx] + h + Math.floor(lo / 4294967296)) >>> 0;
      H[idx + 1] = lo >>> 0;
    };
    add(0, ah, al); add(2, bh, bl); add(4, ch, cl); add(6, dh, dl);
    add(8, eh, el); add(10, fh, fl); add(12, gh, gl); add(14, hh, hl);
  };
  const full = data.length - (data.length % 128);
  for (let off = 0; off < full; off += 128) block(data, off);
  const rem = data.length - full;
  const tailLen = rem < 112 ? 128 : 256;
  const tail = new Uint8Array(tailLen);
  tail.set(data.subarray(full));
  tail[rem] = 0x80;
  const bits = data.length * 8;
  const bh = Math.floor(bits / 4294967296);
  const bl = bits >>> 0;
  for (let i = 0; i < 4; i++) { tail[tailLen - 8 + i] = (bh >>> (24 - 8 * i)) & 0xff; tail[tailLen - 4 + i] = (bl >>> (24 - 8 * i)) & 0xff; }
  for (let off = 0; off < tailLen; off += 128) block(tail, off);
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) out[i * 4 + j] = (H[i] >>> (24 - 8 * j)) & 0xff;
  return out;
}

let iv256;
export function sha512_256Bytes(msg) {
  if (!iv256) {
    const modified = SHA512_IV.map((v) => v ^ 0xa5a5a5a5a5a5a5a5n);
    const d = sha512Raw(enc.encode('SHA-512/256'), modified);
    iv256 = [];
    for (let i = 0; i < 8; i++) {
      let v = 0n;
      for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(d[i * 8 + j]);
      iv256.push(v);
    }
  }
  return sha512Raw(msg, iv256).subarray(0, 32);
}

// ------------------------------------------------------------ checksums ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  const d = asBytes(bytes);
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC_TABLE[(c ^ d[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes) {
  const d = asBytes(bytes);
  let a = 1;
  let b = 0;
  for (let i = 0; i < d.length; i++) {
    a = (a + d[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const hex32 = (n) => (n >>> 0).toString(16).padStart(8, '0');

/** NTLM = MD4 of the UTF-16LE encoding of the text. */
export function ntlmHex(text) {
  const s = String(text);
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  }
  return md4Hex(out);
}

// ----------------------------------------------------------- algorithms ----
// block = HMAC block size in bytes. hmac:false = unkeyed-only.
export const ALGORITHMS = [
  { id: 'MD5', bits: 128, block: 64, hmac: true },
  { id: 'SHA-1', bits: 160, block: 64, hmac: true },
  { id: 'SHA-224', bits: 224, block: 64, hmac: true },
  { id: 'SHA-256', bits: 256, block: 64, hmac: true },
  { id: 'SHA-384', bits: 384, block: 128, hmac: true },
  { id: 'SHA-512', bits: 512, block: 128, hmac: true },
  { id: 'SHA-512/256', bits: 256, block: 128, hmac: true },
  { id: 'SHA3-224', bits: 224, block: 144, hmac: true },
  { id: 'SHA3-256', bits: 256, block: 136, hmac: true },
  { id: 'SHA3-384', bits: 384, block: 104, hmac: true },
  { id: 'SHA3-512', bits: 512, block: 72, hmac: true },
  { id: 'RIPEMD-160', bits: 160, block: 64, hmac: true },
  { id: 'MD4', bits: 128, block: 64, hmac: false },
  { id: 'CRC-32', bits: 32, hmac: false },
  { id: 'Adler-32', bits: 32, hmac: false },
];
export const HMAC_ALGORITHMS = ALGORITHMS.filter((a) => a.hmac).map((a) => a.id);

const wa = (bytes) => CryptoJS.lib.WordArray.create(asBytes(bytes));
const WEBCRYPTO = new Set(['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']);

/** Raw digest bytes for an algorithm id. */
export async function digestBytes(id, msg) {
  const data = asBytes(msg);
  if (WEBCRYPTO.has(id) && globalThis.crypto?.subtle) {
    return new Uint8Array(await crypto.subtle.digest(id, data));
  }
  switch (id) {
    case 'MD5': return hexToBytes(md5Hex(data));
    case 'MD4': return hexToBytes(md4Hex(data));
    case 'SHA-1': return hexToBytes(CryptoJS.SHA1(wa(data)).toString());
    case 'SHA-256': return hexToBytes(CryptoJS.SHA256(wa(data)).toString());
    case 'SHA-384': return hexToBytes(CryptoJS.SHA384(wa(data)).toString());
    case 'SHA-512': return hexToBytes(CryptoJS.SHA512(wa(data)).toString());
    case 'SHA-224': return hexToBytes(CryptoJS.SHA224(wa(data)).toString());
    case 'RIPEMD-160': return hexToBytes(CryptoJS.RIPEMD160(wa(data)).toString());
    case 'SHA-512/256': return sha512_256Bytes(data);
    case 'SHA3-224': return sha3Bytes(data, 224);
    case 'SHA3-256': return sha3Bytes(data, 256);
    case 'SHA3-384': return sha3Bytes(data, 384);
    case 'SHA3-512': return sha3Bytes(data, 512);
    case 'CRC-32': return hexToBytes(hex32(crc32(data)));
    case 'Adler-32': return hexToBytes(hex32(adler32(data)));
    default: throw new Error(`Unknown algorithm: ${id}`);
  }
}

export async function digestHex(id, msg) {
  return toHex(await digestBytes(id, msg));
}

/** HMAC (RFC 2104) over any supported hash, with any key length (including empty). */
export async function hmacBytes(id, key, msg) {
  const algo = ALGORITHMS.find((a) => a.id === id);
  if (!algo || !algo.hmac) throw new Error(`HMAC is not defined for ${id}`);
  let k = asBytes(key);
  if (k.length > algo.block) k = await digestBytes(id, k);
  const ipad = new Uint8Array(algo.block).fill(0x36);
  const opad = new Uint8Array(algo.block).fill(0x5c);
  for (let i = 0; i < k.length; i++) { ipad[i] ^= k[i]; opad[i] ^= k[i]; }
  const data = asBytes(msg);
  const inner = new Uint8Array(ipad.length + data.length);
  inner.set(ipad); inner.set(data, ipad.length);
  const ih = await digestBytes(id, inner);
  const outer = new Uint8Array(opad.length + ih.length);
  outer.set(opad); outer.set(ih, opad.length);
  return digestBytes(id, outer);
}

export async function hmacHex(id, key, msg) {
  return toHex(await hmacBytes(id, key, msg));
}

/** Decode an HMAC key typed as text / hex / base64. Throws a readable Error. */
export function decodeKey(value, encoding = 'text') {
  const s = String(value ?? '');
  if (encoding === 'text') return enc.encode(s);
  if (encoding === 'hex') {
    const h = s.replace(/[\s:]|^0x/gi, '');
    if (h && !/^[0-9a-fA-F]+$/.test(h)) throw new Error('Key is not valid hex (use 0-9 and a-f only).');
    if (h.length % 2) throw new Error('Hex key has an odd number of digits.');
    return hexToBytes(h);
  }
  if (encoding === 'base64') {
    const b = s.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
    if (b && !/^[A-Za-z0-9+/]*={0,2}$/.test(b)) throw new Error('Key is not valid base64.');
    try {
      const bin = atob(b + '='.repeat((4 - (b.replace(/=+$/, '').length % 4)) % 4));
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch { throw new Error('Key is not valid base64.'); }
  }
  throw new Error(`Unknown key encoding: ${encoding}`);
}

/**
 * Compute every applicable digest. Returns [{ id, label, value, error? }].
 * With keyBytes (even empty), only HMAC-capable algorithms are returned, labelled
 * "HMAC-<algo>". `text` (string) enables the NTLM row; files never get one.
 */
export async function computeAll(bytes, { keyBytes = null, text = null } = {}) {
  const rows = [];
  for (const a of ALGORITHMS) {
    if (keyBytes && !a.hmac) continue;
    const label = keyBytes ? `HMAC-${a.id}` : a.id;
    try {
      const value = keyBytes ? await hmacHex(a.id, keyBytes, bytes) : await digestHex(a.id, bytes);
      rows.push({ id: a.id, label, value });
    } catch (e) {
      rows.push({ id: a.id, label, value: '', error: e.message || String(e) });
    }
    if (!keyBytes && a.id === 'MD4' && typeof text === 'string') {
      rows.push({ id: 'NTLM', label: 'NTLM', value: ntlmHex(text) });
    }
  }
  return rows;
}

// ------------------------------------------------------------ verification ----
/** Strip whitespace/colons/0x, lowercase. Returns '' when not a hex string. */
export function normalizeDigest(input) {
  const s = String(input ?? '').trim().replace(/^0x/i, '').replace(/[\s:]/g, '').toLowerCase();
  return /^[0-9a-f]+$/.test(s) && s.length % 2 === 0 ? s : '';
}

/** Candidate algorithm ids from the digest length. */
export function detectAlgorithms(input) {
  const hex = normalizeDigest(input);
  if (!hex) return [];
  const ids = ALGORITHMS.filter((a) => a.bits / 4 === hex.length).map((a) => a.id);
  if (hex.length === 32) ids.push('NTLM');
  return ids;
}

/** 'match' | 'mismatch' | null (row not comparable: different length). */
export function compareDigest(value, expected) {
  const e = normalizeDigest(expected);
  if (!e || !value) return null;
  if (e.length !== value.length) return null;
  return e === value.toLowerCase() ? 'match' : 'mismatch';
}

/** "<hash>  <name>" lines, as consumed by sha256sum -c and friends. */
export function formatSums(entries) {
  return entries.map((e) => `${e.value}  ${e.name}`).join('\n') + (entries.length ? '\n' : '');
}

export function sumsFileName(id) {
  return `${id.replace(/[-/]/g, '')}SUMS`;
}
