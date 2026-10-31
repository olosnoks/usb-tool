import { describe, it, expect } from 'vitest';
import {
  MassStorageDevice, buildCbw, parseCsw, parseInquiry, parseCapacity, findMscInterface, createSimulatedMassStorage
} from '../src/utils/massStorageDriver';

describe('BOT framing', () => {
  it('builds a CBW with the USBC signature and direction flag', () => {
    const cbw = buildCbw(0x11223344, 36, true, 0, [0x12, 0, 0, 0, 36, 0]);
    const dv = new DataView(cbw.buffer);
    expect(dv.getUint32(0, true)).toBe(0x43425355);
    expect(dv.getUint32(4, true)).toBe(0x11223344);
    expect(dv.getUint32(8, true)).toBe(36);
    expect(cbw[12]).toBe(0x80); // data-in
    expect(cbw[14]).toBe(6);    // cdb length
    expect(cbw.length).toBe(31);
  });

  it('parses a CSW and rejects a bad signature', () => {
    const csw = new Uint8Array(13); const dv = new DataView(csw.buffer);
    dv.setUint32(0, 0x53425355, true); dv.setUint32(4, 7, true); csw[12] = 0;
    expect(parseCsw(csw)).toMatchObject({ tag: 7, status: 0 });
    const bad = new Uint8Array(13);
    expect(() => parseCsw(bad)).toThrow(/signature/);
  });

  it('parses INQUIRY and READ CAPACITY structures', () => {
    const inq = new Uint8Array(36);
    inq[0] = 0x00; inq[1] = 0x80;
    new TextEncoder().encodeInto('ACME    ', inq.subarray(8));
    new TextEncoder().encodeInto('SuperDisk', inq.subarray(16));
    expect(parseInquiry(inq)).toMatchObject({ removable: true, vendor: 'ACME', product: 'SuperDisk', peripheralName: expect.stringMatching(/disk/) });

    const cap = new Uint8Array(8); const d = new DataView(cap.buffer);
    d.setUint32(0, 2047, false); d.setUint32(4, 512, false);
    expect(parseCapacity(cap)).toMatchObject({ blocks: 2048, blockSize: 512, totalBytes: 2048 * 512 });
  });
});

describe('findMscInterface', () => {
  it('matches class 08 / protocol 50', () => {
    const cfg = { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 0x08, interfaceSubclass: 0x06, interfaceProtocol: 0x50, endpoints: [
      { type: 'bulk', direction: 'out', endpointNumber: 2 }, { type: 'bulk', direction: 'in', endpointNumber: 1 }
    ] }] }] };
    expect(findMscInterface(cfg)).toMatchObject({ epOut: 2, epIn: 1 });
  });
});

describe('MassStorageDevice against a simulated drive', () => {
  it('reads INQUIRY and capacity', async () => {
    const dev = new MassStorageDevice(createSimulatedMassStorage());
    await dev.open();
    expect(await dev.testUnitReady()).toBe(true);
    const inq = await dev.inquiry();
    expect(inq.product).toBe('Virtual Disk');
    const cap = await dev.readCapacity();
    expect(cap.blockSize).toBe(512);
    expect(cap.totalBytes).toBe(16384 * 512);
  });

  it('reads sector 0 (boot signature) and a data sector', async () => {
    const dev = new MassStorageDevice(createSimulatedMassStorage());
    await dev.open();
    await dev.readCapacity();
    const s0 = await dev.read(0, 1);
    expect(s0.length).toBe(512);
    expect(s0[510]).toBe(0x55);
    expect(s0[511]).toBe(0xaa);
    const s1 = await dev.read(1, 1);
    expect(s1[0]).toBe(1 & 0xff); // (abs + j) with abs=1, j=0
    expect(s1[5]).toBe((1 + 5) & 0xff);
  });

  it('reads multiple consecutive blocks in one command', async () => {
    const dev = new MassStorageDevice(createSimulatedMassStorage());
    await dev.open();
    await dev.readCapacity();
    const four = await dev.read(10, 4);
    expect(four.length).toBe(4 * 512);
  });
});
