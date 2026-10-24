/**
 * analytics.js
 * Visual Analytics & Telemetry Engine for CyberChef
 * Computes rolling Shannon Entropy series, 256-bin byte frequency distributions,
 * and structural data metrics.
 */

import { Dish } from './core/Dish.js';
import { calculateEntropy } from './magic.js';

export { calculateEntropy };

/**
 * Normalizes any input into a Uint8Array.
 * @param {string|ArrayBuffer|Uint8Array|Dish} input
 * @returns {Uint8Array}
 */
export function toUint8Array(input) {
  if (!input) return new Uint8Array(0);
  if (input instanceof Dish) return input.toUint8Array();
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof input === 'string') return new TextEncoder().encode(input);
  return new Uint8Array(0);
}

/**
 * Calculates rolling Shannon Entropy across consecutive blocks.
 * @param {string|ArrayBuffer|Uint8Array|Dish} input
 * @param {number} [blockSize=256]
 * @returns {Array<{offset: number, length: number, entropy: number}>}
 */
export function calculateRollingEntropy(input, blockSize = 256) {
  const bytes = toUint8Array(input);
  const total = bytes.length;
  if (total === 0) return [];

  // For payloads smaller than or equal to block size, return single block
  if (total <= blockSize) {
    return [{
      offset: 0,
      length: total,
      entropy: calculateEntropy(bytes)
    }];
  }

  const blocks = [];
  for (let offset = 0; offset < total; offset += blockSize) {
    const end = Math.min(offset + blockSize, total);
    const slice = bytes.subarray(offset, end);
    const entropy = calculateEntropy(slice);
    blocks.push({
      offset,
      length: end - offset,
      entropy
    });
  }

  return blocks;
}

/**
 * Categorizes a single byte.
 * @param {number} b - Byte value (0-255)
 * @returns {'null'|'control'|'printable'|'high'}
 */
export function classifyByte(b) {
  if (b === 0) return 'null';
  if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) return 'printable';
  if (b < 32 || b === 127) return 'control';
  return 'high';
}


/**
 * Calculates 256-bin byte frequencies and percentages.
 * @param {string|ArrayBuffer|Uint8Array|Dish} input
 * @returns {Array<{byte: number, hex: string, char: string, count: number, percent: number, type: string}>}
 */
export function calculateByteFrequencies(input) {
  const bytes = toUint8Array(input);
  const total = bytes.length;
  const counts = new Array(256).fill(0);

  for (let i = 0; i < total; i++) {
    counts[bytes[i]]++;
  }

  return counts.map((count, byte) => {
    const percent = total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0;
    const type = classifyByte(byte);
    let char = '.';
    if (type === 'printable') {
      if (byte === 32) char = 'SP';
      else if (byte === 9) char = '\\t';
      else if (byte === 10) char = '\\n';
      else if (byte === 13) char = '\\r';
      else char = String.fromCharCode(byte);
    }
    return {
      byte,
      hex: byte.toString(16).padStart(2, '0').toUpperCase(),
      char,
      count,
      percent,
      type
    };
  });
}

/**
 * Calculates comprehensive statistical analytics for a given payload.
 * @param {string|ArrayBuffer|Uint8Array|Dish} input
 * @returns {Object}
 */
export function calculateAnalyticsSummary(input) {
  const bytes = toUint8Array(input);
  const total = bytes.length;
  if (total === 0) {
    return {
      totalBytes: 0,
      meanEntropy: 0,
      minEntropy: 0,
      maxEntropy: 0,
      printableRatio: 0,
      nullRatio: 0,
      highRatio: 0,
      topBytes: []
    };
  }

  const rolling = calculateRollingEntropy(bytes, 256);
  const frequencies = calculateByteFrequencies(bytes);

  const entropies = rolling.map(r => r.entropy);
  const minEntropy = entropies.length ? Math.min(...entropies) : 0;
  const maxEntropy = entropies.length ? Math.max(...entropies) : 0;
  const meanEntropy = entropies.length
    ? Number((entropies.reduce((a, b) => a + b, 0) / entropies.length).toFixed(4))
    : calculateEntropy(bytes);

  let printableCount = 0;
  let nullCount = 0;
  let highCount = 0;

  for (let i = 0; i < total; i++) {
    const b = bytes[i];
    if (b === 0) nullCount++;
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) printableCount++;
    if (b >= 128) highCount++;
  }

  const topBytes = [...frequencies]
    .filter(f => f.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    totalBytes: total,
    meanEntropy,
    minEntropy,
    maxEntropy,
    printableRatio: Number((printableCount / total).toFixed(4)),
    nullRatio: Number((nullCount / total).toFixed(4)),
    highRatio: Number((highCount / total).toFixed(4)),
    topBytes
  };
}
