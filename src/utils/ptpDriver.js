/**
 * ptpDriver.js — PTP / MTP (Picture Transfer Protocol) over WebUSB, for pulling
 * photos and metadata off cameras and phones in PTP mode.
 *
 * I/O goes through an injected transport so the container framing and dataset
 * parsing are testable against a fake camera (see tests/ptp.test.js):
 *
 *     transport.write(Uint8Array) -> Promise<void>   (bulk OUT)
 *     transport.read(maxLength)   -> Promise<Uint8Array> (bulk IN)
 *     transport.close()           -> Promise<void>
 *
 * References: PIMA 15740 / ISO 15740 (PTP); MTP is PTP with vendor extensions.
 */


export const PTP_CLASS = { classCode: 0x06, subclassCode: 0x01, protocolCode: 0x01 }; // Still Image / PTP

export const PTP_TYPE = { COMMAND: 1, DATA: 2, RESPONSE: 3, EVENT: 4 };
export const PTP_OP = {
  GetDeviceInfo: 0x1001, OpenSession: 0x1002, CloseSession: 0x1003,
  GetStorageIDs: 0x1004, GetStorageInfo: 0x1005, GetNumObjects: 0x1006,
  GetObjectHandles: 0x1007, GetObjectInfo: 0x1008, GetObject: 0x1009,
  GetThumb: 0x100a, DeleteObject: 0x100b, SendObjectInfo: 0x100c, SendObject: 0x100d, InitiateCapture: 0x100e,
  GetDevicePropDesc: 0x1014, GetDevicePropValue: 0x1015, SetDevicePropValue: 0x1016, GetPartialObject: 0x101b
};
export const PTP_PROP = {
  BatteryLevel: 0x5001, ImageSize: 0x5003, CompressionSetting: 0x5004, WhiteBalance: 0x5005,
  FNumber: 0x5007, FocalLength: 0x5008, FocusMode: 0x500a, ExposureMeteringMode: 0x500b, FlashMode: 0x500c,
  ExposureTime: 0x500d, ExposureProgramMode: 0x500e, ExposureIndex: 0x500f, ExposureBiasCompensation: 0x5010,
  DateTime: 0x5011
};
export const PTP_RESP = { OK: 0x2001, SessionNotOpen: 0x2003, SessionAlreadyOpen: 0x201e };
export const PTP_EVENT = {
  CancelTransaction: 0x4001, ObjectAdded: 0x4002, ObjectRemoved: 0x4003, StoreAdded: 0x4004, StoreRemoved: 0x4005,
  DevicePropChanged: 0x4006, ObjectInfoChanged: 0x4007, DeviceInfoChanged: 0x4008, RequestObjectTransfer: 0x4009,
  StoreFull: 0x400a, StorageInfoChanged: 0x400c, CaptureComplete: 0x400d
};
const EVENT_NAMES = Object.fromEntries(Object.entries(PTP_EVENT).map(([k, v]) => [v, k]));
export const eventName = (code) => EVENT_NAMES[code] || `0x${code.toString(16)}`;

const RESPONSE_NAMES = {
  0x2002: 'General error', 0x2003: 'Session not open', 0x2004: 'Invalid transaction ID', 0x2005: 'Operation not supported',
  0x2006: 'Parameter not supported', 0x2007: 'Incomplete transfer', 0x2008: 'Invalid storage ID', 0x2009: 'Invalid object handle',
  0x200a: 'Device property not supported', 0x200b: 'Invalid object format code', 0x200c: 'Store full', 0x200d: 'Object write-protected',
  0x200e: 'Store read-only', 0x200f: 'Access denied', 0x2010: 'No thumbnail present', 0x2012: 'Partial deletion',
  0x2013: 'Store not available', 0x2014: 'Specification by format unsupported', 0x2015: 'No valid object info',
  0x2016: 'Invalid code format', 0x2018: 'Capture already terminated', 0x2019: 'Device busy', 0x201a: 'Invalid parent object',
  0x201b: 'Invalid device property format', 0x201c: 'Invalid device property value', 0x201d: 'Invalid parameter',
  0x201e: 'Session already open', 0x201f: 'Transaction cancelled', 0x2020: 'Destination unsupported'
};
export const responseName = (code) => RESPONSE_NAMES[code] || `0x${code.toString(16)}`;

const OBJECT_FORMATS = {
  0x3000: 'Undefined', 0x3001: 'Association (folder)', 0x3002: 'Script', 0x3006: 'DPOF',
  0x300a: 'Text', 0x300b: 'HTML', 0x3801: 'JPEG (EXIF)', 0x3804: 'BMP', 0x3808: 'TIFF',
  0x380b: 'PNG', 0x380d: 'TIFF', 0xb101: 'RAW', 0x3000: 'Undefined', 0xb982: 'MP4', 0x300c: 'DPOF'
};
export const objectFormatName = (code) => OBJECT_FORMATS[code] || `0x${code.toString(16)}`;

export class PtpError extends Error {
  constructor(message, responseCode) { super(message); this.responseCode = responseCode; }
}

// --- container framing ------------------------------------------------------

export function buildContainer(type, code, transactionId, params = [], payload = null) {
  const paramBytes = params.length * 4;
  const extra = payload ? payload.length : paramBytes;
  const len = 12 + extra;
  const buf = new Uint8Array(len);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, len, true);
  dv.setUint16(4, type, true);
  dv.setUint16(6, code, true);
  dv.setUint32(8, transactionId >>> 0, true);
  if (payload) buf.set(payload, 12);
  else params.forEach((p, i) => dv.setUint32(12 + i * 4, p >>> 0, true));
  return buf;
}

export function parseContainerHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { length: dv.getUint32(0, true), type: dv.getUint16(4, true), code: dv.getUint16(6, true), transactionId: dv.getUint32(8, true) };
}

// --- dataset readers --------------------------------------------------------

export class DataReader {
  constructor(bytes, offset = 0) { this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.o = offset; }
  u8() { return this.b[this.o++]; }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  u64() { const lo = this.u32(); const hi = this.u32(); return hi * 0x100000000 + lo; }
  arr16() { const n = this.u32(); const out = []; for (let i = 0; i < n; i++) out.push(this.u16()); return out; }
  arr32() { const n = this.u32(); const out = []; for (let i = 0; i < n; i++) out.push(this.u32()); return out; }
  str() {
    const n = this.u8();
    if (n === 0) return '';
    let s = '';
    for (let i = 0; i < n; i++) { const c = this.u16(); if (c) s += String.fromCharCode(c); }
    return s;
  }
}

export function parseDeviceInfo(bytes) {
  const r = new DataReader(bytes);
  const info = {
    standardVersion: r.u16(),
    vendorExtensionId: r.u32(),
    vendorExtensionVersion: r.u16(),
    vendorExtensionDesc: r.str(),
    functionalMode: r.u16(),
    operationsSupported: r.arr16(),
    eventsSupported: r.arr16(),
    devicePropertiesSupported: r.arr16(),
    captureFormats: r.arr16(),
    imageFormats: r.arr16(),
    manufacturer: r.str(),
    model: r.str(),
    deviceVersion: r.str(),
    serialNumber: r.str()
  };
  return info;
}

export function parseStorageInfo(bytes) {
  const r = new DataReader(bytes);
  const storageType = r.u16();
  const filesystemType = r.u16();
  const accessCapability = r.u16();
  return {
    storageType: { 1: 'fixed ROM', 2: 'removable ROM', 3: 'fixed RAM', 4: 'removable RAM' }[storageType] || `type ${storageType}`,
    filesystemType,
    readOnly: accessCapability !== 0,
    maxCapacity: r.u64(),
    freeSpace: r.u64(),
    freeImages: r.u32(),
    description: r.str(),
    volumeLabel: r.str()
  };
}

export function parseObjectInfo(bytes) {
  const r = new DataReader(bytes);
  return {
    storageId: r.u32(),
    objectFormat: r.u16(),
    protectionStatus: r.u16(),
    compressedSize: r.u32(),
    thumbFormat: r.u16(),
    thumbCompressedSize: r.u32(),
    thumbPixWidth: r.u32(),
    thumbPixHeight: r.u32(),
    imagePixWidth: r.u32(),
    imagePixHeight: r.u32(),
    imageBitDepth: r.u32(),
    parentObject: r.u32(),
    associationType: r.u16(),
    associationDesc: r.u32(),
    sequenceNumber: r.u32(),
    filename: r.str(),
    captureDate: r.str(),
    modificationDate: r.str(),
    keywords: r.str()
  };
}

// --- device properties -------------------------------------------------------

export const PTP_TYPES = { INT8: 1, UINT8: 2, INT16: 3, UINT16: 4, INT32: 5, UINT32: 6, INT64: 7, UINT64: 8, STRING: 0xffff };
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 8, 8: 8 };

const PROP_NAMES = {
  [PTP_PROP.BatteryLevel]: 'Battery level', [PTP_PROP.ImageSize]: 'Image size', [PTP_PROP.CompressionSetting]: 'Image quality',
  [PTP_PROP.WhiteBalance]: 'White balance', [PTP_PROP.FNumber]: 'Aperture', [PTP_PROP.FocalLength]: 'Focal length',
  [PTP_PROP.FocusMode]: 'Focus mode', [PTP_PROP.ExposureMeteringMode]: 'Metering mode', [PTP_PROP.FlashMode]: 'Flash mode',
  [PTP_PROP.ExposureTime]: 'Shutter speed', [PTP_PROP.ExposureProgramMode]: 'Exposure program', [PTP_PROP.ExposureIndex]: 'ISO',
  [PTP_PROP.ExposureBiasCompensation]: 'Exposure compensation', [PTP_PROP.DateTime]: 'Camera clock'
};
export const propName = (code) => PROP_NAMES[code] || `Property 0x${code.toString(16)}`;

/** Properties the tool reads by default, in display order. */
export const COMMON_PROPS = [
  PTP_PROP.BatteryLevel, PTP_PROP.ExposureIndex, PTP_PROP.ExposureTime, PTP_PROP.FNumber, PTP_PROP.ExposureProgramMode,
  PTP_PROP.ExposureBiasCompensation, PTP_PROP.WhiteBalance, PTP_PROP.FocusMode, PTP_PROP.FocalLength, PTP_PROP.FlashMode,
  PTP_PROP.ExposureMeteringMode, PTP_PROP.ImageSize, PTP_PROP.CompressionSetting, PTP_PROP.DateTime
];

const PROP_ENUMS = {
  [PTP_PROP.WhiteBalance]: { 1: 'Manual', 2: 'Auto', 3: 'One-push auto', 4: 'Daylight', 5: 'Fluorescent', 6: 'Tungsten', 7: 'Flash' },
  [PTP_PROP.FocusMode]: { 1: 'Manual', 2: 'Automatic', 3: 'Automatic macro' },
  [PTP_PROP.FlashMode]: { 1: 'Auto', 2: 'Off', 3: 'Fill', 4: 'Red-eye auto', 5: 'Red-eye fill', 6: 'External sync' },
  [PTP_PROP.ExposureProgramMode]: { 1: 'Manual', 2: 'Program', 3: 'Aperture priority', 4: 'Shutter priority', 5: 'Creative', 6: 'Action', 7: 'Portrait' },
  [PTP_PROP.ExposureMeteringMode]: { 1: 'Average', 2: 'Center-weighted', 3: 'Multi-spot', 4: 'Center-spot', 5: 'Multi-pattern' }
};

/** Human text for a raw property value (units follow PIMA 15740 section 13). */
export function formatPropValue(code, v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v || '—';
  const named = PROP_ENUMS[code]?.[v];
  if (named) return named;
  switch (code) {
    case PTP_PROP.BatteryLevel: return `${v}%`;
    case PTP_PROP.FNumber: return `f/${(v / 100).toFixed(1)}`;
    case PTP_PROP.FocalLength: return `${(v / 100).toFixed(v % 100 ? 1 : 0)} mm`;
    case PTP_PROP.ExposureIndex: return v === 0xffff ? 'Auto' : `ISO ${v}`;
    case PTP_PROP.ExposureBiasCompensation: return `${v > 0 ? '+' : ''}${(v / 1000).toFixed(1)} EV`;
    case PTP_PROP.ExposureTime: {
      if (v === 0xffffffff) return 'Bulb';
      if (v === 0) return '—';
      const sec = v / 10000; // units of 0.1 ms
      return sec >= 1 ? `${+sec.toFixed(1)} s` : `1/${Math.round(1 / sec)} s`;
    }
    default: return String(v);
  }
}

function readTyped(r, type) {
  switch (type) {
    case PTP_TYPES.INT8: { const v = r.u8(); return v > 127 ? v - 256 : v; }
    case PTP_TYPES.UINT8: return r.u8();
    case PTP_TYPES.INT16: { const v = r.u16(); return v > 32767 ? v - 65536 : v; }
    case PTP_TYPES.UINT16: return r.u16();
    case PTP_TYPES.INT32: return r.u32() | 0;
    case PTP_TYPES.UINT32: return r.u32();
    case PTP_TYPES.INT64: case PTP_TYPES.UINT64: return r.u64();
    case PTP_TYPES.STRING: return r.str();
    default: throw new PtpError(`Unsupported property data type 0x${type.toString(16)}.`);
  }
}

/** Encode a PTP string (length-prefixed UTF-16LE, null terminated). */
export function encodePtpString(s) {
  const str = String(s ?? '').slice(0, 254);
  if (!str) return Uint8Array.from([0]);
  const out = new Uint8Array(1 + (str.length + 1) * 2);
  out[0] = str.length + 1;
  const dv = new DataView(out.buffer);
  for (let i = 0; i < str.length; i++) dv.setUint16(1 + i * 2, str.charCodeAt(i), true);
  return out;
}

export function encodeTyped(type, value) {
  if (type === PTP_TYPES.STRING) return encodePtpString(value);
  const size = TYPE_SIZE[type];
  if (!size) throw new PtpError(`Unsupported property data type 0x${type.toString(16)}.`);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new PtpError('Value is not a number.');
  switch (type) {
    case PTP_TYPES.INT8: dv.setInt8(0, n); break;
    case PTP_TYPES.UINT8: dv.setUint8(0, n); break;
    case PTP_TYPES.INT16: dv.setInt16(0, n, true); break;
    case PTP_TYPES.UINT16: dv.setUint16(0, n, true); break;
    case PTP_TYPES.INT32: dv.setInt32(0, n, true); break;
    case PTP_TYPES.UINT32: dv.setUint32(0, n, true); break;
    default: dv.setUint32(0, n % 0x100000000, true); dv.setUint32(4, Math.floor(n / 0x100000000), true);
  }
  return out;
}

/** Parse a DevicePropDesc dataset (PIMA 15740 13.3.5). */
export function parseDevicePropDesc(bytes) {
  const r = new DataReader(bytes);
  const code = r.u16();
  const dataType = r.u16();
  const writable = r.u8() === 1;
  const factoryDefault = readTyped(r, dataType);
  const value = readTyped(r, dataType);
  const formFlag = r.u8();
  let form = null;
  if (formFlag === 1) form = { type: 'range', min: readTyped(r, dataType), max: readTyped(r, dataType), step: readTyped(r, dataType) };
  else if (formFlag === 2) {
    const n = r.u16();
    const values = [];
    for (let i = 0; i < n; i++) values.push(readTyped(r, dataType));
    form = { type: 'enum', values };
  }
  return {
    code, name: propName(code), dataType, writable, factoryDefault, value, form,
    display: formatPropValue(code, value),
    options: form?.type === 'enum' ? form.values.map((v) => ({ value: v, label: formatPropValue(code, v) })) : null
  };
}

// --- object upload (SendObjectInfo / SendObject) -------------------------------

const FORMAT_BY_EXT = { jpg: 0x3801, jpeg: 0x3801, bmp: 0x3804, png: 0x380b, tif: 0x380d, tiff: 0x380d, mp4: 0xb982 };
export function objectFormatForFilename(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  return FORMAT_BY_EXT[ext] ?? 0x3000;
}

/** ObjectInfo dataset for SendObjectInfo (the layout parseObjectInfo reads). */
export function buildObjectInfo({ storageId = 0, objectFormat = 0x3000, size = 0, parentObject = 0, filename }) {
  const parts = [];
  const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); parts.push(b); };
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); parts.push(b); };
  u32(storageId); u16(objectFormat); u16(0); u32(size > 0xffffffff ? 0xffffffff : size);
  u16(0); u32(0); u32(0); u32(0); // thumb format, size, width, height
  u32(0); u32(0); u32(0); // image width, height, bit depth
  u32(parentObject); u16(0); u32(0); u32(0); // parent, association type/desc, sequence
  parts.push(encodePtpString(filename), encodePtpString(''), encodePtpString(''), encodePtpString(''));
  let n = 0; parts.forEach((p) => { n += p.length; });
  const out = new Uint8Array(n); let k = 0; parts.forEach((p) => { out.set(p, k); k += p.length; });
  return out;
}

// --- events ------------------------------------------------------------------

/** Parse an event container read from the interrupt endpoint. */
export function parseEvent(bytes) {
  if (!bytes || bytes.length < 12) return null;
  const h = parseContainerHeader(bytes);
  if (h.type !== PTP_TYPE.EVENT) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const params = [];
  for (let o = 12; o + 4 <= Math.min(h.length, bytes.length); o += 4) params.push(dv.getUint32(o, true));
  return { code: h.code, name: eventName(h.code), transactionId: h.transactionId, params };
}

// --- device -----------------------------------------------------------------

class Reader {
  constructor(transport) { this.transport = transport; this.buf = new Uint8Array(0); }
  async _more() {
    const c = await this.transport.read(512 * 1024);
    if (c && c.length) { const m = new Uint8Array(this.buf.length + c.length); m.set(this.buf); m.set(c, this.buf.length); this.buf = m; }
    return c ? c.length : 0;
  }
  async container() {
    while (this.buf.length < 12) if (!(await this._more())) throw new PtpError('Camera closed the connection.');
    const length = new DataView(this.buf.buffer, this.buf.byteOffset, 4).getUint32(0, true);
    while (this.buf.length < length) if (!(await this._more())) throw new PtpError('Truncated PTP container.');
    const whole = this.buf.slice(0, length);
    this.buf = this.buf.slice(length);
    const header = parseContainerHeader(whole);
    return { ...header, payload: whole.slice(12) };
  }
}

export class PtpDevice {
  constructor(transport, { logger = () => {} } = {}) {
    this.transport = transport;
    this.logger = logger;
    this.reader = new Reader(transport);
    this.txid = 0;
    this.sessionOpen = false;
    this.chain = Promise.resolve();
  }

  _serialize(fn) { const r = this.chain.then(fn, fn); this.chain = r.then(() => {}, () => {}); return r; }

  async open() { if (this.transport.open) await this.transport.open(); }

  /**
   * One PTP transaction. Optionally sends a data phase; collects an incoming
   * data phase; returns { responseCode, params, data }.
   */
  transaction(code, params = [], dataToSend = null) {
    return this._serialize(async () => {
      const txid = (this.txid = (this.txid + 1) >>> 0);
      await this.transport.write(buildContainer(PTP_TYPE.COMMAND, code, txid, params));
      if (dataToSend) await this.transport.write(buildContainer(PTP_TYPE.DATA, code, txid, [], dataToSend));
      let data = null;
      for (;;) {
        const c = await this.reader.container();
        if (c.type === PTP_TYPE.DATA) data = c.payload;
        else if (c.type === PTP_TYPE.RESPONSE) {
          const dv = new DataView(c.payload.buffer, c.payload.byteOffset, c.payload.byteLength);
          const rparams = []; for (let i = 0; i + 4 <= c.payload.length; i += 4) rparams.push(dv.getUint32(i, true));
          if (c.code !== PTP_RESP.OK) throw new PtpError(`PTP operation 0x${code.toString(16)} failed: ${responseName(c.code)} (response 0x${c.code.toString(16)}).`, c.code);
          return { responseCode: c.code, params: rparams, data };
        }
      }
    });
  }

  async getDeviceInfo() {
    this.deviceInfo = parseDeviceInfo((await this.transaction(PTP_OP.GetDeviceInfo)).data);
    return this.deviceInfo;
  }

  /** True when the camera lists the operation in its DeviceInfo. */
  supports(op) { return !!this.deviceInfo?.operationsSupported.includes(op); }

  async getStorageInfo(storageId) { return parseStorageInfo((await this.transaction(PTP_OP.GetStorageInfo, [storageId])).data); }

  /** Battery level in percent, or null when the camera doesn't report it. */
  async getBatteryLevel() {
    if (!this.deviceInfo?.devicePropertiesSupported.includes(PTP_PROP.BatteryLevel)) return null;
    try { return (await this.transaction(PTP_OP.GetDevicePropValue, [PTP_PROP.BatteryLevel])).data[0]; } catch (e) { return null; }
  }

  async deleteObject(handle) { await this.transaction(PTP_OP.DeleteObject, [handle, 0]); }

  // --- device properties ---

  /** Full descriptor (type, writable, range/enum, current value) of one property. */
  async getDevicePropDesc(code) {
    return parseDevicePropDesc((await this.transaction(PTP_OP.GetDevicePropDesc, [code])).data);
  }

  /** Current value of a property; dataType is looked up from the descriptor when not given. */
  async getDevicePropValue(code, dataType) {
    const type = dataType ?? (await this.getDevicePropDesc(code)).dataType;
    const data = (await this.transaction(PTP_OP.GetDevicePropValue, [code])).data;
    return readTyped(new DataReader(data), type);
  }

  /**
   * Descriptors for the common exposure/battery/white-balance properties the camera lists in its DeviceInfo.
   * Properties the camera does not report (or fails to describe) are left out, never invented.
   */
  async getCommonProps(codes = COMMON_PROPS) {
    const supported = this.deviceInfo?.devicePropertiesSupported || [];
    const out = [];
    for (const code of codes) {
      if (!supported.includes(code)) continue;
      try { out.push(await this.getDevicePropDesc(code)); } catch (e) { /* camera refused this one */ }
    }
    return out;
  }

  /** Set a property after checking it is writable and the value is one the camera offers. Returns the new descriptor. */
  async setDeviceProp(code, value) {
    if (!this.supports(PTP_OP.SetDevicePropValue)) throw new PtpError('This camera does not support changing properties.');
    const desc = await this.getDevicePropDesc(code);
    if (!desc.writable) throw new PtpError(`${desc.name} is read-only on this camera.`);
    const v = desc.dataType === PTP_TYPES.STRING ? String(value) : Number(value);
    if (desc.form?.type === 'enum' && !desc.form.values.includes(v)) throw new PtpError(`${formatPropValue(code, v)} is not an allowed ${desc.name} value.`);
    if (desc.form?.type === 'range' && (v < desc.form.min || v > desc.form.max)) throw new PtpError(`${desc.name} must be between ${desc.form.min} and ${desc.form.max}.`);
    await this.transaction(PTP_OP.SetDevicePropValue, [code], encodeTyped(desc.dataType, v));
    return this.getDevicePropDesc(code);
  }

  // --- upload (works on cameras and on MTP phones that expose SendObjectInfo/SendObject) ---

  get canUpload() { return this.supports(PTP_OP.SendObjectInfo) && this.supports(PTP_OP.SendObject); }

  /**
   * Upload a file: SendObjectInfo, then SendObject. Returns { storageId, parent, handle } as the device assigned them.
   * Nothing is retried; a device that refuses (store full, read-only) throws its named response.
   */
  async uploadObject({ storageId, parent = 0, filename, bytes, objectFormat }) {
    if (!this.canUpload) throw new PtpError('This device does not support uploading (SendObjectInfo/SendObject).');
    if (!filename) throw new PtpError('A filename is required.');
    const info = buildObjectInfo({
      storageId, parentObject: parent, filename, size: bytes.length,
      objectFormat: objectFormat ?? objectFormatForFilename(filename)
    });
    const res = await this.transaction(PTP_OP.SendObjectInfo, [storageId, parent], info);
    await this.transaction(PTP_OP.SendObject, [], bytes);
    return { storageId: res.params[0], parent: res.params[1], handle: res.params[2] };
  }

  // --- events (interrupt endpoint) ---

  get canPollEvents() { return typeof this.transport.readEvent === 'function' && this.transport.epEvent !== null; }

  /** One event, or null when none arrived / the transport has no event endpoint. */
  async nextEvent() {
    if (!this.transport.readEvent) return null;
    return parseEvent(await this.transport.readEvent());
  }

  /**
   * Poll the interrupt endpoint until stop() is called. onEvent receives { code, name, transactionId, params }.
   * Returns { stop(), done } or null when the transport has no event endpoint.
   */
  startEventPolling(onEvent, { idleMs = 250, onError } = {}) {
    if (!this.canPollEvents) return null;
    let stopped = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const done = (async () => {
      while (!stopped) {
        try {
          const ev = await this.nextEvent();
          if (stopped) break;
          if (ev) onEvent(ev); else await sleep(idleMs);
        } catch (e) {
          if (stopped) break;
          onError?.(e);
          await sleep(idleMs * 4);
        }
      }
    })();
    return { stop() { stopped = true; }, done };
  }

  /**
   * Trigger the shutter (InitiateCapture) and wait for the new object(s) to
   * appear in the handle list. Returns the new handles.
   */
  async capture({ timeoutMs = 20000, pollMs = 500 } = {}) {
    const before = new Set(await this.getObjectHandles());
    await this.transaction(PTP_OP.InitiateCapture, [0, 0]);
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, pollMs));
      const fresh = (await this.getObjectHandles()).filter((h) => !before.has(h));
      if (fresh.length) return fresh;
    }
    throw new PtpError('The camera took no picture (check focus, the lens cap, or that remote capture is allowed in its settings).');
  }

  async openSession(sessionId = 1) {
    try { await this.transaction(PTP_OP.OpenSession, [sessionId]); }
    catch (e) { if (e.responseCode !== PTP_RESP.SessionAlreadyOpen) throw e; }
    this.sessionOpen = true;
  }

  async closeSession() {
    if (this.sessionOpen) { try { await this.transaction(PTP_OP.CloseSession); } catch (e) { /* ignore */ } }
    this.sessionOpen = false;
  }

  async getStorageIds() { return new DataReader((await this.transaction(PTP_OP.GetStorageIDs)).data).arr32(); }

  /** List object handles. storageId 0xffffffff = all; format 0 = all; parent 0 = root (0xffffffff = all). */
  async getObjectHandles(storageId = 0xffffffff, format = 0, parent = 0xffffffff) {
    return new DataReader((await this.transaction(PTP_OP.GetObjectHandles, [storageId, format, parent])).data).arr32();
  }

  async getObjectInfo(handle) { return parseObjectInfo((await this.transaction(PTP_OP.GetObjectInfo, [handle])).data); }

  async getObject(handle) { return (await this.transaction(PTP_OP.GetObject, [handle])).data; }

  async getThumb(handle) { try { return (await this.transaction(PTP_OP.GetThumb, [handle])).data; } catch (e) { return null; } }

  async close() { if (this.transport.close) await this.transport.close(); }
}

// --- WebUSB transport -------------------------------------------------------

export function findPtpInterface(configuration) {
  for (const iface of configuration?.interfaces || []) {
    for (const alt of iface.alternates || []) {
      if (alt.interfaceClass === 0x06 && alt.interfaceSubclass === 0x01) {
        const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
        const inn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
        const evt = alt.endpoints.find((e) => e.type === 'interrupt' && e.direction === 'in');
        if (out && inn) return { interfaceNumber: iface.interfaceNumber, epOut: out.endpointNumber, epIn: inn.endpointNumber, epEvent: evt ? evt.endpointNumber : null };
      }
    }
  }
  return null;
}

export class PtpUsbTransport {
  constructor(device) { this.device = device; }
  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const found = findPtpInterface(d.configuration);
    if (!found) throw new PtpError('No PTP/still-image interface (class 06). Put the camera/phone in PTP mode (not MTP file transfer, not charging).');
    this.interfaceNumber = found.interfaceNumber;
    this.epOut = found.epOut; this.epIn = found.epIn; this.epEvent = found.epEvent;
    await d.claimInterface(this.interfaceNumber);
  }
  async write(bytes) { const r = await this.device.transferOut(this.epOut, bytes); if (r.status !== 'ok') throw new PtpError(`USB OUT ${r.status}`); }
  async read(maxLength) { const r = await this.device.transferIn(this.epIn, maxLength); if (r.status !== 'ok' && !r.data) throw new PtpError(`USB IN ${r.status}`); return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength); }
  /** Wait for one event on the interrupt endpoint; null when the camera has none or reports a non-ok status. */
  async readEvent() {
    if (this.epEvent == null) return null;
    const r = await this.device.transferIn(this.epEvent, 64);
    if (r.status !== 'ok' || !r.data) return null;
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }
  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

export const PTP_USB_FILTERS = [{ classCode: 0x06, subclassCode: 0x01 }];

export async function requestPtpDevice() {
  if (typeof navigator === 'undefined' || !navigator.usb) throw new PtpError('WebUSB needs Chrome or Edge over HTTPS.');
  const device = await navigator.usb.requestDevice({ filters: PTP_USB_FILTERS });
  return new PtpUsbTransport(device);
}

// --- simulated camera (demo + tests) ---------------------------------------

function ptpString(s) {
  if (!s) return Uint8Array.from([0]);
  const out = new Uint8Array(1 + (s.length + 1) * 2);
  out[0] = s.length + 1;
  const dv = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(1 + i * 2, s.charCodeAt(i), true);
  return out;
}
const concat = (arrs) => { let n = 0; arrs.forEach((a) => (n += a.length)); const o = new Uint8Array(n); let k = 0; arrs.forEach((a) => { o.set(a, k); k += a.length; }); return o; };
const u32a = (n) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const u16a = (n) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
const arr32 = (list) => concat([u32a(list.length), ...list.map(u32a)]);
const arr16 = (list) => concat([u32a(list.length), ...list.map(u16a)]);

