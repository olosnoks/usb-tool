// ESP-IDF partition table parser (the 0x8000 table: 32-byte entries).
//
// Entry: AA 50 | type | subtype | offset u32 | size u32 | name[16] | flags u32.
// An optional MD5 entry (EB EB, 14x FF, then the 16-byte MD5 of all earlier
// entries) follows the last partition; unused space is 0xFF.
import CryptoJS from 'crypto-js';

export const PARTITION_TABLE_OFFSET = 0x8000;
export const PARTITION_TABLE_SIZE = 0x1000;
const ENTRY = 32;

const TYPES = { 0x00: 'app', 0x01: 'data' };
const APP_SUBTYPES = { 0x00: 'factory', 0x20: 'test' };
for (let i = 0; i < 16; i++) APP_SUBTYPES[0x10 + i] = `ota_${i}`;
const DATA_SUBTYPES = {
  0x00: 'ota', 0x01: 'phy', 0x02: 'nvs', 0x03: 'coredump', 0x04: 'nvs_keys', 0x05: 'efuse_em',
  0x06: 'undefined', 0x80: 'esphttpd', 0x81: 'fat', 0x82: 'spiffs', 0x83: 'littlefs'
};

export function partitionTypeName(type) {
  return TYPES[type] || `0x${type.toString(16)}`;
}
export function partitionSubtypeName(type, subtype) {
  const t = type === 0x00 ? APP_SUBTYPES : type === 0x01 ? DATA_SUBTYPES : null;
  return (t && t[subtype]) || `0x${subtype.toString(16)}`;
}

function md5Bytes(bytes) {
  return CryptoJS.MD5(CryptoJS.lib.WordArray.create(bytes)).toString();
}

/**
 * Parse a partition table image.
 * @param {Uint8Array} bytes  at least one 32-byte entry; normally 4096 bytes read from 0x8000
 * @returns {{ partitions: object[], md5: { present: boolean, valid: boolean|null }, warnings: string[] }}
 * @throws Error with a clear message when the data is not a partition table.
 */
export function parsePartitionTable(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes || []);
  if (bytes.length < ENTRY) throw new Error(`Partition table is truncated: ${bytes.length} bytes, need at least ${ENTRY}.`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const partitions = [];
  const warnings = [];
  const md5 = { present: false, valid: null };
  let terminated = false;

  for (let pos = 0; pos + ENTRY <= bytes.length; pos += ENTRY) {
    const m0 = bytes[pos], m1 = bytes[pos + 1];
    if (m0 === 0xaa && m1 === 0x50) {
      let nameEnd = 0;
      while (nameEnd < 16 && bytes[pos + 12 + nameEnd] !== 0) nameEnd++;
      const type = bytes[pos + 2], subtype = bytes[pos + 3];
      const flags = dv.getUint32(pos + 28, true);
      partitions.push({
        name: String.fromCharCode(...bytes.subarray(pos + 12, pos + 12 + nameEnd)),
        type, subtype,
        typeName: partitionTypeName(type),
        subtypeName: partitionSubtypeName(type, subtype),
        offset: dv.getUint32(pos + 4, true),
        size: dv.getUint32(pos + 8, true),
        flags,
        encrypted: (flags & 1) !== 0,
        readonly: (flags & 2) !== 0
      });
    } else if (m0 === 0xeb && m1 === 0xeb) {
      md5.present = true;
      const stored = Array.from(bytes.subarray(pos + 16, pos + 32)).map((b) => b.toString(16).padStart(2, '0')).join('');
      md5.valid = md5Bytes(bytes.subarray(0, pos)) === stored;
      if (!md5.valid) warnings.push('The table MD5 entry does not match its contents: the table may be corrupt.');
      terminated = true;
      break;
    } else if (bytes.subarray(pos, pos + ENTRY).every((b) => b === 0xff)) {
      terminated = true;
      break;
    } else {
      throw new Error(`Not a valid partition table: bad entry magic 0x${((m1 << 8) | m0).toString(16).padStart(4, '0')} at table byte ${pos}.`);
    }
  }

  if (partitions.length === 0) throw new Error('No partition entries found (erased flash or not a partition table).');
  if (!terminated) warnings.push('The table runs to the end of the data without a terminator or MD5 entry; it may be truncated.');
  return { partitions, md5, warnings };
}

/** Smallest flash size (bytes) that holds every partition in the table. */
export function partitionTableExtent(partitions) {
  return partitions.reduce((m, p) => Math.max(m, p.offset + p.size), 0);
}

/** Build a table image (for tests and tooling). Entries: { name, type, subtype, offset, size, flags }. */
export function buildPartitionTable(entries, { md5 = true, length = PARTITION_TABLE_SIZE } = {}) {
  const out = new Uint8Array(length).fill(0xff);
  const dv = new DataView(out.buffer);
  let pos = 0;
  for (const e of entries) {
    out[pos] = 0xaa; out[pos + 1] = 0x50; out[pos + 2] = e.type; out[pos + 3] = e.subtype;
    dv.setUint32(pos + 4, e.offset, true); dv.setUint32(pos + 8, e.size, true);
    out.fill(0, pos + 12, pos + 28);
    for (let i = 0; i < Math.min(15, e.name.length); i++) out[pos + 12 + i] = e.name.charCodeAt(i);
    dv.setUint32(pos + 28, e.flags || 0, true);
    pos += ENTRY;
  }
  if (md5) {
    const hex = md5Bytes(out.subarray(0, pos));
    out[pos] = 0xeb; out[pos + 1] = 0xeb; out.fill(0xff, pos + 2, pos + 16);
    for (let i = 0; i < 16; i++) out[pos + 16 + i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}
