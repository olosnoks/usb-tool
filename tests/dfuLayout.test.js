import { describe, it, expect, vi } from 'vitest';
import {
  DfuDevice,
  DFU_REQUEST,
  DFU_STATE,
  parseDfuseLayout,
  parseDfuseRegion,
  planDfuseErase,
  listDfuAlternates,
  discoverDfuInterface
} from '../src/utils/dfuDriver';

// FLB-1: DfuSe layout, layout-aware erase, upload/verify, alt-settings.

const F4 = '@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg';

describe('parseDfuseLayout', () => {
  it('expands the STM32F4 layout into sectors', () => {
    const l = parseDfuseLayout(F4);
    expect(l).toHaveLength(12);
    expect(l[0]).toMatchObject({ start: 0x08000000, size: 16384, flags: 7 });
    expect(l[3]).toMatchObject({ start: 0x0800c000, size: 16384 });
    expect(l[4]).toMatchObject({ start: 0x08010000, size: 65536 });
    expect(l[5]).toMatchObject({ start: 0x08020000, size: 131072 });
    expect(l[11]).toMatchObject({ start: 0x080e0000, size: 131072 });
    const r = parseDfuseRegion(F4);
    expect(r.name).toBe('Internal Flash');
    expect(r.end).toBe(0x08100000);
  });

  it('handles B/M units and flag letters', () => {
    const l = parseDfuseLayout('@Option Bytes  /0x1FFFC000/01*016 e,02*1Mb');
    expect(l[0]).toMatchObject({ size: 16, readable: true, writable: true, erasable: false });
    expect(l[1]).toMatchObject({ size: 1048576, erasable: true, writable: false });
  });

  it('rejects malformed strings with a clear error', () => {
    expect(() => parseDfuseLayout('Internal Flash')).toThrow(/must start with "@"/);
    expect(() => parseDfuseLayout('@Flash /nothex/04*016Kg')).toThrow(/Malformed DfuSe layout/);
    expect(() => parseDfuseLayout('@Flash /0x08000000/04*016Kz')).toThrow(/sector group/);
    expect(() => parseDfuseLayout('@Flash /0x08000000/00*016Kg')).toThrow(/Zero-sized/);
  });
});

describe('planDfuseErase', () => {
  it('40 KB at the flash base needs sectors 0..2 only', () => {
    const plan = planDfuseErase(parseDfuseLayout(F4), 0x08000000, 40 * 1024);
    expect(plan.map((s) => s.start)).toEqual([0x08000000, 0x08004000, 0x08008000]);
  });
  it('rejects images outside the region and non-erasable sectors', () => {
    expect(() => planDfuseErase(parseDfuseLayout(F4), 0x08000000, 2 * 1024 * 1024)).toThrow(/does not fit/);
    expect(() => planDfuseErase(parseDfuseLayout(F4), 0x20000000, 16)).toThrow(/does not fit/);
    expect(() => planDfuseErase(parseDfuseLayout('@X /0x0/02*001Ka'), 0, 100)).toThrow(/not erasable/);
  });
});

describe('listDfuAlternates / discoverDfuInterface', () => {
  const mkAlt = (n, proto, name) => ({
    alternateSetting: n,
    interfaceClass: 0xfe,
    interfaceSubclass: 0x01,
    interfaceProtocol: proto,
    interfaceName: name
  });

  it('lists alternates with parsed regions and mode', () => {
    const usb = {
      configurations: [
        { interfaces: [{ interfaceNumber: 0, alternates: [mkAlt(0, 2, F4), mkAlt(1, 2, 'bogus')] }] }
      ]
    };
    const alts = listDfuAlternates(usb);
    expect(alts).toHaveLength(2);
    expect(alts[0].region.sectors).toHaveLength(12);
    expect(alts[0].mode).toBe('dfu');
    expect(alts[1].region).toBeNull();
  });

  it('flags a runtime-mode-only device and prefers DFU mode when both exist', async () => {
    const cfgBytes = new Uint8Array([9, 2, 18, 0, 1, 1, 0, 0x80, 50, 9, 0x21, 0x0b, 0xff, 0, 0x00, 0x08, 0x1a, 0x01]);
    const mk = (alts) => ({
      configuration: { configurationValue: 1 },
      configurations: [{ interfaces: [{ interfaceNumber: 0, alternates: alts }] }],
      controlTransferIn: vi.fn(async (_s, len) => ({
        status: 'ok',
        data: new DataView(cfgBytes.slice(0, Math.min(len, cfgBytes.length)).buffer)
      }))
    });
    const rt = await discoverDfuInterface(mk([mkAlt(0, 1, '')]));
    expect(rt.runtimeOnly).toBe(true);
    const both = await discoverDfuInterface(mk([mkAlt(0, 1, ''), mkAlt(1, 2, F4)]));
    expect(both.runtimeOnly).toBe(false);
    expect(both.alternate).toBe(1);
  });
});

/** Fake device: tracks DfuSe commands and serves UPLOAD from a memory image. */
function makeDfuseDevice({ memory = new Uint8Array(0), transferSize = 1024, plain = false } = {}) {
  const cmds = [];
  let state = DFU_STATE.dfuIDLE;
  const status = () => ({
    status: 'ok',
    data: new DataView(new Uint8Array([0, 0, 0, 0, state, 0]).buffer)
  });
  return {
    cmds,
    controlTransferOut: vi.fn(async (setup, data) => {
      if (setup.request === DFU_REQUEST.DNLOAD) {
        if (setup.value === 0 && data && data.length) {
          cmds.push(['dnload0', Array.from(data)]);
          state = DFU_STATE.dfuDNLOAD_IDLE;
        } else if (setup.value === 0) {
          cmds.push(['leave']);
        } else {
          cmds.push(['block', setup.value, data.length]);
          state = DFU_STATE.dfuDNLOAD_IDLE;
        }
      } else if (setup.request === DFU_REQUEST.ABORT) {
        cmds.push(['abort']);
        state = DFU_STATE.dfuIDLE;
      }
      return { status: 'ok', bytesWritten: data ? data.length : 0 };
    }),
    controlTransferIn: vi.fn(async (setup, length) => {
      if (setup.request === DFU_REQUEST.GETSTATUS) return status();
      if (setup.request === DFU_REQUEST.UPLOAD) {
        cmds.push(['upload', setup.value, length]);
        const base = (setup.value - (plain ? 0 : 2)) * transferSize;
        const chunk = memory.slice(base, Math.min(memory.length, base + length));
        state = DFU_STATE.dfuUPLOAD_IDLE;
        return { status: 'ok', data: new DataView(chunk.buffer) };
      }
      return { status: 'ok', data: new DataView(new ArrayBuffer(0)) };
    })
  };
}

const isMassErase = (c) => c[0] === 'dnload0' && c[1].length === 1 && c[1][0] === 0x41;
const eraseAddrs = (cmds) =>
  cmds
    .filter((c) => c[0] === 'dnload0' && c[1][0] === 0x41 && c[1].length === 5)
    .map((c) => new DataView(new Uint8Array(c[1]).buffer).getUint32(1, true));

describe('dfuseDownloadElement erase strategy', () => {
  it('erases only the sectors overlapping a 40 KB image on the F4 layout, no mass erase', async () => {
    const dev = makeDfuseDevice();
    const d = new DfuDevice(dev, 0, { transferSize: 1024, dfuse: true });
    await d.dfuseDownloadElement(0x08000000, new Uint8Array(40 * 1024), { layout: parseDfuseLayout(F4) });
    expect(eraseAddrs(dev.cmds)).toEqual([0x08000000, 0x08004000, 0x08008000]);
    expect(dev.cmds.some(isMassErase)).toBe(false);
  });

  it('refuses to erase when geometry is unknown (page size 0, no layout)', async () => {
    const dev = makeDfuseDevice();
    const d = new DfuDevice(dev, 0, { dfuse: true });
    await expect(d.dfuseDownloadElement(0x08000000, new Uint8Array(16), { erasePageSize: 0 })).rejects.toThrow(
      /refusing to erase/
    );
    await expect(d.dfuseDownloadElement(0x08000000, new Uint8Array(16))).rejects.toThrow(/refusing to erase/);
    expect(dev.cmds.filter((c) => c[0] === 'dnload0')).toHaveLength(0);
  });

  it('mass erases only with an explicit massErase flag', async () => {
    const dev = makeDfuseDevice();
    const d = new DfuDevice(dev, 0, { dfuse: true });
    await d.dfuseDownloadElement(0x08000000, new Uint8Array(16), { massErase: true });
    expect(dev.cmds.some(isMassErase)).toBe(true);
  });

  it('keeps the fixed erasePageSize path working (aligned down to the page)', async () => {
    const dev = makeDfuseDevice();
    const d = new DfuDevice(dev, 0, { dfuse: true });
    await d.dfuseDownloadElement(0x08000400, new Uint8Array(3000), { erasePageSize: 2048 });
    expect(eraseAddrs(dev.cmds)).toEqual([0x08000000, 0x08000800]);
  });

  it('leave:false skips the leave sequence; dfuseLeave sends it', async () => {
    const dev = makeDfuseDevice();
    const d = new DfuDevice(dev, 0, { dfuse: true });
    await d.dfuseDownloadElement(0x08000000, new Uint8Array(16), { erasePageSize: 2048, leave: false });
    expect(dev.cmds.some((c) => c[0] === 'leave')).toBe(false);
    await d.dfuseLeave(0x08000000);
    expect(dev.cmds.some((c) => c[0] === 'leave')).toBe(true);
  });
});

describe('DfuDevice.upload / verify', () => {
  const image = Uint8Array.from({ length: 2500 }, (_, i) => (i * 7) & 0xff);

  it('returns exactly N bytes for DfuSe (set-address, abort, blocks from 2)', async () => {
    const dev = makeDfuseDevice({ memory: image });
    const d = new DfuDevice(dev, 0, { transferSize: 1024, dfuse: true });
    const got = await d.upload(2500, undefined, { address: 0x08000000 });
    expect(got.length).toBe(2500);
    expect(Array.from(got)).toEqual(Array.from(image));
    expect(dev.cmds.filter((c) => c[0] === 'upload').map((c) => c[1])).toEqual([2, 3, 4]);
    expect(dev.cmds[0][1]).toEqual([0x21, 0x00, 0x00, 0x00, 0x08]);
  });

  it('stops at a short packet when the device has less than requested', async () => {
    const dev = makeDfuseDevice({ memory: image.slice(0, 1500) });
    const d = new DfuDevice(dev, 0, { transferSize: 1024, dfuse: true });
    const got = await d.upload(5000, undefined, { address: 0x08000000 });
    expect(got.length).toBe(1500);
  });

  it('plain DFU upload starts at block 0', async () => {
    const dev = makeDfuseDevice({ memory: image, plain: true });
    const d = new DfuDevice(dev, 0, { transferSize: 1024 });
    const got = await d.upload(2000);
    expect(got.length).toBe(2000);
    expect(dev.cmds.filter((c) => c[0] === 'upload').map((c) => c[1])).toEqual([0, 1]);
  });

  it('verify passes on a match and reports the first mismatch offset', async () => {
    const dev = makeDfuseDevice({ memory: image });
    const d = new DfuDevice(dev, 0, { transferSize: 1024, dfuse: true });
    expect((await d.verify(image, { address: 0x08000000 })).ok).toBe(true);
    const bad = image.slice();
    bad[1337] ^= 0xff;
    const v = await d.verify(bad, { address: 0x08000000 });
    expect(v.ok).toBe(false);
    expect(v.mismatchOffset).toBe(1337);
  });

  it('DfuSe upload requires an address', async () => {
    const d = new DfuDevice(makeDfuseDevice(), 0, { dfuse: true });
    await expect(d.upload(16)).rejects.toThrow(/address/);
  });
});
