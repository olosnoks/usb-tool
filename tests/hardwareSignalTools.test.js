import { describe, it, expect } from 'vitest';
import {
  parseEsptoolSequence, toEsptoolSequence, diffInputSignals, recordSignalEvents,
  formatSignalEvents, pulseSignal
} from '../src/utils/hardwareSignalTools';

describe('esptool sequence strings', () => {
  it('parses the classic reset sequence', () => {
    expect(parseEsptoolSequence('D0|R1|W0.1|D1|R0|W0.05|D0')).toEqual([
      { dtr: false, rts: true, waitMs: 100 },
      { dtr: true, rts: false, waitMs: 50 },
      { dtr: false, waitMs: 0 }
    ]);
  });
  it('round-trips through toEsptoolSequence', () => {
    const s = 'D0|R1|W0.1|D1|R0|W0.05|D0';
    expect(toEsptoolSequence(parseEsptoolSequence(s))).toBe(s);
  });
  it('is case and space tolerant', () => {
    expect(parseEsptoolSequence(' d1 | r0 | w0.5 ')).toEqual([{ dtr: true, rts: false, waitMs: 500 }]);
  });
  it('rejects bad input with readable errors', () => {
    expect(() => parseEsptoolSequence('')).toThrow(/Enter a sequence/);
    expect(() => parseEsptoolSequence('D2')).toThrow(/0 or 1/);
    expect(() => parseEsptoolSequence('X1')).toThrow(/unknown command/);
    expect(() => parseEsptoolSequence('W')).toThrow(/seconds/);
    expect(() => parseEsptoolSequence('W-1')).toThrow(/seconds/);
    expect(() => parseEsptoolSequence('W60')).toThrow(/limited/);
    expect(() => parseEsptoolSequence('|')).toThrow(/no commands/);
  });
});

describe('input signal log', () => {
  it('detects only changed inputs', () => {
    const a = { cts: false, dsr: true, dcd: false, ri: false, dtr: true };
    const b = { cts: true, dsr: true, dcd: false, ri: true, dtr: false };
    expect(diffInputSignals(a, b)).toEqual([{ name: 'cts', level: true }, { name: 'ri', level: true }]);
    expect(diffInputSignals(null, b)).toEqual([]);
  });
  it('records events, counts and caps the log', () => {
    let st = { events: [], counts: { cts: 0, dsr: 0, dcd: 0, ri: 0 } };
    st = recordSignalEvents(st, [{ name: 'cts', level: true }], 1000);
    st = recordSignalEvents(st, [{ name: 'cts', level: false }, { name: 'dsr', level: true }], 1500);
    expect(st.counts).toEqual({ cts: 2, dsr: 1, dcd: 0, ri: 0 });
    expect(formatSignalEvents(st.events)).toBe('+0.000s CTS -> HIGH\n+0.500s CTS -> LOW\n+0.500s DSR -> HIGH');
    for (let i = 0; i < 250; i++) st = recordSignalEvents(st, [{ name: 'ri', level: i % 2 === 0 }], 2000 + i);
    expect(st.events.length).toBe(200);
  });
});

describe('pulseSignal', () => {
  it('asserts then restores the line', async () => {
    const calls = [];
    let t = 0;
    const port = { setSignals: async (s) => { calls.push(s); } };
    const held = await pulseSignal(port, 'rts', 120, { sleep: async (ms) => { t += ms; }, now: () => t });
    expect(calls).toEqual([{ requestToSend: true }, { requestToSend: false }]);
    expect(held).toBe(120);
  });
  it('restores to a given level and validates input', async () => {
    const calls = [];
    const port = { setSignals: async (s) => { calls.push(s); } };
    await pulseSignal(port, 'dtr', 5, { restore: true, sleep: async () => {} });
    expect(calls[1]).toEqual({ dataTerminalReady: true });
    await expect(pulseSignal(port, 'cts', 5)).rejects.toThrow(/Only DTR/);
    await expect(pulseSignal(port, 'dtr', 0)).rejects.toThrow(/Pulse length/);
    await expect(pulseSignal({}, 'dtr', 5)).rejects.toThrow(/setSignals/);
  });
});
