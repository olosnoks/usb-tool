import { describe, it, expect } from 'vitest';
import { assessLink, summarizeLinkSamples, linkSamplesToCsv, createRateTracker, LINK_CSV_COLUMNS } from '../src/utils/crsfProtocol';

const good = { upRssi1: -60, upRssi2: -120, upLq: 100, upSnr: 10 };

describe('assessLink', () => {
  it('returns none without data', () => expect(assessLink(null).level).toBe('none'));
  it('good link', () => expect(assessLink(good).level).toBe('good'));
  it('warns on mid LQ', () => expect(assessLink({ ...good, upLq: 70 }).level).toBe('warn'));
  it('bad on low LQ and keeps reasons', () => {
    const r = assessLink({ ...good, upLq: 20, upRssi1: -110, upSnr: -3 });
    expect(r.level).toBe('bad');
    expect(r.reasons.length).toBe(3);
  });
  it('uses the better antenna', () => expect(assessLink({ ...good, upRssi1: -110, upRssi2: -70 }).level).toBe('good'));
});

describe('summarizeLinkSamples', () => {
  it('handles empty', () => {
    const s = summarizeLinkSamples([]);
    expect(s.count).toBe(0);
    expect(s.upLq).toBeNull();
  });
  it('computes stats and dropouts', () => {
    const mk = (t, upLq) => ({ t, upLq, upRssi1: -70, upRssi2: -80, upSnr: 5, downLq: 100 });
    const s = summarizeLinkSamples([mk(0, 100), mk(100, 40), mk(200, 30), mk(300, 90), mk(400, 10)]);
    expect(s.dropouts).toBe(2);
    expect(s.upLq.min).toBe(10);
    expect(s.upLq.max).toBe(100);
    expect(s.upLq.avg).toBe(54);
    expect(s.durationMs).toBe(400);
  });
});

describe('linkSamplesToCsv', () => {
  it('writes header and relative times', () => {
    const csv = linkSamplesToCsv([
      { t: 1000, upRssi1: -60, upRssi2: -70, upLq: 99, upSnr: 8, antenna: 0, rfMode: 4, upPowerMw: 100, downRssi: -65, downLq: 98, downSnr: 7 },
      { t: 1250, upRssi1: -61, upRssi2: -71, upLq: 98, upSnr: 7, antenna: 1, rfMode: 4, upPowerMw: null, downRssi: -66, downLq: 97, downSnr: 6 },
    ]).split('\n');
    expect(csv[0]).toBe(LINK_CSV_COLUMNS.join(','));
    expect(csv[1]).toBe('0,-60,-70,99,8,0,4,100,-65,98,7');
    expect(csv[2]).toBe('250,-61,-71,98,7,1,4,,-66,97,6');
  });
});

describe('createRateTracker', () => {
  it('reports Hz over the window and drops old stamps', () => {
    const r = createRateTracker(1000);
    for (let i = 0; i < 50; i++) r.mark(0x16, i * 20);
    expect(r.rates(1000)[0x16]).toBe(50);
    expect(r.rates(5000)[0x16]).toBe(0);
  });
});
