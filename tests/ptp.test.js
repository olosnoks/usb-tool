import { describe, it, expect } from 'vitest';
import {
  PtpDevice, buildContainer, parseContainerHeader, parseDeviceInfo, parseObjectInfo,
  DataReader, findPtpInterface, objectFormatName, createSimulatedPtp, PTP_TYPE, PTP_OP
} from '../src/utils/ptpDriver';

const td = new TextDecoder();

describe('PTP containers', () => {
  it('builds and parses a command container with params', () => {
    const c = buildContainer(PTP_TYPE.COMMAND, PTP_OP.OpenSession, 7, [1]);
    const h = parseContainerHeader(c);
    expect(h).toMatchObject({ length: 16, type: 1, code: 0x1002, transactionId: 7 });
    expect(new DataView(c.buffer).getUint32(12, true)).toBe(1);
  });
});

describe('PTP string/array reader', () => {
  it('reads UTF-16 strings and arrays', () => {
    // string "Hi" = len 3 (incl null), 'H','i',0
    const bytes = Uint8Array.from([0x03, 0x48, 0, 0x69, 0, 0, 0]);
    expect(new DataReader(bytes).str()).toBe('Hi');
    const arr = Uint8Array.from([2, 0, 0, 0, 0x01, 0x30, 0x08, 0x38]); // [0x3001, 0x3808]
    expect(new DataReader(arr).arr16()).toEqual([0x3001, 0x3808]);
  });
});

describe('findPtpInterface', () => {
  it('matches class 06 / subclass 01', () => {
    const cfg = { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 0x06, interfaceSubclass: 0x01, interfaceProtocol: 0x01, endpoints: [
      { type: 'bulk', direction: 'out', endpointNumber: 2 }, { type: 'bulk', direction: 'in', endpointNumber: 1 }
    ] }] }] };
    expect(findPtpInterface(cfg)).toMatchObject({ epOut: 2, epIn: 1 });
  });
});

describe('object format names', () => {
  it('names common formats', () => {
    expect(objectFormatName(0x3801)).toMatch(/JPEG/);
    expect(objectFormatName(0x3001)).toMatch(/Association/);
    expect(objectFormatName(0x9999)).toBe('0x9999');
  });
});

describe('PtpDevice against a simulated camera', () => {
  it('opens a session and reads device info', async () => {
    const cam = createSimulatedPtp();
    const ptp = new PtpDevice(cam);
    await ptp.open();
    await ptp.openSession();
    expect(cam.state.sessionOpen).toBe(true);
    const info = await ptp.getDeviceInfo();
    expect(info.manufacturer).toBe('Simulated Optics');
    expect(info.model).toBe('SimCam X1');
    expect(info.serialNumber).toBe('SNCAM00001');
    expect(info.imageFormats).toContain(0x3801);
  });

  it('lists storages and object handles, and reads object info', async () => {
    const ptp = new PtpDevice(createSimulatedPtp());
    await ptp.open();
    await ptp.openSession();
    expect(await ptp.getStorageIds()).toEqual([0x10001]);
    const handles = await ptp.getObjectHandles();
    expect(handles).toEqual([1, 2]);
    const info = await ptp.getObjectInfo(1);
    expect(info.filename).toBe('IMG_0001.JPG');
    expect(info.objectFormat).toBe(0x3801);
    expect(info.imagePixWidth).toBe(4000);
  });

  it('downloads an object', async () => {
    const ptp = new PtpDevice(createSimulatedPtp());
    await ptp.open();
    await ptp.openSession();
    expect(td.decode(await ptp.getObject(2))).toBe('JPEGDATA0002');
  });

  it('throws a PtpError with the response code on an unsupported op', async () => {
    const ptp = new PtpDevice(createSimulatedPtp());
    await ptp.open();
    await expect(ptp.transaction(0x1099)).rejects.toMatchObject({ responseCode: 0x2005 });
  });
});
