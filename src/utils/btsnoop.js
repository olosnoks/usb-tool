/**
 * Bluetooth HCI capture reader and decoder (offline, no hardware).
 *
 * Containers:
 *  - btsnoop v1 (Android "btsnoop_hci.log"): datalink 1002 (H4, indicator byte present)
 *    and 1001 (H1, no indicator; the packet type is rebuilt from the record flags).
 *  - pcap and pcapng with LINKTYPE_BLUETOOTH_HCI_H4_WITH_PHDR (201): each record starts
 *    with a 4-byte big-endian pseudo header whose bit 0 is the direction (1 = received).
 *
 * Decoding: H4 packet types (command, ACL, SCO, event, ISO), HCI commands and events,
 * LE meta events (connection complete, advertising reports with AD structures), ACL to
 * L2CAP reassembly (PB flags), ATT PDUs, SMP and L2CAP signalling names, and a GATT model
 * rebuilt from discovery responses (services, characteristics) plus per-handle access.
 *
 * Timestamps: relative times are exact. Wall-clock times depend on the btsnoop epoch
 * constant used by Wireshark (0 AD); treat them as approximate.
 *
 * All parsing is bounds-checked. Malformed data becomes a warning or a "truncated"
 * field, not an exception. Only input with no recognised magic number throws.
 */

const BTSNOOP_MAGIC = [0x62, 0x74, 0x73, 0x6e, 0x6f, 0x6f, 0x70, 0x00]; // "btsnoop\0"
// Microseconds from 0 AD to the Unix epoch, as used by Wireshark for btsnoop.
const BTSNOOP_EPOCH_US = 0x00dcddb30f2f8000n;
const LINKTYPE_H4_PHDR = 201;

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

const hb = (n) => (n & 0xff).toString(16).padStart(2, '0');
export const hex8 = (n) => `0x${hb(n)}`;
export const hex16 = (n) => `0x${(n & 0xffff).toString(16).padStart(4, '0')}`;

export function toHex(bytes, sep = ' ') {
  if (!bytes) return '';
  return Array.from(bytes, hb).join(sep);
}

const u16 = (p, o) => (o + 2 <= p.length ? p[o] | (p[o + 1] << 8) : null);
const u16be = (p, o) => (o + 2 <= p.length ? (p[o] << 8) | p[o + 1] : null);

function readU32(b, o, little) {
  const v = little
    ? b[o] + (b[o + 1] << 8) + (b[o + 2] << 16) + b[o + 3] * 0x1000000
    : b[o] * 0x1000000 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
  return v;
}

/** BD_ADDR / device address: stored little-endian on the wire, shown most-significant first. */
export function bdAddr(p, o) {
  if (o === null || o + 6 > p.length) return null;
  const parts = [];
  for (let i = 5; i >= 0; i--) parts.push(hb(p[o + i]).toUpperCase());
  return parts.join(':');
}

/** Printable UTF-8 text of a byte range, or null when it is not clean text. */
export function utf8Preview(bytes) {
  if (!bytes || bytes.length === 0) return '';
  let s;
  try {
    s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  return /^[\t\r\n\x20-\x7e -\u{10ffff}]*$/u.test(s) ? s : null;
}

export function hexDump(bytes) {
  const lines = [];
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.subarray(i, i + 16);
    const hexs = Array.from(chunk, hb).join(' ').padEnd(47, ' ');
    const asc = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${i.toString(16).padStart(4, '0')}  ${hexs}  ${asc}`);
  }
  return lines.join('\n');
}

function concat(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** UUID as a display string: '0x2800' for 16-bit (also base-UUID aliases), else canonical 128-bit. */
export function uuidStr(b) {
  if (!b || b.length === 0) return null;
  if (b.length === 2) return `0x${((b[1] << 8) | b[0]).toString(16).padStart(4, '0')}`;
  if (b.length === 4) {
    const v = readU32(b, 0, true);
    return `0x${v.toString(16).padStart(8, '0')}`;
  }
  if (b.length === 16) {
    let full = '';
    for (let i = 15; i >= 0; i--) full += hb(b[i]);
    if (full.startsWith('0000') && full.endsWith('00001000800000805f9b34fb')) return `0x${full.slice(4, 8)}`;
    return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20)}`;
  }
  return toHex(b);
}

// ---------------------------------------------------------------------------
// Name tables
// ---------------------------------------------------------------------------

const COMMAND_NAMES = {
  0x0401: 'Inquiry',
  0x0402: 'Inquiry Cancel',
  0x0405: 'Create Connection',
  0x0406: 'Disconnect',
  0x0408: 'Create Connection Cancel',
  0x0419: 'Remote Name Request',
  0x041d: 'Read Remote Version Information',
  0x0c01: 'Set Event Mask',
  0x0c03: 'Reset',
  0x0c05: 'Set Event Filter',
  0x0c13: 'Write Local Name',
  0x0c14: 'Read Local Name',
  0x0c1a: 'Write Scan Enable',
  0x0c24: 'Write Class Of Device',
  0x0c56: 'Write Simple Pairing Mode',
  0x0c63: 'Set Event Mask Page 2',
  0x0c6d: 'Write LE Host Support',
  0x1001: 'Read Local Version Information',
  0x1002: 'Read Local Supported Commands',
  0x1003: 'Read Local Supported Features',
  0x1004: 'Read Local Extended Features',
  0x1005: 'Read Buffer Size',
  0x1009: 'Read BD_ADDR',
  0x2001: 'LE Set Event Mask',
  0x2002: 'LE Read Buffer Size',
  0x2003: 'LE Read Local Supported Features',
  0x2005: 'LE Set Random Address',
  0x2006: 'LE Set Advertising Parameters',
  0x2007: 'LE Read Advertising Channel TX Power',
  0x2008: 'LE Set Advertising Data',
  0x2009: 'LE Set Scan Response Data',
  0x200a: 'LE Set Advertising Enable',
  0x200b: 'LE Set Scan Parameters',
  0x200c: 'LE Set Scan Enable',
  0x200d: 'LE Create Connection',
  0x200e: 'LE Create Connection Cancel',
  0x200f: 'LE Read Filter Accept List Size',
  0x2010: 'LE Clear Filter Accept List',
  0x2011: 'LE Add Device To Filter Accept List',
  0x2012: 'LE Remove Device From Filter Accept List',
  0x2013: 'LE Connection Update',
  0x2014: 'LE Set Host Channel Classification',
  0x2015: 'LE Read Channel Map',
  0x2016: 'LE Read Remote Features',
  0x2017: 'LE Encrypt',
  0x2018: 'LE Rand',
  0x2019: 'LE Start Encryption',
  0x201a: 'LE Long Term Key Request Reply',
  0x201b: 'LE Long Term Key Request Negative Reply',
  0x2022: 'LE Set Data Length',
  0x2023: 'LE Read Suggested Default Data Length',
  0x2024: 'LE Write Suggested Default Data Length',
};

const EVENT_NAMES = {
  0x01: 'Inquiry Complete',
  0x02: 'Inquiry Result',
  0x03: 'Connection Complete',
  0x05: 'Disconnection Complete',
  0x07: 'Remote Name Request Complete',
  0x08: 'Encryption Change',
  0x0c: 'Read Remote Version Information Complete',
  0x0e: 'Command Complete',
  0x0f: 'Command Status',
  0x10: 'Hardware Error',
  0x13: 'Number Of Completed Packets',
  0x1a: 'Data Buffer Overflow',
  0x3e: 'LE Meta Event',
  0xff: 'Vendor Specific',
};

const LE_META_NAMES = {
  0x01: 'LE Connection Complete',
  0x02: 'LE Advertising Report',
  0x03: 'LE Connection Update Complete',
  0x04: 'LE Read Remote Features Complete',
  0x05: 'LE Long Term Key Request',
  0x06: 'LE Remote Connection Parameter Request',
  0x07: 'LE Data Length Change',
  0x08: 'LE Read Local P-256 Public Key Complete',
  0x09: 'LE Generate DHKey Complete',
  0x0a: 'LE Enhanced Connection Complete',
  0x0b: 'LE Directed Advertising Report',
  0x0c: 'LE PHY Update Complete',
  0x0d: 'LE Extended Advertising Report',
};

const STATUS_NAMES = {
  0x00: 'Success',
  0x01: 'Unknown HCI Command',
  0x02: 'Unknown Connection Identifier',
  0x05: 'Authentication Failure',
  0x06: 'PIN or Key Missing',
  0x08: 'Connection Timeout',
  0x0c: 'Command Disallowed',
  0x10: 'Connection Accept Timeout',
  0x13: 'Remote User Terminated Connection',
  0x14: 'Remote Device Terminated (low resources)',
  0x15: 'Remote Device Terminated (power off)',
  0x16: 'Connection Terminated By Local Host',
  0x22: 'LL Response Timeout',
  0x3b: 'Unacceptable Connection Parameters',
  0x3d: 'Connection Terminated due to MIC Failure',
  0x3e: 'Connection Failed to be Established',
};

const ATT_OPCODE_NAMES = {
  0x01: 'Error Response',
  0x02: 'Exchange MTU Request',
  0x03: 'Exchange MTU Response',
  0x04: 'Find Information Request',
  0x05: 'Find Information Response',
  0x06: 'Find By Type Value Request',
  0x07: 'Find By Type Value Response',
  0x08: 'Read By Type Request',
  0x09: 'Read By Type Response',
  0x0a: 'Read Request',
  0x0b: 'Read Response',
  0x0c: 'Read Blob Request',
  0x0d: 'Read Blob Response',
  0x0e: 'Read Multiple Request',
  0x0f: 'Read Multiple Response',
  0x10: 'Read By Group Type Request',
  0x11: 'Read By Group Type Response',
  0x12: 'Write Request',
  0x13: 'Write Response',
  0x16: 'Prepare Write Request',
  0x17: 'Prepare Write Response',
  0x18: 'Execute Write Request',
  0x19: 'Execute Write Response',
  0x1b: 'Handle Value Notification',
  0x1d: 'Handle Value Indication',
  0x1e: 'Handle Value Confirmation',
  0x52: 'Write Command',
  0xd2: 'Signed Write Command',
};

const ATT_ERROR_NAMES = {
  0x01: 'Invalid Handle',
  0x02: 'Read Not Permitted',
  0x03: 'Write Not Permitted',
  0x04: 'Invalid PDU',
  0x05: 'Insufficient Authentication',
  0x06: 'Request Not Supported',
  0x07: 'Invalid Offset',
  0x08: 'Insufficient Authorization',
  0x09: 'Prepare Queue Full',
  0x0a: 'Attribute Not Found',
  0x0b: 'Attribute Not Long',
  0x0c: 'Insufficient Encryption Key Size',
  0x0d: 'Invalid Attribute Value Length',
  0x0e: 'Unlikely Error',
  0x0f: 'Insufficient Encryption',
  0x10: 'Unsupported Group Type',
  0x11: 'Insufficient Resources',
};

const ATT_REQUEST_OPS = new Set([0x02, 0x04, 0x06, 0x08, 0x0a, 0x0c, 0x0e, 0x10, 0x12, 0x16, 0x18]);

const SMP_NAMES = {
  0x01: 'Pairing Request',
  0x02: 'Pairing Response',
  0x03: 'Pairing Confirm',
  0x04: 'Pairing Random',
  0x05: 'Pairing Failed',
  0x06: 'Encryption Information',
  0x07: 'Central Identification',
  0x08: 'Identity Information',
  0x09: 'Identity Address Information',
  0x0a: 'Signing Information',
  0x0b: 'Security Request',
  0x0c: 'Pairing Public Key',
  0x0d: 'Pairing DHKey Check',
  0x0e: 'Keypress Notification',
};

const SMP_FAILED_NAMES = {
  0x01: 'Passkey Entry Failed',
  0x02: 'OOB Not Available',
  0x03: 'Authentication Requirements',
  0x04: 'Confirm Value Failed',
  0x05: 'Pairing Not Supported',
  0x06: 'Encryption Key Size',
  0x07: 'Command Not Supported',
  0x08: 'Unspecified Reason',
  0x09: 'Repeated Attempts',
  0x0a: 'Invalid Parameters',
  0x0b: 'DHKey Check Failed',
  0x0c: 'Numeric Comparison Failed',
};

const IO_CAP_NAMES = ['DisplayOnly', 'DisplayYesNo', 'KeyboardOnly', 'NoInputNoOutput', 'KeyboardDisplay'];

const SIG_NAMES = {
  0x01: 'Command Reject',
  0x02: 'Connection Request',
  0x03: 'Connection Response',
  0x04: 'Configure Request',
  0x05: 'Configure Response',
  0x06: 'Disconnection Request',
  0x07: 'Disconnection Response',
  0x08: 'Echo Request',
  0x09: 'Echo Response',
  0x0a: 'Information Request',
  0x0b: 'Information Response',
  0x0c: 'Create Channel Request',
  0x0d: 'Create Channel Response',
  0x12: 'Connection Parameter Update Request',
  0x13: 'Connection Parameter Update Response',
  0x14: 'LE Credit Based Connection Request',
  0x15: 'LE Credit Based Connection Response',
  0x16: 'LE Flow Control Credit',
};

const CID_NAMES = {
  0x0001: 'BR/EDR signalling',
  0x0002: 'Connectionless',
  0x0003: 'AMP manager',
  0x0004: 'ATT',
  0x0005: 'LE signalling',
  0x0006: 'SMP',
  0x0007: 'BR/EDR SMP',
};

const UUID_NAMES = {
  '0x1800': 'Generic Access',
  '0x1801': 'Generic Attribute',
  '0x180a': 'Device Information',
  '0x180d': 'Heart Rate',
  '0x180f': 'Battery Service',
  '0x1812': 'Human Interface Device',
  '0x2800': 'Primary Service',
  '0x2801': 'Secondary Service',
  '0x2802': 'Include',
  '0x2803': 'Characteristic',
  '0x2900': 'Characteristic Extended Properties',
  '0x2901': 'Characteristic User Description',
  '0x2902': 'Client Characteristic Configuration (CCCD)',
  '0x2903': 'Server Characteristic Configuration',
  '0x2904': 'Characteristic Presentation Format',
  '0x2a00': 'Device Name',
  '0x2a01': 'Appearance',
  '0x2a04': 'Peripheral Preferred Connection Parameters',
  '0x2a05': 'Service Changed',
  '0x2a19': 'Battery Level',
  '0x2a24': 'Model Number String',
  '0x2a25': 'Serial Number String',
  '0x2a26': 'Firmware Revision String',
  '0x2a27': 'Hardware Revision String',
  '0x2a28': 'Software Revision String',
  '0x2a29': 'Manufacturer Name String',
  '0x2a37': 'Heart Rate Measurement',
  '0x2a4d': 'Report',
  '0x2a50': 'PnP ID',
};

/** Bluetooth SIG company identifiers (subset). Unlisted IDs show as numbers. */
const COMPANY_NAMES = {
  0x0001: 'Nokia Mobile Phones',
  0x0002: 'Intel Corp.',
  0x0003: 'IBM Corp.',
  0x0004: 'Toshiba Corp.',
  0x0005: '3Com',
  0x0006: 'Microsoft',
  0x0007: 'Lucent',
  0x0008: 'Motorola',
  0x0009: 'Infineon Technologies',
  0x000a: 'Cambridge Silicon Radio',
  0x000d: 'Texas Instruments',
  0x000f: 'Broadcom Corporation',
  0x0013: 'Atmel',
  0x0059: 'Nordic Semiconductor ASA',
  0x0075: 'Samsung Electronics Co. Ltd.',
  0x0087: 'Garmin International',
  0x00e0: 'Google',
  0x012d: 'Sony Corporation',
  0x0157: 'Anhui Huami (Xiaomi wearables)',
  0x0171: 'Amazon.com Services',
  0x038f: 'Xiaomi Inc.',
  0x0499: 'Ruuvi Innovations',
  0x004c: 'Apple Inc.',
  0x02e5: 'Espressif Systems',
};

const AD_TYPE_NAMES = {
  0x01: 'Flags',
  0x02: 'Incomplete list of 16-bit service UUIDs',
  0x03: 'Complete list of 16-bit service UUIDs',
  0x04: 'Incomplete list of 32-bit service UUIDs',
  0x05: 'Complete list of 32-bit service UUIDs',
  0x06: 'Incomplete list of 128-bit service UUIDs',
  0x07: 'Complete list of 128-bit service UUIDs',
  0x08: 'Shortened local name',
  0x09: 'Complete local name',
  0x0a: 'TX power level',
  0x0d: 'Class of device',
  0x12: 'Peripheral connection interval range',
  0x16: 'Service data (16-bit UUID)',
  0x19: 'Appearance',
  0x1b: 'LE Bluetooth device address',
  0x20: 'Service data (32-bit UUID)',
  0x21: 'Service data (128-bit UUID)',
  0xff: 'Manufacturer specific data',
};

const ADDR_TYPE_NAMES = ['Public', 'Random', 'Public identity', 'Random identity'];
const ROLE_NAMES = ['Central', 'Peripheral'];
const ADV_EVENT_NAMES = ['ADV_IND', 'ADV_DIRECT_IND', 'ADV_SCAN_IND', 'ADV_NONCONN_IND', 'SCAN_RSP'];
const PHY_NAMES = { 1: 'LE 1M', 2: 'LE 2M', 3: 'LE Coded' };
const PB_NAMES = ['start (host to controller)', 'continuation', 'start (controller to host)', 'reserved'];
const BC_NAMES = ['point-to-point', 'active broadcast', 'piconet broadcast', 'reserved'];
const PROP_NAMES = [
  [0x01, 'Broadcast'],
  [0x02, 'Read'],
  [0x04, 'Write Without Response'],
  [0x08, 'Write'],
  [0x10, 'Notify'],
  [0x20, 'Indicate'],
  [0x40, 'Authenticated Signed Writes'],
  [0x80, 'Extended Properties'],
];

export function commandName(opcode) {
  return COMMAND_NAMES[opcode] || `Unknown command ${hex16(opcode)}`;
}

export function statusText(code) {
  if (code === null || code === undefined) return 'n/a';
  return `${hex8(code)} ${STATUS_NAMES[code] || 'Unknown status'}`;
}

export function uuidName(str) {
  return (str && UUID_NAMES[str]) || null;
}

export function propNames(props) {
  return PROP_NAMES.filter(([bit]) => props & bit).map(([, n]) => n);
}

export function companyName(id) {
  return COMPANY_NAMES[id] || `Unknown (${hex16(id)})`;
}

function fmtInterval(v) {
  return v === null ? 'n/a' : `${(v * 1.25).toFixed(2)} ms`;
}
function fmtTimeout(v) {
  return v === null ? 'n/a' : `${v * 10} ms`;
}
function fmtScan(v) {
  return v === null ? 'n/a' : `${(v * 0.625).toFixed(3)} ms`;
}
function addrTypeName(t) {
  return t === null || t === undefined ? 'n/a' : ADDR_TYPE_NAMES[t] || `Type ${t}`;
}
function roleName(r) {
  return ROLE_NAMES[r] || 'n/a';
}
const dash = (v, f = (x) => String(x)) => (v === null || v === undefined ? 'n/a' : f(v));

// ---------------------------------------------------------------------------
// Container parsing
// ---------------------------------------------------------------------------

function isBtsnoop(b) {
  return b.length >= 16 && BTSNOOP_MAGIC.every((m, i) => b[i] === m);
}

function isPcapng(b) {
  return b.length >= 12 && b[0] === 0x0a && b[1] === 0x0d && b[2] === 0x0d && b[3] === 0x0a;
}

function pcapMagic(b) {
  if (b.length < 24) return null;
  const m = readU32(b, 0, true);
  if (m === 0xa1b2c3d4) return { little: true, nano: false };
  if (m === 0xa1b23c4d) return { little: true, nano: true };
  if (m === 0xd4c3b2a1) return { little: false, nano: false };
  if (m === 0x4d3cb2a1) return { little: false, nano: true };
  return null;
}

function parseBtsnoop(b, warnings) {
  const version = readU32(b, 8, false);
  const datalink = readU32(b, 12, false);
  if (version !== 1) warnings.push(`btsnoop version ${version} is not v1; parsing it as v1`);
  if (datalink !== 1002 && datalink !== 1001) {
    throw new Error(`Unsupported btsnoop datalink ${datalink} (expected 1002 H4 or 1001 H1)`);
  }
  const records = [];
  let off = 16;
  let assumedAcl = 0;
  while (off + 24 <= b.length) {
    const origLen = readU32(b, off, false);
    const inclLen = readU32(b, off + 4, false);
    const flags = readU32(b, off + 8, false);
    const ts = (BigInt(readU32(b, off + 16, false)) << 32n) | BigInt(readU32(b, off + 20, false));
    off += 24;
    if (inclLen > b.length - off) {
      warnings.push(`Truncated record at byte ${off - 24}: ${inclLen} bytes declared, ${b.length - off} left. Stopped here.`);
      break;
    }
    const data = b.subarray(off, off + inclLen);
    off += inclLen;
    const received = (flags & 1) === 1;
    const isCmdEvt = (flags & 2) === 2;
    let h4;
    if (datalink === 1002) {
      h4 = data;
    } else {
      // H1 carries no indicator; rebuild it from the flags. Data without the command/event
      // bit is ACL or SCO and cannot be told apart in H1, so it is assumed ACL.
      let ind;
      if (isCmdEvt) ind = received ? 0x04 : 0x01;
      else {
        ind = 0x02;
        assumedAcl++;
      }
      h4 = concat([Uint8Array.of(ind), data]);
    }
    records.push({
      origLen,
      direction: received ? 'received' : 'sent',
      unixUs: ts - BTSNOOP_EPOCH_US,
      h4,
    });
  }
  if (assumedAcl) warnings.push(`H1 datalink: ${assumedAcl} data record(s) assumed to be ACL`);
  return { format: 'btsnoop', linkType: datalink, records };
}

function pcapRecordFromPayload(pkt, unixUs, origLen, records, warnings, index) {
  if (pkt.length < 5) {
    warnings.push(`Record ${index}: too short for the H4 pseudo header`);
    return;
  }
  const dirFlags = readU32(pkt, 0, false);
  records.push({
    origLen,
    direction: (dirFlags & 1) === 1 ? 'received' : 'sent',
    unixUs,
    h4: pkt.subarray(4),
  });
}

function parsePcap(b, warnings) {
  const { little, nano } = pcapMagic(b);
  const linkType = readU32(b, 20, little);
  if (linkType !== LINKTYPE_H4_PHDR) {
    throw new Error(`Unsupported pcap link type ${linkType} (only 201, H4 with pseudo-header, is supported)`);
  }
  const records = [];
  let off = 24;
  let index = 0;
  while (off + 16 <= b.length) {
    const sec = readU32(b, off, little);
    const sub = readU32(b, off + 4, little);
    const incl = readU32(b, off + 8, little);
    const orig = readU32(b, off + 12, little);
    off += 16;
    index++;
    if (incl > b.length - off) {
      warnings.push(`Truncated pcap record ${index}. Stopped here.`);
      break;
    }
    const pkt = b.subarray(off, off + incl);
    off += incl;
    const unixUs = BigInt(sec) * 1000000n + BigInt(nano ? Math.floor(sub / 1000) : sub);
    pcapRecordFromPayload(pkt, unixUs, orig, records, warnings, index);
  }
  return { format: 'pcap', linkType, records };
}

function parseOptions(b, start, end, little) {
  const opts = new Map();
  let p = start;
  while (p + 4 <= end) {
    const code = little ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1];
    const len = little ? b[p + 2] | (b[p + 3] << 8) : (b[p + 2] << 8) | b[p + 3];
    if (code === 0) break;
    opts.set(code, b.subarray(p + 4, Math.min(end, p + 4 + len)));
    p += 4 + len + ((4 - (len % 4)) % 4);
  }
  return opts;
}

function parsePcapng(b, warnings) {
  let little = true;
  const ifaces = [];
  const records = [];
  let off = 0;
  let lastUs = 0n;
  let skipped = 0;
  let index = 0;
  while (off + 12 <= b.length) {
    const isShb = b[off] === 0x0a && b[off + 1] === 0x0d && b[off + 2] === 0x0d && b[off + 3] === 0x0a;
    if (isShb) {
      if (readU32(b, off + 8, true) === 0x1a2b3c4d) little = true;
      else if (readU32(b, off + 8, false) === 0x1a2b3c4d) little = false;
      else throw new Error('pcapng byte-order magic not recognised');
      ifaces.length = 0;
    }
    const type = readU32(b, off, little);
    const total = readU32(b, off + 4, little);
    if (total < 12 || total % 4 !== 0 || off + total > b.length) {
      warnings.push(`Malformed pcapng block at byte ${off}. Stopped here.`);
      break;
    }
    const body = off + 8;
    const end = off + total - 4;
    if (isShb) {
      // Section header: nothing more to read.
    } else if (type === 1) {
      const linkType = little ? b[body] | (b[body + 1] << 8) : (b[body] << 8) | b[body + 1];
      const opts = parseOptions(b, body + 8, end, little);
      const res = opts.get(9);
      const r = res && res.length ? res[0] : 6;
      const tps = r & 0x80 ? 1n << BigInt(r & 0x7f) : 10n ** BigInt(r);
      ifaces.push({ linkType, tps });
    } else if (type === 6) {
      index++;
      const ifId = readU32(b, body, little);
      const hi = readU32(b, body + 4, little);
      const lo = readU32(b, body + 8, little);
      const capLen = readU32(b, body + 12, little);
      const origLen = readU32(b, body + 16, little);
      const iface = ifaces[ifId];
      if (!iface) {
        warnings.push(`Packet ${index} refers to unknown interface ${ifId}`);
      } else if (iface.linkType !== LINKTYPE_H4_PHDR) {
        skipped++;
      } else if (body + 20 + capLen <= end) {
        const ticks = (BigInt(hi) << 32n) | BigInt(lo);
        const unixUs = (ticks * 1000000n) / iface.tps;
        lastUs = unixUs;
        pcapRecordFromPayload(b.subarray(body + 20, body + 20 + capLen), unixUs, origLen, records, warnings, index);
      }
    } else if (type === 3) {
      index++;
      const origLen = readU32(b, body, little);
      const iface = ifaces[0];
      if (iface && iface.linkType === LINKTYPE_H4_PHDR) {
        pcapRecordFromPayload(b.subarray(body + 4, end), lastUs, origLen, records, warnings, index);
      } else {
        skipped++;
      }
    }
    off += total;
  }
  if (!ifaces.some((i) => i.linkType === LINKTYPE_H4_PHDR)) {
    throw new Error('pcapng file has no interface with link type 201 (H4 with pseudo-header)');
  }
  if (skipped) warnings.push(`${skipped} pcapng packet(s) on other link types were skipped`);
  return { format: 'pcapng', linkType: LINKTYPE_H4_PHDR, records };
}

/**
 * Parse a capture file. Returns records normalised to H4 bytes (indicator included).
 * @param {ArrayBuffer|Uint8Array} input
 */
export function parseCapture(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const warnings = [];
  let cap;
  if (isBtsnoop(bytes)) cap = parseBtsnoop(bytes, warnings);
  else if (isPcapng(bytes)) cap = parsePcapng(bytes, warnings);
  else if (pcapMagic(bytes)) cap = parsePcap(bytes, warnings);
  else throw new Error('Not a btsnoop, pcap or pcapng file (no recognised magic number)');

  let t0 = null;
  let last = 0;
  const records = cap.records.map((r, i) => {
    if (r.unixUs !== null && t0 === null) t0 = r.unixUs;
    if (r.unixUs !== null) last = Number(r.unixUs - t0);
    return { index: i, origLen: r.origLen, direction: r.direction, h4: r.h4, unixUs: r.unixUs, relUs: last };
  });
  return { format: cap.format, linkType: cap.linkType, warnings, records };
}

// ---------------------------------------------------------------------------
// Packet decoders (one H4 packet, no state)
// ---------------------------------------------------------------------------

const truncated = (type, bytes) => ({
  type,
  name: 'Truncated packet',
  summary: 'Truncated packet',
  fields: [['Bytes', toHex(bytes) || '(none)']],
  sub: [],
  handle: null,
});

/** Parse one advertising AD structure list. Each item: {type, typeName, value, fields}. */
export function parseAdStructures(data) {
  const items = [];
  let i = 0;
  while (i < data.length) {
    const len = data[i];
    if (len === 0) break;
    if (i + 1 + len > data.length) {
      items.push({
        type: -1,
        typeName: 'Truncated AD structure',
        value: toHex(data.subarray(i)),
        fields: [['Warning', `length ${len} runs past the end of the data`]],
      });
      break;
    }
    const type = data[i + 1];
    const body = data.subarray(i + 2, i + 1 + len);
    items.push(decodeAdStructure(type, body));
    i += 1 + len;
  }
  return items;
}

function decodeAdStructure(type, body) {
  const typeName = AD_TYPE_NAMES[type] || `Type ${hex8(type)}`;
  const item = { type, typeName, value: '', fields: [] };
  const list = (step, fmt) => {
    const out = [];
    for (let o = 0; o + step <= body.length; o += step) out.push(fmt(body.subarray(o, o + step)));
    return out;
  };
  switch (type) {
    case 0x01: {
      const bits = [
        [0x01, 'LE Limited Discoverable'],
        [0x02, 'LE General Discoverable'],
        [0x04, 'BR/EDR not supported'],
        [0x08, 'Simultaneous LE and BR/EDR (controller)'],
        [0x10, 'Simultaneous LE and BR/EDR (host)'],
      ];
      const names = bits.filter(([bit]) => body[0] & bit).map(([, n]) => n);
      item.value = names.length ? names.join(', ') : `none (${hex8(body[0] || 0)})`;
      break;
    }
    case 0x02:
    case 0x03:
      item.value = list(2, (b) => uuidStr(b) + (uuidName(uuidStr(b)) ? ` ${uuidName(uuidStr(b))}` : '')).join(', ');
      break;
    case 0x04:
    case 0x05:
      item.value = list(4, (b) => uuidStr(b)).join(', ');
      break;
    case 0x06:
    case 0x07:
      item.value = list(16, (b) => uuidStr(b)).join(', ');
      break;
    case 0x08:
    case 0x09:
      item.value = utf8Preview(body) ?? toHex(body);
      break;
    case 0x0a:
      item.value = body.length ? `${(body[0] << 24) >> 24} dBm` : '';
      break;
    case 0x16:
      item.value = `${uuidStr(body.subarray(0, 2))} ${toHex(body.subarray(2))}`;
      break;
    case 0x19:
      item.value = body.length >= 2 ? hex16(body[0] | (body[1] << 8)) : toHex(body);
      break;
    case 0x1b:
      item.value = `${bdAddr(body, 0) ?? toHex(body)} (${addrTypeName(body[6])})`;
      break;
    case 0x20:
    case 0x21:
      item.value = `${type === 0x20 ? uuidStr(body.subarray(0, 4)) : uuidStr(body.subarray(0, 16))} ${toHex(body.subarray(type === 0x20 ? 4 : 16))}`;
      break;
    case 0xff: {
      const id = u16(body, 0);
      if (id === null) {
        item.value = toHex(body);
      } else {
        item.value = `${companyName(id)}: ${toHex(body.subarray(2))}`;
        item.fields.push(['Company ID', `${hex16(id)} ${companyName(id)}`]);
      }
      break;
    }
    default:
      item.value = toHex(body);
  }
  item.fields.unshift(['Type', `${hex8(type)} ${typeName}`], ['Value', item.value || '(empty)']);
  return item;
}

const adNode = (item) => ({ title: `${item.typeName}: ${item.value}`, fields: item.fields, sub: [] });

function decodeCommand(p) {
  const opcode = u16(p, 0);
  if (opcode === null) return truncated('cmd', p);
  const ogf = opcode >> 10;
  const ocf = opcode & 0x3ff;
  const name = COMMAND_NAMES[opcode] || `Unknown command (OGF ${hex8(ogf)}, OCF ${ocf.toString(16).padStart(4, '0')})`;
  const plen = p.length > 2 ? p[2] : 0;
  const params = p.subarray(3, 3 + plen);
  const fields = [
    ['Opcode', `${hex16(opcode)} (OGF 0x${ogf.toString(16)}, OCF 0x${ocf.toString(16).padStart(4, '0')})`],
    ['Parameter length', String(plen)],
  ];
  if (plen !== Math.max(0, p.length - 3)) {
    fields.push(['Warning', `length byte says ${plen}, packet carries ${Math.max(0, p.length - 3)}`]);
  }
  const extra = commandParams(opcode, params);
  fields.push(...extra.fields);
  return { type: 'cmd', name, opcode, summary: `${name} ${hex16(opcode)}`, fields, sub: extra.sub, handle: extra.handle ?? null };
}

function commandParams(opcode, p) {
  const f = [];
  const sub = [];
  let handle = null;
  const raw = () => f.push(['Parameters', toHex(p) || '(none)']);
  switch (opcode) {
    case 0x0406: // Disconnect
      handle = u16(p, 0);
      f.push(['Handle', dash(handle, hex16)], ['Reason', p.length > 2 ? statusText(p[2]) : 'n/a']);
      break;
    case 0x0405: // Create Connection (BR/EDR)
      f.push(['BD_ADDR', dash(bdAddr(p, 0))]);
      break;
    case 0x0419: // Remote Name Request
      f.push(['BD_ADDR', dash(bdAddr(p, 0))]);
      break;
    case 0x0c13: // Write Local Name
      f.push(['Name', utf8Preview(p.subarray(0, p.indexOf(0) < 0 ? p.length : p.indexOf(0))) ?? toHex(p)]);
      break;
    case 0x0c1a: // Write Scan Enable
      f.push(['Scan enable', dash(p[0], (v) => `${hex8(v)}${v & 1 ? ' inquiry' : ''}${v & 2 ? ' page' : ''}`)]);
      break;
    case 0x200a: // LE Set Advertising Enable
      f.push(['Enable', p.length ? (p[0] ? 'yes' : 'no') : 'n/a']);
      break;
    case 0x200b: // LE Set Scan Parameters
      f.push(
        ['Scan type', p[0] === 1 ? 'active' : p[0] === 0 ? 'passive' : 'n/a'],
        ['Scan interval', fmtScan(u16(p, 1))],
        ['Scan window', fmtScan(u16(p, 3))],
        ['Own address type', addrTypeName(p[5])],
        ['Filter policy', dash(p[6])],
      );
      break;
    case 0x200c: // LE Set Scan Enable
      f.push(['Enable', p.length ? (p[0] ? 'yes' : 'no') : 'n/a'], ['Filter duplicates', p.length > 1 ? (p[1] ? 'yes' : 'no') : 'n/a']);
      break;
    case 0x200d: // LE Create Connection
      f.push(
        ['Scan interval', fmtScan(u16(p, 0))],
        ['Scan window', fmtScan(u16(p, 2))],
        ['Filter policy', dash(p[4])],
        ['Peer address type', addrTypeName(p[5])],
        ['Peer address', dash(bdAddr(p, 6))],
        ['Own address type', addrTypeName(p[12])],
        ['Connection interval', `${fmtInterval(u16(p, 13))} to ${fmtInterval(u16(p, 15))}`],
        ['Peripheral latency', dash(u16(p, 17))],
        ['Supervision timeout', fmtTimeout(u16(p, 19))],
      );
      break;
    case 0x2006: // LE Set Advertising Parameters
      f.push(
        ["Interval min", fmtScan(u16(p, 0))],
        ["Interval max", fmtScan(u16(p, 2))],
        ['Advertising type', dash(p[4])],
        ['Own address type', addrTypeName(p[5])],
        ['Channel map', dash(p[13], hex8)],
      );
      break;
    case 0x2008: // LE Set Advertising Data
    case 0x2009: { // LE Set Scan Response Data
      const len = p.length ? p[0] : 0;
      const data = p.subarray(1, 1 + len);
      f.push(['Data length', String(len)]);
      const items = parseAdStructures(data);
      sub.push({ title: 'Advertising data structures', fields: [], sub: items.map(adNode) });
      break;
    }
    case 0x2013: // LE Connection Update
      handle = u16(p, 0);
      f.push(
        ['Handle', dash(handle, hex16)],
        ['Connection interval', `${fmtInterval(u16(p, 2))} to ${fmtInterval(u16(p, 4))}`],
        ['Peripheral latency', dash(u16(p, 6))],
        ['Supervision timeout', fmtTimeout(u16(p, 8))],
      );
      break;
    case 0x2005: // LE Set Random Address
      f.push(['Random address', dash(bdAddr(p, 0))]);
      break;
    case 0x2016: // LE Read Remote Features
      handle = u16(p, 0);
      f.push(['Handle', dash(handle, hex16)]);
      break;
    case 0x2022: // LE Set Data Length
      handle = u16(p, 0);
      f.push(['Handle', dash(handle, hex16)], ['TX octets', dash(u16(p, 2))], ['TX time', dash(u16(p, 4), (v) => `${v} us`)]);
      break;
    default:
      raw();
  }
  return { fields: f, sub, handle };
}

function decodeEvent(p) {
  const code = p.length ? p[0] : null;
  if (code === null) return truncated('evt', p);
  const plen = p.length > 1 ? p[1] : 0;
  const params = p.subarray(2, 2 + plen);
  const name = EVENT_NAMES[code] || `Event ${hex8(code)}`;
  const fields = [['Event code', `${hex8(code)} ${name}`], ['Parameter length', String(plen)]];
  if (plen !== Math.max(0, p.length - 2)) {
    fields.push(['Warning', `length byte says ${plen}, packet carries ${Math.max(0, p.length - 2)}`]);
  }
  const out = { type: 'evt', name, code, fields, sub: [], handle: null, summary: name, conn: null };
  switch (code) {
    case 0x0e: {
      const opcode = u16(params, 1);
      const cn = opcode === null ? 'n/a' : commandName(opcode);
      const st = params[3];
      fields.push(['Commands allowed', dash(params[0])], ['Command', `${cn} ${dash(opcode, hex16)}`]);
      if (st !== undefined) fields.push(['Status', statusText(st)]);
      if (opcode === 0x1009 && params.length >= 10) fields.push(['BD_ADDR', bdAddr(params, 4)]);
      out.summary = `Command Complete: ${cn}${st !== undefined ? ` - ${statusText(st)}` : ''}`;
      break;
    }
    case 0x0f: {
      const opcode = u16(params, 2);
      const cn = opcode === null ? 'n/a' : commandName(opcode);
      fields.push(['Status', statusText(params[0])], ['Commands allowed', dash(params[1])], ['Command', `${cn} ${dash(opcode, hex16)}`]);
      out.summary = `Command Status: ${cn} - ${statusText(params[0])}`;
      break;
    }
    case 0x03: { // BR/EDR Connection Complete
      const status = params[0];
      const handle = u16(params, 1);
      const addr = bdAddr(params, 3);
      const linkType = params[9];
      fields.push(['Status', statusText(status)], ['Handle', dash(handle, hex16)], ['BD_ADDR', dash(addr)], ['Link type', linkType === 1 ? 'ACL' : linkType === 0 ? 'SCO' : dash(linkType)]);
      out.handle = handle;
      if (status === 0 && linkType === 1) {
        out.conn = { kind: 'connect', transport: 'BR/EDR', status, handle, role: null, peerAddrType: 0, peerAddr: addr, interval: null, latency: null, timeout: null };
      }
      out.summary = `Connection Complete ${dash(handle, hex16)} ${addr ?? ''} ${statusText(status)}`;
      break;
    }
    case 0x05: { // Disconnection Complete
      const status = params[0];
      const handle = u16(params, 1);
      const reason = params[3];
      fields.push(['Status', statusText(status)], ['Handle', dash(handle, hex16)], ['Reason', reason === undefined ? 'n/a' : statusText(reason)]);
      out.handle = handle;
      out.conn = { kind: 'disconnect', handle, status, reason };
      out.summary = `Disconnection Complete ${dash(handle, hex16)} reason ${reason === undefined ? 'n/a' : statusText(reason)}`;
      break;
    }
    case 0x08: { // Encryption Change
      const handle = u16(params, 1);
      fields.push(['Status', statusText(params[0])], ['Handle', dash(handle, hex16)], ['Encryption', params[3] ? 'enabled' : 'disabled']);
      out.handle = handle;
      out.summary = `Encryption Change ${dash(handle, hex16)} ${params[3] ? 'enabled' : 'disabled'}`;
      break;
    }
    case 0x13: { // Number of Completed Packets
      const n = params[0] ?? 0;
      for (let i = 0; i < n; i++) {
        const h = u16(params, 1 + i * 4);
        const c = u16(params, 3 + i * 4);
        if (h === null || c === null) break;
        fields.push([`Handle ${hex16(h)}`, `${c} packet(s)`]);
      }
      out.summary = `Number of Completed Packets (${n} handle(s))`;
      break;
    }
    case 0x10:
      fields.push(['Hardware error code', dash(params[0], hex8)]);
      out.summary = `Hardware Error ${dash(params[0], hex8)}`;
      break;
    case 0x3e: {
      const sub = params[0];
      const r = decodeLeMeta(sub, params.subarray(1));
      out.name = `LE Meta: ${r.name}`;
      out.summary = r.summary;
      out.handle = r.handle;
      out.conn = r.conn;
      out.adv = r.adv;
      out.sub = r.sub;
      fields.push(...r.fields);
      break;
    }
    default:
      fields.push(['Parameters', toHex(params) || '(none)']);
  }
  out.fields = fields;
  return out;
}

function decodeLeMeta(sub, p) {
  const name = LE_META_NAMES[sub] || `LE Meta subevent ${hex8(sub)}`;
  const r = { name, summary: name, fields: [], sub: [], handle: null, conn: null, adv: null };
  if (sub === 0x01 || sub === 0x0a) {
    const enh = sub === 0x0a;
    const status = p[0];
    const handle = u16(p, 1);
    const role = p[3];
    const pat = p[4];
    const pa = bdAddr(p, 5);
    const o = enh ? 23 : 11;
    const interval = u16(p, o);
    const latency = u16(p, o + 2);
    const timeout = u16(p, o + 4);
    r.fields.push(
      ['Status', statusText(status)],
      ['Handle', dash(handle, hex16)],
      ['Role', roleName(role)],
      ['Peer address type', addrTypeName(pat)],
      ['Peer address', dash(pa)],
    );
    if (enh) r.fields.push(['Local resolvable address', dash(bdAddr(p, 11))], ['Peer resolvable address', dash(bdAddr(p, 17))]);
    r.fields.push(
      ['Connection interval', fmtInterval(interval)],
      ['Peripheral latency', dash(latency)],
      ['Supervision timeout', fmtTimeout(timeout)],
    );
    r.handle = handle;
    r.conn = { kind: 'connect', transport: 'LE', status, handle, role, peerAddrType: pat, peerAddr: pa, interval, latency, timeout };
    r.summary = status === 0
      ? `${name} ${dash(handle, hex16)} ${roleName(role)} peer ${pa}`
      : `${name} failed: ${statusText(status)}`;
  } else if (sub === 0x02) {
    const n = p[0] ?? 0;
    let o = 1;
    const reports = [];
    for (let i = 0; i < n; i++) {
      if (o + 9 > p.length) {
        r.fields.push(['Warning', 'advertising report truncated']);
        break;
      }
      const evType = p[o];
      const dl = p[o + 8];
      if (o + 9 + dl + 1 > p.length) {
        r.fields.push(['Warning', 'advertising report data runs past the end of the event']);
        break;
      }
      const data = p.subarray(o + 9, o + 9 + dl);
      const rssi = (p[o + 9 + dl] << 24) >> 24;
      const ad = parseAdStructures(data);
      const nameItem = ad.find((x) => x.type === 0x08 || x.type === 0x09);
      reports.push({
        evType,
        evTypeName: ADV_EVENT_NAMES[evType] || `Event type ${evType}`,
        addrType: p[o + 1],
        addr: bdAddr(p, o + 2),
        rssi,
        data,
        ad,
        localName: nameItem ? nameItem.value : null,
      });
      o += 10 + dl;
    }
    r.adv = reports;
    r.summary = `LE Advertising Report: ${reports.length} report(s)${reports[0] ? ` - ${reports[0].addr} ${reports[0].rssi} dBm${reports[0].localName ? ` "${reports[0].localName}"` : ''}` : ''}`;
    r.sub = reports.map((x) => ({
      title: `${x.evTypeName} from ${x.addr} (${addrTypeName(x.addrType)}), RSSI ${x.rssi} dBm${x.localName ? ` "${x.localName}"` : ''}`,
      fields: [['Event type', x.evTypeName], ['Address', x.addr], ['Address type', addrTypeName(x.addrType)], ['RSSI', `${x.rssi} dBm`]],
      sub: x.ad.map(adNode),
    }));
  } else if (sub === 0x03) {
    const handle = u16(p, 1);
    r.handle = handle;
    r.fields.push(
      ['Status', statusText(p[0])],
      ['Handle', dash(handle, hex16)],
      ['Connection interval', fmtInterval(u16(p, 3))],
      ['Peripheral latency', dash(u16(p, 5))],
      ['Supervision timeout', fmtTimeout(u16(p, 7))],
    );
    r.summary = `LE Connection Update Complete ${dash(handle, hex16)} ${statusText(p[0])}`;
  } else if (sub === 0x05) {
    const handle = u16(p, 0);
    r.handle = handle;
    r.fields.push(['Handle', dash(handle, hex16)], ['Random', toHex(p.subarray(2, 10)) || 'n/a'], ['EDIV', dash(u16(p, 10), hex16)]);
    r.summary = `LE Long Term Key Request ${dash(handle, hex16)}`;
  } else if (sub === 0x07) {
    const handle = u16(p, 0);
    r.handle = handle;
    r.fields.push(
      ['Handle', dash(handle, hex16)],
      ['Max TX octets', dash(u16(p, 2))],
      ['Max TX time', dash(u16(p, 4), (v) => `${v} us`)],
      ['Max RX octets', dash(u16(p, 6))],
      ['Max RX time', dash(u16(p, 8), (v) => `${v} us`)],
    );
    r.summary = `LE Data Length Change ${dash(handle, hex16)}`;
  } else if (sub === 0x0c) {
    const handle = u16(p, 1);
    r.handle = handle;
    r.fields.push(['Status', statusText(p[0])], ['Handle', dash(handle, hex16)], ['TX PHY', PHY_NAMES[p[3]] || dash(p[3])], ['RX PHY', PHY_NAMES[p[4]] || dash(p[4])]);
    r.summary = `LE PHY Update Complete ${dash(handle, hex16)}`;
  } else {
    r.fields.push(['Parameters', toHex(p) || '(none)']);
  }
  return r;
}

function decodeAcl(p) {
  const hw = u16(p, 0);
  if (hw === null) return truncated('acl', p);
  const handle = hw & 0x0fff;
  const pb = (hw >> 12) & 3;
  const bc = (hw >> 14) & 3;
  const dlen = u16(p, 2) ?? 0;
  const data = p.subarray(4, 4 + dlen);
  const fields = [
    ['Handle', hex16(handle)],
    ['PB flag', `${pb} ${PB_NAMES[pb]}`],
    ['BC flag', BC_NAMES[bc]],
    ['Data length', String(dlen)],
  ];
  if (dlen !== Math.max(0, p.length - 4)) fields.push(['Warning', `length field ${dlen}, packet carries ${Math.max(0, p.length - 4)}`]);
  return { type: 'acl', name: 'ACL data', summary: `ACL ${hex16(handle)} ${dlen} bytes`, fields, sub: [], handle, pb, bc, data };
}

function decodeSco(p) {
  const hw = u16(p, 0);
  if (hw === null) return truncated('sco', p);
  const handle = hw & 0x0fff;
  const dlen = p.length > 2 ? p[2] : 0;
  const data = p.subarray(3, 3 + dlen);
  return {
    type: 'sco',
    name: 'SCO data',
    summary: `SCO ${hex16(handle)} ${dlen} bytes`,
    fields: [['Handle', hex16(handle)], ['Data length', String(dlen)]],
    sub: [],
    handle,
    data,
  };
}

function decodeIso(p) {
  const hw = u16(p, 0);
  if (hw === null) return truncated('iso', p);
  const handle = hw & 0x0fff;
  const dlen = u16(p, 2) ?? 0;
  return {
    type: 'iso',
    name: 'ISO data',
    summary: `ISO ${hex16(handle)} ${dlen} bytes`,
    fields: [['Handle', hex16(handle)], ['Data length', String(dlen)]],
    sub: [],
    handle,
    data: p.subarray(4, 4 + dlen),
  };
}

/**
 * Decode one H4 packet (indicator byte first) without any cross-packet state.
 * Returns {type, name, summary, fields, sub, handle, ...}.
 * type is one of 'cmd', 'acl', 'sco', 'evt', 'iso', 'unknown'.
 */
export function decodeH4(h4) {
  if (!h4 || h4.length === 0) {
    return { type: 'unknown', name: 'Empty record', summary: 'Empty record', fields: [], sub: [], handle: null };
  }
  const ind = h4[0];
  const p = h4.subarray(1);
  switch (ind) {
    case 0x01: return decodeCommand(p);
    case 0x02: return decodeAcl(p);
    case 0x03: return decodeSco(p);
    case 0x04: return decodeEvent(p);
    case 0x05: return decodeIso(p);
    default:
      return {
        type: 'unknown',
        name: `Unknown H4 indicator ${hex8(ind)}`,
        summary: `Unknown H4 indicator ${hex8(ind)}`,
        fields: [['Indicator', hex8(ind)], ['Payload', toHex(p)]],
        sub: [],
        handle: null,
      };
  }
}

// ---------------------------------------------------------------------------
// L2CAP payload decoders
// ---------------------------------------------------------------------------

export function decodeSignaling(p) {
  const code = p[0];
  const id = p[1];
  const len = u16(p, 2);
  const name = SIG_NAMES[code] || `Signalling code ${hex8(code)}`;
  const fields = [['Code', `${hex8(code)} ${name}`], ['Identifier', dash(id)], ['Length', dash(len)]];
  if (code === 0x12 && p.length >= 12) {
    fields.push(
      ['Interval min', fmtInterval(u16(p, 4))],
      ['Interval max', fmtInterval(u16(p, 6))],
      ['Latency', dash(u16(p, 8))],
      ['Timeout', fmtTimeout(u16(p, 10))],
    );
  }
  return { code, id, name, summary: name, fields };
}

export function decodeSmp(p) {
  const op = p[0];
  const name = SMP_NAMES[op] || `SMP code ${hex8(op)}`;
  const fields = [['Opcode', `${hex8(op)} ${name}`]];
  if ((op === 0x01 || op === 0x02) && p.length >= 7) {
    const auth = p[3];
    fields.push(
      ['IO capability', IO_CAP_NAMES[p[1]] || dash(p[1])],
      ['OOB data flag', p[2] ? 'present' : 'absent'],
      ['Bonding', ['No bonding', 'Bonding'][auth & 3] || dash(auth & 3)],
      ['MITM (MITM protection requested)', auth & 0x04 ? 'yes' : 'no'],
      ['Secure Connections', auth & 0x08 ? 'yes' : 'no'],
      ['Keypress notifications', auth & 0x10 ? 'yes' : 'no'],
      ['Max encryption key size', String(p[4])],
      ['Initiator key distribution', hex8(p[5])],
      ['Responder key distribution', hex8(p[6])],
    );
  } else if (op === 0x05 && p.length >= 2) {
    fields.push(['Reason', `${hex8(p[1])} ${SMP_FAILED_NAMES[p[1]] || 'Unknown'}`]);
  } else if (p.length > 1) {
    fields.push(['Data', toHex(p.subarray(1))]);
  }
  return { op, name, summary: name, fields };
}

/** Decode an ATT PDU. Returns structured fields used by the GATT model. */
export function decodeAtt(p) {
  if (p.length === 0) return { op: null, name: 'Empty ATT PDU', summary: 'Empty ATT PDU', fields: [] };
  const op = p[0];
  const name = ATT_OPCODE_NAMES[op] || `Unknown ATT opcode ${hex8(op)}`;
  const r = { op, name, summary: name, fields: [['Opcode', `${hex8(op)} ${name}`]] };
  const L = p.length;
  const valueFields = (bytes) => {
    r.fields.push(['Value (hex)', toHex(bytes) || '(empty)']);
    const t = utf8Preview(bytes);
    if (t) r.fields.push(['Value (UTF-8)', t]);
  };
  const entriesOf = (startAt, stride, fn) => {
    const out = [];
    for (let o = startAt; o + stride <= L; o += stride) out.push(fn(o));
    return out;
  };
  switch (op) {
    case 0x01: // Error Response
      r.reqOp = p[1];
      r.handle = u16(p, 2);
      r.errorCode = p[4];
      r.errorName = ATT_ERROR_NAMES[p[4]] || 'Unknown error';
      r.fields.push(
        ['Request opcode', `${hex8(p[1])} ${ATT_OPCODE_NAMES[p[1]] || ''}`.trim()],
        ['Handle', dash(r.handle, hex16)],
        ['Error', `${hex8(p[4])} ${r.errorName}`],
      );
      r.summary = `Error Response: ${ATT_OPCODE_NAMES[p[1]] || hex8(p[1])} ${dash(r.handle, hex16)} - ${r.errorName}`;
      break;
    case 0x02:
    case 0x03:
      r.mtu = u16(p, 1);
      r.fields.push(['MTU', dash(r.mtu)]);
      r.summary = `${name} (MTU ${dash(r.mtu)})`;
      break;
    case 0x04:
    case 0x06:
    case 0x08:
    case 0x10:
      r.startHandle = u16(p, 1);
      r.endHandle = u16(p, 3);
      r.fields.push(['Start handle', dash(r.startHandle, hex16)], ['End handle', dash(r.endHandle, hex16)]);
      if (op === 0x06) {
        r.uuid = uuidStr(p.subarray(5, 7));
        r.fields.push(['Attribute type', dash(r.uuid)]);
        valueFields(p.subarray(7));
      } else if (op === 0x08 || op === 0x10) {
        r.uuid = uuidStr(p.subarray(5));
        r.fields.push(['Type', `${dash(r.uuid)}${uuidName(r.uuid) ? ` (${uuidName(r.uuid)})` : ''}`]);
      }
      r.summary = `${name} ${dash(r.startHandle, hex16)}-${dash(r.endHandle, hex16)}${r.uuid ? ` ${r.uuid}${uuidName(r.uuid) ? ` ${uuidName(r.uuid)}` : ''}` : ''}`;
      break;
    case 0x05: { // Find Information Response
      const fmt = p[1];
      const stride = fmt === 1 ? 4 : 18;
      r.entries = entriesOf(2, stride, (o) => ({ handle: u16(p, o), uuid: uuidStr(p.subarray(o + 2, o + stride)) }));
      r.fields.push(['Format', fmt === 1 ? '16-bit UUIDs' : fmt === 2 ? '128-bit UUIDs' : dash(fmt)], ['Entries', String(r.entries.length)]);
      r.summary = `Find Information Response: ${r.entries.length} entr${r.entries.length === 1 ? 'y' : 'ies'}`;
      break;
    }
    case 0x07: { // Find By Type Value Response
      r.entries = entriesOf(1, 4, (o) => ({ handle: u16(p, o), endHandle: u16(p, o + 2) }));
      r.summary = `Find By Type Value Response: ${r.entries.length} range(s)`;
      r.fields.push(['Ranges', String(r.entries.length)]);
      break;
    }
    case 0x09: { // Read By Type Response
      const len = p[1] ?? 0;
      r.entries = entriesOf(2, len, (o) => ({ handle: u16(p, o), value: p.subarray(o + 2, o + len) }));
      r.fields.push(['Entry length', String(len)], ['Entries', String(r.entries.length)]);
      r.summary = `Read By Type Response: ${r.entries.length} entr${r.entries.length === 1 ? 'y' : 'ies'}`;
      break;
    }
    case 0x0a: // Read Request
    case 0x0c: // Read Blob Request
      r.handle = u16(p, 1);
      r.fields.push(['Handle', dash(r.handle, hex16)]);
      if (op === 0x0c) {
        r.offset = u16(p, 3);
        r.fields.push(['Offset', dash(r.offset)]);
      }
      r.summary = `${name} ${dash(r.handle, hex16)}`;
      break;
    case 0x0b: // Read Response
    case 0x0d: // Read Blob Response
    case 0x0f: // Read Multiple Response
      r.value = p.subarray(1);
      valueFields(r.value);
      r.summary = `${name} (${r.value.length} bytes)`;
      break;
    case 0x0e: { // Read Multiple Request
      r.handles = entriesOf(1, 2, (o) => u16(p, o));
      r.fields.push(['Handles', r.handles.map((h) => hex16(h)).join(', ')]);
      r.summary = `Read Multiple Request (${r.handles.length} handles)`;
      break;
    }
    case 0x11: { // Read By Group Type Response
      const len = p[1] ?? 0;
      r.entries = entriesOf(2, len, (o) => ({ handle: u16(p, o), endHandle: u16(p, o + 2), value: p.subarray(o + 4, o + len) }));
      r.fields.push(['Entry length', String(len)], ['Entries', String(r.entries.length)]);
      r.summary = `Read By Group Type Response: ${r.entries.length} entr${r.entries.length === 1 ? 'y' : 'ies'}`;
      break;
    }
    case 0x12: // Write Request
    case 0x52: // Write Command
    case 0xd2: // Signed Write Command
      r.handle = u16(p, 1);
      r.value = op === 0xd2 ? p.subarray(3, Math.max(3, L - 12)) : p.subarray(3);
      r.fields.push(['Handle', dash(r.handle, hex16)]);
      valueFields(r.value);
      r.summary = `${name} ${dash(r.handle, hex16)} (${r.value.length} bytes)`;
      break;
    case 0x13:
    case 0x19:
    case 0x1e:
      r.summary = name;
      break;
    case 0x16: // Prepare Write Request
    case 0x17: // Prepare Write Response
      r.handle = u16(p, 1);
      r.offset = u16(p, 3);
      r.value = p.subarray(5);
      r.fields.push(['Handle', dash(r.handle, hex16)], ['Offset', dash(r.offset)]);
      valueFields(r.value);
      r.summary = `${name} ${dash(r.handle, hex16)}`;
      break;
    case 0x18: // Execute Write Request
      r.fields.push(['Flags', dash(p[1], hex8)]);
      r.summary = `Execute Write Request (flags ${dash(p[1], hex8)})`;
      break;
    case 0x1b: // Handle Value Notification
    case 0x1d: // Handle Value Indication
      r.handle = u16(p, 1);
      r.value = p.subarray(3);
      r.fields.push(['Handle', dash(r.handle, hex16)]);
      valueFields(r.value);
      r.summary = `${name} ${dash(r.handle, hex16)} (${r.value.length} bytes)`;
      break;
    default:
      r.fields.push(['Data', toHex(p.subarray(1)) || '(none)']);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Capture analysis (stateful: connections, L2CAP reassembly, ATT, GATT)
// ---------------------------------------------------------------------------

function makeGattState() {
  return {
    pending: null,
    events: [],
    services: [],
    chars: [],
    handleUuid: new Map(),
    errors: [],
    clientMtu: null,
    serverMtu: null,
    mtu: null,
  };
}

function attStep(conn, att, pk) {
  const g = conn.gatt;
  const no = pk.no;
  const dir = pk.direction;
  const access = (kind, handle, value, extra = {}) => {
    const ev = { no, dir, kind, handle, value, ...extra };
    g.events.push(ev);
    return ev;
  };
  const op = att.op;
  if (op === 0x02) g.clientMtu = att.mtu;
  if (op === 0x03) g.serverMtu = att.mtu;
  if (op === 0x52 || op === 0xd2) {
    access('write', att.handle, att.value, { status: 'no response (command)' });
    return;
  }
  if (ATT_REQUEST_OPS.has(op)) {
    g.pending = {
      op,
      no,
      startHandle: att.startHandle,
      endHandle: att.endHandle,
      uuid: att.uuid,
      handle: att.handle,
      writeEvent: null,
    };
    if (op === 0x12) g.pending.writeEvent = access('write', att.handle, att.value, { status: 'pending' });
    return;
  }
  if (op === 0x1b) {
    access('notify', att.handle, att.value);
    return;
  }
  if (op === 0x1d) {
    access('indicate', att.handle, att.value);
    return;
  }
  if (op === 0x1e) return;

  const p = g.pending;
  g.pending = null;
  switch (op) {
    case 0x01:
      if (p && p.writeEvent) p.writeEvent.status = `error: ${att.errorName}`;
      g.errors.push({ no, reqOp: att.reqOp, handle: att.handle, code: att.errorCode, name: att.errorName });
      break;
    case 0x03:
      if (g.clientMtu && g.serverMtu) g.mtu = Math.min(g.clientMtu, g.serverMtu);
      break;
    case 0x09:
      if (!p) break;
      if (p.uuid === '0x2803') {
        for (const e of att.entries) {
          if (e.value.length < 3) continue;
          g.chars.push({
            declHandle: e.handle,
            props: e.value[0],
            valueHandle: u16(e.value, 1),
            uuid: uuidStr(e.value.subarray(3)),
            discoveredNo: no,
          });
        }
      } else {
        for (const e of att.entries) access('read', e.handle, e.value, { reqNo: p.no });
      }
      break;
    case 0x11:
      if (!p) break;
      if (p.uuid === '0x2800' || p.uuid === '0x2801') {
        for (const e of att.entries) {
          g.services.push({
            startHandle: e.handle,
            endHandle: e.endHandle,
            uuid: uuidStr(e.value),
            primary: p.uuid === '0x2800',
            discoveredNo: no,
          });
        }
      } else {
        for (const e of att.entries) access('read', e.handle, e.value, { reqNo: p.no });
      }
      break;
    case 0x05:
      for (const e of att.entries || []) g.handleUuid.set(e.handle, e.uuid);
      break;
    case 0x0b:
    case 0x0d:
      if (p && (p.op === 0x0a || p.op === 0x0c)) access('read', p.handle, att.value, { reqNo: p.no });
      break;
    case 0x13:
      if (p && p.writeEvent) p.writeEvent.status = 'ok';
      break;
    default:
      break;
  }
}

function finishSdu(pk, conn, cid, payload, firstNo, lastNo, fragments, handle) {
  const sdu = { cid, cidName: CID_NAMES[cid] || 'Dynamic channel', length: payload.length, firstNo, lastNo, fragments };
  pk.l2cap = sdu;
  pk.l2capPayload = payload;
  conn.sdus++;
  let detail = '';
  if (cid === 0x0004) {
    const att = decodeAtt(payload);
    pk.att = att;
    conn.attOps++;
    attStep(conn, att, pk);
    detail = att.summary;
  } else if (cid === 0x0005 || cid === 0x0001) {
    const sig = decodeSignaling(payload);
    pk.sig = sig;
    detail = sig.summary;
  } else if (cid === 0x0006 || cid === 0x0007) {
    const smp = decodeSmp(payload);
    pk.smp = smp;
    detail = smp.summary;
  } else {
    detail = `${payload.length} bytes`;
  }
  const frag = fragments > 1 ? ` (${fragments} fragments)` : '';
  pk.summary = `ACL ${hex16(handle)} L2CAP CID ${hex16(cid)} ${CID_NAMES[cid] ? `(${CID_NAMES[cid]}) ` : ''}${detail}${frag}`;
}

/**
 * Decode and analyse a parsed capture.
 * @param {ReturnType<typeof parseCapture>} capture
 * @returns {{packets, connections, warnings, stats}}
 */
export function analyzeCapture(capture) {
  const warnings = [...capture.warnings];
  const conns = [];
  const active = new Map(); // ACL handle -> connection
  const reasm = new Map(); // ACL handle -> partial L2CAP SDU
  const counts = { cmd: 0, acl: 0, sco: 0, evt: 0, iso: 0, unknown: 0 };
  const newConn = (o) => {
    const c = {
      id: conns.length,
      handle: o.handle,
      transport: o.transport || 'unknown',
      role: o.role ?? null,
      peerAddr: o.peerAddr ?? null,
      peerAddrType: o.peerAddrType ?? null,
      interval: o.interval ?? null,
      latency: o.latency ?? null,
      timeout: o.timeout ?? null,
      status: o.status ?? 0,
      startNo: o.startNo,
      endNo: null,
      reason: null,
      packets: 0,
      attOps: 0,
      sdus: 0,
      gatt: makeGattState(),
    };
    conns.push(c);
    return c;
  };
  const connFor = (handle, no) => {
    let c = active.get(handle);
    if (!c) {
      c = newConn({ handle, startNo: no, transport: 'unknown' });
      active.set(handle, c);
    }
    return c;
  };

  const packets = capture.records.map((rec, i) => {
    const no = i + 1;
    const dec = decodeH4(rec.h4);
    counts[dec.type] = (counts[dec.type] || 0) + 1;
    const pk = {
      no,
      direction: rec.direction,
      relUs: rec.relUs,
      unixUs: rec.unixUs,
      origLen: rec.origLen,
      type: dec.type,
      name: dec.name,
      summary: dec.summary,
      fields: dec.fields,
      sub: dec.sub,
      handle: dec.handle ?? null,
      connId: null,
      l2cap: null,
      l2capPayload: null,
      fragment: null,
      att: null,
      smp: null,
      sig: null,
      h4: rec.h4,
    };

    if (dec.type === 'evt' && dec.conn) {
      const cc = dec.conn;
      if (cc.kind === 'connect') {
        if (cc.status === 0) {
          const old = active.get(cc.handle);
          if (old) {
            old.endNo = no;
            old.reason = 'superseded by a new connection on the same handle';
          }
          const c = newConn({ ...cc, startNo: no });
          active.set(cc.handle, c);
          pk.connId = c.id;
        } else {
          const c = newConn({ handle: cc.handle, transport: cc.transport, startNo: no, status: cc.status, peerAddr: cc.peerAddr, peerAddrType: cc.peerAddrType });
          c.endNo = no;
          c.reason = statusText(cc.status);
          pk.connId = c.id;
        }
      } else if (cc.kind === 'disconnect') {
        const c = active.get(cc.handle);
        if (c) {
          c.endNo = no;
          c.reason = statusText(cc.reason);
          active.delete(cc.handle);
          pk.connId = c.id;
        }
        reasm.delete(cc.handle);
      }
    }

    if (dec.type === 'acl') {
      const h = dec.handle;
      const c = connFor(h, no);
      c.packets++;
      pk.connId = c.id;
      const data = dec.data;
      const baseSummary = dec.summary;
      if (dec.pb === 0 || dec.pb === 2) {
        if (reasm.has(h)) {
          warnings.push(`#${no}: new L2CAP start on ${hex16(h)} while an earlier SDU was incomplete; discarded it`);
          reasm.delete(h);
        }
        if (data.length < 4) {
          pk.summary = `${baseSummary} (too short for an L2CAP header)`;
        } else {
          const len = u16(data, 0);
          const cid = u16(data, 2);
          const total = len + 4;
          if (data.length >= total) {
            finishSdu(pk, c, cid, data.subarray(4, total), no, no, 1, h);
          } else {
            reasm.set(h, { cid, total, parts: [data], got: data.length, first: no, count: 1 });
            pk.fragment = { state: 'partial', got: data.length, total };
            pk.summary = `ACL ${hex16(h)} L2CAP ${data.length}/${total} bytes, waiting for continuation`;
          }
        }
      } else if (dec.pb === 1) {
        const st = reasm.get(h);
        if (!st) {
          pk.fragment = { state: 'orphan' };
          pk.summary = `ACL ${hex16(h)} continuation without a start fragment (dropped)`;
          warnings.push(`#${no}: continuation fragment on ${hex16(h)} with no start fragment`);
        } else {
          st.parts.push(data);
          st.got += data.length;
          st.count++;
          if (st.got >= st.total) {
            reasm.delete(h);
            const all = concat(st.parts);
            finishSdu(pk, c, st.cid, all.subarray(4, st.total), st.first, no, st.count, h);
          } else {
            pk.fragment = { state: 'partial', got: st.got, total: st.total };
            pk.summary = `ACL ${hex16(h)} L2CAP ${st.got}/${st.total} bytes, waiting for continuation`;
          }
        }
      } else {
        pk.fragment = { state: 'reserved' };
      }
    }
    return pk;
  });

  for (const c of conns) {
    if (c.status === 0 && c.endNo === null && c.transport !== 'unknown') {
      // still connected at end of capture
    }
  }

  return {
    packets,
    connections: conns,
    warnings,
    stats: { ...counts, total: packets.length, sdus: packets.filter((p) => p.l2cap).length, attOps: packets.filter((p) => p.att).length },
  };
}

/**
 * Build the GATT model for one connection from its discovery and access events.
 * Services and characteristics come from Read By Group Type and Read By Type (0x2803)
 * responses. Descriptor handles are inferred from the handle range after each value.
 */
export function buildGattModel(conn) {
  const g = conn.gatt;
  const services = g.services
    .slice()
    .sort((a, b) => a.startHandle - b.startHandle)
    .map((s) => ({ ...s, uuidName: uuidName(s.uuid), characteristics: [] }));
  const chars = g.chars
    .slice()
    .sort((a, b) => a.declHandle - b.declHandle)
    .map((ch) => ({ ...ch, uuidName: uuidName(ch.uuid), props: propNames(ch.props), descriptors: [] }));
  for (const ch of chars) {
    const s = services.find((sv) => ch.declHandle >= sv.startHandle && ch.declHandle <= sv.endHandle);
    if (s) s.characteristics.push(ch);
  }
  for (const s of services) {
    s.characteristics.forEach((ch, idx) => {
      const next = s.characteristics[idx + 1];
      const last = Math.min(next ? next.declHandle - 1 : s.endHandle, ch.valueHandle + 64);
      for (let h = ch.valueHandle + 1; h <= last; h++) {
        const u = g.handleUuid.get(h) || null;
        ch.descriptors.push({ handle: h, uuid: u, uuidName: uuidName(u), inferred: true });
      }
    });
  }

  const nameOf = new Map();
  for (const ch of chars) {
    nameOf.set(ch.valueHandle, `Value: ${ch.uuidName || ch.uuid}`);
    for (const d of ch.descriptors) nameOf.set(d.handle, d.uuidName ? `Descriptor: ${d.uuidName}` : 'Descriptor (inferred from handle range)');
  }
  const byHandle = new Map();
  const entry = (h) => {
    if (!byHandle.has(h)) {
      byHandle.set(h, { handle: h, name: null, reads: 0, writes: 0, notifies: 0, indications: 0, errors: 0, values: [] });
    }
    return byHandle.get(h);
  };
  for (const ev of g.events) {
    const e = entry(ev.handle);
    if (ev.kind === 'read') e.reads++;
    else if (ev.kind === 'write') e.writes++;
    else if (ev.kind === 'notify') e.notifies++;
    else if (ev.kind === 'indicate') e.indications++;
    e.values.push({ no: ev.no, dir: ev.dir, kind: ev.kind, value: ev.value, status: ev.status || null });
  }
  for (const er of g.errors) if (er.handle !== null && er.handle !== undefined) entry(er.handle).errors++;
  const handles = [...byHandle.values()].sort((a, b) => a.handle - b.handle);
  for (const e of handles) {
    e.name = nameOf.get(e.handle) || (g.handleUuid.has(e.handle) ? `Attribute: ${uuidName(g.handleUuid.get(e.handle)) || g.handleUuid.get(e.handle)}` : null);
    const last = e.values[e.values.length - 1];
    e.last = last ? last.value : null;
  }
  return { services, characteristics: chars, handles, errors: g.errors, mtu: g.mtu };
}

/** Filter decoded packets by type, connection handle and free text. */
export function filterPackets(packets, { type = 'all', handle = null, text = '' } = {}) {
  const q = text.trim().toLowerCase();
  return packets.filter((p) => {
    if (type !== 'all' && p.type !== type) return false;
    if (handle !== null && p.handle !== handle) return false;
    if (!q) return true;
    if (`${p.summary} ${p.name}`.toLowerCase().includes(q)) return true;
    return p.fields.some(([k, v]) => `${k} ${v}`.toLowerCase().includes(q));
  });
}

/** Parse "0x40", "40" or "0040" into a number, or null if empty/invalid. */
export function parseHandle(s) {
  const t = String(s || '').trim();
  if (!t) return null;
  const v = parseInt(t.replace(/^0x/i, ''), 16);
  return Number.isFinite(v) && v >= 0 && v <= 0xffff ? v : null;
}

function wallIso(p) {
  if (p.unixUs === null || p.unixUs === undefined) return '';
  return new Date(Number(p.unixUs / 1000n)).toISOString();
}

/** CSV of packets (already filtered by the caller). RFC 4180 quoting, CRLF line ends. */
export function packetsToCsv(packets) {
  const cols = ['no', 'time_s', 'utc', 'direction', 'type', 'handle', 'connection', 'l2cap_cid', 'att_opcode', 'summary'];
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = packets.map((p) => [
    p.no,
    (p.relUs / 1e6).toFixed(6),
    wallIso(p),
    p.direction,
    p.type,
    p.handle === null ? '' : hex16(p.handle),
    p.connId ?? '',
    p.l2cap ? hex16(p.l2cap.cid) : '',
    p.att ? hex8(p.att.op) : '',
    p.summary,
  ]);
  return [cols, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Writing a btsnoop file (used for the built-in example and for tests)
// ---------------------------------------------------------------------------

/**
 * Build a btsnoop v1 file with datalink 1002 (H4).
 * @param {Array<{direction:'sent'|'received', h4:Uint8Array|number[], unixUs?:bigint|number}>} records
 */
export function buildBtsnoopFile(records) {
  const parts = [Uint8Array.from(BTSNOOP_MAGIC), be32(1), be32(1002)];
  let us = 1_700_000_000_000_000n;
  for (const r of records) {
    const h4 = r.h4 instanceof Uint8Array ? r.h4 : Uint8Array.from(r.h4);
    const ind = h4[0];
    const isCmdEvt = ind === 0x01 || ind === 0x04;
    const flags = (r.direction === 'received' ? 1 : 0) | (isCmdEvt ? 2 : 0);
    const ts = BigInt(r.unixUs ?? us) + BTSNOOP_EPOCH_US;
    us += 1000n;
    const rec = new Uint8Array(24);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, h4.length);
    dv.setUint32(4, h4.length);
    dv.setUint32(8, flags);
    dv.setUint32(12, 0);
    dv.setBigUint64(16, ts);
    parts.push(rec, h4);
  }
  return concat(parts);
}

function be32(n) {
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

const le16 = (n) => [n & 0xff, (n >> 8) & 0xff];
const addrLE = (s) => s.split(':').reverse().map((x) => parseInt(x, 16));
const cmdPkt = (opcode, params) => [0x01, ...le16(opcode), params.length, ...params];
const evtPkt = (code, params) => [0x04, code, params.length, ...params];
const leMetaPkt = (sub, params) => evtPkt(0x3e, [sub, ...params]);
const aclPkt = (handle, pb, l2cap) => [0x02, ...le16(handle | (pb << 12)), ...le16(l2cap.length), ...l2cap];
const l2cap = (cid, payload) => [...le16(payload.length), ...le16(cid), ...payload];

/**
 * A small, invented LE session (synthetic, not captured from a device). It shows an advertising
 * report, a connection, a fragmented L2CAP SDU, service and characteristic discovery, a read,
 * a CCCD write, a notification and a disconnect. Used as the workbench's labelled example
 * and by the tests.
 */
export function makeExampleCapture() {
  const records = [
    { direction: 'received', h4: leMetaPkt(0x02, [0x01, 0x00, 0x00, ...addrLE('AA:BB:CC:DD:EE:01'), 9, 0x02, 0x01, 0x06, 0x05, 0x09, 0x54, 0x6f, 0x6f, 0x6c, 0xc4]) },
    {
      direction: 'sent',
      h4: cmdPkt(0x200d, [0x60, 0x00, 0x30, 0x00, 0x00, 0x00, ...addrLE('AA:BB:CC:DD:EE:01'), 0x00, 0x18, 0x00, 0x28, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00, 0x00, 0x00, 0x00]),
    },
    { direction: 'received', h4: evtPkt(0x0f, [0x00, 0x01, ...le16(0x200d)]) },
    {
      direction: 'received',
      h4: leMetaPkt(0x01, [0x00, 0x40, 0x00, 0x00, 0x00, ...addrLE('AA:BB:CC:DD:EE:01'), 0x18, 0x00, 0x00, 0x00, 0xc8, 0x00, 0x00]),
    },
    { direction: 'sent', h4: aclPkt(0x40, 0, l2cap(0x0004, [0x10, 0x01, 0x00, 0xff, 0xff, 0x00, 0x28])) },
    // Read By Group Type Response (two services) split across two ACL fragments.
    ...(() => {
      const full = l2cap(0x0004, [0x11, 0x06, 0x01, 0x00, 0x07, 0x00, 0x00, 0x18, 0x08, 0x00, 0x0b, 0x00, 0x0f, 0x18]);
      return [
        { direction: 'received', h4: aclPkt(0x40, 2, full.slice(0, 10)) },
        { direction: 'received', h4: aclPkt(0x40, 1, full.slice(10)) },
      ];
    })(),
    { direction: 'sent', h4: aclPkt(0x40, 0, l2cap(0x0004, [0x08, 0x02, 0x00, 0x07, 0x00, 0x03, 0x28])) },
    {
      direction: 'received',
      h4: aclPkt(0x40, 2, l2cap(0x0004, [0x09, 0x07, 0x02, 0x00, 0x02, 0x03, 0x00, 0x00, 0x2a, 0x04, 0x00, 0x02, 0x05, 0x00, 0x01, 0x2a])),
    },
    { direction: 'sent', h4: aclPkt(0x40, 0, l2cap(0x0004, [0x0a, 0x03, 0x00])) },
    { direction: 'received', h4: aclPkt(0x40, 2, l2cap(0x0004, [0x0b, 0x54, 0x6f, 0x6f, 0x6c])) },
    { direction: 'sent', h4: aclPkt(0x40, 0, l2cap(0x0004, [0x08, 0x08, 0x00, 0x0b, 0x00, 0x03, 0x28])) },
    { direction: 'received', h4: aclPkt(0x40, 2, l2cap(0x0004, [0x09, 0x07, 0x09, 0x00, 0x12, 0x0a, 0x00, 0x19, 0x2a])) },
    { direction: 'sent', h4: aclPkt(0x40, 0, l2cap(0x0004, [0x12, 0x0b, 0x00, 0x01, 0x00])) },
    { direction: 'received', h4: aclPkt(0x40, 2, l2cap(0x0004, [0x13])) },
    { direction: 'received', h4: aclPkt(0x40, 2, l2cap(0x0004, [0x1b, 0x0a, 0x00, 0x5a])) },
    { direction: 'received', h4: evtPkt(0x05, [0x00, 0x40, 0x00, 0x13]) },
  ];
  return buildBtsnoopFile(records);
}
