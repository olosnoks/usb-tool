// Dependency-free, read-only SQLite database file reader.
//
// Parses the SQLite 3 file format directly from an ArrayBuffer so the DB Browser
// can list tables and page through rows entirely client-side — the file never
// leaves the browser. It implements enough of the on-disk format to be useful:
//   - the 100-byte database header (page size, text encoding),
//   - the sqlite_master schema table (page 1),
//   - table b-trees (leaf 0x0d + interior 0x05) with the record format,
//   - overflow-page chains for large cells.
//
// It deliberately does NOT execute SQL, evaluate indexes, or write anything.
// Index b-trees and WAL files are ignored (row data lives in table b-trees).
//
// References: https://www.sqlite.org/fileformat2.html

const HEADER_MAGIC = 'SQLite format 3\u0000';
const MAX_OVERFLOW_PAGES = 65536; // cycle guard

/** Read a big-endian unsigned integer of `len` bytes. */
function beUint(view, off, len) {
  let v = 0;
  for (let i = 0; i < len; i++) v = v * 256 + view.getUint8(off + i);
  return v;
}

/**
 * Read a SQLite varint (1..9 bytes, big-endian, 7 bits per byte; the 9th byte
 * contributes all 8 bits). Returns { value, size }. Uses Number; values beyond
 * 2^53 lose precision but are rare for rowids/serial types in practice.
 */
function readVarint(view, off) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const byte = view.getUint8(off + i);
    result = result * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: result, size: i + 1 };
  }
  const byte = view.getUint8(off + 8);
  result = result * 256 + byte;
  return { value: result, size: 9 };
}

/** Bytes occupied by a column given its serial type code. */
function serialTypeLen(t) {
  if (t === 0 || t === 8 || t === 9) return 0;
  if (t >= 1 && t <= 4) return t;
  if (t === 5) return 6;
  if (t === 6 || t === 7) return 8;
  if (t >= 12) return Math.floor((t - 12) / 2);
  return 0; // 10, 11 reserved
}

/** Open and validate a database. Returns a handle used by the other calls. */
export function openDatabase(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const magic = new TextDecoder('latin1').decode(bytes.subarray(0, 16));
  if (magic !== HEADER_MAGIC) {
    throw new Error('Not a SQLite 3 database (missing "SQLite format 3" header).');
  }
  let pageSize = view.getUint16(16, false);
  if (pageSize === 1) pageSize = 65536; // special-cased by the format
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0) {
    throw new Error(`Invalid page size ${pageSize}.`);
  }
  const reserved = view.getUint8(20);
  const encCode = beUint(view, 56, 4);
  const encoding = encCode === 2 ? 'utf-16le' : encCode === 3 ? 'utf-16be' : 'utf-8';
  const pageCount = beUint(view, 28, 4) || Math.floor(arrayBuffer.byteLength / pageSize);
  return { bytes, view, pageSize, usable: pageSize - reserved, encoding, pageCount, byteLength: arrayBuffer.byteLength };
}

/** Decode one record (row) payload into an array of JS values. */
function decodeRecord(db, payload) {
  const rv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const { value: headerLen, size: hlSize } = readVarint(rv, 0);
  const types = [];
  let p = hlSize;
  while (p < headerLen) {
    const { value, size } = readVarint(rv, p);
    types.push(value);
    p += size;
  }
  const textDecoder = new TextDecoder(db.encoding);
  const values = [];
  let body = headerLen;
  for (const t of types) {
    const len = serialTypeLen(t);
    if (t === 0) values.push(null);
    else if (t === 8) values.push(0);
    else if (t === 9) values.push(1);
    else if (t >= 1 && t <= 6) {
      // signed big-endian integer
      let v = 0;
      for (let i = 0; i < len; i++) v = v * 256 + rv.getUint8(body + i);
      const bits = len * 8;
      if (v >= 2 ** (bits - 1)) v -= 2 ** bits;
      values.push(v);
    } else if (t === 7) {
      values.push(rv.getFloat64(body, false));
    } else if (t >= 13 && t % 2 === 1) {
      values.push(textDecoder.decode(payload.subarray(body, body + len)));
    } else if (t >= 12) {
      values.push(payload.subarray(body, body + len).slice()); // BLOB -> Uint8Array
    } else {
      values.push(null);
    }
    body += len;
  }
  return values;
}

/** Follow an overflow-page chain and concatenate into a full payload buffer. */
function readWithOverflow(db, pageOffset, localStart, payloadLen, localLen) {
  const out = new Uint8Array(payloadLen);
  out.set(db.bytes.subarray(pageOffset + localStart, pageOffset + localStart + localLen), 0);
  let written = localLen;
  // First overflow page number is the 4 bytes immediately after the local data.
  let next = beUint(db.view, pageOffset + localStart + localLen, 4);
  let guard = 0;
  while (next !== 0 && written < payloadLen && guard++ < MAX_OVERFLOW_PAGES) {
    const ovOff = (next - 1) * db.pageSize;
    const nextPtr = beUint(db.view, ovOff, 4);
    const chunk = Math.min(db.usable - 4, payloadLen - written);
    out.set(db.bytes.subarray(ovOff + 4, ovOff + 4 + chunk), written);
    written += chunk;
    next = nextPtr;
  }
  return out;
}

/** Read one table-leaf cell at the given page/offset into { rowid, values }. */
function readTableLeafCell(db, pageOffset, cellOff) {
  const { value: payloadLen, size: s1 } = readVarint(db.view, pageOffset + cellOff);
  const { value: rowid, size: s2 } = readVarint(db.view, pageOffset + cellOff + s1);
  const dataStart = cellOff + s1 + s2;
  const maxLocal = db.usable - 35;
  let payload;
  if (payloadLen <= maxLocal) {
    payload = db.bytes.subarray(pageOffset + dataStart, pageOffset + dataStart + payloadLen).slice();
  } else {
    const minLocal = Math.floor(((db.usable - 12) * 32) / 255) - 23;
    const k = minLocal + ((payloadLen - minLocal) % (db.usable - 4));
    const localLen = k <= maxLocal ? k : minLocal;
    payload = readWithOverflow(db, pageOffset, dataStart, payloadLen, localLen);
  }
  return { rowid, values: decodeRecord(db, payload) };
}

/**
 * Walk a table b-tree starting at `rootPage`, invoking cb({ rowid, values })
 * for each row. Stops once `limit` rows have been collected. Returns count.
 */
function walkTable(db, rootPage, cb, limit, seen = new Set()) {
  if (rootPage < 1 || rootPage > db.pageCount || seen.has(rootPage)) return 0;
  seen.add(rootPage);
  const pageOffset = (rootPage - 1) * db.pageSize;
  const hdrStart = rootPage === 1 ? 100 : 0;
  const type = db.view.getUint8(pageOffset + hdrStart);
  const numCells = db.view.getUint16(pageOffset + hdrStart + 3, false);
  const cellPtrBase = hdrStart + (type === 0x05 ? 12 : 8);
  let collected = 0;
  if (type === 0x0d) {
    for (let i = 0; i < numCells; i++) {
      if (collected >= limit) break;
      const cellOff = db.view.getUint16(pageOffset + cellPtrBase + i * 2, false);
      cb(readTableLeafCell(db, pageOffset, cellOff));
      collected++;
    }
  } else if (type === 0x05) {
    for (let i = 0; i < numCells; i++) {
      if (collected >= limit) break;
      const cellOff = db.view.getUint16(pageOffset + cellPtrBase + i * 2, false);
      const child = beUint(db.view, pageOffset + cellOff, 4);
      collected += walkTable(db, child, cb, limit - collected, seen);
    }
    if (collected < limit) {
      const rightMost = beUint(db.view, pageOffset + hdrStart + 8, 4);
      collected += walkTable(db, rightMost, cb, limit - collected, seen);
    }
  }
  return collected;
}

/** Count rows in a table b-tree (bounded walk, up to `max`). */
export function countRows(db, rootPage, max = 1000000) {
  let n = 0;
  walkTable(db, rootPage, () => { n++; }, max);
  return n;
}

/**
 * List schema objects from sqlite_master (page 1). Returns an array of
 * { type, name, tblName, rootpage, sql, columns }. `columns` is a best-effort
 * parse of the CREATE TABLE column names (for display headers).
 */
export function listSchema(db) {
  const rows = [];
  walkTable(db, 1, ({ values }) => {
    // sqlite_master columns: type, name, tbl_name, rootpage, sql
    rows.push({
      type: values[0],
      name: values[1],
      tblName: values[2],
      rootpage: values[3],
      sql: values[4],
      columns: parseColumns(values[4]),
    });
  }, 100000);
  return rows;
}

/** Best-effort extraction of column names from a CREATE TABLE statement. */
export function parseColumns(sql) {
  if (!sql || typeof sql !== 'string') return [];
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close <= open) return [];
  const inner = sql.slice(open + 1, close);
  const cols = [];
  let depth = 0;
  let cur = '';
  const parts = [];
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  const constraintKw = /^(constraint|primary|unique|check|foreign|key)\b/i;
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || constraintKw.test(trimmed)) continue;
    const m = trimmed.match(/^("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))/);
    if (m) cols.push(m[2] || m[3] || m[4] || m[5]);
  }
  return cols;
}

/**
 * Read up to `limit` rows from a table (by root page), starting after `offset`
 * rows. Returns { rows, hasMore }. Each row is { rowid, values }.
 */
export function readRows(db, rootPage, { limit = 100, offset = 0 } = {}) {
  const rows = [];
  let index = 0;
  let hasMore = false;
  walkTable(db, rootPage, (row) => {
    if (index >= offset && rows.length < limit) rows.push(row);
    else if (rows.length >= limit) hasMore = true;
    index++;
  }, offset + limit + 1);
  return { rows, hasMore };
}
