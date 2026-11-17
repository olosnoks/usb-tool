/**
 * Hashing Operations
 * MD5, SHA-1, SHA-256, SHA-3, BLAKE2b, CRC-32, Adler-32, plus SHA-2 variants,
 * RIPEMD-160, MD4, NTLM, HMAC, CRC-8/16/64/custom, Fletcher and BLAKE2s.
 */

import CryptoJS from 'crypto-js';
import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';
import { defineOp, bytesToHex, parseBytesArg, BYTE_FORMATS, intArg } from './opHelpers.js';
import {
  sha224, sha384Bytes, sha512Bytes, sha512_256Bytes, ripemd160, md4, ntlm,
  hmac, HASH_FUNCTIONS, crcHex, CRC_PRESETS, fletcher16, fletcher32, blake2s
} from '../algorithms.js';

// RFC 7693 BLAKE2b constants & algorithm
const BLAKE2B_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n
];

const BLAKE2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3]
];

function rotr64(x, c) {
  const cn = BigInt(c);
  return ((x >> cn) | (x << (64n - cn))) & 0xffffffffffffffffn;
}

export function computeBlake2b(bytes, outlen = 64) {
  const h = [...BLAKE2B_IV];
  h[0] ^= 0x01010000n ^ BigInt(outlen);

  let offset = 0;
  const total = bytes.length;

  function compress(chunk, isLast, bytesCount) {
    const v = new Array(16);
    for (let i = 0; i < 8; i++) v[i] = h[i];
    for (let i = 0; i < 8; i++) v[i + 8] = BLAKE2B_IV[i];
    v[12] ^= BigInt(bytesCount) & 0xffffffffffffffffn;
    v[13] ^= BigInt(bytesCount) >> 64n;
    if (isLast) v[14] = ~v[14] & 0xffffffffffffffffn;

    const m = new Array(16).fill(0n);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let i = 0; i < 16; i++) {
      if (i * 8 < chunk.length) {
        m[i] = view.getBigUint64(i * 8, true);
      }
    }

    function G(r, i, a, b, c, d) {
      v[a] = (v[a] + v[b] + m[BLAKE2B_SIGMA[r % 12][2 * i]]) & 0xffffffffffffffffn;
      v[d] = rotr64(v[d] ^ v[a], 32);
      v[c] = (v[c] + v[d]) & 0xffffffffffffffffn;
      v[b] = rotr64(v[b] ^ v[c], 24);
      v[a] = (v[a] + v[b] + m[BLAKE2B_SIGMA[r % 12][2 * i + 1]]) & 0xffffffffffffffffn;
      v[d] = rotr64(v[d] ^ v[a], 16);
      v[c] = (v[c] + v[d]) & 0xffffffffffffffffn;
      v[b] = rotr64(v[b] ^ v[c], 63);
    }

    for (let r = 0; r < 12; r++) {
      G(r, 0, 0, 4, 8, 12);
      G(r, 1, 1, 5, 9, 13);
      G(r, 2, 2, 6, 10, 14);
      G(r, 3, 3, 7, 11, 15);
      G(r, 4, 0, 5, 10, 15);
      G(r, 5, 1, 6, 11, 12);
      G(r, 6, 2, 7, 8, 13);
      G(r, 7, 3, 4, 9, 14);
    }

    for (let i = 0; i < 8; i++) {
      h[i] = (h[i] ^ v[i] ^ v[i + 8]) & 0xffffffffffffffffn;
    }
  }

  if (total === 0) {
    compress(new Uint8Array(128), true, 0);
  } else {
    let processed = 0;
    while (offset < total) {
      const remaining = total - offset;
      const isLast = remaining <= 128;
      const take = Math.min(128, remaining);
      const chunk = new Uint8Array(128);
      chunk.set(bytes.subarray(offset, offset + take));
      processed += take;
      compress(chunk, isLast, processed);
      offset += take;
    }
  }

  const outBuf = new Uint8Array(64);
  const outView = new DataView(outBuf.buffer);
  for (let i = 0; i < 8; i++) {
    outView.setBigUint64(i * 8, h[i], true);
  }
  return Array.from(outBuf.subarray(0, outlen)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function computeCrc32(bytes) {
  let table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  let crc = 0 ^ (-1);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  }
  return ((crc ^ (-1)) >>> 0).toString(16).padStart(8, '0');
}

export function computeAdler32(bytes) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a).toString(16).padStart(8, '0');
}

export class Md5Operation extends Operation {
  constructor() {
    super({
      name: 'MD5',
      id: 'md5',
      module: 'Hashing',
      description: 'Calculates the 128-bit MD5 message digest.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const words = CryptoJS.enc.Latin1.parse(inputDish.toString());
    return CryptoJS.MD5(words).toString();
  }
}

export class Sha1Operation extends Operation {
  constructor() {
    super({
      name: 'SHA-1',
      id: 'sha1',
      module: 'Hashing',
      description: 'Calculates the 160-bit SHA-1 hash digest.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const words = CryptoJS.enc.Latin1.parse(inputDish.toString());
    return CryptoJS.SHA1(words).toString();
  }
}

export class Sha256Operation extends Operation {
  constructor() {
    super({
      name: 'SHA-256',
      id: 'sha256',
      module: 'Hashing',
      description: 'Calculates the 256-bit SHA-2 cryptographic hash digest.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const words = CryptoJS.enc.Latin1.parse(inputDish.toString());
    return CryptoJS.SHA256(words).toString();
  }
}

export class Sha3Operation extends Operation {
  constructor() {
    super({
      name: 'SHA-3',
      id: 'sha3',
      module: 'Hashing',
      description: 'Calculates the Keccak / SHA-3 cryptographic hash digest.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'length', label: 'Digest Length (bits)', type: 'select', options: ['256', '512', '384', '224'], default: '256' }
      ]
    });
  }

  async run(dish, { length = '256' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const words = CryptoJS.enc.Latin1.parse(inputDish.toString());
    const bitLen = parseInt(length, 10) || 256;
    return CryptoJS.SHA3(words, { outputLength: bitLen }).toString();
  }
}

export class Blake2bOperation extends Operation {
  constructor() {
    super({
      name: 'BLAKE2b',
      id: 'blake2b',
      module: 'Hashing',
      description: 'Calculates the BLAKE2b cryptographic hash digest per RFC 7693.',
      inputType: 'Dish',
      outputType: 'string',
      args: [
        { name: 'length', label: 'Digest Length (bits)', type: 'select', options: ['512', '256'], default: '512' }
      ]
    });
  }

  async run(dish, { length = '512' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const bytes = inputDish.toUint8Array();
    const outBytes = length === '256' ? 32 : 64;
    return computeBlake2b(bytes, outBytes);
  }
}

export class Crc32Operation extends Operation {
  constructor() {
    super({
      name: 'CRC-32',
      id: 'crc32',
      module: 'Hashing',
      description: 'Calculates 32-bit Cyclic Redundancy Check (CRC-32).',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    return computeCrc32(inputDish.toUint8Array());
  }
}

export class Adler32Operation extends Operation {
  constructor() {
    super({
      name: 'Adler-32',
      id: 'adler32',
      module: 'Hashing',
      description: 'Calculates 32-bit Adler-32 checksum algorithm.',
      inputType: 'Dish',
      outputType: 'string',
      args: []
    });
  }

  async run(dish) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    return computeAdler32(inputDish.toUint8Array());
  }
}

// ============================================================================
// DAT-5: additional hashes, checksums and HMAC
// ============================================================================

async function webCryptoDigest(name, bytes, fallback) {
  try {
    const subtle = globalThis.crypto && globalThis.crypto.subtle;
    if (subtle) return new Uint8Array(await subtle.digest(name, bytes));
  } catch {
    // fall through to the in-house implementation
  }
  return fallback(bytes);
}

const toBytes = (dish) => (dish instanceof Dish ? dish : new Dish(dish)).toUint8Array();

const hashOp = (name, id, description, keywords, fn) =>
  defineOp(
    { name, id, module: 'Hashing', description, keywords, inputType: 'Dish', outputType: 'string', args: [] },
    async (dish) => bytesToHex(await fn(toBytes(dish)))
  );

export const sha512Operation = hashOp('SHA-512', 'sha512', 'Calculates the 512-bit SHA-2 digest of the input bytes.', ['sha2', 'sha-2', '512'],
  (b) => webCryptoDigest('SHA-512', b, sha512Bytes));
export const sha384Operation = hashOp('SHA-384', 'sha384', 'Calculates the 384-bit SHA-2 digest of the input bytes.', ['sha2', 'sha-2', '384'],
  (b) => webCryptoDigest('SHA-384', b, sha384Bytes));
export const sha224Operation = hashOp('SHA-224', 'sha224', 'Calculates the 224-bit SHA-2 digest of the input bytes.', ['sha2', 'sha-2', '224'], sha224);
export const sha512t256Operation = hashOp('SHA-512/256', 'sha512_256', 'Calculates the SHA-512/256 digest (SHA-512 with a distinct IV, truncated to 256 bits).', ['sha2', 'sha-2', 'sha512t256', 'truncated'], sha512_256Bytes);
export const ripemd160Operation = hashOp('RIPEMD-160', 'ripemd160', 'Calculates the 160-bit RIPEMD-160 digest (used for Bitcoin addresses).', ['ripemd', 'rmd160', 'bitcoin'], ripemd160);
export const md4Operation = hashOp('MD4', 'md4', 'Calculates the legacy 128-bit MD4 digest.', ['md4', 'legacy', 'ntlm'], md4);

export const ntlmOperation = defineOp(
  {
    name: 'NTLM Hash',
    id: 'ntlm_hash',
    module: 'Hashing',
    description: 'Calculates the Windows NT hash: MD4 of the UTF-16LE encoded input (hex, upper case).',
    keywords: ['nt hash', 'ntlm', 'windows', 'md4', 'utf-16le', 'password'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => bytesToHex(ntlm(input)).toUpperCase()
);

const HMAC_HASHES = Object.keys(HASH_FUNCTIONS).filter((n) => n !== 'MD4');

export const hmacOperation = defineOp(
  {
    name: 'HMAC',
    id: 'hmac',
    module: 'Hashing',
    description: 'Keyed-hash message authentication code (RFC 2104). The key may be given as text, hex or Base64.',
    keywords: ['hmac', 'mac', 'keyed hash', 'rfc 2104', 'rfc 4231', 'authentication'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'key', label: 'Key', type: 'text', default: '' },
      { name: 'keyFormat', label: 'Key Format', type: 'select', options: BYTE_FORMATS, default: 'UTF8' },
      { name: 'hash', label: 'Hash Function', type: 'select', options: HMAC_HASHES, default: 'SHA-256' }
    ]
  },
  async (dish, { key = '', keyFormat = 'UTF8', hash = 'SHA-256' } = {}) => {
    if (!HMAC_HASHES.includes(hash)) throw new Error(`Unsupported HMAC hash "${hash}". Choose one of: ${HMAC_HASHES.join(', ')}.`);
    const keyBytes = parseBytesArg(key, keyFormat, 'HMAC key');
    return bytesToHex(hmac(hash, keyBytes, toBytes(dish)));
  }
);

const crcPresetOp = (width, name, id, keywords) => {
  const presets = CRC_PRESETS[width];
  const names = Object.keys(presets);
  return defineOp(
    {
      name,
      id,
      module: 'Hashing',
      description: `Calculates a ${width}-bit CRC using a named, published parameter set.`,
      keywords: ['crc', 'checksum', 'cyclic redundancy', ...keywords],
      inputType: 'Dish',
      outputType: 'string',
      args: [{ name: 'variant', label: 'Variant', type: 'select', options: names, default: names[0] }]
    },
    async (dish, { variant = names[0] } = {}) => {
      const p = presets[variant];
      if (!p) throw new Error(`Unknown ${name} variant "${variant}". Choose one of: ${names.join(', ')}.`);
      return crcHex(toBytes(dish), p);
    }
  );
};

export const crc8Operation = crcPresetOp(8, 'CRC-8', 'crc8', ['crc8', 'maxim', 'dallas', 'rohc']);
export const crc16Operation = crcPresetOp(16, 'CRC-16', 'crc16', ['crc16', 'modbus', 'ccitt', 'xmodem', 'kermit', 'x25', 'usb']);
export const crc64Operation = crcPresetOp(64, 'CRC-64', 'crc64', ['crc64', 'ecma', 'xz', 'go-iso']);

function parseHexBig(text, label) {
  const t = String(text ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(t)) throw new Error(`${label} must be a hexadecimal number (for example 1021).`);
  return BigInt('0x' + t);
}

export const crcCustomOperation = defineOp(
  {
    name: 'CRC (custom)',
    id: 'crc_custom',
    module: 'Hashing',
    description: 'Generic CRC (Rocksoft model) with width 1-64, polynomial, initial value, XOR-out and reflection flags. Parameters are hexadecimal.',
    keywords: ['crc', 'checksum', 'polynomial', 'generic', 'custom', 'rocksoft', 'init', 'xorout'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'width', label: 'Width (bits, 1-64)', type: 'number', default: 16 },
      { name: 'poly', label: 'Polynomial (hex)', type: 'text', default: '1021' },
      { name: 'init', label: 'Initial value (hex)', type: 'text', default: 'FFFF' },
      { name: 'xorout', label: 'XOR out (hex)', type: 'text', default: '0000' },
      { name: 'refin', label: 'Reflect input', type: 'select', options: ['No', 'Yes'], default: 'No' },
      { name: 'refout', label: 'Reflect output', type: 'select', options: ['No', 'Yes'], default: 'No' }
    ]
  },
  async (dish, { width = 16, poly = '1021', init = 'FFFF', xorout = '0000', refin = 'No', refout = 'No' } = {}) => {
    const w = intArg(width, 'CRC width', 1, 64);
    const params = {
      width: w,
      poly: parseHexBig(poly, 'Polynomial'),
      init: parseHexBig(init, 'Initial value'),
      xorout: parseHexBig(xorout, 'XOR out'),
      refin: refin === 'Yes' || refin === true,
      refout: refout === 'Yes' || refout === true
    };
    return crcHex(toBytes(dish), params);
  }
);

export const fletcher16Operation = defineOp(
  {
    name: 'Fletcher-16',
    id: 'fletcher16',
    module: 'Hashing',
    description: 'Calculates the Fletcher-16 checksum (modulo 255 over bytes).',
    keywords: ['fletcher', 'checksum', 'fletcher16'],
    inputType: 'Dish',
    outputType: 'string',
    args: []
  },
  async (dish) => fletcher16(toBytes(dish)).toString(16).padStart(4, '0')
);

export const fletcher32Operation = defineOp(
  {
    name: 'Fletcher-32',
    id: 'fletcher32',
    module: 'Hashing',
    description: 'Calculates the Fletcher-32 checksum (modulo 65535 over 16-bit little-endian words, zero-padded).',
    keywords: ['fletcher', 'checksum', 'fletcher32'],
    inputType: 'Dish',
    outputType: 'string',
    args: []
  },
  async (dish) => fletcher32(toBytes(dish)).toString(16).padStart(8, '0')
);

export const blake2sOperation = defineOp(
  {
    name: 'BLAKE2s',
    id: 'blake2s',
    module: 'Hashing',
    description: 'Calculates the unkeyed BLAKE2s digest per RFC 7693 (32-bit variant of BLAKE2).',
    keywords: ['blake', 'blake2', 'rfc 7693'],
    inputType: 'Dish',
    outputType: 'string',
    args: [{ name: 'length', label: 'Digest Length (bits)', type: 'select', options: ['256', '224', '160', '128'], default: '256' }]
  },
  async (dish, { length = '256' } = {}) => {
    const bits = Number(length);
    if (![256, 224, 160, 128].includes(bits)) throw new Error('BLAKE2s digest length must be 256, 224, 160 or 128 bits.');
    return bytesToHex(blake2s(toBytes(dish), bits / 8));
  }
);

export const extraHashingOperations = [
  sha512Operation, sha384Operation, sha224Operation, sha512t256Operation,
  ripemd160Operation, md4Operation, ntlmOperation, hmacOperation,
  crc8Operation, crc16Operation, crc64Operation, crcCustomOperation,
  fletcher16Operation, fletcher32Operation, blake2sOperation
];

export const hashingOperations = [
  new Md5Operation(),
  new Sha1Operation(),
  new Sha256Operation(),
  new Sha3Operation(),
  new Blake2bOperation(),
  new Crc32Operation(),
  new Adler32Operation(),
  ...extraHashingOperations
];
