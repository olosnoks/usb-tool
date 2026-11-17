import { describe, it, expect } from 'vitest';
import {
  espCrc32, parseNvsPartition, editNvsValue, parseNvsIntText, encodeNvsItem, encodeNvsString,
  encodeNvsBlob, buildNvsPage, buildNvsPartition, credentialHint, printableText, valueToJson, csvCell,
  ITEM_TYPE, PAGE_STATE, NVS_PAGE_SIZE
} from '../src/utils/espNvs.js';
import {
  parseCsv, toCsv, resolveOffsets, validateRows, buildTableBinary, rowsFromPartitions, readDumpTable,
  patchDumpTable, flashMap, detectImage, parseSizeText, TYPE_APP, TYPE_DATA, MAX_ENTRIES
} from '../src/utils/espNvs/partitionTable.js';
import { parsePartitionTable, buildPartitionTable } from '../src/utils/espPartitions.js';

// Real ESP-IDF NVS page: components/nvs_flash/nvs_partition_generator/part_old_blob_format.bin (4096 bytes,
// version byte 0xFF). Written by ESP-IDF's tooling, so it checks the CRC and layout independently of the
// encoder below. Only the used prefix (704 bytes) is embedded; the rest of the page is 0xFF.
const FIXTURE_PREFIX_B64 = '/v///wAAAAD//////////////////////////8IW3dyqqqqqqv///////////////////////////////////wABAf/JPqQHZHVtbXlOYW1lc3BhY2UAAAH/////////AQEB/z0YjsNkdW1teVU4S2V5AAAAAAAAf/////////8BEQH/4546SGR1bW15SThLZXkAAAAAAACA/////////wECAf/0lFDjZHVtbXlVMTZLZXkAAAAAAACA////////AQQB/1sjvhVkdW1teVUzMktleQAAAAAA//////////8BFAH/ZzN6k2R1bW15STMyS2V5AAAAAAAAAACA/////wEhAv/MXo2bZHVtbXlTdHJpbmdLZXkAABIA//+rOxcgMEE6MEI6MEM6MEQ6MEU6MEYA//////////////////8BQQL/Oq5xDWR1bW15SGV4MkJpbktleQAGAP//vzQaxwECA6vN7///////////////////////////////////AUEC/+5l6CFkdW1teUJhc2U2NEtleQAABgD//44Pw8MxMjNhYmP//////////////////////////////////wFBAv9M4lyQaGV4RmlsZUtleQAAAAAAAAgA//848RqyASNFZ4mrze////////////////////////////////8BQQL/4aqDvGJhc2U2NEZpbGVLZXkAAAAMAP//mAtsagECAwQFBgcICavN7///////////////////////////ASEC/xg/9AZzdHJpbmdGaWxlS2V5AAAAGwD//6CqG4JhYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5egD//////wFBAv/mhZbAYmluRmlsZUtleQAAAAAAAAwA//+YC2xqAQIDBAUGBwgJq83v//////////////////////////8=';

const fixtureImage = () => {
  const prefix = Uint8Array.from(atob(FIXTURE_PREFIX_B64), (c) => c.charCodeAt(0));
  const page = new Uint8Array(NVS_PAGE_SIZE).fill(0xff);
  page.set(prefix, 0);
  return page;
};

const NS = 1;
const nsDecl = (idx, name) => encodeNvsItem({ nsIndex: 0, type: ITEM_TYPE.U8, key: name, value: idx });
const pageOf = (seq, entries, erased = []) => buildNvsPage({ seq, entries, erased });
const img = (...pages) => buildNvsPartition(pages);
const valueOf = (r, key) => r.values.find((v) => v.key === key);

describe('espCrc32 (ESP-IDF esp_rom_crc32_le, 0xFFFFFFFF seed)', () => {
  it('matches the zlib.crc32(data, 0xFFFFFFFF) reference vector', () => {
    expect(espCrc32(enc('123456789'))).toBe(0xd202d277);
  });
  it('chains across buffers like one buffer', () => {
    const a = enc('hello ');
    const b = enc('world');
    expect(espCrc32(b, espCrc32(a))).toBe(espCrc32(enc('hello world')));
  });
});

function enc(s) {
  return new TextEncoder().encode(s);
}

describe('parseNvsPartition: real ESP-IDF fixture', () => {
  const r = parseNvsPartition(fixtureImage());
  it('finds the namespace and every item with valid CRCs', () => {
    expect(r.namespaces).toEqual([{ index: 1, name: 'dummyNamespace' }]);
    expect(r.counts.crcBad).toBe(0);
    expect(r.counts.pageCrcBad).toBe(0);
    expect(r.values).toHaveLength(12);
    expect(r.values.every((v) => v.valid)).toBe(true);
  });
  it('decodes integers at their boundaries', () => {
    expect(valueOf(r, 'dummyU8Key').value).toBe('127');
    expect(valueOf(r, 'dummyI8Key').value).toBe('-128');
    expect(valueOf(r, 'dummyU16Key').value).toBe('32768');
    expect(valueOf(r, 'dummyU32Key').value).toBe('4294967295');
    expect(valueOf(r, 'dummyI32Key').value).toBe('-2147483648');
  });
  it('decodes strings and legacy blobs', () => {
    expect(valueOf(r, 'stringFileKey').value).toBe('abcdefghijklmnopqrstuvwxyz');
    expect(valueOf(r, 'dummyStringKey').value).toBe('0A:0B:0C:0D:0E:0F');
    expect(Array.from(valueOf(r, 'hexFileKey').raw)).toEqual([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]);
    expect(valueOf(r, 'hexFileKey').type).toBe('blob');
  });
  it('marks the fixed-size integers editable and the blobs read-only', () => {
    expect(valueOf(r, 'dummyU16Key').editable).toBe(true);
    expect(valueOf(r, 'hexFileKey').editable).toBe(false);
    expect(valueOf(r, 'hexFileKey').readOnlyReason).toMatch(/read-only/);
  });
});

describe('encoder and parser round trip', () => {
  const entries = [
    ...nsDecl(NS, 'wifi'),
    ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U8, key: 'u8', value: 200 }),
    ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.I32, key: 'i32', value: -5 }),
    ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U64, key: 'u64', value: 0xfedcba9876543210n }),
    ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.I64, key: 'i64', value: -1n }),
    ...encodeNvsString(NS, 'ssid', 'HomeNet'),
    ...encodeNvsBlob(NS, 'blob', enc('0123456789abcdef0123456789'), { chunkSize: 10 })
  ];
  const r = parseNvsPartition(img(pageOf(7, entries)));

  it('reads back every value written', () => {
    expect(valueOf(r, 'u8').value).toBe('200');
    expect(valueOf(r, 'i32').value).toBe('-5');
    expect(valueOf(r, 'u64').value).toBe('18364758544493064720');
    expect(valueOf(r, 'i64').value).toBe('-1');
    expect(valueOf(r, 'ssid').value).toBe('HomeNet');
    expect(valueOf(r, 'ssid').type).toBe('string');
  });

  it('reassembles a multi-chunk blob from BLOB_DATA chunks and checks its length', () => {
    const b = valueOf(r, 'blob');
    expect(b.type).toBe('blob_index');
    expect(b.valid).toBe(true);
    expect(b.chunkCount).toBe(3);
    expect(new TextDecoder().decode(b.raw)).toBe('0123456789abcdef0123456789');
    expect(b.editable).toBe(false);
  });

  it('keeps the namespace and reports the page as active with a good CRC', () => {
    expect(r.namespaces[0].name).toBe('wifi');
    expect(r.pages[0]).toMatchObject({ stateName: 'active', seq: 7, crcOk: true, versionOk: true });
    expect(r.warnings).toEqual([]);
  });
});

describe('live value resolution', () => {
  it('lets the newest write win across pages and ignores erased entries', () => {
    const old = [...nsDecl(NS, 'cfg'), ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U32, key: 'n', value: 1 })];
    const newer = [...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U32, key: 'n', value: 2 })];
    const r = parseNvsPartition(img(pageOf(3, old, [1]), pageOf(4, newer)));
    expect(valueOf(r, 'n').value).toBe('2');
    expect(r.values.filter((v) => v.key === 'n')).toHaveLength(1);
  });

  it('ignores a page whose header CRC is bad and says so', () => {
    const good = pageOf(3, [...nsDecl(NS, 'cfg'), ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U8, key: 'a', value: 9 })]);
    const bad = pageOf(4, [...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U8, key: 'a', value: 77 })]);
    bad[28] ^= 0x01; // corrupt the page header CRC
    const r = parseNvsPartition(img(good, bad));
    expect(valueOf(r, 'a').value).toBe('9');
    expect(r.counts.pageCrcBad).toBe(1);
    expect(r.warnings.join(' ')).toMatch(/header CRC/);
  });

  it('marks an item whose data was damaged as invalid and not editable', () => {
    const page = pageOf(2, [...nsDecl(NS, 'cfg'), ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U16, key: 'x', value: 5 })]);
    page[64 + 32 + 24] ^= 0x10; // flip a data bit of the U16 entry
    const r = parseNvsPartition(img(page));
    const v = valueOf(r, 'x');
    expect(v.valid).toBe(false);
    expect(v.editable).toBe(false);
    expect(v.notes.join(' ')).toMatch(/CRC/);
  });

  it('warns when an image looks encrypted (most entries fail CRC)', () => {
    const page = buildNvsPage({ seq: 1, entries: [...nsDecl(NS, 'x'), ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U8, key: 'a', value: 1 })] });
    for (let i = 64; i < 4096; i += 7) page[i] ^= 0x5a; // scramble the entry table
    const r = parseNvsPartition(img(page));
    expect(r.warnings.join(' ')).toMatch(/encrypted|corrupt/);
  });

  it('reports an all-erased partition', () => {
    const r = parseNvsPartition(new Uint8Array(NVS_PAGE_SIZE * 2).fill(0xff));
    expect(r.counts.livePages).toBe(0);
    expect(r.warnings.join(' ')).toMatch(/erased/);
  });

  it('rejects an empty image and warns about trailing bytes', () => {
    expect(() => parseNvsPartition(new Uint8Array(0))).toThrow(/empty/);
    const r = parseNvsPartition(new Uint8Array(NVS_PAGE_SIZE + 10).fill(0xff));
    expect(r.warnings.join(' ')).toMatch(/not a multiple/);
  });
});

describe('editing', () => {
  const build = () => img(pageOf(5, [
    ...nsDecl(NS, 'nvs.net80211'),
    ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U16, key: 'port', value: 8080 }),
    ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.I8, key: 'delta', value: -3 }),
    ...encodeNvsString(NS, 'sta.ssid', 'Cafe-5G'),
    ...encodeNvsString(NS, 'sta.pswd', 'hunter22xx')
  ]));

  it('rewrites an integer and keeps the entry CRC valid', () => {
    const before = build();
    const r0 = parseNvsPartition(before);
    const out = editNvsValue(before, valueOf(r0, 'port'), '65535');
    const r1 = parseNvsPartition(out);
    expect(valueOf(r1, 'port').value).toBe('65535');
    expect(valueOf(r1, 'port').valid).toBe(true);
    expect(r1.counts.crcBad).toBe(0);
    // Only the edited entry (and nothing else) changed.
    const diff = [];
    for (let i = 0; i < before.length; i++) if (before[i] !== out[i]) diff.push(i);
    const e = valueOf(r0, 'port').location.absOffset;
    expect(diff.every((i) => i >= e && i < e + 32)).toBe(true);
  });

  it('accepts hex and negative input within range and rejects out-of-range input', () => {
    const before = build();
    const r0 = parseNvsPartition(before);
    const out = editNvsValue(before, valueOf(r0, 'delta'), '-0x7f');
    expect(valueOf(parseNvsPartition(out), 'delta').value).toBe('-127');
    expect(() => editNvsValue(before, valueOf(r0, 'delta'), '128')).toThrow(/out of range/);
    expect(() => editNvsValue(before, valueOf(r0, 'port'), '65536')).toThrow(/out of range/);
    expect(() => editNvsValue(before, valueOf(r0, 'port'), 'abc')).toThrow(/not an integer/);
  });

  it('rewrites a same-length string and keeps its data CRC valid', () => {
    const before = build();
    const r0 = parseNvsPartition(before);
    const out = editNvsValue(before, valueOf(r0, 'sta.pswd'), 'letmein!!!');
    const r1 = parseNvsPartition(out);
    expect(valueOf(r1, 'sta.pswd').value).toBe('letmein!!!');
    expect(valueOf(r1, 'sta.pswd').valid).toBe(true);
    expect(r1.counts.crcBad).toBe(0);
  });

  it('refuses a string edit that changes the length', () => {
    const before = build();
    const r0 = parseNvsPartition(before);
    expect(() => editNvsValue(before, valueOf(r0, 'sta.ssid'), 'Cafe')).toThrow(/exactly 7 bytes/);
    expect(() => editNvsValue(before, valueOf(r0, 'sta.ssid'), 'Cafe-5Gx')).toThrow(/exactly 7 bytes/);
  });

  it('does not modify the input buffer', () => {
    const before = build();
    const copy = before.slice();
    editNvsValue(before, valueOf(parseNvsPartition(before), 'port'), '1');
    expect(before).toEqual(copy);
  });

  it('refuses to edit blobs and floats', () => {
    const r = parseNvsPartition(img(pageOf(1, [...nsDecl(NS, 'b'), ...encodeNvsBlob(NS, 'k', enc('abc'))])));
    expect(() => editNvsValue(img(pageOf(1, [...nsDecl(NS, 'b'), ...encodeNvsBlob(NS, 'k', enc('abc'))])), valueOf(r, 'k'), 'x')).toThrow(/read-only/);
  });

  it('parseNvsIntText handles the type bounds', () => {
    expect(parseNvsIntText('255', ITEM_TYPE.U8)).toBe(255n);
    expect(parseNvsIntText('-128', ITEM_TYPE.I8)).toBe(-128n);
    expect(parseNvsIntText('18446744073709551615', ITEM_TYPE.U64)).toBe(18446744073709551615n);
    expect(() => parseNvsIntText('-1', ITEM_TYPE.U32)).toThrow(/out of range/);
    expect(() => parseNvsIntText('1.5', ITEM_TYPE.U8)).toThrow(/not an integer/);
  });
});

describe('blobs and string helpers', () => {
  it('flags a blob whose chunk is missing', () => {
    const entries = [...nsDecl(NS, 'b'), ...encodeNvsBlob(NS, 'k', enc('0123456789'), { chunkSize: 4 })];
    // Remove the second chunk (slot 2 is chunk 1 after the namespace entry and chunk 0 + its span).
    const idx = entries.findIndex((e, i) => i > 0 && e[1] === ITEM_TYPE.BLOB_DATA && e[3] === 1);
    entries.splice(idx, 2); // the chunk header and its one payload entry
    const r = parseNvsPartition(img(pageOf(1, entries)));
    const v = valueOf(r, 'k');
    expect(v.valid).toBe(false);
    expect(v.notes.join(' ')).toMatch(/missing|invalid/);
  });

  it('keeps the newest chunks for a blob that was rewritten with the other version offset', () => {
    const first = encodeNvsBlob(NS, 'k', enc('AAAAAAAA'), { chunkSize: 8, chunkStart: 0 });
    const second = encodeNvsBlob(NS, 'k', enc('BBBBBBBB'), { chunkSize: 8, chunkStart: 0x80 });
    const r = parseNvsPartition(img(pageOf(1, [...nsDecl(NS, 'b'), ...first]), pageOf(2, second)));
    expect(new TextDecoder().decode(valueOf(r, 'k').raw)).toBe('BBBBBBBB');
  });

  it('printableText returns text or null for binary', () => {
    expect(printableText(enc('hi\0\0'))).toBe('hi');
    expect(printableText(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(printableText(new Uint8Array(0))).toBe('');
  });

  it('valueToJson and csvCell produce plain values', () => {
    const r = parseNvsPartition(img(pageOf(1, [...nsDecl(NS, 'wifi'), ...encodeNvsItem({ nsIndex: NS, type: ITEM_TYPE.U32, key: 'n', value: 7 })])));
    expect(valueToJson(valueOf(r, 'n'))).toMatchObject({ namespace: 'wifi', key: 'n', value: 7, type: 'u32' });
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell(null)).toBe('');
  });

  it('highlights Wi-Fi credentials by namespace and key', () => {
    expect(credentialHint('nvs.net80211', 'sta.ssid')).toBe('Wi-Fi credential');
    expect(credentialHint('nvs.net80211', 'sta.pswd')).toBe('Wi-Fi credential');
    expect(credentialHint('nvs.net80211', 'sta.authmode')).toBe('Wi-Fi setting');
    expect(credentialHint('app', 'api_token')).toBe('possible secret');
    expect(credentialHint('app', 'brightness')).toBeNull();
  });
});

describe('page builder', () => {
  it('writes the header CRC and the entry-state bitmap', () => {
    const page = buildNvsPage({ seq: 9, entries: nsDecl(NS, 'a'), erased: [0] });
    expect(page[8]).toBe(0xfe);
    expect(page[0] | (page[1] << 8) | (page[2] << 16) | (page[3] << 24)).toBe(0xfffffffe | 0);
    // entry 0 erased (0b00), entry 1 empty (0b11)
    expect(page[32] & 0x0f).toBe(0b1100);
    expect(espCrc32(page.subarray(4, 28))).toBe(((page[28] | (page[29] << 8) | (page[30] << 16) | (page[31] << 24)) >>> 0));
  });
  it('throws when a page would hold more than 126 entries', () => {
    expect(() => buildNvsPage({ seq: 1, entries: new Array(127).fill(new Uint8Array(32)) })).toThrow(/126/);
  });
  it('exposes the page state constants', () => {
    expect(PAGE_STATE.ACTIVE).toBe(0xfffffffe);
  });
  it('builds a partition image of whole pages', () => {
    expect(buildNvsPartition([buildNvsPage({ seq: 1, entries: [] }), buildNvsPage({ seq: 2, entries: [] })]).length).toBe(2 * NVS_PAGE_SIZE);
  });
});

// ---------------------------------------------------------------------------------------------
// Partition table editor
// ---------------------------------------------------------------------------------------------

const IDF_CSV = `# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     0x9000,  0x6000,
phy_init, data, phy,     0xf000,  0x1000,
factory,  app,  factory, 0x10000, 1M,
`;

describe('partition CSV (gen_esp32part.py syntax)', () => {
  it('parses the ESP-IDF default layout', () => {
    const { rows, errors } = parseCsv(IDF_CSV);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ name: 'factory', type: TYPE_APP, subtype: 0, offset: 0x10000, size: 0x100000 });
    expect(rows[0]).toMatchObject({ name: 'nvs', type: TYPE_DATA, subtype: 2, offset: 0x9000, size: 0x6000 });
  });

  it('understands K and M size suffixes and numeric types/subtypes', () => {
    expect(parseSizeText('64K')).toBe(0x10000);
    expect(parseSizeText('1M')).toBe(0x100000);
    expect(parseSizeText('0x1000')).toBe(0x1000);
    expect(parseSizeText('')).toBeNull();
    const { rows } = parseCsv('spiffs, 1, 0x82, , 128K,\nota_0, 0, 0x10, , 1M, \n');
    expect(rows[0]).toMatchObject({ type: 1, subtype: 0x82, offset: null, size: 0x20000 });
    expect(rows[1]).toMatchObject({ type: 0, subtype: 0x10 });
  });

  it('reports bad lines with line numbers and keeps the good ones', () => {
    const { rows, errors } = parseCsv('good, data, nvs, 0x9000, 0x6000,\nbad, data, nvs, 0x9000,\nflagged, data, nvs, , 0x1000, weird\n');
    expect(rows).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
    expect(errors[0].message).toMatch(/size/);
    expect(errors[1].message).toMatch(/unknown flag 'weird'/);
  });

  it('parses encrypted and readonly flags', () => {
    const { rows } = parseCsv('nvs, data, nvs, 0x9000, 0x6000, encrypted:readonly\n');
    expect(rows[0]).toMatchObject({ encrypted: true, readonly: true });
  });

  it('resolves blank offsets like gen_esp32part (aligned per type)', () => {
    const { rows } = parseCsv('nvs, data, nvs, , 0x6000,\nphy_init, data, phy, , 0x1000,\nfactory, app, factory, , 1M,\nstorage, data, spiffs, , 64K,\n');
    const r = resolveOffsets(rows);
    expect(r.map((x) => x.offset)).toEqual([0x9000, 0xf000, 0x10000, 0x110000]);
    expect(r[2].autoOffset).toBe(true);
  });

  it('round-trips through toCsv', () => {
    const { rows } = parseCsv(IDF_CSV);
    const again = parseCsv(toCsv(resolveOffsets(rows))).rows;
    expect(again.map(({ name, type, subtype, offset, size }) => ({ name, type, subtype, offset, size }))).toEqual(
      rows.map(({ name, type, subtype, offset, size }) => ({ name, type, subtype, offset, size }))
    );
    expect(toCsv(rows)).toMatch(/factory,app,factory,0x10000,1M,/);
  });
});

describe('partition validation', () => {
  const base = () => resolveOffsets(parseCsv(IDF_CSV).rows);
  const errs = (rows, opts) => validateRows(rows, opts).filter((i) => i.severity === 'error').map((i) => i.message).join('\n');

  it('accepts the ESP-IDF default layout', () => {
    expect(errs(base())).toBe('');
  });

  it('flags overlaps, misalignment and offsets inside the table', () => {
    const rows = base();
    rows[1].offset = 0xe000; // starts inside nvs (0x9000-0xf000)
    expect(errs(rows)).toMatch(/Overlaps "nvs"/);
    const r2 = base();
    r2[2].offset = 0x11000; // app must be 64K aligned
    expect(errs(r2)).toMatch(/not aligned to 0x10000/);
    const r3 = base();
    r3[0].offset = 0x8000;
    expect(errs(r3)).toMatch(/inside the bootloader/);
  });

  it('flags duplicate names, empty names, long names and small writable nvs', () => {
    const rows = base();
    rows[1].name = 'nvs';
    expect(errs(rows)).toMatch(/Duplicate name "nvs"/);
    const r2 = base();
    r2[0].name = 'this_name_is_too_long';
    expect(errs(r2)).toMatch(/longer than 16/);
    const r3 = base();
    r3[0].size = 0x2000;
    expect(errs(r3)).toMatch(/smaller than 0x3000 must be flagged readonly/);
    r3[0].readonly = true;
    expect(errs(r3)).toBe('');
  });

  it('flags app sizes that are not 4K multiples and readonly ota data', () => {
    const rows = base();
    rows[2].size = 0x100001;
    expect(errs(rows)).toMatch(/not a multiple of 0x1000/);
    const r2 = base();
    r2.push({ name: 'otadata', type: TYPE_DATA, subtype: 0x00, offset: 0x300000, size: 0x2000, encrypted: false, readonly: true });
    expect(errs(r2)).toMatch(/always read-write/);
  });

  it('checks the flash size when given', () => {
    expect(errs(base(), { flashSize: 0x100000 })).toMatch(/past the 1 MiB flash/);
    expect(errs(base(), { flashSize: 0x400000 })).toBe('');
  });

  it('limits the table to 95 entries', () => {
    const rows = [];
    for (let i = 0; i < MAX_ENTRIES + 1; i++) rows.push({ name: `p${i}`, type: TYPE_DATA, subtype: 0x06, offset: 0x9000 + i * 0x1000, size: 0x1000, encrypted: false, readonly: false });
    expect(errs(rows)).toMatch(/at most 95/);
  });
});

describe('partition binary and dump patching', () => {
  const rows = resolveOffsets(parseCsv(IDF_CSV + 'otadata, data, ota, , 8K, \n').rows);
  it('builds a 0xC00 table that the existing parser reads back with a valid MD5', () => {
    const bin = buildTableBinary(rows, { flashSize: 0x400000 });
    expect(bin.length).toBe(0xc00);
    const parsed = parsePartitionTable(bin);
    expect(parsed.md5).toEqual({ present: true, valid: true });
    expect(parsed.partitions.map((p) => [p.name, p.offset, p.size])).toEqual(rows.map((r) => [r.name, r.offset, r.size]));
  });

  it('keeps encrypted and readonly flags through the binary', () => {
    const r = resolveOffsets([{ name: 'nvs', type: TYPE_DATA, subtype: 2, offset: 0x9000, size: 0x3000, encrypted: true, readonly: true }]);
    const p = parsePartitionTable(buildTableBinary(r)).partitions[0];
    expect(p).toMatchObject({ encrypted: true, readonly: true });
  });

  it('refuses to build an invalid table', () => {
    const bad = resolveOffsets(parseCsv('a, app, factory, 0x10001, 1M,\n').rows);
    expect(() => buildTableBinary(bad)).toThrow(/aligned/);
  });

  it('patches the table into a full dump at 0x8000 and reads it back', () => {
    const dump = new Uint8Array(0x400000).fill(0xaa);
    const bin = buildTableBinary(rows);
    const out = patchDumpTable(dump, bin);
    expect(out.length).toBe(dump.length);
    expect(out.subarray(0x8000, 0x8000 + 0xc00)).toEqual(bin);
    expect(out.subarray(0x8c00, 0x9000).every((b) => b === 0xff)).toBe(true);
    expect(dump[0x8000]).toBe(0xaa); // input untouched
    expect(out[0x7fff]).toBe(0xaa); // bootloader area untouched
    expect(readDumpTable(out).partitions.map((p) => p.name)).toEqual(rows.map((r) => r.name));
    expect(rowsFromPartitions(readDumpTable(out).partitions)[0]).toMatchObject({ name: 'nvs', offset: 0x9000 });
  });

  it('refuses a dump that is too small to hold a table', () => {
    expect(() => readDumpTable(new Uint8Array(0x8000))).toThrow(/0x9000/);
    expect(() => patchDumpTable(new Uint8Array(0x8000), buildTableBinary(rows))).toThrow(/0x9000/);
  });
});

describe('flash map and image detection', () => {
  it('lists bootloader, table, partitions and gaps in order', () => {
    const rows = resolveOffsets(parseCsv(IDF_CSV).rows);
    const { segments, total } = flashMap(rows, 0x400000);
    expect(segments[0]).toMatchObject({ kind: 'boot', start: 0, end: 0x8000 });
    expect(segments[1]).toMatchObject({ kind: 'table', start: 0x8000, end: 0x9000 });
    expect(segments.find((s) => s.name === 'factory')).toMatchObject({ kind: 'app', start: 0x10000, end: 0x110000 });
    expect(segments[segments.length - 1]).toMatchObject({ kind: 'gap', end: 0x400000 });
    expect(total).toBe(0x400000);
    for (let i = 1; i < segments.length; i++) expect(segments[i].start).toBe(segments[i - 1].end);
  });

  it('detects dumps, bare tables and NVS images', () => {
    const dump = patchDumpTable(new Uint8Array(0x100000).fill(0xff), buildTableBinary(resolveOffsets(parseCsv(IDF_CSV).rows)));
    expect(detectImage(dump)).toBe('dump');
    expect(detectImage(buildTableBinary(resolveOffsets(parseCsv(IDF_CSV).rows)))).toBe('table');
    expect(detectImage(fixtureImage())).toBe('nvs');
    expect(detectImage(new Uint8Array(100))).toBe('unknown');
  });

  it('still parses a table built without MD5 (partitions only)', () => {
    const bin = buildPartitionTable([{ name: 'nvs', type: 1, subtype: 2, offset: 0x9000, size: 0x6000 }], { md5: false });
    expect(parsePartitionTable(bin).md5.present).toBe(false);
  });
});
