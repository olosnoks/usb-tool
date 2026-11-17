/**
 * Encoding, classical cipher and data-format operations (DAT-6)
 * Caesar/ROT, Vigenere, Atbash, Morse, A1Z26, HTML entities, Punycode, Quoted-printable,
 * Encode/Decode text, Base62, Base45, Defang, JSON<->CSV, Parse CSV, PEM<->Hex.
 */

import { Dish } from '../core/Dish.js';
import {
  defineOp, bytesToHex, hexToBytes, bytesToBase64, base64ToBytes, intArg, unescapeShort, expandAlphabet
} from './opHelpers.js';
import { choice } from './textOps.js';

const YES_NO = ['Yes', 'No'];
const isYes = (v) => v === true || v === 'Yes' || v === 'yes' || v === 'true';
const dishBytes = (d) => (d instanceof Dish ? d : new Dish(d)).toUint8Array();

// ============================================================================
// Classical ciphers
// ============================================================================

function rotateLetters(text, shift) {
  const s = ((shift % 26) + 26) % 26;
  return text.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + s) % 26) + base);
  });
}

export const caesarOperation = defineOp(
  {
    name: 'Caesar Cipher',
    id: 'caesar_cipher',
    module: 'Ciphers',
    description: 'Shifts letters by a fixed amount (A-Z and a-z, case preserved); other characters pass through.',
    keywords: ['caesar', 'shift', 'rot', 'rotate', 'substitution', 'classical'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'shift', label: 'Shift', type: 'number', default: 3 },
      { name: 'mode', label: 'Mode', type: 'select', options: ['Encrypt', 'Decrypt'], default: 'Encrypt' }
    ]
  },
  async (input, { shift = 3, mode = 'Encrypt' } = {}) => {
    choice(mode, ['Encrypt', 'Decrypt'], 'Mode');
    const n = intArg(shift, 'Shift', -1000000, 1000000);
    return rotateLetters(input, mode === 'Decrypt' ? -n : n);
  }
);

export const rotNOperation = defineOp(
  {
    name: 'ROT-N',
    id: 'rot_n',
    module: 'Ciphers',
    description: 'Rotates letters by N positions and optionally digits by N mod 10 (ROT13/ROT5 generalised). Applying ROT-N then ROT-(26-N) restores the text.',
    keywords: ['rot13', 'rot5', 'rot', 'rotate', 'caesar', 'shift'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'amount', label: 'Amount', type: 'number', default: 13 },
      { name: 'letters', label: 'Rotate letters', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'digits', label: 'Rotate digits', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (input, { amount = 13, letters = 'Yes', digits = 'No' } = {}) => {
    const n = intArg(amount, 'Amount', -1000000, 1000000);
    let out = isYes(letters) ? rotateLetters(input, n) : input;
    if (isYes(digits)) {
      const d = ((n % 10) + 10) % 10;
      out = out.replace(/[0-9]/g, (c) => String((Number(c) + d) % 10));
    }
    return out;
  }
);

export const rot47Operation = defineOp(
  {
    name: 'ROT47',
    id: 'rot47',
    module: 'Ciphers',
    description: 'Rotates the 94 printable ASCII characters (! to ~) by an amount; 47 is self-inverse.',
    keywords: ['rot47', 'rotate', 'printable', 'ascii'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'amount', label: 'Amount', type: 'number', default: 47 }]
  },
  async (input, { amount = 47 } = {}) => {
    const n = ((intArg(amount, 'Amount', -1000000, 1000000) % 94) + 94) % 94;
    return input.replace(/[!-~]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 33 + n) % 94) + 33));
  }
);

function vigenere(input, key, decrypt) {
  const shifts = Array.from(String(key)).filter((c) => /[a-zA-Z]/.test(c)).map((c) => c.toLowerCase().charCodeAt(0) - 97);
  if (shifts.length === 0) throw new Error('The key must contain at least one letter (A-Z).');
  let k = 0;
  return input.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    const s = shifts[k++ % shifts.length] * (decrypt ? -1 : 1);
    return String.fromCharCode((((c.charCodeAt(0) - base + s) % 26) + 26) % 26 + base);
  });
}

export const vigenereEncodeOperation = defineOp(
  {
    name: 'Vigenere Encode',
    id: 'vigenere_encode',
    module: 'Ciphers',
    description: 'Encrypts letters with a repeating-key Vigenere cipher. The key advances only on letters; case is preserved.',
    keywords: ['vigenere', 'vigenère', 'polyalphabetic', 'classical', 'encrypt'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'key', label: 'Key (letters)', type: 'text', default: '' }]
  },
  async (input, { key = '' } = {}) => vigenere(input, key, false)
);

export const vigenereDecodeOperation = defineOp(
  {
    name: 'Vigenere Decode',
    id: 'vigenere_decode',
    module: 'Ciphers',
    description: 'Decrypts a repeating-key Vigenere cipher.',
    keywords: ['vigenere', 'vigenère', 'polyalphabetic', 'classical', 'decrypt'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'key', label: 'Key (letters)', type: 'text', default: '' }]
  },
  async (input, { key = '' } = {}) => vigenere(input, key, true)
);

export const atbashOperation = defineOp(
  {
    name: 'Atbash Cipher',
    id: 'atbash_cipher',
    module: 'Ciphers',
    description: 'Substitutes each letter with its mirror in the alphabet (A<->Z, B<->Y). Self-inverse.',
    keywords: ['atbash', 'mirror', 'reverse alphabet', 'substitution', 'classical'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => input.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(base + 25 - (c.charCodeAt(0) - base));
  })
);

// ---------------------------------------------------------------------------
// Morse
// ---------------------------------------------------------------------------

const MORSE = {
  A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
  K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
  U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..',
  0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
  '.': '.-.-.-', ',': '--..--', '?': '..--..', "'": '.----.', '!': '-.-.--', '/': '-..-.', '(': '-.--.', ')': '-.--.-',
  '&': '.-...', ':': '---...', ';': '-.-.-.', '=': '-...-', '+': '.-.-.', '-': '-....-', _: '..--.-', '"': '.-..-.',
  $: '...-..-', '@': '.--.-.'
};
const MORSE_REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

const MORSE_DELIMS = {
  'Space': ' ', 'Line feed': '\n', 'CRLF': '\r\n', 'Forward slash': '/', 'Backslash': '\\',
  'Comma': ',', 'Semi-colon': ';', 'Colon': ':'
};
const MORSE_LETTER_DELIMS = Object.keys(MORSE_DELIMS);
const MORSE_WORD_DELIMS = Object.keys(MORSE_DELIMS).filter((k) => k !== 'Space');

function morseDelims(letterName, wordName) {
  choice(letterName, MORSE_LETTER_DELIMS, 'Letter delimiter');
  choice(wordName, MORSE_WORD_DELIMS, 'Word delimiter');
  if (letterName === wordName) throw new Error('Letter delimiter and word delimiter must differ.');
  return [MORSE_DELIMS[letterName], MORSE_DELIMS[wordName]];
}

export const toMorseOperation = defineOp(
  {
    name: 'To Morse Code',
    id: 'to_morse_code',
    module: 'Ciphers',
    description: 'Encodes letters, digits and common punctuation as International Morse code.',
    keywords: ['morse', 'dots', 'dashes', 'telegraph', 'cw'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'format', label: 'Format', type: 'select', options: ['-/.', '_/.'], default: '-/.' },
      { name: 'letterDelimiter', label: 'Letter delimiter', type: 'select', options: MORSE_LETTER_DELIMS, default: 'Space' },
      { name: 'wordDelimiter', label: 'Word delimiter', type: 'select', options: MORSE_WORD_DELIMS, default: 'Line feed' }
    ]
  },
  async (input, { format = '-/.', letterDelimiter = 'Space', wordDelimiter = 'Line feed' } = {}) => {
    choice(format, ['-/.', '_/.'], 'Format');
    const [ld, wd] = morseDelims(letterDelimiter, wordDelimiter);
    const words = input.toUpperCase().split(/\s+/).filter((w) => w.length > 0);
    const out = words.map((w) => Array.from(w).map((c) => {
      const code = MORSE[c];
      if (!code) throw new Error(`Character "${c}" has no Morse code representation.`);
      return format === '_/.' ? code.replace(/-/g, '_') : code;
    }).join(ld));
    return out.join(wd);
  }
);

export const fromMorseOperation = defineOp(
  {
    name: 'From Morse Code',
    id: 'from_morse_code',
    module: 'Ciphers',
    description: 'Decodes International Morse code (dashes as - or _) back to text.',
    keywords: ['morse', 'dots', 'dashes', 'telegraph', 'decode'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'letterDelimiter', label: 'Letter delimiter', type: 'select', options: MORSE_LETTER_DELIMS, default: 'Space' },
      { name: 'wordDelimiter', label: 'Word delimiter', type: 'select', options: MORSE_WORD_DELIMS, default: 'Line feed' }
    ]
  },
  async (input, { letterDelimiter = 'Space', wordDelimiter = 'Line feed' } = {}) => {
    const [ld, wd] = morseDelims(letterDelimiter, wordDelimiter);
    const text = input.replace(/_/g, '-').replace(/\r\n/g, '\n').replace(/\s+$/, '');
    if (!text.trim()) return '';
    return text.split(wd === '\r\n' ? '\n' : wd).map((word) => word.split(ld === '\r\n' ? '\n' : ld)
      .filter((tok) => tok.trim() !== '')
      .map((tok) => {
        const t = tok.trim();
        const ch = MORSE_REVERSE[t];
        if (ch === undefined) throw new Error(`Unrecognised Morse sequence "${t}".`);
        return ch;
      }).join('')).join(' ');
  }
);

// ---------------------------------------------------------------------------
// A1Z26
// ---------------------------------------------------------------------------

const A1_DELIMS = { 'Space': ' ', 'Comma': ',', 'Semi-colon': ';', 'Colon': ':' };
const A1_DELIM_NAMES = Object.keys(A1_DELIMS);

export const a1z26EncodeOperation = defineOp(
  {
    name: 'A1Z26 Cipher Encode',
    id: 'a1z26_encode',
    module: 'Ciphers',
    description: 'Replaces each letter with its alphabet position (A=1 ... Z=26). Whitespace becomes a line break between words; other characters are dropped.',
    keywords: ['a1z26', 'alphabet position', 'letters to numbers', 'substitution'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'delimiter', label: 'Delimiter', type: 'select', options: A1_DELIM_NAMES, default: 'Space' }]
  },
  async (input, { delimiter = 'Space' } = {}) => {
    choice(delimiter, A1_DELIM_NAMES, 'Delimiter');
    const d = A1_DELIMS[delimiter];
    return input.split(/\s+/).map((w) => Array.from(w.toUpperCase()).filter((c) => c >= 'A' && c <= 'Z')
      .map((c) => c.charCodeAt(0) - 64).join(d)).filter((w) => w !== '').join('\n');
  }
);

export const a1z26DecodeOperation = defineOp(
  {
    name: 'A1Z26 Cipher Decode',
    id: 'a1z26_decode',
    module: 'Ciphers',
    description: 'Converts alphabet positions (1-26) back to letters. Line breaks separate words.',
    keywords: ['a1z26', 'alphabet position', 'numbers to letters', 'substitution', 'decode'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'delimiter', label: 'Delimiter', type: 'select', options: A1_DELIM_NAMES, default: 'Space' }]
  },
  async (input, { delimiter = 'Space' } = {}) => {
    choice(delimiter, A1_DELIM_NAMES, 'Delimiter');
    const d = A1_DELIMS[delimiter];
    return input.split(/\r?\n/).map((line) => line.split(d).map((t) => t.trim()).filter((t) => t !== '').map((t) => {
      if (!/^\d+$/.test(t)) throw new Error(`"${t}" is not a number between 1 and 26.`);
      const n = Number(t);
      if (n < 1 || n > 26) throw new Error(`${n} is outside the range 1-26.`);
      return String.fromCharCode(64 + n);
    }).join('')).filter((w) => w !== '').join(' ');
  }
);

// ============================================================================
// HTML entities
// ============================================================================

const LATIN1_NAMES = ('nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest ' +
  'Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig ' +
  'agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml').split(' ');

const ENTITY_BY_NAME = { amp: 38, lt: 60, gt: 62, quot: 34, apos: 39 };
LATIN1_NAMES.forEach((n, i) => { ENTITY_BY_NAME[n] = 160 + i; });
Object.assign(ENTITY_BY_NAME, {
  OElig: 338, oelig: 339, Scaron: 352, scaron: 353, Yuml: 376, fnof: 402, circ: 710, tilde: 732,
  ensp: 8194, emsp: 8195, thinsp: 8201, ndash: 8211, mdash: 8212, lsquo: 8216, rsquo: 8217, sbquo: 8218,
  ldquo: 8220, rdquo: 8221, bdquo: 8222, dagger: 8224, Dagger: 8225, bull: 8226, hellip: 8230, permil: 8240,
  lsaquo: 8249, rsaquo: 8250, euro: 8364, trade: 8482, larr: 8592, uarr: 8593, rarr: 8594, darr: 8595, harr: 8596,
  infin: 8734, ne: 8800, le: 8804, ge: 8805
});
const ENTITY_BY_CODE = {};
for (const [name, cp] of Object.entries(ENTITY_BY_NAME)) if (!(cp in ENTITY_BY_CODE)) ENTITY_BY_CODE[cp] = name;

const ENTITY_FORMATS = ['Named entities where possible', 'Numeric (decimal)', 'Numeric (hex)'];

export const toHtmlEntityOperation = defineOp(
  {
    name: 'To HTML Entity',
    id: 'to_html_entity',
    module: 'Encoding',
    description: 'Escapes & < > " \' and, optionally, every character as an HTML entity.',
    keywords: ['html', 'entity', 'escape', 'xml', 'amp', 'ampersand', 'encode'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'convertAll', label: 'Convert all characters', type: 'select', options: YES_NO, default: 'No' },
      { name: 'format', label: 'Format', type: 'select', options: ENTITY_FORMATS, default: ENTITY_FORMATS[0] }
    ]
  },
  async (input, { convertAll = 'No', format = ENTITY_FORMATS[0] } = {}) => {
    choice(format, ENTITY_FORMATS, 'Format');
    const all = isYes(convertAll);
    return Array.from(input).map((ch) => {
      const cp = ch.codePointAt(0);
      const special = cp === 38 || cp === 60 || cp === 62 || cp === 34 || cp === 39;
      if (!all && !special) return ch;
      if (format === ENTITY_FORMATS[0]) {
        if (cp === 39) return '&#39;';
        return ENTITY_BY_CODE[cp] ? `&${ENTITY_BY_CODE[cp]};` : `&#${cp};`;
      }
      return format === 'Numeric (hex)' ? `&#x${cp.toString(16)};` : `&#${cp};`;
    }).join('');
  }
);

export const fromHtmlEntityOperation = defineOp(
  {
    name: 'From HTML Entity',
    id: 'from_html_entity',
    module: 'Encoding',
    description: 'Decodes named (common HTML 4 set), decimal (&#65;) and hex (&#x41;) entities. Unknown names are left unchanged.',
    keywords: ['html', 'entity', 'unescape', 'xml', 'decode', 'amp'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => input.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/g, (m, dec, hex, name) => {
    let cp;
    if (dec !== undefined) cp = parseInt(dec, 10);
    else if (hex !== undefined) cp = parseInt(hex, 16);
    else cp = ENTITY_BY_NAME[name];
    if (cp === undefined || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return m;
    return String.fromCodePoint(cp);
  })
);

// ============================================================================
// Punycode (RFC 3492)
// ============================================================================

const PC = { base: 36, tMin: 1, tMax: 26, skew: 38, damp: 700, initialBias: 72, initialN: 128 };

function pcAdapt(delta, numPoints, first) {
  let d = first ? Math.floor(delta / PC.damp) : delta >> 1;
  d += Math.floor(d / numPoints);
  let k = 0;
  while (d > (((PC.base - PC.tMin) * PC.tMax) >> 1)) {
    d = Math.floor(d / (PC.base - PC.tMin));
    k += PC.base;
  }
  return Math.floor(k + ((PC.base - PC.tMin + 1) * d) / (d + PC.skew));
}

const pcDigit = (d) => String.fromCharCode(d < 26 ? d + 97 : d + 22);
const pcThreshold = (k, bias) => (k <= bias ? PC.tMin : k >= bias + PC.tMax ? PC.tMax : k - bias);

export function punycodeEncode(input) {
  const cps = Array.from(input).map((c) => c.codePointAt(0));
  let out = cps.filter((c) => c < 128).map((c) => String.fromCharCode(c)).join('');
  const b = out.length;
  let h = b;
  if (b > 0) out += '-';
  let n = PC.initialN, delta = 0, bias = PC.initialBias;
  while (h < cps.length) {
    const m = Math.min(...cps.filter((c) => c >= n));
    delta += (m - n) * (h + 1);
    if (!Number.isSafeInteger(delta) || delta > 0x7fffffff) throw new Error('Punycode overflow: input too large.');
    n = m;
    for (const c of cps) {
      if (c < n) delta++;
      if (c === n) {
        let q = delta;
        for (let k = PC.base; ; k += PC.base) {
          const t = pcThreshold(k, bias);
          if (q < t) break;
          out += pcDigit(t + ((q - t) % (PC.base - t)));
          q = Math.floor((q - t) / (PC.base - t));
        }
        out += pcDigit(q);
        bias = pcAdapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return out;
}

export function punycodeDecode(input) {
  const out = [];
  const basic = input.lastIndexOf('-');
  for (let j = 0; j < basic; j++) {
    if (input.charCodeAt(j) >= 128) throw new Error('Invalid Punycode: non-ASCII character in the basic section.');
    out.push(input.charCodeAt(j));
  }
  let n = PC.initialN, i = 0, bias = PC.initialBias;
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    const oldi = i;
    for (let w = 1, k = PC.base; ; k += PC.base) {
      if (idx >= input.length) throw new Error('Invalid Punycode: truncated input.');
      const cp = input.charCodeAt(idx++);
      const digit = cp - 48 < 10 ? cp - 22 : cp - 65 < 26 ? cp - 65 : cp - 97 < 26 ? cp - 97 : PC.base;
      if (digit >= PC.base) throw new Error(`Invalid Punycode: unexpected character "${input[idx - 1]}".`);
      i += digit * w;
      if (!Number.isSafeInteger(i)) throw new Error('Punycode overflow.');
      const t = pcThreshold(k, bias);
      if (digit < t) break;
      w *= PC.base - t;
    }
    const len = out.length + 1;
    bias = pcAdapt(i - oldi, len, oldi === 0);
    n += Math.floor(i / len);
    if (n > 0x10ffff) throw new Error('Invalid Punycode: code point out of range.');
    i %= len;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

export const toPunycodeOperation = defineOp(
  {
    name: 'To Punycode',
    id: 'to_punycode',
    module: 'Encoding',
    description: 'Encodes Unicode text as Punycode (RFC 3492). In domain mode each non-ASCII label gets the xn-- prefix.',
    keywords: ['punycode', 'idn', 'idna', 'xn--', 'domain', 'unicode', 'homograph'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'domain', label: 'Domain mode (xn-- labels)', type: 'select', options: YES_NO, default: 'Yes' }]
  },
  async (input, { domain = 'Yes' } = {}) => {
    if (!isYes(domain)) return punycodeEncode(input);
    return input.split('.').map((label) => (/[^\x00-\x7f]/.test(label) ? `xn--${punycodeEncode(label)}` : label)).join('.');
  }
);

export const fromPunycodeOperation = defineOp(
  {
    name: 'From Punycode',
    id: 'from_punycode',
    module: 'Encoding',
    description: 'Decodes Punycode (RFC 3492) to Unicode. In domain mode only labels with the xn-- prefix are decoded.',
    keywords: ['punycode', 'idn', 'idna', 'xn--', 'domain', 'unicode', 'homograph', 'decode'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'domain', label: 'Domain mode (xn-- labels)', type: 'select', options: YES_NO, default: 'Yes' }]
  },
  async (input, { domain = 'Yes' } = {}) => {
    if (!isYes(domain)) return punycodeDecode(input);
    return input.split('.').map((label) => (/^xn--/i.test(label) ? punycodeDecode(label.slice(4)) : label)).join('.');
  }
);

// ============================================================================
// Quoted-printable (RFC 2045)
// ============================================================================

export function quotedPrintableEncode(bytes) {
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  const hex = (b) => '=' + b.toString(16).toUpperCase().padStart(2, '0');
  const pieces = text.split(/(\r?\n)/);
  let out = '';
  for (let p = 0; p < pieces.length; p++) {
    if (p % 2 === 1) { out += pieces[p]; continue; }
    const line = pieces[p];
    const eol = pieces[p + 1] || '\n';
    let cur = '';
    for (let i = 0; i < line.length; i++) {
      const c = line.charCodeAt(i);
      const trailingWs = (c === 32 || c === 9) && i === line.length - 1;
      const token = (c >= 33 && c <= 126 && c !== 61) || ((c === 32 || c === 9) && !trailingWs) ? line[i] : hex(c);
      const limit = i < line.length - 1 ? 75 : 76;
      if (cur.length + token.length > limit) {
        out += cur + '=' + eol;
        cur = '';
      }
      cur += token;
    }
    out += cur;
  }
  return out;
}

export function quotedPrintableDecode(text) {
  const clean = text.replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (ch === '=' && /^[0-9A-Fa-f]{2}$/.test(clean.substr(i + 1, 2))) {
      bytes.push(parseInt(clean.substr(i + 1, 2), 16));
      i += 2;
    } else {
      const cp = clean.codePointAt(i);
      if (cp > 0xffff) i++;
      bytes.push(...new TextEncoder().encode(String.fromCodePoint(cp)));
    }
  }
  return new Uint8Array(bytes);
}

export const toQuotedPrintableOperation = defineOp(
  {
    name: 'To Quoted Printable',
    id: 'to_quoted_printable',
    module: 'Encoding',
    description: 'Encodes bytes as MIME Quoted-Printable (RFC 2045) with soft line breaks at 76 columns.',
    keywords: ['quoted-printable', 'qp', 'mime', 'email', 'rfc 2045', '=20', '=3d'],
    inputType: 'Dish',
    outputType: 'string',
    args: []
  },
  async (dish) => quotedPrintableEncode(dishBytes(dish))
);

export const fromQuotedPrintableOperation = defineOp(
  {
    name: 'From Quoted Printable',
    id: 'from_quoted_printable',
    module: 'Encoding',
    description: 'Decodes MIME Quoted-Printable, removing soft line breaks. Malformed = sequences are kept literally.',
    keywords: ['quoted-printable', 'qp', 'mime', 'email', 'rfc 2045', 'decode'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => Dish.fromBytes(quotedPrintableDecode(input))
);

// ============================================================================
// Encode / Decode text (character sets)
// ============================================================================

const SINGLE_BYTE_CHARSETS = ['ISO-8859-1', 'ISO-8859-2', 'ISO-8859-15', 'windows-1250', 'windows-1251', 'windows-1252', 'KOI8-R', 'IBM866', 'US-ASCII'];
const ENCODE_CHARSETS = ['UTF-8', 'UTF-16LE', 'UTF-16BE', ...SINGLE_BYTE_CHARSETS];
const DECODE_CHARSETS = [...ENCODE_CHARSETS, 'Shift_JIS', 'EUC-JP', 'EUC-KR', 'GBK', 'GB18030', 'Big5'];

const reverseMaps = new Map();
function singleByteReverse(charset) {
  if (!reverseMaps.has(charset)) {
    const dec = new TextDecoder(charset);
    const map = new Map();
    for (let b = 0; b < 256; b++) {
      const ch = dec.decode(new Uint8Array([b]));
      if (ch !== '�' && !map.has(ch)) map.set(ch, b);
    }
    reverseMaps.set(charset, map);
  }
  return reverseMaps.get(charset);
}

export function encodeText(text, charset, onUnmappable = 'Error') {
  choice(charset, ENCODE_CHARSETS, 'Character set');
  if (charset === 'UTF-8') return new TextEncoder().encode(text);
  if (charset === 'ISO-8859-1') {
    // TextDecoder maps this label to windows-1252, so handle true Latin-1 directly.
    const bytes = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (cp <= 255) bytes.push(cp);
      else if (onUnmappable === 'Replace with ?') bytes.push(63);
      else throw new Error(`Character "${ch}" (U+${cp.toString(16).toUpperCase().padStart(4, '0')}) cannot be encoded in ISO-8859-1.`);
    }
    return Uint8Array.from(bytes);
  }
  if (charset === 'UTF-16LE' || charset === 'UTF-16BE') {
    const out = new Uint8Array(text.length * 2);
    const dv = new DataView(out.buffer);
    for (let i = 0; i < text.length; i++) dv.setUint16(i * 2, text.charCodeAt(i), charset === 'UTF-16LE');
    return out;
  }
  const bytes = [];
  const reverse = charset === 'US-ASCII' ? null : singleByteReverse(charset);
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    let b = charset === 'US-ASCII' ? (cp < 128 ? cp : undefined) : reverse.get(ch);
    if (b === undefined) {
      if (onUnmappable !== 'Replace with ?') {
        throw new Error(`Character "${ch}" (U+${cp.toString(16).toUpperCase().padStart(4, '0')}) cannot be encoded in ${charset}.`);
      }
      b = 63;
    }
    bytes.push(b);
  }
  return Uint8Array.from(bytes);
}

export function decodeText(bytes, charset, strict = false) {
  choice(charset, DECODE_CHARSETS, 'Character set');
  if (charset === 'ISO-8859-1') return Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  if (charset === 'US-ASCII') {
    let s = '';
    for (const b of bytes) {
      if (b > 127) {
        if (strict) throw new Error(`Byte 0x${b.toString(16)} is not valid US-ASCII.`);
        s += '�';
      } else s += String.fromCharCode(b);
    }
    return s;
  }
  try {
    return new TextDecoder(charset, { fatal: strict, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`The data is not valid ${charset}.`);
  }
}

export const encodeTextOperation = defineOp(
  {
    name: 'Encode text',
    id: 'encode_text',
    module: 'Encoding',
    description: 'Converts text into bytes in the chosen character set (UTF-8/16 and common single-byte code pages).',
    keywords: ['charset', 'encoding', 'utf-16', 'utf-8', 'latin1', 'windows-1252', 'codepage', 'iso-8859'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'charset', label: 'Character set', type: 'select', options: ENCODE_CHARSETS, default: 'UTF-8' },
      { name: 'onUnmappable', label: 'Unmappable characters', type: 'select', options: ['Error', 'Replace with ?'], default: 'Error' }
    ]
  },
  async (input, { charset = 'UTF-8', onUnmappable = 'Error' } = {}) => Dish.fromBytes(encodeText(input, charset, onUnmappable))
);

export const decodeTextOperation = defineOp(
  {
    name: 'Decode text',
    id: 'decode_text',
    module: 'Encoding',
    description: 'Interprets bytes as text in the chosen character set using the browser TextDecoder.',
    keywords: ['charset', 'encoding', 'utf-16', 'utf-8', 'latin1', 'windows-1252', 'codepage', 'shift_jis', 'gbk'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'charset', label: 'Character set', type: 'select', options: DECODE_CHARSETS, default: 'UTF-8' },
      { name: 'invalid', label: 'Invalid bytes', type: 'select', options: ['Replace with U+FFFD', 'Error'], default: 'Replace with U+FFFD' }
    ]
  },
  async (dish, { charset = 'UTF-8', invalid = 'Replace with U+FFFD' } = {}) => decodeText(dishBytes(dish), charset, invalid === 'Error')
);

// ============================================================================
// Base62 / Base45
// ============================================================================

function resolveAlphabet(spec, size, label) {
  const chars = expandAlphabet(spec);
  if (chars.length !== size || new Set(chars).size !== size) {
    throw new Error(`${label} alphabet must contain exactly ${size} distinct characters (got ${new Set(chars).size}).`);
  }
  return chars;
}

export function toBaseN(bytes, alphabet) {
  const base = BigInt(alphabet.length);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (let i = zeros; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
  let out = '';
  while (n > 0n) { out = alphabet[Number(n % base)] + out; n /= base; }
  return alphabet[0].repeat(zeros) + out;
}

export function fromBaseN(text, alphabet, label) {
  const index = new Map(alphabet.map((c, i) => [c, i]));
  const base = BigInt(alphabet.length);
  const chars = Array.from(text);
  let zeros = 0;
  while (zeros < chars.length && chars[zeros] === alphabet[0]) zeros++;
  let n = 0n;
  for (let i = zeros; i < chars.length; i++) {
    const v = index.get(chars[i]);
    if (v === undefined) throw new Error(`Character "${chars[i]}" is not in the ${label} alphabet.`);
    n = n * base + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes]);
}

export const toBase62Operation = defineOp(
  {
    name: 'To Base62',
    id: 'to_base62',
    module: 'Data Format',
    description: 'Encodes bytes as Base62 (big-number radix conversion). Each leading zero byte becomes one leading first-alphabet character so data round-trips.',
    keywords: ['base62', 'alphanumeric', 'short url', 'radix'],
    inputType: 'Dish',
    outputType: 'string',
    args: [{ name: 'alphabet', label: 'Alphabet', type: 'text', default: '0-9A-Za-z' }]
  },
  async (dish, { alphabet = '0-9A-Za-z' } = {}) => toBaseN(dishBytes(dish), resolveAlphabet(alphabet, 62, 'Base62'))
);

export const fromBase62Operation = defineOp(
  {
    name: 'From Base62',
    id: 'from_base62',
    module: 'Data Format',
    description: 'Decodes Base62 text back to bytes.',
    keywords: ['base62', 'alphanumeric', 'decode', 'radix'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'alphabet', label: 'Alphabet', type: 'text', default: '0-9A-Za-z' }]
  },
  async (input, { alphabet = '0-9A-Za-z' } = {}) =>
    Dish.fromBytes(fromBaseN(input.trim(), resolveAlphabet(alphabet, 62, 'Base62'), 'Base62'))
);

const B45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

export function base45Encode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      const n = bytes[i] * 256 + bytes[i + 1];
      out += B45[n % 45] + B45[Math.floor(n / 45) % 45] + B45[Math.floor(n / 2025)];
    } else {
      out += B45[bytes[i] % 45] + B45[Math.floor(bytes[i] / 45)];
    }
  }
  return out;
}

export function base45Decode(text) {
  if (text.length % 3 === 1) throw new Error('Invalid Base45: length must not be 1 more than a multiple of 3.');
  const vals = Array.from(text).map((c) => {
    const v = B45.indexOf(c);
    if (v < 0) throw new Error(`Invalid Base45 character "${c}".`);
    return v;
  });
  const out = [];
  for (let i = 0; i < vals.length; i += 3) {
    if (i + 2 < vals.length) {
      const n = vals[i] + vals[i + 1] * 45 + vals[i + 2] * 2025;
      if (n > 65535) throw new Error('Invalid Base45: triplet value exceeds 65535.');
      out.push(n >> 8, n & 0xff);
    } else {
      const n = vals[i] + vals[i + 1] * 45;
      if (n > 255) throw new Error('Invalid Base45: final pair value exceeds 255.');
      out.push(n);
    }
  }
  return Uint8Array.from(out);
}

export const toBase45Operation = defineOp(
  {
    name: 'To Base45',
    id: 'to_base45',
    module: 'Data Format',
    description: 'Encodes bytes as Base45 (RFC 9285), the alphanumeric encoding used in QR codes such as EU Digital COVID Certificates.',
    keywords: ['base45', 'qr', 'rfc 9285', 'covid', 'dcc', 'alphanumeric'],
    inputType: 'Dish',
    outputType: 'string',
    args: []
  },
  async (dish) => base45Encode(dishBytes(dish))
);

export const fromBase45Operation = defineOp(
  {
    name: 'From Base45',
    id: 'from_base45',
    module: 'Data Format',
    description: 'Decodes Base45 (RFC 9285) text back to bytes.',
    keywords: ['base45', 'qr', 'rfc 9285', 'covid', 'dcc', 'decode'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => Dish.fromBytes(base45Decode(input.replace(/[\r\n]+$/, '')))
);

// ============================================================================
// Defang
// ============================================================================

const URL_RE = '(?:https?|ftp|hxxps?)://[^\\s<>"\'`]+';
const DOMAIN_RE = '(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}';
const DEFANG_TARGETS = ['Valid domains and full URLs', 'Only full URLs', 'Everything'];

export function defangText(text, { dots = true, http = true, colon = true, target = DEFANG_TARGETS[0] } = {}) {
  const apply = (s) => {
    let r = s;
    if (http) r = r.replace(/^(?:h)tt(ps?)/i, (m, p) => `hxx${p}`);
    if (colon) r = r.replace(/:\/\//g, '[://]');
    if (dots) r = r.replace(/\./g, '[.]');
    return r;
  };
  if (target === 'Everything') return apply(text);
  const re = target === 'Only full URLs'
    ? new RegExp(URL_RE, 'gi')
    : new RegExp(`${URL_RE}|\\b${DOMAIN_RE}\\b`, 'gi');
  return text.replace(re, apply);
}

export const defangUrlOperation = defineOp(
  {
    name: 'Defang URL',
    id: 'defang_url',
    module: 'Networking',
    description: 'Makes URLs and domains safe to share by rewriting them (example.com to example[.]com, http:// to hxxp[://]).',
    keywords: ['defang', 'ioc', 'malware', 'url', 'domain', 'hxxp', 'sanitize', 'threat intel'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'escapeDots', label: 'Escape dots', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'escapeHttp', label: 'Escape http (hxxp)', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'escapeColon', label: 'Escape ://', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'process', label: 'Process', type: 'select', options: DEFANG_TARGETS, default: DEFANG_TARGETS[0] }
    ]
  },
  async (input, a = {}) => {
    const target = choice(a.process ?? DEFANG_TARGETS[0], DEFANG_TARGETS, 'Process');
    return defangText(input, { dots: isYes(a.escapeDots ?? 'Yes'), http: isYes(a.escapeHttp ?? 'Yes'), colon: isYes(a.escapeColon ?? 'Yes'), target });
  }
);

export const fangUrlOperation = defineOp(
  {
    name: 'Fang URL',
    id: 'fang_url',
    module: 'Networking',
    description: 'Reverses defanging: [.] to ., hxxp to http, [://] to ://.',
    keywords: ['fang', 'refang', 'defang', 'ioc', 'url', 'restore'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'restoreDots', label: 'Restore dots', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'restoreHttp', label: 'Restore http', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'restoreColon', label: 'Restore ://', type: 'select', options: YES_NO, default: 'Yes' }
    ]
  },
  async (input, a = {}) => {
    let r = input;
    if (isYes(a.restoreHttp ?? 'Yes')) r = r.replace(/hxxp(s?)/gi, (m, s) => `http${s}`);
    if (isYes(a.restoreColon ?? 'Yes')) r = r.replace(/\[:\/\/\]|\[:\]\/\//g, '://');
    if (isYes(a.restoreDots ?? 'Yes')) r = r.replace(/\[\.\]|\(\.\)|\[dot\]/gi, '.');
    return r;
  }
);

export const defangIpOperation = defineOp(
  {
    name: 'Defang IP Addresses',
    id: 'defang_ip',
    module: 'Networking',
    description: 'Rewrites IPv4 dots as [.] and IPv6 colons as [:] so addresses are not clickable or auto-linked.',
    keywords: ['defang', 'ioc', 'ip', 'ipv4', 'ipv6', 'sanitize', 'threat intel'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => input
    .replace(/(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi, (m) => (m.includes('::') || m.split(':').length === 8 ? m.replace(/:/g, '[:]') : m))
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (m) => m.replace(/\./g, '[.]'))
);

// ============================================================================
// CSV / JSON
// ============================================================================

export function parseCsv(text, cellDelimiter = ',', rowDelimiter = '\r\n') {
  if (cellDelimiter === '') throw new Error('Cell delimiter must not be empty.');
  if (rowDelimiter === '') throw new Error('Row delimiter must not be empty.');
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  let quoted = false;
  const endField = () => { row.push(field); field = ''; quoted = false; };
  const rowBreakLen = (at) => {
    if (text.startsWith(rowDelimiter, at)) return rowDelimiter.length;
    if (rowDelimiter === '\r\n' && (text[at] === '\n' || text[at] === '\r')) return 1;
    return 0;
  };
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '' && !quoted) { inQuotes = true; quoted = true; i++; continue; }
    if (text.startsWith(cellDelimiter, i)) { endField(); i += cellDelimiter.length; continue; }
    const rb = rowBreakLen(i);
    if (rb > 0) {
      const blank = row.length === 0 && field === '' && !quoted;
      if (!blank) { endField(); rows.push(row); }
      row = [];
      i += rb;
      continue;
    }
    field += ch; i++;
  }
  if (inQuotes) throw new Error('Invalid CSV: a quoted field is missing its closing quote.');
  if (field !== '' || quoted || row.length > 0) { endField(); rows.push(row); }
  return rows;
}

function csvCell(value, cellDelimiter) {
  let s;
  if (value === null || value === undefined) s = '';
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  return /["\r\n]/.test(s) || s.includes(cellDelimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function jsonToCsv(text, cellDelimiter = ',', rowDelimiter = '\r\n') {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`Invalid JSON: ${e.message}`); }
  if (!Array.isArray(data)) data = [data];
  if (data.length === 0) return '';
  const lines = [];
  if (data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const keys = [];
    for (const r of data) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    lines.push(keys.map((k) => csvCell(k, cellDelimiter)).join(cellDelimiter));
    for (const r of data) lines.push(keys.map((k) => csvCell(r[k], cellDelimiter)).join(cellDelimiter));
  } else if (data.every((r) => Array.isArray(r))) {
    for (const r of data) lines.push(r.map((c) => csvCell(c, cellDelimiter)).join(cellDelimiter));
  } else if (data.every((r) => r === null || typeof r !== 'object')) {
    for (const r of data) lines.push(csvCell(r, cellDelimiter));
  } else {
    throw new Error('JSON must be an array of objects, an array of arrays, or an array of scalar values.');
  }
  return lines.join(rowDelimiter);
}

const CSV_ARGS = [
  { name: 'cellDelimiter', label: 'Cell delimiter', type: 'text', default: ',' },
  { name: 'rowDelimiter', label: 'Row delimiter', type: 'text', default: '\\r\\n' }
];

export const jsonToCsvOperation = defineOp(
  {
    name: 'JSON to CSV',
    id: 'json_to_csv',
    module: 'Data Format',
    description: 'Converts a JSON array of objects (or arrays) to RFC 4180 CSV with a header row. Nested values are written as JSON.',
    keywords: ['json', 'csv', 'convert', 'table', 'spreadsheet', 'export'],
    inputType: 'string',
    outputType: 'string',
    args: CSV_ARGS
  },
  async (input, { cellDelimiter = ',', rowDelimiter = '\\r\\n' } = {}) =>
    jsonToCsv(input, unescapeShort(cellDelimiter), unescapeShort(rowDelimiter))
);

export const csvToJsonOperation = defineOp(
  {
    name: 'CSV to JSON',
    id: 'csv_to_json',
    module: 'Data Format',
    description: 'Parses CSV (quoted fields, escaped quotes, embedded newlines) into JSON. All values stay strings.',
    keywords: ['csv', 'json', 'convert', 'parse', 'table', 'import'],
    inputType: 'string',
    outputType: 'string',
    args: [
      ...CSV_ARGS,
      { name: 'format', label: 'Format', type: 'select', options: ['Array of dictionaries', 'Array of arrays'], default: 'Array of dictionaries' }
    ]
  },
  async (input, { cellDelimiter = ',', rowDelimiter = '\\r\\n', format = 'Array of dictionaries' } = {}) => {
    choice(format, ['Array of dictionaries', 'Array of arrays'], 'Format');
    const rows = parseCsv(input, unescapeShort(cellDelimiter), unescapeShort(rowDelimiter));
    if (format === 'Array of arrays' || rows.length === 0) return JSON.stringify(rows, null, 2);
    const [header, ...body] = rows;
    return JSON.stringify(body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? '']))), null, 2);
  }
);

const PARSE_CSV_OUTPUTS = ['Aligned table', 'JSON (array of arrays)', 'TSV'];

export const parseCsvOperation = defineOp(
  {
    name: 'Parse CSV',
    id: 'parse_csv',
    module: 'Data Format',
    description: 'Parses CSV and shows it as an aligned table, JSON arrays or tab-separated values. Reports ragged rows.',
    keywords: ['csv', 'parse', 'table', 'tsv', 'columns', 'rows'],
    inputType: 'string',
    outputType: 'string',
    args: [
      ...CSV_ARGS,
      { name: 'output', label: 'Output', type: 'select', options: PARSE_CSV_OUTPUTS, default: PARSE_CSV_OUTPUTS[0] }
    ]
  },
  async (input, { cellDelimiter = ',', rowDelimiter = '\\r\\n', output = PARSE_CSV_OUTPUTS[0] } = {}) => {
    choice(output, PARSE_CSV_OUTPUTS, 'Output');
    const rows = parseCsv(input, unescapeShort(cellDelimiter), unescapeShort(rowDelimiter));
    if (output === 'JSON (array of arrays)') return JSON.stringify(rows, null, 2);
    if (output === 'TSV') return rows.map((r) => r.map((c) => c.replace(/[\t\r\n]/g, ' ')).join('\t')).join('\n');
    const cols = Math.max(0, ...rows.map((r) => r.length));
    const widths = Array.from({ length: cols }, (_, c) => Math.max(...rows.map((r) => (r[c] ?? '').replace(/\s+/g, ' ').length)));
    const lines = rows.map((r) => widths.map((w, c) => (r[c] ?? '').replace(/\s+/g, ' ').padEnd(w)).join(' | ').trimEnd());
    const ragged = rows.filter((r) => r.length !== cols).length;
    return lines.join('\n') + (ragged ? `\n\n${ragged} row(s) have a different number of columns than the widest row (${cols}).` : '');
  }
);

// ============================================================================
// PEM <-> Hex
// ============================================================================

export const pemToHexOperation = defineOp(
  {
    name: 'PEM to Hex',
    id: 'pem_to_hex',
    module: 'Data Format',
    description: 'Extracts the DER bytes from each PEM block (certificate, key, CSR...) and shows them as hex, one block per line.',
    keywords: ['pem', 'der', 'hex', 'certificate', 'key', 'base64', 'x509', 'asn.1'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => {
    const re = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;
    const out = [];
    for (const m of input.matchAll(re)) {
      const body = m[2].split(/\r?\n/).filter((l) => l.trim() !== '' && !l.includes(':')).join('');
      out.push(bytesToHex(base64ToBytes(body, `PEM ${m[1]} body`)));
    }
    if (out.length === 0) throw new Error('No PEM block found. Expected -----BEGIN ...----- and matching -----END ...----- lines.');
    return out.join('\n');
  }
);

export const hexToPemOperation = defineOp(
  {
    name: 'Hex to PEM',
    id: 'hex_to_pem',
    module: 'Data Format',
    description: 'Wraps hex-encoded DER bytes in a PEM block with 64-column Base64 and the given label.',
    keywords: ['pem', 'der', 'hex', 'certificate', 'key', 'base64', 'x509', 'armor'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'label', label: 'Label', type: 'text', default: 'CERTIFICATE' }]
  },
  async (input, { label = 'CERTIFICATE' } = {}) => {
    const name = String(label).trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9 ]*$/.test(name)) throw new Error('PEM label may only contain letters, digits and spaces (for example CERTIFICATE).');
    const bytes = hexToBytes(input, 'Input');
    if (bytes.length === 0) throw new Error('Input is empty; provide hex-encoded DER bytes.');
    const b64 = bytesToBase64(bytes).match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${name}-----\n${b64}\n-----END ${name}-----`;
  }
);

export const encodingOperations = [
  caesarOperation, rotNOperation, rot47Operation, vigenereEncodeOperation, vigenereDecodeOperation, atbashOperation,
  toMorseOperation, fromMorseOperation, a1z26EncodeOperation, a1z26DecodeOperation,
  toHtmlEntityOperation, fromHtmlEntityOperation, toPunycodeOperation, fromPunycodeOperation,
  toQuotedPrintableOperation, fromQuotedPrintableOperation, encodeTextOperation, decodeTextOperation,
  toBase62Operation, fromBase62Operation, toBase45Operation, fromBase45Operation,
  defangUrlOperation, fangUrlOperation, defangIpOperation,
  jsonToCsvOperation, csvToJsonOperation, parseCsvOperation, pemToHexOperation, hexToPemOperation
];

export default encodingOperations;
