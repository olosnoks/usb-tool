/**
 * Fuse decoding and avrdude command export for the AVR ISP workbench.
 * Pure functions, no I/O.
 *
 * Fuse bits are active-low: 0 = programmed. The bit layouts below are the
 * ATmega48/88/168/328 family datasheet layouts (the same die family for all
 * of ATmega48/88/168/328, with and without P / PB suffix). Other chips get no
 * decoding rather than a guess.
 */

const MEGA_X8 = /^ATmega(48|88|168|328)(P|PB)?$/;

export function hasFuseLayout(chip) {
  return !!chip && MEGA_X8.test(chip.name || '');
}

// CKSEL[3:0] -> source (ATmega328P datasheet, table "Device clocking options").
function clockSource(cksel) {
  if (cksel === 0b0000) return { name: 'External clock', mhz: null };
  if (cksel === 0b0010) return { name: 'Internal 8 MHz RC', mhz: 8 };
  if (cksel === 0b0011) return { name: 'Internal 128 kHz RC', mhz: 0.128 };
  if (cksel === 0b0100 || cksel === 0b0101) return { name: 'Low-frequency crystal', mhz: null };
  if (cksel === 0b0110 || cksel === 0b0111) return { name: 'Full-swing crystal', mhz: null };
  if (cksel >= 0b1000) return { name: 'Low-power crystal', mhz: null };
  return { name: 'Reserved', mhz: null };
}

const BOD = { 7: 'Disabled', 6: '1.8 V', 5: '2.7 V', 4: '4.3 V' };
const BOOT_BYTES = { 3: 512, 2: 1024, 1: 2048, 0: 4096 };

const isProg = (value, mask) => (value & mask) === 0;

/**
 * Describe the fuse bytes for a chip. Returns null when the chip's fuse layout
 * is not known. `flags` are the single-bit fuses in display order; each has
 * `fuse` and `mask` so a UI can toggle it with toggleFuseBit().
 */
export function decodeFuses(chip, fuses) {
  if (!hasFuseLayout(chip) || !fuses) return null;
  const { lfuse, hfuse, efuse } = fuses;
  const cksel = lfuse & 0x0f;
  const src = clockSource(cksel);
  const div8 = isProg(lfuse, 0x80);
  const clock = {
    source: src.name,
    cksel,
    startup: `SUT=${(lfuse >> 4) & 3}`,
    divide8: div8,
    mhz: src.mhz == null ? null : src.mhz / (div8 ? 8 : 1)
  };
  const defs = [
    ['CKDIV8', 'lfuse', 0x80, 'Divide the system clock by 8'],
    ['CKOUT', 'lfuse', 0x40, 'Output the system clock on PB0'],
    ['RSTDISBL', 'hfuse', 0x80, 'Reset pin becomes GPIO (ISP stops working)'],
    ['DWEN', 'hfuse', 0x40, 'debugWIRE enabled (ISP stops working)'],
    ['SPIEN', 'hfuse', 0x20, 'Serial (ISP) programming enabled'],
    ['WDTON', 'hfuse', 0x10, 'Watchdog always on'],
    ['EESAVE', 'hfuse', 0x08, 'EEPROM survives chip erase'],
    ['BOOTRST', 'hfuse', 0x01, 'Reset vector at the bootloader start']
  ];
  const flags = defs.map(([name, fuse, mask, desc]) => ({ name, fuse, mask, desc, programmed: isProg(fuses[fuse], mask) }));
  const bootBytes = BOOT_BYTES[(hfuse >> 1) & 3];
  const bod = BOD[efuse & 7] || 'Reserved';
  return { clock, flags, bootBytes, bod };
}

/** One-line summary, for example "Internal 8 MHz RC, CKDIV8, 1 MHz; boot 512 B; BOD Disabled". */
export function summarizeFuses(chip, fuses) {
  const d = decodeFuses(chip, fuses);
  if (!d) return '';
  const c = d.clock;
  const speed = c.mhz == null ? 'speed set by the external source' : `${+c.mhz.toFixed(3)} MHz`;
  return `${c.source}${c.divide8 ? ', CKDIV8' : ''}, ${speed}; boot ${d.bootBytes} B; BOD ${d.bod}`;
}

/** Flip one fuse bit (mask) in a byte. Returns the new byte. */
export function toggleFuseBit(value, mask) {
  return ((value & 0xff) ^ (mask & 0xff)) & 0xff;
}

/** Parse a hex byte typed by the user ("0x62", "62"). NaN when invalid. */
export function parseHexByte(text) {
  const s = String(text ?? '').trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,2}$/i.test(s)) return NaN;
  return parseInt(s, 16);
}

// avrdude -p ids, only for parts whose id is certain.
const AVRDUDE_IDS = {
  ATtiny13A: 't13', ATtiny25: 't25', ATtiny45: 't45', ATtiny85: 't85', ATtiny24: 't24', ATtiny44: 't44', ATtiny84: 't84',
  ATtiny261: 't261', ATtiny461: 't461', ATtiny861: 't861', ATtiny2313: 't2313', ATtiny4313: 't4313',
  ATtiny48: 't48', ATtiny88: 't88', ATtiny87: 't87', ATtiny167: 't167', ATtiny1634: 't1634',
  ATmega8: 'm8', ATmega8515: 'm8515', ATmega8535: 'm8535', ATmega16: 'm16', ATmega32: 'm32', ATmega64: 'm64', ATmega128: 'm128', ATmega162: 'm162',
  ATmega48: 'm48', ATmega48P: 'm48p', ATmega48PB: 'm48pb', ATmega88: 'm88', ATmega88P: 'm88p', ATmega88PB: 'm88pb',
  ATmega168: 'm168', ATmega168P: 'm168p', ATmega168PB: 'm168pb', ATmega328: 'm328', ATmega328P: 'm328p', ATmega328PB: 'm328pb',
  ATmega164P: 'm164p', ATmega324P: 'm324p', ATmega324PA: 'm324pa', ATmega644P: 'm644p', ATmega1284P: 'm1284p',
  ATmega640: 'm640', ATmega1280: 'm1280', ATmega1281: 'm1281', ATmega2560: 'm2560', ATmega2561: 'm2561',
  ATmega8U2: 'm8u2', ATmega16U2: 'm16u2', ATmega32U2: 'm32u2', ATmega16U4: 'm16u4', ATmega32U4: 'm32u4'
};

export function avrdudePartId(chip) {
  return (chip && AVRDUDE_IDS[chip.name]) || null;
}

const q = (s) => (/^[\w.\-/\\:]+$/.test(s) ? s : `"${String(s).replace(/"/g, '')}"`);
const hb = (n) => `0x${(n & 0xff).toString(16).padStart(2, '0').toUpperCase()}`;

/**
 * avrdude command lines equivalent to what the workbench does. These are
 * exported text for the CLI tool, not something the browser runs.
 * The programmer is an STK500v1 ArduinoISP at 19200 baud; the port is a placeholder.
 */
export function avrdudeCommands({ chip, fuses, image, port = '<port>' }) {
  const id = avrdudePartId(chip);
  if (!id) return [];
  const base = `avrdude -c stk500v1 -P ${port} -b 19200 -p ${id}`;
  const out = [{ label: 'Read signature and fuses', cmd: `${base} -v` }];
  if (fuses) {
    const parts = [`-U lfuse:w:${hb(fuses.lfuse)}:m`, `-U hfuse:w:${hb(fuses.hfuse)}:m`];
    if (!chip.noEfuse) parts.push(`-U efuse:w:${hb(fuses.efuse)}:m`);
    out.push({ label: 'Write fuses (L/H/E)', cmd: `${base} ${parts.join(' ')}` });
  }
  if (image?.name) {
    out.push({ label: 'Erase, write and verify flash', cmd: `${base} -U flash:w:${q(image.name)}:i` });
  }
  out.push({ label: 'Read flash to file', cmd: `${base} -U flash:r:flash.hex:i` });
  out.push({ label: 'Read EEPROM to file', cmd: `${base} -U eeprom:r:eeprom.hex:i` });
  return out;
}

/** avrdude line for a bootloader upload (-c arduino). */
export function avrdudeBootloaderCommand({ partId, baud, imageName, port = '<port>' }) {
  if (!partId || !imageName) return '';
  return `avrdude -c arduino -P ${port} -b ${baud} -p ${partId} -D -U flash:w:${q(imageName)}:i`;
}

/** Share of the chip's flash that the image occupies, or null when unknown. */
export function imageFit(image, chip) {
  if (!image || !chip?.flashSize) return null;
  const end = image.startAddress + image.data.length;
  return { end, percent: Math.round((end / chip.flashSize) * 1000) / 10, fits: end <= chip.flashSize };
}
