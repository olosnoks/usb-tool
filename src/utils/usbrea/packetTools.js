// Pure helpers for the Packets tab of the USB Protocol RE tool: per-endpoint statistics, a Wireshark display
// filter for the current selection, CSV export and a byte-level diff of two payloads.
import { hex } from './bytes.js';

/** Per (device, endpoint, direction, type) packet and byte totals, busiest first. */
export function endpoint_stats(transfers) {
  const m = new Map();
  for (const t of transfers) {
    const key = `${t.device}|${t.endpoint & 0x7f}|${t.is_in ? 'IN' : 'OUT'}|${t.xfer_type}`;
    let s = m.get(key);
    if (!s) {
      s = { device: t.device, endpoint: t.endpoint & 0x7f, dir: t.is_in ? 'IN' : 'OUT', kind: t.kind, packets: 0, bytes: 0, min: Infinity, max: 0, first: t.ts, last: t.ts };
      m.set(key, s);
    }
    const n = t.data.length;
    s.packets += 1;
    s.bytes += n;
    if (n < s.min) s.min = n;
    if (n > s.max) s.max = n;
    if (t.ts < s.first) s.first = t.ts;
    if (t.ts > s.last) s.last = t.ts;
  }
  return [...m.values()].map((s) => ({ ...s, min: s.min === Infinity ? 0 : s.min })).sort((a, b) => b.bytes - a.bytes || b.packets - a.packets);
}

/** Wireshark display filter matching the active Packets-tab filter (hex needle becomes a `contains` test). */
export function wireshark_filter(f) {
  const parts = [];
  if (f.device !== '' && f.device != null) parts.push(`usb.device_address == ${Number(f.device)}`);
  if (f.endpoint !== '' && f.endpoint != null && Number.isFinite(Number(f.endpoint))) {
    const ep = Number(f.endpoint) & 0x7f;
    if (f.direction === 'in') parts.push(`usb.endpoint_address == 0x${(ep | 0x80).toString(16)}`);
    else if (f.direction === 'out') parts.push(`usb.endpoint_address == 0x${ep.toString(16).padStart(2, '0')}`);
    else parts.push(`usb.endpoint_address.number == ${ep}`);
  } else if (f.direction === 'in') parts.push('usb.endpoint_address.direction == 1');
  else if (f.direction === 'out') parts.push('usb.endpoint_address.direction == 0');
  if (f.type !== '' && f.type != null) parts.push(`usb.transfer_type == 0x${Number(f.type).toString(16).padStart(2, '0')}`);
  const needle = (f.hex || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (needle.length >= 2 && needle.length % 2 === 0) {
    parts.push(`frame contains ${needle.match(/../g).join(':')}`);
  }
  return parts.join(' && ');
}

function csvCell(v) {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of transfers: frame, time relative to t0, bus, device, endpoint, direction, type, length, setup hex, data hex. */
export function transfers_to_csv(transfers, t0 = 0) {
  const lines = ['frame,time_s,bus,device,endpoint,direction,type,length,setup_hex,data_hex'];
  for (const t of transfers) {
    lines.push([t.frame, (t.ts - t0).toFixed(6), t.bus, t.device, t.endpoint & 0x7f, t.is_in ? 'IN' : 'OUT', t.kind, t.data.length, t.setup ? hex(t.setup) : '', hex(t.data)].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Compare two payloads. Returns per-offset flags plus counts; offsets past the shorter one count as different. */
export function diff_bytes(a, b) {
  const n = Math.max(a.length, b.length);
  const cells = [];
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const x = i < a.length ? a[i] : null;
    const y = i < b.length ? b[i] : null;
    const same = x === y;
    if (!same) changed += 1;
    cells.push({ offset: i, a: x, b: y, same });
  }
  return { cells, changed, lenA: a.length, lenB: b.length };
}

/** Text form of a diff: one row per 16 bytes, changed bytes in [brackets]-free uppercase with a marker line. */
export function render_diff(d) {
  const out = [];
  for (let o = 0; o < d.cells.length; o += 16) {
    const row = d.cells.slice(o, o + 16);
    const fmt = (k) => row.map((c) => (c[k] == null ? '--' : c[k].toString(16).padStart(2, '0'))).join(' ');
    out.push(`${o.toString(16).padStart(4, '0')}  A ${fmt('a')}`);
    out.push(`      B ${fmt('b')}`);
    out.push(`      ${row.map((c) => (c.same ? '  ' : '^^')).join(' ').replace(/^/, '  ')}`);
  }
  return out.join('\n') || '(both empty)';
}
