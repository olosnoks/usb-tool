import { describe, it, expect } from 'vitest';
import { thresholdState, channelRates, countAlerts } from '../src/utils/telemetryModel.js';

describe('thresholdState', () => {
  it('is ok with no limits', () => expect(thresholdState(5, {})).toBe('ok'));
  it('warns and alarms on high/low limits, alarm wins', () => {
    const cfg = { warnHigh: 50, alarmHigh: 80, warnLow: 10, alarmLow: 0 };
    expect(thresholdState(30, cfg)).toBe('ok');
    expect(thresholdState(50, cfg)).toBe('warn');
    expect(thresholdState(85, cfg)).toBe('alarm');
    expect(thresholdState(5, cfg)).toBe('warn');
    expect(thresholdState(-1, cfg)).toBe('alarm');
  });
  it('ignores non-numeric limits and values', () => {
    expect(thresholdState(9, { warnHigh: undefined, alarmHigh: NaN })).toBe('ok');
    expect(thresholdState(NaN, { warnHigh: 1 })).toBe('ok');
  });
});

describe('channelRates', () => {
  const s = (t, ...ks) => ({ t, pairs: ks.map((k) => [k, 1]) });
  it('computes Hz from timestamps in the window', () => {
    const log = [s(1000, 'a'), s(1500, 'a', 'b'), s(2000, 'a')];
    const r = channelRates(log, 2000);
    expect(r.a).toBeCloseTo(2);
    expect(r.b).toBeUndefined();
  });
  it('drops samples older than the window', () => {
    expect(channelRates([s(0, 'a'), s(100, 'a')], 20000, 5000)).toEqual({});
  });
});

describe('countAlerts', () => {
  it('counts channels per state', () => {
    const ch = { a: { value: 90 }, b: { value: 60 }, c: { value: 1 } };
    const cfg = { a: { alarmHigh: 80 }, b: { warnHigh: 50 } };
    expect(countAlerts(ch, cfg)).toEqual({ warn: 1, alarm: 1 });
  });
});
