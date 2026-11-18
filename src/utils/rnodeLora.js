// RNode (Reticulum LoRa modem) KISS command protocol, plus an offline LoRa
// time-on-air / link-budget / duty-cycle calculator. Pure logic, no React, no I/O.
//
// Protocol constants and payload layouts follow markqvist/RNode_Firmware (Framing.h,
// Config.h) and Reticulum's RNS/Interfaces/RNodeInterface.py and RNS/Utilities/rnodeconf.py.
// Time-on-air follows Semtech AN1200.13 ("LoRa Modem Designer's Guide").

import { md5Hex } from './md5.js';

// ---------------------------------------------------------------- KISS framing
export const FEND = 0xc0;
export const FESC = 0xdb;
export const TFEND = 0xdc;
export const TFESC = 0xdd;

// ---------------------------------------------------------------- commands
export const CMD = {
  DATA: 0x00,
  FREQUENCY: 0x01,
  BANDWIDTH: 0x02,
  TXPOWER: 0x03,
  SF: 0x04,
  CR: 0x05,
  RADIO_STATE: 0x06,
  RADIO_LOCK: 0x07,
  DETECT: 0x08,
  READY: 0x0f,
  STAT_RX: 0x21,
  STAT_TX: 0x22,
  STAT_RSSI: 0x23,
  STAT_SNR: 0x24,
  STAT_CHTM: 0x25,
  STAT_PHYPRM: 0x26,
  STAT_BAT: 0x27,
  STAT_CSMA: 0x28,
  STAT_TEMP: 0x29,
  RANDOM: 0x40,
  BOARD: 0x47,
  PLATFORM: 0x48,
  MCU: 0x49,
  FW_VERSION: 0x50,
  ROM_READ: 0x51,
  RESET: 0x55,
  ERROR: 0x90,
};

export const DETECT_REQ = 0x73;
export const DETECT_RESP = 0x46;
export const RADIO_STATE_OFF = 0x00;
export const RADIO_STATE_ON = 0x01;
export const RSSI_OFFSET = 157;
export const RNODE_BAUD = 115200;

export const PLATFORM_NAMES = { 0x90: 'AVR (ATmega)', 0x80: 'ESP32', 0x70: 'nRF52' };
export const MCU_NAMES = { 0x91: 'ATmega1284P', 0x92: 'ATmega2560', 0x81: 'ESP32', 0x71: 'nRF52' };
export const ERROR_NAMES = {
  0x01: 'Radio initialisation failed',
  0x02: 'TX failed',
  0x03: 'EEPROM locked',
  0x04: 'TX queue full',
  0x05: 'Memory low',
  0x06: 'Modem timeout',
};
// Product codes from rnodeconf.py ROM class.
export const PRODUCT_NAMES = {
  0x03: 'RNode', 0x10: 'RAK4631', 0x15: 'T-Echo', 0x20: 'OpenCom XL', 0xb0: 'LilyGO T32-20',
  0xb1: 'LilyGO T32-21', 0xb2: 'LilyGO T32-10', 0xc0: 'Heltec H32 v2', 0xc1: 'Heltec H32 v3',
  0xc2: 'Heltec T114', 0xc3: 'Heltec H32 v4', 0xd0: 'LilyGO T-Deck', 0xe0: 'LilyGO T-Beam',
  0xea: 'LilyGO T-Beam Supreme v1', 0xeb: 'XIAO ESP32-S3', 0xf0: 'Homebrew',
};

// Bandwidths the RNode firmware accepts (Hz).
export const BANDWIDTHS_HZ = [7800, 10400, 15600, 20800, 31250, 41700, 62500, 125000, 250000, 500000];
export const FREQ_MIN_HZ = 137000000;
export const FREQ_MAX_HZ = 1020000000;
export const TXPOWER_MIN_DBM = 0;
export const TXPOWER_MAX_DBM = 22;

// ---------------------------------------------------------------- byte helpers
export function toHex(bytes, sep = ' ') {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(sep).toUpperCase();
}

export function u32be(n) {
  const v = n >>> 0;
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
}

export function readU32be(b, off = 0) {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}

/** KISS-escape a payload: FEND -> FESC TFEND, FESC -> FESC TFESC. */
export function kissEscape(payload) {
  const out = [];
  for (const b of payload) {
    if (b === FEND) out.push(FESC, TFEND);
    else if (b === FESC) out.push(FESC, TFESC);
    else out.push(b);
  }
  return out;
}

/** One KISS frame: FEND, command, escaped payload, FEND. */
export function kissFrame(cmd, payload = []) {
  return Uint8Array.from([FEND, cmd & 0xff, ...kissEscape(payload), FEND]);
}

/**
 * Streaming KISS decoder. Feed it arbitrary chunks; it emits complete frames
 * {cmd, payload} as they close on a FEND. Escape sequences and frames may be split
 * across chunks.
 */
export class KissDecoder {
  constructor({ maxPayload = 4096 } = {}) {
    this.maxPayload = maxPayload;
    this.reset();
  }

  reset() {
    this.cmd = null;
    this.buf = [];
    this.escaped = false;
    this.overflow = false;
  }

  push(bytes) {
    const frames = [];
    for (const b of bytes) {
      if (b === FEND) {
        if (this.cmd !== null && !this.overflow) {
          frames.push({ cmd: this.cmd, payload: Uint8Array.from(this.buf) });
        }
        this.cmd = null;
        this.buf = [];
        this.escaped = false;
        this.overflow = false;
        continue;
      }
      if (this.escaped) {
        this.escaped = false;
        if (b === TFEND) this.add(FEND);
        else if (b === TFESC) this.add(FESC);
        else this.add(b); // malformed escape: keep the byte rather than drop data
        continue;
      }
      if (b === FESC) {
        this.escaped = true;
        continue;
      }
      this.add(b);
    }
    return frames;
  }

  add(b) {
    if (this.cmd === null) {
      this.cmd = b;
      return;
    }
    if (this.buf.length >= this.maxPayload) {
      this.overflow = true;
      return;
    }
    this.buf.push(b);
  }
}

// ---------------------------------------------------------------- command builders
export function buildDetect() {
  // Same sequence RNS sends: detect request, then FW version, platform and MCU queries.
  return concat(
    kissFrame(CMD.DETECT, [DETECT_REQ]),
    kissFrame(CMD.FW_VERSION, [0x00]),
    kissFrame(CMD.PLATFORM, [0x00]),
    kissFrame(CMD.MCU, [0x00]),
  );
}

export function buildQuery(cmd) {
  // Read-only queries use a single 0x00 payload byte, as in RNS.
  return kissFrame(cmd, [0x00]);
}

export function buildRomRead() {
  return kissFrame(CMD.ROM_READ, [0x00]);
}

export function buildRadioState(on) {
  return kissFrame(CMD.RADIO_STATE, [on ? RADIO_STATE_ON : RADIO_STATE_OFF]);
}

/** Validates radio parameters. Returns an array of human-readable errors (empty when valid). */
export function validateRadioParams({ freqHz, bwHz, sf, cr, txPowerDbm }) {
  const errors = [];
  if (!Number.isInteger(freqHz) || freqHz < FREQ_MIN_HZ || freqHz > FREQ_MAX_HZ) {
    errors.push(`Frequency must be ${FREQ_MIN_HZ / 1e6}-${FREQ_MAX_HZ / 1e6} MHz.`);
  }
  if (!BANDWIDTHS_HZ.includes(bwHz)) errors.push('Bandwidth must be one of the supported LoRa values.');
  if (!Number.isInteger(sf) || sf < 5 || sf > 12) errors.push('Spreading factor must be SF5-SF12.');
  if (!Number.isInteger(cr) || cr < 5 || cr > 8) errors.push('Coding rate must be 4/5-4/8.');
  if (!Number.isInteger(txPowerDbm) || txPowerDbm < TXPOWER_MIN_DBM || txPowerDbm > TXPOWER_MAX_DBM) {
    errors.push(`TX power must be ${TXPOWER_MIN_DBM}-${TXPOWER_MAX_DBM} dBm.`);
  }
  return errors;
}

/**
 * Frames to program a radio, in the order RNS uses (frequency, bandwidth, TX power,
 * SF, CR). The caller turns the radio on separately. Throws if the parameters are invalid.
 */
export function buildSetRadio({ freqHz, bwHz, sf, cr, txPowerDbm }) {
  const errors = validateRadioParams({ freqHz, bwHz, sf, cr, txPowerDbm });
  if (errors.length) throw new Error(errors.join(' '));
  return concat(
    kissFrame(CMD.FREQUENCY, u32be(freqHz)),
    kissFrame(CMD.BANDWIDTH, u32be(bwHz)),
    kissFrame(CMD.TXPOWER, [txPowerDbm]),
    kissFrame(CMD.SF, [sf]),
    kissFrame(CMD.CR, [cr]),
  );
}

function concat(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ---------------------------------------------------------------- response parsers
export function parseVersion(payload) {
  if (payload.length < 2) return null;
  return `${payload[0]}.${payload[1]}`;
}

export function parsePlatform(payload) {
  if (!payload.length) return null;
  const code = payload[0];
  return { code, name: PLATFORM_NAMES[code] || 'Unknown' };
}

export function parseMcu(payload) {
  if (!payload.length) return null;
  const code = payload[0];
  return { code, name: MCU_NAMES[code] || 'Unknown' };
}

export function parseRssi(payload) {
  return payload.length ? payload[0] - RSSI_OFFSET : null;
}

export function parseSnr(payload) {
  if (!payload.length) return null;
  const signed = (payload[0] << 24) >> 24;
  return signed * 0.25;
}

export function parseCounter(payload) {
  return payload.length >= 4 ? readU32be(payload, 0) : null;
}

export function parseError(payload) {
  const code = payload.length ? payload[0] : 0;
  return { code, name: ERROR_NAMES[code] || `Unknown error 0x${code.toString(16)}` };
}

/** Channel/airtime statistics frame (CMD_STAT_CHTM, 11 bytes). */
export function parseChannelStats(payload) {
  if (payload.length < 11) return null;
  const be16 = (o) => ((payload[o] << 8) | payload[o + 1]) / 100;
  const noise = payload[9] - RSSI_OFFSET;
  return {
    shortAirtimePct: be16(0),
    longAirtimePct: be16(2),
    shortLoadPct: be16(4),
    longLoadPct: be16(6),
    currentRssi: payload[8] - RSSI_OFFSET,
    noiseFloor: noise,
    interference: payload[10] === 0xff ? null : payload[10] - RSSI_OFFSET,
  };
}

/** Decodes a single command frame into a tagged, display-ready result. */
export function decodeFrame({ cmd, payload }) {
  switch (cmd) {
    case CMD.DETECT:
      return { type: 'detect', detected: payload.length > 0 && payload[0] === DETECT_RESP };
    case CMD.FW_VERSION: return { type: 'fwVersion', value: parseVersion(payload) };
    case CMD.PLATFORM: return { type: 'platform', value: parsePlatform(payload) };
    case CMD.MCU: return { type: 'mcu', value: parseMcu(payload) };
    case CMD.BOARD: return { type: 'board', value: payload.length ? payload[0] : null };
    case CMD.ROM_READ: return { type: 'rom', bytes: payload };
    case CMD.FREQUENCY: return { type: 'frequency', value: payload.length >= 4 ? readU32be(payload) : null };
    case CMD.BANDWIDTH: return { type: 'bandwidth', value: payload.length >= 4 ? readU32be(payload) : null };
    case CMD.TXPOWER: return { type: 'txPower', value: payload.length ? payload[0] : null };
    case CMD.SF: return { type: 'sf', value: payload.length ? payload[0] : null };
    case CMD.CR: return { type: 'cr', value: payload.length ? payload[0] : null };
    case CMD.RADIO_STATE: return { type: 'radioState', on: payload.length > 0 && payload[0] === RADIO_STATE_ON };
    case CMD.STAT_RSSI: return { type: 'rssi', value: parseRssi(payload) };
    case CMD.STAT_SNR: return { type: 'snr', value: parseSnr(payload) };
    case CMD.STAT_RX: return { type: 'statRx', value: parseCounter(payload) };
    case CMD.STAT_TX: return { type: 'statTx', value: parseCounter(payload) };
    case CMD.STAT_CHTM: return { type: 'channelStats', value: parseChannelStats(payload) };
    case CMD.DATA: return { type: 'data', length: payload.length };
    case CMD.ERROR: return { type: 'error', value: parseError(payload) };
    case CMD.READY: return { type: 'ready' };
    case CMD.RANDOM: return { type: 'random', value: payload.length ? payload[0] : null };
    default: return { type: 'unknown', cmd };
  }
}

// ---------------------------------------------------------------- EEPROM (ROM) decode
export const ROM = {
  PRODUCT: 0x00,
  MODEL: 0x01,
  HW_REV: 0x02,
  SERIAL: 0x03, // 4 bytes
  MADE: 0x07, // 4 bytes
  CHKSUM: 0x0b, // 16 bytes (MD5 of bytes 0x00..0x0A)
  SIGNATURE: 0x1b, // 128 bytes
  INFO_LOCK: 0x9b,
  CONF_SF: 0x9c,
  CONF_CR: 0x9d,
  CONF_TXP: 0x9e,
  CONF_BW: 0x9f, // 4 bytes
  CONF_FREQ: 0xa3, // 4 bytes
  CONF_OK: 0xa7,
};
export const PROVISIONED_BYTE = 0x73;

/**
 * Decodes the device EEPROM as returned by CMD_ROM_READ. Reads only; it does not
 * verify the RSA-PSS signature (that needs Reticulum's trusted key set) and does not
 * provision anything. The checksum is MD5 over bytes 0x00..0x0A, as rnodeconf.py does.
 */
export function decodeEeprom(rom) {
  if (!rom || rom.length < ROM.CONF_OK + 1) {
    throw new Error(`ROM read returned ${rom ? rom.length : 0} bytes; expected at least ${ROM.CONF_OK + 1}.`);
  }
  const storedChecksum = toHex(rom.slice(ROM.CHKSUM, ROM.CHKSUM + 16), '').toLowerCase();
  // Only the first 11 bytes (product, model, hw rev, serial, made) are hashed.
  const hashedChecksum = md5Hex(rom.slice(0, 11));
  const sig = rom.slice(ROM.SIGNATURE, ROM.SIGNATURE + 128);
  const sigBlank = sig.every((b) => b === 0x00) || sig.every((b) => b === 0xff);
  return {
    provisioned: rom[ROM.INFO_LOCK] === PROVISIONED_BYTE,
    product: rom[ROM.PRODUCT],
    productName: PRODUCT_NAMES[rom[ROM.PRODUCT]] || 'Unknown',
    model: rom[ROM.MODEL],
    hwRev: rom[ROM.HW_REV],
    serialHex: toHex(rom.slice(ROM.SERIAL, ROM.SERIAL + 4)),
    madeHex: toHex(rom.slice(ROM.MADE, ROM.MADE + 4)),
    checksumStored: storedChecksum,
    checksumOk: storedChecksum === hashedChecksum,
    signaturePresent: !sigBlank,
    signatureBytes: sig.length,
    configValid: rom[ROM.CONF_OK] === PROVISIONED_BYTE,
    config: {
      sf: rom[ROM.CONF_SF],
      cr: rom[ROM.CONF_CR],
      txPowerDbm: rom[ROM.CONF_TXP],
      bwHz: readU32be(rom, ROM.CONF_BW),
      freqHz: readU32be(rom, ROM.CONF_FREQ),
    },
  };
}

// ---------------------------------------------------------------- LoRa calculator
// Semtech AN1200.13 / SX127x datasheet SNR demodulation limits per SF (dB).
export const SNR_LIMIT_DB = { 5: -2.5, 6: -5, 7: -7.5, 8: -10, 9: -12.5, 10: -15, 11: -17.5, 12: -20 };
export const CR_DENOMINATORS = [5, 6, 7, 8];

export function symbolTimeMs(sf, bwHz) {
  return ((2 ** sf) / bwHz) * 1000;
}

/** Auto low-data-rate optimisation: on when symbol time exceeds 16 ms. */
export function ldroAuto(sf, bwHz) {
  return symbolTimeMs(sf, bwHz) > 16;
}

/**
 * LoRa time-on-air per Semtech AN1200.13.
 *   Tsym = 2^SF / BW
 *   Tpreamble = (nPreamble + 4.25) * Tsym
 *   nPayload = 8 + max(ceil((8*PL - 4*SF + 28 + 16*CRC - 20*IH) / (4*(SF - 2*DE))) * (CR + 4), 0)
 * where CR is 1..4 (4/5..4/8), DE = LDRO, IH = implicit header, CRC = payload CRC on.
 */
export function timeOnAir({
  payloadBytes,
  sf,
  bwHz,
  cr = 5,
  preamble = 8,
  implicitHeader = false,
  crc = true,
  ldro = 'auto',
}) {
  if (!Number.isInteger(sf) || sf < 5 || sf > 12) throw new Error('SF must be 5-12.');
  if (!(bwHz >= 7800 && bwHz <= 500000)) throw new Error('Bandwidth must be 7.8-500 kHz.');
  if (!Number.isInteger(cr) || cr < 5 || cr > 8) throw new Error('CR must be 5-8 (4/5-4/8).');
  if (!Number.isInteger(payloadBytes) || payloadBytes < 0 || payloadBytes > 255) throw new Error('Payload must be 0-255 bytes.');
  if (!Number.isInteger(preamble) || preamble < 0 || preamble > 65535) throw new Error('Preamble must be 0-65535 symbols.');

  const tSym = symbolTimeMs(sf, bwHz);
  const de = ldro === 'on' ? true : ldro === 'off' ? false : ldroAuto(sf, bwHz);
  const ih = implicitHeader ? 1 : 0;
  const crcBit = crc ? 1 : 0;
  const crPlus = cr - 4; // 1..4
  const numerator = 8 * payloadBytes - 4 * sf + 28 + 16 * crcBit - 20 * ih;
  const denominator = 4 * (sf - 2 * (de ? 1 : 0));
  const extra = Math.max(Math.ceil(numerator / denominator) * (crPlus + 4), 0);
  const nPayload = 8 + extra;
  const tPre = (preamble + 4.25) * tSym;
  const tPay = nPayload * tSym;
  return {
    symbolTimeMs: tSym,
    ldro: de,
    preambleMs: tPre,
    payloadSymbols: nPayload,
    payloadMs: tPay,
    totalMs: tPre + tPay,
  };
}

/** Raw LoRa bit rate: SF * 4/(4+CR) / Tsym. */
export function bitRateBps({ sf, bwHz, cr = 5 }) {
  return (sf * (4 / cr) * bwHz) / 2 ** sf;
}

/** Estimated receiver sensitivity: -174 + 10log10(BW) + NF + SNR limit. */
export function sensitivityDbm({ bwHz, sf, noiseFigureDb = 6 }) {
  return -174 + 10 * Math.log10(bwHz) + noiseFigureDb + SNR_LIMIT_DB[sf];
}

/**
 * Free-space range estimate. Maximum path loss = Ptx + Gtx + Grx - cable - sensitivity - fade margin,
 * then invert FSPL = 20log10(d_km) + 20log10(f_MHz) + 32.44. Real range is usually much shorter
 * (terrain, antennas, obstacles); treat this as an upper bound.
 */
export function linkBudget({
  txPowerDbm,
  txGainDbi = 0,
  rxGainDbi = 0,
  cableLossDb = 0,
  freqMhz,
  sensitivity,
  fadeMarginDb = 10,
}) {
  const maxPathLossDb = txPowerDbm + txGainDbi + rxGainDbi - cableLossDb - sensitivity - fadeMarginDb;
  const fsplAt1km = 20 * Math.log10(freqMhz) + 32.44;
  const rangeKm = 10 ** ((maxPathLossDb - fsplAt1km) / 20);
  return { maxPathLossDb, fsplAt1kmDb: fsplAt1km, rangeKm };
}

/**
 * Duty-cycle allowance over a rolling hour. EU868 default is 1% (36 s/h); the
 * 869.4-869.65 MHz sub-band is 10%, and some sub-bands are 0.1%.
 */
export function dutyCycleAllowance({ toaMs, dutyFraction = 0.01, windowMs = 3600000 }) {
  if (!(toaMs > 0)) throw new Error('Time-on-air must be positive.');
  if (!(dutyFraction > 0 && dutyFraction <= 1)) throw new Error('Duty cycle must be in (0, 1].');
  const allowedMs = dutyFraction * windowMs;
  return {
    allowedMsPerHour: allowedMs,
    maxMessagesPerHour: Math.floor(allowedMs / toaMs),
    minOffTimeMs: toaMs * (1 / dutyFraction - 1),
  };
}

// ---------------------------------------------------------------- regional limits (advisory)
// Simplified licence-exempt ISM rules, for a sanity check only. Always confirm the current rules
// for your country. Power limits are the regulatory figure (ERP/EIRP/conducted as noted), compared
// here against the module TX power setting; antenna gain and cable loss are not modelled.
export const REGIONS = {
  none: { label: 'Other / licensed (no check)', bands: [] },
  eu868: {
    label: 'EU 863-870 MHz (ETSI EN 300 220)',
    bands: [
      { fromMhz: 863, toMhz: 865, duty: 0.001, maxDbm: 14, note: '25 mW ERP, 0.1%' },
      { fromMhz: 865, toMhz: 868, duty: 0.01, maxDbm: 14, note: '25 mW ERP, 1%' },
      { fromMhz: 868, toMhz: 868.6, duty: 0.01, maxDbm: 14, note: '25 mW ERP, 1%' },
      { fromMhz: 868.7, toMhz: 869.2, duty: 0.001, maxDbm: 14, note: '25 mW ERP, 0.1%' },
      { fromMhz: 869.4, toMhz: 869.65, duty: 0.1, maxDbm: 27, note: '500 mW ERP, 10%' },
      { fromMhz: 869.7, toMhz: 870, duty: 0.01, maxDbm: 14, note: '25 mW ERP, 1%' },
    ],
  },
  eu433: {
    label: 'EU 433 MHz ISM',
    bands: [{ fromMhz: 433.05, toMhz: 434.79, duty: 0.1, maxDbm: 10, note: '10 mW ERP, 10%' }],
  },
  us915: {
    label: 'US 902-928 MHz (FCC Part 15.247)',
    bands: [{ fromMhz: 902, toMhz: 928, duty: 1, maxDbm: 30, note: '1 W conducted with antenna up to 6 dBi, no duty cycle; dwell-time rules apply' }],
  },
  au915: {
    label: 'AU 915-928 MHz',
    bands: [{ fromMhz: 915, toMhz: 928, duty: 1, maxDbm: 30, note: '1 W EIRP class licence, no duty cycle' }],
  },
};

/**
 * Checks a frequency/TX power against a region. Returns {ok, band, duty, maxDbm, messages}.
 * "none" always passes. A frequency outside every band of the region is not ok.
 */
export function regionCheck(regionId, freqMhz, txPowerDbm) {
  const region = REGIONS[regionId];
  if (!region || !region.bands.length) return { ok: true, band: null, duty: null, maxDbm: null, messages: [] };
  const band = region.bands.find((b) => freqMhz >= b.fromMhz && freqMhz <= b.toMhz);
  if (!band) {
    return {
      ok: false, band: null, duty: null, maxDbm: null,
      messages: [`${freqMhz} MHz is outside the licence-exempt LoRa sub-bands for ${region.label}.`],
    };
  }
  const messages = [];
  if (txPowerDbm > band.maxDbm) {
    messages.push(`TX power ${txPowerDbm} dBm is above the ${band.maxDbm} dBm limit for this sub-band (${band.note}).`);
  }
  return { ok: messages.length === 0, band, duty: band.duty, maxDbm: band.maxDbm, messages };
}

// ---------------------------------------------------------------- export helpers
/** rnodeconf command line for the given parameters (an export for the CLI; not run by this tool). */
export function rnodeconfCommand({ freqHz, bwHz, sf, cr, txPowerDbm }, port = '/dev/ttyUSB0') {
  const errors = validateRadioParams({ freqHz, bwHz, sf, cr, txPowerDbm });
  if (errors.length) throw new Error(errors.join(' '));
  return `rnodeconf ${port} --freq ${freqHz} --bw ${bwHz} --txp ${txPowerDbm} --sf ${sf} --cr ${cr}`;
}

/** Reticulum ~/.reticulum/config RNodeInterface block for the given parameters. */
export function reticulumInterfaceConfig({ freqHz, bwHz, sf, cr, txPowerDbm }, port = '/dev/ttyUSB0') {
  const errors = validateRadioParams({ freqHz, bwHz, sf, cr, txPowerDbm });
  if (errors.length) throw new Error(errors.join(' '));
  return [
    '[[RNode LoRa Interface]]',
    '  type = RNodeInterface',
    '  enabled = yes',
    `  port = ${port}`,
    `  frequency = ${freqHz}`,
    `  bandwidth = ${bwHz}`,
    `  txpower = ${txPowerDbm}`,
    `  spreadingfactor = ${sf}`,
    `  codingrate = ${cr}`,
  ].join('\n');
}

/** Summary stats for an RSSI/SNR sample list: {min, max, mean, count}; null when empty. */
export function sampleStats(samples) {
  if (!samples || !samples.length) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, mean: sum / samples.length, count: samples.length };
}

/** SVG polyline points string scaling samples into a width x height box (y inverted). */
export function sparklinePoints(samples, width = 120, height = 24) {
  if (!samples || samples.length < 2) return '';
  const { min, max } = sampleStats(samples);
  const span = max - min || 1;
  return samples
    .map((v, i) => `${((i / (samples.length - 1)) * width).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(' ');
}

/** Largest payload (0-255) whose time on air fits maxToaMs, or -1 if even 0 bytes does not fit. */
export function maxPayloadForToa(maxToaMs, opts) {
  let best = -1;
  for (let n = 0; n <= 255; n += 1) {
    if (timeOnAir({ ...opts, payloadBytes: n }).totalMs <= maxToaMs) best = n;
    else break;
  }
  return best;
}
