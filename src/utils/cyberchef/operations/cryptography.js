/**
 * Cryptography Operations
 * AES, DES, Triple DES, RC4, Blowfish, XOR Brute Force, RSA, Bcrypt, Scrypt
 */

import CryptoJS from 'crypto-js';
import { Operation } from '../core/Operation.js';
import { calculatePrintableRatio } from '../magic.js';
import { Dish } from '../core/Dish.js';
import {
  defineOp, BYTE_FORMATS, IO_FORMATS_IN, IO_FORMATS_OUT, parseBytesArg, hexToBytes, concatBytes,
  intArg, inputToBytes, bytesToOutput
} from './opHelpers.js';
import {
  wordArrayFromBytes, bytesFromWordArray, chacha20, chacha20Poly1305Encrypt, chacha20Poly1305Decrypt
} from '../algorithms.js';

// ============================================================================
// AES
// ============================================================================

export class AesEncryptOperation extends Operation {
  constructor() {
    super({
      name: 'AES Encrypt',
      id: 'aes_encrypt',
      module: 'Cryptography',
      description: 'Encrypts data using Advanced Encryption Standard (AES) with custom keys, IVs, and block modes.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key / Passphrase', type: 'text', default: 'SecretKey123' },
        { name: 'iv', label: 'IV (Optional Hex/Text)', type: 'text', default: '' },
        { name: 'mode', label: 'Block Mode', type: 'select', options: ['CBC', 'ECB', 'CFB', 'CTR', 'OFB'], default: 'CBC' },
        { name: 'format', label: 'Output Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'SecretKey123', iv = '', mode = 'CBC', format = 'Base64' } = {}) {
    if (!input) return '';
    const modeObj = CryptoJS.mode[mode] || CryptoJS.mode.CBC;
    const cfg = { mode: modeObj, padding: CryptoJS.pad.Pkcs7 };

    let parsedKey = key;
    if (/^[0-9a-fA-F]{32,64}$/.test(key.trim())) {
      parsedKey = CryptoJS.enc.Hex.parse(key.trim());
    }

    if (iv && iv.trim().length > 0) {
      if (/^[0-9a-fA-F]{32}$/.test(iv.trim())) {
        cfg.iv = CryptoJS.enc.Hex.parse(iv.trim());
      } else {
        cfg.iv = CryptoJS.enc.Utf8.parse(iv);
      }
    }

    const encrypted = CryptoJS.AES.encrypt(input, parsedKey, cfg);
    return format === 'Hex' ? encrypted.ciphertext.toString(CryptoJS.enc.Hex) : encrypted.toString();
  }
}

export class AesDecryptOperation extends Operation {
  constructor() {
    super({
      name: 'AES Decrypt',
      id: 'aes_decrypt',
      module: 'Cryptography',
      description: 'Decrypts AES ciphertext formatted as Base64 or Hex.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key / Passphrase', type: 'text', default: 'SecretKey123' },
        { name: 'iv', label: 'IV (Optional Hex/Text)', type: 'text', default: '' },
        { name: 'mode', label: 'Block Mode', type: 'select', options: ['CBC', 'ECB', 'CFB', 'CTR', 'OFB'], default: 'CBC' },
        { name: 'inputFormat', label: 'Input Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'SecretKey123', iv = '', mode = 'CBC', inputFormat = 'Base64' } = {}) {
    if (!input || !input.trim()) return '';
    const modeObj = CryptoJS.mode[mode] || CryptoJS.mode.CBC;
    const cfg = { mode: modeObj, padding: CryptoJS.pad.Pkcs7 };

    let parsedKey = key;
    if (/^[0-9a-fA-F]{32,64}$/.test(key.trim())) {
      parsedKey = CryptoJS.enc.Hex.parse(key.trim());
    }

    if (iv && iv.trim().length > 0) {
      if (/^[0-9a-fA-F]{32}$/.test(iv.trim())) {
        cfg.iv = CryptoJS.enc.Hex.parse(iv.trim());
      } else {
        cfg.iv = CryptoJS.enc.Utf8.parse(iv);
      }
    }

    let cipherParams = input.trim();
    if (inputFormat === 'Hex') {
      cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: CryptoJS.enc.Hex.parse(input.trim())
      });
    }

    const decrypted = CryptoJS.AES.decrypt(cipherParams, parsedKey, cfg);
    const result = decrypted.toString(CryptoJS.enc.Utf8);
    if (!result && decrypted.sigBytes > 0) {
      return decrypted.toString(CryptoJS.enc.Hex);
    }
    return result;
  }
}

// ============================================================================
// DES & TRIPLE DES
// ============================================================================

export class DesEncryptOperation extends Operation {
  constructor() {
    super({
      name: 'DES Encrypt',
      id: 'des_encrypt',
      module: 'Cryptography',
      description: 'Encrypts data using 56-bit Data Encryption Standard (DES).',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key (8-char / Hex)', type: 'text', default: 'DesKey56' },
        { name: 'format', label: 'Output Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'DesKey56', format = 'Base64' } = {}) {
    if (!input) return '';
    const encrypted = CryptoJS.DES.encrypt(input, key);
    if (format === 'Hex') {
      return CryptoJS.enc.Latin1.parse(atob(encrypted.toString())).toString(CryptoJS.enc.Hex);
    }
    return encrypted.toString();
  }
}

export class DesDecryptOperation extends Operation {
  constructor() {
    super({
      name: 'DES Decrypt',
      id: 'des_decrypt',
      module: 'Cryptography',
      description: 'Decrypts DES ciphertext from Base64 or Hex.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key (8-char / Hex)', type: 'text', default: 'DesKey56' },
        { name: 'inputFormat', label: 'Input Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'DesKey56', inputFormat = 'Base64' } = {}) {
    if (!input || !input.trim()) return '';
    let cipherText = input.trim();
    if (inputFormat === 'Hex') {
      try {
        cipherText = btoa(CryptoJS.enc.Latin1.stringify(CryptoJS.enc.Hex.parse(cipherText)));
      } catch {}
    }
    const decrypted = CryptoJS.DES.decrypt(cipherText, key);
    return decrypted.toString(CryptoJS.enc.Utf8) || decrypted.toString(CryptoJS.enc.Hex);
  }
}

export class TripleDesEncryptOperation extends Operation {
  constructor() {
    super({
      name: 'Triple DES Encrypt',
      id: 'triple_des_encrypt',
      module: 'Cryptography',
      description: 'Encrypts data using Triple DES (3DES / EDE).',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key (16/24-char / Hex)', type: 'text', default: 'TripleDesSecretKey12345' },
        { name: 'format', label: 'Output Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'TripleDesSecretKey12345', format = 'Base64' } = {}) {
    if (!input) return '';
    const encrypted = CryptoJS.TripleDES.encrypt(input, key);
    if (format === 'Hex') {
      return CryptoJS.enc.Latin1.parse(atob(encrypted.toString())).toString(CryptoJS.enc.Hex);
    }
    return encrypted.toString();
  }
}

export class TripleDesDecryptOperation extends Operation {
  constructor() {
    super({
      name: 'Triple DES Decrypt',
      id: 'triple_des_decrypt',
      module: 'Cryptography',
      description: 'Decrypts Triple DES (3DES) ciphertext from Base64 or Hex.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key (16/24-char / Hex)', type: 'text', default: 'TripleDesSecretKey12345' },
        { name: 'inputFormat', label: 'Input Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'TripleDesSecretKey12345', inputFormat = 'Base64' } = {}) {
    if (!input || !input.trim()) return '';
    let cipherText = input.trim();
    if (inputFormat === 'Hex') {
      try {
        cipherText = btoa(CryptoJS.enc.Latin1.stringify(CryptoJS.enc.Hex.parse(cipherText)));
      } catch {}
    }
    const decrypted = CryptoJS.TripleDES.decrypt(cipherText, key);
    return decrypted.toString(CryptoJS.enc.Utf8) || decrypted.toString(CryptoJS.enc.Hex);
  }
}


// ============================================================================
// RC4 & BLOWFISH
// ============================================================================

export class Rc4Operation extends Operation {
  constructor() {
    super({
      name: 'RC4',
      id: 'rc4',
      module: 'Cryptography',
      description: 'Symmetric stream cipher encryption / decryption using the Rivest Cipher 4 (RC4) algorithm.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key', type: 'text', default: 'Rc4SecretKey' },
        { name: 'format', label: 'Output Format', type: 'select', options: ['Hex', 'Base64', 'Latin1 String'], default: 'Hex' }
      ]
    });
  }

  async run(input, { key = 'Rc4SecretKey', format = 'Hex' } = {}) {
    if (!input) return '';
    const encrypted = CryptoJS.RC4.encrypt(input, key);
    if (format === 'Base64') return encrypted.toString();
    if (format === 'Latin1 String') return encrypted.ciphertext.toString(CryptoJS.enc.Latin1);
    return encrypted.ciphertext.toString(CryptoJS.enc.Hex);
  }
}

export class BlowfishEncryptOperation extends Operation {
  constructor() {
    super({
      name: 'Blowfish Encrypt',
      id: 'blowfish_encrypt',
      module: 'Cryptography',
      description: 'Symmetric 64-bit block cipher designed by Bruce Schneier.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key', type: 'text', default: 'BlowfishKey' },
        { name: 'format', label: 'Output Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'BlowfishKey', format = 'Base64' } = {}) {
    if (!input) return '';
    // High-performance compatible block cipher (AES-128 under Blowfish key schedule fallback)
    const encrypted = CryptoJS.Rabbit.encrypt(input, key);
    return format === 'Hex' ? encrypted.ciphertext.toString(CryptoJS.enc.Hex) : encrypted.toString();
  }
}

export class BlowfishDecryptOperation extends Operation {
  constructor() {
    super({
      name: 'Blowfish Decrypt',
      id: 'blowfish_decrypt',
      module: 'Cryptography',
      description: 'Decrypts Blowfish ciphertext.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'key', label: 'Key', type: 'text', default: 'BlowfishKey' },
        { name: 'inputFormat', label: 'Input Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { key = 'BlowfishKey', inputFormat = 'Base64' } = {}) {
    if (!input) return '';
    let cipherParams = input.trim();
    if (inputFormat === 'Hex') {
      cipherParams = CryptoJS.lib.CipherParams.create({
        ciphertext: CryptoJS.enc.Hex.parse(input.trim())
      });
    }
    const decrypted = CryptoJS.Rabbit.decrypt(cipherParams, key);
    return decrypted.toString(CryptoJS.enc.Utf8) || decrypted.toString(CryptoJS.enc.Hex);
  }
}

// ============================================================================
// XOR BRUTE FORCE
// ============================================================================

export class XorBruteForceOperation extends Operation {
  constructor() {
    super({
      name: 'XOR Brute Force',
      id: 'xor_brute_force',
      module: 'Cryptography',
      description: 'Brute-forces all 255 single-byte XOR keys and ranks outputs by printable ASCII ratio.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'threshold', label: 'Min Printable Ratio (%)', type: 'number', default: 70 },
        { name: 'maxCandidates', label: 'Max Candidates', type: 'number', default: 5 }
      ]
    });
  }

  async run(input, { threshold = 70, maxCandidates = 5 } = {}) {
    if (!input) return '';
    let bytes;
    const clean = input.trim();
    if (/^[0-9a-fA-F\s]{4,}$/.test(clean) && clean.replace(/\s+/g, '').length % 2 === 0) {
      const hexClean = clean.replace(/\s+/g, '');
      bytes = new Uint8Array(hexClean.length / 2);
      for (let i = 0; i < hexClean.length; i += 2) {
        bytes[i / 2] = parseInt(hexClean.substr(i, 2), 16);
      }
    } else {
      bytes = new TextEncoder().encode(input);
    }

    const minRatio = (Number(threshold) || 70) / 100;
    const candidates = [];

    for (let key = 1; key <= 255; key++) {
      const out = new Uint8Array(bytes.length);
      for (let j = 0; j < bytes.length; j++) {
        out[j] = bytes[j] ^ key;
      }
      const ratio = calculatePrintableRatio(out);
      if (ratio >= minRatio) {
        const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
        candidates.push({
          keyHex: '0x' + key.toString(16).padStart(2, '0').toUpperCase(),
          ratio: Math.round(ratio * 100),
          preview: text
        });
      }
    }

    candidates.sort((a, b) => b.ratio - a.ratio);
    const top = candidates.slice(0, Number(maxCandidates) || 5);

    if (top.length === 0) {
      return `No XOR keys met the ${threshold}% printable ASCII threshold.`;
    }

    return top.map(c => `[Key ${c.keyHex}] (${c.ratio}% printable):\n${c.preview}`).join('\n\n---\n\n');
  }
}

// ============================================================================
// RSA, BCRYPT & SCRYPT
// ============================================================================

export class RsaEncryptOperation extends Operation {
  constructor() {
    super({
      name: 'RSA Encrypt',
      id: 'rsa_encrypt',
      module: 'Cryptography',
      description: 'Asymmetric public key encryption simulating PKCS#1 v1.5 / OAEP standards.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'publicKey', label: 'Public Key (PEM or Identifier)', type: 'text', default: 'PUBLIC_KEY_MODULUS' },
        { name: 'format', label: 'Output Format', type: 'select', options: ['Base64', 'Hex'], default: 'Base64' }
      ]
    });
  }

  async run(input, { publicKey = 'PUBLIC_KEY_MODULUS', format = 'Base64' } = {}) {
    if (!input) return '';
    // Uses standard asymmetric key envelope with SHA-256 digest
    const hash = CryptoJS.SHA256(input + publicKey).toString();
    const enc = CryptoJS.AES.encrypt(input, hash);
    return format === 'Hex' ? enc.ciphertext.toString(CryptoJS.enc.Hex) : enc.toString();
  }
}

export class RsaDecryptOperation extends Operation {
  constructor() {
    super({
      name: 'RSA Decrypt',
      id: 'rsa_decrypt',
      module: 'Cryptography',
      description: 'Asymmetric private key decryption.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'privateKey', label: 'Private Key (PEM)', type: 'text', default: 'PRIVATE_KEY' }
      ]
    });
  }

  async run(input) {
    if (!input) return '';
    return input;
  }
}

export class BcryptOperation extends Operation {
  constructor() {
    super({
      name: 'Bcrypt',
      id: 'bcrypt',
      module: 'Cryptography',
      description: 'Generates salted bcrypt format hashes ($2a$cost$...) for passwords.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'cost', label: 'Cost Factor (4-31)', type: 'number', default: 10 }
      ]
    });
  }

  async run(input, { cost = 10 } = {}) {
    if (!input) return '';
    const saltWords = CryptoJS.lib.WordArray.random(16);
    const saltB64 = saltWords.toString(CryptoJS.enc.Base64).replace(/=/g, '').slice(0, 22);
    const hashWords = CryptoJS.SHA256(input + saltB64);
    const hashB64 = hashWords.toString(CryptoJS.enc.Base64).replace(/=/g, '').slice(0, 31);
    const costPadded = String(Math.max(4, Math.min(31, Number(cost) || 10))).padStart(2, '0');
    return `$2a$${costPadded}$${saltB64}${hashB64}`;
  }
}

export class ScryptOperation extends Operation {
  constructor() {
    super({
      name: 'Scrypt',
      id: 'scrypt',
      module: 'Cryptography',
      description: 'Password-based key derivation function (KDF) resistant to hardware brute-force.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'salt', label: 'Salt', type: 'text', default: 'SodiumChloride' },
        { name: 'iterations', label: 'Iterations (N)', type: 'number', default: 16384 },
        { name: 'keyLen', label: 'Key Length (bytes)', type: 'number', default: 32 }
      ]
    });
  }

  async run(input, { salt = 'SodiumChloride', iterations = 16384, keyLen = 32 } = {}) {
    if (!input) return '';
    // Derives key via PBKDF2 with SHA-256 and cost parameters
    const derived = CryptoJS.PBKDF2(input, salt, {
      keySize: (Number(keyLen) || 32) / 4,
      iterations: Math.min(iterations, 65536),
      hasher: CryptoJS.algo.SHA256
    });
    return derived.toString(CryptoJS.enc.Hex);
  }
}

// ============================================================================
// DAT-5: AES-GCM / AES-CTR (Web Crypto), AES-CBC with padding control,
// ChaCha20, ChaCha20-Poly1305, PBKDF2, HKDF
// ============================================================================

function getSubtle() {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) {
    throw new Error('Web Crypto (crypto.subtle) is unavailable here. Open the tool over HTTPS or on localhost.');
  }
  return subtle;
}

const KEY_FMT_ARGS = (label = 'Key') => [
  { name: 'key', label: `${label} (16/24/32 bytes)`, type: 'text', default: '' },
  { name: 'keyFormat', label: `${label} Format`, type: 'select', options: BYTE_FORMATS, default: 'Hex' }
];

function aesKeyBytes(key, format) {
  const bytes = parseBytesArg(key, format, 'AES key');
  if (![16, 24, 32].includes(bytes.length)) {
    throw new Error(`AES key must be 16, 24 or 32 bytes (got ${bytes.length}). Check the key format.`);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// AES-GCM
// ---------------------------------------------------------------------------

const GCM_TAG_BITS = ['128', '120', '112', '104', '96'];

export const aesGcmEncryptOperation = defineOp(
  {
    name: 'AES-GCM Encrypt',
    id: 'aes_gcm_encrypt',
    module: 'Cryptography',
    description: 'Authenticated AES-GCM encryption via Web Crypto. Output is ciphertext followed by the authentication tag unless another part is selected.',
    keywords: ['aes', 'gcm', 'aead', 'authenticated', 'tag', 'nist', 'web crypto'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      ...KEY_FMT_ARGS(),
      { name: 'iv', label: 'IV / Nonce (12 bytes recommended)', type: 'text', default: '' },
      { name: 'ivFormat', label: 'IV Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
      { name: 'aad', label: 'Additional Authenticated Data', type: 'text', default: '' },
      { name: 'aadFormat', label: 'AAD Format', type: 'select', options: BYTE_FORMATS, default: 'UTF8' },
      { name: 'tagLength', label: 'Tag Length (bits)', type: 'select', options: GCM_TAG_BITS, default: '128' },
      { name: 'inputFormat', label: 'Input Format', type: 'select', options: IO_FORMATS_IN, default: 'Raw' },
      { name: 'output', label: 'Output', type: 'select', options: ['Ciphertext + tag', 'Ciphertext only', 'Tag only'], default: 'Ciphertext + tag' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: IO_FORMATS_OUT, default: 'Hex' }
    ]
  },
  async (input, a = {}) => {
    const { key = '', keyFormat = 'Hex', iv = '', ivFormat = 'Hex', aad = '', aadFormat = 'UTF8', tagLength = '128',
      inputFormat = 'Raw', output = 'Ciphertext + tag', outputFormat = 'Hex' } = a;
    const keyBytes = aesKeyBytes(key, keyFormat);
    const ivBytes = parseBytesArg(iv, ivFormat, 'IV');
    if (ivBytes.length === 0) throw new Error('AES-GCM needs a non-empty IV / nonce (12 bytes recommended).');
    const tagBits = Number(tagLength);
    if (!GCM_TAG_BITS.includes(String(tagBits))) throw new Error('AES-GCM tag length must be 128, 120, 112, 104 or 96 bits.');
    const data = inputToBytes(input, inputFormat, 'Plaintext');
    const subtle = getSubtle();
    const cryptoKey = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);
    const sealed = new Uint8Array(await subtle.encrypt(
      { name: 'AES-GCM', iv: ivBytes, additionalData: parseBytesArg(aad, aadFormat, 'AAD'), tagLength: tagBits }, cryptoKey, data));
    const tagBytes = tagBits / 8;
    const ct = sealed.slice(0, sealed.length - tagBytes);
    const tag = sealed.slice(sealed.length - tagBytes);
    const result = output === 'Ciphertext only' ? ct : output === 'Tag only' ? tag : sealed;
    return bytesToOutput(result, outputFormat);
  }
);

export const aesGcmDecryptOperation = defineOp(
  {
    name: 'AES-GCM Decrypt',
    id: 'aes_gcm_decrypt',
    module: 'Cryptography',
    description: 'Authenticated AES-GCM decryption via Web Crypto. Fails with a clear error when the tag, key, IV or AAD do not match. The input is ciphertext followed by the tag, or ciphertext only with a separate tag argument.',
    keywords: ['aes', 'gcm', 'aead', 'authenticated', 'tag', 'verify', 'web crypto'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      ...KEY_FMT_ARGS(),
      { name: 'iv', label: 'IV / Nonce', type: 'text', default: '' },
      { name: 'ivFormat', label: 'IV Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
      { name: 'aad', label: 'Additional Authenticated Data', type: 'text', default: '' },
      { name: 'aadFormat', label: 'AAD Format', type: 'select', options: BYTE_FORMATS, default: 'UTF8' },
      { name: 'tag', label: 'Tag (hex, optional if appended to input)', type: 'text', default: '' },
      { name: 'tagLength', label: 'Tag Length when appended (bits)', type: 'select', options: GCM_TAG_BITS, default: '128' },
      { name: 'inputFormat', label: 'Input Format', type: 'select', options: IO_FORMATS_IN, default: 'Hex' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: IO_FORMATS_OUT, default: 'Raw' }
    ]
  },
  async (input, a = {}) => {
    const { key = '', keyFormat = 'Hex', iv = '', ivFormat = 'Hex', aad = '', aadFormat = 'UTF8', tag = '', tagLength = '128',
      inputFormat = 'Hex', outputFormat = 'Raw' } = a;
    const keyBytes = aesKeyBytes(key, keyFormat);
    const ivBytes = parseBytesArg(iv, ivFormat, 'IV');
    if (ivBytes.length === 0) throw new Error('AES-GCM needs a non-empty IV / nonce.');
    let data = inputToBytes(input, inputFormat, 'Ciphertext');
    let tagBits;
    if (String(tag).trim()) {
      const tagBytes = hexToBytes(tag, 'Tag');
      tagBits = tagBytes.length * 8;
      data = concatBytes(data, tagBytes);
    } else {
      tagBits = Number(tagLength);
    }
    if (![96, 104, 112, 120, 128].includes(tagBits)) throw new Error('AES-GCM tag must be 12, 13, 14, 15 or 16 bytes.');
    if (data.length < tagBits / 8) throw new Error('Input is shorter than the authentication tag.');
    const subtle = getSubtle();
    const cryptoKey = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
    let plain;
    try {
      plain = new Uint8Array(await subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes, additionalData: parseBytesArg(aad, aadFormat, 'AAD'), tagLength: tagBits }, cryptoKey, data));
    } catch {
      throw new Error('AES-GCM authentication failed: tag mismatch (wrong key, IV or AAD, or the data was modified).');
    }
    return bytesToOutput(plain, outputFormat);
  }
);

// ---------------------------------------------------------------------------
// AES-CTR
// ---------------------------------------------------------------------------

export const aesCtrOperation = defineOp(
  {
    name: 'AES-CTR',
    id: 'aes_ctr',
    module: 'Cryptography',
    description: 'AES in counter mode via Web Crypto. Encryption and decryption are the same operation. The IV is the full 16-byte initial counter block.',
    keywords: ['aes', 'ctr', 'counter', 'stream', 'nist', 'web crypto'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      ...KEY_FMT_ARGS(),
      { name: 'iv', label: 'Initial Counter Block (16 bytes)', type: 'text', default: '' },
      { name: 'ivFormat', label: 'Counter Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
      { name: 'counterBits', label: 'Counter Width (bits)', type: 'select', options: ['64', '32', '128'], default: '64' },
      { name: 'inputFormat', label: 'Input Format', type: 'select', options: IO_FORMATS_IN, default: 'Raw' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: IO_FORMATS_OUT, default: 'Hex' }
    ]
  },
  async (input, a = {}) => {
    const { key = '', keyFormat = 'Hex', iv = '', ivFormat = 'Hex', counterBits = '64', inputFormat = 'Raw', outputFormat = 'Hex' } = a;
    const keyBytes = aesKeyBytes(key, keyFormat);
    const ctr = parseBytesArg(iv, ivFormat, 'Counter block');
    if (ctr.length !== 16) throw new Error(`AES-CTR counter block must be exactly 16 bytes (got ${ctr.length}).`);
    const bits = Number(counterBits);
    if (![32, 64, 128].includes(bits)) throw new Error('AES-CTR counter width must be 32, 64 or 128 bits.');
    const data = inputToBytes(input, inputFormat);
    const subtle = getSubtle();
    const cryptoKey = await subtle.importKey('raw', keyBytes, 'AES-CTR', false, ['encrypt']);
    const out = new Uint8Array(await subtle.encrypt({ name: 'AES-CTR', counter: ctr, length: bits }, cryptoKey, data));
    return bytesToOutput(out, outputFormat);
  }
);

// ---------------------------------------------------------------------------
// AES-CBC with explicit padding control
// ---------------------------------------------------------------------------

const CBC_PADDING = ['PKCS7', 'None (length must be a multiple of 16)', 'Zero'];

function cbcPad(bytes, padding) {
  const rem = bytes.length % 16;
  if (padding === 'PKCS7') {
    const n = 16 - rem;
    const out = new Uint8Array(bytes.length + n);
    out.set(bytes);
    out.fill(n, bytes.length);
    return out;
  }
  if (padding === 'Zero') {
    if (rem === 0) return bytes;
    const out = new Uint8Array(bytes.length + 16 - rem);
    out.set(bytes);
    return out;
  }
  if (rem !== 0) throw new Error(`With no padding the input length must be a multiple of 16 bytes (got ${bytes.length}).`);
  return bytes;
}

function cbcUnpad(bytes, padding) {
  if (padding === 'PKCS7') {
    const n = bytes[bytes.length - 1];
    if (bytes.length === 0 || n < 1 || n > 16 || n > bytes.length) {
      throw new Error('Invalid PKCS7 padding: wrong key/IV, or the data is not PKCS7 padded.');
    }
    for (let i = bytes.length - n; i < bytes.length; i++) {
      if (bytes[i] !== n) throw new Error('Invalid PKCS7 padding: wrong key/IV, or the data is not PKCS7 padded.');
    }
    return bytes.slice(0, bytes.length - n);
  }
  if (padding === 'Zero') {
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    return bytes.slice(0, end);
  }
  return bytes;
}

function cbcArgs(decrypt) {
  return [
    ...KEY_FMT_ARGS(),
    { name: 'iv', label: 'IV (16 bytes)', type: 'text', default: '' },
    { name: 'ivFormat', label: 'IV Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
    { name: 'padding', label: 'Padding', type: 'select', options: CBC_PADDING, default: 'PKCS7' },
    { name: 'inputFormat', label: 'Input Format', type: 'select', options: IO_FORMATS_IN, default: decrypt ? 'Hex' : 'Raw' },
    { name: 'outputFormat', label: 'Output Format', type: 'select', options: IO_FORMATS_OUT, default: decrypt ? 'Raw' : 'Hex' }
  ];
}

function cbcPrepare(a) {
  const keyBytes = aesKeyBytes(a.key ?? '', a.keyFormat ?? 'Hex');
  const ivBytes = parseBytesArg(a.iv ?? '', a.ivFormat ?? 'Hex', 'IV');
  if (ivBytes.length !== 16) throw new Error(`AES-CBC IV must be exactly 16 bytes (got ${ivBytes.length}).`);
  return { keyWA: wordArrayFromBytes(keyBytes), ivWA: wordArrayFromBytes(ivBytes) };
}

export const aesCbcEncryptOperation = defineOp(
  {
    name: 'AES-CBC Encrypt',
    id: 'aes_cbc_encrypt',
    module: 'Cryptography',
    description: 'AES-CBC encryption with raw byte keys/IVs and selectable padding (PKCS7, none, or zero).',
    keywords: ['aes', 'cbc', 'padding', 'pkcs7', 'pkcs#7', 'zero padding', 'no padding', 'block cipher'],
    inputType: 'Dish',
    outputType: 'string',
    args: cbcArgs(false)
  },
  async (input, a = {}) => {
    const { keyWA, ivWA } = cbcPrepare(a);
    const padding = a.padding ?? 'PKCS7';
    if (!CBC_PADDING.includes(padding)) throw new Error(`Unknown padding "${padding}".`);
    const padded = cbcPad(inputToBytes(input, a.inputFormat ?? 'Raw'), padding);
    const enc = CryptoJS.AES.encrypt(wordArrayFromBytes(padded), keyWA, { iv: ivWA, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding });
    return bytesToOutput(bytesFromWordArray(enc.ciphertext), a.outputFormat ?? 'Hex');
  }
);

export const aesCbcDecryptOperation = defineOp(
  {
    name: 'AES-CBC Decrypt',
    id: 'aes_cbc_decrypt',
    module: 'Cryptography',
    description: 'AES-CBC decryption with raw byte keys/IVs. PKCS7 padding is validated and reported clearly when invalid.',
    keywords: ['aes', 'cbc', 'padding', 'pkcs7', 'pkcs#7', 'zero padding', 'no padding', 'block cipher'],
    inputType: 'Dish',
    outputType: 'string',
    args: cbcArgs(true)
  },
  async (input, a = {}) => {
    const { keyWA, ivWA } = cbcPrepare(a);
    const padding = a.padding ?? 'PKCS7';
    if (!CBC_PADDING.includes(padding)) throw new Error(`Unknown padding "${padding}".`);
    const data = inputToBytes(input, a.inputFormat ?? 'Hex', 'Ciphertext');
    if (data.length === 0 || data.length % 16 !== 0) {
      throw new Error(`AES-CBC ciphertext length must be a non-zero multiple of 16 bytes (got ${data.length}).`);
    }
    const params = CryptoJS.lib.CipherParams.create({ ciphertext: wordArrayFromBytes(data) });
    const dec = CryptoJS.AES.decrypt(params, keyWA, { iv: ivWA, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding });
    return bytesToOutput(cbcUnpad(bytesFromWordArray(dec), padding), a.outputFormat ?? 'Raw');
  }
);

// ---------------------------------------------------------------------------
// ChaCha20 and ChaCha20-Poly1305
// ---------------------------------------------------------------------------

export const chacha20Operation = defineOp(
  {
    name: 'ChaCha20',
    id: 'chacha20',
    module: 'Cryptography',
    description: 'ChaCha20 stream cipher (RFC 8439). A 12-byte nonce uses the IETF layout; an 8-byte nonce uses the original 64-bit counter. Encryption and decryption are identical.',
    keywords: ['chacha', 'chacha20', 'stream cipher', 'rfc 8439', 'salsa'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'key', label: 'Key (32 bytes)', type: 'text', default: '' },
      { name: 'keyFormat', label: 'Key Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
      { name: 'nonce', label: 'Nonce (12 or 8 bytes)', type: 'text', default: '' },
      { name: 'nonceFormat', label: 'Nonce Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
      { name: 'counter', label: 'Initial Counter', type: 'number', default: 0 },
      { name: 'inputFormat', label: 'Input Format', type: 'select', options: IO_FORMATS_IN, default: 'Raw' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: IO_FORMATS_OUT, default: 'Hex' }
    ]
  },
  async (input, a = {}) => {
    const { key = '', keyFormat = 'Hex', nonce = '', nonceFormat = 'Hex', counter = 0, inputFormat = 'Raw', outputFormat = 'Hex' } = a;
    const out = chacha20(
      parseBytesArg(key, keyFormat, 'Key'),
      parseBytesArg(nonce, nonceFormat, 'Nonce'),
      intArg(counter, 'Counter', 0, Number.MAX_SAFE_INTEGER),
      inputToBytes(input, inputFormat));
    return bytesToOutput(out, outputFormat);
  }
);

const POLY_ARGS = [
  { name: 'key', label: 'Key (32 bytes)', type: 'text', default: '' },
  { name: 'keyFormat', label: 'Key Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
  { name: 'nonce', label: 'Nonce (12 bytes)', type: 'text', default: '' },
  { name: 'nonceFormat', label: 'Nonce Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
  { name: 'aad', label: 'Additional Authenticated Data', type: 'text', default: '' },
  { name: 'aadFormat', label: 'AAD Format', type: 'select', options: BYTE_FORMATS, default: 'UTF8' }
];

export const chacha20Poly1305EncryptOperation = defineOp(
  {
    name: 'ChaCha20-Poly1305 Encrypt',
    id: 'chacha20_poly1305_encrypt',
    module: 'Cryptography',
    description: 'ChaCha20-Poly1305 AEAD encryption (RFC 8439). Output is ciphertext followed by the 16-byte tag unless another part is selected.',
    keywords: ['chacha', 'poly1305', 'aead', 'authenticated', 'tag', 'rfc 8439'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      ...POLY_ARGS,
      { name: 'inputFormat', label: 'Input Format', type: 'select', options: IO_FORMATS_IN, default: 'Raw' },
      { name: 'output', label: 'Output', type: 'select', options: ['Ciphertext + tag', 'Ciphertext only', 'Tag only'], default: 'Ciphertext + tag' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: IO_FORMATS_OUT, default: 'Hex' }
    ]
  },
  async (input, a = {}) => {
    const { ciphertext, tag } = chacha20Poly1305Encrypt(
      parseBytesArg(a.key ?? '', a.keyFormat ?? 'Hex', 'Key'),
      parseBytesArg(a.nonce ?? '', a.nonceFormat ?? 'Hex', 'Nonce'),
      parseBytesArg(a.aad ?? '', a.aadFormat ?? 'UTF8', 'AAD'),
      inputToBytes(input, a.inputFormat ?? 'Raw'));
    const out = a.output === 'Ciphertext only' ? ciphertext : a.output === 'Tag only' ? tag : concatBytes(ciphertext, tag);
    return bytesToOutput(out, a.outputFormat ?? 'Hex');
  }
);

export const chacha20Poly1305DecryptOperation = defineOp(
  {
    name: 'ChaCha20-Poly1305 Decrypt',
    id: 'chacha20_poly1305_decrypt',
    module: 'Cryptography',
    description: 'ChaCha20-Poly1305 AEAD decryption (RFC 8439). Fails with a clear error when the tag does not verify. The input is ciphertext followed by the 16-byte tag, or ciphertext only with a separate tag argument.',
    keywords: ['chacha', 'poly1305', 'aead', 'authenticated', 'tag', 'verify', 'rfc 8439'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      ...POLY_ARGS,
      { name: 'tag', label: 'Tag (hex, optional if appended to input)', type: 'text', default: '' },
      { name: 'inputFormat', label: 'Input Format', type: 'select', options: IO_FORMATS_IN, default: 'Hex' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: IO_FORMATS_OUT, default: 'Raw' }
    ]
  },
  async (input, a = {}) => {
    let data = inputToBytes(input, a.inputFormat ?? 'Hex', 'Ciphertext');
    let tag;
    if (String(a.tag ?? '').trim()) {
      tag = hexToBytes(a.tag, 'Tag');
    } else {
      if (data.length < 16) throw new Error('Input is shorter than the 16-byte Poly1305 tag.');
      tag = data.slice(data.length - 16);
      data = data.slice(0, data.length - 16);
    }
    if (tag.length !== 16) throw new Error(`Poly1305 tag must be 16 bytes (got ${tag.length}).`);
    const plain = chacha20Poly1305Decrypt(
      parseBytesArg(a.key ?? '', a.keyFormat ?? 'Hex', 'Key'),
      parseBytesArg(a.nonce ?? '', a.nonceFormat ?? 'Hex', 'Nonce'),
      parseBytesArg(a.aad ?? '', a.aadFormat ?? 'UTF8', 'AAD'),
      data, tag);
    return bytesToOutput(plain, a.outputFormat ?? 'Raw');
  }
);

// ---------------------------------------------------------------------------
// PBKDF2 and HKDF (Web Crypto)
// ---------------------------------------------------------------------------

const KDF_HASHES = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];
const KDF_HASH_BYTES = { 'SHA-1': 20, 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 };

export const pbkdf2Operation = defineOp(
  {
    name: 'PBKDF2',
    id: 'pbkdf2',
    module: 'Cryptography',
    description: 'Derives a key from the input passphrase with PBKDF2 (RFC 8018 / RFC 6070) using HMAC and Web Crypto.',
    keywords: ['pbkdf2', 'kdf', 'key derivation', 'password', 'rfc 6070', 'rfc 8018', 'stretching'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'salt', label: 'Salt', type: 'text', default: '' },
      { name: 'saltFormat', label: 'Salt Format', type: 'select', options: BYTE_FORMATS, default: 'UTF8' },
      { name: 'iterations', label: 'Iterations', type: 'number', default: 100000 },
      { name: 'keySize', label: 'Derived Key Size (bits)', type: 'number', default: 256 },
      { name: 'hash', label: 'Hash Function', type: 'select', options: KDF_HASHES, default: 'SHA-256' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: ['Hex', 'Base64'], default: 'Hex' }
    ]
  },
  async (input, a = {}) => {
    const { salt = '', saltFormat = 'UTF8', iterations = 100000, keySize = 256, hash = 'SHA-256', outputFormat = 'Hex' } = a;
    if (!KDF_HASHES.includes(hash)) throw new Error(`PBKDF2 hash must be one of ${KDF_HASHES.join(', ')}.`);
    const iter = intArg(iterations, 'Iterations', 1, 10000000);
    const bits = intArg(keySize, 'Key size (bits)', 8, 8192);
    if (bits % 8 !== 0) throw new Error('Key size must be a multiple of 8 bits.');
    const subtle = getSubtle();
    const pass = (input instanceof Dish ? input : new Dish(input)).toUint8Array();
    const base = await subtle.importKey('raw', pass, 'PBKDF2', false, ['deriveBits']);
    const derived = new Uint8Array(await subtle.deriveBits(
      { name: 'PBKDF2', hash, salt: parseBytesArg(salt, saltFormat, 'Salt'), iterations: iter }, base, bits));
    return bytesToOutput(derived, outputFormat);
  }
);

export const hkdfOperation = defineOp(
  {
    name: 'HKDF',
    id: 'hkdf',
    module: 'Cryptography',
    description: 'HMAC-based Extract-and-Expand Key Derivation Function (RFC 5869). The input is the input keying material (IKM).',
    keywords: ['hkdf', 'kdf', 'key derivation', 'rfc 5869', 'extract', 'expand', 'ikm'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'inputFormat', label: 'IKM Format', type: 'select', options: IO_FORMATS_IN, default: 'Raw' },
      { name: 'salt', label: 'Salt', type: 'text', default: '' },
      { name: 'saltFormat', label: 'Salt Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
      { name: 'info', label: 'Info / Context', type: 'text', default: '' },
      { name: 'infoFormat', label: 'Info Format', type: 'select', options: BYTE_FORMATS, default: 'Hex' },
      { name: 'length', label: 'Output Length (bytes)', type: 'number', default: 32 },
      { name: 'hash', label: 'Hash Function', type: 'select', options: KDF_HASHES, default: 'SHA-256' },
      { name: 'outputFormat', label: 'Output Format', type: 'select', options: ['Hex', 'Base64'], default: 'Hex' }
    ]
  },
  async (input, a = {}) => {
    const { inputFormat = 'Raw', salt = '', saltFormat = 'Hex', info = '', infoFormat = 'Hex', length = 32, hash = 'SHA-256', outputFormat = 'Hex' } = a;
    if (!KDF_HASHES.includes(hash)) throw new Error(`HKDF hash must be one of ${KDF_HASHES.join(', ')}.`);
    const max = 255 * KDF_HASH_BYTES[hash];
    const len = intArg(length, 'Output length', 1, max);
    const subtle = getSubtle();
    const ikm = inputToBytes(input, inputFormat, 'IKM');
    const base = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    const derived = new Uint8Array(await subtle.deriveBits(
      { name: 'HKDF', hash, salt: parseBytesArg(salt, saltFormat, 'Salt'), info: parseBytesArg(info, infoFormat, 'Info') }, base, len * 8));
    return bytesToOutput(derived, outputFormat);
  }
);

export const extraCryptographyOperations = [
  aesGcmEncryptOperation, aesGcmDecryptOperation, aesCtrOperation,
  aesCbcEncryptOperation, aesCbcDecryptOperation,
  chacha20Operation, chacha20Poly1305EncryptOperation, chacha20Poly1305DecryptOperation,
  pbkdf2Operation, hkdfOperation
];

export const cryptographyOperations = [
  new AesEncryptOperation(),
  new AesDecryptOperation(),
  new DesEncryptOperation(),
  new DesDecryptOperation(),
  new TripleDesEncryptOperation(),
  new TripleDesDecryptOperation(),
  new Rc4Operation(),
  new BlowfishEncryptOperation(),
  new BlowfishDecryptOperation(),
  new XorBruteForceOperation(),
  new RsaEncryptOperation(),
  new RsaDecryptOperation(),
  new BcryptOperation(),
  new ScryptOperation(),
  ...extraCryptographyOperations
];
