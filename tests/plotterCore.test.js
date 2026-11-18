import { describe, it, expect } from 'vitest';
import {
  createPlotterEngine, createTrigger, detectEdge, decimateMinMax, channelStats, visibleRange,
  spectrum, dominantBin, estimateSampleRate, buildPlotCsv, parseColumns, applyChannelScale,
  serializePlotConfig, parsePlotConfig, movingAverage, estimateFrequency, measureCursors
} from '../src/utils/plotterCore.js';

const enc = (s) => new TextEncoder().encode(s);

describe('engine ingestion', () => {
  it('plots exactly 10 000 samples from 7-byte chunks', () => {
    const e = createPlotterEngine();
    const all = enc(Array.from({ length: 10000 }, (_, i) => `${i % 100},${(i * 3) % 50}`).join('\n') + '\n');
    for (let i = 0; i < all.length; i += 7) e.push(all.slice(i, i + 7));
    expect(e.points.length).toBe(10000);
    expect(e.points[1234].values).toEqual([1234 % 100, (1234 * 3) % 50]);
  });

  it('adds one sample for every repeated identical line', () => {
    const e = createPlotterEngine();
    e.push(enc('512\n'));
    e.push(enc('512\n'));
    e.push(enc('512\n512\n'));
    expect(e.points.length).toBe(4);
  });

  it('does not create bogus points from a line split across chunks', () => {
    const e = createPlotterEngine();
    e.push(enc('temp:2'));
    expect(e.points.length).toBe(0);
    e.push(enc('4.5 hum:60\n'));
    expect(e.points.length).toBe(1);
    expect(e.points[0].values).toEqual([24.5, 60]);
    expect(e.labels()).toEqual(['temp', 'hum']);
  });

  it('keeps named channels at stable indices when order changes', () => {
    const e = createPlotterEngine();
    e.push(enc('a:1 b:2\nb:5 a:4\n'));
    expect(e.points.map((p) => p.values)).toEqual([[1, 2], [4, 5]]);
  });

  it('stamps each line with the time of the chunk that carried its first byte', () => {
    const e = createPlotterEngine();
    e.push(enc('1\n2\n'), 100);
    e.push(enc('3\n'), 200);
    expect(e.points.map((p) => p.t)).toEqual([100, 100, 200]);
  });

  it('supports custom delimiter and column mapping', () => {
    const e = createPlotterEngine({ delimiter: '|', columns: parseColumns('1,3') });
    e.push(enc('x|1.5|y|2.5\n'));
    expect(e.points[0].values).toEqual([1.5, 2.5]);
  });

  it('parses scientific notation and hex', () => {
    const e = createPlotterEngine();
    e.push(enc('1e-3 0x10\n'));
    expect(e.points[0].values[0]).toBeCloseTo(0.001);
    expect(e.points[0].values[1]).toBe(16);
  });

  it('caps the buffer', () => {
    const e = createPlotterEngine({ cap: 100 });
    for (let i = 0; i < 5000; i++) e.push(enc(`${i}\n`));
    expect(e.points.length).toBeLessThan(100 + 2000 + 1);
    expect(e.points[e.points.length - 1].values[0]).toBe(4999);
  });
});

describe('trigger', () => {
  it('detects edges', () => {
    expect(detectEdge(0, 5, 3, 'rising')).toBe(true);
    expect(detectEdge(5, 0, 3, 'rising')).toBe(false);
    expect(detectEdge(5, 0, 3, 'falling')).toBe(true);
    expect(detectEdge(5, 0, 3, 'either')).toBe(true);
  });

  it('captures a pre-roll window around a synthetic edge and stays single-shot', () => {
    const e = createPlotterEngine();
    e.trigger.configure({ enabled: true, channel: 0, level: 50, edge: 'rising', pre: 5, post: 3, single: true });
    e.trigger.arm();
    const lines = [...Array(20).fill(0), ...Array(20).fill(100)].map((v) => `${v}\n`).join('');
    e.push(enc(lines));
    const cap = e.trigger.capture;
    expect(cap).not.toBeNull();
    expect(cap.points.length).toBe(5 + 1 + 3);
    expect(cap.triggerIndex).toBe(5);
    expect(cap.points.slice(0, 5).map((p) => p.values[0])).toEqual([0, 0, 0, 0, 0]);
    expect(cap.points[5].values[0]).toBe(100);
    expect(e.trigger.armed).toBe(false);
  });

  it('re-arms in normal mode and uses fewer pre samples when history is short', () => {
    const t = createTrigger();
    t.configure({ enabled: true, level: 1, pre: 10, post: 0, single: false });
    t.arm();
    const pts = [{ values: [0] }, { values: [2] }];
    t.feed(pts.slice(0, 1));
    t.feed(pts);
    expect(t.capture.points.length).toBe(2);
    expect(t.armed).toBe(true);
  });
});

describe('view, decimation, stats', () => {
  it('visibleRange handles zoom and pan', () => {
    expect(visibleRange(1000, 100, 1, 0)).toEqual({ start: 900, end: 1000 });
    expect(visibleRange(1000, 100, 2, 0)).toEqual({ start: 950, end: 1000 });
    expect(visibleRange(1000, 100, 1, 300)).toEqual({ start: 600, end: 700 });
    expect(visibleRange(1000, 100, 1, 5000)).toEqual({ start: 0, end: 100 });
    expect(visibleRange(10, 100, 1, 0)).toEqual({ start: 0, end: 10 });
    expect(visibleRange(0, 100)).toEqual({ start: 0, end: 0 });
  });

  it('min/max decimation keeps the extremes and bounds the output', () => {
    const v = Array.from({ length: 50000 }, (_, i) => Math.sin(i / 50));
    v[12345] = 9; v[40000] = -9;
    const d = decimateMinMax(v, 500);
    expect(d.length).toBeLessThanOrEqual(1000);
    expect(Math.max(...d.map((p) => p.v))).toBe(9);
    expect(Math.min(...d.map((p) => p.v))).toBe(-9);
    for (let i = 1; i < d.length; i++) expect(d[i].i).toBeGreaterThan(d[i - 1].i);
    expect(decimateMinMax([1, undefined, 3], 10)).toEqual([{ i: 0, v: 1 }, { i: 2, v: 3 }]);
  });

  it('computes min/max/mean/RMS', () => {
    const s = channelStats([3, 4, undefined, NaN]);
    expect(s).toMatchObject({ count: 2, min: 3, max: 4, mean: 3.5, last: 4 });
    expect(s.rms).toBeCloseTo(Math.sqrt((9 + 16) / 2));
    expect(channelStats([])).toBeNull();
    expect(applyChannelScale(2, { scale: 3, offset: 1 })).toBe(7);
    expect(applyChannelScale(2, {})).toBe(2);
  });
});

describe('spectrum', () => {
  it('puts a 50 Hz sine sampled at 1 kHz in the right bin', () => {
    const fs = 1000;
    const x = Array.from({ length: 1024 }, (_, i) => 2 * Math.sin((2 * Math.PI * 50 * i) / fs) + 7);
    const sp = spectrum(x, fs);
    const k = dominantBin(sp.mags);
    expect(Math.abs(sp.freqs[k] - 50)).toBeLessThanOrEqual(sp.binHz);
    expect(sp.mags[k]).toBeGreaterThan(1.5);
    expect(sp.mags[k]).toBeLessThan(2.2);
  });

  it('returns empty for too little data or unknown rate', () => {
    expect(spectrum([1, 2, 3], 1000).n).toBe(0);
    expect(spectrum(Array(64).fill(1), 0).n).toBe(0);
  });

  it('estimates the sample rate from timestamps', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ t: i * 10, values: [0] }));
    expect(estimateSampleRate(pts)).toBeCloseTo(100);
    expect(estimateSampleRate([{ t: 5 }, { t: 5 }])).toBeNull();
  });
});

describe('export and config', () => {
  it('builds a CSV with true per-sample timestamps (column snapshot)', () => {
    const csv = buildPlotCsv([{ t: 0, values: [1, undefined] }, { t: 1500, values: [2, 3] }], ['a', 'b,c']);
    expect(csv).toBe([
      'timestamp,epoch_ms,a,"b,c"',
      '1970-01-01T00:00:00.000Z,0,1,',
      '1970-01-01T00:00:01.500Z,1500,2,3'
    ].join('\n'));
  });

  it('round-trips and sanitises a saved config', () => {
    const text = serializePlotConfig({
      windowSize: 300, autoScale: false, customMinY: -1, customMaxY: 9, view: 'fft',
      channelCfg: { 0: { scale: 2, offset: 1, unit: 'V' } },
      trigger: { enabled: true, channel: 1, level: 3, edge: 'falling', pre: 10, post: 20, single: true }
    });
    const c = parsePlotConfig(text);
    expect(c).toMatchObject({ windowSize: 300, autoScale: false, view: 'fft' });
    expect(c.channelCfg[0]).toEqual({ scale: 2, offset: 1, unit: 'V' });
    expect(c.trigger).toMatchObject({ enabled: true, edge: 'falling', pre: 10, post: 20, single: true });
    expect(() => parsePlotConfig('{"x":1}')).toThrow();
    expect(() => parsePlotConfig('nope')).toThrow();
    expect(parsePlotConfig(serializePlotConfig({ windowSize: 1e9, view: 'evil' })).windowSize).toBe(5000);
  });

  it('parses column lists', () => {
    expect(parseColumns('0, 2;3')).toEqual([0, 2, 3]);
    expect(parseColumns('')).toBeNull();
    expect(parseColumns('a')).toBeNull();
  });
});

describe('moving average, frequency and cursor measurement', () => {
  it('movingAverage is a trailing mean, skips gaps and is the identity for n<=1', () => {
    const v = [1, 2, 3, 4];
    expect(movingAverage(v, 1)).toBe(v);
    expect(movingAverage(v, 2)).toEqual([1, 1.5, 2.5, 3.5]);
    const g = movingAverage([2, undefined, 4], 3);
    expect(g[0]).toBe(2);
    expect(g[1]).toBeUndefined();
    expect(g[2]).toBe(3);
  });

  it('estimateFrequency recovers a 5 Hz sine sampled at 100 Hz from timestamps', () => {
    const times = Array.from({ length: 300 }, (_, i) => 1000 + i * 10);
    const vals = times.map((t) => 2 + Math.sin((2 * Math.PI * 5 * (t - 1000)) / 1000));
    const r = estimateFrequency(vals, times);
    expect(r.freq).toBeGreaterThan(4.9);
    expect(r.freq).toBeLessThan(5.1);
    expect(r.periods).toBeGreaterThanOrEqual(13);
  });

  it('estimateFrequency returns null for flat or too-short signals', () => {
    expect(estimateFrequency([1, 1, 1, 1, 1], [0, 1, 2, 3, 4])).toBeNull();
    expect(estimateFrequency([1, 2], [0, 1])).toBeNull();
  });

  it('measureCursors reports delta time, delta value and 1/dt', () => {
    const pts = [{ t: 1000 }, { t: 1010 }, { t: 1040 }];
    const m = measureCursors(pts, [1, 2, 5], 0, 2);
    expect(m.dtMs).toBe(40);
    expect(m.dv).toBe(4);
    expect(m.freq).toBeCloseTo(25, 6);
    expect(measureCursors(pts, [1, 2, 5], 2, 0).dtMs).toBe(-40);
    expect(measureCursors(pts, [1, 2, 5], 1, 1).freq).toBeNull();
    expect(measureCursors(pts, [1, 2, 5], 0, 9)).toBeNull();
    expect(measureCursors(pts, [1, undefined, 5], 0, 1).dv).toBeNull();
  });
});
