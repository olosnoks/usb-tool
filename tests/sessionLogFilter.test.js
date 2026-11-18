import { describe, it, expect } from 'vitest';
import { parseQuery, matchesQuery, withinMinutes, levelCounts, exportCsv } from '../src/utils/sessionLogFilter';

const E = (o) => ({ seq: 1, t: 1000, tool: 'ADB', level: 'info', text: 'hello world', ...o });
const q = (s, e) => matchesQuery(e, parseQuery(s));

describe('parseQuery / matchesQuery', () => {
  it('ANDs words and supports negation and phrases', () => {
    expect(q('hello world', E())).toBe(true);
    expect(q('hello nope', E())).toBe(false);
    expect(q('-nope', E())).toBe(true);
    expect(q('-hello', E())).toBe(false);
    expect(q('"lo wo"', E())).toBe(true);
  });
  it('supports regex and reports bad ones', () => {
    expect(q('/^hel+o/', E())).toBe(true);
    expect(q('-/wor.d/', E())).toBe(false);
    const p = parseQuery('/(/');
    expect(p.error).toMatch(/Invalid regex/);
    expect(p.terms).toHaveLength(0);
  });
  it('supports tool: and level: keys', () => {
    expect(q('tool:adb', E())).toBe(true);
    expect(q('-tool:adb', E())).toBe(false);
    expect(q('level:error', E({ level: 'error' }))).toBe(true);
    expect(q('level:error', E())).toBe(false);
  });
  it('empty query matches everything', () => expect(q('', E())).toBe(true));
});

describe('time window, counts, csv', () => {
  it('filters by minutes', () => {
    const l = [E({ t: 0 }), E({ t: 590000 })];
    expect(withinMinutes(l, 5, 600000)).toHaveLength(1);
    expect(withinMinutes(l, 0, 600000)).toHaveLength(2);
  });
  it('counts levels with repeats', () => {
    expect(levelCounts([E({ count: 3 }), E({ level: 'error' })])).toEqual({ info: 3, error: 1 });
  });
  it('exports escaped, formula-safe, redacted CSV', () => {
    const csv = exportCsv([E({ text: 'say "hi", ok' }), E({ text: '=1+1' }), E({ text: 'password=hunter2' })]);
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('time,seq,tool,level,count,text');
    expect(lines[1]).toContain('"say ""hi"", ok"');
    expect(lines[2]).toMatch(/,'=1\+1$/);
    expect(lines[3]).toContain('[REDACTED]');
    expect(exportCsv([E({ text: 'password=hunter2' })], false)).toContain('hunter2');
  });
});
