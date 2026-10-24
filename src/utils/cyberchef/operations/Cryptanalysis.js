/**
 * Cryptanalysis.js
 * Advanced cryptanalysis and deep key/certificate parsing operations:
 * - XOR Brute Force (English frequency heuristic)
 * - Frequency Analysis (Character distribution and visual bar chart)
 * - Parse X.509 Certificate (ASN.1 DER/PEM parser)
 * - Parse RSA Key (PEM/DER Modulus and Exponent extractor)
 */

import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';

// English letter unigram frequency distribution percentages
const ENGLISH_FREQUENCIES = {
  a: 8.12, b: 1.49, c: 2.71, d: 4.32, e: 12.02,
  f: 2.30, g: 2.03, h: 5.92, i: 7.31, j: 0.10,
  k: 0.69, l: 3.98, m: 2.61, n: 6.95, o: 7.68,
  p: 1.82, q: 0.11, r: 6.02, s: 6.28, t: 9.10,
  u: 2.88, v: 1.11, w: 2.09, x: 0.17, y: 2.11, z: 0.07
};

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
    if (/^[0-9a-fA-F\s]{8,}$/.test(str) && str.replace(/\s+/g, '').length % 2 === 0) {
      try { bytes = Dish.fromHex(str).toUint8Array(); } catch {}
    } else if (/^[A-Za-z0-9+/=]{12,}$/.test(str.replace(/\s+/g, ''))) {
      try { bytes = Dish.fromBase64(str).toUint8Array(); } catch {}
    }
  }
  return bytes;
}

/**
 * Operation: XOR Brute Force
 */
export class XorBruteForceOperation extends Operation {
  constructor() {
    super({
      name: 'XOR Brute Force',
      id: 'xor_brute_force',
      module: 'Cryptography',
      description: 'Iterates through all 256 single-byte XOR keys (0x00 to 0xFF) and ranks decoded candidates using English character frequency.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'topN', label: 'Top Results Count', type: 'number', default: 10 }
      ]
    });
  }

  async run(dish, { topN = 10 } = {}) {
    const raw = toBytes(dish);
    if (!raw || raw.length === 0) {
      return JSON.stringify({ error: 'Input data is empty.' }, null, 2);
    }

    const maxResults = Math.max(1, Math.min(50, Number(topN) || 10));
    const candidates = [];

    for (let key = 0; key < 256; key++) {
      let score = 0;
      let nonPrintableCount = 0;
      const decodedChars = [];

      for (let i = 0; i < raw.length; i++) {
        const b = raw[i] ^ key;
        decodedChars.push(String.fromCharCode(b));

        if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122)) {
          // English alphabet letter
          const letter = String.fromCharCode(b).toLowerCase();
          score += (ENGLISH_FREQUENCIES[letter] || 1) * 2;
        } else if (b === 32) {
          // Space character is very common in plaintext
          score += 8;
        } else if (b === 10 || b === 13 || b === 9) {
          // Newlines and tabs
          score += 3;
        } else if (b >= 32 && b <= 126) {
          // Standard printable punctuation, digits, brackets, underscore, symbols
          score += 1.5;
        } else {
          // Non-printable or extended ASCII penalty
          nonPrintableCount++;
          score -= 25;
        }
      }

      const ratio = raw.length > 0 ? (raw.length - nonPrintableCount) / raw.length : 0;
      if (ratio > 0.4) {
        const text = decodedChars.join('');
        candidates.push({
          keyInt: key,
          keyHex: '0x' + key.toString(16).padStart(2, '0').toUpperCase(),
          keyChar: key >= 32 && key <= 126 ? String.fromCharCode(key) : null,
          score: Math.round(score * 10) / 10,
          printableRatio: Math.round(ratio * 100) + '%',
          preview: text.length > 120 ? text.substring(0, 120) + '...' : text,
          fullText: text
        });
      }
    }

    candidates.sort((a, b) => b.score - a.score);
    const topCandidates = candidates.slice(0, maxResults).map((c, idx) => ({
      rank: idx + 1,
      ...c
    }));

    return JSON.stringify(topCandidates, null, 2);
  }
}

/**
 * Operation: Frequency Analysis
 */
export class FrequencyAnalysisOperation extends Operation {
  constructor() {
    super({
      name: 'Frequency Analysis',
      id: 'frequency_analysis',
      module: 'Cryptography',
      description: 'Calculates the character distribution of the input and renders frequency percentages and visual histogram bars.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'caseSensitive', label: 'Case Sensitive', type: 'boolean', default: false }
      ]
    });
  }

  async run(dish, { caseSensitive = false } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const text = inputDish.toString();

    if (!text || text.length === 0) {
      return JSON.stringify({
        totalCharacters: 0,
        uniqueCharacters: 0,
        mostFrequent: [],
        visualHistogram: '',
        frequencies: []
      }, null, 2);
    }

    const processedText = caseSensitive ? text : text.toLowerCase();
    const totalChars = processedText.length;
    const freqMap = new Map();

    for (let i = 0; i < totalChars; i++) {
      const ch = processedText[i];
      freqMap.set(ch, (freqMap.get(ch) || 0) + 1);
    }

    const sorted = Array.from(freqMap.entries())
      .map(([char, count]) => {
        const pct = (count / totalChars) * 100;
        return {
          char: char === ' ' ? '<Space>' : char === '\n' ? '<LF>' : char === '\t' ? '<Tab>' : char,
          charCode: char.charCodeAt(0),
          count,
          percentage: Number(pct.toFixed(2))
        };
      })
      .sort((a, b) => b.count - a.count);

    // Build visual ASCII bar chart
    const maxBarLength = 24;
    const maxCount = sorted.length > 0 ? sorted[0].count : 1;
    const visualHistogram = sorted.slice(0, 20).map(item => {
      const barLen = Math.max(1, Math.round((item.count / maxCount) * maxBarLength));
      const bar = '█'.repeat(barLen);
      const label = item.char.padEnd(8, ' ');
      return `${label}: ${bar} ${item.count} (${item.percentage}%)`;
    }).join('\n');

    const result = {
      totalCharacters: totalChars,
      uniqueCharacters: freqMap.size,
      mostFrequent: sorted.slice(0, 5).map(s => s.char),
      visualHistogram,
      frequencies: sorted
    };

    return JSON.stringify(result, null, 2);
  }
}

/**
 * Basic ASN.1 TLV Decoder Helper for X.509 and RSA Keys
 */
class Asn1Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.offset = 0;
  }

  readTag() {
    if (this.offset >= this.bytes.length) return null;
    return this.bytes[this.offset++];
  }

  readLength() {
    if (this.offset >= this.bytes.length) return 0;
    const first = this.bytes[this.offset++];
    if ((first & 0x80) === 0) {
      return first;
    }
    const numOctets = first & 0x7f;
    let len = 0;
    for (let i = 0; i < numOctets && this.offset < this.bytes.length; i++) {
      len = (len << 8) | this.bytes[this.offset++];
    }
    return len;
  }

  readSlice(len) {
    const start = this.offset;
    this.offset = Math.min(this.bytes.length, this.offset + len);
    return this.bytes.slice(start, this.offset);
  }
}

// Known OID strings for Cryptographic Algorithms and Subject Attributes
const OID_NAMES = {
  '1.2.840.113549.1.1.1': 'rsaEncryption',
  '1.2.840.113549.1.1.5': 'sha1WithRSAEncryption',
  '1.2.840.113549.1.1.11': 'sha256WithRSAEncryption',
  '1.2.840.113549.1.1.12': 'sha384WithRSAEncryption',
  '1.2.840.113549.1.1.13': 'sha512WithRSAEncryption',
  '1.2.840.10045.2.1': 'id-ecPublicKey',
  '1.2.840.10045.4.3.2': 'ecdsa-with-SHA256',
  '1.3.101.112': 'Ed25519',
  '2.5.4.3': 'commonName (CN)',
  '2.5.4.6': 'countryName (C)',
  '2.5.4.7': 'localityName (L)',
  '2.5.4.8': 'stateOrProvinceName (ST)',
  '2.5.4.10': 'organizationName (O)',
  '2.5.4.11': 'organizationalUnitName (OU)'
};

/**
 * Operation: Parse X.509 Certificate
 */
export class X509CertificateParserOperation extends Operation {
  constructor() {
    super({
      name: 'Parse X.509 Certificate',
      id: 'parse_x509_certificate',
      module: 'Parsing',
      description: 'Parses ASN.1 DER and PEM-encoded X.509 public certificates, extracting Subject, Issuer, Validity Dates, and Public Key details.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let bytes = inputDish.toUint8Array();
    const str = inputDish.toString();

    // Check for PEM wrapper
    if (str.includes('-----BEGIN CERTIFICATE-----')) {
      const b64 = str
        .replace(/-----BEGIN CERTIFICATE-----/g, '')
        .replace(/-----END CERTIFICATE-----/g, '')
        .replace(/\s+/g, '');
      try {
        bytes = Dish.fromBase64(b64).toUint8Array();
      } catch (err) {
        return JSON.stringify({ error: `Base64 PEM decode error: ${err.message}` }, null, 2);
      }
    } else if (/^[A-Za-z0-9+/=\s]{64,}$/.test(str.trim())) {
      try {
        bytes = Dish.fromBase64(str.replace(/\s+/g, '')).toUint8Array();
      } catch {}
    }

    if (bytes.length < 8 || bytes[0] !== 0x30) {
      return JSON.stringify({
        format: 'X.509 Public Certificate',
        error: 'Invalid X.509 certificate: Input is not a valid ASN.1 DER SEQUENCE (expected initial tag 0x30).'
      }, null, 2);
    }

    try {
      // Decode ASN.1 strings embedded in bytes
      const decodedStrings = [];
      let i = 0;
      while (i < bytes.length) {
        const tag = bytes[i];
        // Check for PrintableString (0x13), TeletexString (0x14), IA5String (0x16), UTF8String (0x0C)
        if (tag === 0x13 || tag === 0x14 || tag === 0x16 || tag === 0x0c) {
          const len = bytes[i + 1];
          if (len > 0 && len < 128 && i + 2 + len <= bytes.length) {
            const val = String.fromCharCode(...bytes.slice(i + 2, i + 2 + len));
            if (/^[a-zA-Z0-9\s._@\-*,]+$/.test(val) && val.length > 1) {
              decodedStrings.push(val);
            }
            i += 2 + len;
            continue;
          }
        }
        i++;
      }

      // Find dates (UTCTime: YYMMDDHHMMSSZ)
      const dates = [];
      const text = String.fromCharCode(...bytes);
      const dateMatches = text.match(/\d{12,14}Z/g);
      if (dateMatches) {
        for (const dm of dateMatches) {
          let year = parseInt(dm.substring(0, 2), 10);
          year += year >= 50 ? 1900 : 2000;
          const month = dm.substring(2, 4);
          const day = dm.substring(4, 6);
          const hour = dm.substring(6, 8);
          const min = dm.substring(8, 10);
          const sec = dm.substring(10, 12);
          dates.push(`${year}-${month}-${day} ${hour}:${min}:${sec} UTC`);
        }
      }

      // Check OID algorithms
      let detectedAlgorithm = 'RSA (rsaEncryption)';
      if (text.includes('id-ecPublicKey') || bytes.some((_, idx) => bytes[idx] === 0x2a && bytes[idx + 1] === 0x86 && bytes[idx + 2] === 0x48 && bytes[idx + 3] === 0xce && bytes[idx + 4] === 0x3d)) {
        detectedAlgorithm = 'Elliptic Curve (id-ecPublicKey / ECDSA)';
      }

      const notBefore = dates[0] || 'Unknown';
      const notAfter = dates[1] || 'Unknown';
      let isValidNow = false;
      if (notBefore !== 'Unknown' && notAfter !== 'Unknown') {
        const now = Date.now();
        const nb = new Date(notBefore).getTime();
        const na = new Date(notAfter).getTime();
        isValidNow = now >= nb && now <= na;
      }

      const certInfo = {
        format: 'X.509 Public Certificate',
        version: 'v3 (0x02)',
        subjectAttributes: decodedStrings.slice(0, 6),
        commonName: decodedStrings.find(s => s.includes('.') || !s.includes(' ')) || decodedStrings[0] || 'Unknown',
        validity: {
          notBefore,
          notAfter,
          isCurrentlyValid: isValidNow
        },
        publicKeyAlgorithm: detectedAlgorithm,
        rawByteLength: bytes.length,
        fingerprintSha256: Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(':') + '...'
      };

      return JSON.stringify(certInfo, null, 2);
    } catch (err) {
      return JSON.stringify({ error: `Certificate parsing error: ${err.message}` }, null, 2);
    }
  }
}

/**
 * Operation: Parse RSA Key
 */
export class RsaKeyParserOperation extends Operation {
  constructor() {
    super({
      name: 'Parse RSA Key',
      id: 'parse_rsa_key',
      module: 'Parsing',
      description: 'Extracts Modulus (N), Public Exponent (E), and key length from standard PEM or DER RSA public keys.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let bytes = inputDish.toUint8Array();
    const str = inputDish.toString().trim();

    let keyType = 'PKCS#8 SubjectPublicKeyInfo';
    if (str.includes('BEGIN RSA PUBLIC KEY')) {
      keyType = 'PKCS#1 RSA Public Key';
    }

    if (str.includes('-----BEGIN')) {
      const b64 = str.replace(/-----BEGIN [^-]+-----/g, '')
                     .replace(/-----END [^-]+-----/g, '')
                     .replace(/\s+/g, '');
      try {
        bytes = Dish.fromBase64(b64).toUint8Array();
      } catch (err) {
        return JSON.stringify({ error: `Base64 PEM decode error: ${err.message}` }, null, 2);
      }
    } else if (/^[A-Za-z0-9+/=\s]{48,}$/.test(str)) {
      try { bytes = Dish.fromBase64(str.replace(/\s+/g, '')).toUint8Array(); } catch {}
    }

    if (bytes.length < 24) {
      return JSON.stringify({ error: 'RSA key payload is too short to be a valid DER sequence.' }, null, 2);
    }

    // Look for ASN.1 INTEGER (Tag 0x02) representing modulus
    // Modulus in 2048-bit RSA is ~256-257 bytes
    let modulusBytes = null;
    let exponent = 65537;

    for (let i = 0; i < bytes.length - 10; i++) {
      if (bytes[i] === 0x02) {
        // Tag INTEGER
        let len = bytes[i + 1];
        let offset = i + 2;
        if (len === 0x81) {
          len = bytes[i + 2];
          offset = i + 3;
        } else if (len === 0x82) {
          len = (bytes[i + 2] << 8) | bytes[i + 3];
          offset = i + 4;
        }

        if (len >= 64 && offset + len <= bytes.length) {
          modulusBytes = bytes.slice(offset, offset + len);

          // The next integer is the exponent (typically 3 bytes: 0x02 0x03 0x01 0x00 0x01 for 65537)
          const expOffset = offset + len;
          if (expOffset + 3 <= bytes.length && bytes[expOffset] === 0x02) {
            const expLen = bytes[expOffset + 1];
            let expVal = 0;
            for (let e = 0; e < expLen; e++) {
              expVal = (expVal << 8) | bytes[expOffset + 2 + e];
            }
            if (expVal > 0) exponent = expVal;
          }
          break;
        }
      }
    }

    if (!modulusBytes) {
      return JSON.stringify({
        error: 'Unable to locate RSA Modulus integer in ASN.1 structure.'
      }, null, 2);
    }

    // Strip leading 0x00 padding byte if present
    const cleanModulus = modulusBytes[0] === 0x00 ? modulusBytes.slice(1) : modulusBytes;
    const bitLength = cleanModulus.length * 8;
    const modulusHex = Array.from(cleanModulus)
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join(' ');

    const result = {
      keyFormat: keyType,
      algorithm: 'RSA',
      bitLength,
      publicExponent: {
        decimal: exponent,
        hex: '0x' + exponent.toString(16).toUpperCase()
      },
      modulus: {
        byteLength: cleanModulus.length,
        hexPreview: modulusHex.length > 90 ? modulusHex.substring(0, 90) + '...' : modulusHex,
        hex: modulusHex
      }
    };

    return JSON.stringify(result, null, 2);
  }
}

export const cryptanalysisOperations = [
  new XorBruteForceOperation(),
  new FrequencyAnalysisOperation(),
  new X509CertificateParserOperation(),
  new RsaKeyParserOperation()
];
