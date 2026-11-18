/**
 * Shared byte helpers for the Binary Payload Decoder: errors, hex / base64 / base32
 * text codecs, strict UTF-8, tree-node helpers and JSON-safe conversion.
 * Pure functions, no DOM, no React.
 */

export class DecodeError extends Error {
  constructor(message, offset = 0, fatal = false) {
    super(message);
    this.name = 'DecodeError';
    this.offset = offset;
    /** fatal errors (item/size limits) must not be swallowed by heuristic candidate parses */
    this.fatal = fatal;
  }
}

export const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Parse hex text. Whitespace, ':' ',' '-' '_' and 0x prefixes are ignored. */
export function parseHex(text) {
  const s = String(text).replace(/0x/gi, '').replace(/[\s,:;_-]/g, '');
  if (s.length === 0) return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error('Hex input contains non-hex characters');
  if (s.length % 2) throw new Error('Hex input has an odd number of digits');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

const HEX = '0123456789abcdef';
export function toHex(bytes, sep = '') {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i && sep) out += sep;
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64(bytes, { url = false, pad = true } = {}) {
  const a = url ? B64URL : B64;
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += a[(n >> 18) & 63] + a[(n >> 12) & 63] + a[(n >> 6) & 63] + a[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += a[(n >> 18) & 63] + a[(n >> 12) & 63] + (pad ? '==' : '');
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += a[(n >> 18) & 63] + a[(n >> 12) & 63] + a[(n >> 6) & 63] + (pad ? '=' : '');
  }
  return out;
}

/** Decode standard or URL-safe base64 (padding optional, whitespace ignored). */
export function parseBase64(text) {
  const s = String(text).replace(/\s/g, '').replace(/=+$/, '');
  if (s.length % 4 === 1) throw new Error('Base64 input has an invalid length');
  const map = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) map[B64.charCodeAt(i)] = i;
  map['-'.charCodeAt(0)] = 62;
  map['_'.charCodeAt(0)] = 63;
  const out = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? map[c] : -1;
    if (v < 0) throw new Error(`Base64 input contains invalid character "${s[i]}"`);
    acc = ((acc << 6) | v) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** RFC 4648 base32 (upper case, padding optional). */
export function parseBase32(text) {
  const s = String(text).replace(/\s/g, '').toUpperCase().replace(/=+$/, '');
  const out = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const v = B32.indexOf(s[i]);
    if (v < 0) throw new Error(`Base32 input contains invalid character "${s[i]}"`);
    acc = ((acc << 5) | v) & 0xffffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

const utf8Dec = new TextDecoder('utf-8', { fatal: true });
const utf8Enc = new TextEncoder();
export function utf8Strict(bytes, offset = 0) {
  try {
    return utf8Dec.decode(bytes);
  } catch {
    throw new DecodeError('invalid UTF-8 text', offset);
  }
}
export function utf8Encode(s) {
  return utf8Enc.encode(s);
}

/** True when the bytes are valid UTF-8 with no control characters other than tab/LF/CR. */
export function isPrintableText(bytes) {
  if (!bytes || bytes.length === 0) return false;
  let s;
  try {
    s = utf8Dec.decode(bytes);
  } catch {
    return false;
  }
  return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f�]/.test(s);
}

/** Shift every absolute offset in a decoded tree by delta (used for embedded payloads). */
export function shiftOffsets(node, delta) {
  node.offset += delta;
  if (node.children) node.children.forEach((c) => shiftOffsets(c, delta));
  return node;
}

/** Diagnostic-style float text (RFC 8949 section 8): "1.0", "1.5", "1.0e+300", "NaN". */
export function formatFloat(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (Object.is(x, -0)) return '-0.0';
  let s = String(x);
  if (/^-?\d+$/.test(s)) return `${s}.0`;
  if (/^-?\d+e/.test(s)) s = s.replace(/^(-?\d+)e/, '$1.0e');
  return s;
}

/** IEEE 754 binary16 to number. */
export function halfToNumber(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return sign * f * 2 ** -24;
  if (e === 31) return f ? NaN : sign * Infinity;
  return sign * (1 + f / 1024) * 2 ** (e - 15);
}

/** Convert a decoded JS value to plain JSON. Non-JSON types use $-prefixed wrappers the encoders accept back. */
export function jsonSafe(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'number') {
    if (Number.isFinite(v)) return v;
    return { $float: Number.isNaN(v) ? 'NaN' : v > 0 ? 'Infinity' : '-Infinity' };
  }
  if (typeof v === 'bigint') {
    if (v >= -MAX_SAFE && v <= MAX_SAFE) return Number(v);
    return { $int: v.toString() };
  }
  if (v instanceof Uint8Array) return { $hex: toHex(v) };
  if (Array.isArray(v)) return v.map(jsonSafe);
  if (v.__simple !== undefined) return { $simple: v.__simple };
  if (v.$tag !== undefined) return { $tag: v.$tag, $value: jsonSafe(v.$value) };
  if (v.$ext !== undefined) return { $ext: v.$ext, $hex: v.$hex };
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]);
    return out;
  }
  return String(v);
}

/** Convert a plain tree node to JSON-serialisable data (for the tree export). */
export function treeToJson(node) {
  const out = { offset: node.offset, length: node.length, label: node.label, type: node.type, value: node.value };
  if (node.error) out.error = node.error;
  if (node.children && node.children.length) out.children = node.children.map(treeToJson);
  return out;
}

export function makeNode(offset, length, label, type, value, children) {
  const n = { offset, length, label, type, value };
  if (children) n.children = children;
  return n;
}

export function readBigUint(b, pos, n) {
  let v = 0n;
  for (let i = 0; i < n; i++) v = (v << 8n) | BigInt(b[pos + i]);
  return v;
}

export function normInt(big) {
  return big >= -MAX_SAFE && big <= MAX_SAFE ? Number(big) : big;
}
