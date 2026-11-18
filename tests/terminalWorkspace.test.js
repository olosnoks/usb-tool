import { describe, it, expect } from 'vitest';
import { sessionStats, formatBytes, parseBaudList, bestBaudResult, formatHuntReport, sanitizePrefs, loadPrefs, savePrefs, PREFS_KEY } from '../src/utils/terminalWorkspace';

describe('sessionStats', () => {
  it('totals rx/tx bytes and the average rx rate', () => {
    const s = sessionStats([
      { type: 'rx', rawBytes: new Uint8Array(100), rawTime: 1000 },
      { type: 'tx', text: 'AT\r\n' },
      { type: 'sys', text: 'ignored' },
      { type: 'rx', rawBytes: new Uint8Array(100), rawTime: 2000 }
    ]);
    expect(s).toMatchObject({ rxBytes: 200, txBytes: 4, rxChunks: 2, txChunks: 1, spanMs: 1000, rxBps: 200 });
  });
  it('handles empty input', () => {
    expect(sessionStats([]).rxBps).toBe(0);
    expect(sessionStats(null).rxBytes).toBe(0);
  });
  it('formats sizes', () => {
    expect(formatBytes(12)).toBe('12 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.00 MB');
  });
});

describe('parseBaudList', () => {
  it('parses, dedupes and reports invalid tokens', () => {
    expect(parseBaudList('9600, 115200 9600;250000')).toEqual({ rates: [9600, 115200, 250000], invalid: [] });
    expect(parseBaudList('abc 10 99999999 1.5 38400')).toEqual({ rates: [38400], invalid: ['abc', '10', '99999999', '1.5'] });
    expect(parseBaudList('')).toEqual({ rates: [], invalid: [] });
  });
});

describe('hunt results', () => {
  const results = [
    { baud: 9600, confidence: 20, printableRatio: 30, entropy: 7, byteCount: 5, verdict: 'LOW' },
    { baud: 115200, confidence: 90, printableRatio: 98, entropy: 4.2, byteCount: 80, verdict: 'HIGH PROBABILITY' }
  ];
  it('picks the best result above the threshold', () => {
    expect(bestBaudResult(results).baud).toBe(115200);
    expect(bestBaudResult([results[0]])).toBeNull();
  });
  it('formats a tab separated report', () => {
    const lines = formatHuntReport(results).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('115200\t90%\t98\t4.2\t80\tHIGH PROBABILITY');
  });
});

describe('prefs', () => {
  it('sanitizes bad values', () => {
    expect(sanitizePrefs({ sidePanel: 'x', termMode: 'interactive', customBauds: 5 })).toEqual({ sidePanel: 'hex', termMode: 'interactive', probeMode: 'active', customBauds: '' });
  });
  it('round-trips through a storage object', () => {
    const mem = {}; const st = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
    savePrefs({ sidePanel: 'none', probeMode: 'passive', customBauds: '250000' }, st);
    expect(mem[PREFS_KEY]).toBeTruthy();
    expect(loadPrefs(st)).toMatchObject({ sidePanel: 'none', probeMode: 'passive', customBauds: '250000' });
    expect(loadPrefs({ getItem: () => 'not json' }).sidePanel).toBe('hex');
  });
});
