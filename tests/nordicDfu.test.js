import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { NordicSecureDfu, readDfuPackage, encodeValue, DFU_OP, DFU_OBJ, enterBootloader } from '../src/utils/nordicDfu';
import { crc32 } from '../src/utils/adbTools';

const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** A Nordic Secure DFU bootloader: objects are created, streamed, CRC-checked and executed. */
function fakeBootloader({ maxData = 4096, maxCommand = 256, failPacketAt = null, rejectInit = false } = {}) {
  const st = {
    [DFU_OBJ.COMMAND]: { committed: [], current: [] },
    [DFU_OBJ.DATA]: { committed: [], current: [] },
    type: DFU_OBJ.COMMAND, packets: 0, executed: [], prn: null
  };
  const listeners = [];
  const notify = (bytes) => setTimeout(() => listeners.forEach((l) => l({ target: { value: new DataView(Uint8Array.from(bytes).buffer) } })), 0);
  const received = (t) => [...st[t].committed, ...st[t].current];
  const control = {
    async startNotifications() {},
    addEventListener(_, fn) { listeners.push(fn); },
    removeEventListener(_, fn) { listeners.splice(listeners.indexOf(fn), 1); },
    async writeValueWithResponse(v) {
      const b = Array.from(v);
      const op = b[0];
      const ok = (extra = []) => notify([DFU_OP.RESPONSE, op, 0x01, ...extra]);
      if (op === DFU_OP.SET_PRN) { st.prn = b[1] | (b[2] << 8); ok(); return; }
      if (op === DFU_OP.SELECT) {
        st.type = b[1];
        const r = Uint8Array.from(received(b[1]));
        ok([...u32(b[1] === DFU_OBJ.DATA ? maxData : maxCommand), ...u32(r.length), ...u32(r.length ? crc32(r) : 0)]);
        return;
      }
      if (op === DFU_OP.CREATE) { st.type = b[1]; st[b[1]].current = []; ok(); return; }
      if (op === DFU_OP.CALC_CRC) { const r = Uint8Array.from(received(st.type)); ok([...u32(r.length), ...u32(crc32(r))]); return; }
      if (op === DFU_OP.EXECUTE) {
        const s = st[st.type];
        // Re-executing a complete init packet re-validates it (success); a data object with nothing new is refused.
        if (!s.current.length) { notify([DFU_OP.RESPONSE, op, st.type === DFU_OBJ.COMMAND && s.committed.length ? 0x01 : 0x08]); return; }
        if (st.type === DFU_OBJ.COMMAND && rejectInit) { notify([DFU_OP.RESPONSE, op, 0x0b, 0x0b]); return; }
        s.committed.push(...s.current);
        s.current = [];
        st.executed.push(st.type);
        ok();
      }
    }
  };
  const packet = {
    async writeValueWithoutResponse(v) {
      st.packets++;
      if (failPacketAt !== null && st.packets === failPacketAt) throw new Error('GATT link lost');
      st[st.type].current.push(...v);
    }
  };
  return { control, packet, st };
}

const firmware = Uint8Array.from({ length: 10000 }, (_, i) => (i * 31) & 0xff);
const initPacket = Uint8Array.from({ length: 140 }, (_, i) => i);

describe('Nordic Secure DFU', () => {
  it('sends the init packet and firmware in objects and verifies each CRC', async () => {
    const b = fakeBootloader();
    const dfu = new NordicSecureDfu(b.control, b.packet, { chunkSize: 100, prn: 0 });
    await dfu.start();
    const phases = [];
    await dfu.update({ initPacket, firmware }, (phase, f) => phases.push([phase, f]));
    expect(Uint8Array.from(b.st[DFU_OBJ.COMMAND].committed)).toEqual(initPacket);
    expect(Uint8Array.from(b.st[DFU_OBJ.DATA].committed)).toEqual(firmware);
    expect(b.st.executed).toEqual([1, 2, 2, 2]); // init + three 4 KB data objects
    expect(phases[phases.length - 1]).toEqual(['firmware', 1]);
  });

  it('resumes after a dropped link without resending finished objects', async () => {
    const b = fakeBootloader({ failPacketAt: 2 + 41 + 10 }); // init (2 chunks), first object (41), then partway into the second
    const first = new NordicSecureDfu(b.control, b.packet, { chunkSize: 100 });
    await first.start();
    await expect(first.update({ initPacket, firmware })).rejects.toThrow(/link lost/);
    first.stop();
    expect(b.st[DFU_OBJ.DATA].committed.length).toBe(4096);
    const packetsBefore = b.st.packets;
    const second = new NordicSecureDfu(b.control, b.packet, { chunkSize: 100 });
    await second.start();
    await second.update({ initPacket, firmware });
    expect(Uint8Array.from(b.st[DFU_OBJ.DATA].committed)).toEqual(firmware);
    expect(b.st.packets - packetsBefore).toBe(Math.ceil(4096 / 100) + Math.ceil((10000 - 8192) / 100));
  });

  it('reports extended errors from the bootloader', async () => {
    const b = fakeBootloader({ rejectInit: true });
    const dfu = new NordicSecureDfu(b.control, b.packet);
    await dfu.start();
    await expect(dfu.update({ initPacket, firmware })).rejects.toThrow(/verification failed \(wrong signing key\)/);
  });

  it('reads a DFU package in flashing order', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ manifest: { application: { bin_file: 'app.bin', dat_file: 'app.dat' }, softdevice: { bin_file: 'sd.bin', dat_file: 'sd.dat' } } }));
    zip.file('app.bin', firmware); zip.file('app.dat', initPacket);
    zip.file('sd.bin', new Uint8Array(4)); zip.file('sd.dat', new Uint8Array(2));
    const parts = await readDfuPackage(await zip.generateAsync({ type: 'uint8array' }));
    expect(parts.map((p) => p.type)).toEqual(['softdevice', 'application']);
    expect(parts[1].firmware).toEqual(firmware);
    const bad = new JSZip();
    bad.file('x.bin', new Uint8Array(1));
    await expect(readDfuPackage(await bad.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/manifest/);
  });

  it('asks a buttonless device to enter its bootloader', async () => {
    let written = null;
    let listener = null;
    const ch = {
      async startNotifications() {},
      addEventListener(_, fn) { listener = fn; },
      async writeValueWithResponse(v) { written = Array.from(v); setTimeout(() => listener({ target: { value: new DataView(Uint8Array.from([0x20, 0x01, 0x01]).buffer) } }), 0); }
    };
    expect(Array.from(await enterBootloader(ch))).toEqual([0x20, 0x01, 0x01]);
    expect(written).toEqual([0x01]);
  });
});

describe('characteristic value encoding', () => {
  it('encodes text, hex and numbers', () => {
    expect(Array.from(encodeValue('Hi', 'utf8'))).toEqual([0x48, 0x69]);
    expect(Array.from(encodeValue('0x01 ff:a0', 'hex'))).toEqual([1, 255, 160]);
    expect(Array.from(encodeValue('300', 'u16le'))).toEqual([0x2c, 0x01]);
    expect(Array.from(encodeValue('300', 'u16be'))).toEqual([0x01, 0x2c]);
    expect(Array.from(encodeValue('-2, 5', 'i8'))).toEqual([0xfe, 5]);
    expect(Array.from(encodeValue('1.5', 'f32le'))).toEqual([0, 0, 0xc0, 0x3f]);
    expect(() => encodeValue('256', 'u8')).toThrow(/does not fit/);
    expect(() => encodeValue('abc', 'hex')).toThrow(/whole bytes/);
  });
});
