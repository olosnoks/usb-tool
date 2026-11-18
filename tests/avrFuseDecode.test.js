import { describe, it, expect } from 'vitest';
import { AVR_CHIP_DATABASE } from '../src/utils/avrChipDatabase';
import {
  hasFuseLayout, decodeFuses, summarizeFuses, toggleFuseBit, parseHexByte,
  avrdudePartId, avrdudeCommands, avrdudeBootloaderCommand, imageFit
} from '../src/utils/avrFuseDecode';

const chip = (name) => Object.values(AVR_CHIP_DATABASE).find((c) => c.name === name);
const m328p = chip('ATmega328P');

describe('fuse decoding', () => {
  it('knows the ATmega328P layout but not other chips', () => {
    expect(hasFuseLayout(m328p)).toBe(true);
    expect(hasFuseLayout(chip('ATtiny85'))).toBe(false);
    expect(decodeFuses(chip('ATtiny85'), { lfuse: 0x62, hfuse: 0xdf, efuse: 0xff })).toBeNull();
  });

  it('decodes factory fuses 62 D9 FF as 1 MHz internal RC', () => {
    const d = decodeFuses(m328p, { lfuse: 0x62, hfuse: 0xd9, efuse: 0xff });
    expect(d.clock.source).toBe('Internal 8 MHz RC');
    expect(d.clock.divide8).toBe(true);
    expect(d.clock.mhz).toBe(1);
    expect(d.bootBytes).toBe(4096);
    expect(d.bod).toBe('Disabled');
    const on = d.flags.filter((f) => f.programmed).map((f) => f.name);
    expect(on).toEqual(['CKDIV8', 'SPIEN']);
  });

  it('decodes the Uno fuses FF DE FD', () => {
    const d = decodeFuses(m328p, { lfuse: 0xff, hfuse: 0xde, efuse: 0xfd });
    expect(d.clock.source).toBe('Low-power crystal');
    expect(d.clock.mhz).toBeNull();
    expect(d.bootBytes).toBe(512);
    expect(d.bod).toBe('2.7 V');
    expect(d.flags.find((f) => f.name === 'BOOTRST').programmed).toBe(true);
    expect(d.flags.find((f) => f.name === 'EESAVE').programmed).toBe(false);
    expect(summarizeFuses(m328p, { lfuse: 0xff, hfuse: 0xde, efuse: 0xfd })).toContain('BOD 2.7 V');
  });

  it('toggles a single bit and parses hex bytes', () => {
    expect(toggleFuseBit(0xff, 0x80)).toBe(0x7f);
    expect(toggleFuseBit(0x7f, 0x80)).toBe(0xff);
    expect(parseHexByte('0xDE')).toBe(0xde);
    expect(parseHexByte(' 5 ')).toBe(5);
    expect(parseHexByte('1ff')).toBeNaN();
    expect(parseHexByte('zz')).toBeNaN();
    expect(parseHexByte('')).toBeNaN();
  });
});

describe('avrdude export', () => {
  it('maps part ids only where certain', () => {
    expect(avrdudePartId(m328p)).toBe('m328p');
    expect(avrdudePartId(chip('ATtiny85'))).toBe('t85');
    expect(avrdudePartId(chip('AT90USB646/647'))).toBeNull();
    expect(avrdudePartId(null)).toBeNull();
  });

  it('builds the command lines', () => {
    const cmds = avrdudeCommands({ chip: m328p, fuses: { lfuse: 0xff, hfuse: 0xde, efuse: 0xfd }, image: { name: 'optiboot atmega328.hex' } });
    const byLabel = Object.fromEntries(cmds.map((c) => [c.label, c.cmd]));
    expect(byLabel['Write fuses (L/H/E)']).toBe('avrdude -c stk500v1 -P <port> -b 19200 -p m328p -U lfuse:w:0xFF:m -U hfuse:w:0xDE:m -U efuse:w:0xFD:m');
    expect(byLabel['Erase, write and verify flash']).toContain('-U flash:w:"optiboot atmega328.hex":i');
    expect(avrdudeCommands({ chip: { name: 'Unknown' } })).toEqual([]);
  });

  it('skips efuse for chips without one', () => {
    const t13 = chip('ATtiny13A');
    const cmd = avrdudeCommands({ chip: t13, fuses: { lfuse: 0x6a, hfuse: 0xff, efuse: 0xff } }).find((c) => c.label.startsWith('Write fuses')).cmd;
    expect(cmd).not.toContain('efuse');
  });

  it('builds a bootloader upload command', () => {
    expect(avrdudeBootloaderCommand({ partId: 'm328p', baud: 115200, imageName: 'blink.hex' }))
      .toBe('avrdude -c arduino -P <port> -b 115200 -p m328p -D -U flash:w:blink.hex:i');
    expect(avrdudeBootloaderCommand({ partId: null, baud: 1, imageName: 'x' })).toBe('');
  });
});

describe('imageFit', () => {
  it('reports occupancy and overflow', () => {
    const img = { startAddress: 0, data: new Uint8Array(16384) };
    expect(imageFit(img, m328p)).toEqual({ end: 16384, percent: 50, fits: true });
    expect(imageFit({ startAddress: 0x7000, data: new Uint8Array(0x2000) }, m328p).fits).toBe(false);
    expect(imageFit(null, m328p)).toBeNull();
  });
});
