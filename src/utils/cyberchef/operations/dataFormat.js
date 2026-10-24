/**
 * Data Format Operations
 * Decimal, Binary, Base64, Base32, Base58, Base85, Hex, Hexdump, URL
 */

import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';

// Base32 RFC 4648 Constants
const B32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Base58 Bitcoin Alphabet Constants
const B58_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

// ============================================================================
// BASE32
// ============================================================================

export class ToBase32Operation extends Operation {
  constructor() {
    super({
      name: 'To Base32',
      id: 'to_base32',
      module: 'Data Format',
      description: 'Encodes data into RFC 4648 standard Base32 format.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'pad', label: 'Include Padding (=)', type: 'select', options: ['Yes', 'No'], default: 'Yes' }
      ]
    });
  }

  async run(dish, { pad = 'Yes' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const bytes = inputDish.toUint8Array();
    if (bytes.length === 0) return '';

    let bits = 0, value = 0, output = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        output += B32_CHARS[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) {
      output += B32_CHARS[(value << (5 - bits)) & 31];
    }
    if (pad === 'Yes') {
      while (output.length % 8 !== 0) output += '=';
    }
    return output;
  }
}

export class FromBase32Operation extends Operation {
  constructor() {
    super({
      name: 'From Base32',
      id: 'from_base32',
      module: 'Data Format',
      description: 'Decodes RFC 4648 Base32 strings back into bytes or text.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return new Dish('', 'string');
    const clean = input.toUpperCase().replace(/[=\s]/g, '');
    let bits = 0, value = 0, index = 0;
    const out = new Uint8Array((clean.length * 5) / 8 | 0);
    for (let i = 0; i < clean.length; i++) {
      const val = B32_CHARS.indexOf(clean[i]);
      if (val === -1) continue;
      value = (value << 5) | val;
      bits += 5;
      if (bits >= 8) {
        out[index++] = (value >>> (bits - 8)) & 255;
        bits -= 8;
      }
    }
    return new Dish(out.subarray(0, index).buffer, 'ArrayBuffer');
  }
}

// ============================================================================
// BASE58
// ============================================================================

export class ToBase58Operation extends Operation {
  constructor() {
    super({
      name: 'To Base58',
      id: 'to_base58',
      module: 'Data Format',
      description: 'Encodes data using Bitcoin / IPFS Base58 alphabet.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const bytes = inputDish.toUint8Array();
    if (bytes.length === 0) return '';

    let digits = [0];
    for (let i = 0; i < bytes.length; i++) {
      for (let j = 0; j < digits.length; j++) digits[j] <<= 8;
      digits[0] += bytes[i];
      let carry = 0;
      for (let j = 0; j < digits.length; ++j) {
        digits[j] += carry;
        carry = (digits[j] / 58) | 0;
        digits[j] %= 58;
      }
      while (carry) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let str = '';
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) str += '1';
    for (let i = digits.length - 1; i >= 0; i--) str += B58_CHARS[digits[i]];
    return str;
  }
}

export class FromBase58Operation extends Operation {
  constructor() {
    super({
      name: 'From Base58',
      id: 'from_base58',
      module: 'Data Format',
      description: 'Decodes Bitcoin Base58 strings back into bytes or text.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return new Dish('', 'string');
    const str = input.trim();
    let bytes = [0];
    for (let i = 0; i < str.length; i++) {
      const c = str[i];
      const val = B58_CHARS.indexOf(c);
      if (val === -1) continue;
      for (let j = 0; j < bytes.length; j++) bytes[j] *= 58;
      bytes[0] += val;
      let carry = 0;
      for (let j = 0; j < bytes.length; ++j) {
        bytes[j] += carry;
        carry = bytes[j] >> 8;
        bytes[j] &= 0xff;
      }
      while (carry) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    for (let i = 0; i < str.length && str[i] === '1'; i++) bytes.push(0);
    return new Dish(new Uint8Array(bytes.reverse()).buffer, 'ArrayBuffer');
  }
}

// ============================================================================
// BASE85
// ============================================================================

export class ToBase85Operation extends Operation {
  constructor() {
    super({
      name: 'To Base85',
      id: 'to_base85',
      module: 'Data Format',
      description: 'Encodes data using Adobe / Ascii85 Base85 format.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const bytes = inputDish.toUint8Array();
    if (bytes.length === 0) return '';

    let out = '';
    const padLen = (4 - (bytes.length % 4)) % 4;
    const padded = new Uint8Array(bytes.length + padLen);
    padded.set(bytes);

    for (let i = 0; i < padded.length; i += 4) {
      const val = ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0;
      if (val === 0 && i + 4 <= bytes.length) {
        out += 'z';
      } else {
        const c5 = val % 85;
        const v4 = Math.floor(val / 85);
        const c4 = v4 % 85;
        const v3 = Math.floor(v4 / 85);
        const c3 = v3 % 85;
        const v2 = Math.floor(v3 / 85);
        const c2 = v2 % 85;
        const c1 = Math.floor(v2 / 85);
        out += String.fromCharCode(c1 + 33, c2 + 33, c3 + 33, c4 + 33, c5 + 33);
      }
    }

    if (padLen > 0) {
      out = out.slice(0, out.length - padLen);
    }
    return `<~${out}~>`;
  }
}

export class FromBase85Operation extends Operation {
  constructor() {
    super({
      name: 'From Base85',
      id: 'from_base85',
      module: 'Data Format',
      description: 'Decodes Ascii85 / Base85 strings back into bytes or text.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return new Dish('', 'string');
    let clean = input.trim();
    if (clean.startsWith('<~')) clean = clean.slice(2);
    if (clean.endsWith('~>')) clean = clean.slice(0, -2);
    clean = clean.replace(/\s+/g, '');

    const bytes = [];
    let i = 0;
    while (i < clean.length) {
      if (clean[i] === 'z') {
        bytes.push(0, 0, 0, 0);
        i++;
        continue;
      }
      const chunk = clean.slice(i, i + 5);
      let val = 0;
      const padLen = 5 - chunk.length;
      for (let j = 0; j < 5; j++) {
        const c = j < chunk.length ? chunk.charCodeAt(j) - 33 : 84;
        val = val * 85 + c;
      }
      const b0 = (val >>> 24) & 0xff;
      const b1 = (val >>> 16) & 0xff;
      const b2 = (val >>> 8) & 0xff;
      const b3 = val & 0xff;
      const raw = [b0, b1, b2, b3];
      for (let k = 0; k < 4 - padLen; k++) {
        bytes.push(raw[k]);
      }
      i += chunk.length;
    }

    return new Dish(new Uint8Array(bytes).buffer, 'ArrayBuffer');
  }
}

// ============================================================================
// HEXDUMP
// ============================================================================

export class ToHexdumpOperation extends Operation {
  constructor() {
    super({
      name: 'To Hexdump',
      id: 'to_hexdump',
      module: 'Data Format',
      description: 'Formats input bytes into canonical 16-bytes-per-line hexdump with offset and ASCII columns.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'width', label: 'Bytes Per Line', type: 'number', default: 16 }
      ]
    });
  }

  async run(dish, { width = 16 } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    return inputDish.toHexdump(Number(width) || 16);
  }
}

export class FromHexdumpOperation extends Operation {
  constructor() {
    super({
      name: 'From Hexdump',
      id: 'from_hexdump',
      module: 'Data Format',
      description: 'Parses canonical hexdump text back into raw binary bytes.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return new Dish('', 'string');
    const lines = input.trim().split(/\r?\n/);
    const hexBytes = [];

    for (const line of lines) {
      // Look for hex column, e.g. after offset: 00000000  48 65 6c ... |Hello|
      const match = line.match(/^[0-9a-fA-F]{4,8}\s+((?:[0-9a-fA-F]{2}\s*)+)/);
      if (match) {
        const parts = match[1].trim().split(/\s+/);
        for (const p of parts) {
          if (/^[0-9a-fA-F]{2}$/.test(p)) hexBytes.push(parseInt(p, 16));
        }
      } else {
        const cleanNoAscii = line.replace(/\|.*\|/, '').replace(/^[0-9a-fA-F]{4,8}\s*/, '');
        const tokens = cleanNoAscii.trim().split(/\s+/);
        for (const t of tokens) {
          if (/^[0-9a-fA-F]{2}$/.test(t)) hexBytes.push(parseInt(t, 16));
        }
      }
    }

    return new Dish(new Uint8Array(hexBytes).buffer, 'ArrayBuffer');
  }
}

// ============================================================================
// DECIMAL, BINARY, BASE64, HEX, URL
// ============================================================================

export class ToDecimalOperation extends Operation {
  constructor() {
    super({
      name: 'To Decimal',
      id: 'to_decimal',
      module: 'Data Format',
      description: 'Converts input bytes or characters to decimal integer byte representations (0-255).',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'delimiter', label: 'Delimiter', type: 'select', options: ['Space', 'Comma', 'Semi-colon', 'Line feed'], default: 'Space' }
      ]
    });
  }

  async run(dish, { delimiter = 'Space' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const uint8 = inputDish.toUint8Array();
    const delim = delimiter === 'Space' ? ' ' : delimiter === 'Comma' ? ', ' : delimiter === 'Semi-colon' ? '; ' : '\n';
    const decs = [];
    for (let i = 0; i < uint8.length; i++) {
      decs.push(uint8[i].toString(10));
    }
    return decs.join(delim);
  }
}

export class FromDecimalOperation extends Operation {
  constructor() {
    super({
      name: 'From Decimal',
      id: 'from_decimal',
      module: 'Data Format',
      description: 'Parses decimal byte values (0-255) back into decoded characters or binary bytes.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return new Dish('', 'string');
    const matches = input.match(/\b\d+\b/g);
    if (!matches) return new Dish('', 'string');
    const bytes = new Uint8Array(matches.map(m => parseInt(m, 10) & 0xff));
    return new Dish(bytes.buffer, 'ArrayBuffer');
  }
}

export class ToBinaryOperation extends Operation {
  constructor() {
    super({
      name: 'To Binary',
      id: 'to_binary',
      module: 'Data Format',
      description: 'Converts input bytes into 8-bit binary strings (e.g., 01001000 01100101).',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'delimiter', label: 'Delimiter', type: 'select', options: ['Space', 'None', 'Comma', 'Line feed'], default: 'Space' }
      ]
    });
  }

  async run(dish, { delimiter = 'Space' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const uint8 = inputDish.toUint8Array();
    const delim = delimiter === 'Space' ? ' ' : delimiter === 'None' ? '' : delimiter === 'Comma' ? ', ' : '\n';
    const bits = [];
    for (let i = 0; i < uint8.length; i++) {
      bits.push(uint8[i].toString(2).padStart(8, '0'));
    }
    return bits.join(delim);
  }
}

export class FromBinaryOperation extends Operation {
  constructor() {
    super({
      name: 'From Binary',
      id: 'from_binary',
      module: 'Data Format',
      description: 'Converts 8-bit binary representations back to text or binary bytes.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return new Dish('', 'string');
    const clean = input.trim();
    let chunks = [];
    if (/\s+/.test(clean)) {
      chunks = clean.split(/\s+/);
    } else {
      for (let i = 0; i < clean.length; i += 8) {
        chunks.push(clean.substr(i, 8));
      }
    }
    const bytes = new Uint8Array(chunks.map(c => parseInt(c, 2) & 0xff));
    return new Dish(bytes.buffer, 'ArrayBuffer');
  }
}

export class ToBase64Operation extends Operation {
  constructor() {
    super({
      name: 'To Base64',
      id: 'to_base64',
      module: 'Data Format',
      description: 'Encodes raw text or binary bytes into standard RFC 4648 Base64 format.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    return inputDish.toBase64();
  }
}

export class FromBase64Operation extends Operation {
  constructor() {
    super({
      name: 'From Base64',
      id: 'from_base64',
      module: 'Data Format',
      description: 'Decodes Base64 string into bytes or UTF-8 text.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    return Dish.fromBase64(input);
  }
}

export class ToHexOperation extends Operation {
  constructor() {
    super({
      name: 'To Hex',
      id: 'to_hex',
      module: 'Data Format',
      description: 'Converts input text or binary bytes into hexadecimal representation.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'delimiter', label: 'Delimiter', type: 'select', options: ['Space', 'None', '0x prefix', 'Comma'], default: 'Space' }
      ]
    });
  }

  async run(dish, { delimiter = 'Space' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let delim = '';
    if (delimiter === 'Space') delim = ' ';
    else if (delimiter === '0x prefix') delim = '0x';
    else if (delimiter === 'Comma') delim = ',';
    return inputDish.toHex(delim);
  }
}

export class FromHexOperation extends Operation {
  constructor() {
    super({
      name: 'From Hex',
      id: 'from_hex',
      module: 'Data Format',
      description: 'Converts hexadecimal byte string into bytes or UTF-8 text.',
      inputType: 'string',
      outputType: 'Dish',
      args: []
    });
  }

  async run(input) {
    return Dish.fromHex(input);
  }
}

export class UrlEncodeOperation extends Operation {
  constructor() {
    super({
      name: 'URL Encode',
      id: 'url_encode',
      module: 'Data Format',
      description: 'Standard percent-encoding for URI query strings and parameters.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'encodeAll', label: 'Encode All Characters', type: 'select', options: ['No', 'Yes'], default: 'No' }
      ]
    });
  }

  async run(input, { encodeAll = 'No' } = {}) {
    if (!input) return '';
    if (encodeAll === 'Yes') {
      const bytes = new TextEncoder().encode(input);
      let res = '';
      for (let i = 0; i < bytes.length; i++) {
        res += '%' + bytes[i].toString(16).padStart(2, '0').toUpperCase();
      }
      return res;
    }
    return encodeURIComponent(input);
  }
}

export class UrlDecodeOperation extends Operation {
  constructor() {
    super({
      name: 'URL Decode',
      id: 'url_decode',
      module: 'Data Format',
      description: 'Decodes percent-encoded URL characters (%20 -> space).',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input) return '';
    return decodeURIComponent(input);
  }
}

export const dataFormatOperations = [
  new ToDecimalOperation(),
  new FromDecimalOperation(),
  new ToBinaryOperation(),
  new FromBinaryOperation(),
  new ToBase64Operation(),
  new FromBase64Operation(),
  new ToBase32Operation(),
  new FromBase32Operation(),
  new ToBase58Operation(),
  new FromBase58Operation(),
  new ToBase85Operation(),
  new FromBase85Operation(),
  new ToHexOperation(),
  new FromHexOperation(),
  new ToHexdumpOperation(),
  new FromHexdumpOperation(),
  new UrlEncodeOperation(),
  new UrlDecodeOperation()
];
