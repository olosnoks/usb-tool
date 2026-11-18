// ESP-IDF partition table editing: ESP-IDF gen_esp32part.py CSV import/export, validation,
// flash map, 0xC00 binary generation (with MD5 entry) and patching into a full flash dump.
// Rules follow components/partition_table/gen_esp32part.py. Pure logic, no React.
import { parsePartitionTable, buildPartitionTable, PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE } from '../espPartitions.js';

export const TABLE_BIN_SIZE = 0xc00; // gen_esp32part MAX_PARTITION_LENGTH: 3K of data, rest of the 4K sector is padding
export const MAX_ENTRIES = (TABLE_BIN_SIZE - 32) / 32; // 95 partitions + the MD5 entry
export const FIRST_FREE_OFFSET = PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE; // 0x9000
export const APP_ALIGN = 0x10000;
export const DATA_ALIGN = 0x1000;
export const NVS_RW_MIN_SIZE = 0x3000;
export const MAX_NAME_LENGTH = 16;

export const TYPE_APP = 0x00;
export const TYPE_DATA = 0x01;

// Subtype names used by gen_esp32part.py (CSV spelling).
const APP_SUBTYPES = { factory: 0x00, test: 0x20 };
for (let i = 0; i < 16; i++) APP_SUBTYPES[`ota_${i}`] = 0x10 + i;
const DATA_SUBTYPES = {
  ota: 0x00, phy: 0x01, nvs: 0x02, coredump: 0x03, nvs_keys: 0x04, efuse: 0x05, undefined: 0x06,
  esphttpd: 0x80, fat: 0x81, spiffs: 0x82, littlefs: 0x83, tee_ota: 0x90
};

export function subtypesFor(type) {
  return type === TYPE_APP ? APP_SUBTYPES : type === TYPE_DATA ? DATA_SUBTYPES : {};
}

export function subtypeName(type, subtype) {
  const table = subtypesFor(type);
  const hit = Object.keys(table).find((k) => table[k] === subtype);
  return hit || `0x${subtype.toString(16).padStart(2, '0')}`;
}

export function typeName(type) {
  return type === TYPE_APP ? 'app' : type === TYPE_DATA ? 'data' : `0x${type.toString(16).padStart(2, '0')}`;
}

/** Parse "0x10000", "65536", "64K", "1M" (gen_esp32part parse_int rules, k = 1024). */
export function parseSizeText(text) {
  const t = String(text ?? '').trim();
  if (t === '') return null;
  const m = /^(0x[0-9a-f]+|0o[0-7]+|0b[01]+|\d+)([km])?$/i.exec(t);
  if (!m) throw new Error(`"${t}" is not a number (use decimal, 0x hex, or a K/M suffix).`);
  const base = Number(m[1]);
  const mult = m[2] ? (m[2].toLowerCase() === 'k' ? 1024 : 1024 * 1024) : 1;
  return base * mult;
}

/** Hex text for the editor UI, e.g. 0x10000. */
export function formatHex(n) {
  return n === null || n === undefined ? '' : `0x${n.toString(16)}`;
}

/**
 * Parse ESP-IDF partition CSV. Blank offset means "auto" (resolved later).
 * @returns {{rows: object[], errors: {line:number, message:string}[]}}
 */
export function parseCsv(text) {
  const rows = [];
  const errors = [];
  const lines = String(text ?? '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const line = raw.trim();
    const lineNo = idx + 1;
    if (line === '' || line.startsWith('#')) return;
    const f = (line + ',,,,').split(',').map((s) => s.trim());
    const fail = (message) => errors.push({ line: lineNo, message });
    try {
      const name = f[0];
      if (!name) throw new Error('name is empty');
      let type;
      if (f[1] === 'app') type = TYPE_APP;
      else if (f[1] === 'data') type = TYPE_DATA;
      else if (f[1] === '') throw new Error("type can't be empty");
      else type = parseNumberField(f[1], {}, 'type');
      let subtype;
      if (f[2] === '') {
        if (type === TYPE_APP) throw new Error('app partition needs a subtype');
        subtype = DATA_SUBTYPES.undefined;
      } else {
        subtype = parseNumberField(f[2], subtypesFor(type), 'subtype');
      }
      const offset = f[3] === '' ? null : parseNumberField(f[3], {}, 'offset');
      if (f[4] === '') throw new Error("size can't be empty");
      const size = parseNumberField(f[4], {}, 'size');
      const flags = f[5] ? f[5].split(':') : [];
      let encrypted = false;
      let readonly = false;
      for (const flag of flags) {
        if (flag === 'encrypted') encrypted = true;
        else if (flag === 'readonly') readonly = true;
        else if (flag !== '') throw new Error(`unknown flag '${flag}'`);
      }
      rows.push({ name, type, subtype, offset, size, encrypted, readonly, line: lineNo });
    } catch (e) {
      fail(e.message);
    }
  });
  return { rows, errors };
}

function parseNumberField(text, keywords, field) {
  const t = String(text).trim();
  if (keywords[t.toLowerCase()] !== undefined) return keywords[t.toLowerCase()];
  try {
    const v = parseSizeText(t);
    if (v === null) throw new Error('empty');
    return v;
  } catch {
    const known = Object.keys(keywords);
    throw new Error(`invalid ${field} '${t}'${known.length ? ` (known: ${known.join(', ')})` : ''}`);
  }
}

/** Size text as gen_esp32part writes it: 1M / 64K when exact, else hex. */
export const formatSize = (n) => {
  for (const [val, suffix] of [[0x100000, 'M'], [0x400, 'K']]) {
    if (n % val === 0) return `${n / val}${suffix}`;
  }
  return `0x${n.toString(16)}`;
};

/** Render rows as gen_esp32part-style CSV (offsets in hex, sizes with K/M when exact). */
export function toCsv(rows) {
  const header = '# ESP-IDF Partition Table\n# Name, Type, SubType, Offset, Size, Flags';
  const body = rows.map((r) => {
    const flags = [r.encrypted && 'encrypted', r.readonly && 'readonly'].filter(Boolean).join(':');
    const subName = subtypeName(r.type, r.subtype);
    const sub = subtypesFor(r.type)[subName] === r.subtype ? subName : String(r.subtype);
    const off = r.offset === null || r.offset === undefined ? '' : `0x${r.offset.toString(16)}`;
    const size = r.size === null || r.size === undefined ? '' : formatSize(r.size);
    const tn = r.type === TYPE_APP ? 'app' : r.type === TYPE_DATA ? 'data' : String(r.type);
    return [r.name, tn, sub, off, size, flags].join(',');
  });
  return [header, ...body].join('\n') + '\n';
}

/** Fill in blank offsets the way gen_esp32part does (in list order, aligned per type). */
export function resolveOffsets(rows) {
  let lastEnd = FIRST_FREE_OFFSET;
  return rows.map((r) => {
    let offset = r.offset;
    if (offset === null || offset === undefined) {
      const align = r.type === TYPE_APP ? APP_ALIGN : DATA_ALIGN;
      offset = lastEnd % align ? lastEnd + (align - (lastEnd % align)) : lastEnd;
    }
    const size = r.size ?? 0;
    lastEnd = offset + size;
    return { ...r, offset, autoOffset: r.offset === null || r.offset === undefined };
  });
}

/**
 * Validate rows (offsets must already be resolved). Severity 'error' blocks the binary build.
 * @param {object[]} rows
 * @param {{flashSize?: number}} [opts]
 * @returns {{severity:'error'|'warning', row:number|null, message:string}[]}
 */
export function validateRows(rows, { flashSize } = {}) {
  const issues = [];
  const add = (severity, row, message) => issues.push({ severity, row, message });
  if (rows.length === 0) add('error', null, 'The table has no partitions.');
  if (rows.length > MAX_ENTRIES) add('error', null, `The table has ${rows.length} entries; a 0xC00 table holds at most ${MAX_ENTRIES}.`);

  const names = new Map();
  rows.forEach((r, i) => {
    const tag = r.name || `row ${i + 1}`;
    if (!r.name) add('error', i, 'Name is empty.');
    else {
      if (r.name.length > MAX_NAME_LENGTH) add('error', i, `Name "${r.name}" is longer than ${MAX_NAME_LENGTH} characters.`);
      if (!/^[\x20-\x7e]+$/.test(r.name)) add('error', i, `Name "${r.name}" must be printable ASCII.`);
      if (names.has(r.name)) add('error', i, `Duplicate name "${r.name}".`);
      names.set(r.name, i);
    }
    if (!Number.isInteger(r.type) || r.type < 0 || r.type > 0xff) add('error', i, `${tag}: type is not a byte.`);
    else if (r.type !== TYPE_APP && r.type !== TYPE_DATA) add('warning', i, `${tag}: type 0x${r.type.toString(16)} is not app or data; alignment rules assumed to be data.`);
    if (!Number.isInteger(r.subtype) || r.subtype < 0 || r.subtype > 0xff) add('error', i, `${tag}: subtype is not a byte.`);
    if (r.type === TYPE_APP && !Object.values(APP_SUBTYPES).includes(r.subtype)) {
      add('warning', i, `${tag}: app subtype 0x${r.subtype.toString(16)} is not a standard app subtype.`);
    }
    if (r.offset === null || r.offset === undefined) { add('error', i, `${tag}: offset is not set.`); return; }
    if (r.size === null || r.size === undefined || r.size <= 0) { add('error', i, `${tag}: size must be greater than zero.`); return; }
    const align = r.type === TYPE_APP ? APP_ALIGN : DATA_ALIGN;
    if (r.offset % align !== 0) add('error', i, `${tag}: offset 0x${r.offset.toString(16)} is not aligned to 0x${align.toString(16)}.`);
    if (r.offset < FIRST_FREE_OFFSET) add('error', i, `${tag}: offset 0x${r.offset.toString(16)} is inside the bootloader or partition table (below 0x${FIRST_FREE_OFFSET.toString(16)}).`);
    if (r.type === TYPE_APP && r.size % 0x1000 !== 0) add('error', i, `${tag}: app size 0x${r.size.toString(16)} is not a multiple of 0x1000.`);
    if (r.type === TYPE_DATA && r.size % 0x1000 !== 0) add('warning', i, `${tag}: size is not a multiple of the 4 KiB flash sector.`);
    if (flashSize && r.offset + r.size > flashSize) add('error', i, `${tag}: ends at 0x${(r.offset + r.size).toString(16)}, past the ${flashSize / 0x100000} MiB flash.`);
    if (r.type === TYPE_DATA && r.subtype === DATA_SUBTYPES.nvs && r.size < NVS_RW_MIN_SIZE && !r.readonly) {
      add('error', i, `${tag}: an nvs partition smaller than 0x3000 must be flagged readonly.`);
    }
    if (r.type === TYPE_DATA && (r.subtype === DATA_SUBTYPES.ota || r.subtype === DATA_SUBTYPES.coredump) && r.readonly) {
      add('error', i, `${tag}: ${subtypeName(r.type, r.subtype)} partitions are always read-write and cannot be readonly.`);
    }
  });

  const otadata = rows.filter((r) => r.type === TYPE_DATA && r.subtype === DATA_SUBTYPES.ota);
  if (otadata.length > 1) rows.forEach((r, i) => { if (otadata.includes(r)) add('error', i, 'More than one otadata partition.'); });

  const placed = rows.map((r, i) => ({ r, i })).filter(({ r }) => Number.isInteger(r.offset) && Number.isInteger(r.size) && r.size > 0)
    .sort((a, b) => a.r.offset - b.r.offset);
  for (let k = 1; k < placed.length; k++) {
    const prev = placed[k - 1].r;
    const cur = placed[k].r;
    if (cur.offset < prev.offset + prev.size) {
      add('error', placed[k].i, `Overlaps "${prev.name}" (0x${prev.offset.toString(16)}-0x${(prev.offset + prev.size - 1).toString(16)}).`);
    }
  }
  return issues;
}

/** Build the 0xC00 partition table binary with the MD5 entry. Throws when validation has errors. */
export function buildTableBinary(rows, opts = {}) {
  const errors = validateRows(rows, opts).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(`Cannot build: ${errors[0].message}`);
  const entries = rows.map((r) => ({
    name: r.name,
    type: r.type,
    subtype: r.subtype,
    offset: r.offset,
    size: r.size,
    flags: (r.encrypted ? 1 : 0) | (r.readonly ? 2 : 0)
  }));
  return buildPartitionTable(entries, { md5: true, length: TABLE_BIN_SIZE });
}

/** Rows from a parsed binary table (for editing). */
export function rowsFromPartitions(partitions) {
  return partitions.map((p) => ({
    name: p.name,
    type: p.type,
    subtype: p.subtype,
    offset: p.offset,
    size: p.size,
    encrypted: !!p.encrypted,
    readonly: !!p.readonly
  }));
}

/** Parse the partition table at 0x8000 of a full flash dump. Throws a readable error when absent. */
export function readDumpTable(dump) {
  if (dump.length < PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE) {
    throw new Error('Image is smaller than 0x9000 bytes; it has no partition table at 0x8000.');
  }
  return parsePartitionTable(dump.subarray(PARTITION_TABLE_OFFSET, PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE));
}

/**
 * Return a copy of a full dump with the table written at 0x8000 (0xC00 bytes; the rest of the
 * 4 KiB sector is set to 0xFF). The dump must be at least 0x9000 bytes.
 */
export function patchDumpTable(dump, tableBin) {
  if (dump.length < PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE) throw new Error('Dump is smaller than 0x9000 bytes.');
  const out = dump.slice();
  out.set(tableBin, PARTITION_TABLE_OFFSET);
  out.fill(0xff, PARTITION_TABLE_OFFSET + tableBin.length, PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE);
  return out;
}

/** Copy `bytes` into `dump` at `offset` (used to write an edited NVS partition back). */
export function patchRegion(dump, offset, bytes) {
  if (offset + bytes.length > dump.length) throw new Error('Region does not fit in the image.');
  const out = dump.slice();
  out.set(bytes, offset);
  return out;
}

/**
 * Flash map segments, sorted, with gaps. kind: boot | table | app | data | gap.
 * @param {object[]} rows  resolved rows
 */
export function flashMap(rows, flashSize) {
  const segs = [
    { start: 0, end: PARTITION_TABLE_OFFSET, kind: 'boot', label: 'bootloader + boot data' },
    { start: PARTITION_TABLE_OFFSET, end: FIRST_FREE_OFFSET, kind: 'table', label: 'partition table' }
  ];
  const placed = rows
    .filter((r) => Number.isInteger(r.offset) && Number.isInteger(r.size) && r.size > 0)
    .sort((a, b) => a.offset - b.offset);
  for (const r of placed) {
    segs.push({ start: r.offset, end: r.offset + r.size, kind: r.type === TYPE_APP ? 'app' : 'data', label: r.name, name: r.name, subtype: subtypeName(r.type, r.subtype) });
  }
  segs.sort((a, b) => a.start - b.start);
  const total = Math.max(flashSize || 0, ...segs.map((s) => s.end), FIRST_FREE_OFFSET);
  const out = [];
  let cursor = 0;
  for (const s of segs) {
    if (s.start > cursor) out.push({ start: cursor, end: s.start, kind: 'gap', label: 'unallocated' });
    out.push(s);
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < total) out.push({ start: cursor, end: total, kind: 'gap', label: 'unallocated' });
  return { segments: out, total };
}

/** Simple guess of what a loaded image is, for the UI. */
export function detectImage(bytes) {
  const n = bytes.length;
  const magicAt = (o) => o + 1 < n && bytes[o] === 0xaa && bytes[o + 1] === 0x50;
  if (n >= PARTITION_TABLE_OFFSET + PARTITION_TABLE_SIZE && magicAt(PARTITION_TABLE_OFFSET)) return 'dump';
  if (magicAt(0)) return 'table';
  if (n >= 0x1000 && n % 0x1000 === 0) {
    const state = (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
    const ver = bytes[8];
    const plausibleVersion = ver === 0xfe || ver === 0xff; // v2, or the v1 format still read by ESP-IDF
    const pageState = [0xfffffffe, 0xfffffffc, 0xfffffff8, 0xfffffff0, 0xffffffff].includes(state);
    if (plausibleVersion && pageState) return 'nvs';
  }
  return 'unknown';
}
