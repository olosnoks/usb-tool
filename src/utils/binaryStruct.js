// Pure helpers for the Binary Decoder: a tiny struct template language and a data inspector.
// Template syntax (one field per line, '#' starts a comment):
//   endian le | be            default byte order (le if omitted)
//   name: u16                 scalar. Types: u8 i8 u16 i16 u32 i32 u64 i64 f32 f64 bool
//   name: u16be / u32le       per-field byte order
//   name: u8[4]               array with a fixed count
//   name: u8[len]             count taken from an earlier numeric field
//   name: u8[*]               as many as fit in the rest of the data
//   name: char[8]             text (UTF-8); cstr = zero-terminated text; bytes[n] = raw bytes
//   name: skip[2]             skip n bytes
//   name: u32 hex             optional display flag: hex | bin | dec

const SCALARS = {
  u8: [1, 'u'], i8: [1, 'i'], u16: [2, 'u'], i16: [2, 'i'], u32: [4, 'u'], i32: [4, 'i'],
  u64: [8, 'u'], i64: [8, 'i'], f32: [4, 'f'], f64: [8, 'f'], bool: [1, 'b'],
};
export const STRUCT_TYPES = [...Object.keys(SCALARS), 'char', 'cstr', 'bytes', 'skip'];
const MAX_ARRAY = 65536;

export function parseTemplate(text) {
  const fields = [];
  const errors = [];
  let endian = 'le';
  String(text).split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const ln = idx + 1;
    const em = /^endian\s+(le|be)$/i.exec(line);
    if (em) { endian = em[1].toLowerCase(); return; }
    const m = /^([A-Za-z_]\w*)\s*:\s*([a-z0-9]+)(?:\[\s*([A-Za-z_]\w*|\d+|\*)\s*\])?(?:\s+(hex|bin|dec))?$/.exec(line);
    if (!m) { errors.push(`line ${ln}: cannot parse "${line}"`); return; }
    const [, name, rawType, count, fmt] = m;
    let type = rawType;
    let fieldEndian = endian;
    const sfx = /^(.*?)(le|be)$/.exec(type);
    if (sfx && SCALARS[sfx[1]] && SCALARS[sfx[1]][0] > 1) { type = sfx[1]; fieldEndian = sfx[2]; }
    if (!STRUCT_TYPES.includes(type)) { errors.push(`line ${ln}: unknown type "${type}"`); return; }
    if (['char', 'bytes', 'skip'].includes(type) && count === undefined) { errors.push(`line ${ln}: ${type} needs a length, for example ${type}[4]`); return; }
    if (type === 'cstr' && count !== undefined) { errors.push(`line ${ln}: cstr takes no length`); return; }
    if (fields.some((f) => f.name === name)) { errors.push(`line ${ln}: duplicate field name "${name}"`); return; }
    if (count && /^[A-Za-z_]/.test(count) && !fields.some((f) => f.name === count && SCALARS[f.type] && f.count === null)) {
      errors.push(`line ${ln}: length "${count}" must be an earlier numeric field`); return;
    }
    fields.push({ name, type, count: count === undefined ? null : /^\d+$/.test(count) ? Number(count) : count, endian: fieldEndian, fmt: fmt || 'dec', line: ln });
  });
  return { fields, errors, endian };
}

function readScalar(view, off, type, little) {
  switch (type) {
    case 'u8': return view.getUint8(off);
    case 'i8': return view.getInt8(off);
    case 'u16': return view.getUint16(off, little);
    case 'i16': return view.getInt16(off, little);
    case 'u32': return view.getUint32(off, little);
    case 'i32': return view.getInt32(off, little);
    case 'u64': return view.getBigUint64(off, little);
    case 'i64': return view.getBigInt64(off, little);
    case 'f32': return view.getFloat32(off, little);
    case 'f64': return view.getFloat64(off, little);
    default: return view.getUint8(off) !== 0;
  }
}

function fmtNumber(v, fmt, size) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (fmt === 'hex' || fmt === 'bin') {
    const b = BigInt(v);
    const u = b < 0n ? b + (1n << BigInt(size * 8)) : b;
    return fmt === 'hex' ? `0x${u.toString(16).padStart(size * 2, '0')}` : `0b${u.toString(2).padStart(size * 8, '0')}`;
  }
  return String(v);
}

const hexOf = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** Decode bytes with parsed template fields. Never throws; stops at the first field that does not fit. */
export function decodeStruct(bytes, fields, startOffset = 0) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows = [];
  const known = {};
  let pos = startOffset;
  let error = null;
  for (const f of fields) {
    let n = 1;
    if (typeof f.count === 'number') n = f.count;
    else if (f.count === '*') n = null;
    else if (typeof f.count === 'string') {
      const v = known[f.count];
      n = typeof v === 'bigint' ? Number(v) : v;
      if (!Number.isInteger(n) || n < 0) { error = `${f.name}: length field "${f.count}" is not a non-negative integer`; break; }
    }
    const start = pos;
    if (f.type === 'cstr') {
      let end = pos;
      while (end < bytes.length && bytes[end] !== 0) end++;
      if (end >= bytes.length) { error = `${f.name}: no zero terminator before the end of data`; break; }
      rows.push({ name: f.name, type: 'cstr', offset: start, length: end - pos + 1, value: JSON.stringify(new TextDecoder().decode(bytes.subarray(pos, end))) });
      pos = end + 1;
      continue;
    }
    const isScalar = !!SCALARS[f.type];
    const unit = isScalar ? SCALARS[f.type][0] : 1;
    if (n === null) n = Math.floor((bytes.length - pos) / unit);
    if (isScalar && n > MAX_ARRAY) { error = `${f.name}: count ${n} is too large`; break; }
    const total = unit * n;
    if (pos + total > bytes.length) { error = `${f.name}: needs ${total} byte(s) at offset ${pos}, only ${Math.max(0, bytes.length - pos)} left`; break; }
    const label = `${f.type}${f.count !== null ? `[${f.count}]` : ''}`;
    if (f.type === 'skip') {
      rows.push({ name: f.name, type: label, offset: start, length: total, value: `(skipped ${total} byte${total === 1 ? '' : 's'})` });
    } else if (f.type === 'char') {
      rows.push({ name: f.name, type: label, offset: start, length: total, value: JSON.stringify(new TextDecoder().decode(bytes.subarray(pos, pos + total))) });
    } else if (f.type === 'bytes') {
      const shownBytes = bytes.subarray(pos, pos + Math.min(total, 256));
      rows.push({ name: f.name, type: label, offset: start, length: total, value: (hexOf(shownBytes) + (total > 256 ? ' ...' : '')) || '(empty)' });
    } else {
      const little = f.endian === 'le';
      const kind = SCALARS[f.type][1];
      const vals = [];
      for (let i = 0; i < n; i++) vals.push(readScalar(view, pos + i * unit, f.type, little));
      if (f.count === null) known[f.name] = vals[0];
      const shown = kind === 'f' ? vals.map(String) : vals.map((v) => fmtNumber(v, f.fmt, unit));
      rows.push({
        name: f.name, type: label, offset: start, length: total,
        value: f.count === null ? shown[0] : `[${shown.slice(0, 64).join(', ')}${shown.length > 64 ? ', ...' : ''}]`,
      });
    }
    pos += total;
  }
  return { rows, error, end: pos };
}

/** Data inspector: common interpretations of the bytes starting at `offset`. */
export function inspectBytes(bytes, offset, little = true) {
  const out = [];
  if (!bytes || offset == null || offset < 0 || offset >= bytes.length) return out;
  const avail = bytes.length - offset;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const add = (label, fn, need) => { if (avail >= need) out.push({ label, value: String(fn()) }); };
  const b = bytes[offset];
  add('u8', () => view.getUint8(offset), 1);
  add('i8', () => view.getInt8(offset), 1);
  add('u16', () => view.getUint16(offset, little), 2);
  add('i16', () => view.getInt16(offset, little), 2);
  if (avail >= 3) {
    const raw = little
      ? bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
      : (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
    out.push({ label: 'u24', value: String(raw) });
    out.push({ label: 'i24', value: String(raw & 0x800000 ? raw - 0x1000000 : raw) });
  }
  add('u32', () => view.getUint32(offset, little), 4);
  add('i32', () => view.getInt32(offset, little), 4);
  add('u64', () => view.getBigUint64(offset, little), 8);
  add('i64', () => view.getBigInt64(offset, little), 8);
  add('f32', () => view.getFloat32(offset, little), 4);
  add('f64', () => view.getFloat64(offset, little), 8);
  out.push({ label: 'bin', value: b.toString(2).padStart(8, '0') });
  out.push({ label: 'char', value: b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.' });
  if (avail >= 4) {
    const d = new Date(view.getUint32(offset, little) * 1000);
    out.push({ label: 'unix time (u32)', value: d.toISOString() });
  }
  return out;
}

/** Parse a search query into byte values (-1 = wildcard). Throws on bad hex. */
export function parsePattern(query, mode = 'hex') {
  const pat = [];
  if (mode === 'text') return Array.from(new TextEncoder().encode(query));
  const toks = query.replace(/0x/gi, '').split(/[\s,:]+/).filter(Boolean);
  for (const t of toks) {
    if (/^\?\??$/.test(t)) pat.push(-1);
    else if (/^([0-9a-f]{2})+$/i.test(t)) for (let i = 0; i < t.length; i += 2) pat.push(parseInt(t.slice(i, i + 2), 16));
    else throw new Error(`"${t}" is not a hex byte`);
  }
  return pat;
}

/** Find a hex pattern ("de ad ?? ef", ?? = wildcard) or UTF-8 text. Returns matching offsets. */
export function findBytes(bytes, query, mode = 'hex', limit = 1000) {
  const pat = parsePattern(query, mode);
  if (!pat.length) return [];
  const hits = [];
  for (let i = 0; i + pat.length <= bytes.length && hits.length < limit; i++) {
    let ok = true;
    for (let j = 0; j < pat.length; j++) if (pat[j] !== -1 && bytes[i + j] !== pat[j]) { ok = false; break; }
    if (ok) hits.push(i);
  }
  return hits;
}

export const STRUCT_EXAMPLE = `# example header (little endian)
endian le
magic: char[4]
version: u16
flags: u16 hex
count: u8
pad: skip[1]
values: u16[count]
tail: bytes[*]`;
export const STRUCT_EXAMPLE_HEX = '4d 59 48 44 02 00 05 80 03 00 0a 00 14 00 1e 00 ff';
