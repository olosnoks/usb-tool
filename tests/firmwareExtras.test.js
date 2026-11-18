import { describe, it, expect } from 'vitest';
import { byteHistogram, digestHex, classifyStrings, countByRule, signaturesToText } from '../src/utils/firmwareExtras.js';

describe('firmwareExtras', () => {
  it('byteHistogram counts and percentages', () => {
    const h = byteHistogram(new Uint8Array([0, 0, 255, 65, 66, 66]));
    expect(h.counts[0]).toBe(2);
    expect(h.counts[66]).toBe(2);
    expect(h.total).toBe(6);
    expect(h.distinct).toBe(4);
    expect(h.zeroPct).toBe(33.33);
    expect(h.printablePct).toBe(50);
    expect(byteHistogram(new Uint8Array(0)).total).toBe(0);
  });
  it('digestHex matches known SHA-256 of "abc"', async () => {
    const d = await digestHex(new TextEncoder().encode('abc'));
    expect(d).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('classifyStrings tags interesting strings only', () => {
    const t = classifyStrings([
      { offset: 1, encoding: 'ascii', text: 'http://192.168.1.1/update' },
      { offset: 2, encoding: 'ascii', text: 'hello world' },
      { offset: 3, encoding: 'ascii', text: 'password=hunter2' },
      { offset: 4, encoding: 'ascii', text: 'Linux version 5.4.0' },
      { offset: 5, encoding: 'ascii', text: 'admin@example.com' },
      { offset: 6, encoding: 'ascii', text: '/etc/passwd' }
    ]);
    expect(t.map((x) => x.rule)).toEqual(['url', 'credential', 'version', 'email', 'path']);
    expect(countByRule(t).url).toBe(1);
  });
  it('signaturesToText lists offsets in decimal and hex', () => {
    const txt = signaturesToText([{ offset: 256, name: 'gzip', size: 10, fields: [['os', 'Unix']] }]);
    expect(txt).toContain('256');
    expect(txt).toContain('0x100');
    expect(txt).toContain('gzip, 10 bytes, os: Unix');
  });
});

import { buildReport, reportToMarkdown } from '../src/utils/firmwareAnalyzer.js';
describe('report hash line', () => {
  it('is included only when present', () => {
    const r = buildReport({ fileName: 'a.bin', size: 1, hits: [] });
    expect(reportToMarkdown(r)).not.toContain('SHA-256');
    r.file.hash = { algorithm: 'SHA-256', hex: 'ab' };
    expect(reportToMarkdown(r)).toContain('- SHA-256: ab');
  });
});
