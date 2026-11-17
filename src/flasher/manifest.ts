import { FlashManifest, FlashTarget, FlashValidationError } from './types';

/**
 * Standard Built-in Firmware Flash Manifests for Proxmark devices.
 * Links client build identity to exact blobs and cryptographic hashes.
 *
 * `expectedSha256: null` means no real, published hash is known yet. The earlier
 * placeholder digests were hashes of test strings, so nothing could ever match
 * them. Such entries are disabled (WebFlashService.prepareFlashSession refuses
 * them) until a real hash is supplied, e.g. through parseManifestJson() with a
 * manifest generated from the actual release files. Sizes and addresses here
 * are likewise unverified placeholders.
 */
export const BUILTIN_FLASH_MANIFESTS: Record<FlashTarget, FlashManifest> = {
  PM3RDV4: {
    version: 'v4.18962',
    target: 'PM3RDV4',
    gitHash: 'b4a8e21',
    requiredTransport: 'webserial-bootloader',
    artifacts: [
      {
        name: 'bootrom.bin',
        expectedSha256: null,
        byteSize: 32768,
        targetAddress: 0x00100000
      },
      {
        name: 'fullimage.bin',
        expectedSha256: null,
        byteSize: 458752,
        targetAddress: 0x00102000
      }
    ],
    notes: 'Official Proxmark3 RDV4 reference release aligned with Web Client build b4a8e21.'
  },
  PM3GENERIC: {
    version: 'v4.18962',
    target: 'PM3GENERIC',
    gitHash: 'b4a8e21',
    requiredTransport: 'webserial-bootloader',
    artifacts: [
      {
        name: 'bootrom.bin',
        expectedSha256: null,
        byteSize: 32768,
        targetAddress: 0x00100000
      },
      {
        name: 'fullimage.bin',
        expectedSha256: null,
        byteSize: 262144,
        targetAddress: 0x00102000
      }
    ],
    notes: 'Generic 512KB / 256KB AT91SAM7S512 platform target.'
  },
  PM3ICOPYX: {
    version: 'v4.18962',
    target: 'PM3ICOPYX',
    gitHash: 'b4a8e21',
    requiredTransport: 'webserial-bootloader',
    artifacts: [
      {
        name: 'bootrom.bin',
        expectedSha256: null,
        byteSize: 32768,
        targetAddress: 0x00100000
      },
      {
        name: 'fullimage.bin',
        expectedSha256: null,
        byteSize: 458752,
        targetAddress: 0x00102000
      }
    ],
    notes: 'iCopy-X hardware revision target.'
  },
  PM5: {
    version: 'v5.0.1',
    target: 'PM5',
    gitHash: '99aabbc',
    requiredTransport: 'webusb-dfu',
    artifacts: [
      {
        name: 'pm5-firmware.bin',
        expectedSha256: null,
        byteSize: 1048576,
        targetAddress: 0x08000000
      }
    ],
    notes: 'Proxmark5 DFU target for high-performance ARM Cortex-M7.'
  },
  UNKNOWN: {
    version: '0.0.0',
    target: 'UNKNOWN',
    gitHash: 'unknown',
    requiredTransport: 'webserial-bootloader',
    artifacts: [],
    notes: 'Unrecognized hardware target.'
  }
};

/**
 * Resolves a built-in flash manifest for a given hardware target.
 */
export function resolveManifest(target: FlashTarget): FlashManifest {
  const manifest = BUILTIN_FLASH_MANIFESTS[target];
  if (!manifest) {
    throw new FlashValidationError(`No built-in flash manifest available for target "${target}"`);
  }
  return manifest;
}

/**
 * Parses and validates an external JSON string into a typed FlashManifest.
 */
export function parseManifestJson(jsonString: string): FlashManifest {
  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err: any) {
    throw new FlashValidationError(`Malformed JSON manifest: ${err.message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new FlashValidationError('Manifest root must be an object');
  }

  if (!parsed.target || typeof parsed.target !== 'string') {
    throw new FlashValidationError('Missing or invalid "target" field in manifest');
  }

  if (!Array.isArray(parsed.artifacts) || parsed.artifacts.length === 0) {
    throw new FlashValidationError('Manifest must contain a non-empty "artifacts" array');
  }

  for (const artifact of parsed.artifacts) {
    if (!artifact.name || typeof artifact.name !== 'string') {
      throw new FlashValidationError('Artifact missing valid "name" field');
    }
    if (!artifact.expectedSha256 || typeof artifact.expectedSha256 !== 'string') {
      throw new FlashValidationError(`Artifact "${artifact.name}" missing "expectedSha256"`);
    }
    if (typeof artifact.byteSize !== 'number' || artifact.byteSize <= 0) {
      throw new FlashValidationError(`Artifact "${artifact.name}" invalid "byteSize"`);
    }
  }

  return {
    version: parsed.version || 'custom',
    target: parsed.target as FlashTarget,
    gitHash: parsed.gitHash || 'custom',
    requiredTransport: parsed.requiredTransport || 'webserial-bootloader',
    artifacts: parsed.artifacts,
    notes: parsed.notes
  };
}
