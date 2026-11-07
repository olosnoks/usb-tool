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
  GetThumb: 0x100a, DeleteObject: 0x100b, InitiateCapture: 0x100e,
  GetDevicePropDesc: 0x1014, GetDevicePropValue: 0x1015, GetPartialObject: 0x101b
};
export const PTP_PROP = { BatteryLevel: 0x5001 };
export const PTP_RESP = { OK: 0x2001, SessionNotOpen: 0x2003, SessionAlreadyOpen: 0x201e };

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
          if (c.code !== PTP_RESP.OK) throw new PtpError(`PTP operation 0x${code.toString(16)} failed (response 0x${c.code.toString(16)}).`, c.code);
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
        if (out && inn) return { interfaceNumber: iface.interfaceNumber, epOut: out.endpointNumber, epIn: inn.endpointNumber };
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
    this.epOut = found.epOut; this.epIn = found.epIn;
    await d.claimInterface(this.interfaceNumber);
  }
  async write(bytes) { const r = await this.device.transferOut(this.epOut, bytes); if (r.status !== 'ok') throw new PtpError(`USB OUT ${r.status}`); }
  async read(maxLength) { const r = await this.device.transferIn(this.epIn, maxLength); if (r.status !== 'ok' && !r.data) throw new PtpError(`USB IN ${r.status}`); return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength); }
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

