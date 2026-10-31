/**
 * bleDriver.js — Web Bluetooth LE GATT client helpers.
 *
 * The "pure driver" half of the driver + workbench pattern for Bluetooth Low
 * Energy. It owns three things, all independent of React and of the live
 * `navigator.bluetooth` object so they stay unit-testable:
 *
 *   1. UUID canonicalization + a curated Bluetooth SIG assigned-numbers table
 *      (services / characteristics) and a company-identifier table, so raw
 *      16-bit UUIDs and manufacturer IDs render as human names.
 *   2. Parsers for the common standard characteristics (Battery Level, Heart
 *      Rate Measurement, Device Information strings, Appearance) plus a
 *      manufacturer-data decoder for advertisements.
 *   3. Thin async wrappers that walk a GATT server into a serializable tree and
 *      read/parse a characteristic — these take any object shaped like the Web
 *      Bluetooth GATT interfaces, so a fake stands in for hardware in tests.
 *
 * NOTE: Web Bluetooth is a GATT *client*. It connects only to a user-chosen
 * device; it cannot passively sniff arbitrary advertisements. This module is
 * scoped to that reality.
 */

// ---------------------------------------------------------------------------
// UUID handling
// ---------------------------------------------------------------------------

// The Bluetooth Base UUID: 16-/32-bit UUIDs expand into this template.
const BASE_UUID_SUFFIX = '-0000-1000-8000-00805f9b34fb';

/**
 * Normalize any UUID form (number, "0x180d", "180d", or a full 128-bit string)
 * to a lowercase canonical 128-bit UUID string.
 */
export function canonicalUuid(input) {
  if (typeof input === 'number') {
    return `${input.toString(16).padStart(8, '0')}${BASE_UUID_SUFFIX}`.toLowerCase();
  }
  let s = String(input).trim().toLowerCase();
  if (s.startsWith('0x')) s = s.slice(2);
  if (/^[0-9a-f]{1,8}$/.test(s)) {
    return `${s.padStart(8, '0')}${BASE_UUID_SUFFIX}`;
  }
  return s;
}

/**
 * If a 128-bit UUID is really an assigned 16-bit UUID in the SIG base range,
 * return that 16-bit value (number); otherwise null.
 */
export function shortUuid(input) {
  const c = canonicalUuid(input);
  if (c.endsWith(BASE_UUID_SUFFIX) && c.slice(0, 4) === '0000') {
    return parseInt(c.slice(4, 8), 16);
  }
  return null;
}

// Curated subset of SIG assigned numbers — the services/characteristics a user
// actually meets on consumer and dev-board peripherals. Keyed by 16-bit value.
export const GATT_SERVICE_NAMES = {
  0x1800: 'Generic Access',
  0x1801: 'Generic Attribute',
  0x1802: 'Immediate Alert',
  0x1803: 'Link Loss',
  0x1804: 'Tx Power',
  0x1805: 'Current Time',
  0x180a: 'Device Information',
  0x180d: 'Heart Rate',
  0x180f: 'Battery',
  0x1810: 'Blood Pressure',
  0x1811: 'Alert Notification',
  0x1812: 'Human Interface Device',
  0x1816: 'Cycling Speed and Cadence',
  0x1818: 'Cycling Power',
  0x181a: 'Environmental Sensing',
  0x181b: 'Body Composition',
  0x181c: 'User Data',
  0x181d: 'Weight Scale',
  0x1826: 'Fitness Machine',
  0x183b: 'Binary Sensor',
  0x1843: 'Audio Input Control',
  0xfe59: 'Nordic DFU (Secure)',
  0xfd6f: 'Exposure Notification'
};

export const GATT_CHARACTERISTIC_NAMES = {
  0x2a00: 'Device Name',
  0x2a01: 'Appearance',
  0x2a04: 'Peripheral Preferred Connection Parameters',
  0x2a05: 'Service Changed',
  0x2a19: 'Battery Level',
  0x2a23: 'System ID',
  0x2a24: 'Model Number String',
  0x2a25: 'Serial Number String',
  0x2a26: 'Firmware Revision String',
  0x2a27: 'Hardware Revision String',
  0x2a28: 'Software Revision String',
  0x2a29: 'Manufacturer Name String',
  0x2a37: 'Heart Rate Measurement',
  0x2a38: 'Body Sensor Location',
  0x2a39: 'Heart Rate Control Point',
  0x2a6d: 'Pressure',
  0x2a6e: 'Temperature',
  0x2a6f: 'Humidity'
};

// A handful of the most common company identifiers (BLE manufacturer data).
export const COMPANY_IDENTIFIERS = {
  0x004c: 'Apple, Inc.',
  0x0006: 'Microsoft',
  0x00e0: 'Google',
  0x0075: 'Samsung Electronics',
  0x0059: 'Nordic Semiconductor ASA',
  0x0499: 'Ruuvi Innovations',
  0x0157: 'Anhui Huami (Xiaomi/Amazfit)',
  0x0171: 'Amazon',
  0x0001: 'Nokia Mobile Phones',
  0x02e5: 'Espressif Incorporated',
  0x0300: 'Shenzhen'
};

export function describeUuid(uuid, kind = 'characteristic') {
  const short = shortUuid(uuid);
  const table = kind === 'service' ? GATT_SERVICE_NAMES : GATT_CHARACTERISTIC_NAMES;
  if (short != null && table[short]) {
    return { name: table[short], short, assigned: true };
  }
  return {
    name: short != null ? `Unknown (0x${short.toString(16)})` : 'Vendor-specific',
    short,
    assigned: false
  };
}

export function companyName(id) {
  return COMPANY_IDENTIFIERS[id] ?? `Unknown (0x${id.toString(16).padStart(4, '0')})`;
}

// ---------------------------------------------------------------------------
// Low-level byte helpers
// ---------------------------------------------------------------------------

export function toDataView(input) {
  if (input instanceof DataView) return input;
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  return new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
}

export function bytesToHex(input, sep = ' ') {
  const u8 =
    input instanceof DataView
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(sep);
}

const utf8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

// ---------------------------------------------------------------------------
// Standard characteristic value parsers
// ---------------------------------------------------------------------------

/** Battery Level (0x2A19): single uint8 percentage. */
export function parseBatteryLevel(value) {
  const dv = toDataView(value);
  const pct = dv.getUint8(0);
  return { label: 'Battery', text: `${pct}%`, value: pct };
}

/** Heart Rate Measurement (0x2A37): flags byte + 8/16-bit BPM + optional fields. */
export function parseHeartRate(value) {
  const dv = toDataView(value);
  const flags = dv.getUint8(0);
  const is16 = (flags & 0x01) !== 0;
  const bpm = is16 ? dv.getUint16(1, true) : dv.getUint8(1);
  return { label: 'Heart Rate', text: `${bpm} bpm`, value: bpm, flags };
}

/** Appearance (0x2A01): uint16 category code. */
export function parseAppearance(value) {
  const dv = toDataView(value);
  const code = dv.getUint16(0, true);
  return { label: 'Appearance', text: `0x${code.toString(16)}`, value: code };
}

/** Any of the Device Information string characteristics: UTF-8 text. */
export function parseUtf8String(value) {
  const dv = toDataView(value);
  const u8 = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  const text = utf8Decoder ? utf8Decoder.decode(u8) : String.fromCharCode(...u8);
  return { label: 'String', text, value: text };
}

// Map short UUID -> parser for the characteristics we can interpret.
const VALUE_PARSERS = {
  0x2a19: parseBatteryLevel,
  0x2a37: parseHeartRate,
  0x2a01: parseAppearance,
  0x2a00: parseUtf8String,
  0x2a24: parseUtf8String,
  0x2a25: parseUtf8String,
  0x2a26: parseUtf8String,
  0x2a27: parseUtf8String,
  0x2a28: parseUtf8String,
  0x2a29: parseUtf8String
};

/**
 * Interpret a characteristic's raw value. Returns a decoded object when the
 * UUID is a known standard characteristic, always alongside a hex rendering.
 */
export function parseCharacteristicValue(uuid, value) {
  const dv = toDataView(value);
  const hex = bytesToHex(dv);
  const short = shortUuid(uuid);
  const parser = short != null ? VALUE_PARSERS[short] : null;
  let decoded = null;
  if (parser) {
    try {
      decoded = parser(dv);
    } catch {
      decoded = null;
    }
  }
  return { hex, byteLength: dv.byteLength, decoded };
}

/**
 * Decode a BLE advertisement's manufacturer-specific data entry.
 * @param {number} companyId  16-bit company identifier.
 * @param {DataView|Uint8Array} data  The vendor payload after the company id.
 */
export function parseManufacturerData(companyId, data) {
  return {
    companyId,
    company: companyName(companyId),
    hex: bytesToHex(data),
    byteLength: toDataView(data).byteLength
  };
}

// ---------------------------------------------------------------------------
// GATT property flags -> a compact capability object
// ---------------------------------------------------------------------------

export function characteristicCapabilities(props = {}) {
  return {
    read: Boolean(props.read),
    write: Boolean(props.write),
    writeWithoutResponse: Boolean(props.writeWithoutResponse),
    notify: Boolean(props.notify),
    indicate: Boolean(props.indicate)
  };
}

// ---------------------------------------------------------------------------
// GATT tree walker (works against the real Web Bluetooth GATT server or a fake)
// ---------------------------------------------------------------------------

/**
 * Walk a connected GATT server into a serializable tree of services and their
 * characteristics. `server` must expose `getPrimaryServices()`, each service
 * `getCharacteristics()` + `uuid`, and each characteristic `uuid` + `properties`.
 */
export async function buildGattTree(server) {
  const services = await server.getPrimaryServices();
  const tree = [];
  for (const service of services) {
    const info = describeUuid(service.uuid, 'service');
    const characteristics = await service.getCharacteristics();
    const chars = characteristics.map((ch) => {
      const cinfo = describeUuid(ch.uuid, 'characteristic');
      return {
        uuid: canonicalUuid(ch.uuid),
        name: cinfo.name,
        short: cinfo.short,
        assigned: cinfo.assigned,
        properties: characteristicCapabilities(ch.properties),
        _ref: ch // live handle, not serialized into UI state
      };
    });
    tree.push({
      uuid: canonicalUuid(service.uuid),
      name: info.name,
      short: info.short,
      assigned: info.assigned,
      characteristics: chars,
      _ref: service
    });
  }
  return tree;
}

/**
 * Read one characteristic handle and return its parsed value.
 * `characteristic` must expose `uuid` and `readValue(): Promise<DataView>`.
 */
export async function readCharacteristic(characteristic) {
  const value = await characteristic.readValue();
  return parseCharacteristicValue(characteristic.uuid, value);
}
