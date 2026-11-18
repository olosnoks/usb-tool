/**
 * Extra operations: bitwise NOT / rotate, Shannon entropy,
 * text statistics, and escape / unescape string.
 */

import { Dish } from '../core/Dish.js';
import { defineOp, intArg } from './opHelpers.js';

const toBytes = (input) => (input instanceof Dish ? input : new Dish(input)).toUint8Array();

/** Bitwise NOT of every byte. */
export function bitwiseNot(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = ~bytes[i] & 0xff;
  return out;
}

/** Rotate each byte left or right by `amount` bits (0-7). */
export function rotateBytes(bytes, amount, direction = 'Left') {
  if (direction !== 'Left' && direction !== 'Right') throw new Error('Direction must be Left or Right.');
  const n = intArg(amount, 'Amount', 0, 7);
  const l = direction === 'Left' ? n : (8 - n) % 8;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = ((bytes[i] << l) | (bytes[i] >>> (8 - l))) & 0xff;
  return out;
}

/** Shannon entropy in bits per byte (0 for empty input). */
export function shannonEntropy(bytes) {
  if (!bytes.length) return 0;
  const counts = new Array(256).fill(0);
  for (const b of bytes) counts[b]++;
  let e = 0;
  for (const c of counts) {
    if (c) {
      const p = c / bytes.length;
      e -= p * Math.log2(p);
    }
  }
  return e;
}

/** Counts of bytes, characters, words, lines and unique bytes. */
export function textStats(bytes) {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const trimmed = text.trim();
  return {
    bytes: bytes.length,
    characters: Array.from(text).length,
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    lines: text === '' ? 0 : text.split(/\r\n|\r|\n/).length,
    uniqueBytes: new Set(bytes).size
  };
}

const ESCAPES = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\\': '\\\\', '"': '\\"', "'": "\\'", '\0': '\\0' };

/** Escape control characters, quotes and non-ASCII as \n, \xHH or \uHHHH. */
export function escapeString(text) {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ESCAPES[ch]) out += ESCAPES[ch];
    else if (cp < 0x20 || (cp >= 0x7f && cp <= 0xff)) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp > 0xffff) out += '\\u{' + cp.toString(16) + '}';
    else if (cp > 0xff) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out;
}

const UNESCAPE_MAP = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', '\\': '\\', '"': '"', "'": "'" };

/** Reverse of escapeString (also handles \b \f \v). Unknown escapes are left as-is. */
export function unescapeString(text) {
  const re = /\\(?:u\{([0-9a-fA-F]{1,6})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g;
  return text.replace(re, (m, brace, u4, x2, ch) => {
    if (brace) return String.fromCodePoint(parseInt(brace, 16));
    if (u4) return String.fromCharCode(parseInt(u4, 16));
    if (x2) return String.fromCharCode(parseInt(x2, 16));
    return Object.prototype.hasOwnProperty.call(UNESCAPE_MAP, ch) ? UNESCAPE_MAP[ch] : m;
  });
}

export const bitwiseNotOperation = defineOp(
  {
    name: 'Bitwise NOT',
    id: 'bitwise_not',
    module: 'Arithmetic',
    description: 'Inverts every bit of every input byte.',
    keywords: ['not', 'invert', 'complement', 'bitwise'],
    inputType: 'Dish',
    outputType: 'Dish',
    args: []
  },
  async (input) => Dish.fromBytes(bitwiseNot(toBytes(input)))
);

export const rotateBitsOperation = defineOp(
  {
    name: 'Rotate bits',
    id: 'rotate_bits',
    module: 'Arithmetic',
    description: 'Rotates the bits inside each byte left or right (ROL / ROR).',
    keywords: ['rotate', 'rol', 'ror', 'bitwise', 'shift'],
    inputType: 'Dish',
    outputType: 'Dish',
    args: [
      { name: 'direction', label: 'Direction', type: 'select', options: ['Left', 'Right'], default: 'Left' },
      { name: 'amount', label: 'Amount (0-7)', type: 'number', default: 1 }
    ]
  },
  async (input, { direction = 'Left', amount = 1 } = {}) => Dish.fromBytes(rotateBytes(toBytes(input), amount, direction))
);

export const entropyOperation = defineOp(
  {
    name: 'Shannon entropy',
    id: 'shannon_entropy',
    module: 'Forensics',
    description: 'Reports the Shannon entropy of the input in bits per byte (0 to 8). High values suggest compressed or encrypted data.',
    keywords: ['entropy', 'randomness', 'encrypted', 'compressed', 'packed'],
    inputType: 'Dish',
    outputType: 'string',
    args: []
  },
  async (input) => {
    const bytes = toBytes(input);
    const e = shannonEntropy(bytes);
    return `Entropy: ${e.toFixed(4)} bits/byte (${((e / 8) * 100).toFixed(1)}% of maximum)\nBytes: ${bytes.length}`;
  }
);

export const textStatsOperation = defineOp(
  {
    name: 'Text statistics',
    id: 'text_stats',
    module: 'Text',
    description: 'Counts bytes, characters, words, lines and distinct byte values in the input.',
    keywords: ['count', 'length', 'words', 'lines', 'characters', 'statistics'],
    inputType: 'Dish',
    outputType: 'string',
    args: []
  },
  async (input) => {
    const s = textStats(toBytes(input));
    return `Bytes: ${s.bytes}\nCharacters: ${s.characters}\nWords: ${s.words}\nLines: ${s.lines}\nUnique byte values: ${s.uniqueBytes}`;
  }
);

export const escapeStringOperation = defineOp(
  {
    name: 'Escape string',
    id: 'escape_string',
    module: 'Encoding',
    description: 'Escapes backslashes, quotes, control characters and non-ASCII characters (\\n, \\xHH, \\uHHHH).',
    keywords: ['escape', 'string', 'backslash', 'literal'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => escapeString(input)
);

export const unescapeStringOperation = defineOp(
  {
    name: 'Unescape string',
    id: 'unescape_string',
    module: 'Encoding',
    description: 'Reverses Escape string: converts \\n, \\t, \\xHH, \\uHHHH and \\u{...} sequences back to characters.',
    keywords: ['unescape', 'string', 'backslash', 'literal'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => unescapeString(input)
);

export const extraOperations = [
  bitwiseNotOperation, rotateBitsOperation, entropyOperation,
  textStatsOperation, escapeStringOperation, unescapeStringOperation
];

export default extraOperations;
