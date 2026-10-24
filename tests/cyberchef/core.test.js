import { describe, it, expect } from 'vitest';
import { Dish, Recipe, Chef, registry } from '../../src/utils/cyberchef/core/index.js';
import '../../src/utils/cyberchef/operations/index.js';

describe('CyberChef Core Architecture (core.test.js)', () => {
  describe('Dish Data Container', () => {
    it('handles string inputs and type detection correctly', () => {
      const dish = new Dish('Hello CyberChef');
      expect(dish.type).toBe('string');
      expect(dish.length).toBe(15);
      expect(dish.toString()).toBe('Hello CyberChef');
      expect(dish.toBase64()).toBe('SGVsbG8gQ3liZXJDaGVm');
      expect(dish.toHex(' ')).toBe('48 65 6c 6c 6f 20 43 79 62 65 72 43 68 65 66');
      expect(dish.toHex()).toBe('48656c6c6f20437962657243686566');
    });

    it('generates canonical 16-bytes-per-line hexdump', () => {
      const dish = new Dish('Hello World!');
      const hexdump = dish.toHexdump(16);
      expect(hexdump).toContain('00000000');
      expect(hexdump).toContain('48 65 6c 6c 6f 20 57 6f');
      expect(hexdump).toContain('|Hello World!|');
    });

    it('handles ArrayBuffer inputs and conversions', () => {
      const buffer = new Uint8Array([0x01, 0x02, 0x03, 0x04]).buffer;
      const dish = new Dish(buffer);
      expect(dish.type).toBe('ArrayBuffer');
      expect(dish.length).toBe(4);
      expect(dish.toHex(' ')).toBe('01 02 03 04');
      expect(dish.toBase64()).toBe('AQIDBA==');

      const arrayBuf = dish.toArrayBuffer();
      expect(arrayBuf.byteLength).toBe(4);
      expect(new Uint8Array(arrayBuf)[0]).toBe(0x01);
    });

    it('creates Dish from Base64 and Hex accurately', () => {
      const b64Dish = Dish.fromBase64('SGVsbG8=');
      expect(b64Dish.toString()).toBe('Hello');

      const hexDish = Dish.fromHex('48656c6c6f');
      expect(hexDish.toString()).toBe('Hello');
    });
  });

  describe('Operation Registry', () => {
    it('contains over 50 registered operations across categories', () => {
      const all = registry.getAll();
      expect(all.length).toBeGreaterThanOrEqual(50);

      const categories = registry.getCategories();
      expect(categories).toContain('Cryptography');
      expect(categories).toContain('Compression');
      expect(categories).toContain('Parsing');
      expect(categories).toContain('Extractors');
      expect(categories).toContain('Networking');
      expect(categories).toContain('Forensics');
      expect(categories).toContain('Data Format');
      expect(categories).toContain('Flow Control');
    });
  });

  describe('Flow Control Engine (Fork, Merge, Register, Subsection, Label/Jump)', () => {
    it('executes Fork and Merge on multi-line text', async () => {
      const input = 'alpha\nbeta\ngamma';
      const recipe = [
        { op: 'Fork', args: { splitDelimiter: '\n', mergeDelimiter: '\n' } },
        { op: 'To Base64', args: {} },
        { op: 'Merge', args: { delimiter: ',' } }
      ];
      const chef = new Chef();
      const result = await chef.bake(input, recipe);
      expect(result.toString()).toBe('YWxwaGE=,YmV0YQ==,Z2FtbWE=');
    });

    it('handles Register memory storage and substitution ($R0)', async () => {
      const input = 'Authorization: Bearer secret_jwt_token_12345';
      const recipe = [
        { op: 'Register', args: { mode: 'Set', register: 'token', pattern: 'Bearer\\s+([A-Za-z0-9_]+)' } },
        { op: 'To Base64', args: {} }, // arbitrary step transforming stream
        { op: 'Register', args: { mode: 'Get', register: 'token' } }
      ];
      const result = await Chef.bake(input, recipe);
      expect(result.toString()).toBe('secret_jwt_token_12345');
    });

    it('handles Subsection selective line modification', async () => {
      const input = 'admin:secret123\nguest:public\nadmin:anothersecret';
      const recipe = [
        { op: 'Subsection', args: { action: 'Start', regex: '^admin:.*', invert: 'No' } },
        { op: 'To Base64', args: {} },
        { op: 'Subsection', args: { action: 'End' } }
      ];
      const result = await Chef.bake(input, recipe);
      const lines = result.toString().split('\n');
      expect(lines.length).toBe(3);
      // admin lines were base64 encoded
      expect(lines[0]).toBe(btoa('admin:secret123'));
      // guest line was left untouched
      expect(lines[1]).toBe('guest:public');
      expect(lines[2]).toBe(btoa('admin:anothersecret'));
    });
  });

  describe('Advanced Cryptography (DES, Triple DES, RC4, XOR Brute Force)', () => {
    it('executes DES Encrypt and Decrypt cycle', async () => {
      const key = 'DesKey56';
      const plain = 'Confidential DES Payload';
      const enc = await Chef.bake(plain, [{ op: 'DES Encrypt', args: { key, format: 'Base64' } }]);
      expect(enc.toString()).not.toBe(plain);

      const dec = await Chef.bake(enc.toString(), [{ op: 'DES Decrypt', args: { key, inputFormat: 'Base64' } }]);
      expect(dec.toString()).toBe(plain);
    });

    it('executes Triple DES Encrypt and Decrypt cycle', async () => {
      const key = 'TripleDesSecretKey12345';
      const plain = 'Top Secret 3DES Communication';
      const enc = await Chef.bake(plain, [{ op: 'Triple DES Encrypt', args: { key, format: 'Hex' } }]);
      expect(enc.toString()).not.toBe(plain);

      const dec = await Chef.bake(enc.toString(), [{ op: 'Triple DES Decrypt', args: { key, inputFormat: 'Hex' } }]);
      expect(dec.toString()).toBe(plain);
    });

    it('executes RC4 stream cipher encryption', async () => {
      const plain = 'RC4 Plaintext Stream';
      const enc = await Chef.bake(plain, [{ op: 'RC4', args: { key: 'MyKey', format: 'Hex' } }]);
      expect(enc.toString()).toMatch(/^[0-9a-fA-F]+$/);
    });

    it('runs XOR Brute Force to recover hidden text', async () => {
      // XOR "Hello Secret" with key 0x42
      const key = 0x42;
      const plain = 'Hello Secret';
      const xorBytes = Array.from(new TextEncoder().encode(plain)).map(b => (b ^ key).toString(16).padStart(2, '0')).join(' ');

      const res = await Chef.bake(xorBytes, [{ op: 'XOR Brute Force', args: { threshold: 60 } }]);
      expect(res.toString()).toContain('0x42');
      expect(res.toString()).toContain('Hello Secret');
    });
  });

  describe('Data Format Extensions (Base32, Base58, Base85, Hexdump)', () => {
    it('executes Base32 encode and decode', async () => {
      const original = 'Hello World';
      const enc = await Chef.bake(original, [{ op: 'To Base32', args: { pad: 'Yes' } }]);
      expect(enc.toString()).toBe('JBSWY3DPEBLW64TMMQ======');

      const dec = await Chef.bake(enc.toString(), [{ op: 'From Base32', args: {} }]);
      expect(dec.toString()).toBe(original);
    });

    it('executes Base58 encode and decode', async () => {
      const original = 'Hello World';
      const enc = await Chef.bake(original, [{ op: 'To Base58', args: {} }]);
      expect(enc.toString()).toBe('JxF12TrwUP45BMd');

      const dec = await Chef.bake(enc.toString(), [{ op: 'From Base58', args: {} }]);
      expect(dec.toString()).toBe(original);
    });

    it('executes Base85 encode and decode', async () => {
      const original = 'Hello World';
      const enc = await Chef.bake(original, [{ op: 'To Base85', args: {} }]);
      expect(enc.toString()).toContain('<~');

      const dec = await Chef.bake(enc.toString(), [{ op: 'From Base85', args: {} }]);
      expect(dec.toString()).toBe(original);
    });

    it('executes To Hexdump and From Hexdump', async () => {
      const original = 'Test Hexdump String';
      const hexdump = await Chef.bake(original, [{ op: 'To Hexdump', args: { width: 16 } }]);
      expect(hexdump.toString()).toContain('00000000');

      const parsed = await Chef.bake(hexdump.toString(), [{ op: 'From Hexdump', args: {} }]);
      expect(parsed.toString()).toBe(original);
    });
  });

  describe('Compression Extensions (Zip & Unzip, Raw Deflate)', () => {
    it('creates and extracts Zip archives via JSZip', async () => {
      const content = 'Data inside compressed PKZip archive';
      const zipDish = await Chef.bake(content, [{ op: 'Zip', args: { filename: 'test.txt' } }]);
      expect(zipDish.type).toBe('ArrayBuffer');
      expect(new Uint8Array(zipDish.value)[0]).toBe(0x50); // 'P'
      expect(new Uint8Array(zipDish.value)[1]).toBe(0x4b); // 'K'

      const unzipped = await Chef.bake(zipDish, [{ op: 'Unzip', args: {} }]);
      expect(unzipped.toString()).toContain('File: test.txt');
      expect(unzipped.toString()).toContain(content);
    });

    it('executes Raw Deflate and Raw Inflate', async () => {
      const original = 'RFC 1951 Raw Deflate and Inflate Stream';
      const deflated = await Chef.bake(original, [{ op: 'Raw Deflate', args: {} }]);
      expect(deflated.type).toBe('ArrayBuffer');

      const inflated = await Chef.bake(deflated, [{ op: 'Raw Inflate', args: {} }]);
      expect(inflated.toString()).toBe(original);
    });
  });

  describe('Breakpoints & Step-Through Execution', () => {
    it('pauses execution when a breakpoint is encountered', async () => {
      const recipe = [
        { op: 'To Base64', args: {}, breakpoint: false },
        { op: 'To Hex', args: {}, breakpoint: true }, // breakpoint here
        { op: 'To Base64', args: {}, breakpoint: false }
      ];
      const chef = new Chef();
      const res = await chef.bake('Debug Payload', recipe);

      expect(res.paused).toBe(true);
      expect(res.pausedStepIndex).toBe(1);
      expect(res.pausedStepOp).toBe('To Hex');
      // res output should be the state before step 1 ran (i.e. output of To Base64)
      expect(res.toString()).toBe(btoa('Debug Payload'));
    });
  });
});
