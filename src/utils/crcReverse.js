/**
 * CRC reverse-engineering & checksum catalogue: public API for the workbench and tests.
 * Everything runs offline. Parameters come from the RevEng catalogue (see crcReverse/catalogue.js).
 */
import { parseHexInput } from './checksums.js';
import { CRC_CATALOGUE, CRC_ALIASES, findCrcModel } from './crcReverse/catalogue.js';
import { crcOf, hexOf } from './crcReverse/engine.js';
import { SIMPLE_SUMS } from './crcReverse/sums.js';

export { CRC_CATALOGUE, CRC_ALIASES, findCrcModel, SIMPLE_SUMS };
export { reverseCrc, locateCrc, revengString, solveInitXorout, KNOWN_POLYS_32 } from './crcReverse/solver.js';
export { crcOf, crcNum, crcBig, residueOf, hexOf } from './crcReverse/engine.js';

/**
 * Bytes from user text.
 * @param {string} text
 * @param {'hex'|'ascii'} mode
 */
export function bytesFromInput(text, mode = 'hex') {
  if (mode === 'ascii') return new TextEncoder().encode(String(text ?? ''));
  return parseHexInput(String(text ?? ''));
}

/** Integer value of big-endian bytes (empty input gives 0n). */
export function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/**
 * Parse one sample per line.
 *  - 'tail': the line is a whole frame; its last `tailBytes` bytes are the stored checksum.
 *  - 'separate': the line is `payloadHex:checksumHex`.
 * @returns {{samples: Array<{payload: Uint8Array, checksum: Uint8Array, line: number}>, errors: string[]}}
 */
export function parseSampleText(text, { layout = 'tail', tailBytes = 2 } = {}) {
  const samples = [];
  const errors = [];
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  lines.forEach((line, i) => {
    try {
      if (layout === 'separate') {
        const parts = line.split(':');
        if (parts.length !== 2) throw new Error('expected payload:checksum');
        const payload = parseHexInput(parts[0]);
        const checksum = parseHexInput(parts[1]);
        if (!payload.length) throw new Error('empty payload');
        if (!checksum.length) throw new Error('empty checksum');
        samples.push({ payload, checksum, line: i + 1 });
      } else {
        const frame = parseHexInput(line);
        if (frame.length <= tailBytes) throw new Error(`frame is ${frame.length} byte(s), needs more than ${tailBytes}`);
        const cut = frame.length - tailBytes;
        samples.push({ payload: frame.slice(0, cut), checksum: frame.slice(cut), line: i + 1 });
      }
    } catch (e) {
      errors.push(`line ${i + 1}: ${e.message}`);
    }
  });
  const sizes = new Set(samples.map((s) => s.checksum.length));
  if (sizes.size > 1) errors.push('The checksum field must be the same length in every sample.');
  return { samples, errors };
}

/**
 * Every catalogue CRC and simple sum of `bytes`.
 * @returns {Array<{family: 'CRC'|'Sum', name: string, width: number, value: bigint, hex: string}>}
 */
export function allChecksums(bytes) {
  const out = [];
  for (const m of CRC_CATALOGUE) {
    const value = crcOf(bytes, m);
    out.push({ family: 'CRC', name: m.name, width: m.width, value, hex: hexOf(value, m.width) });
  }
  for (const s of SIMPLE_SUMS) {
    const value = BigInt(s.fn(bytes));
    out.push({ family: 'Sum', name: s.name, width: s.width, value, hex: hexOf(value, s.width) });
  }
  return out;
}

/**
 * Filter a checksum list to the entries whose value equals `expectedText` (hex, read as a big-endian integer).
 * @returns {{expected: bigint|null, matches: Array}}
 */
export function matchExpected(list, expectedText) {
  const bytes = parseHexInput(String(expectedText ?? '').trim());
  if (!bytes.length) return { expected: null, matches: [] };
  const expected = bytesToBigInt(bytes);
  return { expected, matches: list.filter((c) => c.value === expected) };
}
