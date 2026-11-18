import { describe, it, expect } from 'vitest';
import { pushHistory, stepHistory, suggestCommands, filterLogs, formatLogText, MAX_HISTORY } from '../../src/utils/flipperCli';

describe('flipperCli', () => {
  it('pushHistory trims, skips empty and consecutive duplicates, caps', () => {
    let h = pushHistory([], '  uptime ');
    expect(h).toEqual(['uptime']);
    expect(pushHistory(h, 'uptime')).toBe(h);
    expect(pushHistory(h, '   ')).toBe(h);
    let big = [];
    for (let i = 0; i < MAX_HISTORY + 5; i++) big = pushHistory(big, `c${i}`);
    expect(big).toHaveLength(MAX_HISTORY);
    expect(big[big.length - 1]).toBe(`c${MAX_HISTORY + 4}`);
  });
  it('stepHistory walks older/newer and clamps', () => {
    const h = ['a', 'b', 'c'];
    let r = stepHistory(h, 3, -1);
    expect(r).toEqual({ index: 2, value: 'c' });
    r = stepHistory(h, r.index, -1); r = stepHistory(h, r.index, -1); r = stepHistory(h, r.index, -1);
    expect(r).toEqual({ index: 0, value: 'a' });
    expect(stepHistory(h, 2, 1)).toEqual({ index: 3, value: '' });
    expect(stepHistory([], 0, -1)).toEqual({ index: 0, value: '' });
  });
  it('suggestCommands prefers history and drops exact match', () => {
    expect(suggestCommands('')).toEqual([]);
    expect(suggestCommands('storage l')).toContain('storage list /ext');
    expect(suggestCommands('uptime')).toEqual([]);
    expect(suggestCommands('led', ['led r 10'])[0]).toBe('led r 10');
  });
  it('filterLogs and formatLogText', () => {
    const logs = [
      { timestamp: '10:00', type: 'tx', msg: 'uptime' },
      { timestamp: '10:01', type: 'error', msg: 'Bad thing' }
    ];
    expect(filterLogs(logs, 'bad')).toHaveLength(1);
    expect(filterLogs(logs, '', ['tx'])).toHaveLength(1);
    expect(formatLogText(logs)).toBe('[10:00] > uptime\n[10:01] Bad thing');
    expect(formatLogText(logs, false)).toBe('> uptime\nBad thing');
  });
});
