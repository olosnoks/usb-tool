// Compact, dependency-free MD4 (RFC 1320). Needed for NTLM hashing (MD4 of the
// UTF-16LE password); the Web Crypto API does not provide MD4. MD4 is
// cryptographically broken — offered only for interop / password-audit use.

function toHexLE(n) {
  let s = '';
  for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return s;
}

export function md4Hex(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const origLenBits = msg.length * 8;
  const withPad = ((msg.length + 8) >> 6) + 1;
  const total = withPad * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const lenLo = origLenBits >>> 0;
  const lenHi = Math.floor(origLenBits / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i++) buf[total - 8 + i] = (lenLo >>> (i * 8)) & 0xff;
  for (let i = 0; i < 4; i++) buf[total - 4 + i] = (lenHi >>> (i * 8)) & 0xff;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (x, c) => ((x << c) | (x >>> (32 - c))) >>> 0;
  const X = new Int32Array(16);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      X[i] = (buf[off + i * 4]) | (buf[off + i * 4 + 1] << 8) | (buf[off + i * 4 + 2] << 16) | (buf[off + i * 4 + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    const FF = (a, b, c, d, k, s) => rotl((a + (((b & c) | (~b & d)) >>> 0) + (X[k] >>> 0)) >>> 0, s);
    const GG = (a, b, c, d, k, s) => rotl((a + (((b & c) | (b & d) | (c & d)) >>> 0) + (X[k] >>> 0) + 0x5a827999) >>> 0, s);
    const HH = (a, b, c, d, k, s) => rotl((a + ((b ^ c ^ d) >>> 0) + (X[k] >>> 0) + 0x6ed9eba1) >>> 0, s);

    // Round 1
    const r1 = [3, 7, 11, 19];
    for (let i = 0; i < 16; i += 4) {
      A = FF(A, B, C, D, i, r1[0]); D = FF(D, A, B, C, i + 1, r1[1]); C = FF(C, D, A, B, i + 2, r1[2]); B = FF(B, C, D, A, i + 3, r1[3]);
    }
    // Round 2
    const r2 = [3, 5, 9, 13];
    for (let i = 0; i < 4; i++) {
      A = GG(A, B, C, D, i, r2[0]); D = GG(D, A, B, C, i + 4, r2[1]); C = GG(C, D, A, B, i + 8, r2[2]); B = GG(B, C, D, A, i + 12, r2[3]);
    }
    // Round 3
    const r3 = [3, 9, 11, 15];
    const order3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let i = 0; i < 16; i += 4) {
      A = HH(A, B, C, D, order3[i], r3[0]); D = HH(D, A, B, C, order3[i + 1], r3[1]); C = HH(C, D, A, B, order3[i + 2], r3[2]); B = HH(B, C, D, A, order3[i + 3], r3[3]);
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}
