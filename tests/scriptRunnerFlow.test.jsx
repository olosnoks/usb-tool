import { describe, it, expect } from 'vitest';
import { runScript } from '../src/utils/scriptModel';
import { createRxBuffer } from '../src/utils/serialExpect';

// Fake serial + injected clock: `reply(sentText, callIndex)` returns text the
// device "answers" with (appended to the RX buffer right after the send).
function harness(reply, { isActive } = {}) {
  let t = 0;
  const buffer = createRxBuffer();
  const sent = [];
  const signals = [];
  const bauds = [];
  const io = {
    buffer,
    now: () => t,
    sleep: async (ms) => { t += ms; },
    isActive: isActive || (() => true),
    send: async (bytes) => {
      sent.push(Array.from(bytes));
      const text = reply(new TextDecoder().decode(bytes), sent.length - 1);
      if (text) buffer.append(text);
    },
    setSignals: async (s) => { signals.push(s); },
    setBaud: async (b) => { bauds.push(b); },
  };
  return { io, sent, signals, bauds };
}
const opts = { gapMs: 0 };

describe('runScript', () => {
  it('transmits CR LF bytes for AT\\r\\n and passes on OK', async () => {
    const h = harness(() => 'OK\r\n');
    const r = await runScript([{ id: '1', send: 'AT\\r\\n', expect: 'OK', timeoutMs: 100 }], h.io, opts);
    expect(h.sent[0]).toEqual([65, 84, 13, 10]);
    expect(r.passed).toBe(true);
    expect(r.results['1'].status).toBe('pass');
    expect(r.results['1'].output).toContain('OK');
  });

  it('stores regex captures as ${1} and uses them in a later step', async () => {
    const h = harness((txt) => (txt.startsWith('AT+CSQ') ? '+CSQ: 21,0\r\nOK' : 'OK'));
    const r = await runScript([
      { id: 'a', send: 'AT+CSQ\\r\\n', expect: '\\+CSQ: (\\d+),', expectMode: 'regex', timeoutMs: 100 },
      { id: 'b', send: 'AT+LEVEL=${1}', expect: 'OK', timeoutMs: 100 },
    ], h.io, opts);
    expect(r.vars['1']).toBe('21');
    expect(new TextDecoder().decode(Uint8Array.from(h.sent[1]))).toBe('AT+LEVEL=21');
  });

  const loopSteps = (onFail) => [
    { id: 'L', send: 'ping', expect: 'pong', timeoutMs: 100, loopCount: 5, onFail },
    { id: 'T', send: 'after', expect: 'pong', timeoutMs: 100 },
    { id: 'G', send: 'goal', expect: 'pong', timeoutMs: 100 },
  ];
  // device answers pong except on the 3rd ping
  const pingReply = () => { let n = 0; return (txt) => { if (txt === 'ping') { n++; return n === 3 ? '' : 'pong'; } return 'pong'; }; };

  it('loop of 5 with failing 3rd iteration: stop halts the suite', async () => {
    const h = harness(pingReply());
    const r = await runScript(loopSteps('stop'), h.io, opts);
    expect(r.results.L.iterations.length).toBe(3);
    expect(r.results.L.status).toBe('fail');
    expect(r.results.T).toBeUndefined();
    expect(r.passed).toBe(false);
  });
  it('loop of 5 with failing 3rd iteration: continue runs all iterations and the next steps', async () => {
    const h = harness(pingReply());
    const r = await runScript(loopSteps('continue'), h.io, opts);
    expect(r.results.L.iterations.length).toBe(5);
    expect(r.results.L.iterations.map((i) => i.ok)).toEqual([true, true, false, true, true]);
    expect(r.results.L.status).toBe('fail');
    expect(r.results.G.status).toBe('pass');
    expect(r.passed).toBe(false);
  });
  it('goto jumps to the target step after the failure', async () => {
    const h = harness(pingReply());
    const steps = loopSteps('goto');
    steps[0].gotoId = 'G';
    const r = await runScript(steps, h.io, opts);
    expect(r.results.L.iterations.length).toBe(3);
    expect(r.results.T).toBeUndefined();
    expect(r.results.G.status).toBe('pass');
  });

  it('retries a failing step before applying the policy', async () => {
    let n = 0;
    const h = harness(() => (++n === 3 ? 'OK' : ''));
    const r = await runScript([{ id: '1', send: 'x', expect: 'OK', timeoutMs: 100, retries: 2 }], h.io, opts);
    expect(r.results['1'].status).toBe('pass');
    expect(r.results['1'].iterations[0].attempts).toBe(3);
  });

  it('until-mode repeats until the expect matches', async () => {
    let n = 0;
    const h = harness(() => (++n === 4 ? 'READY' : ''));
    const r = await runScript([{ id: '1', send: 'st', expect: 'READY', timeoutMs: 50, loopMode: 'until', loopCount: 10 }], h.io, opts);
    expect(r.results['1'].status).toBe('pass');
    expect(r.results['1'].iterations.length).toBe(4);
  });

  it('not-expect passes when the text never appears and fails when it does', async () => {
    const ok = await runScript([{ id: '1', send: 'x', expect: 'ERROR', expectMode: 'not', timeoutMs: 100 }], harness(() => 'fine').io, opts);
    expect(ok.results['1'].status).toBe('pass');
    const bad = await runScript([{ id: '1', send: 'x', expect: 'ERROR', expectMode: 'not', timeoutMs: 100 }], harness(() => 'ERROR!').io, opts);
    expect(bad.results['1'].status).toBe('fail');
  });

  it('runs delay, DTR/RTS and baud steps', async () => {
    const h = harness(() => '');
    const r = await runScript([
      { id: 'd', type: 'delay', value: '250' },
      { id: 'a', type: 'dtr', value: '1' },
      { id: 'b', type: 'rts', value: '0' },
      { id: 'c', type: 'baud', value: '9600' },
    ], h.io, opts);
    expect(r.passed).toBe(true);
    expect(h.signals).toEqual([{ dataTerminalReady: true }, { requestToSend: false }]);
    expect(h.bauds).toEqual([9600]);
  });

  it('abort marks the running step aborted and skips the rest', async () => {
    let active = true;
    const h = harness(() => '', { isActive: () => active });
    h.io.sleep = async () => { active = false; };
    const r = await runScript([
      { id: '1', send: 'x', expect: 'never', timeoutMs: 5000 },
      { id: '2', send: 'y', expect: 'OK', timeoutMs: 100 },
    ], h.io, opts);
    expect(r.aborted).toBe(true);
    expect(r.results['1'].status).toBe('aborted');
    expect(r.results['2']).toBeUndefined();
  });

  it('reports an invalid regex as a failure, not a crash', async () => {
    const r = await runScript([{ id: '1', send: 'x', expect: '(', expectMode: 'regex', timeoutMs: 50 }], harness(() => '').io, opts);
    expect(r.results['1'].status).toBe('fail');
    expect(r.results['1'].error).toMatch(/invalid pattern/);
  });
});
