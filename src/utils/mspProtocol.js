/**
 * mspProtocol.js: MultiWii Serial Protocol (MSP) for Betaflight / INAV flight controllers.
 *
 * Pure logic, no React and no hardware access:
 *  - encoders for MSP v1 (`$M<`) and MSP v2 (`$X<`, CRC-8 DVB-S2 trailer)
 *  - a streaming decoder that accepts arbitrary chunks (partial frames, several
 *    frames per chunk, garbage between frames) and reports `!` error frames
 *  - decoders for the read-only commands the Flight Controller Configurator uses
 *  - MspClient: one request in flight at a time, with timeouts, on top of any
 *    `send(Uint8Array)` function
 *
 * Nothing here writes settings or moves motors. The only commands this module
 * knows how to encode are read requests (empty payload), so the UI cannot send a
 * configuration write by accident.
 */

export const MSP_BAUD_RATE = 115200;

export const MSP = Object.freeze({
  API_VERSION: 1,
  FC_VARIANT: 2,
  FC_VERSION: 3,
  BOARD_INFO: 4,
  BUILD_INFO: 5,
  STATUS: 101,
  RAW_IMU: 102,
  MOTOR: 104,
  RC: 105,
  ATTITUDE: 108,
  ANALOG: 110,
  STATUS_EX: 150,
});

const EMPTY = new Uint8Array(0);
const DOLLAR = 0x24; // '$'
const PROTO_V1 = 0x4d; // 'M'
const PROTO_V2 = 0x58; // 'X'
const DIR_TO_FC = 0x3c; // '<'
const DIR_FROM_FC = 0x3e; // '>'
const DIR_ERROR = 0x21; // '!'

/** CRC-8 with polynomial 0xD5, init 0, no reflection (CRC-8/DVB-S2). Check value of "123456789" is 0xBC. */
export function crc8DvbS2(bytes, start = 0, end = bytes.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (((crc << 1) ^ 0xd5) & 0xff) : ((crc << 1) & 0xff);
    }
  }
  return crc;
}

/** MSP v1 checksum: XOR of size, command and payload bytes. */
export function xorChecksum(bytes, start = 0, end = bytes.length) {
  let sum = 0;
  for (let i = start; i < end; i++) sum ^= bytes[i];
  return sum;
}

function toPayload(payload) {
  if (payload === undefined || payload === null) return EMPTY;
  if (payload instanceof Uint8Array) return payload;
  return Uint8Array.from(payload);
}

/** Encode an MSP v1 request: `$M<` size cmd payload checksum. */
export function encodeV1(cmd, payload) {
  const body = toPayload(payload);
  if (!Number.isInteger(cmd) || cmd < 0 || cmd > 0xff) throw new RangeError(`MSP v1 command out of range: ${cmd}`);
  if (body.length > 0xff) throw new RangeError(`MSP v1 payload too long: ${body.length}`);
  const out = new Uint8Array(6 + body.length);
  out[0] = DOLLAR;
  out[1] = PROTO_V1;
  out[2] = DIR_TO_FC;
  out[3] = body.length;
  out[4] = cmd;
  out.set(body, 5);
  out[5 + body.length] = xorChecksum(out, 3, 5 + body.length);
  return out;
}

/** Encode an MSP v2 request: `$X<` flag cmd(u16 LE) size(u16 LE) payload crc8-dvb-s2. */
export function encodeV2(cmd, payload, flag = 0) {
  const body = toPayload(payload);
  if (!Number.isInteger(cmd) || cmd < 0 || cmd > 0xffff) throw new RangeError(`MSP v2 command out of range: ${cmd}`);
  if (body.length > 0xffff) throw new RangeError(`MSP v2 payload too long: ${body.length}`);
  const out = new Uint8Array(9 + body.length);
  out[0] = DOLLAR;
  out[1] = PROTO_V2;
  out[2] = DIR_TO_FC;
  out[3] = flag & 0xff;
  out[4] = cmd & 0xff;
  out[5] = (cmd >> 8) & 0xff;
  out[6] = body.length & 0xff;
  out[7] = (body.length >> 8) & 0xff;
  out.set(body, 8);
  out[8 + body.length] = crc8DvbS2(out, 3, 8 + body.length);
  return out;
}

/** Encode a request with the chosen protocol version (1 or 2). */
export function encodeRequest(cmd, { version = 1, payload, flag = 0 } = {}) {
  return version === 2 ? encodeV2(cmd, payload, flag) : encodeV1(cmd, payload);
}

const NEED_MORE = { need: true };

function badFrame(reason) {
  return { need: false, frame: null, reason };
}

function kindForDirection(dir) {
  if (dir === DIR_FROM_FC) return 'response';
  if (dir === DIR_ERROR) return 'error';
  if (dir === DIR_TO_FC) return 'request';
  return null;
}

/**
 * Try to parse one frame at the start of `buf` (which must start with '$').
 * Returns { need: true } when more bytes are required, { frame, length } on success,
 * or { frame: null, reason } when the bytes at the start are not a valid frame.
 */
function parseAt(buf) {
  if (buf.length < 3) return NEED_MORE;
  const proto = buf[1];
  const dirByte = buf[2];

  if (proto === PROTO_V1) {
    if (buf.length < 5) return NEED_MORE;
    const kind = kindForDirection(dirByte);
    if (!kind) return badFrame('unknown MSP v1 direction byte');
    const size = buf[3];
    const total = 6 + size;
    if (buf.length < total) return NEED_MORE;
    if (buf[5 + size] !== xorChecksum(buf, 3, 5 + size)) return badFrame('MSP v1 checksum mismatch');
    return {
      frame: { kind, version: 1, cmd: buf[4], flag: 0, payload: buf.slice(5, 5 + size) },
      length: total,
    };
  }

  if (proto === PROTO_V2) {
    if (buf.length < 8) return NEED_MORE;
    const kind = kindForDirection(dirByte);
    if (!kind) return badFrame('unknown MSP v2 direction byte');
    const size = buf[6] | (buf[7] << 8);
    const total = 9 + size;
    if (buf.length < total) return NEED_MORE;
    if (buf[8 + size] !== crc8DvbS2(buf, 3, 8 + size)) return badFrame('MSP v2 CRC-8 mismatch');
    return {
      frame: {
        kind,
        version: 2,
        cmd: buf[4] | (buf[5] << 8),
        flag: buf[3],
        payload: buf.slice(8, 8 + size),
      },
      length: total,
    };
  }

  return badFrame('not an MSP header');
}

/**
 * Streaming decoder. feed() takes whatever chunk the serial port delivered and returns
 * the frames completed by it: { kind: 'response'|'error'|'request', version, cmd, flag, payload }
 * or { kind: 'corrupt', reason } for a bad header or checksum. Bytes that are not part of a
 * frame (CLI text, line noise) are skipped and counted in stats.skipped.
 */
export class MspDecoder {
  constructor() {
    this.buf = EMPTY;
    this.stats = { frames: 0, corrupt: 0, skipped: 0 };
  }

  reset() {
    this.buf = EMPTY;
  }

  feed(chunk) {
    if (!chunk || chunk.length === 0) return [];
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf, 0);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const out = [];
    for (;;) {
      const start = this.buf.indexOf(DOLLAR);
      if (start < 0) {
        this.stats.skipped += this.buf.length;
        this.buf = EMPTY;
        break;
      }
      if (start > 0) {
        this.stats.skipped += start;
        this.buf = this.buf.subarray(start);
      }
      const res = parseAt(this.buf);
      if (res === NEED_MORE || res.need) break;
      if (res.frame) {
        out.push(res.frame);
        this.stats.frames++;
        this.buf = this.buf.subarray(res.length);
      } else {
        out.push({ kind: 'corrupt', reason: res.reason });
        this.stats.corrupt++;
        this.buf = this.buf.subarray(1);
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Payload decoders. Each returns null when the payload is too short to be the
// documented layout, so the UI can say "short payload" instead of guessing.
// ---------------------------------------------------------------------------

function view(p) {
  return new DataView(p.buffer, p.byteOffset, p.byteLength);
}

function asciiField(p, start, length) {
  let s = '';
  const end = Math.min(p.length, start + length);
  for (let i = start; i < end; i++) {
    if (p[i] === 0) break;
    s += String.fromCharCode(p[i]);
  }
  return s.trim();
}

const VARIANTS = { BTFL: 'Betaflight', INAV: 'INAV', CLFL: 'Cleanflight' };

export function decodeApiVersion(p) {
  if (!p || p.length < 3) return null;
  return {
    protocolVersion: p[0],
    apiMajor: p[1],
    apiMinor: p[2],
    apiVersion: `${p[1]}.${p[2]}`,
  };
}

export function decodeFcVariant(p) {
  if (!p || p.length < 4) return null;
  const id = asciiField(p, 0, 4);
  return { identifier: id, name: VARIANTS[id] || 'Unknown variant' };
}

export function decodeFcVersion(p) {
  if (!p || p.length < 3) return null;
  return { major: p[0], minor: p[1], patch: p[2], version: `${p[0]}.${p[1]}.${p[2]}` };
}

/**
 * MSP_BOARD_INFO: identifier(4) hardwareRevision(u16) osdSupport(u8) commCapabilities(u8),
 * then length-prefixed strings (target name, board name, manufacturer id) when the firmware
 * sends them. Fields after the strings are not decoded.
 */
export function decodeBoardInfo(p) {
  if (!p || p.length < 8) return null;
  const v = view(p);
  const info = {
    identifier: asciiField(p, 0, 4),
    hardwareRevision: v.getUint16(4, true),
    osdSupport: p[6],
    commCapabilities: p[7],
    targetName: undefined,
    boardName: undefined,
    manufacturerId: undefined,
  };
  let off = 8;
  const readString = () => {
    if (off >= p.length) return undefined;
    const n = p[off];
    if (off + 1 + n > p.length) return undefined;
    const s = asciiField(p, off + 1, n);
    off += 1 + n;
    return s;
  };
  info.targetName = readString();
  info.boardName = readString();
  info.manufacturerId = readString();
  return info;
}

/** MSP_BUILD_INFO: date(11) time(8) short git revision(7). */
export function decodeBuildInfo(p) {
  if (!p || p.length < 26) return null;
  return {
    buildDate: asciiField(p, 0, 11),
    buildTime: asciiField(p, 11, 8),
    gitRevision: asciiField(p, 19, 7),
  };
}

const SENSOR_BITS = ['ACC', 'BARO', 'MAG', 'GPS', 'SONAR'];

/**
 * MSP_STATUS_EX (150), fixed prefix only: cycleTime(u16 us) i2cErrors(u16) sensors(u16 bitmask)
 * flightModeFlags(u32, raw) and, when present, the PID profile index (u8).
 * The arming-disabled reasons and later fields are NOT decoded here; the raw flag word is kept.
 */
export function decodeStatusEx(p) {
  if (!p || p.length < 10) return null;
  const v = view(p);
  const sensorMask = v.getUint16(4, true);
  const cycleTimeUs = v.getUint16(0, true);
  return {
    cycleTimeUs,
    sampleRateHz: cycleTimeUs > 0 ? 1e6 / cycleTimeUs : 0,
    i2cErrors: v.getUint16(2, true),
    sensorMask,
    sensors: SENSOR_BITS.map((name, bit) => ({ name, present: Boolean(sensorMask & (1 << bit)) })),
    flightModeFlagsRaw: v.getUint32(6, true),
    pidProfile: p.length >= 11 ? p[10] : undefined,
  };
}

/** MSP_ATTITUDE (108): roll and pitch in 0.1 degree, yaw in whole degrees, all signed 16-bit. */
export function decodeAttitude(p) {
  if (!p || p.length < 6) return null;
  const v = view(p);
  return {
    rollDeg: v.getInt16(0, true) / 10,
    pitchDeg: v.getInt16(2, true) / 10,
    yawDeg: v.getInt16(4, true),
  };
}

/** MSP_RAW_IMU (102): accel x/y/z, gyro x/y/z, mag x/y/z as signed 16-bit raw counts (no unit conversion). */
export function decodeRawImu(p) {
  if (!p || p.length < 18) return null;
  const v = view(p);
  const axis = (o) => [v.getInt16(o, true), v.getInt16(o + 2, true), v.getInt16(o + 4, true)];
  return { acc: axis(0), gyro: axis(6), mag: axis(12) };
}

/** MSP_RC (105): one unsigned 16-bit value per channel. */
export function decodeChannels(p) {
  if (!p) return null;
  const v = view(p);
  const count = Math.floor(p.length / 2);
  const out = [];
  for (let i = 0; i < count; i++) out.push(v.getUint16(i * 2, true));
  return out;
}

/** MSP_MOTOR (104): one unsigned 16-bit output value per motor slot. Readout only. */
export const decodeMotors = decodeChannels;

/** MSP_ANALOG (110): vbat(u8, 0.1 V) mAhDrawn(u16) rssi(u16, raw) amperage(i16, 0.01 A). */
export function decodeAnalog(p) {
  if (!p || p.length < 7) return null;
  const v = view(p);
  return {
    voltageV: p[0] / 10,
    mahDrawn: v.getUint16(1, true),
    rssiRaw: v.getUint16(3, true),
    currentA: v.getInt16(5, true) / 100,
  };
}

// ---------------------------------------------------------------------------
// Request/response client
// ---------------------------------------------------------------------------

export class MspTimeoutError extends Error {
  constructor(cmd) {
    super(`No MSP response for command ${cmd}`);
    this.name = 'MspTimeoutError';
    this.cmd = cmd;
  }
}

export class MspRejectedError extends Error {
  constructor(cmd) {
    super(`Flight controller rejected command ${cmd} (not supported by this firmware)`);
    this.name = 'MspRejectedError';
    this.cmd = cmd;
  }
}

/**
 * Serialised request/response over a byte transport. Feed every received chunk into
 * feed(); request() resolves with the matching response frame, rejects with
 * MspRejectedError on a '!' frame, or MspTimeoutError after timeoutMs.
 */
export class MspClient {
  constructor({ send, timeoutMs = 400 } = {}) {
    this.send = send;
    this.timeoutMs = timeoutMs;
    this.decoder = new MspDecoder();
    this.queue = [];
    this.current = null;
    this.closed = false;
    this.counts = { requests: 0, responses: 0, timeouts: 0, rejected: 0, stray: 0, corrupt: 0 };
  }

  feed(chunk) {
    const frames = this.decoder.feed(chunk);
    for (const frame of frames) {
      if (frame.kind === 'corrupt') {
        this.counts.corrupt++;
        continue;
      }
      if (frame.kind === 'request') continue;
      const cur = this.current;
      if (!cur || cur.cmd !== frame.cmd) {
        this.counts.stray++;
        continue;
      }
      if (frame.kind === 'error') {
        this.counts.rejected++;
        this.finish(cur, new MspRejectedError(frame.cmd));
      } else {
        this.counts.responses++;
        this.finish(cur, null, frame);
      }
    }
  }

  request(cmd, { payload, version = 1, flag = 0, timeoutMs } = {}) {
    if (this.closed) return Promise.reject(new Error('MSP client is closed'));
    const bytes = encodeRequest(cmd, { version, payload, flag });
    return new Promise((resolve, reject) => {
      this.queue.push({ cmd, bytes, timeoutMs: timeoutMs ?? this.timeoutMs, resolve, reject });
      this.pump();
    });
  }

  finish(job, error, frame) {
    if (this.current !== job) return;
    clearTimeout(job.timer);
    this.current = null;
    if (error) job.reject(error);
    else job.resolve(frame);
    this.pump();
  }

  pump() {
    if (this.current || this.closed || this.queue.length === 0) return;
    const next = this.queue.shift();
    const job = { cmd: next.cmd, resolve: next.resolve, reject: next.reject, timer: null };
    this.counts.requests++;
    job.timer = setTimeout(() => {
      this.counts.timeouts++;
      this.finish(job, new MspTimeoutError(job.cmd));
    }, next.timeoutMs);
    this.current = job;
    try {
      const result = this.send(next.bytes);
      if (result && typeof result.catch === 'function') {
        result.catch((err) => this.finish(job, err instanceof Error ? err : new Error(String(err))));
      }
    } catch (err) {
      this.finish(job, err instanceof Error ? err : new Error(String(err)));
    }
  }

  close() {
    this.closed = true;
    if (this.current) {
      clearTimeout(this.current.timer);
      const job = this.current;
      this.current = null;
      job.reject(new Error('MSP client closed'));
    }
    for (const job of this.queue.splice(0)) job.reject(new Error('MSP client closed'));
  }
}

// ---------------------------------------------------------------------------
// CLI helpers (text mode, entered with '#')
// ---------------------------------------------------------------------------

/** Byte that switches the flight controller from MSP to its text CLI. */
export const CLI_ENTER_BYTES = Uint8Array.of(0x23);

/** Encode one CLI line with CRLF. */
export function cliLineBytes(line) {
  return new TextEncoder().encode(`${String(line).replace(/\r?\n$/, '')}\r\n`);
}

/** True when the last non-empty line of CLI output is the bare '#' prompt. */
export function endsWithCliPrompt(text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line === '') continue;
    return line === '#';
  }
  return false;
}

/** True for the CLI `exit` line, which makes the flight controller reboot. */
export function isRebootingCommand(line) {
  return /^\s*exit\s*$/i.test(String(line));
}
