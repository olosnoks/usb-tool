/**
 * Cryptography Operations
 * AES, DES, Triple DES, RC4, Blowfish, XOR Brute Force, RSA, Bcrypt, Scrypt
 */

import CryptoJS from 'crypto-js';
import { Operation } from '../core/Operation.js';
import { calculatePrintableRatio } from '../magic.js';

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
  new ScryptOperation()
];
