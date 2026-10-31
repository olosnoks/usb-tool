import { describe, it, expect } from 'vitest';
import { parseCharacteristicValue, describeUuid, readAllValues, buildGattTree, STANDARD_SERVICE_UUIDS } from '../src/utils/bleDriver';
import { applyPresentationFormat, ieee11073Float } from '../src/utils/bleAssigned';
import { normalizeServiceInput, buildOptionalServices } from '../src/components/tools/BleExplorer';

const dv = (bytes) => new DataView(new Uint8Array(bytes).buffer);
const decode = (short, bytes) => parseCharacteristicValue(short, dv(bytes)).decoded;

describe('Standard characteristic decoders', () => {
  it('reads environmental sensing values', () => {
    expect(decode(0x2a6e, [0x2a, 0x09]).text).toBe('23.46 °C');   // 2346 * 0.01
    expect(decode(0x2a6f, [0x88, 0x13]).text).toBe('50.00 %');    // 5000 * 0.01
    expect(decode(0x2a6d, [0x08, 0x75, 0x0f, 0x00]).text).toBe('1013.0 hPa'); // 1013000 * 0.1 Pa
  });

  it('reads device information records', () => {
    expect(decode(0x2a50, [0x02, 0x3a, 0x30, 0x01, 0x10, 0x23, 0x01]).text)
      .toBe('USB vendor 0x303a, product 0x1001, version 1.2.3');
    expect(decode(0x2a07, [0xf8]).text).toBe('-8 dBm');
    expect(decode(0x2a04, [0x18, 0x00, 0x28, 0x00, 0x00, 0x00, 0x90, 0x01]).text)
      .toBe('interval 30–50 ms, latency 0, timeout 4000 ms');
    expect(decode(0x2a01, [0xc1, 0x03]).text).toMatch(/Human Interface Device/);
  });

  it('reads IEEE-11073 temperatures', () => {
    // mantissa 3650, exponent -2 => 36.5
    expect(ieee11073Float(dv([0x42, 0x0e, 0x00, 0xfe]))).toBe(36.5);
    expect(decode(0x2a1c, [0x00, 0x42, 0x0e, 0x00, 0xfe]).text).toBe('36.5 °C');
  });
});

describe('Assigned names', () => {
  it('covers the full SIG service range and known vendor services', () => {
    expect(describeUuid(0x1822, 'service').name).toBe('Pulse Oximeter');
    expect(describeUuid('6e400001-b5a3-f393-e0a9-e50e24dcca9e', 'service')).toMatchObject({ name: 'Nordic UART Service (NUS)', vendor: true });
    expect(STANDARD_SERVICE_UUIDS).toContain(0x1800);
    expect(STANDARD_SERVICE_UUIDS).toContain(0x1859);
  });
});

describe('Characteristic Presentation Format (0x2904)', () => {
  it('scales by the exponent and adds the unit', () => {
    // sint16, exponent -2, unit °C
    expect(applyPresentationFormat(dv([0x2a, 0x09]), dv([0x0e, 0xfe, 0x2f, 0x27, 0x01, 0x00, 0x00])).text).toBe('23.46 °C');
    // uint8 percent
    expect(applyPresentationFormat(dv([0x4b]), dv([0x04, 0x00, 0xad, 0x27, 0x01, 0x00, 0x00])).text).toBe('75 %');
    // utf8
    expect(applyPresentationFormat(dv([0x68, 0x69]), dv([0x19, 0, 0, 0x27, 0, 0, 0])).text).toBe('hi');
  });

  it('is applied automatically when reading a vendor characteristic', async () => {
    const value = dv([0x2a, 0x09]);
    const fmt = dv([0x0e, 0xfe, 0x2f, 0x27, 0x01, 0x00, 0x00]);
    const ch = {
      uuid: 'abcd0001-0000-1000-8000-000000000001',
      properties: { read: true },
      readValue: async () => value,
      getDescriptors: async () => [{ uuid: 0x2904, readValue: async () => fmt }]
    };
    const server = { getPrimaryServices: async () => [{ uuid: 'abcd0000-0000-1000-8000-000000000001', getCharacteristics: async () => [ch] }] };
    const tree = await buildGattTree(server);
    const all = await readAllValues(tree);
    const v = all[ch.uuid];
    expect(v.decoded.text).toBe('23.46 °C');
    expect(v.hex).toBe('2a 09');                       // raw bytes still shown
    expect(all[`${ch.uuid}/${tree[0].characteristics[0].descriptors[0].uuid}`].text).toMatch(/exponent -2/);
  });
});

describe('Explorer service list', () => {
  it('accepts short and full UUIDs and rejects junk', () => {
    expect(normalizeServiceInput('FFE0')).toBe('0000ffe0-0000-1000-8000-00805f9b34fb');
    expect(normalizeServiceInput('0x180D')).toBe('0000180d-0000-1000-8000-00805f9b34fb');
    expect(normalizeServiceInput('6E400001-B5A3-F393-E0A9-E50E24DCCA9E')).toBe('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    expect(normalizeServiceInput('hello')).toBeNull();
    expect(normalizeServiceInput('')).toBeNull();
  });

  it('requests every SIG service, the UART profiles and custom UUIDs once each', () => {
    const custom = 'deadbeef-0000-1000-8000-00805f9b34fb';
    const list = buildOptionalServices([custom]);
    expect(list).toContain('0000180f-0000-1000-8000-00805f9b34fb');
    expect(list).toContain('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    expect(list).toContain('8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000');
    expect(list).toContain(custom);
    expect(new Set(list).size).toBe(list.length);
  });
});
