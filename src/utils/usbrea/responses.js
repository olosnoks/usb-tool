// Device replies: pair host->device queries with the device->host data that answers them.
// Port of usb-rea src/usb_rea/responses.py (MIT, (c) 2026 Emir Mrkaljević).
//
// A query is a host->device message (bulk/interrupt OUT, control SET_REPORT/vendor OUT) or a
// class/vendor control IN request (GET_REPORT). Its reply is the IN data that follows it:
// the completion of the same control request, or a bulk/interrupt IN transfer shortly after.
//
// Pairing runs in two passes. Pass 1 takes, for every query, the first IN transfer before the next
// host->device message; that tells which query groups get replies at all, on which endpoint, of
// what length and after what typical delay. Pass 2 assigns each IN transfer of such a shape to the
// outstanding query whose delay is closest to its group's typical delay, so a poll that lands
// between a command and the command's reply does not steal it.
//
// Reply bytes are explained with the same machinery as commands (constants, checksums, linear fits
// to label values with the leave-one-out guard), plus echo (repeats a query byte), counter, and
// reading (varies on its own; reported with its observed range, nothing more is claimed). A reading
// gets a name and a scale when 'seen <name> <value>' markers (what the vendor app displayed) fit it,
// and a value -> label map when the app showed words ('seen mode turbo').
//
// Port notes:
// - groups (name -> list of query transfers) is a Map; labels (query frame -> label) is a plain object or Map;
//   driven is a Set of offsets; pair() returns a Map name -> [shape, pairs, latency] with shape = [endpoint,
//   xfer_type, length] and pairs = [[query, reply|null], ...].
// - A named mode reading's Field.table is a Map raw -> label (sorted by raw); limits are [min, max] arrays.
// - Python id(transfer) keys become Maps/Sets keyed by the Transfer object itself.
import { Action } from './model.js';
import { hex } from './bytes.js';
import { fmt_fixed } from './pyfmt.js';
import { Command, Field, _fit_linear, _infer_command, _get } from './infer.js';

export const WINDOW = 0.5; // seconds: a reply later than this is not paired
export const MAX_REPLY = 64; // longer IN transfers are bulk data (sectors, frames), not answers to a query
export const SEEN_WINDOW = 1.0; // seconds: an observation is compared with replies at most this far away

// ---- small Python-isms ----

function bisect_left(a, x) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function bisect_right(a, x) {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < a[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** statistics.median */
function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) throw new Error('median of empty data');
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** round(x, 1) with Python's exact half-even behaviour. */
function round1(x) { return Number(fmt_fixed(x, 1)); }

/** Counter keyed by the JSON of the key (so tuples work); mostCommon keeps first-seen order on ties. */
class Counter {
  constructor() { this.m = new Map(); }
  add(k, n = 1) {
    const s = JSON.stringify(k);
    const e = this.m.get(s);
    if (e) e[1] += n;
    else this.m.set(s, [k, n]);
  }
  get(k) { return this.m.get(JSON.stringify(k))?.[1] ?? 0; }
  mostCommon() { return [...this.m.values()].sort((a, b) => b[1] - a[1]); }
}

function setEq(values, ...want) {
  const s = new Set(values);
  return s.size === want.length && want.every((w) => s.has(w));
}

const lab = (labels, frame) => (labels instanceof Map ? labels.get(frame) : labels[frame]) ?? '';
const bitLength = (x) => (x > 0 ? 32 - Math.clz32(x) : 0);
const asc = (a, b) => a - b;

export class Response {
  constructor({
    query, source, query_endpoint, query_xfer_type, query_setup, query_payload, endpoint, xfer_type, length,
    fields, answered, queries, latency_ms, samples, packet = 0, request = null, notes = [],
  }) {
    this.query = query; // command name, "poll N" or "GET_REPORT ..."
    this.source = source; // command | background | control read
    this.query_endpoint = query_endpoint;
    this.query_xfer_type = query_xfer_type;
    this.query_setup = query_setup;
    this.query_payload = query_payload; // query bytes, '??' where they vary
    this.endpoint = endpoint; // IN endpoint the reply arrives on
    this.xfer_type = xfer_type;
    this.length = length;
    this.fields = fields;
    this.answered = answered;
    this.queries = queries;
    this.latency_ms = latency_ms;
    this.samples = samples; // [label, query frame, reply hex, reply frame]
    this.packet = packet; // which packet of a multi-packet command it answers
    this.request = request; // how to send the query again (background polls)
    this.notes = notes;
  }

  get explained() {
    const seen = new Set();
    for (const f of this.fields) {
      if (f.kind !== 'reading' && f.kind !== 'unknown' || f.name) {
        for (let o = f.offset; o < f.offset + f.width; o++) seen.add(o);
      }
    }
    return seen.size;
  }
}

/** Class or vendor control IN request (GET_REPORT, vendor reads); standard requests are skipped. */
export function is_control_read(t) {
  return t.is_in && t.xfer_type === 2 && t.setup !== null && t.setup !== undefined && t.data.length === 0
    && [1, 2].includes((t.setup[0] >> 5) & 3);
}

export function _shape(t) {
  return [t.endpoint, t.xfer_type, t.data.length];
}

const shapeKey = (s) => s.join(',');

/**
 * groups: Map name -> list of query transfers. Returns Map name -> [shape, [[query, reply|null]], median latency s]
 * for the groups that get replies (at least 2 and at least half of their queries answered).
 */
export function pair(groups, transfers, window = WINDOW) {
  const ordered = [...transfers].sort((a, b) => a.frame - b.frame);
  const frames = ordered.map((t) => t.frame);
  const out = new Map();
  // control reads: the reply is the completion of the same request (EP0 transfers are serialised)
  const reads = new Map();
  for (const [n, qs] of groups) if (qs.length && is_control_read(qs[0])) reads.set(n, qs);
  for (const [name, qs] of reads) {
    let pairs = [];
    for (const q of qs) {
      let r = null;
      for (let j = bisect_right(frames, q.frame); j < ordered.length; j++) {
        const t = ordered[j];
        if (t.ts - q.ts > window) break;
        if (t.xfer_type === 2 && t.is_in && t.data.length && !(t.setup)) {
          r = t;
          break;
        }
      }
      pairs.push([q, r]);
    }
    let got = pairs.filter(([, r]) => r !== null);
    let shape = null;
    if (got.length) {
      const c = new Counter();
      for (const [, r] of got) c.add(_shape(r));
      shape = c.mostCommon()[0][0];
    }
    got = got.filter(([, r]) => shapeKey(_shape(r)) === shapeKey(shape));
    if (got.length >= 2 && got.length >= 0.5 * qs.length && shape[2] <= MAX_REPLY) {
      pairs = pairs.map(([q, r]) => [q, r !== null && shapeKey(_shape(r)) === shapeKey(shape) ? r : null]);
      out.set(name, [shape, pairs, median(got.map(([q, r]) => r.ts - q.ts))]);
    }
  }

  // pass 1: queries sent back to back (no IN in between) form a run. A run of one takes the first IN
  // transfer before the next host->device message; a longer run is paired in order, but only when it
  // is followed by exactly as many IN transfers (otherwise it is left out of the statistics)
  const ins = ordered.filter((t) => t.is_in && t.data.length && t.xfer_type !== 2);
  const in_frames = ins.map((t) => t.frame);
  const outs = ordered.filter((t) => t.is_out && t.data.length);
  const first = new Map();
  const decided = new Set();
  let i = 0;
  while (i < outs.length) {
    const run = [outs[i]];
    const nxt = bisect_right(in_frames, outs[i].frame);
    while (i + run.length < outs.length && (nxt >= ins.length || outs[i + run.length].frame < ins[nxt].frame)) {
      run.push(outs[i + run.length]);
    }
    i += run.length;
    const stop = i < outs.length ? outs[i].frame : null;
    let after = ins.slice(nxt, nxt + run.length + 1).filter((r) => stop === null || r.frame < stop);
    if (run.length === 1) after = after.slice(0, 1);
    else if (after.length !== run.length) continue;
    for (const q of run) decided.add(q);
    for (let k = 0; k < Math.min(run.length, after.length); k++) {
      if (after[k].ts - run[k].ts <= window) first.set(run[k], after[k]);
    }
  }
  const replying = new Map();
  for (const [name, qs] of groups) {
    if (reads.has(name) || !qs.length) continue;
    const shapes = new Counter();
    for (const q of qs) if (first.has(q)) shapes.add(_shape(first.get(q)));
    const mc = shapes.mostCommon();
    if (!mc.length) continue;
    const [shape, n] = mc[0];
    if (n >= 2 && n >= 0.5 * qs.filter((q) => decided.has(q)).length && shape[2] <= MAX_REPLY) {
      const lat = median(qs.filter((q) => first.has(q) && shapeKey(_shape(first.get(q))) === shapeKey(shape))
        .map((q) => first.get(q).ts - q.ts));
      replying.set(name, [shape, lat]);
    }
  }

  // pass 2: each reply goes to the outstanding query whose delay best matches its group's typical delay
  const queries = [];
  for (const n of replying.keys()) for (const q of groups.get(n)) queries.push([q, n]);
  queries.sort((a, b) => a[0].frame - b[0].frame);
  const shapes = new Set([...replying.values()].map(([s]) => shapeKey(s)));
  const got = new Map();
  let pending = [];
  let qi = 0;
  for (const r of ins) {
    if (!shapes.has(shapeKey(_shape(r)))) continue;
    while (qi < queries.length && queries[qi][0].frame < r.frame) {
      pending.push(queries[qi]);
      qi += 1;
    }
    pending = pending.filter(([q]) => r.ts - q.ts <= window && !got.has(q));
    let best = null;
    for (const [q, n] of pending) {
      const [shape, lat] = replying.get(n);
      if (shapeKey(shape) !== shapeKey(_shape(r))) continue;
      const err = Math.abs((r.ts - q.ts) - lat);
      if (err <= Math.max(4 * lat, 0.05) && (best === null || err < best[0])) best = [err, q];
    }
    if (best) got.set(best[1], r);
  }
  for (const [name, [shape]] of replying) {
    const pairs = groups.get(name).map((q) => [q, got.get(q) ?? null]);
    const done = pairs.filter(([, r]) => r !== null);
    if (done.length >= 2) out.set(name, [shape, pairs, median(done.map(([q, r]) => r.ts - q.ts))]);
  }
  return out;
}

export function _pattern(datas) {
  const n = Math.min(...datas.map((d) => d.length));
  const out = [];
  for (let i = 0; i < n; i++) {
    const v = datas[0][i];
    out.push(datas.every((d) => d[i] === v) ? v.toString(16).padStart(2, '0') : '??');
  }
  return out.join(' ');
}

/**
 * Infer the byte roles of one group's replies. labels: query frame -> action label;
 * driven: query offsets that carry the label value (a reply byte copying those is fitted, not echoed);
 * seen: observations ('seen rpm 1180' markers, see actions.observations) used to name readings.
 */
export function decode(name, source, pairs, shape, latency, labels = {}, packet = 0, driven = new Set(), seen = []) {
  labels = labels || {};
  const got = pairs.filter(([, r]) => r !== null).sort((a, b) => a[1].frame - b[1].frame);
  const q0 = got[0][0];
  const length = shape[2];
  const notes = [];
  const acts = got.map(([q]) => new Action({ label: lab(labels, q.frame), start: 0, end: 0 }));
  const items = acts.map((a, k) => [a, got[k][1]]);
  const labelled = acts.some((a) => a.values.length);
  const datas = got.map(([, r]) => r.data);
  const qdatas = got.map(([q]) => q.data);
  const frames = got.map(([, r]) => r.frame);
  const qlen = qdatas.length ? Math.min(...qdatas.map((d) => d.length)) : 0;

  const echo_of = (o, skip = new Set()) => {
    for (let k = 0; k < qlen; k++) {
      if (!skip.has(k) && new Set(qdatas.map((d) => d[k])).size > 1
        && qdatas.every((q, j) => datas[j][o] === q[k])) return k;
    }
    return null;
  };

  // echo of a sequence number or other non-label byte: claimed before fitting, so a counter that
  // happens to rise with the values is not mistaken for one
  const preset = new Map();
  for (let o = 0; o < length; o++) {
    const k = echo_of(o, driven);
    if (k !== null) preset.set(o, new Field({ offset: o, kind: 'echo', echo: k, frames }));
  }
  const c = _infer_command(name, items, length, [], new Map(), false, preset);
  const by_off = new Map(c.fields.map((f) => [f.offset, f]));

  const unknown = (o) => by_off.has(o) && by_off.get(o).kind === 'unknown';

  // echo of a label-driven query byte that no fit explained
  for (let o = 0; o < length; o++) {
    if (unknown(o) && echo_of(o) !== null) by_off.set(o, new Field({ offset: o, kind: 'echo', echo: echo_of(o), frames }));
  }
  // counter: steps by the same non-zero amount from one reply to the next
  if (datas.length >= 4) {
    for (let o = 0; o < length; o++) {
      if (unknown(o)) {
        const steps = new Set();
        for (let j = 0; j + 1 < datas.length; j++) steps.add((datas[j + 1][o] - datas[j][o]) & 0xFF);
        if (steps.size === 1 && !steps.has(0)) by_off.set(o, new Field({ offset: o, kind: 'counter', step: [...steps][0], frames }));
      }
    }
  }
  // readings: whatever still varies. Two neighbouring bytes are read as one 16-bit number only when
  // one byte order changes smoothly and the other jumps (needs 8+ replies)
  let o = 0;
  while (o < length) {
    if (!unknown(o)) {
      o += 1;
      continue;
    }
    let width = 1;
    let end = 'le';
    if (unknown(o + 1) && datas.length >= 8) {
      const tv = {};
      for (const e of ['le', 'be']) {
        let s = 0;
        for (let j = 0; j + 1 < datas.length; j++) s += Math.abs(_get(datas[j + 1], o, 2, e) - _get(datas[j], o, 2, e));
        tv[e] = s;
      }
      for (const [e, other] of [['le', 'be'], ['be', 'le']]) {
        if (tv[e] * 8 < tv[other]) {
          width = 2;
          end = e;
        }
      }
    }
    const vals = datas.map((d) => _get(d, o, width, end));
    by_off.set(o, new Field({
      offset: o, kind: 'reading', width, endian: end, limits: [Math.min(...vals), Math.max(...vals)], frames,
    }));
    if (width === 2) by_off.delete(o + 1);
    o += width;
  }
  let fields = [...by_off.keys()].sort(asc).map((k) => by_off.get(k));
  for (const f of fields) {
    f.observed = [];
    f.frames = f.frames.slice(0, 20);
  }
  if (seen && seen.length) fields = name_readings(fields, got.map(([, r]) => r), seen, notes);
  const readings = fields.filter((f) => f.kind === 'reading' && !f.name);
  const hint = 'mark what the vendor app displays (e.g. `usb-rea mark "seen rpm 1180"`) to name them';
  if (readings.length) {
    const where = (readings.length === 1 && readings[0].width === 1 ? 'byte ' : 'bytes ')
      + readings.map((f) => `${f.offset}` + (f.width === 2 ? `-${f.offset + 1}` : '')).join(', ');
    if (labelled) {
      notes.push(`${where} vary but do not follow the action values; they are listed as readings `
        + `(meaning unknown, only the observed range is given); ${hint}`);
    } else {
      notes.push(`${where} vary with no label to explain them: listed as readings with their observed `
        + `range; label actions with the value you set (e.g. 'fan 1200') to fit them, or ${hint}`);
    }
    if (readings.some((f) => f.width === 2)) {
      notes.push('16-bit readings: byte order chosen because that order changes smoothly between replies '
        + 'and the other jumps');
    }
  }
  if (got.length < 3) notes.push('fewer than 3 replies: record more to raise confidence');
  const missing = pairs.length - got.length;
  if (missing) notes.push(`${missing} of ${pairs.length} queries got no reply of this shape within ${WINDOW} s`);
  const samples = got.slice(0, 20).map(([q, r]) => [lab(labels, q.frame), q.frame, hex(r.data, ' '), r.frame]);
  const payload = qdatas.length && qlen ? _pattern(qdatas) : '';
  return new Response({
    query: name, source, query_endpoint: q0.endpoint, query_xfer_type: q0.xfer_type, query_setup: q0.setup,
    query_payload: payload, endpoint: shape[0], xfer_type: shape[1], length, fields, answered: got.length,
    queries: pairs.length, latency_ms: round1(latency * 1000), samples, packet, request: null, notes,
  });
}

export function _tol(v) {
  return Math.max(1.0, 0.01 * Math.abs(v)); // the app rounds what it shows: one unit, or 1% of big numbers
}

const fieldSort = (a, b) => a.offset - b.offset || (a.bit_offset || 0) - (b.bit_offset || 0);

/**
 * Give readings the names of what the vendor app showed ('seen rpm 1180').
 *
 * Each observation is compared with the last reply before it (what the app was showing when the
 * marker was typed) or, failing that, the first one after it, within SEEN_WINDOW; if that does not
 * fit, the other way round. A reading takes the name when it equals every observation of that name
 * (2+ observations, within one unit or 1%; a value shown with decimals may also be sent as tenths,
 * hundredths or thousandths, 'seen temp 41.5' as raw 415), or when a linear raw = value * scale + bias
 * fits them exactly and survives leave-one-out (3+ observations, as for commands). Two neighbouring byte
 * readings are also tried as one 16-bit LE/BE number, and four (or three plus a 0x00 high byte) as one
 * 32-bit LE/BE number, e.g. energy counters or uptime. When the app showed a negative value ('seen
 * temp -5'), 8/16-bit readings are also tried as signed (two's complement) numbers. A name only ever
 * seen as on/off ('seen pump on', 'seen pump off') is a status flag: it takes the one bit of a byte
 * reading that is 1 exactly when the app showed 'on' (see name_flag); one seen as words ('seen mode
 * silent', 'seen mode turbo') is a mode with one raw value per word (see name_mode). A name that
 * fits more than one place is left out, with a note.
 */
export function name_readings(fields, replies, seen, notes) {
  const rts = replies.map((r) => r.ts);

  const near = (ts, after) => {
    const i = bisect_left(rts, ts);
    const a = i < replies.length && rts[i] - ts <= SEEN_WINDOW ? replies[i] : null;
    const b = i && ts - rts[i - 1] <= SEEN_WINDOW ? replies[i - 1] : null;
    return after ? (a || b) : (b || a);
  };

  const by_name = new Map();
  for (const o of seen) {
    if (!by_name.has(o.name)) by_name.set(o.name, []);
    by_name.get(o.name).push(o);
  }
  // on/off flags first, words last: a mode or a small level may share its byte with flags
  const order = (obs) => {
    const vals = obs.map((o) => o.value);
    return vals.some((v) => typeof v === 'string') ? 2 : (setEq(vals, 0, 1) ? 0 : 1);
  };
  const entries = [...by_name.entries()].sort((a, b) => order(a[1]) - order(b[1]));
  for (const [name, obs] of entries) {
    const tries = [false, true].map((after) => {
      const pts = [];
      for (const o of obs) {
        const r = near(o.ts, after);
        if (r) pts.push([o, r]);
      }
      return pts;
    });
    const words = new Set(obs.map((o) => typeof o.value === 'string'));
    if (words.size > 1) {
      notes.push(`'${name}' was seen both as a number and as a word: left unnamed; `
        + 'use one kind of value per name');
      continue;
    }
    if (words.size === 1 && words.has(true)) {
      fields = name_mode(name, fields, replies, tries, notes);
      continue;
    }
    if (setEq(obs.map((o) => o.value), 0, 1)) {
      fields = name_flag(name, fields, replies, tries, notes);
      continue;
    }
    const free = fields.filter((f) => f.kind === 'reading' && !f.name);
    let cands = free.map((f) => [f.offset, f.width, f.endian]);
    for (let k = 0; k + 1 < free.length; k++) {
      const f = free[k];
      const g = free[k + 1];
      if (f.width === 1 && g.width === 1 && g.offset === f.offset + 1) {
        for (const e of ['le', 'be']) cands.push([f.offset, 2, e]);
      }
    }
    for (const [off, e] of _u32_spans(fields)) cands.push([off, 4, e]);
    // a negative value on screen: 8/16-bit readings whose top bit gets set may be two's complement
    const minv = Math.min(...obs.map((o) => o.value));
    cands = cands.map((c) => [...c, false]).concat(
      cands.filter((c) => c[1] <= 2 && minv < 0 && replies.some((r) => _get(r.data, c[0], c[1], c[2], true) < 0))
        .map((c) => [...c, true]));
    // a value shown with decimals ('seen temp 41.5') is often sent as tenths, hundredths or thousandths
    const scales = obs.some((o) => o.value !== Math.trunc(o.value)) ? [1.0, 10.0, 100.0, 1000.0] : [1.0];
    const exact = [];
    const fitted = [];
    for (const [off, w, end, sg] of cands) {
      const xy = tries.map((pts) => [pts.map(([o]) => o.value), pts.map(([, r]) => _get(r.data, off, w, end, sg)), pts]);
      const same = [];
      for (const k of scales) {
        xy.forEach(([xs, ys, pts], i) => {
          if (pts.length >= 2 && xs.every((x, j) => Math.abs(ys[j] - x * k) <= _tol(x * k))) {
            let s = 0;
            xs.forEach((x, j) => { s += Math.abs(ys[j] - x * k); });
            same.push([s / k, k, i, pts]);
          }
        });
      }
      same.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
      const fits = [];
      for (const [xs, ys, pts] of xy) {
        if (pts.length >= 3) {
          const fit = _fit_linear(xs, ys);
          if (fit !== null && fit !== undefined && !(fit[0] === 1 && fit[1] === 0)) fits.push([fit[0], fit[1], pts]);
        }
      }
      if (same.length) exact.push([off, w, end, sg, same[0][1], 0.0, same[0][3]]); // the closer pairing and scale
      else if (fits.length) fitted.push([off, w, end, sg, ...fits[0]]);
    }
    const hits = exact.length ? exact : fitted;
    if (!hits.length && obs.every((o) => o.value >= 0 && o.value === Math.trunc(o.value))) {
      fields = name_level(name, fields, replies, tries, notes);
      continue;
    }
    if (hits.length > 1) {
      const where = hits.map(([o, w, e, sg]) => (w > 1 ? `${o}-${o + w - 1} ${e}` : `${o}`) + (sg ? ' signed' : '')).join(', ');
      notes.push(`'${name}' fits several readings (bytes ${where}): left unnamed; `
        + 'note values while they differ more');
    }
    if (hits.length !== 1) continue;
    const [off, w, end, sg, scale, bias, pts] = hits[0];
    const vals = replies.map((r) => _get(r.data, off, w, end, sg));
    const f = new Field({
      offset: off, kind: 'reading', width: w, endian: end, scale, bias, limits: [Math.min(...vals), Math.max(...vals)],
      name, signed: sg, frames: replies.map((r) => r.frame).slice(0, 20),
      observed: pts.map(([o, r]) => [o.value, _get(r.data, off, w, end, sg), r.frame, o.time]),
    });
    fields = fields.filter((x) => !(off <= x.offset && x.offset < off + w)).concat([f]).sort((a, b) => a.offset - b.offset);
  }
  const named = [...new Set(fields.filter((f) => f.bit_width && f.name).map((f) => f.offset))].sort(asc);
  for (const off of named) {
    let rest = 0;
    for (let j = 0; j + 1 < replies.length; j++) rest |= replies[j].data[off] ^ replies[j + 1].data[off];
    rest &= ~_named_bits(fields, off) & 0xFF;
    if (rest) {
      notes.push(`byte ${off}: bits other than the named ones also change (mask 0x${rest.toString(16).padStart(2, '0')}); not described`);
    }
  }
  return fields;
}

/**
 * Small number packed into part of a byte ('seen level 3', 'seen battery 2'), tried only when no
 * whole reading fits: the free bits beside named flags or modes (each contiguous run, trimmed to the
 * bits that change between replies, so reserved bits that stay fixed are left out), or either nibble
 * of an unnamed byte reading. The raw bits must equal every observation of a pairing
 * with 2+ observations and 2+ different values. A level that fits more than one place is left out.
 */
export function name_level(name, fields, replies, tries, notes) {
  const groups = [];
  const offs = [...new Set(fields.filter((f) => f.kind === 'reading' && f.name && f.bit_width).map((f) => f.offset))].sort(asc);
  for (const off of offs) {
    const used = _named_bits(fields, off);
    let bit = 0;
    while (bit < 8) {
      if ((used >> bit) & 1) {
        bit += 1;
        continue;
      }
      const lo = bit;
      while (bit < 8 && !((used >> bit) & 1)) bit += 1;
      let ch = 0;
      for (let j = 0; j + 1 < replies.length; j++) {
        ch |= ((replies[j].data[off] ^ replies[j + 1].data[off]) >> lo) & ((1 << (bit - lo)) - 1);
      }
      if (ch & (ch - 1)) { // 2+ changing bits: from the lowest to the highest of them
        const a = bitLength(ch & -ch) - 1;
        const z = bitLength(ch);
        groups.push([off, lo + a, z - a]);
      }
    }
  }
  for (const f of fields) {
    if (f.kind === 'reading' && f.width === 1 && !f.name && !f.bit_width) {
      for (const lo of [0, 4]) groups.push([f.offset, lo, 4]);
    }
  }
  const hits = [];
  for (const [off, lo, bw] of groups) {
    const get = (d) => (d[off] >> lo) & ((1 << bw) - 1);
    const pts = tries.find((p) => p.length >= 2 && new Set(p.map(([o]) => o.value)).size >= 2
      && p.every(([o, r]) => get(r.data) === o.value));
    if (pts) hits.push([off, lo, bw, pts]);
  }
  if (hits.length > 1) {
    const where = hits.map(([o, lo, bw]) => `byte ${o} bits ${lo}-${lo + bw - 1}`).join(', ');
    notes.push(`'${name}' fits several bit groups (${where}): left unnamed; note values while they differ more`);
  }
  if (hits.length !== 1) return fields;
  const [off, lo, bw, pts] = hits[0];
  const get = (d) => (d[off] >> lo) & ((1 << bw) - 1);
  const vals = replies.map((r) => get(r.data));
  const f = new Field({
    offset: off, kind: 'reading', width: 1, endian: 'le', scale: 1.0, bias: 0.0,
    limits: [Math.min(...vals), Math.max(...vals)], name, bit_offset: lo, bit_width: bw,
    frames: replies.map((r) => r.frame).slice(0, 20),
    observed: pts.map(([o, r]) => [o.value, get(r.data), r.frame, o.time]),
  });
  return fields.filter((x) => !(x.offset === off && !x.name)).concat([f]).sort(fieldSort);
}

/** Mask of the bits of byte `off` already taken by named flags and modes. */
export function _named_bits(fields, off) {
  let s = 0;
  for (const f of fields) {
    if (f.offset === off && f.name && f.bit_width) s += ((1 << f.bit_width) - 1) << f.bit_offset;
  }
  return s;
}

/**
 * [offset, byte order] of 4-byte windows that could hold one 32-bit reading: unnamed 8/16-bit
 * readings that fill it exactly, or fill three bytes with a constant 0x00 as the high byte (a
 * counter that has not reached 2**24 yet). Needs 3+ varying bytes, so a u16 reading next to zero
 * padding is never also offered as u32.
 */
export function _u32_spans(fields) {
  const at = new Map(fields.map((f) => [f.offset, f]));
  const out = [];
  for (const off of [...at.keys()].sort(asc)) {
    const free = [];
    let end = off;
    while (at.has(end) && end < off + 4) {
      const f = at.get(end);
      if (f.kind === 'reading' && !f.name && !f.bit_width) {
        for (let k = end; k < end + f.width; k++) free.push(k);
      } else if (!(f.kind === 'const' && f.const === 0 && f.width === 1)) {
        break;
      }
      end += f.width;
    }
    if (end !== off + 4 || free.length < 3) continue;
    for (const [e, high] of [['le', off + 3], ['be', off]]) {
      if (free.length === 4 || !free.includes(high)) out.push([off, e]);
    }
  }
  return out;
}

/**
 * Status flag ('seen pump on' / 'seen pump off'): the bit of a byte reading that is 1 every time
 * the app showed on and 0 every time it showed off (both states must be seen). Several flags can share
 * a byte; a bit that is not alone in fitting (two bits that always flip together) is left unnamed.
 */
export function name_flag(name, fields, replies, tries, notes) {
  const offs = [...new Set(fields.filter((f) => f.kind === 'reading' && f.width === 1 && (!f.name || f.bit_width))
    .map((f) => f.offset))].sort(asc);
  const hits = [];
  for (const off of offs) {
    for (let bit = 0; bit < 8; bit++) {
      if ((_named_bits(fields, off) >> bit) & 1) continue;
      const pts = tries.find((p) => setEq(p.map(([o]) => o.value), 0, 1)
        && p.every(([o, r]) => ((r.data[off] >> bit) & 1) === o.value));
      if (pts) hits.push([off, bit, pts]);
    }
  }
  if (hits.length > 1) {
    const where = hits.map(([o, b]) => `byte ${o} bit ${b}`).join(', ');
    notes.push(`'${name}' (on/off) fits several bits (${where}): left unnamed; note it while other states differ`);
  }
  if (hits.length !== 1) return fields;
  const [off, bit, pts] = hits[0];
  const f = new Field({
    offset: off, kind: 'reading', width: 1, endian: 'le', limits: [0, 1], name, bit_offset: bit, bit_width: 1,
    frames: replies.map((r) => r.frame).slice(0, 20),
    observed: pts.map(([o, r]) => [o.value, (r.data[off] >> bit) & 1, r.frame, o.time]),
  });
  return fields.filter((x) => !(x.offset === off && !x.name)).concat([f]).sort(fieldSort);
}

/**
 * Mode or other enum value ('seen mode silent', 'seen mode turbo', 'seen profile gaming'): a byte
 * reading whose raw value is the same every time the app showed one word and differs between words.
 * Needs 2+ different words and 3+ observations, so at least one word is seen twice and could have
 * disagreed. When the whole byte does not give one value per word (other bits change on their own),
 * or it holds named flags, only the bits that differ between the words are tried (one contiguous
 * group, e.g. bits[4:6]). Both bytes of an unnamed 16-bit reading are tried too (a rarely changing
 * mode byte next to a drifting one looks like one u16), and the other byte becomes a u8 reading again.
 * A mode that fits more than one place is left unnamed, with a note.
 */
export function name_mode(name, fields, replies, tries, notes) {
  const offSet = new Set(fields.filter((f) => f.kind === 'reading' && f.width === 1 && (!f.name || f.bit_width))
    .map((f) => f.offset));
  for (const f of fields) {
    if (f.kind === 'reading' && f.width === 2 && !f.name) {
      offSet.add(f.offset);
      offSet.add(f.offset + 1);
    }
  }
  const offs = [...offSet].sort(asc);
  const hits = [];
  for (const off of offs) {
    const used = _named_bits(fields, off);
    for (const pts of tries) {
      if (pts.length < 3 || new Set(pts.map(([o]) => o.value)).size < 2) continue;
      const raws = pts.map(([, r]) => r.data[off] & ~used);
      let diff = 0;
      for (const x of raws) diff |= x ^ raws[0];
      if (!diff) continue;
      const lowbit = bitLength(diff & -diff);
      const lo = lowbit - 1;
      const bw = bitLength(diff) - lowbit + 1;
      const mask = ((1 << bw) - 1) << lo;
      if (mask & used) continue;
      // the whole byte first (other bits may still change between modes); if it is not one value
      // per word, or the byte holds named flags, only the bits that differ between the words
      let table = null;
      let group = false;
      let found = false;
      for (const g of (used ? [true] : [false, true])) {
        group = g;
        table = new Map();
        const ok = raws.every((x, j) => {
          const key = g ? (x >> lo) & ((1 << bw) - 1) : x;
          const val = pts[j][0].value;
          if (!table.has(key)) table.set(key, val); // setdefault
          return table.get(key) === val;
        });
        if (ok && table.size === new Set(pts.map(([o]) => o.value)).size) {
          found = true;
          break;
        }
      }
      if (!found) continue;
      hits.push([off, group ? [lo, bw] : [null, null], table, pts]);
      break;
    }
  }
  if (hits.length > 1) {
    const where = hits.map(([o, [bo, bw]]) => `byte ${o}` + (bo !== null ? ` bits[${bo}:${bo + bw}]` : '')).join(', ');
    const words = [...new Set(tries.flatMap((pts) => pts.map(([o]) => o.value)))].sort().join(', ');
    notes.push(`'${name}' (${words}) fits several places (${where}): left unnamed; `
      + 'note it while other readings differ');
  }
  if (hits.length !== 1) return fields;
  const [off, [bo, bw], table, pts] = hits[0];
  const get = bo === null ? (d) => d[off] : (d) => (d[off] >> bo) & ((1 << bw) - 1);
  const vals = replies.map((r) => get(r.data));
  const f = new Field({
    offset: off, kind: 'reading', width: 1, endian: 'le', limits: [Math.min(...vals), Math.max(...vals)], name,
    table: new Map([...table.entries()].sort((a, b) => a[0] - b[0])), bit_offset: bo, bit_width: bw,
    frames: replies.map((r) => r.frame).slice(0, 20),
    observed: pts.map(([o, r]) => [o.value, get(r.data), r.frame, o.time]),
  });
  const rest = [];
  for (const x of fields) {
    if (x.kind === 'reading' && !x.name && x.width === 2 && x.offset <= off && off <= x.offset + 1) {
      const other = x.offset + (off === x.offset ? 1 : 0); // the byte of the u16 reading that is not the mode
      const vs = replies.map((r) => r.data[other]);
      rest.push(new Field({ offset: other, kind: 'reading', limits: [Math.min(...vs), Math.max(...vs)], frames: x.frames }));
    } else if (!(x.offset === off && !x.name)) {
      rest.push(x);
    }
  }
  return rest.concat([f]).sort(fieldSort);
}

/**
 * A constant reply byte that equals a constant query byte, with different values for different
 * queries on the same reply endpoint, is an echoed command id.
 * qconsts: Map query name -> Map offset -> value.
 */
export function link_command_ids(responses, qconsts) {
  const by_ep = new Map();
  for (const r of responses) {
    if (qconsts.has(r.query)) {
      if (!by_ep.has(r.endpoint)) by_ep.set(r.endpoint, []);
      by_ep.get(r.endpoint).push(r);
    }
  }
  for (const rs of by_ep.values()) {
    if (rs.length < 2) continue;
    const maxLen = Math.max(...rs.map((r) => r.length));
    for (let o = 0; o < maxLen; o++) {
      const hit = [];
      for (const r of rs) for (const f of r.fields) if (f.offset === o && f.kind === 'const') hit.push([r, f]);
      if (hit.length < 2 || new Set(hit.map(([, f]) => f.const)).size < 2) continue;
      let ks = null;
      for (const [r, f] of hit) {
        const mine = new Set();
        for (const [k, v] of qconsts.get(r.query)) if (v === f.const) mine.add(k);
        ks = ks === null ? mine : new Set([...ks].filter((k) => mine.has(k)));
      }
      if (ks.size) {
        const m = Math.min(...ks);
        for (const [, f] of hit) {
          f.kind = 'echo';
          f.echo = m;
        }
      }
    }
  }
}

/** Explain a background poll's own bytes (constant, sequence counter, checksum) so a driver can send it. */
export function query_command(name, qs) {
  qs = [...qs].sort((a, b) => a.frame - b.frame);
  const n = Math.min(...qs.map((t) => t.data.length));
  qs = qs.filter((t) => t.data.length === n);
  // checksums first: a sum over a +1 sequence byte also counts up by one
  const c = _infer_command(name, qs.map((t) => [new Action({ label: name, start: 0, end: 0 }), t]), n, [], new Map(), false);
  for (const f of c.fields) {
    if (f.kind === 'unknown' && qs.length >= 4) {
      const steps = new Set();
      for (let j = 0; j + 1 < qs.length; j++) steps.add((qs[j + 1].data[f.offset] - qs[j].data[f.offset]) & 0xFF);
      if (steps.size === 1 && !steps.has(0)) {
        f.kind = 'counter';
        f.step = [...steps][0];
      }
    }
  }
  for (const f of c.fields) {
    f.observed = [];
    f.frames = f.frames.slice(0, 20);
  }
  c.frames = c.frames.slice(0, 20);
  c.samples = c.samples.slice(0, 5);
  c.notes = [];
  return c;
}

/**
 * Find and decode the replies to inferred commands, background polls and control reads.
 * background: [{ids: [Transfer...], ...}] as produced by the background detector (b.ids holds the Transfer
 * objects, as Python's id() values did, or any keys that map through the same transfers list);
 * seen: 'seen <name> <value>' observations (actions.observations) that can name readings.
 */
export function analyze_responses(transfers, commands, background, seen = []) {
  const by_frame = new Map(transfers.map((t) => [t.frame, t]));
  const groups = new Map();
  const meta = new Map();
  for (const c of commands) {
    [c, ...c.steps].forEach((step, j) => {
      const qs = step.samples.filter(([, , fr]) => by_frame.has(fr)).map(([, , fr]) => by_frame.get(fr));
      if (qs.length) {
        const key = `${c.name}\x00${j}`;
        groups.set(key, qs);
        const driven = new Set();
        for (const f of step.fields) {
          if (['value', 'bitfield', 'lookup'].includes(f.kind)) for (let i = f.offset; i < f.offset + f.width; i++) driven.add(i);
        }
        const labels = {};
        for (const [lb, , fr] of step.samples) labels[fr] = lb;
        meta.set(key, [c.name, 'command', labels, j, driven]);
      }
    });
  }
  // background polls list their transfers (b.ids holds Transfer objects, as Python's id() values did;
  // plain numbers are taken as frame numbers)
  const known = new Set(transfers);
  const resolve = (x) => (typeof x === 'number' ? by_frame.get(x) ?? null : (known.has(x) ? x : null));
  background.forEach((b, i0) => {
    const qs = [...b.ids].map(resolve).filter((x) => x !== null);
    if (qs.length) {
      const key = `poll ${i0 + 1}`;
      groups.set(key, qs);
      meta.set(key, [key, 'background', {}, 0, new Set()]);
    }
  });
  const reads = new Map();
  for (const t of transfers) {
    if (is_control_read(t)) {
      const k = hex(t.setup);
      if (!reads.has(k)) reads.set(k, [t.setup, []]);
      reads.get(k)[1].push(t);
    }
  }
  for (const [setup, qs] of reads.values()) {
    const kind = { 1: 'Input', 2: 'Output', 3: 'Feature' }[setup[3]] ?? `type ${setup[3]}`;
    const name = (setup[0] & 0x60) === 0x20 && setup[1] === 0x01
      ? `GET_REPORT ${kind} 0x${setup[2].toString(16).padStart(2, '0')}`
      : `control read ${hex(setup.subarray(0, 4))}`;
    groups.set(name, qs);
    meta.set(name, [name, 'control read', {}, 0, new Set()]);
  }

  const paired = pair(groups, transfers);
  const out = [];
  const used = new Map();
  for (const key of groups.keys()) {
    if (!paired.has(key)) continue;
    const [name, source, labels, j, driven] = meta.get(key);
    if (used.has(name)) continue; // one reply per command: the first packet of the transaction that gets one
    used.set(name, key);
    const [shape, pairs, lat] = paired.get(key);
    const r = decode(name, source, pairs, shape, lat, labels, j, driven, seen);
    if (source === 'background') r.request = query_command(name, groups.get(key));
    out.push(r);
  }
  const qconsts = new Map();
  for (const [name, key] of used) {
    const qs = groups.get(key);
    if (qs[0].data.length) {
      const n = Math.min(...qs.map((t) => t.data.length));
      const m = new Map();
      for (let k = 0; k < n; k++) if (new Set(qs.map((t) => t.data[k])).size === 1) m.set(k, qs[0].data[k]);
      qconsts.set(name, m);
    }
  }
  link_command_ids(out, qconsts);
  return out;
}
