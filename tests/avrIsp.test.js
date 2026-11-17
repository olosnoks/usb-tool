import { describe, it, expect } from 'vitest';
import { SerialLink, FakeSerialPort } from '../src/utils/serialLink';
import { AvrIspClient, fuseHazards, pagesFromImage, AVR_CHIP_DATABASE, STK, toIntelHex, uploadViaBootloader, ARDUINO_BOARDS, eepromAfterErase } from '../src/utils/avrIspDriver';
import { parseIntelHex } from '../src/utils/firmwareParser';

// A fake ArduinoISP with an ATmega328P on its SPI pins.
function fakeArduinoIsp({ signature = [0x1e, 0x95, 0x0f], corruptAt = -1 } = {}) {
  const t = {
    fuses: { lfuse: 0x62, hfuse: 0xd9, efuse: 0xff, lock: 0xff },
    flash: new Uint8Array(32768).fill(0xff),
    eeprom: new Uint8Array(1024).fill(0xff),
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
      if (a === 0xa0) return ok(p, [t.eeprom[(x << 8) | y]]);
      if (a === 0xc0) { t.eeprom[(x << 8) | y] = d; return ok(p, [0]); }
      if (a === 0x30) return ok(p, [signature[y]]);
      if (a === 0x50 && x === 0x00) return ok(p, [t.fuses.lfuse]);
      if (a === 0x58 && x === 0x08) return ok(p, [t.fuses.hfuse]);
      if (a === 0x50 && x === 0x08) return ok(p, [t.fuses.efuse | 0xf8]);
      if (a === 0x58 && x === 0x00) return ok(p, [t.fuses.lock | 0xc0]);
      if (a === 0xac && x === 0xa0) t.fuses.lfuse = d;
      if (a === 0xac && x === 0xa8) t.fuses.hfuse = d;
      if (a === 0xac && x === 0xa4) t.fuses.efuse = d;
      if (a === 0xac && x === 0xe0) t.fuses.lock = d;
      if (a === 0xac && x === 0x80) { t.flash.fill(0xff); t.fuses.lock = 0xff; if (t.fuses.hfuse & 0x08) t.eeprom.fill(0xff); }
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

describe('chip list', () => {
  const chips = Object.entries(AVR_CHIP_DATABASE);

  it('has a broad list with sane geometry', () => {
    expect(chips.length).toBeGreaterThanOrEqual(55);
    const names = chips.map(([, c]) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const [sig, c] of chips) {
      expect((Number(sig) >> 16) & 0xff, `${c.name} signature byte 0`).toBe(0x1e);
      expect(c.pageSize & (c.pageSize - 1), `${c.name} page size`).toBe(0);
      expect(c.flashSize % c.pageSize, `${c.name} flash/page`).toBe(0);
      expect(c.eepromSize).toBeGreaterThan(0);
      if (c.eesave) expect(c.eesave[1] & (c.eesave[1] - 1), `${c.name} eesave is one bit`).toBe(0);
    }
  });

  it('resolves well-known signatures to named chips with the right pages', () => {
    expect(AVR_CHIP_DATABASE[0x1e930b]).toMatchObject({ name: 'ATtiny85', pageSize: 64, flashSize: 8192, eepromSize: 512 });
    expect(AVR_CHIP_DATABASE[0x1e9801]).toMatchObject({ name: 'ATmega2560', pageSize: 256, flashSize: 262144, eepromSize: 4096 });
    expect(AVR_CHIP_DATABASE[0x1e950f].name).toBe('ATmega328P');
    expect(AVR_CHIP_DATABASE[0x1e9514].name).toBe('ATmega328'); // 328P is 1E950F, 328PB is 1E9516
    expect(AVR_CHIP_DATABASE[0x1e9516].name).toBe('ATmega328PB');
    expect(AVR_CHIP_DATABASE[0x1e9587].name).toBe('ATmega32U4');
    expect(AVR_CHIP_DATABASE[0x1e9489].name).toBe('ATmega16U2');
  });

  it('only offers Arduino fuse defaults where they are known', () => {
    expect(AVR_CHIP_DATABASE[0x1e9108].defaultFuses).toBeUndefined();
    expect(AVR_CHIP_DATABASE[0x1e950f].defaultFuses).toBeDefined();
  });
});

describe('reading, verifying and exporting', () => {
  it('reads flash back equal to what was written and exports HEX that round-trips', async () => {
    const { client } = await connected();
    await client.readSignature();
    const data = Uint8Array.from({ length: 300 }, (_, i) => (i * 7 + 1) & 0xff);
    data[299] = 0x5a;
    await client.flashImage({ data, startAddress: 0x100 });
    const back = await client.readFlash({ start: 0x100, length: 300 });
    expect(Array.from(back)).toEqual(Array.from(data));
    const parsed = parseIntelHex(toIntelHex(back, 0x100));
    expect(parsed.startAddress).toBe(0x100);
    expect(Array.from(parsed.data)).toEqual(Array.from(data));
  });

  it('exports HEX for addresses above 64 KB with an extended address record', () => {
    const data = Uint8Array.from([1, 2, 3, 4, 5]);
    const hex = toIntelHex(data, 0x1fffe);
    expect(hex).toContain(':020000040001F9');
    const parsed = parseIntelHex(hex);
    expect(parsed.startAddress).toBe(0x1fffe);
    expect(Array.from(parsed.data)).toEqual([1, 2, 3, 4, 5]);
    expect(hex.trim().endsWith(':00000001FF')).toBe(true);
  });

  it('verifies against an image and reports the first difference', async () => {
    const { client, target } = await connected();
    await client.readSignature();
    const data = new Uint8Array(200).fill(0x33);
    await client.flashImage({ data, startAddress: 0 });
    expect(await client.verifyFlash({ data, startAddress: 0 })).toMatchObject({ ok: true, checked: 200 });
    target.flash[77] = 0x34;
    expect(await client.verifyFlash({ data, startAddress: 0 })).toMatchObject({ ok: false, firstMismatch: 77, expected: 0x33, actual: 0x34 });
  });

  it('reads and writes the EEPROM with read-back verification', async () => {
    const { client, target } = await connected();
    await client.readSignature();
    const data = Uint8Array.from([1, 2, 3, 0xff, 5]);
    const r = await client.writeEeprom(data, { start: 0x10 });
    expect(r).toEqual({ bytes: 5, written: 4 }); // the 0xFF byte already matched
    expect(Array.from(target.eeprom.slice(0x10, 0x15))).toEqual([1, 2, 3, 0xff, 5]);
    const all = await client.readEeprom();
    expect(all.length).toBe(1024);
    expect(all[0x11]).toBe(2);
    await expect(client.writeEeprom(new Uint8Array(10), { start: 1020 })).rejects.toThrow(/past the/);
  });
});

describe('chip erase and the EEPROM', () => {
  it('explains from EESAVE what an erase does', () => {
    const chip = AVR_CHIP_DATABASE[0x1e950f];
    expect(eepromAfterErase(chip, 0xd9).status).toBe('wiped');
    expect(eepromAfterErase(chip, 0xd1).status).toBe('preserved'); // bit 3 cleared = programmed
    // ATtiny13A keeps EESAVE in the low fuse (bit 6); a bare high-fuse byte can't answer it
    const t13 = AVR_CHIP_DATABASE[0x1e9007];
    expect(eepromAfterErase(t13, 0xff).status).toBe('unknown');
    expect(eepromAfterErase(t13, { lfuse: 0x6a, hfuse: 0xff }).status).toBe('wiped');
    expect(eepromAfterErase(t13, { lfuse: 0x2a, hfuse: 0xff }).status).toBe('preserved');
    expect(eepromAfterErase(chip, { lfuse: 0xff, hfuse: 0xd1 }).status).toBe('preserved');
    expect(eepromAfterErase(chip, 0xd9).text).toMatch(/wipes the EEPROM/);
  });

  it('reads the high fuse before erasing and reports EEPROM loss', async () => {
    const { client } = await connected();
    await client.readSignature();
    const impact = await client.eraseImpact();
    expect(impact).toMatchObject({ status: 'wiped', hfuse: 0xd9 });
  });

  it('wipes the EEPROM on a plain erase and keeps it with preserveEeprom', async () => {
    const { client, target } = await connected();
    await client.readSignature();
    target.eeprom[3] = 0x42;
    target.eeprom[1023] = 0x99;
    await client.chipErase({ preserveEeprom: true });
    expect(target.eeprom[3]).toBe(0x42);
    expect(target.eeprom[1023]).toBe(0x99);
    await client.chipErase();
    expect(target.eeprom[3]).toBe(0xff);
  });
});

// A bootloader (optiboot-style) on an ATmega328P: STK500v1 only, no ISP.
function fakeBootloader() {
  const t = { flash: new Uint8Array(32768).fill(0xff), addr: 0, stream: [], cmds: [] };
  const ok = (p, data = []) => p.feed([STK.INSYNC, ...data, STK.OK]);
  const port = new FakeSerialPort((b, p) => {
    t.stream.push(...b);
    const c = b[0];
    t.cmds.push(c);
    if (c === STK.GET_SYNC) return ok(p);
    if (c === STK.READ_SIGN) return ok(p, [0x1e, 0x95, 0x0f]);
    if (c === STK.LOAD_ADDRESS) { t.addr = ((b[2] << 8) | b[1]) * 2; return ok(p); }
    if (c === STK.PROG_PAGE) { const len = (b[1] << 8) | b[2]; t.flash.set(b.slice(4, 4 + len), t.addr); return ok(p); }
    if (c === STK.READ_PAGE) { const len = (b[1] << 8) | b[2]; return ok(p, Array.from(t.flash.slice(t.addr, t.addr + len))); }
    if (c === STK.LEAVE_PROGMODE) return ok(p);
    return p.feed([STK.INSYNC, STK.FAILED]);
  });
  return { port, t };
}

describe('Arduino bootloader upload', () => {
  it('sends exactly the STK500v1 stream for a 2-page image and never erases or touches fuses', async () => {
    const { port, t } = fakeBootloader();
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    const data = Uint8Array.from({ length: 256 }, (_, i) => i);
    const progress = [];
    const r = await uploadViaBootloader(link, { data, startAddress: 0 }, { board: ARDUINO_BOARDS.uno, resetWithDtr: false, onProgress: (n) => progress.push(n) });
    expect(r).toEqual({ pages: 2, bytes: 256 });
    const page = (i) => Array.from(data.slice(i * 128, i * 128 + 128));
    const expected = [
      0x30, 0x20,                                  // GET_SYNC
      0x75, 0x20,                                  // READ_SIGN
      0x55, 0x00, 0x00, 0x20,                      // LOAD_ADDRESS word 0
      0x64, 0x00, 0x80, 0x46, ...page(0), 0x20,    // PROG_PAGE flash 128 bytes
      0x55, 0x40, 0x00, 0x20,                      // LOAD_ADDRESS word 0x40 (byte 0x80)
      0x64, 0x00, 0x80, 0x46, ...page(1), 0x20,
      0x55, 0x00, 0x00, 0x20, 0x74, 0x00, 0x80, 0x46, 0x20, // read back page 0
      0x55, 0x40, 0x00, 0x20, 0x74, 0x00, 0x80, 0x46, 0x20, // read back page 1
      0x51, 0x20                                   // LEAVE_PROGMODE: starts the sketch
    ];
    expect(t.stream).toEqual(expected);
    expect(t.cmds).not.toContain(STK.UNIVERSAL);
    expect(t.cmds).not.toContain(STK.ENTER_PROGMODE);
    expect(progress.at(-1)).toBe(100);
    expect(Array.from(t.flash.slice(0, 256))).toEqual(Array.from(data));
  });

  it('writes blank pages inside the image too, since nothing is erased first', async () => {
    const { port, t } = fakeBootloader();
    t.flash.fill(0x77);
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    const data = new Uint8Array(256).fill(0xff);
    data[0] = 1;
    await uploadViaBootloader(link, { data, startAddress: 0 }, { board: ARDUINO_BOARDS.uno, resetWithDtr: false });
    expect(Array.from(t.flash.slice(128, 256))).toEqual(new Array(128).fill(0xff));
  });

  it('pulses DTR to reset the board before syncing', async () => {
    const { port } = fakeBootloader();
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    await uploadViaBootloader(link, { data: new Uint8Array(128).fill(1), startAddress: 0 }, { board: ARDUINO_BOARDS.uno, bootWaitMs: 0 });
    expect(port.signals.map((s) => s.dataTerminalReady)).toEqual([false, true]);
  });

  it('refuses a bootloader hex and an image that runs into the bootloader, before any write', async () => {
    const { port, t } = fakeBootloader();
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    await expect(uploadViaBootloader(link, { data: new Uint8Array(512), startAddress: 0x7e00 }, { board: ARDUINO_BOARDS.uno, resetWithDtr: false })).rejects.toThrow(/bootloader area/);
    await expect(uploadViaBootloader(link, { data: new Uint8Array(33000), startAddress: 0 }, { board: ARDUINO_BOARDS.uno, resetWithDtr: false })).rejects.toThrow(/past the/);
    expect(t.cmds).toEqual([]);
  });

  it('stops when the board answers with another signature', async () => {
    const { port, t } = fakeBootloader();
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    const other = { ...ARDUINO_BOARDS.uno, signature: 0x1e9514 };
    await expect(uploadViaBootloader(link, { data: new Uint8Array(128).fill(1), startAddress: 0 }, { board: other, resetWithDtr: false })).rejects.toThrow(/signature/);
    expect(t.cmds).not.toContain(STK.PROG_PAGE);
  });

  it('has the Arduino IDE speeds: Uno 115200, old Nano 57600', () => {
    expect(ARDUINO_BOARDS.uno.baud).toBe(115200);
    expect(ARDUINO_BOARDS['nano-new'].baud).toBe(115200);
    expect(ARDUINO_BOARDS['nano-old'].baud).toBe(57600);
  });
});
