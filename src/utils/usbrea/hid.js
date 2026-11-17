// HID report descriptor decoder. Port of usb-rea src/usb_rea/hid.py (MIT, (c) 2026 Emir Mrkaljević).
//
// Turns the raw report descriptor (GET_DESCRIPTOR type 0x22, or a hex string) into reports and
// fields so captured SET_REPORT / interrupt payloads can be mapped to named, bit-exact fields.
// Follows HID 1.11 section 6.2.2.
//
// Port notes: from_transfers returns a Map keyed by tupleKey([device, interface]) -> Uint8Array;
// decode returns an array of [label, value] pairs; a missing report throws an Error named KeyError.
import { fromHex, readInt, hex } from './bytes.js';
import { tupleKey } from './model.js';

export const MAIN = { 0x8: 'Input', 0x9: 'Output', 0xB: 'Feature', 0xA: 'Collection', 0xC: 'End Collection' };
export const GLOBAL = {
  0x0: 'Usage Page', 0x1: 'Logical Minimum', 0x2: 'Logical Maximum', 0x3: 'Physical Minimum',
  0x4: 'Physical Maximum', 0x5: 'Unit Exponent', 0x6: 'Unit', 0x7: 'Report Size',
  0x8: 'Report ID', 0x9: 'Report Count', 0xA: 'Push', 0xB: 'Pop',
};
export const LOCAL = {
  0x0: 'Usage', 0x1: 'Usage Minimum', 0x2: 'Usage Maximum', 0x3: 'Designator Index',
  0x4: 'Designator Minimum', 0x5: 'Designator Maximum', 0x7: 'String Index',
  0x8: 'String Minimum', 0x9: 'String Maximum', 0xA: 'Delimiter',
};
export const COLLECTIONS = {
  0: 'Physical', 1: 'Application', 2: 'Logical', 3: 'Report', 4: 'Named Array',
  5: 'Usage Switch', 6: 'Usage Modifier',
};
export const PAGES = {
  0x01: 'Generic Desktop', 0x02: 'Simulation', 0x05: 'Game', 0x06: 'Generic Device',
  0x07: 'Keyboard/Keypad', 0x08: 'LED', 0x09: 'Button', 0x0A: 'Ordinal', 0x0B: 'Telephony',
  0x0C: 'Consumer', 0x0D: 'Digitizer', 0x0F: 'PID', 0x14: 'Auxiliary Display',
  0x20: 'Sensor', 0x59: 'Lighting And Illumination', 0x84: 'Power Device', 0x85: 'Battery System',
};
export const USAGES = {
  0x01: {
    0x01: 'Pointer', 0x02: 'Mouse', 0x04: 'Joystick', 0x05: 'Game Pad', 0x06: 'Keyboard',
    0x07: 'Keypad', 0x08: 'Multi-axis Controller', 0x30: 'X', 0x31: 'Y', 0x32: 'Z', 0x33: 'Rx',
    0x34: 'Ry', 0x35: 'Rz', 0x36: 'Slider', 0x37: 'Dial', 0x38: 'Wheel', 0x39: 'Hat Switch',
    0x80: 'System Control', 0x81: 'System Power Down', 0x82: 'System Sleep', 0x83: 'System Wake Up',
  },
  0x0C: {
    0x01: 'Consumer Control', 0xB5: 'Scan Next Track', 0xB6: 'Scan Previous Track',
    0xB7: 'Stop', 0xCD: 'Play/Pause', 0xE2: 'Mute', 0xE9: 'Volume Increment',
    0xEA: 'Volume Decrement', 0x238: 'AC Pan',
  },
  0x08: { 0x01: 'Num Lock', 0x02: 'Caps Lock', 0x03: 'Scroll Lock', 0x04: 'Compose', 0x05: 'Kana' },
};
export const REPORT_TYPES = { 1: 'Input', 2: 'Output', 3: 'Feature' };

const h2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const h4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

export function page_name(page) {
  if (page >= 0xFF00) return `Vendor 0x${h4(page)}`;
  return PAGES[page] ?? `Page 0x${h2(page)}`;
}

export function usage_name(page, usage) {
  if (page === 0x09) return `Button ${usage}`;
  if (page === 0x0A) return `Instance ${usage}`;
  return (USAGES[page] ?? {})[usage] ?? `0x${h2(usage)}`;
}

export class Item {
  constructor({ offset, kind, tag, data }) {
    this.offset = offset;
    this.kind = kind; // "main" | "global" | "local" | "long" | "reserved"
    this.tag = tag;
    this.data = data; // Uint8Array
  }
  get uvalue() { return this.data.length ? readInt(this.data, 0, this.data.length, 'little') : 0; }
  get svalue() { return this.data.length ? readInt(this.data, 0, this.data.length, 'little', true) : 0; }
  get name() {
    const table = { main: MAIN, global: GLOBAL, local: LOCAL }[this.kind] ?? {};
    return table[this.tag] ?? `${this.kind} tag 0x${this.tag.toString(16).toUpperCase()}`;
  }
}

export function items(desc) {
  const out = [];
  let i = 0;
  while (i < desc.length) {
    const p = desc[i];
    if (p === 0xFE) { // long item
      if (i + 2 >= desc.length) throw new Error(`truncated long item at byte ${i}`);
      const size = desc[i + 1];
      const tag = desc[i + 2];
      out.push(new Item({ offset: i, kind: 'long', tag, data: Uint8Array.from(desc.subarray(i + 3, i + 3 + size)) }));
      i += 3 + size;
      continue;
    }
    const size = [0, 1, 2, 4][p & 3];
    const kind = ['main', 'global', 'local', 'reserved'][(p >> 2) & 3];
    if (i + 1 + size > desc.length) throw new Error(`truncated item 0x${p.toString(16).padStart(2, '0')} at byte ${i}`);
    out.push(new Item({ offset: i, kind, tag: p >> 4, data: Uint8Array.from(desc.subarray(i + 1, i + 1 + size)) }));
    i += 1 + size;
  }
  return out;
}

export class Field {
  constructor({
    report_type, report_id, bit_offset, size, count, usage_page, usages, logical_min, logical_max, flags,
    collection = '',
  }) {
    this.report_type = report_type; // Input | Output | Feature
    this.report_id = report_id; // 0 when the descriptor uses no report IDs
    this.bit_offset = bit_offset; // offset inside the report payload, excluding the report ID byte
    this.size = size; // bits per element
    this.count = count;
    this.usage_page = usage_page;
    this.usages = usages; // one per element for variables; the usage range for arrays
    this.logical_min = logical_min;
    this.logical_max = logical_max;
    this.flags = flags;
    this.collection = collection;
  }
  get constant() { return Boolean(this.flags & 1); }
  get variable() { return Boolean(this.flags & 2); }
  get relative() { return Boolean(this.flags & 4); }

  label(i = 0) {
    if (this.constant) return 'padding';
    if (!this.usages.length) return `${page_name(this.usage_page)} (no usage)`;
    if (!this.variable) {
      const lo = this.usages[0];
      const hi = this.usages[this.usages.length - 1];
      return `${page_name(this.usage_page)} array [${usage_name(this.usage_page, lo)}..${usage_name(this.usage_page, hi)}]`;
    }
    const u = this.usages[Math.min(i, this.usages.length - 1)];
    return `${page_name(this.usage_page)}: ${usage_name(this.usage_page, u)}`;
  }

  describe() {
    const bits = `bits ${this.bit_offset}..${this.bit_offset + this.size * this.count - 1}`;
    let what = this.label();
    if (this.variable && !this.constant && this.count > 1 && new Set(this.usages).size > 1) {
      what = `${what} .. ${usage_name(this.usage_page, this.usages[this.usages.length - 1])}`;
    }
    const attrs = [this.constant ? 'Const' : 'Data', this.variable ? 'Var' : 'Array', this.relative ? 'Rel' : 'Abs'];
    return `${bits}: ${what} (${this.count}x${this.size} bit, logical ${this.logical_min}..${this.logical_max}, ${attrs.join(',')})`;
  }
}

export class Report {
  constructor({ report_type, report_id, fields = [] }) {
    this.report_type = report_type;
    this.report_id = report_id;
    this.fields = fields;
  }
  get bits() {
    return this.fields.reduce((m, f) => Math.max(m, f.bit_offset + f.size * f.count), 0);
  }
  /** Bytes on the wire, including the report ID byte when IDs are used. */
  get length() { return Math.floor((this.bits + 7) / 8) + (this.report_id ? 1 : 0); }
  get vendor() { return this.fields.some((f) => !f.constant && f.usage_page >= 0xFF00); }
  title() {
    const rid = this.report_id ? `id 0x${h2(this.report_id)}` : 'no id';
    const f = this.fields.find((x) => !x.constant);
    const page = f ? page_name(f.usage_page) : 'padding only';
    return `${this.report_type} report (${rid}, ${this.length} bytes, ${page})`;
  }
}

export class Descriptor {
  constructor({ raw, items, reports, top_usages }) {
    this.raw = raw;
    this.items = items;
    this.reports = reports;
    this.top_usages = top_usages;
  }
  get uses_report_ids() { return this.reports.some((r) => r.report_id); }
  report(report_type, report_id = 0) {
    for (const r of this.reports) if (r.report_type === report_type && r.report_id === report_id) return r;
    return null;
  }
  to_dict() {
    return {
      length: this.raw.length, top_level: this.top_usages, uses_report_ids: this.uses_report_ids,
      reports: this.reports.map((r) => ({
        type: r.report_type, id: r.report_id, length: r.length, vendor: r.vendor,
        fields: r.fields.map((f) => f.describe()),
      })),
    };
  }
}

/** Parse a report descriptor (Uint8Array, or hex with optional spaces/0x/commas). */
export function parse(desc) {
  if (typeof desc === 'string') {
    desc = fromHex(desc.replaceAll('0x', '').replaceAll(',', ' ').replaceAll('\n', ' '));
  }
  const its = items(desc);
  let g = { page: 0, lmin: 0, lmax: 0, size: 0, count: 0, id: 0 };
  const stack = [];
  let local = { usages: [], min: null, max: null };
  const reports = new Map();
  const colls = [];
  const top = [];

  const full = (u) => {
    if (u.data.length === 4) return [Math.floor(u.uvalue / 65536), u.uvalue & 0xFFFF];
    return [g.page, u.uvalue];
  };

  for (const it of its) {
    if (it.kind === 'global') {
      if (it.tag === 0x0) g.page = it.uvalue;
      else if (it.tag === 0x1) g.lmin = it.svalue;
      else if (it.tag === 0x2) {
        // logical max is read as signed only when logical min is negative (what Linux hid-core does)
        g.lmax = g.lmin < 0 ? it.svalue : it.uvalue;
      } else if (it.tag === 0x7) g.size = it.uvalue;
      else if (it.tag === 0x8) g.id = it.uvalue;
      else if (it.tag === 0x9) g.count = it.uvalue;
      else if (it.tag === 0xA) stack.push({ ...g });
      else if (it.tag === 0xB && stack.length) g = stack.pop();
    } else if (it.kind === 'local') {
      if (it.tag === 0x0) local.usages.push(full(it));
      else if (it.tag === 0x1) local.min = full(it);
      else if (it.tag === 0x2) local.max = full(it);
    } else if (it.kind === 'main') {
      if (it.tag === 0xA) {
        const u = local.usages.length ? local.usages[0] : null;
        const name = u ? `${page_name(u[0])}: ${usage_name(u[0], u[1])}` : '?';
        const kind = COLLECTIONS[it.uvalue] ?? `0x${h2(it.uvalue)}`;
        if (!colls.length) top.push(name);
        colls.push(`${name} (${kind})`);
      } else if (it.tag === 0xC) {
        if (colls.length) colls.pop();
      } else if (it.tag === 0x8 || it.tag === 0x9 || it.tag === 0xB) {
        const rtype = MAIN[it.tag];
        const rkey = tupleKey([rtype, g.id]);
        if (!reports.has(rkey)) reports.set(rkey, new Report({ report_type: rtype, report_id: g.id }));
        const rep = reports.get(rkey);
        const usages = [...local.usages];
        if (local.min !== null && local.max !== null) {
          const pg = local.min[0];
          for (let u = local.min[1]; u < local.max[1] + 1; u++) usages.push([pg, u]);
        }
        const page = usages.length ? usages[0][0] : g.page;
        const fld = new Field({
          report_type: rtype, report_id: g.id, bit_offset: rep.bits, size: g.size, count: g.count,
          usage_page: page, usages: usages.map(([, u]) => u), logical_min: g.lmin, logical_max: g.lmax,
          flags: it.uvalue, collection: colls.length ? colls[colls.length - 1] : '',
        });
        if (fld.variable && fld.usages.length && fld.usages.length < fld.count) {
          const last = fld.usages[fld.usages.length - 1];
          const extra = fld.count - fld.usages.length;
          for (let k = 0; k < extra; k++) fld.usages.push(last);
        }
        rep.fields.push(fld);
      }
      local = { usages: [], min: null, max: null };
    }
  }
  return new Descriptor({ raw: Uint8Array.from(desc), items: its, reports: [...reports.values()], top_usages: top });
}

function _bits(data, offset, size) {
  let v = 0n;
  for (let i = data.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(data[i]);
  return Number((v >> BigInt(offset)) & ((1n << BigInt(size)) - 1n));
}

/** Decode one report payload into [field label, value] pairs. Padding is skipped. */
export function decode(desc, report_type, data) {
  const rid = desc.uses_report_ids && data.length ? data[0] : 0;
  const body = rid ? data.subarray(1) : data;
  const rep = desc.report(report_type, rid);
  if (rep === null) {
    const e = new Error(`no ${report_type} report with id ${rid} in descriptor`);
    e.name = 'KeyError';
    throw e;
  }
  const out = [];
  for (const f of rep.fields) {
    if (f.constant) continue;
    for (let i = 0; i < f.count; i++) {
      let raw = _bits(body, f.bit_offset + i * f.size, f.size);
      if (f.logical_min < 0 && raw >= 2 ** (f.size - 1)) raw -= 2 ** f.size;
      if (f.variable) {
        out.push([f.label(i), raw]);
      } else if (raw) {
        const u = f.usages.length ? f.usages[0] + raw - f.logical_min : raw;
        out.push([`${page_name(f.usage_page)} usage`, u]);
      }
    }
  }
  return out;
}

/** hid-tools style listing: one line per item, with byte offsets. */
export function dump(desc) {
  const lines = [];
  let depth = 0;
  let page = 0;
  for (const it of desc.items) {
    if (it.kind === 'global' && it.tag === 0) page = it.uvalue;
    if (it.kind === 'main' && it.tag === 0xC) depth = Math.max(0, depth - 1);
    const raw = hex(desc.raw.subarray(it.offset, it.offset + 1 + it.data.length), ' ');
    let val = '';
    if (it.data.length) {
      if (it.kind === 'global' && it.tag === 0) {
        val = page_name(it.uvalue);
      } else if (it.kind === 'main' && it.tag === 0xA) {
        val = COLLECTIONS[it.uvalue] ?? `0x${it.uvalue.toString(16)}`;
      } else if (it.kind === 'main') {
        val = [(it.uvalue & 1) ? 'Const' : 'Data', (it.uvalue & 2) ? 'Var' : 'Array', (it.uvalue & 4) ? 'Rel' : 'Abs'].join(',');
      } else if (it.kind === 'local' && (it.tag === 0 || it.tag === 1 || it.tag === 2)) {
        const [pg, u] = it.data.length === 4 ? [Math.floor(it.uvalue / 65536), it.uvalue & 0xFFFF] : [page, it.uvalue];
        val = usage_name(pg, u);
      } else if (it.kind === 'global' && it.tag >= 1 && it.tag <= 4) {
        val = String(it.svalue);
      } else {
        val = String(it.uvalue);
      }
    }
    lines.push(`${String(it.offset).padStart(4)}  ${raw.padEnd(15)} ${'  '.repeat(depth)}${it.name}` + (val ? ` (${val})` : ''));
    if (it.kind === 'main' && it.tag === 0xA) depth += 1;
  }
  return lines.join('\n');
}

/** Find HID report descriptors in a capture: Map of tupleKey([device, interface]) -> descriptor bytes. */
export function from_transfers(transfers) {
  const found = new Map();
  const pending = new Map();
  for (const t of transfers) {
    if (t.xfer_type !== 2) continue;
    if (t.setup && t.setup.length && t.setup[0] === 0x81 && t.setup[1] === 6 && t.setup[3] === 0x22) {
      pending.set(t.device, t.setup[4] | (t.setup[5] << 8));
    } else if (pending.has(t.device) && t.is_in && t.data.length && !(t.setup && t.setup.length)) {
      found.set(tupleKey([t.device, pending.get(t.device)]), t.data);
      pending.delete(t.device);
    }
  }
  return found;
}

/** Which report a host->device message is, from its SET_REPORT setup or interrupt OUT payload. */
export function match(desc, setup, endpoint, data) {
  if (setup && setup.length) {
    if ((setup[0] & 0x60) === 0x20 && setup[1] === 0x09) { // class request SET_REPORT
      const rtype = REPORT_TYPES[setup[3]];
      return rtype ? desc.report(rtype, setup[2]) : null;
    }
    return null;
  }
  if ((endpoint & 0x80) === 0) {
    const rid = desc.uses_report_ids && data.length ? data[0] : 0;
    return desc.report('Output', rid);
  }
  return null;
}
