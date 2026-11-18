import { describe, it, expect } from 'vitest';
import { parseAtr } from '../src/utils/smartcardTools.js';
import {
  explainInterfaceByte, explainAtrInterface, formatAtrReport, parseScript, exportScript, convertToolOutputToTrace,
} from '../src/utils/smartcardScript.js';

describe('ATR interface byte explanations', () => {
  it('decodes TA2, TA3/TB3/TC3 (T=1) and T=15 TA', () => {
    expect(explainInterfaceByte(2, 'TA', 0x81)).toContain('mode cannot change');
    expect(explainInterfaceByte(3, 'TA', 0xfe, 1)).toContain('IFSC');
    expect(explainInterfaceByte(3, 'TB', 0x45, 1)).toContain('BWI=4');
    expect(explainInterfaceByte(3, 'TB', 0x45, 1)).toContain('CWI=5');
    expect(explainInterfaceByte(3, 'TC', 0x01, 1)).toContain('CRC');
    expect(explainInterfaceByte(3, 'TC', 0x00, 1)).toContain('LRC');
    expect(explainInterfaceByte(3, 'TA', 0xc7, 15)).toContain('clock stop low or high');
    expect(explainInterfaceByte(3, 'TA', 0xc7, 15)).toContain('1.8V');
  });
  it('walks the groups of a parsed ATR with the right governing protocol', () => {
    const atr = parseAtr('3B F7 18 00 02 10 80 FE 45 00 00 00 00 00');
    const groups = explainAtrInterface(atr);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups[0].notes.some((n) => n.startsWith('TA1'))).toBe(true);
  });
  it('builds a text report', () => {
    const atr = parseAtr('3B 6E 00 00 80 31 80 66 B1 84 0C 01 6E 01 83 00 90 00');
    const rep = formatAtrReport(atr, '3B 6E 00 00');
    expect(rep).toContain('ATR: 3B 6E 00 00');
    expect(rep).toContain('direct convention');
    expect(rep).toContain('Historical bytes');
  });
});

describe('script parsing and export', () => {
  const text = '# comment\n/reset\n00 A4 04 00 02 A0 00 ; trailing\n00 20 00 80 04 31 32 33 34\nZZ\n00 A4\n';
  const p = parseScript(text);
  it('keeps commands, directives and reports bad lines', () => {
    expect(p.commands.map((c) => c.line)).toEqual([3, 4]);
    expect(p.directives).toEqual([{ line: 2, text: '/reset' }]);
    expect(p.errors.map((e) => e.line)).toContain(5);
    expect(p.commands[0].name).toMatch(/SELECT/i);
  });
  it('warns for VERIFY and other state-changing instructions', () => {
    expect(p.commands[1].risky).toMatch(/VERIFY/);
    expect(p.warnings.length).toBe(1);
    expect(parseScript('80 E4 00 80 00').warnings[0].message).toMatch(/DELETE/);
  });
  it('exports for scriptor, opensc-tool, gp and pyscard', () => {
    expect(exportScript(p, 'scriptor')).toBe('/reset\n00 A4 04 00 02 A0 00\n00 20 00 80 04 31 32 33 34\n');
    expect(exportScript(p, 'opensc').split('\n')[0]).toBe('opensc-tool -s 00A4040002A000');
    expect(exportScript(p, 'gp')).toBe('gp -a 00A4040002A000 -a 002000800431323334');
    expect(exportScript(p, 'pyscard')).toContain('0x00, 0xA4');
    expect(() => exportScript(p, 'nope')).toThrow();
  });
});

describe('tool output to trace', () => {
  it('converts gp -d and scriptor lines and counts the rest', () => {
    const gp = 'A>> T=1 (4+0008) 00A40400 08 A000000151000000\nA<< (0018+2) (28ms) 6F10840E 9000\nnoise';
    const r = convertToolOutputToTrace(gp);
    expect(r.trace.split('\n')).toEqual(['>> 00 A4 04 00 08 A0 00 00 01 51 00 00 00', '<< 6F 10 84 0E 90 00']);
    expect(r.skipped).toBe(1);
    const sc = convertToolOutputToTrace('Sending: 00 A4 00 00 02 3F 00\nResponse: 6F 20 : 90 00 (OK)');
    expect(sc.trace).toBe('>> 00 A4 00 00 02 3F 00\n<< 6F 20 90 00');
  });
});
