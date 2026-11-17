/**
 * Firmware File Converter & Inspector: pure, offline codecs.
 *
 * Input:  raw .bin (with a base address), Intel HEX (types 00-05), Motorola S-record
 *         (S0-S9), UF2 (512-byte blocks), ELF32/ELF64 (PT_LOAD segments, p_paddr).
 * Output: raw .bin, Intel HEX (type 04 extended linear address, type 05 start),
 *         Motorola S-record (S1/S2/S3 data, S7/S8/S9 entry), UF2 (family ID flag).
 *
 * Internal model ("image"):
 *   { segments: [{ address, data: Uint8Array }],   // sorted, non-overlapping, merged when adjacent
 *     startAddress: number | null,                 // entry / start address if the source had one
 *     startKind: 'entry' | 'EIP' | 'CS:IP' | null,
 *     meta: { format, filename, familyIds: number[], uf2Blocks: [...] | null, srecHeader },
 *     warnings: string[],
 *     overlapBytes: number }
 *
 * Everything here is synchronous and has no DOM or React dependency so it can be unit
 * tested with Vitest. CRC-32 and SHA-256 are implemented here (no dependencies).
 */

export class FirmwareError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FirmwareError';
  }
}

export const FORMAT_INFO = {
  bin: { label: 'Raw binary (.bin)', ext: 'bin', mime: 'application/octet-stream', input: true, output: true, hasStart: false },
  hex: { label: 'Intel HEX (.hex)', ext: 'hex', mime: 'text/plain', input: true, output: true, hasStart: true },
  srec: { label: 'Motorola S-record (.srec / .s19)', ext: 'srec', mime: 'text/plain', input: true, output: true, hasStart: true },
  uf2: { label: 'UF2 (.uf2)', ext: 'uf2', mime: 'application/octet-stream', input: true, output: true, hasStart: false },
  elf: { label: 'ELF32 / ELF64 (.elf)', ext: 'elf', mime: 'application/octet-stream', input: true, output: false, hasStart: true },
};
export const OUTPUT_FORMATS = ['bin', 'hex', 'srec', 'uf2'];

// UF2 constants (Microsoft UF2 specification)
export const UF2_MAGIC0 = 0x0a324655;
export const UF2_MAGIC1 = 0x9e5d5157;
export const UF2_MAGIC_END = 0x0ab16f30;
export const UF2_BLOCK_SIZE = 512;
export const UF2_MAX_PAYLOAD = 476;
export const UF2_FLAG_NOT_MAIN_FLASH = 0x00000001;
export const UF2_FLAG_FILE_CONTAINER = 0x00001000;
export const UF2_FLAG_FAMILY_ID = 0x00002000;
export const UF2_FLAG_MD5 = 0x00004000;
export const UF2_FLAG_EXTENSION_TAGS = 0x00008000;

/**
 * Known UF2 family IDs. Hand-entered from the UF2 family list; check against the
 * upstream microsoft/uf2 family table before relying on an entry for a flash.
 * Any other ID can be typed in as hex.
 */
export const UF2_FAMILIES = [
  { id: 0xe48bff56, name: 'RP2040' },
  { id: 0xe48bff59, name: 'RP2350 (ARM Secure)' },
  { id: 0xe48bff5a, name: 'RP2350 (RISC-V)' },
  { id: 0xe48bff5b, name: 'RP2350 (ARM Non-secure)' },
  { id: 0xada52840, name: 'nRF52840' },
  { id: 0x68ed2b88, name: 'SAMD21' },
  { id: 0x55114460, name: 'SAMD51' },
  { id: 0xbfdd4eee, name: 'ESP32-S2' },
  { id: 0xc47e5767, name: 'ESP32-S3' },
  { id: 0x57755a57, name: 'STM32F4' },
];

/** Largest address span that will be expanded into a flat buffer (gap filling, digests). */
export const MAX_SPAN = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const hex2 = (n) => (n & 0xff).toString(16).padStart(2, '0').toUpperCase();
const hexN = (n, width) => n.toString(16).padStart(width, '0').toUpperCase();
const hexAddr = (n) => `0x${hexN(n, n > 0xffffffff ? 16 : 8)}`;

function encodeText(s) {
  return new TextEncoder().encode(s);
}

function decodeText(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Parse a string such as "0x08000000", "134217728", "-0x100" into a safe integer. */
export function parseNumber(text) {
  const s = String(text ?? '').trim().replace(/_/g, '');
  if (!s) throw new FirmwareError('Enter a number');
  let sign = 1;
  let body = s;
  if (body[0] === '-') { sign = -1; body = body.slice(1); } else if (body[0] === '+') body = body.slice(1);
  let v;
  if (/^0x[0-9a-f]+$/i.test(body)) v = parseInt(body.slice(2), 16);
  else if (/^[0-9]+$/.test(body)) v = parseInt(body, 10);
  else throw new FirmwareError(`Not a number: "${text}" (use decimal or 0x-prefixed hex)`);
  if (!Number.isSafeInteger(v * sign)) throw new FirmwareError(`Number out of range: "${text}"`);
  return sign * v;
}

const HEX_RE = /^(?:[0-9a-fA-F]{2})+$/;
function hexToBytes(str) {
  const out = new Uint8Array(str.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(str.substr(i * 2, 2), 16);
  return out;
}

function readBE(bytes, offset, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + bytes[offset + i];
  return v;
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) and SHA-256 (FIPS 180-4)
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** @returns {number} unsigned 32-bit CRC-32 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** @returns {string} lowercase hex SHA-256 digest */
export function sha256Hex(bytes) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = bytes.length;
  const padLen = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(padLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padLen - 4, bitLen >>> 0);
  const W = new Uint32Array(64);
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + W[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += hexN(H[i] >>> 0, 8).toLowerCase();
  return out;
}

// ---------------------------------------------------------------------------
// Image model
// ---------------------------------------------------------------------------

/**
 * Turn (file-ordered) data chunks into sorted, non-overlapping segments.
 * Overlaps are resolved with last-write-wins (file order), like a programmer would.
 * @returns {{ segments: {address:number,data:Uint8Array}[], overlapBytes: number }}
 */
export function buildSegments(chunks) {
  const live = chunks.filter((c) => c.data.length > 0);
  const sorted = live.slice().sort((a, b) => a.address - b.address);

  // Pass 1: count overlaps in address order.
  let overlapBytes = 0;
  let reach = -Infinity;
  for (const c of sorted) {
    if (c.address < reach) overlapBytes += Math.min(reach, c.address + c.data.length) - c.address;
    reach = Math.max(reach, c.address + c.data.length);
  }

  if (overlapBytes > 0) {
    // Rare path: resolve byte by byte in file order so the last write wins.
    const map = new Map();
    for (const c of live) for (let k = 0; k < c.data.length; k++) map.set(c.address + k, c.data[k]);
    const keys = [...map.keys()].sort((a, b) => a - b);
    const segments = [];
    let i = 0;
    while (i < keys.length) {
      const start = keys[i];
      let j = i;
      while (j + 1 < keys.length && keys[j + 1] === keys[j] + 1) j++;
      const data = new Uint8Array(j - i + 1);
      for (let k = i; k <= j; k++) data[k - i] = map.get(keys[k]);
      segments.push({ address: start, data });
      i = j + 1;
    }
    return { segments, overlapBytes };
  }

  // Common path: concatenate contiguous chunks.
  const groups = [];
  let cur = null;
  for (const c of sorted) {
    if (cur && c.address === cur.end) {
      cur.parts.push(c.data);
      cur.end += c.data.length;
    } else {
      if (cur) groups.push(cur);
      cur = { address: c.address, end: c.address + c.data.length, parts: [c.data] };
    }
  }
  if (cur) groups.push(cur);
  const segments = groups.map((g) => {
    const data = new Uint8Array(g.end - g.address);
    let o = 0;
    for (const p of g.parts) { data.set(p, o); o += p.length; }
    return { address: g.address, data };
  });
  return { segments, overlapBytes: 0 };
}

function makeImage({ chunks, startAddress = null, startKind = null, meta = {}, warnings = [] }) {
  const { segments, overlapBytes } = buildSegments(chunks);
  const w = [...warnings];
  if (overlapBytes > 0) w.push(`${overlapBytes} byte(s) are written more than once (overlap); the last write wins`);
  return {
    segments,
    startAddress: startAddress ?? null,
    startKind: startAddress == null ? null : startKind,
    meta: { format: null, filename: '', familyIds: [], uf2Blocks: null, srecHeader: null, ...meta },
    warnings: w,
    overlapBytes,
  };
}

/** @returns {{start:number,end:number,size:number}} end is exclusive */
export function imageSpan(image) {
  const segs = image.segments;
  if (!segs.length) return { start: 0, end: 0, size: 0 };
  const start = segs[0].address;
  const last = segs[segs.length - 1];
  const end = last.address + last.data.length;
  return { start, end, size: end - start };
}

/** Flatten an image into one buffer from its first to last byte; gaps get `fill`. */
export function flatten(image, fill = 0xff) {
  const { start, size } = imageSpan(image);
  if (size > MAX_SPAN) {
    throw new FirmwareError(`Address span ${size} bytes is too large to expand (limit ${MAX_SPAN} bytes)`);
  }
  const out = new Uint8Array(size).fill(fill & 0xff);
  for (const s of image.segments) out.set(s.data, s.address - start);
  return out;
}

/** @returns {{start:number,end:number,size:number}[]} the holes between segments */
export function gapsOf(image) {
  const gaps = [];
  for (let i = 1; i < image.segments.length; i++) {
    const prev = image.segments[i - 1];
    const prevEnd = prev.address + prev.data.length;
    const next = image.segments[i].address;
    if (next > prevEnd) gaps.push({ start: prevEnd, end: next, size: next - prevEnd });
  }
  return gaps;
}

/** Resolve UF2 family for output. 'auto' keeps the source family when there is exactly one. */
export function resolveFamily(family, image) {
  if (family === undefined || family === null || family === 'auto') {
    const fams = image.meta?.familyIds ?? [];
    return fams.length === 1 ? fams[0] : null;
  }
  if (family === 'none') return null;
  if (typeof family === 'number') {
    if (!Number.isInteger(family) || family < 0 || family > 0xffffffff) throw new FirmwareError('UF2 family ID must be a 32-bit value');
    return family;
  }
  throw new FirmwareError(`Unknown UF2 family option: ${family}`);
}

/**
 * Inspector summary of an image: segment map, gaps, digests, start address, warnings.
 * CRC-32 and SHA-256 are over the flattened image (gaps = 0xFF, like a default .bin),
 * or over the data bytes only when the span is too large to flatten.
 */
export function describeImage(image) {
  const { start, end, size } = imageSpan(image);
  const dataBytes = image.segments.reduce((n, s) => n + s.data.length, 0);
  const gaps = gapsOf(image);
  let basis = 'none';
  let flat = new Uint8Array(0);
  if (size > 0 && size <= MAX_SPAN) {
    flat = flatten(image, 0xff);
    basis = 'flattened image (gaps = 0xFF)';
  } else if (size > 0) {
    flat = new Uint8Array(dataBytes);
    let o = 0;
    for (const s of image.segments) { flat.set(s.data, o); o += s.data.length; }
    basis = 'data bytes only (span too large to flatten)';
  }
  return {
    segmentCount: image.segments.length,
    dataBytes,
    start,
    end,
    span: size,
    gaps,
    gapBytes: gaps.reduce((n, g) => n + g.size, 0),
    crc32: hexN(crc32(flat), 8),
    sha256: flat.length ? sha256Hex(flat) : '',
    digestBasis: basis,
    startAddress: image.startAddress,
    startKind: image.startKind,
    familyIds: image.meta?.familyIds ?? [],
    uf2Blocks: image.meta?.uf2Blocks ?? null,
    format: image.meta?.format ?? null,
    warnings: image.warnings,
  };
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

/** Sniff the format from content (UF2/ELF magic, then text-line starts). Falls back to bin. */
export function detectFormat(bytes) {
  if (bytes.length >= 4) {
    const m = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
    if (m === UF2_MAGIC0) return 'uf2';
  }
  if (bytes.length >= 52 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'elf';
  let p = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const end = Math.min(bytes.length, 512);
  let textLike = true;
  for (let i = p; i < end; i++) {
    const b = bytes[i];
    if (!(b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127))) { textLike = false; break; }
  }
  if (textLike) {
    const s = decodeText(bytes.subarray(p, end)).trimStart();
    if (s[0] === ':') return 'hex';
    if (/^S[0-9]/.test(s)) return 'srec';
  }
  return 'bin';
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

export function parseBinary(bytes, baseAddress = 0) {
  if (!Number.isSafeInteger(baseAddress) || baseAddress < 0) throw new FirmwareError('Base address must be a non-negative number');
  return { chunks: [{ address: baseAddress, data: bytes }] };
}

/**
 * Intel HEX reader. Record types 00 (data), 01 (EOF), 02 (extended segment address,
 * upper = value * 16), 03 (start CS:IP, stored as linear CS*16+IP), 04 (extended linear
 * address, upper = value << 16), 05 (start EIP). Any malformed record or checksum
 * mismatch throws with the line number.
 */
export function parseIntelHex(text) {
  const chunks = [];
  const warnings = [];
  let upper = 0;
  let start = null;
  let startKind = null;
  let eof = false;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    const lineNo = n + 1;
    if (eof) { warnings.push(`Data after the end-of-file record (line ${lineNo}) was ignored`); break; }
    if (line[0] !== ':') throw new FirmwareError(`Line ${lineNo}: Intel HEX records start with ':'`);
    const body = line.slice(1);
    if (!HEX_RE.test(body) || body.length < 10) throw new FirmwareError(`Line ${lineNo}: malformed record (expected hex digits)`);
    const bytes = hexToBytes(body);
    const count = bytes[0];
    if (bytes.length !== count + 5) throw new FirmwareError(`Line ${lineNo}: byte count ${count} does not match the record length`);
    let sum = 0;
    for (const b of bytes) sum += b;
    if ((sum & 0xff) !== 0) throw new FirmwareError(`Line ${lineNo}: checksum mismatch (record sum is 0x${hex2(sum)}, expected 0x00)`);
    const addr = (bytes[1] << 8) | bytes[2];
    const type = bytes[3];
    const data = bytes.subarray(4, 4 + count);
    switch (type) {
      case 0x00:
        chunks.push({ address: upper + addr, data });
        break;
      case 0x01:
        if (count !== 0) throw new FirmwareError(`Line ${lineNo}: EOF record must have no data`);
        eof = true;
        break;
      case 0x02:
        if (count !== 2) throw new FirmwareError(`Line ${lineNo}: type 02 needs 2 data bytes`);
        upper = readBE(data, 0, 2) * 16;
        break;
      case 0x03:
        if (count !== 4) throw new FirmwareError(`Line ${lineNo}: type 03 needs 4 data bytes`);
        start = readBE(data, 0, 2) * 16 + readBE(data, 2, 2);
        startKind = 'CS:IP';
        break;
      case 0x04:
        if (count !== 2) throw new FirmwareError(`Line ${lineNo}: type 04 needs 2 data bytes`);
        upper = readBE(data, 0, 2) * 65536;
        break;
      case 0x05:
        if (count !== 4) throw new FirmwareError(`Line ${lineNo}: type 05 needs 4 data bytes`);
        start = readBE(data, 0, 4);
        startKind = 'EIP';
        break;
      default:
        throw new FirmwareError(`Line ${lineNo}: unknown record type 0x${hex2(type)}`);
    }
  }
  if (!eof) warnings.push('No end-of-file record (:00000001FF) found; the file may be truncated');
  return { chunks, startAddress: start, startKind, warnings };
}

const SREC_ADDR_BYTES = { 0: 2, 1: 2, 2: 3, 3: 4, 5: 2, 6: 3, 7: 4, 8: 3, 9: 2 };

/**
 * Motorola S-record reader. S0 header (kept as meta), S1/S2/S3 data with 2/3/4-byte
 * addresses, S5/S6 counts (checked for presence only), S7/S8/S9 start address.
 * Each record's checksum (ones' complement of the byte sum) is verified.
 */
export function parseSrec(text) {
  const chunks = [];
  const warnings = [];
  let start = null;
  let header = null;
  const lines = text.split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    const lineNo = n + 1;
    if (!/^S[0-9]/.test(line)) throw new FirmwareError(`Line ${lineNo}: S-record lines start with S0-S9`);
    const type = Number(line[1]);
    const body = line.slice(2);
    if (!HEX_RE.test(body) || body.length < 4) throw new FirmwareError(`Line ${lineNo}: malformed record (expected hex digits)`);
    const bytes = hexToBytes(body);
    const count = bytes[0];
    if (bytes.length !== count + 1) throw new FirmwareError(`Line ${lineNo}: byte count ${count} does not match the record length`);
    let sum = 0;
    for (const b of bytes) sum += b;
    if ((sum & 0xff) !== 0xff) throw new FirmwareError(`Line ${lineNo}: checksum mismatch`);
    const addrBytes = SREC_ADDR_BYTES[type];
    if (addrBytes === undefined) throw new FirmwareError(`Line ${lineNo}: S${type} is reserved`);
    if (count < addrBytes + 1) throw new FirmwareError(`Line ${lineNo}: record too short for an S${type} address`);
    const addr = readBE(bytes, 1, addrBytes);
    const data = bytes.subarray(1 + addrBytes, bytes.length - 1);
    if (type === 0) header = decodeText(data);
    else if (type >= 1 && type <= 3) { if (data.length) chunks.push({ address: addr, data }); }
    else if (type >= 7) {
      if (start !== null) warnings.push(`Line ${lineNo}: more than one start record; the last one is used`);
      start = addr;
    }
  }
  return { chunks, startAddress: start, startKind: 'entry', header, warnings };
}

/** UF2 reader. Every block's magic is checked; the file is walked block by block. */
export function parseUF2(bytes) {
  if (!bytes.length || bytes.length % UF2_BLOCK_SIZE !== 0) {
    throw new FirmwareError(`UF2 length ${bytes.length} is not a multiple of 512 bytes`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const total = bytes.length / UF2_BLOCK_SIZE;
  const chunks = [];
  const blocks = [];
  const flagged = new Set();
  let unflagged = 0;
  let misaligned = 0;
  let notMain = 0;
  let md5 = 0;
  let exts = 0;
  let container = 0;
  let badSeq = 0;
  let badCount = 0;
  for (let b = 0; b < total; b++) {
    const o = b * UF2_BLOCK_SIZE;
    if (dv.getUint32(o, true) !== UF2_MAGIC0 || dv.getUint32(o + 4, true) !== UF2_MAGIC1 || dv.getUint32(o + 508, true) !== UF2_MAGIC_END) {
      throw new FirmwareError(`UF2 block ${b} (offset 0x${o.toString(16)}): bad magic numbers`);
    }
    const flags = dv.getUint32(o + 8, true);
    const target = dv.getUint32(o + 12, true);
    const payloadSize = dv.getUint32(o + 16, true);
    const blockNo = dv.getUint32(o + 20, true);
    const numBlocks = dv.getUint32(o + 24, true);
    const word28 = dv.getUint32(o + 28, true);
    if (payloadSize > UF2_MAX_PAYLOAD) throw new FirmwareError(`UF2 block ${b}: payload size ${payloadSize} exceeds 476`);
    const familyId = flags & UF2_FLAG_FAMILY_ID ? word28 : null;
    if (familyId !== null) flagged.add(familyId);
    else unflagged++;
    if (flags & UF2_FLAG_NOT_MAIN_FLASH) notMain++;
    if (flags & UF2_FLAG_MD5) md5++;
    if (flags & UF2_FLAG_EXTENSION_TAGS) exts++;
    if (flags & UF2_FLAG_FILE_CONTAINER) container++;
    if (target % 4 !== 0 || payloadSize % 4 !== 0) misaligned++;
    if (blockNo !== b) badSeq++;
    if (numBlocks !== total) badCount++;
    blocks.push({
      index: b, flags, targetAddress: target, payloadSize, blockNo, numBlocks,
      familyId, fileSize: familyId === null ? word28 : null,
    });
    chunks.push({ address: target, data: bytes.subarray(o + 32, o + 32 + payloadSize) });
  }
  const warnings = [];
  const fams = [...flagged].sort((a, b) => a - b);
  if (fams.length > 1) warnings.push(`Mixed families: ${fams.map(hexAddr).join(', ')}. Output will not carry a family ID unless you pick one`);
  if (fams.length >= 1 && unflagged > 0) warnings.push(`${unflagged} block(s) have no family ID flag`);
  if (misaligned) warnings.push(`${misaligned} block(s) misaligned (target address or payload size is not a multiple of 4)`);
  if (badSeq) warnings.push(`${badSeq} block(s) have a blockNo that does not match their position`);
  if (badCount) warnings.push(`${badCount} block(s) have a numBlocks field that does not match the file (${total} blocks)`);
  if (notMain) warnings.push(`${notMain} block(s) are flagged NotMainFlash (not for main flash); they are included`);
  if (md5) warnings.push(`${md5} block(s) set the MD5 flag; the MD5 extension is not verified`);
  if (exts) warnings.push(`${exts} block(s) carry extension tags; extension tags are not decoded`);
  if (container) warnings.push(`${container} block(s) are flagged as a file container; the container is not unpacked`);
  return { chunks, blocks, familyIds: fams, warnings };
}

/**
 * ELF reader: every PT_LOAD segment with a non-zero file size is copied from its file
 * offset to its physical load address (p_paddr). Zero-fill (memsz > filesz, .bss) is
 * not stored. The ELF entry point becomes the start address.
 */
export function parseElf(bytes) {
  if (bytes.length < 52 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    throw new FirmwareError('Not an ELF file');
  }
  const cls = bytes[4];
  if (cls !== 1 && cls !== 2) throw new FirmwareError('ELF class must be 32 or 64 bit');
  const le = bytes[5] === 1;
  if (bytes[5] !== 1 && bytes[5] !== 2) throw new FirmwareError('ELF data encoding must be little or big endian');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const u64 = (o) => (le ? u32(o) + u32(o + 4) * 2 ** 32 : u32(o) * 2 ** 32 + u32(o + 4));

  let entry, phoff, phentsize, phnum;
  if (cls === 1) { entry = u32(24); phoff = u32(28); phentsize = u16(42); phnum = u16(44); }
  else { entry = u64(24); phoff = u64(32); phentsize = u16(54); phnum = u16(56); }
  if (phnum === 0 || phoff === 0) throw new FirmwareError('ELF has no program headers (relocatable object?)');
  if (phoff + phnum * phentsize > bytes.length) throw new FirmwareError('ELF program header table is truncated');

  const chunks = [];
  const warnings = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    const pType = u32(o);
    if (pType !== 1) continue; // PT_LOAD only
    let pOffset, pPaddr, pFilesz, pMemsz;
    if (cls === 1) { pOffset = u32(o + 4); pPaddr = u32(o + 12); pFilesz = u32(o + 16); pMemsz = u32(o + 20); }
    else { pOffset = u64(o + 8); pPaddr = u64(o + 24); pFilesz = u64(o + 32); pMemsz = u64(o + 40); }
    if (pFilesz === 0) {
      if (pMemsz > 0) warnings.push(`PT_LOAD ${i}: ${pMemsz} byte(s) of zero-fill only; nothing stored`);
      continue;
    }
    if (pOffset + pFilesz > bytes.length) throw new FirmwareError(`PT_LOAD ${i} extends past the end of the file`);
    chunks.push({ address: pPaddr, data: bytes.subarray(pOffset, pOffset + pFilesz) });
    if (pMemsz > pFilesz) warnings.push(`PT_LOAD ${i}: ${pMemsz - pFilesz} byte(s) of zero-fill (.bss) not stored`);
  }
  if (!chunks.length) throw new FirmwareError('ELF has no PT_LOAD segments with data');
  return { chunks, startAddress: entry || null, startKind: 'entry', warnings };
}

/**
 * Parse any supported file. format: 'auto' | 'bin' | 'hex' | 'srec' | 'uf2' | 'elf'.
 * baseAddress applies to raw .bin only.
 */
export function parseFirmware(input, { format = 'auto', filename = '', baseAddress = 0 } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!bytes.length) throw new FirmwareError('The file is empty');
  const fmt = format === 'auto' || !format ? detectFormat(bytes) : format;
  let parsed;
  switch (fmt) {
    case 'bin': parsed = parseBinary(bytes, baseAddress); break;
    case 'hex': parsed = parseIntelHex(decodeText(bytes)); break;
    case 'srec': parsed = parseSrec(decodeText(bytes)); break;
    case 'uf2': parsed = parseUF2(bytes); break;
    case 'elf': parsed = parseElf(bytes); break;
    default: throw new FirmwareError(`Unknown input format: ${fmt}`);
  }
  return makeImage({
    chunks: parsed.chunks,
    startAddress: parsed.startAddress ?? null,
    startKind: parsed.startKind ?? null,
    meta: {
      format: fmt,
      filename,
      familyIds: parsed.familyIds ?? [],
      uf2Blocks: parsed.blocks ?? null,
      srecHeader: parsed.header ?? null,
    },
    warnings: parsed.warnings ?? [],
  });
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

/** Segments to write: the real ones, or one flat run when gaps are to be filled. */
function outputSegments(image, fillGaps, fill) {
  if (!image.segments.length) throw new FirmwareError('The image contains no data');
  if (!fillGaps) return image.segments;
  return [{ address: imageSpan(image).start, data: flatten(image, fill) }];
}

function checkRecordSize(n, max) {
  if (!Number.isInteger(n) || n < 1 || n > max) throw new FirmwareError(`Record size must be an integer from 1 to ${max}`);
}

/** Raw binary: always the full span from the first to the last byte, gaps filled with `fill`. */
export function writeBinary(image, { fill = 0xff } = {}) {
  if (!image.segments.length) throw new FirmwareError('The image contains no data');
  return flatten(image, fill);
}

/**
 * Intel HEX writer. Data records split at 64 KiB boundaries; type 04 is emitted whenever
 * the upper 16 bits change (starting from 0); type 05 carries the start address.
 */
export function writeIntelHex(image, { fillGaps = false, fill = 0xff, recordSize = 16 } = {}) {
  checkRecordSize(recordSize, 255);
  const segs = outputSegments(image, fillGaps, fill);
  const lines = [];
  const rec = (type, addr, data) => {
    const bytes = [data.length, (addr >>> 8) & 0xff, addr & 0xff, type];
    for (const b of data) bytes.push(b);
    let sum = 0;
    for (const b of bytes) sum += b;
    return ':' + bytes.map(hex2).join('') + hex2(-sum);
  };
  let upper = 0;
  for (const s of segs) {
    const last = s.address + s.data.length - 1;
    if (last > 0xffffffff) throw new FirmwareError('Intel HEX addresses are limited to 32 bits');
    let i = 0;
    while (i < s.data.length) {
      const a = s.address + i;
      const hi = Math.floor(a / 65536);
      if (hi !== upper) {
        lines.push(rec(0x04, 0, [(hi >>> 8) & 0xff, hi & 0xff]));
        upper = hi;
      }
      const off = a - hi * 65536;
      const n = Math.min(recordSize, s.data.length - i, 65536 - off);
      lines.push(rec(0x00, off, s.data.subarray(i, i + n)));
      i += n;
    }
  }
  if (image.startAddress !== null && image.startAddress !== undefined) {
    const sa = image.startAddress;
    if (sa < 0 || sa > 0xffffffff) throw new FirmwareError('Start address does not fit in 32 bits for Intel HEX');
    lines.push(rec(0x05, 0, [(sa >>> 24) & 0xff, (sa >>> 16) & 0xff, (sa >>> 8) & 0xff, sa & 0xff]));
  }
  lines.push(':00000001FF');
  return lines.join('\n') + '\n';
}

/**
 * Motorola S-record writer. Data type is chosen from the highest address used
 * (S1 up to 0xFFFF, S2 up to 0xFFFFFF, S3 above). The entry record matches the data type
 * (S9 / S8 / S7). An optional S0 header is written when `header` is set.
 */
export function writeSrec(image, { fillGaps = false, fill = 0xff, recordSize = 32, header = '' } = {}) {
  checkRecordSize(recordSize, 250);
  const segs = outputSegments(image, fillGaps, fill);
  const dataMax = segs.length ? segs[segs.length - 1].address + segs[segs.length - 1].data.length - 1 : 0;
  const maxAddr = Math.max(dataMax, image.startAddress ?? 0);
  let addrBytes;
  if (maxAddr <= 0xffff) addrBytes = 2;
  else if (maxAddr <= 0xffffff) addrBytes = 3;
  else if (maxAddr <= 0xffffffff) addrBytes = 4;
  else throw new FirmwareError('S-record addresses are limited to 32 bits');
  const dataType = addrBytes === 2 ? 1 : addrBytes === 3 ? 2 : 3;
  const endType = addrBytes === 2 ? 9 : addrBytes === 3 ? 8 : 7;

  const rec = (type, addr, nAddr, data) => {
    const bytes = [nAddr + data.length + 1];
    for (let k = nAddr - 1; k >= 0; k--) bytes.push(Math.floor(addr / 2 ** (8 * k)) & 0xff);
    for (const b of data) bytes.push(b);
    let sum = 0;
    for (const b of bytes) sum += b;
    return `S${type}` + bytes.map(hex2).join('') + hex2(~sum);
  };

  const lines = [];
  if (header) {
    const hb = encodeText(header);
    if (hb.length > 250) throw new FirmwareError('S0 header must be at most 250 bytes');
    lines.push(rec(0, 0, 2, hb));
  }
  for (const s of segs) {
    for (let i = 0; i < s.data.length; i += recordSize) {
      lines.push(rec(dataType, s.address + i, addrBytes, s.data.subarray(i, i + recordSize)));
    }
  }
  if (image.startAddress !== null && image.startAddress !== undefined) {
    lines.push(rec(endType, image.startAddress, addrBytes, new Uint8Array(0)));
  }
  return lines.join('\n') + '\n';
}

/**
 * UF2 writer. Each block carries up to payloadSize bytes (4..476, multiple of 4),
 * 256 is the common choice. familyId: number, 'none', or 'auto' (the source family if
 * there is exactly one). Blocks are written in address order.
 */
export function writeUF2(image, { payloadSize = 256, family = 'auto', fillGaps = false, fill = 0xff } = {}) {
  if (!Number.isInteger(payloadSize) || payloadSize < 4 || payloadSize > UF2_MAX_PAYLOAD || payloadSize % 4 !== 0) {
    throw new FirmwareError('UF2 payload size must be a multiple of 4 between 4 and 476');
  }
  const segs = outputSegments(image, fillGaps, fill);
  const famId = resolveFamily(family, image);
  const pieces = [];
  for (const s of segs) {
    for (let i = 0; i < s.data.length; i += payloadSize) {
      pieces.push({ address: s.address + i, data: s.data.subarray(i, i + payloadSize) });
    }
  }
  const total = pieces.length;
  const out = new Uint8Array(total * UF2_BLOCK_SIZE);
  const dv = new DataView(out.buffer);
  pieces.forEach((p, i) => {
    const o = i * UF2_BLOCK_SIZE;
    if (p.address + p.data.length - 1 > 0xffffffff) throw new FirmwareError('UF2 target addresses are limited to 32 bits');
    dv.setUint32(o, UF2_MAGIC0, true);
    dv.setUint32(o + 4, UF2_MAGIC1, true);
    dv.setUint32(o + 8, famId === null ? 0 : UF2_FLAG_FAMILY_ID, true);
    dv.setUint32(o + 12, p.address, true);
    dv.setUint32(o + 16, p.data.length, true);
    dv.setUint32(o + 20, i, true);
    dv.setUint32(o + 24, total, true);
    dv.setUint32(o + 28, famId === null ? 0 : famId, true);
    out.set(p.data, o + 32);
    dv.setUint32(o + 508, UF2_MAGIC_END, true);
  });
  return out;
}

/**
 * Convert an image to an output format.
 * @returns {{bytes: Uint8Array, ext: string, mime: string, blocks?: number}}
 */
export function convertImage(image, format, opts = {}) {
  const o = { fillGaps: false, fill: 0xff, ...opts };
  switch (format) {
    case 'bin':
      return { bytes: writeBinary(image, o), ...pick('bin') };
    case 'hex':
      return { bytes: encodeText(writeIntelHex(image, o)), ...pick('hex') };
    case 'srec':
      return { bytes: encodeText(writeSrec(image, o)), ...pick('srec') };
    case 'uf2': {
      const bytes = writeUF2(image, o);
      return { bytes, blocks: bytes.length / UF2_BLOCK_SIZE, ...pick('uf2') };
    }
    default:
      throw new FirmwareError(`Cannot write ${format}; ELF is input only`);
  }
}

function pick(fmt) {
  const info = FORMAT_INFO[fmt];
  return { ext: info.ext, mime: info.mime };
}

/**
 * Re-parse an output and compare it with the source image: data, base address and, where
 * the format has one, the start address and the UF2 family. Without gap filling the
 * segments are compared directly (no flattening, so large sparse images still verify);
 * with gap filling, or for raw binary, both sides are flattened with the same fill byte.
 * A check is null when it could not be evaluated (span too large to flatten).
 */
export function verifyOutput(image, format, bytes, { fill = 0xff, fillGaps = false, family = 'auto' } = {}) {
  const span = imageSpan(image);
  const reparsed = parseFirmware(bytes, { format, baseAddress: span.start });
  const checks = {};
  try {
    if (format === 'bin' || fillGaps) {
      const want = flatten(image, fill);
      const got = flatten(reparsed, fill);
      checks.data = want.length === got.length && want.every((v, i) => v === got[i]);
    } else {
      const a = image.segments;
      const b = reparsed.segments;
      checks.data = a.length === b.length && a.every((s, i) => s.address === b[i].address
        && s.data.length === b[i].data.length && s.data.every((v, k) => v === b[i].data[k]));
    }
  } catch {
    checks.data = null;
  }
  checks.base = imageSpan(reparsed).start === span.start;
  checks.start = FORMAT_INFO[format]?.hasStart ? (reparsed.startAddress ?? null) === (image.startAddress ?? null) : null;
  if (format === 'uf2') {
    const expected = resolveFamily(family, image);
    const fams = reparsed.meta.familyIds;
    checks.family = expected === null ? fams.length === 0 : fams.length === 1 && fams[0] === expected;
  } else {
    checks.family = null;
  }
  const ok = [checks.data, checks.base, checks.start, checks.family].every((c) => c !== false) && checks.data === true;
  let sourceCrc32 = null;
  if (span.size <= MAX_SPAN) sourceCrc32 = hexN(crc32(flatten(image, fill)), 8);
  return { ok, checks, sourceCrc32 };
}

// ---------------------------------------------------------------------------
// Offset relocation, split and merge
// ---------------------------------------------------------------------------

/** Add `offset` to every address (segments and start address). */
export function relocateImage(image, offset) {
  if (!Number.isSafeInteger(offset)) throw new FirmwareError('Offset must be an integer');
  if (!image.segments.length) return image;
  const segments = image.segments.map((s) => {
    const address = s.address + offset;
    if (address < 0) throw new FirmwareError(`Offset ${offset} moves data below address 0`);
    return { address, data: s.data };
  });
  let startAddress = image.startAddress;
  if (startAddress !== null) {
    startAddress += offset;
    if (startAddress < 0) throw new FirmwareError(`Offset ${offset} moves the start address below 0`);
  }
  return { ...image, segments, startAddress };
}

function clipSegments(segments, lo, hi) {
  const out = [];
  for (const s of segments) {
    const a = Math.max(s.address, lo);
    const b = Math.min(s.address + s.data.length, hi);
    if (b > a) out.push({ address: a, data: s.data.subarray(a - s.address, b - s.address) });
  }
  return out;
}

/** Split into [below, atOrAbove] at an address. Start address goes to the side that holds it. */
export function splitImageAt(image, address) {
  const below = clipSegments(image.segments, -Infinity, address);
  const above = clipSegments(image.segments, address, Infinity);
  const sa = image.startAddress;
  const mk = (segments, keep) => ({
    ...image,
    segments,
    startAddress: sa !== null && keep(sa) ? sa : null,
    startKind: sa !== null && keep(sa) ? image.startKind : null,
    warnings: [],
    overlapBytes: 0,
  });
  return [mk(below, (x) => x < address), mk(above, (x) => x >= address)];
}

/** One image per contiguous segment. The start address stays with the segment that holds it. */
export function splitImageBySegment(image) {
  return image.segments.map((s) => {
    const holds = image.startAddress !== null && image.startAddress >= s.address && image.startAddress < s.address + s.data.length;
    return {
      ...image,
      segments: [s],
      startAddress: holds ? image.startAddress : null,
      startKind: holds ? image.startKind : null,
      warnings: [],
      overlapBytes: 0,
    };
  });
}

/** Merge images in order. Overlaps: the later image wins. */
export function mergeImages(images) {
  if (!images.length) throw new FirmwareError('Nothing to merge');
  const chunks = [];
  const warnings = [];
  const fams = new Set();
  let startAddress = null;
  let startKind = null;
  for (const img of images) {
    for (const s of img.segments) chunks.push({ address: s.address, data: s.data });
    for (const f of img.meta?.familyIds ?? []) fams.add(f);
    if (startAddress === null && img.startAddress !== null) { startAddress = img.startAddress; startKind = img.startKind; }
    warnings.push(...img.warnings);
  }
  const familyIds = [...fams].sort((a, b) => a - b);
  if (familyIds.length > 1) warnings.push(`Merged images carry mixed families: ${familyIds.map(hexAddr).join(', ')}`);
  return makeImage({
    chunks,
    startAddress,
    startKind,
    meta: { format: 'merged', filename: `${images.length} files`, familyIds },
    warnings: [...new Set(warnings)],
  });
}
