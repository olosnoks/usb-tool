/**
 * canTools.js — CAN analysis on top of raw frames: DBC signal decoding, ID
 * filters, candump logs and replay, ISO-TP (ISO 15765-2) and UDS (ISO 14229)
 * diagnostics, extra OBD-II PIDs, and a simulated ECU for demo mode.
 *
 * Frames everywhere are { id, isExtended, dlc, data: Uint8Array, t? (ms) }.
 */

import { buildSlcanFrame, decodeDtc } from './canBusDriver';

const hex = (v, w = 2) => v.toString(16).toUpperCase().padStart(w, '0');

// ---------------------------------------------------------------------------
// DBC
// ---------------------------------------------------------------------------

/**
 * Parse a Vector DBC file. Returns { messages: Map(key -> message) } where key
 * is `${extended ? 'x' : ''}${id}` and message has { id, isExtended, name, dlc,
 * sender, signals: [...] }.
 */
export function parseDbc(text) {
  const messages = new Map();
  const byRawId = new Map();
  let current = null;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    let m = line.match(/^BO_\s+(\d+)\s+(\w+)\s*:\s*(\d+)\s+(\w+)/);
    if (m) {
      const rawId = Number(m[1]);
      const isExtended = rawId > 0x7ff || (rawId & 0x80000000) !== 0;
      const id = (rawId & 0x1fffffff) >>> 0;
      current = { id, isExtended, name: m[2], dlc: Number(m[3]), sender: m[4], signals: [], comment: '' };
      messages.set(`${isExtended ? 'x' : ''}${id}`, current);
      byRawId.set(rawId, current);
      continue;
    }
    m = line.match(/^SG_\s+(\w+)\s*(M|m\d+)?\s*:\s*(\d+)\|(\d+)@([01])([+-])\s*\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)\s*\[\s*([-+\d.eE]*)\s*\|\s*([-+\d.eE]*)\s*\]\s*"([^"]*)"/);
    if (m && current) {
      current.signals.push({
        name: m[1],
        multiplexer: m[2] === 'M',
        muxValue: m[2] && m[2] !== 'M' ? Number(m[2].slice(1)) : null,
        startBit: Number(m[3]),
        length: Number(m[4]),
        littleEndian: m[5] === '1',
        signed: m[6] === '-',
        factor: Number(m[7]),
        offset: Number(m[8]),
        min: m[9] === '' ? null : Number(m[9]),
        max: m[10] === '' ? null : Number(m[10]),
        unit: m[11],
        values: null,
        comment: ''
      });
      continue;
    }
    if (line === '') current = null; // a blank line ends the message's signal list
  }
  // Value tables and comments can span the whole file; read them with regexes.
  for (const v of text.matchAll(/VAL_\s+(\d+)\s+(\w+)\s+((?:-?\d+\s+"[^"]*"\s*)+);/g)) {
    const msg = byRawId.get(Number(v[1]));
    const sig = msg?.signals.find((s) => s.name === v[2]);
    if (!sig) continue;
    sig.values = {};
    for (const pair of v[3].matchAll(/(-?\d+)\s+"([^"]*)"/g)) sig.values[pair[1]] = pair[2];
  }
  for (const c of text.matchAll(/CM_\s+SG_\s+(\d+)\s+(\w+)\s+"([^"]*)"\s*;/g)) {
    const sig = byRawId.get(Number(c[1]))?.signals.find((s) => s.name === c[2]);
    if (sig) sig.comment = c[3];
  }
  for (const c of text.matchAll(/CM_\s+BO_\s+(\d+)\s+"([^"]*)"\s*;/g)) {
    const msg = byRawId.get(Number(c[1]));
    if (msg) msg.comment = c[2];
  }
  return { messages };
}

/** Raw (unsigned) bits of a signal as a BigInt. */
export function extractBits(data, startBit, length, littleEndian) {
  let v = 0n;
  if (littleEndian) {
    for (let i = length - 1; i >= 0; i--) {
      const pos = startBit + i;
      v = (v << 1n) | BigInt((data[pos >> 3] >> (pos & 7)) & 1);
    }
  } else {
    // Motorola: start bit is the MSB; walk down within a byte, then to bit 7 of the next byte.
    let pos = startBit;
    for (let i = 0; i < length; i++) {
      v = (v << 1n) | BigInt((data[pos >> 3] >> (pos & 7)) & 1);
      pos = (pos & 7) === 0 ? pos + 15 : pos - 1;
    }
  }
  return v;
}

/** True when every bit of the signal lies inside a payload of `bytes` bytes. */
export function signalFits(sig, bytes) {
  if (sig.littleEndian) return sig.startBit + sig.length <= bytes * 8;
  let pos = sig.startBit;
  for (let i = 1; i < sig.length; i++) pos = (pos & 7) === 0 ? pos + 15 : pos - 1;
  return (pos >> 3) < bytes && (sig.startBit >> 3) < bytes;
}

export function decodeSignal(sig, data) {
  let raw = extractBits(data, sig.startBit, sig.length, sig.littleEndian);
  if (sig.signed && raw & (1n << BigInt(sig.length - 1))) raw -= 1n << BigInt(sig.length);
  const rawNum = Number(raw);
  const value = rawNum * sig.factor + sig.offset;
  const rounded = Number.isInteger(sig.factor) && Number.isInteger(sig.offset) ? value : Number(value.toPrecision(10));
  const text = sig.values?.[String(rawNum)];
  return { name: sig.name, raw: rawNum, value: rounded, unit: sig.unit, text: text ?? null };
}

/** Decode all signals of a frame (honours multiplexing). Returns null if the DBC doesn't know the ID. */
export function decodeFrame(dbc, frame) {
  const msg = dbc?.messages.get(`${frame.isExtended ? 'x' : ''}${frame.id}`);
  if (!msg) return null;
  const mux = msg.signals.find((s) => s.multiplexer);
  const muxValue = mux ? decodeSignal(mux, frame.data).raw : null;
  const signals = msg.signals
    .filter((s) => (s.muxValue === null || s.muxValue === muxValue) && signalFits(s, frame.data.length))
    .map((s) => decodeSignal(s, frame.data));
  return { name: msg.name, signals };
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/**
 * Compile a filter like "1DC, 200-2FF, !7DF, x18DAF110" into a predicate.
 * Plain IDs and ranges include; a leading ! excludes. Empty = everything.
 */
export function compileIdFilter(text) {
  const parts = String(text || '').split(/[\s,;]+/).filter(Boolean);
  const include = [];
  const exclude = [];
  for (const p of parts) {
    const neg = p.startsWith('!');
    const body = (neg ? p.slice(1) : p).replace(/^0x/i, '');
    const m = body.match(/^([0-9a-f]+)(?:-(?:0x)?([0-9a-f]+))?$/i);
    if (!m) throw new Error(`"${p}" is not an ID, range (100-1FF) or exclusion (!7DF).`);
    const lo = parseInt(m[1], 16);
    const hi = m[2] ? parseInt(m[2], 16) : lo;
    (neg ? exclude : include).push([Math.min(lo, hi), Math.max(lo, hi)]);
  }
  const inRanges = (id, ranges) => ranges.some(([lo, hi]) => id >= lo && id <= hi);
  return (id) => (!include.length || inRanges(id, include)) && !inRanges(id, exclude);
}

// ---------------------------------------------------------------------------
// candump logs
// ---------------------------------------------------------------------------

/** Linux can-utils `candump -L` format: "(1698765432.123456) can0 123#1122". */
export function toCandumpLog(frames, iface = 'can0') {
  return frames.map((f) => {
    const t = (f.t ?? 0) / 1000;
    const id = f.isExtended ? hex(f.id, 8) : hex(f.id, 3);
    const data = f.rtr ? 'R' : Array.from(f.data).map((b) => hex(b)).join('');
    return `(${t.toFixed(6)}) ${iface} ${id}#${data}`;
  }).join('\n') + '\n';
}

export function parseCandumpLog(text) {
  const frames = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*\((\d+(?:\.\d+)?)\)\s+\S+\s+([0-9A-Fa-f]{1,8})#(R|[0-9A-Fa-f]*)/);
    if (!m) continue;
    const isExtended = m[2].length > 3;
    const data = m[3] === 'R' ? new Uint8Array(0) : Uint8Array.from((m[3].match(/../g) || []).map((x) => parseInt(x, 16)));
    frames.push({ t: Number(m[1]) * 1000, id: parseInt(m[2], 16), isExtended, dlc: data.length, data, rtr: m[3] === 'R' });
  }
  if (!frames.length) throw new Error('No candump lines found ("(time) can0 123#1122...").');
  return frames;
}

export function toCsv(frames, dbc = null) {
  const rows = ['time_s,id,extended,dlc,data,decoded'];
  const t0 = frames[0]?.t ?? 0;
  for (const f of frames) {
    const dec = dbc ? decodeFrame(dbc, f) : null;
    const decoded = dec ? `${dec.name}: ${dec.signals.map((s) => `${s.name}=${s.text ?? s.value}${s.unit ? ` ${s.unit}` : ''}`).join('; ')}` : '';
    rows.push([((f.t - t0) / 1000).toFixed(6), hex(f.id, f.isExtended ? 8 : 3), f.isExtended ? 1 : 0, f.dlc, Array.from(f.data).map((b) => hex(b)).join(' '), `"${decoded.replace(/"/g, '""')}"`].join(','));
  }
  return rows.join('\n') + '\n';
}

/**
 * Replay frames with their original spacing (scaled by `speed`). Returns a
 * stop() function. `send(frame)` is called for each frame; `onDone` at the end.
 */
export function replayFrames(frames, send, { speed = 1, loop = false, onProgress, onDone } = {}) {
  let stopped = false;
  let timer = null;
  let i = 0;
  const step = () => {
    if (stopped) return;
    if (i >= frames.length) {
      if (loop && frames.length) i = 0;
      else { onDone?.(); return; }
    }
    send(frames[i]);
    onProgress?.(i + 1, frames.length);
    const next = frames[i + 1];
    const gap = next ? Math.max(0, (next.t - frames[i].t) / speed) : 0;
    i++;
    timer = setTimeout(step, Math.min(gap, 10000));
  };
  step();
  return () => { stopped = true; clearTimeout(timer); };
}

// ---------------------------------------------------------------------------
// ISO-TP (ISO 15765-2)
// ---------------------------------------------------------------------------

export class IsoTpError extends Error {}

export class IsoTpChannel {
  /**
   * send(frame) puts one CAN frame on the bus. Feed every received frame to onFrame().
   */
  constructor(send, { txId, rxId, extended = false, padding = 0xaa, timeoutMs = 1000, blockSize = 0, stMin = 0 } = {}) {
    Object.assign(this, { send, txId, rxId, extended, padding, timeoutMs, blockSize, stMin });
    this.onMessage = null; // optional: receive complete messages by callback instead of receive()
    this.rx = null;        // message being reassembled
    this.done = [];        // complete messages not yet read
    this.waiters = [];
    this.fcWaiter = null;
  }

  _frame(bytes) {
    const data = new Uint8Array(8).fill(this.padding);
    data.set(bytes);
    this.send({ id: this.txId, isExtended: this.extended, dlc: 8, data });
  }

  onFrame(f) {
    if (f.id !== this.rxId || !!f.isExtended !== !!this.extended || !f.data.length) return;
    const d = f.data;
    const type = d[0] >> 4;
    if (type === 0) {
      const n = d[0] & 0x0f;
      if (n) this._complete(d.slice(1, 1 + n));
    } else if (type === 1) {
      const total = ((d[0] & 0x0f) << 8) | d[1];
      this.rx = { total, data: Array.from(d.slice(2, 8)), next: 1, sinceFc: 0 };
      this._frame([0x30, this.blockSize, this.stMin]);
    } else if (type === 2 && this.rx) {
      if ((d[0] & 0x0f) !== (this.rx.next & 0x0f)) { this.rx = null; return; } // sequence error: drop it
      this.rx.next++;
      this.rx.data.push(...d.slice(1, 8));
      if (this.rx.data.length >= this.rx.total) {
        const msg = Uint8Array.from(this.rx.data.slice(0, this.rx.total));
        this.rx = null;
        this._complete(msg);
      } else if (this.blockSize && ++this.rx.sinceFc >= this.blockSize) {
        this.rx.sinceFc = 0;
        this._frame([0x30, this.blockSize, this.stMin]);
      }
    } else if (type === 3 && this.fcWaiter) {
      const w = this.fcWaiter;
      this.fcWaiter = null;
      w({ status: d[0] & 0x0f, blockSize: d[1], stMin: d[2] });
    }
  }

  _complete(msg) {
    if (this.onMessage) { this.onMessage(msg); return; }
    const w = this.waiters.shift();
    if (w) w.resolve(msg); else this.done.push(msg);
  }

  _waitFc() {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.fcWaiter = null; reject(new IsoTpError('No flow control from the ECU.')); }, this.timeoutMs);
      this.fcWaiter = (fc) => { clearTimeout(t); resolve(fc); };
    });
  }

  async sendMessage(payload) {
    const p = Uint8Array.from(payload);
    if (p.length <= 7) { this._frame([p.length, ...p]); return; }
    if (p.length > 4095) throw new IsoTpError('ISO-TP messages are limited to 4095 bytes.');
    this._frame([0x10 | (p.length >> 8), p.length & 0xff, ...p.slice(0, 6)]);
    let off = 6;
    let sn = 1;
    while (off < p.length) {
      let fc = await this._waitFc();
      while (fc.status === 1) fc = await this._waitFc(); // WAIT
      if (fc.status === 2) throw new IsoTpError('The ECU reported a buffer overflow.');
      const gap = fc.stMin <= 0x7f ? fc.stMin : (fc.stMin >= 0xf1 && fc.stMin <= 0xf9 ? 1 : 127);
      let sent = 0;
      while (off < p.length && (!fc.blockSize || sent < fc.blockSize)) {
        if (gap) await new Promise((r) => setTimeout(r, gap));
        this._frame([0x20 | (sn & 0x0f), ...p.slice(off, off + 7)]);
        off += 7;
        sn++;
        sent++;
      }
    }
  }

  receive(timeoutMs = this.timeoutMs) {
    if (this.done.length) return Promise.resolve(this.done.shift());
    return new Promise((resolve, reject) => {
      const w = { resolve: (m) => { clearTimeout(t); resolve(m); } };
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== w);
        reject(new IsoTpError(`No answer from 0x${hex(this.rxId, 3)} within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  async request(payload, timeoutMs) {
    this.done = [];
    await this.sendMessage(payload);
    return this.receive(timeoutMs);
  }
}

// ---------------------------------------------------------------------------
// UDS (ISO 14229)
// ---------------------------------------------------------------------------

export const UDS_NRC = {
  0x10: 'general reject', 0x11: 'service not supported', 0x12: 'sub-function not supported',
  0x13: 'incorrect message length or format', 0x14: 'response too long', 0x21: 'busy, repeat request',
  0x22: 'conditions not correct', 0x24: 'request sequence error', 0x25: 'no response from sub-net component',
  0x26: 'failure prevents execution', 0x31: 'request out of range', 0x33: 'security access denied',
  0x35: 'invalid key', 0x36: 'exceeded number of attempts', 0x37: 'required time delay not expired',
  0x70: 'upload/download not accepted', 0x71: 'transfer data suspended', 0x72: 'general programming failure',
  0x73: 'wrong block sequence counter', 0x78: 'response pending', 0x7e: 'sub-function not supported in active session',
  0x7f: 'service not supported in active session', 0x92: 'voltage too high', 0x93: 'voltage too low'
};

export const UDS_SERVICES = {
  0x10: 'DiagnosticSessionControl', 0x11: 'ECUReset', 0x14: 'ClearDiagnosticInformation', 0x19: 'ReadDTCInformation',
  0x22: 'ReadDataByIdentifier', 0x23: 'ReadMemoryByAddress', 0x27: 'SecurityAccess', 0x28: 'CommunicationControl',
  0x2e: 'WriteDataByIdentifier', 0x31: 'RoutineControl', 0x34: 'RequestDownload', 0x36: 'TransferData',
  0x37: 'RequestTransferExit', 0x3e: 'TesterPresent', 0x85: 'ControlDTCSetting'
};

export const UDS_DIDS = {
  0xf186: 'Active diagnostic session', 0xf187: 'Spare part number', 0xf188: 'ECU software number',
  0xf189: 'ECU software version', 0xf18a: 'System supplier ID', 0xf18b: 'ECU manufacturing date',
  0xf18c: 'ECU serial number', 0xf190: 'VIN', 0xf191: 'ECU hardware number', 0xf192: 'Supplier hardware number',
  0xf193: 'Supplier hardware version', 0xf194: 'Supplier software number', 0xf195: 'Supplier software version',
  0xf197: 'System name', 0xf199: 'Programming date', 0xf19e: 'ODX file'
};

export const UDS_DTC_STATUS = ['testFailed', 'failedThisCycle', 'pending', 'confirmed', 'notCompletedSinceClear', 'failedSinceClear', 'notCompletedThisCycle', 'warningIndicator'];

export class UdsError extends Error {
  constructor(service, nrc) {
    super(`${UDS_SERVICES[service] || `Service 0x${hex(service)}`} refused: ${UDS_NRC[nrc] || 'unknown'} (NRC 0x${hex(nrc)}).`);
    this.service = service;
    this.nrc = nrc;
  }
}

/** Show a DID value as text if it is printable, else hex. */
export function formatDidValue(bytes) {
  const b = Array.from(bytes);
  const trimmed = b.filter((x, i) => !(x === 0 || x === 0x20 || x === 0xff) || b.slice(i).some((y) => y !== 0 && y !== 0x20 && y !== 0xff));
  if (trimmed.length && trimmed.every((x) => x >= 0x20 && x < 0x7f)) return String.fromCharCode(...trimmed).trim();
  return b.map((x) => hex(x)).join(' ');
}

export class UdsDeclinedError extends Error {}

const bytesBE = (value, n) => Array.from({ length: n }, (_, i) => Math.floor(value / 2 ** (8 * (n - 1 - i))) & 0xff);

export const UDS_ROUTINE_TYPES = { 1: 'start', 2: 'stop', 3: 'request results' };

export class UdsClient {
  /**
   * `confirm(message) => boolean` is asked before every service that changes
   * the ECU (routine start/stop, write DID, communication control, DTC setting,
   * security key). Without one those services refuse to run; in the UI pass
   * `confirmAction` from utils/sessionLog.
   */
  constructor(isotp, { p2StarMs = 5000, confirm = null } = {}) {
    this.tp = isotp;
    this.p2StarMs = p2StarMs;
    this.confirm = confirm;
  }

  _confirmed(message) {
    if (!this.confirm || !this.confirm(message)) throw new UdsDeclinedError(`Not sent: ${message.split('\n')[0]}`);
  }

  async request(bytes, { timeoutMs } = {}) {
    const sid = bytes[0];
    let resp = await this.tp.request(bytes, timeoutMs);
    for (;;) {
      if (resp[0] === 0x7f && resp[1] === sid && resp[2] === 0x78) {
        resp = await this.tp.receive(this.p2StarMs); // response pending: keep waiting
        continue;
      }
      if (resp[0] === 0x7f && resp[1] === sid) throw new UdsError(sid, resp[2]);
      if (resp[0] !== ((sid + 0x40) & 0xff)) throw new Error(`Unexpected reply 0x${hex(resp[0])} to 0x${hex(sid)}.`);
      return resp;
    }
  }

  async sessionControl(type = 0x03) {
    const r = await this.request([0x10, type]);
    return r.length >= 6 ? { p2Ms: (r[2] << 8) | r[3], p2StarMs: ((r[4] << 8) | r[5]) * 10 } : {};
  }

  ecuReset(type = 0x01) { return this.request([0x11, type]); }
  testerPresent() { return this.request([0x3e, 0x00]); }

  async readDid(did) {
    const r = await this.request([0x22, did >> 8, did & 0xff]);
    if (((r[1] << 8) | r[2]) !== did) throw new Error(`Reply was for DID 0x${hex((r[1] << 8) | r[2], 4)}.`);
    return r.slice(3);
  }

  /** Read the standard identification DIDs; ones the ECU refuses are skipped. */
  async readIdentification(dids = Object.keys(UDS_DIDS).map(Number)) {
    const out = [];
    for (const did of dids) {
      try {
        const v = await this.readDid(did);
        out.push({ did, name: UDS_DIDS[did] || `DID 0x${hex(did, 4)}`, value: formatDidValue(v), raw: v });
      } catch (e) {
        if (!(e instanceof UdsError)) throw e;
      }
    }
    return out;
  }

  /** 0x19 0x02: DTCs matching a status mask. */
  async readDtcs(statusMask = 0xff) {
    const r = await this.request([0x19, 0x02, statusMask]);
    const dtcs = [];
    for (let i = 3; i + 3 < r.length; i += 4) {
      const status = r[i + 3];
      dtcs.push({
        code: `${decodeDtc(r[i], r[i + 1])}-${hex(r[i + 2])}`,
        status,
        flags: UDS_DTC_STATUS.filter((_, b) => status & (1 << b))
      });
    }
    return { availabilityMask: r[2], dtcs };
  }

  clearDtcs(group = 0xffffff) { return this.request([0x14, (group >> 16) & 0xff, (group >> 8) & 0xff, group & 0xff]); }

  // --- SecurityAccess (0x27): the standard seed/key exchange only. The key is
  // always supplied by the user; this tool does not compute or guess keys. ---

  /** 27 <odd level>: ask for a seed. An all-zero seed means the level is already unlocked. */
  async requestSeed(level = 0x01) {
    if (!Number.isInteger(level) || level < 1 || level > 0x7d || level % 2 === 0) throw new RangeError('A seed request uses an odd level (01, 03, 05, ...).');
    const r = await this.request([0x27, level]);
    if (r[1] !== level) throw new Error(`Reply was for security level 0x${hex(r[1])}.`);
    const seed = r.slice(2);
    return { level, seed, unlocked: seed.length > 0 && seed.every((b) => b === 0) };
  }

  /** 27 <level+1> <key>: send the key the user computed. Confirmation required. */
  async sendKey(level, key) {
    const k = Array.from(key || []);
    if (!k.length) throw new Error('Enter the key (hex) for this seed first; none is computed for you.');
    this._confirmed(`Send SecurityAccess key (27 ${hex(level + 1)}, ${k.length} bytes) to this ECU?\nWrong keys count against the ECU's attempt limit and can lock it for a while.`);
    const r = await this.request([0x27, level + 1, ...k]);
    return { level, accepted: r[0] === 0x67 };
  }

  /** Both steps: keyProvider(seed, level) returns the key bytes (the UI asks the user). */
  async securityAccess(level, keyProvider) {
    const s = await this.requestSeed(level);
    if (s.unlocked) return { level, accepted: true, alreadyUnlocked: true, seed: s.seed };
    const key = await keyProvider(s.seed, level);
    const r = await this.sendKey(level, key);
    return { ...r, seed: s.seed };
  }

  // --- Services that act on the ECU. All ask for confirmation first. ---

  /** 31 <type> <routine id> [option record]. type 1 start, 2 stop, 3 request results (read-only, no prompt). */
  async routineControl(type, routineId, option = []) {
    if (!UDS_ROUTINE_TYPES[type]) throw new RangeError('Routine control type is 1 (start), 2 (stop) or 3 (results).');
    if (!Number.isInteger(routineId) || routineId < 0 || routineId > 0xffff) throw new RangeError('A routine ID is 16 bits.');
    if (type !== 3) this._confirmed(`Send UDS RoutineControl ${UDS_ROUTINE_TYPES[type]} for routine 0x${hex(routineId, 4)} to this ECU?\nRoutines can erase memory, actuate outputs or change calibration.`);
    const r = await this.request([0x31, type, routineId >> 8, routineId & 0xff, ...option]);
    if (r[1] !== type || ((r[2] << 8) | r[3]) !== routineId) throw new Error('The routine reply did not echo the request.');
    return { type, routineId, status: r.slice(4) };
  }

  /** 2E <DID> <data>: write a data identifier. */
  async writeDid(did, bytes) {
    const data = Array.from(bytes || []);
    if (!Number.isInteger(did) || did < 0 || did > 0xffff) throw new RangeError('A DID is 16 bits.');
    if (!data.length) throw new Error('Nothing to write.');
    this._confirmed(`Write ${data.length} byte${data.length === 1 ? '' : 's'} to DID 0x${hex(did, 4)}${UDS_DIDS[did] ? ` (${UDS_DIDS[did]})` : ''} on this ECU?\nThis changes what is stored in the ECU.`);
    const r = await this.request([0x2e, did >> 8, did & 0xff, ...data]);
    if (((r[1] << 8) | r[2]) !== did) throw new Error(`Reply was for DID 0x${hex((r[1] << 8) | r[2], 4)}.`);
    return r;
  }

  /** 23 ReadMemoryByAddress (read-only). */
  async readMemory(address, size, { addressBytes = 4, sizeBytes = 2 } = {}) {
    if (addressBytes < 1 || addressBytes > 5 || sizeBytes < 1 || sizeBytes > 5) throw new RangeError('Address and size fields are 1 to 5 bytes.');
    if (!(size > 0) || size >= 2 ** (8 * sizeBytes)) throw new RangeError(`Size must fit in ${sizeBytes} byte(s).`);
    if (address < 0 || address >= 2 ** (8 * addressBytes)) throw new RangeError(`Address must fit in ${addressBytes} byte(s).`);
    const r = await this.request([0x23, (sizeBytes << 4) | addressBytes, ...bytesBE(address, addressBytes), ...bytesBE(size, sizeBytes)]);
    return r.slice(1);
  }

  /** 28 CommunicationControl: 00 enable rx+tx, 01 enable rx/disable tx, 02 disable rx/enable tx, 03 disable both. */
  async communicationControl(controlType = 0x00, communicationType = 0x01) {
    this._confirmed(`Send UDS CommunicationControl (28 ${hex(controlType)} ${hex(communicationType)}) to this ECU?\nDisabling communication can silence the ECU on the bus.`);
    return this.request([0x28, controlType, communicationType]);
  }

  /** 85 ControlDTCSetting: 01 on, 02 off (stops the ECU from logging DTCs). */
  async controlDtcSetting(setting = 0x01, option = []) {
    this._confirmed(`Send UDS ControlDTCSetting (85 ${hex(setting)}) to this ECU?\n${setting === 2 ? 'DTC logging stays off until you turn it back on or the session ends.' : 'This turns DTC logging back on.'}`);
    return this.request([0x85, setting, ...option]);
  }
}

// ---------------------------------------------------------------------------
// More OBD-II (SAE J1979)
// ---------------------------------------------------------------------------

const pct = (b) => Number(((b[0] * 100) / 255).toFixed(1));
const u16 = (b) => b[0] * 256 + b[1];

export const OBD_PID_TABLE = {
  0x04: ['Calculated engine load', '%', pct],
  0x05: ['Coolant temperature', '°C', (b) => b[0] - 40],
  0x06: ['Short term fuel trim (bank 1)', '%', (b) => Number(((b[0] - 128) * 100 / 128).toFixed(1))],
  0x07: ['Long term fuel trim (bank 1)', '%', (b) => Number(((b[0] - 128) * 100 / 128).toFixed(1))],
  0x0a: ['Fuel pressure', 'kPa', (b) => b[0] * 3],
  0x0b: ['Intake manifold pressure', 'kPa', (b) => b[0]],
  0x0c: ['Engine speed', 'rpm', (b) => u16(b) / 4],
  0x0d: ['Vehicle speed', 'km/h', (b) => b[0]],
  0x0e: ['Timing advance', '° before TDC', (b) => b[0] / 2 - 64],
  0x0f: ['Intake air temperature', '°C', (b) => b[0] - 40],
  0x10: ['MAF air flow rate', 'g/s', (b) => u16(b) / 100],
  0x11: ['Throttle position', '%', pct],
  0x1f: ['Run time since engine start', 's', u16],
  0x21: ['Distance with MIL on', 'km', u16],
  0x2f: ['Fuel tank level', '%', pct],
  0x31: ['Distance since codes cleared', 'km', u16],
  0x33: ['Barometric pressure', 'kPa', (b) => b[0]],
  0x42: ['Control module voltage', 'V', (b) => u16(b) / 1000],
  0x43: ['Absolute load value', '%', (b) => Number((u16(b) * 100 / 255).toFixed(1))],
  0x46: ['Ambient air temperature', '°C', (b) => b[0] - 40],
  0x49: ['Accelerator pedal position D', '%', pct],
  0x4d: ['Time run with MIL on', 'min', u16],
  0x51: ['Fuel type', '', (b) => ['n/a', 'Gasoline', 'Methanol', 'Ethanol', 'Diesel', 'LPG', 'CNG', 'Propane', 'Electric'][b[0]] || `type ${b[0]}`],
  0x5c: ['Engine oil temperature', '°C', (b) => b[0] - 40],
  0x5e: ['Engine fuel rate', 'L/h', (b) => u16(b) / 20],
  0xa6: ['Odometer', 'km', (b) => ((b[0] * 2 ** 24) + (b[1] << 16) + (b[2] << 8) + b[3]) / 10]
};

/** Decode a mode 01 "supported PIDs" bitmap reply (for PID base 0x00, 0x20, ...). */
export function decodeSupportedPids(base, bytes) {
  const out = [];
  for (let i = 0; i < 32; i++) if (bytes[i >> 3] & (0x80 >> (i & 7))) out.push(base + i + 1);
  return out;
}

// ---------------------------------------------------------------------------
// SAE J1939 (heavy vehicles, marine, agriculture): 29-bit identifiers
// ---------------------------------------------------------------------------

/**
 * Split a 29-bit J1939 identifier: priority (3 bits), PGN, source address and,
 * for PDU1 messages (PF < 240), the destination address. PDU2 messages are
 * broadcast: `da` is 0xFF.
 */
export function decodeJ1939Id(id) {
  const priority = (id >>> 26) & 0x07;
  const edp = (id >>> 25) & 1;
  const dp = (id >>> 24) & 1;
  const pf = (id >>> 16) & 0xff;
  const ps = (id >>> 8) & 0xff;
  const sa = id & 0xff;
  const pdu1 = pf < 240;
  const pgn = ((edp << 17) | (dp << 16) | (pf << 8) | (pdu1 ? 0 : ps)) >>> 0;
  return { priority, pgn, sa, da: pdu1 ? ps : 0xff, pdu1 };
}

/** Build a 29-bit identifier from priority, PGN, source and (PDU1 only) destination. */
export function buildJ1939Id({ priority = 6, pgn, sa, da = 0xff }) {
  const pf = (pgn >> 8) & 0xff;
  const low = pf < 240 ? da & 0xff : pgn & 0xff;
  return (((priority & 7) << 26) | (((pgn >> 16) & 3) << 24) | (pf << 16) | (low << 8) | (sa & 0xff)) >>> 0;
}

/** PGN request (PGN 59904): ask `da` (0xFF = everyone) to send `pgn`. Returns a frame for the sender. */
export function buildJ1939Request(pgn, { da = 0xff, sa = 0xf9, priority = 6 } = {}) {
  if (!Number.isInteger(pgn) || pgn < 0 || pgn > 0x3ffff) throw new RangeError('A PGN is 18 bits (0-262143).');
  return {
    id: buildJ1939Id({ priority, pgn: 59904, sa, da }),
    isExtended: true,
    dlc: 3,
    data: Uint8Array.from([pgn & 0xff, (pgn >> 8) & 0xff, (pgn >> 16) & 0x03])
  };
}

// [acronym, name] by PGN (SAE J1939-71 / -21 / -81 names for the common ones).
export const J1939_PGNS = {
  0: ['TSC1', 'Torque/Speed Control 1'],
  59392: ['ACKM', 'Acknowledgment'],
  59904: ['RQST', 'Request'],
  60160: ['TP.DT', 'Transport Protocol Data Transfer'],
  60416: ['TP.CM', 'Transport Protocol Connection Management'],
  60928: ['AC', 'Address Claimed'],
  61184: ['PROPA', 'Proprietary A'],
  61440: ['ERC1', 'Electronic Retarder Controller 1'],
  61441: ['EBC1', 'Electronic Brake Controller 1'],
  61442: ['ETC1', 'Electronic Transmission Controller 1'],
  61443: ['EEC2', 'Electronic Engine Controller 2'],
  61444: ['EEC1', 'Electronic Engine Controller 1'],
  61445: ['ETC2', 'Electronic Transmission Controller 2'],
  61449: ['VDC2', 'Vehicle Dynamic Stability Control 2'],
  64965: ['ECUID', 'ECU Identification Information'],
  65098: ['ETC7', 'Electronic Transmission Controller 7'],
  65110: ['AT1T1I', 'Aftertreatment 1 DEF Tank 1 Information'],
  65132: ['TCO1', 'Tachograph'],
  65217: ['VDHR', 'High Resolution Vehicle Distance'],
  65226: ['DM1', 'Active Diagnostic Trouble Codes'],
  65227: ['DM2', 'Previously Active Diagnostic Trouble Codes'],
  65228: ['DM3', 'Diagnostic Data Clear/Reset of Previously Active DTCs'],
  65229: ['DM4', 'Freeze Frame Parameters'],
  65230: ['DM5', 'Diagnostic Readiness 1'],
  65231: ['DM6', 'Pending Diagnostic Trouble Codes'],
  65235: ['DM11', 'Diagnostic Data Clear/Reset for Active DTCs'],
  65236: ['DM12', 'Emissions-Related Active DTCs'],
  65242: ['SOFT', 'Software Identification'],
  65247: ['EEC3', 'Electronic Engine Controller 3'],
  65248: ['VD', 'Vehicle Distance'],
  65249: ['RCFG', 'Retarder Configuration'],
  65250: ['TCFG', 'Transmission Configuration'],
  65251: ['ECFG', 'Engine Configuration'],
  65252: ['SHUTDN', 'Shutdown'],
  65253: ['HOURS', 'Engine Hours, Revolutions'],
  65254: ['TD', 'Time/Date'],
  65255: ['VH', 'Vehicle Hours'],
  65256: ['VDS', 'Vehicle Direction/Speed'],
  65257: ['LFC', 'Fuel Consumption (Liquid)'],
  65258: ['VW', 'Vehicle Weight'],
  65259: ['CI', 'Component Identification'],
  65260: ['VI', 'Vehicle Identification'],
  65261: ['CCSS', 'Cruise Control/Vehicle Speed Setup'],
  65262: ['ET1', 'Engine Temperature 1'],
  65263: ['EFL/P1', 'Engine Fluid Level/Pressure 1'],
  65264: ['PTO', 'Power Takeoff Information'],
  65265: ['CCVS', 'Cruise Control/Vehicle Speed'],
  65266: ['LFE', 'Fuel Economy (Liquid)'],
  65267: ['VP', 'Vehicle Position'],
  65268: ['TIRE', 'Tire Condition'],
  65269: ['AMB', 'Ambient Conditions'],
  65270: ['IC1', 'Inlet/Exhaust Conditions 1'],
  65271: ['VEP1', 'Vehicle Electrical Power 1'],
  65272: ['TRF1', 'Transmission Fluids 1'],
  65274: ['BRAKES', 'Brakes'],
  65275: ['RF', 'Retarder Fluids'],
  65276: ['DD', 'Dash Display'],
  65277: ['AF', 'Alternate Fuel 1'],
  65278: ['AWPP', 'Auxiliary Water Pump Pressure'],
  65279: ['WFI', 'Water in Fuel Indicator 1']
};

export function j1939PgnName(pgn) {
  const e = J1939_PGNS[pgn];
  if (e) return { acronym: e[0], name: e[1] };
  if (pgn >= 61184 && pgn <= 61439) return { acronym: 'PROPA', name: 'Proprietary A (manufacturer specific)' };
  if (pgn >= 65280 && pgn <= 65535) return { acronym: 'PROPB', name: 'Proprietary B (manufacturer specific)' };
  return { acronym: null, name: null };
}

export const J1939_FMI = {
  0: 'data valid but above normal range (most severe)', 1: 'data valid but below normal range (most severe)',
  2: 'data erratic, intermittent or incorrect', 3: 'voltage above normal or shorted high', 4: 'voltage below normal or shorted low',
  5: 'current below normal or open circuit', 6: 'current above normal or grounded', 7: 'mechanical system not responding',
  8: 'abnormal frequency, pulse width or period', 9: 'abnormal update rate', 10: 'abnormal rate of change',
  11: 'root cause not known', 12: 'bad intelligent device', 13: 'out of calibration', 14: 'special instructions',
  15: 'data valid but above normal range (least severe)', 16: 'data valid but above normal range (moderately severe)',
  17: 'data valid but below normal range (least severe)', 18: 'data valid but below normal range (moderately severe)',
  19: 'network data error', 20: 'data drifted high', 21: 'data drifted low', 31: 'condition exists'
};

// Numeric SPN fields per PGN: { spn, name, unit, off (byte), len (bytes), scale, offset }.
const F = (spn, name, unit, off, len, scale, offset = 0) => ({ spn, name, unit, off, len, scale, offset });
const J1939_SPNS = {
  61443: [F(91, 'Accelerator pedal position 1', '%', 1, 1, 0.4), F(92, 'Engine percent load at current speed', '%', 2, 1, 1)],
  61444: [F(512, 'Driver demand engine torque', '%', 1, 1, 1, -125), F(513, 'Actual engine torque', '%', 2, 1, 1, -125), F(190, 'Engine speed', 'rpm', 3, 2, 0.125)],
  65217: [F(917, 'Total vehicle distance (high res)', 'km', 0, 4, 0.005), F(918, 'Trip distance (high res)', 'km', 4, 4, 0.005)],
  65247: [F(514, 'Nominal friction torque', '%', 0, 1, 1, -125), F(515, 'Desired operating speed', 'rpm', 1, 2, 0.125)],
  65248: [F(244, 'Trip distance', 'km', 0, 4, 0.125), F(245, 'Total vehicle distance', 'km', 4, 4, 0.125)],
  65253: [F(247, 'Total engine hours', 'h', 0, 4, 0.05), F(249, 'Total engine revolutions', 'r', 4, 4, 1000)],
  65257: [F(182, 'Trip fuel', 'L', 0, 4, 0.5), F(250, 'Total fuel used', 'L', 4, 4, 0.5)],
  65262: [F(110, 'Engine coolant temperature', '°C', 0, 1, 1, -40), F(174, 'Fuel temperature', '°C', 1, 1, 1, -40), F(175, 'Engine oil temperature', '°C', 2, 2, 0.03125, -273)],
  65263: [F(94, 'Fuel delivery pressure', 'kPa', 0, 1, 4), F(98, 'Engine oil level', '%', 2, 1, 0.4), F(100, 'Engine oil pressure', 'kPa', 3, 1, 4), F(111, 'Coolant level', '%', 7, 1, 0.4)],
  65265: [F(84, 'Wheel-based vehicle speed', 'km/h', 1, 2, 1 / 256), F(86, 'Cruise control set speed', 'km/h', 5, 1, 1)],
  65266: [F(183, 'Fuel rate', 'L/h', 0, 2, 0.05), F(184, 'Instantaneous fuel economy', 'km/L', 2, 2, 1 / 512), F(51, 'Throttle position', '%', 6, 1, 0.4)],
  65269: [F(108, 'Barometric pressure', 'kPa', 0, 1, 0.5), F(171, 'Ambient air temperature', '°C', 3, 2, 0.03125, -273), F(172, 'Air inlet temperature', '°C', 5, 1, 1, -40)],
  65270: [F(102, 'Boost pressure', 'kPa', 1, 1, 2), F(105, 'Intake manifold temperature', '°C', 2, 1, 1, -40), F(173, 'Exhaust gas temperature', '°C', 5, 2, 0.03125, -273)],
  65271: [F(114, 'Net battery current', 'A', 0, 1, 1, -125), F(115, 'Alternator current', 'A', 1, 1, 1), F(167, 'Charging system potential', 'V', 2, 2, 0.05), F(168, 'Battery potential', 'V', 4, 2, 0.05)],
  65276: [F(80, 'Washer fluid level', '%', 0, 1, 0.4), F(96, 'Fuel level 1', '%', 1, 1, 0.4)]
};

const le = (data, off, len) => {
  let v = 0;
  for (let i = len - 1; i >= 0; i--) v = v * 256 + data[off + i];
  return v;
};

/** J1939 NAME (the 8 data bytes of an Address Claimed message). */
export function decodeJ1939Name(d) {
  if (d.length < 8) return null;
  const groups = ['global', 'on-highway', 'agricultural/forestry', 'construction', 'marine', 'industrial/process control'];
  const industryGroup = (d[7] >> 4) & 7;
  return {
    identityNumber: d[0] | (d[1] << 8) | ((d[2] & 0x1f) << 16),
    manufacturerCode: (d[2] >> 5) | (d[3] << 3),
    ecuInstance: d[4] & 7,
    functionInstance: d[4] >> 3,
    func: d[5],
    vehicleSystem: d[6] >> 1,
    vehicleSystemInstance: d[7] & 0x0f,
    industryGroup,
    industryGroupName: groups[industryGroup] || `group ${industryGroup}`,
    arbitraryAddressCapable: !!(d[7] & 0x80)
  };
}

/** One 4-byte DM1/DM2 trouble code: SPN (19 bits), FMI, occurrence count, SPN conversion method. */
export function decodeJ1939Dtc(b0, b1, b2, b3) {
  const fmi = b2 & 0x1f;
  return { spn: b0 | (b1 << 8) | (((b2 >> 5) & 7) << 16), fmi, fmiText: J1939_FMI[fmi] || null, occurrences: b3 & 0x7f, conversionMethod: (b3 >> 7) & 1 };
}

/**
 * Decode the payload of a J1939 message. Returns an array of
 * { spn, name, value, unit, text? }; values the sender marks "not available"
 * (all ones) or "error" are reported with value null and a text, never as numbers.
 * Only PGNs with a table above (plus DM1/DM2, Address Claimed, Request, VIN)
 * are decoded; others return an empty array.
 */
export function decodeJ1939Pgn(pgn, data) {
  if (pgn === 59904) {
    if (data.length < 3) return [];
    const req = le(data, 0, 3);
    return [{ spn: null, name: 'Requested PGN', value: req, unit: '', text: `${req}${j1939PgnName(req).acronym ? ` (${j1939PgnName(req).acronym})` : ''}` }];
  }
  if (pgn === 60928) {
    const n = decodeJ1939Name(data);
    return n ? [{ spn: null, name: 'NAME', value: null, unit: '', text: `identity ${n.identityNumber}, manufacturer ${n.manufacturerCode}, function ${n.func}, system ${n.vehicleSystem}, ${n.industryGroupName}${n.arbitraryAddressCapable ? ', arbitrary address' : ''}` }] : [];
  }
  if (pgn === 65226 || pgn === 65227) {
    if (data.length < 2) return [];
    const out = [{ spn: null, name: 'Lamp status', value: data[0], unit: '', text: `MIL ${(data[0] >> 6) & 3}, red stop ${(data[0] >> 4) & 3}, amber warning ${(data[0] >> 2) & 3}, protect ${data[0] & 3}` }];
    for (let i = 2; i + 3 < data.length; i += 4) {
      if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 0) continue;
      if (data[i] === 0xff && data[i + 1] === 0xff && data[i + 2] === 0xff && data[i + 3] === 0xff) continue;
      const d = decodeJ1939Dtc(data[i], data[i + 1], data[i + 2], data[i + 3]);
      out.push({ spn: d.spn, name: `DTC SPN ${d.spn} FMI ${d.fmi}`, value: d.occurrences, unit: 'x', text: `${d.fmiText || 'FMI ' + d.fmi}, count ${d.occurrences}` });
    }
    return out;
  }
  if (pgn === 65260) {
    const text = String.fromCharCode(...Array.from(data).filter((b) => b >= 0x20 && b < 0x7f && b !== 0x2a));
    return [{ spn: 237, name: 'Vehicle identification number', value: null, unit: '', text }];
  }
  const out = [];
  for (const f of J1939_SPNS[pgn] || []) {
    if (f.off + f.len > data.length) continue;
    const raw = le(data, f.off, f.len);
    // J1939-71: a top byte of 0xFF means "not available", 0xFE "error", 0xFB-0xFD reserved.
    const topByte = Math.floor(raw / 2 ** (8 * (f.len - 1)));
    if (topByte >= 0xfb) {
      out.push({ spn: f.spn, name: f.name, value: null, unit: f.unit, text: topByte === 0xff ? 'not available' : topByte === 0xfe ? 'error' : 'reserved' });
      continue;
    }
    out.push({ spn: f.spn, name: f.name, value: Number((raw * f.scale + f.offset).toPrecision(10)), unit: f.unit });
  }
  return out;
}

/** Full decode of a received extended frame: id fields, PGN name and signals. null for 11-bit frames. */
export function decodeJ1939Frame(frame) {
  if (!frame.isExtended) return null;
  const id = decodeJ1939Id(frame.id);
  return { ...id, ...j1939PgnName(id.pgn), signals: decodeJ1939Pgn(id.pgn, frame.data) };
}

// ---------------------------------------------------------------------------
// A simulated ECU for demo mode (answers ISO-TP UDS and OBD requests)
// ---------------------------------------------------------------------------


export { buildSlcanFrame };
