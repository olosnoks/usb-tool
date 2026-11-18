import { describe, it, expect } from 'vitest';
import {
  PICOBOOT_MAGIC, PICOBOOT_CMD, PICOBOOT_RESET_REQUEST, XIP_BASE, FLASH_SECTOR_SIZE, FLASH_PAGE_SIZE,
  BINARY_INFO_MARKER_START, chipFromPid, encodeCommand, decodeCommand, rangeArgs, rebootArgs, reboot2Args,
  exclusiveArgs, planFlashWrite, uf2ToFlashImage, parseBinaryInfo, findPicobootInterface, PicobootConnection,
  formatRange, binaryInfoTagString, REBOOT2_TYPE_BOOTSEL,
} from '../src/utils/picoboot';

// ---- UF2 builder for test vectors (512-byte blocks, layout from the UF2 spec) ----
function uf2Block({ addr, payload, blockNo = 0, numBlocks = 1, family = 0xe48bff56 }) {
  const b = new Uint8Array(512);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, 0x0a324655, true);
  dv.setUint32(4, 0x9e5d5157, true);
  dv.setUint32(8, 0x2000, true); // familyID present flag
  dv.setUint32(12, addr, true);
  dv.setUint32(16, payload.length, true);
  dv.setUint32(20, blockNo, true);
  dv.setUint32(24, numBlocks, true);
  dv.setUint32(28, family, true);
  b.set(payload, 32);
  dv.setUint32(508, 0x0ab16f30, true);
  return b;
}
function uf2File(blocks) {
  const out = new Uint8Array(blocks.length * 512);
  blocks.forEach((b, i) => out.set(b, i * 512));
  return out.buffer;
}

describe('PICOBOOT command struct', () => {
  it('packs the 32-byte header little-endian with magic, token, id, size, length, args', () => {
    const pkt = encodeCommand({ cmdId: PICOBOOT_CMD.FLASH_ERASE, token: 0x11223344, transferLength: 0, args: rangeArgs(0x10000000, 0x1000) });
    expect(pkt.length).toBe(32);
    expect(Array.from(pkt.slice(0, 4))).toEqual([0x0b, 0xd1, 0x1f, 0x43]); // 0x431fd10b LE
    expect(PICOBOOT_MAGIC).toBe(0x431fd10b);
    expect(Array.from(pkt.slice(4, 8))).toEqual([0x44, 0x33, 0x22, 0x11]);
    expect(pkt[8]).toBe(0x03);
    expect(pkt[9]).toBe(8); // cmd size = 8 bytes of args
    expect(Array.from(pkt.slice(10, 12))).toEqual([0, 0]);
    expect(Array.from(pkt.slice(12, 16))).toEqual([0, 0, 0, 0]);
    expect(Array.from(pkt.slice(16, 20))).toEqual([0x00, 0x00, 0x00, 0x10]); // addr
    expect(Array.from(pkt.slice(20, 24))).toEqual([0x00, 0x10, 0x00, 0x00]); // size
    expect(Array.from(pkt.slice(24))).toEqual(new Array(8).fill(0));
  });

  it('round-trips through decodeCommand and encodes transfer length for READ', () => {
    const pkt = encodeCommand({ cmdId: PICOBOOT_CMD.READ, transferLength: 4096, args: rangeArgs(0x10000000, 4096) });
    const d = decodeCommand(pkt);
    expect(d.magic).toBe(PICOBOOT_MAGIC);
    expect(d.cmdId).toBe(0x84);
    expect(d.transferLength).toBe(4096);
    expect(d.token).toBe(1);
    expect(d.cmdSize).toBe(8);
  });

  it('uses the documented command ids and reset request value', () => {
    expect(PICOBOOT_CMD).toMatchObject({ EXCLUSIVE_ACCESS: 1, REBOOT: 2, FLASH_ERASE: 3, WRITE: 5, EXIT_XIP: 6, ENTER_CMD_XIP: 7, REBOOT2: 0x0a, GET_INFO: 0x8b });
    expect(PICOBOOT_CMD.READ).toBe(0x84);
    expect(PICOBOOT_RESET_REQUEST).toBe(0x41);
  });

  it('rejects arguments longer than 16 bytes and bad command ids', () => {
    expect(() => encodeCommand({ cmdId: 1, args: new Uint8Array(17) })).toThrow(/16 bytes/);
    expect(() => encodeCommand({ cmdId: 256 })).toThrow(/command id/);
  });

  it('builds REBOOT, REBOOT2 and EXCLUSIVE argument blocks', () => {
    const r = rebootArgs({ pc: 0x10000100, sp: 0x20040000, delayMs: 50 });
    expect(r.length).toBe(12);
    expect(new DataView(r.buffer).getUint32(0, true)).toBe(0x10000100);
    expect(new DataView(r.buffer).getUint32(8, true)).toBe(50);
    const r2 = reboot2Args({ flags: REBOOT2_TYPE_BOOTSEL, delayMs: 100, param0: 0, param1: 0 });
    expect(r2.length).toBe(16);
    expect(new DataView(r2.buffer).getUint32(0, true)).toBe(0x2);
    expect(new DataView(r2.buffer).getUint32(4, true)).toBe(100);
    expect(Array.from(exclusiveArgs(1))).toEqual([1]);
  });

  it('maps USB product ids to chips and ignores unknown ids', () => {
    expect(chipFromPid(0x0003)).toBe('RP2040');
    expect(chipFromPid(0x000f)).toBe('RP2350');
    expect(chipFromPid(0x000a)).toBeNull(); // app-mode CDC, not PICOBOOT
  });
});

describe('flash write planning', () => {
  it('erases whole sectors and pads to 256-byte pages', () => {
    const data = new Uint8Array(300).fill(0xab);
    const p = planFlashWrite(data, 0x1000 + 10);
    expect(p.eraseStart).toBe(0x1000);
    expect(p.eraseSize).toBe(FLASH_SECTOR_SIZE);
    expect(p.writeStart).toBe(0x1000);
    expect(p.image.length % FLASH_PAGE_SIZE).toBe(0);
    expect(p.image.length).toBe(512); // 10 + 300 rounded up to two pages
    expect(p.imageOffset).toBe(10);
    expect(p.image[9]).toBe(0xff);
    expect(p.image[10]).toBe(0xab);
    expect(p.image[309]).toBe(0xab);
    expect(p.image[310]).toBe(0xff);
  });

  it('spans two sectors when the image crosses a sector boundary', () => {
    const p = planFlashWrite(new Uint8Array(4096), 2048);
    expect(p.eraseStart).toBe(0);
    expect(p.eraseSize).toBe(8192);
  });

  it('rejects empty images and negative offsets', () => {
    expect(() => planFlashWrite(new Uint8Array(0), 0)).toThrow(/empty/);
    expect(() => planFlashWrite(new Uint8Array(4), -1)).toThrow(/offset/);
  });

  it('formats ranges as inclusive hex', () => {
    expect(formatRange(0, 4096)).toBe('0x000000 - 0x000fff');
  });
});

describe('UF2 to flash layout', () => {
  it('places blocks at their target addresses relative to XIP_BASE with 0xFF gaps', () => {
    const b0 = uf2Block({ addr: XIP_BASE, payload: new Uint8Array(256).fill(0x11), blockNo: 0, numBlocks: 2 });
    const b1 = uf2Block({ addr: XIP_BASE + 0x1000, payload: new Uint8Array([1, 2, 3, 4]), blockNo: 1, numBlocks: 2 });
    const img = uf2ToFlashImage(uf2File([b0, b1]));
    expect(img.flashOffset).toBe(0);
    expect(img.familyId).toBe(0xe48bff56);
    expect(img.data.length).toBe(0x1000 + 4);
    expect(img.data[0]).toBe(0x11);
    expect(img.data[255]).toBe(0x11);
    expect(img.data[256]).toBe(0xff); // gap
    expect(Array.from(img.data.slice(0x1000, 0x1004))).toEqual([1, 2, 3, 4]);
  });

  it('reports a non-zero flash offset when the first block is not at the flash base', () => {
    const b = uf2Block({ addr: XIP_BASE + 0x8000, payload: new Uint8Array(16).fill(7) });
    const img = uf2ToFlashImage(uf2File([b]));
    expect(img.flashOffset).toBe(0x8000);
    expect(img.data.length).toBe(16);
  });

  it('rejects RAM targets and bad block magic', () => {
    const ram = uf2Block({ addr: 0x20000000, payload: new Uint8Array(4) });
    expect(() => uf2ToFlashImage(uf2File([ram]))).toThrow(/outside the flash window/);
    const bad = uf2Block({ addr: XIP_BASE, payload: new Uint8Array(4) });
    bad[0] = 0;
    expect(() => uf2ToFlashImage(uf2File([bad]))).toThrow(/magic/);
  });

  it('round-trips a UF2 image through the write planner', () => {
    const b = uf2Block({ addr: XIP_BASE + 0x1000, payload: new Uint8Array(100).fill(0x5a) });
    const img = uf2ToFlashImage(uf2File([b]));
    const plan = planFlashWrite(img.data, img.flashOffset);
    expect(plan.eraseStart).toBe(0x1000);
    expect(plan.imageOffset).toBe(0);
    expect(plan.image[99]).toBe(0x5a);
  });
});

describe('binary_info parsing', () => {
  // Craft a flash image: header at 0x100, pointer table at 0x200, entries at 0x300/0x320, strings at 0x400.
  function craftImage() {
    const img = new Uint8Array(0x800).fill(0xff);
    const dv = new DataView(img.buffer);
    const ptr = (o) => XIP_BASE + o;
    // header: marker, version, table start, table end
    dv.setUint32(0x100, BINARY_INFO_MARKER_START, true);
    dv.setUint32(0x104, 1, true);
    dv.setUint32(0x108, ptr(0x200), true);
    dv.setUint32(0x10c, ptr(0x208), true);
    // table of two entry pointers
    dv.setUint32(0x200, ptr(0x300), true);
    dv.setUint32(0x204, ptr(0x320), true);
    // ID_AND_STRING tag 'RP': core(type=6, tag=0x5052), id, value -> string
    dv.setUint16(0x300, 6, true);
    dv.setUint16(0x302, 0x5052, true);
    dv.setUint32(0x304, 0x02031ab2, true);
    dv.setUint32(0x308, ptr(0x400), true);
    // ID_AND_INT tag 'RP'
    dv.setUint16(0x320, 5, true);
    dv.setUint16(0x322, 0x5052, true);
    dv.setUint32(0x324, 0x77, true);
    dv.setInt32(0x328, -3, true);
    const s = new TextEncoder().encode('hello_pico\0');
    img.set(s, 0x400);
    return img;
  }

  it('finds the header, walks the pointer table and decodes string and int entries', () => {
    const r = parseBinaryInfo(craftImage());
    expect(r.found).toBe(true);
    expect(r.headerOffset).toBe(0x100);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({ type: 6, tagText: 'RP', id: 0x02031ab2, text: 'hello_pico' });
    expect(r.entries[1]).toMatchObject({ type: 5, tagText: 'RP', id: 0x77, value: -3 });
    expect(r.program.strings).toEqual(['hello_pico']);
    expect(r.program.ints).toHaveLength(1);
  });

  it('reports not found on a blank image and on an empty buffer', () => {
    expect(parseBinaryInfo(new Uint8Array(4096).fill(0xff)).found).toBe(false);
    expect(parseBinaryInfo(new Uint8Array(4)).found).toBe(false);
  });

  it('keeps pin and other entry types as raw, not decoded', () => {
    const img = craftImage();
    const dv = new DataView(img.buffer);
    dv.setUint16(0x320, 8, true); // PINS_WITH_FUNC
    const r = parseBinaryInfo(img);
    expect(r.entries[1]).toMatchObject({ type: 8, raw: true });
    expect(r.program.pinEntries).toBe(1);
  });

  it('does not trust a string that does not stay inside the image', () => {
    const img = craftImage();
    new DataView(img.buffer).setUint32(0x308, XIP_BASE + 0xffff0, true);
    const r = parseBinaryInfo(img);
    expect(r.entries[0].text).toBe('');
  });

  it('builds the RP tag as two ASCII characters', () => {
    expect(binaryInfoTagString(0x5052)).toBe('RP');
  });
});

describe('PICOBOOT interface discovery', () => {
  const ep = (direction, endpointNumber) => ({ direction, type: 'bulk', endpointNumber });
  it('picks the vendor-class interface with bulk IN and OUT and ignores mass storage', () => {
    const device = {
      configurations: [{
        configurationValue: 1,
        interfaces: [
          { interfaceNumber: 0, alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0, interfaceProtocol: 0, endpoints: [ep('out', 2), ep('in', 1)] }] },
          { interfaceNumber: 1, alternates: [{ interfaceClass: 0x08, interfaceSubclass: 0x06, interfaceProtocol: 0x50, endpoints: [ep('out', 3), ep('in', 4)] }] },
        ],
      }],
    };
    expect(findPicobootInterface(device)).toEqual({ configurationValue: 1, interfaceNumber: 0, outEndpoint: 2, inEndpoint: 1 });
    expect(findPicobootInterface({ configurations: [] })).toBeNull();
  });
});

// ---- Transport: drive the connection with a fake WebUSB device ----
function fakeDevice(inQueue = []) {
  const calls = [];
  const dev = {
    opened: false,
    configuration: null,
    calls,
    async open() { this.opened = true; },
    async selectConfiguration() {},
    async claimInterface() {},
    async releaseInterface() {},
    async controlTransferOut(setup) { calls.push(['ctrl', setup]); return { status: 'ok' }; },
    async transferOut(ep, data) { calls.push(['out', ep, Array.from(data)]); return { status: 'ok' }; },
    async transferIn(ep, len) {
      calls.push(['in', ep, len]);
      const next = inQueue.shift();
      const bytes = next ?? new Uint8Array(0);
      return { status: 'ok', data: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
    },
  };
  return dev;
}

describe('PicobootConnection transport sequence', () => {
  const iface = { interfaceNumber: 0, outEndpoint: 2, inEndpoint: 1 };

  it('sends the reset control request on the vendor interface', async () => {
    const dev = fakeDevice();
    const c = new PicobootConnection(dev, iface);
    await c.resetInterface();
    expect(dev.calls[0]).toEqual(['ctrl', { requestType: 'vendor', recipient: 'interface', request: 0x41, value: 0, index: 0 }]);
  });

  it('READ: command on OUT, data on IN, then zero-length OUT ACK', async () => {
    const payload = new Uint8Array([9, 8, 7, 6]);
    const dev = fakeDevice([payload]);
    const c = new PicobootConnection(dev, iface);
    const data = await c.read(XIP_BASE, 4);
    expect(Array.from(data)).toEqual([9, 8, 7, 6]);
    expect(dev.calls.map((x) => x[0] + (x[0] === 'out' ? `:${x[2].length}` : ''))).toEqual(['out:32', 'in', 'out:0']);
    expect(dev.calls[1]).toEqual(['in', 1, 4]);
  });

  it('WRITE: command, data on OUT, then zero-length IN ACK', async () => {
    const dev = fakeDevice([new Uint8Array(0)]);
    const c = new PicobootConnection(dev, iface);
    await c.write(XIP_BASE + 0x1000, Uint8Array.of(1, 2, 3));
    expect(dev.calls.map((x) => x[0] + (x[0] === 'out' ? `:${x[2].length}` : ''))).toEqual(['out:32', 'out:3', 'in']);
    const cmd = decodeCommand(Uint8Array.from(dev.calls[0][2]));
    expect(cmd.cmdId).toBe(PICOBOOT_CMD.WRITE);
    expect(cmd.transferLength).toBe(3);
  });

  it('increments the token for each command', async () => {
    const dev = fakeDevice([new Uint8Array(0), new Uint8Array(0)]);
    const c = new PicobootConnection(dev, iface);
    await c.exitXip();
    await c.enterCmdXip();
    expect(decodeCommand(Uint8Array.from(dev.calls[0][2])).token).toBe(1);
    expect(decodeCommand(Uint8Array.from(dev.calls[2][2])).token).toBe(2);
  });

  it('reboot reports a disconnect after the command instead of throwing', async () => {
    const dev = fakeDevice();
    dev.transferIn = async () => { throw new Error('The device was disconnected.'); };
    const c = new PicobootConnection(dev, iface);
    const r = await c.reboot('RP2040', 'app');
    expect(r.disconnectedAfterCommand).toBe(true);
    expect(decodeCommand(Uint8Array.from(dev.calls[0][2])).cmdId).toBe(PICOBOOT_CMD.REBOOT);
  });

  it('uses REBOOT2 with the BOOTSEL flag on RP2350', async () => {
    const dev = fakeDevice([new Uint8Array(0)]);
    const c = new PicobootConnection(dev, iface);
    await c.reboot('RP2350', 'bootsel');
    const cmd = decodeCommand(Uint8Array.from(dev.calls[0][2]));
    expect(cmd.cmdId).toBe(PICOBOOT_CMD.REBOOT2);
    expect(new DataView(cmd.args.buffer, cmd.args.byteOffset, 4).getUint32(0, true)).toBe(0x2);
  });
});

import { parseSize, usedLength, binToUf2, compareImages, crc32Hex, digestHex, picotoolCommands } from '../src/utils/picoboot';

describe('save / verify / export helpers', () => {
  it('parses sizes with K/M suffixes, hex and decimal', () => {
    expect(parseSize('2M')).toBe(2 * 1024 * 1024);
    expect(parseSize('256k')).toBe(262144);
    expect(parseSize('0x1000')).toBe(4096);
    expect(parseSize('12')).toBe(12);
    expect(parseSize('abc')).toBeNull();
    expect(parseSize('')).toBeNull();
  });
  it('trims trailing 0xFF rounded up to pages', () => {
    const d = new Uint8Array(1024).fill(0xff);
    d[300] = 1;
    expect(usedLength(d)).toBe(512);
    expect(usedLength(new Uint8Array(512).fill(0xff))).toBe(0);
  });
  it('encodes UF2 that parses back to the same flash image', () => {
    const data = Uint8Array.from({ length: 700 }, (_, i) => i & 0xff);
    const uf2 = binToUf2(data, XIP_BASE + 0x1000);
    expect(uf2.length).toBe(3 * 512);
    const img = uf2ToFlashImage(uf2.buffer);
    expect(img.flashOffset).toBe(0x1000);
    expect(Array.from(img.data.subarray(0, 700))).toEqual(Array.from(data));
  });
  it('compares images and reports the first mismatch', () => {
    expect(compareImages(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 2, 3)).equal).toBe(true);
    const r = compareImages(Uint8Array.of(1, 2, 3), Uint8Array.of(1, 9, 3, 4));
    expect(r).toMatchObject({ equal: false, mismatches: 2, firstIndex: 1 });
  });
  it('computes CRC-32 and SHA-256', async () => {
    expect(crc32Hex(new TextEncoder().encode('123456789'))).toBe('cbf43926');
    expect(await digestHex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('builds picotool command lines', () => {
    const c = picotoolCommands({ readOffset: 0, readLength: 0x1000, writeFile: 'fw.bin', writeOffset: 0x1000 });
    expect(c).toContain('picotool save -r 0x10000000 0x10001000 flash.bin');
    expect(c).toContain('picotool load fw.bin -o 0x10001000 -v');
    expect(picotoolCommands({ writeFile: 'a b.uf2' })).toContain('picotool load "a b.uf2" -v');
  });
});
