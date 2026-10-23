import {
  FlashTarget,
  FlashManifest,
  PreparedFlashSession,
  HashMismatchError,
  HardwareTargetMismatchError,
  FlashValidationError,
  NotImplementedError
} from './types';
import { resolveManifest } from './manifest';

export interface PrepareFlashOptions {
  target: FlashTarget;
  manifest?: FlashManifest;
  artifactBlobs: Record<string, Uint8Array | ArrayBuffer>;
}

export interface ReEnumerationOptions {
  timeoutMs?: number;
  expectedVendorId?: number;
}

export class WebFlashService {
  /**
   * Calculates the SHA-256 digest of binary data in-browser using Web Cryptography API.
   */
  public static async calculateSha256(data: Uint8Array | ArrayBuffer): Promise<string> {
    const uint8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', uint8 as unknown as BufferSource);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').toLowerCase();
  }

  /**
   * Validates hardware target alignment and cryptographic integrity of all firmware blobs.
   * Fails closed on hash mismatches, size discrepancies, or missing artifacts.
   */
  public static async prepareFlashSession(
    options: PrepareFlashOptions
  ): Promise<PreparedFlashSession> {
    const manifest = options.manifest ?? resolveManifest(options.target);

    if (options.target !== 'UNKNOWN' && manifest.target !== options.target) {
      throw new HardwareTargetMismatchError(options.target, manifest.target);
    }

    const validatedArtifacts: PreparedFlashSession['artifacts'] = [];

    for (const expectedArtifact of manifest.artifacts) {
      const rawBlob = options.artifactBlobs[expectedArtifact.name];
      if (!rawBlob) {
        throw new FlashValidationError(
          `Missing required firmware artifact: "${expectedArtifact.name}"`
        );
      }

      const uint8Blob = rawBlob instanceof Uint8Array ? rawBlob : new Uint8Array(rawBlob);

      if (uint8Blob.byteLength !== expectedArtifact.byteSize) {
        throw new FlashValidationError(
          `Artifact "${expectedArtifact.name}" byte size mismatch: ` +
          `expected ${expectedArtifact.byteSize} bytes, received ${uint8Blob.byteLength} bytes`
        );
      }

      const actualSha256 = await this.calculateSha256(uint8Blob);
      const expectedSha256 = expectedArtifact.expectedSha256.toLowerCase();

      if (actualSha256 !== expectedSha256) {
        throw new HashMismatchError(expectedArtifact.name, expectedSha256, actualSha256);
      }

      validatedArtifacts.push({
        name: expectedArtifact.name,
        blob: uint8Blob,
        sha256: actualSha256,
        byteSize: uint8Blob.byteLength
      });
    }

    return {
      manifest,
      target: options.target,
      artifacts: validatedArtifacts,
      readyToFlash: true
    };
  }

  /**
   * Handles USB physical disconnection and re-enumeration when entering bootloader mode.
   * Listens for port reconnection and polls navigator.serial.getPorts().
   */
  public static async waitForBootloaderReEnumeration(
    options: ReEnumerationOptions = {}
  ): Promise<any> {
    const timeoutMs = options.timeoutMs ?? 15000;
    const vendorId = options.expectedVendorId ?? 0x9ac4;

    if (typeof navigator === 'undefined' || !('serial' in navigator)) {
      throw new Error('Web Serial API is unavailable for bootloader re-enumeration');
    }

    const serial = (navigator as any).serial;

    return new Promise((resolve, reject) => {
      let isResolved = false;

      const timer = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          serial.removeEventListener('connect', handleConnect);
          clearInterval(pollInterval);
          reject(
            new Error(
              `Bootloader re-enumeration timed out after ${timeoutMs}ms. Device did not re-appear.`
            )
          );
        }
      }, timeoutMs);

      const checkMatchingPort = async () => {
        try {
          const ports = await serial.getPorts();
          for (const port of ports) {
            const info = port.getInfo ? port.getInfo() : {};
            if (!info.usbVendorId || info.usbVendorId === vendorId) {
              return port;
            }
          }
        } catch {
          // Ignore polling errors
        }
        return null;
      };

      const handleConnect = async (event: any) => {
        if (isResolved) return;
        const port = event.port;
        const info = port.getInfo ? port.getInfo() : {};
        if (!info.usbVendorId || info.usbVendorId === vendorId) {
          isResolved = true;
          clearTimeout(timer);
          clearInterval(pollInterval);
          serial.removeEventListener('connect', handleConnect);
          resolve(port);
        }
      };

      serial.addEventListener('connect', handleConnect);

      // Also actively poll getPorts in case connect event already fired
      const pollInterval = setInterval(async () => {
        if (isResolved) return;
        const port = await checkMatchingPort();
        if (port) {
          isResolved = true;
          clearTimeout(timer);
          clearInterval(pollInterval);
          serial.removeEventListener('connect', handleConnect);
          resolve(port);
        }
      }, 500);
    });
  }

  /**
   * Executes low-level flash write operations.
   * Safety constraint: Throws typed NotImplementedError until low-level bootloader
   * write/erase opcodes are verified against the specific hardware bootrom.
   */
  public static async executeFlashSession(
    session: PreparedFlashSession,
    _port?: any
  ): Promise<void> {
    if (!session.readyToFlash) {
      throw new FlashValidationError('Flash session is not prepared or validated');
    }

    // Explicit Fail-Closed Safety Constraint
    throw new NotImplementedError(
      `Flashing payload write sequence pending verified bootloader protocol for ${session.target}. ` +
      `Low-level bootloader flash erase and block write opcodes are held closed to prevent permanent bootloader bricking.`
    );
  }
}
