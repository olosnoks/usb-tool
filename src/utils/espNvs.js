// ESP-IDF NVS (non-volatile storage) v2 page parser, editor and encoder.
//
// Layout (ESP-IDF components/nvs_flash, 4096-byte pages):
//   0..31    page header: state u32, seq u32, version u8 (0xFE = v2), reserved[19], crc32 u32 (at 28)
//   32..63   entry-state bitmap: 2 bits per entry, 126 entries, entry i at byte i>>2, shift (i&3)*2
//   64..4095 126 entries of 32 bytes: ns u8, type u8, span u8, chunkIndex u8, crc32 u32,
//            key[16] (NUL padded), data[8]
// CRC32: esp_rom_crc32_le seeded with 0xFFFFFFFF. It equals zlib.crc32(data, 0xFFFFFFFF)
// and chains like zlib. Page header CRC covers bytes 4..27. Entry CRC covers bytes 0..3 and 8..31.
// Variable-length items (SZ, BLOB, BLOB_DATA) store dataSize u16 and dataCrc32 in data[0..8)
// and their payload in the following `span - 1` entries. BLOB_IDX stores size u32, chunkCount u8
// and chunkStart u8; its chunks are BLOB_DATA items with chunkIndex = chunkStart + k.
//
// Pure logic: no React, no hardware. Also contains a small encoder so tests can build pages.

export const NVS_PAGE_SIZE = 4096;
export const NVS_ENTRY_SIZE = 32;
export const NVS_ENTRY_COUNT = 126;
export const NVS_VERSION_V2 = 0xfe;
export const NVS_CHUNK_MAX = NVS_ENTRY_SIZE * (NVS_ENTRY_COUNT - 1);
const BITMAP_OFFSET = 32;
const ENTRIES_OFFSET = 64;
const CHUNK_ANY = 0xff;

export const PAGE_STATE = {
  EMPTY: 0xffffffff,
  ACTIVE: 0xfffffffe,
  FULL: 0xfffffffc,
  FREEING: 0xfffffff8,
  CORRUPT: 0xfffffff0
};
const PAGE_STATE_NAMES = {
  [PAGE_STATE.EMPTY]: 'empty',
  [PAGE_STATE.ACTIVE]: 'active',
  [PAGE_STATE.FULL]: 'full',
  [PAGE_STATE.FREEING]: 'freeing',
  [PAGE_STATE.CORRUPT]: 'corrupt'
};
const LIVE_PAGE_STATES = new Set(['active', 'full', 'freeing']);

export const ENTRY_STATE = { ERASED: 0, ILLEGAL: 1, WRITTEN: 2, EMPTY: 3 };
const ENTRY_STATE_NAMES = { 0: 'erased', 1: 'illegal', 2: 'written', 3: 'empty' };

export const ITEM_TYPE = {
  U8: 0x01, I8: 0x11, U16: 0x02, I16: 0x12, U32: 0x04, I32: 0x14, U64: 0x08, I64: 0x18,
  FLOAT: 0x24, DOUBLE: 0x28, SZ: 0x21, BLOB: 0x41, BLOB_DATA: 0x42, BLOB_IDX: 0x48
};
const TYPE_NAMES = {
  0x01: 'u8', 0x11: 'i8', 0x02: 'u16', 0x12: 'i16', 0x04: 'u32', 0x14: 'i32', 0x08: 'u64', 0x18: 'i64',
  0x24: 'float', 0x28: 'double', 0x21: 'string', 0x41: 'blob', 0x42: 'blob_data', 0x48: 'blob_index'
};

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * ESP-IDF CRC32 (esp_rom_crc32_le). Seeded with 0xFFFFFFFF by default; pass the previous
 * return value as `init` to continue a calculation over several buffers.
 * @param {ArrayLike<number>} bytes
 * @param {number} [init=0xffffffff]
 * @returns {number} unsigned 32-bit CRC
 */
export function espCrc32(bytes, init = 0xffffffff) {
  let crc = (~init) >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = (CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (~crc) >>> 0;
}

const u16 = (b, o) => (b[o] | (b[o + 1] << 8)) >>> 0;
const u32 = (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);
function putU32(b, o, v) {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
}

function readInt(b, o, size, signed) {
  let v = 0n;
  for (let k = size - 1; k >= 0; k--) v = (v << 8n) | BigInt(b[o + k]);
  return signed ? BigInt.asIntN(size * 8, v) : v;
}

function writeInt(b, o, size, value) {
  const v = BigInt.asUintN(size * 8, BigInt(value));
  for (let k = 0; k < size; k++) b[o + k] = Number((v >> BigInt(8 * k)) & 0xffn);
}

const INT_RANGE = (size, signed) => {
  const bits = BigInt(size * 8);
  return signed
    ? [-(1n << (bits - 1n)), (1n << (bits - 1n)) - 1n]
    : [0n, (1n << bits) - 1n];
};

const isFixedType = (t) => [0x01, 0x11, 0x02, 0x12, 0x04, 0x14, 0x08, 0x18].includes(t);
const isVarType = (t) => t === ITEM_TYPE.SZ || t === ITEM_TYPE.BLOB || t === ITEM_TYPE.BLOB_DATA;
const fixedSize = (t) => t & 0x0f;
const fixedSigned = (t) => (t & 0xf0) === 0x10;

const decodeKey = (b, o) => {
  let end = 0;
  while (end < 16 && b[o + end] !== 0) end++;
  let s = '';
  for (let i = 0; i < end; i++) s += String.fromCharCode(b[o + i]);
  return s;
};

// Browsers and Node both provide TextDecoder/TextEncoder.
const utf8Decode = (bytes) => new TextDecoder('utf-8', { fatal: false }).decode(bytes);
const utf8Encode = (text) => new TextEncoder().encode(text);

/** Key/namespace name check used by the encoder: 1..15 printable ASCII chars. */
export function isValidNvsKey(name) {
  return typeof name === 'string' && name.length >= 1 && name.length <= 15 && /^[\x21-\x7e]+$/.test(name);
}

const SENSITIVE_KEY = /ssid|pswd|pass|psk|secret|token|credential|authkey|api.?key|private/i;
const WIFI_NS = /net80211|wifi|wpa|wlan/i;

/**
 * Does this namespace/key look like a credential the user should notice? Used for highlighting only.
 * @returns {string|null} reason text, or null
 */
export function credentialHint(namespace, key) {
  if (SENSITIVE_KEY.test(key)) return WIFI_NS.test(namespace) ? 'Wi-Fi credential' : 'possible secret';
  if (WIFI_NS.test(namespace) && /^(sta|ap)\./i.test(key)) return 'Wi-Fi setting';
  return null;
}

function parseEntry(data, base, i, pageIndex, seq) {
  const eOff = base + ENTRIES_OFFSET + i * NVS_ENTRY_SIZE;
  const ns = data[eOff];
  const type = data[eOff + 1];
  const rawSpan = data[eOff + 2];
  let span = rawSpan === 0 || rawSpan === 0xff ? 1 : rawSpan;
  if (i + span > NVS_ENTRY_COUNT) span = 1;
  const crcStored = u32(data, eOff + 4);
  const crcOk = espCrc32(data.subarray(eOff + 8, eOff + 32), espCrc32(data.subarray(eOff, eOff + 4))) === crcStored;
  const item = {
    pageIndex,
    pageSeq: seq,
    entryIndex: i,
    absOffset: eOff,
    span,
    nsIndex: ns,
    type,
    typeName: TYPE_NAMES[type] || `0x${type.toString(16).padStart(2, '0')}`,
    chunkIndex: data[eOff + 3],
    key: decodeKey(data, eOff + 8),
    crcOk,
    valid: crcOk,
    notes: []
  };
  if (!crcOk) item.notes.push('entry CRC mismatch');

  if (isFixedType(type)) {
    const size = fixedSize(type);
    item.size = size;
    item.raw = data.slice(eOff + 24, eOff + 24 + size);
    item.number = readInt(data, eOff + 24, size, fixedSigned(type));
  } else if (type === ITEM_TYPE.FLOAT || type === ITEM_TYPE.DOUBLE) {
    const size = type === ITEM_TYPE.FLOAT ? 4 : 8;
    item.size = size;
    item.raw = data.slice(eOff + 24, eOff + 24 + size);
  } else if (isVarType(type)) {
    const dataSize = u16(data, eOff + 24);
    const dataCrc = u32(data, eOff + 28);
    item.size = dataSize;
    item.dataCrc = dataCrc;
    if (dataSize > (span - 1) * NVS_ENTRY_SIZE) {
      item.valid = false;
      item.notes.push('payload does not fit in its entries');
      item.raw = new Uint8Array(0);
    } else {
      const payload = data.slice(eOff + NVS_ENTRY_SIZE, eOff + NVS_ENTRY_SIZE + dataSize);
      const dataCrcOk = espCrc32(payload) === dataCrc;
      item.raw = payload;
      item.dataCrcOk = dataCrcOk;
      if (!dataCrcOk) {
        item.valid = false;
        item.notes.push('data CRC mismatch');
      }
    }
  } else if (type === ITEM_TYPE.BLOB_IDX) {
    item.blobSize = u32(data, eOff + 24);
    item.chunkCount = data[eOff + 28];
    item.chunkStart = data[eOff + 29];
    item.size = item.blobSize;
  } else {
    item.notes.push('unknown item type');
    item.valid = false;
  }
  return item;
}

function parsePage(data, index) {
  const base = index * NVS_PAGE_SIZE;
  const state = u32(data, base);
  const seq = u32(data, base + 4);
  const version = data[base + 8];
  const crcStored = u32(data, base + 28);
  const crcComputed = espCrc32(data.subarray(base + 4, base + 28));
  const stateName = PAGE_STATE_NAMES[state] || 'invalid';
  const page = {
    index,
    offset: base,
    state,
    stateName,
    seq,
    version,
    versionOk: version === NVS_VERSION_V2,
    crcOk: crcStored === crcComputed,
    written: 0,
    erased: 0,
    illegal: 0,
    empty: 0,
    items: 0,
    notes: []
  };
  const items = [];
  if (state === PAGE_STATE.EMPTY) return { page, items, entries: [] };
  if (!page.crcOk) page.notes.push('page header CRC mismatch');
  if (!page.versionOk) page.notes.push(`page version byte 0x${version.toString(16)} (expected 0xfe / v2)`);
  if (stateName === 'invalid') page.notes.push(`unknown page state 0x${state.toString(16)}`);

  const states = new Array(NVS_ENTRY_COUNT);
  for (let i = 0; i < NVS_ENTRY_COUNT; i++) {
    const s = (data[base + BITMAP_OFFSET + (i >> 2)] >> ((i & 3) * 2)) & 3;
    states[i] = s;
    if (s === ENTRY_STATE.WRITTEN) page.written++;
    else if (s === ENTRY_STATE.ERASED) page.erased++;
    else if (s === ENTRY_STATE.ILLEGAL) page.illegal++;
    else page.empty++;
  }

  let i = 0;
  while (i < NVS_ENTRY_COUNT) {
    const s = states[i];
    if (s === ENTRY_STATE.EMPTY || s === ENTRY_STATE.ILLEGAL) { i++; continue; }
    const item = parseEntry(data, base, i, index, seq);
    item.state = s;
    item.stateName = ENTRY_STATE_NAMES[s];
    if (s !== ENTRY_STATE.WRITTEN) { item.valid = false; item.notes.push(`entry ${item.stateName}`); }
    items.push(item);
    i += item.span;
  }
  page.items = items.length;
  return { page, items };
}

/**
 * Parse an NVS partition image (length a multiple of 4096).
 * Returns every page and entry, plus the live key/value set (newest write wins per namespace + key).
 * @param {Uint8Array|ArrayBuffer} input
 */
export function parseNvsPartition(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const warnings = [];
  if (data.length === 0) throw new Error('The NVS partition image is empty.');
  if (data.length % NVS_PAGE_SIZE !== 0) {
    warnings.push(`Image is ${data.length} bytes, not a multiple of ${NVS_PAGE_SIZE}; the trailing bytes are ignored.`);
  }
  const pageCount = Math.floor(data.length / NVS_PAGE_SIZE);
  const pages = [];
  const allItems = [];
  for (let p = 0; p < pageCount; p++) {
    const { page, items } = parsePage(data, p);
    pages.push(page);
    allItems.push(...items);
  }
  const used = pages.filter((p) => p.stateName !== 'empty');
  if (used.length === 0) warnings.push('Every page is erased (0xFF): this partition holds no NVS data.');

  const livePages = new Set(pages.filter((p) => LIVE_PAGE_STATES.has(p.stateName) && p.crcOk).map((p) => p.index));
  const isLive = (it) => it.state === ENTRY_STATE.WRITTEN && livePages.has(it.pageIndex);
  const newer = (a, b) => (a.pageSeq !== b.pageSeq ? a.pageSeq > b.pageSeq : a.entryIndex > b.entryIndex);

  // Namespaces: nsIndex 0 entries of type u8, key = namespace name, value = namespace index.
  const namespaces = new Map();
  for (const it of allItems) {
    if (!isLive(it) || it.nsIndex !== 0 || it.type !== ITEM_TYPE.U8 || !it.valid) continue;
    const prev = namespaces.get(Number(it.number));
    if (!prev || newer(it, prev.item)) namespaces.set(Number(it.number), { index: Number(it.number), name: it.key, item: it });
  }
  const nsName = (idx) => (idx === 0 ? '' : namespaces.get(idx)?.name ?? `#${idx}`);

  // Blob chunks: newest BLOB_DATA per (ns, key, chunkIndex).
  const chunkMap = new Map();
  for (const it of allItems) {
    if (!isLive(it) || it.type !== ITEM_TYPE.BLOB_DATA) continue;
    const k = `${it.nsIndex}\u0000${it.key}`;
    if (!chunkMap.has(k)) chunkMap.set(k, new Map());
    const m = chunkMap.get(k);
    const prev = m.get(it.chunkIndex);
    if (!prev || newer(it, prev)) m.set(it.chunkIndex, it);
  }

  // Live value per (ns, key): newest non-chunk, non-namespace item.
  const latest = new Map();
  for (const it of allItems) {
    if (!isLive(it) || it.nsIndex === 0 || it.type === ITEM_TYPE.BLOB_DATA) continue;
    const k = `${it.nsIndex}\u0000${it.key}`;
    const prev = latest.get(k);
    if (!prev || newer(it, prev)) latest.set(k, it);
  }

  const values = [];
  for (const it of latest.values()) {
    const namespace = nsName(it.nsIndex);
    const v = {
      namespace,
      nsIndex: it.nsIndex,
      key: it.key,
      type: it.typeName,
      typeCode: it.type,
      pageIndex: it.pageIndex,
      entryIndex: it.entryIndex,
      location: { absOffset: it.absOffset, span: it.span, type: it.type },
      valid: it.valid,
      notes: [...it.notes],
      editable: false,
      editKind: null,
      readOnlyReason: '',
      size: it.size ?? 0
    };
    if (isFixedType(it.type)) {
      v.kind = 'int';
      v.number = it.number;
      v.value = String(it.number);
      v.raw = it.raw;
      v.editable = it.valid;
      v.editKind = 'int';
      if (!it.valid) v.readOnlyReason = 'entry failed its CRC';
    } else if (it.type === ITEM_TYPE.FLOAT || it.type === ITEM_TYPE.DOUBLE) {
      v.kind = 'float';
      v.raw = it.raw;
      const dv = new DataView(it.raw.buffer, it.raw.byteOffset, it.raw.byteLength);
      v.value = it.type === ITEM_TYPE.FLOAT ? String(dv.getFloat32(0, true)) : String(dv.getFloat64(0, true));
      v.readOnlyReason = 'float and double values are shown, not edited';
    } else if (it.type === ITEM_TYPE.SZ) {
      v.kind = 'string';
      const bytes = it.raw;
      const nul = bytes.indexOf(0);
      const text = bytes.subarray(0, nul < 0 ? bytes.length : nul);
      v.raw = bytes;
      v.value = utf8Decode(text);
      v.editable = it.valid && bytes.length > 0 && bytes[bytes.length - 1] === 0;
      v.editKind = 'string';
      v.readOnlyReason = v.editable ? '' : 'string failed its CRC or has no terminator';
      v.notes.push(`stored length ${bytes.length} bytes incl. NUL`);
    } else if (it.type === ITEM_TYPE.BLOB_IDX || it.type === ITEM_TYPE.BLOB) {
      v.kind = 'blob';
      let raw = null;
      if (it.type === ITEM_TYPE.BLOB) {
        raw = it.raw;
        v.valid = it.valid;
      } else {
        const chunks = [];
        const cm = chunkMap.get(`${it.nsIndex}\u0000${it.key}`);
        let ok = !!cm;
        for (let k = 0; ok && k < it.chunkCount; k++) {
          const c = cm.get((it.chunkStart + k) & 0xff);
          if (!c || !c.valid) { ok = false; break; }
          chunks.push(c.raw);
        }
        if (ok) {
          const total = chunks.reduce((s, c) => s + c.length, 0);
          if (total !== it.blobSize) { ok = false; v.notes.push(`chunks hold ${total} bytes, index says ${it.blobSize}`); }
        } else {
          v.notes.push('one or more blob chunks are missing or invalid');
        }
        v.valid = ok && it.valid;
        if (ok) {
          raw = new Uint8Array(it.blobSize);
          let o = 0;
          for (const c of chunks) { raw.set(c, o); o += c.length; }
        }
        v.chunkCount = it.chunkCount;
        v.chunkStart = it.chunkStart;
      }
      v.raw = raw || new Uint8Array(0);
      v.size = v.raw.length;
      v.value = v.valid ? `<blob ${v.raw.length} bytes>` : '<invalid blob>';
      v.readOnlyReason = 'blobs are read-only in this editor';
    } else {
      v.kind = 'unknown';
      v.raw = new Uint8Array(0);
      v.value = '';
      v.readOnlyReason = 'unknown item type';
    }
    v.sensitive = credentialHint(namespace, it.key);
    if (!v.valid && !v.notes.length) v.notes.push('invalid');
    values.push(v);
  }
  values.sort((a, b) => (a.namespace === b.namespace ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.namespace < b.namespace ? -1 : 1));

  const counts = {
    pages: pages.length,
    livePages: livePages.size,
    written: allItems.filter((it) => it.state === ENTRY_STATE.WRITTEN).length,
    erased: allItems.filter((it) => it.state === ENTRY_STATE.ERASED).length,
    crcBad: allItems.filter((it) => !it.crcOk).length,
    pageCrcBad: pages.filter((p) => p.stateName !== 'empty' && !p.crcOk).length
  };
  const totalNonEmpty = counts.written + counts.erased;
  if (totalNonEmpty > 0 && counts.crcBad / Math.max(1, allItems.length) > 0.5) {
    warnings.push('Most entries fail their CRC. The partition may be NVS-encrypted (nvs_keys), corrupt or not an NVS image.');
  }
  if (counts.pageCrcBad > 0) warnings.push(`${counts.pageCrcBad} page(s) have a bad header CRC and were ignored for live values.`);

  return {
    pages,
    items: allItems,
    namespaces: [...namespaces.values()].map((n) => ({ index: n.index, name: n.name })).sort((a, b) => a.index - b.index),
    values,
    counts,
    warnings
  };
}

/** Chunk payloads of a blob value: returns a copy of the payload bytes. */
export function blobBytes(value) {
  return value && value.raw ? value.raw.slice() : new Uint8Array(0);
}

/** Printable text view of bytes (NUL stripped at the end), or null when not printable. */
export function printableText(bytes) {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  if (end === 0) return '';
  for (let i = 0; i < end; i++) {
    const c = bytes[i];
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return null;
    if (c === 0x7f) return null;
  }
  return utf8Decode(bytes.subarray(0, end));
}

function recomputeItemCrc(b, absOffset) {
  const c = espCrc32(b.subarray(absOffset + 8, absOffset + 32), espCrc32(b.subarray(absOffset, absOffset + 4)));
  putU32(b, absOffset + 4, c);
}

/**
 * Parse text for an integer NVS value of the given type (decimal, 0x hex, optional sign).
 * Throws with a readable message when the text is not an integer or is out of range.
 */
export function parseNvsIntText(text, typeCode) {
  const size = fixedSize(typeCode);
  const signed = fixedSigned(typeCode);
  const t = String(text).trim();
  if (!/^[-+]?(0x[0-9a-f]+|\d+)$/i.test(t)) throw new Error(`"${t}" is not an integer.`);
  const neg = t.startsWith('-');
  const body = t.replace(/^[-+]/, '');
  let n = BigInt(body);
  if (neg) n = -n;
  const [lo, hi] = INT_RANGE(size, signed);
  if (n < lo || n > hi) throw new Error(`${n} is out of range ${lo}..${hi} for this type.`);
  return n;
}

/**
 * Return a copy of `bytes` with an integer or same-length string value rewritten and its entry CRC
 * recomputed. Throws for anything that cannot be edited in place.
 * @param {Uint8Array} bytes  whole NVS partition image
 * @param {object} value      an entry from parseNvsPartition().values
 * @param {string} text       new value
 * @returns {Uint8Array}
 */
export function editNvsValue(bytes, value, text) {
  if (!value || !value.editable) throw new Error(value?.readOnlyReason || 'This value is read-only.');
  const out = bytes.slice();
  const o = value.location.absOffset;
  if (value.editKind === 'int') {
    const type = value.location.type;
    const n = parseNvsIntText(text, type);
    writeInt(out, o + 24, fixedSize(type), n);
  } else if (value.editKind === 'string') {
    const dataSize = u16(out, o + 24);
    const newBytes = utf8Encode(String(text));
    if (newBytes.length !== dataSize - 1) {
      throw new Error(`The new text is ${newBytes.length} bytes; this value must stay exactly ${dataSize - 1} bytes (same-length edits only).`);
    }
    if (newBytes.includes(0)) throw new Error('The text cannot contain a NUL character.');
    const region = out.subarray(o + NVS_ENTRY_SIZE, o + NVS_ENTRY_SIZE + dataSize);
    region.set(newBytes, 0);
    region[dataSize - 1] = 0;
    putU32(out, o + 28, espCrc32(region));
  } else {
    throw new Error('This value type is read-only.');
  }
  recomputeItemCrc(out, o);
  return out;
}

/** Entries needed to store `payloadLength` bytes after the header. */
const childCount = (len) => Math.ceil(len / NVS_ENTRY_SIZE);

function keyField(name) {
  if (!isValidNvsKey(name)) throw new Error(`Invalid NVS key "${name}" (1-15 printable ASCII characters).`);
  const out = new Uint8Array(16);
  for (let i = 0; i < name.length; i++) out[i] = name.charCodeAt(i);
  return out;
}

/**
 * Encode one NVS item as 32-byte entries (header first, then payload entries), with CRCs.
 * @param {{nsIndex:number, type:number, key:string, value?:number|bigint|Uint8Array, chunkIndex?:number,
 *   blob?:{size:number, chunkCount:number, chunkStart:number}}} opts
 *   value: integer for fixed types; Uint8Array payload (NUL included) for SZ/BLOB/BLOB_DATA
 * @returns {Uint8Array[]}
 */
export function encodeNvsItem({ nsIndex, type, key, value, chunkIndex = CHUNK_ANY, blob }) {
  const head = new Uint8Array(NVS_ENTRY_SIZE).fill(0xff);
  head[0] = nsIndex & 0xff;
  head[1] = type;
  head[3] = chunkIndex & 0xff;
  head.set(keyField(key), 8);
  const extra = [];
  if (isFixedType(type)) {
    head[2] = 1;
    writeInt(head, 24, fixedSize(type), value ?? 0);
  } else if (type === ITEM_TYPE.BLOB_IDX) {
    head[2] = 1;
    putU32(head, 24, blob.size >>> 0);
    head[28] = blob.chunkCount & 0xff;
    head[29] = blob.chunkStart & 0xff;
    head[30] = 0xff;
    head[31] = 0xff;
  } else if (isVarType(type)) {
    const payload = value instanceof Uint8Array ? value : new Uint8Array(0);
    const n = childCount(payload.length);
    head[2] = 1 + n;
    head[24] = payload.length & 0xff;
    head[25] = (payload.length >>> 8) & 0xff;
    head[26] = 0xff;
    head[27] = 0xff;
    putU32(head, 28, espCrc32(payload));
    const padded = new Uint8Array(n * NVS_ENTRY_SIZE).fill(0xff);
    padded.set(payload, 0);
    for (let i = 0; i < n; i++) extra.push(padded.slice(i * NVS_ENTRY_SIZE, (i + 1) * NVS_ENTRY_SIZE));
  } else {
    throw new Error(`Cannot encode NVS type 0x${type.toString(16)}.`);
  }
  recomputeItemCrc(head, 0);
  return [head, ...extra];
}

/** Encode a string value (adds the NUL terminator). */
export function encodeNvsString(nsIndex, key, text) {
  const b = utf8Encode(String(text));
  const payload = new Uint8Array(b.length + 1);
  payload.set(b, 0);
  return encodeNvsItem({ nsIndex, type: ITEM_TYPE.SZ, key, value: payload });
}

/**
 * Encode a blob as BLOB_DATA chunks followed by a BLOB_IDX entry.
 * @param {number} chunkStart 0 or 0x80 (version offset)
 */
export function encodeNvsBlob(nsIndex, key, bytes, { chunkSize = NVS_CHUNK_MAX, chunkStart = 0 } = {}) {
  const parts = [];
  const chunkCount = Math.max(1, Math.ceil(bytes.length / chunkSize));
  for (let k = 0; k < chunkCount; k++) {
    const chunk = bytes.subarray(k * chunkSize, Math.min(bytes.length, (k + 1) * chunkSize));
    parts.push(...encodeNvsItem({ nsIndex, type: ITEM_TYPE.BLOB_DATA, key, value: chunk, chunkIndex: (chunkStart + k) & 0xff }));
  }
  parts.push(...encodeNvsItem({ nsIndex, type: ITEM_TYPE.BLOB_IDX, key, blob: { size: bytes.length, chunkCount, chunkStart } }));
  return parts;
}

/**
 * Build one 4096-byte page.
 * @param {{seq:number, entries:Uint8Array[], erased?:number[], state?:number}} opts
 *   entries: encoded 32-byte entries in slot order; erased: slot indices marked ERASED
 */
export function buildNvsPage({ seq, entries, erased = [], state = PAGE_STATE.ACTIVE }) {
  if (entries.length > NVS_ENTRY_COUNT) throw new Error(`A page holds ${NVS_ENTRY_COUNT} entries; got ${entries.length}.`);
  const page = new Uint8Array(NVS_PAGE_SIZE).fill(0xff);
  putU32(page, 0, state >>> 0);
  putU32(page, 4, seq >>> 0);
  page[8] = NVS_VERSION_V2;
  const erasedSet = new Set(erased);
  for (let i = 0; i < NVS_ENTRY_COUNT; i++) {
    const s = i >= entries.length ? ENTRY_STATE.EMPTY : erasedSet.has(i) ? ENTRY_STATE.ERASED : ENTRY_STATE.WRITTEN;
    const bo = BITMAP_OFFSET + (i >> 2);
    const shift = (i & 3) * 2;
    page[bo] = (page[bo] & ~(3 << shift)) | (s << shift);
  }
  entries.forEach((e, i) => {
    if (e.length !== NVS_ENTRY_SIZE) throw new Error('Entries must be 32 bytes.');
    page.set(e, ENTRIES_OFFSET + i * NVS_ENTRY_SIZE);
  });
  putU32(page, 28, espCrc32(page.subarray(4, 28)));
  return page;
}

/** Concatenate pages into a partition image. */
export function buildNvsPartition(pages) {
  const out = new Uint8Array(pages.length * NVS_PAGE_SIZE);
  pages.forEach((p, i) => out.set(p, i * NVS_PAGE_SIZE));
  return out;
}

/** Flatten a parsed value into a plain object for JSON export. */
export function valueToJson(v) {
  const num = v.kind === 'int' ? (Number.isSafeInteger(Number(v.number)) ? Number(v.number) : String(v.number)) : undefined;
  const out = {
    namespace: v.namespace,
    key: v.key,
    type: v.type,
    value: v.kind === 'int' ? num : v.kind === 'blob' ? undefined : v.value,
    size: v.size,
    valid: v.valid,
    sensitive: v.sensitive,
    editable: v.editable
  };
  if (v.kind === 'blob' || v.kind === 'unknown') out.hex = Array.from(v.raw, (b) => b.toString(16).padStart(2, '0')).join('');
  return out;
}

/** CSV cell escaping (RFC 4180). */
export function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
