// Port of usb_rea/actions.py: action markers, which transfers belong to which user action
// (MIT, (c) 2026 Emir Mrkaljevic).
//
// Deviations: load_markers takes parsed JSON (array) or JSON text instead of a file path; append_marker is
// the pure part only: append_marker(marks, label, ts) mutates the `marks` array and returns the new marker
// (no file IO); read_labels takes text (a ';'-separated string, or file contents with one label per line)
// and never reads files. Python id(t) sets are Sets of the Transfer objects themselves.
import { Action, is_observation, split_observation, tupleKey } from './model.js';
import { hex } from './bytes.js';

/** Markers: JSON list (or its text) of {label, start, end?} (epoch seconds).
 * Missing `end` means "until the next action marker starts" (or +infinity). Observation markers
 * ('seen rpm 1180': what the vendor app displayed at that moment) are points in time: end = start. */
export function load_markers(src) {
  const parsed = typeof src === 'string' ? JSON.parse(src) : src;
  const marks = parsed.map((m) => ({ ...m })).sort((a, b) => a.start - b.start);
  const acts = marks.filter((m) => !is_observation(m.label));
  acts.forEach((m, i) => {
    if (m.end == null) m.end = i + 1 < acts.length ? acts[i + 1].start : Infinity;
  });
  for (const m of marks) if (m.end == null) m.end = m.start;
  return marks;
}

/** Pure part of append_marker: add a marker to `marks` (an array), closing any open action. Returns the new marker. */
export function append_marker(marks, label, ts = null) {
  const now = ts === null || ts === undefined ? Date.now() / 1000 : ts;
  let m;
  if (is_observation(label)) { // a reading of the screen does not end the action in progress
    m = { label, start: now, end: now };
  } else {
    for (const old of marks) if (old.end == null) old.end = now;
    m = { label, start: now, end: null };
  }
  marks.push(m);
  return m;
}

function _round3(x) {
  return Number(x.toFixed(3));
}

/** One entry per name/value pair of each 'seen ...' marker; time is seconds after t0. */
export function observations(marks, t0 = 0.0) {
  const out = [];
  for (const m of marks) {
    for (const [n, v] of split_observation(m.label)) {
      out.push({ label: m.label, ts: m.start, time: _round3(m.start - t0), name: n, value: v });
    }
  }
  return out;
}

export function assign(transfers, marks) {
  const acts = marks.filter((m) => !is_observation(m.label))
    .map((m) => new Action({ label: m.label, start: m.start, end: m.end }));
  for (const t of transfers) {
    for (const a of acts) {
      if (a.start <= t.ts && t.ts <= a.end) {
        a.transfers.push(t);
        break;
      }
    }
  }
  return acts;
}

/** Host->device messages that carry data (the interesting part). */
export function commands_of(action) {
  return action.transfers.filter((t) => t.is_out && t.data.length);
}

/** Median period if `ts` is sent at a steady rhythm and mostly on its own, else null. */
export function _periodic(ts, outs) {
  const iv = [];
  for (let i = 0; i + 1 < ts.length; i++) iv.push(ts[i + 1].ts - ts[i].ts);
  iv.sort((a, b) => a - b);
  const period = iv[Math.floor(iv.length / 2)];
  if (!(period > 0)) return null;
  // steady rhythm: most intervals within 35% of the median (a missed or late poll is fine)
  if (iv.filter((x) => Math.abs(x - period) <= 0.35 * period).length < 0.6 * iv.length) return null;
  const window = 0.1 * period;
  const mine = new Set(ts);
  const others = outs.filter((t) => !mine.has(t)).map((t) => t.ts);
  let alone = 0;
  for (const t of ts) if (!others.some((o) => Math.abs(o - t.ts) <= window)) alone += 1;
  return alone >= 0.5 * ts.length ? period : null;
}

/** Groups of same-shape messages that differ only in a +1 sequence byte (and maybe a trailing
 * checksum byte that changes with it). Returns [key, template (Uint8Array), masked positions, transfers] tuples. */
export function _counter_candidates(outs, skip, min_count) {
  const shapes = new Map();
  for (const t of outs) {
    if (!skip.has(t) && t.data.length <= 64) {
      const k = tupleKey([t.key(), t.data.length]);
      if (!shapes.has(k)) shapes.set(k, { key: t.key(), n: t.data.length, ts: [] });
      shapes.get(k).ts.push(t);
    }
  }
  const cands = [];
  for (const { key, n, ts } of shapes.values()) {
    if (ts.length < min_count) continue;
    for (let j = 0; j < n; j++) {
      const masks = j !== n - 1 ? [[j], [j, n - 1]] : [[j]];
      for (const mask of masks) {
        const groups = new Map();
        for (const t of ts) {
          const tpl = Uint8Array.from(t.data);
          for (const i of mask) tpl[i] = 0;
          const gk = hex(tpl);
          if (!groups.has(gk)) groups.set(gk, { tpl, g: [] });
          groups.get(gk).g.push(t);
        }
        for (const { tpl, g } of groups.values()) {
          if (g.length < min_count) continue;
          const steps = [];
          for (let i = 0; i + 1 < g.length; i++) steps.push((((g[i + 1].data[j] - g[i].data[j]) % 256) + 256) % 256);
          if (steps.filter((x) => x === 1).length >= 0.8 * steps.length) {
            cands.push([key, tpl, mask.slice().sort((a, b) => a - b), g]);
          }
        }
      }
    }
  }
  // prefer the biggest groups, then the fewest masked bytes
  cands.sort((a, b) => (b[3].length - a[3].length) || (a[2].length - b[2].length));
  return cands;
}

/** Host->device messages the vendor app sends on its own (status polls, keep-alives).
 *
 * A payload counts as background when the identical message (same channel, same bytes) is sent
 * at least `min_count` times, at a steady rhythm, and mostly on its own: at least half of the
 * copies have no other host->device message close by. That keeps a constant "apply" packet,
 * which always follows a real command, out of this list.
 * Polls that carry a sequence number are found too: same-shape messages that differ only in a
 * byte counting up by one (plus, optionally, a trailing checksum byte). Because a user could step
 * a value by one at a steady pace, these need at least 2 * min_count (and 8) copies.
 * Returns one object per payload: key, data, mask (positions that vary), count, period (s), frames,
 * ids (a Set of the Transfer objects, standing in for Python's id() set). */
export function find_background(transfers, min_count = 4) {
  const outs = transfers.filter((t) => t.is_out && t.data.length).sort((a, b) => a.ts - b.ts);
  const groups = new Map();
  for (const t of outs) {
    const k = tupleKey([t.key(), hex(t.data)]);
    if (!groups.has(k)) groups.set(k, { key: t.key(), data: t.data, ts: [] });
    groups.get(k).ts.push(t);
  }
  const found = [];
  const claimed = new Set();
  for (const { key, data, ts } of groups.values()) {
    if (ts.length < min_count) continue;
    const period = _periodic(ts, outs);
    if (period === null) continue;
    for (const t of ts) claimed.add(t);
    found.push({
      key, data, mask: [], count: ts.length, period: _round3(period),
      frames: ts.map((t) => t.frame), ids: new Set(ts),
    });
  }
  for (const [key, tpl, mask, ts] of _counter_candidates(outs, claimed, Math.max(2 * min_count, 8))) {
    if (ts.some((t) => claimed.has(t))) continue;
    const period = _periodic(ts, outs);
    if (period === null) continue;
    for (const t of ts) claimed.add(t);
    found.push({
      key, data: tpl, mask: Array.from(mask), count: ts.length, period: _round3(period),
      frames: ts.map((t) => t.frame), ids: new Set(ts),
    });
  }
  return found;
}

export function drop_background(transfers, background) {
  const ids = new Set();
  for (const b of background) for (const t of b.ids) ids.add(t);
  return transfers.filter((t) => !ids.has(t));
}

/** Hex payload with the varying (sequence/checksum) bytes shown as ??. `mask` is an array/Set of positions. */
export function pattern(data, mask) {
  const m = new Set(mask);
  return Array.from(data, (b, i) => (m.has(i) ? '??' : b.toString(16).padStart(2, '0'))).join(' ');
}

/** Build markers without timestamps: split host->device traffic at the largest pauses.
 *
 * For captures made in Wireshark/USBPcap where you simply clicked the actions in order with a
 * short pause between them. Returns markers usable by `assign`. */
export function segment_by_gaps(transfers, labels) {
  const outs = transfers.filter((t) => t.is_out && t.data.length).sort((a, b) => a.ts - b.ts);
  const n = labels.length;
  if (n === 0 || outs.length < n) {
    throw new Error(`${labels.length} labels but only ${outs.length} host->device messages in the capture`);
  }
  const idx = [];
  for (let i = 1; i < outs.length; i++) idx.push(i);
  const gaps = idx.sort((a, b) => (outs[b].ts - outs[b - 1].ts) - (outs[a].ts - outs[a - 1].ts)).slice(0, n - 1);
  const cuts = [0, ...gaps.sort((a, b) => a - b), outs.length];
  const marks = [];
  for (let k = 0; k < n; k++) {
    const a = cuts[k];
    const b = cuts[k + 1];
    marks.push({ label: labels[k], start: outs[a].ts - 1e-6, end: outs[b - 1].ts + 1e-6 });
  }
  return marks;
}

/** Labels from text: a ';'-separated string, or (when it contains a newline) file contents with one label
 * per line, '#' lines ignored. Python also accepted a file path; pass the file's text instead. */
export function read_labels(spec) {
  if (spec.includes('\n')) {
    return spec.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  }
  return spec.split(';').map((s) => s.trim()).filter(Boolean);
}
