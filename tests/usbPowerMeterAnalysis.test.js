import { describe, it, expect } from 'vitest';
import {
  parseLimit, tripped, createAlarmState, updateAlarmState,
  createAverager, addAverage, averages, batteryRuntimeHours, formatDuration, loadResistance,
} from '../src/utils/usbPowerMeter/analysis';

describe('alarm limits', () => {
  it('parses limits', () => {
    expect(parseLimit('')).toBeNull();
    expect(parseLimit('abc')).toBeNull();
    expect(parseLimit('-1')).toBeNull();
    expect(parseLimit(' 2.5 ')).toBe(2.5);
  });
  it('detects over and under', () => {
    const lim = { maxAmps: 1, minVolts: 4.5, maxWatts: null };
    expect(tripped({ amps: 1.2, volts: 5, watts: 99 }, lim)).toEqual(['maxAmps']);
    expect(tripped({ amps: 0.5, volts: 4.2, watts: 1 }, lim)).toEqual(['minVolts']);
    expect(tripped({ amps: 1, volts: 4.5 }, lim)).toEqual([]);
  });
  it('counts rising edges only', () => {
    const st = createAlarmState();
    const lim = { maxAmps: 1 };
    [0.5, 1.5, 1.6, 0.4, 2].forEach((a, i) => updateAlarmState(st, { tMs: i * 10, amps: a }, lim));
    expect(st.events.maxAmps).toBe(2);
    expect(st.total).toBe(2);
    expect(st.firstAtMs).toBe(10);
    expect(st.lastAtMs).toBe(40);
    expect(st.active).toEqual(['maxAmps']);
  });
});

describe('averager', () => {
  it('time-weights and skips gaps', () => {
    const a = createAverager();
    addAverage(a, { tMs: 0, volts: 5, amps: 1, watts: 5 });
    addAverage(a, { tMs: 1000, volts: 5, amps: 1, watts: 5 });
    addAverage(a, { tMs: 4000, volts: 5, amps: 2, watts: 10 });
    addAverage(a, { tMs: 60000, volts: 5, amps: 9, watts: 45 });
    const r = averages(a);
    expect(r.seconds).toBe(4);
    expect(r.amps).toBeCloseTo((1 + 3 * 1.5) / 4, 6);
    expect(r.peakW).toBe(45);
  });
  it('is empty-safe', () => {
    expect(averages(createAverager()).watts).toBeNull();
  });
});

describe('runtime and formatting', () => {
  it('estimates runtime', () => {
    expect(batteryRuntimeHours({ capacityWh: 10, loadWatts: 2 })).toBe(5);
    expect(batteryRuntimeHours({ capacityMah: 5000, nominalVolts: 3.7, loadWatts: 3.7, efficiency: 0.9 })).toBeCloseTo(4.5, 6);
    expect(batteryRuntimeHours({ capacityWh: 10, loadWatts: 0 })).toBeNull();
    expect(batteryRuntimeHours({ capacityWh: 10, loadWatts: 1, efficiency: 1.5 })).toBeNull();
  });
  it('formats duration', () => {
    expect(formatDuration(3725)).toBe('01:02:05');
    expect(formatDuration(NaN)).toBe('—');
  });
  it('computes resistance', () => {
    expect(loadResistance(5, 0.5)).toBe(10);
    expect(loadResistance(5, 0)).toBeNull();
  });
});
