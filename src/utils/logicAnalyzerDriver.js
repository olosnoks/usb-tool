/**
 * 24MHz 8-Channel USB Logic Analyzer & Protocol Decoder Driver
 * Hardware: SUMP devices over Web Serial, fx2lafw boards over WebUSB.
 * Works with Saleae / USBee FX2LP 8-channel hardware clones over WebUSB,
 * and includes high-speed software decoders for UART, I2C, and SPI.
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

/**
 * Generates realistic synthetic digital signals (I2C transaction + UART transmission)
 * for testing without physical hardware
 */
export function generateSyntheticSignalBuffer(sampleCount = 50000, sampleRate = 4000000) {
  const buffer = new Uint8Array(sampleCount);
  buffer.fill(0b00000011); // Channels D0 (SCL) and D1 (SDA) idle HIGH, D2 (UART TX) idle HIGH

  const samplesPerUs = sampleRate / 1000000;

  // 1. Synthesize I2C Start + Address 0x3C (SSD1306 Display) + Data 0x40 on D0 (SCL) & D1 (SDA)
  const sclClockHalfPeriod = Math.floor(samplesPerUs * 5); // 100kHz I2C clock
  let cur = Math.floor(samplesPerUs * 100);

  // START condition: SDA goes low while SCL is high
  buffer.fill(0b00000001, cur, cur + Math.floor(samplesPerUs * 2));
  cur += Math.floor(samplesPerUs * 2);

  const i2cBits = [
    // 7-bit addr 0x3C (0,1,1,1,1,0,0) + Write (0) + ACK (0)
    0, 1, 1, 1, 1, 0, 0, 0, 0,
    // Data byte 0x40 (0,1,0,0,0,0,0,0) + ACK (0)
    0, 1, 0, 0, 0, 0, 0, 0, 0
  ];

  for (const bit of i2cBits) {
    // SCL low, set SDA
    for (let s = 0; s < sclClockHalfPeriod; s++) {
      buffer[cur + s] = (bit ? 0b00000010 : 0b00000000) | 0b00000100;
    }
    cur += sclClockHalfPeriod;

    // SCL high, read SDA
    for (let s = 0; s < sclClockHalfPeriod; s++) {
      buffer[cur + s] = 0b00000001 | (bit ? 0b00000010 : 0b00000000) | 0b00000100;
    }
    cur += sclClockHalfPeriod;
  }

  // STOP condition: SCL high, SDA goes from low to high
  for (let s = 0; s < Math.floor(samplesPerUs * 5); s++) {
    buffer[cur + s] = 0b00000001 | 0b00000100;
  }
  cur += Math.floor(samplesPerUs * 5);
  for (let s = 0; s < Math.floor(samplesPerUs * 5); s++) {
    buffer[cur + s] = 0b00000011 | 0b00000100;
  }

  // 2. Synthesize UART "OK\n" on Channel D2 at 115200 baud
  const baudPeriod = Math.floor(sampleRate / 115200);
  let uCur = Math.floor(samplesPerUs * 400);

  const uartBytes = [0x4F, 0x4B, 0x0A]; // 'O', 'K', '\n'
  for (const byte of uartBytes) {
    // Start bit (0)
    for (let s = 0; s < baudPeriod; s++) {
      buffer[uCur + s] = (buffer[uCur + s] || 0) & ~0b00000100;
    }
    uCur += baudPeriod;

    // 8 data bits (LSB first)
    for (let b = 0; b < 8; b++) {
      const bitVal = (byte >> b) & 1;
      for (let s = 0; s < baudPeriod; s++) {
        if (bitVal) buffer[uCur + s] = (buffer[uCur + s] || 0) | 0b00000100;
        else buffer[uCur + s] = (buffer[uCur + s] || 0) & ~0b00000100;
      }
      uCur += baudPeriod;
    }

    // Stop bit (1)
    for (let s = 0; s < baudPeriod; s++) {
      buffer[uCur + s] = (buffer[uCur + s] || 0) | 0b00000100;
    }
    uCur += baudPeriod * 2;
  }

  return buffer;
}

/**
 * Protocol Decoder: Decodes UART signal from channel data
 */
export function decodeUart(buffer, channelIdx = 2, baudRate = 115200, sampleRate = 4000000) {
  const bitMask = 1 << channelIdx;
  const samplesPerBit = sampleRate / baudRate;
  const decoded = [];

  let i = 0;
  while (i < buffer.length - (samplesPerBit * 10)) {
    const isHigh = (buffer[i] & bitMask) !== 0;
    // Look for Falling Edge (Start Bit: High -> Low)
    if (!isHigh && (buffer[i - 1] & bitMask) !== 0) {
      const startSample = i;
      // Sample in the middle of data bits
      let byte = 0;
      let valid = true;

      for (let b = 0; b < 8; b++) {
        const samplePos = Math.floor(startSample + (samplesPerBit * (b + 1.5)));
        if (samplePos >= buffer.length) { valid = false; break; }
        const bit = (buffer[samplePos] & bitMask) !== 0 ? 1 : 0;
        byte |= (bit << b);
      }

      const stopSamplePos = Math.floor(startSample + (samplesPerBit * 9.5));
      const stopBit = stopSamplePos < buffer.length ? (buffer[stopSamplePos] & bitMask) !== 0 : true;

      if (valid && stopBit) {
        decoded.push({
          type: 'uart',
          startSample,
          endSample: Math.floor(startSample + (samplesPerBit * 10)),
          byte,
          char: byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : `0x${byte.toString(16).toUpperCase()}`
        });
        i += Math.floor(samplesPerBit * 10);
        continue;
      }
    }
    i++;
  }

  return decoded;
}

/**
 * Protocol Decoder: Decodes I2C transactions (SCL on sclCh, SDA on sdaCh)
 */
export function decodeI2C(buffer, sclCh = 0, sdaCh = 1) {
  const sclMask = 1 << sclCh;
  const sdaMask = 1 << sdaCh;
  const events = [];

  let inTransaction = false;
  let bits = [];
  let transactionStart = 0;

  for (let i = 1; i < buffer.length; i++) {
    const prevScl = (buffer[i - 1] & sclMask) !== 0;
    const curScl = (buffer[i] & sclMask) !== 0;
    const prevSda = (buffer[i - 1] & sdaMask) !== 0;
    const curSda = (buffer[i] & sdaMask) !== 0;

    // START condition: SCL High, SDA High -> Low
    if (curScl && prevSda && !curSda) {
      inTransaction = true;
      transactionStart = i;
      bits = [];
      events.push({ type: 'START', sample: i });
      continue;
    }

    // STOP condition: SCL High, SDA Low -> High
    if (curScl && !prevSda && curSda && inTransaction) {
      inTransaction = false;
      events.push({ type: 'STOP', sample: i });
      continue;
    }

    // Sample data on SCL Rising Edge
    if (!prevScl && curScl && inTransaction) {
      bits.push({ val: curSda ? 1 : 0, sample: i });
      if (bits.length === 9) {
        // 8 data bits + 1 ACK bit
        let byteVal = 0;
        for (let b = 0; b < 8; b++) {
          byteVal = (byteVal << 1) | bits[b].val;
        }
        const ack = bits[8].val === 0;

        events.push({
          type: 'DATA',
          byte: byteVal,
          ack,
          startSample: bits[0].sample,
          endSample: bits[8].sample
        });
        bits = [];
      }
    }
  }

  return events;
}

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

export class SumpAnalyzer {
  constructor(link, { clockHz = 100_000_000 } = {}) {
    this.link = link;
    this.clockHz = clockHz;
    this.metadata = {};
  }

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
    return { id, ...this.metadata };
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
    await this.link.write([cmd, ...le32(value)]);
  }

  /**
   * Capture `samples` 8-channel samples at `sampleRate`.
   * Trigger: `triggerMask` selects channels, `triggerValue` their levels (0 = immediate).
   * Most SUMP devices send the newest sample first; `newestFirst` reverses it.
   */
  async capture({ sampleRate, samples, triggerMask = 0, triggerValue = 0, newestFirst = true, timeoutMs }) {
    const divider = Math.max(0, Math.round(this.clockHz / sampleRate) - 1);
    const quads = Math.max(1, Math.ceil(samples / 4));
    const count = quads * 4;
    if (quads > 0x10000) throw new Error('SUMP 0x81 counts top out at 262144 samples.');
    await this.link.drain(20);
    await this._long(SUMP.DIVIDER, divider);
    await this._long(SUMP.READ_DELAY, ((quads - 1) & 0xffff) | (((quads - 1) & 0xffff) << 16));
    await this._long(SUMP.FLAGS, 0x38); // only channel group 0 (D0-D7)
    await this._long(SUMP.TRIGGER_MASK, triggerMask & 0xff);
    await this._long(SUMP.TRIGGER_VALUE, triggerValue & 0xff);
    await this._long(SUMP.TRIGGER_CONFIG, 0x08000000); // stage 0, start capture on match
    await this.link.write([SUMP.RUN]);
    const actualRate = this.clockHz / (divider + 1);
    const wait = timeoutMs ?? Math.max(5000, (count / actualRate) * 1000 * 2 + count / 10 + (triggerMask ? 30000 : 0));
    const data = await this.link.read(count, wait, 'capture data (no trigger, or the device is slower than expected)');
    const buf = Uint8Array.from(data);
    if (newestFirst) buf.reverse();
    return { samples: buf.slice(0, samples), sampleRate: actualRate };
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
  EP_IN: 2,
  CPUCS: 0xe600, FW_LOAD: 0xa0
};

export const FX2_USB_FILTERS = [
  { vendorId: FX2LAFW.VID, productId: FX2LAFW.PID }, // already running fx2lafw
  { vendorId: 0x0925, productId: 0x3881 },             // Saleae Logic / clones
  { vendorId: 0x08a9, productId: 0x0014 },             // USBee AX
  { vendorId: 0x04b4, productId: 0x8613 }              // blank Cypress FX2
];

/** CMD_START payload: [flags, delay_h, delay_l] for an 8-bit capture. */
export function fx2StartCommand(sampleRate) {
  let flags = FX2LAFW.FLAG_CLK_48MHZ;
  let delay = 0;
  if (48_000_000 % sampleRate === 0) delay = 48_000_000 / sampleRate - 1;
  if ((delay === 0 || delay > 1535) && 30_000_000 % sampleRate === 0) {
    flags = 0;
    delay = 30_000_000 / sampleRate - 1;
  }
  if (delay <= 0 || delay > 1535) throw new Error(`${sampleRate} Hz can't be made from the FX2's 48 or 30 MHz clock.`);
  return [flags, (delay >> 8) & 0xff, delay & 0xff];
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

  /** Stream `samples` bytes (one per sample, D0-D7) from bulk endpoint 2. */
  async capture({ sampleRate, samples, onProgress }) {
    await this.device.controlTransferOut(
      { requestType: 'vendor', recipient: 'device', request: FX2LAFW.CMD_START, value: 0, index: 0 },
      Uint8Array.from(fx2StartCommand(sampleRate)));
    const buf = new Uint8Array(samples);
    let got = 0;
    const chunk = 16384;
    const inflight = 4; // keep several transfers queued so the FX2 FIFO doesn't fill
    const pull = () => this.device.transferIn(FX2LAFW.EP_IN, chunk);
    const queue = Array.from({ length: inflight }, pull);
    while (got < samples) {
      const r = await queue.shift();
      if (r.status !== 'ok') throw new Error(`USB transfer ${r.status}`);
      const bytes = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
      const take = Math.min(bytes.length, samples - got);
      buf.set(bytes.subarray(0, take), got);
      got += take;
      onProgress?.(got / samples);
      if (got < samples) queue.push(pull());
    }
    // Let the queued transfers drain so the next capture starts clean.
    await Promise.allSettled(queue);
    return { samples: buf, sampleRate };
  }

  async close() {
    try { await this.device.releaseInterface(0); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

