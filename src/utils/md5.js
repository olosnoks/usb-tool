// Compact, dependency-free MD5 (RFC 1321) for the Hash calculator — the Web
// Crypto API does not provide MD5. Operates on a Uint8Array and returns a lower-
// case hex digest. MD5 is cryptographically broken; it is offered only for
// checksums / interop, not for security.

function toHexLE(n) {
  let s = '';
  for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0');
  return s;
}

export function md5Hex(bytes) {
  const msg = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const origLenBits = msg.length * 8;

  // padding to 448 mod 512, then 64-bit length
  const withPad = ((msg.length + 8) >> 6) + 1;
  const total = withPad * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // little-endian 64-bit length (low 32 bits + high 32 bits)
  const lenLo = origLenBits >>> 0;
  const lenHi = Math.floor(origLenBits / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i++) buf[total - 8 + i] = (lenLo >>> (i * 8)) & 0xff;
  for (let i = 0; i < 4; i++) buf[total - 4 + i] = (lenHi >>> (i * 8)) & 0xff;

  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = [];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (x, c) => ((x << c) | (x >>> (32 - c))) >>> 0;

  const M = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      M[i] = (buf[off + i * 4]) | (buf[off + i * 4 + 1] << 8) | (buf[off + i * 4 + 2] << 16) | (buf[off + i * 4 + 3] << 24);
    }
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F; let g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[(Math.floor(i / 16) * 4) + (i % 4)])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return toHexLE(a0) + toHexLE(b0) + toHexLE(c0) + toHexLE(d0);
}
