import { describe, it, expect } from 'vitest';
import { compareHash, parseSearchPattern, indexOfBytes, searchSectors, fileListingCsv, hexDumpText } from '../src/utils/massStorageTools';

const H = { md5: 'a'.repeat(32), sha1: 'b'.repeat(40), sha256: 'c'.repeat(64) };

describe('compareHash', () => {
  it('detects algorithm by length and matches case-insensitively', () => {
    expect(compareHash('A'.repeat(32), H)).toMatchObject({ state: 'match', algo: 'md5' });
    expect(compareHash(`sha256: ${'C'.repeat(64)} *disk.img`, H)).toMatchObject({ state: 'match', algo: 'sha256' });
    expect(compareHash('b'.repeat(40), H).algo).toBe('sha1');
  });
  it('reports mismatch, invalid and empty', () => {
    expect(compareHash('d'.repeat(64), H).state).toBe('mismatch');
    expect(compareHash('xyz', H).state).toBe('invalid');
    expect(compareHash('abc', H).state).toBe('invalid');
    expect(compareHash('  ', H).state).toBe('empty');
  });
});

describe('parseSearchPattern', () => {
  it('parses hex in several styles', () => {
    expect([...parseSearchPattern('55 AA', 'hex')]).toEqual([0x55, 0xaa]);
    expect([...parseSearchPattern('0x55,0xaa', 'hex')]).toEqual([0x55, 0xaa]);
    expect([...parseSearchPattern('55aa', 'hex')]).toEqual([0x55, 0xaa]);
  });
  it('rejects bad hex and empty input', () => {
    expect(() => parseSearchPattern('5', 'hex')).toThrow(/even/);
    expect(() => parseSearchPattern('zz', 'hex')).toThrow(/0-9/);
    expect(() => parseSearchPattern('', 'text')).toThrow();
  });
  it('encodes text', () => {
    expect([...parseSearchPattern('FAT', 'text')]).toEqual([0x46, 0x41, 0x54]);
  });
});

describe('searchSectors', () => {
  const bs = 16;
  const disk = new Uint8Array(bs * 10);
  const put = (at, s) => { for (let i = 0; i < s.length; i++) disk[at + i] = s.charCodeAt(i); };
  const readSectors = async (s, n) => disk.slice(s * bs, (s + n) * bs);
  it('finds a match and reports lba and offset', async () => {
    put(5 * bs + 3, 'NEEDLE');
    const r = await searchSectors({ readSectors, startLba: 0, sectors: 10, blockSize: bs, pattern: parseSearchPattern('NEEDLE', 'text'), chunkSectors: 2 });
    expect(r.hit).toEqual({ lba: 5, offset: 3, byteOffset: 83 });
  });
  it('finds a match straddling a chunk boundary', async () => {
    disk.fill(0); put(4 * bs - 3, 'SPLIT!');
    const r = await searchSectors({ readSectors, startLba: 0, sectors: 10, blockSize: bs, pattern: parseSearchPattern('SPLIT!', 'text'), chunkSectors: 4 });
    expect(r.hit).toMatchObject({ lba: 3, offset: 13 });
  });
  it('returns null when absent and honours start and cancel', async () => {
    disk.fill(0); put(2 * bs, 'ABC');
    expect((await searchSectors({ readSectors, startLba: 3, sectors: 7, blockSize: bs, pattern: parseSearchPattern('ABC', 'text') })).hit).toBeNull();
    const c = await searchSectors({ readSectors, startLba: 0, sectors: 10, blockSize: bs, pattern: parseSearchPattern('ABC', 'text'), shouldCancel: () => true });
    expect(c.cancelled).toBe(true);
  });
});

describe('indexOfBytes', () => {
  it('works with from offset', () => {
    expect(indexOfBytes(Uint8Array.of(1, 2, 1, 2), Uint8Array.of(1, 2), 1)).toBe(2);
    expect(indexOfBytes(Uint8Array.of(1), Uint8Array.of(), 0)).toBe(-1);
  });
});

describe('fileListingCsv', () => {
  it('escapes cells and marks deleted entries', () => {
    const csv = fileListingCsv([
      { name: 'a,"b".txt', size: 5, isDir: false, modified: new Date('2024-01-02T03:04:05Z'), readOnly: true, deleted: true },
      { name: 'DIR', isDir: true, size: 0, hidden: true }
    ], '/x');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('path,name,type,size,modified_utc,attributes,deleted');
    expect(lines[1]).toBe('/x,"a,""b"".txt",file,5,2024-01-02 03:04:05,R,yes');
    expect(lines[2]).toBe('/x,DIR,dir,,,H,no');
  });
});

describe('hexDumpText', () => {
  it('formats offset, hex and ascii', () => {
    const t = hexDumpText(Uint8Array.from([0x41, 0x42, 0x00]), 0x200);
    expect(t.startsWith('00000200  41 42 00')).toBe(true);
    expect(t.trim().endsWith('AB.')).toBe(true);
  });
});
