/**
 * Simple checksums and sums. Each returns an unsigned integer of the stated width.
 * Words for Fletcher-32 and the Internet checksum are 16-bit; the Fletcher-32 variant reads
 * them big-endian and little-endian, since both conventions are in use.
 */

export const SIMPLE_SUMS = Object.freeze([
  { name: 'Sum-8', width: 8, fn: sum8 },
  { name: 'Sum-16', width: 16, fn: sum16 },
  { name: 'XOR-8', width: 8, fn: xor8 },
  { name: 'LRC (two\'s complement of Sum-8)', width: 8, fn: lrc },
  { name: 'Fletcher-16', width: 16, fn: fletcher16 },
  { name: 'Fletcher-32 (BE words)', width: 32, fn: (b) => fletcher32(b, 'be') },
  { name: 'Fletcher-32 (LE words)', width: 32, fn: (b) => fletcher32(b, 'le') },
  { name: 'Adler-32', width: 32, fn: adler32 },
  { name: 'Internet checksum (RFC 1071)', width: 16, fn: internetChecksum },
]);

export function sum8(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + b) & 0xff;
  return s;
}

export function sum16(bytes) {
  let s = 0;
  for (const b of bytes) s = (s + b) & 0xffff;
  return s;
}

export function xor8(bytes) {
  let x = 0;
  for (const b of bytes) x ^= b;
  return x & 0xff;
}

export function lrc(bytes) {
  return (0x100 - sum8(bytes)) & 0xff;
}

/** Fletcher-16: returns (sum2 << 8) | sum1 */
export function fletcher16(bytes) {
  let a = 0;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 255;
    b = (b + a) % 255;
  }
  return (b << 8) | a;
}

/** Fletcher-32 over 16-bit words; returns sum2 * 65536 + sum1 (fits in a Number). */
export function fletcher32(bytes, order = 'be') {
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const lo = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const word = order === 'le' ? bytes[i] | (lo << 8) : (bytes[i] << 8) | lo;
    s1 = (s1 + word) % 65535;
    s2 = (s2 + s1) % 65535;
  }
  return s2 * 65536 + s1;
}

/** Adler-32: returns B * 65536 + A. */
export function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return b * 65536 + a;
}

/** RFC 1071 Internet checksum: one's-complement sum of big-endian 16-bit words, then complemented. */
export function internetChecksum(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 2) {
    const word = (bytes[i] << 8) | (i + 1 < bytes.length ? bytes[i + 1] : 0);
    sum += word;
  }
  while (sum > 0xffff) sum = (sum & 0xffff) + Math.floor(sum / 65536);
  return (~sum) & 0xffff;
}
