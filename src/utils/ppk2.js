/**
 * ppk2.js — Nordic Power Profiler Kit II (PPK2): protocol, decoding and calibration.
 *
 * Ported from IRNAS ppk2-api-python (src/ppk2_api/ppk2_api.py, master branch), which follows
 * the nRF Connect Power Profiler app. Command bytes, the metadata text format, the 4-byte
 * sample layout and the per-range current formula are taken from that source. The spike
 * filter / rolling average that ppk2-api-python applies on top of the formula is NOT ported.
 *
 * Everything above `Ppk2Device` is pure logic (no browser APIs) so it is unit-tested with
 * real byte vectors. `Ppk2Device` wraps a Web Serial port (or any duck-typed fake).
 */

export const PPK2_USB_VENDOR_ID = 0x1915;
export const PPK2_USB_PRODUCT_ID = 0xc00a;
/** ppk2-api-python sets 9600; the USB CDC endpoint ignores the rate. */
export const PPK2_BAUD = 9600;
/** 100 000 four-byte samples per second (ppk2-api-python buffer sizing comment). */
export const SAMPLE_RATE_HZ = 100000;
export const SAMPLE_BYTES = 4;
export const VDD_MIN_MV = 800;
export const VDD_MAX_MV = 5000;
/** ppk2-api-python: `self.adc_mult = 1.8 / 163840`. */
export const ADC_MULT = 1.8 / 163840;

/** Command bytes (ppk2-api-python PPK2_Command). */
export const PPK2_CMD = {
  NO_OP: 0x00,
  TRIGGER_SET: 0x01,
  AVG_NUM_SET: 0x02,
  AVERAGE_START: 0x06,
  AVERAGE_STOP: 0x07,
  DEVICE_RUNNING_SET: 0x0c,
  REGULATOR_SET: 0x0d,
  SET_POWER_MODE: 0x11,
  GET_META_DATA: 0x19,
  RESET: 0x20,
};

export const MODE_AMPERE = 'ampere';
export const MODE_SOURCE = 'source';

const CAL_NAMES = ['R', 'GS', 'GI', 'O', 'S', 'I', 'UG'];

// ---------------------------------------------------------------------------
// Command encoders
// ---------------------------------------------------------------------------

/** REGULATOR_SET: source voltage in mV, clamped to 800-5000 like ppk2-api-python. */
export function encodeRegulatorSet(mv) {
  const n = Number(mv);
  if (!Number.isFinite(n)) throw new RangeError(`Voltage is not a number: ${mv}`);
  const v = Math.min(VDD_MAX_MV, Math.max(VDD_MIN_MV, Math.round(n)));
  // ppk2-api-python: diff = mV - 800 + 32; byte1 = 3 + diff // 256; byte2 = diff % 256
  const diff = v - VDD_MIN_MV + 32;
  return Uint8Array.of(PPK2_CMD.REGULATOR_SET, 3 + Math.floor(diff / 256), diff % 256);
}

/** SET_POWER_MODE: 1 = ampere meter, 2 = source meter. */
export function encodeSetPowerMode(mode) {
  if (mode === MODE_AMPERE) return Uint8Array.of(PPK2_CMD.SET_POWER_MODE, 1);
  if (mode === MODE_SOURCE) return Uint8Array.of(PPK2_CMD.SET_POWER_MODE, 2);
  throw new RangeError(`Unknown PPK2 mode: ${mode}`);
}

/** DEVICE_RUNNING_SET: switch the DUT supply on (1) or off (0). */
export function encodeDutPower(on) {
  return Uint8Array.of(PPK2_CMD.DEVICE_RUNNING_SET, on ? 1 : 0);
}

export const encodeAverageStart = () => Uint8Array.of(PPK2_CMD.AVERAGE_START);
export const encodeAverageStop = () => Uint8Array.of(PPK2_CMD.AVERAGE_STOP);
export const encodeGetMetadata = () => Uint8Array.of(PPK2_CMD.GET_META_DATA);

// ---------------------------------------------------------------------------
// Metadata (calibration) text
// ---------------------------------------------------------------------------

/** Factory defaults used by ppk2-api-python before metadata is read. Not a real calibration. */
export function defaultCalibration() {
  return {
    R: [1031.64, 101.65, 10.15, 0.94, 0.043],
    GS: [1, 1, 1, 1, 1],
    GI: [1, 1, 1, 1, 1],
    O: [0, 0, 0, 0, 0],
    S: [0, 0, 0, 0, 0],
    I: [0, 0, 0, 0, 0],
    UG: [1, 1, 1, 1, 1],
  };
}

/**
 * Parse the text returned by GET_META_DATA (lines of `key: value`, terminated by `END`).
 *
 * Per-range keys are R0-R4, GS0-GS4, GI0-GI4, O0-O4, S0-S4, I0-I4, UG0-UG4. Like
 * ppk2-api-python, an R value of 0 keeps the default (and is reported as a warning).
 * `complete` is false when any per-range key is missing; callers must not present
 * currents as calibrated in that case.
 *
 * @param {string} text
 * @returns {{ calibration: object, complete: boolean, missing: string[], warnings: string[],
 *            meta: { vdd: number|null, hw: string|null, mode: string|null,
 *                    calibrated: string|null, ia: string|null }, hasEnd: boolean }}
 */
export function parseMetadata(text) {
  if (typeof text !== 'string') throw new TypeError('Metadata must be text');
  const calibration = defaultCalibration();
  const seen = new Set();
  const warnings = [];
  const meta = { vdd: null, hw: null, mode: null, calibrated: null, ia: null };

  for (const rawLine of text.split(/\r?\n/)) {
    const idx = rawLine.indexOf(':');
    if (idx < 0) continue;
    const key = rawLine.slice(0, idx).trim();
    const val = rawLine.slice(idx + 1).trim();
    const m = /^(R|GS|GI|O|S|I|UG)([0-4])$/.exec(key);
    if (m) {
      const n = Number(val);
      if (val === '' || !Number.isFinite(n)) {
        throw new Error(`Metadata ${key} is not a number: "${val}"`);
      }
      const i = Number(m[2]);
      if (m[1] === 'R' && n === 0) {
        warnings.push(`${key} reads 0; the default resistor value is kept`);
        continue;
      }
      calibration[m[1]][i] = n;
      seen.add(key);
      continue;
    }
    if (key === 'VDD') {
      const n = Number(val);
      meta.vdd = Number.isFinite(n) ? n : null;
    } else if (key === 'HW') meta.hw = val;
    else if (key === 'mode') meta.mode = val;
    else if (key === 'Calibrated') meta.calibrated = val;
    else if (key === 'IA') meta.ia = val;
  }

  const missing = [];
  for (const name of CAL_NAMES) {
    for (let i = 0; i <= 4; i++) {
      const k = `${name}${i}`;
      if (!seen.has(k)) missing.push(k);
    }
  }
  return {
    calibration,
    complete: missing.length === 0,
    missing,
    warnings,
    meta,
    hasEnd: text.includes('END'),
  };
}

// ---------------------------------------------------------------------------
// Sample decoding
// ---------------------------------------------------------------------------

/**
 * Split one 32-bit little-endian sample word into its fields.
 *   bits 0-13  : ADC value (14 bit)
 *   bits 14-16 : current range 0-4 (3 bit; values above 4 are clipped to 4 by the reference)
 *   bits 17-23 : not used by ppk2-api-python (counter bits are not decoded)
 *   bits 24-31 : digital channels D0-D7
 */
export function decodeWord(word) {
  const w = word >>> 0;
  return {
    adc: w & 0x3fff,
    range: Math.min((w >>> 14) & 0x7, 4),
    bits: (w >>> 24) & 0xff,
  };
}

/**
 * Convert one sample word to microamperes, using ppk2-api-python's formula:
 *   v   = (adc*4 - O[r]) * (ADC_MULT / R[r])
 *   I_A = UG[r] * (v * (GS[r]*v + GI[r]) + (S[r]*(vdd_mV/1000) + I[r]))
 */
export function wordToUa(word, cal, vddMv) {
  const { adc, range } = decodeWord(word);
  const adcScaled = adc * 4;
  const v = (adcScaled - cal.O[range]) * (ADC_MULT / cal.R[range]);
  const amps = cal.UG[range] * (v * (cal.GS[range] * v + cal.GI[range]) + (cal.S[range] * (vddMv / 1000) + cal.I[range]));
  return amps * 1e6;
}

/** Streaming decoder state: keeps a partial sample between serial chunks. */
export function createSampleDecoder() {
  return { carry: new Uint8Array(0) };
}

/** Decode a raw chunk into 32-bit words, carrying any trailing partial sample. */
export function decodeWords(decoder, bytes) {
  let buf = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (decoder.carry.length) {
    const joined = new Uint8Array(decoder.carry.length + buf.length);
    joined.set(decoder.carry, 0);
    joined.set(buf, decoder.carry.length);
    buf = joined;
  }
  const whole = buf.length - (buf.length % SAMPLE_BYTES);
  const words = new Uint32Array(whole / SAMPLE_BYTES);
  const dv = new DataView(buf.buffer, buf.byteOffset, whole);
  for (let i = 0; i < words.length; i++) words[i] = dv.getUint32(i * SAMPLE_BYTES, true);
  decoder.carry = buf.slice(whole);
  return words;
}

/** Convert a chunk of words to µA and digital bytes. */
export function convertWords(words, cal, vddMv) {
  const uA = new Float32Array(words.length);
  const bits = new Uint8Array(words.length);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    uA[i] = wordToUa(w, cal, vddMv);
    bits[i] = (w >>> 24) & 0xff;
  }
  return { uA, bits };
}

// ---------------------------------------------------------------------------
// Sample storage and analysis
// ---------------------------------------------------------------------------

/**
 * Fixed-size ring of converted samples, addressed by absolute sample index
 * (0 = first sample of the session). Old samples are overwritten once full.
 */
export class SampleRing {
  constructor(capacity) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.uA = new Float32Array(this.capacity);
    this.bits = new Uint8Array(this.capacity);
    this.total = 0;
  }

  get oldest() { return Math.max(0, this.total - this.capacity); }

  push(uA, bits) {
    const n = uA.length;
    let i = this.total % this.capacity;
    for (let k = 0; k < n; k++) {
      this.uA[i] = uA[k];
      this.bits[i] = bits[k];
      if (++i === this.capacity) i = 0;
    }
    this.total += n;
  }

  uAt(abs) { return this.uA[abs % this.capacity]; }
  bitsAt(abs) { return this.bits[abs % this.capacity]; }
}

/**
 * Min/max/average envelope of [fromAbs, toAbs) split into `buckets` columns, plus
 * per-column digital state: andBits has a lane bit set only if it was high for every
 * sample in the column, orBits only if it was high for at least one.
 */
export function envelope(ring, fromAbs, toAbs, buckets) {
  const out = {
    min: new Float32Array(buckets),
    max: new Float32Array(buckets),
    avg: new Float32Array(buckets),
    andBits: new Uint8Array(buckets),
    orBits: new Uint8Array(buckets),
    valid: new Uint8Array(buckets),
  };
  const span = toAbs - fromAbs;
  if (span <= 0 || buckets <= 0) return out;
  const cap = ring.capacity;
  for (let b = 0; b < buckets; b++) {
    const a = fromAbs + Math.floor((b * span) / buckets);
    const e = fromAbs + Math.floor(((b + 1) * span) / buckets);
    if (e <= a) continue;
    let mn = Infinity;
    let mx = -Infinity;
    let sum = 0;
    let andB = 0xff;
    let orB = 0;
    let i = a % cap;
    for (let k = a; k < e; k++) {
      const v = ring.uA[i];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sum += v;
      const bt = ring.bits[i];
      andB &= bt;
      orB |= bt;
      if (++i === cap) i = 0;
    }
    out.min[b] = mn;
    out.max[b] = mx;
    out.avg[b] = sum / (e - a);
    out.andBits[b] = andB;
    out.orBits[b] = orB;
    out.valid[b] = 1;
  }
  return out;
}

/**
 * Statistics over [fromAbs, toAbs). Charge is the integral of current over time, using
 * the 100 kS/s sample period. Energy needs a supply voltage (volts); null if not given.
 */
export function rangeStats(ring, fromAbs, toAbs, voltageV = null) {
  const count = Math.max(0, toAbs - fromAbs);
  const empty = {
    samples: 0, durationS: 0, avgUa: null, minUa: null, maxUa: null,
    chargeUc: null, chargeMah: null, energyUj: null, energyMwh: null,
  };
  if (count === 0) return empty;
  const cap = ring.capacity;
  let mn = Infinity;
  let mx = -Infinity;
  let sum = 0;
  let i = fromAbs % cap;
  for (let k = fromAbs; k < toAbs; k++) {
    const v = ring.uA[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    if (++i === cap) i = 0;
  }
  const durationS = count / SAMPLE_RATE_HZ;
  const chargeUc = sum / SAMPLE_RATE_HZ; // µA * s = µC
  const hasV = Number.isFinite(voltageV) && voltageV > 0;
  return {
    samples: count,
    durationS,
    avgUa: sum / count,
    minUa: mn,
    maxUa: mx,
    chargeUc,
    chargeMah: chargeUc / 3.6e6, // 1 mAh = 3.6e6 µC
    energyUj: hasV ? chargeUc * voltageV : null, // µC * V = µJ
    energyMwh: hasV ? (chargeUc * voltageV) / 3.6e6 : null, // 1 mWh = 3.6e6 µJ
  };
}

/** Mean of the last `n` samples before `endAbs` (for the live readout). */
export function recentAverageUa(ring, endAbs, n = 200) {
  const from = Math.max(ring.oldest, endAbs - n);
  if (endAbs <= from) return null;
  let sum = 0;
  for (let k = from; k < endAbs; k++) sum += ring.uAt(k);
  return sum / (endAbs - from);
}

/**
 * Spread and activity analysis of [fromAbs, toAbs). Standard deviation and peak-to-peak
 * describe the whole range. With a threshold (µA), samples above it count as "active":
 * the result gives the active fraction, mean active and idle current and the number of
 * separate active bursts. A burst is one run of consecutive samples above the threshold.
 */
export function activityStats(ring, fromAbs, toAbs, thresholdUa = null) {
  const count = Math.max(0, toAbs - fromAbs);
  if (count === 0) {
    return { samples: 0, stdUa: null, p2pUa: null, activeFraction: null, activeAvgUa: null, idleAvgUa: null, bursts: null, activeS: null };
  }
  const cap = ring.capacity;
  const hasT = Number.isFinite(thresholdUa);
  let sum = 0;
  let mn = Infinity;
  let mx = -Infinity;
  let activeN = 0;
  let activeSum = 0;
  let idleSum = 0;
  let bursts = 0;
  let prevActive = false;
  let i = fromAbs % cap;
  for (let k = fromAbs; k < toAbs; k++) {
    const v = ring.uA[i];
    sum += v;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    if (hasT) {
      const act = v > thresholdUa;
      if (act) { activeN++; activeSum += v; if (!prevActive) bursts++; } else idleSum += v;
      prevActive = act;
    }
    if (++i === cap) i = 0;
  }
  const mean = sum / count;
  let sq = 0;
  let j = fromAbs % cap;
  for (let k = fromAbs; k < toAbs; k++) {
    const d = ring.uA[j] - mean;
    sq += d * d;
    if (++j === cap) j = 0;
  }
  const idleN = count - activeN;
  return {
    samples: count,
    stdUa: Math.sqrt(sq / count),
    p2pUa: mx - mn,
    activeFraction: hasT ? activeN / count : null,
    activeAvgUa: hasT && activeN ? activeSum / activeN : null,
    idleAvgUa: hasT && idleN ? idleSum / idleN : null,
    bursts: hasT ? bursts : null,
    activeS: hasT ? activeN / SAMPLE_RATE_HZ : null,
  };
}

/**
 * Battery life from capacity (mAh) and average current (µA), like the simple average-current
 * method of battery estimators. `marginPct` (0-90) keeps that share of capacity unused
 * (derating for cutoff voltage, temperature and self-discharge). Returns hours, or null.
 */
export function batteryLifeHours(capacityMah, avgUa, marginPct = 0) {
  const cap = Number(capacityMah);
  const ua = Number(avgUa);
  const m = Math.min(90, Math.max(0, Number(marginPct) || 0));
  if (!Number.isFinite(cap) || cap <= 0 || !Number.isFinite(ua) || ua <= 0) return null;
  return (cap * (1 - m / 100)) / (ua / 1000);
}

/** Human duration for a number of hours: minutes, hours, days or years. */
export function formatLife(hours) {
  if (hours == null || !Number.isFinite(hours)) return '—';
  if (hours < 1) return `${(hours * 60).toFixed(1)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  const days = hours / 24;
  if (days < 365) return `${days.toFixed(1)} days`;
  return `${(days / 365.25).toFixed(2)} years (${Math.round(days)} days)`;
}

/**
 * Map a current to a 0-1 chart height. Linear from 0, or logarithmic over [floorUa, maxUa]
 * (floor must be above 0) so µA sleep current and mA bursts both stay visible.
 */
export function scaleCurrent(v, maxUa, log = false, floorUa = 0.1) {
  if (!(maxUa > 0)) return 0;
  if (!log) return Math.max(0, Math.min(1, v / maxUa));
  const lo = Math.log10(Math.max(floorUa, 1e-9));
  const hi = Math.log10(Math.max(maxUa, floorUa * 10));
  const x = (Math.log10(Math.max(v, floorUa)) - lo) / (hi - lo);
  return Math.max(0, Math.min(1, x));
}

/** Plain-text summary of a stats object (for the clipboard). */
export function statsSummary(title, st, voltageV, act = null) {
  if (!st || !st.samples) return `${title}: no samples`;
  const lines = [
    `${title} (${st.durationS.toFixed(3)} s, ${st.samples} samples)`,
    `avg ${st.avgUa.toFixed(3)} uA, min ${st.minUa.toFixed(3)} uA, max ${st.maxUa.toFixed(3)} uA`,
    `charge ${st.chargeUc.toFixed(3)} uC (${st.chargeMah.toExponential(3)} mAh)`,
  ];
  if (st.energyUj != null) lines.push(`energy ${st.energyUj.toFixed(3)} uJ at ${voltageV.toFixed(3)} V`);
  if (act && act.stdUa != null) lines.push(`std ${act.stdUa.toFixed(3)} uA, peak-to-peak ${act.p2pUa.toFixed(3)} uA`);
  return lines.join('\n');
}

export const CSV_HEADER = 'time_s,current_uA,D0,D1,D2,D3,D4,D5,D6,D7';

/** CSV rows for [fromAbs, toAbs) without the header. Time is measured from the session start. */
export function csvRows(ring, fromAbs, toAbs) {
  const lines = [];
  for (let k = fromAbs; k < toAbs; k++) {
    const b = ring.bitsAt(k);
    let row = `${(k / SAMPLE_RATE_HZ).toFixed(5)},${ring.uAt(k).toFixed(3)}`;
    for (let lane = 0; lane < 8; lane++) row += `,${(b >> lane) & 1}`;
    lines.push(row);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Web Serial I/O
// ---------------------------------------------------------------------------

/** Ask the user for a PPK2 on its own serial port (not the app's shared port). */
export async function requestPpk2Port(serial = typeof navigator !== 'undefined' ? navigator.serial : undefined) {
  if (!serial) throw new Error('Web Serial needs Chrome or Edge on desktop.');
  return serial.requestPort({
    filters: [{ usbVendorId: PPK2_USB_VENDOR_ID, usbProductId: PPK2_USB_PRODUCT_ID }],
  });
}

/**
 * One open PPK2. Owns the port's read loop; while a metadata read is pending the bytes go
 * to it instead of the sample callback. Stale bytes after open are discarded.
 */
export class Ppk2Device {
  constructor(port) {
    this.port = port;
    this.isOpen = false;
    this.onSamples = null; // (Uint8Array) => void
    this.onDisconnect = null; // (Error|null) => void
    this._reader = null;
    this._writer = null;
    this._metaCollector = null;
    this._discardUntil = 0;
    this._loop = null;
  }

  async open() {
    await this.port.open({ baudRate: PPK2_BAUD });
    this.isOpen = true;
    this._discardUntil = Date.now() + 150;
    this._loop = this._run();
  }

  async _run() {
    let failure = null;
    try {
      this._reader = this.port.readable.getReader();
      for (;;) {
        const { value, done } = await this._reader.read();
        if (done) break;
        if (!value || !value.length) continue;
        if (this._metaCollector) this._metaCollector(value);
        else if (Date.now() >= this._discardUntil && this.onSamples) this.onSamples(value);
      }
    } catch (e) {
      failure = e;
    } finally {
      try { this._reader?.releaseLock(); } catch (e) { /* ignore */ }
      this._reader = null;
      const wasOpen = this.isOpen;
      this.isOpen = false;
      if (wasOpen && this.onDisconnect) this.onDisconnect(failure);
    }
  }

  async _write(bytes) {
    if (!this.isOpen) throw new Error('PPK2 is not open');
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  /** Request GET_META_DATA and resolve with the text once `END` has been received. */
  readMetadata(timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const dec = new TextDecoder();
      let text = '';
      const timer = setTimeout(() => {
        this._metaCollector = null;
        reject(new Error('The PPK2 did not return calibration metadata (is it the PPK2 and not in use elsewhere?)'));
      }, timeoutMs);
      this._metaCollector = (bytes) => {
        text += dec.decode(bytes, { stream: true });
        if (text.includes('END')) {
          clearTimeout(timer);
          this._metaCollector = null;
          resolve(text);
        }
      };
      this._write(encodeGetMetadata()).catch((e) => {
        clearTimeout(timer);
        this._metaCollector = null;
        reject(e);
      });
    });
  }

  setPowerMode(mode) { return this._write(encodeSetPowerMode(mode)); }
  setVoltageMv(mv) { return this._write(encodeRegulatorSet(mv)); }
  setDutPower(on) { return this._write(encodeDutPower(on)); }
  startAverage() { return this._write(encodeAverageStart()); }
  stopAverage() { return this._write(encodeAverageStop()); }

  async close() {
    if (!this.isOpen && !this._reader) return;
    this.isOpen = false;
    try { await this._reader?.cancel(); } catch (e) { /* already closed */ }
    try { await this._loop; } catch (e) { /* ignore */ }
    try { await this.port.close(); } catch (e) { /* ignore */ }
  }
}
