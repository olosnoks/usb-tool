import { describe, it, expect } from 'vitest';
import { SerialLink, FakeSerialPort } from '../src/utils/serialLink';
import { SumpAnalyzer, parseSumpMetadata, Fx2LogicAnalyzer, fx2StartCommand, FX2LAFW, SUMP } from '../src/utils/logicAnalyzerDriver';

// An Arduino-style SUMP sketch: answers ID + metadata, captures a counter
// pattern and sends it newest sample first.
function fakeSump({ withMetadata = true } = {}) {
  const st = { divider: null, quads: null, flags: null };
  let pending = [];
  const port = new FakeSerialPort((bytes, p) => {
    pending.push(...bytes);
    while (pending.length) {
      const c = pending[0];
      if (c >= 0x80) {
        if (pending.length < 5) return;
        const v = pending[1] | (pending[2] << 8) | (pending[3] << 16) | (pending[4] << 24);
        if (c === SUMP.DIVIDER) st.divider = v;
        if (c === SUMP.READ_DELAY) st.quads = (v & 0xffff) + 1;
        if (c === SUMP.FLAGS) st.flags = v;
        pending = pending.slice(5);
        continue;
      }
      pending = pending.slice(1);
      if (c === SUMP.ID) p.feed(new TextEncoder().encode('1ALS'));
      if (c === SUMP.METADATA && withMetadata) {
        p.feed([0x01, ...new TextEncoder().encode('AGLAv0'), 0x00, 0x20, 0, 0, 0, 8, 0x23, 0x00, 0x3d, 0x09, 0x00, 0x00]);
      }
      if (c === SUMP.RUN) {
        const n = st.quads * 4;
        const data = Array.from({ length: n }, (_, i) => i & 0xff);
        p.feed(data.reverse());
      }
    }
  });
  return { port, st };
}

describe('SUMP capture', () => {
  it('identifies the device and reads its metadata', async () => {
    const { port } = fakeSump();
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    const la = new SumpAnalyzer(link);
    const id = await la.identify();
    expect(id).toMatchObject({ id: '1ALS', name: 'AGLAv0', probes: 8, maxSampleRate: 4000000 });
  });

  it('works without metadata support', async () => {
    const { port } = fakeSump({ withMetadata: false });
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    expect((await new SumpAnalyzer(link).identify()).id).toBe('1ALS');
  });

  it('programs divider, count and channel groups, and un-reverses the data', async () => {
    const { port, st } = fakeSump();
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    const la = new SumpAnalyzer(link);
    await la.identify();
    const r = await la.capture({ sampleRate: 1_000_000, samples: 1024 });
    expect(st.divider).toBe(99);    // 100 MHz / 1 MHz - 1
    expect(st.quads).toBe(256);     // 1024 / 4
    expect(st.flags).toBe(0x38);    // groups 1-3 off
    expect(r.samples.length).toBe(1024);
    expect(Array.from(r.samples.slice(0, 4))).toEqual([0, 1, 2, 3]); // oldest first
  });

  it('decodes metadata strings and numbers', () => {
    expect(parseSumpMetadata([0x01, 0x41, 0x00, 0x40, 0x08, 0x00])).toEqual({ name: 'A', probes: 8 });
  });
});

describe('fx2lafw', () => {
  it('builds the start command from the 48 or 30 MHz clock', () => {
    expect(fx2StartCommand(24_000_000)).toEqual([FX2LAFW.FLAG_CLK_48MHZ, 0, 1]);
    expect(fx2StartCommand(1_000_000)).toEqual([FX2LAFW.FLAG_CLK_48MHZ, 0, 47]);
    expect(fx2StartCommand(20_000)).toEqual([0, 0x05, 0xdb]); // 30 MHz / 20 kHz - 1 = 1499
    expect(() => fx2StartCommand(10_000)).toThrow();
  });

  function fakeUsb({ vendorId = FX2LAFW.VID, productId = FX2LAFW.PID } = {}) {
    const calls = [];
    let counter = 0;
    return {
      vendorId, productId, configuration: null, calls,
      async open() {}, async close() { calls.push(['close']); },
      async selectConfiguration() { this.configuration = {}; },
      async claimInterface(n) { calls.push(['claim', n]); },
      async releaseInterface() {},
      async controlTransferOut(setup, data) { calls.push(['out', setup.request, setup.value, Array.from(data)]); return { status: 'ok' }; },
      async controlTransferIn(setup) {
        calls.push(['in', setup.request]);
        return { status: 'ok', data: new DataView(Uint8Array.from([1, 3]).buffer) };
      },
      async transferIn(ep, len) {
        const u8 = Uint8Array.from({ length: len }, () => counter++ & 0xff);
        return { status: 'ok', data: new DataView(u8.buffer) };
      }
    };
  }

  it('uploads firmware to the FX2 RAM between CPU reset and run', async () => {
    const dev = fakeUsb({ vendorId: 0x0925, productId: 0x3881 });
    const la = new Fx2LogicAnalyzer(dev);
    expect(la.needsFirmware).toBe(true);
    await la.open();
    await la.uploadFirmware(new Uint8Array(5000).fill(0x12));
    const outs = dev.calls.filter((c) => c[0] === 'out');
    expect(outs[0]).toEqual(['out', 0xa0, 0xe600, [1]]);
    expect(outs[1].slice(1, 3)).toEqual([0xa0, 0]);
    expect(outs[1][3].length).toBe(4096);
    expect(outs[2].slice(1, 3)).toEqual([0xa0, 4096]);
    expect(outs.at(-1)).toEqual(['out', 0xa0, 0xe600, [0]]);
  });

  it('checks the firmware version and streams the requested samples', async () => {
    const dev = fakeUsb();
    const la = new Fx2LogicAnalyzer(dev);
    await la.open();
    expect(await la.start()).toBe('1.3');
    const r = await la.capture({ sampleRate: 4_000_000, samples: 40000 });
    expect(r.samples.length).toBe(40000);
    expect(r.samples[0]).toBe(0);
    expect(r.samples[300]).toBe(300 & 0xff);
    const start = dev.calls.find((c) => c[0] === 'out' && c[1] === FX2LAFW.CMD_START);
    expect(start[3]).toEqual([FX2LAFW.FLAG_CLK_48MHZ, 0, 11]);
  });
});
