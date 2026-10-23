import { CompatibilityLevel, CommandRiskLevel, Pm3Packet } from '../../protocols/pm3';

/**
 * State machine states for Proxmark Device Controller
 */
export type ProxmarkState =
  | 'disconnected'
  | 'connecting'
  | 'interrogating'
  | 'readyMatched'
  | 'readyCompatible'
  | 'lockedUnsupported'
  | 'bootloader'
  | 'error';

/**
 * Hardware targets supported by Proxmark3 / Proxmark5
 */
export type HardwareTarget =
  | 'PM3RDV4'
  | 'PM3GENERIC'
  | 'PM3ICOPYX'
  | 'PM5'
  | 'UNKNOWN';

/**
 * Parsed Identity from CMD_VERSION handshake
 */
export interface DeviceFirmwareIdentity {
  rawVersionString: string;
  gitHash: string;
  isClean: boolean;
  hardwareTarget: HardwareTarget;
  buildDate?: string;
  bootloaderVersion?: string;
}

/**
 * Client's internal build identity against which firmware compatibility is evaluated
 */
export interface ClientBuildIdentity {
  gitHash: string;
  majorProtocolVersion: number;
  expectedTarget: HardwareTarget;
}

/**
 * Event map for ProxmarkDevice listeners
 */
export interface ProxmarkEventMap {
  stateChanged: { from: ProxmarkState; to: ProxmarkState; reason?: string };
  debugPrint: { message: string; timestamp: number };
  packetReceived: { packet: Pm3Packet };
  packetSent: { packet: Pm3Packet };
  compatibilityResolved: {
    level: CompatibilityLevel;
    identity: DeviceFirmwareIdentity;
  };
  error: { error: Error };
  disconnected: { reason?: string };
}

export type ProxmarkEventListener<K extends keyof ProxmarkEventMap> = (
  payload: ProxmarkEventMap[K]
) => void;
