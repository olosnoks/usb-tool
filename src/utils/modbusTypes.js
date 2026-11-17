/**
 * Modbus register data types, word/byte order handling, scaling and
 * user-defined register maps. Pure functions, no I/O.
 *
 * Word orders (names follow the common "ABCD" convention, A = most significant byte):
 *   ABCD  big-endian, registers in order        (Modbus default)
 *   CDAB  registers swapped ("word swap")       (very common for float32)
 *   BADC  bytes swapped inside each register
 *   DCBA  fully reversed (little-endian)
 */

// Read tables: which function code reads them and the per-request quantity limit.
export const READ_TABLES = {
  holding: { fc: 0x03, max: 125, label: 'Holding registers (FC03)', bits: false },
  input: { fc: 0x04, max: 125, label: 'Input registers (FC04)', bits: false },
  coils: { fc: 0x01, max: 2000, label: 'Coils (FC01)', bits: true },
  discrete: { fc: 0x02, max: 2000, label: 'Discrete inputs (FC02)', bits: true }
};

export const DATA_TYPES =['u16', 'i16', 'u32', 'i32', 'f32', 'f64', 'ascii'];
export const WORD_ORDERS = ['ABCD', 'CDAB', 'BADC', 'DCBA'];

// Number of 16-bit registers a type occupies (ascii needs an explicit length).
export function typeWordCount(type, asciiWords = 1) {
  switch (type) {
    case 'u16': case 'i16': return 1;
    case 'u32': case 'i32': case 'f32': return 2;
    case 'f64': return 4;
    case 'ascii': return Math.max(1, Math.floor(asciiWords) || 1);
    default: return 1;
  }
}

// Register words -> big-endian byte array in "ABCD" (canonical) order.
function wordsToCanonicalBytes(words, order) {
  let w = Array.from(words).map((x) => x & 0xFFFF);
  if (order === 'CDAB' || order === 'DCBA') w = w.slice().reverse();
  const bytes = [];
  for (const word of w) {
    const hi = (word >> 8) & 0xFF;
    const lo = word & 0xFF;
    if (order === 'BADC' || order === 'DCBA') bytes.push(lo, hi);
    else bytes.push(hi, lo);
  }
  return bytes;
}

// Canonical big-endian bytes -> register words in the requested wire order.
function canonicalBytesToWords(bytes, order) {
  let words = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const a = bytes[i];
    const b = bytes[i + 1] ?? 0;
    words.push(order === 'BADC' || order === 'DCBA' ? (b << 8) | a : (a << 8) | b);
  }
  if (order === 'CDAB' || order === 'DCBA') words = words.reverse();
  return words;
}

/**
 * Decode registers into a value.
 * @param {number[]} words register words as received
 * @param {string} type one of DATA_TYPES
 * @param {string} order one of WORD_ORDERS
 * @returns {number|string|null} null when too few words were supplied
 */
export function decodeValue(words, type = 'u16', order = 'ABCD') {
  const need = type === 'ascii' ? 1 : typeWordCount(type);
  if (!words || words.length < need) return null;
  const n = type === 'ascii' ? words.length : need;
  const bytes = wordsToCanonicalBytes(words.slice(0, n), order);
  const view = new DataView(new Uint8Array(bytes).buffer);
  switch (type) {
    case 'u16': return view.getUint16(0);
    case 'i16': return view.getInt16(0);
    case 'u32': return view.getUint32(0);
    case 'i32': return view.getInt32(0);
    case 'f32': return view.getFloat32(0);
    case 'f64': return view.getFloat64(0);
    case 'ascii': {
      // ASCII text is conventionally high byte first; honour only word swaps of the order.
      const textBytes = wordsToCanonicalBytes(words.slice(0, n), order === 'CDAB' ? 'CDAB' : 'ABCD');
      let s = '';
      for (const b of textBytes) {
        if (b === 0) break;
        s += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
      }
      return s.trimEnd();
    }
    default: return view.getUint16(0);
  }
}

/** Encode a numeric value into register words (for writes). */
export function encodeValue(value, type = 'u16', order = 'ABCD') {
  const v = Number(value);
  if (!Number.isFinite(v)) throw new Error('Value is not a number');
  const size = type === 'f64' ? 8 : (type === 'u32' || type === 'i32' || type === 'f32') ? 4 : 2;
  const buf = new DataView(new ArrayBuffer(size));
  switch (type) {
    case 'u16': buf.setUint16(0, v); break;
    case 'i16': buf.setInt16(0, v); break;
    case 'u32': buf.setUint32(0, v); break;
    case 'i32': buf.setInt32(0, v); break;
    case 'f32': buf.setFloat32(0, v); break;
    case 'f64': buf.setFloat64(0, v); break;
    default: throw new Error(`Cannot encode type ${type}`);
  }
  const bytes = Array.from(new Uint8Array(buf.buffer));
  return canonicalBytesToWords(bytes, order);
}

export function applyScale(value, scale = 1, offset = 0) {
  if (typeof value !== 'number') return value;
  const s = Number.isFinite(Number(scale)) ? Number(scale) : 1;
  const o = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  return value * s + o;
}

// Modicon-style register number for display (holding 4xxxx, input 3xxxx, ...).
export function modiconNumber(table, address) {
  const base = { coils: 1, discrete: 10001, input: 30001, holding: 40001 }[table];
  return base === undefined ? address : base + address;
}

function hex16(w) {
  return '0x' + (w & 0xFFFF).toString(16).padStart(4, '0').toUpperCase();
}

function fmtNumber(v) {
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v)) return String(v);
  return String(Number(v.toPrecision(7)));
}

/**
 * Turn raw register words into display rows according to a register map.
 * Registers not covered by any range get a generic "Register N" label and are
 * shown as plain uint16 (no scaling, no units are ever invented).
 *
 * @param {number} startAddr address of words[0]
 * @param {number[]} words
 * @param {{ranges?: object[]}|null} map user-defined map
 * @param {string} table 'holding' | 'input'
 */
export function buildRegisterRows(startAddr, words, map = null, table = 'holding') {
  const ranges = (map && Array.isArray(map.ranges)) ? map.ranges : [];
  const rows = [];
  let i = 0;
  while (i < words.length) {
    const addr = startAddr + i;
    const range = ranges.find((r) => r.start === addr);
    let span = 1;
    let type = 'u16';
    let order = 'ABCD';
    let scale = 1;
    let offset = 0;
    let unit = '';
    let label = `Register ${addr}`;
    let mapped = false;
    if (range) {
      const wanted = typeWordCount(range.type || 'u16', range.words);
      if (i + wanted <= words.length) {
        span = wanted;
        type = range.type || 'u16';
        order = range.wordOrder || 'ABCD';
        scale = range.scale ?? 1;
        offset = range.offset ?? 0;
        unit = range.unit || '';
        label = range.label || label;
        mapped = true;
      }
    }
    const slice = words.slice(i, i + span);
    const decoded = decodeValue(slice, type, order);
    const scaled = applyScale(decoded, scale, offset);
    const u16 = words[i] & 0xFFFF;
    rows.push({
      address: addr,
      registerNumber: modiconNumber(table, addr),
      words: slice,
      label,
      mapped,
      type,
      hex: slice.map(hex16).join(' '),
      rawUint16: u16,
      int16: u16 > 32767 ? u16 - 65536 : u16,
      value: scaled,
      unit,
      display: scaled === null ? '' : `${fmtNumber(scaled)}${unit ? ' ' + unit : ''}`
    });
    i += span;
  }
  return rows;
}

// ---- Register map import / export ----

export const EXAMPLE_SOLAR_INVERTER_MAP = {
  name: 'Example: solar inverter',
  version: 1,
  ranges: [
    { start: 0, type: 'u16', scale: 0.1, unit: 'V', label: 'AC Grid Voltage' },
    { start: 1, type: 'u16', scale: 0.1, unit: 'A', label: 'AC Grid Current' },
    { start: 2, type: 'u16', scale: 1, unit: 'W', label: 'Active Output Power' },
    { start: 3, type: 'u16', scale: 0.01, unit: 'Hz', label: 'Grid Frequency' },
    { start: 4, type: 'u16', scale: 0.01, unit: '', label: 'Power Factor' },
    { start: 5, type: 'i16', scale: 0.1, unit: '°C', label: 'Inverter Temp' },
    { start: 6, type: 'u16', scale: 0.01, unit: 'kWh', label: 'Daily Yield' },
    { start: 7, type: 'u16', scale: 1, unit: 'kWh', label: 'Lifetime Yield' }
  ]
};

export const EXAMPLE_MAPS = [EXAMPLE_SOLAR_INVERTER_MAP];

export function normalizeRange(r) {
  if (!r || typeof r !== 'object') throw new Error('Range must be an object');
  const start = Number(r.start);
  if (!Number.isInteger(start) || start < 0 || start > 65535) throw new Error('Range start must be 0-65535');
  const type = r.type || 'u16';
  if (!DATA_TYPES.includes(type)) throw new Error(`Unknown data type "${type}"`);
  const wordOrder = r.wordOrder || 'ABCD';
  if (!WORD_ORDERS.includes(wordOrder)) throw new Error(`Unknown word order "${wordOrder}"`);
  const scale = r.scale === undefined || r.scale === '' ? 1 : Number(r.scale);
  const offset = r.offset === undefined || r.offset === '' ? 0 : Number(r.offset);
  if (!Number.isFinite(scale) || !Number.isFinite(offset)) throw new Error('scale/offset must be numbers');
  const out = { start, type, wordOrder, scale, offset, unit: String(r.unit || ''), label: String(r.label || '') };
  if (type === 'ascii') out.words = Math.max(1, Math.min(125, Number(r.words) || 1));
  return out;
}

export function parseRegisterMap(text) {
  let obj;
  try {
    obj = typeof text === 'string' ? JSON.parse(text) : text;
  } catch (err) {
    throw new Error(`Invalid JSON: ${err.message}`);
  }
  if (!obj || !Array.isArray(obj.ranges)) throw new Error('Register map needs a "ranges" array');
  return {
    name: String(obj.name || 'Imported map'),
    version: 1,
    ranges: obj.ranges.map(normalizeRange)
  };
}

export function serializeRegisterMap(map) {
  return JSON.stringify({ name: map?.name || 'Register map', version: 1, ranges: map?.ranges || [] }, null, 2);
}

// ---- CSV log ----

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** entries: [{ t: ISO string, slaveId, fc, address, label, value, unit, hex }] */
export function pollLogToCsv(entries) {
  const head = ['time', 'slave', 'function', 'address', 'label', 'value', 'unit', 'raw'];
  const lines = [head.join(',')];
  for (const e of entries) {
    lines.push([e.t, e.slaveId, e.fc, e.address, e.label, e.value, e.unit, e.hex].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}
