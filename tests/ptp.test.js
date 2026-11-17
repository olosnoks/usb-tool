import { describe, it, expect } from 'vitest';
import {
  PtpDevice, buildContainer, parseContainerHeader, parseDeviceInfo, parseObjectInfo,
  DataReader, findPtpInterface, objectFormatName, PTP_TYPE, PTP_OP, PTP_PROP, PTP_EVENT,
  parseDevicePropDesc, formatPropValue, parseEvent, buildObjectInfo, responseName
} from '../src/utils/ptpDriver';
import { createSimulatedPtp } from './helpers/sim/ptp';

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

describe('PTP storage, battery, capture and delete', () => {
  const Dev = PtpDevice; const sim = createSimulatedPtp; const OP = PTP_OP;
  const open = async () => {
    const t = sim();
    const d = new Dev(t);
    await d.open();
    await d.openSession();
    await d.getDeviceInfo();
    return { d, t };
  };

  it('reads storage info and battery level', async () => {
    const { d } = await open();
    const [sid] = await d.getStorageIds();
    const s = await d.getStorageInfo(sid);
    expect(s).toMatchObject({ storageType: 'removable RAM', readOnly: false, description: 'SD card', volumeLabel: 'SIMCAM', freeImages: 1840 });
    expect(s.maxCapacity).toBe(16 * 2 ** 32);
    expect(await d.getBatteryLevel()).toBe(87);
  });

  it('captures a new picture and deletes it', async () => {
    const { d, t } = await open();
    expect(d.supports(OP.InitiateCapture)).toBe(true);
    const fresh = await d.capture({ pollMs: 5 });
    expect(fresh).toEqual([3]);
    expect((await d.getObjectInfo(3)).filename).toBe('IMG_0003.JPG');
    await d.deleteObject(3);
    expect(t.state.deleted).toEqual([3]);
    expect(await d.getObjectHandles()).toEqual([1, 2]);
  });

  it('returns thumbnails', async () => {
    const { d } = await open();
    const th = await d.getThumb(1);
    expect(String.fromCharCode(th[0], th[1])).toBe('BM');
    expect((await d.getObjectInfo(1)).thumbFormat).toBe(0x3804);
  });
});

describe('PTP device properties', () => {
  const open = async (opts) => {
    const t = createSimulatedPtp(opts);
    const d = new PtpDevice(t);
    await d.open();
    await d.openSession();
    await d.getDeviceInfo();
    return { d, t };
  };

  it('formats values with the units the spec defines', () => {
    expect(formatPropValue(PTP_PROP.FNumber, 280)).toBe('f/2.8');
    expect(formatPropValue(PTP_PROP.ExposureTime, 40)).toBe('1/250 s');
    expect(formatPropValue(PTP_PROP.ExposureTime, 20000)).toBe('2 s');
    expect(formatPropValue(PTP_PROP.ExposureIndex, 800)).toBe('ISO 800');
    expect(formatPropValue(PTP_PROP.WhiteBalance, 4)).toBe('Daylight');
    expect(formatPropValue(PTP_PROP.ExposureBiasCompensation, -1000)).toBe('-1.0 EV');
    expect(formatPropValue(PTP_PROP.BatteryLevel, 55)).toBe('55%');
  });

  it('reads descriptors with enum and range forms', async () => {
    const { d } = await open();
    const iso = await d.getDevicePropDesc(PTP_PROP.ExposureIndex);
    expect(iso).toMatchObject({ name: 'ISO', writable: true, value: 400, display: 'ISO 400' });
    expect(iso.options.map((o) => o.value)).toEqual([100, 200, 400, 800, 1600]);
    const batt = await d.getDevicePropDesc(PTP_PROP.BatteryLevel);
    expect(batt).toMatchObject({ writable: false, value: 87, form: { type: 'range', min: 0, max: 100 } });
    expect(await d.getDevicePropValue(PTP_PROP.ExposureTime)).toBe(40);
  });

  it('lists only the common properties the camera reports', async () => {
    const { d } = await open();
    const props = await d.getCommonProps();
    expect(props.map((p) => p.name)).toEqual(['Battery level', 'ISO', 'Shutter speed', 'Aperture', 'White balance']);
    d.deviceInfo.devicePropertiesSupported = [0x5001];
    expect((await d.getCommonProps()).map((p) => p.name)).toEqual(['Battery level']);
  });

  it('sets an allowed value, and refuses disallowed, read-only and unwritable cases', async () => {
    const { d, t } = await open();
    const after = await d.setDeviceProp(PTP_PROP.ExposureIndex, 800);
    expect(after.value).toBe(800);
    expect(t.state.lastSet).toEqual({ code: 0x500f, value: 800 });
    await expect(d.setDeviceProp(PTP_PROP.ExposureIndex, 123)).rejects.toThrow(/not an allowed/);
    await expect(d.setDeviceProp(PTP_PROP.BatteryLevel, 50)).rejects.toThrow(/read-only/);
    const ro = await open({ propsWritable: false });
    await expect(ro.d.setDeviceProp(PTP_PROP.ExposureIndex, 800)).rejects.toThrow(/read-only/);
  });

  it('a missing property is a named error, not a made-up value', async () => {
    const { d } = await open();
    await expect(d.getDevicePropDesc(0x5013)).rejects.toMatchObject({ responseCode: 0x200a, message: expect.stringContaining('Device property not supported') });
  });

  it('parses a descriptor byte-for-byte', () => {
    // ISO (0x500f), UINT16, read/write, default 100, current 200, enum [100, 200]
    const bytes = Uint8Array.from([0x0f, 0x50, 4, 0, 1, 100, 0, 200, 0, 2, 2, 0, 100, 0, 200, 0]);
    expect(parseDevicePropDesc(bytes)).toMatchObject({ code: 0x500f, value: 200, factoryDefault: 100, form: { type: 'enum', values: [100, 200] } });
  });
});

describe('PTP events', () => {
  it('parses an event container', () => {
    const c = buildContainer(PTP_TYPE.EVENT, PTP_EVENT.ObjectAdded, 0, [42]);
    expect(parseEvent(c)).toEqual({ code: 0x4002, name: 'ObjectAdded', transactionId: 0, params: [42] });
    expect(parseEvent(buildContainer(PTP_TYPE.RESPONSE, 0x2001, 1))).toBeNull();
  });

  it('delivers events from the interrupt endpoint until stopped', async () => {
    const t = createSimulatedPtp();
    const d = new PtpDevice(t);
    await d.open();
    t.pushEvent(PTP_EVENT.ObjectAdded, [7]);
    t.pushEvent(PTP_EVENT.DevicePropChanged, [0x500f]);
    const seen = [];
    const h = d.startEventPolling((e) => seen.push(e), { idleMs: 5 });
    await new Promise((r) => setTimeout(r, 60));
    h.stop(); await h.done;
    expect(seen.map((e) => e.name)).toEqual(['ObjectAdded', 'DevicePropChanged']);
    expect(seen[1].params).toEqual([0x500f]);
    t.pushEvent(PTP_EVENT.CaptureComplete);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(2); // stopped: nothing more is consumed
  });

  it('has no polling when the transport has no event endpoint', () => {
    const d = new PtpDevice({ write: async () => {}, read: async () => new Uint8Array() });
    expect(d.startEventPolling(() => {})).toBeNull();
    const d2 = new PtpDevice({ write: async () => {}, read: async () => new Uint8Array(), readEvent: async () => null, epEvent: null });
    expect(d2.canPollEvents).toBe(false);
  });
});

describe('PTP / MTP upload', () => {
  it('uploads a file with SendObjectInfo then SendObject', async () => {
    const t = createSimulatedPtp();
    const d = new PtpDevice(t);
    await d.open(); await d.openSession(); await d.getDeviceInfo();
    expect(d.canUpload).toBe(true);
    const bytes = new TextEncoder().encode('hello camera');
    const res = await d.uploadObject({ storageId: 0x10001, filename: 'notes.txt', bytes });
    expect(res).toMatchObject({ storageId: 0x10001, parent: 0 });
    expect(t.state.uploads[0]).toMatchObject({ filename: 'notes.txt', size: bytes.length, format: 0x3000 });
    expect(td.decode(await d.getObject(res.handle))).toBe('hello camera');
    expect((await d.getObjectInfo(res.handle)).filename).toBe('notes.txt');
  });

  it('encodes ObjectInfo the parser can read back', () => {
    const info = parseObjectInfo(buildObjectInfo({ storageId: 5, filename: 'a.jpg', size: 10, parentObject: 3, objectFormat: 0x3801 }));
    expect(info).toMatchObject({ storageId: 5, objectFormat: 0x3801, compressedSize: 10, parentObject: 3, filename: 'a.jpg' });
  });

  it('refuses when the device lacks the operations, and names a refusal', async () => {
    const d = new PtpDevice(createSimulatedPtp());
    await d.open(); await d.openSession(); await d.getDeviceInfo();
    d.deviceInfo.operationsSupported = d.deviceInfo.operationsSupported.filter((o) => o !== PTP_OP.SendObject);
    await expect(d.uploadObject({ storageId: 1, filename: 'x', bytes: new Uint8Array(1) })).rejects.toThrow(/does not support uploading/);
    const t = createSimulatedPtp();
    const d2 = new PtpDevice(t);
    await d2.open(); await d2.openSession(); await d2.getDeviceInfo();
    t.state.failNext = 0x200c;
    await expect(d2.uploadObject({ storageId: 1, filename: 'x', bytes: new Uint8Array(1) })).rejects.toThrow(/Store full/);
    expect(responseName(0x2019)).toBe('Device busy');
  });
});
