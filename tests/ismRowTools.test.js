import { describe, it, expect } from 'vitest';
import { flexSpec, segmentsToCsv, groupRows, rowDiff, checksumHints, cursorMeasure, bitsToBinary } from '../src/utils/ismDecoder/rowTools.js';
import { crc8 } from '../src/utils/ismDecoder/devices.js';

const bitsOf = (bytes) => Uint8Array.from(bytes.flatMap((b) => Array.from({ length: 8 }, (_, i) => (b >> (7 - i)) & 1)));

describe('ism rowTools', () => {
  it('builds a PWM flex spec', () => {
    const g = { modulation: 'pwm', shortUs: 232.4, longUs: 420.6, resetUs: 3000 };
    const s = flexSpec(g, [{ gapUs: 300 }, { gapUs: 9000 }]);
    expect(s).toContain('m=OOK_PWM');
    expect(s).toContain('s=232');
    expect(s).toContain('l=421');
    expect(s).toContain('r=3000');
    expect(s).toContain('g=360');
  });
  it('returns null for unknown modulation', () => {
    expect(flexSpec({ modulation: 'unknown' })).toBeNull();
    expect(flexSpec(null)).toBeNull();
  });
  it('writes CSV', () => {
    const csv = segmentsToCsv([{ startUs: 10.4, markUs: 500.04, gapUs: 250 }]);
    expect(csv).toBe('index,start_us,mark_us,gap_us\n0,10,500,250');
  });
  it('groups identical rows and diffs them', () => {
    const a = bitsOf([0xaa, 0x01]);
    const b = bitsOf([0xaa, 0x03]);
    const rows = [{ bits: a, startUs: 1 }, { bits: a, startUs: 2 }, { bits: b, startUs: 3 }];
    const g = groupRows(rows);
    expect(g.map((x) => x.count)).toEqual([2, 1]);
    const d = rowDiff(rows);
    expect(d.mask).toBe('10101010' + '000000x1');
    expect(d.varying).toBe(1);
    expect(rowDiff([rows[0]])).toBeNull();
    expect(bitsToBinary(a).length).toBe(16);
  });
  it('finds checksums', () => {
    const body = [0x12, 0x34, 0x56];
    const sum = body.reduce((s, x) => s + x, 0) & 0xff;
    expect(checksumHints(bitsOf([...body, sum]))).toContain('sum8 over bytes 0..n-2');
    const c = crc8(Uint8Array.from(body), 3, 0x31, 0);
    expect(checksumHints(bitsOf([...body, c])).some((h) => h.startsWith('crc8 poly 0x31 init 0x00'))).toBe(true);
    expect(checksumHints(bitsOf([1, 2]))).toEqual([]);
  });
  it('measures cursors', () => {
    const m = cursorMeasure(0, 250, 250000);
    expect(m.us).toBeCloseTo(1000);
    expect(m.hz).toBeCloseTo(1000);
    expect(cursorMeasure(5, 5, 1000).hz).toBeNull();
  });
});
