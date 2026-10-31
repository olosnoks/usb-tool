// Improv Wi-Fi over serial (https://www.improv-wifi.com/serial/), plus the
// scan replies of the AT and MicroPython fallbacks.
//
// Packet: "IMPROV" | version 1 | type | length | data | checksum
// checksum = sum of every preceding byte & 0xFF. Types: 0x01 current state,
// 0x02 error state, 0x03 RPC command, 0x04 RPC result.
// RPC data: command | length of the rest | rest. Strings are length-prefixed.

export const IMPROV_TYPE = { STATE: 0x01, ERROR: 0x02, RPC: 0x03, RESULT: 0x04 };
export const IMPROV_CMD = { WIFI_SETTINGS: 0x01, GET_STATE: 0x02, GET_INFO: 0x03, SCAN: 0x04 };
export const IMPROV_STATE = { READY: 0x02, PROVISIONING: 0x03, PROVISIONED: 0x04 };
export const IMPROV_ERRORS = {
  0x00: null,
  0x01: 'invalid RPC packet',
  0x02: 'unknown RPC command',
  0x03: 'unable to connect to the network',
  0xff: 'unknown error'
};

const HEADER = [0x49, 0x4d, 0x50, 0x52, 0x4f, 0x56];   // "IMPROV"
const enc = new TextEncoder(), dec = new TextDecoder();

export function improvFrame(type, data) {
  const body = [...HEADER, 0x01, type, data.length, ...data];
  let sum = 0;
  for (const b of body) sum = (sum + b) & 0xff;
  return Uint8Array.from([...body, sum]);
}

export function improvStrings(strings) {
  const out = [];
  for (const s of strings) { const b = enc.encode(s); out.push(b.length, ...b); }
  return out;
}

/** RPC command frame (command | length | payload). */
export function improvRpc(command, payload = []) {
  return improvFrame(IMPROV_TYPE.RPC, [command, payload.length, ...payload]);
}

export const improvWifiSettings = (ssid, password) => improvRpc(IMPROV_CMD.WIFI_SETTINGS, improvStrings([ssid, password]));

/** Pulls Improv packets out of a byte stream that also carries log text. */
export class ImprovParser {
  constructor() { this.buf = []; }
  push(bytes) {
    for (const b of bytes) this.buf.push(b);
    const packets = [];
    while (true) {
      const i = this._findHeader();
      if (i < 0) { this.buf = this.buf.slice(-5); break; }
      if (i > 0) this.buf = this.buf.slice(i);
      if (this.buf.length < 9) break;
      const len = this.buf[8];
      if (this.buf.length < 10 + len) break;
      const pkt = this.buf.slice(0, 10 + len);
      let sum = 0;
      for (let k = 0; k < 9 + len; k++) sum = (sum + pkt[k]) & 0xff;
      if (sum === pkt[9 + len] && pkt[6] === 0x01) {
        packets.push(decodeImprov(pkt[7], Uint8Array.from(pkt.slice(9, 9 + len))));
        this.buf = this.buf.slice(10 + len);
      } else {
        this.buf = this.buf.slice(1);           // false header: keep hunting
      }
    }
    return packets;
  }
  _findHeader() {
    outer: for (let i = 0; i + HEADER.length <= this.buf.length; i++) {
      for (let k = 0; k < HEADER.length; k++) if (this.buf[i + k] !== HEADER[k]) continue outer;
      return i;
    }
    return -1;
  }
}

function readStrings(data) {
  const out = [];
  let i = 0;
  while (i < data.length) {
    const n = data[i++];
    out.push(dec.decode(data.subarray(i, i + n)));
    i += n;
  }
  return out;
}

export function decodeImprov(type, data) {
  if (type === IMPROV_TYPE.STATE) return { kind: 'state', state: data[0] };
  if (type === IMPROV_TYPE.ERROR) return { kind: 'error', code: data[0], message: IMPROV_ERRORS[data[0]] ?? `error 0x${(data[0] || 0).toString(16)}` };
  if (type === IMPROV_TYPE.RESULT) {
    const command = data[0], len = data[1] || 0;
    return { kind: 'result', command, strings: readStrings(data.subarray(2, 2 + len)) };
  }
  return { kind: 'other', type, data };
}

// ---- fallback modes ----

/** ESP-AT: +CWLAP:(<ecn>,"<ssid>",<rssi>,"<mac>",<channel>,...) */
export function parseCwlapLine(line) {
  const m = line.match(/^\+CWLAP:\((\d+),"((?:[^"\\]|\\.)*)",(-?\d+)/);
  if (!m) return null;
  return { ssid: m[2].replace(/\\(.)/g, '$1'), rssi: parseInt(m[3], 10), secure: m[1] !== '0' };
}

/** MicroPython: SCAN_RES: [(b'ssid', b'\x..bssid', ch, rssi, authmode, hidden), ...] */
export function parseMicropythonScan(line) {
  if (!line.includes('SCAN_RES:')) return null;
  const out = [];
  const re = /\(b(['"])((?:\\.|(?!\1).)*)\1,\s*b(['"])(?:\\.|(?!\3).)*\3,\s*(\d+),\s*(-?\d+),\s*(\d+),\s*(?:\d+|True|False)\)/g;
  let m;
  while ((m = re.exec(line))) {
    out.push({ ssid: m[2].replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(.)/g, '$1'),
               rssi: parseInt(m[5], 10), secure: m[6] !== '0' });
  }
  return out;
}
