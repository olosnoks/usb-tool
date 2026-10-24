/**
 * NetworkParsers.js
 * Hardware & Telemetry Synergy: Deep network payload decoders for CyberChef.
 * Implements Parse DNS Query, Parse TCP Header, Parse UDP Header, and Parse HTTP Request/Response.
 */

import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';

/**
 * Normalizes dish input to a Uint8Array, auto-decoding Hex or Base64 if needed.
 * @param {Dish|any} dish
 * @returns {Uint8Array}
 */
function toBytes(dish) {
  const inputDish = dish instanceof Dish ? dish : new Dish(dish);
  let bytes = inputDish.toUint8Array();

  if (inputDish.type !== 'ArrayBuffer' && bytes.length > 0) {
    const str = inputDish.toString().trim();
    // Auto-detect Hex stream (e.g., from hardware capture or hexdump)
    if (/^[0-9a-fA-F\s]{8,}$/.test(str) && str.replace(/\s+/g, '').length % 2 === 0) {
      try {
        bytes = Dish.fromHex(str).toUint8Array();
      } catch {}
    } else if (/^[A-Za-z0-9+/=]{12,}$/.test(str.replace(/\s+/g, ''))) {
      try {
        bytes = Dish.fromBase64(str).toUint8Array();
      } catch {}
    }
  }
  return bytes;
}

// DNS Query Types
const DNS_TYPES = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  12: 'PTR',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
  33: 'SRV',
  255: 'ANY'
};

const DNS_CLASSES = {
  1: 'IN (Internet)',
  2: 'CS',
  3: 'CH (CHAOS)',
  4: 'HS (Hesiod)'
};

/**
 * Operation: Parse DNS Query
 */
export class ParseDnsQueryOperation extends Operation {
  constructor() {
    super({
      name: 'Parse DNS Query',
      id: 'parse_dns_query',
      module: 'Networking',
      description: 'Extracts Transaction ID, flags, question count, and queried domain name from raw DNS payloads.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'offset', label: 'Byte Offset', type: 'number', default: 0 }
      ]
    });
  }

  async run(dish, { offset = 0 } = {}) {
    const raw = toBytes(dish);
    const start = Math.max(0, Number(offset) || 0);

    if (raw.length < start + 12) {
      return JSON.stringify({
        error: `Insufficient payload length: requires at least 12 bytes at offset ${start} (got ${raw.length} bytes total)`
      }, null, 2);
    }

    const view = new DataView(raw.buffer, raw.byteOffset + start, raw.byteLength - start);

    const transactionId = view.getUint16(0, false);
    const flags = view.getUint16(2, false);
    const qdCount = view.getUint16(4, false);
    const anCount = view.getUint16(6, false);
    const nsCount = view.getUint16(8, false);
    const arCount = view.getUint16(10, false);

    const qr = (flags >> 15) & 0x01;
    const opcode = (flags >> 11) & 0x0f;
    const aa = (flags >> 10) & 0x01;
    const tc = (flags >> 9) & 0x01;
    const rd = (flags >> 8) & 0x01;
    const ra = (flags >> 7) & 0x01;
    const rcode = flags & 0x0f;

    const opcodes = { 0: 'Standard Query (QUERY)', 1: 'Inverse Query (IQUERY)', 2: 'Server Status (STATUS)', 4: 'Notify', 5: 'Update' };
    const rcodes = { 0: 'No Error (NOERROR)', 1: 'Format Error (FORMERR)', 2: 'Server Failure (SERVFAIL)', 3: 'Non-Existent Domain (NXDOMAIN)', 4: 'Not Implemented (NOTIMP)', 5: 'Query Refused (REFUSED)' };

    // Parse DNS Questions
    const questions = [];
    let ptr = 12;

    for (let q = 0; q < qdCount && ptr < view.byteLength; q++) {
      const labels = [];
      while (ptr < view.byteLength) {
        const len = view.getUint8(ptr);
        if (len === 0) {
          ptr++;
          break;
        }
        if ((len & 0xc0) === 0xc0) {
          // Compressed label pointer (skip 2 bytes)
          ptr += 2;
          labels.push('[compressed]');
          break;
        }
        ptr++;
        let label = '';
        for (let i = 0; i < len && ptr < view.byteLength; i++) {
          label += String.fromCharCode(view.getUint8(ptr++));
        }
        labels.push(label);
      }

      const domain = labels.join('.');
      let qTypeNum = 0;
      let qClassNum = 0;

      if (ptr + 4 <= view.byteLength) {
        qTypeNum = view.getUint16(ptr, false);
        qClassNum = view.getUint16(ptr + 2, false);
        ptr += 4;
      }

      questions.push({
        name: domain || '<root>',
        type: DNS_TYPES[qTypeNum] || `TYPE_${qTypeNum}`,
        typeId: qTypeNum,
        class: DNS_CLASSES[qClassNum] || `CLASS_${qClassNum}`,
        classId: qClassNum
      });
    }

    const result = {
      protocol: 'DNS',
      offset: start,
      transactionId: '0x' + transactionId.toString(16).padStart(4, '0').toUpperCase(),
      messageType: qr === 0 ? 'Standard Query' : 'Response',
      flags: {
        raw: '0x' + flags.toString(16).padStart(4, '0').toUpperCase(),
        queryResponse: qr === 0 ? 'Query' : 'Response',
        opcode: opcodes[opcode] || `OPCODE_${opcode}`,
        authoritativeAnswer: aa === 1,
        truncated: tc === 1,
        recursionDesired: rd === 1,
        recursionAvailable: ra === 1,
        responseCode: rcodes[rcode] || `RCODE_${rcode}`
      },
      counts: {
        questions: qdCount,
        answers: anCount,
        authorities: nsCount,
        additionals: arCount
      },
      questions,
      payloadBytesRemaining: view.byteLength - ptr
    };

    return JSON.stringify(result, null, 2);
  }
}

/**
 * Operation: Parse TCP Header
 */
export class ParseTcpHeaderOperation extends Operation {
  constructor() {
    super({
      name: 'Parse TCP Header',
      id: 'parse_tcp_header',
      module: 'Networking',
      description: 'Extracts Source Port, Destination Port, Sequence Number, Acknowledgment Number, Flags (SYN, ACK, RST), and payload offset.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'offset', label: 'Byte Offset', type: 'number', default: 0 }
      ]
    });
  }

  async run(dish, { offset = 0 } = {}) {
    const raw = toBytes(dish);
    const start = Math.max(0, Number(offset) || 0);

    if (raw.length < start + 20) {
      return JSON.stringify({
        error: `Insufficient payload length: TCP header requires at least 20 bytes at offset ${start} (got ${raw.length} bytes total)`
      }, null, 2);
    }

    const view = new DataView(raw.buffer, raw.byteOffset + start, raw.byteLength - start);

    const srcPort = view.getUint16(0, false);
    const dstPort = view.getUint16(2, false);
    const seqNum = view.getUint32(4, false);
    const ackNum = view.getUint32(8, false);

    const byte12 = view.getUint8(12);
    const byte13 = view.getUint8(13);

    const dataOffsetWords = (byte12 >> 4) & 0x0f;
    const headerLengthBytes = dataOffsetWords * 4;

    const ns = byte12 & 0x01;
    const cwr = (byte13 >> 7) & 0x01;
    const ece = (byte13 >> 6) & 0x01;
    const urg = (byte13 >> 5) & 0x01;
    const ack = (byte13 >> 4) & 0x01;
    const psh = (byte13 >> 3) & 0x01;
    const rst = (byte13 >> 2) & 0x01;
    const syn = (byte13 >> 1) & 0x01;
    const fin = byte13 & 0x01;

    const activeFlags = [];
    if (cwr) activeFlags.push('CWR');
    if (ece) activeFlags.push('ECE');
    if (urg) activeFlags.push('URG');
    if (ack) activeFlags.push('ACK');
    if (psh) activeFlags.push('PSH');
    if (rst) activeFlags.push('RST');
    if (syn) activeFlags.push('SYN');
    if (fin) activeFlags.push('FIN');
    if (ns) activeFlags.push('NS');

    const windowSize = view.getUint16(14, false);
    const checksum = view.getUint16(16, false);
    const urgentPointer = view.getUint16(18, false);

    const payloadOffset = start + headerLengthBytes;
    const payloadLength = Math.max(0, raw.length - payloadOffset);

    // Common well-known port mappings
    const KNOWN_PORTS = {
      20: 'FTP Data', 21: 'FTP Control', 22: 'SSH', 23: 'Telnet', 25: 'SMTP',
      53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS',
      445: 'SMB', 1883: 'MQTT', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL',
      8080: 'HTTP Alt', 8443: 'HTTPS Alt'
    };

    const result = {
      protocol: 'TCP',
      offset: start,
      ports: {
        source: srcPort,
        sourceService: KNOWN_PORTS[srcPort] || 'Ephemeral / Unknown',
        destination: dstPort,
        destinationService: KNOWN_PORTS[dstPort] || 'Ephemeral / Unknown'
      },
      sequenceNumber: seqNum,
      acknowledgmentNumber: ackNum,
      headerLength: headerLengthBytes,
      flags: {
        active: activeFlags,
        summary: activeFlags.join(', ') || 'NONE',
        URG: urg === 1,
        ACK: ack === 1,
        PSH: psh === 1,
        RST: rst === 1,
        SYN: syn === 1,
        FIN: fin === 1
      },
      windowSize,
      checksum: '0x' + checksum.toString(16).padStart(4, '0').toUpperCase(),
      urgentPointer,
      payload: {
        offset: payloadOffset,
        length: payloadLength,
        hasData: payloadLength > 0
      }
    };

    return JSON.stringify(result, null, 2);
  }
}

/**
 * Operation: Parse UDP Header
 */
export class ParseUdpHeaderOperation extends Operation {
  constructor() {
    super({
      name: 'Parse UDP Header',
      id: 'parse_udp_header',
      module: 'Networking',
      description: 'Extracts Source Port, Destination Port, Length, and Checksum from raw UDP datagrams.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'offset', label: 'Byte Offset', type: 'number', default: 0 }
      ]
    });
  }

  async run(dish, { offset = 0 } = {}) {
    const raw = toBytes(dish);
    const start = Math.max(0, Number(offset) || 0);

    if (raw.length < start + 8) {
      return JSON.stringify({
        error: `Insufficient payload length: UDP header requires 8 bytes at offset ${start} (got ${raw.length} bytes total)`
      }, null, 2);
    }

    const view = new DataView(raw.buffer, raw.byteOffset + start, raw.byteLength - start);

    const srcPort = view.getUint16(0, false);
    const dstPort = view.getUint16(2, false);
    const length = view.getUint16(4, false);
    const checksum = view.getUint16(6, false);

    const payloadOffset = start + 8;
    const availablePayload = Math.max(0, raw.length - payloadOffset);
    const expectedPayload = Math.max(0, length - 8);

    const KNOWN_PORTS = {
      53: 'DNS', 67: 'DHCP Server', 68: 'DHCP Client', 69: 'TFTP',
      123: 'NTP', 161: 'SNMP', 514: 'Syslog', 1883: 'MQTT-SN',
      5353: 'mDNS', 5683: 'CoAP'
    };

    const result = {
      protocol: 'UDP',
      offset: start,
      ports: {
        source: srcPort,
        sourceService: KNOWN_PORTS[srcPort] || 'Ephemeral / Unknown',
        destination: dstPort,
        destinationService: KNOWN_PORTS[dstPort] || 'Ephemeral / Unknown'
      },
      lengthField: length,
      checksum: '0x' + checksum.toString(16).padStart(4, '0').toUpperCase(),
      payload: {
        offset: payloadOffset,
        expectedLength: expectedPayload,
        availableLength: availablePayload,
        isTruncated: availablePayload < expectedPayload
      }
    };

    return JSON.stringify(result, null, 2);
  }
}

/**
 * Operation: Parse HTTP Request/Response
 */
export class ParseHttpOperation extends Operation {
  constructor() {
    super({
      name: 'Parse HTTP Request/Response',
      id: 'parse_http',
      module: 'Networking',
      description: 'Detects standard HTTP methods (GET, POST, etc.) and extracts Headers, Path, and Body from Layer 7 traffic.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'offset', label: 'Byte Offset', type: 'number', default: 0 }
      ]
    });
  }

  async run(dish, { offset = 0 } = {}) {
    const raw = toBytes(dish);
    const start = Math.max(0, Number(offset) || 0);

    if (raw.length <= start) {
      return JSON.stringify({ error: `Offset ${start} is beyond input data length (${raw.length})` }, null, 2);
    }

    const text = new TextDecoder('utf-8', { fatal: false }).decode(raw.slice(start));
    const headerEndIdx = text.indexOf('\r\n\r\n') !== -1
      ? text.indexOf('\r\n\r\n')
      : text.indexOf('\n\n');

    if (headerEndIdx === -1) {
      return JSON.stringify({
        error: 'No valid HTTP header boundary (CRLF CRLF or LF LF) found in stream.'
      }, null, 2);
    }

    const headerSection = text.substring(0, headerEndIdx);
    const delimiterLen = text.indexOf('\r\n\r\n') !== -1 ? 4 : 2;
    const bodySection = text.substring(headerEndIdx + delimiterLen);

    const lines = headerSection.split(/\r?\n/);
    const startLine = lines[0] || '';

    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const key = line.substring(0, colonIdx).trim().toLowerCase();
        const val = line.substring(colonIdx + 1).trim();
        headers[key] = val;
      }
    }

    // Determine Request vs Response
    // Response: HTTP/1.x 200 OK
    const isResponse = /^HTTP\/[\d.]+\s+(\d+)\s*(.*)/i.test(startLine);
    let result = {};

    if (isResponse) {
      const match = startLine.match(/^HTTP\/([\d.]+)\s+(\d+)\s*(.*)/i);
      result = {
        type: 'HTTP Response',
        httpVersion: match ? match[1] : '1.1',
        statusCode: match ? parseInt(match[2], 10) : 0,
        statusText: match ? match[3].trim() : '',
        headerCount: Object.keys(headers).length,
        headers,
        body: {
          offset: start + headerEndIdx + delimiterLen,
          length: bodySection.length,
          preview: bodySection.length > 500 ? bodySection.substring(0, 500) + '... [truncated]' : bodySection
        }
      };
    } else {
      // Request: GET /index.html HTTP/1.1
      const parts = startLine.split(/\s+/);
      result = {
        type: 'HTTP Request',
        method: parts[0] || 'UNKNOWN',
        path: parts[1] || '/',
        httpVersion: (parts[2] || 'HTTP/1.1').replace(/^HTTP\//i, ''),
        headerCount: Object.keys(headers).length,
        headers,
        body: {
          offset: start + headerEndIdx + delimiterLen,
          length: bodySection.length,
          preview: bodySection.length > 500 ? bodySection.substring(0, 500) + '... [truncated]' : bodySection
        }
      };
    }

    return JSON.stringify(result, null, 2);
  }
}

export const networkParserOperations = [
  new ParseDnsQueryOperation(),
  new ParseTcpHeaderOperation(),
  new ParseUdpHeaderOperation(),
  new ParseHttpOperation()
];
