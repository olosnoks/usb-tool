import { describe, it, expect } from 'vitest';
import { createRxBuffer, waitForExpect } from '../src/utils/serialExpect';
import { pyStr, bytesToBase64, base64ToBytes, buildReadScript, buildWriteScript, buildDeleteScript, parseFileOutput } from '../src/utils/micropythonFiles';

describe('waitForExpect', () => {
  it('matches text that arrives after the wait starts', async () => {
    const buf = createRxBuffer();
    setTimeout(() => buf.append('hello O'), 20);
    setTimeout(() => buf.append('K\r\n'), 60);
    expect(await waitForExpect(buf, 'OK', 1000)).toBe(true);
  });
  it('times out when nothing matches', async () => {
    const buf = createRxBuffer();
    buf.append('nope');
    expect(await waitForExpect(buf, 'OK', 80)).toBe(false);
  });
  it('stops early when aborted', async () => {
    const buf = createRxBuffer();
    let active = true;
    setTimeout(() => { active = false; }, 30);
    const t = Date.now();
    expect(await waitForExpect(buf, 'OK', 5000, { isActive: () => active })).toBe(false);
    expect(Date.now() - t).toBeLessThan(1000);
  });
  it('clear() discards earlier text', async () => {
    const buf = createRxBuffer();
    buf.append('OK');
    buf.clear();
    expect(await waitForExpect(buf, 'OK', 60)).toBe(false);
  });
});

describe('micropython file helpers', () => {
  it('round-trips binary bytes through base64', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });
  it('encodes non-Latin1 text via UTF-8 without throwing', () => {
    const text = 'héllo 日本語 \u{1F600}';
    const script = buildWriteScript('a.txt', text);
    const b64 = /a2b_base64\('([^']+)'\)/.exec(script)[1];
    expect(new TextDecoder().decode(base64ToBytes(b64))).toBe(text);
  });
  it('quotes paths so they cannot break out of the literal', () => {
    const evil = `x'`+'"); import os; os.remove("/main.py"); ("'+String.fromCharCode(92);
    const BS = String.fromCharCode(92);
    const Q = String.fromCharCode(34);
    expect(pyStr(evil)).toBe(Q + "x'" + BS + Q + '); import os; os.remove(' + BS + Q + '/main.py' + BS + Q + '); (' + BS + Q + BS + BS + Q);
    expect(pyStr('a\nb')).toBe('"a' + String.fromCharCode(92) + 'nb"');
    for (const build of [buildReadScript, buildDeleteScript, (p) => buildWriteScript(p, 'x')]) {
      expect(build(evil)).toContain(pyStr(evil));
    }
  });
  it('parses downloaded file output into bytes', () => {
    const out = `OK\n__FILE_DATA_START__\n${bytesToBase64(new Uint8Array([0, 255, 128]))}\n__FILE_DATA_END__\n`;
    expect(Array.from(parseFileOutput(out))).toEqual([0, 255, 128]);
    expect(parseFileOutput('error')).toBeNull();
  });
});
