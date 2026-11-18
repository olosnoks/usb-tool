import { describe, it, expect } from 'vitest';
import { matchesQuery, logToCsv, logToText, logStats } from '../src/utils/midiLogTools.js';

const a = { dir: 'in', from: 'Keys', t: 1000, category: 'note', channel: 1, text: 'Note On C4 (60) vel 100 ch 1', raw: '90 3C 64' };
const b = { dir: 'out', to: 'Synth, A', t: 3000, category: 'cc', channel: 2, text: 'CC 7 "Volume"', raw: 'B1 07 64' };

describe('midiLogTools', () => {
  it('matches all terms case-insensitively', () => {
    expect(matchesQuery(a, '')).toBe(true);
    expect(matchesQuery(a, 'note c4')).toBe(true);
    expect(matchesQuery(a, '90 3c')).toBe(true);
    expect(matchesQuery(a, 'keys cc')).toBe(false);
  });
  it('writes CSV with quoting', () => {
    const lines = logToCsv([a, b]).split('\r\n');
    expect(lines[0]).toBe('time_ms,direction,port,category,channel,text,raw_hex');
    expect(lines[1]).toBe('1000.000,in,Keys,note,1,Note On C4 (60) vel 100 ch 1,90 3C 64');
    expect(lines[2]).toContain('"Synth, A"');
    expect(lines[2]).toContain('"CC 7 ""Volume"""');
  });
  it('writes text lines', () => {
    expect(logToText([a, b]).split('\n')[1]).toBe('3.000s > Synth, A | CC 7 "Volume" | B1 07 64');
  });
  it('computes stats', () => {
    const s = logStats([a, b]);
    expect(s.total).toBe(2);
    expect(s.byCategory).toEqual({ note: 1, cc: 1 });
    expect(s.perSecond).toBeCloseTo(1);
    expect(logStats([]).perSecond).toBeNull();
  });
});
