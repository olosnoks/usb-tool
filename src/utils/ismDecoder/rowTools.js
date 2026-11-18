/**
 * Helpers for working with sliced bit rows and pulse lists (URH / inspectrum style):
 * rtl_433 flex spec text, pulse CSV, repeat grouping, per-bit difference mask,
 * checksum hints and cursor measurements. Pure functions, no hardware.
 */
import { bitsToBytes, bitsToHex, crc8, sumBytes } from './devices.js';

/**
 * rtl_433 flex decoder spec (`-X`) built from the analyzer guess. It is an export for the
 * rtl_433 command line, not something this app runs. Returns null when there is no guess.
 */
export function flexSpec(guess, segments = [], name = 'ism-capture') {
  if (!guess) return null;
  const r = (v) => Math.round(v);
  const gaps = segments.map((s) => s.gapUs).filter((g) => g > 0 && g < (guess.resetUs || 20000));
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  const reset = guess.resetUs || 0;
  if (guess.modulation === 'pwm' || guess.modulation === 'ppm') {
    const m = guess.modulation === 'pwm' ? 'OOK_PWM' : 'OOK_PPM';
    const tol = r(Math.max(20, (guess.longUs - guess.shortUs) / 4));
    const parts = [`n=${name}`, `m=${m}`, `s=${r(guess.shortUs)}`, `l=${r(guess.longUs)}`, `r=${reset || r(guess.longUs * 8)}`];
    if (maxGap) parts.push(`g=${r(maxGap * 1.2)}`);
    parts.push(`t=${tol}`);
    return `-X "${parts.join(',')}"`;
  }
  if (guess.modulation === 'manchester' && guess.halfBitUs) {
    return `-X "n=${name},m=OOK_MC_ZEROBIT,s=${r(guess.halfBitUs)},l=${r(guess.halfBitUs * 2)},r=${reset || r(guess.halfBitUs * 12)}"`;
  }
  if (guess.modulation === 'fsk-pcm' && guess.halfBitUs) {
    return `-X "n=${name},m=FSK_PCM,s=${r(guess.halfBitUs)},l=${r(guess.halfBitUs)},r=${reset || r(guess.halfBitUs * 12)}"`;
  }
  return null;
}

/** Pulse list as CSV (microseconds). */
export function segmentsToCsv(segments) {
  const lines = ['index,start_us,mark_us,gap_us'];
  segments.forEach((s, i) => {
    lines.push(`${i},${Math.round(s.startUs)},${(Math.round(s.markUs * 10) / 10)},${(Math.round(s.gapUs * 10) / 10)}`);
  });
  return lines.join('\n');
}

/** Bits as a 0/1 string. */
export function bitsToBinary(bits) {
  let s = '';
  for (let i = 0; i < bits.length; i++) s += bits[i] ? '1' : '0';
  return s;
}

/** Group rows with identical bits: [{ bits, hex, count, firstUs }] in first-seen order. */
export function groupRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = bitsToBinary(row.bits);
    const g = map.get(key);
    if (g) g.count++;
    else map.set(key, { bits: row.bits, hex: bitsToHex(row.bits), count: 1, firstUs: row.startUs });
  }
  return [...map.values()];
}

/**
 * Per-bit comparison of rows (aligned at bit 0, up to the shortest row).
 * Returns { length, constant: '0'|'1'|'x' string } where x marks a bit that differs.
 */
export function rowDiff(rows) {
  if (rows.length < 2) return null;
  const length = Math.min(...rows.map((r) => r.bits.length));
  let mask = '';
  let varying = 0;
  for (let i = 0; i < length; i++) {
    const first = rows[0].bits[i];
    let same = true;
    for (let k = 1; k < rows.length; k++) if (rows[k].bits[i] !== first) { same = false; break; }
    mask += same ? (first ? '1' : '0') : 'x';
    if (!same) varying++;
  }
  return { length, mask, varying };
}

const CRC8_POLYS = [0x07, 0x31, 0x1d, 0x9b, 0xd5, 0x2f, 0x39];

/**
 * Look for a checksum in the last byte of a row: byte sum, XOR, and CRC-8 with common
 * polynomials and init 0x00 / 0xFF. Tries the whole message minus the last byte, with
 * and without the first byte. Hints only: a match on a short row can be chance (1 in 256).
 */
export function checksumHints(bits) {
  const n = Math.floor(bits.length / 8);
  if (n < 3) return [];
  const bytes = bitsToBytes(bits, 0, n);
  const want = bytes[n - 1];
  const hints = [];
  for (const skip of [0, 1]) {
    const view = bytes.subarray(skip, n - 1);
    if (view.length < 1) continue;
    const label = skip ? 'bytes 1..n-2' : 'bytes 0..n-2';
    if (sumBytes(view, view.length) === want) hints.push(`sum8 over ${label}`);
    let x = 0;
    for (const b of view) x ^= b;
    if (x === want) hints.push(`xor8 over ${label}`);
    for (const poly of CRC8_POLYS) {
      for (const init of [0x00, 0xff]) {
        if (crc8(view, view.length, poly, init) === want) {
          hints.push(`crc8 poly 0x${poly.toString(16).padStart(2, '0')} init 0x${init.toString(16).padStart(2, '0')} over ${label}`);
        }
      }
    }
  }
  return hints;
}

/** Interval between two cursor positions in samples: { us, hz } (hz null for zero). */
export function cursorMeasure(sampleA, sampleB, sampleRate) {
  const us = (Math.abs(sampleB - sampleA) * 1e6) / sampleRate;
  return { us, hz: us > 0 ? 1e6 / us : null };
}
