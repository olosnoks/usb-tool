import { Pm3Packet } from './types';

/** Decoders for Proxmark3 replies. All pure. */

const hex = (bytes: ArrayLike<number>): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join('');

// ---------------------------------------------------------------- chip id
export interface ChipInfo {
  chipId: number;
  chipName: string;
  /** Internal flash size in KB, or null when the ID does not encode one we know. */
  flashKb: number | null;
}

// Atmel CHIPID_CIDR NVPSIZ field (bits 8..11) -> flash size in KB.
const NVPSIZ_KB: Record<number, number> = { 1: 8, 2: 16, 3: 32, 5: 64, 7: 128, 9: 256, 10: 512, 12: 1024, 14: 2048 };

/** Decodes the Atmel chip ID register the firmware reports with its version. */
export function decodeChipId(chipId: number): ChipInfo {
  const id = chipId >>> 0;
  const flashKb = NVPSIZ_KB[(id >>> 8) & 0xf] ?? null;
  const arch = (id >>> 20) & 0xff;
  let chipName = `Unknown MCU (chip ID 0x${id.toString(16).toUpperCase().padStart(8, '0')})`;
  if (arch === 0x70 && flashKb) chipName = `AT91SAM7S${flashKb}`;
  return { chipId: id, chipName, flashKb };
}

// ---------------------------------------------------------------- ISO 14443A select
export interface Iso14aCard {
  /** 0 = no card, 1 = selected (ISO 14443-4, has ATS), 2 = selected (no ATS), 3 = proprietary anticollision. */
  selectStatus: number;
  found: boolean;
  uid: string;
  uidBytes: number[];
  /** As usually printed: high byte first (e.g. "0004"). */
  atqa: string;
  sak: string;
  ats: string;
  cardType: string;
}

const SAK_TYPES: Record<number, string> = {
  0x00: 'MIFARE Ultralight / NTAG (Type 2 tag)',
  0x08: 'MIFARE Classic 1K',
  0x09: 'MIFARE Mini',
  0x10: 'MIFARE Plus 2K (SL2)',
  0x11: 'MIFARE Plus 4K (SL2)',
  0x18: 'MIFARE Classic 4K',
  0x19: 'MIFARE Classic 2K',
  0x20: 'ISO 14443-4 card (DESFire, Plus SL3, JCOP, payment card...)',
  0x28: 'SmartMX / JCOP with MIFARE Classic 1K emulation',
  0x38: 'SmartMX / JCOP with MIFARE Classic 4K emulation',
  0x88: 'Infineon MIFARE Classic 1K'
};

const NO_CARD: Iso14aCard = {
  selectStatus: 0, found: false, uid: '', uidBytes: [], atqa: '', sak: '', ats: '', cardType: ''
};

/**
 * Parses the firmware's iso14a_card_select_t:
 *   uid[10], uidlen, atqa[2], sak, ats_len, ats[256]
 * The layout is the same on legacy and NG firmware.
 */
export function parseIso14aSelect(selectStatus: number, data: Uint8Array): Iso14aCard {
  if (selectStatus === 0 || data.byteLength < 15) return { ...NO_CARD };
  const uidLen = data[10];
  if (uidLen === 0 || uidLen > 10) return { ...NO_CARD };
  const uidBytes = Array.from(data.subarray(0, uidLen));
  const sak = data[13];
  const atsLen = Math.min(data[14], data.byteLength - 15);
  return {
    selectStatus,
    found: true,
    uid: hex(uidBytes),
    uidBytes,
    atqa: hex([data[12], data[11]]),
    sak: hex([sak]),
    ats: selectStatus === 1 ? hex(data.subarray(15, 15 + atsLen)) : '',
    cardType: SAK_TYPES[sak & 0xfb] ?? 'Unknown (SAK not in the built-in table)'
  };
}

/**
 * Card from any firmware's answer to a 14443A CONNECT:
 * - legacy and older NG firmware: CMD_ACK with arg0 = select status, data = card struct
 * - current NG firmware: iso14a_raw_resp_t { len u16, sel u8, rfu u8, data[] }
 */
export function parseIso14aReply(packet: Pm3Packet): Iso14aCard {
  if (packet.ng) {
    if (packet.status !== 0 || packet.payload.byteLength < 4) return { ...NO_CARD };
    return parseIso14aSelect(packet.payload[2], packet.payload.subarray(4));
  }
  return parseIso14aSelect(packet.arg0, packet.payload);
}

// ---------------------------------------------------------------- antenna tuning
export interface AntennaTuning {
  lf125mV: number;
  lf134mV: number;
  hfmV: number;
  /** Highest LF voltage seen in the sweep and the frequency it occurred at. */
  peakmV: number;
  peakKhz: number;
  /** LF sweep, one value per divisor (frequency = 12000 / (index + 1) kHz), in units of `sweepStepmV`. */
  sweep: Uint8Array;
  sweepStepmV: number;
}

const divisorToKhz = (divisor: number): number => Number((12000 / (divisor + 1)).toFixed(2));

/** Legacy CMD_MEASURED_ANTENNA_TUNING: values packed into the three args, sweep in the data. */
export function parseLegacyTuning(packet: Pm3Packet): AntennaTuning {
  return {
    lf125mV: packet.arg0 & 0xffff,
    lf134mV: packet.arg0 >>> 16,
    hfmV: packet.arg1 & 0xffff,
    peakmV: packet.arg2 >>> 16,
    peakKhz: divisorToKhz(packet.arg2 & 0xffff),
    sweep: packet.payload.slice(0, 256),
    sweepStepmV: 256
  };
}

/** NG CMD_MEASURE_ANTENNA_TUNING payload: 6 x u32, i32 divisor, 256 sweep bytes. */
export function parseNgTuning(packet: Pm3Packet): AntennaTuning {
  if (packet.payload.byteLength < 28) {
    throw new Error(`Antenna tuning reply too short (${packet.payload.byteLength} bytes)`);
  }
  const p = packet.payload;
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return {
    lf134mV: view.getUint32(0, true),
    lf125mV: view.getUint32(4, true),
    hfmV: view.getUint32(12, true),
    peakmV: view.getUint32(16, true),
    peakKhz: divisorToKhz(view.getUint32(20, true)),
    sweep: p.slice(28, 28 + 256),
    sweepStepmV: 512
  };
}
