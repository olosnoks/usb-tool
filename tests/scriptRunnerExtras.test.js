import { describe, it, expect } from 'vitest';
import { runScript, parseHex, encodeSend, buildJUnit } from '../src/utils/scriptModel';
import { buildPySerialScript } from '../src/utils/scriptExport';
import { createRxBuffer } from '../src/utils/serialExpect';

function harness() {
  let t = 0;
  const sent = [];
  const buffer = createRxBuffer();
  return {
    sent,
    io: {
      buffer,
      now: () => t,
      sleep: async (ms) => { t += ms; },
      send: async (b) => { sent.push(Array.from(b)); buffer.append('OK'); },
    },
  };
}

describe('parseHex / hex send', () => {
  it('parses separators and 0x prefixes', () => {
    expect(parseHex('AA 55,0x10:ff')).toEqual([0xaa, 0x55, 0x10, 0xff]);
    expect(parseHex('aa55')).toEqual([0xaa, 0x55]);
    expect(parseHex('')).toEqual([]);
  });
  it('rejects odd or non-hex tokens', () => {
    expect(() => parseHex('A')).toThrow(/invalid hex/);
    expect(() => parseHex('ZZ')).toThrow(/invalid hex/);
  });
  it('encodeSend hex appends the line ending and ignores escapes', () => {
    expect(Array.from(encodeSend('01 02', { format: 'hex', lineEnding: 'crlf' }))).toEqual([1, 2, 13, 10]);
  });
  it('a bad hex step fails with a send error', async () => {
    const h = harness();
    const r = await runScript([{ id: '1', send: 'XYZ', sendFormat: 'hex', expect: 'OK', timeoutMs: 50 }], h.io, { gapMs: 0 });
    expect(r.results['1'].status).toBe('fail');
    expect(r.results['1'].error).toMatch(/send failed/);
    expect(h.sent).toHaveLength(0);
  });
  it('sends hex bytes through the engine', async () => {
    const h = harness();
    await runScript([{ id: '1', send: 'DE AD', sendFormat: 'hex', expect: 'OK', timeoutMs: 50 }], h.io, { gapMs: 0 });
    expect(h.sent[0]).toEqual([0xde, 0xad]);
  });
});

describe('disabled steps', () => {
  it('are skipped, do not send and do not fail the suite', async () => {
    const h = harness();
    const steps = [
      { id: 'a', send: 'one', expect: 'OK', timeoutMs: 50, disabled: true },
      { id: 'b', send: 'two', expect: 'OK', timeoutMs: 50 },
    ];
    const r = await runScript(steps, h.io, { gapMs: 0 });
    expect(r.passed).toBe(true);
    expect(r.results.a.status).toBe('skipped');
    expect(h.sent).toHaveLength(1);
    expect(buildJUnit('s', steps, r.results)).toContain('message="disabled"');
  });
});

describe('buildPySerialScript', () => {
  const steps = [
    { id: '1', send: 'AT\\r\\n', expect: 'OK', timeoutMs: 1500, retries: 2 },
    { id: '2', type: 'delay', value: '500' },
    { id: '3', type: 'dtr', value: '1' },
    { id: '4', send: 'AA 55', sendFormat: 'hex', expect: 'ok', expectMode: 'regex', caseSensitive: false, onFail: 'continue' },
    { id: '5', send: 'x', onFail: 'goto', gotoId: '1', loopCount: 3, loopMode: 'until', expect: 'y' },
    { id: '6', send: 'skip', disabled: true },
  ];
  const py = buildPySerialScript('My "suite"', steps);
  it('translates steps, retries, loops and signals', () => {
    expect(py).toContain('import serial');
    expect(py).toContain('run_step(1, "AT\\\\r\\\\n", False, "", "OK", "plain", False, 1.5)');
    expect(py).toContain('for _try in range(3):');
    expect(py).toContain('time.sleep(0.5)');
    expect(py).toContain('ser.dtr = True');
    expect(py).toContain('run_step(4, "aa55", True');
    expect(py).toContain('for _rep in range(3):');
  });
  it('is honest about goto and disabled steps', () => {
    expect(py).toContain('"goto" is not exported');
    expect(py).toContain('# step 6: disabled, skipped');
    expect(py).not.toContain('"skip"');
  });
  it('stops on failure unless on-fail is continue', () => {
    expect(py).toContain('print("step 1 failed, stopping")');
    expect(py).not.toContain('step 4 failed, stopping');
  });
});
