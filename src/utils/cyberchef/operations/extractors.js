/**
 * Extractors Operations
 * Extract IP addresses, Domains, URLs, Emails, MAC addresses, Hashes, Base64
 */

import { Operation } from '../core/Operation.js';

export class ExtractIpAddressesOperation extends Operation {
  constructor() {
    super({
      name: 'Extract IP addresses',
      id: 'extract_ip_addresses',
      module: 'Extractors',
      description: 'Extracts IPv4 and IPv6 network addresses from text.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'includeIpv6', label: 'Include IPv6', type: 'select', options: ['Yes', 'No'], default: 'Yes' },
        { name: 'uniqueOnly', label: 'Unique Only', type: 'select', options: ['Yes', 'No'], default: 'Yes' }
      ]
    });
  }

  async run(input, { includeIpv6 = 'Yes', uniqueOnly = 'Yes' } = {}) {
    if (!input) return '';
    const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
    const ipv6Regex = /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?=(?:[0-9a-fA-F]{0,4}:){0,7}[0-9a-fA-F]{0,4})(?:[0-9a-fA-F]{1,4}:){1,7}:|:(?::[0-9a-fA-F]{1,4}){1,7}|(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}/g;

    let matches = input.match(ipv4Regex) || [];
    if (includeIpv6 === 'Yes') {
      const v6Matches = input.match(ipv6Regex) || [];
      matches = matches.concat(v6Matches);
    }

    if (uniqueOnly === 'Yes') {
      matches = Array.from(new Set(matches));
    }
    return matches.join('\n');
  }
}

export class ExtractDomainsOperation extends Operation {
  constructor() {
    super({
      name: 'Extract Domains',
      id: 'extract_domains',
      module: 'Extractors',
      description: 'Extracts domain names and Fully Qualified Domain Names (FQDNs).',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'uniqueOnly', label: 'Unique Only', type: 'select', options: ['Yes', 'No'], default: 'Yes' }
      ]
    });
  }

  async run(input, { uniqueOnly = 'Yes' } = {}) {
    if (!input) return '';
    const domainRegex = /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}\b/g;
    let matches = input.match(domainRegex) || [];
    if (uniqueOnly === 'Yes') {
      matches = Array.from(new Set(matches.map(d => d.toLowerCase())));
    }
    return matches.join('\n');
  }
}

export class ExtractUrlsOperation extends Operation {
  constructor() {
    super({
      name: 'Extract URLs',
      id: 'extract_urls',
      module: 'Extractors',
      description: 'Extracts web URLs (HTTP, HTTPS, FTP, WebSocket) from text.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'uniqueOnly', label: 'Unique Only', type: 'select', options: ['Yes', 'No'], default: 'Yes' }
      ]
    });
  }

  async run(input, { uniqueOnly = 'Yes' } = {}) {
    if (!input) return '';
    const urlRegex = /\b(?:https?|ftp|wss?):\/\/[^\s/$.?#].[^\s]*[^\s.,!?:;"')\]]/gi;
    let matches = input.match(urlRegex) || [];
    if (uniqueOnly === 'Yes') {
      matches = Array.from(new Set(matches));
    }
    return matches.join('\n');
  }
}

export class ExtractEmailsOperation extends Operation {
  constructor() {
    super({
      name: 'Extract Emails',
      id: 'extract_emails',
      module: 'Extractors',
      description: 'Extracts valid RFC 5322 email addresses from text.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'uniqueOnly', label: 'Unique Only', type: 'select', options: ['Yes', 'No'], default: 'Yes' }
      ]
    });
  }

  async run(input, { uniqueOnly = 'Yes' } = {}) {
    if (!input) return '';
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    let matches = input.match(emailRegex) || [];
    if (uniqueOnly === 'Yes') {
      matches = Array.from(new Set(matches.map(e => e.toLowerCase())));
    }
    return matches.join('\n');
  }
}

export class ExtractMacAddressesOperation extends Operation {
  constructor() {
    super({
      name: 'Extract MAC addresses',
      id: 'extract_mac_addresses',
      module: 'Extractors',
      description: 'Extracts IEEE 802 MAC addresses (colon or hyphen separated).',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'uniqueOnly', label: 'Unique Only', type: 'select', options: ['Yes', 'No'], default: 'Yes' }
      ]
    });
  }

  async run(input, { uniqueOnly = 'Yes' } = {}) {
    if (!input) return '';
    const macRegex = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b|\b(?:[0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}\b/g;
    let matches = input.match(macRegex) || [];
    if (uniqueOnly === 'Yes') {
      matches = Array.from(new Set(matches.map(m => m.toUpperCase())));
    }
    return matches.join('\n');
  }
}

export class ExtractHashesOperation extends Operation {
  constructor() {
    super({
      name: 'Extract Hashes',
      id: 'extract_hashes',
      module: 'Extractors',
      description: 'Extracts cryptographic hash candidates (MD5, SHA-1, SHA-256, SHA-512) based on hexadecimal lengths.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'type', label: 'Hash Type', type: 'select', options: ['All', 'MD5 (32)', 'SHA-1 (40)', 'SHA-256 (64)', 'SHA-512 (128)'], default: 'All' }
      ]
    });
  }

  async run(input, { type = 'All' } = {}) {
    if (!input) return '';
    const results = [];

    const md5Regex = /\b[0-9a-fA-F]{32}\b/g;
    const sha1Regex = /\b[0-9a-fA-F]{40}\b/g;
    const sha256Regex = /\b[0-9a-fA-F]{64}\b/g;
    const sha512Regex = /\b[0-9a-fA-F]{128}\b/g;

    const findMatches = (regex, label) => {
      const found = input.match(regex) || [];
      for (const h of found) {
        results.push(type === 'All' ? `[${label}] ${h}` : h);
      }
    };

    if (type === 'All' || type.startsWith('MD5')) findMatches(md5Regex, 'MD5');
    if (type === 'All' || type.startsWith('SHA-1')) findMatches(sha1Regex, 'SHA-1');
    if (type === 'All' || type.startsWith('SHA-256')) findMatches(sha256Regex, 'SHA-256');
    if (type === 'All' || type.startsWith('SHA-512')) findMatches(sha512Regex, 'SHA-512');

    return Array.from(new Set(results)).join('\n');
  }
}

export class ExtractBase64Operation extends Operation {
  constructor() {
    super({
      name: 'Extract Base64',
      id: 'extract_base64',
      module: 'Extractors',
      description: 'Extracts continuous blocks of valid RFC 4648 Base64 characters.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'minLength', label: 'Min String Length', type: 'number', default: 16 }
      ]
    });
  }

  async run(input, { minLength = 16 } = {}) {
    if (!input) return '';
    const min = Math.max(4, Number(minLength) || 16);
    const regex = new RegExp(`[A-Za-z0-9+/]{${min},}(?:={0,2})`, 'g');
    const matches = input.match(regex) || [];
    return Array.from(new Set(matches)).join('\n');
  }
}

export const extractorOperations = [
  new ExtractIpAddressesOperation(),
  new ExtractDomainsOperation(),
  new ExtractUrlsOperation(),
  new ExtractEmailsOperation(),
  new ExtractMacAddressesOperation(),
  new ExtractHashesOperation(),
  new ExtractBase64Operation()
];
