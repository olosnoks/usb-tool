// Pure helpers for the CH341A programmer UI: blank check, ranged-read parsing,
// checksums and an export command for flashrom. No hardware access here.

/** Parse "0x1000", "4096" or "1000h"-less decimal/hex text. Returns NaN if invalid. */
export function parseNumber(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/_/g, '');
  if (!s) return NaN;
  if (/^0x[0-9a-f]+$/.test(s)) return parseInt(s, 16);
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return NaN;
}

/**
 * Validate a start/length pair against the chip size.
 * Returns { ok, start, length, error }.
 */
export function parseRange(startText, lengthText, chipSize) {
  const start = parseNumber(startText);
  const length = parseNumber(lengthText);
  if (Number.isNaN(start)) return { ok: false, error: 'Start must be a decimal or 0x hex number.' };
  if (Number.isNaN(length) || length < 1) return { ok: false, error: 'Length must be a positive decimal or 0x hex number.' };
  if (chipSize && start >= chipSize) return { ok: false, error: `Start is past the end of the chip (${chipSize} bytes).` };
  if (chipSize && start + length > chipSize) return { ok: false, error: `Range runs past the end of the chip (${chipSize} bytes).` };
  return { ok: true, start, length };
}

/** Blank check: erased NOR flash reads as 0xFF. */
export function blankCheck(data, { fill = 0xff } = {}) {
  let bad = 0;
  let firstBad = -1;
  for (let i = 0; i < data.length; i++) {
    if (data[i] !== fill) {
      bad++;
      if (firstBad < 0) firstBad = i;
    }
  }
  return { blank: bad === 0, nonBlankBytes: bad, firstNonBlank: firstBad, length: data.length };
}

let crcTable = null;
/** CRC-32 (IEEE 802.3, same as zlib/cksum -o3), returned as an unsigned number. */
export function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export const crc32Hex = (data) => crc32(data).toString(16).toUpperCase().padStart(8, '0');

/** SHA-256 hex via WebCrypto; null when crypto.subtle is unavailable. */
export async function sha256Hex(data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const digest = new Uint8Array(await subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Build a flashrom command line for the same job, for use on a PC with the
 * CLI installed. This is only text; the browser tool does not run flashrom.
 */
export function flashromCommand({ action = 'read', file = 'dump.bin', chip = '' } = {}) {
  const flag = { read: '-r', write: '-w', verify: '-v' }[action] || '-r';
  const safeFile = /^[\w.\-/\:]+$/.test(file) ? file : `"${file.replace(/"/g, '')}"`;
  const chipPart = chip && /^[\w.\-+/]+$/.test(chip) ? ` -c ${chip}` : '';
  return `flashrom -p ch341a_spi${chipPart} ${flag} ${safeFile}`;
}
