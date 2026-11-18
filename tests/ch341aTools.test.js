import { describe, it, expect } from 'vitest';
import { parseNumber, parseRange, blankCheck, crc32, crc32Hex, sha256Hex, flashromCommand } from '../src/utils/ch341aTools';

describe('ch341aTools', () => {
  it('parses decimal and hex numbers', () => {
    expect(parseNumber('4096')).toBe(4096);
    expect(parseNumber('0x1000')).toBe(4096);
    expect(parseNumber('0X1_000')).toBe(4096);
    expect(parseNumber('')).toBeNaN();
    expect(parseNumber('12abc')).toBeNaN();
  });

  it('validates ranges against the chip size', () => {
    expect(parseRange('0', '0x100', 1024)).toEqual({ ok: true, start: 0, length: 256 });
    expect(parseRange('1000', '100', 1024).ok).toBe(false);
    expect(parseRange('2000', '1', 1024).ok).toBe(false);
    expect(parseRange('x', '1', 1024).ok).toBe(false);
    expect(parseRange('0', '0', 1024).ok).toBe(false);
    expect(parseRange('0', '99999', 0).ok).toBe(true);
  });

  it('blank checks a buffer', () => {
    expect(blankCheck(new Uint8Array(8).fill(0xff))).toMatchObject({ blank: true, firstNonBlank: -1 });
    const d = new Uint8Array(8).fill(0xff);
    d[5] = 0; d[7] = 1;
    expect(blankCheck(d)).toMatchObject({ blank: false, nonBlankBytes: 2, firstNonBlank: 5 });
  });

  it('computes CRC-32 and SHA-256 with known vectors', async () => {
    const msg = new TextEncoder().encode('123456789');
    expect(crc32(msg)).toBe(0xcbf43926);
    expect(crc32Hex(new Uint8Array(0))).toBe('00000000');
    expect(await sha256Hex(msg)).toBe('15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225');
  });

  it('builds flashrom commands and quotes odd file names', () => {
    expect(flashromCommand({ action: 'read', file: 'bios.bin', chip: 'W25Q128.V' })).toBe('flashrom -p ch341a_spi -c W25Q128.V -r bios.bin');
    expect(flashromCommand({ action: 'write', file: 'my bios.bin' })).toBe('flashrom -p ch341a_spi -w "my bios.bin"');
  });
});
