import { describe, it, expect } from 'vitest';
import {
  Ch341, SpiFlash, I2cEeprom, Ch341aClient, reverseBits, identifyChip, decodeStatus, diffBuffers, CH341_USB
} from '../src/utils/ch341aDriver';
import { createSimulatedCh341 } from './helpers/sim/ch341';

const setup = async (opts) => {
  const t = createSimulatedCh341(opts);
  const ch = new Ch341(t);
  await ch.configure(1);
  await ch.enablePins(true);
  return { t, ch, flash: new SpiFlash(ch) };
};

describe('CH341 packets', () => {
  it('reverses bits for the LSB-first SPI engine', () => {
    expect(reverseBits(0x01)).toBe(0x80);
    expect(reverseBits(0x9f)).toBe(0xf9);
    expect(reverseBits(0xa5)).toBe(0xa5);
  });

  it('frames an SPI transaction as a CS packet plus 31-byte stream packets', async () => {
    const sent = [];
    const ch = new Ch341({ out: async (b) => sent.push(Array.from(b)), in: async (n) => new Uint8Array(Math.min(n, 31)).fill(0x01) });
    const r = await ch.spi([0x9f], 40);
    const first = sent[0];
    expect(first.slice(0, 4)).toEqual([CH341_USB.CMD_UIO_STREAM, 0xb7, 0xb6, CH341_USB.UIO_STM_END]);
    expect(first.length).toBe(32 + 2 + 41);
    expect(first[32]).toBe(CH341_USB.CMD_SPI_STREAM);
    expect(first[33]).toBe(0xf9); // 0x9F reversed
    expect(first[64]).toBe(CH341_USB.CMD_SPI_STREAM);
    expect(sent[1]).toEqual([CH341_USB.CMD_UIO_STREAM, 0xb7, CH341_USB.UIO_STM_END]);
    expect(r.length).toBe(40);
    expect(r[0]).toBe(0x80); // 0x01 reversed back
  });

  it('builds I2C read transactions with a NACKed last byte', async () => {
    const sent = [];
    const ch = new Ch341({ out: async (b) => sent.push(Array.from(b)), in: async (n) => new Uint8Array(n) });
    await ch.i2c([0xa0, 0x10], 4);
    expect(sent[0]).toEqual([0xaa, 0x74, 0x82, 0xa0, 0x10, 0x74, 0x81, 0xa1, 0xc3, 0xc0, 0x75, 0x00]);
  });
});

describe('SPI flash through the simulated programmer', () => {
  it('identifies the chip from JEDEC ID and SFDP', async () => {
    const { flash } = await setup();
    expect(await flash.identify()).toMatchObject({ manufacturer: 'Winbond', model: 'W25Q64', sizeBytes: 8 * 1024 * 1024 });
    const unknown = await setup({ jedecId: 0x123456, size: 2 * 1024 * 1024 });
    expect(await unknown.flash.identify()).toMatchObject({ guessed: true, sizeBytes: 2 * 1024 * 1024, sizeFrom: 'SFDP' });
    expect(identifyChip(0xaa4017).sizeBytes).toBe(8 * 1024 * 1024);
  });

  it('reads across packet boundaries', async () => {
    const { flash } = await setup();
    await flash.identify();
    const data = await flash.read(0, 5000);
    expect(new TextDecoder().decode(data.subarray(0, 8))).toBe('AMI BIOS');
    expect(Array.from(data.subarray(0x1000, 0x1006))).toEqual([0x54, 0xee, 0x75, 0x12, 0x34, 0x56]);
  });

  it('reports and clears block protection', async () => {
    const { flash } = await setup();
    await flash.identify();
    const before = await flash.status();
    expect(before).toMatchObject({ bp: 7, protected: true, qe: true });
    const after = await flash.unprotect();
    expect(after.protected).toBe(false);
    expect(decodeStatus(0x9c).srp0).toBe(true);
  });

  it('writes with erase-as-needed and verifies; write-protected chips fail verify', async () => {
    const { flash, t } = await setup();
    await flash.identify();
    const payload = Uint8Array.from({ length: 6000 }, (_, i) => (i * 13) & 0xff);
    await expect(flash.write(0x2000, payload)).rejects.toThrow(/write-protected/);
    await flash.unprotect();
    const r = await flash.write(0x2000, payload);
    expect(r.erased).toBe(0); // blank (0xFF) sectors only need bits cleared
    expect(r.programmed).toBe(24);
    expect(Array.from(await flash.read(0x2000, 6000))).toEqual(Array.from(payload));
    // Writing it again changes nothing, and a 1 -> 0 only change needs no erase.
    expect((await flash.write(0x2000, payload)).skipped).toBe(2);
    t.state.log.length = 0;
    const lowered = payload.slice(0, 16).map((b) => b & 0x0f);
    const r2 = await flash.write(0x2000, lowered);
    expect(r2.erased).toBe(0);
    expect(r2.programmed).toBe(1);
    // Setting bits back to 1 needs an erase of that sector only.
    const r3 = await flash.write(0x2000, new Uint8Array(16).fill(0xff));
    expect(r3.erased).toBe(1);
    expect(Array.from(await flash.read(0x2010, 4))).toEqual(Array.from(payload.subarray(16, 20)));
  });
});

describe('I2C EEPROM', () => {
  it('reads and writes a 24C02 with page wrap handled', async () => {
    const { ch } = await setup();
    const ee = new I2cEeprom(ch, '24C02');
    const first = await ee.read();
    expect(new TextDecoder().decode(first.subarray(0, 10))).toBe('SIM-EEPROM');
    const data = Uint8Array.from({ length: 256 }, (_, i) => 255 - i);
    await ee.write(data);
    expect(Array.from(await ee.read())).toEqual(Array.from(data));
    expect(() => new I2cEeprom(ch, '24X99')).toThrow(/Unknown/);
  });

  it('puts high address bits in the device address on 24C04-16', () => {
    const ee = new I2cEeprom(null, '24C16');
    expect(ee._address(0x3ab)).toEqual({ dev: 0x53, bytes: [0xab] });
    const big = new I2cEeprom(null, '24C256');
    expect(big._address(0x1234)).toEqual({ dev: 0x50, bytes: [0x12, 0x34] });
  });
});

describe('client and diffs', () => {
  it('runs the workbench flow in simulation', async () => {
    const c = new Ch341aClient(() => {});
    await c._attach(createSimulatedCh341());
    const chip = await c.readJedecId();
    expect(chip.model).toBe('W25Q64');
    const dump = await c.readFlash(0, 4096);
    expect(dump[0]).toBe(0x41);
    await c.disconnect();
    expect(c.connected).toBe(false);
  });

  it('finds and merges differing ranges', () => {
    const a = new Uint8Array(100);
    const b = a.slice();
    b[10] = 1; b[12] = 1; b[80] = 1;
    expect(diffBuffers(a, b, { gap: 4 })).toEqual({ bytes: 3, ranges: [{ start: 10, end: 13 }, { start: 80, end: 81 }], sizeDiffers: false });
  });
});
