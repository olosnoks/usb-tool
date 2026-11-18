/**
 * ExpressLRS / Crossfire (CRSF) protocol: frame building, a streaming frame parser,
 * CRC-8 (DVB-S2 polynomial 0xD5), telemetry decoders, and the device parameter
 * protocol (ping, device info, parameter read/write) as a small request client.
 *
 * Conventions used here:
 *  - Frame = [sync][len][type][payload...][crc8]; len = type + payload + crc (so len = payload + 2).
 *  - CRC-8 is computed over type + payload only (not sync or len).
 *  - Multi-byte fields are big-endian. RC channels are 11-bit values packed LSB-first.
 *  - Extended frames (type >= 0x28) start their payload with destination and origin addresses.
 *
 * No browser APIs here; everything is unit-testable without hardware.
 */

export const CRSF_SYNC = Object.freeze({
  FLIGHT_CONTROLLER: 0xc8,
  RECEIVER: 0xec,
  RADIO: 0xea,
  TX_MODULE: 0xee,
});

/** Origin address this tool uses for requests (the radio transmitter address). */
export const CRSF_HOST_ADDRESS = 0xea;
/** Destination 0x00 is broadcast: every device answers a ping. */
export const CRSF_BROADCAST = 0x00;

export const CRSF_BAUD_RATES = [115200, 400000, 416666, 420000, 921600];
export const CRSF_DEFAULT_BAUD = 420000;

/** Bytes accepted as the start of a frame. */
export const SYNC_BYTES = new Set([0xc8, 0xea, 0xee, 0xec]);

/** Largest allowed value of the len field (type + payload + crc). */
const MAX_LEN = 62;

export const FRAME_TYPE = Object.freeze({
  GPS: 0x02,
  BATTERY: 0x08,
  LINK_STATISTICS: 0x14,
  RC_CHANNELS_PACKED: 0x16,
  ATTITUDE: 0x1e,
  FLIGHT_MODE: 0x21,
  DEVICE_PING: 0x28,
  DEVICE_INFO: 0x29,
  PARAMETER_SETTINGS_ENTRY: 0x2b,
  PARAMETER_READ: 0x2c,
  PARAMETER_WRITE: 0x2d,
});

export const FRAME_TYPE_NAMES = Object.freeze({
  0x02: 'GPS',
  0x08: 'Battery',
  0x14: 'Link statistics',
  0x16: 'RC channels',
  0x1e: 'Attitude',
  0x21: 'Flight mode',
  0x28: 'Device ping',
  0x29: 'Device info',
  0x2b: 'Parameter entry',
  0x2c: 'Parameter read',
  0x2d: 'Parameter write',
});

export const ADDRESS_NAMES = Object.freeze({
  0xc8: 'Flight controller',
  0xec: 'Receiver',
  0xea: 'Radio transmitter',
  0xee: 'TX module',
  0x00: 'Broadcast',
});

export const PARAM_TYPE = Object.freeze({
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  UINT64: 6,
  INT64: 7,
  FLOAT: 8,
  TEXT_SELECTION: 9,
  STRING: 10,
  FOLDER: 11,
  INFO: 12,
  COMMAND: 13,
});

export const PARAM_TYPE_NAMES = Object.freeze({
  0: 'UINT8',
  1: 'INT8',
  2: 'UINT16',
  3: 'INT16',
  4: 'UINT32',
  5: 'INT32',
  6: 'UINT64',
  7: 'INT64',
  8: 'FLOAT',
  9: 'TEXT SELECT',
  10: 'STRING',
  11: 'FOLDER',
  12: 'INFO',
  13: 'COMMAND',
});

/** CRSF tx power index to milliwatts. */
export const TX_POWER_MW = Object.freeze({ 0: 10, 1: 25, 2: 100, 3: 500, 4: 1000, 5: 2000, 6: 250, 7: 50 });

// --- CRC-8 (poly 0xD5, init 0, no reflection, no final xor) -----------------------

const CRC_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let b = 0; b < 8; b++) c = c & 0x80 ? ((c << 1) ^ 0xd5) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();

/** CRC-8 over bytes[start..end). */
export function crc8(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) crc = CRC_TABLE[crc ^ bytes[i]];
  return crc;
}

// --- Frame building -----------------------------------------------------------

/** Build a complete CRSF frame. `payload` is the bytes after the type byte. */
export function buildFrame(type, payload = [], sync = CRSF_SYNC.TX_MODULE) {
  const body = [type, ...payload];
  const len = body.length + 1; // type + payload + crc
  if (len > MAX_LEN) throw new RangeError(`CRSF frame too long (${len} > ${MAX_LEN})`);
  const out = new Uint8Array(len + 2);
  out[0] = sync;
  out[1] = len;
  out.set(body, 2);
  out[out.length - 1] = crc8(out, 2, out.length - 1);
  return out;
}

export function buildDevicePing(sync = CRSF_SYNC.TX_MODULE) {
  return buildFrame(FRAME_TYPE.DEVICE_PING, [CRSF_BROADCAST, CRSF_HOST_ADDRESS], sync);
}

export function buildParamRead(dest, paramNum, chunk = 0, sync = CRSF_SYNC.TX_MODULE) {
  return buildFrame(FRAME_TYPE.PARAMETER_READ, [dest, CRSF_HOST_ADDRESS, paramNum, chunk], sync);
}

export function buildParamWrite(dest, paramNum, valueBytes, sync = CRSF_SYNC.TX_MODULE) {
  return buildFrame(FRAME_TYPE.PARAMETER_WRITE, [dest, CRSF_HOST_ADDRESS, paramNum, ...valueBytes], sync);
}

// --- Streaming parser ---------------------------------------------------------

/**
 * Streaming CRSF parser. push(chunk) accepts Uint8Array chunks of any size and returns
 * the complete, CRC-valid frames found so far. Bytes that do not start a valid frame are
 * skipped one at a time, so a corrupted frame resynchronises on the next sync byte.
 */
export function createCrsfParser() {
  let buf = new Uint8Array(0);
  const counters = { frames: 0, badCrc: 0, skipped: 0 };

  function push(chunk) {
    if (!chunk || chunk.length === 0) return [];
    const merged = new Uint8Array(buf.length + chunk.length);
    merged.set(buf, 0);
    merged.set(chunk, buf.length);
    buf = merged;

    const frames = [];
    let i = 0;
    while (i < buf.length) {
      if (!SYNC_BYTES.has(buf[i])) { i++; counters.skipped++; continue; }
      if (buf.length - i < 2) break;
      const len = buf[i + 1];
      if (len < 2 || len > MAX_LEN) { i++; counters.skipped++; continue; }
      const total = len + 2;
      if (buf.length - i < total) break; // wait for the rest of the frame
      if (crc8(buf, i + 2, i + total - 1) !== buf[i + total - 1]) { i++; counters.badCrc++; continue; }
      frames.push({
        sync: buf[i],
        type: buf[i + 2],
        payload: buf.slice(i + 3, i + total - 1),
        raw: buf.slice(i, i + total),
      });
      counters.frames++;
      i += total;
    }
    buf = buf.slice(i);
    return frames;
  }

  return {
    push,
    reset() { buf = new Uint8Array(0); },
    get stats() { return { ...counters }; },
    get pendingBytes() { return buf.length; },
  };
}

// --- Byte helpers -----------------------------------------------------------------

export function toHex(bytes, sep = ' ') {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(sep);
}

/** Read an unsigned or two's-complement integer, big-endian. */
function readInt(bytes, offset, size, signed) {
  let v = 0;
  for (let i = 0; i < size; i++) v = v * 256 + bytes[offset + i];
  if (signed && v >= 2 ** (8 * size - 1)) v -= 2 ** (8 * size);
  return v;
}

/** Sequential reader that throws RangeError on truncated input. */
class Reader {
  constructor(bytes) { this.b = bytes; this.o = 0; }
  need(n) { if (this.o + n > this.b.length) throw new RangeError('truncated CRSF payload'); }
  u8() { this.need(1); return this.b[this.o++]; }
  int(size, signed = false) { this.need(size); const v = readInt(this.b, this.o, size, signed); this.o += size; return v; }
  /** Null-terminated ASCII; a missing terminator reads to the end. */
  cstr() {
    let e = this.o;
    while (e < this.b.length && this.b[e] !== 0) e++;
    let text = '';
    for (let i = this.o; i < e; i++) text += String.fromCharCode(this.b[i]);
    this.o = Math.min(e + 1, this.b.length);
    return text;
  }
  rest() { const r = this.b.subarray(this.o); this.o = this.b.length; return r; }
}

const safeDecode = (fn) => { try { return fn(); } catch (err) { if (err instanceof RangeError) return null; throw err; } };

// --- Telemetry decoders -------------------------------------------------------------

/** RC channels packed frame (0x16): 16 channels of 11 bits, LSB-first. Returns raw 0..2047 values and microseconds. */
export function decodeRcChannels(payload) {
  if (!payload || payload.length < 22) return null;
  const raw = new Array(16);
  let acc = 0;
  let bits = 0;
  let idx = 0;
  for (let c = 0; c < 16; c++) {
    while (bits < 11) { acc |= payload[idx++] << bits; bits += 8; }
    raw[c] = acc & 0x7ff;
    acc >>>= 11;
    bits -= 11;
  }
  return { raw, us: raw.map(toMicroseconds) };
}

/** CRSF value 172..1811 (992 centre) to a servo pulse in microseconds (988..2012 for the full range). */
export function toMicroseconds(raw) {
  return Math.round(1500 + ((raw - 992) * 5) / 8);
}

/** Link statistics (0x14), 10 bytes. RSSI values are sent as positive magnitudes and returned as negative dBm. */
export function decodeLinkStatistics(payload) {
  return safeDecode(() => {
    const r = new Reader(payload);
    const upRssi1 = -r.u8();
    const upRssi2 = -r.u8();
    const upLq = r.u8();
    const upSnr = r.int(1, true);
    const antenna = r.u8();
    const rfMode = r.u8();
    const powerIndex = r.u8();
    const downRssi = -r.u8();
    const downLq = r.u8();
    const downSnr = r.int(1, true);
    return {
      upRssi1, upRssi2, upLq, upSnr, antenna, rfMode,
      upPowerIndex: powerIndex,
      upPowerMw: TX_POWER_MW[powerIndex] ?? null,
      downRssi, downLq, downSnr,
    };
  });
}

/** Battery sensor (0x08), 8 bytes: voltage 0.1 V, current 0.1 A, capacity mAh (24-bit), remaining %. */
export function decodeBattery(payload) {
  return safeDecode(() => {
    const r = new Reader(payload);
    const voltageV = r.int(2) / 10;
    const currentA = r.int(2) / 10;
    const capacityMah = r.int(3);
    const remainingPct = r.u8();
    return { voltageV, currentA, capacityMah, remainingPct };
  });
}

/** GPS (0x02), 15 bytes. */
export function decodeGps(payload) {
  return safeDecode(() => {
    const r = new Reader(payload);
    const lat = r.int(4, true) / 1e7;
    const lon = r.int(4, true) / 1e7;
    const groundspeedKmh = r.int(2) / 10;
    const headingDeg = r.int(2) / 100;
    const altitudeM = r.int(2) - 1000;
    const satellites = r.u8();
    return { lat, lon, groundspeedKmh, headingDeg, altitudeM, satellites };
  });
}

/** Attitude (0x1E), 6 bytes: pitch, roll, yaw as int16 in 1/10000 rad. */
export function decodeAttitude(payload) {
  return safeDecode(() => {
    const r = new Reader(payload);
    const toDeg = (v) => (v / 10000) * (180 / Math.PI);
    const pitchDeg = toDeg(r.int(2, true));
    const rollDeg = toDeg(r.int(2, true));
    const yawDeg = toDeg(r.int(2, true));
    return { pitchDeg, rollDeg, yawDeg };
  });
}

/** Flight mode (0x21): null-terminated ASCII text. */
export function decodeFlightMode(payload) {
  return safeDecode(() => new Reader(payload).cstr());
}

/** Device info (0x29), extended frame: dest, origin, name, serial, hardware id, firmware id, parameter count, parameter version. */
export function decodeDeviceInfo(payload) {
  return safeDecode(() => {
    const r = new Reader(payload);
    const dest = r.u8();
    const address = r.u8();
    const name = r.cstr();
    const serial = r.int(4);
    const hardwareId = r.int(4);
    const firmwareId = r.int(4);
    const paramCount = r.u8();
    const paramVersion = r.u8();
    return { dest, address, name, serial, hardwareId, firmwareId, paramCount, paramVersion };
  });
}

/** Decode a parsed frame into a named telemetry object, or null if it is not a decoded type. */
export function decodeTelemetry(frame) {
  const p = frame.payload;
  switch (frame.type) {
    case FRAME_TYPE.RC_CHANNELS_PACKED: return { kind: 'rc', data: decodeRcChannels(p) };
    case FRAME_TYPE.LINK_STATISTICS: return { kind: 'link', data: decodeLinkStatistics(p) };
    case FRAME_TYPE.BATTERY: return { kind: 'battery', data: decodeBattery(p) };
    case FRAME_TYPE.GPS: return { kind: 'gps', data: decodeGps(p) };
    case FRAME_TYPE.ATTITUDE: return { kind: 'attitude', data: decodeAttitude(p) };
    case FRAME_TYPE.FLIGHT_MODE: return { kind: 'flightMode', data: decodeFlightMode(p) };
    case FRAME_TYPE.DEVICE_INFO: return { kind: 'device', data: decodeDeviceInfo(p) };
    default: return null;
  }
}

// --- Device parameters -----------------------------------------------------------

/**
 * Parameter settings entry (0x2B): dest, origin, parameter number, chunks remaining,
 * then a chunk of the parameter body. Returns null for a short payload.
 */
export function decodeParamEntry(payload) {
  if (!payload || payload.length < 4) return null;
  return {
    dest: payload[0],
    origin: payload[1],
    paramNum: payload[2],
    chunksRemaining: payload[3],
    data: payload.subarray(4),
  };
}

/**
 * Decode an assembled parameter body: parent folder, type (bit 7 = hidden), name, then the
 * type-specific fields. Throws RangeError if the body is truncated.
 */
export function decodeParamBody(bytes) {
  const r = new Reader(bytes);
  const parent = r.u8();
  const rawType = r.u8();
  const hidden = (rawType & 0x80) !== 0;
  const type = rawType & 0x7f;
  const name = r.cstr();
  const base = { parent, type, typeName: PARAM_TYPE_NAMES[type] || `unknown (${type})`, hidden, name };

  switch (type) {
    case PARAM_TYPE.UINT8:
    case PARAM_TYPE.INT8:
    case PARAM_TYPE.UINT16:
    case PARAM_TYPE.INT16:
    case PARAM_TYPE.UINT32:
    case PARAM_TYPE.INT32: {
      const { size, signed } = INT_LAYOUT[type];
      const value = r.int(size, signed);
      const min = r.int(size, signed);
      const max = r.int(size, signed);
      const def = r.int(size, signed);
      return { ...base, value, min, max, default: def, unit: r.cstr(), decimals: 0, writable: true };
    }
    case PARAM_TYPE.FLOAT: {
      const rawValue = r.int(4, true);
      const rawMin = r.int(4, true);
      const rawMax = r.int(4, true);
      const rawDefault = r.int(4, true);
      const decimals = r.u8();
      const step = r.int(4, true) / 10 ** decimals;
      const scale = 10 ** decimals;
      return {
        ...base,
        value: rawValue / scale, min: rawMin / scale, max: rawMax / scale, default: rawDefault / scale,
        rawValue, rawMin, rawMax, decimals, step, unit: r.cstr(), writable: true,
      };
    }
    case PARAM_TYPE.TEXT_SELECTION: {
      const options = r.cstr().split(';');
      const value = r.u8();
      const min = r.u8();
      const max = r.u8();
      const def = r.u8();
      return { ...base, options, value, min, max, default: def, unit: r.cstr(), writable: true };
    }
    case PARAM_TYPE.STRING:
      return { ...base, value: r.cstr(), writable: false };
    case PARAM_TYPE.FOLDER:
      return { ...base, children: Array.from(r.rest()).filter((v) => v !== 0xff), writable: false };
    case PARAM_TYPE.INFO:
      return { ...base, value: r.cstr(), writable: false };
    case PARAM_TYPE.COMMAND: {
      const status = r.u8();
      const timeout = r.u8();
      return { ...base, status, timeout, info: r.cstr(), writable: true };
    }
    default:
      // 64-bit numerics and unknown types: keep the raw bytes, do not guess.
      return { ...base, raw: Array.from(r.rest()), writable: false, note: 'Type not decoded by this tool.' };
  }
}

const INT_LAYOUT = Object.freeze({
  0: { size: 1, signed: false },
  1: { size: 1, signed: true },
  2: { size: 2, signed: false },
  3: { size: 2, signed: true },
  4: { size: 4, signed: false },
  5: { size: 4, signed: true },
});

/**
 * Bytes to send in PARAMETER_WRITE for a decoded parameter and a new value. Throws if the
 * value is out of range or the type is not writable here (strings, folders, info).
 */
export function encodeParamValue(param, value) {
  if (!param.writable) throw new Error(`${param.typeName} parameters are not writable from this tool.`);
  const t = param.type;
  if (t in INT_LAYOUT) {
    const { size } = INT_LAYOUT[t];
    if (!Number.isInteger(value)) throw new Error('Value must be a whole number.');
    if (value < param.min || value > param.max) throw new Error(`Value must be between ${param.min} and ${param.max}.`);
    return encodeInt(value, size);
  }
  if (t === PARAM_TYPE.FLOAT) {
    if (!Number.isFinite(value)) throw new Error('Value must be a number.');
    const raw = Math.round(value * 10 ** param.decimals);
    if (raw < param.rawMin || raw > param.rawMax) throw new Error(`Value must be between ${param.min} and ${param.max}.`);
    return encodeInt(raw, 4);
  }
  if (t === PARAM_TYPE.TEXT_SELECTION) {
    if (!Number.isInteger(value) || value < param.min || value > param.max) {
      throw new Error(`Choose an option between ${param.min} and ${param.max}.`);
    }
    return [value];
  }
  if (t === PARAM_TYPE.COMMAND) return [1]; // "execute" step
  throw new Error('This parameter type is not writable.');
}

function encodeInt(value, size) {
  let v = value < 0 ? value + 2 ** (8 * size) : value;
  const out = new Array(size);
  for (let i = size - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256); }
  return out;
}

/** Concatenate Uint8Array chunks. */
function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

/**
 * Request client for the device parameter protocol. The caller supplies `send(bytes)` to
 * transmit a frame and feeds every received frame to `feed(frame)`. One outstanding read per
 * parameter; each read retries on timeout and then rejects. Nothing here is simulated.
 */
export function createParamClient({ send, dest, sync = CRSF_SYNC.TX_MODULE, timeoutMs = 800, retries = 2 }) {
  const pending = new Map(); // paramNum -> { chunks, tries, timer, resolve, reject }

  function request(num, chunk) {
    send(buildParamRead(dest, num, chunk, sync));
  }

  function arm(num, p) {
    clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (pending.get(num) !== p) return;
      if (p.tries >= retries) {
        pending.delete(num);
        p.reject(new Error(`No response for parameter ${num} after ${p.tries + 1} attempts.`));
        return;
      }
      p.tries += 1;
      request(num, p.chunks.length);
      arm(num, p);
    }, timeoutMs);
  }

  function readParam(num) {
    if (!Number.isInteger(num) || num < 1 || num > 255) {
      return Promise.reject(new RangeError('Parameter number must be 1..255.'));
    }
    if (pending.has(num)) return Promise.reject(new Error(`Parameter ${num} is already being read.`));
    return new Promise((resolve, reject) => {
      const p = { chunks: [], tries: 0, timer: null, resolve, reject };
      pending.set(num, p);
      try {
        request(num, 0);
      } catch (err) {
        pending.delete(num);
        reject(err);
        return;
      }
      arm(num, p);
    });
  }

  /** Returns true if the frame belonged to an outstanding read. */
  function feed(frame) {
    if (frame.type !== FRAME_TYPE.PARAMETER_SETTINGS_ENTRY) return false;
    const entry = decodeParamEntry(frame.payload);
    if (!entry || entry.dest !== CRSF_HOST_ADDRESS || entry.origin !== dest) return false;
    const p = pending.get(entry.paramNum);
    if (!p) return false;
    p.chunks.push(entry.data);
    p.tries = 0;
    if (entry.chunksRemaining > 0) {
      request(entry.paramNum, p.chunks.length);
      arm(entry.paramNum, p);
      return true;
    }
    clearTimeout(p.timer);
    pending.delete(entry.paramNum);
    try {
      p.resolve({ ...decodeParamBody(concatBytes(p.chunks)), paramNum: entry.paramNum, device: entry.origin });
    } catch (err) {
      p.reject(err);
    }
    return true;
  }

  /** Write a value, then read the parameter back. Resolves with the read-back entry. */
  async function writeParam(param, value) {
    const bytes = encodeParamValue(param, value);
    send(buildParamWrite(dest, param.paramNum, bytes, sync));
    return readParam(param.paramNum);
  }

  /** Reject every outstanding read (used on disconnect). */
  function reset(reason = 'Connection closed.') {
    for (const [num, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      pending.delete(num);
    }
  }

  return { readParam, writeParam, feed, reset, get busy() { return pending.size > 0; } };
}
