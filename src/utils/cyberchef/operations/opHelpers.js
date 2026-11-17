/**
 * Shared helpers for the function-style operations (hashing/crypto/text/encoding).
 * Keeps each Operation small: define metadata + a run function.
 */

import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';

export class FnOperation extends Operation {
  constructor(options, fn) {
    super(options);
    this._fn = fn;
  }

  async run(input, args = {}) {
    return this._fn(input, args);
  }
}

export function defineOp(options, fn) {
  return new FnOperation(options, fn);
}

export const BYTE_FORMATS = ['UTF8', 'Hex', 'Base64', 'Latin1'];

// ---------------------------------------------------------------------------
// Byte conversions
// ---------------------------------------------------------------------------

export function bytesToHex(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(text, label = 'Hex value') {
  const clean = String(text ?? '').replace(/0x/gi, '').replace(/[\s,:;\-]/g, '');
  if (clean.length % 2 !== 0) throw new Error(`${label} must have an even number of hex digits.`);
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error(`${label} contains non-hex characters.`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(bin);
}

export function base64ToBytes(text, label = 'Base64 value') {
  let clean = String(text ?? '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  clean = clean.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) {
    throw new Error(`${label} is not valid Base64.`);
  }
  while (clean.length % 4) clean += '=';
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function latin1ToBytes(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 255) throw new Error('Latin1 value contains characters above U+00FF.');
    out[i] = c;
  }
  return out;
}

/** Parse a text argument into bytes using one of BYTE_FORMATS. */
export function parseBytesArg(value, format = 'UTF8', label = 'Value') {
  const text = String(value ?? '');
  switch (format) {
    case 'Hex': return hexToBytes(text, label);
    case 'Base64': return base64ToBytes(text, label);
    case 'Latin1': return latin1ToBytes(text);
    case 'UTF8':
    default: return new TextEncoder().encode(text);
  }
}

export function concatBytes(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

export function intArg(value, label, min, max) {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

/** Interpret \n \r \t \xHH \\ escapes in short delimiter strings. */
export function unescapeShort(text) {
  return String(text ?? '').replace(/\\(n|r|t|0|\\|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4})/g, (m, g) => {
    switch (g[0]) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '0': return '\0';
      case '\\': return '\\';
      default: return String.fromCharCode(parseInt(g.slice(1), 16));
    }
  });
}

// Formats for crypto op inputs/outputs: 'Raw' means the Dish bytes themselves.
export const IO_FORMATS_IN = ['Raw', 'Hex', 'Base64'];
export const IO_FORMATS_OUT = ['Hex', 'Base64', 'Raw'];

export function inputToBytes(input, format = 'Raw', label = 'Input') {
  const dish = input instanceof Dish ? input : new Dish(input);
  if (format === 'Hex') return hexToBytes(dish.toString(), label);
  if (format === 'Base64') return base64ToBytes(dish.toString(), label);
  return dish.toUint8Array();
}

export function bytesToOutput(bytes, format = 'Hex') {
  if (format === 'Base64') return bytesToBase64(bytes);
  if (format === 'Raw') return Dish.fromBytes(bytes);
  return bytesToHex(bytes);
}

/**
 * Expand a CyberChef-style alphabet spec such as "A-Za-z0-9+/=" into a character
 * list. "x-y" is a range; a backslash escapes the next character (e.g. "\-").
 */
export function expandAlphabet(spec) {
  const s = Array.from(String(spec ?? ''));
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && i + 1 < s.length) {
      out.push(s[++i]);
    } else if (i + 2 < s.length && s[i + 1] === '-') {
      const a = s[i].codePointAt(0);
      const b = s[i + 2].codePointAt(0);
      if (b < a) throw new Error(`Invalid alphabet range "${s[i]}-${s[i + 2]}".`);
      for (let c = a; c <= b; c++) out.push(String.fromCodePoint(c));
      i += 2;
    } else {
      out.push(s[i]);
    }
  }
  return out;
}
