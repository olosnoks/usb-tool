import { describe, it, expect } from 'vitest';
import {
  WebFlashService,
  resolveManifest,
  parseManifestJson,
  HashMismatchError,
  HardwareTargetMismatchError,
  FlashValidationError,
  NotImplementedError,
  BUILTIN_FLASH_MANIFESTS
} from '../../src/flasher';
import {
  validateHexBytes,
  validateParameter,
  validateActionParameters,
  COMMAND_TREE
} from '../../src/ui/components/proxmark/commandSchema';

describe('WebFlash Scaffold & Manifest Validation', () => {
  it('resolves built-in manifests for all supported hardware targets', () => {
    const rdv4 = resolveManifest('PM3RDV4');
    expect(rdv4.target).toBe('PM3RDV4');
    expect(rdv4.artifacts.length).toBe(2);
    expect(rdv4.artifacts.map((a) => a.name)).toEqual(['bootrom.bin', 'fullimage.bin']);

    const generic = resolveManifest('PM3GENERIC');
    expect(generic.target).toBe('PM3GENERIC');

    const pm5 = resolveManifest('PM5');
    expect(pm5.target).toBe('PM5');
    expect(pm5.requiredTransport).toBe('webusb-dfu');
  });

  it('parses valid external JSON manifest', () => {
    const rawJson = JSON.stringify({
      version: 'v4.20000',
      target: 'PM3RDV4',
      gitHash: 'abcdef0',
      requiredTransport: 'webserial-bootloader',
      artifacts: [
        {
          name: 'bootrom.bin',
          expectedSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
          byteSize: 1024
        }
      ]
    });

    const parsed = parseManifestJson(rawJson);
    expect(parsed.version).toBe('v4.20000');
    expect(parsed.target).toBe('PM3RDV4');
    expect(parsed.artifacts.length).toBe(1);
  });

  it('rejects malformed manifest JSON', () => {
    expect(() => parseManifestJson('not a json')).toThrow(FlashValidationError);
    expect(() => parseManifestJson('{}')).toThrow(FlashValidationError);
    expect(() =>
      parseManifestJson(JSON.stringify({ target: 'PM3RDV4', artifacts: [] }))
    ).toThrow(FlashValidationError);
  });

  it('computes correct SHA-256 hash using Web Cryptography API', async () => {
    // SHA-256 of "test" is 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
    const testBytes = new TextEncoder().encode('test');
    const hash = await WebFlashService.calculateSha256(testBytes);
    expect(hash).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('detects hash mismatch and throws typed HashMismatchError (fail-closed)', async () => {
    const customManifest = {
      version: 'v1.0',
      target: 'PM3RDV4' as const,
      gitHash: 'abc',
      requiredTransport: 'webserial-bootloader' as const,
      artifacts: [
        {
          name: 'bootrom.bin',
          expectedSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', // "test"
          byteSize: 4
        }
      ]
    };

    // Provide incorrect content ("diff")
    const corruptedBlob = new TextEncoder().encode('diff');

    await expect(
      WebFlashService.prepareFlashSession({
        target: 'PM3RDV4',
        manifest: customManifest,
        artifactBlobs: {
          'bootrom.bin': corruptedBlob
        }
      })
    ).rejects.toThrow(HashMismatchError);
  });

  it('detects hardware target mismatch and throws HardwareTargetMismatchError', async () => {
    const customManifest = {
      version: 'v1.0',
      target: 'PM3RDV4' as const,
      gitHash: 'abc',
      requiredTransport: 'webserial-bootloader' as const,
      artifacts: []
    };

    await expect(
      WebFlashService.prepareFlashSession({
        target: 'PM5', // Device is PM5, but manifest is for PM3RDV4
        manifest: customManifest,
        artifactBlobs: {}
      })
    ).rejects.toThrow(HardwareTargetMismatchError);
  });

  it('enforces fail-closed safety constraint on executeFlashSession', async () => {
    const session = {
      manifest: BUILTIN_FLASH_MANIFESTS.PM3RDV4,
      target: 'PM3RDV4' as const,
      artifacts: [],
      readyToFlash: true
    };

    await expect(WebFlashService.executeFlashSession(session)).rejects.toThrow(
      NotImplementedError
    );
  });
});

describe('Cascading Command Schema & Input Validation', () => {
  it('validates hex byte strings accurately', () => {
    expect(validateHexBytes('52').valid).toBe(true);
    expect(validateHexBytes('93 20').valid).toBe(true);
    expect(validateHexBytes('DE:AD:BE:EF').valid).toBe(true);

    // Odd characters
    expect(validateHexBytes('5').valid).toBe(false);
    expect(validateHexBytes('123').valid).toBe(false);

    // Non-hex characters
    expect(validateHexBytes('5Z').valid).toBe(false);
    expect(validateHexBytes('hello').valid).toBe(false);

    // Empty
    expect(validateHexBytes('').valid).toBe(false);
  });

  it('validates parameter constraints (numbers, bounds, required)', () => {
    const numParam = {
      id: 'timeout',
      name: 'Timeout',
      type: 'number' as const,
      min: 100,
      max: 5000,
      required: true
    };

    expect(validateParameter(numParam, 500).valid).toBe(true);
    expect(validateParameter(numParam, 50).valid).toBe(false);
    expect(validateParameter(numParam, 6000).valid).toBe(false);
    expect(validateParameter(numParam, 'not-a-number').valid).toBe(false);
    expect(validateParameter(numParam, '').valid).toBe(false);
  });

  it('validates action parameters for HF 14a Raw Frame Exchange', () => {
    const hfDomain = COMMAND_TREE.find((d) => d.id === 'hf')!;
    const iso14a = hfDomain.subsystems.find((s) => s.id === '14a')!;
    const rawAction = iso14a.actions.find((a) => a.id === 'raw')!;

    // Valid parameters
    const validCheck = validateActionParameters(rawAction, {
      hexData: '52',
      appendCrc: true
    });
    expect(validCheck.valid).toBe(true);
    expect(Object.keys(validCheck.errors).length).toBe(0);

    // Invalid parameters (odd hex length)
    const invalidCheck = validateActionParameters(rawAction, {
      hexData: '52A',
      appendCrc: false
    });
    expect(invalidCheck.valid).toBe(false);
    expect(invalidCheck.errors.hexData).toBeDefined();
  });
});
