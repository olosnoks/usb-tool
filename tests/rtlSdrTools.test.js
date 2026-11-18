import { describe, it, expect } from 'vitest';
import {
  clampFreqHz, stepFreqHz, fracToHz, updatePeakHold, updateAverage, findPeak, findPeaks,
  toRtlPowerCsv, spectrumFileName, normalizeBookmarks, addBookmark, removeBookmark, BAND_PRESETS,
  MIN_FREQ_HZ, MAX_FREQ_HZ,
} from '../src/utils/rtlSdrTools.js';

describe('rtlSdrTools', () => {
  it('clamps and steps frequencies', () => {
    expect(clampFreqHz(1)).toBe(MIN_FREQ_HZ);
    expect(clampFreqHz(5e9)).toBe(MAX_FREQ_HZ);
    expect(clampFreqHz(NaN)).toBeNull();
    expect(stepFreqHz(100e6, 25e3, 1)).toBe(100025000);
    expect(stepFreqHz(100e6, 25e3, -1)).toBe(99975000);
  });
  it('maps a position to frequency', () => {
    expect(fracToHz(0.5, 100e6, 2e6)).toBe(100e6);
    expect(fracToHz(0, 100e6, 2e6)).toBe(99e6);
    expect(fracToHz(2, 100e6, 2e6)).toBe(101e6);
  });
  it('holds peaks and averages', () => {
    let hold = updatePeakHold(null, [1, 5, 2]);
    hold = updatePeakHold(hold, [3, 4, 1]);
    expect(Array.from(hold)).toEqual([3, 5, 2]);
    let avg = updateAverage(null, [0, 10]);
    avg = updateAverage(avg, [10, 10], 0.5);
    expect(Array.from(avg)).toEqual([5, 10]);
  });
  it('finds peaks', () => {
    const spec = new Float32Array(100).fill(-90);
    spec[20] = -30; spec[21] = -40; spec[70] = -50; spec[72] = -45;
    const p = findPeak(spec, 100e6, 1e6);
    expect(p.index).toBe(20);
    expect(p.hz).toBeCloseTo(100e6 - 0.5e6 + 20.5e4, 0);
    const ps = findPeaks(spec, 100e6, 1e6, { count: 3, minDb: -60, minSepBins: 5 });
    expect(ps.map((x) => x.index)).toEqual([20, 72]);
    expect(findPeak([], 1, 1)).toBeNull();
  });
  it('writes an rtl_power style row', () => {
    const row = toRtlPowerCsv([-10, -20.123], 100e6, 2e6, new Date(2024, 0, 2, 3, 4, 5));
    expect(row).toBe('2024-01-02, 03:04:05, 99000000, 101000000, 1000000.00, 1, -10.00, -20.12\n');
    expect(spectrumFileName(98e6, new Date(0))).toBe('rtlsdr_98000kHz_1970-01-01T00-00-00.csv');
  });
  it('manages bookmarks', () => {
    expect(normalizeBookmarks([{ hz: 1, name: 'x' }, { hz: 98e6, mode: 'bad' }])).toEqual([
      { name: '98.000 MHz', hz: 98000000, mode: 'WFM' },
    ]);
    let list = addBookmark([], { name: 'b', hz: 200e6, mode: 'AM' });
    list = addBookmark(list, { name: 'a', hz: 100e6, mode: 'NFM' });
    list = addBookmark(list, { name: 'a2', hz: 100e6, mode: 'NFM' });
    expect(list.map((b) => b.name)).toEqual(['a2', 'b']);
    expect(removeBookmark(list, 200e6, 'AM')).toHaveLength(1);
  });
  it('presets are in range', () => {
    for (const p of BAND_PRESETS) expect(clampFreqHz(p.hz)).toBe(p.hz);
  });
});
