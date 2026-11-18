import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  CRC_CATALOGUE,
  findCrcModel,
  crcOf,
  normalizeModel,
  parseRevengModel,
  revengString,
  verifyFrames,
  appendCrc,
  parseHexLines,
  crcToBytes,
  generateCode,
} from '../src/utils/crcReverse.js';

const CHECK = new TextEncoder().encode('123456789');
const NAMES = ['CRC-16/MODBUS', 'CRC-32/ISO-HDLC', 'CRC-8/SMBUS', 'CRC-16/XMODEM', 'CRC-64/XZ', 'CRC-5/USB', 'CRC-32/MPEG-2'];

describe('parseRevengModel', () => {
  it('round-trips revengString', () => {
    const e = findCrcModel('CRC-16/MODBUS');
    const m = parseRevengModel(revengString(e, e.name));
    expect(crcOf(CHECK, m)).toBe(crcOf(CHECK, e));
    expect(m.width).toBe(16);
    expect(m.refin).toBe(true);
  });
  it('defaults and errors', () => {
    expect(parseRevengModel('width=8 poly=0x07').init).toBe(0n);
    expect(() => parseRevengModel('poly=0x07')).toThrow(/width/);
    expect(() => parseRevengModel('width=8')).toThrow(/poly/);
    expect(() => parseRevengModel('width=8 poly=0x107')).toThrow(/fit/);
    expect(() => parseRevengModel('width=8 poly=0x07 refin=maybe')).toThrow(/boolean/);
  });
  it('normalizeModel validates', () => {
    expect(() => normalizeModel({ width: 70, poly: '0x1' })).toThrow();
    expect(() => normalizeModel({ width: 8, poly: '0' })).toThrow(/zero/);
    expect(normalizeModel({ width: '16', poly: '4129', init: '0xffff' }).poly).toBe(0x1021n);
  });
});

describe('verifyFrames / appendCrc', () => {
  const model = normalizeModel(findCrcModel('CRC-16/MODBUS'));
  it('appends little-endian and verifies', () => {
    const [r] = appendCrc(model, [Uint8Array.from([1, 3, 0, 0, 0, 2])], 'le');
    expect(r.frame).toBe('01 03 00 00 00 02 c4 0b');
    const frames = parseHexLines(r.frame + '\n01 03 00 00 00 02 c4 0c');
    const v = verifyFrames(model, frames, 'le');
    expect(v.map((x) => x.ok)).toEqual([true, false]);
    expect(v[1].computed).toBe('0x0bc4');
  });
  it('big-endian order differs and short frames are flagged', () => {
    expect(Array.from(crcToBytes(0x1234, model, 'be'))).toEqual([0x12, 0x34]);
    expect(verifyFrames(model, [Uint8Array.from([1])])[0].error).toMatch(/shorter/);
  });
  it('parseHexLines reports line numbers', () => {
    expect(() => parseHexLines('01 02\nzz')).toThrow(/Line 2/);
    expect(() => parseHexLines('abc')).toThrow(/odd/);
  });
});

describe('generateCode', () => {
  for (const n of NAMES) {
    it(`JS output matches the engine for ${n}`, () => {
      const e = findCrcModel(n);
      const code = generateCode(e, 'js');
      const fn = new Function(`${code}; return crc${e.width};`)();
      const data = Uint8Array.from([0, 1, 2, 250, 77, 13]);
      expect(fn(CHECK)).toBe(crcOf(CHECK, e));
      expect(fn(data)).toBe(crcOf(data, e));
    });
  }
  it('C and Python text contain the parameters', () => {
    const e = findCrcModel('CRC-32/ISO-HDLC');
    expect(generateCode(e, 'c')).toContain('uint32_t crc32(');
    expect(generateCode(e, 'c')).toContain('0x04c11db7u');
    expect(generateCode(e, 'python')).toContain('def crc32(');
    expect(() => generateCode(e, 'cobol')).toThrow();
  });
  it('Python output matches the engine when python is installed', () => {
    const py = spawnSync('python', ['--version']);
    if (py.error || py.status !== 0) return;
    for (const n of NAMES) {
      const e = findCrcModel(n);
      const script = `${generateCode(e, 'python')}\nprint(hex(crc${e.width}(b"123456789")))`;
      const r = spawnSync('python', ['-c', script], { encoding: 'utf8' });
      expect(r.stdout.trim()).toBe(`0x${crcOf(CHECK, e).toString(16)}`);
    }
  });
  it('catalogue has entries used above', () => {
    expect(CRC_CATALOGUE.length).toBeGreaterThan(50);
  });
});
