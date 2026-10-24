/**
 * Obfuscation Operations
 * CharCode Array, Hex Escape, Unicode Escape, PowerShell String Slicing, DuckyScript Jitter
 */

import { Operation } from '../core/Operation.js';

export class ObfuscateCharCodeOperation extends Operation {
  constructor() {
    super({
      name: 'JavaScript CharCode Array',
      id: 'obfuscate_charcode',
      module: 'Obfuscation',
      description: 'Converts string into String.fromCharCode(c1, c2, c3...).',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input) return '';
    const codes = Array.from(new TextEncoder().encode(input)).join(',');
    return `String.fromCharCode(${codes})`;
  }
}

export class ObfuscateHexEscapeOperation extends Operation {
  constructor() {
    super({
      name: 'Hex Escape Sequence',
      id: 'obfuscate_hex_escape',
      module: 'Obfuscation',
      description: 'Encodes string as \\x41\\x42 escape codes for C, Python, and JS strings.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input) return '';
    const bytes = new TextEncoder().encode(input);
    return Array.from(bytes).map(b => `\\x${b.toString(16).padStart(2, '0')}`).join('');
  }
}

export class ObfuscateUnicodeEscapeOperation extends Operation {
  constructor() {
    super({
      name: 'Unicode Escape Sequence',
      id: 'obfuscate_unicode_escape',
      module: 'Obfuscation',
      description: 'Encodes string as \\u0041\\u0042 escape codes.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input) return '';
    let out = '';
    for (let i = 0; i < input.length; i++) {
      out += '\\u' + input.charCodeAt(i).toString(16).padStart(4, '0');
    }
    return out;
  }
}

export class ObfuscatePowershellOperation extends Operation {
  constructor() {
    super({
      name: 'PowerShell String Slicing',
      id: 'obfuscate_powershell',
      module: 'Obfuscation',
      description: 'Splits strings into scrambled format tokens (e.g., "{1}{0}" -f "x","e").',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'chunksCount', label: 'Number of Chunks', type: 'number', default: 4 }
      ]
    });
  }

  async run(input, { chunksCount = 4 } = {}) {
    if (!input || input.length < 2) return input;
    const count = Math.max(2, Math.min(input.length, Number(chunksCount) || 4));
    const chunkSize = Math.max(1, Math.floor(input.length / count));
    const chunks = [];
    for (let i = 0; i < input.length; i += chunkSize) {
      chunks.push(input.substring(i, i + chunkSize));
    }
    const indices = chunks.map((_, idx) => idx).reverse();
    const formatStr = indices.map(idx => `{${idx}}`).join('');
    const formatArgs = indices.map(idx => `"${chunks[idx]}"`).join(',');
    return `('${formatStr}' -f ${formatArgs})`;
  }
}

export class DuckyJitterOperation extends Operation {
  constructor() {
    super({
      name: 'DuckyScript Micro-Delay Jitter',
      id: 'ducky_jitter',
      module: 'Obfuscation',
      description: 'Adds random DELAYs between DuckyScript keystrokes to simulate human typing and evade behavioral rate-limiters.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'minDelay', label: 'Min Delay (ms)', type: 'number', default: 20 },
        { name: 'maxDelay', label: 'Max Delay (ms)', type: 'number', default: 80 }
      ]
    });
  }

  async run(input, { minDelay = 20, maxDelay = 80 } = {}) {
    if (!input) return '';
    const lines = input.split('\n');
    const outLines = [];
    const min = Number(minDelay) || 20;
    const max = Number(maxDelay) || 80;

    for (const line of lines) {
      if (line.startsWith('STRING ')) {
        const text = line.substring(7);
        for (let i = 0; i < text.length; i++) {
          outLines.push(`STRING ${text[i]}`);
          const jitter = Math.floor(Math.random() * (max - min + 1)) + min;
          outLines.push(`DELAY ${jitter}`);
        }
      } else {
        outLines.push(line);
      }
    }
    return outLines.join('\n');
  }
}

export const obfuscationOperations = [
  new ObfuscateCharCodeOperation(),
  new ObfuscateHexEscapeOperation(),
  new ObfuscateUnicodeEscapeOperation(),
  new ObfuscatePowershellOperation(),
  new DuckyJitterOperation()
];
