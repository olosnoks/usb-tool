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

// ---------------------------------------------------------------------------
// Raw descriptor parsing (USB-3). Everything below is pure: it takes bytes
// (Uint8Array / ArrayBuffer / DataView / number[]) and never throws on garbled
// input; problems are reported as `notes` ("malformed at offset N ...").
// ---------------------------------------------------------------------------

export const DT = {
  DEVICE: 0x01, CONFIG: 0x02, STRING: 0x03, INTERFACE: 0x04, ENDPOINT: 0x05,
  QUALIFIER: 0x06, OTHER_SPEED: 0x07, IAD: 0x0b, BOS: 0x0f, DEVICE_CAP: 0x10,
  HID: 0x21, HID_REPORT: 0x22, CS_INTERFACE: 0x24, CS_ENDPOINT: 0x25,
  HUB: 0x29, SS_HUB: 0x2a, SS_ENDPOINT_COMPANION: 0x30, SSP_ISO_COMPANION: 0x31
};

export function toBytes(data) {
  if (data == null) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return Uint8Array.from(data);
  return new Uint8Array(0);
}

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const hx = (n, w = 2) => `0x${n.toString(16).padStart(w, '0')}`;

/** Hex dump, 16 bytes per row, with ASCII gutter. */
export function hexDump(data) {
  const b = toBytes(data);
  const rows = [];
  for (let o = 0; o < b.length; o += 16) {
    const slice = Array.from(b.subarray(o, o + 16));
    const hexs = slice.map((v) => v.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const asc = slice.map((v) => (v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.')).join('');
    rows.push(`${o.toString(16).padStart(4, '0')}  ${hexs}  ${asc}`);
  }
  return rows.join('\n');
}

export function toHex(data) {
  return Array.from(toBytes(data)).map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Split a descriptor blob into [{offset,length,type,bytes}] and report malformed spots. */
export function walkDescriptors(data) {
  const b = toBytes(data);
  const items = [];
  const notes = [];
  let off = 0;
  while (off < b.length) {
    const len = b[off];
    if (len < 2) {
      notes.push(`malformed at offset ${off}: bLength ${len}`);
      break;
    }
    if (off + len > b.length) {
      notes.push(`malformed at offset ${off}: bLength ${len} overruns the buffer (${b.length - off} bytes left)`);
      break;
    }
    items.push({ offset: off, length: len, type: b[off + 1], bytes: b.subarray(off, off + len) });
    off += len;
  }
  return { items, notes };
}

/** GUID in the mixed-endian text form used by USB platform capabilities. */
export function formatUuid(bytes16) {
  const b = toBytes(bytes16);
  if (b.length < 16) return null;
  const h = (i, n) => Array.from(b.subarray(i, i + n)).map((v) => v.toString(16).padStart(2, '0'));
  return [h(0, 4).reverse().join(''), h(4, 2).reverse().join(''), h(6, 2).reverse().join(''), h(8, 2).join(''), h(10, 6).join('')].join('-');
}

export const WEBUSB_UUID = '3408b638-09a9-47a0-8bfd-a0768815b665';
export const MS_OS_20_UUID = 'd8dd60df-4589-4cc7-9cd2-659d9e648a9f';

export function parseDeviceDescriptor(data) {
  const b = toBytes(data);
  if (b.length < 18 || b[1] !== DT.DEVICE) {
    return { notes: [b.length < 18 ? `malformed at offset 0: device descriptor needs 18 bytes, got ${b.length}` : `malformed at offset 0: bDescriptorType ${hx(b[1])} is not a device descriptor`] };
  }
  const bcdUSB = u16(b, 2);
  const ss = bcdUSB >= 0x0300;
  return {
    bcdUSB, usbVersion: formatBcd(bcdUSB),
    class: b[4], subclass: b[5], protocol: b[6], className: b[4] === 0 ? 'Per-interface' : className(b[4]),
    maxPacketSize0: ss ? 2 ** b[7] : b[7],
    vendorId: u16(b, 8), productId: u16(b, 10), bcdDevice: u16(b, 12), deviceVersion: formatBcd(u16(b, 12)),
    iManufacturer: b[14], iProduct: b[15], iSerialNumber: b[16], numConfigurations: b[17],
    notes: b[0] !== 18 ? [`note: bLength is ${b[0]}, expected 18`] : []
  };
}

export function parseDeviceQualifier(data) {
  const b = toBytes(data);
  if (b.length < 10 || b[1] !== DT.QUALIFIER) return { notes: ['malformed at offset 0: not a 10-byte device qualifier'] };
  return { bcdUSB: u16(b, 2), usbVersion: formatBcd(u16(b, 2)), class: b[4], subclass: b[5], protocol: b[6], maxPacketSize0: b[7], numConfigurations: b[8], notes: [] };
}

/** Language ids from string descriptor 0. */
export function parseLangIds(data) {
  const b = toBytes(data);
  if (b.length < 2 || b[1] !== DT.STRING) return [];
  const end = Math.min(b[0] || b.length, b.length);
  const ids = [];
  for (let o = 2; o + 1 < end; o += 2) ids.push(u16(b, o));
  return ids;
}

/** UTF-16LE string descriptor -> { text, notes }. */
export function parseStringDescriptor(data) {
  const b = toBytes(data);
  if (b.length < 2) return { text: null, notes: ['malformed at offset 0: string descriptor shorter than 2 bytes'] };
  const notes = [];
  if (b[1] !== DT.STRING) notes.push(`malformed at offset 1: bDescriptorType ${hx(b[1])} is not a string`);
  let end = b[0];
  if (end < 2) { notes.push('malformed at offset 0: bLength < 2'); end = b.length; }
  if (end > b.length) { notes.push(`malformed at offset 0: bLength ${end} overruns the buffer (${b.length} bytes)`); end = b.length; }
  let text = '';
  for (let o = 2; o + 1 < end; o += 2) text += String.fromCharCode(u16(b, o));
  return { text, notes };
}

const CAP_NAMES = {
  0x01: 'Wireless USB', 0x02: 'USB 2.0 Extension', 0x03: 'SuperSpeed USB', 0x04: 'Container ID',
  0x05: 'Platform', 0x06: 'Power Delivery Capability', 0x07: 'Battery Info', 0x08: 'PD Consumer Port',
  0x09: 'PD Provider Port', 0x0a: 'SuperSpeedPlus', 0x0b: 'Precision Time Measurement',
  0x0c: 'Wireless USB Ext', 0x0d: 'Billboard', 0x0e: 'Authentication', 0x0f: 'Billboard Ext',
  0x10: 'Configuration Summary'
};

/** Decode a BOS descriptor (header + device capabilities). */
export function parseBos(data) {
  const b = toBytes(data);
  const out = { totalLength: null, numDeviceCaps: null, capabilities: [], notes: [] };
  if (b.length < 5 || b[1] !== DT.BOS) {
    out.notes.push(b.length < 5 ? `malformed at offset 0: BOS header needs 5 bytes, got ${b.length}` : `malformed at offset 0: bDescriptorType ${hx(b[1])} is not BOS`);
    return out;
  }
  out.totalLength = u16(b, 2);
  out.numDeviceCaps = b[4];
  if (out.totalLength > b.length) out.notes.push(`note: wTotalLength ${out.totalLength} exceeds the ${b.length} bytes supplied`);
  const base = b[0] >= 5 ? b[0] : 5;
  const end = Math.min(out.totalLength >= base ? out.totalLength : b.length, b.length);
  const { items, notes } = walkDescriptors(b.subarray(base, end));
  for (const n of notes) out.notes.push(n.replace(/offset (\d+)/, (_, o) => `offset ${Number(o) + base}`));
  for (const it of items) {
    const d = it.bytes;
    const at = it.offset + base;
    if (it.type !== DT.DEVICE_CAP || d.length < 3) {
      out.notes.push(`malformed at offset ${at}: expected a device capability descriptor, found type ${hx(it.type)}`);
      continue;
    }
    const capType = d[2];
    const cap = { offset: at, type: capType, name: CAP_NAMES[capType] || `Capability ${hx(capType)}`, hex: toHex(d) };
    if (capType === 0x02 && d.length >= 7) {
      const bm = u32(d, 3);
      Object.assign(cap, { bmAttributes: bm, lpm: !!(bm & 2), besl: !!(bm & 4) });
    } else if (capType === 0x03 && d.length >= 10) {
      const speeds = u16(d, 4);
      Object.assign(cap, {
        bmAttributes: d[3], ltm: !!(d[3] & 2), wSpeedsSupported: speeds,
        speeds: ['Low', 'Full', 'High', 'SuperSpeed'].filter((_, i) => speeds & (1 << i)),
        functionalitySupport: d[6], u1ExitLatency: d[7], u2ExitLatency: u16(d, 8)
      });
    } else if (capType === 0x04 && d.length >= 20) {
      cap.containerId = formatUuid(d.subarray(4, 20));
    } else if (capType === 0x05 && d.length >= 20) {
      const uuid = formatUuid(d.subarray(4, 20));
      cap.uuid = uuid;
      cap.platformData = toHex(d.subarray(20));
      if (uuid === WEBUSB_UUID && d.length >= 24) {
        cap.platform = 'WebUSB';
        cap.name = 'Platform: WebUSB';
        cap.bcdVersion = u16(d, 20);
        cap.version = formatBcd(u16(d, 20));
        cap.vendorCode = d[22];
        cap.landingPageIndex = d[23]; // 0 = none, 255 = about:blank
      } else if (uuid === MS_OS_20_UUID && d.length >= 28) {
        cap.platform = 'Microsoft OS 2.0';
        cap.name = 'Platform: Microsoft OS 2.0 descriptors';
        cap.windowsVersion = u32(d, 20);
        cap.descriptorSetTotalLength = u16(d, 24);
        cap.vendorCode = d[26];
        cap.altEnumCode = d[27];
      } else if (uuid === WEBUSB_UUID || uuid === MS_OS_20_UUID) {
        out.notes.push(`malformed at offset ${at}: platform capability ${uuid} is truncated`);
      }
    } else if (capType === 0x0a && d.length >= 12) {
      cap.bmAttributes = u32(d, 4);
      cap.sublinkSpeedAttrCount = (cap.bmAttributes & 0x1f) + 1;
    } else if ([0x02, 0x03, 0x04, 0x05].includes(capType)) {
      out.notes.push(`malformed at offset ${at}: ${cap.name} capability is truncated (${d.length} bytes)`);
    }
    out.capabilities.push(cap);
  }
  return out;
}

const CDC_SUBTYPES = { 0x00: 'Header', 0x01: 'Call Management', 0x02: 'Abstract Control Management', 0x03: 'Direct Line Management', 0x04: 'Telephone Ringer', 0x05: 'Telephone Call/Line State', 0x06: 'Union', 0x07: 'Country Selection', 0x08: 'Telephone Operational Modes', 0x09: 'USB Terminal', 0x0a: 'Network Channel Terminal', 0x0b: 'Protocol Unit', 0x0c: 'Extension Unit', 0x0d: 'Multi-Channel Management', 0x0e: 'CAPI Control Management', 0x0f: 'Ethernet Networking', 0x10: 'ATM Networking', 0x13: 'MBIM', 0x1b: 'MBIM Extended' };
const UVC_VC = { 1: 'VC_HEADER', 2: 'VC_INPUT_TERMINAL', 3: 'VC_OUTPUT_TERMINAL', 4: 'VC_SELECTOR_UNIT', 5: 'VC_PROCESSING_UNIT', 6: 'VC_EXTENSION_UNIT' };
const UVC_VS = { 1: 'VS_INPUT_HEADER', 2: 'VS_OUTPUT_HEADER', 3: 'VS_STILL_IMAGE_FRAME', 4: 'VS_FORMAT_UNCOMPRESSED', 5: 'VS_FRAME_UNCOMPRESSED', 6: 'VS_FORMAT_MJPEG', 7: 'VS_FRAME_MJPEG', 0x0d: 'VS_COLORFORMAT' };
const UAC_AC = { 1: 'HEADER', 2: 'INPUT_TERMINAL', 3: 'OUTPUT_TERMINAL', 4: 'MIXER_UNIT', 5: 'SELECTOR_UNIT', 6: 'FEATURE_UNIT', 7: 'PROCESSING_UNIT', 8: 'EXTENSION_UNIT' };
const UAC_AS = { 1: 'AS_GENERAL', 2: 'FORMAT_TYPE', 3: 'FORMAT_SPECIFIC' };

function decodeDfu(d, base) {
  if (d.length < 9) return { ...base, kind: 'dfu', name: 'DFU functional descriptor (truncated)' };
  const a = d[2];
  return {
    ...base, kind: 'dfu', name: 'DFU functional descriptor', bmAttributes: a,
    canDownload: !!(a & 1), canUpload: !!(a & 2), manifestationTolerant: !!(a & 4), willDetach: !!(a & 8),
    detachTimeout: u16(d, 3), transferSize: u16(d, 5), bcdDFUVersion: formatBcd(u16(d, 7))
  };
}

/** Hub descriptor (as returned by a class GET_DESCRIPTOR, or found in a config blob). */
export function parseHubDescriptor(data) {
  const d = toBytes(data);
  const base = { type: d[1], hex: toHex(d), kind: 'hub' };
  if (d.length < 7) return { ...base, name: 'Hub descriptor (truncated)', notes: [`malformed at offset 0: hub descriptor needs 7 bytes, got ${d.length}`] };
  const ss = d[1] === DT.SS_HUB;
  const chars = u16(d, 3);
  return {
    ...base, name: ss ? 'SuperSpeed hub descriptor' : 'Hub descriptor', numPorts: d[2], wHubCharacteristics: chars,
    powerSwitching: ['ganged', 'individual', 'none', 'none'][chars & 3],
    compoundDevice: !!(chars & 4), overCurrentProtection: ['global', 'individual', 'none', 'none'][(chars >> 3) & 3],
    powerOnToGoodMs: d[5] * 2, hubControllerCurrentMa: d[6], notes: []
  };
}

/**
 * Decode one class-specific descriptor (type 0x24/0x25/0x21/0x29) in the
 * context of the interface it follows. `d` is the whole descriptor.
 */
export function decodeClassSpecific(d, cls, sub) {
  const type = d[1];
  const base = { type, hex: toHex(d) };
  if (type === DT.HID) {
    if (cls === 0xfe && sub === 1) return decodeDfu(d, base);
    if (d.length < 9) return { ...base, kind: 'hid', name: 'HID descriptor (truncated)' };
    const n = d[5];
    const descriptors = [];
    for (let i = 0; i < n && 8 + i * 3 < d.length; i++) descriptors.push({ type: d[6 + i * 3], length: u16(d, 7 + i * 3) });
    const report = descriptors.find((x) => x.type === DT.HID_REPORT);
    return { ...base, kind: 'hid', name: 'HID descriptor', bcdHID: formatBcd(u16(d, 2)), countryCode: d[4], numDescriptors: n, descriptors, reportDescriptorLength: report ? report.length : null };
  }
  if (type === DT.HUB || type === DT.SS_HUB) return parseHubDescriptor(d);
  if (type === DT.CS_ENDPOINT) return { ...base, kind: 'cs-endpoint', name: `Class-specific endpoint (subtype ${hx(d[2] ?? 0)})`, subtype: d[2] };
  if (type !== DT.CS_INTERFACE || d.length < 3) return { ...base, kind: 'unknown', name: `Descriptor type ${hx(type)}` };
  const st = d[2];
  if (cls === 0x02) {
    const o = { ...base, kind: 'cdc', subtype: st, name: `CDC ${CDC_SUBTYPES[st] || `subtype ${hx(st)}`}` };
    if (st === 0x00 && d.length >= 5) o.bcdCDC = formatBcd(u16(d, 3));
    else if (st === 0x01 && d.length >= 5) Object.assign(o, { bmCapabilities: d[3], handlesCallManagement: !!(d[3] & 1), callManagementOverDataInterface: !!(d[3] & 2), dataInterface: d[4] });
    else if (st === 0x02 && d.length >= 4) Object.assign(o, { bmCapabilities: d[3], lineCoding: !!(d[3] & 2), sendBreak: !!(d[3] & 4), networkConnection: !!(d[3] & 8) });
    else if (st === 0x06 && d.length >= 5) Object.assign(o, { controlInterface: d[3], subordinateInterfaces: Array.from(d.subarray(4)) });
    else if (st === 0x0f && d.length >= 13) Object.assign(o, { iMACAddress: d[3], maxSegmentSize: u16(d, 8), numberMCFilters: u16(d, 10), numberPowerFilters: d[12] });
    return o;
  }
  if (cls === 0x0e) {
    const isVs = sub === 2;
    const o = { ...base, kind: 'uvc', subtype: st, name: `UVC ${(isVs ? UVC_VS : UVC_VC)[st] || `subtype ${hx(st)}`}` };
    if (!isVs && st === 1 && d.length >= 12) {
      Object.assign(o, { bcdUVC: formatBcd(u16(d, 3)), totalLength: u16(d, 5), clockFrequencyHz: u32(d, 7), interfaceCollection: Array.from(d.subarray(12, 12 + d[11])) });
    } else if (isVs && st === 1 && d.length >= 7) {
      Object.assign(o, { numFormats: d[3], totalLength: u16(d, 4), endpointAddress: hx(d[6]) });
    }
    return o;
  }
  if (cls === 0x01) {
    const isAs = sub === 2;
    const o = { ...base, kind: 'uac', subtype: st, name: `UAC ${(isAs ? UAC_AS : UAC_AC)[st] || `subtype ${hx(st)}`}` };
    if (!isAs && st === 1 && d.length >= 8) {
      Object.assign(o, { bcdADC: formatBcd(u16(d, 3)), totalLength: u16(d, 5), interfaceCollection: Array.from(d.subarray(8, 8 + d[7])) });
    }
    return o;
  }
  return { ...base, kind: 'class-specific', subtype: st, name: `Class-specific interface descriptor (subtype ${hx(st)})` };
}

function describeParsedEndpoint(d) {
  const attrs = d[3];
  const typeIdx = attrs & 3;
  const w = u16(d, 4);
  const addr = d[2];
  const ep = {
    address: hx(addr), number: addr & 0x0f, direction: addr & 0x80 ? 'IN' : 'OUT',
    type: ENDPOINT_TYPES[typeIdx], packetSize: w & 0x7ff, transactionsPerMicroframe: ((w >> 11) & 3) + 1,
    attributes: attrs, interval: d[6], companion: null
  };
  if (typeIdx === 1) {
    ep.sync = EP_SYNC[(attrs >> 2) & 3];
    ep.usage = EP_USAGE[(attrs >> 4) & 3];
  }
  return ep;
}

/**
 * Parse a full configuration descriptor blob (as returned by GET_DESCRIPTOR
 * with wTotalLength) into IADs, interfaces, endpoints (+ SS companion) and
 * class-specific descriptors. Interface/endpoint shape matches `describeDevice`.
 */
export function parseConfigDescriptor(data, opts = {}) {
  const b = toBytes(data);
  const out = {
    totalLength: null, numInterfaces: null, configurationValue: null, iConfiguration: 0,
    bmAttributes: null, selfPowered: false, remoteWakeup: false, maxPowerMa: null,
    iads: [], interfaces: [], other: [], notes: []
  };
  const { items, notes } = walkDescriptors(b);
  out.notes.push(...notes);
  const first = items[0];
  if (!first || first.type !== DT.CONFIG || first.length < 9) {
    out.notes.push(first ? `malformed at offset 0: first descriptor is type ${hx(first.type)} (length ${first.length}), not a configuration` : 'malformed at offset 0: no configuration descriptor');
    return out;
  }
  const c = first.bytes;
  out.totalLength = u16(c, 2);
  out.numInterfaces = c[4];
  out.configurationValue = c[5];
  out.iConfiguration = c[6];
  out.bmAttributes = c[7];
  out.selfPowered = !!(c[7] & 0x40);
  out.remoteWakeup = !!(c[7] & 0x20);
  if (!(c[7] & 0x80)) out.notes.push('note: bmAttributes bit 7 (reserved, must be 1) is clear');
  out.maxPowerMa = c[8] * (opts.superSpeed ? 8 : 2);
  if (out.totalLength > b.length) out.notes.push(`note: wTotalLength ${out.totalLength} exceeds the ${b.length} bytes supplied (truncated read)`);

  let alt = null;
  let lastEp = null;
  const ifaces = new Map();
  for (const it of items.slice(1)) {
    const d = it.bytes;
    const at = it.offset;
    switch (it.type) {
      case DT.IAD:
        if (d.length >= 8) out.iads.push({ offset: at, firstInterface: d[2], interfaceCount: d[3], class: d[4], subclass: d[5], protocol: d[6], detail: classDetail(d[4], d[5], d[6]), iFunction: d[7] });
        else out.notes.push(`malformed at offset ${at}: IAD needs 8 bytes, got ${d.length}`);
        break;
      case DT.INTERFACE: {
        if (d.length < 9) { out.notes.push(`malformed at offset ${at}: interface descriptor needs 9 bytes, got ${d.length}`); alt = null; break; }
        let iface = ifaces.get(d[2]);
        if (!iface) { iface = { number: d[2], alternates: [] }; ifaces.set(d[2], iface); out.interfaces.push(iface); }
        alt = {
          offset: at, setting: d[3], numEndpoints: d[4], class: d[5], subclass: d[6], protocol: d[7],
          className: className(d[5]), detail: classDetail(d[5], d[6], d[7]), iInterface: d[8],
          endpoints: [], classSpecific: []
        };
        iface.alternates.push(alt);
        lastEp = null;
        break;
      }
      case DT.ENDPOINT:
        if (!alt) { out.notes.push(`malformed at offset ${at}: endpoint descriptor outside an interface`); break; }
        if (d.length < 7) { out.notes.push(`malformed at offset ${at}: endpoint descriptor needs 7 bytes, got ${d.length}`); break; }
        lastEp = describeParsedEndpoint(d);
        alt.endpoints.push(lastEp);
        break;
      case DT.SS_ENDPOINT_COMPANION:
        if (lastEp && d.length >= 6) lastEp.companion = { maxBurst: d[2], attributes: d[3], bytesPerInterval: u16(d, 4) };
        else out.notes.push(`malformed at offset ${at}: SuperSpeed endpoint companion without a preceding endpoint`);
        break;
      case DT.SSP_ISO_COMPANION:
        if (lastEp) lastEp.sspIsoCompanion = toHex(d);
        break;
      case DT.HID:
      case DT.CS_INTERFACE:
      case DT.CS_ENDPOINT:
      case DT.HUB:
      case DT.SS_HUB:
        if (alt) {
          const dec = decodeClassSpecific(d, alt.class, alt.subclass);
          dec.offset = at;
          // class-specific endpoint descriptors belong to the endpoint they follow
          if (it.type === DT.CS_ENDPOINT && lastEp) (lastEp.classSpecific = lastEp.classSpecific || []).push(dec);
          else alt.classSpecific.push(dec);
        } else out.other.push({ offset: at, type: it.type, hex: toHex(d) });
        break;
      default:
        out.other.push({ offset: at, type: it.type, hex: toHex(d) });
    }
  }
  for (const iface of out.interfaces) {
    for (const a of iface.alternates) {
      if (a.endpoints.length !== a.numEndpoints) out.notes.push(`note: interface ${iface.number}.${a.setting} declares ${a.numEndpoints} endpoint(s) but ${a.endpoints.length} were found`);
    }
  }
  return out;
}

/** lsusb -v style text from fetchRawDescriptors() output (strings optional). */
export function toLsusbText(raw, names = {}) {
  const L = [];
  const dev = raw.device;
  const str = (idx) => {
    if (!idx) return '';
    const langs = raw.strings ? Object.values(raw.strings) : [];
    const s = langs.map((m) => m[idx]).find((v) => v != null);
    return s != null ? ` ${s}` : '';
  };
  if (dev && dev.vendorId != null) {
    L.push(`ID ${formatId(dev.vendorId)}:${formatId(dev.productId)}${names.vendor ? ` ${names.vendor}` : ''}${names.product ? ` ${names.product}` : ''}`);
    L.push('Device Descriptor:');
    L.push('  bLength                18', '  bDescriptorType         1');
    L.push(`  bcdUSB              ${dev.usbVersion}`);
    L.push(`  bDeviceClass        ${String(dev.class).padStart(3)} ${dev.className}`);
    L.push(`  bDeviceSubClass     ${String(dev.subclass).padStart(3)}`, `  bDeviceProtocol     ${String(dev.protocol).padStart(3)}`);
    L.push(`  bMaxPacketSize0     ${String(dev.maxPacketSize0).padStart(3)}`);
    L.push(`  idVendor          ${hx(dev.vendorId, 4)}${names.vendor ? ` ${names.vendor}` : ''}`);
    L.push(`  idProduct         ${hx(dev.productId, 4)}${names.product ? ` ${names.product}` : ''}`);
    L.push(`  bcdDevice           ${dev.deviceVersion}`);
    L.push(`  iManufacturer       ${String(dev.iManufacturer).padStart(3)}${str(dev.iManufacturer)}`);
    L.push(`  iProduct            ${String(dev.iProduct).padStart(3)}${str(dev.iProduct)}`);
    L.push(`  iSerial             ${String(dev.iSerialNumber).padStart(3)}${str(dev.iSerialNumber)}`);
    L.push(`  bNumConfigurations  ${String(dev.numConfigurations).padStart(3)}`);
  }
  for (const cfg of raw.configs || []) {
    const c = cfg.parsed;
    L.push('  Configuration Descriptor:');
    L.push(`    wTotalLength      ${hx(c.totalLength ?? 0, 4)}`, `    bNumInterfaces      ${c.numInterfaces}`, `    bConfigurationValue ${c.configurationValue}`);
    L.push(`    iConfiguration      ${c.iConfiguration}${str(c.iConfiguration)}`);
    L.push(`    bmAttributes        ${hx(c.bmAttributes ?? 0)}${c.selfPowered ? ' (Self Powered)' : ''}${c.remoteWakeup ? ' (Remote Wakeup)' : ''}`);
    L.push(`    MaxPower            ${c.maxPowerMa}mA`);
    for (const ia of c.iads) L.push(`    Interface Association: first ${ia.firstInterface}, count ${ia.interfaceCount}, ${ia.detail}`);
    for (const iface of c.interfaces) {
      for (const a of iface.alternates) {
        L.push(`    Interface Descriptor: bInterfaceNumber ${iface.number}, bAlternateSetting ${a.setting}, bNumEndpoints ${a.numEndpoints}`);
        L.push(`      bInterfaceClass ${a.class} ${a.className}, SubClass ${a.subclass}, Protocol ${a.protocol} (${a.detail})${str(a.iInterface)}`);
        for (const cs of a.classSpecific) L.push(`      ${cs.name}${cs.reportDescriptorLength != null ? `: report descriptor ${cs.reportDescriptorLength} bytes` : ''}`);
        for (const ep of a.endpoints) {
          L.push(`      Endpoint Descriptor: bEndpointAddress ${ep.address} EP ${ep.number} ${ep.direction}, ${ep.type}, wMaxPacketSize ${ep.packetSize}, bInterval ${ep.interval}`);
          if (ep.companion) L.push(`        SuperSpeed companion: bMaxBurst ${ep.companion.maxBurst}, wBytesPerInterval ${ep.companion.bytesPerInterval}`);
        }
      }
    }
    for (const n of c.notes) L.push(`    ! ${n}`);
  }
  if (raw.bos && raw.bos.parsed) {
    L.push('  Binary Object Store Descriptor:');
    for (const cap of raw.bos.parsed.capabilities) {
      L.push(`    ${cap.name}`);
      if (cap.platform === 'WebUSB') L.push(`      WebUSB ${cap.version}, bVendorCode ${cap.vendorCode}, iLandingPage ${cap.landingPageIndex}`);
      if (cap.platform === 'Microsoft OS 2.0') L.push(`      MS OS 2.0: Windows ${hx(cap.windowsVersion, 8)}, descriptor set ${cap.descriptorSetTotalLength} bytes, bVendorCode ${cap.vendorCode}`);
    }
  }
  for (const n of raw.notes || []) L.push(`! ${n}`);
  return L.join('\n');
}

/**
 * Read the raw descriptors of a WebUSB device with standard, device-recipient
 * GET_DESCRIPTOR control reads only (never a control OUT, never a transfer).
 * Opens the device if needed (and closes it again if it opened it).
 * The WebUSB landing-page URL and MS OS 2.0 descriptor set need vendor
 * requests, so they are reported (vendor code, index, length) but not fetched.
 *
 * @param device anything shaped like a USBDevice
 */
export async function fetchRawDescriptors(device) {
  const notes = [];
  const out = { device: null, deviceBytes: null, qualifier: null, configs: [], bos: null, strings: {}, langIds: [], notes };
  let weOpened = false;
  try {
    if (!device.opened) {
      try { await device.open(); weOpened = true; } catch (e) {
        notes.push(`Could not open the device (${e.message || e}); raw descriptors need an open device (another driver may own it). Showing cached descriptors only.`);
        return out;
      }
    }
    const get = async (type, index, langId, length) => {
      try {
        const res = await device.controlTransferIn({
          requestType: 'standard', recipient: 'device', request: 0x06,
          value: (type << 8) | index, index: langId
        }, length);
        if (res.status !== 'ok' || !res.data) { notes.push(`GET_DESCRIPTOR ${hx(type)}/${index} returned ${res.status}`); return null; }
        return toBytes(res.data);
      } catch (e) {
        notes.push(`GET_DESCRIPTOR ${hx(type)}/${index} failed: ${e.message || e}`);
        return null;
      }
    };

    const devBytes = await get(DT.DEVICE, 0, 0, 18);
    if (devBytes) { out.deviceBytes = devBytes; out.device = parseDeviceDescriptor(devBytes); }
    const nCfg = out.device?.numConfigurations ?? (device.configurations?.length || 0);
    const superSpeed = (out.device?.bcdUSB ?? 0) >= 0x0300;

    for (let i = 0; i < nCfg; i++) {
      const head = await get(DT.CONFIG, i, 0, 9);
      if (!head || head.length < 4) continue;
      const total = Math.max(u16(head, 2), 9);
      const full = await get(DT.CONFIG, i, 0, total);
      if (full) out.configs.push({ index: i, bytes: full, parsed: parseConfigDescriptor(full, { superSpeed }) });
    }

    // The device qualifier only exists on USB 2.x devices.
    if (!superSpeed && (out.device?.bcdUSB ?? 0) >= 0x0200) {
      const q = await get(DT.QUALIFIER, 0, 0, 10);
      if (q) out.qualifier = { bytes: q, parsed: parseDeviceQualifier(q) };
    }

    if ((out.device?.bcdUSB ?? 0) >= 0x0201) {
      const bh = await get(DT.BOS, 0, 0, 5);
      if (bh && bh.length >= 5) {
        const total = Math.max(u16(bh, 2), 5);
        const bb = await get(DT.BOS, 0, 0, total);
        if (bb) out.bos = { bytes: bb, parsed: parseBos(bb) };
      }
    }

    const l0 = await get(DT.STRING, 0, 0, 255);
    if (l0) {
      out.langIds = parseLangIds(l0).slice(0, 16);
      const idxs = new Set();
      if (out.device) [out.device.iManufacturer, out.device.iProduct, out.device.iSerialNumber].forEach((x) => x && idxs.add(x));
      for (const cfg of out.configs) {
        if (cfg.parsed.iConfiguration) idxs.add(cfg.parsed.iConfiguration);
        for (const ia of cfg.parsed.iads) if (ia.iFunction) idxs.add(ia.iFunction);
        for (const iface of cfg.parsed.interfaces) for (const a of iface.alternates) if (a.iInterface) idxs.add(a.iInterface);
      }
      for (const lang of out.langIds) {
        const map = {};
        for (const idx of idxs) {
          const sb = await get(DT.STRING, idx, lang, 255);
          if (sb) map[idx] = parseStringDescriptor(sb).text;
        }
        out.strings[lang] = map;
      }
    }
  } finally {
    if (weOpened) { try { await device.close(); } catch (e) { /* already gone */ } }
  }
  return out;
}
