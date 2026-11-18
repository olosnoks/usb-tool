import { describe, it, expect } from 'vitest';
import {
  analyzeGcode, formatDuration, travelWarnings, parseMacro, wcsZeroLine, marlinOverrideLine,
  describeGrblCode, GRBL_OVERRIDE, overrideLabel,
} from '../src/utils/gcodeExtras';

describe('analyzeGcode', () => {
  it('computes bounds, length and time for linear moves', () => {
    const a = analyzeGcode(['G21', 'G90', 'G1 X10 Y0 F600', 'G1 X10 Y10']);
    expect(a.cutLength).toBeCloseTo(20);
    expect(a.seconds).toBe(2);
    expect(a.bounds.max).toEqual({ X: 10, Y: 10, Z: 0 });
    expect(a.size.X).toBe(10);
  });
  it('uses rapid feed for G0 and converts inches', () => {
    const a = analyzeGcode(['G20', 'G0 X1'], { rapidFeed: 1524 });
    expect(a.rapidLength).toBeCloseTo(25.4);
    expect(a.seconds).toBe(1);
    expect(a.warnings.join()).toContain('inches');
  });
  it('handles relative mode and modal motion', () => {
    const a = analyzeGcode(['G91', 'G1 X5 F60', 'X5']);
    expect(a.bounds.max.X).toBe(10);
    expect(a.warnings.join()).toContain('Relative');
  });
  it('approximates a full circle with I/J', () => {
    const a = analyzeGcode(['G1 X10 F1000', 'G2 X10 Y0 I-10 J0']);
    expect(a.cutLength).toBeGreaterThan(10 + 2 * Math.PI * 10 * 0.99);
    expect(a.bounds.min.X).toBeCloseTo(-10, 0);
  });
  it('handles R arcs (half circle, CCW)', () => {
    const a = analyzeGcode(['G1 X0 Y0 F1000', 'G3 X10 Y0 R5']);
    expect(a.bounds.min.Y).toBeCloseTo(-5, 0);
    expect(a.cutLength).toBeCloseTo(Math.PI * 5, 0);
  });
  it('counts dwell per firmware and warns without feed', () => {
    expect(analyzeGcode(['G4 P2'], { firmware: 'grbl' }).seconds).toBe(2);
    expect(analyzeGcode(['G4 P2000'], { firmware: 'marlin' }).seconds).toBe(2);
    expect(analyzeGcode(['G1 X10']).warnings.join()).toContain('no feed');
  });
  it('returns null bounds for an empty program and tracks spindle', () => {
    const a = analyzeGcode(['M3 S1000']);
    expect(a.bounds).toBeNull();
    expect(a.spindleLeftOn).toBe(true);
  });
});

describe('helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(5)).toBe('5s');
    expect(formatDuration(125)).toBe('2m 05s');
    expect(formatDuration(3723)).toBe('1h 02m 03s');
    expect(formatDuration(NaN)).toBe('-');
  });
  it('warns when the file exceeds max travel', () => {
    const w = travelWarnings({ X: 400, Y: 10, Z: 1 }, [{ id: 130, value: '300.000' }, { id: 131, value: '200' }]);
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('$130');
    expect(travelWarnings(null, [])).toEqual([]);
  });
  it('parses macros', () => {
    expect(parseMacro('', 'G0 X1').ok).toBe(false);
    expect(parseMacro('a', '; only comment').ok).toBe(false);
    const m = parseMacro('Park', 'G91\n(c)\nG0 Z5 ; up');
    expect(m.commands).toEqual(['G91', 'G0 Z5']);
  });
  it('builds WCS zero lines and Marlin overrides', () => {
    expect(wcsZeroLine('G55', ['X', 'Y'])).toBe('G10 L20 P2 X0 Y0');
    expect(() => wcsZeroLine('G53', ['X'])).toThrow();
    expect(marlinOverrideLine('feed', 120)).toBe('M220 S120');
    expect(marlinOverrideLine('flow', 95)).toBe('M221 S95');
    expect(() => marlinOverrideLine('feed', 5)).toThrow();
  });
  it('describes GRBL codes and override bytes', () => {
    expect(describeGrblCode('error', 22)).toContain('Feed rate');
    expect(describeGrblCode('alarm', 1)).toContain('Hard limit');
    expect(describeGrblCode('error', 999)).toBeNull();
    expect(GRBL_OVERRIDE.FEED_PLUS_10).toBe(0x91);
    expect(overrideLabel(0x91)).toContain('feed plus 10');
  });
});
