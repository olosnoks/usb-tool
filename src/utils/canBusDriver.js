/**
 * CAN bus driver helpers: the SLCAN (Lawicel) ASCII protocol spoken by CANable,
 * Candlelight-in-SLCAN-mode and USB-CAN adapters (classic CAN and, where the
 * adapter firmware supports the d/D/b/B extension, CAN FD), plus OBD-II
 * (ISO 15765-4) requests carried over raw CAN frames. It does not speak ELM327.
 */

export const CAN_BAUD_RATES = [
  { code: 'S3', baud: 100000, label: '100 kbps' },
  { code: 'S4', baud: 125000, label: '125 kbps (Low-speed / Body CAN)' },
  { code: 'S5', baud: 250000, label: '250 kbps (Commercial / Marine NMEA 2000)' },
  { code: 'S6', baud: 500000, label: '500 kbps (Standard Automotive High-Speed)' },
  { code: 'S8', baud: 1000000, label: '1000 kbps (1 Mbps / Fast Industrial)' }
];

export const OBD_PIDS = [
  { pid: '010C', name: 'Engine RPM', unit: 'RPM', parse: (bytes) => ((bytes[0] * 256) + bytes[1]) / 4 },
  { pid: '010D', name: 'Vehicle Speed', unit: 'km/h', parse: (bytes) => bytes[0] },
  { pid: '0105', name: 'Coolant Temperature', unit: '°C', parse: (bytes) => bytes[0] - 40 },
  { pid: '0104', name: 'Engine Load', unit: '%', parse: (bytes) => Number(((bytes[0] * 100) / 255).toFixed(1)) },
  { pid: '0111', name: 'Throttle Position', unit: '%', parse: (bytes) => Number(((bytes[0] * 100) / 255).toFixed(1)) },
  { pid: '012F', name: 'Fuel Level', unit: '%', parse: (bytes) => Number(((bytes[0] * 100) / 255).toFixed(1)) },
  { pid: '0142', name: 'Battery Voltage', unit: 'V', parse: (bytes) => Number((((bytes[0] * 256) + bytes[1]) / 1000).toFixed(2)) }
];

export const COMMON_DTCS = {
  'P0016': 'Crankshaft / Camshaft Position Correlation (Bank 1 Sensor A)',
  'P0087': 'Fuel Rail / System Pressure Too Low',
  'P0100': 'Mass Air Flow (MAF) Circuit Malfunction',
  'P0101': 'Mass Air Flow Circuit Range / Performance',
  'P0102': 'Mass Air Flow Circuit Low Input',
  'P0103': 'Mass Air Flow Circuit High Input',
  'P0105': 'Manifold Absolute Pressure Circuit Malfunction',
  'P0106': 'Manifold Absolute Pressure Range / Performance',
  'P0110': 'Intake Air Temperature Circuit Malfunction',
  'P0113': 'Intake Air Temperature Circuit High Input',
  'P0115': 'Engine Coolant Temperature Circuit Malfunction',
  'P0117': 'Engine Coolant Temperature Circuit Low Input',
  'P0118': 'Engine Coolant Temperature Circuit High Input',
  'P0120': 'Throttle / Pedal Position Sensor A Circuit Malfunction',
  'P0121': 'Throttle / Pedal Position Sensor A Range / Performance',
  'P0128': 'Coolant Thermostat (Coolant Temp Below Regulating Temp)',
  'P0130': 'O2 Sensor Circuit Malfunction (Bank 1 Sensor 1)',
  'P0131': 'O2 Sensor Circuit Low Voltage (Bank 1 Sensor 1)',
  'P0133': 'O2 Sensor Circuit Slow Response (Bank 1 Sensor 1)',
  'P0135': 'O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 1)',
  'P0141': 'O2 Sensor Heater Circuit Malfunction (Bank 1 Sensor 2)',
  'P0171': 'System Too Lean (Bank 1)',
  'P0172': 'System Too Rich (Bank 1)',
  'P0174': 'System Too Lean (Bank 2)',
  'P0175': 'System Too Rich (Bank 2)',
  'P0191': 'Fuel Rail Pressure Sensor Circuit Range / Performance',
  'P0201': 'Injector Circuit Malfunction - Cylinder 1',
  'P0202': 'Injector Circuit Malfunction - Cylinder 2',
  'P0203': 'Injector Circuit Malfunction - Cylinder 3',
  'P0204': 'Injector Circuit Malfunction - Cylinder 4',
  'P0217': 'Engine Coolant Over Temperature Condition',
  'P0220': 'Throttle / Pedal Position Sensor B Circuit Malfunction',
  'P0230': 'Fuel Pump Primary Circuit Malfunction',
  'P0234': 'Turbo / Supercharger Overboost Condition',
  'P0299': 'Turbo / Supercharger Underboost',
  'P0300': 'Random / Multiple Cylinder Misfire Detected',
  'P0301': 'Cylinder 1 Misfire Detected',
  'P0302': 'Cylinder 2 Misfire Detected',
  'P0303': 'Cylinder 3 Misfire Detected',
  'P0304': 'Cylinder 4 Misfire Detected',
  'P0305': 'Cylinder 5 Misfire Detected',
  'P0306': 'Cylinder 6 Misfire Detected',
  'P0325': 'Knock Sensor 1 Circuit Malfunction (Bank 1)',
  'P0335': 'Crankshaft Position Sensor A Circuit Malfunction',
  'P0340': 'Camshaft Position Sensor Circuit Malfunction (Bank 1)',
  'P0341': 'Camshaft Position Sensor Range / Performance (Bank 1)',
  'P0351': 'Ignition Coil A Primary / Secondary Circuit Malfunction',
  'P0352': 'Ignition Coil B Primary / Secondary Circuit Malfunction',
  'P0401': 'Exhaust Gas Recirculation Flow Insufficient',
  'P0402': 'Exhaust Gas Recirculation Flow Excessive',
  'P0420': 'Catalyst System Efficiency Below Threshold (Bank 1)',
  'P0430': 'Catalyst System Efficiency Below Threshold (Bank 2)',
  'P0440': 'Evaporative Emission Control System Malfunction',
  'P0442': 'Evaporative Emission System Leak Detected (Small Leak)',
  'P0446': 'Evaporative Emission Vent Control Circuit Malfunction',
  'P0455': 'Evaporative Emission System Leak Detected (Gross Leak)',
  'P0456': 'Evaporative Emission System Leak Detected (Very Small Leak)',
  'P0480': 'Cooling Fan 1 Control Circuit Malfunction',
  'P0500': 'Vehicle Speed Sensor (VSS) Malfunction',
  'P0505': 'Idle Control System Malfunction',
  'P0506': 'Idle Control System RPM Lower Than Expected',
  'P0507': 'Idle Control System RPM Higher Than Expected',
  'P0562': 'System Voltage Low',
  'P0563': 'System Voltage High',
  'P0600': 'Serial Communication Link Malfunction',
  'P0601': 'Internal Control Module Memory Check Sum Error',
  'P0606': 'Control Module Processor Fault',
  'P0700': 'Transmission Control System Malfunction',
  'P0715': 'Input / Turbine Speed Sensor Circuit Malfunction',
  'P0720': 'Output Speed Sensor Circuit Malfunction',
  'P0730': 'Incorrect Gear Ratio',
  'P0741': 'Torque Converter Clutch Circuit Performance or Stuck Off',
  'P2002': 'Diesel Particulate Filter Efficiency Below Threshold (Bank 1)',
  'P2096': 'Post Catalyst Fuel Trim System Too Lean (Bank 1)',
  'P2138': 'Throttle / Pedal Position Sensor D / E Voltage Correlation',
  'P2195': 'O2 Sensor Signal Stuck Lean (Bank 1 Sensor 1)',
  'P2196': 'O2 Sensor Signal Stuck Rich (Bank 1 Sensor 1)',
  'C0035': 'Left Front Wheel Speed Sensor Circuit',
  'C0040': 'Right Front Wheel Speed Sensor Circuit',
  'C0045': 'Left Rear Wheel Speed Sensor Circuit',
  'C0050': 'Right Rear Wheel Speed Sensor Circuit',
  'U0001': 'High Speed CAN Communication Bus',
  'U0073': 'Control Module Communication Bus Off',
  'U0100': 'Lost Communication With ECM / PCM',
  'U0101': 'Lost Communication With TCM',
  'U0121': 'Lost Communication With Anti-Lock Brake System (ABS) Control Module',
  'U0140': 'Lost Communication With Body Control Module',
  'U0155': 'Lost Communication With Instrument Panel Cluster (IPC) Control Module'
};

// CAN FD data length for each 4-bit DLC code (codes 0-8 are the length itself).
export const CAN_FD_LENGTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];
export const canFdLengthToDlc = (len) => CAN_FD_LENGTHS.indexOf(len);

const HEX_ONLY = /^[0-9A-Fa-f]*$/;

// SLCAN frame type letters: t/T classic data, r/R classic remote (RTR), and the
// CAN FD extension used by CANable 2.0 / candleLight-FD firmware: d/D FD
// without bit-rate switching, b/B FD with BRS. Lower case = 11-bit, upper = 29-bit.
const SLCAN_TYPES = {
  t: { ext: false, rtr: false, fd: false, brs: false },
  T: { ext: true, rtr: false, fd: false, brs: false },
  r: { ext: false, rtr: true, fd: false, brs: false },
  R: { ext: true, rtr: true, fd: false, brs: false },
  d: { ext: false, rtr: false, fd: true, brs: false },
  D: { ext: true, rtr: false, fd: true, brs: false },
  b: { ext: false, rtr: false, fd: true, brs: true },
  B: { ext: true, rtr: false, fd: true, brs: true }
};

/**
 * Parses one SLCAN ASCII frame line:
 *   t12381122334455667788      -> { id: 0x123, isExtended: false, dlc: 8, data: [0x11, 0x22, ...] }
 *   T18DAF11081122334455667788 -> { id: 0x18DAF110, isExtended: true, ... }
 *   r1238 / R18DAF1108         -> remote frame: { rtr: true, dlc: 8, data: [] }
 *   b1239...                   -> CAN FD with bit-rate switching (brs: true); the DLC is a hex
 *                                 code (9 = 12 bytes ... F = 64 bytes)
 * With the adapter's timestamp option (Z1) a line ends with 4 hex digits of
 * milliseconds (wrapping at 60000); they come back as `timestamp`.
 *
 * Returns { id, isExtended, dlc (data length), data, raw, rtr, fd, brs, timestamp }
 * or null when the line is not a valid frame (bad hex, DLC out of range, short
 * or surplus characters). Data bytes are never filled in with guessed zeros.
 */
export function parseSlcanFrame(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  const spec = SLCAN_TYPES[trimmed[0]];
  if (!spec) return null;
  const dlcPos = 1 + (spec.ext ? 8 : 3);
  if (trimmed.length <= dlcPos) return null;
  const idStr = trimmed.substring(1, dlcPos);
  if (!HEX_ONLY.test(idStr)) return null;
  const id = parseInt(idStr, 16);
  if (id > (spec.ext ? 0x1fffffff : 0x7ff)) return null;
  const dlcChar = trimmed[dlcPos];
  if (!/^[0-9A-Fa-f]$/.test(dlcChar)) return null;
  const code = parseInt(dlcChar, 16);
  let len;
  if (spec.fd) len = CAN_FD_LENGTHS[code];
  else if (code <= 8) len = code;
  else return null;
  let pos = dlcPos + 1;
  let data;
  if (spec.rtr) {
    data = new Uint8Array(0);
  } else {
    const dataStr = trimmed.substring(pos, pos + len * 2);
    if (dataStr.length !== len * 2 || !HEX_ONLY.test(dataStr)) return null;
    data = new Uint8Array(len);
    for (let i = 0; i < len; i++) data[i] = parseInt(dataStr.substring(i * 2, i * 2 + 2), 16);
    pos += len * 2;
  }
  let timestamp = null;
  const rest = trimmed.substring(pos);
  if (rest.length) {
    if (rest.length !== 4 || !HEX_ONLY.test(rest)) return null;
    timestamp = parseInt(rest, 16);
  }
  return { id, isExtended: spec.ext, dlc: len, data, raw: trimmed, rtr: spec.rtr, fd: spec.fd, brs: spec.brs, timestamp };
}

/**
 * Encodes a CAN frame as an SLCAN string (with the trailing "\r").
 *   buildSlcanFrame(0x123, [1, 2], false)                           -> "t12320102\r" (classic)
 *   buildSlcanFrame(0x123, [], false, { rtr: true, dlc: 4 })        -> "r1234\r"
 *   buildSlcanFrame(0x123, bytes12, false, { fd: true, brs: true }) -> "b1239...\r"
 * Throws RangeError for a payload the frame type cannot carry.
 */
export function buildSlcanFrame(id, dataBytes, isExtended = false, { rtr = false, fd = false, brs = false, dlc } = {}) {
  const bytes = Array.from(dataBytes || []);
  let len = bytes.length;
  if (rtr) {
    if (fd) throw new RangeError('CAN FD has no remote frames.');
    len = dlc ?? bytes.length;
    if (!Number.isInteger(len) || len < 0 || len > 8) throw new RangeError('A remote frame requests 0 to 8 bytes.');
  } else if (fd) {
    if (canFdLengthToDlc(len) < 0) throw new RangeError(`A CAN FD payload is 0-8, 12, 16, 20, 24, 32, 48 or 64 bytes, not ${len}.`);
  } else if (len > 8) {
    throw new RangeError('Classic CAN frames carry at most 8 bytes; use CAN FD for more.');
  }
  const type = rtr ? (isExtended ? 'R' : 'r')
    : fd ? (brs ? (isExtended ? 'B' : 'b') : (isExtended ? 'D' : 'd'))
      : (isExtended ? 'T' : 't');
  const idStr = isExtended
    ? (id & 0x1FFFFFFF).toString(16).padStart(8, '0').toUpperCase()
    : (id & 0x7FF).toString(16).padStart(3, '0').toUpperCase();
  const dlcChar = fd ? canFdLengthToDlc(len).toString(16).toUpperCase() : String(len);
  const hexData = rtr ? '' : bytes.map((b) => (b & 0xFF).toString(16).padStart(2, '0').toUpperCase()).join('');
  return `${type}${idStr}${dlcChar}${hexData}\r`;
}

/** CAN FD data-phase bit rates (CANable 2.0 / candleLight-FD "Y" command). Confirm against your firmware. */
export const CAN_FD_DATA_RATES = [
  { code: 'Y1', baud: 1000000, label: '1 Mbps data phase' },
  { code: 'Y2', baud: 2000000, label: '2 Mbps data phase' },
  { code: 'Y4', baud: 4000000, label: '4 Mbps data phase' },
  { code: 'Y5', baud: 5000000, label: '5 Mbps data phase' }
];

/**
 * Commands (without the "\r") that open an SLCAN channel:
 * C (close), S<n> (nominal bit rate), Y<n> (FD data rate), Z1 (timestamps),
 * then O (normal), L (listen-only: never transmits or ACKs) or l (loopback).
 */
export function buildSlcanOpenSequence({ baudCode = 'S6', fdRateCode = null, mode = 'normal', timestamps = false } = {}) {
  const open = { normal: 'O', listen: 'L', loopback: 'l' }[mode];
  if (!open) throw new RangeError(`Unknown SLCAN open mode "${mode}".`);
  const seq = ['C', baudCode];
  if (fdRateCode) seq.push(fdRateCode);
  if (timestamps) seq.push('Z1');
  seq.push(open);
  return seq;
}

/** The adapter answers a rejected command with a BELL (0x07). */
export const isSlcanError = (line) => typeof line === 'string' && line.includes('\x07');

/**
 * Turn the 16-bit millisecond timestamps (0-59999, then wrapping) into a
 * continuously increasing millisecond count. Call the returned function with
 * each frame's `timestamp` in arrival order.
 */
export function createSlcanClock() {
  let last = null;
  let base = 0;
  return (ts) => {
    if (ts === null || ts === undefined) return null;
    if (last !== null && ts < last - 30000) base += 60000;
    last = ts;
    return base + ts;
  };
}

/**
 * Find the bus bit rate by listening. `probe(code)` must open the channel
 * listen-only at that SLCAN rate code, listen for a moment, and resolve
 * { frames, errors } (valid frames parsed, error replies / bad lines). The
 * first rate with traffic and no errors wins; null means nothing was heard
 * (silent bus, wiring, or a rate not in the list).
 */
export async function autoDetectBitrate(probe, { codes = ['S6', 'S5', 'S8', 'S4', 'S3'], minFrames = 1 } = {}) {
  const results = [];
  for (const code of codes) {
    const r = await probe(code);
    results.push({ code, frames: r.frames, errors: r.errors });
    if (r.frames >= minFrames && r.errors === 0) return { code, results };
  }
  return { code: null, results };
}

/**
 * Splits an SLCAN byte/text stream into lines. Adapters end each frame with
 * "\r" (some also send "\n"); a chunk can end mid-frame, so the remainder is
 * carried over. "\x07" (BELL) is the adapter's error reply.
 */
export class SlcanLineReader {
  constructor() { this.buf = ''; }
  push(text) {
    this.buf += text;
    const parts = this.buf.split(/[\r\n]/);
    this.buf = parts.pop();
    if (this.buf.length > 4096) this.buf = '';
    return parts.filter((p) => p.length > 0);
  }
}

/** Two DTC bytes -> "P0300". */
export function decodeDtc(b1, b2) {
  const letter = 'PCBU'[(b1 >> 6) & 3];
  return letter + ((b1 >> 4) & 3) + (b1 & 0x0f).toString(16).toUpperCase()
    + ((b2 >> 4) & 0x0f).toString(16).toUpperCase() + (b2 & 0x0f).toString(16).toUpperCase();
}

/**
 * OBD-II over a raw SLCAN adapter (ISO 15765-4, 11-bit, functional 0x7DF).
 * Handles ISO-TP single frames and multi-frame replies (sends flow control
 * to the ECU's physical request ID, response ID - 8).
 *
 *   const obd = new ObdOverSlcan((slcanLine) => sendString(slcanLine, ''));
 *   onEachReceivedFrame(f => obd.onFrame(f));
 *   const { dtcs } = await obd.readDtcs();
 */
export class ObdOverSlcan {
  constructor(send, { timeoutMs = 1500, quietMs = 250 } = {}) {
    this.send = send;
    this.timeoutMs = timeoutMs;
    this.quietMs = quietMs;
    this.collector = null;
    this._chain = Promise.resolve();   // one request on the bus at a time
  }

  onFrame(f) {
    if (this.collector && !f.isExtended && f.id >= 0x7e8 && f.id <= 0x7ef) this.collector(f);
  }

  /**
   * Send a service request; resolves with { ecuId: payload } for every ECU that
   * answered. Requests are queued, so polling and a DTC scan can't collide.
   */
  request(serviceBytes, opts = {}) {
    const run = () => this._request(serviceBytes, opts);
    const p = this._chain.then(run, run);
    this._chain = p.catch(() => {});
    return p;
  }

  _request(serviceBytes, { quietMs = this.quietMs, timeoutMs = this.timeoutMs } = {}) {
    const sf = new Uint8Array(8);
    sf[0] = serviceBytes.length;
    sf.set(serviceBytes, 1);
    return new Promise((resolve) => {
      const ecus = new Map();   // id -> { total, data: [] }
      let quiet = null;
      const finish = () => {
        clearTimeout(hard); clearTimeout(quiet);
        this.collector = null;
        const out = {};
        for (const [id, e] of ecus) if (e.data.length >= e.total) out[id] = Uint8Array.from(e.data.slice(0, e.total));
        resolve(out);
      };
      const hard = setTimeout(finish, timeoutMs);
      this.collector = (f) => {
        const pci = f.data[0] >> 4;
        if (pci === 0) {                                    // single frame
          const n = f.data[0] & 0x0f;
          ecus.set(f.id, { total: n, data: Array.from(f.data.subarray(1, 1 + n)) });
        } else if (pci === 1) {                             // first frame
          const total = ((f.data[0] & 0x0f) << 8) | f.data[1];
          ecus.set(f.id, { total, data: Array.from(f.data.subarray(2, 8)), next: 1 });
          this.send(buildSlcanFrame(f.id - 8, new Uint8Array([0x30, 0, 0, 0, 0, 0, 0, 0])));
        } else if (pci === 2) {                             // consecutive frame
          const e = ecus.get(f.id);
          if (!e || (f.data[0] & 0x0f) !== (e.next & 0x0f)) return;
          e.next++;
          e.data.push(...f.data.subarray(1, 8));
        } else return;
        clearTimeout(quiet);
        quiet = setTimeout(finish, quietMs);
      };
      this.send(buildSlcanFrame(0x7df, sf));
    });
  }

  /**
   * Mode 01 PID: data bytes (after 0x41, pid) from the first ECU that answers,
   * or null when no ECU supports it.
   */
  async readPid(pid) {
    const replies = await this.request([0x01, pid], { quietMs: 40, timeoutMs: 300 });
    for (const id of Object.keys(replies).map(Number).sort()) {
      const p = replies[id];
      if (p[0] === 0x41 && p[1] === pid) return p.subarray(2);
    }
    return null;
  }

  /** Mode 09 PID 02: the VIN, or null when no ECU reports it. */
  async readVin() {
    const replies = await this.request([0x09, 0x02]);
    for (const p of Object.values(replies)) {
      if (p[0] !== 0x49 || p[1] !== 0x02) continue;
      const text = String.fromCharCode(...p.subarray(2)).replace(/[^A-HJ-NPR-Z0-9]/g, '');
      if (text.length >= 17) return text.slice(-17);
    }
    return null;
  }

  /** Mode 01 PIDs the vehicle supports, from the 0x00 / 0x20 / 0x40 ... bitmaps. */
  async supportedPids() {
    const out = [];
    for (let base = 0; base <= 0xe0; base += 0x20) {
      const b = await this.readPid(base);
      if (!b || b.length < 4) break;
      for (let i = 0; i < 32; i++) if (b[i >> 3] & (0x80 >> (i & 7))) out.push(base + i + 1);
      if (!out.includes(base + 0x20)) break;
    }
    return out.filter((pid) => pid % 0x20 !== 0);
  }

  /** Mode 03: stored DTCs from every ECU that answers. */
  async readDtcs() {
    const replies = await this.request([0x03]);
    const dtcs = [];
    const ecus = Object.keys(replies).map(Number);
    for (const id of ecus) {
      const p = replies[id];
      if (p[0] !== 0x43) continue;
      // CAN replies carry a count byte after 0x43; fall back to pairs if it doesn't fit.
      let start = 1;
      if (p.length >= 2 && p.length - 2 === p[1] * 2) start = 2;
      for (let i = start; i + 1 < p.length; i += 2) {
        if (p[i] === 0 && p[i + 1] === 0) continue;
        const code = decodeDtc(p[i], p[i + 1]);
        if (!dtcs.includes(code)) dtcs.push(code);
      }
    }
    return { dtcs, ecus };
  }

  /** Mode 04: clear DTCs. Resolves with the ECUs that confirmed (0x44). */
  async clearDtcs() {
    const replies = await this.request([0x04]);
    const confirmed = [], refused = [];
    for (const [id, p] of Object.entries(replies)) (p[0] === 0x44 ? confirmed : refused).push(Number(id));
    return { confirmed, refused };
  }
}
