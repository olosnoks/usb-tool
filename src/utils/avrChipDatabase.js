/**
 * AVR chip database: signature -> memory geometry and the fuse bits that matter
 * to ISP programming. Verified against avrdude's avrdude.conf.in and
 * src/avrintel.c (see tests/avrChipDatabase.test.js).
 * Only parts whose signature, flash size, EEPROM size and flash page size are
 * known for certain are listed. Parts that share a signature (the "A" / "PA"
 * variants of the same die, AT90USB646/647) appear once under a combined name.
 *
 * Fuse bits are active-low: 0 = programmed.
 *   guard   bits that lock you out of ISP when set wrong ([fuse, mask]).
 *   eesave  the EESAVE bit (EEPROM survives chip erase when it is programmed).
 *           Omitted when the bit position is not known for sure.
 *   defaultFuses  Arduino defaults, only where known; without them the
 *           "burn bootloader" action is disabled for that chip.
 *   noEfuse / efuseUnused  extended fuse presence and its unused-bit mask
 *           (the driver assumes 0xf8, i.e. a 3-bit efuse, when omitted).
 *   ATtiny13A: EESAVE is lfuse bit 6 (0x40) (avrdude avrintel.c); eepromAfterErase()
 *           reads whichever fuse the chip's eesave entry names.
 */

const MEGA_GUARD = { spien: ['hfuse', 0x20] };
// ATmega48/88/168/328 and ATtiny25/45/85/24/44/84/261/461/861/48/88 share this hfuse layout.
const RST_GUARD = { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80], dwen: ['hfuse', 0x40] };
const EESAVE_H3 = ['hfuse', 0x08];
// ATtiny2313/4313: RSTDISBL is hfuse bit 0, DWEN bit 7 (avrdude avrintel.c cfgtab_attiny2313).
const TINY2313_GUARD = { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x01], dwen: ['hfuse', 0x80] };
// ATmega8U2/16U2/32U2 and AT90USB82/162: RSTDISBL is hfuse bit 6, DWEN bit 7.
const USB2_GUARD = { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x40], dwen: ['hfuse', 0x80] };

const kb = (n) => n * 1024;

function part(signature, name, family, flashSize, eepromSize, pageSize, extra = {}) {
  return [signature, { name, family, flashSize, eepromSize, pageSize, ...extra }];
}

const ENTRIES = [
  // ---- tinyAVR -------------------------------------------------------------
  part(0x1E9007, 'ATtiny13A', 'tinyAVR', kb(1), 64, 32, {
    noEfuse: true,
    defaultFuses: { lfuse: 0x6A, hfuse: 0xFF, efuse: 0xFF, lock: 0xFF },
    eesave: ['lfuse', 0x40], // avrdude avrintel.c: ATtiny13A EESAVE is lfuse bit 6
    guard: { spien: ['lfuse', 0x80], rstdisbl: ['hfuse', 0x01], dwen: ['hfuse', 0x08] },
    desc: '8-pin, 1 KB flash'
  }),
  part(0x1E9108, 'ATtiny25', 'tinyAVR', kb(2), 128, 32, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '8-pin tinyAVR, 2 KB flash' }),
  part(0x1E9206, 'ATtiny45', 'tinyAVR', kb(4), 256, 64, {
    efuseUnused: 0xfe, eesave: EESAVE_H3,
    defaultFuses: { lfuse: 0x62, hfuse: 0xDF, efuse: 0xFF, lock: 0xFF },
    guard: RST_GUARD, desc: '8-pin tinyAVR, 4 KB flash'
  }),
  part(0x1E930B, 'ATtiny85', 'tinyAVR', kb(8), 512, 64, {
    efuseUnused: 0xfe, eesave: EESAVE_H3,
    defaultFuses: { lfuse: 0x62, hfuse: 0xDF, efuse: 0xFF, lock: 0xFF },
    guard: RST_GUARD, desc: '8-pin ultra-compact microcontroller (Digispark)'
  }),
  part(0x1E910B, 'ATtiny24', 'tinyAVR', kb(2), 128, 32, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '14-pin tinyAVR, 2 KB flash' }),
  part(0x1E9207, 'ATtiny44', 'tinyAVR', kb(4), 256, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '14-pin tinyAVR, 4 KB flash' }),
  part(0x1E930C, 'ATtiny84', 'tinyAVR', kb(8), 512, 64, {
    efuseUnused: 0xfe, eesave: EESAVE_H3,
    defaultFuses: { lfuse: 0x62, hfuse: 0xDF, efuse: 0xFF, lock: 0xFF },
    guard: RST_GUARD, desc: '14-pin tinyAVR'
  }),
  part(0x1E910C, 'ATtiny261', 'tinyAVR', kb(2), 128, 32, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '20-pin tinyAVR, 2 KB flash' }),
  part(0x1E9208, 'ATtiny461', 'tinyAVR', kb(4), 256, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '20-pin tinyAVR, 4 KB flash' }),
  part(0x1E930D, 'ATtiny861', 'tinyAVR', kb(8), 512, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '20-pin tinyAVR, 8 KB flash' }),
  part(0x1E910A, 'ATtiny2313', 'tinyAVR', kb(2), 128, 32, { efuseUnused: 0xfe, eesave: ['hfuse', 0x40], guard: TINY2313_GUARD, desc: '20-pin tinyAVR with UART (ATtiny2313 / 2313A)' }),
  part(0x1E920D, 'ATtiny4313', 'tinyAVR', kb(4), 256, 64, { efuseUnused: 0xfe, eesave: ['hfuse', 0x40], guard: TINY2313_GUARD, desc: '20-pin tinyAVR with UART (ATtiny4313)' }),
  part(0x1E9209, 'ATtiny48', 'tinyAVR', kb(4), 64, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '28/32-pin tinyAVR, 4 KB flash' }),
  part(0x1E9311, 'ATtiny88', 'tinyAVR', kb(8), 64, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '28/32-pin tinyAVR, 8 KB flash' }),
  part(0x1E9387, 'ATtiny87', 'tinyAVR', kb(8), 512, 128, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '20-pin tinyAVR with LIN/UART' }),
  part(0x1E9487, 'ATtiny167', 'tinyAVR', kb(16), 512, 128, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: '20-pin tinyAVR with LIN/UART, 16 KB flash (Digispark Pro)' }),
  part(0x1E9412, 'ATtiny1634', 'tinyAVR', kb(16), 256, 32, { efuseUnused: 0xe0, eesave: EESAVE_H3, guard: RST_GUARD, desc: '20-pin tinyAVR, 16 KB flash, two USARTs' }),

  // ---- megaAVR: classic ----------------------------------------------------
  part(0x1E9307, 'ATmega8', 'megaAVR', kb(8), 512, 64, {
    noEfuse: true, eesave: EESAVE_H3,
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80] },
    desc: 'Arduino NG / early boards (ATmega8 / 8A)'
  }),
  part(0x1E9306, 'ATmega8515', 'megaAVR', kb(8), 512, 64, { noEfuse: true, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin classic megaAVR' }),
  part(0x1E9308, 'ATmega8535', 'megaAVR', kb(8), 512, 64, { noEfuse: true, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin classic megaAVR with ADC' }),
  part(0x1E9403, 'ATmega16', 'megaAVR', kb(16), 512, 128, { noEfuse: true, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin megaAVR with JTAG (ATmega16 / 16A)' }),
  part(0x1E9502, 'ATmega32', 'megaAVR', kb(32), 1024, 128, { noEfuse: true, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin megaAVR with JTAG (ATmega32 / 32A)' }),
  part(0x1E9602, 'ATmega64', 'megaAVR', kb(64), 2048, 256, { efuseUnused: 0xfc, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '64-pin megaAVR (ATmega64 / 64A)' }),
  part(0x1E9702, 'ATmega128', 'megaAVR', kb(128), 4096, 256, { efuseUnused: 0xfc, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '64-pin megaAVR (ATmega128 / 128A)' }),
  part(0x1E9404, 'ATmega162', 'megaAVR', kb(16), 512, 128, { efuseUnused: 0xe1, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin megaAVR with two USARTs' }),

  // ---- megaAVR: 48/88/168/328 families -------------------------------------
  part(0x1E9205, 'ATmega48', 'megaAVR', kb(4), 256, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega48 / 48A' }),
  part(0x1E920A, 'ATmega48P', 'megaAVR', kb(4), 256, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega48P / 48PA' }),
  part(0x1E9210, 'ATmega48PB', 'megaAVR', kb(4), 256, 64, { efuseUnused: 0xfe, eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega48PB' }),
  part(0x1E930A, 'ATmega88', 'megaAVR', kb(8), 512, 64, { eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega88 / 88A' }),
  part(0x1E930F, 'ATmega88P', 'megaAVR', kb(8), 512, 64, { eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega88P / 88PA' }),
  part(0x1E9316, 'ATmega88PB', 'megaAVR', kb(8), 512, 64, { eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega88PB' }),
  part(0x1E9406, 'ATmega168', 'megaAVR', kb(16), 512, 128, {
    eesave: EESAVE_H3,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xDD, efuse: 0xF8, lock: 0x0F },
    guard: RST_GUARD, desc: 'Arduino Diecimila / older Nano and Pro Mini (ATmega168 / 168A)'
  }),
  part(0x1E940B, 'ATmega168P', 'megaAVR', kb(16), 512, 128, { eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega168P / 168PA' }),
  part(0x1E9415, 'ATmega168PB', 'megaAVR', kb(16), 512, 128, { eesave: EESAVE_H3, guard: RST_GUARD, desc: 'ATmega168PB' }),
  part(0x1E9514, 'ATmega328', 'megaAVR', kb(32), 1024, 128, {
    eesave: EESAVE_H3,
    guard: RST_GUARD, desc: 'ATmega328 (non-P)'
  }),
  part(0x1E950F, 'ATmega328P', 'megaAVR', kb(32), 1024, 128, {
    eesave: EESAVE_H3,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xDE, efuse: 0xFD, lock: 0x0F },
    guard: RST_GUARD, desc: 'Arduino Uno R3, Nano v3, Pro Mini 5V/16MHz'
  }),
  part(0x1E9516, 'ATmega328PB', 'megaAVR', kb(32), 1024, 128, {
    efuseUnused: 0xf0, eesave: EESAVE_H3,
    guard: RST_GUARD, desc: 'Enhanced ATmega328 with dual USART, SPI, and I2C'
  }),

  // ---- megaAVR: 164/324/644/1284 ------------------------------------------
  part(0x1E940F, 'ATmega164A', 'megaAVR', kb(16), 512, 128, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin megaAVR, 16 KB flash' }),
  part(0x1E940A, 'ATmega164P', 'megaAVR', kb(16), 512, 128, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'ATmega164P / 164PA' }),
  part(0x1E9515, 'ATmega324A', 'megaAVR', kb(32), 1024, 128, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin megaAVR, 32 KB flash' }),
  part(0x1E9508, 'ATmega324P', 'megaAVR', kb(32), 1024, 128, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'ATmega324P' }),
  part(0x1E9511, 'ATmega324PA', 'megaAVR', kb(32), 1024, 128, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'ATmega324PA' }),
  part(0x1E9609, 'ATmega644A', 'megaAVR', kb(64), 2048, 256, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '40-pin megaAVR, 64 KB flash (ATmega644 / 644A)' }),
  part(0x1E960A, 'ATmega644P', 'megaAVR', kb(64), 2048, 256, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'ATmega644P / 644PA' }),
  part(0x1E9706, 'ATmega1284', 'megaAVR', kb(128), 4096, 256, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'ATmega1284' }),
  part(0x1E9705, 'ATmega1284P', 'megaAVR', kb(128), 4096, 256, {
    eesave: EESAVE_H3,
    guard: MEGA_GUARD, desc: 'Sanguino / large-memory 40-pin AVR'
  }),

  // ---- megaAVR: 640/1280/1281/2560/2561 -----------------------------------
  part(0x1E9608, 'ATmega640', 'megaAVR', kb(64), 4096, 256, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '100-pin megaAVR, 64 KB flash' }),
  part(0x1E9703, 'ATmega1280', 'megaAVR', kb(128), 4096, 256, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'Arduino Mega (original)' }),
  part(0x1E9704, 'ATmega1281', 'megaAVR', kb(128), 4096, 256, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '64-pin megaAVR, 128 KB flash' }),
  part(0x1E9801, 'ATmega2560', 'megaAVR', kb(256), 4096, 256, {
    eesave: EESAVE_H3,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xD8, efuse: 0xFD, lock: 0x0F },
    guard: MEGA_GUARD, desc: 'Arduino Mega 2560, 3D Printer Controller (RAMPS)'
  }),
  part(0x1E9802, 'ATmega2561', 'megaAVR', kb(256), 4096, 256, { eesave: EESAVE_H3, guard: MEGA_GUARD, desc: '64-pin megaAVR, 256 KB flash' }),

  // ---- megaAVR / AT90 with USB ---------------------------------------------
  part(0x1E9389, 'ATmega8U2', 'megaAVR (Native USB)', kb(8), 512, 128, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: USB2_GUARD, desc: 'Arduino Uno USB-serial chip (older boards)' }),
  part(0x1E9489, 'ATmega16U2', 'megaAVR (Native USB)', kb(16), 512, 128, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: USB2_GUARD, desc: 'Arduino Uno R3 USB-serial chip' }),
  part(0x1E958A, 'ATmega32U2', 'megaAVR (Native USB)', kb(32), 1024, 128, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: USB2_GUARD, desc: 'Native USB megaAVR, 32 KB flash' }),
  part(0x1E9488, 'ATmega16U4', 'megaAVR (Native USB)', kb(16), 512, 128, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'Native USB megaAVR, 16 KB flash' }),
  part(0x1E9587, 'ATmega32U4', 'megaAVR (Native USB)', kb(32), 1024, 128, {
    efuseUnused: 0xf0, eesave: EESAVE_H3,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xD8, efuse: 0xCB, lock: 0x2F },
    guard: MEGA_GUARD, desc: 'Arduino Leonardo, Pro Micro, BadUSB Keyboard Emulators'
  }),
  part(0x1E9382, 'AT90USB82', 'AT90 (Native USB)', kb(8), 512, 128, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: USB2_GUARD, desc: 'AT90USB82' }),
  part(0x1E9482, 'AT90USB162', 'AT90 (Native USB)', kb(16), 512, 128, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: USB2_GUARD, desc: 'AT90USB162' }),
  part(0x1E9682, 'AT90USB646/647', 'AT90 (Native USB)', kb(64), 2048, 256, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'AT90USB646 and AT90USB647 share this signature' }),
  part(0x1E9782, 'AT90USB1286/1287', 'AT90 (Native USB)', kb(128), 4096, 256, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'AT90USB1286 and AT90USB1287 share this signature' }),

  // ---- AT90CAN --------------------------------------------------------------
  part(0x1E9581, 'AT90CAN32', 'AT90', kb(32), 1024, 256, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'AT90CAN32' }),
  part(0x1E9681, 'AT90CAN64', 'AT90', kb(64), 2048, 256, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'AT90CAN64' }),
  part(0x1E9781, 'AT90CAN128', 'AT90', kb(128), 4096, 256, { efuseUnused: 0xf0, eesave: EESAVE_H3, guard: MEGA_GUARD, desc: 'AT90CAN128' })
];

export const AVR_CHIP_DATABASE = Object.fromEntries(ENTRIES);

/**
 * What a chip erase does to the EEPROM, from the high fuse.
 * @returns {{ status: 'preserved' | 'wiped' | 'unknown', text: string }}
 */
/**
 * What a chip erase does to the EEPROM. `fuses` is the fuse object from readFuses()
 * ({ lfuse, hfuse, efuse }), or, for older callers, just the high-fuse byte.
 */
export function eepromAfterErase(chip, fuses) {
  if (!chip?.eesave) {
    return { status: 'unknown', text: `The EESAVE fuse position of the ${chip?.name || 'chip'} is not in the chip list, so it is not known whether a chip erase keeps the EEPROM. Assume it is wiped.` };
  }
  const [which, mask] = chip.eesave;
  const value = typeof fuses === 'object' && fuses !== null ? fuses[which] : (which === 'hfuse' ? fuses : undefined);
  if (value === undefined || value === null) {
    const name = { lfuse: 'low', hfuse: 'high', efuse: 'extended' }[which] || which;
    return { status: 'unknown', text: `The ${name} fuse was not read, so it is not known whether a chip erase keeps the EEPROM. Assume it is wiped.` };
  }
  return (value & mask) === 0
    ? { status: 'preserved', text: 'EESAVE is programmed: a chip erase keeps the EEPROM.' }
    : { status: 'wiped', text: 'EESAVE is NOT programmed: a chip erase also wipes the EEPROM (every byte becomes 0xFF).' };
}
