// Pure helpers for the ESP flash dump tool: number parsing, MD5 / SHA-256
// digests of a finished dump, hex preview, printable-string extraction and an
// equivalent esptool.py command line.

/** Parse "0x9000", "9000h" or a decimal string into a non-negative integer, else NaN. */
export function parseOffset(text) {
  const s = String(text ?? '').trim();
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  if (/^[0-9a-f]+h$/i.test(s)) return parseInt(s.slice(0, -1), 16);
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  return NaN;
}

/** Parse a size: "20480", "0x5000", "20K", "4M" (K/M are 1024-based). NaN when invalid. */
export function parseSize(text) {
  const s = String(text ?? '').trim();
  const m = /^(\d+)\s*([kKmM])(?:i?[bB])?$/.exec(s);
  if (m) return Number(m[1]) * (m[2].toLowerCase() === 'k' ? 1024 : 1048576);
  return parseOffset(s);
}

/** Warnings (not errors) for a dump range: erase-sector alignment and flash bounds. */
export function rangeWarnings(offset, length, flashSize) {
  const out = [];
  if (!Number.isFinite(offset) || !(length > 0)) return out;
  if (offset % 4096 !== 0) out.push('Offset is not aligned to a 4 KB flash sector.');
  if (length % 4 !== 0) out.push('Size is not a multiple of 4 bytes.');
  if (flashSize && offset + length > flashSize) out.push('Range runs past the detected flash size.');
  return out;
}

/** Equivalent esptool.py command (for the CLI; this tool does not run it). */
export function esptoolReadCommand({ offset, length, baud = 115200, port = '<PORT>', file }) {
  const hex = (n) => `0x${n.toString(16)}`;
  const name = file || `dump_${hex(offset)}_${length}.bin`;
  return `esptool.py --chip auto --port ${port} --baud ${baud} read_flash ${hex(offset)} ${hex(length)} ${name}`;
}

const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0);
const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

/** MD5 (esptool prints MD5 for read_flash, so dumps can be compared with it). Returns lowercase hex. */
export function md5Hex(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) << 6) + 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, (len * 8) >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(len / 536870912) >>> 0, true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      const r = i >> 4;
      if (r === 0) { F = (B & C) | (~B & D); g = i; }
      else if (r === 1) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (r === 2) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      const sh = S[(r << 2) | (i & 3)];
      B = (B + ((F << sh) | (F >>> (32 - sh)))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((v, i) => odv.setUint32(i * 4, v, true));
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex via Web Crypto; null when unavailable. */
export async function sha256Hex(data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Classic hexdump rows for bytes[start, start+count): { offset, hex, ascii }. */
export function hexRows(bytes, baseOffset = 0, start = 0, count = 256, width = 16) {
  const rows = [];
  const end = Math.min(bytes.length, start + count);
  for (let i = start; i < end; i += width) {
    const chunk = bytes.subarray(i, Math.min(i + width, end));
    rows.push({
      offset: baseOffset + i,
      hex: Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' '),
      ascii: Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')
    });
  }
  return rows;
}

/** Printable ASCII runs of at least minLen bytes (like `strings`): [{ offset, text }], capped at `max`. */
export function extractStrings(bytes, baseOffset = 0, minLen = 6, max = 500) {
  const out = [];
  let start = -1;
  const flush = (end) => {
    if (start >= 0 && end - start >= minLen) {
      out.push({ offset: baseOffset + start, text: String.fromCharCode(...bytes.subarray(start, Math.min(end, start + 200))) });
    }
    start = -1;
  };
  for (let i = 0; i < bytes.length && out.length < max; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b < 0x7f) { if (start < 0) start = i; } else flush(i);
  }
  if (out.length < max) flush(bytes.length);
  return out;
}
