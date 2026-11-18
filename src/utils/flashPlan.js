/**
 * Pure helpers for the Firmware Flasher: ESP image header inspection, pre-flash
 * layout checks (overlap / sector alignment / expected magic) and an esptool
 * command-line export. Nothing here touches hardware.
 */

export const SECTOR_SIZE = 0x1000;

const FLASH_MODES = ['QIO', 'QOUT', 'DIO', 'DOUT'];
// Header byte 3 high nibble (same encoding across the ESP32 family).
const FLASH_SIZES = { 0: 1, 1: 2, 2: 4, 3: 8, 4: 16, 5: 32, 6: 64, 7: 128 };
// Extended header chip id (u16 at byte 12).
const CHIP_IDS = {
  0x0000: 'ESP32', 0x0002: 'ESP32-S2', 0x0005: 'ESP32-C3', 0x0009: 'ESP32-S3',
  0x000c: 'ESP32-C2', 0x000d: 'ESP32-C6', 0x0010: 'ESP32-H2'
};

const hex = (n) => `0x${n.toString(16)}`;

/**
 * Inspect the first bytes of an image. Returns null if it is not an ESP image
 * (first byte not 0xE9) so callers can tell "no header" from "header found".
 */
export function parseEspImageHeader(data) {
  if (!data || data.length < 16 || data[0] !== 0xe9) return null;
  const segments = data[1];
  const flashModeCode = data[2];
  const sizeCode = data[3] >> 4;
  const chipId = data[12] | (data[13] << 8);
  const looksExtended = segments > 0 && segments <= 16 && chipId in CHIP_IDS && data[14] <= 0x10;
  return {
    segments,
    flashMode: FLASH_MODES[flashModeCode] || `code ${flashModeCode}`,
    flashSizeMB: looksExtended ? (FLASH_SIZES[sizeCode] ?? null) : null,
    flashSizeCode: sizeCode,
    entry: (data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24)) >>> 0,
    chip: looksExtended ? CHIP_IDS[chipId] : null
  };
}

/** True when the data looks like an ESP-IDF partition table (0xAA 0x50 entries). */
export function isPartitionTable(data) {
  return !!data && data.length >= 2 && data[0] === 0xaa && data[1] === 0x50;
}

/** One-line description of an image's header, or null. */
export function describeImage(data) {
  const h = parseEspImageHeader(data);
  if (h) {
    const parts = [h.chip ? `${h.chip} image` : 'ESP image', `${h.segments} seg`, h.flashMode];
    if (h.flashSizeMB) parts.push(`${h.flashSizeMB} MB flash`);
    return parts.join(', ');
  }
  if (isPartitionTable(data)) return 'ESP-IDF partition table';
  return null;
}

/**
 * Check the enabled slots for problems before flashing.
 * @param {Array<{label:string, offset:number|null, size:number}>} items numeric offsets (null = invalid)
 * @param {Array<Uint8Array>} [datas] file bytes per item, for magic checks
 * @returns {Array<{level:'error'|'warn'|'info', slot:number, message:string}>}
 */
export function checkLayout(items, datas = []) {
  const out = [];
  items.forEach((it, i) => {
    if (it.offset === null) {
      out.push({ level: 'error', slot: i, message: `${it.label}: offset is not valid hex.` });
      return;
    }
    if (it.offset % SECTOR_SIZE !== 0) {
      out.push({ level: 'warn', slot: i, message: `${it.label}: offset ${hex(it.offset)} is not 4 KB aligned; the chip erases whole 4 KB sectors, so neighbouring data would be erased too.` });
    }
    const data = datas[i];
    if (data && data.length) {
      if (it.offset === 0x8000 && !isPartitionTable(data)) {
        out.push({ level: 'warn', slot: i, message: `${it.label}: 0x8000 normally holds the partition table (starts AA 50) but this file does not.` });
      }
      if ((it.offset === 0x10000 || it.offset === 0x1000) && data[0] !== 0xe9) {
        out.push({ level: 'warn', slot: i, message: `${it.label}: an ESP bootloader or app image starts with byte E9, but this file starts with ${data[0].toString(16).toUpperCase().padStart(2, '0')}.` });
      }
      if (it.offset === 0 && data.length > 0x8002 && data[0x8000] === 0xaa && data[0x8001] === 0x50) {
        out.push({ level: 'info', slot: i, message: `${it.label}: looks like a merged image (partition table at 0x8000 inside the file); 0x0 is the right offset.` });
      }
    }
  });
  const valid = items.map((it, i) => ({ ...it, i })).filter(it => it.offset !== null && it.size > 0);
  for (let a = 0; a < valid.length; a++) {
    for (let b = a + 1; b < valid.length; b++) {
      const A = valid[a];
      const B = valid[b];
      if (A.offset < B.offset + B.size && B.offset < A.offset + A.size) {
        out.push({ level: 'error', slot: B.i, message: `${A.label} and ${B.label} overlap (${hex(Math.max(A.offset, B.offset))} to ${hex(Math.min(A.offset + A.size, B.offset + B.size))}); the later write would destroy the earlier one.` });
      }
    }
  }
  return out;
}

function shellQuote(s) {
  return /^[A-Za-z0-9_./:\\-]+$/.test(s) ? s : '"' + String(s).replace(/(["\\$`])/g, '\\$1') + '"';
}

/**
 * Build an esptool command line equivalent to the current slot list.
 * This is an export for the CLI tool; the browser flasher does not run it.
 */
export function buildEsptoolCommand(items, { baud = 460800, compress = true, port = 'COM3' } = {}) {
  const files = items.filter(it => it.offset !== null && it.name);
  if (!files.length) return '';
  const args = ['esptool.py', '--port', port, '--baud', String(baud), 'write_flash'];
  if (!compress) args.push('--no-compress');
  for (const f of files) args.push(hex(f.offset), shellQuote(f.name));
  return args.join(' ');
}
