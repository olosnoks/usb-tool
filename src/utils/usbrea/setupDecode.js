// Pure helpers for the packet browser: decode USB setup packets and pick descriptors out of a capture.
// (Local minimal decode of device/configuration/string descriptors.)
import { hex } from './bytes.js';

const STD_REQ = {
  0: 'GET_STATUS', 1: 'CLEAR_FEATURE', 3: 'SET_FEATURE', 5: 'SET_ADDRESS', 6: 'GET_DESCRIPTOR', 7: 'SET_DESCRIPTOR',
  8: 'GET_CONFIGURATION', 9: 'SET_CONFIGURATION', 10: 'GET_INTERFACE', 11: 'SET_INTERFACE', 12: 'SYNCH_FRAME',
};
const DESC_TYPE = { 1: 'DEVICE', 2: 'CONFIGURATION', 3: 'STRING', 4: 'INTERFACE', 5: 'ENDPOINT', 6: 'DEVICE_QUALIFIER', 0x21: 'HID', 0x22: 'HID REPORT', 0x29: 'HUB' };
const HID_REQ = { 1: 'GET_REPORT', 2: 'GET_IDLE', 3: 'GET_PROTOCOL', 9: 'SET_REPORT', 10: 'SET_IDLE', 11: 'SET_PROTOCOL' };
const CDC_REQ = { 0x20: 'SET_LINE_CODING', 0x21: 'GET_LINE_CODING', 0x22: 'SET_CONTROL_LINE_STATE', 0x23: 'SEND_BREAK' };
const REPORT_TYPE = { 1: 'Input', 2: 'Output', 3: 'Feature' };
const h2 = (n) => `0x${n.toString(16).padStart(2, '0')}`;

/** Decode an 8-byte setup packet into a short human string, e.g. "GET_DESCRIPTOR(CONFIGURATION idx 0, len 255)". */
export function decode_setup(setup, data = null) {
  if (!setup || setup.length < 8) return '';
  const bm = setup[0];
  const req = setup[1];
  const val = setup[2] | (setup[3] << 8);
  const idx = setup[4] | (setup[5] << 8);
  const len = setup[6] | (setup[7] << 8);
  const type = (bm >> 5) & 3;
  if (type === 0) {
    const name = STD_REQ[req] || `request ${h2(req)}`;
    if (req === 6 || req === 7) return `${name}(${DESC_TYPE[val >> 8] || `type ${h2(val >> 8)}`} idx ${val & 0xff}${idx ? `, lang/iface ${h2(idx)}` : ''}, len ${len})`;
    if (req === 9) return `${name}(config ${val})`;
    if (req === 11) return `${name}(interface ${idx}, alt ${val})`;
    return `${name}(value ${h2(val)}, index ${idx}, len ${len})`;
  }
  if (type === 1) {
    if ((bm & 0x1f) === 1 && HID_REQ[req]) {
      const base = HID_REQ[req];
      if (req === 1 || req === 9) return `${base}(${REPORT_TYPE[val >> 8] || `type ${val >> 8}`} id ${val & 0xff}, iface ${idx}, len ${len})`;
      return `${base}(value ${h2(val)}, iface ${idx})`;
    }
    if (CDC_REQ[req]) {
      if (req === 0x20 && data && data.length >= 7) {
        const baud = (data[0] | (data[1] << 8) | (data[2] << 16) | (data[3] << 24)) >>> 0;
        return `SET_LINE_CODING(${baud} baud, ${data[6]} data bits, stop ${['1', '1.5', '2'][data[4]] ?? data[4]}, parity ${['none', 'odd', 'even', 'mark', 'space'][data[5]] ?? data[5]})`;
      }
      if (req === 0x22) return `SET_CONTROL_LINE_STATE(DTR=${val & 1}, RTS=${(val >> 1) & 1})`;
      return `${CDC_REQ[req]}(iface ${idx})`;
    }
    return `class request ${h2(req)}(value ${h2(val)}, index ${idx}, len ${len})`;
  }
  return `${type === 2 ? 'vendor' : 'reserved'} request ${h2(req)}(value ${h2(val)}, index ${idx}, len ${len})`;
}

function u16(b, o) { return b[o] | (b[o + 1] << 8); }

/** Decode a device descriptor (18 bytes) or null. */
export function decode_device(d) {
  if (d.length < 18 || d[1] !== 1) return null;
  return {
    bcdUSB: `${d[3]}.${(d[2] >> 4)}${d[2] & 15}`,
    class: d[4], subclass: d[5], protocol: d[6], maxPacket0: d[7],
    vid: u16(d, 8), pid: u16(d, 10), bcdDevice: `${d[13]}.${(d[12] >> 4)}${d[12] & 15}`,
    manufacturerIdx: d[14], productIdx: d[15], serialIdx: d[16], configs: d[17],
  };
}

/** Walk a configuration descriptor blob into interfaces and endpoints (stops at truncation). */
export function decode_config(d) {
  if (d.length < 9 || d[1] !== 2) return null;
  const cfg = { totalLength: u16(d, 2), interfaces: d[4], value: d[5], attributes: d[7], maxPowerMa: d[8] * 2, items: [], truncated: d.length < u16(d, 2) };
  let o = 9;
  let cur = null;
  while (o + 2 <= d.length && d[o] >= 2 && o + d[o] <= d.length) {
    const len = d[o];
    const t = d[o + 1];
    if (t === 4 && len >= 9) {
      cur = { number: d[o + 2], alt: d[o + 3], endpoints: [], class: d[o + 5], subclass: d[o + 6], protocol: d[o + 7] };
      cfg.items.push(cur);
    } else if (t === 5 && len >= 7 && cur) {
      cur.endpoints.push({ address: d[o + 2], type: ['control', 'isochronous', 'bulk', 'interrupt'][d[o + 3] & 3], maxPacket: u16(d, o + 4), interval: d[o + 6] });
    }
    o += len;
  }
  return cfg;
}

export function decode_string(d) {
  if (d.length < 2 || d[1] !== 3) return null;
  let s = '';
  for (let o = 2; o + 1 < Math.min(d.length, d[0]); o += 2) s += String.fromCharCode(u16(d, o));
  return s;
}

/** Descriptors answered in the capture: [{ frame, device, kind, summary, hex, decoded }]. */
export function find_descriptors(transfers) {
  const out = [];
  const pending = new Map();
  for (const t of transfers) {
    if (t.xfer_type !== 2) continue;
    if (t.setup && (t.setup[0] & 0x80) && t.setup[1] === 6 && !t.data.length) {
      pending.set(t.device, t.setup);
    } else if (!t.setup && t.is_in && t.data.length && pending.has(t.device)) {
      const setup = pending.get(t.device);
      pending.delete(t.device);
      const type = setup[3];
      let kind = DESC_TYPE[type] || `type ${h2(type)}`;
      let summary = '';
      let decoded = null;
      if (type === 1 && (decoded = decode_device(t.data))) summary = `${decoded.vid.toString(16).padStart(4, '0')}:${decoded.pid.toString(16).padStart(4, '0')}, USB ${decoded.bcdUSB}, class ${h2(decoded.class)}`;
      else if (type === 2 && (decoded = decode_config(t.data))) summary = `${decoded.items.length} interface alt-setting(s), ${decoded.maxPowerMa} mA${decoded.truncated ? ', truncated' : ''}`;
      else if (type === 3 && (decoded = decode_string(t.data)) !== null) summary = JSON.stringify(decoded);
      else if (type === 0x22) summary = `${t.data.length} bytes of HID report descriptor`;
      else summary = `${t.data.length} bytes`;
      out.push({ frame: t.frame, device: t.device, kind, summary, hex: hex(t.data), decoded });
    }
  }
  return out;
}

/** One-line ASCII preview (non-printables as '.'). */
export function ascii(data, max = 24) {
  let s = '';
  for (let i = 0; i < Math.min(data.length, max); i++) s += data[i] >= 32 && data[i] < 127 ? String.fromCharCode(data[i]) : '.';
  return s;
}
