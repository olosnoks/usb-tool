// One-call analysis (port of usb-rea's pipeline.py). Browser version: takes the capture bytes and the
// parsed markers (the `<capture>.actions.json` written by `usb-rea mark`) instead of file paths.
import { assign, drop_background, find_background, load_markers, observations, pattern, segment_by_gaps } from './actions.js';
import { infer } from './infer.js';
import { is_observation } from './model.js';
import { find_ids, read_transfers } from './pcap.js';
import { drop_streams, find_streams } from './streams.js';
import { find_handshake, find_reopens, reopen_ids } from './handshake.js';
import { find_reported, find_states, find_switches } from './states.js';
import { analyze_responses } from './responses.js';
import * as hid from './hid.js';
import { fromHex, hex } from './bytes.js';

/**
 * @param {Uint8Array} capture  pcap / pcapng (optionally gzipped), usbmon or USBPcap
 * @param {object|string|null} markers  actions JSON (object or text); ignored when `labels` is given
 * @param {number|null} device  USB device address; default = the one with the most OUT data
 * @param {string[]|null} labels  action labels in order, for captures without markers (split on gaps)
 */
export function analyze(capture, markers = null, device = null, labels = null) {
  let ts = read_transfers(capture);
  const t0 = ts.length ? Math.min(...ts.map((t) => t.ts)) : 0;
  const ids = find_ids(ts);
  if (device === null || device === undefined) {
    // the device with the most host->device data is almost always the target
    const counts = new Map();
    for (const t of ts) if (t.is_out && t.data.length && t.device !== 0) counts.set(t.device, (counts.get(t.device) || 0) + 1);
    device = null;
    let best = -1;
    for (const [d, n] of counts) if (n > best) { best = n; device = d; }
  }
  ts = ts.filter((t) => device === null || t.device === device);
  const idEntry = ids instanceof Map ? ids.get(device) : ids?.[device];
  const [vid, pid] = idEntry || [null, null];
  // image/video streams to a screen would drown the commands: set aside first
  const streams = find_streams(ts);
  ts = drop_streams(ts, streams);
  // status polls / keep-alives
  const background = find_background(ts);
  const everything = ts;
  ts = drop_background(ts, background);
  let marks;
  if (labels && labels.length) {
    marks = segment_by_gaps(ts, labels.filter((lb) => !is_observation(lb)));
  } else {
    if (!markers) throw new Error('No action markers: load the .actions.json from `usb-rea mark`, or type the labels in order.');
    marks = load_markers(typeof markers === 'string' ? JSON.parse(markers) : markers);
  }
  const seen = observations(marks, t0);
  // a mid-capture re-handshake is session setup, not part of an action
  const reopens = find_reopens(everything, background, marks);
  if (reopens && reopens.length) {
    const drop = reopen_ids(reopens, everything);
    ts = ts.filter((t) => !drop.has(t));
  }
  const acts = assign(ts, marks);
  const proto = infer(acts, vid, pid);
  proto.switches = find_switches(acts, proto.commands);
  proto.states = find_states(acts, proto.commands);
  proto.hid = hid_summary(ts, proto);
  proto.streams = streams.map((st) => Object.fromEntries(Object.entries(st).filter(([k]) => k !== 'ids')));
  proto.background = background.map((b) => ({
    endpoint: b.key[1], xfer_type: b.key[2], setup: b.key[3] || null, payload: pattern(b.data, b.mask),
    count: b.count, period: b.period, frames: b.frames.slice(0, 5),
  }));
  proto.responses = analyze_responses(everything, proto.commands, background, seen);
  proto.states = proto.states.concat(find_reported(acts, proto.commands, proto.responses, everything));
  proto.handshake = find_handshake(everything, background, marks, proto.commands, t0, reopens);
  proto.observations = seen.map((o) => ({
    label: o.label, time: o.time, name: o.name, value: o.value,
    matched: proto.responses.flatMap((r) => r.fields
      .filter((f) => f.name === o.name && f.observed.some((x) => x[3] === o.time))
      .map((f) => `${r.query} ${_span(f)}`)),
  }));
  return proto;
}

export function _span(f) {
  if (f.bit_width === 1) return `byte ${f.offset} bit ${f.bit_offset}`;
  if (f.bit_width) return `byte ${f.offset} bits ${f.bit_offset}-${f.bit_offset + f.bit_width - 1}`;
  return f.width > 1 ? `bytes ${f.offset}-${f.offset + f.width - 1}` : `byte ${f.offset}`;
}

/** Decode HID report descriptors seen in the capture and map each inferred command to its report. */
export function hid_summary(transfers, proto) {
  const out = [];
  const found = hid.from_transfers(transfers);
  const entries = found instanceof Map
    ? [...found.entries()].map(([k, raw]) => [typeof k === 'string' ? JSON.parse(k) : k, raw])
    : Object.entries(found).map(([k, raw]) => [JSON.parse(k), raw]);
  entries.sort((a, b) => a[0][0] - b[0][0] || a[0][1] - b[0][1]);
  for (const [[, iface], raw] of entries) {
    let desc;
    try {
      desc = hid.parse(raw);
    } catch (e) {
      out.push({ interface: iface, descriptor: hex(raw), error: String(e.message || e) });
      continue;
    }
    const cmds = {};
    for (const c of proto.commands) {
      const data = c.samples.length ? fromHex(c.samples[0][1].replace(/ /g, '')) : new Uint8Array(0);
      const rep = hid.match(desc, c.setup, c.endpoint, data);
      if (rep === null || rep === undefined) continue;
      let note = rep.title();
      if (rep.length !== c.length) note += `; captured ${c.length} bytes, descriptor says ${rep.length}`;
      cmds[c.name] = note;
    }
    out.push({ interface: iface, descriptor: hex(raw), ...desc.to_dict(), commands: cmds });
  }
  return out;
}

export async function sha256(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return hex(new Uint8Array(d));
}
