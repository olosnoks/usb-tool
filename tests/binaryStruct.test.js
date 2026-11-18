import { describe, it, expect } from 'vitest';
import { parseTemplate, decodeStruct, inspectBytes, findBytes, STRUCT_EXAMPLE, STRUCT_EXAMPLE_HEX } from '../src/utils/binaryStruct.js';

const hex = (s) => new Uint8Array(s.split(/\s+/).map((h) => parseInt(h, 16)));

describe('struct template', () => {
  it('decodes the example', () => {
    const t = parseTemplate(STRUCT_EXAMPLE);
    expect(t.errors).toEqual([]);
    const r = decodeStruct(hex(STRUCT_EXAMPLE_HEX), t.fields);
    expect(r.error).toBeNull();
    const by = Object.fromEntries(r.rows.map((x) => [x.name, x]));
    expect(by.magic.value).toBe('"MYHD"');
    expect(by.version.value).toBe('2');
    expect(by.flags.value).toBe('0x8005');
    expect(by.values.value).toBe('[10, 20, 30]');
    expect(by.values.offset).toBe(10);
    expect(by.tail.value).toBe('ff');
  });
  it('honours endianness and 64-bit values', () => {
    const t = parseTemplate('a: u32be\nb: i64le');
    const r = decodeStruct(hex('00 00 01 00 ff ff ff ff ff ff ff ff'), t.fields);
    expect(r.rows[0].value).toBe('256');
    expect(r.rows[1].value).toBe('-1');
  });
  it('reports bad syntax and truncation', () => {
    expect(parseTemplate('x: nope').errors[0]).toMatch(/unknown type/);
    expect(parseTemplate('x: u8[y]').errors[0]).toMatch(/earlier numeric field/);
    const r = decodeStruct(hex('01'), parseTemplate('a: u32').fields);
    expect(r.error).toMatch(/only 1 left/);
  });
  it('reads cstr', () => {
    const r = decodeStruct(hex('68 69 00 07'), parseTemplate('s: cstr\nn: u8').fields);
    expect(r.rows[0].value).toBe('"hi"');
    expect(r.rows[1].value).toBe('7');
  });
});

describe('inspector and search', () => {
  it('inspects both byte orders', () => {
    const le = inspectBytes(hex('01 02 03 04'), 0, true);
    const be = inspectBytes(hex('01 02 03 04'), 0, false);
    expect(le.find((x) => x.label === 'u32').value).toBe('67305985');
    expect(be.find((x) => x.label === 'u32').value).toBe('16909060');
    expect(le.find((x) => x.label === 'u24').value).toBe('197121');
  });
  it('finds hex with wildcards and text', () => {
    const b = hex('de ad be ef 00 de ad 00');
    expect(findBytes(b, 'de ad')).toEqual([0, 5]);
    expect(findBytes(b, 'de ?? be')).toEqual([0]);
    expect(findBytes(new TextEncoder().encode('xxabxab'), 'ab', 'text')).toEqual([2, 5]);
    expect(() => findBytes(b, 'zz')).toThrow();
  });
});
