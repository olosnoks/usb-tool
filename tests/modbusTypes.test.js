import { describe, it, expect } from 'vitest';
import {
  decodeValue, encodeValue, applyScale, buildRegisterRows, parseRegisterMap, serializeRegisterMap,
  EXAMPLE_SOLAR_INVERTER_MAP, typeWordCount, modiconNumber, pollLogToCsv, READ_TABLES
} from '../src/utils/modbusTypes';

describe('modbus data types and word order', () => {
  it('decodes float32 from known vectors in every order', () => {
    // 123.456f = 0x42F6E979
    expect(decodeValue([0x42F6, 0xE979], 'f32', 'ABCD')).toBeCloseTo(123.456, 3);
    expect(decodeValue([0xE979, 0x42F6], 'f32', 'CDAB')).toBeCloseTo(123.456, 3);
    expect(decodeValue([0xF642, 0x79E9], 'f32', 'BADC')).toBeCloseTo(123.456, 3);
    expect(decodeValue([0x79E9, 0xF642], 'f32', 'DCBA')).toBeCloseTo(123.456, 3);
  });
  it('decodes 16/32-bit integers', () => {
    expect(decodeValue([0xFFFF], 'i16')).toBe(-1);
    expect(decodeValue([0xFFFF], 'u16')).toBe(65535);
    expect(decodeValue([0x0001, 0x0000], 'u32', 'ABCD')).toBe(65536);
    expect(decodeValue([0x0000, 0x0001], 'u32', 'CDAB')).toBe(65536);
    expect(decodeValue([0xFFFF, 0xFFFE], 'i32', 'ABCD')).toBe(-2);
  });
  it('decodes float64 and ascii', () => {
    const w = encodeValue(Math.PI, 'f64', 'ABCD');
    expect(w).toHaveLength(4);
    expect(decodeValue(w, 'f64', 'ABCD')).toBe(Math.PI);
    expect(decodeValue([0x4142, 0x4300], 'ascii')).toBe('ABC');
  });
  it('round-trips encode/decode for each order', () => {
    for (const order of ['ABCD', 'CDAB', 'BADC', 'DCBA']) {
      expect(decodeValue(encodeValue(-12345, 'i32', order), 'i32', order)).toBe(-12345);
      expect(decodeValue(encodeValue(1.5, 'f32', order), 'f32', order)).toBe(1.5);
    }
  });
  it('returns null when too few words are given', () => {
    expect(decodeValue([1], 'f32')).toBeNull();
    expect(typeWordCount('f64')).toBe(4);
  });
  it('applies scale and offset', () => {
    expect(applyScale(2300, 0.1, 0)).toBeCloseTo(230);
    expect(applyScale(10, 2, 5)).toBe(25);
  });
});

describe('generic register rows (B8)', () => {
  it('shows generic labels and no scaling or units without a map', () => {
    const rows = buildRegisterRows(0, [2300, 55, 1000], null);
    expect(rows.map((r) => r.label)).toEqual(['Register 0', 'Register 1', 'Register 2']);
    expect(rows.every((r) => r.unit === '' && r.mapped === false)).toBe(true);
    expect(rows[0].display).toBe('2300');
    expect(JSON.stringify(rows)).not.toMatch(/Grid|Inverter|kWh|Yield/);
  });
  it('applies a user map, including multi-register types', () => {
    const map = { ranges: [{ start: 10, type: 'f32', wordOrder: 'CDAB', unit: 'V', label: 'Voltage' }] };
    const rows = buildRegisterRows(10, [0xE979, 0x42F6, 7], map);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ address: 10, label: 'Voltage', unit: 'V', mapped: true });
    expect(rows[0].value).toBeCloseTo(123.456, 3);
    expect(rows[1]).toMatchObject({ address: 12, label: 'Register 12' });
  });
  it('falls back to uint16 when a mapped type is cut off by the read window', () => {
    const rows = buildRegisterRows(0, [1], { ranges: [{ start: 0, type: 'u32' }] });
    expect(rows[0]).toMatchObject({ mapped: false, label: 'Register 0' });
  });
  it('the solar example map is opt-in and scales as documented', () => {
    const rows = buildRegisterRows(0, [2300, 55], EXAMPLE_SOLAR_INVERTER_MAP);
    expect(rows[0].display).toBe('230 V');
    expect(rows[1].display).toBe('5.5 A');
  });
});

describe('register map import/export', () => {
  it('round-trips and validates', () => {
    const m = parseRegisterMap(serializeRegisterMap(EXAMPLE_SOLAR_INVERTER_MAP));
    expect(m.ranges).toHaveLength(8);
    expect(() => parseRegisterMap('{bad')).toThrow(/Invalid JSON/);
    expect(() => parseRegisterMap('{"ranges":[{"start":0,"type":"u128"}]}')).toThrow(/data type/);
    expect(() => parseRegisterMap('{}')).toThrow(/ranges/);
  });
});

describe('tables and csv', () => {
  it('maps tables to function codes and limits', () => {
    expect(READ_TABLES.holding).toMatchObject({ fc: 3, max: 125 });
    expect(READ_TABLES.coils).toMatchObject({ fc: 1, max: 2000 });
    expect(READ_TABLES.input.fc).toBe(4);
    expect(READ_TABLES.discrete.fc).toBe(2);
    expect(modiconNumber('holding', 0)).toBe(40001);
    expect(modiconNumber('input', 5)).toBe(30006);
  });
  it('escapes csv cells', () => {
    const csv = pollLogToCsv([{ t: 't', slaveId: 1, fc: 3, address: 0, label: 'a,"b"', value: 1, unit: '', hex: '0x0001' }]);
    expect(csv.split('\n')[1]).toContain('"a,""b"""');
  });
});
