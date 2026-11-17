/**
 * logicDecoders.js — protocol decoders, triggers, measurements and capture
 * file formats for the Logic Analyzer.
 *
 * Every decoder takes a sample buffer (Uint8Array for up to 8 channels, Uint16Array
 * / Uint32Array for wider captures; bit N = channel DN) and returns annotation items:
 *   { type, start, end, label, kind: 'data' | 'control' | 'error', ...fields }
 * where start/end are sample indexes, so the UI can draw them under the waveforms.
 */

import JSZip from 'jszip';
import { I2C_CHIP_DATABASE } from './busExplorerDriver';
import { canCrc15, dallasCrc8 } from './logicSynth';
import { STACKS } from './logicStacks';

export { canCrc15, dallasCrc8 };

const bitAt = (buf, i, ch) => (buf[i] >> ch) & 1;
const hex = (v, w = 2) => v.toString(16).toUpperCase().padStart(w, '0');
const printable = (b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : null);

/** Runs of constant level on one channel: [{ level, start, len }]. */
export function channelRuns(buf, ch) {
  const out = [];
  if (!buf.length) return out;
  let level = bitAt(buf, 0, ch);
  let start = 0;
  for (let i = 1; i < buf.length; i++) {
    const v = bitAt(buf, i, ch);
    if (v !== level) { out.push({ level, start, len: i - start }); level = v; start = i; }
  }
  out.push({ level, start, len: buf.length - start });
  return out;
}

// ---------------------------------------------------------------------------
// UART
// ---------------------------------------------------------------------------

export const STANDARD_BAUDS = [300, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 74880, 115200, 230400, 250000, 460800, 500000, 921600, 1000000, 1500000, 2000000, 3000000];

/** Guess the baud rate from the shortest pulses on a channel. */
export function estimateBaud(buf, ch, sampleRate) {
  const runs = channelRuns(buf, ch).slice(1, -1); // the first and last runs are cut by the capture
  if (runs.length < 4) return null;
  const min = Math.min(...runs.map((r) => r.len));
  const near = runs.map((r) => r.len).filter((l) => l <= min * 1.5);
  const avg = near.reduce((a, b) => a + b, 0) / near.length;
  const raw = sampleRate / avg;
  const snapped = STANDARD_BAUDS.reduce((best, b) => (Math.abs(b - raw) < Math.abs(best - raw) ? b : best), STANDARD_BAUDS[0]);
  return { raw: Math.round(raw), baud: Math.abs(snapped - raw) / snapped < 0.06 ? snapped : Math.round(raw) };
}

export function decodeUartFrames(buf, { channel = 2, baud = 115200, sampleRate, dataBits = 8, parity = 'none', stopBits = 1, inverted = false, msbFirst = false } = {}) {
  const spb = sampleRate / baud;
  const out = [];
  if (spb < 2) return [{ type: 'error', start: 0, end: 0, kind: 'error', label: `Sample rate too low for ${baud} baud (need at least 2 samples a bit).` }];
  const idle = inverted ? 0 : 1;
  const level = (pos) => { const v = bitAt(buf, Math.floor(pos), channel); return inverted ? v ^ 1 : v; };
  const parityBits = parity === 'none' ? 0 : 1;
  const frameBits = 1 + dataBits + parityBits + stopBits;
  let i = 1;
  while (i + spb * frameBits <= buf.length) {
    const prev = bitAt(buf, i - 1, channel);
    const cur = bitAt(buf, i, channel);
    if (!(prev === idle && cur !== idle) || level(i + spb / 2) !== 0) { i++; continue; }
    let value = 0;
    let ones = 0;
    for (let b = 0; b < dataBits; b++) {
      const v = level(i + spb * (b + 1.5));
      ones += v;
      value |= v << (msbFirst ? dataBits - 1 - b : b);
    }
    const errors = [];
    if (parityBits) {
      const p = level(i + spb * (dataBits + 1.5));
      const ok = parity === 'even' ? ((ones + p) & 1) === 0 : parity === 'odd' ? ((ones + p) & 1) === 1 : parity === 'mark' ? p === 1 : p === 0;
      if (!ok) errors.push('parity');
    }
    const stopPos = i + spb * (1 + dataBits + parityBits + 0.5);
    if (level(stopPos) !== 1) errors.push('framing');
    const end = Math.floor(i + spb * frameBits);
    const ch = printable(value);
    out.push({
      type: 'uart', start: i, end, byte: value, char: ch ?? `0x${hex(value)}`, errors,
      kind: errors.length ? 'error' : 'data',
      label: `${ch ? `'${ch}'` : `0x${hex(value)}`}${errors.length ? ` ${errors.join('+')} err` : ''}`
    });
    // A break or framing error: resume right after the stop bit sample.
    i = Math.max(i + 1, Math.floor(stopPos));
  }
  return out;
}

// ---------------------------------------------------------------------------
// I2C
// ---------------------------------------------------------------------------

export function i2cDeviceName(addr) {
  return I2C_CHIP_DATABASE[addr]?.name || null;
}

export function decodeI2cBus(buf, { scl = 0, sda = 1 } = {}) {
  const out = [];
  let inTx = false;
  let bits = [];
  let first = true;
  for (let i = 1; i < buf.length; i++) {
    const ps = bitAt(buf, i - 1, scl);
    const cs = bitAt(buf, i, scl);
    const pd = bitAt(buf, i - 1, sda);
    const cd = bitAt(buf, i, sda);
    if (ps && cs && pd && !cd) {
      out.push({ type: 'start', start: i, end: i, kind: 'control', label: inTx ? 'Sr' : 'S' });
      inTx = true; bits = []; first = true;
      continue;
    }
    if (ps && cs && !pd && cd && inTx) {
      out.push({ type: 'stop', start: i, end: i, kind: 'control', label: 'P' });
      inTx = false; bits = [];
      continue;
    }
    if (!ps && cs && inTx) {
      bits.push({ v: cd, i });
      if (bits.length === 9) {
        let byte = 0;
        for (let b = 0; b < 8; b++) byte = (byte << 1) | bits[b].v;
        const ack = bits[8].v === 0;
        const start = bits[0].i;
        const end = bits[8].i;
        if (first) {
          const addr = byte >> 1;
          const read = (byte & 1) === 1;
          const name = i2cDeviceName(addr);
          out.push({ type: 'address', start, end, addr, read, ack, kind: ack ? 'control' : 'error', label: `${read ? 'R' : 'W'} 0x${hex(addr)}${name ? ` ${name}` : ''} ${ack ? 'ACK' : 'NACK'}` });
          first = false;
        } else {
          out.push({ type: 'data', start, end, byte, ack, kind: 'data', label: `0x${hex(byte)} ${ack ? 'A' : 'N'}` });
        }
        bits = [];
      }
    }
  }
  return out;
}

/** Group decoded I2C items into transactions: [{ addr, read, bytes, nacked, start, end }]. */
export function i2cTransactions(items) {
  const txs = [];
  let cur = null;
  for (const it of items) {
    if (it.type === 'address') {
      cur = { addr: it.addr, read: it.read, ack: it.ack, bytes: [], nacked: !it.ack, start: it.start, end: it.end, name: i2cDeviceName(it.addr) };
      txs.push(cur);
    } else if (it.type === 'data' && cur) {
      cur.bytes.push(it.byte);
      cur.end = it.end;
      if (!it.ack && !cur.read) cur.nacked = true;
    } else if (it.type === 'stop') {
      cur = null;
    }
  }
  return txs;
}

// ---------------------------------------------------------------------------
// SPI
// ---------------------------------------------------------------------------

export function decodeSpi(buf, { cs = 4, clk = 7, mosi = 5, miso = 6, mode = 0, wordSize = 8, msbFirst = true, csActiveLow = true } = {}) {
  const out = [];
  const cpol = (mode >> 1) & 1;
  const cpha = mode & 1;
  const sampleRising = cpol === cpha;
  const useCs = cs !== null && cs !== undefined && cs >= 0;
  let active = !useCs;
  let mo = 0;
  let mi = 0;
  let n = 0;
  let wordStart = 0;
  let csStart = 0;
  let words = 0;
  const flush = (end, partial) => {
    if (!n) return;
    out.push({
      type: 'word', start: wordStart, end, mosi: mo, miso: mi, bits: n, partial,
      kind: partial ? 'error' : 'data',
      label: `${miso >= 0 ? `${hex(mo)}/${hex(mi)}` : hex(mo)}${partial ? ` (${n} bits)` : ''}`
    });
    mo = 0; mi = 0; n = 0;
  };
  for (let i = 1; i < buf.length; i++) {
    if (useCs) {
      const lvl = bitAt(buf, i, cs);
      const on = csActiveLow ? lvl === 0 : lvl === 1;
      if (on && !active) { active = true; csStart = i; words = 0; mo = 0; mi = 0; n = 0; }
      else if (!on && active) {
        flush(i, true);
        active = false;
        out.push({ type: 'cs', start: csStart, end: i, kind: 'control', label: `CS ${words} word${words === 1 ? '' : 's'}` });
        continue;
      }
    }
    if (!active) continue;
    const p = bitAt(buf, i - 1, clk);
    const c = bitAt(buf, i, clk);
    if (p === c || (sampleRising ? c !== 1 : c !== 0)) continue;
    if (n === 0) wordStart = i;
    const mob = bitAt(buf, i, mosi);
    const mib = miso >= 0 ? bitAt(buf, i, miso) : 0;
    if (msbFirst) { mo = (mo << 1) | mob; mi = (mi << 1) | mib; }
    else { mo |= mob << n; mi |= mib << n; }
    n++;
    if (n === wordSize) { flush(i, false); words++; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1-Wire
// ---------------------------------------------------------------------------

export const ONEWIRE_COMMANDS = {
  0x33: 'READ ROM', 0x55: 'MATCH ROM', 0xcc: 'SKIP ROM', 0xf0: 'SEARCH ROM', 0xec: 'ALARM SEARCH',
  0x69: 'OVERDRIVE MATCH', 0x3c: 'OVERDRIVE SKIP', 0xa5: 'RESUME'
};
export const ONEWIRE_FUNCTIONS = {
  0x44: 'CONVERT T', 0xbe: 'READ SCRATCHPAD', 0x4e: 'WRITE SCRATCHPAD', 0x48: 'COPY SCRATCHPAD',
  0xb8: 'RECALL E2', 0xb4: 'READ POWER SUPPLY', 0xf0: 'READ MEMORY', 0x0f: 'WRITE SCRATCHPAD (EEPROM)'
};
export const ONEWIRE_FAMILIES = { 0x01: 'DS1990A iButton', 0x10: 'DS18S20', 0x22: 'DS1822', 0x28: 'DS18B20', 0x26: 'DS2438', 0x2d: 'DS2431 EEPROM', 0x3b: 'MAX31850', 0x42: 'DS28EA00' };

export function decodeOneWire(buf, { channel = 3, sampleRate } = {}) {
  const out = [];
  const us = (n) => (n * 1e6) / sampleRate;
  let resetEnd = -1;
  let afterReset = false;
  let bits = 0;
  let byte = 0;
  let byteStart = 0;
  let index = 0; // byte number since the last reset
  let rom = null;
  let romStart = 0;
  let searching = false;
  for (const run of channelRuns(buf, channel)) {
    if (run.level !== 0 || run.start === 0) continue;
    const d = us(run.len);
    if (d >= 400) {
      out.push({ type: 'reset', start: run.start, end: run.start + run.len, kind: 'control', label: 'RESET' });
      resetEnd = run.start + run.len; afterReset = true; bits = 0; byte = 0; index = 0; rom = null; searching = false;
      continue;
    }
    if (afterReset && us(run.start - resetEnd) < 80 && d >= 50) {
      out.push({ type: 'presence', start: run.start, end: run.start + run.len, kind: 'control', label: 'PRESENCE' });
      afterReset = false;
      continue;
    }
    afterReset = false;
    if (searching) continue; // SEARCH ROM is bit triplets, not bytes
    if (bits === 0) byteStart = run.start;
    byte |= (d < 15 ? 1 : 0) << bits;
    bits++;
    if (bits < 8) continue;
    const end = run.start + run.len;
    let label = `0x${hex(byte)}`;
    if (index === 0 && ONEWIRE_COMMANDS[byte]) {
      label = ONEWIRE_COMMANDS[byte];
      if (byte === 0x33 || byte === 0x55) rom = [];
      if (byte === 0xf0 || byte === 0xec) searching = true;
    } else if (rom && rom.length < 8) {
      if (!rom.length) romStart = byteStart;
      rom.push(byte);
      if (rom.length === 8) {
        const ok = dallasCrc8(rom.slice(0, 7)) === rom[7];
        const fam = ONEWIRE_FAMILIES[rom[0]];
        const serial = rom.slice(1, 7).reverse().map((b) => hex(b)).join('');
        out.push({ type: 'rom', start: romStart, end, rom: [...rom], crcOk: ok, kind: ok ? 'control' : 'error', label: `ROM ${hex(rom[0])}-${serial}${fam ? ` ${fam}` : ''} CRC ${ok ? 'ok' : 'BAD'}` });
      }
    } else if (index > 0 && ONEWIRE_FUNCTIONS[byte] && (index === 1 || (rom && rom.length === 8 && index === 9))) {
      label = `${ONEWIRE_FUNCTIONS[byte]} (0x${hex(byte)})`;
    }
    out.push({ type: 'byte', start: byteStart, end, byte, kind: 'data', label });
    index++;
    bits = 0;
    byte = 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CAN 2.0A/B (single-ended RX line from a transceiver, dominant = low)
// ---------------------------------------------------------------------------

class CanBitError extends Error {}

export function decodeCan(buf, { channel = 3, bitrate = 500000, sampleRate } = {}) {
  const bitLen = sampleRate / bitrate;
  if (bitLen < 3) return [{ type: 'error', start: 0, end: 0, kind: 'error', label: `Sample rate too low for ${bitrate / 1000} kbit/s (need 3+ samples a bit).` }];
  const out = [];
  const runs = channelRuns(buf, channel);

  const parse = (sof) => {
    let pos = sof;
    const raw = () => {
      const center = pos + bitLen / 2;
      if (center >= buf.length) throw new CanBitError('capture ended mid-frame');
      const v = bitAt(buf, Math.floor(center), channel);
      // Resynchronise on any edge within half a bit of the expected boundary.
      let next = pos + bitLen;
      const hi = Math.min(buf.length - 1, Math.floor(pos + bitLen * 1.5));
      for (let k = Math.floor(center) + 1; k <= hi; k++) {
        if (bitAt(buf, k, channel) !== bitAt(buf, k - 1, channel)) { next = k; break; }
      }
      pos = next;
      return v;
    };
    let run = 0;
    let last = -1;
    const crcBits = [];
    let collect = true;
    const next = () => {
      let b = raw();
      if (run === 5) {
        if (b === last) throw new CanBitError('stuff error');
        last = b; run = 1;
        b = raw();
      }
      if (b === last) run++; else { last = b; run = 1; }
      if (collect) crcBits.push(b);
      return b;
    };
    const read = (n) => { let v = 0; for (let k = 0; k < n; k++) v = v * 2 + next(); return v; };

    if (next() !== 0) throw new CanBitError('no start of frame');
    let id = read(11);
    const b12 = next();
    const ide = next();
    let rtr = b12;
    if (ide) {
      id = id * 2 ** 18 + read(18);
      rtr = next();
      next(); next(); // r1, r0
    } else {
      next(); // r0
    }
    const dlc = read(4);
    const n = rtr ? 0 : Math.min(dlc, 8);
    const data = [];
    for (let k = 0; k < n; k++) data.push(read(8));
    collect = false;
    const crcCalc = canCrc15(crcBits);
    const crc = read(15);
    if (run === 5) raw(); // a stuff bit after the CRC sequence
    const delim = raw();
    const ack = raw() === 0;
    raw(); // ACK delimiter
    for (let k = 0; k < 7 && pos + bitLen / 2 < buf.length; k++) raw();
    const crcOk = crc === crcCalc && delim === 1;
    const idText = ide ? hex(id, 8) : hex(id, 3);
    return {
      type: 'frame', start: sof, end: Math.min(buf.length - 1, Math.floor(pos)), id, extended: !!ide, rtr: !!rtr, dlc, data, crc, crcOk, ack,
      kind: crcOk ? 'data' : 'error',
      label: `${idText}${rtr ? ' RTR' : ''} [${dlc}] ${data.map((d) => hex(d)).join(' ')}${crcOk ? '' : ' CRC ERR'}${ack ? '' : ' NO-ACK'}`.trim()
    };
  };

  let resumeAt = 0;
  for (let r = 0; r < runs.length - 1; r++) {
    const run = runs[r];
    if (run.level !== 1) continue;
    const sof = run.start + run.len;
    if (sof < resumeAt) continue;
    if (run.len < bitLen * 7 && run.start !== 0) continue; // not bus idle
    try {
      const frame = parse(sof);
      out.push(frame);
      resumeAt = frame.end;
    } catch (e) {
      if (!(e instanceof CanBitError)) throw e;
      out.push({ type: 'error', start: sof, end: sof + Math.floor(bitLen), kind: 'error', label: e.message });
      resumeAt = sof + Math.floor(bitLen);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// WS2812 / NeoPixel
// ---------------------------------------------------------------------------

export function decodeWs2812(buf, { channel = 7, sampleRate, order = 'GRB' } = {}) {
  const out = [];
  const us = (n) => (n * 1e6) / sampleRate;
  if (sampleRate < 4e6) return [{ type: 'error', start: 0, end: 0, kind: 'error', label: 'WS2812 needs at least 4 MS/s (8+ is safer).' }];
  const runs = channelRuns(buf, channel);
  let word = 0;
  let n = 0;
  let ledStart = 0;
  let led = 0;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (run.level === 0) {
      if (us(run.len) >= 50 && r > 0) {
        if (led || n) out.push({ type: 'reset', start: run.start, end: run.start + run.len, kind: 'control', label: `RESET (${led} LEDs)` });
        word = 0; n = 0; led = 0;
      }
      continue;
    }
    const high = us(run.len);
    if (high > 2) continue; // not a data bit
    if (n === 0) ledStart = run.start;
    word = (word << 1) | (high > 0.6 ? 1 : 0);
    n++;
    if (n === 24) {
      const c = {};
      [...order].forEach((name, k) => { c[name.toLowerCase()] = (word >> (16 - k * 8)) & 0xff; });
      const end = run.start + run.len + (runs[r + 1] && us(runs[r + 1].len) < 50 ? runs[r + 1].len : 0);
      out.push({ type: 'led', index: led, start: ledStart, end, r: c.r, g: c.g, b: c.b, kind: 'data', label: `#${led} ${hex(c.r)}${hex(c.g)}${hex(c.b)}` });
      led++; word = 0; n = 0;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Infrared remotes (demodulated receiver output, e.g. TSOP38238)
// ---------------------------------------------------------------------------

const near = (v, target, tol = 0.35) => Math.abs(v - target) <= target * tol;

export function decodeIrNec(buf, { channel = 7, sampleRate, activeLow = true } = {}) {
  const out = [];
  const us = (n) => (n * 1e6) / sampleRate;
  const markLevel = activeLow ? 0 : 1;
  const runs = channelRuns(buf, channel);
  for (let r = 0; r < runs.length - 2; r++) {
    const lead = runs[r];
    if (lead.level !== markLevel || !near(us(lead.len), 9000, 0.25)) continue;
    const gap = us(runs[r + 1].len);
    if (near(gap, 2250, 0.3)) {
      out.push({ type: 'repeat', start: lead.start, end: runs[r + 2].start + runs[r + 2].len, kind: 'control', label: 'NEC REPEAT' });
      r += 2;
      continue;
    }
    if (!near(gap, 4500, 0.25)) continue;
    let word = 0;
    let k = r + 2;
    let ok = true;
    for (let bit = 0; bit < 32; bit++, k += 2) {
      if (!runs[k + 1] || !near(us(runs[k].len), 562, 0.5)) { ok = false; break; }
      const space = us(runs[k + 1].len);
      if (near(space, 1687, 0.35)) word |= 1 << bit;
      else if (!near(space, 562, 0.5)) { ok = false; break; }
    }
    const end = runs[Math.min(k, runs.length - 1)].start + (runs[k]?.len || 0);
    if (!ok) {
      out.push({ type: 'error', start: lead.start, end, kind: 'error', label: 'NEC frame cut short' });
      continue;
    }
    word >>>= 0;
    const a = word & 0xff;
    const ai = (word >>> 8) & 0xff;
    const c = (word >>> 16) & 0xff;
    const ci = (word >>> 24) & 0xff;
    const extended = (a ^ ai) !== 0xff;
    const address = extended ? a | (ai << 8) : a;
    const valid = (c ^ ci) === 0xff;
    out.push({
      type: 'nec', start: lead.start, end, address, command: c, extended, valid,
      kind: valid ? 'data' : 'error',
      label: `NEC addr 0x${hex(address, extended ? 4 : 2)} cmd 0x${hex(c)}${valid ? '' : ' (bad check)'}`
    });
    r = k;
  }
  return out;
}

export function decodeIrRc5(buf, { channel = 7, sampleRate, activeLow = true } = {}) {
  const out = [];
  const us = (n) => (n * 1e6) / sampleRate;
  const markLevel = activeLow ? 0 : 1;
  const runs = channelRuns(buf, channel);
  const T = 889;
  for (let r = 1; r < runs.length; r++) {
    const startRun = runs[r];
    if (startRun.level !== markLevel || us(runs[r - 1].len) < 2.5 * T) continue;
    // Expand runs into half-bit levels; S1 is a 1, so its first half is the idle before it.
    const halves = [markLevel ^ 1];
    let k = r;
    let bad = false;
    while (k < runs.length && halves.length < 28) {
      const d = us(runs[k].len);
      const count = near(d, T, 0.35) ? 1 : near(d, 2 * T, 0.25) ? 2 : d > 3 * T && runs[k].level !== markLevel ? 1 : 0;
      if (!count) { bad = true; break; }
      for (let c = 0; c < count; c++) halves.push(runs[k].level);
      if (d > 3 * T) break;
      k++;
    }
    if (bad || halves.length < 27) continue;
    if (halves.length === 27) halves.push(markLevel ^ 1);
    const bits = [];
    for (let h = 0; h < 28; h += 2) {
      if (halves[h] === halves[h + 1]) { bad = true; break; }
      bits.push(halves[h + 1] === markLevel ? 1 : 0);
    }
    if (bad) continue;
    const address = bits.slice(3, 8).reduce((v, b) => (v << 1) | b, 0);
    let command = bits.slice(8, 14).reduce((v, b) => (v << 1) | b, 0);
    if (!bits[1]) command |= 0x40; // RC-5X: inverted S2 is command bit 6
    const end = runs[Math.min(k, runs.length - 1)].start;
    out.push({ type: 'rc5', start: startRun.start, end, address, command, toggle: bits[2], kind: 'data', label: `RC5 addr ${address} cmd ${command} T${bits[2]}` });
    r = k;
  }
  return out;
}

// ---------------------------------------------------------------------------
// SWD (ARM Serial Wire Debug)
// ---------------------------------------------------------------------------

const DP_READ = { 0x0: 'IDCODE', 0x4: 'CTRL/STAT', 0x8: 'RESEND', 0xc: 'RDBUFF' };
const DP_WRITE = { 0x0: 'ABORT', 0x4: 'CTRL/STAT', 0x8: 'SELECT', 0xc: 'TARGETSEL' };
const AP_REGS = { 0x0: 'CSW', 0x4: 'TAR', 0x8: 'AP[8]', 0xc: 'DRW' };
const SWD_ACK = { 1: 'OK', 2: 'WAIT', 4: 'FAULT' };

export function decodeSwd(buf, { swclk = 0, swdio = 1 } = {}) {
  const out = [];
  // One cycle per rising edge: host bits are valid at the rising edge, target
  // bits (ACK, read data) just before the following falling edge.
  const cycles = [];
  let lastRise = -1;
  for (let i = 1; i < buf.length; i++) {
    const p = bitAt(buf, i - 1, swclk);
    const c = bitAt(buf, i, swclk);
    if (!p && c) { lastRise = i; cycles.push({ rise: i, host: bitAt(buf, i, swdio), target: null, fall: null }); }
    else if (p && !c && lastRise >= 0 && cycles.length) {
      const cy = cycles[cycles.length - 1];
      if (cy.fall === null) { cy.fall = i; cy.target = bitAt(buf, i - 1, swdio); }
    }
  }
  for (const cy of cycles) if (cy.target === null) cy.target = cy.host;
  let k = 0;
  let ones = 0;
  while (k < cycles.length) {
    const h = cycles[k].host;
    if (h === 1) {
      ones++;
      if (ones >= 50 && (k + 1 >= cycles.length || cycles[k + 1].host === 0)) {
        out.push({ type: 'reset', start: cycles[k - ones + 1].rise, end: cycles[k].rise, kind: 'control', label: `LINE RESET (${ones} cycles)` });
        ones = 0;
        k++;
        continue;
      }
    } else ones = 0;
    const prevLow = k === 0 || cycles[k - 1].host === 0;
    if (!(h === 1 && prevLow && k + 12 < cycles.length)) { k++; continue; }
    const req = cycles.slice(k, k + 8).map((c) => c.host);
    const [, ap, rnw, a2, a3, par, stop, park] = req;
    if (stop !== 0 || park !== 1 || ((ap + rnw + a2 + a3) & 1) !== par) { k++; continue; }
    ones = 0;
    const addr = (a2 << 2) | (a3 << 3);
    const reg = ap ? AP_REGS[addr] : rnw ? DP_READ[addr] : DP_WRITE[addr];
    const ack = cycles[k + 9].target | (cycles[k + 10].target << 1) | (cycles[k + 11].target << 2);
    const start = cycles[k].rise;
    let next = k + 13;
    let data = null;
    let parityOk = null;
    if (ack === 1) {
      const base = rnw ? k + 12 : k + 13;
      if (base + 33 > cycles.length) break;
      let v = 0;
      let cnt = 0;
      for (let b = 0; b < 32; b++) {
        const bit = rnw ? cycles[base + b].target : cycles[base + b].host;
        v |= bit << b;
        cnt += bit;
      }
      data = v >>> 0;
      const pbit = rnw ? cycles[base + 32].target : cycles[base + 32].host;
      parityOk = ((cnt + pbit) & 1) === 0;
      next = base + 33 + (rnw ? 1 : 0);
    }
    const end = cycles[Math.min(next, cycles.length) - 1].rise;
    out.push({
      type: 'transfer', start, end, ap: !!ap, read: !!rnw, addr, reg, ack, ackName: SWD_ACK[ack] || `0b${ack.toString(2).padStart(3, '0')}`, data, parityOk,
      kind: ack === 1 && parityOk !== false ? 'data' : 'error',
      label: `${ap ? 'AP' : 'DP'} ${rnw ? 'R' : 'W'} ${reg} ${SWD_ACK[ack] || 'NO-ACK'}${data !== null ? ` 0x${hex(data, 8)}` : ''}${parityOk === false ? ' PARITY ERR' : ''}`
    });
    k = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Decoder registry (drives the UI)
// ---------------------------------------------------------------------------

export const DECODERS = {
  i2c: {
    label: 'I2C', channels: { scl: 0, sda: 1 }, params: {}, stack: STACKS.i2c,
    run: (buf, ch) => decodeI2cBus(buf, ch)
  },
  uart: {
    label: 'UART', channels: { rx: 2 }, params: { baud: 115200, dataBits: 8, parity: 'none', stopBits: 1, inverted: false }, stack: STACKS.uart,
    run: (buf, ch, p, sampleRate) => decodeUartFrames(buf, { channel: ch.rx, sampleRate, ...p })
  },
  spi: {
    label: 'SPI', channels: { cs: 4, clk: 7, mosi: 5, miso: 6 }, params: { mode: 0, wordSize: 8, msbFirst: true, csActiveLow: true }, stack: STACKS.spi,
    run: (buf, ch, p) => decodeSpi(buf, { ...ch, ...p })
  },
  onewire: {
    label: '1-Wire', channels: { dq: 3 }, params: {},
    run: (buf, ch, p, sampleRate) => decodeOneWire(buf, { channel: ch.dq, sampleRate })
  },
  can: {
    label: 'CAN', channels: { rx: 3 }, params: { bitrate: 500000 }, stack: STACKS.can,
    run: (buf, ch, p, sampleRate) => decodeCan(buf, { channel: ch.rx, sampleRate, ...p })
  },
  ws2812: {
    label: 'WS2812', channels: { din: 7 }, params: { order: 'GRB' },
    run: (buf, ch, p, sampleRate) => decodeWs2812(buf, { channel: ch.din, sampleRate, ...p })
  },
  ir: {
    label: 'IR (NEC/RC5)', channels: { ir: 7 }, params: { protocol: 'nec', activeLow: true },
    run: (buf, ch, p, sampleRate) => (p.protocol === 'rc5' ? decodeIrRc5 : decodeIrNec)(buf, { channel: ch.ir, sampleRate, activeLow: p.activeLow })
  },
  swd: {
    label: 'SWD', channels: { swclk: 0, swdio: 1 }, params: {},
    run: (buf, ch) => decodeSwd(buf, ch)
  }
};

// ---------------------------------------------------------------------------
// Triggers & measurements
// ---------------------------------------------------------------------------

/**
 * Find the next (direction 1) or previous (-1) sample matching a condition.
 * kind: 'rising' | 'falling' | 'edge' | 'pattern' (mask/value) | 'pulse' (width
 * shorter than `maxWidth` samples, i.e. a glitch). Returns -1 when nothing matches.
 */
export function findTrigger(buf, { kind = 'rising', channel = 0, mask = 0, value = 0, maxWidth = 2, from = 0, direction = 1 } = {}) {
  const match = (i) => {
    if (i < 1 || i >= buf.length) return false;
    if (kind === 'pattern') return (buf[i] & mask) === (value & mask) && (buf[i - 1] & mask) !== (value & mask);
    const p = bitAt(buf, i - 1, channel);
    const c = bitAt(buf, i, channel);
    if (kind === 'rising') return !p && c;
    if (kind === 'falling') return p && !c;
    if (kind === 'edge') return p !== c;
    if (kind === 'pulse') {
      if (p === c) return false;
      let w = 1;
      while (i + w < buf.length && bitAt(buf, i + w, channel) === c && w <= maxWidth) w++;
      return w <= maxWidth && i + w < buf.length;
    }
    return false;
  };
  for (let i = from + direction; i >= 1 && i < buf.length; i += direction) if (match(i)) return i;
  return -1;
}

/** Edge count, frequency, duty cycle and pulse widths of one channel. */
export function measureChannel(buf, ch, sampleRate) {
  const runs = channelRuns(buf, ch);
  const inner = runs.slice(1, -1);
  const highs = inner.filter((r) => r.level === 1).map((r) => r.len);
  const lows = inner.filter((r) => r.level === 0).map((r) => r.len);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const edges = Math.max(0, runs.length - 1);
  const avgHigh = highs.length ? sum(highs) / highs.length : 0;
  const avgLow = lows.length ? sum(lows) / lows.length : 0;
  const period = avgHigh + avgLow;
  const toUs = (n) => (n * 1e6) / sampleRate;
  return {
    edges,
    level: runs.length === 1 ? runs[0].level : null,
    frequency: highs.length && lows.length ? sampleRate / period : 0,
    duty: period ? (avgHigh / period) * 100 : null,
    minPulseUs: inner.length ? toUs(Math.min(...inner.map((r) => r.len))) : null,
    maxPulseUs: inner.length ? toUs(Math.max(...inner.map((r) => r.len))) : null
  };
}

// ---------------------------------------------------------------------------
// Capture files: VCD and sigrok .sr
// ---------------------------------------------------------------------------

const vcdId = (c) => String.fromCharCode(33 + c);

export function exportVcd(buf, sampleRate, names = [], channelCount = 8) {
  const psPerSample = 1e12 / sampleRate;
  const scale = Number.isInteger(psPerSample / 1000) ? 'ns' : 'ps';
  const unit = scale === 'ns' ? psPerSample / 1000 : psPerSample;
  const lines = [
    `$date ${new Date().toISOString()} $end`,
    '$version Skon\'s USB Tool logic analyzer $end',
    `$comment samplerate ${sampleRate} $end`,
    `$timescale 1 ${scale} $end`,
    '$scope module logic $end'
  ];
  for (let c = 0; c < channelCount; c++) lines.push(`$var wire 1 ${vcdId(c)} ${(names[c] || `D${c}`).replace(/\s+/g, '_')} $end`);
  lines.push('$upscope $end', '$enddefinitions $end');
  let prev = -1;
  for (let i = 0; i < buf.length; i++) {
    const s = buf[i];
    if (s === prev) continue;
    const changes = [];
    for (let c = 0; c < channelCount; c++) {
      const v = (s >> c) & 1;
      if (prev < 0 || ((prev >> c) & 1) !== v) changes.push(`${v}${vcdId(c)}`);
    }
    lines.push(`#${Math.round(i * unit)}`, ...changes);
    prev = s;
  }
  lines.push(`#${Math.round(buf.length * unit)}`);
  return lines.join('\n') + '\n';
}

const TIMESCALE = { s: 1, ms: 1e-3, us: 1e-6, ns: 1e-9, ps: 1e-12, fs: 1e-15 };
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };

/** Parse a VCD with up to 8 one-bit wires. Returns { samples, sampleRate, names }. */
export function importVcd(text, { maxSamples = 4_000_000, sampleRate } = {}) {
  const tsMatch = text.match(/\$timescale\s+(\d+)\s*(s|ms|us|ns|ps|fs)\s*\$end/);
  const tscale = tsMatch ? Number(tsMatch[1]) * TIMESCALE[tsMatch[2]] : 1e-9;
  const vars = [];
  for (const m of text.matchAll(/\$var\s+\w+\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+\[[^\]]*\])?\s+\$end/g)) {
    if (m[1] === '1' && vars.length < 32) vars.push({ id: m[2], name: m[3] });
  }
  if (!vars.length) throw new Error('No one-bit signals found in this VCD.');
  const chOf = new Map(vars.map((v, i) => [v.id, i]));
  const body = text.slice(text.indexOf('$enddefinitions'));
  const events = []; // [time, channel, value]
  let t = 0;
  for (const tok of body.split(/\s+/)) {
    if (!tok || tok.startsWith('$')) continue;
    if (tok[0] === '#') { t = Number(tok.slice(1)); continue; }
    if (/^[01xXzZ]/.test(tok)) {
      const ch = chOf.get(tok.slice(1));
      if (ch !== undefined) events.push([t, ch, tok[0] === '1' ? 1 : 0]);
    }
  }
  if (!events.length) throw new Error('This VCD has no value changes.');
  const times = [...new Set(events.map((e) => e[0]))].sort((a, b) => a - b);
  let step = 0;
  for (let i = 1; i < times.length; i++) step = gcd(step, times[i] - times[i - 1]);
  step = step || 1;
  if (sampleRate) step = 1 / (sampleRate * tscale);
  const last = times[times.length - 1];
  const count = Math.min(maxSamples, Math.floor((last - times[0]) / step) + 1);
  const samples = vars.length <= 8 ? new Uint8Array(count) : vars.length <= 16 ? new Uint16Array(count) : new Uint32Array(count);
  let state = 0;
  let e = 0;
  for (let i = 0; i < count; i++) {
    const time = times[0] + i * step;
    while (e < events.length && events[e][0] <= time) {
      const [, ch, v] = events[e++];
      state = v ? state | (1 << ch) : state & ~(1 << ch);
    }
    samples[i] = state;
  }
  return { samples, sampleRate: Math.round(1 / (step * tscale)), names: vars.map((v) => v.name), channelCount: vars.length };
}

/** Like importVcd, but uses the sample rate our own exporter writes in a $comment. */
export function importVcdFile(text, opts) {
  const declared = Number(text.match(/\$comment\s+samplerate\s+(\d+)\s*\$end/)?.[1]);
  return importVcd(text, { ...opts, sampleRate: declared || undefined });
}

export function sigrokRate(rate) {
  if (rate % 1e6 === 0) return `${rate / 1e6} MHz`;
  if (rate % 1e3 === 0) return `${rate / 1e3} kHz`;
  return `${rate} Hz`;
}

function parseSigrokRate(text) {
  const m = String(text).trim().match(/^([\d.]+)\s*(GHz|MHz|kHz|Hz)?$/i);
  if (!m) return null;
  const mult = { ghz: 1e9, mhz: 1e6, khz: 1e3, hz: 1 }[(m[2] || 'Hz').toLowerCase()];
  return Math.round(Number(m[1]) * mult);
}

/** A sigrok/PulseView session file (.sr) as a Uint8Array. */
export async function exportSigrok(buf, sampleRate, names = [], channelCount = 8) {
  const zip = new JSZip();
  zip.file('version', '2');
  const unit = Math.ceil(channelCount / 8);
  const probes = Array.from({ length: channelCount }, (_, c) => `probe${c + 1}=${(names[c] || `D${c}`).replace(/[=\n]/g, ' ')}`);
  zip.file('metadata', [
    '[global]', 'sigrok version=0.5.2', '', '[device 1]', 'capturefile=logic-1', `total probes=${channelCount}`,
    `samplerate=${sigrokRate(sampleRate)}`, 'total analog=0', ...probes, `unitsize=${unit}`, ''
  ].join('\n'));
  let raw = buf;
  if (unit > 1) {
    raw = new Uint8Array(buf.length * unit);
    for (let i = 0; i < buf.length; i++) for (let b = 0; b < unit; b++) raw[i * unit + b] = (buf[i] >>> (8 * b)) & 0xff;
  }
  zip.file('logic-1-1', raw);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export async function importSigrok(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const meta = await zip.file('metadata')?.async('string');
  if (!meta) throw new Error('Not a sigrok session: no metadata file.');
  const get = (key) => meta.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1];
  const sampleRate = parseSigrokRate(get('samplerate') || '');
  const unitsize = Number(get('unitsize') || 1);
  const capture = get('capturefile') || 'logic-1';
  const names = [];
  const probeCount = Math.min(32, Number(get('total probes')) || 8);
  for (let c = 1; c <= probeCount; c++) names.push(get(`probe${c}`) || `D${c - 1}`);
  const parts = Object.keys(zip.files)
    .filter((n) => n === capture || n.startsWith(`${capture}-`))
    .sort((a, b) => Number(a.split('-').pop()) - Number(b.split('-').pop()));
  if (!parts.length) throw new Error('The session has no logic data.');
  const chunks = await Promise.all(parts.map((p) => zip.file(p).async('uint8array')));
  const total = chunks.reduce((n, c) => n + c.length, 0) / unitsize;
  const samples = unitsize === 1 ? new Uint8Array(total) : unitsize === 2 ? new Uint16Array(total) : new Uint32Array(total);
  let o = 0;
  for (const chunk of chunks) {
    for (let i = 0; i + unitsize <= chunk.length; i += unitsize) {
      let v = 0;
      for (let b = 0; b < unitsize; b++) v += chunk[i + b] * 2 ** (8 * b);
      samples[o++] = v;
    }
  }
  return { samples, sampleRate: sampleRate || 1e6, names, channelCount: probeCount };
}

// ---------------------------------------------------------------------------
// Stacked decoders and session files
// ---------------------------------------------------------------------------

/** Run the stack `stackId` declared on DECODERS[decoderId] over that decoder's items. */
export function runStack(decoderId, stackId, items, params) {
  const st = DECODERS[decoderId]?.stack?.find((x) => x.id === stackId);
  if (!st) return [];
  return st.run(items, { ...st.params, ...params });
}

export const LOGIC_SESSION_FORMAT = 'skons-logic-session';

const bytesPerSampleOf = (buf) => (buf instanceof Uint32Array ? 4 : buf instanceof Uint16Array ? 2 : 1);

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Capture plus configuration as JSON text: samples (base64, little-endian), rate, names, decoder setup, cursors. */
export function serializeLogicSession({ samples, sampleRate, channelNames = [], channelCount = 8, decoderId = null, decoderConfig = null, stackId = '', cursors = null, triggerIndex = null }) {
  const width = bytesPerSampleOf(samples);
  const raw = new Uint8Array(samples.length * width);
  for (let i = 0; i < samples.length; i++) for (let b = 0; b < width; b++) raw[i * width + b] = (samples[i] >>> (8 * b)) & 0xff;
  return JSON.stringify({
    format: LOGIC_SESSION_FORMAT, version: 1, sampleRate, channelCount, bytesPerSample: width, sampleCount: samples.length,
    channelNames, decoderId, decoderConfig, stackId, cursors, triggerIndex, samples: toBase64(raw)
  });
}

export function parseLogicSession(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error('Not a JSON file.'); }
  if (j?.format !== LOGIC_SESSION_FORMAT) throw new Error('Not a logic analyzer session file.');
  if (j.version !== 1) throw new Error(`Unsupported session version ${j.version}.`);
  if (!(j.sampleRate > 0)) throw new Error('The session has no valid sample rate.');
  const width = j.bytesPerSample;
  if (![1, 2, 4].includes(width) || typeof j.samples !== 'string') throw new Error('The session sample data is malformed.');
  const bin = atob(j.samples);
  if (bin.length !== j.sampleCount * width) throw new Error('The session sample data is truncated.');
  const samples = width === 1 ? new Uint8Array(j.sampleCount) : width === 2 ? new Uint16Array(j.sampleCount) : new Uint32Array(j.sampleCount);
  for (let i = 0; i < j.sampleCount; i++) {
    let v = 0;
    for (let b = 0; b < width; b++) v += bin.charCodeAt(i * width + b) * 2 ** (8 * b);
    samples[i] = v;
  }
  return {
    samples, sampleRate: j.sampleRate, channelCount: j.channelCount || width * 8, channelNames: j.channelNames || [],
    decoderId: j.decoderId ?? null, decoderConfig: j.decoderConfig ?? null, stackId: j.stackId || '', cursors: j.cursors ?? null, triggerIndex: j.triggerIndex ?? null
  };
}
