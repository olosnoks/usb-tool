import { describe, it, expect } from 'vitest';
import {
  SampleRing,
  SAMPLE_RATE_HZ,
  activityStats,
  batteryLifeHours,
  formatLife,
  scaleCurrent,
  statsSummary,
  rangeStats,
} from '../src/utils/ppk2';

function ringOf(values) {
  const r = new SampleRing(values.length);
  r.push(Float32Array.from(values), new Uint8Array(values.length));
  return r;
}

describe('activityStats', () => {
  it('returns nulls for an empty range', () => {
    const r = ringOf([1, 2]);
    const a = activityStats(r, 1, 1, 5);
    expect(a.samples).toBe(0);
    expect(a.stdUa).toBeNull();
  });
  it('computes std dev and peak-to-peak', () => {
    const a = activityStats(ringOf([2, 4, 4, 4, 5, 5, 7, 9]), 0, 8);
    expect(a.stdUa).toBeCloseTo(2, 5);
    expect(a.p2pUa).toBe(7);
    expect(a.activeFraction).toBeNull();
  });
  it('counts bursts above the threshold', () => {
    const a = activityStats(ringOf([1, 1, 100, 100, 1, 200, 1, 1]), 0, 8, 50);
    expect(a.bursts).toBe(2);
    expect(a.activeFraction).toBeCloseTo(3 / 8, 6);
    expect(a.activeAvgUa).toBeCloseTo(400 / 3, 4);
    expect(a.idleAvgUa).toBeCloseTo(1, 6);
    expect(a.activeS).toBeCloseTo(3 / SAMPLE_RATE_HZ, 9);
  });
  it('handles a ring that has wrapped', () => {
    const r = new SampleRing(4);
    r.push(Float32Array.from([1, 1, 1, 1, 100, 100]), new Uint8Array(6));
    const a = activityStats(r, r.oldest, r.total, 50);
    expect(a.samples).toBe(4);
    expect(a.bursts).toBe(1);
  });
});

describe('batteryLifeHours', () => {
  it('divides capacity by average current', () => {
    expect(batteryLifeHours(220, 10)).toBeCloseTo(22000, 6); // 220 mAh / 0.01 mA
  });
  it('applies the margin', () => {
    expect(batteryLifeHours(100, 1000, 20)).toBeCloseTo(80, 6);
  });
  it('rejects bad input', () => {
    expect(batteryLifeHours(0, 10)).toBeNull();
    expect(batteryLifeHours(100, 0)).toBeNull();
    expect(batteryLifeHours(100, null)).toBeNull();
    expect(batteryLifeHours('abc', 5)).toBeNull();
  });
  it('clamps the margin to 90 percent', () => {
    expect(batteryLifeHours(100, 1000, 500)).toBeCloseTo(10, 6);
  });
});

describe('formatLife', () => {
  it('picks units', () => {
    expect(formatLife(0.5)).toBe('30.0 min');
    expect(formatLife(10)).toBe('10.0 h');
    expect(formatLife(72)).toBe('3.0 days');
    expect(formatLife(24 * 730)).toContain('years');
    expect(formatLife(null)).toBe('—');
  });
});

describe('scaleCurrent', () => {
  it('is linear by default', () => {
    expect(scaleCurrent(50, 100)).toBe(0.5);
    expect(scaleCurrent(500, 100)).toBe(1);
  });
  it('is logarithmic on request', () => {
    expect(scaleCurrent(0.1, 1000, true)).toBeCloseTo(0, 6);
    expect(scaleCurrent(1000, 1000, true)).toBeCloseTo(1, 6);
    expect(scaleCurrent(10, 1000, true)).toBeCloseTo(0.5, 6);
    expect(scaleCurrent(0, 1000, true)).toBe(0);
  });
});

describe('statsSummary', () => {
  it('reports no samples', () => {
    expect(statsSummary('X', rangeStats(null, 0, 0), 3.3)).toBe('X: no samples');
  });
  it('includes charge and energy', () => {
    const r = ringOf(new Array(100000).fill(10));
    const st = rangeStats(r, 0, 100000, 3);
    const txt = statsSummary('Cap', st, 3, activityStats(r, 0, 100000));
    expect(txt).toContain('avg 10.000 uA');
    expect(txt).toContain('charge 10.000 uC');
    expect(txt).toContain('energy 30.000 uJ at 3.000 V');
    expect(txt).toContain('std 0.000 uA');
  });
});
