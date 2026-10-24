/**
 * magic.js
 * "Magic" Heuristic & Auto-Detection Engine v2
 * Multi-step recipe chaining up to depth limit (depth <= 3), Shannon Entropy diagnostics,
 * forensic magic bytes detection, and printable ASCII ratio scoring.
 */

import { Dish } from './core/Dish.js';
import { ungzip as ungzipFn } from 'pako';

/**
 * Calculates Shannon Entropy (0 to 8 bits per byte).
 * Values > 7.2 indicate compressed or encrypted data.
 * Plain English text is typically 3.5 - 4.8.
 * @param {string|ArrayBuffer|Uint8Array|Dish} input
 * @returns {number}
 */
export function calculateEntropy(input) {
  let uint8;
  if (input instanceof Dish) {
    uint8 = input.toUint8Array();
  } else if (input instanceof Uint8Array) {
    uint8 = input;
  } else if (input instanceof ArrayBuffer) {
    uint8 = new Uint8Array(input);
  } else {
    uint8 = new TextEncoder().encode(String(input || ''));
  }

  const len = uint8.length;
  if (len === 0) return 0;

  const freq = new Array(256).fill(0);
  for (let i = 0; i < len; i++) {
    freq[uint8[i]]++;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] > 0) {
      const p = freq[i] / len;
      entropy -= p * Math.log2(p);
    }
  }

  return Number(entropy.toFixed(4));
}

/**
 * Calculates printable ASCII ratio (0.0 to 1.0)
 * Printable characters: ASCII 32-126 plus Tab (9), LF (10), CR (13).
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function calculatePrintableRatio(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  let printableCount = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) {
      printableCount++;
    }
  }
  return printableCount / bytes.length;
}

/**
 * Checks for known binary file format magic headers
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
export function detectMagicBytes(bytes) {
  if (!bytes || bytes.length < 2) return null;

  // Gzip: 1F 8B
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'Gzip';
  // ZIP: 50 4B 03 04 or 50 4B
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'ZIP';
  // PDF: %PDF (25 50 44 46)
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'PDF';
  // PNG: 89 50 4E 47
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'PNG';
  // ELF: 7F 45 4C 46
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return 'ELF Binary';
  // Windows PE: 4D 5A
  if (bytes[0] === 0x4d && bytes[1] === 0x5a) return 'PE / MZ Executable';
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'JPEG Image';

  return null;
}

/**
 * Checks if decoded text contains recognizable English/source code constructs
 * @param {string} text
 * @returns {number} Boost score (0.0 to 0.25)
 */
function scoreTextStructure(text) {
  if (!text || text.length < 4) return 0;
  let boost = 0;
  const lower = text.toLowerCase();

  // Common keywords & indicators
  const indicators = ['http://', 'https://', '{"', '":', '<html', '<?xml', 'select ', 'from ', 'user', 'token', 'password', 'key', 'error', 'the ', 'and ', 'that ', 'with '];
  for (const ind of indicators) {
    if (lower.includes(ind)) boost += 0.05;
  }
  return Math.min(0.25, boost);
}

/**
 * Executes a single heuristic transformation on a Dish
 * @param {Dish} dish
 * @param {string} opName
 * @returns {Dish|null}
 */
function attemptStep(dish, opName) {
  try {
    if (opName === 'From Base64') {
      const clean = dish.toString().trim().replace(/\s+/g, '');
      if (/^[A-Za-z0-9+/=]{4,}$/.test(clean) && clean.length % 4 === 0) {
        return Dish.fromBase64(clean);
      }
    } else if (opName === 'From Hex') {
      const clean = dish.toString().trim().replace(/0x|[\s,:-]/g, '');
      if (/^[0-9a-fA-F]{4,}$/.test(clean) && clean.length % 2 === 0) {
        return Dish.fromHex(clean);
      }
    } else if (opName === 'Gunzip') {
      const decompressed = ungzipFn(dish.toUint8Array());
      try {
        const str = new TextDecoder('utf-8', { fatal: true }).decode(decompressed);
        return new Dish(str, 'string');
      } catch {
        return new Dish(decompressed.buffer, 'ArrayBuffer');
      }
    } else if (opName === 'URL Decode') {
      const str = dish.toString();
      if (/%[0-9a-fA-F]{2}/.test(str)) {
        const decoded = decodeURIComponent(str);
        if (decoded !== str) return new Dish(decoded, 'string');
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Analyzes input and generates ranked candidate operations with multi-step chaining.
 * @param {string|ArrayBuffer|Dish} input
 * @param {Object} [options={}] - { maxDepth = 3 }
 * @returns {Object}
 */
export function magic(input, { maxDepth = 3 } = {}) {
  const initialDish = input instanceof Dish ? input : new Dish(input);
  const rawBytes = initialDish.toUint8Array();
  const rawStr = initialDish.toString();
  const trimmedStr = rawStr.trim();
  const inputEntropy = calculateEntropy(rawBytes);
  const inputPrintable = calculatePrintableRatio(rawBytes);
  const detectedHeader = detectMagicBytes(rawBytes);

  const suggestions = [];
  const visited = new Set();
  const maxSearchDepth = Math.max(1, Math.min(4, Number(maxDepth) || 3));

  // 1. Direct JWT Check
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmedStr)) {
    try {
      const headerB64 = atob(trimmedStr.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'));
      if (headerB64.includes('"alg"')) {
        suggestions.push({
          op: 'Parse JWT',
          confidence: 0.98,
          reason: 'Valid RFC 7519 JSON Web Token structure.',
          preview: headerB64,
          recipe: [{ op: 'Parse JWT', args: {} }]
        });
      }
    } catch {}
  }

  // 2. Direct Gzip / Magic Header Check
  if (detectedHeader === 'Gzip') {
    try {
      const decomp = ungzipFn(rawBytes);
      const text = new TextDecoder('utf-8', { fatal: false }).decode(decomp);
      suggestions.push({
        op: 'Gunzip',
        confidence: 0.99,
        reason: 'Detected RFC 1952 Gzip magic bytes (1F 8B).',
        preview: text.slice(0, 100),
        recipe: [{ op: 'Gunzip', args: {} }]
      });
    } catch {
      suggestions.push({
        op: 'Gunzip',
        confidence: 0.85,
        reason: 'Detected Gzip magic bytes header.',
        preview: '[Compressed Binary]',
        recipe: [{ op: 'Gunzip', args: {} }]
      });
    }
  }

  // 3. Multi-Step Chaining Exploration (BFS)
  const candidateOps = ['From Base64', 'From Hex', 'URL Decode', 'Gunzip'];
  const queue = [{
    dish: initialDish,
    recipe: [],
    depth: 0
  }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current.depth >= maxSearchDepth) continue;

    for (const opName of candidateOps) {
      // Avoid immediate redundant repeats
      if (current.recipe.length > 0 && current.recipe[current.recipe.length - 1].op === opName) {
        continue;
      }

      const nextDish = attemptStep(current.dish, opName);
      if (!nextDish) continue;

      const nextBytes = nextDish.toUint8Array();
      const sigKey = `${opName}_${nextBytes.length}_${nextBytes.slice(0, 8).join(',')}`;
      if (visited.has(sigKey)) continue;
      visited.add(sigKey);

      const nextRecipe = [...current.recipe, { op: opName, args: {} }];
      const nextPrintable = calculatePrintableRatio(nextBytes);
      const nextMagic = detectMagicBytes(nextBytes);
      const nextText = nextDish.toString();

      // Check if intermediate result is Gzip stream: trigger Gunzip next step
      if (nextMagic === 'Gzip') {
        try {
          const decomp = ungzipFn(nextBytes);
          const decompText = new TextDecoder('utf-8', { fatal: false }).decode(decomp);
          const chainedRecipe = [...nextRecipe, { op: 'Gunzip', args: {} }];
          suggestions.push({
            op: chainedRecipe.map(r => r.op).join(' + '),
            confidence: 0.98,
            reason: `${nextRecipe.map(r => r.op).join(' + ')} yields Gzip compressed payload.`,
            preview: decompText.slice(0, 100),
            recipe: chainedRecipe
          });
        } catch {}
      }

      // Check if printable ASCII ratio improved noticeably
      const structureBoost = scoreTextStructure(nextText);
      const confidence = Math.min(0.95, nextPrintable * 0.75 + structureBoost + 0.1);

      if (nextPrintable > 0.70 && nextText.length >= 2) {
        suggestions.push({
          op: nextRecipe.map(r => r.op).join(' + '),
          confidence: Number(confidence.toFixed(2)),
          reason: `Transforms input to ${Math.round(nextPrintable * 100)}% printable ASCII text.`,
          preview: nextText.slice(0, 100),
          recipe: nextRecipe
        });
      }

      // Enqueue for further chaining if below maxSearchDepth
      if (current.depth + 1 < maxSearchDepth) {
        queue.push({
          dish: nextDish,
          recipe: nextRecipe,
          depth: current.depth + 1
        });
      }
    }
  }

  // 4. JSON Detection
  if ((trimmedStr.startsWith('{') && trimmedStr.endsWith('}')) || (trimmedStr.startsWith('[') && trimmedStr.endsWith(']'))) {
    try {
      const obj = JSON.parse(trimmedStr);
      if (obj && typeof obj === 'object') {
        suggestions.push({
          op: 'JSON Beautify',
          confidence: 0.85,
          reason: 'Valid JSON string detected.',
          preview: JSON.stringify(obj).slice(0, 80),
          recipe: [{ op: 'JSON Beautify', args: { indent: 2 } }]
        });
      }
    } catch {}
  }

  // De-duplicate suggestions by recipe signature
  const seenRecipes = new Set();
  const uniqueSuggestions = [];
  for (const s of suggestions) {
    const key = s.recipe.map(r => r.op).join('->');
    if (!seenRecipes.has(key)) {
      seenRecipes.add(key);
      uniqueSuggestions.push(s);
    }
  }

  uniqueSuggestions.sort((a, b) => b.confidence - a.confidence);

  return {
    entropy: inputEntropy,
    isEncryptedOrCompressed: inputEntropy > 7.2,
    magicBytes: detectedHeader,
    printableRatio: Number(inputPrintable.toFixed(4)),
    suggestions: uniqueSuggestions,
    bestMatch: uniqueSuggestions.length > 0 && uniqueSuggestions[0].confidence >= 0.5 ? uniqueSuggestions[0] : null
  };
}

export default magic;
