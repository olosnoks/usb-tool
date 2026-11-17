// Per-action diffing and protocol inference. Every claim carries frame evidence. Port of usb_rea/infer.py.
//
// Byte roles: const, command, value (linear, 8/16/32-bit LE/BE), bitfield (packed bits),
// lookup (value->byte table), counter (increments per message), checksum (sum/xor/CRC8/CRC16),
// unknown. Device replies (see responses.js) add echo and reading.
//
// Port notes: lookup `table` fields are built as Map (number -> byte); every reader here also accepts a
// plain object (see table_items/table_get). `counters` / `preset` arguments of _infer_command accept a Map or
// a plain object keyed by offset. Python int/float are both JS numbers.
import { commands_of } from './actions.js';
import { CHECKSUMS, compute } from './checksums.js';
import { split_values } from './model.js';
import { hex, readInt, writeInt } from './bytes.js';
import { fmt_g, fmt_hex } from './pyfmt.js';

// ---- small Python-compat helpers -------------------------------------------------------------

/** Python round(x) (half to even) -> integer; round(x, nd) -> float. */
export function py_round_n(x, nd = 0) {
  if (!Number.isFinite(x)) return x;
  if (nd === 0) {
    const f = Math.floor(x);
    const d = x - f;
    if (d < 0.5) return f;
    if (d > 0.5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  }
  const m = 10 ** nd;
  // exact tie only when the lowest set bit of x sits exactly one place below 10^-nd
  let y = Math.abs(x);
  let e = 0;
  if (y !== 0) {
    while (!Number.isInteger(y)) { y *= 2; e -= 1; }
    while (y % 2 === 0) { y /= 2; e += 1; }
    if (e + nd === -1) {
      const t = x * m; // exactly k + 0.5
      const f = Math.floor(t);
      const k = f % 2 === 0 ? f : f + 1;
      return k / m;
    }
  }
  const r = Number(x.toFixed(nd));
  return r === 0 ? 0 : r;
}

/** `:g` for a number (also used for table keys and state values). */
export function fmtg(v) {
  return fmt_g(v === 0 ? 0 : v);
}

/** entries of a dict held as Map or plain object; numeric-looking keys of an object become numbers. */
export function table_items(t) {
  if (!t) return [];
  if (t instanceof Map) return [...t];
  return Object.entries(t).map(([k, v]) => [/^-?\d+(\.\d+)?$/.test(k) ? Number(k) : k, v]);
}
export function table_get(t, k) {
  if (!t) return undefined;
  if (t instanceof Map) return t.get(k);
  return t[k];
}
/** Python truthiness of a dict held as Map or object. */
export function table_truthy(t) {
  if (!t) return false;
  return t instanceof Map ? t.size > 0 : Object.keys(t).length > 0;
}

function checksum_items() {
  return CHECKSUMS instanceof Map ? [...CHECKSUMS] : Object.entries(CHECKSUMS);
}

const endianName = (e) => (e === 'le' ? 'little' : 'big');

export class Field {
  constructor({
    offset, kind, width = 1, endian = 'le', const: c = null, index = 0, scale = null, bias = null, table = null,
    step = null, algo = null, covers = null, source = null, bit_offset = null, bit_width = null, echo = null,
    limits = null, name = null, signed = false, observed = [], frames = [],
  }) {
    this.offset = offset;
    this.kind = kind; // const | command | value | bitfield | lookup | counter | checksum | echo | reading | unknown
    this.width = width;
    this.endian = endian;
    this.const = c;
    this.index = index; // which number of the action label drives this field
    this.scale = scale; // value/bitfield and named reading: raw = value * scale + bias
    this.bias = bias;
    this.table = table; // lookup: value -> byte; named mode reading: raw -> label shown by the app
    this.step = step;
    this.algo = algo;
    this.covers = covers;
    this.source = source; // checksum over an earlier packet of the same transaction
    this.bit_offset = bit_offset;
    this.bit_width = bit_width;
    this.echo = echo; // reply byte that repeats this byte of the query
    this.limits = limits; // observed min/max of a reading
    this.name = name; // reading named after what the vendor app showed
    this.signed = signed;
    this.observed = observed;
    this.frames = frames;
  }

  describe() {
    let w;
    const s = this.signed ? 'i' : 'u';
    if (this.width === 4) w = `${s}32${this.endian} `;
    else if (this.width === 2) w = `${s}16${this.endian} `;
    else w = this.signed ? 'i8 ' : '';
    const g = fmt_g;
    if (this.kind === 'const' || this.kind === 'command') return `0x${fmt_hex(this.const, 2)}`;
    if (this.kind === 'value') {
      const v = this.index === 0 ? 'value' : `value[${this.index}]`;
      return `${w}round(${v} * ${g(this.scale)} + ${g(this.bias)})`;
    }
    if (this.kind === 'bitfield') {
      const v = this.index === 0 ? 'value' : `value[${this.index}]`;
      const expr = `round(${v} * ${g(this.scale)} + ${g(this.bias)})`;
      return `bits[${this.bit_offset}:${this.bit_offset + this.bit_width}] = ${expr}`;
    }
    if (this.kind === 'lookup') {
      const items = table_items(this.table).sort((a, b) => a[0] - b[0]);
      return 'lookup ' + items.map(([k, v]) => `${g(k)}→0x${fmt_hex(v, 2)}`).join(', ');
    }
    if (this.kind === 'counter') return `counter (+${this.step} per message)`;
    if (this.kind === 'echo') {
      return `= query byte ${this.echo}` + (this.const !== null ? ` (0x${fmt_hex(this.const, 2)})` : '');
    }
    if (this.kind === 'reading' && this.name && this.table !== null) {
      const bits = this.bit_width ? `bits[${this.bit_offset}:${this.bit_offset + this.bit_width}] ` : '';
      const items = table_items(this.table).sort((a, b) => a[0] - b[0]);
      return `${bits}${this.name}: ` + items.map(([k, v]) => `0x${fmt_hex(k, 2)} = ${v}`).join(', ');
    }
    if (this.kind === 'reading' && this.name && this.bit_width === 1) return `bit ${this.bit_offset}: ${this.name} (1 = on)`;
    if (this.kind === 'reading' && this.name && this.bit_width) {
      return `bits[${this.bit_offset}:${this.bit_offset + this.bit_width}] ${this.name}, seen ${this.limits[0]}..${this.limits[1]}`;
    }
    if (this.kind === 'reading' && this.name) {
      return `${w || 'u8 '}${this.name} = ${formula(this.scale, this.bias)}, seen ${this.limits[0]}..${this.limits[1]}`;
    }
    if (this.kind === 'reading') return `${w || 'u8 '}reading, seen ${this.limits[0]}..${this.limits[1]}`;
    if (this.kind === 'checksum') {
      const src = this.source !== null ? `packet${this.source + 1}` : 'bytes';
      return `${w}${this.algo}(${src}[${this.covers[0]}:${this.covers[1]}])`;
    }
    return '?';
  }
}

/** How to get the displayed value back from raw = value * scale + bias. */
export function formula(scale, bias) {
  const s = !bias ? 'raw' : `(raw ${bias > 0 ? '-' : '+'} ${fmt_g(Math.abs(bias))})`;
  return scale === 1 ? s.replace(/^[()]+|[()]+$/g, '') : `${s} / ${fmt_g(scale)}`;
}

export function _put(b, f, v) {
  writeInt(b, f.offset, f.width, v, endianName(f.endian));
}

export function _get(d, off, width, endian, signed = false) {
  return readInt(d, off, width, endian === 'le' ? 'little' : 'big', signed);
}

/** Pack v into bits [bit_offset : bit_offset+bit_width) of the field's byte span (LE bit order). */
export function _put_bits(b, f, v) {
  const bo = BigInt(f.bit_offset);
  const bw = BigInt(f.bit_width);
  const vv = BigInt(v) & ((1n << bw) - 1n);
  let span = 0n;
  for (let i = f.width - 1; i >= 0; i--) span = (span << 8n) | BigInt(b[f.offset + i] ?? 0);
  const mask = ((1n << bw) - 1n) << bo;
  span = (span & ~mask) | (vv << bo);
  span = BigInt.asUintN(f.width * 8, span);
  for (let i = 0; i < f.width; i++) { b[f.offset + i] = Number(span & 0xffn); span >>= 8n; }
}

export function _get_bits(d, off, width, bit_offset, bit_width) {
  const span = BigInt(readInt(d, off, width, 'little'));
  return Number((span >> BigInt(bit_offset)) & ((1n << BigInt(bit_width)) - 1n));
}

/** Split JS call args into (values, opts) the way Python's `*values, seq=0, prev=None` would. */
function splitArgs(args) {
  let opts = {};
  if (args.length && args[args.length - 1] !== null && typeof args[args.length - 1] === 'object' && !Array.isArray(args[args.length - 1])) {
    opts = args[args.length - 1];
    args = args.slice(0, -1);
  }
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  return [args, opts];
}

export class Command {
  constructor({
    name, endpoint, xfer_type, setup, length, fields, confidence, frames, samples, notes = [], steps = [],
    requires = null, switch: sw = null,
  }) {
    this.name = name;
    this.endpoint = endpoint;
    this.xfer_type = xfer_type;
    this.setup = setup;
    this.length = length;
    this.fields = fields;
    this.confidence = confidence;
    this.frames = frames;
    this.samples = samples; // [[label, hex, frame], ...]
    this.notes = notes;
    this.steps = steps; // follow-up packets of a multi-packet transaction
    this.requires = requires; // states this command was only sent in (states.js)
    this.switch = sw; // a state the app switched to inside this action and back (states.js)
  }

  get arity() {
    const idx = [];
    for (const c of [this, ...this.steps]) {
      for (const f of c.fields) if (f.kind === 'value' || f.kind === 'bitfield' || f.kind === 'lookup') idx.push(f.index);
    }
    return idx.length ? idx.reduce((m, x) => Math.max(m, x), -Infinity) + 1 : 0;
  }

  template() {
    const b = new Uint8Array(this.length);
    for (const f of this.fields) {
      if (f.kind === 'const' || f.kind === 'command') b[f.offset] = f.const;
      else if (f.kind === 'bitfield' && f.const !== null) {
        // plant constant bits outside the packed value (LE byte span)
        writeInt(b, f.offset, f.width, f.const, 'little');
      }
    }
    return b;
  }

  /** encode_all(...values, {seq}) : every packet of the transaction, in order (the counter advances per packet). */
  encode_all(...args) {
    const [values, opts] = splitArgs(args);
    const seq = opts.seq ?? 0;
    const out = [];
    [this, ...this.steps].forEach((c, i) => {
      out.push(c.encode(...values, { seq: seq + i, prev: out }));
    });
    return out;
  }

  /** encode(...values, {seq, prev}) (also accepts one array of values). */
  encode(...args) {
    const [values, opts] = splitArgs(args);
    const seq = opts.seq ?? 0;
    const prev = opts.prev ?? null;
    const b = this.template();
    for (const f of this.fields) {
      if (f.kind === 'value') _put(b, f, py_round_n(values[f.index] * f.scale + f.bias + 1e-9));
      else if (f.kind === 'bitfield') _put_bits(b, f, py_round_n(values[f.index] * f.scale + f.bias + 1e-9));
      else if (f.kind === 'lookup') {
        const k = Number(values[f.index]);
        const v = table_get(f.table, k);
        if (v === undefined) throw new Error(`KeyError: ${k}`);
        _put(b, f, v);
      } else if (f.kind === 'counter') _put(b, f, seq * f.step);
    }
    for (const f of this.fields) {
      if (f.kind === 'checksum') {
        const src = f.source === null ? b : prev[f.source];
        _put(b, f, compute(f.algo, src.slice(f.covers[0], f.covers[1])));
      }
    }
    return b;
  }
}

export class Protocol {
  constructor({
    vid = null, pid = null, commands = [], unmatched = [], hid = [], background = [], responses = [],
    observations = [], handshake = [], states = [], switches = [], streams = [],
  } = {}) {
    this.vid = vid;
    this.pid = pid;
    this.commands = commands;
    this.unmatched = unmatched;
    this.hid = hid; // filled by pipeline when the capture has HID descriptors
    this.background = background; // periodic polls/keep-alives set aside by the pipeline
    this.responses = responses; // decoded device replies (responses.Response)
    this.observations = observations;
    this.handshake = handshake; // messages sent once before the first action (handshake.js)
    this.states = states; // commands only sent in one state of a mode command (states.js)
    this.switches = switches; // state switches the app made inside an action (states.js)
    this.streams = streams; // image streams to a screen, kept out of the commands (streams.js)
  }

  /** dataclasses.asdict(self) with command/response setup bytes hexed. Maps become plain objects. */
  to_dict() {
    const d = asdict(this);
    const reqs = d.responses.map((r) => r.request).filter(Boolean);
    for (const c of [...d.commands, ...reqs]) {
      for (const x of [c, ...c.steps]) x.setup = x.setup ? hex(x.setup) : null;
    }
    for (const r of d.responses) r.query_setup = r.query_setup ? hex(r.query_setup) : null;
    return d;
  }
}

/** Deep copy like dataclasses.asdict: class instances and Maps become plain objects, bytes are copied. */
export function asdict(o) {
  if (o === null || o === undefined) return o;
  if (o instanceof Uint8Array) return o.slice();
  if (Array.isArray(o)) return o.map(asdict);
  if (o instanceof Set) return [...o].map(asdict);
  if (o instanceof Map) {
    const out = {};
    for (const [k, v] of o) out[String(k)] = asdict(v);
    return out;
  }
  if (typeof o === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(o)) out[k] = asdict(v);
    return out;
  }
  return o;
}

// ---- linear fits ---------------------------------------------------------------------------

/** Linear fit that must also survive leave-one-out (guards against rounding coincidences). */
export function _fit_linear(xs, ys) {
  const fit = _fit_linear_raw(xs, ys);
  if (fit === null || xs.length < 3) return fit;
  for (let i = 0; i < xs.length; i++) {
    const sub = _fit_linear_raw([...xs.slice(0, i), ...xs.slice(i + 1)], [...ys.slice(0, i), ...ys.slice(i + 1)]);
    const tol = xs.length >= 5 ? 1 : 0;
    if (sub === null || Math.abs(py_round_n(xs[i] * sub[0] + sub[1] + 1e-9) - ys[i]) > tol) return null;
  }
  return fit;
}

export function _fit_linear_raw(xs, ys) {
  const n = xs.length;
  if (n < 2 || new Set(xs).size < 2 || new Set(ys).size < 2) return null;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  let sxy = 0;
  for (let i = 0; i < n; i++) sxy += (xs[i] - mx) * (ys[i] - my);
  const a = sxy / sxx;
  const b = my - a * mx;
  // off-by-one tolerance (vendor rounding) only with enough samples; otherwise a lookup table is the honest answer
  for (const tol of n >= 5 ? [0, 1] : [0]) {
    for (const ca of [py_round_n(a), py_round_n(a, 1), py_round_n(a, 2), py_round_n(a, 3), py_round_n(a, 4)]) {
      for (const cb of [py_round_n(b), py_round_n(b, 2), b]) {
        let ok = true;
        for (let i = 0; i < n; i++) {
          if (Math.abs(py_round_n(xs[i] * ca + cb + 1e-9) - ys[i]) > tol) { ok = false; break; }
        }
        if (ok) return [ca === 0 ? 0 : ca, cb === 0 ? 0 : cb];
      }
    }
  }
  return null;
}

// ---- inference -----------------------------------------------------------------------------

const dataKey = (t) => `${t.keyStr()}|${hex(t.data)}`;
const shapeOf = (ms) => JSON.stringify(ms.map((t) => [t.key(), t.data.length]));

export function infer(actions, vid = null, pid = null) {
  // background: identical OUT payloads present in >= 80% of actions
  const seen = new Map();
  for (const a of actions) {
    for (const p of new Set(commands_of(a).map(dataKey))) seen.set(p, (seen.get(p) || 0) + 1);
  }
  const bg = new Set();
  for (const [p, c] of seen) if (actions.length > 2 && c >= 0.8 * actions.length) bg.add(p);

  const groups = new Map(); // name -> [[Action, Transfer[]], ...]
  const unmatched = [];
  for (const a of actions) {
    const msgs = commands_of(a).filter((t) => !bg.has(dataKey(t)));
    if (!msgs.length) { unmatched.push(a.label); continue; }
    const vs = a.values;
    const key = !vs.length || vs.length === 1 ? a.name : _name(a);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([a, msgs]);
  }

  const flat = [];
  for (const [n, items] of groups) for (const [, ms] of items) for (const t of ms) flat.push([n, t]);
  const counters = _find_counters(flat);

  const commands = [];
  for (const [name, items] of groups) {
    // transaction shape: how many packets this action sends, and on which channels
    const shapes = new Map();
    for (const [, ms] of items) { const k = shapeOf(ms); shapes.set(k, (shapes.get(k) || 0) + 1); }
    let bestKey = null;
    let bestN = -1;
    for (const [k, n] of shapes) if (n > bestN) { bestKey = k; bestN = n; }
    let shape = JSON.parse(bestKey); // [[key, length], ...]
    let ok = items.filter(([, ms]) => shapeOf(ms) === bestKey);
    if (ok.length < 2 && shape.length > 1) {
      // not enough identical transactions: fall back to the first packet only
      shape = [shape[0]];
      const first = JSON.stringify(shape[0]);
      ok = items.filter(([, ms]) => JSON.stringify([ms[0].key(), ms[0].data.length]) === first).map(([a, ms]) => [a, ms.slice(0, 1)]);
    }
    const notes = [];
    if (ok.length < items.length) {
      notes.push(`${items.length - ok.length} action(s) sent a differently shaped transaction and were ignored`);
    }
    const steps = [];
    shape.forEach(([key, length], j) => {
      const sub = ok.map(([a, ms]) => [a, ms[j]]);
      const ctr = counters.get(JSON.stringify(key));
      steps.push(_infer_command(j === 0 ? name : `${name} [packet ${j + 1}]`, sub, length, j === 0 ? notes : [], ctr || new Map()));
    });
    _cross_packet_checksums(steps, ok.map(([, ms]) => ms.map((t) => t.data)));
    const head = steps[0];
    head.steps = steps.slice(1);
    if (head.steps.length) {
      head.notes.push(`multi-packet transaction: ${shape.length} packets per action, sent in this order`);
      head.confidence = py_round_n(Math.min(...steps.map((c) => c.confidence)), 2);
    }
    commands.push(head);
  }

  mark_command_ids(commands);
  return new Protocol({ vid, pid, commands, unmatched });
}

/** Command-id bytes: const positions whose value differs between commands on the same channel. */
export function mark_command_ids(commands) {
  const byChan = new Map();
  for (const c of commands) {
    const k = JSON.stringify([c.endpoint, c.xfer_type, c.setup ? hex(c.setup.subarray(0, 4)) : null]);
    if (!byChan.has(k)) byChan.set(k, []);
    byChan.get(k).push(c);
  }
  for (const cs of byChan.values()) {
    if (cs.length < 2) continue;
    const n = Math.min(...cs.map((c) => c.length));
    for (let off = 0; off < n; off++) {
      const fs = cs.map((c) => c.fields.find((f) => f.offset === off) ?? null);
      if (fs.every((f) => f !== null && (f.kind === 'const' || f.kind === 'command')) && new Set(fs.map((f) => f.const)).size > 1) {
        for (const f of fs) f.kind = 'command';
      }
    }
  }
}

/** A later packet may carry a checksum of an earlier one (e.g. 'apply' after 'write'). */
export function _cross_packet_checksums(steps, samples) {
  const algos = checksum_items();
  for (let j = 1; j < steps.length; j++) {
    for (const f of steps[j].fields) {
      if ((f.kind !== 'unknown' && f.kind !== 'lookup') || f.width !== 1) continue;
      const cur = samples.map((s) => s[j][f.offset]);
      let found = false;
      search:
      for (let i = 0; i < j; i++) {
        const n = samples.reduce((m, s) => Math.min(m, s[i].length), Infinity);
        for (let a = 0; a < n; a++) {
          for (let b = n; b > a + 1; b--) {
            for (const [algo, [w]] of algos) {
              if (w === 1 && samples.every((s, k) => compute(algo, s[i].slice(a, b)) === cur[k])) {
                f.kind = 'checksum'; f.algo = algo; f.covers = [a, b]; f.source = i; f.table = null;
                found = true;
                break search;
              }
            }
          }
        }
      }
    }
    const unknown = steps[j].fields.filter((x) => x.kind === 'unknown').length;
    steps[j].notes = steps[j].notes.filter((n) => !n.includes('lookup tables only') || steps[j].fields.some((x) => x.kind === 'lookup'));
    steps[j].confidence = samples.length >= 3
      ? py_round_n(1.0 - unknown / Math.max(steps[j].length, 1), 2)
      : steps[j].confidence;
  }
}

export function _name(a) {
  return split_values(a.label)[0];
}

/**
 * Offsets that increase by a fixed step on every message of a channel, across >= 2 commands.
 * Returns Map<keyStr, Map<offset, [step, frames]>>.
 */
export function _find_counters(msgs) {
  const out = new Map();
  const byKey = new Map();
  const names = new Map();
  const keys = new Map();
  for (const [n, t] of msgs) {
    const k = t.keyStr();
    if (!byKey.has(k)) { byKey.set(k, []); names.set(k, new Set()); keys.set(k, t.key()); }
    byKey.get(k).push(t);
    names.get(k).add(n);
  }
  for (const [k, ts] of byKey) {
    ts.sort((a, b) => a.frame - b.frame);
    if (ts.length < 4 || names.get(k).size < 2) continue;
    const found = new Map();
    const n = ts.reduce((m, t) => Math.min(m, t.data.length), Infinity);
    for (let off = 0; off < n; off++) {
      const col = ts.map((t) => t.data[off]);
      const steps = new Set();
      for (let i = 0; i + 1 < col.length; i++) steps.add((col[i + 1] - col[i]) & 0xff);
      if (steps.size === 1 && !steps.has(0)) found.set(off, [[...steps][0], ts.map((t) => t.frame)]);
    }
    out.set(k, found);
  }
  return out;
}

const popcount = (x) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };
const bitLength = (x) => 32 - Math.clz32(x);

/** If varying bits form one contiguous run and outside bits are constant, return [bit_offset, bit_width, mask]. */
export function _bit_run(cols, nbits = 8) {
  if (new Set(cols).size < 2) return null;
  let xor_all = 0;
  for (let i = 0; i + 1 < cols.length; i++) xor_all |= cols[i] ^ cols[i + 1];
  if (xor_all === 0) return null;
  const lo = bitLength(xor_all & -xor_all) - 1;
  const hi = bitLength(xor_all) - 1;
  const bw = hi - lo + 1;
  if (popcount(xor_all) !== bw) return null; // gaps, not a single packed field
  const mask = ((1 << bw) - 1) << lo;
  const outside = ((1 << nbits) - 1) ^ mask;
  if (new Set(cols.map((c) => c & outside)).size !== 1) return null;
  // full-width run, or outside bits that are merely zero padding, is a normal value field.
  // A real bitfield has other constant (non-zero) bits packed beside it.
  if (outside === 0 || bw === nbits) return null;
  if (cols.every((c) => (c & outside) === 0)) return null;
  return [lo, bw, mask];
}

const asItems = (x) => (x instanceof Map ? [...x] : x ? Object.entries(x).map(([k, v]) => [Number(k), v]) : []);

export function _infer_command(name, items, length, notes, counters, lookups = true, preset = null) {
  const t0 = items[0][1];
  const frames = items.map(([, t]) => t.frame);
  const datas = items.map(([, t]) => t.data);
  const vals = items.map(([a]) => a.values);
  const arity = vals.reduce((m, v) => Math.max(m, v.length), 0);
  let fields = [];
  for (let off = 0; off < length; off++) {
    const col = datas.map((d) => d[off]);
    const f = new Field({ offset: off, kind: 'unknown', observed: vals.map((v, i) => [v.slice(), col[i]]), frames });
    if (new Set(col).size === 1) { f.kind = 'const'; f.const = col[0]; }
    fields.push(f);
  }
  for (const [off, [step, fr]] of asItems(counters)) {
    if (off < length && fields[off].kind === 'unknown') {
      fields[off].kind = 'counter'; fields[off].step = step; fields[off].frames = fr;
    }
  }
  for (const [off, f] of asItems(preset)) {
    if (fields[off].kind === 'unknown') fields[off] = f;
  }

  const free = (a, w = 1) => {
    if (a + w > length) return false;
    for (let i = a; i < a + w; i++) if (fields[i].kind !== 'unknown') return false;
    return true;
  };
  const claim = (f) => {
    fields[f.offset] = f;
    for (let i = f.offset + 1; i < f.offset + f.width; i++) fields[i] = new Field({ offset: i, kind: 'part', const: f.offset });
  };

  // 1. checksums (need >= 2 distinct packets)
  const algos = checksum_items();
  if (new Set(datas.map((d) => hex(d))).size >= 2) {
    for (let off = 0; off < length; off++) {
      let done = false;
      for (const [algo, [w]] of algos) {
        if (done || !free(off, w)) continue;
        for (const end of w === 2 ? ['le', 'be'] : ['le']) {
          for (const [a, b] of [[0, off], [1, off], [2, off], [off + w, length]]) {
            if (b - a < 2) continue;
            let allConst = true;
            for (let i = a; i < b; i++) if (fields[i].kind !== 'const') { allConst = false; break; }
            if (allConst) continue;
            if (datas.every((d) => compute(algo, d.slice(a, b)) === _get(d, off, w, end))) {
              claim(new Field({ offset: off, kind: 'checksum', width: w, endian: end, algo, covers: [a, b], frames }));
              done = true;
              break;
            }
          }
          if (done) break;
        }
      }
    }
  }

  // 2. values: bitfields (packed beside non-zero const bits) first, then 32/16-bit,
  //    then 8-bit, then lookups. Prefer wider bitfield spans.
  for (let j = 0; j < arity; j++) {
    const xs = vals.map((v) => (j < v.length ? v[j] : null));
    if (xs.some((x) => x === null)) continue;
    for (const width of [2, 1]) {
      for (let off = 0; off <= length - width; off++) {
        if (!free(off, width)) continue;
        const run = _bit_run(datas.map((d) => _get(d, off, width, 'le')), 8 * width);
        if (run === null) continue;
        const [bo, bw, mask] = run;
        const ys = datas.map((d) => _get_bits(d, off, width, bo, bw));
        const fit = _fit_linear(xs, ys);
        if (fit) {
          const bgv = _get(datas[0], off, width, 'le') & ~mask;
          claim(new Field({
            offset: off, kind: 'bitfield', width, endian: 'le', const: bgv, index: j, scale: fit[0], bias: fit[1],
            bit_offset: bo, bit_width: bw, frames,
          }));
        }
      }
    }
    for (const width of [4, 2]) {
      for (let off = 0; off <= length - width; off++) {
        if (!free(off, width)) continue;
        for (const end of ['le', 'be']) {
          const ys = datas.map((d) => _get(d, off, width, end));
          const fit = _fit_linear(xs, ys);
          let varies = true;
          if (fit) {
            for (let i = off; i < off + width; i++) if (new Set(datas.map((d) => d[i])).size <= 1) { varies = false; break; }
          }
          if (fit && varies) {
            claim(new Field({ offset: off, kind: 'value', width, endian: end, index: j, scale: fit[0], bias: fit[1], frames }));
            break;
          }
        }
      }
    }
    for (let off = 0; off < length; off++) {
      if (free(off)) {
        const fit = _fit_linear(xs, datas.map((d) => d[off]));
        if (fit) claim(new Field({ offset: off, kind: 'value', index: j, scale: fit[0], bias: fit[1], frames }));
      }
    }
  }
  for (let j = 0; j < (lookups ? arity : 0); j++) {
    const xs = vals.map((v) => (j < v.length ? v[j] : null));
    if (xs.some((x) => x === null) || new Set(xs).size < 2) continue;
    for (let off = 0; off < length; off++) {
      if (!free(off)) continue;
      const table = new Map();
      let good = true;
      for (let i = 0; i < xs.length; i++) {
        const x = Number(xs[i]);
        if (!table.has(x)) table.set(x, datas[i][off]);
        if (table.get(x) !== datas[i][off]) { good = false; break; }
      }
      if (good && new Set(table.values()).size === table.size) {
        claim(new Field({ offset: off, kind: 'lookup', index: j, table, frames }));
      }
    }
  }
  fields = fields.filter((f) => f.kind !== 'part');

  const unknown = fields.filter((f) => f.kind === 'unknown').length;
  let conf = 1.0 - unknown / Math.max(length, 1);
  if (items.length < 3) {
    conf *= 0.6;
    notes.push('fewer than 3 samples: record more values of this action to raise confidence');
  }
  if (fields.some((f) => f.kind === 'lookup')) notes.push('lookup tables only cover the values that were captured');
  if (unknown) notes.push(`${unknown} byte(s) vary but could not be explained`);
  return new Command({
    name, endpoint: t0.endpoint, xfer_type: t0.xfer_type, setup: t0.setup, length, fields,
    confidence: py_round_n(conf, 2), frames,
    samples: items.map(([a, t]) => [a.label, hex(t.data, ' '), t.frame]), notes,
  });
}

