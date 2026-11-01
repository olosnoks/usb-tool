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
  const ctrlOut = [], ctrlIn = [], ctrlInFull = [];
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
      ctrlInFull.push({ request: setup.request, value: setup.value, index: setup.index, seq: ctrlOut.length });
      if (setup.request === 15) return { data: new DataView(new TextEncoder().encode('git-abc 2024').buffer) };
      if (setup.request === 14) return { data: new DataView(new Uint8Array([2]).buffer) }; // board id 2 = HackRF One
      if (setup.request === 45) return { data: new DataView(new Uint8Array([4]).buffer) }; // board rev
      // Gain requests (19/20) are IN transfers that ack with 1 (libhackrf), 0 = rejected.
      if (setup.request === 19) return { data: new DataView(new Uint8Array([setup.index <= 40 && setup.index % 8 === 0 ? 1 : 0]).buffer) };
      if (setup.request === 20) return { data: new DataView(new Uint8Array([setup.index <= 62 && setup.index % 2 === 0 ? 1 : 0]).buffer) };
      return { data: new DataView(new Uint8Array(len).buffer) };
    },
    async transferIn() { await new Promise((r) => setTimeout(r, 1)); return { data: new DataView(iq.buffer.slice(0)) }; },
    async close() { this.opened = false; }
  };
  return { dev, ctrlOut, ctrlIn, ctrlInFull };
}

describe('PortaPack Mayhem over WebUSB (simulated HackRF)', () => {
  it('runs the libhackrf bring-up in order and streams a real FFT spectrum', async () => {
    const { dev, ctrlOut, ctrlIn, ctrlInFull } = makeFakeHackRf();
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      const firstFrame = new Promise((res) => { d.onSpectrumCallback = (spec, peak) => res({ spec, peak }); });
      await d.connectWebUsb();

      expect(d.connectionType).toBe('webusb');
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

      // Freq (16) and amp (17) are OUT transfers; the gains (19 LNA, 20 VGA)
      // are IN transfers with the dB value in wIndex (libhackrf), never OUT.
      expect(ctrlOut.some((c) => c.request === 16)).toBe(true);
      expect(ctrlOut.some((c) => c.request === 17)).toBe(true);
      expect(ctrlOut.some((c) => c.request === 19 || c.request === 20)).toBe(false);
      const lna = ctrlInFull.filter((c) => c.request === 19), vga = ctrlInFull.filter((c) => c.request === 20);
      expect(lna.length).toBeGreaterThanOrEqual(2);          // before RECEIVE and re-asserted after the retune
      expect(lna.every((c) => c.index === 24 && c.value === 0)).toBe(true);
      expect(vga.every((c) => c.index === 24 && c.value === 0)).toBe(true);
      expect(ctrlIn).toContain(15); // version read
      expect(ctrlIn).toContain(14); // board id read
      expect(ctrlIn).toContain(45); // board rev read
      expect(d.boardRev).toBe(4);

      // Order: OFF, HW sync off, rate, filter, freq, amp, gains, RECEIVE, then the
      // +1 MHz / back cache-bust retune and the gains again (mayhem-mobile bring-up).
      const seq = ctrlOut.map((c) => c.request);
      const iOff = seq.indexOf(1), iSync = seq.indexOf(29), iRate = seq.indexOf(6), iBw = seq.indexOf(7), iFreq = seq.indexOf(16);
      const iRx = ctrlOut.findIndex((c) => c.request === 1 && c.value === 1);
      expect(iOff).toBeLessThan(iSync); expect(iSync).toBeLessThan(iRate); expect(iRate).toBeLessThan(iBw); expect(iBw).toBeLessThan(iFreq);
      expect(iFreq).toBeLessThan(iRx);
      const freqsAfterRx = ctrlOut.slice(iRx + 1).filter((c) => c.request === 16).map((c) => new DataView(c.data.buffer).getUint32(0, true));
      expect(freqsAfterRx.slice(0, 2)).toEqual([434, 433]);  // 433.92 + 1 MHz, then back
      expect(lna[lna.length - 1].seq).toBeGreaterThan(iRx);

      // A real averaged FFT came off the IQ stream: 1024 finite bins that are not all equal.
      const { spec, peak } = await firstFrame;
      expect(spec.length).toBe(1024);
      expect(Number.isFinite(peak)).toBe(true);
      expect(spec.every((v) => Number.isFinite(v))).toBe(true);
      expect(Math.max(...spec) - Math.min(...spec)).toBeGreaterThan(1);

      await d.disconnect();
      expect(d.connectionType).toBe(null);
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

describe('PortaPack Mayhem wideband sweep (simulated HackRF)', () => {
  it('retunes across the band, emits a segment per step, and restores the dial', async () => {
    const { dev, ctrlOut } = makeFakeHackRf();
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      await d.connectWebUsb();
      const startFreq = d.frequency;
      const segments = [];
      await d.sweepBand({ startHz: 100e6, endHz: 106e6, settleMs: 300, onSegment: (s) => segments.push(s) });
      // span 2 MHz, flat 60% = 1.2 MHz windows -> centers at 100.6/101.8/103.0/104.2/105.4 MHz
      expect(segments.length).toBe(5);
      expect(segments.every((s) => s.spec.length === 1024 && s.spanHz === 2000000 && s.useSpanHz === 1200000)).toBe(true);
      expect(Math.round(segments[0].centerHz)).toBe(100600000);
      // Each step issued a SET_FREQ (req 16); the dial returned to the start.
      expect(ctrlOut.filter((c) => c.request === 16).length).toBeGreaterThanOrEqual(6);
      expect(d.frequency).toBe(startFreq);
      await d.disconnect();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('stopSweep ends the sweep early', async () => {
    const { dev } = makeFakeHackRf();
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      await d.connectWebUsb();
      let count = 0;
      const p = d.sweepBand({ startHz: 100e6, endHz: 200e6, settleMs: 300, onSegment: () => { count++; if (count === 2) d.stopSweep(); } });
      await p;
      expect(count).toBe(2);
      await d.disconnect();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});


describe('PortaPack Mayhem WebUSB gains, AGC, capture (simulated HackRF)', () => {
  async function up() {
    const fake = makeFakeHackRf();
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => fake.dev, getDevices: async () => [] } });
    const d = new MayhemPortaPackDriver();
    const logs = [];
    d.onLogCallback = (e) => logs.push(e);
    await d.connectWebUsb();
    return { d, logs, ...fake };
  }

  it('rounds gains to the hardware steps and reports a firmware rejection', async () => {
    const { d, ctrlInFull, logs } = await up();
    try {
      await d.setWebUsbGains(30, 33);          // -> LNA 24 (8 dB steps), VGA 32 (2 dB steps)
      expect(d.lnaGain).toBe(24); expect(d.vgaGain).toBe(32);
      const last = ctrlInFull.slice(-2);
      expect(last.map((c) => [c.request, c.index])).toEqual([[19, 24], [20, 32]]);
      await d.sendCommand('lna 48');            // clamps to 40
      expect(d.lnaGain).toBe(40);
      // A device that acks 0 is reported, not silently accepted.
      d.usbDevice.controlTransferIn = async () => ({ data: new DataView(new Uint8Array([0]).buffer) });
      await d.setWebUsbGains(16, 16);
      expect(d.lnaGain).toBe(40);
      expect(logs.some((l) => /rejected by the firmware/.test(l.text))).toBe(true);
    } finally { await d.disconnect(); vi.unstubAllGlobals(); }
  });

  it('AGC raises the VGA when the IQ is quiet and lowers it when it is hot', async () => {
    const { d } = await up();
    try {
      d.setAgc(true);
      const vga0 = d.vgaGain;
      d._agcLastTs = -1e9; d._agcTick(2);      // quiet: 2 counts RMS
      await new Promise((r) => setTimeout(r, 5));
      expect(d.vgaGain).toBe(vga0 + 2);
      d._agcLastTs = -1e9; d._agcTick(60);     // hot: 60 counts RMS
      await new Promise((r) => setTimeout(r, 5));
      expect(d.vgaGain).toBe(vga0);
      d._agcLastTs = -1e9; d._agcTick(12);     // in the window: untouched
      await new Promise((r) => setTimeout(r, 5));
      expect(d.vgaGain).toBe(vga0);
      d.setAgc(false);
      d._agcLastTs = -1e9; d._agcTick(2);
      await new Promise((r) => setTimeout(r, 5));
      expect(d.vgaGain).toBe(vga0);            // off: no change
    } finally { await d.disconnect(); vi.unstubAllGlobals(); }
  });

  it('records the raw IQ stream and builds Mayhem C16 + sidecar from it', async () => {
    const { d } = await up();
    try {
      d.startCapture({ maxBytes: 6000 });
      await new Promise((r) => setTimeout(r, 40));
      const cap = d.stopCapture();
      expect(cap.bytes).toBe(6000);            // capped at the limit
      expect(cap.c8.length).toBe(6000);
      expect(cap.sampleRate).toBe(2000000);
      expect(cap.centerHz).toBe(433920000);
      expect(cap.sidecar).toBe('sample_rate=2000000\ncenter_frequency=433920000\n');
      const c16 = cap.toC16();
      expect(c16[0]).toBe(cap.c8[0] << 8);
      expect(d.captureStatus()).toBe(null);
    } finally { await d.disconnect(); vi.unstubAllGlobals(); }
  });

  it('changes the sample rate live and keeps the channel offset inside the span', async () => {
    const { d, ctrlOut } = await up();
    try {
      d.setChannelOffset(900000);
      expect(d.channelOffsetHz).toBe(900000);
      await d.setSampleRate(8000000);
      const rates = ctrlOut.filter((c) => c.request === 6).map((c) => new DataView(c.data.buffer).getUint32(0, true));
      expect(rates[rates.length - 1]).toBe(8000000);
      const bw = ctrlOut.filter((c) => c.request === 7).pop();
      expect(bw.value).toBe(7000000 & 0xffff);
      expect(d.sampleRate).toBe(8000000);
      expect(d.listeningHz).toBe(433920000 + 900000);
      d.setChannelOffset(5000000);               // beyond +/-4 MHz -> clamped
      expect(d.channelOffsetHz).toBe(4000000);
    } finally { await d.disconnect(); vi.unstubAllGlobals(); }
  });

  it('refuses a PortaPack still in Mayhem serial mode instead of pretending to stream', async () => {
    const { dev } = makeFakeHackRf();
    dev.productId = 0x6018;
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      await expect(d.connectWebUsb()).rejects.toThrow(/HackRF mode/);
      expect(d.isConnected).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
});


describe('PortaPack Mayhem WebUSB bring-up resilience (simulated HackRF)', () => {
  it('retries a step that fails once and still connects (names the step in the log)', async () => {
    const { dev, ctrlOut } = makeFakeHackRf();
    let failedOnce = false;
    const orig = dev.controlTransferOut.bind(dev);
    dev.controlTransferOut = async (setup, data) => {
      if (setup.request === 6 && !failedOnce) { failedOnce = true; throw new Error("Failed to execute 'controlTransferOut' on 'USBDevice': A transfer error has occurred."); }
      return orig(setup, data);
    };
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      const logs = [];
      d.onLogCallback = (e) => logs.push(e.text);
      await d.connectWebUsb();
      expect(d.connectionType).toBe('webusb');
      expect(logs.some((t) => /SAMPLE_RATE_SET 2 Msps failed .*retrying/.test(t))).toBe(true);
      expect(ctrlOut.filter((c) => c.request === 6).length).toBe(1);   // the retry landed
      expect(ctrlOut.some((c) => c.request === 1 && c.value === 1)).toBe(true);
      await d.disconnect();
    } finally { vi.unstubAllGlobals(); }
  });

  it('a step that keeps failing is skipped with a warning, unless it is RECEIVE', async () => {
    const { dev } = makeFakeHackRf();
    const orig = dev.controlTransferOut.bind(dev);
    dev.controlTransferOut = async (setup, data) => { if (setup.request === 29) throw new Error('transfer error'); return orig(setup, data); };
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      const logs = [];
      d.onLogCallback = (e) => logs.push(e.text);
      await d.connectWebUsb();                 // HW sync off is optional
      expect(d.connectionType).toBe('webusb');
      expect(logs.some((t) => /SET_HW_SYNC_MODE off failed again/.test(t))).toBe(true);
      await d.disconnect();

      dev.controlTransferOut = async (setup, data) => { if (setup.request === 1 && setup.value === 1) throw new Error('transfer error'); return orig(setup, data); };
      const d2 = new MayhemPortaPackDriver();
      await expect(d2.connectWebUsb()).rejects.toThrow(/SET_TRANSCEIVER_MODE RECEIVE failed twice/);
      expect(d2.isConnected).toBe(false);
      expect(dev.opened).toBe(false);          // closed again after the failure
    } finally { vi.unstubAllGlobals(); }
  });

  it('reads the board revision only after RX is up, so a stall on old firmware cannot break the bring-up', async () => {
    const { dev, ctrlInFull, ctrlOut } = makeFakeHackRf();
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      await d.connectWebUsb();
      const rev = ctrlInFull.find((c) => c.request === 45);
      const iRx = ctrlOut.findIndex((c) => c.request === 1 && c.value === 1);
      expect(rev.seq).toBeGreaterThan(iRx);
      await d.disconnect();
    } finally { vi.unstubAllGlobals(); }
  });
});


describe('PortaPack Mayhem WebUSB legacy bring-up fallback (simulated HackRF)', () => {
  it('falls back to retune-before-RECEIVE when the firmware refuses RECEIVE in the first order', async () => {
    const { dev, ctrlOut } = makeFakeHackRf();
    // This firmware accepts RECEIVE only right after a SET_FREQ (legacy order).
    const orig = dev.controlTransferOut.bind(dev);
    dev.controlTransferOut = async (setup, data) => {
      if (setup.request === 1 && setup.value === 1) {
        const prev = ctrlOut[ctrlOut.length - 1];
        if (!prev || prev.request !== 16) throw new Error("Failed to execute 'controlTransferOut' on 'USBDevice': A transfer error has occurred.");
      }
      return orig(setup, data);
    };
    let resets = 0;
    dev.reset = async () => { resets++; };
    dev.releaseInterface = async () => {};
    vi.stubGlobal('navigator', { usb: { requestDevice: async () => dev, getDevices: async () => [] } });
    try {
      const d = new MayhemPortaPackDriver();
      const logs = [];
      d.onLogCallback = (e) => logs.push(e.text);
      await d.connectWebUsb();
      expect(d.connectionType).toBe('webusb');
      expect(d.bringUpOrder).toBe('legacy');
      expect(resets).toBe(1);
      expect(logs.some((t) => /Retrying with the legacy bring-up order/.test(t))).toBe(true);
      expect(logs.some((t) => /RX engaged \(legacy order\)/.test(t))).toBe(true);
      // In the legacy order the gains are set after RECEIVE.
      const rxIdx = ctrlOut.map((c, i) => (c.request === 1 && c.value === 1 ? i : -1)).filter((i) => i >= 0).pop();
      expect(rxIdx).toBeGreaterThan(0);
      await d.disconnect();
    } finally { vi.unstubAllGlobals(); }
  });
});
