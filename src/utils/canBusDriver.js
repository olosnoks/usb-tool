/**
 * Automotive CAN Bus & OBD-II Diagnostic Driver
 * Implements SLCAN protocol (CANable, Candlelight, USB-CAN) & ELM327 OBD-II AT commands.
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
  'P0300': 'Random / Multiple Cylinder Misfire Detected',
  'P0301': 'Cylinder 1 Misfire Detected',
  'P0171': 'System Too Lean (Bank 1)',
  'P0420': 'Catalyst System Efficiency Below Threshold (Bank 1)',
  'P0128': 'Coolant Thermostat (Coolant Temp Below Regulating Temp)',
  'P0455': 'Evaporative Emission System Leak Detected (Gross Leak)',
  'P0500': 'Vehicle Speed Sensor (VSS) Malfunction'
};

/**
 * Parses an SLCAN ASCII frame line:
 * t12381122334455667788 -> { id: 0x123, isExtended: false, dlc: 8, data: Uint8Array([0x11, 0x22...]) }
 * T18DAF11081122334455667788 -> { id: 0x18DAF110, isExtended: true, dlc: 8, data: ... }
 */
export function parseSlcanFrame(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  const type = trimmed[0];

  if (type === 't') {
    // Standard 11-bit ID (3 hex chars) + DLC (1 digit) + Data (2*DLC hex chars)
    const id = parseInt(trimmed.substring(1, 4), 16);
    const dlc = parseInt(trimmed[4], 10);
    const dataStr = trimmed.substring(5, 5 + (dlc * 2));
    const data = new Uint8Array(dlc);
    for (let i = 0; i < dlc; i++) {
      data[i] = parseInt(dataStr.substring(i * 2, (i * 2) + 2), 16) || 0;
    }
    return { id, isExtended: false, dlc, data, raw: trimmed };
  } else if (type === 'T') {
    // Extended 29-bit ID (8 hex chars) + DLC (1 digit) + Data
    const id = parseInt(trimmed.substring(1, 9), 16);
    const dlc = parseInt(trimmed[9], 10);
    const dataStr = trimmed.substring(10, 10 + (dlc * 2));
    const data = new Uint8Array(dlc);
    for (let i = 0; i < dlc; i++) {
      data[i] = parseInt(dataStr.substring(i * 2, (i * 2) + 2), 16) || 0;
    }
    return { id, isExtended: true, dlc, data, raw: trimmed };
  }

  return null;
}

/**
 * Encodes a CAN frame into an SLCAN string
 */
export function buildSlcanFrame(id, dataBytes, isExtended = false) {
  const dlc = dataBytes.length;
  const hexData = Array.from(dataBytes)
    .map(b => (b & 0xFF).toString(16).padStart(2, '0').toUpperCase())
    .join('');

  if (isExtended) {
    const idStr = (id & 0x1FFFFFFF).toString(16).padStart(8, '0').toUpperCase();
    return `T${idStr}${dlc}${hexData}\r`;
  } else {
    const idStr = (id & 0x7FF).toString(16).padStart(3, '0').toUpperCase();
    return `t${idStr}${dlc}${hexData}\r`;
  }
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
  }

  onFrame(f) {
    if (this.collector && !f.isExtended && f.id >= 0x7e8 && f.id <= 0x7ef) this.collector(f);
  }

  /** Send a service request; resolves with { ecuId: payload } for every ECU that answered. */
  request(serviceBytes) {
    if (this.collector) return Promise.reject(new Error('an OBD request is already running'));
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
      const hard = setTimeout(finish, this.timeoutMs);
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
        quiet = setTimeout(finish, this.quietMs);
      };
      this.send(buildSlcanFrame(0x7df, sf));
    });
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
