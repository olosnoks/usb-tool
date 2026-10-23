import { CompatibilityLevel, CommandRiskLevel } from '../../protocols/pm3';
import { DeviceFirmwareIdentity, ClientBuildIdentity, HardwareTarget } from './types';

export class CompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompatibilityError';
  }
}

export class DeviceLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceLockedError';
  }
}

/**
 * Default Client Reference Build Identity.
 * Corresponds to the validated Web Client protocol build.
 */
export const DEFAULT_CLIENT_BUILD: ClientBuildIdentity = {
  gitHash: 'b4a8e21',
  majorProtocolVersion: 4,
  expectedTarget: 'PM3RDV4'
};

/**
 * Compares device firmware identity against client build identity to yield a tri-state CompatibilityLevel:
 *
 * 1. 'matched': Exact git commit hash matches and hardware targets align. Full capabilities enabled.
 * 2. 'compatible': Recognized NG hardware target and valid NG protocol, but commit hashes differ.
 *    Read-only diagnostics and safe scans permitted; writes/magic/raw locked behind explicit override.
 * 3. 'unsupported': Unrecognized hardware target, corrupted version response, or incompatible protocol.
 *    All operations blocked; only "Align Firmware via WebFlash" is accessible.
 */
export function evaluateCompatibility(
  firmware: DeviceFirmwareIdentity,
  client: ClientBuildIdentity = DEFAULT_CLIENT_BUILD
): CompatibilityLevel {
  // If target is completely unknown and no response string was received
  if (
    firmware.hardwareTarget === 'UNKNOWN' &&
    (!firmware.gitHash || firmware.gitHash === 'unknown') &&
    (!firmware.rawVersionString || firmware.rawVersionString === 'corrupted')
  ) {
    return 'unsupported';
  }

  const isKnownTarget = ['PM3RDV4', 'PM3GENERIC', 'PM3ICOPYX', 'PM5'].includes(
    firmware.hardwareTarget
  );

  if (!isKnownTarget || firmware.hardwareTarget === 'UNKNOWN') {
    return 'unsupported';
  }

  const clientHashPrefix = client.gitHash.slice(0, 7).toLowerCase();
  const deviceHash = (firmware.gitHash || '').toLowerCase();

  if (
    deviceHash &&
    deviceHash !== 'unknown' &&
    (deviceHash.startsWith(clientHashPrefix) || clientHashPrefix.startsWith(deviceHash))
  ) {
    return 'matched';
  }

  return 'compatible';
}

export interface CompatibilityGuardOptions {
  compatibilityLevel: CompatibilityLevel;
  allowRiskOverrides?: boolean;
}

/**
 * Returns true if a command of the given risk level is authorized to execute.
 */
export function canExecute(
  risk: CommandRiskLevel,
  options: CompatibilityGuardOptions
): boolean {
  if (options.compatibilityLevel === 'matched') {
    return true;
  }

  if (options.compatibilityLevel === 'compatible') {
    // Diagnostic and read operations are always permitted on compatible firmware
    if (risk === 'diagnostic' || risk === 'read') {
      return true;
    }
    // High-risk flash/magic/raw operations allowed if override is set
    return !!options.allowRiskOverrides;
  }

  // Strictly locked on unsupported firmware
  return false;
}

/**
 * Enforces command dispatch safety. Throws a typed error if execution is not permitted.
 */
export function assertCanExecute(
  risk: CommandRiskLevel,
  options: CompatibilityGuardOptions,
  commandName?: string
): void {
  if (!canExecute(risk, options)) {
    if (options.compatibilityLevel === 'unsupported') {
      throw new DeviceLockedError(
        `Command execution blocked: Device firmware is unsupported. ` +
        `Operational commands are locked until firmware is aligned via WebFlash.`
      );
    }
    throw new CompatibilityError(
      `Command execution blocked: Command risk '${risk}' is locked on compatible firmware ` +
      `without explicit risk override${commandName ? ` (${commandName})` : ''}.`
    );
  }
}
