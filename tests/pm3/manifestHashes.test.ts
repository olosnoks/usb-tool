import { describe, it, expect } from 'vitest';
import { BUILTIN_FLASH_MANIFESTS, WebFlashService, FlashValidationError } from '../../src/flasher';

// SHA-256 of the strings "test", "password" and "foo": the old placeholder hashes.
const FAKE_HASHES = [
  '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8',
  '2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae'
];

describe('built-in flash manifests carry no invented hashes', () => {
  it('has no placeholder SHA-256 values', () => {
    for (const m of Object.values(BUILTIN_FLASH_MANIFESTS)) {
      for (const a of m.artifacts) {
        expect(a.expectedSha256 === null || /^[0-9a-f]{64}$/.test(a.expectedSha256)).toBe(true);
        expect(FAKE_HASHES).not.toContain(a.expectedSha256);
      }
    }
  });

  it('refuses to prepare a session for an artifact with no published hash', async () => {
    const m = BUILTIN_FLASH_MANIFESTS.PM3RDV4;
    const blobs: Record<string, Uint8Array> = {};
    for (const a of m.artifacts) blobs[a.name] = new Uint8Array(a.byteSize);
    await expect(WebFlashService.prepareFlashSession({ target: 'PM3RDV4', artifactBlobs: blobs }))
      .rejects.toThrow(FlashValidationError);
    await expect(WebFlashService.prepareFlashSession({ target: 'PM3RDV4', artifactBlobs: blobs }))
      .rejects.toThrow(/No verified SHA-256/);
  });
});
