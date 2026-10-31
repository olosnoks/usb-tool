/**
 * logicSynth.js — draws protocol traffic into an 8-channel sample buffer.
 *
 * Used by the Logic Analyzer's demo captures and by the decoder tests. Each
 * sample is one byte, bit N = channel DN, exactly like a real capture.
 */

/** Holds the level of several channels and appends them to the buffer in time order. */
export class SignalWriter {
  constructor(buf, sampleRate, idle = {}) {
    this.buf = buf;
    this.sampleRate = sampleRate;
    this.t = 0; // position in samples (fractional, so long sequences don't drift)
    this.levels = { ...idle };
    // Write the idle levels into the whole buffer so untouched time stays idle.
    for (const [ch, v] of Object.entries(idle)) {
      const mask = 1 << Number(ch);
      for (let i = 0; i < buf.length; i++) buf[i] = v ? buf[i] | mask : buf[i] & ~mask;
    }
  }

  at(us) { this.t = (us * this.sampleRate) / 1e6; return this; }

  /** Set `changes` ({ channel: level }) and hold every level for `us` microseconds. */
  hold(changes, us) {
    Object.assign(this.levels, changes);
    const from = Math.round(this.t);
    this.t += (us * this.sampleRate) / 1e6;
    const to = Math.min(this.buf.length, Math.round(this.t));
    for (let i = from; i < to; i++) {
      let s = this.buf[i];
      for (const [ch, v] of Object.entries(this.levels)) {
        const mask = 1 << Number(ch);
        s = v ? s | mask : s & ~mask;
      }
      this.buf[i] = s;
    }
    return this;
  }
}

export function synthUart(w, ch, bytes, { baud = 115200, dataBits = 8, parity = 'none', stopBits = 1, gapBits = 1 } = {}) {
  const bit = 1e6 / baud;
  for (const byte of bytes) {
    w.hold({ [ch]: 0 }, bit);
    let ones = 0;
    for (let b = 0; b < dataBits; b++) {
      const v = (byte >> b) & 1;
      ones += v;
      w.hold({ [ch]: v }, bit);
    }
    if (parity === 'even') w.hold({ [ch]: ones & 1 }, bit);
    if (parity === 'odd') w.hold({ [ch]: (ones & 1) ^ 1 }, bit);
    w.hold({ [ch]: 1 }, bit * (stopBits + gapBits));
  }
}

/** transactions: [{ addr, read, data: [..], nack: index of a byte to NACK, addrNack }] */
export function synthI2c(w, scl, sda, transactions, { khz = 100 } = {}) {
  const half = 500 / khz;
  const sendByte = (byte, ack) => {
    for (let b = 7; b >= 0; b--) {
      w.hold({ [scl]: 0, [sda]: (byte >> b) & 1 }, half);
      w.hold({ [scl]: 1 }, half);
    }
    w.hold({ [scl]: 0, [sda]: ack ? 0 : 1 }, half);
    w.hold({ [scl]: 1 }, half);
  };
  for (const tx of transactions) {
    w.hold({ [scl]: 1, [sda]: 1 }, half);
    w.hold({ [sda]: 0 }, half); // START
    sendByte(((tx.addr << 1) | (tx.read ? 1 : 0)) & 0xff, !tx.addrNack);
    (tx.data || []).forEach((d, i) => sendByte(d, i !== tx.nack));
    w.hold({ [scl]: 0, [sda]: 0 }, half);
    w.hold({ [scl]: 1 }, half);
    w.hold({ [sda]: 1 }, half * 4); // STOP
  }
}

export function synthSpi(w, { cs, clk, mosi, miso }, mosiBytes, misoBytes = [], { mode = 0, khz = 1000, msbFirst = true } = {}) {
  const cpol = mode >> 1;
  const cpha = mode & 1;
  const half = 500 / khz;
  const bitOf = (byte, i) => (byte >> (msbFirst ? 7 - i : i)) & 1;
  w.hold({ [cs]: 1, [clk]: cpol }, half * 2);
  w.hold({ [cs]: 0 }, half);
  mosiBytes.forEach((mb, n) => {
    const sb = misoBytes[n] ?? 0;
    for (let i = 0; i < 8; i++) {
      const data = { [mosi]: bitOf(mb, i), [miso]: bitOf(sb, i) };
      if (cpha === 0) {
        // Data is valid before the first (sampling) edge.
        w.hold({ ...data, [clk]: cpol }, half);
        w.hold({ [clk]: cpol ^ 1 }, half);
      } else {
        // First edge launches the data, second samples it.
        w.hold({ [clk]: cpol ^ 1, ...data }, half);
        w.hold({ [clk]: cpol }, half);
      }
    }
  });
  w.hold({ [clk]: cpol }, half);
  w.hold({ [cs]: 1 }, half * 4);
}

/** Reset + presence, then `bytes` written by the master. */
export function synthOneWire(w, ch, bytes, { presence = true } = {}) {
  w.hold({ [ch]: 1 }, 20);
  w.hold({ [ch]: 0 }, 500); // reset
  w.hold({ [ch]: 1 }, 30);
  if (presence) w.hold({ [ch]: 0 }, 120);
  w.hold({ [ch]: 1 }, 350);
  for (const byte of bytes) {
    for (let b = 0; b < 8; b++) {
      if ((byte >> b) & 1) { w.hold({ [ch]: 0 }, 6); w.hold({ [ch]: 1 }, 64); }
      else { w.hold({ [ch]: 0 }, 60); w.hold({ [ch]: 1 }, 10); }
    }
  }
  w.hold({ [ch]: 1 }, 100);
}

/** CRC-15/CAN over a bit array. */
export function canCrc15(bits) {
  let crc = 0;
  for (const b of bits) {
    const next = b ^ ((crc >> 14) & 1);
    crc = (crc << 1) & 0x7fff;
    if (next) crc ^= 0x4599;
  }
  return crc;
}

/** The bits of one CAN 2.0 frame, stuffed, from SOF to the end of EOF. */
export function canFrameBits({ id, extended = false, rtr = false, data = [], ack = true }) {
  const bits = [];
  const put = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  bits.push(0); // SOF
  if (extended) {
    put(id >>> 18, 11);
    bits.push(1, 1); // SRR, IDE
    put(id & 0x3ffff, 18);
    bits.push(rtr ? 1 : 0, 0, 0); // RTR, r1, r0
  } else {
    put(id, 11);
    bits.push(rtr ? 1 : 0, 0, 0); // RTR, IDE, r0
  }
  put(rtr ? Math.min(data.length, 8) : data.length, 4);
  if (!rtr) data.forEach((d) => put(d, 8));
  put(canCrc15(bits), 15);
  // Stuff from SOF through the CRC sequence.
  const stuffed = [];
  let run = 0;
  let last = -1;
  for (const b of bits) {
    stuffed.push(b);
    if (b === last) run++; else { last = b; run = 1; }
    if (run === 5) { stuffed.push(last ^ 1); last ^= 1; run = 1; }
  }
  stuffed.push(1, ack ? 0 : 1, 1, 1, 1, 1, 1, 1, 1, 1); // CRC delim, ACK, ACK delim, EOF
  return stuffed;
}

export function synthCan(w, ch, frames, { bitrate = 500000 } = {}) {
  const bit = 1e6 / bitrate;
  w.hold({ [ch]: 1 }, bit * 12);
  for (const frame of frames) {
    for (const b of canFrameBits(frame)) w.hold({ [ch]: b }, bit);
    w.hold({ [ch]: 1 }, bit * 4); // intermission
  }
}

/** leds: [{ r, g, b }], sent GRB like a WS2812B. */
export function synthWs2812(w, ch, leds, { order = 'GRB' } = {}) {
  w.hold({ [ch]: 0 }, 60);
  for (const led of leds) {
    const word = [...order].reduce((acc, c) => (acc << 8) | led[c.toLowerCase()], 0);
    for (let i = 23; i >= 0; i--) {
      if ((word >> i) & 1) { w.hold({ [ch]: 1 }, 0.8); w.hold({ [ch]: 0 }, 0.45); }
      else { w.hold({ [ch]: 1 }, 0.4); w.hold({ [ch]: 0 }, 0.85); }
    }
  }
  w.hold({ [ch]: 0 }, 80); // latch
}

/** NEC frame on an IR receiver output (idle high, mark = low). */
export function synthNec(w, ch, address, command, { repeat = false } = {}) {
  const mark = (us) => w.hold({ [ch]: 0 }, us);
  const space = (us) => w.hold({ [ch]: 1 }, us);
  space(2000);
  mark(9000);
  space(4500);
  const word = (address & 0xff) | ((~address & 0xff) << 8) | ((command & 0xff) << 16) | ((~command & 0xff) << 24);
  for (let i = 0; i < 32; i++) {
    mark(562);
    space((word >>> i) & 1 ? 1687 : 562);
  }
  mark(562);
  space(40000);
  if (repeat) { mark(9000); space(2250); mark(562); space(2000); }
}

/** RC-5 frame on an IR receiver output (idle high, mark = low). */
export function synthRc5(w, ch, address, command, { toggle = 0 } = {}) {
  const half = 889;
  w.hold({ [ch]: 1 }, 3000);
  const bits = [1, command & 0x40 ? 0 : 1, toggle & 1];
  for (let i = 4; i >= 0; i--) bits.push((address >> i) & 1);
  for (let i = 5; i >= 0; i--) bits.push((command >> i) & 1);
  // On the receiver output a 1 is high then low, a 0 is low then high.
  for (const b of bits) {
    w.hold({ [ch]: b ? 1 : 0 }, half);
    w.hold({ [ch]: b ? 0 : 1 }, half);
  }
  w.hold({ [ch]: 1 }, 5000);
}

/**
 * SWD transfers. The host drives SWDIO on the falling edge and the target on
 * the rising edge, so host bits are valid at the rising edge and target bits
 * at the falling edge. transfers: [{ ap, read, addr, ack = 1, data }]
 */
export function synthSwd(w, clk, dio, transfers, { khz = 1000, lineReset = true } = {}) {
  const half = 500 / khz;
  const host = (v) => { w.hold({ [clk]: 0, [dio]: v }, half); w.hold({ [clk]: 1 }, half); };
  const target = (v) => { w.hold({ [clk]: 0 }, half); w.hold({ [clk]: 1, [dio]: v }, half); };
  const idle = (n) => { for (let i = 0; i < n; i++) host(0); };
  w.hold({ [clk]: 1, [dio]: 1 }, half * 2);
  if (lineReset) { for (let i = 0; i < 52; i++) host(1); idle(2); }
  for (const t of transfers) {
    const a2 = (t.addr >> 2) & 1;
    const a3 = (t.addr >> 3) & 1;
    const ap = t.ap ? 1 : 0;
    const rd = t.read ? 1 : 0;
    [1, ap, rd, a2, a3, (ap + rd + a2 + a3) & 1, 0, 1].forEach(host);
    target(1); // turnaround (line floats high)
    const ack = t.ack ?? 1;
    for (let i = 0; i < 3; i++) target((ack >> i) & 1);
    let ones = 0;
    if (ack === 1 && t.read) {
      for (let i = 0; i < 32; i++) { const v = (t.data >>> i) & 1; ones += v; target(v); }
      target(ones & 1);
      host(0); // turnaround back to the host
    } else if (ack === 1) {
      target(1); // turnaround
      for (let i = 0; i < 32; i++) { const v = (t.data >>> i) & 1; ones += v; host(v); }
      host(ones & 1);
    } else {
      target(1);
    }
    idle(4);
  }
}

/**
 * A demo capture for one decoder, drawn on that decoder's default channels.
 * Returns { samples, sampleRate } with a rate the protocol needs.
 */
export function demoCapture(protocol) {
  const make = (sampleRate, count, idle) => {
    const buf = new Uint8Array(count);
    return { buf, w: new SignalWriter(buf, sampleRate, idle), sampleRate };
  };
  switch (protocol) {
    case 'spi': {
      const { buf, w, sampleRate } = make(8e6, 40000, { 4: 1, 7: 0 });
      w.at(100);
      // JEDEC ID read from a W25Q64: 9F -> EF 40 17
      synthSpi(w, { cs: 4, clk: 7, mosi: 5, miso: 6 }, [0x9f, 0, 0, 0], [0xff, 0xef, 0x40, 0x17]);
      w.hold({}, 20);
      synthSpi(w, { cs: 4, clk: 7, mosi: 5, miso: 6 }, [0x03, 0x00, 0x10, 0x00, 0, 0], [0xff, 0xff, 0xff, 0xff, 0x48, 0x69]);
      return { samples: buf, sampleRate };
    }
    case 'onewire': {
      const { buf, w, sampleRate } = make(1e6, 25000, { 3: 1 });
      w.at(200);
      synthOneWire(w, 3, [0xcc, 0x44]);
      w.hold({}, 1000);
      const rom = [0x28, 0xff, 0x4c, 0x2a, 0x91, 0x16, 0x04];
      synthOneWire(w, 3, [0x55, ...rom, dallasCrc8(rom), 0xbe]);
      return { samples: buf, sampleRate };
    }
    case 'can': {
      const { buf, w, sampleRate } = make(4e6, 50000, { 3: 1 });
      w.at(20);
      synthCan(w, 3, [
        { id: 0x7df, data: [0x02, 0x01, 0x0c, 0, 0, 0, 0, 0] },
        { id: 0x7e8, data: [0x04, 0x41, 0x0c, 0x1a, 0xf8, 0, 0, 0] },
        { id: 0x18db33f1, extended: true, data: [0x02, 0x01, 0x0d] },
        { id: 0x123, rtr: true, data: [0, 0] }
      ]);
      return { samples: buf, sampleRate };
    }
    case 'ws2812': {
      const { buf, w, sampleRate } = make(12e6, 12000, { 7: 0 });
      w.at(5);
      synthWs2812(w, 7, [{ r: 255, g: 0, b: 0 }, { r: 0, g: 255, b: 0 }, { r: 0, g: 0, b: 255 }, { r: 255, g: 160, b: 0 }, { r: 32, g: 32, b: 32 }]);
      return { samples: buf, sampleRate };
    }
    case 'ir': {
      const { buf, w, sampleRate } = make(100e3, 14000, { 7: 1 });
      synthNec(w, 7, 0x04, 0x08, { repeat: true });
      return { samples: buf, sampleRate };
    }
    case 'swd': {
      const { buf, w, sampleRate } = make(8e6, 30000, { 0: 1, 1: 1 });
      w.at(5);
      synthSwd(w, 0, 1, [
        { ap: false, read: true, addr: 0x0, data: 0x2ba01477 },
        { ap: false, read: false, addr: 0x4, data: 0x50000000 },
        { ap: false, read: true, addr: 0x4, data: 0xf0000040 },
        { ap: true, read: false, addr: 0x4, data: 0xe000ed00 },
        { ap: true, read: true, addr: 0xc, ack: 2 }
      ]);
      return { samples: buf, sampleRate };
    }
    case 'uart': {
      const { buf, w, sampleRate } = make(4e6, 25000, { 2: 1 });
      w.at(50);
      synthUart(w, 2, [...new TextEncoder().encode('AT+GMR\r\n')]);
      return { samples: buf, sampleRate };
    }
    case 'i2c':
    default: {
      const { buf, w, sampleRate } = make(4e6, 40000, { 0: 1, 1: 1 });
      w.at(50);
      synthI2c(w, 0, 1, [
        { addr: 0x3c, data: [0x00, 0xaf] },
        { addr: 0x76, data: [0xd0] },
        { addr: 0x76, read: true, data: [0x60], nack: 0 },
        { addr: 0x50, addrNack: true }
      ]);
      return { samples: buf, sampleRate };
    }
  }
}

/** Dallas/Maxim CRC-8 (polynomial x^8 + x^5 + x^4 + 1), as used in 1-Wire ROM IDs. */
export function dallasCrc8(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    let b = byte;
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ b) & 1;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      b >>= 1;
    }
  }
  return crc;
}
