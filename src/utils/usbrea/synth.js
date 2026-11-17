// Port of usb_rea/synth.py: synthetic usbmon captures with known ground truth, for tests and demos
// (MIT, (c) 2026 Emir Mrkaljevic).
//
// Devices (VID 0x1234 / PID 0xABCD):
//   lamp: bulk/HID: AA <cmd> <arg> 00 <sum8>; brightness/power/hue (8-bit)
//   fan:  5A <seq> <cmd> <args> pad + CRC16/MODBUS; 16-bit BE RPM, RGB, lookup.
//   dial: A5 <cmd> <args> <sum8>; 32-bit LE position + 4-bit level bitfield
//   lcd:  screen on an AIO pump cap (brightness, optional JPEG/BMP/WebP/raw pixel streams)
// See make_capture for the options (the docstring of the Python original is kept there).
//
// Deviations from the Python module:
// - make_capture(options) / capture_from_messages(messages, vid, pid, ...) do not write files: they return
//   { capture: Uint8Array (a classic pcap, link type 220), markers: [...] } (markers = what Python wrote to
//   <path>.actions.json). A leading `path` argument is accepted and ignored for call-compatibility.
// - random.Random is reproduced bit for bit (Mersenne Twister, randrange/randint/uniform/choice/randbytes),
//   so the same seed gives the same capture as the Python tool.
import { concat, concatAll, writeInt } from './bytes.js';
import { compute } from './checksums.js';
import { split_label, split_values } from './model.js';
import { testcard as _testcard } from './streams.js';

export const VID = 0x1234;
export const PID = 0xABCD;
export const CMDS = { brightness: 0x01, power: 0x02, hue: 0x03 };

// ---------------------------------------------------------------------------------------------
// Python's random.Random (MT19937), enough of it for this module.

export class PyRandom {
  constructor(seed = 0) {
    this.mt = new Uint32Array(624);
    this.idx = 625;
    let n = BigInt(seed);
    if (n < 0n) n = -n;
    const key = [];
    while (n > 0n) { key.push(Number(n & 0xffffffffn)); n >>= 32n; }
    if (!key.length) key.push(0);
    this._init_by_array(key);
  }

  _init_genrand(s) {
    const mt = this.mt;
    mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = (Math.imul(1812433253, p) + i) >>> 0;
    }
    this.idx = 624;
  }

  _init_by_array(key) {
    const mt = this.mt;
    this._init_genrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const p = mt[i - 1] ^ (mt[i - 1] >>> 30);
      mt[i] = ((mt[i] ^ Math.imul(p, 1566083941)) - i) >>> 0;
      i++;
      if (i >= 624) { mt[0] = mt[623]; i = 1; }
    }
    mt[0] = 0x80000000;
    this.idx = 624;
  }

  _u32() {
    const mt = this.mt;
    if (this.idx >= 624) {
      let kk = 0;
      let y;
      for (; kk < 624 - 397; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      for (; kk < 623; kk++) {
        y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff);
        mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      }
      y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff);
      mt[623] = mt[396] ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
      this.idx = 0;
    }
    let y = mt[this.idx++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  random() {
    const a = this._u32() >>> 5;
    const b = this._u32() >>> 6;
    return (a * 67108864.0 + b) * (1.0 / 9007199254740992.0);
  }

  getrandbits(k) {
    if (k <= 0) return 0;
    if (k <= 32) return this._u32() >>> (32 - k);
    throw new Error('getrandbits > 32 not needed');
  }

  _randbelow(n) {
    if (!n) return 0;
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  randrange(start, stop) {
    return start + this._randbelow(stop - start);
  }

  randint(a, b) { return this.randrange(a, b + 1); }

  uniform(a, b) { return a + (b - a) * this.random(); }

  choice(seq) { return seq[this._randbelow(seq.length)]; }

  /** Python 3.9+ randbytes(n): getrandbits(8n) little endian. */
  randbytes(n) {
    const out = new Uint8Array(n);
    for (let w = 0; w * 4 < n; w++) {
      let r = this._u32();
      const rem = n - w * 4;
      if (rem < 4) r >>>= (32 - rem * 8);
      for (let i = 0; i < Math.min(4, rem); i++) out[w * 4 + i] = (r >>> (8 * i)) & 0xff;
    }
    return out;
  }
}

/** Python round() on floats: round half to even. */
export function _round(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

// ---------------------------------------------------------------------------------------------
// small byte helpers

const _b = (...a) => Uint8Array.from(a);
const _int = (v, width, endian = 'little') => { const d = new Uint8Array(width); writeInt(d, 0, width, v, endian); return d; };
function _ljust(b, n) {
  if (b.length >= n) return b;
  const o = new Uint8Array(n);
  o.set(b);
  return o;
}
const _sum8 = (b) => { let s = 0; for (const c of b) s += c; return s & 0xff; };
const _hexb = (s) => Uint8Array.from(s.trim().split(/\s+/).map((h) => parseInt(h, 16)));
const _crc_le = (body) => _int(compute('crc16_modbus', body), 2, 'little');
const _tr = (v) => Math.trunc(v);

export function encode(name, value) {
  const cmd = CMDS[name];
  let arg;
  if (name === 'brightness') arg = _round(value * 255 / 100);
  else if (name === 'hue') arg = Math.floor(_tr(value) / 2);
  else arg = _tr(value);
  const body = _b(0xAA, cmd, arg & 0xFF, 0x00);
  return concat(body, _b(_sum8(body)));
}

export class UsbmonWriter {
  constructor(bus = 1, dev = 5) {
    this.pkts = []; // [ts, Uint8Array]
    this.bus = bus;
    this.dev = dev;
    this._id = 0x1000;
  }

  _pkt(ts, ev, xtype, ep, data = new Uint8Array(0), setup = null, length = null, urb = 0n) {
    const sec = Math.trunc(ts);
    const usec = _round((ts - sec) * 1e6);
    // usbmon: data flag 0 = data present, '<' = IN submit / '>' = OUT completion (nothing attached)
    const flag = data.length ? 0x00 : (ev === 'S' ? 0x3c : 0x3e);
    const hdr = new Uint8Array(64);
    const dv = new DataView(hdr.buffer);
    dv.setBigUint64(0, BigInt.asUintN(64, urb), true);
    hdr[8] = ev.charCodeAt(0);
    hdr[9] = xtype;
    hdr[10] = ep;
    hdr[11] = this.dev;
    dv.setUint16(12, this.bus, true);
    hdr[14] = setup !== null ? 0x00 : 0x2d; // '-'
    hdr[15] = flag;
    dv.setBigInt64(16, BigInt(sec), true);
    dv.setInt32(24, usec, true);
    dv.setInt32(28, ev === 'S' ? -115 : 0, true);
    dv.setUint32(32, length === null ? data.length : length, true);
    dv.setUint32(36, data.length, true);
    if (setup) hdr.set(setup.subarray(0, 8), 40);
    this.pkts.push([ts, concat(hdr, data)]);
  }

  _urb() {
    // submission and completion share one URB id, as in real usbmon (Wireshark pairs them by it)
    this._id += 1;
    return 0xFFFF888000000000n | (BigInt(this._id) << 8n);
  }

  out(ts, ep, data, xtype = 3) {
    const u = this._urb();
    this._pkt(ts, 'S', xtype, ep & 0x7F, data, null, null, u);
    this._pkt(ts + 0.0001, 'C', xtype, ep & 0x7F, new Uint8Array(0), null, data.length, u);
  }

  in_(ts, ep, data, xtype = 1) {
    const u = this._urb();
    this._pkt(ts, 'S', xtype, ep | 0x80, new Uint8Array(0), null, 64, u);
    this._pkt(ts + 0.0002, 'C', xtype, ep | 0x80, data, null, null, u);
  }

  control_out(ts, setup, data) {
    const u = this._urb();
    this._pkt(ts, 'S', 2, 0x00, data, setup, null, u);
    this._pkt(ts + 0.0001, 'C', 2, 0x00, new Uint8Array(0), null, data.length, u);
  }

  control_in(ts, setup, data) {
    const u = this._urb();
    this._pkt(ts, 'S', 2, 0x80, new Uint8Array(0), setup, setup[6] | (setup[7] << 8), u);
    this._pkt(ts + 0.0002, 'C', 2, 0x80, data, null, null, u);
  }

  /** The capture as a classic pcap file (link type 220), packets sorted by time (stable). */
  to_bytes() {
    const sorted = this.pkts.slice().sort((a, b) => a[0] - b[0]);
    const parts = [];
    const gh = new Uint8Array(24);
    const gv = new DataView(gh.buffer);
    gv.setUint32(0, 0xA1B2C3D4, true);
    gv.setUint16(4, 2, true);
    gv.setUint16(6, 4, true);
    gv.setInt32(8, 0, true);
    gv.setUint32(12, 0, true);
    gv.setUint32(16, 65535, true);
    gv.setUint32(20, 220, true);
    parts.push(gh);
    for (const [ts, raw] of sorted) {
      const sec = Math.trunc(ts);
      const usec = _round((ts - sec) * 1e6);
      const rh = new Uint8Array(16);
      const rv = new DataView(rh.buffer);
      rv.setUint32(0, sec, true);
      rv.setUint32(4, usec, true);
      rv.setUint32(8, raw.length, true);
      rv.setUint32(12, raw.length, true);
      parts.push(rh, raw);
    }
    return concatAll(parts);
  }

  /** Python wrote this to a path; here it returns the bytes. */
  save() { return this.to_bytes(); }
}

export function device_descriptor() {
  // "<BBHBBBBHHHBBBB": 18, 1, bcdUSB 0x0200, 0, 0, 0, 64, VID, PID, bcdDevice 0x0100, 1, 2, 0, 1
  return concat(_b(18, 1), _int(0x0200, 2), _b(0, 0, 0, 64), _int(VID, 2), _int(PID, 2), _int(0x0100, 2), _b(1, 2, 0, 1));
}

// Vendor-defined HID interface for the lamp when it talks over SET_REPORT:
// 5-byte output report (the command) and 3-byte input report (the ACK), no report IDs.
export const LAMP_HID_DESCRIPTOR = _hexb(
  '06 00 ff 09 01 a1 01 15 00 26 ff 00 75 08'
  + ' 95 05 09 02 91 02'
  + ' 95 03 09 03 81 02 c0');

export const FAN_MODES = { 1: 0x11, 2: 0x22, 3: 0x47 };
export const FAN_MODE_NAMES = { 0x00: 'auto', 0x11: 'silent', 0x22: 'balanced', 0x47: 'turbo' }; // what the vendor app shows
export const FAN_ACTIONS = ['fan 800', 'fan 1200', 'fan 2650', 'fan 4000', 'color 255 0 0', 'color 0 128 255',
  'color 10 20 30', 'mode 1', 'mode 2', 'mode 3'];

// states=True: the fan only takes a color in mode 3 (its custom lighting mode), so the vendor app only
// ever sends color after mode 3; fan speed works in every mode
export const FAN_STATE_ACTIONS = ['mode 1', 'fan 800', 'fan 1200', 'mode 3', 'color 255 0 0', 'color 0 128 255',
  'mode 2', 'fan 2650', 'fan 4000', 'mode 3', 'color 10 20 30'];

// reported=True: the mode is changed on the fan itself ('press mode N', no host traffic) or by the app
// ('mode N'); the app reads the mode from the status reply and only sends a color while it says turbo
export const FAN_REPORTED_ACTIONS = ['fan 800', 'press mode 3', 'color 255 0 0', 'color 0 128 255', 'press mode 1',
  'fan 1200', 'mode 2', 'fan 2650', 'mode 3', 'color 10 20 30', 'mode 1',
  'fan 4000'];

// switch=True: the app switches to mode 3 inside every color action and back to the mode before
export const FAN_SWITCH_ACTIONS = ['mode 1', 'fan 800', 'color 255 0 0', 'mode 3', 'fan 1200', 'mode 2',
  'color 0 128 255', 'fan 2650', 'color 10 20 30', 'mode 1', 'color 40 50 60', 'fan 4000'];

/** Fake fan controller: 5A <seq> <cmd> <args...> pad to 6, then CRC16/MODBUS little-endian. */
export function encode_fan(name, values, seq) {
  let args;
  let cmd;
  if (name === 'fan') {
    args = _int(_tr(values[0]), 2, 'big');
    cmd = 0x10;
  } else if (name === 'color') {
    args = Uint8Array.from(values.map((v) => _tr(v)));
    cmd = 0x20;
  } else {
    args = _b(FAN_MODES[_tr(values[0])]);
    cmd = 0x30;
  }
  const body = _ljust(concat(_b(0x5A, seq & 0xFF, cmd), args), 6);
  return concat(body, _crc_le(body));
}

/** Fan "get status": 5A 00 40, pad, CRC16/MODBUS (no sequence number). */
export function fan_status_query() {
  const body = _b(0x5A, 0x00, 0x40, 0, 0, 0);
  return concat(body, _crc_le(body));
}

/** Fan ACK: A5 <cmd> <seq echo> <arg u16 LE> <sum8>; arg = set RPM for 'fan', mode byte for 'mode'. */
export function fan_reply(msg, values) {
  const cmd = msg[2];
  const arg = cmd === 0x10 ? _tr(values[0]) : cmd === 0x30 ? msg[3] : 0;
  const body = concat(_b(0xA5, cmd, msg[1]), _int(arg, 2, 'little'));
  return concat(body, _b(_sum8(body)));
}

export function fan_status(rpm, temp, mode = 0x00) {
  const body = concat(_b(0xA5, 0x40), _int(rpm, 2, 'little'), _b(temp, mode));
  return concat(body, _b(_sum8(body)));
}

/** Fan session setup as [request, reply] pairs, requests framed like commands (5A 00 <cmd> ... CRC16):
 * hello 01 -> A5 01 <4-byte session token> <sum8>; auth 02 <token> -> A5 02 <status> <sum8>;
 * start 03 01 -> A5 03 01 <sum8>. Status 01 is ready; with status 02 (needs calibration) the app
 * sends calibrate 04 01 -> A5 04 01 <sum8> before start. */
export function fan_handshake(token, status = 0x01) {
  const req = (body) => {
    const b = _ljust(concat(_b(0x5A, 0x00), body), 6);
    return concat(b, _crc_le(b));
  };
  const rep = (body) => {
    const b = concat(_b(0xA5), body);
    return concat(b, _b(_sum8(b)));
  };
  const steps = [
    [req(_b(0x01)), rep(concat(_b(0x01), token))],
    [req(concat(_b(0x02), token)), rep(_b(0x02, status))],
  ];
  if (status === 0x02) steps.push([req(_b(0x04, 0x01)), rep(_b(0x04, 0x01))]);
  steps.push([req(_b(0x03, 0x01)), rep(_b(0x03, 0x01))]);
  return steps;
}

export const LCD_ACTIONS = ['brightness 0', 'brightness 50', 'brightness 100', 'brightness 25', 'brightness 75'];

export function encode_lcd(values) {
  return _ljust(_b(0x12, 0x01, 0x00, 0x80, _tr(values[0])), 64);
}

/** A JPEG-shaped image: SOI, JFIF APP0, SOF0 with the size, scan data without FF bytes, EOI.
 * Not decodable, but every marker the stream detector looks at is where a real encoder puts it. */
export function fake_jpeg(n, size = 240, seed = 0) {
  const rnd = new PyRandom(seed);
  const app0 = _hexb('ff e0 00 10 4a 46 49 46 00 01 01 00 00 01 00 01 00 00');
  const sof = concat(_hexb('ff c0 00 11 08'), _int(size, 2, 'big'), _int(size, 2, 'big'),
    _hexb('03 01 22 00 02 11 01 03 11 01'));
  const sos = _hexb('ff da 00 0c 03 01 00 02 11 03 11 00 3f 00');
  const head = concat(_b(0xff, 0xd8), app0, sof, sos);
  const body = new Uint8Array(Math.max(0, n - head.length - 2));
  for (let i = 0; i < body.length; i++) body[i] = rnd.randrange(0, 255);
  return concat(head, body, _b(0xff, 0xd9));
}

/** A BMP-shaped image: BITMAPFILEHEADER + BITMAPINFOHEADER + pixel bytes.
 * bfSize matches the returned length; biWidth/biHeight are `size` (negative height if top_down).
 * Not a full photo, but every field the stream detector reads is where a real encoder puts it. */
export function fake_bmp(n, size = 64, seed = 0, top_down = false) {
  const rnd = new PyRandom(seed);
  const bf_off = 54;
  n = Math.max(n, bf_off + 4);
  const height = top_down ? -size : size;
  const body = new Uint8Array(n - bf_off);
  for (let i = 0; i < body.length; i++) body[i] = rnd.randrange(0, 256);
  const hdr = concat(ascii2('BM'), _int(n, 4), _int(0, 2), _int(0, 2), _int(bf_off, 4));
  const info = concat(_int(40, 4), _int(size, 4), _int(height, 4), _int(1, 2), _int(24, 2), _int(0, 4),
    _int(body.length, 4), _int(2835, 4), _int(2835, 4), _int(0, 4), _int(0, 4));
  return concat(hdr, info, body);
}

function ascii2(s) { return Uint8Array.from(s, (c) => c.charCodeAt(0)); }

/** A WebP-shaped image: RIFF/WEBP + VP8X canvas size + pad bytes.
 * The RIFF chunk size matches the returned length; VP8X holds width/height as (size - 1).
 * Not decodable, but every field the stream detector reads is where a real encoder puts it. */
export function fake_webp(n, size = 64, seed = 0) {
  const rnd = new PyRandom(seed);
  let vp8x = concat(ascii2('VP8X'), _int(10, 4));
  vp8x = concat(vp8x, new Uint8Array(4)); // flags + reserved
  vp8x = concat(vp8x, _int(size - 1, 3), _int(size - 1, 3));
  n = Math.max(n, 30 + 4);
  const body = new Uint8Array(n - 30);
  for (let i = 0; i < body.length; i++) body[i] = rnd.randrange(0, 256);
  return concat(ascii2('RIFF'), _int(n - 8, 4), ascii2('WEBP'), vp8x, body);
}

/** Packets for one frame: header 08 <count> 00 80, then 08 <index> 00 00; last one padded. */
export function lcd_frames(image, chunk = 512) {
  const room = chunk - 4;
  const parts = [];
  for (let i = 0; i < image.length; i += room) parts.push(image.subarray(i, i + room));
  return parts.map((p, k) => _ljust(concat(_b(0x08, k === 0 ? parts.length : k, 0x00, k === 0 ? 0x80 : 0x00), p), chunk));
}

/** A smooth test picture (red across, green down, shifted by n) as RGB565 or RGB888 pixels. */
export function gradient(w, h, n = 0, bpp = 2, order = 'little') {
  const out = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = (Math.floor(x * 255 / Math.max(1, w - 1)) + 4 * n) & 0xFF;
      const g = Math.floor(y * 255 / Math.max(1, h - 1));
      const b = 0x60;
      if (bpp === 3) {
        out.push(r, g, b);
      } else {
        const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
        if (order === 'big') out.push(v >> 8, v & 0xff); else out.push(v & 0xff, v >> 8);
      }
    }
  }
  return Uint8Array.from(out);
}

/** The usb-rea test card as a screen with this channel order would take it (RGB565 or RGB888). */
export function encode_testcard(w, h, bpp, order = 'rgb', endian = 'little') {
  const rgb = _testcard(w, h);
  const out = [];
  for (let i = 0; i < rgb.length; i += 3) {
    let r; let g; let b;
    if (order === 'rgb') [r, g, b] = [rgb[i], rgb[i + 1], rgb[i + 2]];
    else [r, g, b] = [rgb[i + 2], rgb[i + 1], rgb[i]];
    if (bpp === 3) {
      out.push(r, g, b);
    } else {
      const v = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
      if (endian === 'big') out.push(v >> 8, v & 0xff); else out.push(v & 0xff, v >> 8);
    }
  }
  return Uint8Array.from(out);
}

/** Synthetic raw LCD 'draw' command: 55 AA 02 00, then x, y, width, height as u16 LE. */
export function raw_header(x, y, w, h) {
  return concat(_b(0x55, 0xaa, 0x02, 0x00), ...[x, y, w, h].map((v) => _int(v, 2, 'little')));
}

/** RGB888 frame cut into packets behind a 4-byte header: packet index and count as u16 LE. */
export function raw888_packets(pixels, chunk = 64) {
  const room = chunk - 4;
  const parts = [];
  for (let i = 0; i < pixels.length; i += room) parts.push(pixels.subarray(i, i + room));
  return parts.map((p, k) => concat(_int(k, 2, 'little'), _int(parts.length, 2, 'little'), p));
}

export const DIAL_ACTIONS = [
  // values chosen so each of the 4 LE bytes varies (required to claim u32 over four u8s)
  'position 0', 'position 1000', 'position 50000', 'position 16843009', 'position 2309737967',
  'level 0', 'level 3', 'level 7', 'level 10', 'level 15',
];

/** Fake dial: A5 <cmd> <args...> <sum8>.
 * cmd 0x01 position: 32-bit LE absolute position (bytes 2..5)
 * cmd 0x02 level:    brightness 0..15 in bits 0..3 of byte 2; high nibble fixed 0xB */
export function encode_dial(name, values) {
  let body;
  if (name === 'position') {
    body = concat(_b(0xA5, 0x01), _int(_tr(values[0]), 4, 'little'));
  } else {
    // high nibble 0xB (const), low nibble = level
    body = _b(0xA5, 0x02, 0xB0 | (_tr(values[0]) & 0x0F), 0x00);
  }
  return concat(body, _b(_sum8(body)));
}

/** Endpoint of each of a frame's n packets (the first one is the draw command when `command`). */
export function _stream_endpoints(how, n, data, command) {
  const rep = (v, c) => Array.from({ length: c }, () => v);
  if (how === null || how === undefined) return rep(data[0], n);
  if (how === 'command') return [0x01, ...rep(data[0], n - 1)];
  const [head, m] = command ? [[data[0]], n - 1] : [[], n];
  if (how === 'alternate') return head.concat(Array.from({ length: m }, (_, k) => data[k % 2]));
  return head.concat(Array.from({ length: m }, (_, k) => data[Math.floor(k * 2 / m)]));
}

const _SETREPORT = (len) => _b(0x21, 0x09, 0x00, 0x02, 0, 0, len, 0);
const _T0 = 1_760_000_000.0;

/** Build a synthetic capture. Returns { capture: Uint8Array (pcap), markers: [{label, start, end}] }.
 *
 * Options (all optional, same names and meaning as the Python keyword arguments):
 * actions, transport ('bulk' | 'control'), noise, seed, device ('lamp' | 'fan' | 'dial' | 'lcd'), poll,
 * poll_seq, observe, handshake, reopen, branch, states, image_stream, fps, raw ('rgb565' | 'rgb888'),
 * testcard ('rgb' | 'bgr'), endpoints ('alternate' | 'blocks' | 'command'), reported, switch, inline, bmp, webp.
 *
 * poll: if > 0, the "vendor app" also sends a status request every `poll` seconds on the
 * command channel, whatever the user is doing, like most real control panels. The lamp answers
 * 55 10 00; the fan answers with its current RPM (follows the last 'fan N' setting, +-12 jitter)
 * and a slowly drifting temperature, so tests have ground truth for decoded replies.
 * poll_seq: the lamp's status request carries a sequence byte (and so a changing checksum),
 * which the reply echoes.
 * observe: (fan with poll) every 5th status reply is also noted as an observation marker
 * 'seen rpm N temp T mode M', 60 ms after the reply, as if the user read the vendor app's screen;
 * the status reply then also carries the current mode byte (see FAN_MODE_NAMES), and the first
 * reply after a mode change is noted as 'seen mode M'.
 * reopen: (fan with handshake) halfway through, the app opens the session again (as after the
 * device slept) with a new session token, between two actions.
 * branch: (fan with handshake) the app opens the session again twice more, a third and two thirds of
 * the way through: the first time the fan answers auth with status 02 (needs calibration) and the
 * app sends a calibrate step before start, the second time it answers 01 (ready) as at first.
 * states: (fan) use FAN_STATE_ACTIONS, where color is only ever sent after 'mode 3' while fan
 * speed is set in modes 1 and 2, so color gets a state precondition.
 * reported: (fan) use FAN_REPORTED_ACTIONS: the user changes the mode with the fan's own button
 * ('press mode N' labels make no traffic and no marker) and the app only sends a color while the
 * fan's status reply says turbo; it also sets mode 2 and 3 itself. Implies poll=0.25 (unless set)
 * and observe=True, so the mode byte of the status reply is named.
 * switch: (fan) use FAN_SWITCH_ACTIONS: every color action is sent as mode 3, the color, then the
 * mode the app was in before (1 or 2), all inside the one action, each packet with its own reply.
 * image_stream: (lcd) the vendor app streams a JPEG video to the screen at `fps` frames per second
 * for the whole capture (frames of 1.5 to 4 KB, so 3 to 8 packets each, the first one cut off by
 * the start of the capture), with an ack from the device after each frame.
 * bmp / webp: (lcd with image_stream, not raw) stream 64x64 BMP / WebP frames instead of JPEG.
 * testcard: (raw streams) 'rgb' or 'bgr': frames 4 to 11 (but not the clock redraws) show the
 * usb-rea test card encoded in that channel order, as when the user put it on the screen.
 * raw: (lcd with image_stream) stream raw pixels instead of JPEG on bulk EP 0x02. 'rgb565': a
 * 160x128 screen at 10 fps, each frame a 12-byte draw command (55 AA 02 00, x, y, width, height as
 * u16 LE) then RGB565 LE pixels in 512-byte packets; every 4th frame only redraws a 48x16 clock at
 * (100, 8); ack 55 AA 82 00 on EP 0x82. 'rgb888': a 128x160 screen at 5 fps with no command, 64-byte
 * packets each starting with the packet index and count as u16 LE (1024 packets a frame).
 * inline: (rgb565) the draw command has no packet of its own: it is the first 12 bytes of the
 * frame's first 512-byte packet and the pixels follow right after it.
 * endpoints: (image streams) spread each frame over more than one host->device endpoint.
 * device: 'lamp' (see module doc), 'fan' (counter + 16-bit BE + RGB + lookup + CRC16),
 * 'dial' (32-bit LE position + 4-bit brightness bitfield + sum8) or 'lcd' (brightness, image stream). */
export function make_capture(...args) {
  if (args.length > 1 || typeof args[0] === 'string') args.shift(); // leading path (ignored)
  const o = args[0] || {};
  let { actions = null, transport = 'bulk', noise = true, seed = 0, device = 'lamp', poll = 0.0, poll_seq = false,
    observe = false, handshake = false, reopen = false, branch = false, states = false, image_stream = false,
    fps = 20.0, raw = null, testcard = null, endpoints = null, reported = false, switch: switch_ = false,
    inline = false, bmp = false, webp = false } = o;
  raw = raw || null;
  testcard = testcard || null;
  endpoints = endpoints || null;
  const rnd = new PyRandom(seed);
  if ((states || reported || switch_) && device !== 'fan') throw new Error('only the synthetic fan has state-dependent commands');
  if ([states, reported, switch_].filter(Boolean).length > 1) throw new Error('states, reported and switch are separate scenarios; pick one');
  if (reported) { poll = poll || 0.25; observe = true; }
  if (image_stream && device !== 'lcd') throw new Error('only the synthetic lcd streams images');
  if (bmp && (!image_stream || raw)) throw new Error('bmp needs image_stream=True and no raw pixels');
  if (webp && (!image_stream || raw)) throw new Error('webp needs image_stream=True and no raw pixels');
  if (bmp && webp) throw new Error('bmp and webp are separate formats; pick one');
  if ((raw !== null && raw !== 'rgb565' && raw !== 'rgb888') || (raw && !image_stream)) {
    throw new Error("raw is 'rgb565' or 'rgb888' and needs image_stream=True");
  }
  if ((testcard !== null && testcard !== 'rgb' && testcard !== 'bgr') || (testcard && !raw)) {
    throw new Error("testcard is 'rgb' or 'bgr' and needs a raw stream");
  }
  if ((endpoints !== null && !['alternate', 'blocks', 'command'].includes(endpoints)) || (endpoints && !image_stream)
      || (endpoints === 'command' && raw !== 'rgb565')) {
    throw new Error("endpoints is 'alternate', 'blocks' or 'command' (rgb565 only) and needs image_stream=True");
  }
  if (inline && (raw !== 'rgb565' || endpoints)) throw new Error("inline needs raw='rgb565' on one endpoint");
  if (device === 'fan') {
    actions = actions || (states ? FAN_STATE_ACTIONS : reported ? FAN_REPORTED_ACTIONS : switch_ ? FAN_SWITCH_ACTIONS : FAN_ACTIONS);
  } else if (device === 'dial') {
    actions = actions || DIAL_ACTIONS;
  } else if (device === 'lcd') {
    actions = actions || LCD_ACTIONS;
  }
  actions = actions || ['brightness 0%', 'brightness 25%', 'brightness 50%', 'brightness 75%',
    'brightness 100%', 'power off', 'power on', 'hue 0', 'hue 120', 'hue 240'];
  const w = new UsbmonWriter();
  let t = _T0;
  w.control_in(t, _b(0x80, 6, 0, 1, 0, 0, 18, 0), device_descriptor());
  if (transport === 'control') {
    w.control_in(t + 0.01, _b(0x81, 6, 0, 0x22, 0, 0, LAMP_HID_DESCRIPTOR.length, 0), LAMP_HID_DESCRIPTOR);
  }
  if ((handshake || reopen || branch) && device !== 'fan') throw new Error('only the synthetic fan does a handshake');

  const open_session = (at0, token, status = 0x01) => {
    fan_handshake(token, status).forEach(([req, rep], i) => {
      const at = at0 + 0.01 * i;
      if (transport === 'control') w.control_out(at, _SETREPORT(req.length), req);
      else w.out(at, 0x01, req);
      w.in_(at + 0.003, 0x81, rep);
    });
  };
  if (handshake) open_session(t + 0.012, new PyRandom(seed + 7).randbytes(4));
  t += 0.5;
  const marks = [];
  let seq = 0x40;
  const targets = [[0.0, 1000]]; // fan: (time, set RPM), for the status replies
  const modes = [[0.0, 0x00]]; // fan: (time, mode byte), reported in the status replies with observe
  let current = null; // fan: the last 'mode N' the app sent (switch=True restores it)
  for (let n_act = 0; n_act < actions.length; n_act++) {
    const label = actions[n_act];
    if (reopen && handshake && n_act === Math.floor(actions.length / 2)) {
      open_session(t - 0.4, new PyRandom(seed + 8).randbytes(4));
    }
    if (branch && handshake && (n_act === Math.floor(actions.length / 3) || n_act === Math.floor(2 * actions.length / 3))) {
      const first = n_act === Math.floor(actions.length / 3);
      open_session(t - 0.3, new PyRandom(seed + (first ? 9 : 10)).randbytes(4), first ? 0x02 : 0x01);
    }
    const start = t;
    if (noise) {
      const cnt = rnd.randint(1, 3);
      for (let i = 0; i < cnt; i++) w.in_(t + rnd.random() * 0.2, 0x81, new Uint8Array(4));
    }
    let [name, values] = split_values(label);
    if (device === 'fan' && name === 'press mode') {
      // the user pressed the mode button on the fan itself: no host traffic and no marker,
      // only the status replies show the new mode
      modes.push([t, FAN_MODES[_tr(values[0])]]);
      t += 0.5;
      continue;
    }
    const wrap = device === 'fan' && switch_ && name === 'color' && (current === 1 || current === 2);
    let msg;
    let msgs = null;
    if (device === 'fan') {
      seq += 1;
      if (wrap) { // the app switches to mode 3 just for the color, then back to the mode it was in
        msgs = [encode_fan('mode', [3], seq), encode_fan(name, values, seq + 1), encode_fan('mode', [current], seq + 2)];
        seq += 2;
      }
      msg = encode_fan(name, values, seq);
      if (name === 'mode') current = _tr(values[0]);
    } else if (device === 'dial') {
      msg = encode_dial(name, values);
    } else if (device === 'lcd') {
      msg = encode_lcd(split_values(label)[1]);
    } else {
      const [nm, value] = split_label(label);
      msg = encode(nm, value !== null ? value : 0);
    }
    if (wrap) {
      msgs.forEach((m, k) => {
        const at = t + 0.3 + 0.03 * k;
        if (transport === 'control') w.control_out(at, _SETREPORT(m.length), m);
        else w.out(at, 0x01, m);
        w.in_(at + 0.01, 0x81, fan_reply(m, m[2] === 0x20 ? values : [0]));
        if (m[2] === 0x30) modes.push([at, m[3]]);
      });
    } else if (device === 'lcd') {
      w.out(t + 0.3, 0x01, msg, 1);
    } else if (transport === 'control') {
      // HID SET_REPORT, output report 0
      w.control_out(t + 0.3, _SETREPORT(msg.length), msg);
    } else {
      w.out(t + 0.3, 0x01, msg);
    }
    if (wrap) {
      // nothing more: replies were written above
    } else if (device === 'fan') {
      w.in_(t + 0.31, 0x81, fan_reply(msg, split_values(label)[1]));
      if (msg[2] === 0x10) targets.push([t + 0.3, _tr(split_values(label)[1][0])]);
      else if (msg[2] === 0x30) modes.push([t + 0.3, msg[3]]);
    } else if (device !== 'lcd') {
      w.in_(t + 0.31, 0x81, _b(0x55, msg[1], 0x00));
    }
    t += 1.0;
    marks.push({ label, start, end: t - 0.01 });
    t += 0.5;
  }
  if (poll > 0) {
    let status = _b(0xAA, 0x10, 0x00, 0x00, 0xBA); // "get status", same shape as a command
    let reply = _b(0x55, 0x10, 0x00);
    let sensor = null;
    let temp = 38;
    let shown = 0x00;
    if (device === 'fan') {
      status = fan_status_query();
      sensor = new PyRandom(seed + 1);
    }
    let tp = _T0 + 0.05;
    let n = 0;
    const last = (lst, at) => { let v = null; for (const [ts_, r] of lst) if (ts_ <= at) v = r; return v; };
    while (tp < t) {
      if (poll_seq && device !== 'fan') {
        const body = _b(0xAA, 0x10, n & 0xFF, 0x00);
        status = concat(body, _b(_sum8(body)));
        reply = _b(0x55, 0x10, n & 0xFF);
        n += 1;
      }
      const at = tp + rnd.uniform(-0.02, 0.02) * poll;
      if (device === 'fan') {
        const target = last(targets, at);
        temp = Math.min(45, Math.max(35, temp + sensor.choice([-1, 0, 0, 1])));
        const rpm = target + sensor.randint(-12, 12);
        const mode = observe ? last(modes, at) : 0x00;
        reply = fan_status(rpm, temp, mode);
        if (observe && n % 5 === 2) {
          marks.push({ label: `seen rpm ${rpm} temp ${temp} mode ${FAN_MODE_NAMES[mode]}`, start: at + 0.07, end: at + 0.07 });
        } else if (observe && mode !== shown) { // the user glances at the app after switching modes
          marks.push({ label: `seen mode ${FAN_MODE_NAMES[mode]}`, start: at + 0.07, end: at + 0.07 });
        }
        shown = mode;
        n += 1;
      }
      if (transport === 'control') w.control_out(at, _SETREPORT(status.length), status);
      else w.out(at, 0x01, status);
      w.in_(at + 0.01, 0x81, reply);
      tp += poll;
    }
  }
  if (image_stream && raw) {
    let tf = _T0 + 0.02;
    let n = 0;
    fps = raw === 'rgb565' ? 10.0 : 5.0;
    while (tf < t) {
      const card = testcard && n >= 4 && n < 12 && n % 4 !== 3; // the user showed the test card for a while
      let pkts;
      if (raw === 'rgb565') {
        const [x, y, wd, ht] = n % 4 === 3 ? [100, 8, 48, 16] : [0, 0, 160, 128];
        const pix = card ? encode_testcard(160, 128, 2, testcard) : gradient(wd, ht, n);
        if (inline) {
          const data = concat(raw_header(x, y, wd, ht), pix);
          pkts = [];
          for (let i = 0; i < data.length; i += 512) pkts.push(data.subarray(i, i + 512));
        } else {
          pkts = [raw_header(x, y, wd, ht)];
          for (let i = 0; i < pix.length; i += 512) pkts.push(pix.subarray(i, i + 512));
        }
      } else {
        pkts = raw888_packets(card ? encode_testcard(128, 160, 3, testcard) : gradient(128, 160, n, 3));
      }
      let eps = _stream_endpoints(endpoints, pkts.length, [0x02, 0x04], raw === 'rgb565');
      let xtypes = eps.map((ep) => (ep === 0x01 ? 1 : 3));
      if (n === 0) { // the capture started in the middle of a frame
        pkts = pkts.slice(3); eps = eps.slice(3); xtypes = xtypes.slice(3);
      }
      const step = raw === 'rgb565' ? 0.0004 : 0.0001;
      pkts.forEach((pkt, k) => w.out(tf + step * k, eps[k], pkt, xtypes[k]));
      if (raw === 'rgb565') w.in_(tf + step * pkts.length + 0.001, 0x82, _b(0x55, 0xaa, 0x82, 0x00));
      tf += 1 / fps;
      n += 1;
    }
  } else if (image_stream) {
    const video = new PyRandom(seed + 2);
    let tf = _T0 + 0.02;
    let n = 0;
    while (tf < t) {
      let img;
      if (bmp) img = fake_bmp(video.randint(1500, 4000), 64, seed * 1000 + n);
      else if (webp) img = fake_webp(video.randint(1500, 4000), 64, seed * 1000 + n);
      else img = fake_jpeg(video.randint(1500, 4000), 240, seed * 1000 + n);
      let pkts = lcd_frames(img);
      let eps = _stream_endpoints(endpoints, pkts.length, [0x03, 0x05], false);
      if (n === 0) { // the capture started in the middle of a frame
        pkts = pkts.slice(2); eps = eps.slice(2);
      }
      pkts.forEach((pkt, k) => w.out(tf + 0.001 * k, eps[k], pkt, 1));
      w.in_(tf + 0.001 * pkts.length + 0.001, 0x84, concat(_b(0x08, 0x81), new Uint8Array(14)));
      tf += 1 / fps;
      n += 1;
    }
  }
  return { capture: w.to_bytes(), markers: marks };
}

/** Build a usbmon capture from explicit host->device messages. Returns { capture, markers } like make_capture.
 *
 * messages: list of [label, data, how] where data is a Uint8Array or an Array of Uint8Array (multi-packet)
 * and how is ['bulk' | 'interrupt', endpoint] or ['control', 8-byte setup]. Used to replay protocols
 * documented by other projects. A leading `path` argument is accepted and ignored. */
export function capture_from_messages(...args) {
  if (!Array.isArray(args[0])) args.shift(); // leading path (ignored)
  const [messages, vid, pid, noise = true, seed = 0] = args;
  const rnd = new PyRandom(seed);
  const w = new UsbmonWriter();
  let t = _T0;
  const desc = Uint8Array.from(device_descriptor());
  desc.set(concat(_int(vid, 2), _int(pid, 2)), 8);
  w.control_in(t, _b(0x80, 6, 0, 1, 0, 0, 18, 0), desc);
  t += 0.5;
  const marks = [];
  for (const [label, data, how] of messages) {
    const start = t;
    if (noise) {
      const cnt = rnd.randint(0, 2);
      for (let i = 0; i < cnt; i++) w.in_(t + rnd.random() * 0.2, 0x81, new Uint8Array(8));
    }
    (Array.isArray(data) ? data : [data]).forEach((pkt, i) => { // list = multi-packet
      if (how[0] === 'control') w.control_out(t + 0.3 + 0.02 * i, how[1], pkt);
      else w.out(t + 0.3 + 0.02 * i, how[1], pkt, how[0] === 'interrupt' ? 1 : 3);
    });
    t += 1.0;
    marks.push({ label, start, end: t - 0.01 });
    t += 0.5;
  }
  return { capture: w.to_bytes(), markers: marks };
}
