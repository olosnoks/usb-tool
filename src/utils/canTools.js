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
  0x7f: 'service not supported in active session'
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

export class UdsClient {
  constructor(isotp, { p2StarMs = 5000 } = {}) {
    this.tp = isotp;
    this.p2StarMs = p2StarMs;
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
// A simulated ECU for demo mode (answers ISO-TP UDS and OBD requests)
// ---------------------------------------------------------------------------

export class SimulatedEcu {
  /** emit(frame) delivers the ECU's frames back to the tool. */
  constructor(emit, { requestId = 0x7e0, responseId = 0x7e8 } = {}) {
    this.emit = emit;
    this.requestId = requestId;
    this.responseId = responseId;
    this.session = 1;
    this.dtcs = [[0x04, 0x20, 0x00, 0x2f], [0x01, 0x71, 0x00, 0x24]]; // P0420, P0171
    this.dids = {
      0xf187: '8V0907115B', 0xf189: 'SW 0450', 0xf18a: 'Demo Supplier', 0xf18c: 'SN00012345',
      0xf190: 'WVWZZZ1KZDM900001', 0xf191: 'HW H13', 0xf197: 'ENGINE CONTROL'
    };
    const out = (f) => setTimeout(() => this.emit(f), 2);
    // Physical requests and flow control arrive on requestId; functional OBD requests on 0x7DF.
    this.tx = new IsoTpChannel(out, { txId: responseId, rxId: requestId, padding: 0x55 });
    this.functional = new IsoTpChannel(out, { txId: responseId, rxId: 0x7df, padding: 0x55 });
    const reply = (req) => { this.tx.sendMessage(this.answer(req)).catch(() => {}); };
    this.tx.onMessage = reply;
    this.functional.onMessage = reply;
  }

  onFrame(f) {
    this.tx.onFrame(f);
    this.functional.onFrame(f);
  }

  answer(req) {
    const sid = req[0];
    const neg = (nrc) => [0x7f, sid, nrc];
    switch (sid) {
      case 0x01: {
        const pid = req[1];
        if (pid === 0x00) return [0x41, 0x00, 0x18, 0x3b, 0x80, 0x11];
        const values = { 0x0c: [0x1a, 0xf8], 0x0d: [0x2a], 0x05: [0x7b], 0x04: [0x50], 0x11: [0x30], 0x42: [0x37, 0x1c] };
        return values[pid] ? [0x41, pid, ...values[pid]] : neg(0x12);
      }
      case 0x09: return req[1] === 0x02 ? [0x49, 0x02, 0x01, ...new TextEncoder().encode(this.dids[0xf190])] : neg(0x12);
      case 0x10: this.session = req[1]; return [0x50, req[1], 0x00, 0x32, 0x01, 0xf4];
      case 0x11: return [0x51, req[1]];
      case 0x3e: return [0x7e, 0x00];
      case 0x22: {
        const did = (req[1] << 8) | req[2];
        if (did === 0xf186) return [0x62, req[1], req[2], this.session];
        const v = this.dids[did];
        return v ? [0x62, req[1], req[2], ...new TextEncoder().encode(v)] : neg(0x31);
      }
      case 0x19: return req[1] === 0x02 ? [0x59, 0x02, 0xff, ...this.dtcs.flat()] : neg(0x12);
      case 0x14: this.dtcs = []; return [0x54];
      case 0x03: return [0x43, this.dtcs.length, ...this.dtcs.flatMap((d) => [d[0], d[1]])];
      case 0x04: this.dtcs = []; return [0x44];
      default: return neg(0x11);
    }
  }
}

export { buildSlcanFrame };
