// Pure helpers for the Packet Analyzer tab: turn parsed radiotap/802.11 pcap records (and serial lines)
// into display frames, classify 802.11 frames, and produce CSV rows. No React, no browser APIs.
import { extractLayer3Metadata } from './layer3Parser.js';
import { generatePcapBuffer } from './pcapExporter.js';

const MGMT = { 0: 'Association Request', 1: 'Association Response', 2: 'Reassociation Request', 3: 'Reassociation Response', 4: 'Probe Request', 5: 'Probe Response', 8: 'Beacon', 9: 'ATIM', 10: 'Disassociation', 11: 'Authentication', 12: 'Deauthentication', 13: 'Action' };
const CTRL = { 7: 'Control Wrapper', 8: 'Block Ack Request', 9: 'Block Ack', 10: 'PS-Poll', 11: 'RTS', 12: 'CTS', 13: 'ACK', 14: 'CF-End', 15: 'CF-End + CF-Ack' };
const DATA = { 0: 'Data', 1: 'Data + CF-Ack', 2: 'Data + CF-Poll', 3: 'Data + CF-Ack + CF-Poll', 4: 'Null', 8: 'QoS Data', 12: 'QoS Null' };
const SHORT = { 'Association Request': 'Assoc Req', 'Association Response': 'Assoc Resp', 'Reassociation Request': 'Reassoc Req', 'Reassociation Response': 'Reassoc Resp', 'Probe Request': 'Probe Req', 'Probe Response': 'Probe Resp', Disassociation: 'Disassoc', Authentication: 'Auth', Deauthentication: 'Deauth' };

const mac = (b, o) => (b.length >= o + 6 ? Array.from(b.subarray(o, o + 6), (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':') : '');
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');

/** Length of the radiotap header (0 when the buffer is not radiotap). */
export function radiotapLength(buf) {
  if (!buf || buf.length < 8 || buf[0] !== 0) return 0;
  const len = buf[2] | (buf[3] << 8);
  return len >= 8 && len <= buf.length ? len : 0;
}

/** Channel frequency (MHz) and dBm signal from a radiotap header; undefined when absent. */
export function parseRadiotap(buf) {
  const len = radiotapLength(buf);
  if (!len) return { len: 0 };
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const present = dv.getUint32(4, true);
  let o = 8;
  let ext = present;
  while (ext & 0x80000000 && o + 4 <= len) { ext = dv.getUint32(o, true); o += 4; }
  const out = { len };
  // Fields 0..5 in order: TSFT(8,a8) flags(1) rate(1) channel(4,a2) FHSS(2) dbm_antsignal(1)
  const spec = [[0, 8, 8], [1, 1, 1], [2, 1, 1], [3, 4, 2], [4, 2, 1], [5, 1, 1]];
  for (const [bit, size, align] of spec) {
    if (!(present & (1 << bit))) continue;
    o = Math.ceil(o / align) * align;
    if (o + size > len) break;
    if (bit === 3) out.freq = dv.getUint16(o, true);
    if (bit === 5) out.rssi = dv.getInt8(o);
    o += size;
  }
  return out;
}

export function freqToChannel(f) {
  if (!f) return 0;
  if (f === 2484) return 14;
  if (f >= 2412 && f <= 2472) return (f - 2407) / 5;
  if (f >= 5000 && f <= 5900) return (f - 5000) / 5;
  return 0;
}

/**
 * Classify an 802.11 MAC frame starting at `off`.
 * Returns { type, subtype, protocol, isQoS, isProtected, eapol } or null when too short.
 * eapol is 1..4 for the four-way handshake message number, 0 for other EAPOL, null otherwise.
 */
export function classifyFrame(buf, off = 0) {
  if (!buf || buf.length < off + 10) return null;
  const fc0 = buf[off];
  const fc1 = buf[off + 1];
  const t = (fc0 >> 2) & 3;
  const st = fc0 >> 4;
  const isProtected = (fc1 & 0x40) !== 0;
  if (t === 0) {
    const sub = MGMT[st] || `Management ${st}`;
    return { type: 'Management', subtype: sub, protocol: `802.11 ${SHORT[sub] || sub}`, isQoS: false, isProtected, eapol: null };
  }
  if (t === 1) {
    const sub = CTRL[st] || `Control ${st}`;
    return { type: 'Control', subtype: sub, protocol: `802.11 ${sub}`, isQoS: false, isProtected, eapol: null };
  }
  if (t === 2) {
    const isQoS = (st & 8) !== 0;
    const sub = DATA[st] || `Data ${st}`;
    let hdr = isQoS ? 26 : 24;
    if ((fc1 & 3) === 3) hdr += 6;
    const p = off + hdr;
    if (!isProtected && buf.length >= p + 8 && buf[p] === 0xaa && buf[p + 1] === 0xaa && buf[p + 2] === 0x03
      && buf[p + 6] === 0x88 && buf[p + 7] === 0x8e) {
      let n = 0;
      // EAPOL: version, type(3 = Key), len(2), descriptor(1), key info(2)
      if (buf[p + 9] === 3 && buf.length >= p + 8 + 7) {
        const ki = (buf[p + 8 + 5] << 8) | buf[p + 8 + 6];
        const ack = ki & 0x80; const mic = ki & 0x100; const inst = ki & 0x40; const sec = ki & 0x200;
        if (ack && !mic) n = 1;
        else if (ack && mic && inst) n = 3;
        else if (mic && !ack && sec) n = 4;
        else if (mic && !ack) n = 2;
        return { type: 'Data', subtype: 'EAPOL Key', protocol: n ? `EAPOL 4-Way #${n}` : 'EAPOL Key', isQoS, isProtected, eapol: n };
      }
      return { type: 'Data', subtype: 'EAPOL', protocol: 'EAPOL', isQoS, isProtected, eapol: 0 };
    }
    return { type: 'Data', subtype: sub, protocol: `802.11 ${isProtected ? 'Data (protected)' : sub}`, isQoS, isProtected, eapol: null };
  }
  return { type: 'Extension', subtype: `Extension ${st}`, protocol: '802.11 Extension', isQoS: false, isProtected, eapol: null };
}

function parseTags(buf, start) {
  const tags = {};
  let o = start;
  while (o + 2 <= buf.length) {
    const id = buf[o];
    const len = buf[o + 1];
    if (o + 2 + len > buf.length) break;
    if (!(id in tags)) tags[id] = buf.subarray(o + 2, o + 2 + len);
    o += 2 + len;
  }
  return tags;
}

function fmtClock(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
}

/**
 * Convert one record from pcapReader.parsePcap().packetRecords into a display frame.
 * `t0Ms` is the first packet's timeMs so that times read relative to capture start.
 */
export function recordToFrame(record, id, t0Ms = record.timestamp.timeMs) {
  const data = record.data;
  const rt = parseRadiotap(data);
  const off = rt.len;
  const cls = classifyFrame(data, off);
  const frame = {
    id,
    time: fmtClock((record.timestamp.timeMs - t0Ms) / 1000),
    timeMs: record.timestamp.timeMs,
    origin: 'pcap',
    raw: data,
    protocol: 'Unknown',
    source: '', dest: '', bssid: 'N/A', addr1: '', addr2: '', addr3: '',
    channel: freqToChannel(rt.freq),
    rssi: rt.rssi ?? 0,
    ssid: '',
    type: 'Unknown', subtype: 'Unknown',
    length: record.origLen ?? data.length,
    hex: hex(data),
  };
  if (!cls) return frame;
  frame.type = cls.type;
  frame.subtype = cls.subtype;
  frame.protocol = cls.protocol;
  frame.addr1 = mac(data, off + 4);
  frame.addr2 = mac(data, off + 10);
  frame.addr3 = mac(data, off + 16);
  frame.dest = frame.addr1;
  frame.source = frame.addr2 || frame.addr1;
  frame.bssid = frame.addr3 || 'N/A';
  if (cls.type === 'Management') {
    const sub = (data[off] >> 4);
    const fixed = sub === 8 || sub === 5 ? 12 : sub === 4 ? 0 : -1;
    if (fixed >= 0) {
      const tags = parseTags(data, off + 24 + fixed);
      if (tags[0]) {
        const s = new TextDecoder('utf-8', { fatal: false }).decode(tags[0]);
        frame.ssid = s || (sub === 4 ? 'Broadcast (Wildcard)' : '(hidden)');
      } else if (sub === 4) frame.ssid = 'Broadcast (Wildcard)';
      if (!frame.channel && tags[3] && tags[3].length) frame.channel = tags[3][0];
    }
  } else if (cls.type === 'Data' && !cls.isProtected) {
    const l3 = extractLayer3Metadata(data, off, cls.isQoS);
    if (l3) {
      frame.protocol = l3.protocol === 'ARP' ? `ARP ${l3.op}` : `DHCP${l3.messageType ? ` ${l3.messageType}` : ''}`;
      frame.ssid = [l3.ip, l3.hostname].filter(Boolean).join(' ');
    }
  }
  return frame;
}

/** Wrap one serial line (Uint8Array) as a display frame. */
export function serialToFrame(bytes, id, timeMs, t0Ms = timeMs) {
  let text = '';
  for (const b of bytes) text += b >= 32 && b < 127 ? String.fromCharCode(b) : (b === 9 ? ' ' : '');
  const nmea = /^\$[A-Z]{2}[A-Z0-9]{3},/.test(text);
  return {
    id, time: fmtClock((timeMs - t0Ms) / 1000), timeMs, origin: 'serial', raw: bytes,
    protocol: nmea ? 'NMEA 0183' : 'Serial', source: 'UART RX', dest: 'Serial Host', bssid: 'N/A', addr1: '', addr2: '', addr3: '',
    channel: 0, rssi: 0, ssid: text, type: 'Serial', subtype: nmea ? text.slice(3, 6) : 'Raw',
    length: bytes.length, hex: hex(bytes),
  };
}

export const CSV_HEADER = ['No', 'Time', 'Protocol', 'Type', 'Subtype', 'Source', 'Destination', 'BSSID', 'SSID/Info', 'Channel', 'RSSI (dBm)', 'Length', 'Hex'];

function cell(v) {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+@]/.test(s)) s = `'${s}`; // SSIDs are attacker-controlled; keep spreadsheets from evaluating them
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function frameToCsvRow(f) {
  return [f.id, f.time, f.protocol, f.type, f.subtype, f.source, f.dest, f.bssid, f.ssid, f.channel || '', f.rssi || '', f.length, f.hex];
}

export function framesToCsv(frames) {
  return [CSV_HEADER, ...frames.map(frameToCsvRow)].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Real radiotap .pcap bytes of the frames that came from a capture (serial/demo frames are not packets). */
export function framesToPcap(frames) {
  const pk = frames.filter((f) => f.origin === 'pcap').map((f) => ({ data: f.raw, timestamp: f.timeMs }));
  return { bytes: generatePcapBuffer(pk), count: pk.length };
}
