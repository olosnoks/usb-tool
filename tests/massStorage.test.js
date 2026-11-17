import { describe, it, expect } from 'vitest';
import {
  MassStorageDevice, MscUsbTransport, MassStorageError, explainUsbError, buildReadCdb,
  buildCbw, parseCsw, parseInquiry, parseCapacity, findMscInterface
} from '../src/utils/massStorageDriver';
import { createSimulatedMassStorage } from './helpers/sim/massStorage';

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

  it('reads sector 0 (boot signature) and the partition boot sector', async () => {
    const dev = new MassStorageDevice(createSimulatedMassStorage());
    await dev.open();
    await dev.readCapacity();
    const s0 = await dev.read(0, 1);
    expect(s0.length).toBe(512);
    expect(s0[510]).toBe(0x55);
    expect(s0[511]).toBe(0xaa);
    expect(s0[446 + 4]).toBe(0x06); // one FAT16 partition
    const vbr = await dev.read(2048, 1);
    expect(new TextDecoder().decode(vbr.subarray(3, 11))).toBe('MSWIN4.1');
  });

  it('reads multiple consecutive blocks in one command', async () => {
    const dev = new MassStorageDevice(createSimulatedMassStorage());
    await dev.open();
    await dev.readCapacity();
    const four = await dev.read(10, 4);
    expect(four.length).toBe(4 * 512);
  });
});

// ---------------------------------------------------------------------------
// A scriptable fake drive: capacity beyond 2 TiB, STALLs and phase errors
// ---------------------------------------------------------------------------

const stallErr = () => Object.assign(new Error('stalled'), { stall: true });

function fakeDrive({ blocks = 1000, blockSize = 512 } = {}) {
  const calls = { cdbs: [], clearHalt: [], resets: 0 };
  const ctl = { stallCsw: 0, stallData: 0, phaseError: 0 };
  let pending = [];
  const be64 = (n) => { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, Math.floor(n / 2 ** 32)); dv.setUint32(4, n % 2 ** 32); return b; };
  const block = (lba) => { const b = new Uint8Array(blockSize); b.set(be64(lba)); return b; };
  const transport = {
    calls, ctl,
    async open() {}, async close() {},
    async clearHalt(dir) { calls.clearHalt.push(dir); },
    async reset() { calls.resets++; pending = []; },
    async write(bytes) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const tag = dv.getUint32(4, true);
      const cdb = Array.from(bytes.slice(15, 15 + bytes[14]));
      calls.cdbs.push(cdb);
      const op = cdb[0];
      let data = null;
      if (op === 0x25) {
        data = new Uint8Array(8); const d = new DataView(data.buffer);
        d.setUint32(0, Math.min(blocks - 1, 0xffffffff), false); d.setUint32(4, blockSize, false);
      } else if (op === 0x9e) {
        data = new Uint8Array(32); data.set(be64(blocks - 1)); new DataView(data.buffer).setUint32(8, blockSize, false);
      } else if (op === 0x28 || op === 0x88) {
        const w = new DataView(Uint8Array.from(cdb).buffer);
        const lba = op === 0x28 ? w.getUint32(2) : w.getUint32(2) * 2 ** 32 + w.getUint32(6);
        const count = op === 0x28 ? w.getUint16(7) : w.getUint32(10);
        const out = new Uint8Array(count * blockSize);
        for (let i = 0; i < count; i++) out.set(block(lba + i), i * blockSize);
        data = out;
      }
      if (data && data.length) pending.push({ bytes: data, kind: 'data' });
      const csw = new Uint8Array(13); const c = new DataView(csw.buffer);
      c.setUint32(0, 0x53425355, true); c.setUint32(4, tag, true);
      if (ctl.phaseError > 0) { ctl.phaseError--; csw[12] = 2; }
      pending.push({ bytes: csw, kind: 'csw' });
    },
    async read() {
      const head = pending[0];
      if (!head) return new Uint8Array();
      if (head.kind === 'csw' && ctl.stallCsw > 0) { ctl.stallCsw--; throw stallErr(); }
      if (head.kind === 'data' && ctl.stallData > 0) { ctl.stallData--; pending.shift(); throw stallErr(); }
      return pending.shift().bytes;
    }
  };
  return transport;
}

describe('READ CAPACITY(16) and READ(16)', () => {
  it('a 3 TiB drive answers 0xFFFFFFFF to READ CAPACITY(10), so the driver asks again with (16)', async () => {
    const blocks = (3 * 2 ** 40) / 512;
    const t = fakeDrive({ blocks });
    const dev = new MassStorageDevice(t);
    const cap = await dev.readCapacity();
    expect(cap).toMatchObject({ blocks, blockSize: 512, totalBytes: 3 * 2 ** 40, capacity16: true });
    const ops = t.calls.cdbs.map((c) => c[0]);
    expect(ops).toEqual([0x25, 0x9e]);
    expect(t.calls.cdbs[1].slice(0, 2)).toEqual([0x9e, 0x10]); // SERVICE ACTION IN(16) / READ CAPACITY(16)
    expect(t.calls.cdbs[1].slice(10, 14)).toEqual([0, 0, 0, 32]); // allocation length
  });

  it('read() past 2^32 blocks sends a 16-byte CDB with the exact 64-bit LBA', async () => {
    const t = fakeDrive({ blocks: (3 * 2 ** 40) / 512 });
    const dev = new MassStorageDevice(t);
    await dev.readCapacity();
    const lba = 5_000_000_000; // above 2^32 (4_294_967_296)
    const data = await dev.read(lba, 2);
    const cdb = t.calls.cdbs.at(-1);
    expect(cdb).toHaveLength(16);
    expect(cdb[0]).toBe(0x88);
    expect(cdb.slice(2, 10)).toEqual([0, 0, 0, 1, 0x2a, 0x05, 0xf2, 0x00]); // 0x1_2A05F200
    expect(cdb.slice(10, 14)).toEqual([0, 0, 0, 2]);
    // the fake drive echoes the LBA it was asked for, per block
    const dv = new DataView(data.buffer, data.byteOffset);
    expect(dv.getUint32(0) * 2 ** 32 + dv.getUint32(4)).toBe(lba);
    expect(dv.getUint32(512) * 2 ** 32 + dv.getUint32(516)).toBe(lba + 1);
  });

  it('a small drive keeps using READ CAPACITY(10) and READ(10)', async () => {
    const t = fakeDrive({ blocks: 4096 });
    const dev = new MassStorageDevice(t);
    const cap = await dev.readCapacity();
    expect(cap.capacity16).toBeUndefined();
    await dev.read(7, 1);
    expect(t.calls.cdbs.map((c) => c[0])).toEqual([0x25, 0x28]);
    expect(buildReadCdb(2 ** 32 + 5, 1)[0]).toBe(0x88); // never silently wraps a 32-bit LBA
    expect(buildReadCdb(0xfffffff0, 0x20)[0]).toBe(0x88); // READ(10) cannot address past the 32-bit LBA limit
  });
});

describe('BOT STALL and phase-error recovery', () => {
  it('a STALL on the CSW read clears the halt and reads the CSW again', async () => {
    const t = fakeDrive();
    t.ctl.stallCsw = 1;
    const dev = new MassStorageDevice(t);
    const data = await dev.read(3, 1);
    expect(data.length).toBe(512);
    expect(t.calls.clearHalt).toEqual(['in']);
    expect(t.calls.resets).toBe(0);
  });

  it('a STALL that ends the data stage early is cleared and the CSW is still read', async () => {
    const t = fakeDrive();
    t.ctl.stallData = 1;
    const dev = new MassStorageDevice(t);
    const data = await dev.read(3, 1);
    expect(data.length).toBe(0); // short data, status passed: the caller sees what the drive sent
    expect(t.calls.clearHalt).toEqual(['in']);
  });

  it('a CSW that stalls twice triggers reset recovery, and the next command works', async () => {
    const t = fakeDrive();
    t.ctl.stallCsw = 2;
    const dev = new MassStorageDevice(t);
    await expect(dev.read(3, 1)).rejects.toThrow(/stalled the status stage twice/);
    expect(t.calls.resets).toBe(1);
    expect(t.calls.clearHalt).toEqual(['in', 'in', 'out']); // first retry, then recovery clears both endpoints
    expect((await dev.read(4, 1)).length).toBe(512);
  });

  it('a phase error (CSW status 2) triggers reset recovery and the next command works', async () => {
    const t = fakeDrive();
    t.ctl.phaseError = 1;
    const dev = new MassStorageDevice(t);
    await expect(dev.read(3, 1)).rejects.toThrow(/Phase error/);
    expect(t.calls.resets).toBe(1);
    expect(t.calls.clearHalt).toEqual(['in', 'out']);
    expect((await dev.read(4, 1)).length).toBe(512);
  });
});

describe('WebUSB failure explanations', () => {
  const mscDevice = (claim) => ({
    opened: true,
    configuration: { interfaces: [{ interfaceNumber: 0, alternates: [{ interfaceClass: 0x08, interfaceSubclass: 0x06, interfaceProtocol: 0x50, endpoints: [
      { type: 'bulk', direction: 'out', endpointNumber: 2 }, { type: 'bulk', direction: 'in', endpointNumber: 1 }
    ] }] }] },
    claimInterface: claim,
    async open() {}, async selectConfiguration() {}
  });

  it('claimInterface SecurityError (protected class) becomes a plain explanation that points at image files', async () => {
    const claim = async () => { throw new DOMException('The requested interface implements a protected class.', 'SecurityError'); };
    const transport = new MscUsbTransport(mscDevice(claim));
    const err = await transport.open().then(() => null, (e) => e);
    expect(err).toBeInstanceOf(MassStorageError);
    expect(err.kind).toBe('protected-class');
    expect(err.message).toMatch(/protected interface class/);
    expect(err.message).toMatch(/not a fault with the drive/);
    expect(err.message).toMatch(/OPEN DISK IMAGE FILE/);
  });

  it('NotFoundError (empty or cancelled chooser) and busy drives are explained too', () => {
    const nf = explainUsbError(new DOMException('No device selected.', 'NotFoundError'));
    expect(nf.kind).toBe('no-device');
    expect(nf.message).toMatch(/OPEN DISK IMAGE FILE/);
    expect(explainUsbError(new DOMException('Unable to claim interface.', 'NetworkError')).kind).toBe('busy');
    const other = new Error('boom');
    expect(explainUsbError(other)).toBe(other);
  });

  it('maps WebUSB stall status to a stall error and issues clearHalt / the class reset request', async () => {
    const calls = [];
    const device = {
      ...mscDevice(async () => {}),
      async transferIn() { return { status: 'stall' }; },
      async transferOut() { return { status: 'stall' }; },
      async clearHalt(dir, ep) { calls.push(['clearHalt', dir, ep]); },
      async controlTransferOut(setup) { calls.push(['control', setup]); }
    };
    const t = new MscUsbTransport(device);
    await t.open();
    await expect(t.read(13)).rejects.toMatchObject({ stall: true });
    await expect(t.write(new Uint8Array(31))).rejects.toMatchObject({ stall: true });
    await t.clearHalt('in'); await t.clearHalt('out'); await t.reset();
    expect(calls).toEqual([
      ['clearHalt', 'in', 1], ['clearHalt', 'out', 2],
      ['control', { requestType: 'class', recipient: 'interface', request: 0xff, value: 0, index: 0 }]
    ]);
  });
});
