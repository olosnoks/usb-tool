// Byte helpers standing in for Python `bytes` operations in the usb-rea port.

/** Lowercase hex, no separator (Python bytes.hex()). Pass sep for bytes.hex(' '). */
export function hex(b, sep = '') {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(sep);
}

/** bytes.fromhex: ignores whitespace. */
export function fromHex(s) {
  const clean = s.replace(/\s+/g, '');
  if (clean.length % 2) throw new Error('odd-length hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) throw new Error(`bad hex at ${i * 2}`);
    out[i] = v;
  }
  return out;
}

export function eq(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function concat(...parts) {
  return concatAll(parts);
}

/** concat() for an array of chunks: no argument spreading, so it is safe for thousands of chunks. */
export function concatAll(parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function startsWith(b, prefix) {
  if (prefix.length > b.length) return false;
  for (let i = 0; i < prefix.length; i++) if (b[i] !== prefix[i]) return false;
  return true;
}

/** Python bytes.find(sub, start). */
export function indexOf(b, sub, start = 0) {
  outer: for (let i = start; i <= b.length - sub.length; i++) {
    for (let j = 0; j < sub.length; j++) if (b[i + j] !== sub[j]) continue outer;
    return i;
  }
  return -1;
}

/** Read an unsigned/signed integer like int.from_bytes(d[off:off+width], endian, signed=...). */
export function readInt(d, off, width, endian = 'little', signed = false) {
  let v = 0n;
  for (let i = 0; i < width; i++) {
    const byte = BigInt(d[off + (endian === 'little' ? width - 1 - i : i)] ?? 0);
    v = (v << 8n) | byte;
  }
  if (signed && width > 0 && v >= 1n << BigInt(width * 8 - 1)) v -= 1n << BigInt(width * 8);
  return Number(v);
}

/** int.to_bytes(width, endian, signed=...) written into d at off. */
export function writeInt(d, off, width, v, endian = 'little') {
  let x = BigInt.asUintN(width * 8, BigInt(Math.round(v)));
  for (let i = 0; i < width; i++) {
    const idx = endian === 'little' ? off + i : off + width - 1 - i;
    d[idx] = Number(x & 0xffn);
    x >>= 8n;
  }
}

export function ascii(s) {
  return new TextEncoder().encode(s);
}
