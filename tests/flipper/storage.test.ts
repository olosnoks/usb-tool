import { describe, it, expect } from 'vitest';
import {
  formatKb,
  formatBytes,
  normalizeSdToKb,
  normalizeIntToKb,
  formatFileSize
} from '../../src/utils/flipperDriver';

describe('Flipper Zero Storage Capacity & Unit Calculations', () => {
  describe('formatKb', () => {
    it('accurately formats gigabytes (1 GB = 1024 * 1024 KB)', () => {
      // 32 GB microSD card (~31,166,976 KB)
      expect(formatKb(31166976)).toBe('29.7 GB');
      // 16 GB microSD card (~15,583,232 KB)
      expect(formatKb(15583232)).toBe('14.9 GB');
      // Exactly 1 GB
      expect(formatKb(1024 * 1024)).toBe('1.0 GB');
    });

    it('accurately formats megabytes without dividing by 1024 a second time', () => {
      // 500 MB free space (512,000 KB) -> must be 500.0 MB, NOT 0.5 MB!
      expect(formatKb(512000)).toBe('500.0 MB');
      // 80 MB free space (81,920 KB) -> must be 80.0 MB, NOT 0.1 MB!
      expect(formatKb(81920)).toBe('80.0 MB');
      // 1.5 MB free space (1,536 KB)
      expect(formatKb(1536)).toBe('1.5 MB');
    });

    it('accurately formats kilobytes (internal flash)', () => {
      // 184 KB internal flash LittleFS
      expect(formatKb(184)).toBe('184 KB');
      // 40 KB internal flash
      expect(formatKb(40)).toBe('40 KB');
      // 0 KB
      expect(formatKb(0)).toBe('0 KB');
    });

    it('handles null, undefined, and invalid inputs gracefully', () => {
      expect(formatKb(null)).toBe('--');
      expect(formatKb(undefined)).toBe('--');
      expect(formatKb(NaN)).toBe('--');
    });
  });

  describe('formatBytes', () => {
    it('formats raw byte values from Protobuf Storage.InfoResponse accurately', () => {
      // 32 GB SD card (31,914,983,424 bytes)
      expect(formatBytes(31914983424n)).toBe('29.7 GB');
      // 16 GB SD card (16,000,000,000 bytes)
      expect(formatBytes(16000000000n)).toBe('14.9 GB');
      // 500 MB free space (524,288,000 bytes)
      expect(formatBytes(524288000n)).toBe('500.0 MB');
      // 80 MB free space (83,886,080 bytes)
      expect(formatBytes(83886080n)).toBe('80.0 MB');
      // 1.5 MB free space (1,572,864 bytes)
      expect(formatBytes(1572864n)).toBe('1.5 MB');
      // 184 KB internal flash (188,416 bytes)
      expect(formatBytes(188416n)).toBe('184.0 KB');
      // 0 bytes
      expect(formatBytes(0n)).toBe('0 B');
      expect(formatBytes(null)).toBe('--');
    });
  });

  describe('normalizeSdToKb', () => {
    it('converts raw uint64 bytes from RPC into KiB across all magnitudes', () => {
      // 32 GB in bytes (31,914,983,424 bytes)
      expect(normalizeSdToKb(31914983424n)).toBe(31166976);
      // 500 MB in bytes (524,288,000 bytes) -> must NOT be treated as already KiB!
      expect(normalizeSdToKb(524288000n)).toBe(512000);
      // 80 MB in bytes (83,886,080 bytes)
      expect(normalizeSdToKb(83886080n)).toBe(81920);
      // 1.5 MB in bytes (1,572,864 bytes)
      expect(normalizeSdToKb(1572864n)).toBe(1536);
    });

    it('respects pre-formatted string units like "15573760 KB"', () => {
      expect(normalizeSdToKb('15573760 KB')).toBe(15573760);
    });
  });

  describe('normalizeIntToKb', () => {
    it('converts internal flash byte counts to KiB accurately', () => {
      // 184 KB partition (188,416 bytes)
      expect(normalizeIntToKb(188416n)).toBe(184);
      // 256 KB partition (262,144 bytes)
      expect(normalizeIntToKb(262144n)).toBe(256);
      // Pre-normalized KiB numbers (<= 1024) are preserved
      expect(normalizeIntToKb(184)).toBe(184);
      expect(normalizeIntToKb(256)).toBe(256);
    });
  });
});
