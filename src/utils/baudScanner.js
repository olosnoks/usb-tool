/**
 * Baud Rate Hunter & Signal Entropy Analyzer
 * Scans standard baud rates, calculates ASCII printable ratio & Shannon Entropy
 */

export const CANDIDATE_BAUD_RATES = [
  9600,
  19200,
  38400,
  57600,
  74880,   // Common ESP8266 / ESP32 boot ROM clock
  115200,  // Standard embedded default
  230400,
  460800,
  921600
];

/**
 * Calculates Shannon Entropy of a byte buffer
 * H(X) = -sum(p(x) * log2(p(x)))
 * Output range: 0.0 (all identical bytes) to 8.0 (completely random noise)
 * Natural text typically sits between 3.5 and 5.2.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function calculateShannonEntropy(bytes) {
  if (!bytes || bytes.length === 0) return 0;

  const frequencies = new Map();
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    frequencies.set(b, (frequencies.get(b) || 0) + 1);
  }

  let entropy = 0;
  const len = bytes.length;
  for (const count of frequencies.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return Number(entropy.toFixed(3));
}

/**
 * Calculates the percentage of printable ASCII characters (including CR, LF, TAB)
 * @param {Uint8Array} bytes
 * @returns {number} 0 to 100
 */
export function calculatePrintableRatio(bytes) {
  if (!bytes || bytes.length === 0) return 0;

  let printableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // 0x20 to 0x7E are printable ASCII; 0x09 (TAB), 0x0A (LF), 0x0D (CR) are valid whitespace
    if ((b >= 0x20 && b <= 0x7e) || b === 0x09 || b === 0x0a || b === 0x0d) {
      printableCount++;
    }
  }

  return Number(((printableCount / bytes.length) * 100).toFixed(1));
}

/**
 * Evaluates the confidence score that a given sample corresponds to valid serial communication
 * @param {Uint8Array} bytes
 * @returns {{ confidence: number, printableRatio: number, entropy: number, verdict: string, previewText: string }}
 */
export function evaluateSample(bytes) {
  if (!bytes || bytes.length === 0) {
    return {
      confidence: 0,
      printableRatio: 0,
      entropy: 0,
      verdict: 'NO DATA',
      previewText: ''
    };
  }

  const printableRatio = calculatePrintableRatio(bytes);
  const entropy = calculateShannonEntropy(bytes);

  // Confidence heuristic:
  // Legitimate text / log streams typically have >70% printable characters
  // and entropy between 3.0 and 6.0 bits.
  let confidence = 0;

  if (printableRatio >= 85) {
    confidence += 65;
  } else if (printableRatio >= 60) {
    confidence += 45;
  } else if (printableRatio >= 30) {
    confidence += 20;
  }

  // Realistic text entropy reward
  if (entropy >= 3.0 && entropy <= 5.8) {
    confidence += 25;
  } else if (entropy >= 2.0 && entropy <= 6.5) {
    confidence += 10;
  }

  // Penalty if almost all 0x00 or 0xFF (common floating UART pin noise)
  let nullOrMax = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x00 || bytes[i] === 0xff) nullOrMax++;
  }
  if (nullOrMax / bytes.length > 0.5) {
    confidence = Math.max(0, confidence - 40);
  }

  // Ensure 0-100 clamp
  confidence = Math.min(100, Math.max(0, confidence));

  let verdict = 'UNLIKELY';
  if (confidence >= 80) verdict = 'HIGH PROBABILITY';
  else if (confidence >= 50) verdict = 'MODERATE';
  else if (confidence > 20) verdict = 'LOW';

  // Generate ASCII preview
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let previewText = decoder.decode(bytes).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '.');
  if (previewText.length > 60) {
    previewText = previewText.substring(0, 60) + '...';
  }

  return {
    confidence,
    printableRatio,
    entropy,
    verdict,
    previewText
  };
}
