import { describe, it, expect, vi } from 'vitest';
import {
  dfuCrc32,
  parseDfuSuffix,
  parseDfuSeImage,
  parseDfuStatus,
  parseDfuFunctionalDescriptor,
  DfuDevice,
  DFU_REQUEST,
  DFU_STATE
} from '../src/utils/dfuDriver';

describe('DFU CRC-32 (suffix convention: no final inversion)', () => {
  it('matches the known "123456789" vector', () => {
    const data = new TextEncoder().encode('123456789');
    // Standard CRC-32 of "123456789" is 0xCBF43926 (after final XOR).
    // The DFU suffix stores the pre-inversion register = value ^ 0xFFFFFFFF.
    expect(dfuCrc32(data) >>> 0).toBe(0xcbf43926 ^ 0xffffffff);
  });
});

describe('parseDfuSuffix', () => {
  const buildSuffixed = (payload, vid, pid) => {
    const total = new Uint8Array(payload.length + 16);
    total.set(payload, 0);
    const dv = new DataView(total.buffer);
    const base = payload.length;
    dv.setUint16(base + 0, 0xffff, true); // bcdDevice
    dv.setUint16(base + 2, pid, true); // idProduct
    dv.setUint16(base + 4, vid, true); // idVendor
    dv.setUint16(base + 6, 0x011a, true); // bcdDFU
    total[base + 8] = 0x44; // 'D'
    total[base + 9] = 0x46; // 'F'
    total[base + 10] = 0x55; // 'U'
    total[base + 11] = 16; // bLength
    const crc = dfuCrc32(total.subarray(0, total.length - 4));
    dv.setUint32(base + 12, crc, true);
    return total;
  };

  it('validates a correct suffix and strips the payload', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const file = buildSuffixed(payload, 0x0483, 0xdf11);
    const res = parseDfuSuffix(file);
    expect(res.present).toBe(true);
    expect(res.valid).toBe(true);
    expect(res.idVendor).toBe(0x0483);
    expect(res.idProduct).toBe(0xdf11);
    expect(Array.from(res.payload)).toEqual([1, 2, 3, 4, 5]);
  });

  it('flags a corrupted CRC', () => {
    const file = buildSuffixed(new Uint8Array([9, 9, 9]), 0x0483, 0xdf11);
    file[0] ^= 0xff; // mutate payload after CRC was computed
    const res = parseDfuSuffix(file);
    expect(res.present).toBe(true);
    expect(res.valid).toBe(false);
  });

  it('treats a raw binary with no suffix as present:false', () => {
    const res = parseDfuSuffix(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
    expect(res.present).toBe(false);
    expect(res.payload.length).toBe(8);
  });
});

describe('parseDfuSeImage', () => {
  it('returns isDfuSe:false for a plain binary', () => {
    expect(parseDfuSeImage(new Uint8Array([1, 2, 3])).isDfuSe).toBe(false);
  });

  it('parses one target with one element at an address', () => {
    const elemData = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
    const targetHeader = 274; // signature6+alt1+named4+name255+size4+nb4
    const total = 11 + targetHeader + 8 + elemData.length;
    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    // Prefix: "DfuSe"
    buf.set([0x44, 0x66, 0x75, 0x53, 0x65], 0);
    buf[5] = 0x01; // bVersion
    dv.setUint32(6, total, true); // DFUImageSize
    buf[10] = 1; // bTargets
    // Target @ 11
    buf.set(new TextEncoder().encode('Target'), 11);
    buf[17] = 0; // bAlternateSetting
    dv.setUint32(11 + 270, 1, true); // dwNbElements
    // Element @ 11 + 274
    const eoff = 11 + 274;
    dv.setUint32(eoff, 0x08004000, true); // address
    dv.setUint32(eoff + 4, elemData.length, true); // size
    buf.set(elemData, eoff + 8);

    const res = parseDfuSeImage(buf);
    expect(res.isDfuSe).toBe(true);
    expect(res.targets).toHaveLength(1);
    expect(res.targets[0].elements[0].address).toBe(0x08004000);
    expect(Array.from(res.targets[0].elements[0].data)).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });
});

describe('parseDfuStatus', () => {
  it('decodes status, poll timeout and state', () => {
    const buf = new Uint8Array([0x00, 0xe8, 0x03, 0x00, DFU_STATE.dfuDNLOAD_IDLE, 0]);
    const s = parseDfuStatus(new DataView(buf.buffer));
    expect(s.status).toBe(0);
    expect(s.pollTimeout).toBe(1000); // 0x03e8
    expect(s.state).toBe(DFU_STATE.dfuDNLOAD_IDLE);
    expect(s.stateText).toBe('dfuDNLOAD_IDLE');
  });
});

describe('parseDfuFunctionalDescriptor', () => {
  it('extracts transferSize and attribute flags', () => {
    // bLength=9, bType=0x21, bmAttributes=0x0b, detach=0x00ff, transfer=0x0800, bcdDFU=0x011a
    const desc = new Uint8Array([
      0x09, 0x21, 0x0b, 0xff, 0x00, 0x00, 0x08, 0x1a, 0x01
    ]);
    // Prepend an unrelated interface descriptor to prove the walk skips it.
    const iface = new Uint8Array([0x09, 0x04, 0, 0, 0, 0xfe, 0x01, 0x02, 0]);
    const combined = new Uint8Array([...iface, ...desc]);
    const f = parseDfuFunctionalDescriptor(combined);
    expect(f.transferSize).toBe(0x0800);
    expect(f.bcdDFU).toBe(0x011a);
    expect(f.canDownload).toBe(true);
    expect(f.canUpload).toBe(true);
    expect(f.willDetach).toBe(true);
  });
});

/**
 * Fake WebUSB device that records every control transfer and always reports a
 * clean, idle DFU status. Lets us exercise the download state machine with no
 * hardware present.
 */
function makeFakeDevice() {
  const outCalls = [];
  const okStatus = () =>
    Promise.resolve({
      status: 'ok',
      data: new DataView(new Uint8Array([0x00, 0x00, 0x00, 0x00, DFU_STATE.dfuIDLE, 0]).buffer)
    });
  return {
    outCalls,
    controlTransferOut: vi.fn((setup, data) => {
      outCalls.push({ request: setup.request, value: setup.value, length: data ? data.length : 0 });
      return Promise.resolve({ status: 'ok', bytesWritten: data ? data.length : 0 });
    }),
    controlTransferIn: vi.fn((setup) => {
      if (setup.request === DFU_REQUEST.GETSTATUS) return okStatus();
      return Promise.resolve({ status: 'ok', data: new DataView(new ArrayBuffer(0)) });
    })
  };
}

describe('DfuDevice.download (plain DFU 1.1)', () => {
  it('splits into transferSize blocks and ends with a zero-length DNLOAD', async () => {
    const dev = makeFakeDevice();
    const driver = new DfuDevice(dev, 0, { transferSize: 1024 });
    const data = new Uint8Array(2500).fill(0x5a);

    const progress = [];
    await driver.download(data, (p) => progress.push(p.written));

    const dnloads = dev.outCalls.filter((c) => c.request === DFU_REQUEST.DNLOAD);
    // 3 data blocks (1024 + 1024 + 452) + 1 terminating zero-length.
    expect(dnloads.map((c) => c.length)).toEqual([1024, 1024, 452, 0]);
    // Block numbers increment 0,1,2,3.
    expect(dnloads.map((c) => c.value)).toEqual([0, 1, 2, 3]);
    expect(progress[progress.length - 1]).toBe(2500);
  });
});

describe('DfuDevice DfuSe addressing', () => {
  it('encodes SET_ADDRESS as 0x21 + little-endian address in block 0', async () => {
    const dev = makeFakeDevice();
    const driver = new DfuDevice(dev, 0, { transferSize: 1024, dfuse: true });
    await driver.dfuseSetAddress(0x08004000);

    const cmd = dev.controlTransferOut.mock.calls.find(
      ([setup]) => setup.request === DFU_REQUEST.DNLOAD
    );
    expect(cmd).toBeTruthy();
    const payload = Array.from(cmd[1]);
    expect(payload).toEqual([0x21, 0x00, 0x40, 0x00, 0x08]);
  });
});
