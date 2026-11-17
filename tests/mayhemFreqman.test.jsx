import { describe, it, expect, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

function stubStorage() {
  const m = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }
  });
  return m;
}

let mod;
beforeEach(async () => { stubStorage(); mod = await import('../src/utils/mayhemDriver.js'); });

const plain = (l) => l.map(({ freq, mod: a, label, bw }) => ({ freq, mod: a, label, bw }));

describe('parseFreqmanTxt', () => {
  it('parses valid lines, comments and CRLF', () => {
    const r = mod.parseFreqmanTxt('# c\r\nf=433920000,a=NFM,d=Key fob,bw=12500\r\n\r\nf=1090000000,a=SPEC,d=ADS-B, Mode-S,bw=2000000\r\n');
    expect(r.rejected).toBe(0);
    expect(r.entries).toEqual([
      { freq: 433920000, mod: 'NFM', label: 'Key fob', bw: 12500 },
      { freq: 1090000000, mod: 'SPEC', label: 'ADS-B, Mode-S', bw: 2000000 }
    ]);
  });
  it('rejects out-of-range and malformed lines with a count', () => {
    const r = mod.parseFreqmanTxt('f=500000,a=AM,d=low,bw=1\nf=7000000000,a=AM,d=hi,bw=1\nnonsense\nf=abc,a=AM,d=x,bw=1\nf=100000000,a=AM,d=x,bw=zz\nf=100000000,a=AM,d=ok,bw=10000');
    expect(r.entries).toHaveLength(1);
    expect(r.rejected).toBe(5);
  });
  it('dedupes by freq+mod', () => {
    const r = mod.parseFreqmanTxt('f=100000000,a=AM,d=a,bw=1\nf=100000000,a=AM,d=b,bw=1\nf=100000000,a=NFM,d=c,bw=1');
    expect(r.entries).toHaveLength(2);
    expect(r.duplicates).toBe(1);
  });
});

describe('driver FREQMAN', () => {
  it('export then import yields the identical list', () => {
    const d = new mod.MayhemPortaPackDriver();
    d.addFrequency(446006250, 'NFM', 'PMR446 ch1', 12500);
    const before = plain(d.freqList);
    const res = d.importFreqmanTxt(d.exportFreqmanTxt());
    expect(res).toMatchObject({ applied: true, rejected: 0 });
    expect(plain(d.freqList)).toEqual(before);
  });
  it('keeps the list when nothing valid is imported', () => {
    const d = new mod.MayhemPortaPackDriver();
    const n = d.freqList.length;
    expect(d.importFreqmanTxt('garbage\n').applied).toBe(false);
    expect(d.freqList).toHaveLength(n);
  });
  it('persists across a new instance and resets to presets', () => {
    const d = new mod.MayhemPortaPackDriver();
    d.addFrequency(446006250, 'NFM', 'PMR', 12500);
    expect(new mod.MayhemPortaPackDriver().freqList[0].label).toBe('PMR');
    d.resetFreqmanToPresets();
    expect(new mod.MayhemPortaPackDriver().freqList).toHaveLength(mod.FREQMAN_PRESETS.length);
  });
  it('ignores corrupt stored data', () => {
    localStorage.setItem(mod.FREQMAN_STORAGE_KEY, '{bad');
    expect(new mod.MayhemPortaPackDriver().freqList).toHaveLength(mod.FREQMAN_PRESETS.length);
  });
});

describe('UI', () => {
  it('FreqmanView shows the Import control and Reset', async () => {
    const { default: FreqmanView } = await import('../src/components/tools/portapack/FreqmanView.jsx');
    const d = new mod.MayhemPortaPackDriver();
    const html = renderToString(<FreqmanView driver={d} customFreqInput="" customLabel="" customMod="NFM" handleAddCustomFreq={() => {}}
      handleExportFreqman={() => {}} handleTunePreset={() => {}} setCustomFreqInput={() => {}} setCustomLabel={() => {}} setCustomMod={() => {}} />);
    expect(html).toContain('Import FREQMAN.TXT');
    expect(html).toContain('Reset to presets');
    expect(html).toContain('data-testid="freqman-import"');
  });
  it('peaksToCsv matches the peak list', async () => {
    const { peaksToCsv } = await import('../src/components/tools/hackrf/ReceiverDeck.jsx');
    const csv = peaksToCsv([{ id: 1, freqHz: 433920000, powerDb: -42 }], { startHz: 4e8, endHz: 5e8 }, '2025-01-01T00:00:00.000Z');
    expect(csv).toBe('start_hz,end_hz,peak_hz,dbfs,timestamp\n400000000,500000000,433920000,-42,2025-01-01T00:00:00.000Z\n');
  });
});
