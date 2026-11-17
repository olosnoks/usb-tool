// Test-only simulated PTP (camera) transport.
//
// Recovered from the pre-refactor driver (commit f695098^) when simulation was
// stripped from the shipping app. It fakes the USB bulk transport a PtpDevice
// talks to, so the real protocol/parsing code in ptpDriver.js can be unit
// tested without a camera. NOT imported by any app code.
import {
  buildContainer, parseContainerHeader, PTP_TYPE, PTP_RESP, PTP_OP
} from '../../../src/utils/ptpDriver.js';
import { demoScreenshotBmp } from './demoSignals.js';

const concat = (arrs) => { let n = 0; arrs.forEach((a) => (n += a.length)); const o = new Uint8Array(n); let k = 0; arrs.forEach((a) => { o.set(a, k); k += a.length; }); return o; };
const u32a = (n) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
const u16a = (n) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);
const arr32 = (list) => concat([u32a(list.length), ...list.map(u32a)]);
const arr16 = (list) => concat([u32a(list.length), ...list.map(u16a)]);
function ptpString(s) {
  if (!s) return Uint8Array.from([0]);
  const out = new Uint8Array(1 + (s.length + 1) * 2);
  out[0] = s.length + 1;
  const dv = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(1 + i * 2, s.charCodeAt(i), true);
  return out;
}

const typed = (type, v) => {
  if (type === 2) return Uint8Array.of(v);
  if (type === 4) return u16a(v);
  if (type === 6) return u32a(v);
  throw new Error('sim: unsupported type');
};

export function createSimulatedPtp({ propsWritable = true } = {}) {
  const thumb = demoScreenshotBmp(160, 120);
  const objects = {
    1: { info: { storageId: 0x10001, objectFormat: 0x3801, compressedSize: 12, imagePixWidth: 4000, imagePixHeight: 3000, filename: 'IMG_0001.JPG', captureDate: '20240131T101500' }, data: new TextEncoder().encode('JPEGDATA0001') },
    2: { info: { storageId: 0x10001, objectFormat: 0x3801, compressedSize: 12, imagePixWidth: 4000, imagePixHeight: 3000, filename: 'IMG_0002.JPG', captureDate: '20240131T101530' }, data: new TextEncoder().encode('JPEGDATA0002') }
  };
  // Device properties: code -> { type, writable, value, def, values (enum) }
  const props = {
    0x5001: { type: 2, writable: false, value: 87, def: 100, range: [0, 100, 1] },
    0x500f: { type: 4, writable: propsWritable, value: 400, def: 100, values: [100, 200, 400, 800, 1600] },
    0x500d: { type: 6, writable: propsWritable, value: 40, def: 40, values: [10, 20, 40, 80, 160, 10000] },
    0x5007: { type: 4, writable: propsWritable, value: 400, def: 280, values: [280, 400, 560, 800] },
    0x5005: { type: 4, writable: propsWritable, value: 2, def: 2, values: [2, 4, 6] }
  };
  const state = { simulated: true, sessionOpen: false, objects, captures: 0, deleted: [], props, uploads: [], eventQueue: [], failNext: null };
  let pending = [];
  let awaiting = null; // { code, txid } while a data phase from the host is expected
  let nextHandle = 100;
  const propDesc = (code) => {
    const p = props[code];
    const parts = [u16a(code), u16a(p.type), Uint8Array.of(p.writable ? 1 : 0), typed(p.type, p.def), typed(p.type, p.value)];
    if (p.values) parts.push(Uint8Array.of(2), u16a(p.values.length), ...p.values.map((v) => typed(p.type, v)));
    else if (p.range) parts.push(Uint8Array.of(1), ...p.range.map((v) => typed(p.type, v)));
    else parts.push(Uint8Array.of(0));
    return concat(parts);
  };
  const readString = (dv, o) => { const n = dv.getUint8(o); let str = ''; for (let i = 0; i < n - 1; i++) str += String.fromCharCode(dv.getUint16(o + 1 + i * 2, true)); return str; };
  const devInfo = () => concat([
    u16a(100), u32a(0), u16a(100), ptpString('sim'), u16a(0),
    arr16([0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1007, 0x1008, 0x1009, 0x100a, 0x100b, 0x100c, 0x100d, 0x100e, 0x1014, 0x1015, 0x1016]),
    arr16([0x4002, 0x4006, 0x400d]), arr16(Object.keys(props).map(Number)), arr16([0x3801]), arr16([0x3801]),
    ptpString('Simulated Optics'), ptpString('SimCam X1'), ptpString('1.0'), ptpString('SNCAM00001')
  ]);
  const objInfo = (h) => {
    const i = objects[h].info;
    return concat([
      u32a(i.storageId), u16a(i.objectFormat), u16a(0), u32a(i.compressedSize),
      u16a(0x3804), u32a(thumb.length), u32a(160), u32a(120), u32a(i.imagePixWidth), u32a(i.imagePixHeight),
      u32a(24), u32a(0), u16a(0), u32a(0), u32a(h),
      ptpString(i.filename), ptpString(i.captureDate), ptpString(''), ptpString('')
    ]);
  };
  const reply = (type, code, txid, payload) => pending.push(buildContainer(type, code, txid, [], payload));
  const ok = (txid) => pending.push(buildContainer(PTP_TYPE.RESPONSE, PTP_RESP.OK, txid));
  return {
    state,
    async open() {}, async close() {},
    async write(bytes) {
      const h = parseContainerHeader(bytes);
      if (h.type === PTP_TYPE.DATA && awaiting) {
        const aw = awaiting;
        const { code, txid } = aw;
        awaiting = null;
        const payload = bytes.slice(12, h.length);
        const pdv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        if (code === PTP_OP.SendObjectInfo) {
          // storage u32, format u16, prot u16, size u32, then 7 thumb/image u32/u16 fields up to the filename
          const filename = readString(pdv, 4 + 2 + 2 + 4 + 2 + 4 * 3 + 4 * 3 + 4 + 2 + 4 + 4);
          state.uploads.push({ filename, format: pdv.getUint16(4, true), size: pdv.getUint32(8, true), storageId: pdv.getUint32(0, true), parent: pdv.getUint32(4 + 2 + 2 + 4 + 2 + 4 * 3 + 4 * 3, true) });
          const handle = nextHandle++;
          state.pendingUpload = state.uploads[state.uploads.length - 1];
          state.pendingUpload.handle = handle;
          pending.push(buildContainer(PTP_TYPE.RESPONSE, PTP_RESP.OK, txid, [state.pendingUpload.storageId || 0x10001, state.pendingUpload.parent, handle]));
        } else if (code === PTP_OP.SendObject) {
          const up = state.pendingUpload;
          up.data = payload;
          state.pendingUpload = null;
          objects[up.handle] = { info: { storageId: 0x10001, objectFormat: up.format, compressedSize: payload.length, imagePixWidth: 0, imagePixHeight: 0, filename: up.filename, captureDate: '' }, data: payload };
          ok(txid);
        } else if (code === PTP_OP.SetDevicePropValue) {
          const prop = props[aw.prop];
          prop.value = prop.type === 2 ? payload[0] : prop.type === 4 ? pdv.getUint16(0, true) : pdv.getUint32(0, true);
          state.lastSet = { code: aw.prop, value: prop.value };
          ok(txid);
        }
        return;
      }
      if (h.type !== PTP_TYPE.COMMAND) return;
      if (state.failNext) { const rc = state.failNext; state.failNext = null; pending.push(buildContainer(PTP_TYPE.RESPONSE, rc, h.transactionId)); return; }
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const p = []; for (let o = 12; o + 4 <= h.length; o += 4) p.push(dv.getUint32(o, true));
      switch (h.code) {
        case PTP_OP.OpenSession: state.sessionOpen = true; ok(h.transactionId); break;
        case PTP_OP.CloseSession: state.sessionOpen = false; ok(h.transactionId); break;
        case PTP_OP.GetDeviceInfo: reply(PTP_TYPE.DATA, h.code, h.transactionId, devInfo()); ok(h.transactionId); break;
        case PTP_OP.GetStorageIDs: reply(PTP_TYPE.DATA, h.code, h.transactionId, arr32([0x10001])); ok(h.transactionId); break;
        case PTP_OP.GetObjectHandles: reply(PTP_TYPE.DATA, h.code, h.transactionId, arr32(Object.keys(objects).map(Number))); ok(h.transactionId); break;
        case PTP_OP.GetObjectInfo: reply(PTP_TYPE.DATA, h.code, h.transactionId, objInfo(p[0])); ok(h.transactionId); break;
        case PTP_OP.GetObject: reply(PTP_TYPE.DATA, h.code, h.transactionId, objects[p[0]].data); ok(h.transactionId); break;
        case PTP_OP.GetThumb: reply(PTP_TYPE.DATA, h.code, h.transactionId, thumb); ok(h.transactionId); break;
        case PTP_OP.GetStorageInfo:
          reply(PTP_TYPE.DATA, h.code, h.transactionId, concat([u16a(4), u16a(2), u16a(0), u32a(0), u32a(16), u32a(0x40000000), u32a(9), u32a(1840), ptpString('SD card'), ptpString('SIMCAM')]));
          ok(h.transactionId);
          break;
        case PTP_OP.GetDevicePropValue:
          if (!props[p[0]]) pending.push(buildContainer(PTP_TYPE.RESPONSE, 0x200a, h.transactionId));
          else { reply(PTP_TYPE.DATA, h.code, h.transactionId, typed(props[p[0]].type, props[p[0]].value)); ok(h.transactionId); }
          break;
        case PTP_OP.GetDevicePropDesc:
          if (!props[p[0]]) pending.push(buildContainer(PTP_TYPE.RESPONSE, 0x200a, h.transactionId));
          else { reply(PTP_TYPE.DATA, h.code, h.transactionId, propDesc(p[0])); ok(h.transactionId); }
          break;
        case PTP_OP.SetDevicePropValue: awaiting = { code: h.code, txid: h.transactionId, prop: p[0] }; break;
        case PTP_OP.SendObjectInfo: case PTP_OP.SendObject: awaiting = { code: h.code, txid: h.transactionId }; break;
        case PTP_OP.DeleteObject: delete objects[p[0]]; state.deleted.push(p[0]); ok(h.transactionId); break;
        case PTP_OP.InitiateCapture: {
          const n = 3 + state.captures++;
          objects[n] = { info: { ...objects[1]?.info, storageId: 0x10001, objectFormat: 0x3801, compressedSize: 12, imagePixWidth: 4000, imagePixHeight: 3000, filename: `IMG_000${n}.JPG`, captureDate: '20260131T120000' }, data: new TextEncoder().encode(`JPEGDATA000${n}`) };
          ok(h.transactionId);
          break;
        }
        default: pending.push(buildContainer(PTP_TYPE.RESPONSE, 0x2005, h.transactionId));
      }
    },
    async read() { return pending.length ? pending.shift() : new Uint8Array(); },
    /** Queue an event the camera will deliver on its interrupt endpoint. */
    pushEvent(code, params = []) { state.eventQueue.push(buildContainer(PTP_TYPE.EVENT, code, 0, params)); },
    async readEvent() { return state.eventQueue.length ? state.eventQueue.shift() : null; }
  };
}
