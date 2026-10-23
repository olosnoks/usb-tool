/**
 * Proxmark3 / Proxmark5 NG Protocol Definitions & Packet Structures
 * (RfidResearchGroup/proxmark3 include/pm3_cmd.h). All fields are little-endian.
 *
 * Host -> device frame:
 *   magic   u32  'PM3a' (0x61334D50)
 *   length  u16  bits 0..14 = data length, bit 15 = "ng" flag
 *   cmd     u16
 *   data    [length]    (non-ng "MIX" frames: 3 x u64 args first, then payload)
 *   crc     u16  'a3' (0x3361) postamble (USB transport, CRC not computed)
 *
 * Device -> host frame:
 *   magic   u32  'PM3b' (0x62334D50)
 *   length  u16  bits 0..14 = data length, bit 15 = "ng" flag
 *   status  i16
 *   cmd     u16
 *   data    [length]
 *   crc     u16  'b3' (0x3362)
 */

export const PM3_MAGIC_COMMAND = 0x61334d50; // "PM3a"
export const PM3_MAGIC_RESPONSE = 0x62334d50; // "PM3b"
export const PM3_NG_MAGIC = PM3_MAGIC_COMMAND;
export const PM3_NG_MAGIC_CMD_A = PM3_MAGIC_COMMAND;
export const PM3_NG_MAGIC_RESP_B = PM3_MAGIC_RESPONSE;

export function isValidPm3Magic(magic: number): boolean {
  return magic === PM3_MAGIC_COMMAND || magic === PM3_MAGIC_RESPONSE;
}

export const PM3_COMMAND_PREAMBLE_SIZE = 8; // magic + length + cmd
export const PM3_RESPONSE_PREAMBLE_SIZE = 10; // magic + length + status + cmd
export const PM3_POSTAMBLE_SIZE = 2;
export const PM3_POSTAMBLE_COMMAND = 0x3361; // "a3"
export const PM3_POSTAMBLE_RESPONSE = 0x3362; // "b3"
export const PM3_MIX_ARGS_SIZE = 24; // 3 x uint64

/** Smallest possible frame (response preamble + postamble, no data). */
export const PM3_NG_HEADER_SIZE = PM3_RESPONSE_PREAMBLE_SIZE + PM3_POSTAMBLE_SIZE;

/**
 * Maximum data length accepted per frame. Release firmware uses 512; newer
 * firmware / PM5 uses larger buffers, so be permissive on receive.
 */
export const PM3_MAX_PAYLOAD_SIZE = 4096;

/** Default timeout in milliseconds for UART/USB communication responses */
export const UART_USB_CLIENT_RX_TIMEOUT_MS = 3000;

/**
 * Standard Proxmark USB Vendor/Product IDs for Web Serial / CDC ACM & common clone bridges
 */
export const PROXMARK_USB_IDS = [
  { usbVendorId: 0x9ac4, usbProductId: 0x4b8f, name: 'Proxmark3 RDV4 / Easy / Generic' },
  { usbVendorId: 0x2d2d, usbProductId: 0x504d, name: 'Proxmark5 DFU / CDC' },
  { usbVendorId: 0x1d50, usbProductId: 0x6089, name: 'Openmoko Proxmark3' },
  { usbVendorId: 0x1a86, usbProductId: 0x7523, name: 'Proxmark3 Easy (CH340 Bridge)' },
  { usbVendorId: 0x10c4, usbProductId: 0xea60, name: 'Proxmark3 Easy (CP2102 Bridge)' },
  { usbVendorId: 0x0403, usbProductId: 0x6001, name: 'Proxmark3 Easy (FTDI Bridge)' }
];

/** PM3 Frame Header definition */
export interface Pm3FrameHeader {
  magic: number;
  cmd: number;
  length: number;
  /** Unused on the wire; kept for API compatibility. */
  flags: number;
  /** MIX frames only (low 32 bits of the u64 args). */
  arg0: number;
  arg1: number;
  arg2: number;
  /** Device status (PM3_SUCCESS = 0). Always 0 for host->device frames. */
  status: number;
  /** true = NG frame (no args), false = legacy MIX frame (3 x u64 args + data). */
  ng: boolean;
}

/** Complete Proxmark packet. `payload` excludes the MIX args. */
export interface Pm3Packet extends Pm3FrameHeader {
  payload: Uint8Array;
}

/**
 * Compatibility Level between Host Client Build & Device Firmware:
 * - matched: client commit hash matches firmware. Full operations enabled.
 * - compatible: recognised device, different commit. Diagnostics/reads permitted; write/magic/raw behind override.
 * - unsupported: unrecognised device. Operations disabled.
 */
export type CompatibilityLevel = 'matched' | 'compatible' | 'unsupported';

/** Command Risk Classification for Tri-State Guard Enforcements */
export type CommandRiskLevel = 'diagnostic' | 'read' | 'write' | 'magic' | 'raw';
