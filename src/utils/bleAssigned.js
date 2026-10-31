// Bluetooth SIG assigned numbers and value decoders used by bleDriver.js.
// Names follow the Bluetooth SIG "Assigned Numbers" document.

// ---- GATT services (16-bit) ----
export const SIG_SERVICE_NAMES = {
  0x1800: 'Generic Access', 0x1801: 'Generic Attribute', 0x1802: 'Immediate Alert', 0x1803: 'Link Loss',
  0x1804: 'Tx Power', 0x1805: 'Current Time', 0x1806: 'Reference Time Update', 0x1807: 'Next DST Change',
  0x1808: 'Glucose', 0x1809: 'Health Thermometer', 0x180a: 'Device Information', 0x180d: 'Heart Rate',
  0x180e: 'Phone Alert Status', 0x180f: 'Battery', 0x1810: 'Blood Pressure', 0x1811: 'Alert Notification',
  0x1812: 'Human Interface Device', 0x1813: 'Scan Parameters', 0x1814: 'Running Speed and Cadence',
  0x1815: 'Automation IO', 0x1816: 'Cycling Speed and Cadence', 0x1818: 'Cycling Power',
  0x1819: 'Location and Navigation', 0x181a: 'Environmental Sensing', 0x181b: 'Body Composition',
  0x181c: 'User Data', 0x181d: 'Weight Scale', 0x181e: 'Bond Management', 0x181f: 'Continuous Glucose Monitoring',
  0x1820: 'Internet Protocol Support', 0x1821: 'Indoor Positioning', 0x1822: 'Pulse Oximeter',
  0x1823: 'HTTP Proxy', 0x1824: 'Transport Discovery', 0x1825: 'Object Transfer', 0x1826: 'Fitness Machine',
  0x1827: 'Mesh Provisioning', 0x1828: 'Mesh Proxy', 0x1829: 'Reconnection Configuration',
  0x183a: 'Insulin Delivery', 0x183b: 'Binary Sensor', 0x183c: 'Emergency Configuration',
  0x183d: 'Authorization Control', 0x183e: 'Physical Activity Monitor', 0x183f: 'Elapsed Time',
  0x1840: 'Generic Health Sensor', 0x1843: 'Audio Input Control', 0x1844: 'Volume Control',
  0x1845: 'Volume Offset Control', 0x1846: 'Coordinated Set Identification', 0x1847: 'Device Time',
  0x1848: 'Media Control', 0x1849: 'Generic Media Control', 0x184a: 'Constant Tone Extension',
  0x184b: 'Telephone Bearer', 0x184c: 'Generic Telephone Bearer', 0x184d: 'Microphone Control',
  0x184e: 'Audio Stream Control', 0x184f: 'Broadcast Audio Scan', 0x1850: 'Published Audio Capabilities',
  0x1851: 'Basic Audio Announcement', 0x1852: 'Broadcast Audio Announcement', 0x1853: 'Common Audio',
  0x1854: 'Hearing Access', 0x1855: 'Telephony and Media Audio', 0x1856: 'Public Broadcast Announcement',
  0x1857: 'Electronic Shelf Label', 0x1858: 'Gaming Audio', 0x1859: 'Mesh Proxy Solicitation',
  // 16-bit UUIDs assigned to member companies
  0xfe59: 'Nordic DFU (Secure, buttonless)', 0xfd6f: 'Exposure Notification', 0xfe2c: 'Google Fast Pair',
  0xffe0: 'HM-10 / CC254x Serial (FFE0)'
};

// Every 16-bit SIG service number we ask the browser for access to.
export const STANDARD_SERVICE_UUIDS = Array.from({ length: 0x185a - 0x1800 }, (_, i) => 0x1800 + i)
  .concat([0xfe59, 0xfe2c, 0xffe0]);

// ---- Vendor 128-bit services worth knowing about ----
export const VENDOR_SERVICES = {
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e': 'Nordic UART Service (NUS)',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455': 'Microchip / ISSC Transparent UART',
  '8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000': 'Flipper Zero Serial',
  '00001530-1212-efde-1523-785feabcd123': 'Nordic Legacy DFU',
  '0000fff0-0000-1000-8000-00805f9b34fb': 'Generic vendor service (FFF0)'
};

// ---- GATT characteristics (16-bit) ----
export const SIG_CHARACTERISTIC_NAMES = {
  0x2a00: 'Device Name', 0x2a01: 'Appearance', 0x2a02: 'Peripheral Privacy Flag', 0x2a03: 'Reconnection Address',
  0x2a04: 'Peripheral Preferred Connection Parameters', 0x2a05: 'Service Changed', 0x2a06: 'Alert Level',
  0x2a07: 'Tx Power Level', 0x2a08: 'Date Time', 0x2a09: 'Day of Week', 0x2a0a: 'Day Date Time',
  0x2a0c: 'Exact Time 256', 0x2a0d: 'DST Offset', 0x2a0e: 'Time Zone', 0x2a0f: 'Local Time Information',
  0x2a11: 'Time with DST', 0x2a12: 'Time Accuracy', 0x2a13: 'Time Source', 0x2a14: 'Reference Time Information',
  0x2a16: 'Time Update Control Point', 0x2a17: 'Time Update State', 0x2a18: 'Glucose Measurement',
  0x2a19: 'Battery Level', 0x2a1c: 'Temperature Measurement', 0x2a1d: 'Temperature Type',
  0x2a1e: 'Intermediate Temperature', 0x2a21: 'Measurement Interval', 0x2a22: 'Boot Keyboard Input Report',
  0x2a23: 'System ID', 0x2a24: 'Model Number String', 0x2a25: 'Serial Number String',
  0x2a26: 'Firmware Revision String', 0x2a27: 'Hardware Revision String', 0x2a28: 'Software Revision String',
  0x2a29: 'Manufacturer Name String', 0x2a2a: 'IEEE 11073-20601 Regulatory Certification Data List',
  0x2a2b: 'Current Time', 0x2a31: 'Scan Refresh', 0x2a32: 'Boot Keyboard Output Report',
  0x2a33: 'Boot Mouse Input Report', 0x2a34: 'Glucose Measurement Context', 0x2a35: 'Blood Pressure Measurement',
  0x2a36: 'Intermediate Cuff Pressure', 0x2a37: 'Heart Rate Measurement', 0x2a38: 'Body Sensor Location',
  0x2a39: 'Heart Rate Control Point', 0x2a3f: 'Alert Status', 0x2a40: 'Ringer Control Point',
  0x2a41: 'Ringer Setting', 0x2a42: 'Alert Category ID Bit Mask', 0x2a43: 'Alert Category ID',
  0x2a44: 'Alert Notification Control Point', 0x2a45: 'Unread Alert Status', 0x2a46: 'New Alert',
  0x2a47: 'Supported New Alert Category', 0x2a48: 'Supported Unread Alert Category',
  0x2a49: 'Blood Pressure Feature', 0x2a4a: 'HID Information', 0x2a4b: 'Report Map', 0x2a4c: 'HID Control Point',
  0x2a4d: 'Report', 0x2a4e: 'Protocol Mode', 0x2a4f: 'Scan Interval Window', 0x2a50: 'PnP ID',
  0x2a51: 'Glucose Feature', 0x2a52: 'Record Access Control Point', 0x2a53: 'RSC Measurement',
  0x2a54: 'RSC Feature', 0x2a55: 'SC Control Point', 0x2a5b: 'CSC Measurement', 0x2a5c: 'CSC Feature',
  0x2a5d: 'Sensor Location', 0x2a63: 'Cycling Power Measurement', 0x2a64: 'Cycling Power Vector',
  0x2a65: 'Cycling Power Feature', 0x2a66: 'Cycling Power Control Point', 0x2a67: 'Location and Speed',
  0x2a68: 'Navigation', 0x2a6c: 'Elevation', 0x2a6d: 'Pressure', 0x2a6e: 'Temperature', 0x2a6f: 'Humidity',
  0x2a70: 'True Wind Speed', 0x2a71: 'True Wind Direction', 0x2a72: 'Apparent Wind Speed',
  0x2a73: 'Apparent Wind Direction', 0x2a74: 'Gust Factor', 0x2a75: 'Pollen Concentration', 0x2a76: 'UV Index',
  0x2a77: 'Irradiance', 0x2a78: 'Rainfall', 0x2a79: 'Wind Chill', 0x2a7a: 'Heat Index', 0x2a7b: 'Dew Point',
  0x2a7d: 'Descriptor Value Changed', 0x2a98: 'Weight', 0x2a9d: 'Weight Measurement',
  0x2a9e: 'Weight Scale Feature', 0x2aa6: 'Central Address Resolution', 0x2ac9: 'Resolvable Private Address Only',
  0x2acc: 'Fitness Machine Feature', 0x2ad9: 'Fitness Machine Control Point', 0x2ada: 'Fitness Machine Status',
  0x2b29: 'Client Supported Features', 0x2b2a: 'Database Hash', 0x2b3a: 'Server Supported Features',
  0xffe1: 'HM-10 Serial Data (FFE1)'
};

export const VENDOR_CHARACTERISTICS = {
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e': 'NUS RX (write to device)',
  '6e400003-b5a3-f393-e0a9-e50e24dcca9e': 'NUS TX (notifications from device)'
};

// ---- value decoders ----
const s24 = (dv, o) => { const v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getUint8(o + 2) << 16); return v & 0x800000 ? v - 0x1000000 : v; };
const hex = (n, w = 4) => `0x${n.toString(16).padStart(w, '0')}`;

/** IEEE-11073 32-bit FLOAT: int24 mantissa, int8 exponent. */
export function ieee11073Float(dv, o = 0) {
  const raw = dv.getUint32(o, true);
  const mantissa = raw & 0xffffff;
  if (mantissa === 0x7fffff) return NaN;
  if (mantissa === 0x800000 || mantissa === 0x7ffffe || mantissa === 0x800002) return NaN;
  const m = mantissa & 0x800000 ? mantissa - 0x1000000 : mantissa;
  const e = (raw >> 24) << 24 >> 24;
  return Number((m * 10 ** e).toPrecision(8));
}

function dateTime(dv, o = 0) {
  const y = dv.getUint16(o, true), mo = dv.getUint8(o + 2), d = dv.getUint8(o + 3);
  const h = dv.getUint8(o + 4), mi = dv.getUint8(o + 5), s = dv.getUint8(o + 6);
  const p = (n) => String(n).padStart(2, '0');
  return `${y || '????'}-${p(mo)}-${p(d)} ${p(h)}:${p(mi)}:${p(s)}`;
}

const APPEARANCE_CATEGORIES = ['Unknown', 'Phone', 'Computer', 'Watch', 'Clock', 'Display', 'Remote Control',
  'Eye-glasses', 'Tag', 'Keyring', 'Media Player', 'Barcode Scanner', 'Thermometer', 'Heart Rate Sensor',
  'Blood Pressure', 'Human Interface Device', 'Glucose Meter', 'Running Walking Sensor', 'Cycling'];
const BODY_LOCATIONS = ['Other', 'Chest', 'Wrist', 'Finger', 'Hand', 'Ear Lobe', 'Foot'];
const ALERT_LEVELS = ['No Alert', 'Mild Alert', 'High Alert'];

/** Decoders keyed by 16-bit characteristic UUID. Each returns { label, text, value }. */
export const EXTRA_PARSERS = {
  0x2a01: (dv) => {
    const v = dv.getUint16(0, true);
    const cat = APPEARANCE_CATEGORIES[v >> 6];
    return { label: 'Appearance', text: `${cat || 'Category ' + (v >> 6)} (${hex(v)})`, value: v };
  },
  0x2a04: (dv) => {
    const min = dv.getUint16(0, true) * 1.25, max = dv.getUint16(2, true) * 1.25;
    const lat = dv.getUint16(4, true), to = dv.getUint16(6, true) * 10;
    return { label: 'Connection params', text: `interval ${min}–${max} ms, latency ${lat}, timeout ${to} ms`, value: { min, max, lat, to } };
  },
  0x2a05: (dv) => ({ label: 'Changed handles', text: `${hex(dv.getUint16(0, true))}–${hex(dv.getUint16(2, true))}` }),
  0x2a06: (dv) => ({ label: 'Alert Level', text: ALERT_LEVELS[dv.getUint8(0)] || `level ${dv.getUint8(0)}`, value: dv.getUint8(0) }),
  0x2a07: (dv) => ({ label: 'Tx Power', text: `${dv.getInt8(0)} dBm`, value: dv.getInt8(0) }),
  0x2a08: (dv) => ({ label: 'Date Time', text: dateTime(dv) }),
  0x2a2b: (dv) => ({ label: 'Current Time', text: dateTime(dv) }),
  0x2a1c: (dv) => {
    const f = dv.getUint8(0), t = ieee11073Float(dv, 1);
    return { label: 'Temperature', text: `${t} °${f & 1 ? 'F' : 'C'}`, value: t };
  },
  0x2a23: (dv) => {
    const b = Array.from({ length: dv.byteLength }, (_, i) => dv.getUint8(i));
    const oui = b.slice(5, 8).reverse().map((x) => x.toString(16).padStart(2, '0')).join(':').toUpperCase();
    const mfr = b.slice(0, 5).reverse().map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    return { label: 'System ID', text: `OUI ${oui}, manufacturer id ${mfr}` };
  },
  0x2a38: (dv) => ({ label: 'Body Sensor Location', text: BODY_LOCATIONS[dv.getUint8(0)] || `code ${dv.getUint8(0)}` }),
  0x2a50: (dv) => {
    const src = dv.getUint8(0), vid = dv.getUint16(1, true), pid = dv.getUint16(3, true), ver = dv.getUint16(5, true);
    const space = src === 1 ? 'Bluetooth SIG company' : src === 2 ? 'USB' : `source ${src}`;
    return { label: 'PnP ID', text: `${space} vendor ${hex(vid)}, product ${hex(pid)}, version ${ver >> 8}.${(ver >> 4) & 0xf}.${ver & 0xf}` };
  },
  0x2a6c: (dv) => ({ label: 'Elevation', text: `${(s24(dv, 0) / 100).toFixed(2)} m` }),
  0x2a6d: (dv) => ({ label: 'Pressure', text: `${(dv.getUint32(0, true) / 1000).toFixed(1)} hPa` }),
  0x2a6e: (dv) => ({ label: 'Temperature', text: `${(dv.getInt16(0, true) / 100).toFixed(2)} °C`, value: dv.getInt16(0, true) / 100 }),
  0x2a6f: (dv) => ({ label: 'Humidity', text: `${(dv.getUint16(0, true) / 100).toFixed(2)} %`, value: dv.getUint16(0, true) / 100 }),
  0x2a76: (dv) => ({ label: 'UV Index', text: String(dv.getUint8(0)), value: dv.getUint8(0) }),
  0x2a7b: (dv) => ({ label: 'Dew Point', text: `${dv.getInt8(0)} °C` }),
  0x2a19: (dv) => ({ label: 'Battery', text: `${dv.getUint8(0)}%`, value: dv.getUint8(0) })
};

// ---- Characteristic Presentation Format (0x2904) ----
const UNITS = { 0x2700: '', 0x2701: 'm', 0x2702: 'kg', 0x2703: 's', 0x2704: 'A', 0x2705: 'K', 0x272f: '°C', 0x27ad: '%' };
const FORMAT_READERS = {
  0x01: [1, (dv) => (dv.getUint8(0) ? 'true' : 'false')],
  0x04: [1, (dv) => dv.getUint8(0)], 0x06: [2, (dv) => dv.getUint16(0, true)],
  0x07: [3, (dv) => dv.getUint8(0) | (dv.getUint8(1) << 8) | (dv.getUint8(2) << 16)],
  0x08: [4, (dv) => dv.getUint32(0, true)], 0x0a: [8, (dv) => dv.getBigUint64(0, true)],
  0x0c: [1, (dv) => dv.getInt8(0)], 0x0e: [2, (dv) => dv.getInt16(0, true)], 0x0f: [3, (dv) => s24(dv, 0)],
  0x10: [4, (dv) => dv.getInt32(0, true)], 0x12: [8, (dv) => dv.getBigInt64(0, true)],
  0x14: [4, (dv) => dv.getFloat32(0, true)], 0x15: [8, (dv) => dv.getFloat64(0, true)],
  0x17: [4, (dv) => ieee11073Float(dv, 0)]
};

/**
 * Decode a value using its 0x2904 descriptor (format, exponent, unit).
 * Returns { label, text } or null when the format isn't one we read.
 */
export function applyPresentationFormat(valueDv, fmtDv) {
  if (!fmtDv || fmtDv.byteLength < 4) return null;
  const format = fmtDv.getUint8(0), exponent = fmtDv.getInt8(1), unit = fmtDv.getUint16(2, true);
  const unitText = unit in UNITS ? UNITS[unit] : `(unit ${hex(unit)})`;
  if (format === 0x19) {
    return { label: 'Formatted (UTF-8)', text: new TextDecoder().decode(new Uint8Array(valueDv.buffer, valueDv.byteOffset, valueDv.byteLength)) };
  }
  const reader = FORMAT_READERS[format];
  if (!reader || valueDv.byteLength < reader[0]) return null;
  let v = reader[1](valueDv);
  if (typeof v === 'bigint') v = v.toString();
  else if (typeof v === 'number' && exponent) v = Number((v * 10 ** exponent).toPrecision(10));
  return { label: 'Formatted', text: unitText ? `${v} ${unitText}` : String(v) };
}
