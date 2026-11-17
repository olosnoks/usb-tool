/**
 * streamHash.js — incremental MD5 and SHA-1 (WebCrypto has no streaming API and
 * no MD5), plus MultiHasher which feeds MD5 + SHA-1 + SHA-256 in one pass so a
 * disk image is read once. MD5 and SHA-1 are offered because forensic reports
 * conventionally quote them; they are not collision resistant, so SHA-256 is
 * the one to trust.
 */
import { Sha256 } from './diskImage';

const rotl = (x, n) => (x << n) | (x >>> (32 - n));

class BlockHash {
  constructor() { this.buf = new Uint8Array(64); this.bufLen = 0; this.total = 0; }

  update(data) {
    let i = 0;
    this.total += data.length;
    if (this.bufLen) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen < 64) return this;
      this._block(this.buf, 0);
      this.bufLen = 0;
    }
    for (; i + 64 <= data.length; i += 64) this._block(data, i);
    this.buf.set(data.subarray(i), 0);
    this.bufLen = data.length - i;
    return this;
  }

  _finish(littleEndianLength) {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8);
    pad[0] = 0x80;
    const dv = new DataView(pad.buffer);
    const hi = Math.floor(bits / 2 ** 32);
    const lo = bits >>> 0;
    if (littleEndianLength) { dv.setUint32(pad.length - 8, lo, true); dv.setUint32(pad.length - 4, hi, true); }
    else { dv.setUint32(pad.length - 8, hi); dv.setUint32(pad.length - 4, lo); }
    const total = this.total;
    this.update(pad);
    this.total = total;
  }
}

const SHIFTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
];
const MD5_K = new Uint32Array(64).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

export class Md5 extends BlockHash {
  constructor() { super(); this.h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]); this.m = new Uint32Array(16); }

  _block(b, o) {
    const m = this.m;
    for (let i = 0; i < 16; i++) m[i] = b[o + i * 4] | (b[o + i * 4 + 1] << 8) | (b[o + i * 4 + 2] << 16) | (b[o + i * 4 + 3] << 24);
    const H0 = this.h; let a = H0[0], bb = H0[1], c = H0[2], d = H0[3];
    for (let i = 0; i < 64; i++) {
      let f; let g;
      if (i < 16) { f = (bb & c) | (~bb & d); g = i; }
      else if (i < 32) { f = (d & bb) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = bb ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (bb | ~d); g = (7 * i) % 16; }
      f = (f + a + MD5_K[i] + m[g]) | 0;
      a = d; d = c; c = bb;
      bb = (bb + rotl(f, SHIFTS[i])) | 0;
    }
    this.h[0] += a; this.h[1] += bb; this.h[2] += c; this.h[3] += d;
  }

  hex() {
    this._finish(true);
    return Array.from(this.h, (x) => [0, 8, 16, 24].map((s) => ((x >>> s) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
  }
}

export class Sha1 extends BlockHash {
  constructor() { super(); this.h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]); this.w = new Uint32Array(80); }

  _block(b, o) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    const H0 = this.h; let a = H0[0], bb = H0[1], c = H0[2], d = H0[3], e = H0[4];
    for (let i = 0; i < 80; i++) {
      let f; let k;
      if (i < 20) { f = (bb & c) | (~bb & d); k = 0x5a827999; }
      else if (i < 40) { f = bb ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (bb & c) | (bb & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = bb ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rotl(bb, 30); bb = a; a = t;
    }
    this.h[0] += a; this.h[1] += bb; this.h[2] += c; this.h[3] += d; this.h[4] += e;
  }

  hex() {
    this._finish(false);
    return Array.from(this.h, (x) => x.toString(16).padStart(8, '0')).join('');
  }
}

/** MD5 + SHA-1 + SHA-256 fed in one pass. hex() returns { md5, sha1, sha256 }. */
export class MultiHasher {
  constructor() { this.md5 = new Md5(); this.sha1 = new Sha1(); this.sha256 = new Sha256(); }
  update(data) { this.md5.update(data); this.sha1.update(data); this.sha256.update(data); return this; }
  hex() { return { md5: this.md5.hex(), sha1: this.sha1.hex(), sha256: this.sha256.hex() }; }
}
