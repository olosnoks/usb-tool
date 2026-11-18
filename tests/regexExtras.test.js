import { describe, it, expect } from 'vitest';
import { lintPattern, exportMatches, matchStats, insertToken } from '../src/utils/regexExtras.js';
import { runMatch } from '../src/utils/regexTools.js';

describe('lintPattern', () => {
  it('flags nested quantifiers', () => {
    expect(lintPattern('(a+)+$').map((x) => x.id)).toContain('nested-quantifier');
    expect(lintPattern('(\\w+\\s*)*').map((x) => x.id)).toContain('nested-quantifier');
  });
  it('flags quantified alternation with empty or duplicate branches', () => {
    expect(lintPattern('(a|a)+').map((x) => x.id)).toContain('quantified-alternation');
    expect(lintPattern('(a|)*').map((x) => x.id)).toContain('quantified-alternation');
  });
  it('is quiet for ordinary patterns and ignores escapes/classes', () => {
    expect(lintPattern('(\\w+)@(\\w+\\.\\w+)')).toEqual([]);
    expect(lintPattern('[(+*]+')).toEqual([]);
    expect(lintPattern('\\(a+\\)+')).toEqual([]);
    expect(lintPattern('')).toEqual([]);
  });
  it('notes multiple wildcards', () => {
    expect(lintPattern('a.*b.*c').map((x) => x.id)).toContain('adjacent-wildcards');
  });
});

describe('exportMatches / matchStats', () => {
  const r = runMatch({ pattern: '(\\w)(\\d)', flags: 'g', text: 'a1 b2 a1' });
  it('json', () => {
    const j = JSON.parse(exportMatches(r.matches, 'json'));
    expect(j).toHaveLength(3);
    expect(j[0]).toMatchObject({ index: 0, text: 'a1', groups: ['a', '1'] });
  });
  it('csv with quoting', () => {
    const csv = exportMatches([{ index: 0, text: 'a,"b"', length: 5, groups: ['x'] }], 'csv').split('\n');
    expect(csv[0]).toBe('#,text,index,length,group1');
    expect(csv[1]).toBe('1,"a,""b""",0,5,x');
  });
  it('lines and unique', () => {
    expect(exportMatches(r.matches, 'lines')).toBe('a1\nb2\na1');
    expect(exportMatches(r.matches, 'unique')).toBe('a1\nb2');
  });
  it('stats', () => {
    expect(matchStats(r.matches, 'a1 b2 a1')).toEqual({ count: 3, unique: 2, covered: 6, percent: 75 });
    expect(matchStats([], '')).toMatchObject({ count: 0, percent: 0 });
  });
  it('insertToken', () => {
    expect(insertToken('a', '(?:…)')).toBe('a(?:)');
  });
});
