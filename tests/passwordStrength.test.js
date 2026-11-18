import { describe, it, expect } from 'vitest';
import { analyzePassword, findPatterns, formatDuration, summarizeStrength, requestPreview } from '../src/utils/passwordStrength.js';

describe('passwordStrength', () => {
  it('rates common passwords very weak', () => {
    const a = analyzePassword('password123');
    expect(a.score).toBeLessThanOrEqual(1);
    expect(a.warnings.join(' ')).toMatch(/common/i);
  });
  it('detects patterns', () => {
    const kinds = (p) => findPatterns(p).map((x) => x.kind);
    expect(kinds('xxabcdxx')).toContain('sequence');
    expect(kinds('myqwertyx')).toContain('keyboard');
    expect(kinds('zz1987zz')).toContain('year');
    expect(kinds('aaaaaa')).toContain('repeat');
    expect(kinds('p@ssw0rd')).toContain('common');
  });
  it('rates long random strings strong', () => {
    const a = analyzePassword('k7#Vq9!mZr2$Lw8&Xt4');
    expect(a.score).toBe(4);
    expect(a.crackTimes).toHaveLength(4);
  });
  it('gains bits with length for random text', () => {
    expect(analyzePassword('Zq8#mK2v!Rt5').bits).toBeGreaterThan(analyzePassword('Zq8#mK2v').bits);
  });
  it('handles empty input and unicode', () => {
    expect(analyzePassword('').label).toBe('Empty');
    expect(analyzePassword('pässwörd-key').length).toBe(12);
  });
  it('formats durations', () => {
    expect(formatDuration(0.2)).toBe('instantly');
    expect(formatDuration(90)).toBe('2 minutes');
    expect(formatDuration(Infinity)).toBe('centuries');
  });
  it('summarises and previews', () => {
    expect(summarizeStrength([{ score: 0 }, { score: 1 }, { score: 4 }, null])).toEqual({ byScore: [1, 1, 0, 0, 1], weak: 2, total: 3 });
    const p = requestPreview('5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8');
    expect(p.prefix).toBe('5BAA6');
    expect(p.url).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(p.keptLocal).toBe(35);
  });
});
