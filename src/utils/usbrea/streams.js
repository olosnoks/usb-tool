// Continuous image streams (pictures or video for an LCD) kept apart from commands.
// Port of usb-rea src/usb_rea/streams.py (MIT, (c) 2026 Emir Mrkaljević).
//
// Some devices with a screen (AIO pump caps, keyboards and stream decks with displays) get a picture
// or a whole video from the vendor app: thousands of large host->device packets on one endpoint, each
// frame an encoded image cut into chunks behind a small per-packet header. Diffed as actions, that
// traffic drowns the real commands (brightness, orientation) sent on another endpoint.
//
// A stream is a host->device channel (bulk or interrupt) where at least `min_frames` packets start
// an image (JPEG FF D8 FF, PNG 89 50 4E 47 0D 0A 1A 0A, GIF 'GIF8', BMP 'BM', WebP RIFF....WEBP) at the same offset. That offset
// is the per-packet header length. A frame runs from its start packet until the image end marker
// (JPEG FF D9, PNG IEND), the BMP bfSize or WebP RIFF chunk size byte count, the next start or a pause of a second; its packets are set aside.
// Header bytes are described as constant, `nn` (the number of packets in the frame) or `ii` (the
// packet's index in the frame), and a device->host message of fixed content sent about once per
// frame is recorded as the per-frame ack.
//
// Raw pixel streams (RGB565, RGB888) have no start marker and are found by size instead, see the
// section further down.
//
// Port notes: a stream is a plain object with the same keys as the Python dict. `ids` is a Set of Transfer
// objects (Python used id()). Tuples are arrays ([w, h]); channel keys are strings (Transfer.keyStr()).
// write_testcard(w, h) returns the PNG bytes instead of writing a file (stored deflate, no zlib needed).
import { XFER_NAMES } from './model.js';
import { ascii, concat, concatAll, eq, hex, indexOf, readInt } from './bytes.js';
import { fmt_fixed } from './pyfmt.js';

export const MAGIC = {
  jpeg: Uint8Array.of(0xff, 0xd8, 0xff),
  png: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
  gif: ascii('GIF8'),
  bmp: ascii('BM'),
  webp: ascii('RIFF'),
};
export const END = {
  jpeg: Uint8Array.of(0xff, 0xd9),
  png: Uint8Array.of(0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82),
};
export const MAX_HEADER = 32;

// ---- small Python-isms ----

/** Counter keyed by the JSON of the key; mostCommon keeps first-seen order on ties (like CPython). */
class Counter {
  constructor() { this.m = new Map(); }
  add(k, n = 1) {
    const s = JSON.stringify(k);
    const e = this.m.get(s);
    if (e) e[1] += n;
    else this.m.set(s, [k, n]);
  }
  get(k) { return this.m.get(JSON.stringify(k))?.[1] ?? 0; }
  get size() { return this.m.size; }
  total() { let s = 0; for (const [, n] of this.m.values()) s += n; return s; }
  mostCommon() { return [...this.m.values()].sort((a, b) => b[1] - a[1]); }
}

const minOf = (xs) => xs.reduce((m, x) => (x < m ? x : m), Infinity);
const maxOf = (xs) => xs.reduce((m, x) => (x > m ? x : m), -Infinity);
const sumOf = (xs) => xs.reduce((s, x) => s + x, 0);
const round1 = (x) => Number(fmt_fixed(x, 1));
const round2 = (x) => Number(fmt_fixed(x, 2));
const hex2 = (n) => n.toString(16).padStart(2, '0');
const BE = 'big';
const LE = 'little';

/** Python tuple ordering for arrays of numbers. */
function cmpTuple(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

function* combinations(arr, n) {
  const idx = [];
  function* rec(start) {
    if (idx.length === n) { yield idx.map((i) => arr[i]); return; }
    for (let i = start; i < arr.length; i++) {
      idx.push(i);
      yield* rec(i + 1);
      idx.pop();
    }
  }
  yield* rec(0);
}

/** (width, height) from a JPEG SOF marker, the PNG IHDR, the GIF screen descriptor, BMP BITMAPINFOHEADER or WebP VP8X/VP8L/VP8. */
export function _size(fmt, img) {
  if (fmt === 'png' && img.length >= 24) return [readInt(img, 16, 4, BE), readInt(img, 20, 4, BE)];
  if (fmt === 'gif' && img.length >= 10) return [readInt(img, 6, 2, LE), readInt(img, 8, 2, LE)];
  if (fmt === 'bmp' && img.length >= 26) {
    const w = readInt(img, 18, 4, LE, true);
    const h = Math.abs(readInt(img, 22, 4, LE, true));
    if (w > 0 && h > 0) return [w, h];
  }
  if (fmt === 'webp' && img.length >= 16 && eq(img.subarray(8, 12), ascii('WEBP'))) {
    // VP8X canvas size, else first VP8L or VP8 bitstream chunk
    let i = 12;
    while (i + 8 <= img.length) {
      const tag = String.fromCharCode(...img.subarray(i, i + 4));
      const n = readInt(img, i + 4, 4, LE);
      const data = img.subarray(i + 8, i + 8 + n);
      const nxt = i + 8 + n + (n & 1); // RIFF pads odd chunks
      if (tag === 'VP8X' && data.length >= 10) {
        const w = readInt(data, 4, 3, LE) + 1;
        const h = readInt(data, 7, 3, LE) + 1;
        if (w > 0 && h > 0) return [w, h];
      }
      if (tag === 'VP8L' && data.length >= 5 && data[0] === 0x2f) {
        const bits = readInt(data, 1, 4, LE);
        const w = (bits & 0x3fff) + 1;
        const h = ((bits >>> 14) & 0x3fff) + 1;
        if (w > 0 && h > 0) return [w, h];
      }
      if (tag === 'VP8 ' && data.length >= 10 && data[3] === 0x9d && data[4] === 0x01 && data[5] === 0x2a) {
        const w = readInt(data, 6, 2, LE) & 0x3fff;
        const h = readInt(data, 8, 2, LE) & 0x3fff;
        if (w > 0 && h > 0) return [w, h];
      }
      if (n < 0 || nxt <= i) break;
      i = nxt;
    }
  }
  if (fmt === 'jpeg') {
    let i = 2;
    while (i + 9 < img.length && img[i] === 0xff) {
      const m = img[i + 1];
      const n = readInt(img, i + 2, 2, BE);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) {
        return [readInt(img, i + 7, 2, BE), readInt(img, i + 5, 2, BE)];
      }
      i += 2 + n;
    }
  }
  return null;
}

/**
 * Length of the image in buf once its end marker arrived (JPEG: as many FF D9 as FF D8 FF, so an
 * embedded thumbnail does not end the frame; BMP: the bfSize field at offset 2; WebP: RIFF chunk size + 8), else null.
 */
export function _ended(fmt, buf) {
  if (fmt === 'bmp') {
    if (buf.length < 6) return null;
    const size = readInt(buf, 2, 4, LE);
    if (size < 14) return null;
    return buf.length >= size ? size : null;
  }
  if (fmt === 'webp') {
    if (buf.length < 12) return null;
    if (!eq(buf.subarray(8, 12), ascii('WEBP'))) return null;
    const size = readInt(buf, 4, 4, LE) + 8;
    if (size < 12) return null;
    return buf.length >= size ? size : null;
  }
  const end = END[fmt];
  if (end === undefined) return null;
  if (fmt === 'jpeg') {
    let depth = 0;
    let i = 0;
    for (;;) {
      const a = indexOf(buf, MAGIC.jpeg, i);
      const b = indexOf(buf, end, i);
      if (b < 0) return null;
      if (a >= 0 && a < b) {
        depth += 1;
        i = a + 3;
      } else {
        depth -= 1;
        i = b + 2;
        if (depth <= 0) return i;
      }
    }
  }
  const k = indexOf(buf, end);
  return k < 0 ? null : k + end.length;
}

/**
 * Pattern of the first (or the following) packets' headers: hex, nn = packet count, ii = index.
 * A count or index above 255 is looked for as a 16-bit field (little or big endian) first.
 * Returns [pattern, roles].
 */
export function _header(frames, h, first) {
  const rows = first
    ? frames.map((f) => [f[0].data.subarray(0, h), f.length, 0])
    : frames.flatMap((f) => f.slice(1).map((t, k) => [t.data.subarray(0, h), f.length, k + 1]));
  if (!rows.length) return ['', {}];
  const counts = new Set(rows.map(([, n]) => n));
  const out = new Array(h).fill(null);
  const roles = {};
  for (let j = 0; j < h - 1; j++) {
    for (const order of [LE, BE]) {
      if (out[j] || out[j + 1]) break;
      const vals = rows.map(([d]) => readInt(d, j, 2, order));
      if (maxOf(vals) <= 255) continue;
      if (!('count' in roles) && vals.every((v, i) => v === rows[i][1])) {
        out[j] = out[j + 1] = 'nn';
        Object.assign(roles, { count: j, count_width: 2, count_endian: order });
      } else if (!first && !('index' in roles) && new Set(vals.map((v, i) => v - rows[i][2])).size === 1
        && [j, j + 1].every((i) => new Set(rows.map(([d]) => d[i])).size > 1)) {
        out[j] = out[j + 1] = 'ii';
        Object.assign(roles, { index: j, index_width: 2, index_endian: order, index_base: vals[0] - rows[0][2] });
      }
    }
  }
  for (let j = 0; j < h; j++) {
    if (out[j]) continue;
    const vals = rows.map(([d]) => d[j]);
    if (!('count' in roles) && counts.size > 1 && vals.every((v, i) => v === (rows[i][1] & 0xff))) {
      out[j] = 'nn';
      Object.assign(roles, { count: j, count_width: 1 });
    } else if (!first && !('index' in roles) && new Set(vals.map((v, i) => v - rows[i][2])).size === 1
      && new Set(vals).size > 1) {
      out[j] = 'ii';
      Object.assign(roles, { index: j, index_width: 1, index_base: vals[0] - rows[0][2] });
    } else if (new Set(vals).size === 1) {
      out[j] = hex2(vals[0]);
    } else {
      out[j] = '??';
    }
  }
  return [out.join(' '), roles];
}

/** Host->device bulk/interrupt channels: Map of Transfer.keyStr() -> packets in time order. */
export function _channels(transfers) {
  const chans = new Map();
  const sorted = [...transfers].sort((a, b) => a.ts - b.ts);
  for (const t of sorted) {
    if (t.is_out && t.data.length && (t.xfer_type === 1 || t.xfer_type === 3)) {
      const k = t.keyStr();
      if (!chans.has(k)) chans.set(k, []);
      chans.get(k).push(t);
    }
  }
  return chans;
}

/**
 * Image streams in the capture; each object has the stream's description plus `ids` (its packets
 * and acks, to leave out of everything else). A stream whose frames span several host->device
 * endpoints of one device (see _multi_endpoint) replaces the per-endpoint guesses it explains.
 */
export function find_streams(transfers, min_frames = 3) {
  const chans = _channels(transfers);
  const singles = new Map();
  for (const [ks, pkts] of chans) {
    const key = JSON.parse(ks);
    const s = _encoded_stream(transfers, key, pkts, min_frames) || _raw_stream(transfers, key, pkts, min_frames);
    if (s) singles.set(ks, s);
  }
  let found = [...singles.values()];
  for (const [m, keys] of _multi_endpoint(transfers, chans, singles, min_frames)) {
    const gone = keys.filter((k) => singles.has(k)).map((k) => singles.get(k));
    const at = gone.length ? minOf(gone.map((g) => found.indexOf(g))) : found.length;
    found = found.filter((s) => gone.every((g) => s !== g));
    found.splice(Math.min(at, found.length), 0, m);
  }
  for (const s of found) _finish(s);
  return found;
}

/** A JPEG/PNG/GIF/BMP/WebP stream on these packets (one channel, or several merged by time), or null. */
export function _encoded_stream(transfers, key, pkts, min_frames) {
  let best = null;
  for (const [fmt, magic] of Object.entries(MAGIC)) {
    const offs = new Counter();
    for (const t of pkts) {
      const o = indexOf(t.data, magic);
      if (o >= 0 && o <= MAX_HEADER && (fmt !== 'webp' || (o + 12 <= t.data.length && eq(t.data.subarray(o + 8, o + 12), ascii('WEBP'))))) {
        offs.add(o);
      }
    }
    if (offs.size) {
      const [h, n] = offs.mostCommon()[0];
      if (n >= min_frames && (best === null || n > best[2])) best = [fmt, h, n];
    }
  }
  if (best === null) return null;
  const [fmt, h] = best;
  const magic = MAGIC[fmt];
  const starts = [];
  pkts.forEach((t, i) => {
    if (eq(t.data.subarray(h, h + magic.length), magic)
      && (fmt !== 'webp' || (h + 12 <= t.data.length && eq(t.data.subarray(h + 8, h + 12), ascii('WEBP'))))) starts.push(i);
  });
  const frames = [];
  const sizes = [];
  const dims = new Counter();
  starts.forEach((s, si) => {
    const stop = si + 1 < starts.length ? starts[si + 1] : pkts.length;
    const members = [pkts[s]];
    let buf = pkts[s].data.subarray(h);
    let n_img = _ended(fmt, buf);
    let k = s + 1;
    while (n_img === null && k < stop && pkts[k].ts - pkts[k - 1].ts < 1.0) {
      members.push(pkts[k]);
      buf = concat(buf, pkts[k].data.subarray(h));
      n_img = _ended(fmt, buf);
      k += 1;
    }
    frames.push(members);
    if (n_img !== null) sizes.push(n_img);
    if (dims.size < 50) {
      const d = _size(fmt, buf);
      if (d) dims.add(d);
    }
  });
  const ids = new Set();
  for (const f of frames) for (const t of f) ids.add(t);
  const lens = new Counter();
  for (const f of frames) for (const t of f) lens.add(t.data.length);
  const chunk = lens.mostCommon()[0][0];
  const padded = lens.get(chunk) >= 0.95 * ids.size;
  const [first, froles] = _header(frames, h, true);
  const [nxt, nroles] = _header(frames.filter((f) => f.length > 1), h, false);
  // chunks of a frame cut off by the start or a pause of the capture: same size, same fixed
  // header bytes as the packets that follow a frame's first one
  const fixed = nxt.split(/\s+/).filter(Boolean).map((b, j) => [j, b]).filter(([, b]) => !['nn', 'ii', '??'].includes(b))
    .map(([j, b]) => [j, parseInt(b, 16)]);
  const orphans = pkts.filter((t) => !ids.has(t) && t.data.length === chunk && h && nxt && fixed.every(([j, v]) => t.data[j] === v));
  for (const t of orphans) ids.add(t);
  const span = frames[frames.length - 1][0].ts - frames[0][0].ts;
  const s = {
    endpoint: key[1], xfer_type: key[2], format: fmt, frames: frames.length,
    packets: ids.size, partial: orphans.length, chunk, padded,
    header_len: h, first_header: first, next_header: nxt,
    count_offset: froles.count ?? nroles.count ?? null,
    index_offset: nroles.index ?? null, index_base: nroles.index_base ?? null,
    count_in_next: 'count' in nroles,
    packets_per_frame: [minOf(frames.map((f) => f.length)), maxOf(frames.map((f) => f.length))],
    image_bytes: sizes.length ? [minOf(sizes), maxOf(sizes)] : null,
    size: dims.size ? [...dims.mostCommon()[0][0]] : null,
    fps: span > 0 ? round1((frames.length - 1) / span) : null,
    first_frames: frames.slice(0, 5).map((f) => f[0].frame), ack: null,
  };
  for (const k of ['count_width', 'count_endian']) s[k] = froles[k] ?? nroles[k] ?? null;
  for (const k of ['index_width', 'index_endian']) s[k] = nroles[k] ?? null;
  Object.assign(s, {
    raw: false, header_packet: null, header_inline: false, region: null, length_field: null, byteorder: null,
    size_alternatives: [], frame_bytes: null, regions: 0, channel_order: null, channel_evidence: null,
  });
  _add_ack(s, transfers, key[0], frames, ids);
  s.ids = ids;
  Object.assign(s, { _frames: frames, _heads: [], _complete: sizes.length });
  return s;
}

// ---- streams over several endpoints ----
//
// Some screens take a frame over more than one host->device endpoint: the packets alternate
// between two bulk endpoints, the first part of the frame goes to one endpoint and the rest to
// another, or a draw command goes to the command endpoint and the pixels to a data endpoint. Seen
// one endpoint at a time such a stream is missed or cut into broken frames. So for every device
// with more than one host->device channel the channels are also merged by time and searched again.
// A merged stream is kept only when most of its frames really use more than one endpoint (so two
// screens on two endpoints stay two streams) and it explains as many whole frames (give or take a
// frame cut by each end of the capture) and at least as many packets as the streams found on its
// endpoints one by one.

export const MAX_MERGE = 4; // data channels of one device tried together

export function _uses_several(s) {
  const frames = s._frames;
  const heads = s._heads;
  if (!frames.length) return false;
  const spans = frames.filter((f) => new Set(f.map((t) => t.endpoint)).size > 1).length;
  const data_eps = new Set(frames.flatMap((f) => f.map((t) => t.endpoint)));
  const cmd = heads.filter((h) => !data_eps.has(h.endpoint)).length;
  return spans >= 0.5 * frames.length || cmd >= 0.5 * frames.length;
}

/** Streams whose frames span several endpoints, each with the channel keys it replaces: [[stream, keys], ...]. */
export function _multi_endpoint(transfers, chans, singles, min_frames) {
  const by_dev = new Map();
  for (const ks of chans.keys()) {
    const dev = JSON.parse(ks)[0];
    if (!by_dev.has(dev)) by_dev.set(dev, []);
    by_dev.get(dev).push(ks);
  }
  const out = [];
  for (const keys of by_dev.values()) {
    if (keys.length < 2) continue;
    let data = keys.filter((k) => chans.get(k).filter((t) => t.data.length > MAX_HEADER_PKT).length >= 0.5 * chans.get(k).length);
    data = data.map((k, i) => [k, i]).sort((a, b) => chans.get(b[0]).length - chans.get(a[0]).length || a[1] - b[1])
      .map(([k]) => k).slice(0, MAX_MERGE);
    const cmd = keys.filter((k) => !data.includes(k));
    // the packet size each data channel mostly uses; a frame is only looked for over channels
    // that share it (a command channel of 64-byte reports next to 1024-byte image chunks is not one)
    const chunk = new Map();
    for (const k of data) {
      const c = new Counter();
      for (const t of chans.get(k)) c.add(t.data.length);
      chunk.set(k, c.mostCommon()[0][0]);
    }
    const cands = [];
    for (let n = data.length; n > 0; n--) {
      for (const sub of combinations(data, n)) {
        const encoded = sub.some((k) => singles.has(k) && !singles.get(k).raw);
        const tries = [];
        if (n >= 2 && new Set(sub.map((k) => chunk.get(k))).size === 1) tries.push([sub, true]);
        if (cmd.length && !encoded) tries.push([sub.concat(cmd), false]); // a draw command on a command endpoint
        for (const [group, allow_encoded] of tries) {
          const pkts = group.flatMap((k) => chans.get(k)).sort((a, b) => a.ts - b.ts || a.frame - b.frame);
          const key = JSON.parse(group[0]);
          let m = allow_encoded ? _encoded_stream(transfers, key, pkts, min_frames) : null;
          if (m === null && !encoded) m = _raw_stream(transfers, key, pkts, min_frames);
          if (m === null || !_uses_several(m)) continue;
          const mine = group.filter((k) => singles.has(k)).map((k) => singles.get(k));
          const best = mine.length ? maxOf(mine.map((s) => s._complete)) : 0;
          const covered = sumOf(mine.map((s) => s.packets));
          // a tie means the endpoints alone each looked like a smaller screen in step
          // with the other: one frame over both is the simpler story. One endpoint alone
          // can see one more whole frame at each end, where the capture cut a frame.
          if (m._complete + 2 >= best && m.packets >= covered) cands.push([[m._complete, m.packets], m, group]);
        }
      }
    }
    const taken = new Set();
    const sorted = cands.map((c, i) => [c, i]).sort((a, b) => cmpTuple(b[0][0], a[0][0]) || a[1] - b[1]).map(([c]) => c);
    for (const [, m, group] of sorted) {
      if (group.every((k) => !taken.has(k))) {
        for (const k of group) taken.add(k);
        out.push([m, group]);
      }
    }
  }
  return out;
}

/** Which endpoints carry the stream's frames, in what layout, and where its draw command goes. */
export function _finish(s) {
  const frames = s._frames;
  const heads = s._heads;
  delete s._frames;
  delete s._heads;
  delete s._complete;
  const order = [];
  const longest = [...frames].sort((a, b) => b.length - a.length).slice(0, 1);
  for (const f of longest.concat(frames)) {
    for (const t of f) if (!order.includes(t.endpoint)) order.push(t.endpoint);
  }
  const n = order.length;
  let layout = null;
  if (n > 1) {
    const multi = frames.filter((f) => f.length >= n);
    if (multi.every((f) => f.every((t, k) => t.endpoint === order[k % n]))) layout = 'alternate';
    else if (multi.every((f) => f.every((t, k) => t.endpoint === order[Math.floor((k * n) / f.length)]))) layout = 'blocks';
    else layout = 'mixed';
    const types = new Map();
    for (const f of frames) for (const t of f) types.set(t.endpoint, t.xfer_type);
    s.endpoint = order[0];
    s.xfer_type = types.get(order[0]);
  }
  const head_eps = new Counter();
  for (const h of heads) head_eps.add(h.endpoint);
  const hmc = head_eps.mostCommon();
  const head_ep = hmc.length ? hmc[0][0] : null;
  s.endpoints = order.length ? order : [s.endpoint];
  s.endpoint_layout = layout;
  s.header_endpoint = head_ep !== null && !order.includes(head_ep) ? head_ep : null;
}

/**
 * A fixed device->host message sent about once per frame on the same device is the frame ack.
 *
 * Counted per frame, not over the whole capture: a message counts for a frame when it arrives
 * between the frame's start and the next frame (at most a second after the frame's last packet).
 * It is the ack when at least half the frames get one and most of those get exactly one, so a
 * burst of copies while no frames go out (a paused or trimmed stream) does not hide it.
 */
export function _add_ack(s, transfers, device, frames, ids) {
  const acks = new Map();
  for (const t of transfers) {
    if (t.is_in && t.data.length && t.device === device && (t.xfer_type === 1 || t.xfer_type === 3)) {
      const k = `${t.endpoint}:${hex(t.data)}`;
      if (!acks.has(k)) acks.set(k, { ep: t.endpoint, d: t.data, g: [] });
      acks.get(k).g.push(t);
    }
  }
  const starts = frames.map((f) => f[0].ts);
  const nexts = starts.slice(1).concat([Infinity]);
  const windows = frames.map((f, i) => [f[0].ts, Math.min(nexts[i], f[f.length - 1].ts + 1.0)]);
  let best = null;
  for (const { ep, d, g } of acks.values()) {
    const per = windows.map(([a, b]) => g.filter((t) => a <= t.ts && t.ts < b).length);
    const hit = per.filter((n) => n).length;
    const single = per.filter((n) => n === 1).length;
    if (hit >= 0.5 * frames.length && single >= (2 / 3) * hit && (best === null || hit > best[0])) {
      best = [hit, ep, d, g];
    }
  }
  if (best) {
    const [hit, ep, d, g] = best;
    s.ack = {
      endpoint: ep, payload: hex(d, ' '), count: g.length, frames_acked: hit,
      frames: g.slice(0, 5).map((t) => t.frame),
    };
    for (const t of g) ids.add(t);
  }
}

export function drop_streams(transfers, streams) {
  const ids = new Set();
  for (const s of streams) for (const t of s.ids) ids.add(t);
  return transfers.filter((t) => !ids.has(t));
}

/** One line: 'jpeg stream on interrupt EP 0x03: 8670 frames, ...'. */
export function describe(s) {
  const size = s.size ? ` ${s.size[0]}x${s.size[1]},` : '';
  const ack = s.ack ? `; ack ${s.ack.payload} on EP 0x${hex2(s.ack.endpoint)}` : '';
  let hdr = s.header_len ? `, header \`${s.first_header}\` then \`${s.next_header}\`` : '';
  if (s.header_packet) hdr += `, each frame after a command \`${s.header_packet}\``;
  const part = s.regions ? ` (${s.regions} redraw part of the screen)` : '';
  let order = s.byteorder ? ` ${s.byteorder}-endian` : '';
  if (s.channel_order) order += ` ${s.channel_order.toUpperCase()}`;
  const kind = s.raw ? `raw ${s.format}${order}` : s.format;
  return `${kind} stream on ${XFER_NAMES[s.xfer_type]} ${endpoints(s)}:${size} `
    + `${s.frames} frames${part} in ${s.packets} packets of ${s.chunk} bytes${hdr}${ack}`;
}

export const LAYOUTS = {
  alternate: 'packets alternate between them', blocks: "each frame's first part on the first one",
  mixed: 'no fixed order',
};

/** 'EP 0x02', or 'EP 0x02 + 0x04 (packets alternate between them), command on EP 0x01'. */
export function endpoints(s) {
  const eps = s.endpoints && s.endpoints.length ? s.endpoints : [s.endpoint];
  let out = 'EP ' + eps.map((e) => `0x${hex2(e)}`).join(' + ');
  if (s.endpoint_layout) out += ` (${LAYOUTS[s.endpoint_layout]})`;
  if (s.header_endpoint !== null && s.header_endpoint !== undefined) out += `, command on EP 0x${hex2(s.header_endpoint)}`;
  return out;
}

// ---- raw pixel streams (no image file format) ----
//
// Many cheap case and AIO screens take plain pixels: RGB565 (2 bytes a pixel) or RGB888 (3 bytes),
// usually behind a small command that says where on the screen they go. Nothing in the bytes says
// "image", so a raw stream is found by size: on one host->device channel, runs of large packets
// (all but the last the same length, no pause between them) whose payload is exactly
// width x height x bytes per pixel for a common screen size, or exactly the region a short packet
// sent just before the run describes (x, y, width, height or x0, y0, x1, y1 as 16-bit fields, or
// four 10-bit fields packed into 5 bytes). At least `min_frames` such frames make a stream.

export const SCREENS = [
  [128, 128], [128, 160], [160, 128], [160, 80], [80, 160], [240, 135], [135, 240], [240, 240],
  [240, 280], [280, 240], [240, 320], [320, 240], [170, 320], [320, 170], [172, 320], [320, 172],
  [320, 320], [360, 360], [320, 480], [480, 320], [480, 272], [272, 480], [412, 412], [466, 466],
  [480, 480], [480, 800], [800, 480], [480, 854], [854, 480], [640, 480], [480, 640], [800, 600],
  [1024, 600], [600, 1024], [1280, 480], [480, 1280], [1920, 480], [480, 1920]];
export const RAW = { rgb565: 2, rgb888: 3 };
/** pixel byte count -> [[format, width, height], ...] in the order Python inserted them. */
export const SIZES = new Map();
for (const [_fmt, _bpp] of Object.entries(RAW)) {
  for (const [_w, _h] of SCREENS) {
    const k = _w * _h * _bpp;
    if (!SIZES.has(k)) SIZES.set(k, []);
    SIZES.get(k).push([_fmt, _w, _h]);
  }
}
export const GAP = 0.03; // longest pause between two packets of one raw frame, in seconds
export const MAX_HEADER_PKT = 32; // a packet this short right before a run is the run's header (command) packet
export const REGION_TOKENS = { xywh: ['xx', 'yy', 'ww', 'hh'], box: ['xx', 'yy', 'ex', 'ey'], wh: ['ww', 'hh'] };

/** [x, y, width, height] a header packet gives in this layout, or null if it does not fit. */
export function _region(layout, hdr, off, order) {
  if (layout === 'box10') { // four 10-bit fields x, y, end x, end y packed into 5 bytes
    if (hdr.length < off + 5) return null;
    const v = readInt(hdr, off, 5, BE);
    const x = Math.floor(v / 2 ** 30);
    const y = Math.floor(v / 2 ** 20) % 1024;
    const ex = Math.floor(v / 2 ** 10) % 1024;
    const ey = v % 1024;
    return ex >= x && ey >= y ? [x, y, ex - x + 1, ey - y + 1] : null;
  }
  const n = layout === 'wh' ? 2 : 4;
  if (hdr.length < off + 2 * n) return null;
  const f = [];
  for (let i = 0; i < n; i++) f.push(readInt(hdr, off + 2 * i, 2, order));
  if (layout === 'wh') return [0, 0, f[0], f[1]];
  if (layout === 'box') return f[2] >= f[0] && f[3] >= f[1] ? [f[0], f[1], f[2] - f[0] + 1, f[3] - f[1] + 1] : null;
  return [f[0], f[1], f[2], f[3]];
}

/** The run's payload is `size` bytes, or `size` with the last packet padded to a full chunk. */
export function _fits(payload, n_pkts, room, size) {
  return payload === size || (size < payload && n_pkts === Math.ceil(size / room) && payload - size < room);
}

/** Region field layouts to try in a command of hl bytes, most likely first: [layout, offset, endian]. */
export function _region_tries(hl) {
  const tries = [];
  for (let o = 0; o < hl - 4; o++) tries.push(['box10', o, BE]);
  for (const layout of ['xywh', 'box', 'wh']) {
    // aligned little-endian fields first: a byte-shifted big-endian reading of small
    // values can fit the same frames
    const part = [];
    for (let o = 0; o < hl - 1; o++) for (const e of [LE, BE]) part.push([layout, o, e]);
    part.sort((a, b) => (a[1] % 2) - (b[1] % 2) || Number(a[2] !== LE) - Number(b[2] !== LE) || a[1] - b[1]);
    for (const _x of part) tries.push(_x);
  }
  return tries;
}

/**
 * A draw command at the start of each frame's first pixel packet (no packet of its own): its
 * region fields give width x height, and the frame's bytes are that many pixels plus the command,
 * the same command length in every frame. Returns [layout, offset, endian, format, got, length] or null.
 */
export function _inline_region(runs, min_frames) {
  if (runs.length < min_frames) return null;
  const width = { box10: 5, xywh: 8, box: 8, wh: 4 };
  for (const [layout, o, e] of _region_tries(MAX_HEADER_PKT)) {
    for (const [fmt, bpp] of Object.entries(RAW)) {
      let got = [];
      const lens = new Counter();
      let misses = 0;
      const room = 0.1 * runs.length + 1; // runs that may miss (frames cut off by the capture)
      for (const r of runs) {
        const ps = [...r.pkts];
        const g = _region(layout, ps[0].data, o, e);
        if (!g || !(g[2] > 0 && g[2] <= 4096 && g[3] > 0 && g[3] <= 4096)) {
          misses += 1;
          if (misses > room) break;
          continue;
        }
        const pay = sumOf(ps.map((t) => t.data.length));
        let hl = pay - g[2] * g[3] * bpp;
        if (!(o + width[layout] <= hl && hl <= MAX_HEADER_PKT) && r.tail !== null) {
          ps.push(r.tail);
          hl += r.tail.data.length;
        }
        if (o + width[layout] <= hl && hl <= MAX_HEADER_PKT && hl <= ps[0].data.length) {
          got.push([r, ps, g, hl]);
          lens.add(hl);
        } else {
          misses += 1;
          if (misses > room) break;
        }
      }
      if (!lens.size) continue;
      const [hl, n] = lens.mostCommon()[0];
      got = got.filter(([, , , k]) => k === hl).map(([r, ps, g]) => [r, ps, g]);
      if (n >= Math.max(min_frames, 0.9 * runs.length)) {
        if (layout === 'xywh' && !got.some(([, , g]) => g[0] || g[1])) continue; // x and y always 0: plain width and height fields are the simpler story
        return [layout, o, e, fmt, got, hl];
      }
    }
  }
  return null;
}

/** Byte order of RGB565 pixels: the order that makes neighbouring pixels more alike, if clear. */
export function _rgb565_order(pix) {
  const n = Math.min(Math.floor(pix.length / 2), 8192);
  const cost = (order) => {
    let c = 0;
    let prev = null;
    for (let i = 0; i < n; i++) {
      const v = readInt(pix, 2 * i, 2, order);
      const px = [v >> 11, (v >> 5) & 63, v & 31];
      if (prev) c += 2 * Math.abs(px[0] - prev[0]) + Math.abs(px[1] - prev[1]) + 2 * Math.abs(px[2] - prev[2]);
      prev = px;
    }
    return c;
  };
  const le = cost(LE);
  const be = cost(BE);
  if (le < 0.7 * be) return LE;
  if (be < 0.7 * le) return BE;
  return null;
}

/**
 * Packets that follow each other without a pause, all but the last `chunk` bytes long, plus the
 * short packet just before (a header candidate) and a short one just after (a tail candidate).
 * Each run is {head, pkts, tail}.
 */
export function _runs(pkts, chunk) {
  const runs = [];
  let i = 0;
  while (i < pkts.length) {
    const n = pkts[i].data.length;
    if (n <= MAX_HEADER_PKT || n > chunk) {
      i += 1;
      continue;
    }
    let j = i + 1;
    if (n === chunk) {
      while (j < pkts.length && pkts[j].ts - pkts[j - 1].ts < GAP && MAX_HEADER_PKT < pkts[j].data.length && pkts[j].data.length <= chunk) {
        j += 1;
        if (pkts[j - 1].data.length < chunk) break;
      }
    }
    const head = i && pkts[i - 1].data.length <= MAX_HEADER_PKT && pkts[i].ts - pkts[i - 1].ts < GAP ? pkts[i - 1] : null;
    const tail = j < pkts.length && pkts[j].data.length <= MAX_HEADER_PKT && pkts[j].ts - pkts[j - 1].ts < GAP ? pkts[j] : null;
    runs.push({ head, pkts: pkts.slice(i, j), tail });
    i = j;
  }
  return runs;
}

/** Frames whose payload is a whole screen; a run of several back-to-back frames is split. [[run, packets, size], ...] */
export function _frames_by_size(runs, chunk, h) {
  const room = chunk - h;
  const out = [];
  const sizes = new Counter();
  for (const r of runs) {
    const pay = sumOf(r.pkts.map((t) => t.data.length - h));
    for (const size of SIZES.keys()) {
      if (_fits(pay, r.pkts.length, room, size)) {
        sizes.add(size);
        break;
      }
    }
  }
  const big = sizes.mostCommon().map(([sz]) => sz).concat([...SIZES.keys()].sort((a, b) => b - a));
  for (const r of runs) {
    const ps = r.pkts;
    if (h === 0 && SIZES.has(chunk) && ps.length > 1 && ps.every((t) => t.data.length === chunk)) {
      // one transfer per frame (the app hands the whole screen to the USB stack at once)
      ps.forEach((t, k) => out.push([{ head: k === 0 ? r.head : null, pkts: [t], tail: null }, [t], chunk]));
      continue;
    }
    const pay = sumOf(ps.map((t) => t.data.length - h));
    let hit = null;
    for (const sz of SIZES.keys()) {
      if (_fits(pay, ps.length, room, sz)) {
        hit = sz;
        break;
      }
    }
    if (hit) {
      out.push([r, ps, hit]);
      continue;
    }
    // one run holding k frames sent back to back (each frame whole packets, no header packet)
    for (const sz of big) {
      if (sz % room === 0 && pay % sz === 0 && Math.floor(pay / sz) >= 2 && ps.every((t) => t.data.length === chunk)) {
        const per = sz / room;
        for (let k = 0; k < ps.length; k += per) {
          out.push([{ head: k === 0 ? r.head : null, pkts: ps.slice(k, k + per), tail: null }, ps.slice(k, k + per), sz]);
        }
        break;
      }
    }
  }
  return out;
}

export function _raw_stream(transfers, key, pkts, min_frames) {
  const lens = new Counter();
  for (const t of pkts) if (t.data.length > MAX_HEADER_PKT) lens.add(t.data.length);
  if (!lens.size) return null;
  const chunk = lens.mostCommon()[0][0];
  const runs = _runs(pkts, chunk);
  if (!runs.length) return null;
  // payload per packet after an optional per-packet header of h bytes
  let best = null;
  for (let h = 0; h <= MAX_HEADER; h++) {
    if (h >= chunk) break;
    const fr = _frames_by_size(runs, chunk, h);
    // runs that are one frame each are better evidence than runs split into several frames
    const score = [fr.filter(([r, ps]) => ps === r.pkts).length, fr.length];
    if (fr.length >= min_frames && (best === null || cmpTuple(score, best[2]) > 0)) best = [h, fr, score];
  }
  const h = best ? best[0] : 0;
  const room = chunk - h;
  // a header packet before the runs that says which region of the screen the pixels go to
  const heads = new Counter();
  for (const r of runs) if (r.head !== null) heads.add(r.head.data.length);
  let region = null;
  if (heads.size && h === 0) {
    const [hl, nh] = heads.mostCommon()[0];
    const headed = runs.filter((r) => r.head !== null && r.head.data.length === hl);
    if (nh >= min_frames) {
      search:
      for (const [layout, o, e] of _region_tries(hl)) {
        for (const [fmt, bpp] of Object.entries(RAW)) {
          const got = [];
          let broke = false;
          for (const r of headed) {
            const g = _region(layout, r.head.data, o, e);
            if (!g || !(g[2] > 0 && g[2] <= 4096 && g[3] > 0 && g[3] <= 4096)) {
              broke = true;
              break;
            }
            const ps = [...r.pkts];
            const pay = sumOf(ps.map((t) => t.data.length));
            if (!_fits(pay, ps.length, room, g[2] * g[3] * bpp)) {
              if (r.tail === null || pay + r.tail.data.length !== g[2] * g[3] * bpp) continue;
              ps.push(r.tail);
            }
            got.push([r, ps, g]);
          }
          if (!broke && got.length >= Math.max(min_frames, 0.9 * headed.length)) {
            if (layout === 'xywh' && !got.some(([, , g]) => g[0] || g[1])) continue; // x and y always 0: plain width and height fields are the simpler story
            region = [layout, o, e, fmt, got];
            break search;
          }
        }
      }
    }
  }
  let inline = 0; // length of a draw command sent at the start of the first pixel packet
  if (region === null && h === 0) {
    const found = _inline_region(runs, min_frames);
    if (found) {
      region = found.slice(0, 5);
      inline = found[5];
    }
  }
  let got;
  let frames;
  let heads_used;
  let frame_bytes;
  let fmt;
  let size;
  let alts;
  let n_regions;
  if (region) {
    let layout;
    [layout, , , fmt, got] = region;
    frames = got.map(([, ps]) => ps);
    heads_used = inline ? [] : got.map(([r]) => r.head);
    const areas = new Counter();
    for (const [, , g] of got) areas.add([g[0], g[1], g[2], g[3]]);
    let full = null;
    let fullKey = null;
    for (const [g, n] of areas.m.values()) {
      const kk = [g[2] * g[3], n];
      if (full === null || cmpTuple(kk, fullKey) > 0) {
        full = g;
        fullKey = kk;
      }
    }
    size = [full[2], full[3]];
    alts = [];
    n_regions = got.filter(([, , g]) => g[2] !== full[2] || g[3] !== full[3]).length;
    frame_bytes = full[2] * full[3] * RAW[fmt];
  } else {
    if (best === null) return null;
    got = best[1];
    frames = got.map(([, ps]) => ps);
    heads_used = got.filter(([r]) => r.head !== null).map(([r]) => r.head);
    const fb = new Counter();
    for (const [, , sz] of got) fb.add(sz);
    frame_bytes = fb.mostCommon()[0][0];
    const [[f0, w, hh], ...rest] = SIZES.get(frame_bytes);
    fmt = f0;
    size = [w, hh];
    n_regions = 0;
    alts = rest.map(([f, a, b]) => `${f} ${a}x${b}`);
    if (heads_used.length && heads_used.length < 0.8 * frames.length) heads_used = [];
  }
  const ids = new Set();
  for (const f of frames) for (const t of f) ids.add(t);
  for (const t of heads_used) ids.add(t);
  // frames cut off by the start or the end of the capture: the first or last run, same chunk size
  const used = new Set(got.map(([r]) => r.pkts[0]));
  const partial = [];
  for (const r of [runs[0], runs[runs.length - 1]]) {
    if (!used.has(r.pkts[0])) for (const t of r.pkts) if (t.data.length === chunk) partial.push(t);
  }
  if (inline) { // a cut frame still ends with the short rest of its pixels
    for (const r of [runs[0], runs[runs.length - 1]]) {
      if (!used.has(r.pkts[0]) && r.tail !== null && r.tail.data.length < chunk) partial.push(r.tail);
    }
  }
  for (const t of partial) ids.add(t);
  const [first, froles] = _header(frames, h, true);
  const [nxt, nroles] = _header(frames.filter((f) => f.length > 1), h, false);
  const joinPix = (f) => concatAll(f.map((t) => t.data.subarray(h)));
  let pix = frames.length ? joinPix(frames[0]).subarray(inline, inline + frame_bytes) : new Uint8Array(0);
  const full_frames = frames.filter((f) => sumOf(f.map((t) => t.data.length - h)) - inline >= frame_bytes);
  if (full_frames.length) pix = joinPix(full_frames[0]).subarray(inline, inline + frame_bytes);
  const span = frames[frames.length - 1][0].ts - frames[0][0].ts;
  const plens = new Counter();
  for (const f of frames) for (const t of f) plens.add(t.data.length);
  const payloads = frames.map((f) => sumOf(f.map((t) => t.data.length - h)));
  const s = {
    endpoint: key[1], xfer_type: key[2], format: fmt, frames: frames.length,
    packets: ids.size, partial: partial.length, chunk,
    padded: plens.get(chunk) >= 0.95 * plens.total() && frames.some((f) => sumOf(f.map((t) => t.data.length - h)) - inline > frame_bytes),
    header_len: h, first_header: h ? first : '', next_header: h ? nxt : '',
    count_offset: froles.count ?? nroles.count ?? null,
    index_offset: nroles.index ?? null, index_base: nroles.index_base ?? null,
    count_in_next: 'count' in nroles,
    count_width: froles.count_width ?? nroles.count_width ?? null,
    count_endian: froles.count_endian ?? nroles.count_endian ?? null,
    index_width: nroles.index_width ?? null, index_endian: nroles.index_endian ?? null,
    packets_per_frame: [minOf(frames.map((f) => f.length)), maxOf(frames.map((f) => f.length))],
    image_bytes: [minOf(payloads) - inline, maxOf(payloads) - inline],
    size, size_alternatives: alts, frame_bytes, regions: n_regions,
    fps: span > 0 ? round1((frames.length - 1) / span) : null,
    first_frames: frames.slice(0, 5).map((f) => f[0].frame), ack: null, raw: true,
    byteorder: fmt === 'rgb565' ? _rgb565_order(pix) : null,
    header_packet: null, header_inline: Boolean(inline), region: null, length_field: null,
  };
  Object.assign(s, _channel_order(full_frames, h, fmt, frame_bytes, s.byteorder, 600, inline));
  if (heads_used.length || inline) {
    const hd = inline ? frames.map((f) => f[0].data.subarray(0, inline)) : heads_used.map((t) => t.data);
    const hl = hd[0].length;
    const tokens = new Array(hl).fill(null);
    if (region) {
      const [layout, o, e] = region;
      if (layout === 'box10') {
        for (let i = 0; i < 5; i++) tokens[o + i] = 'rr';
      } else {
        REGION_TOKENS[layout].forEach((name, i) => {
          tokens[o + 2 * i] = name;
          tokens[o + 2 * i + 1] = name;
        });
      }
      s.region = { layout, offset: o, endian: e };
    }
    // a 16- or 32-bit field holding the frame's byte count
    const pays = frames.map((f) => sumOf(f.map((t) => t.data.length - h)) - inline);
    for (const width of [4, 2]) {
      for (let j = 0; j < hl - width + 1; j++) {
        if (s.length_field || tokens.slice(j, j + width).some(Boolean)) continue;
        for (const e of [LE, BE]) {
          const vals = hd.map((d) => readInt(d, j, width, e));
          const m = Math.min(vals.length, pays.length);
          let ok = true;
          for (let i = 0; i < m; i++) if (vals[i] !== pays[i]) { ok = false; break; }
          if (maxOf(vals) > 255 && ok) {
            for (let i = 0; i < width; i++) tokens[j + i] = 'll';
            s.length_field = { offset: j, width, endian: e };
            break;
          }
        }
      }
    }
    for (let j = 0; j < hl; j++) {
      if (tokens[j] === null || tokens[j] === undefined) {
        const col = new Set(hd.map((d) => d[j]));
        tokens[j] = col.size === 1 ? hex2([...col][0]) : '??';
      }
    }
    s.header_packet = tokens.join(' ');
  }
  _add_ack(s, transfers, key[0], frames, ids);
  s.ids = ids;
  Object.assign(s, { _frames: frames, _heads: heads_used, _complete: frames.length });
  return s;
}

// ---- channel order (RGB or BGR) from the usb-rea test card ----
//
// Pixels alone do not say whether the first channel is red or blue: a photo with red and blue
// swapped is still a smooth photo. So the order is only claimed when a frame shows a known picture,
// the usb-rea test card (`usb-rea testcard`): left half red, top right quarter green, then a blue
// and a white eighth. Its colour shares (1/2 red, 1/4 green, 1/8 blue, 1/8 white) do not change
// when the vendor app scales, rotates or mirrors the picture, and they only come out right for one
// reading of the pixels (RGB or BGR, and for RGB565 also little or big endian). Without such a
// frame the order stays unknown.

export const TESTCARD_SHARES = { r: 0.5, g: 0.25, b: 0.125, w: 0.125 };
export const TESTCARD_COLORS = { r: [255, 0, 0], g: [0, 255, 0], b: [0, 0, 255], w: [255, 255, 255] };
export const _LO = 55; // a channel this dark or this bright counts as off or on
export const _HI = 200;

/** The test card as RGB888 pixels, row by row. */
export function testcard(w, h) {
  const out = new Uint8Array(w * h * 3);
  let p = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = x < Math.floor(w / 2) ? 'r' : y < Math.floor(h / 2) ? 'g' : x < Math.floor((w * 3) / 4) ? 'b' : 'w';
      const rgb = TESTCARD_COLORS[c];
      out[p++] = rgb[0];
      out[p++] = rgb[1];
      out[p++] = rgb[2];
    }
  }
  return out;
}

let _crcTable = null;
function crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** zlib stream made of stored (uncompressed) deflate blocks. */
function zlibStored(data) {
  const parts = [Uint8Array.of(0x78, 0x01)];
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  for (let i = 0; i < data.length || i === 0; i += 65535) {
    const n = Math.min(65535, data.length - i);
    const last = i + n >= data.length;
    parts.push(Uint8Array.of(last ? 1 : 0, n & 0xff, n >> 8, ~n & 0xff, (~n >> 8) & 0xff), data.subarray(i, i + n));
    if (last) break;
  }
  parts.push(Uint8Array.of((b >> 8) & 0xff, b & 0xff, (a >> 8) & 0xff, a & 0xff));
  return concatAll(parts);
}

const be32 = (n) => Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);

/** The test card as PNG bytes (no compression library needed) to show on the screen while capturing. */
export function write_testcard(w = 320, h = 240) {
  const pix = testcard(w, h);
  const rows = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) rows.set(pix.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  const chunk = (kind, data) => {
    const k = ascii(kind);
    return concat(be32(data.length), k, data, be32(crc32(concat(k, data))));
  };
  const ihdr = concat(be32(w), be32(h), Uint8Array.of(8, 2, 0, 0, 0));
  return concat(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', ihdr),
    chunk('IDAT', zlibStored(rows)), chunk('IEND', new Uint8Array(0)));
}

export function _readings(fmt) {
  const out = [];
  for (const o of ['rgb', 'bgr']) for (const e of (fmt === 'rgb888' ? [null] : [LE, BE])) out.push([o, e]);
  return out;
}

export function _pixel(fmt, px, order, endian) {
  let a;
  let g;
  let c;
  if (fmt === 'rgb888') {
    [a, g, c] = [px[0], px[1], px[2]];
  } else {
    const v = readInt(px, 0, 2, endian);
    a = Math.floor(((v >> 11) * 255) / 31);
    g = Math.floor((((v >> 5) & 63) * 255) / 63);
    c = Math.floor(((v & 31) * 255) / 31);
  }
  return order === 'rgb' ? [a, g, c] : [c, g, a];
}

export function _color(p) {
  if (p.every((v) => v >= _HI)) return 'w';
  const on = p.map((v) => v >= _HI);
  if (on.filter(Boolean).length === 1 && p.every((v, i) => on[i] || v <= _LO)) return 'rgb'[on.indexOf(true)];
  return null;
}

export function _is_testcard(fmt, pix, order, endian, n) {
  const bpp = RAW[fmt];
  const total = Math.floor(pix.length / bpp);
  if (total < 16) return false;
  // spread the samples with the golden ratio: a plain stride can land on the same column every row
  const got = new Counter();
  for (let k = 0; k < n; k++) {
    const i = Math.floor(total * ((k * 0.6180339887) % 1));
    got.add(_color(_pixel(fmt, pix.subarray(i * bpp, (i + 1) * bpp), order, endian)));
  }
  let colored = 0;
  for (const [k, v] of got.m.values()) if (k) colored += v;
  if (colored < 0.85 * n) return false;
  return Object.entries(TESTCARD_SHARES).every(([c, share]) => Math.abs(got.get(c) / n - share) <= (share > 0.2 ? 0.1 : 0.06));
}

/**
 * `channel_order` ('rgb', 'bgr' or null for unknown) and the evidence: full frames that show
 * the test card under exactly one reading of the pixels. For RGB565 the test card also settles the
 * byte order (`byteorder` is replaced when the pixel smoothness guess disagreed). Confidence is
 * the share of matching frames that agree; below 0.9 the order stays unknown.
 */
export function _channel_order(frames, h, fmt, frame_bytes, byteorder, max_frames = 600, skip = 0) {
  const hits = new Counter();
  const seen = new Map();
  let checked = 0;
  // a long video is checked at an even stride (a card shown for a few seconds is still hit)
  const stride = Math.max(1, Math.ceil(frames.length / max_frames));
  for (let fi = 0; fi < frames.length; fi += stride) {
    const f = frames[fi];
    const pix = concatAll(f.map((t) => t.data.subarray(h))).subarray(skip, skip + frame_bytes);
    checked += 1;
    // a quick look at a few pixels first, the full sample only for likely frames
    const quick = _readings(fmt).filter((r) => _is_testcard(fmt, pix, r[0], r[1], 64));
    const match = quick.filter((r) => _is_testcard(fmt, pix, r[0], r[1], 2048));
    if (match.length === 1) {
      hits.add(match[0]);
      const k = JSON.stringify(match[0]);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(f[0].frame);
    }
  }
  const out = { channel_order: null, channel_evidence: null };
  if (!hits.size) return out;
  const [[order, endian], n] = hits.mostCommon()[0];
  const matched = hits.total();
  const conf = round2(n / matched);
  out.channel_evidence = {
    method: 'testcard', frames_checked: checked, frames_matched: matched,
    agree: n, confidence: conf, frames: seen.get(JSON.stringify([order, endian])).slice(0, 5),
    byteorder: endian,
  };
  if (conf >= 0.9) {
    out.channel_order = order;
    if (endian) {
      out.byteorder = endian;
      out.channel_evidence.byteorder_was = byteorder;
    }
  }
  return out;
}
