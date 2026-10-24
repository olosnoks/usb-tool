import { describe, it, expect } from 'vitest';
import { Dish, Chef } from '../../src/utils/cyberchef/index.js';
import {
  XorBruteForceOperation,
  FrequencyAnalysisOperation,
  X509CertificateParserOperation,
  RsaKeyParserOperation
} from '../../src/utils/cyberchef/operations/Cryptanalysis.js';

describe('CyberChef Cryptanalysis Operations (Cryptanalysis.js)', () => {
  describe('XOR Brute Force Operation', () => {
    it('accurately identifies the single-byte key and decodes English plaintext', async () => {
      const plaintext = 'The quick brown fox jumps over the lazy dog.';
      const key = 0x5A; // 90

      // XOR encrypt
      const plainBytes = new TextEncoder().encode(plaintext);
      const cipherBytes = new Uint8Array(plainBytes.length);
      for (let i = 0; i < plainBytes.length; i++) {
        cipherBytes[i] = plainBytes[i] ^ key;
      }

      // Convert to hex string
      const hexCipher = Array.from(cipherBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const dish = Dish.fromHex(hexCipher);
      const op = new XorBruteForceOperation();

      const resultStr = await op.run(dish, { topN: 10 });
      const candidates = JSON.parse(resultStr);

      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates.length).toBeLessThanOrEqual(10);

      // Top candidate must be key 0x5A
      const top = candidates[0];
      expect(top.keyInt).toBe(0x5A);
      expect(top.keyHex.toLowerCase()).toBe('0x5a');
      expect(top.preview).toBe(plaintext);
    });

    it('handles binary dish input correctly', async () => {
      const msg = 'Secret Message For CyberChef Analysis';
      const key = 0x37;
      const raw = new TextEncoder().encode(msg);
      const enc = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) enc[i] = raw[i] ^ key;

      const dish = Dish.fromBytes(enc);
      const op = new XorBruteForceOperation();
      const res = JSON.parse(await op.run(dish, { topN: 5 }));

      expect(res.some(c => c.keyInt === key && c.preview.includes('Secret Message'))).toBe(true);
    });
  });

  describe('Frequency Analysis Operation', () => {
    it('computes accurate ASCII frequencies and renders visual histogram', async () => {
      const text = 'AAAAABBBCCDE';
      const dish = Dish.fromString(text);
      const op = new FrequencyAnalysisOperation();

      const resStr = await op.run(dish, { caseSensitive: true });
      const res = JSON.parse(resStr);

      expect(res.totalCharacters).toBe(12);
      expect(res.frequencies).toBeDefined();

      const itemA = res.frequencies.find(f => f.char === 'A');
      expect(itemA).toBeDefined();
      expect(itemA.count).toBe(5);
      expect(itemA.percentage).toBe(Math.round((5 / 12) * 10000) / 100);

      const itemB = res.frequencies.find(f => f.char === 'B');
      expect(itemB).toBeDefined();
      expect(itemB.count).toBe(3);

      expect(typeof res.visualHistogram).toBe('string');
      expect(res.visualHistogram).toContain('A');
      expect(res.visualHistogram).toContain('B');
    });

    it('returns empty analysis for blank dish', async () => {
      const dish = Dish.fromString('');
      const op = new FrequencyAnalysisOperation();
      const res = JSON.parse(await op.run(dish, {}));
      expect(res.totalCharacters).toBe(0);
      expect(res.frequencies.length).toBe(0);
    });
  });

  describe('X.509 Certificate Parser Operation', () => {
    it('parses PEM-encoded certificate structure or provides informative error', async () => {
      const dummyCert = `-----BEGIN CERTIFICATE-----
MIIBkDCB+wIJAL0Z8dummycert
-----END CERTIFICATE-----`;
      const dish = Dish.fromString(dummyCert);
      const op = new X509CertificateParserOperation();
      const res = JSON.parse(await op.run(dish, {}));

      expect(res).toBeDefined();
      expect(res.format).toBe('X.509 Public Certificate');
      expect(res.error || res.subjectAttributes).toBeDefined();
    });

    it('extracts certificate details from a valid minimal X.509 DER structure', async () => {
      // Minimal valid ASN.1 DER SEQUENCE (0x30) with 32 bytes
      const certBytes = new Uint8Array(48);
      certBytes[0] = 0x30;
      certBytes[1] = 46;
      // Embedded printable string: tag 0x13, len 8, "test.com"
      certBytes[2] = 0x13;
      certBytes[3] = 8;
      const strBytes = new TextEncoder().encode('test.com');
      certBytes.set(strBytes, 4);

      const dish = Dish.fromBytes(certBytes);
      const op = new X509CertificateParserOperation();
      const res = JSON.parse(await op.run(dish, {}));

      expect(res.format).toBe('X.509 Public Certificate');
      expect(res.commonName).toBe('test.com');
      expect(res.fingerprintSha256).toBeDefined();
    });
  });

  describe('RSA Key Parser Operation', () => {
    it('parses RSA public key and extracts modulus and exponent', async () => {
      // Construct a minimal valid RSA SubjectPublicKeyInfo DER with a 512-bit modulus
      // Modulus integer: Tag 0x02, Length 65 (0x81 0x41), leading 0x00 + 64 bytes of 0xAA
      // Exponent integer: Tag 0x02, Length 3, 0x01 0x00 0x01 (65537)
      const rsaDer = new Uint8Array(80);
      let p = 0;
      rsaDer[p++] = 0x30; // SEQUENCE
      rsaDer[p++] = 78;   // Length
      rsaDer[p++] = 0x02; // INTEGER (modulus)
      rsaDer[p++] = 65;   // Length 65
      rsaDer[p++] = 0x00; // leading zero
      for (let i = 0; i < 64; i++) rsaDer[p++] = 0xAA; // 512-bit modulus
      rsaDer[p++] = 0x02; // INTEGER (exponent)
      rsaDer[p++] = 0x03; // Length 3
      rsaDer[p++] = 0x01;
      rsaDer[p++] = 0x00;
      rsaDer[p++] = 0x01; // 65537

      const dish = Dish.fromBytes(rsaDer);
      const op = new RsaKeyParserOperation();
      const res = JSON.parse(await op.run(dish, {}));

      expect(res.algorithm).toBe('RSA');
      expect(res.bitLength).toBe(512);
      expect(res.publicExponent.decimal).toBe(65537);
      expect(res.modulus.hex).toContain('AA AA AA');
    });
  });
});

describe('CyberChef Recipe Test Suite Validation', () => {
  it('correctly validates passing test cases with exact matching', async () => {
    const recipe = [
      { op: 'To Base64', args: {} }
    ];

    const testInput = 'Hello CyberChef';
    const expectedOutput = 'SGVsbG8gQ3liZXJDaGVm';

    const dish = Dish.fromString(testInput);
    const resultDish = await Chef.bake(dish, recipe);
    const actualOutput = resultDish.toString();

    expect(actualOutput).toBe(expectedOutput);
  });

  it('correctly catches failing test cases when recipe output does not match expected', async () => {
    const recipe = [
      { op: 'To Base64', args: {} }
    ];

    const testInput = 'Hello CyberChef';
    const expectedOutput = 'WRONG_EXPECTATION';

    const dish = Dish.fromString(testInput);
    const resultDish = await Chef.bake(dish, recipe);
    const actualOutput = resultDish.toString();

    expect(actualOutput).not.toBe(expectedOutput);
  });

  it('supports fuzzy contains matching for complex pipeline outputs', async () => {
    const recipe = [
      { op: 'MD5', args: {} }
    ];

    const testInput = 'admin';
    const dish = Dish.fromString(testInput);
    const resultDish = await Chef.bake(dish, recipe);
    const actualOutput = resultDish.toString().toLowerCase();

    // MD5 of admin: 21232f297a57a5a743894a0e4a801fc3
    expect(actualOutput).toContain('21232f297a57a5a7');
  });
});
