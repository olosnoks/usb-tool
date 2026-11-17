// Core data model for the in-browser port of usb-rea (MIT, (c) 2026 Emir Mrkaljević,
// https://github.com/emirmrkaljevic/usb-rea). Mirrors src/usb_rea/model.py.
//
// Port conventions shared by every module in src/utils/usbrea/:
// - File names and exported identifiers keep the Python names (snake_case functions, same class names)
//   so modules ported in parallel line up without coordination.
// - Python `bytes` -> Uint8Array. Use the helpers in ./bytes.js (hex, fromHex, eq, concat, ...).
// - Python tuple dict keys -> Map keyed by a string (see Transfer.keyStr / tupleKey).
// - Python `None` -> null.

export const XFER_NAMES = { 0: 'iso', 1: 'interrupt', 2: 'control', 3: 'bulk' };

import { hex } from './bytes.js';

/** One USB data movement seen in a capture (an OUT submission or an IN completion). */
export class Transfer {
  constructor({ frame, ts, bus, device, endpoint, xfer_type, setup = null, data = new Uint8Array(0) }) {
    this.frame = frame; // 1-based frame number (matches Wireshark)
    this.ts = ts; // seconds since epoch (float)
    this.bus = bus;
    this.device = device;
    this.endpoint = endpoint; // includes direction bit 0x80 for IN
    this.xfer_type = xfer_type; // 0 iso, 1 interrupt, 2 control, 3 bulk
    this.setup = setup; // Uint8Array(8) for control transfers, else null
    this.data = data; // Uint8Array
  }
  get is_in() { return Boolean(this.endpoint & 0x80); }
  get is_out() { return !this.is_in; }
  get kind() { return XFER_NAMES[this.xfer_type] ?? String(this.xfer_type); }
  /** Channel identity used to align messages across actions: [device, endpoint, xfer_type, setupHex4]. */
  key() {
    const s = this.setup ? hex(this.setup.subarray(0, 4)) : '';
    return [this.device, this.endpoint, this.xfer_type, s];
  }
  /** key() as a string, for use as a Map key. */
  keyStr() { return tupleKey(this.key()); }
}

/** Turn a Python-style tuple (array) into a stable Map key. */
export function tupleKey(arr) { return JSON.stringify(arr); }

export class Action {
  constructor({ label, start, end, transfers = [] }) {
    this.label = label;
    this.start = start;
    this.end = end;
    this.transfers = transfers;
  }
  get name() { return split_label(this.label)[0]; }
  get value() { return split_label(this.label)[1]; }
  get values() { return split_values(this.label)[1]; }
}

/** 'brightness 50%' -> ['brightness', 50]; 'power on' -> ['power', 1]; 'reset' -> ['reset', null]. */
export function split_label(label) {
  label = label.trim();
  const m = label.match(/^(.*?)[\s=:]+(-?\d+(?:\.\d+)?)\s*%?$/s);
  if (m) return [m[1].trim().toLowerCase(), parseFloat(m[2])];
  const words = label.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 2 && ['on', 'off', 'true', 'false', 'yes', 'no'].includes(words[words.length - 1])) {
    return [words.slice(0, -1).join(' '), ['on', 'true', 'yes'].includes(words[words.length - 1]) ? 1 : 0];
  }
  return [label.toLowerCase(), null];
}

/** 'color 255, 24, 0' -> ['color', [255, 24, 0]]; falls back to split_label for one/zero values. */
export function split_values(label) {
  const toks = label.trim().split(/[\s,=:;/]+/).filter(Boolean);
  const name = [];
  const nums = [];
  for (const t of toks) {
    const m = t.match(/^(-?\d+(?:\.\d+)?)%?$/);
    if (m && name.length) nums.push(parseFloat(m[1]));
    else if (nums.length) break;
    else name.push(t);
  }
  if (nums.length >= 2 && name.length + nums.length === toks.length) return [name.join(' ').toLowerCase(), nums];
  const [n, v] = split_label(label);
  return [n, v === null ? [] : [v]];
}

/** 'seen rpm 1180' notes what the vendor app displayed; it is not an action. */
export function is_observation(label) {
  return /^\s*seen\b/i.test(label);
}

const STATES = { on: 1, off: 0, true: 1, false: 0, yes: 1, no: 0 };

/** 'seen rpm 1180, temp 34°C' -> [['rpm', 1180], ['temp', 34]]; [] for other labels. See model.py. */
export function split_observation(label) {
  if (!is_observation(label)) return [];
  let body = label.trim().slice(4);
  body = body.replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
  body = body.replace(/(?<=\d),(?=\d)/g, '.');
  const out = [];
  for (const part of body.split(/[,;]+/)) {
    let name = [];
    for (const t of part.trim().split(/[\s=:]+/)) {
      const v = t.match(/^(-?\d+(?:\.\d+)?)(?:%|°?[a-zA-Z]{0,3})$/);
      const state = Object.prototype.hasOwnProperty.call(STATES, t.toLowerCase()) ? STATES[t.toLowerCase()] : undefined;
      if ((v || state !== undefined) && name.length) {
        out.push([name.join(' ').toLowerCase(), v ? parseFloat(v[1]) : state]);
        name = [];
      } else if (t && !v) {
        name.push(t);
      }
    }
    if (name.length >= 2) out.push([name.slice(0, -1).join(' ').toLowerCase(), name[name.length - 1].toLowerCase()]);
  }
  return out;
}
