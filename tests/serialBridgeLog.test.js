import { describe, it, expect } from 'vitest';
import { byteCount, filterLog, computeStats, logToCsv, logToText, hexDump } from '../src/utils/serialBridgeLog';

const log = [
  { id: '1', time: '10:00:00.000', dir: 'A->B', deltaMs: 0, hex: '48 49 0D 0A', text: 'HI..' },
  { id: '2', time: '10:00:00.500', dir: 'B->A', deltaMs: 500, hex: '4F 4B', text: 'OK' },
  { id: '3', time: '10:00:01.000', dir: 'A->B', deltaMs: 500, hex: '41 2C 22', text: 'A,"' },
];

describe('serialBridgeLog', () => {
  it('counts bytes', () => {
    expect(byteCount(log[0])).toBe(4);
    expect(byteCount({ hex: '' })).toBe(0);
  });
  it('filters by direction and query (text or hex, case-insensitive)', () => {
    expect(filterLog(log, { dir: 'B->A' })).toHaveLength(1);
    expect(filterLog(log, { query: 'ok' })).toHaveLength(1);
    expect(filterLog(log, { query: '0d 0a' })).toHaveLength(1);
    expect(filterLog(log, { query: 'zzz' })).toHaveLength(0);
    expect(filterLog(log)).toHaveLength(3);
  });
  it('computes per-direction stats and rate', () => {
    const s = computeStats(log);
    expect(s.bytes).toBe(9);
    expect(s.aToB).toEqual({ chunks: 2, bytes: 7 });
    expect(s.bToA).toEqual({ chunks: 1, bytes: 2 });
    expect(s.durationMs).toBe(1000);
    expect(s.bytesPerSec).toBe(9);
  });
  it('writes escaped CSV with board names', () => {
    const csv = logToCsv(log, { a: 'Dash', b: 'Ctrl' });
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('time,direction,from,to,delta_ms,bytes,hex,text');
    expect(lines[1]).toContain('Dash,Ctrl');
    expect(lines[3]).toContain('"A,"""');
  });
  it('builds a hex dump with ascii column', () => {
    expect(hexDump('48 49 00')).toBe(`0000  48 49 00${' '.repeat(47 - 8 + 2)}HI.`);
    expect(hexDump('')).toBe('');
    expect(hexDump(Array(17).fill('41').join(' ')).split('\n')).toHaveLength(2);
  });
  it('exports text with headers', () => {
    const t = logToText(log, { a: 'A1', b: 'B1' });
    expect(t).toContain('[10:00:00.500] B1 -> A1 (2 bytes, +500ms)');
  });
});
