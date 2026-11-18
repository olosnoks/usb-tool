import { describe, it, expect } from 'vitest';
import {
  parseHexBytes, decodeIso14a, decodeAccessBits, decodeEm410x, describeOpcode, filterLogs, formatLogsText
} from '../../src/protocols/pm3';

describe('pm3 offline helpers', () => {
  it('parses hex', () => {
    expect(Array.from(parseHexBytes('0xDE:AD be-ef')!)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    expect(parseHexBytes('abc')).toBeNull();
    expect(parseHexBytes('zz')).toBeNull();
  });
  it('decodes ISO14A', () => {
    const r: any = decodeIso14a('DEADBEEF', '0004', '08');
    expect(r.cardType).toBe('MIFARE Classic 1K');
    expect(r.uidLength).toBe(4);
    expect(r.uidProblem).toBeNull();
    const bad: any = decodeIso14a('DEADBEEF11', '0004', '08');
    expect(bad.bccValid).toBe(false);
    expect((decodeIso14a('', '00', '08') as any).error).toBeTruthy();
    expect((decodeIso14a('04112233445566', '4403', '20') as any).iso14443_4).toBe(true);
  });
  it('decodes access bits (transport default)', () => {
    const r: any = decodeAccessBits('FF078069');
    expect(r.valid).toBe(true);
    expect(r.blocks.map((b: any) => b.c)).toEqual(['000', '000', '000', '001']);
    expect(r.userByte).toBe(0x69);
  });
  it('flags inconsistent access bits', () => {
    const r: any = decodeAccessBits('00000000');
    expect(r.valid).toBe(false);
    expect(r.warning).toMatch(/unreadable/);
  });
  it('builds EM410x frame', () => {
    const r: any = decodeEm410x('0F0368568B');
    expect(r.frameBits).toHaveLength(64);
    expect(r.frameBits.startsWith('111111111')).toBe(true);
    expect(r.frameBits.endsWith('0')).toBe(true);
    expect(r.decimal40).toBe(String(0x0f0368568bn));
    expect((decodeEm410x('12') as any).error).toBeTruthy();
  });
  it('names opcodes and formats logs', () => {
    expect(describeOpcode(0x0109)).toBe('CMD_PING');
    expect(describeOpcode(0xffff)).toBe('UNKNOWN');
    const logs = [{ type: 'tx', text: 'TX a', time: '1' }, { type: 'rx', text: 'RX b', time: '2' }];
    expect(filterLogs(logs, new Set(['rx']), '')).toHaveLength(1);
    expect(filterLogs(logs, new Set(['tx', 'rx']), 'tx')).toHaveLength(1);
    expect(formatLogsText(logs)).toContain('TX a');
  });
});
