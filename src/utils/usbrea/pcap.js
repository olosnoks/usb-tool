// Port of usb_rea/pcap.py: pcap/pcapng reader for USB captures (MIT, (c) 2026 Emir Mrkaljevic).
//
// Supported link types:
//   189 LINKTYPE_USB_LINUX           (usbmon, 48-byte header)
//   220 LINKTYPE_USB_LINUX_MMAPPED   (usbmon, 64-byte header)
//   249 LINKTYPE_USBPCAP             (Windows USBPcap)
//
// Deviation: functions that took a file path take the file's bytes (Uint8Array / ArrayBuffer) instead.
// Gzip-compressed input (.pcap.gz) is detected by its magic bytes and inflated with pako.
import { ungzip } from 'pako';
import { Transfer } from './model.js';

export const LINUX = 189;
export const LINUX_MMAPPED = 220;
export const USBPCAP = 249;

function _u8(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new TypeError('expected capture bytes (Uint8Array)');
}

function _view(b) {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function _m4(data, a, b, c, d) {
  return data.length >= 4 && data[0] === a && data[1] === b && data[2] === c && data[3] === d;
}

/** Yield [frame_no, ts, linktype, raw] for each packet. `data` = capture file bytes (gzip ok).
 * `info` (optional object) receives `truncated_at`: the 1-based frame number where a cut-off or corrupt
 * record was found (that partial frame is not yielded), or stays null for a clean file. */
export function* iter_packets(data, info = null) {
  if (info) info.truncated_at = null;
  data = _u8(data);
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) data = ungzip(data);
  if (_m4(data, 0xd4, 0xc3, 0xb2, 0xa1) || _m4(data, 0xa1, 0xb2, 0xc3, 0xd4)
      || _m4(data, 0x4d, 0x3c, 0xb2, 0xa1) || _m4(data, 0xa1, 0xb2, 0x3c, 0x4d)) {
    yield* _iter_pcap(data, info);
  } else if (_m4(data, 0x0a, 0x0d, 0x0d, 0x0a)) {
    yield* _iter_pcapng(data, info);
  } else {
    throw new Error('not a pcap/pcapng file');
  }
}

export function* _iter_pcap(data, info = null) {
  const le = _m4(data, 0xd4, 0xc3, 0xb2, 0xa1) || _m4(data, 0x4d, 0x3c, 0xb2, 0xa1);
  const nano = _m4(data, 0x4d, 0x3c, 0xb2, 0xa1) || _m4(data, 0xa1, 0xb2, 0x3c, 0x4d);
  const dv = _view(data);
  const linktype = dv.getUint32(20, le);
  let off = 24;
  let n = 0;
  while (off < data.length) {
    if (off + 16 > data.length) { if (info) info.truncated_at = n + 1; return; }
    const sec = dv.getUint32(off, le);
    const frac = dv.getUint32(off + 4, le);
    const incl = dv.getUint32(off + 8, le);
    off += 16;
    if (off + incl > data.length) { if (info) info.truncated_at = n + 1; return; }
    n += 1;
    yield [n, sec + frac / (nano ? 1e9 : 1e6), linktype, data.subarray(off, off + incl)];
    off += incl;
  }
}

export function* _iter_pcapng(data, info = null) {
  const dv = _view(data);
  let off = 0;
  let n = 0;
  let le = true;
  let ifaces = []; // [linktype, resolution]
  let last_ts = 0.0;
  while (off < data.length) {
    if (off + 12 > data.length) { if (info) info.truncated_at = n + 1; return; }
    const btype = dv.getUint32(off, le);
    if (btype === 0x0a0d0d0a) {
      // byte-order magic 4D 3C 2B 1A = little endian
      le = data[off + 8] === 0x4d && data[off + 9] === 0x3c && data[off + 10] === 0x2b && data[off + 11] === 0x1a;
      ifaces = [];
    }
    const blen = dv.getUint32(off + 4, le);
    if (blen < 12 || blen % 4 || off + blen > data.length) { if (info) info.truncated_at = n + 1; return; }
    const body = data.subarray(off + 8, off + blen - 4);
    const bv = _view(body);
    if (btype === 1) { // IDB
      const lt = bv.getUint16(0, le);
      let res = 1e-6;
      let o = 8;
      while (o + 4 <= body.length) {
        const code = bv.getUint16(o, le);
        const ln = bv.getUint16(o + 2, le);
        if (code === 0) break;
        if (code === 9 && ln >= 1) {
          const v = body[o + 4];
          res = (v & 0x80) ? 2.0 ** -(v & 0x7f) : 10.0 ** -v;
        }
        o += 4 + ((ln + 3) & ~3);
      }
      ifaces.push([lt, res]);
    } else if (btype === 6) { // EPB
      const iid = bv.getUint32(0, le);
      const hi = bv.getUint32(4, le);
      const lo = bv.getUint32(8, le);
      const cap = bv.getUint32(12, le);
      const [lt, res] = iid < ifaces.length ? ifaces[iid] : [LINUX_MMAPPED, 1e-6];
      n += 1;
      last_ts = (hi * 4294967296 + lo) * res;
      yield [n, last_ts, lt, body.subarray(20, 20 + cap)];
    } else if (btype === 3) { // SPB
      const [lt] = ifaces.length ? ifaces[0] : [LINUX_MMAPPED, 1e-6];
      n += 1;
      yield [n, last_ts, lt, body.subarray(4)]; // SPBs carry no timestamp: reuse the previous packet's
    }
    off += blen;
  }
}

const _EMPTY = new Uint8Array(0);

// usbmon header (first 48 bytes, little endian): id Q@0, event c@8, xfer_type B@9, epnum B@10, devnum B@11,
// busnum H@12, flag_setup c@14, flag_data c@15, ts_sec q@16, ts_usec i@24, status i@28, length I@32,
// len_cap I@36, setup 8s@40
export function parse_usbmon(frame, ts, raw, hdr_len) {
  const xtype = raw[9];
  const ep = raw[10];
  const dev = raw[11];
  const bus = raw[12] | (raw[13] << 8);
  const flag_setup = raw[14];
  const len_cap = _view(raw).getUint32(36, true);
  const setup = raw.subarray(40, 48);
  const payload = raw.subarray(hdr_len, hdr_len + len_cap);
  const ev = String.fromCharCode(raw[8]);
  const is_in = Boolean(ep & 0x80);
  const has_setup = flag_setup === 0 && xtype === 2 && ev === 'S';
  if (ev === 'S') {
    // OUT data travels on submission; control submissions carry the setup packet.
    if (is_in && !has_setup) return null;
    if (xtype === 2 && has_setup && (setup[0] & 0x80)) {
      // control IN request: keep setup, data arrives on completion
      return new Transfer({ frame, ts, bus, device: dev, endpoint: ep | 0x80, xfer_type: xtype, setup, data: _EMPTY });
    }
    return new Transfer({ frame, ts, bus, device: dev, endpoint: ep & 0x7f, xfer_type: xtype, setup: has_setup ? setup : null, data: payload });
  }
  if (ev === 'C' && is_in && payload.length) {
    return new Transfer({ frame, ts, bus, device: dev, endpoint: ep, xfer_type: xtype, setup: null, data: payload });
  }
  return null;
}

// USBPcap header (27 bytes, little endian): headerLen H@0, irpId Q@2, status I@10, function H@14, info B@16,
// bus H@17, device H@19, endpoint B@21, transfer B@22, dataLength I@23
export function parse_usbpcap(frame, ts, raw) {
  const dv = _view(raw);
  const hlen = dv.getUint16(0, true);
  const info = raw[16];
  const bus = dv.getUint16(17, true);
  const dev = dv.getUint16(19, true);
  const ep = raw[21];
  const xtype = raw[22];
  const dlen = dv.getUint32(23, true);
  const completion = Boolean(info & 1);
  const is_in = Boolean(ep & 0x80);
  let payload = raw.subarray(hlen, hlen + dlen);
  if (xtype === 2) {
    const stage = raw.length > 27 ? raw[27] : 0;
    if (stage === 0) { // setup stage: 8-byte setup packet in payload
      const setup = payload.subarray(0, 8);
      payload = payload.subarray(8);
      if (completion) return null;
      if (setup.length && (setup[0] & 0x80)) {
        return new Transfer({ frame, ts, bus, device: dev, endpoint: ep | 0x80, xfer_type: xtype, setup, data: _EMPTY });
      }
      return new Transfer({ frame, ts, bus, device: dev, endpoint: ep & 0x7f, xfer_type: xtype, setup, data: payload });
    }
    if (stage === 1 || stage === 3) { // data stage, or USBPcap's "complete" record with the IN data
      if (is_in && completion && payload.length) {
        return new Transfer({ frame, ts, bus, device: dev, endpoint: ep | 0x80, xfer_type: xtype, setup: null, data: payload });
      }
      return null;
    }
    return null;
  }
  if (!is_in && !completion && payload.length) {
    return new Transfer({ frame, ts, bus, device: dev, endpoint: ep, xfer_type: xtype, setup: null, data: payload });
  }
  if (is_in && completion && payload.length) {
    return new Transfer({ frame, ts, bus, device: dev, endpoint: ep, xfer_type: xtype, setup: null, data: payload });
  }
  return null;
}

/** Transfers of a capture. `data` = bytes of a pcap/pcapng file (optionally gzip-compressed). */
export function read_transfers(data, info = null) {
  const out = [];
  let frames = 0;
  for (const [frame, ts, lt, raw] of iter_packets(data, info)) {
    frames = frame;
    let t = null;
    if (lt === LINUX_MMAPPED && raw.length >= 64) t = parse_usbmon(frame, ts, raw, 64);
    else if (lt === LINUX && raw.length >= 48) t = parse_usbmon(frame, ts, raw, 48);
    else if (lt === USBPCAP && raw.length >= 27) t = parse_usbpcap(frame, ts, raw);
    if (t !== null) out.push(t);
  }
  if (info) info.frames = frames;
  return out;
}

/** Find [VID, PID] per device address from GET_DESCRIPTOR(DEVICE) responses -> {device: [vid, pid]}. */
export function find_ids(transfers) {
  const ids = {};
  const pending = {};
  for (const t of transfers) {
    if (t.xfer_type !== 2) continue;
    if (t.setup && t.setup[1] === 6 && t.setup[3] === 1) {
      pending[t.device] = true;
    } else if (pending[t.device] && t.data.length >= 12 && t.data[1] === 1) {
      ids[t.device] = [t.data[8] | (t.data[9] << 8), t.data[10] | (t.data[11] << 8)];
      pending[t.device] = false;
    }
  }
  return ids;
}
