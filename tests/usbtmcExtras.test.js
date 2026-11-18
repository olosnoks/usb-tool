import { describe, it, expect } from 'vitest';
import { expandScript, loggerStats, limitViolations, isOutOfLimits, toPyvisaScript, MAX_SCRIPT_STEPS } from '../src/utils/usbtmcExtras';

describe('expandScript', () => {
  it('parses commands, waits and comments', () => {
    const { steps, error } = expandScript('# hi\n*IDN?\nwait 250\nSOUR:VOLT 5');
    expect(error).toBeNull();
    expect(steps.map((s) => s.text || s.ms)).toEqual(['*IDN?', 250, 'SOUR:VOLT 5']);
  });
  it('expands nested repeat blocks', () => {
    const { steps } = expandScript('repeat 2\nA\nrepeat 3\nB\nend\nend\nC');
    expect(steps.map((s) => s.text).join('')).toBe('ABBBABBBC');
  });
  it('reports unbalanced blocks and huge expansions', () => {
    expect(expandScript('repeat 2\nA').error).toMatch(/missing/);
    expect(expandScript('end').error).toMatch(/without/);
    expect(expandScript(`repeat ${MAX_SCRIPT_STEPS}\nrepeat 2\nA\nend\nend`).error).toMatch(/more than/);
    expect(expandScript('repeat 0\nA\nend').error).toMatch(/count/);
  });
});

describe('loggerStats / limits', () => {
  it('computes stats ignoring overload', () => {
    const s = loggerStats([1, 3, Infinity, NaN]);
    expect(s).toMatchObject({ min: 1, max: 3, avg: 2, std: 1, count: 2 });
    expect(loggerStats([])).toBeNull();
  });
  it('counts violations', () => {
    expect(limitViolations([1, 2, 3, 4], 2, 3)).toEqual({ below: 1, above: 1, total: 2 });
    expect(limitViolations([1, 5], '', '')).toEqual({ below: 0, above: 0, total: 0 });
    expect(isOutOfLimits(9, '', 5)).toBe(true);
  });
});

describe('toPyvisaScript', () => {
  it('maps queries, writes and waits', () => {
    const py = toPyvisaScript([{ type: 'cmd', text: "*IDN?" }, { type: 'cmd', text: 'VOLT 1' }, { type: 'wait', ms: 500 }], { timeoutMs: 2000 });
    expect(py).toContain("inst.query('*IDN?')");
    expect(py).toContain("inst.write('VOLT 1')");
    expect(py).toContain('time.sleep(0.5)');
    expect(py).toContain('inst.timeout = 2000');
  });
  it('escapes quotes', () => {
    expect(toPyvisaScript([{ type: 'cmd', text: "DISP:TEXT 'a'" }])).toContain("inst.write('DISP:TEXT \'a\'')");
  });
});
