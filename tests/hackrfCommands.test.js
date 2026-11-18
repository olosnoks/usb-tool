import { describe, it, expect } from 'vitest';
import { buildTransferCommand, buildSweepCommand, captureBytes, filterFreqList, sortFreqList, snapLna, snapVga } from '../src/utils/hackrfCommands.js';

describe('hackrf command builders', () => {
  it('builds a hackrf_transfer receive command', () => {
    expect(buildTransferCommand({ freqHz: 433920000, sampleRate: 2e6, lna: 32, vga: 20, amp: false, seconds: 5, file: 'fob.cs8' }))
      .toBe('hackrf_transfer -r fob.cs8 -f 433920000 -s 2000000 -l 32 -g 20 -a 0 -n 10000000');
  });
  it('snaps gains and clamps rate and frequency', () => {
    expect(snapLna(13)).toBe(16);
    expect(snapLna(99)).toBe(40);
    expect(snapVga(31)).toBe(32);
    const c = buildTransferCommand({ freqHz: 9e9, sampleRate: 50e6, seconds: 0, amp: true });
    expect(c).toContain('-f 6000000000');
    expect(c).toContain('-s 20000000');
    expect(c).toContain('-a 1');
    expect(c).not.toContain('-n');
  });
  it('sanitises the file name', () => {
    expect(buildTransferCommand({ file: 'a b;rm -rf.cs8' })).toContain('-r a_b_rm_-rf.cs8');
  });
  it('builds hackrf_sweep', () => {
    expect(buildSweepCommand({ startMHz: 88, stopMHz: 108, binWidthHz: 100000, once: true }))
      .toBe('hackrf_sweep -f 88:108 -w 100000 -l 16 -g 20 -a 0 -1');
    expect(buildSweepCommand({ startMHz: 100, stopMHz: 100 })).toContain('-f 100:101');
  });
  it('estimates capture size', () => { expect(captureBytes(10e6, 2)).toBe(40e6); });
});

describe('freqman filter and sort', () => {
  const list = [
    { freq: 433920000, mod: 'NFM', label: 'ISM keyfob', category: 'ISM' },
    { freq: 121500000, mod: 'AM', label: 'Air Guard', category: 'Aviation' }
  ];
  it('filters by text, category, modulation and MHz prefix', () => {
    expect(filterFreqList(list, 'guard')).toHaveLength(1);
    expect(filterFreqList(list, 'aviation')).toHaveLength(1);
    expect(filterFreqList(list, 'nfm')).toHaveLength(1);
    expect(filterFreqList(list, '433')).toHaveLength(1);
    expect(filterFreqList(list, '')).toHaveLength(2);
  });
  it('sorts a copy', () => {
    expect(sortFreqList(list, 'freq')[0].freq).toBe(121500000);
    expect(sortFreqList(list, 'name')[0].label).toBe('Air Guard');
    expect(list[0].freq).toBe(433920000);
  });
});
