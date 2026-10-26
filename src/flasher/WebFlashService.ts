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
// Pure DFU protocol driver (device-agnostic, see src/utils/dfuDriver.js).
import { DfuDevice, discoverDfuInterface } from '../utils/dfuDriver';

export interface PrepareFlashOptions {
  target: FlashTarget;
  manifest?: FlashManifest;
  artifactBlobs: Record<string, Uint8Array | ArrayBuffer>;
}

export interface DfuFlashContext {
  /** An opened + claimed WebUSB device (navigator.usb). */
  usbDevice: any;
  /** DFU interface number; auto-discovered when omitted. */
  interfaceNumber?: number;
  /** Max bytes per DNLOAD block; taken from the functional descriptor if omitted. */
  transferSize?: number;
  /** Use the ST DfuSe command set (set-address / erase). */
  dfuse?: boolean;
  /** Erase page size for DfuSe (bytes); 0 => mass erase. */
  erasePageSize?: number;
  onProgress?: (info: { written: number; total: number; artifact: string }) => void;
  log?: (msg: string) => void;
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
   *
   * Dispatches on the manifest's required transport:
   *  - `webusb-dfu`: runs the verified USB DFU 1.1 / DfuSe download sequence
   *    against the supplied, already-opened WebUSB device.
   *  - `webserial-bootloader`: still held closed (fail-closed) because the
   *    serial bootloader write/erase opcodes are device-specific and unverified.
   */
  public static async executeFlashSession(
    session: PreparedFlashSession,
    context?: DfuFlashContext | any
  ): Promise<void> {
    if (!session.readyToFlash) {
      throw new FlashValidationError('Flash session is not prepared or validated');
    }

    if (session.manifest.requiredTransport === 'webusb-dfu') {
      return this.executeDfuFlash(session, context as DfuFlashContext);
    }

    // webserial-bootloader remains an explicit fail-closed safety constraint:
    // the low-level ROM erase/write opcodes are not yet verified per target.
    throw new NotImplementedError(
      `Serial bootloader flash sequence pending verified protocol for ${session.target}. ` +
      `Low-level erase and block-write opcodes are held closed to prevent permanent bricking.`
    );
  }

  /**
   * Runs the DFU download for every validated artifact in the session. An
   * artifact with a `targetAddress` is written via the DfuSe set-address/erase
   * path; otherwise a plain DFU 1.1 download is used.
   */
  public static async executeDfuFlash(
    session: PreparedFlashSession,
    context: DfuFlashContext
  ): Promise<void> {
    if (!context || !context.usbDevice) {
      throw new FlashValidationError('DFU flash requires an opened WebUSB device in the context');
    }

    const log = context.log ?? (() => undefined);

    // Resolve the DFU interface + transfer size from the live descriptors
    // unless the caller pinned them explicitly.
    let interfaceNumber = context.interfaceNumber;
    let transferSize = context.transferSize;
    let dfuse = context.dfuse ?? false;

    if (interfaceNumber == null || transferSize == null) {
      const info = await discoverDfuInterface(context.usbDevice);
      if (!info) {
        throw new FlashValidationError('No DFU interface found on the connected device');
      }
      interfaceNumber = interfaceNumber ?? info.interfaceNumber;
      transferSize = transferSize ?? info.transferSize;
      // ST DfuSe bootloaders report bcdDFU 0x011a.
      if (context.dfuse == null && info.bcdDFU === 0x011a) dfuse = true;
    }

    const driver = new DfuDevice(context.usbDevice, interfaceNumber, {
      transferSize,
      dfuse,
      log
    });

    for (const artifact of session.artifacts) {
      const onProgress = (info: { written: number; total: number }) =>
        context.onProgress?.({ ...info, artifact: artifact.name });

      const manifestArtifact = session.manifest.artifacts.find((a) => a.name === artifact.name);
      const targetAddress = manifestArtifact?.targetAddress;

      if (dfuse && typeof targetAddress === 'number') {
        log(`DfuSe: ${artifact.name} -> 0x${targetAddress.toString(16)} (${artifact.byteSize} B)`);
        await driver.dfuseDownloadElement(
          targetAddress,
          artifact.blob,
          { erasePageSize: context.erasePageSize ?? 0 },
          onProgress
        );
      } else {
        log(`DFU 1.1: ${artifact.name} (${artifact.byteSize} B)`);
        await driver.download(artifact.blob, onProgress);
      }
    }
  }
}
