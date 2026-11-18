import { describe, it, expect } from 'vitest';
import { parseOffset, parseSize, rangeWarnings, esptoolReadCommand, md5Hex, sha256Hex, hexRows, extractStrings } from '../src/utils/espDumpTools';

const enc = (s) => new TextEncoder().encode(s);

describe('espDumpTools', () => {
  it('parses offsets and sizes', () => {
    expect(parseOffset('0x9000')).toBe(0x9000);
    expect(parseOffset('9000h')).toBe(0x9000);
    expect(parseOffset('123')).toBe(123);
    expect(parseOffset('zz')).toBeNaN();
    expect(parseSize('20K')).toBe(20480);
    expect(parseSize('4MB')).toBe(4194304);
    expect(parseSize('0x5000')).toBe(20480);
    expect(parseSize('')).toBeNaN();
  });
  it('warns on range issues', () => {
    expect(rangeWarnings(0x9000, 4096, 4194304)).toEqual([]);
    expect(rangeWarnings(0x9001, 6, 0)).toHaveLength(2);
    expect(rangeWarnings(0x3ff000, 8192, 4194304)).toHaveLength(1);
  });
  it('builds an esptool command', () => {
    expect(esptoolReadCommand({ offset: 0x9000, length: 0x5000, baud: 460800, port: 'COM3' }))
      .toBe('esptool.py --chip auto --port COM3 --baud 460800 read_flash 0x9000 0x5000 dump_0x9000_20480.bin');
  });
  it('computes MD5 test vectors', () => {
    expect(md5Hex(new Uint8Array(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5Hex(enc('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5Hex(enc('12345678901234567890123456789012345678901234567890123456789012345678901234567890')))
      .toBe('57edf4a22be3c955ac49da2e2107b67a');
  });
  it('computes SHA-256', async () => {
    expect(await sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('makes hex rows and strings', () => {
    const b = Uint8Array.from([0x41, 0x42, 0, 0x7f, ...enc('hello world'), 0, 0x61]);
    const rows = hexRows(b, 0x1000, 0, 32);
    expect(rows[0].offset).toBe(0x1000);
    expect(rows[0].ascii.startsWith('AB..hello')).toBe(true);
    expect(extractStrings(b, 0x1000, 6)).toEqual([{ offset: 0x1004, text: 'hello world' }]);
  });
});
