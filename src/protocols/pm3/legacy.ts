import { Pm3Packet } from './types';

/**
 * Legacy ("old-style") Proxmark3 USB framing, used by every firmware older
 * than the Iceman NG protocol (official firmware up to v3.x and the factory
 * images most Proxmark3 Easy units ship with).
 *
 * Both directions use one fixed 544-byte frame, little-endian:
 *   cmd   u64
 *   arg   3 x u64
 *   data  512 bytes
 *
 * There is no magic, length or checksum. The firmware handles one USB read as
 * one command, so a short NG frame is taken for an unknown command and
 * answered with a debug string: "unknown command:: 0x61334d50".
 */
export const PM3_LEGACY_FRAME_SIZE = 544;
export const PM3_LEGACY_DATA_SIZE = 512;
const HEADER_SIZE = 32;

/** Opcodes as the legacy firmware numbers them (checked against a 2016 Proxmark3 Easy). */
export const PM3_LEGACY_COMMANDS = {
  CMD_DEVICE_INFO: 0x0000,
  CMD_ACK: 0x00ff,
  CMD_DEBUG_PRINT_STRING: 0x0100,
  CMD_VERSION: 0x0107,
  CMD_ACQUIRE_RAW_ADC_SAMPLES_125K: 0x0205,
  CMD_DOWNLOAD_RAW_ADC_SAMPLES_125K: 0x0207,
  CMD_DOWNLOADED_RAW_ADC_SAMPLES_125K: 0x0208,
  CMD_READER_ISO_15693: 0x0310,
  CMD_READER_ISO_14443a: 0x0385,
  CMD_MEASURE_ANTENNA_TUNING: 0x0400,
  CMD_MEASURED_ANTENNA_TUNING: 0x0410
} as const;

export interface LegacyFrameOptions {
  cmd: number;
  arg0?: number;
  arg1?: number;
  arg2?: number;
  payload?: Uint8Array | number[];
}

export function packLegacyFrame(options: LegacyFrameOptions): Uint8Array {
  const data = options.payload
    ? options.payload instanceof Uint8Array
      ? options.payload
      : new Uint8Array(options.payload)
    : new Uint8Array(0);
  if (data.byteLength > PM3_LEGACY_DATA_SIZE) {
    throw new Error(`Legacy Proxmark frames carry at most ${PM3_LEGACY_DATA_SIZE} data bytes, got ${data.byteLength}`);
  }
  const buffer = new Uint8Array(PM3_LEGACY_FRAME_SIZE);
  const view = new DataView(buffer.buffer);
  view.setBigUint64(0, BigInt(options.cmd >>> 0), true);
  view.setBigUint64(8, BigInt((options.arg0 ?? 0) >>> 0), true);
  view.setBigUint64(16, BigInt((options.arg1 ?? 0) >>> 0), true);
  view.setBigUint64(24, BigInt((options.arg2 ?? 0) >>> 0), true);
  buffer.set(data, HEADER_SIZE);
  return buffer;
}

/**
 * Unpacks one 544-byte legacy frame. `payload` is always the full 512-byte
 * data area: the frame has no length field, each command defines how much of
 * it is meaningful (usually through one of the args).
 */
export function unpackLegacyFrame(data: Uint8Array): Pm3Packet {
  if (data.byteLength < PM3_LEGACY_FRAME_SIZE) {
    throw new Error(`Truncated legacy Proxmark frame: ${data.byteLength} of ${PM3_LEGACY_FRAME_SIZE} bytes`);
  }
  const view = new DataView(data.buffer, data.byteOffset, PM3_LEGACY_FRAME_SIZE);
  const low32 = (offset: number) => Number(view.getBigUint64(offset, true) & 0xffffffffn);
  return {
    magic: 0,
    cmd: low32(0) & 0xffff,
    length: PM3_LEGACY_DATA_SIZE,
    flags: 0,
    arg0: low32(8),
    arg1: low32(16),
    arg2: low32(24),
    status: 0,
    ng: false,
    payload: data.slice(HEADER_SIZE, PM3_LEGACY_FRAME_SIZE)
  };
}

/** Text of a CMD_DEBUG_PRINT_STRING frame (arg0 is the string length). */
export function legacyDebugText(packet: Pm3Packet): string {
  const len = Math.min(packet.arg0, packet.payload.byteLength);
  return new TextDecoder('utf-8', { fatal: false }).decode(packet.payload.subarray(0, len));
}

/**
 * True when `bytes` (what a device sent back after an NG request) starts with
 * a legacy debug-string frame, i.e. the device is a Proxmark3 on pre-NG
 * firmware. Deliberately strict so nothing else is mistaken for one.
 */
export function looksLikeLegacyReply(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PM3_LEGACY_FRAME_SIZE) return false;
  const packet = unpackLegacyFrame(bytes);
  if (packet.cmd !== PM3_LEGACY_COMMANDS.CMD_DEBUG_PRINT_STRING) return false;
  if (packet.arg0 === 0 || packet.arg0 > PM3_LEGACY_DATA_SIZE) return false;
  return /^[\x20-\x7e\r\n]+$/.test(legacyDebugText(packet));
}
