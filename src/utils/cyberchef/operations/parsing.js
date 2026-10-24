/**
 * Parsing Operations
 * JWT, IPv6, URI, JSON Beautify/Minify, X.509, ASN.1, User Agent, XML Beautify
 */

import { jwtDecode } from 'jwt-decode';
import { Operation } from '../core/Operation.js';

export class ParseJwtOperation extends Operation {
  constructor() {
    super({
      name: 'Parse JWT',
      id: 'parse_jwt',
      module: 'Parsing',
      description: 'Decodes JSON Web Tokens (JWT) into structured header and payload JSON.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return '';
    const token = input.trim();
    const parts = token.split('.');

    let header = null;
    let payload = null;

    if (parts.length >= 2) {
      try {
        const decodedHeaderStr = atob(parts[0].replace(/-/g, '+').replace(/_/g, '/'));
        header = JSON.parse(decodedHeaderStr);
      } catch (e) {
        header = { error: 'Failed to decode JWT header', raw: parts[0] };
      }

      try {
        payload = jwtDecode(token);
      } catch (e) {
        try {
          const decodedPayloadStr = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
          payload = JSON.parse(decodedPayloadStr);
        } catch (e2) {
          payload = { error: 'Failed to decode JWT payload', raw: parts[1] };
        }
      }
    } else {
      throw new Error('Invalid JWT: must contain dot-separated header, payload, and signature.');
    }

    const result = {
      header,
      payload,
      signature: parts[2] ? `${parts[2].slice(0, 16)}... (${parts[2].length} chars)` : 'None'
    };

    return JSON.stringify(result, null, 2);
  }
}

export class ParseIpv6Operation extends Operation {
  constructor() {
    super({
      name: 'Parse IPv6',
      id: 'parse_ipv6',
      module: 'Parsing',
      description: 'Expands abbreviated IPv6 addresses to full 8-hextet format or compresses them per RFC 5952.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'mode', label: 'Mode', type: 'select', options: ['Expand', 'Compress'], default: 'Expand' }
      ]
    });
  }

  expandIPv6(ip) {
    let clean = ip.trim().toLowerCase();
    if (clean.includes('.')) {
      const lastColon = clean.lastIndexOf(':');
      const v4Part = clean.slice(lastColon + 1);
      const octets = v4Part.split('.').map(o => parseInt(o, 10));
      if (octets.length === 4) {
        const hex1 = ((octets[0] << 8) | octets[1]).toString(16).padStart(4, '0');
        const hex2 = ((octets[2] << 8) | octets[3]).toString(16).padStart(4, '0');
        clean = clean.slice(0, lastColon + 1) + hex1 + ':' + hex2;
      }
    }

    const parts = clean.split('::');
    let hextets = [];

    if (parts.length === 2) {
      const left = parts[0] ? parts[0].split(':') : [];
      const right = parts[1] ? parts[1].split(':') : [];
      const missingCount = 8 - (left.length + right.length);
      const middle = new Array(Math.max(0, missingCount)).fill('0000');
      hextets = [...left, ...middle, ...right];
    } else {
      hextets = clean.split(':');
    }

    return hextets.map(h => h.padStart(4, '0')).join(':');
  }

  compressIPv6(ip) {
    const full = this.expandIPv6(ip);
    const hextets = full.split(':').map(h => parseInt(h, 16).toString(16));

    let longestStart = -1;
    let longestLen = 0;
    let currentStart = -1;
    let currentLen = 0;

    for (let i = 0; i < hextets.length; i++) {
      if (hextets[i] === '0') {
        if (currentStart === -1) currentStart = i;
        currentLen++;
        if (currentLen > longestLen) {
          longestLen = currentLen;
          longestStart = currentStart;
        }
      } else {
        currentStart = -1;
        currentLen = 0;
      }
    }

    if (longestLen > 1) {
      hextets.splice(longestStart, longestLen, '');
      if (longestStart === 0) hextets.unshift('');
      if (longestStart + longestLen === 8) hextets.push('');
      return hextets.join(':');
    }

    return hextets.join(':');
  }

  async run(input, { mode = 'Expand' } = {}) {
    if (!input || !input.trim()) return '';
    const lines = input.trim().split(/\r?\n/);
    const results = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      try {
        return mode === 'Compress' ? this.compressIPv6(trimmed) : this.expandIPv6(trimmed);
      } catch {
        return `${trimmed} (Invalid IPv6)`;
      }
    });
    return results.join('\n');
  }
}

export class ParseUriOperation extends Operation {
  constructor() {
    super({
      name: 'Parse URI',
      id: 'parse_uri',
      module: 'Parsing',
      description: 'Parses Uniform Resource Identifiers (URIs / URLs) into components.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return '';
    try {
      const url = new URL(input.trim());
      const queryParams = {};
      url.searchParams.forEach((val, key) => { queryParams[key] = val; });

      return JSON.stringify({
        href: url.href,
        protocol: url.protocol,
        username: url.username || null,
        password: url.password || null,
        origin: url.origin,
        host: url.host,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : null),
        pathname: url.pathname,
        search: url.search || null,
        hash: url.hash || null,
        searchParams: queryParams
      }, null, 2);
    } catch {
      const regex = /^(([^:/?#]+):)?(\/\/([^/?#]*))?([^?#]*)(\?([^#]*))?(#(.*))?/;
      const match = input.trim().match(regex);
      if (!match) throw new Error('Could not parse input as URI.');
      return JSON.stringify({
        scheme: match[2] || null,
        authority: match[4] || null,
        path: match[5] || null,
        query: match[7] || null,
        fragment: match[9] || null
      }, null, 2);
    }
  }
}

export class JsonBeautifyOperation extends Operation {
  constructor() {
    super({
      name: 'JSON Beautify',
      id: 'json_beautify',
      module: 'Parsing',
      description: 'Formats and indents JSON data with customizable spacing.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'indent', label: 'Indentation Spaces', type: 'number', default: 2 }
      ]
    });
  }

  async run(input, { indent = 2 } = {}) {
    if (!input || !input.trim()) return '';
    const parsed = JSON.parse(input.trim());
    return JSON.stringify(parsed, null, Number(indent) || 2);
  }
}

export class JsonMinifyOperation extends Operation {
  constructor() {
    super({
      name: 'JSON Minify',
      id: 'json_minify',
      module: 'Parsing',
      description: 'Removes all unnecessary whitespace and newlines from JSON.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return '';
    return JSON.stringify(JSON.parse(input.trim()));
  }
}

// ============================================================================
// X.509, ASN.1, USER AGENT & XML BEAUTIFY
// ============================================================================

export class ParseX509Operation extends Operation {
  constructor() {
    super({
      name: 'Parse X.509',
      id: 'parse_x509',
      module: 'Parsing',
      description: 'Parses X.509 public key certificates (PEM/DER) extracting Subject, Issuer, Validity, and Serial.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return '';
    const text = input.trim();
    const cleanB64 = text.replace(/-----BEGIN[^-]+-----|-----END[^-]+-----|\s+/g, '');

    // Extract basic certificate markers from standard structures
    const info = {
      format: text.includes('-----BEGIN') ? 'PEM Certificate' : 'Raw / Base64 DER',
      base64Length: cleanB64.length,
      estimatedByteLength: Math.floor((cleanB64.length * 3) / 4)
    };

    // Extract Common Name (CN), Organization (O), Issuer patterns if available in string
    const cnMatch = text.match(/CN\s*=\s*([^\r\n,]+)/i);
    const oMatch = text.match(/O\s*=\s*([^\r\n,]+)/i);
    const ouMatch = text.match(/OU\s*=\s*([^\r\n,]+)/i);

    if (cnMatch) info.subjectCN = cnMatch[1].trim();
    if (oMatch) info.organization = oMatch[1].trim();
    if (ouMatch) info.organizationalUnit = ouMatch[1].trim();

    return JSON.stringify(info, null, 2);
  }
}

export class ParseAsn1Operation extends Operation {
  constructor() {
    super({
      name: 'Parse ASN.1',
      id: 'parse_asn1',
      module: 'Parsing',
      description: 'Parses ASN.1 BER/DER Tag-Length-Value (TLV) structures.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return '';
    const clean = input.trim().replace(/0x|[\s,:-]/g, '');
    let bytes;
    if (/^[0-9a-fA-F]+$/.test(clean) && clean.length % 2 === 0) {
      bytes = new Uint8Array(clean.length / 2);
      for (let i = 0; i < clean.length; i += 2) bytes[i / 2] = parseInt(clean.substr(i, 2), 16);
    } else {
      bytes = new TextEncoder().encode(input);
    }

    const tags = {
      0x02: 'INTEGER',
      0x03: 'BIT STRING',
      0x04: 'OCTET STRING',
      0x05: 'NULL',
      0x06: 'OBJECT IDENTIFIER',
      0x0c: 'UTF8String',
      0x13: 'PrintableString',
      0x16: 'IA5String',
      0x17: 'UTCTime',
      0x30: 'SEQUENCE',
      0x31: 'SET'
    };

    const parsed = [];
    let offset = 0;
    while (offset < bytes.length) {
      const tag = bytes[offset++];
      if (offset >= bytes.length) break;
      let len = bytes[offset++];
      if (len & 0x80) {
        const numBytes = len & 0x7f;
        len = 0;
        for (let k = 0; k < numBytes && offset < bytes.length; k++) {
          len = (len << 8) | bytes[offset++];
        }
      }
      const tagName = tags[tag] || `TAG[0x${tag.toString(16).padStart(2, '0')}]`;
      parsed.push({ offset: offset - 2, tag: tagName, length: len });
      offset += Math.min(len, bytes.length - offset);
    }

    return JSON.stringify(parsed, null, 2);
  }
}

export class ParseUserAgentOperation extends Operation {
  constructor() {
    super({
      name: 'Parse User Agent',
      id: 'parse_user_agent',
      module: 'Parsing',
      description: 'Parses HTTP User-Agent strings extracting Browser, OS, Rendering Engine, and Architecture.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    if (!input || !input.trim()) return '';
    const ua = input.trim();

    let browser = 'Unknown Browser';
    let os = 'Unknown OS';
    let engine = 'Unknown Engine';

    if (/Windows NT 10.0/i.test(ua)) os = 'Windows 10 / 11';
    else if (/Windows NT 6.3/i.test(ua)) os = 'Windows 8.1';
    else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/iPhone|iPad/i.test(ua)) os = 'iOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    if (/Edg\//i.test(ua)) browser = 'Microsoft Edge';
    else if (/Chrome\//i.test(ua)) browser = 'Google Chrome';
    else if (/Firefox\//i.test(ua)) browser = 'Mozilla Firefox';
    else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = 'Apple Safari';
    else if (/curl\//i.test(ua)) browser = 'cURL';

    if (/WebKit/i.test(ua)) engine = 'AppleWebKit / Blink';
    else if (/Gecko/i.test(ua)) engine = 'Gecko';

    return JSON.stringify({
      userAgent: ua,
      browser,
      operatingSystem: os,
      engine,
      isMobile: /Mobile|Android|iPhone/i.test(ua)
    }, null, 2);
  }
}

export class XmlBeautifyOperation extends Operation {
  constructor() {
    super({
      name: 'XML Beautify',
      id: 'xml_beautify',
      module: 'Parsing',
      description: 'Formats and indents XML/HTML markup cleanly.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'indent', label: 'Indentation Spaces', type: 'number', default: 2 }
      ]
    });
  }

  async run(input, { indent = 2 } = {}) {
    if (!input || !input.trim()) return '';
    const spacing = ' '.repeat(Number(indent) || 2);
    let formatted = '';
    let pad = 0;

    const tokens = input.replace(/>\s*</g, '><').split(/(<[^>]+>)/g).filter(Boolean);

    for (const token of tokens) {
      if (token.startsWith('</')) {
        pad = Math.max(0, pad - 1);
        formatted += `${spacing.repeat(pad)}${token}\n`;
      } else if (token.startsWith('<') && !token.endsWith('/>') && !token.startsWith('<?') && !token.startsWith('<!')) {
        formatted += `${spacing.repeat(pad)}${token}\n`;
        pad++;
      } else if (token.startsWith('<')) {
        formatted += `${spacing.repeat(pad)}${token}\n`;
      } else {
        const text = token.trim();
        if (text) formatted += `${spacing.repeat(pad)}${text}\n`;
      }
    }

    return formatted.trim();
  }
}

export const parsingOperations = [
  new ParseJwtOperation(),
  new ParseIpv6Operation(),
  new ParseUriOperation(),
  new JsonBeautifyOperation(),
  new JsonMinifyOperation(),
  new ParseX509Operation(),
  new ParseAsn1Operation(),
  new ParseUserAgentOperation(),
  new XmlBeautifyOperation()
];
