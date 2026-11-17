// Handshake: what the vendor app sends once when it opens the device, before the first action.
// Port of usb_rea/handshake.py (see its docstring for the retry / reopen / branch semantics).
//
// Port notes: Python `id(t)` sets (background `ids`, reopen_ids) are Sets of Transfer objects here.
// Dicts are plain objects; `cases` keys are two-hex-digit strings, so integer-like ones ("10".."99") iterate
// before the others (Python kept insertion order).
import { CHECKSUMS, compute } from './checksums.js';
import { is_observation } from './model.js';
import { MAX_REPLY, WINDOW, is_control_read } from './responses.js';
import { eq, fromHex, hex, readInt } from './bytes.js';
import { py_round_n } from './infer.js';

export const MIN_RUN = 3;
export const MAX_STEPS = 32;

const EMPTY = new Uint8Array(0);
const checksum_items = () => (CHECKSUMS instanceof Map ? [...CHECKSUMS] : Object.entries(CHECKSUMS));
const endian = (e) => (e === 'le' ? 'little' : 'big');

function bisect_right(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (x < arr[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** int.from_bytes(m[-w:], ...) */
function tail_int(m, w, e) {
  const s = m.slice(Math.max(0, m.length - w));
  return readInt(s, 0, s.length, endian(e));
}

const same_msg = (a, b) => a.keyStr() === b.keyStr() && eq(a.data, b.data);
const is_poll = (polls, t) => polls.has(t) || polls.has(t.frame);

/** One algorithm over bytes [start:n-w] stored in the last w bytes of every message. */
export function _checksum(msgs) {
  msgs = msgs.filter((m) => m && m.length);
  if (!msgs.length) return null;
  for (const [algo, [w]] of checksum_items()) {
    if (msgs.length < 2 && w < 2) continue;
    for (const e of w === 2 ? ['le', 'be'] : ['le']) {
      for (const start of [0, 1]) {
        if (msgs.every((m) => m.length >= start + w + 2 && tail_int(m, w, e) === compute(algo, m.slice(start, m.length - w)))) {
          return { algo, width: w, endian: e, start };
        }
      }
    }
  }
  return null;
}

export function _ck_span(ck, n) {
  const out = new Set();
  if (ck) for (let i = n - ck.width; i < n; i++) out.add(i);
  return out;
}

/** Maximal common runs [offset in a, offset in b, length] of MIN_RUN+ bytes, not all one value. */
export function _runs(a, b, skip_a, skip_b) {
  const out = [];
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (i && j && a[i - 1] === b[j - 1] && !skip_a.has(i - 1) && !skip_b.has(j - 1)) continue; // not maximal
      let n = 0;
      while (i + n < a.length && j + n < b.length && a[i + n] === b[j + n] && !skip_a.has(i + n) && !skip_b.has(j + n)) n++;
      if (n >= MIN_RUN && new Set(a.subarray(i, i + n)).size > 1) out.push([i, j, n]);
    }
  }
  return out;
}

export function _reply(q, ordered, frames) {
  for (let i = bisect_right(frames, q.frame); i < ordered.length; i++) {
    const t = ordered[i];
    if (t.ts - q.ts > WINDOW) return null;
    if (is_control_read(q)) {
      if (t.xfer_type === 2 && t.is_in && t.data.length && t.setup === null) return t;
      continue;
    }
    if (t.is_out && t.data.length) return null; // the next message went out first: this one got no reply
    if (t.is_in && t.data.length && t.xfer_type !== 2) return t.data.length <= MAX_REPLY ? t : null;
  }
  return null;
}

export function _query(t) {
  return Boolean((t.is_out && t.data.length) || is_control_read(t));
}

/** Consecutive identical copies (nothing else sent in between but polls) are retries of one step. */
export function _group(qs, ordered, frames, polls) {
  const between = (a, b) => ordered.slice(bisect_right(frames, a.frame), bisect_right(frames, b.frame) - 1)
    .filter((x) => _query(x) && !is_poll(polls, x));
  const groups = [];
  for (const t of qs) {
    const prev = groups.length ? groups[groups.length - 1][groups[groups.length - 1].length - 1] : null;
    if (prev !== null && same_msg(prev, t) && !between(prev, t).length) groups[groups.length - 1].push(t);
    else groups.push([t]);
  }
  return groups.slice(0, MAX_STEPS);
}

export function _setup(transfers, background, marks) {
  const starts = marks.filter((m) => !is_observation(m.label)).map((m) => m.start);
  if (!starts.length) return null;
  const polls = new Set();
  for (const b of background || []) for (const x of b.ids) polls.add(x);
  const ordered = [...transfers].sort((a, b) => a.frame - b.frame);
  return [starts.reduce((m, x) => Math.min(m, x), Infinity), polls, ordered, ordered.map((t) => t.frame)];
}

/** m is step c sent again: same channel and length, other bytes only checksum or copied from replies. */
export function _same_step(m, c, replies, ck) {
  const md = m.data || EMPTY;
  const cd = c.data || EMPTY;
  if (m.keyStr() !== c.keyStr() || md.length !== cd.length || is_control_read(m) !== is_control_read(c)) return false;
  const diff = new Set();
  for (let k = 0; k < md.length; k++) if (md[k] !== cd[k]) diff.add(k);
  if (!diff.size) return true;
  const ok = new Set();
  if (ck && !is_control_read(m) && tail_int(md, ck.width, ck.endian) === compute(ck.algo, md.slice(ck.start, md.length - ck.width))) {
    for (const x of _ck_span(ck, md.length)) ok.add(x);
  }
  for (const r of replies) {
    for (const [, b, n] of _runs(r, md, new Set(), new Set())) for (let k = b; k < b + n; k++) ok.add(k);
  }
  for (const k of diff) if (!ok.has(k)) return false;
  return true;
}

/** Copies of each step of a later handshake block. `fork` is set when the block took another branch:
 * {step, offset, value}; the copies after that step are the messages the app sent instead of the rest. */
export class Block extends Array {
  static get [Symbol.species]() { return Array; }

  constructor() {
    super();
    this.fork = null;
  }
}

function make_block(items) {
  const b = new Block();
  for (const x of items) b.push(x);
  return b;
}

/** after[q] and the identical copies sent straight after it (retries); returns [copies, last index]. */
export function _copies(after, q) {
  const copies = [after[q]];
  while (q + 1 < after.length && same_msg(after[q + 1], after[q]) && after[q + 1].ts - after[q].ts <= WINDOW) {
    q += 1;
    copies.push(after[q]);
  }
  return [copies, q];
}

/** Reply bytes copied into later requests (session tokens). */
export function _reused(reply, reqs) {
  const out = new Set();
  for (const m of reqs) for (const [a, , n] of _runs(reply, m, new Set(), new Set())) for (let k = a; k < a + n; k++) out.add(k);
  return out;
}

/** First byte where a block's reply differs from the first session's, not counting checksum and token bytes. */
export function _decides(pre_reply, reply, ck, pre_later, later) {
  if (!pre_reply.length || pre_reply.length !== reply.length) return null;
  const skip = new Set([..._ck_span(ck, reply.length), ..._reused(pre_reply, pre_later), ..._reused(reply, later)]);
  for (let k = 0; k < reply.length; k++) if (pre_reply[k] !== reply[k] && !skip.has(k)) return k;
  return null;
}

/** Later blocks that send the pre-action sequence again: one list of copies per step. A block that
 * follows it up to a step whose reply differs, then sends other messages, is a branch (Block.fork). */
export function find_reopens(transfers, background, marks) {
  const st = _setup(transfers, background, marks);
  if (!st) return [];
  const [first, polls, ordered, frames] = st;
  const acts = marks.filter((m) => !is_observation(m.label)).map((m) => [m.start, m.end ?? m.start]);
  const starts = acts.map(([a]) => a).sort((a, b) => a - b);
  const pre = _group(ordered.filter((t) => t.ts < first && _query(t) && !is_poll(polls, t)), ordered, frames, polls);
  if (pre.length < 2) return [];
  const last = (g) => g[g.length - 1];
  const ck = _checksum(pre.filter((g) => !is_control_read(last(g))).map((g) => last(g).data));
  const pre_reps = pre.map((g) => { const r = _reply(last(g), ordered, frames); return r ? r.data : EMPTY; });
  const rck = _checksum(pre_reps);
  const after = ordered.filter((t) => t.ts >= first && _query(t) && !is_poll(polls, t));
  const blocks = [];
  let p = 0;
  while (p < after.length) {
    if (!same_msg(after[p], last(pre[0]))) { p += 1; continue; }
    const block = new Block();
    const replies = [];
    let q = p;
    for (const c of pre.map(last)) {
      if (q >= after.length || !_same_step(after[q], c, replies, ck)) break;
      let copies;
      [copies, q] = _copies(after, q);
      const r = _reply(last(copies), ordered, frames);
      replies.push(r ? r.data : EMPTY);
      block.push(copies);
      q += 1;
    }
    if (block.length === pre.length) {
      blocks.push(block);
      p = q;
      continue;
    }
    // a branch: the app went on with other messages, up to the next action marker
    // (only between actions: inside one, the messages belong to that action)
    const end = starts.find((s) => s > after[p].ts) ?? Infinity;
    const inside = acts.some(([a, z]) => a <= after[p].ts && after[p].ts <= z);
    const tail = [];
    while (block.length && !inside && q < after.length && after[q].ts < end && block.length + tail.length < MAX_STEPS) {
      let copies;
      [copies, q] = _copies(after, q);
      tail.push(copies);
      q += 1;
    }
    const k = block.length - 1;
    const off = block.length && tail.length
      ? _decides(pre_reps[k], replies[k], rck, pre.slice(k + 1).map((g) => last(g).data), tail.map((c) => last(c).data))
      : null;
    if (off === null) { p += 1; continue; }
    const nb = make_block([...block, ...tail]);
    nb.fork = { step: k, offset: off, value: replies[k][off] };
    blocks.push(nb);
    p = q;
  }
  return blocks;
}

/** The requests and replies of reopen blocks (Transfer objects), to set aside before actions are inferred. */
export function reopen_ids(blocks, transfers) {
  const ordered = [...transfers].sort((a, b) => a.frame - b.frame);
  const frames = ordered.map((t) => t.frame);
  const out = new Set();
  for (const b of blocks) {
    for (const copies of b) {
      for (const c of copies) {
        out.add(c);
        const r = _reply(c, ordered, frames);
        if (r !== null) out.add(r);
      }
    }
  }
  return out;
}

const hexs = (d) => hex(d, ' ');

/** Handshake steps (objects, JSON-ready) found before the first action marker. */
export function find_handshake(transfers, background, marks, commands = [], t0 = 0.0, reopens = null) {
  const st = _setup(transfers, background, marks);
  if (!st) return [];
  const [first, polls, ordered, frames] = st;
  reopens = reopens === null || reopens === undefined ? find_reopens(transfers, background, marks) : reopens;
  const again = new Set();
  for (const b of reopens) for (const copies of b) for (const c of copies) again.add(c);
  const later = new Set(ordered.filter((t) => t.ts >= first && _query(t) && !again.has(t)).map((t) => `${t.keyStr()}|${hex(t.data)}`));
  const qs = ordered.filter((t) => t.ts < first && _query(t) && !is_poll(polls, t) && !later.has(`${t.keyStr()}|${hex(t.data)}`));
  const groups = _group(qs, ordered, frames, polls);
  const pre = _group(ordered.filter((t) => t.ts < first && _query(t) && !is_poll(polls, t)), ordered, frames, polls);
  const where = new Map(pre.map((g, k) => [g[g.length - 1], k]));
  const steps = [];
  groups.forEach((g, i0) => {
    const i = i0 + 1;
    const q = g[g.length - 1];
    const r = _reply(q, ordered, frames);
    const tries = g.slice(0, -1).map((c) => {
      const cr = _reply(c, ordered, frames);
      return { frame: c.frame, time: py_round_n(c.ts - t0, 3), reply: cr ? hexs(cr.data) : null };
    });
    steps.push({
      step: i, frame: q.frame, time: py_round_n(q.ts - t0, 3),
      endpoint: q.endpoint, xfer_type: q.xfer_type, setup: q.setup ? hex(q.setup) : null,
      read: is_control_read(q), request: hexs(q.data),
      reply: r ? hexs(r.data) : null, reply_frame: r ? r.frame : null,
      reply_endpoint: r ? r.endpoint : null, reply_xfer_type: r ? r.xfer_type : null,
      latency_ms: r ? py_round_n((r.ts - q.ts) * 1000, 1) : null,
      request_checksum: null, reply_checksum: null, uses: [], tokens: [], echoes: [],
      expect: null, retries: tries,
      reopens: reopens.filter((b) => where.has(q) && (!b.fork || where.get(q) <= b.fork.step)).map((b) => {
        const x = b[where.get(q)][b[where.get(q)].length - 1];
        return { frame: x.frame, time: py_round_n(x.ts - t0, 3) };
      }),
    });
  });
  if (!steps.length) return [];
  const reqs = steps.map((s) => fromHex(s.request));
  const reps = steps.map((s) => (s.reply ? fromHex(s.reply) : EMPTY));
  const qck = _checksum(reqs.filter((m, k) => !steps[k].read));
  const rck = _checksum(reps);
  steps.forEach((s, k) => {
    const m = reqs[k];
    const r = reps[k];
    if (qck && m.length && !s.read) s.request_checksum = { ...qck, covers: [qck.start, m.length - qck.width] };
    if (rck && r.length) s.reply_checksum = { ...rck, covers: [rck.start, r.length - rck.width] };
  });

  const skip_q = (k) => _ck_span(steps[k].request_checksum, reqs[k].length);
  const skip_r = (k) => _ck_span(steps[k].reply_checksum, reps[k].length);
  const union = (a, b) => new Set([...a, ...b]);

  const taken = steps.map(() => new Set()); // reply bytes claimed as tokens
  steps.forEach((s, i) => {
    if (!reps[i].length) return;
    const own = new Set();
    for (const [a, , n] of _runs(reps[i], reqs[i], skip_r(i), skip_q(i))) for (let k = a; k < a + n; k++) own.add(k);
    for (const [a, b, n] of _runs(reps[i], reqs[i], skip_r(i), skip_q(i))) s.echoes.push({ offset: a, width: n, query_offset: b });
    const tokens = new Map();
    const use = (a, n, wh) => {
      const key = `${a},${n}`;
      if (!tokens.has(key)) tokens.set(key, { reply_offset: a, width: n, used_by: [] });
      tokens.get(key).used_by.push(wh);
      for (let k = a; k < a + n; k++) taken[i].add(k);
    };
    for (let j = i + 1; j < steps.length; j++) {
      for (const [a, b, n] of _runs(reps[i], reqs[j], union(skip_r(i), own), skip_q(j))) {
        if (steps[j].uses.some((u) => u.offset === b && u.width === n)) continue; // an earlier reply already explains these bytes
        use(a, n, { step: j + 1, offset: b });
        steps[j].uses.push({ step: i + 1, reply_offset: a, offset: b, width: n });
      }
    }
    for (const c of commands) {
      [c, ...c.steps].forEach((packet, k) => {
        const datas = packet.samples.map(([, hx]) => fromHex(hx.replace(/ /g, '')));
        if (!datas.length) return;
        for (const [a, b, n] of _runs(reps[i], datas[0], union(skip_r(i), own), new Set())) {
          if (datas.every((d) => eq(d.subarray(b, b + n), reps[i].subarray(a, a + n)))) {
            use(a, n, { command: c.name, packet: k, offset: b });
            c.notes.push(`bytes ${b}-${b + n - 1}` + (k ? ` of packet ${k + 1}` : '')
              + ` repeat bytes ${a}-${a + n - 1} of the reply to handshake step `
              + `${i + 1} (frame ${s.reply_frame}): a session token or device id; `
              + 'the driver copies them from the live reply');
          }
        }
      });
    }
    s.tokens = [...tokens.values()].sort((x, y) => x.reply_offset - y.reply_offset);
  });
  steps.forEach((s, i) => {
    if (reps[i].length) {
      const vary = union(taken[i], skip_r(i));
      s.expect = Array.from(reps[i], (b, k) => (vary.has(k) ? '??' : b.toString(16).padStart(2, '0'))).join(' ');
    }
  });
  _branches(steps, groups, reopens, where, ordered, frames, t0, qck, rck);
  return steps;
}

export function _fits(ck, m) {
  return Boolean(ck && m.length && m.length >= ck.start + ck.width + 2
    && tail_int(m, ck.width, ck.endian) === compute(ck.algo, m.slice(ck.start, m.length - ck.width)));
}

/** Record on the deciding step which messages the app sent next for each value of its reply byte. */
export function _branches(steps, groups, reopens, where, ordered, frames, t0, qck, rck) {
  const forks = reopens.filter((b) => b.fork);
  if (!forks.length) return;
  const lastOf = (g) => g[g.length - 1];
  const pos = new Map(); // pre index -> step index
  groups.forEach((g, k) => { if (where.has(lastOf(g))) pos.set(where.get(lastOf(g)), k); });
  const fork = forks[0].fork;
  const k = pos.get(fork.step);
  if (k === undefined || !steps[k].reply) return;
  const s = steps[k];
  const off = fork.offset;
  const main = fromHex(s.reply);
  if (main.length <= off) return;
  const hx2 = (v) => v.toString(16).padStart(2, '0');
  const cases = {};
  cases[hx2(main[off])] = { count: 1, main: true, frames: [s.reply_frame], steps: [] };
  for (const b of reopens) {
    if (b.fork && (b.fork.step !== fork.step || b.fork.offset !== off)) continue;
    const dq = lastOf(b[fork.step]);
    const r = _reply(dq, ordered, frames);
    if (r === null || r.data.length <= off) continue;
    const key = hx2(r.data[off]);
    if (!(key in cases)) cases[key] = { count: 0, main: !b.fork, frames: [], steps: [] };
    const cs = cases[key];
    cs.count += 1;
    cs.frames.push(r.frame);
    if (b.fork && !cs.steps.length && !cs.main) {
      // this session's replies so far, indexed like the driver's session list (step n -> n - 1)
      const session = [];
      for (let i = 0; i <= k; i++) {
        const g = groups[i];
        const c = where.has(lastOf(g)) ? lastOf(b[where.get(lastOf(g))]) : null;
        const cr = c !== null ? _reply(c, ordered, frames) : null;
        session.push(cr ? cr.data : EMPTY);
      }
      cs.steps = _tail(b.slice(fork.step + 1), session, k + 1, ordered, frames, t0, qck, rck);
    }
  }
  s.expect = s.expect.split(' ').map((x, i) => (i === off ? '??' : x)).join(' ');
  let best = null;
  for (const v of Object.keys(cases)) if (best === null || cases[v].count > cases[best].count) best = v;
  s.branches = { offset: off, default: best, cases };
}

/** Steps (numbered after the `done` steps before them) the app sent in one branch, with their replies. */
export function _tail(groups, session, done, ordered, frames, t0, qck, rck) {
  const out = [];
  groups.forEach((g, j) => {
    const q = g[g.length - 1];
    const r = _reply(q, ordered, frames);
    const req = q.data || EMPTY;
    const rep = r ? r.data : EMPTY;
    const qc = !is_control_read(q) && _fits(qck, req) ? qck : null;
    const rc = _fits(rck, rep) ? rck : null;
    const skip = _ck_span(qc, req.length);
    const uses = [];
    session.forEach((prev, i) => {
      for (const [a, b, n] of _runs(prev, req, new Set(), skip)) {
        if (!uses.some((u) => b < u.offset + u.width && u.offset < b + n)) uses.push({ step: i + 1, reply_offset: a, offset: b, width: n });
      }
    });
    out.push({
      step: done + j + 1, frame: q.frame, time: py_round_n(q.ts - t0, 3),
      endpoint: q.endpoint, xfer_type: q.xfer_type, setup: q.setup ? hex(q.setup) : null,
      read: is_control_read(q), request: hexs(req),
      reply: r ? hexs(rep) : null, reply_frame: r ? r.frame : null,
      reply_endpoint: r ? r.endpoint : null, reply_xfer_type: r ? r.xfer_type : null,
      request_checksum: qc ? { ...qc, covers: [qc.start, req.length - qc.width] } : null,
      reply_checksum: rc ? { ...rc, covers: [rc.start, rep.length - rc.width] } : null,
      uses, retries: g.slice(0, -1).map((c) => ({ frame: c.frame })), expect: null,
    });
    session.push(rep);
  });
  out.forEach((st, i) => {
    if (st.reply) {
      const rep = fromHex(st.reply);
      const n = done + i; // this reply's index in the session
      const vary = _ck_span(st.reply_checksum, rep.length);
      for (const o of out) for (const u of o.uses) if (u.step === n + 1) for (let x = 0; x < u.width; x++) vary.add(u.reply_offset + x);
      st.expect = Array.from(rep, (b, k) => (vary.has(k) ? '??' : b.toString(16).padStart(2, '0'))).join(' ');
    }
  });
  return out;
}
