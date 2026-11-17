/**
 * Logic analyzer capture drivers: SUMP / OpenBench Logic Sniffer devices over Web
 * Serial (up to 32 channels, as the device reports them) and fx2lafw boards
 * over WebUSB (8 channels, or 16 in wide mode). Protocol decoding lives in
 * logicDecoders.js.
 */

export const SAMPLE_RATES = [
  { value: 24000000, label: '24 MHz (41.6 ns/sample)' },
  { value: 16000000, label: '16 MHz (62.5 ns/sample)' },
  { value: 12000000, label: '12 MHz (83.3 ns/sample)' },
  { value: 8000000,  label: '8 MHz (125 ns/sample)' },
  { value: 4000000,  label: '4 MHz (250 ns/sample)' },
  { value: 2000000,  label: '2 MHz (500 ns/sample)' },
  { value: 1000000,  label: '1 MHz (1 µs/sample)' },
  { value: 500000,   label: '500 kHz (2 µs/sample)' },
  { value: 200000,   label: '200 kHz (5 µs/sample)' },
  { value: 100000,   label: '100 kHz (10 µs/sample)' },
  { value: 50000,    label: '50 kHz (20 µs/sample)' },
  { value: 20000,    label: '20 kHz (50 µs/sample)' }
];

export const FX2_USB = {
  VID_SALEAE: 0x0925,
  PID_SALEAE: 0x3881,
  VID_USBEE: 0x08A9,
  PID_USBEE: 0x0014
};

// ---------------------------------------------------------------------------
// Real capture hardware
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const le32 = (n) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];

// SUMP / OpenBench Logic Sniffer protocol. Spoken by the OLS, and by the
// common Arduino / Raspberry Pi Pico "logic analyzer" sketches.
export const SUMP = {
  RESET: 0x00, RUN: 0x01, ID: 0x02, METADATA: 0x04,
  DIVIDER: 0x80, READ_DELAY: 0x81, FLAGS: 0x82,
  TRIGGER_MASK: 0xc0, TRIGGER_VALUE: 0xc1, TRIGGER_CONFIG: 0xc2
};

/** Parse a SUMP metadata block (0x04 reply) into named fields. */
export function parseSumpMetadata(bytes) {
  const out = {};
  const names = { 0x01: 'name', 0x02: 'fpgaVersion', 0x03: 'firmwareVersion', 0x20: 'probes', 0x21: 'sampleMemory', 0x22: 'dynamicMemory', 0x23: 'maxSampleRate', 0x24: 'protocol', 0x40: 'probes', 0x41: 'protocol' };
  let i = 0;
  while (i < bytes.length) {
    const key = bytes[i++];
    if (key === 0x00) break;
    const name = names[key] || `key_${key.toString(16)}`;
    if (key <= 0x1f) {
      let str = '';
      while (i < bytes.length && bytes[i] !== 0) str += String.fromCharCode(bytes[i++]);
      i++;
      out[name] = str;
    } else if (key <= 0x3f) {
      out[name] = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
      i += 4;
    } else if (key <= 0x5f) {
      out[name] = bytes[i++];
    } else break;
  }
  return out;
}

/**
 * What a SUMP device can do, from its metadata: channel count (probes), number
 * of 8-channel groups, bytes per sample and the largest capture its sample
 * memory holds (null when the device does not say).
 */
export function sumpCapabilities(meta = {}) {
  const channels = Math.min(32, Math.max(1, Number(meta.probes) || 8));
  const groups = Math.ceil(channels / 8);
  const memory = Number(meta.sampleMemory) || 0;
  return { channels, groups, bytesPerSample: groups, maxSamples: memory ? Math.floor(memory / groups) : null };
}

/**
 * Turn the raw bytes of a capture into samples. A device with N enabled groups
 * sends N bytes per sample, group 0 first. 1 group -> Uint8Array (fast path),
 * 2 -> Uint16Array, 3-4 -> Uint32Array; bit n of a sample is channel Dn.
 * `newestFirst` (the usual SUMP order) is undone so index 0 is the oldest sample.
 */
export function unpackSumpSamples(bytes, groups, { newestFirst = true } = {}) {
  const src = Uint8Array.from(bytes);
  const n = Math.floor(src.length / groups);
  let out;
  if (groups === 1) {
    out = src.slice(0, n);
  } else {
    out = groups === 2 ? new Uint16Array(n) : new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let g = 0; g < groups; g++) v += src[i * groups + g] * 2 ** (8 * g);
      out[i] = v;
    }
  }
  if (newestFirst) out.reverse();
  return out;
}

export class SumpAnalyzer {
  constructor(link, { clockHz = 100_000_000 } = {}) {
    this.link = link;
    this.clockHz = clockHz;
    this.metadata = {};
  }

  get capabilities() { return sumpCapabilities(this.metadata); }

  /** Reset, check the "1ALS" ID, and read metadata when the device has it. */
  async identify() {
    for (let i = 0; i < 5; i++) await this.link.write([SUMP.RESET]);
    await this.link.drain(80);
    await this.link.write([SUMP.ID]);
    const id = new TextDecoder().decode(await this.link.read(4, 1500, 'the SUMP ID'));
    if (id !== '1ALS' && id !== 'SLA1') throw new Error(`Device answered "${id}", not the SUMP ID "1ALS".`);
    await this.link.write([SUMP.METADATA]);
    try {
      const meta = await this.link.readUntil((b) => b.length > 0 && b[b.length - 1] === 0x00 && this._metaComplete(b), 800, 'metadata');
      this.metadata = parseSumpMetadata(meta);
    } catch (e) {
      this.metadata = {}; // metadata is optional (older OLS firmware, minimal sketches)
      await this.link.drain(50);
    }
    return { id, ...this.metadata, ...this.capabilities };
  }

  // True when the 0x00 at the end is the terminator, not part of a value.
  _metaComplete(b) {
    let i = 0;
    while (i < b.length) {
      const key = b[i++];
      if (key === 0x00) return i === b.length;
      if (key <= 0x1f) { while (i < b.length && b[i] !== 0) i++; if (i >= b.length) return false; i++; }
      else if (key <= 0x3f) { i += 4; if (i > b.length) return false; }
      else if (key <= 0x5f) { i += 1; if (i > b.length) return false; }
      else return true;
    }
    return false;
  }

  async _long(cmd, value) {
    await this.link.write([cmd, ...le32(value >>> 0)]);
  }

  /**
   * Trigger stages to program, as [{ mask, value, start }] (stage 0 first).
   * - Level: stage 0 matches `mask`/`value` and starts the capture.
   * - Rising/falling edge on `edge.channel`: SUMP has no native edge trigger, so
   *   stage 0 waits for the channel at its old level and stage 1 (start) fires
   *   on the new level; `mask`/`value` still apply to both stages.
   */
  static triggerStages({ mask = 0, value = 0, edge = null, channels = 8 }) {
    const all = channels >= 32 ? 0xffffffff : (2 ** channels) - 1;
    const m = (mask & all) >>> 0;
    const v = (value & all) >>> 0;
    if (!edge) return [{ mask: m, value: v & m, start: true }];
    if (!(edge.channel >= 0 && edge.channel < channels)) throw new Error(`Edge trigger channel D${edge.channel} is not on this ${channels}-channel device.`);
    const bit = (1 << edge.channel) >>> 0;
    const rising = edge.kind !== 'falling';
    const base = ((m | bit) >>> 0);
    const common = (v & m & ~bit) >>> 0;
    return [
      { mask: base, value: (common | (rising ? 0 : bit)) >>> 0, start: false },
      { mask: base, value: (common | (rising ? bit : 0)) >>> 0, start: true }
    ];
  }

  /**
   * Capture `samples` samples at `sampleRate` from every channel the device reports.
   * Trigger: `triggerMask` selects channels, `triggerValue` their levels (0 mask = immediate);
   * `edge: { channel, kind: 'rising' | 'falling' }` adds an edge trigger.
   * `preTrigger` (0 to 0.9) is the fraction of the capture recorded before the
   * trigger. Returns { samples, sampleRate, channels, triggerIndex } where
   * triggerIndex is where the trigger falls in `samples` (null with no trigger).
   * Most SUMP devices send the newest sample first; `newestFirst` reverses it.
   */
  async capture({ sampleRate, samples, triggerMask = 0, triggerValue = 0, edge = null, preTrigger = 0, newestFirst = true, timeoutMs }) {
    const cap = this.capabilities;
    if (cap.maxSamples && samples > cap.maxSamples) {
      throw new Error(`This device holds at most ${cap.maxSamples.toLocaleString()} samples at ${cap.channels} channels; asked for ${samples.toLocaleString()}.`);
    }
    const divider = Math.max(0, Math.round(this.clockHz / sampleRate) - 1);
    const quads = Math.max(1, Math.ceil(samples / 4));
    const count = quads * 4;
    if (quads > 0x10000) throw new Error('SUMP 0x81 counts top out at 262144 samples.');
    const pre = Math.min(0.9, Math.max(0, Number(preTrigger) || 0));
    const delayQuads = Math.min(quads, Math.max(1, Math.round(quads * (1 - pre))));
    const triggered = !!(triggerMask || edge);
    await this.link.drain(20);
    await this._long(SUMP.DIVIDER, divider);
    // read count in the low 16 bits, delay count (samples after the trigger) in the high 16, both in quads minus one
    await this._long(SUMP.READ_DELAY, ((quads - 1) & 0xffff) | (((delayQuads - 1) & 0xffff) << 16));
    let flags = 0; // bits 2-5 switch channel groups 0-3 off
    for (let g = cap.groups; g < 4; g++) flags |= 0x04 << g;
    await this._long(SUMP.FLAGS, flags);
    const stages = SumpAnalyzer.triggerStages({ mask: triggerMask, value: triggerValue, edge, channels: cap.channels });
    for (let i = 0; i < stages.length; i++) {
      await this._long(SUMP.TRIGGER_MASK + i * 4, stages[i].mask);
      await this._long(SUMP.TRIGGER_VALUE + i * 4, stages[i].value);
      await this._long(SUMP.TRIGGER_CONFIG + i * 4, ((i & 3) << 16) | (stages[i].start ? 0x08000000 : 0)); // level = stage number; start capture on the last stage
    }
    await this.link.write([SUMP.RUN]);
    const actualRate = this.clockHz / (divider + 1);
    const bytes = count * cap.groups;
    const wait = timeoutMs ?? Math.max(5000, (count / actualRate) * 1000 * 2 + bytes / 10 + (triggered ? 30000 : 0));
    const data = await this.link.read(bytes, wait, 'capture data (no trigger, or the device is slower than expected)');
    const all = unpackSumpSamples(data, cap.groups, { newestFirst });
    const out = all.slice(0, samples);
    const triggerIndex = triggered ? Math.min(out.length - 1, (quads - delayQuads) * 4) : null;
    return { samples: out, sampleRate: actualRate, channels: cap.channels, triggerIndex };
  }

  async reset() {
    try { for (let i = 0; i < 5; i++) await this.link.write([SUMP.RESET]); } catch (e) { /* ignore */ }
  }
}

// fx2lafw (sigrok's open-source firmware for Cypress FX2 analyzers: Saleae Logic
// clones, USBee, generic "24MHz 8CH" boards).
export const FX2LAFW = {
  VID: 0x1d50, PID: 0x608c,
  CMD_GET_FW_VERSION: 0xb0, CMD_START: 0xb1,
  FLAG_CLK_48MHZ: 1 << 6,
  FLAG_WIDE: 1 << 5, // 16-bit samples
  EP_IN: 2,
  CPUCS: 0xe600, FW_LOAD: 0xa0
};

export const FX2_USB_FILTERS = [
  { vendorId: FX2LAFW.VID, productId: FX2LAFW.PID }, // already running fx2lafw
  { vendorId: 0x0925, productId: 0x3881 },             // Saleae Logic / clones
  { vendorId: 0x08a9, productId: 0x0014 },             // USBee AX
  { vendorId: 0x04b4, productId: 0x8613 }              // blank Cypress FX2
];

/** CMD_START payload: [flags, delay_h, delay_l]; `wide` asks for 16-bit samples (boards with 16 inputs). */
export function fx2StartCommand(sampleRate, { wide = false } = {}) {
  let flags = FX2LAFW.FLAG_CLK_48MHZ;
  let delay = 0;
  if (48_000_000 % sampleRate === 0) delay = 48_000_000 / sampleRate - 1;
  if ((delay === 0 || delay > 1535) && 30_000_000 % sampleRate === 0) {
    flags = 0;
    delay = 30_000_000 / sampleRate - 1;
  }
  if (delay <= 0 || delay > 1535) throw new Error(`${sampleRate} Hz can't be made from the FX2's 48 or 30 MHz clock.`);
  return [flags | (wide ? FX2LAFW.FLAG_WIDE : 0), (delay >> 8) & 0xff, delay & 0xff];
}

export class Fx2LogicAnalyzer {
  constructor(usbDevice) {
    this.device = usbDevice;
    this.firmware = null;
  }

  get needsFirmware() {
    return !(this.device.vendorId === FX2LAFW.VID && this.device.productId === FX2LAFW.PID);
  }

  static async request() {
    if (typeof navigator === 'undefined' || !navigator.usb) throw new Error('WebUSB needs Chrome or Edge.');
    return new Fx2LogicAnalyzer(await navigator.usb.requestDevice({ filters: FX2_USB_FILTERS }));
  }

  async open() {
    await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(1);
  }

  /**
   * Load firmware into the FX2's RAM (vendor request 0xA0), then let it run.
   * The board drops off USB and comes back as fx2lafw (1D50:608C).
   * `image` is the raw .fw file (loads at address 0) or { data, startAddress }.
   */
  async uploadFirmware(image) {
    const data = image instanceof Uint8Array ? image : image.data;
    const base = image instanceof Uint8Array ? 0 : image.startAddress;
    const out = (value, bytes) => this.device.controlTransferOut(
      { requestType: 'vendor', recipient: 'device', request: FX2LAFW.FW_LOAD, value, index: 0 }, Uint8Array.from(bytes));
    await out(FX2LAFW.CPUCS, [0x01]); // hold the 8051 in reset
    for (let off = 0; off < data.length; off += 4096) {
      await out(base + off, data.subarray(off, Math.min(off + 4096, data.length)));
    }
    await out(FX2LAFW.CPUCS, [0x00]); // run
    try { await this.device.close(); } catch (e) { /* it is re-enumerating */ }
  }

  async start() {
    await this.device.claimInterface(0);
    const r = await this.device.controlTransferIn(
      { requestType: 'vendor', recipient: 'device', request: FX2LAFW.CMD_GET_FW_VERSION, value: 0, index: 0 }, 2);
    if (r.status !== 'ok' || !r.data || r.data.byteLength < 2) throw new Error('No firmware version reply: is this fx2lafw?');
    this.firmware = `${r.data.getUint8(0)}.${r.data.getUint8(1)}`;
    if (r.data.getUint8(0) !== 1) throw new Error(`fx2lafw firmware ${this.firmware} is not the supported 1.x protocol.`);
    return this.firmware;
  }

  /**
   * Stream `samples` samples from bulk endpoint 2: one byte each (D0-D7), or in
   * `wide` mode two bytes each (little-endian, D0-D15) returned as a Uint16Array.
   */
  async capture({ sampleRate, samples, onProgress, wide = false }) {
    const width = wide ? 2 : 1;
    const total = samples * width;
    await this.device.controlTransferOut(
      { requestType: 'vendor', recipient: 'device', request: FX2LAFW.CMD_START, value: 0, index: 0 },
      Uint8Array.from(fx2StartCommand(sampleRate, { wide })));
    const buf = new Uint8Array(total);
    let got = 0;
    const chunk = 16384;
    const inflight = 4; // keep several transfers queued so the FX2 FIFO doesn't fill
    const pull = () => this.device.transferIn(FX2LAFW.EP_IN, chunk);
    const queue = Array.from({ length: inflight }, pull);
    while (got < total) {
      const r = await queue.shift();
      if (r.status !== 'ok') throw new Error(`USB transfer ${r.status}`);
      const bytes = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const take = Math.min(bytes.length, total - got);
      buf.set(bytes.subarray(0, take), got);
      got += take;
      onProgress?.(got / total);
      if (got < total) queue.push(pull());
    }
    // Let the queued transfers drain so the next capture starts clean.
    await Promise.allSettled(queue);
    if (wide) {
      const w = new Uint16Array(samples);
      for (let i = 0; i < samples; i++) w[i] = buf[i * 2] | (buf[i * 2 + 1] << 8);
      return { samples: w, sampleRate, channels: 16 };
    }
    return { samples: buf, sampleRate, channels: 8 };
  }

  async close() {
    try { await this.device.releaseInterface(0); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

