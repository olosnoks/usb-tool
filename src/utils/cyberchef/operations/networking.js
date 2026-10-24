/**
 * Networking Operations
 * Change IP Format, Generate UUID, Parse MAC Address
 */

import { Operation } from '../core/Operation.js';

export class ChangeIpFormatOperation extends Operation {
  constructor() {
    super({
      name: 'Change IP Format',
      id: 'change_ip_format',
      module: 'Networking',
      description: 'Converts IPv4 addresses between Dotted Decimal, Hexadecimal, Integer, and Binary formats.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'format', label: 'Output Format', type: 'select', options: ['Dotted Decimal', 'Hexadecimal (0x)', 'Integer', 'Binary'], default: 'Hexadecimal (0x)' }
      ]
    });
  }

  async run(input, { format = 'Hexadecimal (0x)' } = {}) {
    if (!input || !input.trim()) return '';
    const lines = input.trim().split(/\r?\n/);

    const converted = lines.map(line => {
      const trimmed = line.trim();
      let intVal = 0;

      // Parse input format to 32-bit uint
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(trimmed)) {
        const octets = trimmed.split('.').map(Number);
        intVal = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
      } else if (/^0x[0-9a-fA-F]{1,8}$/i.test(trimmed)) {
        intVal = parseInt(trimmed, 16) >>> 0;
      } else if (/^\d+$/.test(trimmed)) {
        intVal = Number(trimmed) >>> 0;
      } else if (/^[01]{32}$/.test(trimmed)) {
        intVal = parseInt(trimmed, 2) >>> 0;
      } else {
        return `${trimmed} (Invalid IP)`;
      }

      if (format === 'Hexadecimal (0x)') {
        return '0x' + intVal.toString(16).padStart(8, '0').toUpperCase();
      } else if (format === 'Integer') {
        return String(intVal);
      } else if (format === 'Binary') {
        return intVal.toString(2).padStart(32, '0');
      } else {
        // Dotted Decimal
        return [
          (intVal >>> 24) & 255,
          (intVal >>> 16) & 255,
          (intVal >>> 8) & 255,
          intVal & 255
        ].join('.');
      }
    });

    return converted.join('\n');
  }
}

export class GenerateUuidOperation extends Operation {
  constructor() {
    super({
      name: 'Generate UUID',
      id: 'generate_uuid',
      module: 'Networking',
      description: 'Generates random RFC 4122 Version 4 UUID strings.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'count', label: 'Quantity to Generate', type: 'number', default: 1 }
      ]
    });
  }

  async run(input, { count = 1 } = {}) {
    const qty = Math.max(1, Math.min(100, Number(count) || 1));
    const uuids = [];
    for (let i = 0; i < qty; i++) {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        uuids.push(crypto.randomUUID());
      } else {
        uuids.push('xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }));
      }
    }
    return uuids.join('\n');
  }
}

export class ParseMacAddressOperation extends Operation {
  constructor() {
    super({
      name: 'Parse MAC address',
      id: 'parse_mac_address',
      module: 'Networking',
      description: 'Parses IEEE 802 MAC addresses and formats into standard colon, hyphen, or Cisco dot notation.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'format', label: 'Format Style', type: 'select', options: ['Colon (00:11:22:33:44:55)', 'Hyphen (00-11-22-33-44-55)', 'Cisco Dot (0011.2233.4455)', 'Continuous Hex'], default: 'Colon (00:11:22:33:44:55)' }
      ]
    });
  }

  async run(input, { format = 'Colon (00:11:22:33:44:55)' } = {}) {
    if (!input || !input.trim()) return '';
    const clean = input.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
    if (clean.length < 12) return `${input} (Invalid MAC: requires 12 hex digits)`;

    const macs = [];
    for (let i = 0; i <= clean.length - 12; i += 12) {
      const slice = clean.substr(i, 12);
      if (format.startsWith('Colon')) {
        macs.push(slice.match(/.{2}/g).join(':'));
      } else if (format.startsWith('Hyphen')) {
        macs.push(slice.match(/.{2}/g).join('-'));
      } else if (format.startsWith('Cisco')) {
        macs.push(slice.match(/.{4}/g).join('.'));
      } else {
        macs.push(slice);
      }
    }

    return macs.join('\n');
  }
}

export const networkingOperations = [
  new ChangeIpFormatOperation(),
  new GenerateUuidOperation(),
  new ParseMacAddressOperation()
];
