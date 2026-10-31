/**
 * usbDescriptors.js — a WebUSB "lsusb -v": turn a USBDevice's descriptor tree
 * into a readable, named structure, and decode USB class/subclass/protocol
 * codes, endpoint attributes and common BCD fields.
 *
 * Pure functions only — no `navigator.usb`. `describeDevice` takes anything
 * shaped like a WebUSB USBDevice (the fields are plain data), so it is tested
 * against hand-built device objects (see tests/usbDescriptors.test.js).
 *
 * References: USB 2.0 spec ch.9; USB-IF Defined Class Codes.
 */

// USB base class codes -> name. Subclass/protocol are decoded per class below.
export const USB_CLASS_NAMES = {
  0x00: 'Use interface descriptors', 0x01: 'Audio', 0x02: 'Communications (CDC)',
  0x03: 'HID', 0x05: 'Physical', 0x06: 'Image (PTP/MTP)', 0x07: 'Printer',
  0x08: 'Mass Storage', 0x09: 'Hub', 0x0a: 'CDC-Data', 0x0b: 'Smart Card',
  0x0d: 'Content Security', 0x0e: 'Video', 0x0f: 'Personal Healthcare',
  0x10: 'Audio/Video', 0x11: 'Billboard', 0x12: 'USB-C Bridge',
  0xdc: 'Diagnostic', 0xe0: 'Wireless Controller', 0xef: 'Miscellaneous',
  0xfe: 'Application Specific', 0xff: 'Vendor Specific'
};

// Well-known (class, subclass, protocol) triples seen on real hardware.
const CLASS_DETAIL = {
  '8/6/80': 'SCSI transparent, Bulk-Only Transport (BOT)',
  '8/6/50': 'SCSI, Bulk-Only Transport',
  '3/1/1': 'HID Boot Keyboard',
  '3/1/2': 'HID Boot Mouse',
  '2/2/1': 'CDC Abstract Control Model (AT commands)',
  '255/66/3': 'Android fastboot',
  '255/66/1': 'Android ADB',
  '254/1/1': 'DFU runtime / mode',
  '6/1/1': 'Still Image Capture (PTP)',
  '254/3/0': 'USBTMC',
  '254/3/1': 'USBTMC-USB488'
};

export const ENDPOINT_TYPES = ['Control', 'Isochronous', 'Bulk', 'Interrupt'];

export function className(code) {
  return USB_CLASS_NAMES[code] ?? `Class 0x${code.toString(16).padStart(2, '0')}`;
}

/** Decode a (class, subclass, protocol) triple into a human label. */
export function classDetail(cls, sub, proto) {
  const exact = CLASS_DETAIL[`${cls}/${sub}/${proto}`];
  if (exact) return exact;
  const base = className(cls);
  if (sub === 0 && proto === 0) return base;
  return `${base} (subclass ${sub}, protocol ${proto})`;
}

/** A BCD word like 0x0210 -> "2.10". */
export function formatBcd(v) {
  if (v == null) return null;
  const major = (v >> 8) & 0xff;
  const minor = v & 0xff;
  return `${major}.${minor.toString(16).padStart(2, '0')}`;
}

export function formatId(v) {
  return v == null ? '----' : v.toString(16).padStart(4, '0');
}

const EP_USAGE = ['Data', 'Feedback', 'Implicit feedback', 'Reserved'];
const EP_SYNC = ['No sync', 'Asynchronous', 'Adaptive', 'Synchronous'];

/** Decode an endpoint's address + attributes. */
export function describeEndpoint(ep) {
  const type = ENDPOINT_TYPES[ep.type ? ENDPOINT_TYPES.findIndex((t) => t.toLowerCase() === ep.type) : 0] ||
    (typeof ep.type === 'string' ? ep.type[0].toUpperCase() + ep.type.slice(1) : 'Control');
  const out = {
    address: `0x${(((ep.direction === 'in' ? 0x80 : 0x00) | ep.endpointNumber) >>> 0).toString(16).padStart(2, '0')}`,
    number: ep.endpointNumber,
    direction: ep.direction?.toUpperCase?.() || ep.direction,
    type,
    packetSize: ep.packetSize
  };
  if (type === 'Isochronous') {
    out.sync = EP_SYNC[(ep.synchronizationType != null ? ep.synchronizationType : 0)] || ep.synchronizationType;
    out.usage = EP_USAGE[(ep.usageType != null ? ep.usageType : 0)] || ep.usageType;
  }
  return out;
}

/**
 * Build a full, named descriptor tree from a USBDevice-shaped object.
 * Nothing is fetched; it reads the fields WebUSB already populates.
 */
export function describeDevice(device) {
  const configurations = (device.configurations || []).map((cfg) => ({
    value: cfg.configurationValue,
    name: cfg.configurationName || null,
    interfaces: (cfg.interfaces || []).map((iface) => ({
      number: iface.interfaceNumber,
      alternates: (iface.alternates || []).map((alt) => ({
        setting: alt.alternateSetting,
        class: alt.interfaceClass,
        subclass: alt.interfaceSubclass,
        protocol: alt.interfaceProtocol,
        className: className(alt.interfaceClass),
        detail: classDetail(alt.interfaceClass, alt.interfaceSubclass, alt.interfaceProtocol),
        name: alt.interfaceName || null,
        endpoints: (alt.endpoints || []).map(describeEndpoint)
      }))
    }))
  }));

  // Device class lives at device level only when it isn't delegated to interfaces.
  const devClass = device.deviceClass ?? 0;
  return {
    usbVersion: formatBcd(device.usbVersionMajor != null
      ? (device.usbVersionMajor << 8) | ((device.usbVersionMinor || 0) << 4) | (device.usbVersionSubminor || 0)
      : device.bcdUSB),
    vendorId: device.vendorId,
    productId: device.productId,
    vendorIdHex: formatId(device.vendorId),
    productIdHex: formatId(device.productId),
    deviceVersion: formatBcd(device.deviceVersionMajor != null
      ? (device.deviceVersionMajor << 8) | ((device.deviceVersionMinor || 0) << 4) | (device.deviceVersionSubminor || 0)
      : device.bcdDevice),
    class: devClass,
    className: devClass === 0 ? 'Per-interface' : className(devClass),
    subclass: device.deviceSubclass ?? 0,
    protocol: device.deviceProtocol ?? 0,
    manufacturerName: device.manufacturerName || null,
    productName: device.productName || null,
    serialNumber: device.serialNumber || null,
    configurationCount: configurations.length,
    configurations,
    // A quick, flat list of the interesting things on the device.
    highlights: summarize(configurations, devClass)
  };
}

function summarize(configurations, devClass) {
  const classes = new Set();
  let endpoints = 0;
  for (const cfg of configurations) {
    for (const iface of cfg.interfaces) {
      const alt = iface.alternates[0];
      if (alt) classes.add(alt.detail);
      for (const alt2 of iface.alternates) endpoints += alt2.endpoints.length;
    }
  }
  return { interfaceClasses: [...classes], endpointCount: endpoints };
}

/**
 * Render a lsusb-style plain-text dump, handy for copy/paste into a bug report.
 */
export function toTextReport(info) {
  const L = [];
  L.push(`Device ${info.vendorIdHex}:${info.productIdHex}  ${[info.manufacturerName, info.productName].filter(Boolean).join(' ') || '(no strings)'}`);
  if (info.serialNumber) L.push(`  Serial: ${info.serialNumber}`);
  L.push(`  USB ${info.usbVersion || '?'}, device ${info.deviceVersion || '?'}, class ${info.className}`);
  for (const cfg of info.configurations) {
    L.push(`  Configuration ${cfg.value}${cfg.name ? ` "${cfg.name}"` : ''}`);
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        L.push(`    Interface ${iface.number}${alt.setting ? `.${alt.setting}` : ''}: ${alt.detail}${alt.name ? ` "${alt.name}"` : ''}`);
        for (const ep of alt.endpoints) {
          L.push(`      EP ${ep.address} ${ep.direction} ${ep.type}, ${ep.packetSize} B`);
        }
      }
    }
  }
  return L.join('\n');
}

export const DESCRIPTOR_FILTERS = []; // acceptAllDevices in the picker

export async function requestAnyUsbDevice() {
  if (typeof navigator === 'undefined' || !navigator.usb) throw new Error('WebUSB needs Chrome or Edge over HTTPS.');
  return navigator.usb.requestDevice({ filters: DESCRIPTOR_FILTERS });
}

/** Devices the page has already been granted, so they can be listed without the picker. */
export async function listGrantedUsbDevices() {
  if (typeof navigator === 'undefined' || !navigator.usb) return [];
  try { return await navigator.usb.getDevices(); } catch (e) { return []; }
}
