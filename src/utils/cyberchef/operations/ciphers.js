/**
 * Cipher Operations
 * ROT13, XOR, Reverse String
 */

import { Operation } from '../core/Operation.js';

export class Rot13Operation extends Operation {
  constructor() {
    super({
      name: 'ROT13',
      id: 'rot13',
      module: 'Ciphers',
      description: 'Rotates ASCII letters by 13 positions (Caesar cipher variant).',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input) return '';
    return input.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
  }
}

export class XorOperation extends Operation {
  constructor() {
    super({
      name: 'XOR',
      id: 'xor',
      module: 'Ciphers',
      description: 'Performs bitwise XOR with single-byte or repeating text/hex key.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key (hex or text)', type: 'text', default: '5A' },
        { name: 'outputFormat', label: 'Output Format', type: 'select', options: ['Hex', 'Latin1 String', 'UTF-8 String'], default: 'Hex' }
      ]
    });
  }

  async run(input, { key = '5A', outputFormat = 'Hex' } = {}) {
    if (!input) return '';
    const cleanKey = key.trim();
    let kBytes;
    if (/^[0-9a-fA-F]{2}$/.test(cleanKey)) {
      kBytes = [parseInt(cleanKey, 16)];
    } else if (/^[0-9a-fA-F]{4,}$/.test(cleanKey) && cleanKey.length % 2 === 0) {
      kBytes = [];
      for (let i = 0; i < cleanKey.length; i += 2) {
        kBytes.push(parseInt(cleanKey.substr(i, 2), 16));
      }
    } else {
      kBytes = Array.from(new TextEncoder().encode(cleanKey || 'X'));
    }

    const inBytes = new TextEncoder().encode(input);
    const out = new Uint8Array(inBytes.length);
    for (let i = 0; i < inBytes.length; i++) {
      out[i] = inBytes[i] ^ kBytes[i % kBytes.length];
    }

    if (outputFormat === 'Hex') {
      return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join(' ');
    } else if (outputFormat === 'Latin1 String') {
      return Array.from(out).map(b => String.fromCharCode(b)).join('');
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(out);
  }
}

export class ReverseStringOperation extends Operation {
  constructor() {
    super({
      name: 'Reverse String',
      id: 'reverse_string',
      module: 'Ciphers',
      description: 'Reverses the sequence of characters in the input string.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input) return '';
    return Array.from(input).reverse().join('');
  }
}

export const cipherOperations = [
  new Rot13Operation(),
  new XorOperation(),
  new ReverseStringOperation()
];
