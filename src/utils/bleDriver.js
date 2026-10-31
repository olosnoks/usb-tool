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

import {
  SIG_SERVICE_NAMES, SIG_CHARACTERISTIC_NAMES, VENDOR_SERVICES, VENDOR_CHARACTERISTICS,
  EXTRA_PARSERS, applyPresentationFormat
} from './bleAssigned.js';

export { STANDARD_SERVICE_UUIDS, VENDOR_SERVICES } from './bleAssigned.js';

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

// Names come from the Bluetooth SIG assigned-numbers tables in bleAssigned.js.
export const GATT_SERVICE_NAMES = SIG_SERVICE_NAMES;
export const GATT_CHARACTERISTIC_NAMES = SIG_CHARACTERISTIC_NAMES;

// GATT descriptor names (assigned numbers 0x29xx).
export const GATT_DESCRIPTOR_NAMES = {
  0x2900: 'Characteristic Extended Properties',
  0x2901: 'Characteristic User Description',
  0x2902: 'Client Characteristic Configuration',
  0x2903: 'Server Characteristic Configuration',
  0x2904: 'Characteristic Presentation Format',
  0x2905: 'Characteristic Aggregate Format',
  0x2906: 'Valid Range',
  0x2907: 'External Report Reference',
  0x2908: 'Report Reference'
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
  const vendorName = (kind === 'service' ? VENDOR_SERVICES : VENDOR_CHARACTERISTICS)[canonicalUuid(uuid)];
  if (vendorName) return { name: vendorName, short, assigned: false, vendor: true };
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
  ...EXTRA_PARSERS,
  0x2a19: parseBatteryLevel,
  0x2a37: parseHeartRate,
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
export function parseCharacteristicValue(uuid, value, presentationFormat = null) {
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
  let formatted = null;
  if (presentationFormat) {
    try { formatted = applyPresentationFormat(dv, toDataView(presentationFormat)); } catch { formatted = null; }
  }
  return { hex, byteLength: dv.byteLength, decoded: decoded || formatted, formatted, ascii: asciiPreview(dv), numbers: numericViews(dv) };
}

/** Bytes as text: printable ASCII kept, everything else shown as '.'. */
export function asciiPreview(value) {
  const dv = toDataView(value);
  let out = '';
  for (let i = 0; i < dv.byteLength; i++) {
    const b = dv.getUint8(i);
    out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
  }
  return out;
}

/**
 * The value read as little-endian integers / floats, for values of 1, 2, 4 or
 * 8 bytes (BLE characteristics are little-endian). Empty for other sizes.
 */
export function numericViews(value) {
  const dv = toDataView(value);
  const n = dv.byteLength;
  const out = [];
  if (n === 1) out.push(['uint8', dv.getUint8(0)], ['int8', dv.getInt8(0)]);
  if (n === 2) out.push(['uint16', dv.getUint16(0, true)], ['int16', dv.getInt16(0, true)]);
  if (n === 4) {
    out.push(['uint32', dv.getUint32(0, true)], ['int32', dv.getInt32(0, true)]);
    const f = dv.getFloat32(0, true);
    // Skip denormal noise (small integers read as floats come out ~1e-41).
    if (Number.isFinite(f) && (f === 0 || Math.abs(f) >= 1e-6)) out.push(['float32', Number(f.toPrecision(7))]);
  }
  if (n === 8) {
    out.push(['uint64', dv.getBigUint64(0, true).toString()], ['int64', dv.getBigInt64(0, true).toString()]);
    const f = dv.getFloat64(0, true);
    if (Number.isFinite(f) && (f === 0 || Math.abs(f) >= 1e-6)) out.push(['float64', f]);
  }
  return out;
}

/** Decode a descriptor value we understand (user description, CCCD). */
export function parseDescriptorValue(uuid, value) {
  const dv = toDataView(value);
  const short = shortUuid(uuid);
  const base = { hex: bytesToHex(dv), byteLength: dv.byteLength, ascii: asciiPreview(dv) };
  if (short === 0x2901) return { ...base, text: parseUtf8String(dv).text };
  if (short === 0x2902 && dv.byteLength >= 2) {
    const v = dv.getUint16(0, true);
    const on = [v & 1 ? 'notifications' : null, v & 2 ? 'indications' : null].filter(Boolean);
    return { ...base, text: on.length ? `${on.join(' + ')} enabled` : 'notifications/indications off' };
  }
  if (short === 0x2904 && dv.byteLength >= 7) {
    const fmt = dv.getUint8(0), exp = dv.getInt8(1), unit = dv.getUint16(2, true);
    return { ...base, text: `format 0x${fmt.toString(16).padStart(2, '0')}, exponent ${exp}, unit 0x${unit.toString(16)}` };
  }
  if (short === 0x2900 && dv.byteLength >= 2) {
    const v = dv.getUint16(0, true);
    return { ...base, text: [v & 1 ? 'reliable write' : null, v & 2 ? 'writable auxiliaries' : null].filter(Boolean).join(', ') || 'none' };
  }
  return { ...base, text: null };
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
    const chars = [];
    for (const ch of characteristics) {
      const cinfo = describeUuid(ch.uuid, 'characteristic');
      // Descriptors (user description, CCCD, ...). Not every device / browser
      // exposes them; a failure just means none are listed.
      let descriptors = [];
      if (typeof ch.getDescriptors === 'function') {
        try {
          descriptors = (await ch.getDescriptors()).map((d) => {
            const short = shortUuid(d.uuid);
            return {
              uuid: canonicalUuid(d.uuid),
              short,
              name: (short != null && GATT_DESCRIPTOR_NAMES[short]) || (short != null ? `Descriptor 0x${short.toString(16)}` : 'Vendor descriptor'),
              _ref: d
            };
          });
        } catch {
          descriptors = [];
        }
      }
      chars.push({
        uuid: canonicalUuid(ch.uuid),
        name: cinfo.name,
        short: cinfo.short,
        assigned: cinfo.assigned,
        properties: characteristicCapabilities(ch.properties),
        descriptors,
        _ref: ch // live handle, not serialized into UI state
      });
    }
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

/**
 * Read every readable characteristic and every descriptor in a tree, one GATT
 * operation at a time (Web Bluetooth rejects overlapping operations).
 * Resolves { [key]: result | { error } } where key is the characteristic uuid
 * (or `${characteristicUuid}/${descriptorUuid}` for descriptors).
 * `onEach(key, result)` is called as each value arrives.
 */
export async function readAllValues(tree, onEach) {
  const out = {};
  const put = (k, v) => { out[k] = v; if (onEach) onEach(k, v); };
  for (const service of tree) {
    for (const ch of service.characteristics) {
      let format = null; // raw 0x2904 Presentation Format, if the characteristic has one
      for (const d of ch.descriptors || []) {
        const key = `${ch.uuid}/${d.uuid}`;
        try {
          const raw = await d._ref.readValue();
          if (d.short === 0x2904) format = toDataView(raw);
          put(key, { ...parseDescriptorValue(d.uuid, raw), ts: Date.now() });
        } catch (e) { put(key, { error: e.message || String(e), ts: Date.now() }); }
      }
      if (ch.properties.read) {
        try {
          const raw = await ch._ref.readValue();
          put(ch.uuid, { ...parseCharacteristicValue(ch.uuid, raw, format), ts: Date.now() });
        } catch (e) { put(ch.uuid, { error: e.message || String(e), ts: Date.now() }); }
      }
    }
  }
  return out;
}
