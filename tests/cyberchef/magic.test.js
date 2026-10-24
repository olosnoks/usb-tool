import { describe, it, expect } from 'vitest';
import { magic, calculateEntropy, detectMagicBytes } from '../../src/utils/cyberchef/magic.js';
import { gzip as gzipFn } from 'pako';

describe('CyberChef Magic Heuristic Engine (magic.test.js)', () => {
  describe('Shannon Entropy Calculation', () => {
    it('calculates 0 entropy for uniform single-byte strings', () => {
      const entropy = calculateEntropy('AAAAAAAAAAAAAAA');
      expect(entropy).toBe(0);
    });

    it('calculates realistic entropy for natural language text', () => {
      const text = 'The quick brown fox jumps over the lazy dog and explores cybersecurity protocols.';
      const entropy = calculateEntropy(text);
      expect(entropy).toBeGreaterThan(3.5);
      expect(entropy).toBeLessThan(5.5);
    });

    it('identifies high entropy on pseudo-random or compressed data', () => {
      const randomBytes = new Uint8Array(512);
      for (let i = 0; i < randomBytes.length; i++) {
        randomBytes[i] = Math.floor(Math.random() * 256);
      }
      const entropy = calculateEntropy(randomBytes);
      expect(entropy).toBeGreaterThan(7.0);
    });
  });

  describe('Magic Bytes Detection', () => {
    it('detects Gzip magic bytes (1F 8B)', () => {
      const gzipHeader = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
      expect(detectMagicBytes(gzipHeader)).toBe('Gzip');
    });

    it('detects ZIP magic bytes (50 4B 03 04)', () => {
      const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
      expect(detectMagicBytes(zipHeader)).toBe('ZIP');
    });

    it('returns null for generic strings', () => {
      const text = new TextEncoder().encode('Hello World');
      expect(detectMagicBytes(text)).toBeNull();
    });
  });

  describe('Heuristic Magic Decoder Suggestions', () => {
    it('detects Base64 inputs and suggests From Base64 recipe', () => {
      // Base64 encoding of "CyberChef Enterprise Data Pipeline"
      const b64 = 'Q3liZXJDaGVmIEVudGVycHJpc2UgRGF0YSBQaXBlbGluZQ==';
      const result = magic(b64);

      expect(result.suggestions.length).toBeGreaterThan(0);
      const b64Suggestion = result.suggestions.find(s => s.op === 'From Base64');
      expect(b64Suggestion).toBeDefined();
      expect(b64Suggestion.confidence).toBeGreaterThanOrEqual(0.7);
      expect(result.bestMatch).not.toBeNull();
      expect(result.bestMatch.op).toBe('From Base64');
    });

    it('detects raw Gzip buffer and suggests Gunzip recipe', () => {
      const originalText = 'Highly compressable repetitive data string for testing gzip magic heuristics.';
      const compressed = gzipFn(new TextEncoder().encode(originalText));
      const result = magic(compressed.buffer);

      expect(result.magicBytes).toBe('Gzip');
      expect(result.suggestions.length).toBeGreaterThan(0);
      const gzipSuggestion = result.suggestions.find(s => s.op === 'Gunzip');
      expect(gzipSuggestion).toBeDefined();
      expect(gzipSuggestion.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('detects Base64-wrapped Gzip and suggests multi-step From Base64 + Gunzip', () => {
      const plain = 'Hidden secret credentials and token inside compressed gzip';
      const compressed = gzipFn(new TextEncoder().encode(plain));

      let bin = '';
      for (let i = 0; i < compressed.length; i++) bin += String.fromCharCode(compressed[i]);
      const base64Gzip = btoa(bin);

      const result = magic(base64Gzip);
      expect(result.suggestions.length).toBeGreaterThan(0);

      const combo = result.suggestions.find(s => s.op === 'From Base64 + Gunzip');
      expect(combo).toBeDefined();
      expect(combo.recipe.length).toBe(2);
      expect(combo.recipe[0].op).toBe('From Base64');
      expect(combo.recipe[1].op).toBe('Gunzip');
      expect(result.bestMatch.op).toBe('From Base64 + Gunzip');
    });

    it('detects Hex strings and suggests From Hex', () => {
      const hex = '48 65 6c 6c 6f 20 57 6f 72 6c 64';
      const result = magic(hex);

      expect(result.suggestions.length).toBeGreaterThan(0);
      const hexMatch = result.suggestions.find(s => s.op === 'From Hex');
      expect(hexMatch).toBeDefined();
      expect(hexMatch.confidence).toBeGreaterThan(0.7);
    });

    it('detects JWT tokens and suggests Parse JWT', () => {
      // Standard dummy JWT
      const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const result = magic(jwt);

      expect(result.suggestions.length).toBeGreaterThan(0);
      const jwtMatch = result.suggestions.find(s => s.op === 'Parse JWT');
      expect(jwtMatch).toBeDefined();
      expect(jwtMatch.confidence).toBeGreaterThanOrEqual(0.9);
    });
  });
});
