import { describe, it, expect } from 'vitest';
import { parsePartitionTable, buildPartitionTable, partitionTableExtent } from '../src/utils/espPartitions';

const APP = 0, DATA = 1;
// Arduino-ESP32 default.csv
const ARDUINO_DEFAULT = [
  { name: 'nvs', type: DATA, subtype: 0x02, offset: 0x9000, size: 0x5000 },
  { name: 'otadata', type: DATA, subtype: 0x00, offset: 0xe000, size: 0x2000 },
  { name: 'app0', type: APP, subtype: 0x10, offset: 0x10000, size: 0x140000 },
  { name: 'app1', type: APP, subtype: 0x11, offset: 0x150000, size: 0x140000 },
  { name: 'spiffs', type: DATA, subtype: 0x82, offset: 0x290000, size: 0x160000 },
  { name: 'coredump', type: DATA, subtype: 0x03, offset: 0x3f0000, size: 0x10000 }
];

describe('parsePartitionTable', () => {
  it('parses the default Arduino-ESP32 table and validates the MD5 entry', () => {
    const t = parsePartitionTable(buildPartitionTable(ARDUINO_DEFAULT));
    expect(t.partitions.map((p) => p.name)).toEqual(['nvs', 'otadata', 'app0', 'app1', 'spiffs', 'coredump']);
    expect(t.partitions[2]).toMatchObject({ typeName: 'app', subtypeName: 'ota_0', offset: 0x10000, size: 0x140000 });
    expect(t.partitions[4].subtypeName).toBe('spiffs');
    expect(t.md5).toEqual({ present: true, valid: true });
    expect(t.warnings).toEqual([]);
    expect(partitionTableExtent(t.partitions)).toBe(0x400000);
  });

  it('parses an IDF factory + ota table with flags', () => {
    const t = parsePartitionTable(buildPartitionTable([
      { name: 'nvs', type: DATA, subtype: 0x02, offset: 0x9000, size: 0x6000 },
      { name: 'phy_init', type: DATA, subtype: 0x01, offset: 0xf000, size: 0x1000 },
      { name: 'factory', type: APP, subtype: 0x00, offset: 0x10000, size: 0x100000, flags: 1 },
      { name: 'ota_0', type: APP, subtype: 0x10, offset: 0x110000, size: 0x100000, flags: 2 }
    ]));
    expect(t.partitions[2]).toMatchObject({ subtypeName: 'factory', encrypted: true, readonly: false });
    expect(t.partitions[3]).toMatchObject({ subtypeName: 'ota_0', encrypted: false, readonly: true });
    expect(t.md5.valid).toBe(true);
  });

  it('accepts a table without an MD5 entry', () => {
    const t = parsePartitionTable(buildPartitionTable(ARDUINO_DEFAULT, { md5: false }));
    expect(t.md5).toEqual({ present: false, valid: null });
    expect(t.partitions).toHaveLength(6);
  });

  it('flags a corrupted table through the MD5 entry', () => {
    const bytes = buildPartitionTable(ARDUINO_DEFAULT);
    bytes[4] ^= 0x10; // change the nvs offset after the MD5 was computed
    const t = parsePartitionTable(bytes);
    expect(t.md5.valid).toBe(false);
    expect(t.warnings.join(' ')).toMatch(/MD5/);
  });

  it('gives a clear error for garbage, erased flash and truncated data', () => {
    expect(() => parsePartitionTable(new Uint8Array(4096).fill(0x41))).toThrow(/bad entry magic/);
    expect(() => parsePartitionTable(new Uint8Array(4096).fill(0xff))).toThrow(/No partition entries/);
    expect(() => parsePartitionTable(new Uint8Array(10))).toThrow(/truncated/);
    expect(() => parsePartitionTable(undefined)).toThrow(/truncated/);
  });

  it('warns when the table is cut off without a terminator', () => {
    const full = buildPartitionTable(ARDUINO_DEFAULT, { md5: false });
    const t = parsePartitionTable(full.subarray(0, 64));
    expect(t.partitions).toHaveLength(2);
    expect(t.warnings.join(' ')).toMatch(/truncated/);
  });
});
