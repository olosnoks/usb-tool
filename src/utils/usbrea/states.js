// Commands the vendor app only sent while the device was in one state (set by another command).
// Port of usb_rea/states.py; see the Python docstring for the full description.
//
// A state-setting command is one that picks a mode: its single argument is a lookup table
// (mode 1/2/3 -> 0x11/0x22/0x47) or an on/off label. Walking the actions in capture order gives the
// state the device was in when each other command was sent. A command gets a precondition when it
// was sent at least twice, every time after the setter had chosen the same value, and the capture also shows
// the setter at another value while other commands were used.
//   * find_switches: the app sends the mode command, then the action's own packet(s), then (often) the
//     mode command again to go back, all for one click.
//   * find_reported: a status reply byte named as a mode or on/off flag ('seen mode turbo' markers).
import { commands_of } from './actions.js';
import { compute } from './checksums.js';
import { split_values } from './model.js';
import { fmtg, mark_command_ids, py_round_n, table_get, table_items, table_truthy } from './infer.js';
import { readInt, minOf } from './bytes.js';

export const STALE = 5.0; // seconds: a status reply older than this does not tell the state a command was sent in

export function _key(a) {
  return !a.values.length || a.values.length === 1 ? a.name : split_values(a.label)[0];
}

export function _is_setter(c, values) {
  if (c.steps.length || c.arity !== 1 || values.size < 2) return false;
  const lookup = c.fields.some((f) => f.kind === 'lookup');
  return lookup || [...values].every((v) => v === 0 || v === 1);
}

const byStart = (a, b) => a.start - b.start;
const uniq = (arr) => [...new Set(arr)];
const numSort = (arr) => arr.sort((a, b) => a - b);
const strSort = (arr) => arr.sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));

function valuesByName(acts) {
  const values = new Map();
  for (const a of acts) {
    if (a.values.length) {
      const k = _key(a);
      if (!values.has(k)) values.set(k, new Set());
      values.get(k).add(Number(a.values[0]));
    }
  }
  return values;
}

/** Set `requires` on gated commands and return the preconditions (JSON-ready objects). */
export function find_states(actions, commands) {
  const by_name = new Map(commands.map((c) => [c.name, c]));
  const acts = actions.filter((a) => commands_of(a).length && by_name.has(_key(a))).sort(byStart);
  const values = valuesByName(acts);
  const setters = [...by_name.keys()].filter((n) => _is_setter(by_name.get(n), values.get(n) || new Set()));
  const found = [];
  for (const s of setters) {
    let cur = null;
    let frame = null;
    const seen = []; // [command, state, setter frame, frame]
    for (const a of acts) {
      const k = _key(a);
      if (k === s) {
        cur = Number(a.values[0]);
        frame = commands_of(a)[0].frame;
      } else if (!setters.includes(k)) {
        seen.push([k, cur, frame, commands_of(a)[0].frame]);
      }
    }
    for (const name of uniq(seen.map((x) => x[0]))) {
      const mine = seen.filter((x) => x[0] === name);
      const states = new Set(mine.map((x) => x[1]));
      if (mine.length < 2 || states.size !== 1 || states.has(null)) continue;
      const want = [...states][0];
      const others = numSort(uniq(seen.filter((x) => x[0] !== name && x[1] !== null && x[1] !== want).map((x) => x[1])));
      if (!others.length) continue; // the state never changed while other commands were used: nothing to compare
      if (by_name.get(name).switch) continue; // the app switches into its own state inside the action
      const setter_frames = numSort(uniq(mine.map((x) => x[2])));
      const req = {
        command: name, state: s, value: want, source: 'command', count: mine.length,
        other_values: others, setter_frames, frames: mine.map((x) => x[3]),
      };
      found.push(req);
      const c = by_name.get(name);
      const { command: _omit, ...rest } = req;
      c.requires = [...(c.requires || []), rest];
      c.notes.push(`only sent while ${s} was ${fmtg(want)} (${mine.length}x, after frame(s) ${setter_frames.join(', ')}); `
        + `other commands were also used with ${s} ${others.map((v) => fmtg(v)).join(', ')}. The driver sets ${s} ${fmtg(want)} first`);
    }
  }
  return found;
}

/** A state value as text: 3 for 3.0, words as they are. */
export function fmt(v) {
  return typeof v === 'number' ? fmtg(v) : String(v);
}

export function _same_channel(c, t) {
  const a = JSON.stringify([t.endpoint, t.xfer_type, t.setup ? Array.from(t.setup.subarray(0, 4)) : null]);
  const b = JSON.stringify([c.endpoint, c.xfer_type, c.setup ? Array.from(c.setup.subarray(0, 4)) : null]);
  return a === b && t.data.length === c.length;
}

/** The label value a one-argument state command `c` would have sent as packet `t`, or null when `t` is
 * not that command. */
export function decode_setter(c, t) {
  if (c.steps.length || c.arity !== 1 || !_same_channel(c, t)) return null;
  const d = t.data;
  let got = null;
  for (const f of c.fields) {
    const raw = readInt(d, f.offset, f.width, f.endian === 'le' ? 'little' : 'big');
    if (f.kind === 'const' || f.kind === 'command') {
      if (raw !== f.const) return null;
    } else if (f.kind === 'lookup') {
      const back = table_items(f.table).filter(([, b]) => b === raw).map(([v]) => v);
      if (back.length !== 1) return null;
      got = Number(back[0]);
    } else if (f.kind === 'value' && f.scale) {
      const v = (raw - f.bias) / f.scale;
      const known = new Set();
      for (const [lb] of c.samples) {
        const vs = split_values(lb)[1];
        if (vs.length === 1) known.add(vs[0]);
      }
      if (Math.abs(v - py_round_n(v)) > 1e-6 || !known.has(py_round_n(v))) return null;
      got = Number(py_round_n(v));
    } else if (f.kind === 'checksum') {
      if (f.source !== null || raw !== compute(f.algo, d.slice(f.covers[0], f.covers[1]))) return null;
    } else if (f.kind !== 'counter') {
      return null;
    }
  }
  return got;
}

export function _rename(c, name) {
  c.name = name;
  c.steps.forEach((x, k) => { x.name = `${name} [packet ${k + 2}]`; });
}

/** Multi-packet actions that are really a state switch around the action's own packets.
 * Rewrites those commands in place (inner packets only, with `switch`) and returns the switches. */
export function find_switches(actions, commands) {
  const by_name = new Map(commands.map((c) => [c.name, c]));
  const acts = actions.filter((a) => commands_of(a).length && by_name.has(_key(a))).sort(byStart);
  const values = valuesByName(acts);
  const setters = [...by_name.keys()].filter((n) => _is_setter(by_name.get(n), values.get(n) || new Set())).map((n) => by_name.get(n));
  const found = [];
  for (const c of [...commands]) {
    const packets = [c, ...c.steps];
    if (packets.length < 2 || setters.some((s) => s.name === c.name)) continue;
    const mine = acts.filter((a) => _key(a) === c.name && commands_of(a).length === packets.length
      && packets.every((p, i) => _same_channel(p, commands_of(a)[i])));
    if (mine.length < 2) continue;
    const ids = new Map(mine.map((a, i) => [a, i]));
    for (const s of setters) {
      const enter = mine.map((a) => decode_setter(s, commands_of(a)[0]));
      if (enter.includes(null)) continue;
      if (new Set(enter).size !== 1) {
        c.notes.push(`the first packet is the ${s.name} command, but with different values `
          + `(${uniq(enter.map(fmt)).sort().join(', ')}): not replayed as a switch`);
        break;
      }
      const last = mine.map((a) => decode_setter(s, commands_of(a)[commands_of(a).length - 1]));
      const back = !last.includes(null) && packets.length >= 3;
      const inner = back ? packets.slice(1, -1) : packets.slice(1);
      if (mine.some((a) => { for (let k = 1; k < 1 + inner.length; k++) if (decode_setter(s, commands_of(a)[k]) !== null) return true; return false; })) {
        break; // the "action" is only more state commands
      }
      if (inner.some((p) => p.fields.some((f) => f.kind === 'checksum' && f.source !== null && !(f.source >= 1 && f.source <= inner.length)))) {
        break; // a checksum over a state packet: keep the transaction as captured
      }
      // the state each action started in: the last value its state command chose before it
      let cur = null;
      const before = new Map();
      for (const a of acts) {
        const k = _key(a);
        if (k === s.name) cur = Number(a.values[0]);
        else if (ids.has(a)) {
          before.set(a, cur);
          cur = back ? last[ids.get(a)] : enter[0];
        }
      }
      let restore = null;
      if (back) {
        const prev = mine.map((a) => before.get(a));
        if (!prev.includes(null) && prev.every((p, i) => p === last[i])) restore = 'previous';
        else if (new Set(last).size === 1) restore = last[0];
        else {
          c.notes.push(`the last packet sets ${s.name} ${last.map(fmt).join(', ')}, which is `
            + 'neither the value from before the action nor one fixed value: not replayed as a switch');
          break;
        }
      }
      // the action is the inner packets; the driver sends the state command around them
      const nw = inner[0];
      nw.steps = inner.slice(1);
      for (const p of inner) for (const f of p.fields) if (f.kind === 'checksum' && f.source !== null) f.source -= 1;
      const sw = {
        command: c.name, state: s.name, enter: enter[0], restore, count: mine.length, packets: packets.length,
        enter_frames: mine.map((a) => commands_of(a)[0].frame),
        restore_frames: back ? mine.map((a) => commands_of(a)[commands_of(a).length - 1].frame) : [],
        restore_values: back ? last : [],
      };
      const { command: _omit, ...swRest } = sw;
      nw.switch = swRest;
      nw.notes = [...c.notes.filter((n) => !n.startsWith('multi-packet')), ...nw.notes];
      if (nw.steps.length) nw.notes.push(`multi-packet transaction: ${inner.length} packets per action, sent in this order`);
      const back_txt = restore === 'previous'
        ? `and back to the value it had before (${last.map(fmt).join(', ')})`
        : back ? `and then to ${s.name} ${fmt(restore)}` : 'and left it there';
      nw.notes.push(`the app switched ${s.name} to ${fmt(enter[0])} inside this action (${mine.length}x, `
        + `frames ${sw.enter_frames.slice(0, 8).join(', ')}) ${back_txt}; the driver does `
        + 'the same around these packets');
      nw.confidence = py_round_n(minOf(inner.map((p) => p.confidence)), 2);
      nw.samples = inner[0].samples;
      _rename(nw, c.name);
      commands[commands.indexOf(c)] = nw;
      found.push(sw);
      break;
    }
  }
  if (found.length) mark_command_ids(commands);
  return found;
}

/** [response, field] for each status-reply byte named as a mode (word table) or an on/off flag. */
export function _reported(responses) {
  const out = [];
  for (const r of responses) {
    if (r.source !== 'background' && r.source !== 'control read') continue;
    for (const f of r.fields) {
      if (f.kind === 'reading' && f.name && (table_truthy(f.table) || f.bit_width === 1)) out.push([r, f]);
    }
  }
  return out;
}

export function _report_value(f, data) {
  let raw = data[f.offset];
  if (f.bit_width) raw = (raw >> f.bit_offset) & ((1 << f.bit_width) - 1);
  if (table_truthy(f.table)) {
    const v = table_get(f.table, raw);
    return v === undefined ? null : v;
  }
  return Number(raw);
}

/** Every IN transfer shaped like this status reply: same endpoint and length, fixed bytes and checksum hold. */
export function _replies(r, transfers) {
  const out = [];
  for (const t of transfers) {
    if (!(t.is_in && t.data.length && t.endpoint === r.endpoint && t.xfer_type === r.xfer_type && t.data.length === r.length)) continue;
    let ok = true;
    for (const f of r.fields) {
      const raw = readInt(t.data, f.offset, f.width, f.endian === 'le' ? 'little' : 'big');
      if ((f.kind === 'const' || f.kind === 'echo') && f.const !== null && raw !== f.const) ok = false;
      else if (f.kind === 'checksum' && f.algo && raw !== compute(f.algo, t.data.slice(f.covers[0], f.covers[1]))) ok = false;
    }
    if (ok) out.push(t);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

function bisect_left(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Set `requires` on commands the app only sent while a status reply showed one mode or flag value;
 * return those preconditions (JSON-ready objects, `source` "reply"). */
export function find_reported(actions, commands, responses, transfers) {
  const by_name = new Map(commands.map((c) => [c.name, c]));
  const acts = actions.filter((a) => commands_of(a).length && by_name.has(_key(a))).sort(byStart);
  const found = [];
  for (const [r, f] of _reported(responses)) {
    const reps = _replies(r, transfers);
    const times = reps.map((t) => t.ts);
    const before = (ts) => {
      const i = bisect_left(times, ts) - 1;
      return i >= 0 && ts - times[i] <= STALE ? reps[i] : null;
    };
    // The last status reply after action `a` and before the next action (what it left the device in).
    const settled = (a) => {
      const cs = commands_of(a);
      const ts = cs[cs.length - 1].ts;
      let nxt = ts + STALE;
      for (const b of acts) { const bt = commands_of(b)[0].ts; if (bt > ts) { nxt = bt; break; } }
      const i = bisect_left(times, Math.min(nxt, ts + STALE)) - 1;
      return i >= 0 && times[i] > ts ? reps[i] : null;
    };

    // commands that set this state: every time, the next status reply shows the value it stands for
    const setters = new Map();
    for (const [name, c] of by_name) {
      const mine = acts.filter((a) => _key(a) === name);
      if (c.steps.length || c.arity !== 1 || mine.length < 2 || mine.some((a) => !a.values.length)) continue;
      const seen = new Map();
      let changed = false;
      let broke = false;
      for (const a of mine) {
        const b = before(commands_of(a)[0].ts);
        const n = settled(a);
        const v = n ? _report_value(f, n.data) : null;
        const key = Number(a.values[0]);
        if (v === null) { broke = true; break; }
        if (!seen.has(key)) seen.set(key, v);
        if (seen.get(key) !== v) { broke = true; break; }
        changed = changed || b === null || _report_value(f, b.data) !== v;
      }
      if (!broke && changed && new Set(seen.values()).size === seen.size) {
        setters.set(name, { command: name, map: seen, frames: mine.map((a) => commands_of(a)[0].frame) });
      }
    }
    const seen = []; // [command, reported value, reply frame, command frame]
    for (const a of acts) {
      const k = _key(a);
      if (setters.has(k)) continue;
      const t = commands_of(a)[0];
      const b = before(t.ts);
      seen.push([k, b ? _report_value(f, b.data) : null, b ? b.frame : null, t.frame]);
    }
    for (const name of uniq(seen.map((x) => x[0]))) {
      const c = by_name.get(name);
      if (c.switch || (c.requires || []).some((q) => q.state === f.name)) continue;
      const mine = seen.filter((x) => x[0] === name);
      const states = new Set(mine.map((x) => x[1]));
      if (mine.length < 2 || states.size !== 1 || states.has(null)) continue;
      const want = [...states][0];
      const others = strSort(uniq(seen.filter((x) => x[0] !== name && x[1] !== null && x[1] !== want).map((x) => x[1])));
      if (!others.length) continue;
      let st = null;
      outer:
      for (const s of setters.values()) {
        for (const [v, got] of s.map) {
          if (got === want) { st = { command: s.command, value: v, count: s.frames.length, frames: s.frames }; break outer; }
        }
      }
      const where = `byte ${f.offset}` + (f.bit_width === 1 ? ` bit ${f.bit_offset}`
        : f.bit_width ? ` bits ${f.bit_offset}-${f.bit_offset + f.bit_width - 1}` : '');
      const req = {
        command: name, state: f.name, value: want, source: 'reply', reply: r.query, where, flag: !table_truthy(f.table),
        count: mine.length, other_values: others, reply_frames: mine.map((x) => x[2]), frames: mine.map((x) => x[3]), setter: st,
      };
      found.push(req);
      const { command: _omit, ...rest } = req;
      c.requires = [...(c.requires || []), rest];
      const how = st
        ? `switches it with ${st.command} ${fmt(st.value)} (after which the reply showed ${fmt(want)} each time, frames `
          + `${st.frames.slice(0, 8).join(', ')}) and reads it again`
        : 'raises StateError when the device reports another value (no command in the capture was seen to change it)';
      c.notes.push(`only sent while the device reported ${f.name} ${fmt(want)} (${r.query} ${where}, `
        + `${mine.length}x, replies in frames ${req.reply_frames.slice(0, 8).join(', ')}); other `
        + `commands were also used while it reported ${others.map(fmt).join(', ')}. The driver `
        + `asks first and ${how}`);
    }
  }
  return found;
}
