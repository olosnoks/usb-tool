import { describe, it, expect } from 'vitest';
import {
  describeCollections, parseHexBytes, ledBits, ledReportBytes, reportRateStats, serializeRecording, parseRecording
} from '../src/utils/hidInspector';

// A boot keyboard's output report: 5 LED bits, then 3 bits of padding.
const keyboard = describeCollections([{
  usagePage: 1, usage: 6,
  inputReports: [],
  outputReports: [{ reportId: 0, items: [
    { usagePage: 8, usageMinimum: 1, usageMaximum: 5, reportSize: 1, reportCount: 5, logicalMinimum: 0, logicalMaximum: 1 },
    { reportSize: 3, reportCount: 1, isConstant: true }
  ] }],
  featureReports: []
}])[0];

describe('HID output helpers', () => {
  it('parses hex bytes strictly', () => {
    expect(Array.from(parseHexBytes('01 ff 0x10,7'))).toEqual([1, 255, 16, 7]);
    expect(() => parseHexBytes('1ff')).toThrow(/not a hex byte/);
  });

  it('finds LED bits and builds the LED report', () => {
    const out = keyboard.outputReports[0];
    expect(out.byteLength).toBe(1);
    expect(ledBits(out)).toEqual({ 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 });
    expect(Array.from(ledReportBytes(out, { 2: true }))).toEqual([0x02]);
    expect(Array.from(ledReportBytes(out, { 1: true, 3: true }))).toEqual([0x05]);
  });

  it('measures report rate and jitter', () => {
    const times = Array.from({ length: 101 }, (_, i) => i * 1 + (i % 2 ? 0.1 : 0));
    const s = reportRateStats(times);
    expect(s.rateHz).toBeCloseTo(1000, -1);
    expect(s.minMs).toBeCloseTo(0.9, 5);
    expect(s.maxMs).toBeCloseTo(1.1, 5);
    expect(reportRateStats([1, 2])).toBeNull();
  });

  it('round-trips recordings', () => {
    const text = serializeRecording({ vendorId: 0x46d, productId: 0xc077 }, [{ t: 0, reportId: 0, bytes: Uint8Array.from([1, 2, 255]) }, { t: 8.0004, reportId: 2, bytes: Uint8Array.from([0]) }]);
    const back = parseRecording(text);
    expect(back.device).toEqual({ vendorId: 0x46d, productId: 0xc077 });
    expect(back.reports.map((r) => [r.t, r.reportId, Array.from(r.bytes)])).toEqual([[0, 0, [1, 2, 255]], [8, 2, [0]]]);
    expect(() => parseRecording('{"x":1}')).toThrow(/Not a HID recording/);
  });
});
