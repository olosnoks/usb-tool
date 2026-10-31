/**
 * hidInspector.js — decode WebHID devices: their report descriptors (as the
 * browser parsed them into `collections`) and their live input reports.
 *
 * Pure functions only (no `navigator.hid`), so the collection decoding and the
 * generic report-field extractor are tested against hand-built report items
 * (see tests/hidInspector.test.js).
 *
 * References: USB HID 1.11 spec; HID Usage Tables 1.4; WebHID spec.
 */

// HID usage pages (the common ones).
export const USAGE_PAGES = {
  0x01: 'Generic Desktop', 0x02: 'Simulation', 0x03: 'VR', 0x04: 'Sport', 0x05: 'Game',
  0x06: 'Generic Device', 0x07: 'Keyboard/Keypad', 0x08: 'LED', 0x09: 'Button',
  0x0a: 'Ordinal', 0x0b: 'Telephony', 0x0c: 'Consumer', 0x0d: 'Digitizer',
  0x0f: 'PID (Force Feedback)', 0x14: 'Alphanumeric Display', 0x20: 'Sensor',
  0x81: 'Monitor', 0x84: 'Power', 0x8c: 'Barcode Scanner', 0xff00: 'Vendor-defined', 0xffa0: 'Vendor-defined'
};

// Usages within Generic Desktop (0x01) worth naming.
const GENERIC_DESKTOP = {
  0x01: 'Pointer', 0x02: 'Mouse', 0x04: 'Joystick', 0x05: 'Gamepad', 0x06: 'Keyboard',
  0x07: 'Keypad', 0x08: 'Multi-axis Controller', 0x30: 'X', 0x31: 'Y', 0x32: 'Z',
  0x33: 'Rx', 0x34: 'Ry', 0x35: 'Rz', 0x36: 'Slider', 0x37: 'Dial', 0x38: 'Wheel',
  0x39: 'Hat Switch', 0x3d: 'Start', 0x3e: 'Select', 0x40: 'Vx', 0x41: 'Vy', 0x42: 'Vz',
  0x80: 'System Control', 0x81: 'System Power Down', 0x82: 'System Sleep', 0x83: 'System Wake Up'
};

const LED_USAGES = { 0x01: 'Num Lock', 0x02: 'Caps Lock', 0x03: 'Scroll Lock', 0x04: 'Compose', 0x05: 'Kana' };

export function usagePageName(page) {
  if (page >= 0xff00) return 'Vendor-defined';
  return USAGE_PAGES[page] || `Page 0x${page.toString(16)}`;
}

/** Name a (page, usage) pair where we can; otherwise a hex label. */
export function usageName(page, usage) {
  if (page === 0x01) return GENERIC_DESKTOP[usage] || `Desktop 0x${usage.toString(16)}`;
  if (page === 0x09) return `Button ${usage}`;
  if (page === 0x08) return LED_USAGES[usage] || `LED 0x${usage.toString(16)}`;
  if (page === 0x07) return `Key 0x${usage.toString(16)}`;
  if (page === 0x0c) return `Consumer 0x${usage.toString(16)}`;
  return `${usagePageName(page)} 0x${usage.toString(16)}`;
}

/** A compact description of a device's collections, reports and fields. */
export function describeCollections(collections) {
  return (collections || []).map((col) => ({
    usagePage: col.usagePage,
    usage: col.usage,
    name: usageName(col.usagePage, col.usage),
    inputReports: (col.inputReports || []).map(describeReport),
    outputReports: (col.outputReports || []).map(describeReport),
    featureReports: (col.featureReports || []).map(describeReport)
  }));
}

function describeReport(report) {
  const fields = (report.items || []).map((item) => ({
    bitSize: item.reportSize,
    count: item.reportCount,
    totalBits: item.reportSize * item.reportCount,
    signed: (item.logicalMinimum ?? 0) < 0,
    logicalMinimum: item.logicalMinimum ?? 0,
    logicalMaximum: item.logicalMaximum ?? 0,
    isAbsolute: item.isAbsolute !== false,
    isArray: !!item.isArray,
    isConstant: !!item.isConstant,
    usagePage: item.usagePage,
    usages: itemUsages(item)
  }));
  const bits = fields.reduce((a, f) => a + f.totalBits, 0);
  return { reportId: report.reportId ?? 0, byteLength: Math.ceil(bits / 8), fields };
}

// The list of (page, usage) this item covers, from either an explicit usages
// array or a usageMinimum..usageMaximum range.
function itemUsages(item) {
  const page = item.usagePage;
  if (Array.isArray(item.usages) && item.usages.length) {
    return item.usages.map((u) => ({ page, usage: u, name: usageName(page, u) }));
  }
  if (item.usageMinimum != null && item.usageMaximum != null) {
    const out = [];
    for (let u = item.usageMinimum; u <= item.usageMaximum; u++) out.push({ page, usage: u, name: usageName(page, u) });
    return out;
  }
  return [];
}

/** Read `size` bits starting at `bitOffset` (LSB-first), optionally signed. */
export function readBits(dataView, bitOffset, size, signed) {
  let value = 0;
  for (let i = 0; i < size; i++) {
    const bit = bitOffset + i;
    const byte = dataView.getUint8(bit >> 3);
    value |= ((byte >> (bit & 7)) & 1) << i;
  }
  value >>>= 0;
  if (signed && size < 32 && (value & (1 << (size - 1)))) value -= 1 << size; // sign-extend
  return value;
}

/**
 * Decode one input report's data into named fields using a described report
 * (from describeReport). `data` is a DataView without the report-id byte
 * (which is how WebHID delivers it).
 */
export function decodeReport(describedReport, data) {
  const out = [];
  let bit = 0;
  for (const field of describedReport.fields) {
    const values = [];
    for (let i = 0; i < field.count; i++) {
      values.push(readBits(data, bit, field.bitSize, field.signed));
      bit += field.bitSize;
    }
    if (field.isConstant) continue; // padding
    if (field.isArray) {
      // Array item: each value is a usage code that is currently "down".
      const active = values.filter((v) => v !== 0).map((v) => usageName(field.usagePage, v));
      out.push({ label: field.usages[0]?.name?.replace(/0x.*/, '') || usagePageName(field.usagePage), type: 'array', active, raw: values });
    } else {
      // Variable item: one value per usage, in order.
      values.forEach((v, i) => {
        const u = field.usages[i] || field.usages[field.usages.length - 1];
        out.push({ label: u ? u.name : `${usagePageName(field.usagePage)} #${i}`, type: 'value', value: v, min: field.logicalMinimum, max: field.logicalMaximum });
      });
    }
  }
  return out;
}

export function hexDump(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export async function requestHidDevice() {
  if (typeof navigator === 'undefined' || !navigator.hid) throw new Error('WebHID needs Chrome or Edge over HTTPS.');
  const devices = await navigator.hid.requestDevice({ filters: [] });
  return devices[0] || null;
}

export async function listGrantedHidDevices() {
  if (typeof navigator === 'undefined' || !navigator.hid) return [];
  try { return await navigator.hid.getDevices(); } catch (e) { return []; }
}
