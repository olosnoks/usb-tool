import { describe, it, expect } from 'vitest';
import { estimateFrameBits, computeBusLoad, snapshotBaseline, diffAgainstBaseline, formatTraceLine, toAscLog } from '../src/utils/canBusDriver';

const fr = (o) => ({ id: 0x123, isExtended: false, rtr: false, fd: false, data: Uint8Array.from([1, 2, 3]), t: 1000, ...o });

describe('estimateFrameBits', () => {
  it('counts standard, extended and remote frames', () => {
    expect(estimateFrameBits(fr({ data: new Uint8Array(8) }))).toBe(47 + 64 + 3);
    expect(estimateFrameBits(fr({ isExtended: true, data: new Uint8Array(0) }))).toBe(70);
    expect(estimateFrameBits(fr({ rtr: true, dlc: 8, data: new Uint8Array(0) }))).toBe(50);
  });
  it('returns null for FD', () => expect(estimateFrameBits(fr({ fd: true }))).toBeNull());
});

describe('computeBusLoad', () => {
  it('computes percentage and clamps', () => {
    expect(computeBusLoad(250000, 500000, 1000)).toBeCloseTo(50);
    expect(computeBusLoad(9e9, 500000, 1000)).toBe(100);
    expect(computeBusLoad(10, 0, 1000)).toBe(0);
  });
});

describe('baseline diff', () => {
  const base = snapshotBaseline({ 291: { data: Uint8Array.from([1, 2, 3]) } });
  it('flags changed bytes, new IDs and length changes', () => {
    expect(diffAgainstBaseline(null, '291', [1])).toBeNull();
    expect(diffAgainstBaseline(base, '291', [1, 9, 3]).bytes).toEqual(new Set([1]));
    expect(diffAgainstBaseline(base, '291', [1, 2, 3]).bytes.size).toBe(0);
    expect(diffAgainstBaseline(base, '291', [1, 2]).bytes).toEqual(new Set([2]));
    expect(diffAgainstBaseline(base, '999', [1]).isNew).toBe(true);
  });
});

describe('formatTraceLine / toAscLog', () => {
  it('formats a trace line', () => {
    expect(formatTraceLine(fr({ t: 3500 }), 1000)).toBe('     2.500  RX  123  [3]  01 02 03');
    expect(formatTraceLine(fr({ tx: true, rtr: true, dlc: 2, data: new Uint8Array(0) }), 1000)).toContain('TX  123  [2] remote');
  });
  it('writes Vector ASC and skips FD', () => {
    const { text, skipped } = toAscLog([fr({ t: 5000 }), fr({ t: 5100, id: 0x18daf110, isExtended: true, tx: true }), fr({ fd: true }), fr({ t: 5200, rtr: true, dlc: 4, data: new Uint8Array(0) })], { date: new Date(0) });
    expect(skipped).toBe(1);
    const lines = text.trim().split('\n');
    expect(lines[0]).toMatch(/^date /);
    expect(lines[4]).toMatch(/^\s+0\.000000 1  123\s+Rx   d 3 01 02 03$/);
    expect(lines[5]).toMatch(/18DAF110x\s+Tx   d 3/);
    expect(lines[6]).toMatch(/Rx   r 4$/);
  });
});
