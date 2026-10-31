import { describe, it, expect } from 'vitest';
import { SerialLink, FakeSerialPort } from '../src/utils/serialLink';
import { AvrIspClient, fuseHazards, pagesFromImage, AVR_CHIP_DATABASE, STK } from '../src/utils/avrIspDriver';

// A fake ArduinoISP with an ATmega328P on its SPI pins.
function fakeArduinoIsp({ signature = [0x1e, 0x95, 0x0f], corruptAt = -1 } = {}) {
  const t = {
    fuses: { lfuse: 0x62, hfuse: 0xd9, efuse: 0xff, lock: 0xff },
    flash: new Uint8Array(32768).fill(0xff),
    pageSize: 0, progmode: false, addr: 0, log: []
  };
  const ok = (port, data = []) => port.feed([STK.INSYNC, ...data, STK.OK]);
  const port = new FakeSerialPort((b, p) => {
    const c = b[0];
    t.log.push(c);
    if (b[b.length - 1] !== STK.CRC_EOP) return p.feed([STK.NOSYNC]);
    if (c === STK.GET_SYNC) return ok(p);
    if (c === STK.GET_PARAMETER) return ok(p, [{ 0x80: 2, 0x81: 1, 0x82: 18 }[b[1]] ?? 0]);
    if (c === STK.SET_DEVICE) { t.pageSize = (b[13] << 8) | b[14]; return ok(p); }
    if (c === STK.ENTER_PROGMODE) { t.progmode = true; return ok(p); }
    if (c === STK.LEAVE_PROGMODE) { t.progmode = false; return ok(p); }
    if (c === STK.LOAD_ADDRESS) { t.addr = ((b[2] << 8) | b[1]) * 2; return ok(p); }
    if (c === STK.UNIVERSAL) {
      if (!t.progmode) return ok(p, [0]);
      const [a, x, y, d] = [b[1], b[2], b[3], b[4]];
      if (a === 0x30) return ok(p, [signature[y]]);
      if (a === 0x50 && x === 0x00) return ok(p, [t.fuses.lfuse]);
      if (a === 0x58 && x === 0x08) return ok(p, [t.fuses.hfuse]);
      if (a === 0x50 && x === 0x08) return ok(p, [t.fuses.efuse | 0xf8]);
      if (a === 0x58 && x === 0x00) return ok(p, [t.fuses.lock | 0xc0]);
      if (a === 0xac && x === 0xa0) t.fuses.lfuse = d;
      if (a === 0xac && x === 0xa8) t.fuses.hfuse = d;
      if (a === 0xac && x === 0xa4) t.fuses.efuse = d;
      if (a === 0xac && x === 0xe0) t.fuses.lock = d;
      if (a === 0xac && x === 0x80) { t.flash.fill(0xff); t.fuses.lock = 0xff; }
      return ok(p, [0]);
    }
    if (c === STK.PROG_PAGE) {
      const len = (b[1] << 8) | b[2];
      const data = b.slice(4, 4 + len);
      t.flash.set(data, t.addr);
      if (corruptAt >= t.addr && corruptAt < t.addr + len) t.flash[corruptAt] ^= 0x01;
      return ok(p);
    }
    if (c === STK.READ_PAGE) {
      const len = (b[1] << 8) | b[2];
      return ok(p, Array.from(t.flash.slice(t.addr, t.addr + len)));
    }
    return p.feed([STK.INSYNC, STK.FAILED]);
  });
  return { port, target: t };
}

async function connected(opts) {
  const { port, target } = fakeArduinoIsp(opts);
  const link = new SerialLink(port);
  await link.open({ baudRate: 19200 });
  const client = new AvrIspClient(() => {});
  await client.connectHardware({ link, bootDelayMs: 0 });
  return { client, target, port };
}

describe('STK500v1 / ArduinoISP', () => {
  it('syncs, reads the programmer version and identifies the target', async () => {
    const { client } = await connected();
    expect(client.programmerInfo).toEqual({ hw: 2, sw: '1.18' });
    const chip = await client.readSignature();
    expect(chip.name).toBe('ATmega328P');
    expect(chip.signature).toBe(0x1e950f);
    const fuses = await client.readFuses();
    expect(fuses).toMatchObject({ lfuse: 0x62, hfuse: 0xd9 });
  });

  it('explains a dead target instead of guessing a chip', async () => {
    const { client } = await connected({ signature: [0, 0, 0] });
    await expect(client.readSignature()).rejects.toThrow(/isn't answering/);
  });

  it('writes fuses and checks them by read-back', async () => {
    const { client, target } = await connected();
    await client.readSignature();
    const back = await client.writeFuses({ lfuse: 0xff, hfuse: 0xde, efuse: 0x05, lock: 0x3f });
    expect(target.fuses).toMatchObject({ lfuse: 0xff, hfuse: 0xde, efuse: 0x05 });
    expect(back.lfuse).toBe(0xff);
  });

  it('refuses fuse values that would disable ISP', async () => {
    const { client, target } = await connected();
    await client.readSignature();
    await expect(client.writeFuses({ lfuse: 0xff, hfuse: 0x5e, efuse: 0xfd, lock: 0x3f })).rejects.toThrow(/RSTDISBL/);
    await expect(client.writeFuses({ lfuse: 0xff, hfuse: 0xfe, efuse: 0xfd, lock: 0x3f })).rejects.toThrow(/SPIEN/);
    expect(target.fuses.hfuse).toBe(0xd9); // untouched
    expect(fuseHazards(AVR_CHIP_DATABASE[0x1e950f], { lfuse: 0xff, hfuse: 0xde, efuse: 0xfd })).toEqual([]);
  });

  it('flashes an image page by page and verifies it', async () => {
    const { client, target } = await connected();
    await client.readSignature();
    const data = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
    const progress = [];
    const r = await client.flashImage({ data, startAddress: 0x7e00 }, { onProgress: (p) => progress.push(p) });
    expect(r.pages).toBe(3); // 300 bytes over 128-byte pages
    expect(Array.from(target.flash.slice(0x7e00, 0x7e00 + 300))).toEqual(Array.from(data));
    expect(progress.at(-1)).toBe(100);
  });

  it('reports a verify failure with the address', async () => {
    const { client } = await connected({ corruptAt: 0x7e05 });
    await client.readSignature();
    const data = new Uint8Array(128).fill(0x55);
    await expect(client.flashImage({ data, startAddress: 0x7e00 })).rejects.toThrow(/Verify failed at 0x7e05/);
  });

  it('burns a bootloader with the chip preset fuses and lock bits', async () => {
    const { client, target } = await connected();
    await client.readSignature();
    await client.burnBootloader({ data: new Uint8Array(512).fill(0x11), startAddress: 0x7e00 });
    expect(target.fuses).toMatchObject({ lfuse: 0xff, hfuse: 0xde, efuse: 0xfd, lock: 0x0f });
    expect(target.flash[0x7e00]).toBe(0x11);
  });

  it('skips erased pages and pads partial ones', () => {
    const data = new Uint8Array(200).fill(0xff);
    data[150] = 0x42;
    const pages = pagesFromImage(data, 0x10, 64);
    expect(pages.map((p) => p.address)).toEqual([0x80]);
    expect(pages[0].data[0x10 + 150 - 0x80]).toBe(0x42);
  });
});
