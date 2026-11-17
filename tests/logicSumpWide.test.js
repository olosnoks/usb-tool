import { describe, it, expect } from 'vitest';
import { SerialLink, FakeSerialPort } from '../src/utils/serialLink';
import {
  SumpAnalyzer, SUMP, sumpCapabilities, unpackSumpSamples, Fx2LogicAnalyzer, fx2StartCommand, FX2LAFW
} from '../src/utils/logicAnalyzerDriver';
import { decodeUartFrames, exportSigrok, importSigrok, exportVcd, importVcd, serializeLogicSession, parseLogicSession } from '../src/utils/logicDecoders';
import { SignalWriter, synthUart } from '../src/utils/logicSynth';

// SUMP metadata numbers are big-endian
const u32 = (v) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];

// A SUMP device reporting `probes` channels and `memory` bytes; sends `source(n)` samples newest first.
function fakeSump({ probes = 16, memory = 131072, source }) {
  const st = { cmds: [] };
  let pending = [];
  const groups = Math.ceil(probes / 8);
  const port = new FakeSerialPort((bytes, p) => {
    pending.push(...bytes);
    while (pending.length) {
      const c = pending[0];
      if (c >= 0x80) {
        if (pending.length < 5) return;
        const v = (pending[1] | (pending[2] << 8) | (pending[3] << 16) | (pending[4] << 24)) >>> 0;
        st.cmds.push([c, v]);
        if (c === SUMP.READ_DELAY) { st.quads = (v & 0xffff) + 1; st.delayQuads = (v >>> 16) + 1; }
        if (c === SUMP.FLAGS) st.flags = v;
        pending = pending.slice(5);
        continue;
      }
      pending = pending.slice(1);
      if (c === SUMP.ID) p.feed(new TextEncoder().encode('1ALS'));
      if (c === SUMP.METADATA) {
        p.feed([0x01, ...new TextEncoder().encode('WideBoard'), 0x00, 0x20, ...u32(probes), 0x21, ...u32(memory), 0x23, ...u32(4_000_000), 0x00]);
      }
      if (c === SUMP.RUN) {
        const samples = source(st.quads * 4); // oldest first
        const out = [];
        for (let i = samples.length - 1; i >= 0; i--) for (let g = 0; g < groups; g++) out.push((samples[i] >>> (8 * g)) & 0xff);
        p.feed(out);
      }
    }
  });
  return { port, st };
}

async function connect(opts) {
  const f = fakeSump(opts);
  const link = new SerialLink(f.port);
  await link.open({ baudRate: 115200 });
  const la = new SumpAnalyzer(link);
  const id = await la.identify();
  return { ...f, la, id };
}

describe('SUMP capabilities from metadata', () => {
  it('derives channels, groups, bytes per sample and the memory limit', () => {
    expect(sumpCapabilities({ probes: 16, sampleMemory: 131072 })).toEqual({ channels: 16, groups: 2, bytesPerSample: 2, maxSamples: 65536 });
    expect(sumpCapabilities({})).toEqual({ channels: 8, groups: 1, bytesPerSample: 1, maxSamples: null });
    expect(sumpCapabilities({ probes: 32 }).groups).toBe(4);
  });

  it('unpacks 1, 2 and 4 byte samples, oldest first', () => {
    expect(unpackSumpSamples([3, 2, 1], 1)).toBeInstanceOf(Uint8Array);
    expect(Array.from(unpackSumpSamples([3, 2, 1], 1))).toEqual([1, 2, 3]);
    const w = unpackSumpSamples([0x34, 0x12, 0x78, 0x56], 2); // newest first: 0x5678 then 0x1234
    expect(w).toBeInstanceOf(Uint16Array);
    expect(Array.from(w)).toEqual([0x5678, 0x1234]);
    const q = unpackSumpSamples([1, 2, 3, 0x80], 4);
    expect(q).toBeInstanceOf(Uint32Array);
    expect(q[0]).toBe(0x80030201);
  });
});

describe('16-channel SUMP capture', () => {
  const rate = 1_000_000;
  const n = 6000;
  const uartSource = () => {
    const buf = new Uint16Array(n);
    const w = new SignalWriter(buf, rate, { 12: 1 });
    w.at(100);
    synthUart(w, 12, [0x4f, 0x4b], { baud: 9600 });
    return Array.from(buf);
  };

  it('reports 16 channels, enables two groups and decodes UART on channel 12', async () => {
    const { la, st, id } = await connect({ source: uartSource });
    expect(id).toMatchObject({ probes: 16, channels: 16, maxSamples: 65536 });
    const r = await la.capture({ sampleRate: rate, samples: n });
    expect(st.flags).toBe(0x30); // groups 2 and 3 off
    expect(r.samples).toBeInstanceOf(Uint16Array);
    expect(r.samples.length).toBe(n);
    expect(r.channels).toBe(16);
    const out = decodeUartFrames(r.samples, { channel: 12, baud: 9600, sampleRate: r.sampleRate });
    expect(out.map((o) => o.byte)).toEqual([0x4f, 0x4b]);
    expect(decodeUartFrames(r.samples, { channel: 2, baud: 9600, sampleRate: r.sampleRate })).toEqual([]);
  });

  it('keeps an 8-bit device on the Uint8Array fast path', async () => {
    const { la, st } = await connect({ probes: 8, memory: 4096, source: (c) => Array.from({ length: c }, (_, i) => i & 0xff) });
    const r = await la.capture({ sampleRate: rate, samples: 1024 });
    expect(st.flags).toBe(0x38);
    expect(r.samples).toBeInstanceOf(Uint8Array);
    expect(Array.from(r.samples.slice(0, 3))).toEqual([0, 1, 2]);
  });

  it('refuses a capture larger than the sample memory', async () => {
    const { la } = await connect({ probes: 16, memory: 8192, source: () => [] });
    await expect(la.capture({ sampleRate: rate, samples: 5000 })).rejects.toThrow(/at most 4,?096 samples/);
  });

  it('sends level trigger mask/value/config on stage 0 as wide values', async () => {
    const { la, st } = await connect({ source: (c) => new Array(c).fill(0) });
    await la.capture({ sampleRate: rate, samples: 400, triggerMask: 0x1000, triggerValue: 0x1000 });
    const trig = st.cmds.filter(([c]) => c >= 0xc0);
    expect(trig).toEqual([[0xc0, 0x1000], [0xc1, 0x1000], [0xc2, 0x08000000]]);
  });

  it('programs a rising edge as two stages, falling as the reverse', async () => {
    const { la, st } = await connect({ source: (c) => new Array(c).fill(0) });
    await la.capture({ sampleRate: rate, samples: 400, edge: { channel: 5, kind: 'rising' } });
    expect(st.cmds.filter(([c]) => c >= 0xc0)).toEqual([
      [0xc0, 0x20], [0xc1, 0x00], [0xc2, 0x00000000],
      [0xc4, 0x20], [0xc5, 0x20], [0xc6, 0x08010000]
    ]);
    st.cmds.length = 0;
    await la.capture({ sampleRate: rate, samples: 400, edge: { channel: 5, kind: 'falling' } });
    const t = st.cmds.filter(([c]) => c >= 0xc0);
    expect(t[1]).toEqual([0xc1, 0x20]);
    expect(t[4]).toEqual([0xc5, 0x00]);
    await expect(la.capture({ sampleRate: rate, samples: 400, edge: { channel: 16, kind: 'rising' } })).rejects.toThrow(/16-channel/);
  });

  it('the pre-trigger fraction moves the delay count and the trigger index', async () => {
    const { la, st } = await connect({ source: (c) => new Array(c).fill(0) });
    const a = await la.capture({ sampleRate: rate, samples: 4000, triggerMask: 1, triggerValue: 1 });
    expect(st.quads).toBe(1000);
    expect(st.delayQuads).toBe(1000);
    expect(a.triggerIndex).toBe(0);
    const b = await la.capture({ sampleRate: rate, samples: 4000, triggerMask: 1, triggerValue: 1, preTrigger: 0.5 });
    expect(st.delayQuads).toBe(500);
    expect(b.triggerIndex).toBe(2000);
    const c = await la.capture({ sampleRate: rate, samples: 4000, triggerMask: 1, triggerValue: 1, preTrigger: 0.25 });
    expect(c.triggerIndex).toBe(1000);
    const none = await la.capture({ sampleRate: rate, samples: 4000 });
    expect(none.triggerIndex).toBeNull();
  });
});

describe('fx2lafw wide mode', () => {
  it('sets the 16-bit flag and returns a Uint16Array', async () => {
    expect(fx2StartCommand(1_000_000, { wide: true })[0]).toBe(FX2LAFW.FLAG_CLK_48MHZ | FX2LAFW.FLAG_WIDE);
    expect(fx2StartCommand(1_000_000)[0]).toBe(FX2LAFW.FLAG_CLK_48MHZ);
    const calls = [];
    let counter = 0;
    const dev = {
      vendorId: FX2LAFW.VID, productId: FX2LAFW.PID, configuration: {},
      async controlTransferOut(setup, data) { calls.push([setup.request, Array.from(data)]); return { status: 'ok' }; },
      async transferIn(ep, len) {
        const u8 = Uint8Array.from({ length: len }, () => counter++ & 0xff);
        return { status: 'ok', data: new DataView(u8.buffer) };
      }
    };
    const r = await new Fx2LogicAnalyzer(dev).capture({ sampleRate: 1_000_000, samples: 1000, wide: true });
    expect(r.samples).toBeInstanceOf(Uint16Array);
    expect(r.samples.length).toBe(1000);
    expect(r.samples[0]).toBe(0x0100);
    expect(r.samples[1]).toBe(0x0302);
    expect(calls[0][1][0] & FX2LAFW.FLAG_WIDE).toBeTruthy();
  });
});

describe('wide captures in files and sessions', () => {
  const wide = Uint16Array.from([0, 0x1000, 0x1001, 0x8000, 0xffff, 0x0f0f]);

  it('round-trips through sigrok and VCD with 16 channels', async () => {
    const sr = await importSigrok(await exportSigrok(wide, 1e6, [], 16));
    expect(sr.samples).toBeInstanceOf(Uint16Array);
    expect(Array.from(sr.samples)).toEqual(Array.from(wide));
    expect(sr.names).toHaveLength(16);
    const vcd = importVcd(exportVcd(wide, 1e6, [], 16), { sampleRate: 1e6 });
    expect(Array.from(vcd.samples)).toEqual(Array.from(wide));
  });

  it('saves and loads a session with samples, rate, names and decoder setup', () => {
    const text = serializeLogicSession({
      samples: wide, sampleRate: 2e6, channelNames: ['a', 'b'], channelCount: 16, decoderId: 'uart',
      decoderConfig: { uart: { channels: { rx: 12 }, params: { baud: 9600 } } }, stackId: 'nmea', cursors: [1, 3], triggerIndex: 2
    });
    const s = parseLogicSession(text);
    expect(s.samples).toBeInstanceOf(Uint16Array);
    expect(Array.from(s.samples)).toEqual(Array.from(wide));
    expect(s).toMatchObject({ sampleRate: 2e6, channelCount: 16, channelNames: ['a', 'b'], decoderId: 'uart', stackId: 'nmea', cursors: [1, 3], triggerIndex: 2 });
    expect(s.decoderConfig.uart.params.baud).toBe(9600);
    const s8 = parseLogicSession(serializeLogicSession({ samples: Uint8Array.from([1, 2, 255]), sampleRate: 1e6 }));
    expect(s8.samples).toBeInstanceOf(Uint8Array);
    expect(Array.from(s8.samples)).toEqual([1, 2, 255]);
  });

  it('rejects malformed sessions', () => {
    expect(() => parseLogicSession('nope')).toThrow(/JSON/);
    expect(() => parseLogicSession('{"format":"x"}')).toThrow(/session file/);
    const ok = JSON.parse(serializeLogicSession({ samples: Uint8Array.from([1, 2, 3]), sampleRate: 1e6 }));
    expect(() => parseLogicSession(JSON.stringify({ ...ok, sampleCount: 9 }))).toThrow(/truncated/);
    expect(() => parseLogicSession(JSON.stringify({ ...ok, sampleRate: 0 }))).toThrow(/sample rate/);
  });
});
