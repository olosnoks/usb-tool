import { HardwareTarget } from '../devices/proxmark/types';

export type FlashTarget = HardwareTarget;

export type RequiredTransport = 'webserial-bootloader' | 'webusb-dfu';

export interface FirmwareArtifact {
  name: string;
  blob?: Uint8Array | ArrayBuffer;
  url?: string;
  expectedSha256: string;
  byteSize: number;
  targetAddress?: number;
}

export interface FlashManifest {
  version: string;
  target: FlashTarget;
  gitHash: string;
  requiredTransport: RequiredTransport;
  artifacts: FirmwareArtifact[];
  notes?: string;
}

export class FlashValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FlashValidationError';
  }
}

export class HashMismatchError extends FlashValidationError {
  constructor(artifactName: string, expected: string, actual: string) {
    super(
      `SHA-256 integrity check failed for artifact "${artifactName}": ` +
      `expected ${expected}, calculated ${actual}`
    );
    this.name = 'HashMismatchError';
  }
}

export class HardwareTargetMismatchError extends FlashValidationError {
  constructor(deviceTarget: string, manifestTarget: string) {
    super(
      `Hardware target mismatch: Connected device is "${deviceTarget}", ` +
      `but firmware manifest is built for "${manifestTarget}"`
    );
    this.name = 'HardwareTargetMismatchError';
  }
}

export class NotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotImplementedError';
  }
}

export interface PreparedFlashSession {
  manifest: FlashManifest;
  target: FlashTarget;
  artifacts: Array<{
    name: string;
    blob: Uint8Array;
    sha256: string;
    byteSize: number;
  }>;
  readyToFlash: boolean;
}
