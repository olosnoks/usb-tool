import { describe, it, expect } from 'vitest';
import {
  canonicalUuid,
  shortUuid,
  describeUuid,
  companyName,
  bytesToHex,
  parseBatteryLevel,
  parseHeartRate,
  parseAppearance,
  parseUtf8String,
  parseCharacteristicValue,
  parseManufacturerData,
  characteristicCapabilities,
  buildGattTree,
  readCharacteristic
} from '../src/utils/bleDriver';

const dv = (arr) => new DataView(new Uint8Array(arr).buffer);

describe('UUID canonicalization', () => {
  it('expands 16-bit forms (number, hex string, 0x-prefixed) to the base UUID', () => {
    const expected = '0000180d-0000-1000-8000-00805f9b34fb';
    expect(canonicalUuid(0x180d)).toBe(expected);
    expect(canonicalUuid('180d')).toBe(expected);
    expect(canonicalUuid('0x180D')).toBe(expected);
  });

  it('passes a full 128-bit UUID through lowercased', () => {
    const u = '12345678-1234-5678-1234-56789abcdef0';
    expect(canonicalUuid(u.toUpperCase())).toBe(u);
  });

  it('recovers the 16-bit value only for base-range UUIDs', () => {
    expect(shortUuid(0x180f)).toBe(0x180f);
    expect(shortUuid('12345678-1234-5678-1234-56789abcdef0')).toBeNull();
  });
});

describe('Assigned-number lookups', () => {
  it('names known services and characteristics', () => {
    expect(describeUuid(0x180d, 'service')).toMatchObject({ name: 'Heart Rate', assigned: true });
    expect(describeUuid(0x2a19)).toMatchObject({ name: 'Battery Level', assigned: true });
  });

  it('marks vendor-specific UUIDs as unassigned', () => {
    const r = describeUuid('12345678-1234-5678-1234-56789abcdef0', 'service');
    expect(r.assigned).toBe(false);
  });

  it('resolves company identifiers', () => {
    expect(companyName(0x004c)).toBe('Apple, Inc.');
    expect(companyName(0x0059)).toBe('Nordic Semiconductor ASA');
    expect(companyName(0x9999)).toMatch(/Unknown/);
  });
});

describe('Standard characteristic parsers', () => {
  it('battery level as a percentage', () => {
    expect(parseBatteryLevel(dv([87])).value).toBe(87);
  });

  it('heart rate with 8-bit and 16-bit flag', () => {
    expect(parseHeartRate(dv([0x00, 72])).value).toBe(72); // 8-bit
    expect(parseHeartRate(dv([0x01, 0x2c, 0x01])).value).toBe(300); // 16-bit LE
  });

  it('appearance as a uint16', () => {
    expect(parseAppearance(dv([0xc0, 0x03])).value).toBe(0x03c0);
  });

  it('utf-8 device info strings', () => {
    const bytes = Array.from(new TextEncoder().encode('nRF52-DK'));
    expect(parseUtf8String(dv(bytes)).text).toBe('nRF52-DK');
  });
});

describe('parseCharacteristicValue dispatch', () => {
  it('decodes a known characteristic and always provides hex', () => {
    const r = parseCharacteristicValue(0x2a19, dv([0x64]));
    expect(r.decoded.text).toBe('100%');
    expect(r.hex).toBe('64');
    expect(r.byteLength).toBe(1);
  });

  it('leaves vendor characteristics undecoded but hex-rendered', () => {
    const r = parseCharacteristicValue('12345678-1234-5678-1234-56789abcdef0', dv([0xde, 0xad]));
    expect(r.decoded).toBeNull();
    expect(r.hex).toBe('de ad');
  });
});

describe('Manufacturer data + helpers', () => {
  it('decodes a manufacturer-data entry', () => {
    const r = parseManufacturerData(0x004c, dv([0x02, 0x15, 0xaa]));
    expect(r.company).toBe('Apple, Inc.');
    expect(r.hex).toBe('02 15 aa');
  });

  it('bytesToHex handles Uint8Array, DataView and ArrayBuffer', () => {
    expect(bytesToHex(new Uint8Array([1, 255]))).toBe('01 ff');
    expect(bytesToHex(dv([0, 16]))).toBe('00 10');
  });

  it('characteristicCapabilities coerces to booleans', () => {
    const caps = characteristicCapabilities({ read: true, notify: 1, write: undefined });
    expect(caps).toMatchObject({ read: true, notify: true, write: false });
  });
});

/**
 * Fake GATT server matching the slice of the Web Bluetooth interface that
 * buildGattTree/readCharacteristic touch — no radio required.
 */
function makeFakeServer() {
  const batteryChar = {
    uuid: '00002a19-0000-1000-8000-00805f9b34fb',
    properties: { read: true, notify: true },
    readValue: () => Promise.resolve(dv([0x5a]))
  };
  const batteryService = {
    uuid: '0000180f-0000-1000-8000-00805f9b34fb',
    getCharacteristics: () => Promise.resolve([batteryChar])
  };
  const vendorService = {
    uuid: '12345678-1234-5678-1234-56789abcdef0',
    getCharacteristics: () =>
      Promise.resolve([
        {
          uuid: '87654321-1234-5678-1234-56789abcdef0',
          properties: { write: true },
          readValue: () => Promise.resolve(dv([0x00]))
        }
      ])
  };
  return {
    getPrimaryServices: () => Promise.resolve([batteryService, vendorService]),
    _batteryChar: batteryChar
  };
}

describe('buildGattTree', () => {
  it('walks services + characteristics into a named, serializable tree', async () => {
    const server = makeFakeServer();
    const tree = await buildGattTree(server);

    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe('Battery');
    expect(tree[0].assigned).toBe(true);
    expect(tree[0].characteristics[0].name).toBe('Battery Level');
    expect(tree[0].characteristics[0].properties).toMatchObject({ read: true, notify: true });

    // Vendor service stays unassigned.
    expect(tree[1].assigned).toBe(false);
    expect(tree[1].characteristics[0].properties.write).toBe(true);
  });

  it('readCharacteristic reads + parses a handle', async () => {
    const server = makeFakeServer();
    const r = await readCharacteristic(server._batteryChar);
    expect(r.decoded.text).toBe('90%'); // 0x5a = 90
  });
});
