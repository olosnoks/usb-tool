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

export function createSimulatedPtp() {
  const thumb = demoScreenshotBmp(160, 120);
  const objects = {
    1: { info: { storageId: 0x10001, objectFormat: 0x3801, compressedSize: 12, imagePixWidth: 4000, imagePixHeight: 3000, filename: 'IMG_0001.JPG', captureDate: '20240131T101500' }, data: new TextEncoder().encode('JPEGDATA0001') },
    2: { info: { storageId: 0x10001, objectFormat: 0x3801, compressedSize: 12, imagePixWidth: 4000, imagePixHeight: 3000, filename: 'IMG_0002.JPG', captureDate: '20240131T101530' }, data: new TextEncoder().encode('JPEGDATA0002') }
  };
  const state = { simulated: true, sessionOpen: false, objects, captures: 0, deleted: [] };
  let pending = [];
  const devInfo = () => concat([
    u16a(100), u32a(0), u16a(100), ptpString('sim'), u16a(0),
    arr16([0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1007, 0x1008, 0x1009, 0x100a, 0x100b, 0x100e, 0x1015]),
    arr16([0x4002, 0x400d]), arr16([0x5001]), arr16([0x3801]), arr16([0x3801]),
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
      if (h.type !== PTP_TYPE.COMMAND) return;
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
        case PTP_OP.GetDevicePropValue: reply(PTP_TYPE.DATA, h.code, h.transactionId, Uint8Array.from([87])); ok(h.transactionId); break;
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
    async read() { return pending.length ? pending.shift() : new Uint8Array(); }
  };
}
