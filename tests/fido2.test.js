import { describe, it, expect } from 'vitest';
import {
  Fido2Device, buildPackets, decodeCbor, parseGetInfo, aaguidToString, CTAPHID
} from '../src/utils/fido2Driver';
import { createSimulatedFido2 } from './helpers/sim/fido2';

describe('CBOR decode (GetInfo subset)', () => {
  it('decodes ints, text, arrays, maps and booleans', () => {
    expect(decodeCbor(Uint8Array.from([0x0a])).value).toBe(10);
    expect(decodeCbor(Uint8Array.from([0x18, 0x64])).value).toBe(100);
    expect(decodeCbor(Uint8Array.from([0x63, 0x55, 0x32, 0x46])).value).toBe('U2F'); // text(3) "U2F"
    expect(decodeCbor(Uint8Array.from([0x82, 0x01, 0x02])).value).toEqual([1, 2]); // array [1,2]
    expect(decodeCbor(Uint8Array.from([0xf5])).value).toBe(true);
    const m = decodeCbor(Uint8Array.from([0xa1, 0x01, 0x02])).value; // {1:2}
    expect(m.get(1)).toBe(2);
  });
});

describe('AAGUID formatting', () => {
  it('formats 16 bytes as a UUID', () => {
    const b = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
    expect(aaguidToString(b)).toBe('01020304-0506-0708-090a-0b0c0d0e0f10');
  });
});

describe('CTAP-HID framing', () => {
  it('builds a 64-byte init packet with the command and BE length', () => {
    const [pkt] = buildPackets(0x11223344, CTAPHID.CBOR, Uint8Array.from([0x04]));
    expect(pkt.length).toBe(64);
    const dv = new DataView(pkt.buffer);
    expect(dv.getUint32(0, false)).toBe(0x11223344);
    expect(pkt[4]).toBe(CTAPHID.CBOR | 0x80);
    expect(dv.getUint16(5, false)).toBe(1);
    expect(pkt[7]).toBe(0x04);
  });

  it('splits long messages into continuation packets', () => {
    const data = new Uint8Array(200).map((_, i) => i & 0xff);
    const pkts = buildPackets(1, CTAPHID.PING, data);
    expect(pkts.length).toBe(1 + Math.ceil((200 - 57) / 59));
    expect(pkts[1][4]).toBe(0); // first continuation seq = 0
    expect(pkts[2][4]).toBe(1);
  });
});

describe('Fido2Device against a simulated key', () => {
  it('INIT allocates a channel and reports capabilities', async () => {
    const dev = new Fido2Device(createSimulatedFido2());
    await dev.open();
    const info = await dev.init();
    expect(dev.cid).toBe(0x11223344);
    expect(info.capCbor).toBe(true);
    expect(info.deviceVersion).toBe('5.2.4');
  });

  it('reads authenticatorGetInfo', async () => {
    const dev = new Fido2Device(createSimulatedFido2());
    await dev.open();
    await dev.init();
    const info = await dev.getInfo();
    expect(info.versions).toEqual(['U2F_V2', 'FIDO_2_0', 'FIDO_2_1']);
    expect(info.aaguid).toBe('01020304-0506-0708-090a-0b0c0d0e0f10');
    expect(info.options.rk).toBe(true);
    expect(info.options.uv).toBe(true);
  });

  it('PINGs and matches the echo', async () => {
    const dev = new Fido2Device(createSimulatedFido2());
    await dev.open();
    await dev.init();
    expect(await dev.ping(24)).toBe(true);
  });

  it('parseGetInfo handles a raw CBOR map', () => {
    // {1:["FIDO_2_0"]}
    const bytes = Uint8Array.from([0xa1, 0x01, 0x81, 0x68, 0x46, 0x49, 0x44, 0x4f, 0x5f, 0x32, 0x5f, 0x30]);
    expect(parseGetInfo(bytes).versions).toEqual(['FIDO_2_0']);
  });
});
