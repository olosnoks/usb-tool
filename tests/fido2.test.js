import { describe, it, expect } from 'vitest';
import {
  Fido2Device, Fido2Error, buildPackets, decodeCbor, parseGetInfo, aaguidToString, aaguidName, CTAPHID
} from '../src/utils/fido2Driver';
import { createSimulatedFido2 } from './helpers/sim/fido2';
import { setAaguidNames } from '../src/utils/fido2Driver';

// The AAGUID name list is fetched at runtime in the app; tests inject a fixed table.
setAaguidNames({ 'ee882879-721c-4913-9775-3dfcce97072a': 'YubiKey 5 Series' });

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

// --- tiny CBOR encoder for fixtures -----------------------------------------
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let k = 0; for (const x of p) { o.set(x, k); k += x.length; } return o; };
const head = (mt, n) => (n < 24 ? Uint8Array.of((mt << 5) | n) : n < 256 ? Uint8Array.of((mt << 5) | 24, n) : n < 65536 ? Uint8Array.of((mt << 5) | 25, n >> 8, n & 0xff) : Uint8Array.of((mt << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff));
const enc = (v) => {
  if (v instanceof Uint8Array) return cat(head(2, v.length), v);
  if (typeof v === 'string') { const u = new TextEncoder().encode(v); return cat(head(3, u.length), u); }
  if (typeof v === 'boolean') return Uint8Array.of(v ? 0xf5 : 0xf4);
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (Array.isArray(v)) return cat(head(4, v.length), ...v.map(enc));
  if (v instanceof Map) return cat(head(5, v.size), ...[...v].flatMap(([k, x]) => [enc(k), enc(x)]));
  throw new Error('enc');
};
const uuidBytes = (u) => Uint8Array.from(u.replace(/-/g, '').match(/../g).map((h) => parseInt(h, 16)));

// Modelled on the getInfo of a YubiKey 5 (fw 5.4, firmwareVersion 0x050400): synthetic bytes built here, not a recording.
const YUBIKEY5_AAGUID = 'ee882879-721c-4913-9775-3dfcce97072a';
function yubikeyInfo() {
  return enc(new Map([
    [1, ['U2F_V2', 'FIDO_2_0', 'FIDO_2_1_PRE']],
    [2, ['credProtect', 'hmac-secret']],
    [3, uuidBytes(YUBIKEY5_AAGUID)],
    [4, new Map([['rk', true], ['up', true], ['plat', false], ['clientPin', true]])],
    [5, 1200],
    [6, [2, 1]],
    [7, 8],
    [8, 128],
    [9, ['usb', 'nfc']],
    [10, [new Map([['alg', -7], ['type', 'public-key']]), new Map([['alg', -8], ['type', 'public-key']])]],
    [0x0d, 4],
    [0x0e, 0x050400],
    [0x14, 25]
  ]));
}

describe('full getInfo decoding (USB-6)', () => {
  it('returns extensions, algorithms, firmwareVersion and names the AAGUID', () => {
    const info = parseGetInfo(yubikeyInfo());
    expect(info.extensions).toEqual(['credProtect', 'hmac-secret']);
    expect(info.algorithms.map((a) => a.name)).toEqual(['ES256', 'EdDSA']);
    expect(info.firmwareVersion).toBe(0x050400);
    expect(info.minPinLength).toBe(4);
    expect(info.remainingDiscoverableCredentials).toBe(25);
    expect(info.aaguid).toBe(YUBIKEY5_AAGUID);
    expect(info.aaguidName).toBe('YubiKey 5 Series');
  });

  it('unknown AAGUIDs have no name', () => {
    expect(aaguidName('01020304-0506-0708-090a-0b0c0d0e0f10')).toBeNull();
    const info = parseGetInfo(enc(new Map([[1, ['FIDO_2_0']], [3, Uint8Array.from({ length: 16 }, (_, i) => i + 1)]])));
    expect(info.aaguid).toBe('01020304-0506-0708-090a-0b0c0d0e0f10');
    expect(info.aaguidName).toBeNull();
  });

  it('malformed CBOR throws Fido2Error, not RangeError', () => {
    expect(() => parseGetInfo(Uint8Array.of(0xa5, 0x01))).toThrow(Fido2Error);
    expect(() => parseGetInfo(Uint8Array.of(0x78, 0xff, 0x41))).toThrow(Fido2Error);
  });
});

describe('receive timeout and channel filtering', () => {
  it('_recv rejects after the deadline when the transport never answers', async () => {
    const dev = new Fido2Device({ write: async () => {}, read: () => new Promise(() => {}) });
    const t0 = Date.now();
    await expect(dev._recv({ timeout: 80 })).rejects.toThrow(/did not answer/);
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('ignores frames for other CIDs', async () => {
    const dev = new Fido2Device({ write: async () => {}, read: async () => new Uint8Array(64) });
    dev.cid = 0x01020304;
    const queue = [
      buildPackets(0x0a0b0c0d, CTAPHID.PING, Uint8Array.of(9, 9))[0],
      buildPackets(0x01020304, CTAPHID.PING, Uint8Array.of(1, 2))[0]
    ];
    dev.transport = { read: async () => queue.shift() };
    const { data } = await dev._recv({ timeout: 500 });
    expect(Array.from(data)).toEqual([1, 2]);
  });

  it('getInfo refuses on a U2F-only key', async () => {
    const dev = new Fido2Device(createSimulatedFido2());
    dev.ctapInfo = { capCbor: false };
    await expect(dev.getInfo()).rejects.toThrow(/U2F-only/);
  });
});
