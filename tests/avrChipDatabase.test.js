import { describe, it, expect } from 'vitest';
import { AVR_CHIP_DATABASE } from '../src/utils/avrChipDatabase';

// Spot-check values copied from avrdudes/avrdude (src/avrdude.conf.in for signature,
// flash/EEPROM size and flash page size; src/avrintel.c cfgtab_* for the EESAVE fuse
// and the efuse bit layout). Part ids are the avrdude.conf `id` of each part.
// [avrdude id, signature, flash bytes, flash page bytes, EEPROM bytes, eesave, efuseUnused]
const TABLE = [
  ['m328p',   0x1e950f,  32768, 128, 1024, ['hfuse', 0x08], undefined],
  ['t85',     0x1e930b,   8192,  64,  512, ['hfuse', 0x08], 0xfe],
  ['m2560',   0x1e9801, 262144, 256, 4096, ['hfuse', 0x08], undefined],
  ['m32u4',   0x1e9587,  32768, 128, 1024, ['hfuse', 0x08], 0xf0],
  ['m1284p',  0x1e9705, 131072, 256, 4096, ['hfuse', 0x08], undefined],
  ['m16u2',   0x1e9489,  16384, 128,  512, ['hfuse', 0x08], 0xf0],
  ['usb1286', 0x1e9782, 131072, 256, 4096, ['hfuse', 0x08], 0xf0],
  ['t2313',   0x1e910a,   2048,  32,  128, ['hfuse', 0x40], 0xfe],
  ['m64',     0x1e9602,  65536, 256, 2048, ['hfuse', 0x08], 0xfc],
  ['c128',    0x1e9781, 131072, 256, 4096, ['hfuse', 0x08], 0xf0],
  ['t1634',   0x1e9412,  16384,  32,  256, ['hfuse', 0x08], 0xe0],
  ['m162',    0x1e9404,  16384, 128,  512, ['hfuse', 0x08], 0xe1],
];

describe('AVR chip database vs avrdude.conf', () => {
  it.each(TABLE)('%s', (id, sig, flash, page, eeprom, eesave, efuseUnused) => {
    const chip = AVR_CHIP_DATABASE[sig];
    expect(chip, `signature 0x${sig.toString(16)} (${id})`).toBeDefined();
    expect(chip.flashSize).toBe(flash);
    expect(chip.pageSize).toBe(page);
    expect(chip.eepromSize).toBe(eeprom);
    expect(chip.eesave).toEqual(eesave);
    expect(chip.efuseUnused).toBe(efuseUnused);
  });

  it('places ATtiny13A EESAVE in the low fuse, bit 6 (avrdude avrintel.c)', () => {
    const chip = AVR_CHIP_DATABASE[0x1e9007]; // avrdude id t13a
    expect(chip).toMatchObject({ name: 'ATtiny13A', flashSize: 1024, pageSize: 32, eepromSize: 64, noEfuse: true });
    expect(chip.eesave).toEqual(['lfuse', 0x40]);
  });

  it('only ships default fuses that match avrdude initval or the Arduino core boards.txt', () => {
    // Arduino Uno / Leonardo / Mega 2560 rows of ArduinoCore-avr boards.txt.
    expect(AVR_CHIP_DATABASE[0x1e950f].defaultFuses).toEqual({ lfuse: 0xff, hfuse: 0xde, efuse: 0xfd, lock: 0x0f });
    expect(AVR_CHIP_DATABASE[0x1e9587].defaultFuses).toEqual({ lfuse: 0xff, hfuse: 0xd8, efuse: 0xcb, lock: 0x2f });
    expect(AVR_CHIP_DATABASE[0x1e9801].defaultFuses).toEqual({ lfuse: 0xff, hfuse: 0xd8, efuse: 0xfd, lock: 0x0f });
    // avrdude.conf initval for t85: lfuse 0x62, hfuse 0xdf, efuse 0xff.
    expect(AVR_CHIP_DATABASE[0x1e930b].defaultFuses).toMatchObject({ lfuse: 0x62, hfuse: 0xdf, efuse: 0xff });
    // Not confirmable from either source, so deliberately absent.
    for (const sig of [0x1e9307, 0x1e9514, 0x1e9516, 0x1e9705]) {
      expect(AVR_CHIP_DATABASE[sig].defaultFuses, `0x${sig.toString(16)}`).toBeUndefined();
    }
  });
});
