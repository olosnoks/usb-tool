import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MayhemPortaPackDriver, basebandFilterBwForRate } from '../src/utils/mayhemDriver';
import { _resetPortManager } from '../src/utils/portManager';

const enc = new TextEncoder(), dec = new TextDecoder();

// Fake Mayhem USB serial console: echoes the command, prints its output, then
// the `ch>` prompt. Output is delivered in small, uneven chunks so lines and
// prompts arrive split, as they do over USB.
function makeFakeMayhem() {
  let controller, pending = '';
  const dev = { sent: [], freq: null, buttons: [], touches: [] };
  const SCREEN = ['  __', ' _ _', '____'];   // 4x3 test frame
  const reply = (text) => {
    const bytes = enc.encode(text);
    let i = 0, k = 0;
    while (i < bytes.length) { const n = 1 + ((k++ * 7) % 5); controller.enqueue(bytes.slice(i, i + n)); i += n; }
  };
  function run(cmd) {
    dev.sent.push(cmd);
    const [verb, ...args] = cmd.split(' ');
    let out = '';
    if (verb === 'info') out = 'Mayhem v2.1.0\r\nHackRF One r10\r\n';
    else if (verb === 'setfreq') { dev.freq = +args[0]; out = 'ok\r\n'; }
    else if (verb === 'button') { dev.buttons.push(+args[0]); out = 'ok\r\n'; }
    else if (verb === 'touch') { dev.touches.push(args.map(Number)); out = 'ok\r\n'; }
    else if (verb === 'screenframeshort') out = SCREEN.join('\r\n') + '\r\n';
    else if (verb === 'applist') out = 'adsbrx\r\nsubghzd\r\n';
    else out = `${verb}: command not found\r\n`;
    reply(cmd + '\r\n' + out + 'ch> ');
  }
  const port = {
    readable: null, writable: null,
    getInfo: () => ({ usbVendorId: 0x1d50, usbProductId: 0x6018 }),
    async open() {
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({
        write(ch) {
          pending += dec.decode(ch);
          let n;
          while ((n = pending.indexOf('\r\n')) >= 0) { const l = pending.slice(0, n); pending = pending.slice(n + 2); setTimeout(() => run(l), 5); }
        }
      });
    },
    async close() { this.readable = null; this.writable = null; }
  };
  dev.asyncLine = (t) => reply(t);
  return { port, dev };
}

async function connected() {
  const { port, dev } = makeFakeMayhem();
  const serial = { requestPort: async () => port, addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial } });
  const d = new MayhemPortaPackDriver();
  const logs = [];
  d.onLogCallback = (e) => logs.push(e);
  await d.connectHardware();
  return { d, dev, logs };
}

beforeEach(() => _resetPortManager());

describe('PortaPack Mayhem serial console (simulated device)', () => {
  it('reads the real identity on connect instead of keeping the demo one', async () => {
    const { d } = await connected();
    expect(d.isDemo).toBe(false);
    expect(d.firmwareVersion).toBe('Mayhem v2.1.0');
    expect(d.batteryMv).toBe(null);
    expect(d.boardId).toBe(null);
    await d.disconnect();
  });

  it('tunes with setfreq, presses real buttons, and touches', async () => {
    const { d, dev } = await connected();
    await d.sendCommand('freq 433920000');
    expect(dev.freq).toBe(433920000);
    expect(d.frequency).toBe(433920000);
    d.pressKey('up'); d.pressKey('select'); d.pressKey('step_up');
    await d.sendTouch(10, 20);
    expect(dev.buttons).toEqual([4, 5, 8]);
    expect(dev.touches).toEqual([[10, 20]]);
    await d.disconnect();
  });

  it('serializes overlapping commands instead of colliding on the writer', async () => {
    const { d, dev } = await connected();
    await Promise.all([d.sendCommand('freq 100000000'), d.sendCommand('freq 200000000'), d.sendCommand('freq 300000000')]);
    expect(dev.sent.filter((c) => c.startsWith('setfreq'))).toEqual(['setfreq 100000000', 'setfreq 200000000', 'setfreq 300000000']);
    expect(d.frequency).toBe(300000000);
    await d.disconnect();
  });

  it('says amp / gain need HackRF mode instead of sending unknown commands', async () => {
    const { d, dev, logs } = await connected();
    const before = dev.sent.length;
    await d.sendCommand('amp 1');
    expect(dev.sent.length).toBe(before);
    expect(logs.some((l) => /isn't available over the Mayhem serial console/.test(l.text))).toBe(true);
    await d.disconnect();
  });

  it('decodes screenframeshort into RGBA', async () => {
    const { d } = await connected();
    const f = await d.captureScreen();
    expect([f.width, f.height]).toEqual([4, 3]);
    // ' ' (32) = black, '_' (95) = 63 = white
    expect(Array.from(f.rgba.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(f.rgba.slice(8, 12))).toEqual([255, 255, 255, 255]);
    await d.disconnect();
  });

  it('reassembles async lines split across chunks', async () => {
    const { d, dev, logs } = await connected();
    dev.asyncLine('*8D4840D6202CC371C32CE0576098;\r\nhello from mayhem\r\n');
    await new Promise((r) => setTimeout(r, 30));
    expect(logs.some((l) => l.text === '[MAYHEM] hello from mayhem')).toBe(true);
    expect(logs.some((l) => l.text === '[MAYHEM] *8D4840D6202CC371C32CE0576098;')).toBe(true);
    await d.disconnect();
  });

  it('demo mode still works and keeps its labeled identity', async () => {
    const d = new MayhemPortaPackDriver();
    await d.connectDemo();
    expect(d.isDemo).toBe(true);
    expect(d.firmwareVersion).toMatch(/Mayhem/);
    await d.sendCommand('freq 915000000');
    expect(d.frequency).toBe(915000000);
  });
});


describe('HackRF baseband filter selection', () => {
  it('picks the largest libhackrf filter strictly below the sample rate', () => {
    expect(basebandFilterBwForRate(2000000)).toBe(1750000);
    expect(basebandFilterBwForRate(8000000)).toBe(7000000);
    expect(basebandFilterBwForRate(10000001)).toBe(10000000);
    expect(basebandFilterBwForRate(500000)).toBe(1750000);   // floor at the narrowest
    expect(basebandFilterBwForRate(1e9)).toBe(28000000);     // cap at the widest
  });
});

// A fake HackRF One over WebUSB: records control transfers, answers the
// version/board reads, and streams a tone on the bulk IN endpoint.
function makeFakeHackRf() {
  const ctrlOut = [], ctrlIn = [];
  const iq = new Int8Array(2048);
  for (let k = 0; k < 1024; k++) { iq[2 * k] = Math.round(110 * Math.cos(k / 4)); iq[2 * k + 1] = Math.round(110 * Math.sin(k / 4)); }
  const dev = {
    vendorId: 0x1d50, productId: 0x6089, productName: 'HackRF One', opened: false,
    configuration: null,
    async open() { this.opened = true; },
    async selectConfiguration() {
      this.configuration = { interfaces: [{ claimed: true, alternate: { endpoints: [
        { direction: 'in', type: 'bulk', endpointNumber: 1 }, { direction: 'out', type: 'bulk', endpointNumber: 2 }
      ] } }] };
    },
    async claimInterface() {},
    async controlTransferOut(setup, data) { ctrlOut.push({ request: setup.request, value: setup.value, index: setup.index, data: data ? new Uint8Array(data) : null }); return { status: 'ok' }; },
    async controlTransferIn(setup, len) {
      ctrlIn.push(setup.request);
      if (setup.request === 15) return { data: new DataView(new TextEncoder().encode('git-abc 2024').buffer) };
      if (setup.request === 14) return { data: new DataView(new Uint8Array([2]).buffer) }; // board id 2 = HackRF One
      return { data: new DataView(new Uint8Array(len).buffer) };
    },
    async transferIn() { await Promise.resolve(); return { data: new DataView(iq.buffer.slice(0)) }; },
    async close() { this.opened = false; }
  };
  return { dev, ctrlOut, ctrlIn };
}

describe('PortaPack Mayhem over WebUSB (simulated HackRF)', () => {
  it('runs the libhackrf bring-up in order and streams a real FFT spectrum', async () => {
    const { dev, ctrlOut, ctrlIn } = makeFakeHackRf();
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      const firstFrame = new Promise((res) => { d.onSpectrumCallback = (spec, peak) => res({ spec, peak }); });
      await d.connectWebUsb();

      expect(d.connectionType).toBe('webusb');
      expect(d.isDemo).toBe(false);
      expect(d.rxEndpoint).toBe(1);                 // discovered bulk IN 0x81
      expect(d.firmwareVersion).toBe('git-abc 2024');
      expect(d.boardId).toBe('HackRF One');

      // Transceiver mode (req 1): OFF (0) must come before RECEIVE (1).
      const modes = ctrlOut.filter((c) => c.request === 1).map((c) => c.value);
      expect(modes[0]).toBe(0);
      expect(modes).toContain(1);

      // Sample rate (req 6) = 2 MSPS; baseband filter (req 7) = 1.75 MHz.
      const rate = ctrlOut.find((c) => c.request === 6);
      expect(new DataView(rate.data.buffer).getUint32(0, true)).toBe(2000000);
      expect(ctrlOut.find((c) => c.request === 7).value).toBe(1750000 & 0xffff);

      // Freq (16), amp (17) and both gains (19 LNA, 20 VGA) were issued.
      expect(ctrlOut.some((c) => c.request === 16)).toBe(true);
      expect(ctrlOut.some((c) => c.request === 17)).toBe(true);
      expect(ctrlOut.some((c) => c.request === 19)).toBe(true);
      expect(ctrlOut.some((c) => c.request === 20)).toBe(true);
      expect(ctrlIn).toContain(15); // version read
      expect(ctrlIn).toContain(14); // board id read

      // A real FFT came off the IQ stream: 256 finite bins that are not all equal.
      const { spec, peak } = await firstFrame;
      expect(spec.length).toBe(256);
      expect(Number.isFinite(peak)).toBe(true);
      expect(spec.every((v) => Number.isFinite(v))).toBe(true);
      expect(Math.max(...spec) - Math.min(...spec)).toBeGreaterThan(1);

      await d.disconnect();
      expect(d.connectionType).toBe('demo');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('PortaPack Mayhem WebUSB streaming concurrency', () => {
  it('keeps several IQ transfers in flight at once (RocketGod pump model)', async () => {
    const { dev } = makeFakeHackRf();
    let inFlight = 0, maxInFlight = 0;
    const tone = new Int8Array(2048);
    for (let k = 0; k < 1024; k++) { tone[2 * k] = Math.round(90 * Math.cos(k / 3)); tone[2 * k + 1] = Math.round(90 * Math.sin(k / 3)); }
    dev.transferIn = async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { status: 'ok', data: new DataView(tone.buffer.slice(0)) };
    };
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      await d.connectWebUsb();
      await new Promise((r) => setTimeout(r, 40)); // let the pumps overlap
      expect(maxInFlight).toBeGreaterThan(1);       // not a single serial reader
      await d.disconnect();
      expect(inFlight).toBe(0);                     // every transfer unwound
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
