/**
 * usbPowerMeter.js: protocol decoders and session maths for USB power meters.
 *
 * Pure logic, no browser APIs, so it can be unit-tested with byte vectors.
 *
 * Supported families (each protocol was checked against open-source sources,
 * see the wiki article for the links):
 *  - RuiDeng UM24C / UM25C / UM34C: Bluetooth SPP shown as a serial port.
 *    Host sends 0xF0, the meter answers with a 130-byte status dump.
 *  - FNIRSI FNB48 / FNB58 / C1 (and FNB48S): USB HID, 64-byte reports.
 *    Host sends 0xAA-framed commands with a CRC-8, the meter streams sample packets.
 *
 * Accumulated mAh/mWh are reported by the RuiDeng dump (data group values). The
 * FNIRSI packet has no accumulated charge field in the verified layout, so those
 * are computed here by integrating the samples over time.
 */

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return Uint8Array.from(input);
}

// Big-endian (RuiDeng). The high byte is multiplied rather than shifted so a
// 32-bit value never goes negative.
function be16(b, o) { return (b[o] << 8) | b[o + 1]; }
function be32(b, o) { return b[o] * 0x1000000 + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]); }

// Little-endian (FNIRSI)
function le16(b, o) { return b[o] | (b[o + 1] << 8); }
function le32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000; }

// ---------------------------------------------------------------------------
// RuiDeng UM24C / UM25C / UM34C
// ---------------------------------------------------------------------------

export const RUIDENG_BAUD = 9600;
export const RUIDENG_REQUEST = 0xf0;
export const RUIDENG_FRAME_LEN = 130;

/**
 * Model ID is bytes 0-1 of the dump. The UM25C reports voltage in mV and
 * current in 0.1 mA units; the UM24C and UM34C report cV and mA.
 * Source: rdumtool (smandon/rdumtool, rdum/__init__.py) and rdserialtool
 * (Black-FX/rdserialtool, rdserial/um), both agreeing on these divisors.
 */
export const RUIDENG_MODELS = Object.freeze({
  0x0963: Object.freeze({ id: 0x0963, name: 'UM24C', voltageDiv: 100, currentDiv: 1000 }),
  0x09c9: Object.freeze({ id: 0x09c9, name: 'UM25C', voltageDiv: 1000, currentDiv: 10000 }),
  0x0d4c: Object.freeze({ id: 0x0d4c, name: 'UM34C', voltageDiv: 100, currentDiv: 1000 }),
});

/** Charging-mode index at dump offset 100 (rdserialtool's table). */
export const RUIDENG_CHARGING_MODES = Object.freeze([
  'Unknown', 'QC2', 'QC3', 'APP2 4A', 'APP2 1A', 'APP1 0A', 'APP0 5A', 'DCP 1.5A', 'Samsung',
]);

/**
 * Decode one 130-byte RuiDeng status dump.
 * Offsets (big-endian, unsigned): see the wiki article's table.
 * Throws on wrong length or unknown model ID.
 */
export function parseRuiDengDump(input) {
  const b = toBytes(input);
  if (b.length !== RUIDENG_FRAME_LEN) {
    throw new Error(`RuiDeng dump must be ${RUIDENG_FRAME_LEN} bytes, got ${b.length}`);
  }
  const id = be16(b, 0);
  const model = RUIDENG_MODELS[id];
  if (!model) throw new Error(`Unknown RuiDeng model id 0x${id.toString(16).padStart(4, '0')}`);

  const groups = [];
  for (let i = 0; i < 10; i++) {
    const o = 16 + 8 * i;
    groups.push({ index: i, mAh: be32(b, o) / 1000, mWh: be32(b, o + 4) / 1000 });
  }
  const selectedGroup = be16(b, 14);
  const mode = be16(b, 100);
  const selected = selectedGroup < groups.length ? groups[selectedGroup] : null;

  return {
    model: model.name,
    modelId: id,
    volts: be16(b, 2) / model.voltageDiv,
    amps: be16(b, 4) / model.currentDiv,
    watts: be32(b, 6) / 1000,
    tempC: be16(b, 10),
    tempF: be16(b, 12),
    selectedGroup,
    groups,
    deviceMah: selected ? selected.mAh : null,
    deviceMwh: selected ? selected.mWh : null,
    dPlus: be16(b, 96) / 100,
    dMinus: be16(b, 98) / 100,
    chargingMode: mode,
    chargingModeName: RUIDENG_CHARGING_MODES[mode] ?? `Mode ${mode}`,
    thresholdA: be16(b, 110) / 100,
    recordMah: be32(b, 102) / 1000,
    recordMwh: be32(b, 106) / 1000,
    recordSeconds: be32(b, 112),
    recording: be16(b, 116) === 1,
    screenTimeout: be16(b, 118),
    backlight: be16(b, 120),
    resistanceOhms: be32(b, 122) / 10,
    screenSelected: be16(b, 126),
  };
}

/**
 * Find complete 130-byte dumps in a byte stream. Scans for a known model ID at
 * the start of a frame and skips any other leading byte (for example the 0xFF
 * the meter sends at power-on). Returns the frames and the unconsumed tail.
 */
export function extractRuiDengFrames(input) {
  const b = toBytes(input);
  const frames = [];
  let i = 0;
  while (i < b.length) {
    if (i + 2 > b.length) break;
    if (!RUIDENG_MODELS[be16(b, i)]) { i++; continue; }
    if (i + RUIDENG_FRAME_LEN > b.length) break;
    frames.push(b.slice(i, i + RUIDENG_FRAME_LEN));
    i += RUIDENG_FRAME_LEN;
  }
  return { frames, rest: b.slice(i) };
}

// ---------------------------------------------------------------------------
// FNIRSI FNB48 / FNB58 / C1 (HID)
// ---------------------------------------------------------------------------

export const FNIRSI_FRAME_LEN = 64;
export const FNIRSI_SAMPLE_RATE_HZ = 100;
export const FNIRSI_SAMPLE_PERIOD_MS = 1000 / FNIRSI_SAMPLE_RATE_HZ;

/**
 * Device table. `init` is the command sequence sent after opening the HID device.
 * FNB58 and FNB48S use 0x81, 0x82, 0x82; FNB48 and C1 use 0x81, 0x82, 0x83.
 * Source: yeckel/OpenFNB58 fnb58.py (FNB58 PID 2E3C:5558), baryluk/fnirsi-usb-power-data-logger
 * fnirsi_logger.py (FNB48 0483:003A, C1 0483:003B, FNB48S 2E3C:0049).
 */
export const FNIRSI_DEVICES = Object.freeze([
  Object.freeze({ id: 'fnb48', name: 'FNIRSI FNB48', vendorId: 0x0483, productId: 0x003a, init: [0x81, 0x82, 0x83] }),
  Object.freeze({ id: 'c1', name: 'FNIRSI C1', vendorId: 0x0483, productId: 0x003b, init: [0x81, 0x82, 0x83] }),
  Object.freeze({ id: 'fnb58', name: 'FNIRSI FNB58', vendorId: 0x2e3c, productId: 0x5558, init: [0x81, 0x82, 0x82] }),
  Object.freeze({ id: 'fnb48s', name: 'FNIRSI FNB48S', vendorId: 0x2e3c, productId: 0x0049, init: [0x81, 0x82, 0x82] }),
]);

/** CRC-8: polynomial 0x39, init 0x42, no reflection, xorout 0. */
export function crc8Fnirsi(bytes) {
  let crc = 0x42;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc & 0x80) ? (((crc << 1) ^ 0x39) & 0xff) : ((crc << 1) & 0xff);
    }
  }
  return crc;
}

/** Build a 64-byte command: 0xAA, command, zero padding, CRC-8 over bytes 1..62 in byte 63. */
export function fnirsiCommand(cmd) {
  const frame = new Uint8Array(FNIRSI_FRAME_LEN);
  frame[0] = 0xaa;
  frame[1] = cmd & 0xff;
  frame[63] = crc8Fnirsi(frame.subarray(1, 63));
  return frame;
}

/**
 * Decode one 64-byte FNIRSI packet. Type 0x04 carries four 15-byte samples
 * starting at offset 2. Each sample is little-endian:
 *   +0 u32 volts / 100000, +4 u32 amps / 100000, +8 u16 D+ / 1000,
 *   +10 u16 D- / 1000, +12 unused, +13 u16 temperature / 10 (degC).
 * Byte 62 is not decoded. Other packet types are returned as not-ok.
 */
export function decodeFnirsiPacket(input, { checkCrc = true } = {}) {
  const b = toBytes(input);
  if (b.length !== FNIRSI_FRAME_LEN) return { ok: false, reason: `length ${b.length}` };
  if (b[0] !== 0xaa) return { ok: false, reason: 'bad header' };
  if (b[1] !== 0x04) return { ok: false, reason: 'not a sample packet', type: b[1] };
  if (checkCrc && crc8Fnirsi(b.subarray(1, 63)) !== b[63]) return { ok: false, reason: 'crc' };

  const samples = [];
  for (let i = 0; i < 4; i++) {
    const o = 2 + 15 * i;
    const volts = le32(b, o) / 100000;
    const amps = le32(b, o + 4) / 100000;
    samples.push({
      volts,
      amps,
      watts: volts * amps,
      dPlus: le16(b, o + 8) / 1000,
      dMinus: le16(b, o + 10) / 1000,
      tempC: le16(b, o + 13) / 10,
    });
  }
  return { ok: true, type: 0x04, samples };
}

// ---------------------------------------------------------------------------
// Sample records and session accumulation
// ---------------------------------------------------------------------------

/** Gaps longer than this are not integrated (the meter was unplugged or paused). */
export const SESSION_MAX_GAP_S = 5;

const TRACKED = ['volts', 'amps', 'watts', 'tempC'];

/** Turn a RuiDeng dump into a sample record. */
export function ruiDengSample(dump, tMs) {
  return {
    tMs,
    source: 'ruideng',
    model: dump.model,
    volts: dump.volts,
    amps: dump.amps,
    watts: dump.watts,
    tempC: dump.tempC,
    dPlus: dump.dPlus,
    dMinus: dump.dMinus,
    chargingModeName: dump.chargingModeName,
    resistanceOhms: dump.resistanceOhms,
    deviceMah: dump.deviceMah,
    deviceMwh: dump.deviceMwh,
  };
}

/**
 * Turn the four samples of an FNIRSI packet into sample records. The last
 * sample is stamped `nowMs`, earlier ones 10 ms apart, as in the source logger.
 */
export function fnirsiSamples(packetSamples, nowMs) {
  const dt = FNIRSI_SAMPLE_PERIOD_MS;
  return packetSamples.map((s, i) => ({
    tMs: nowMs - (packetSamples.length - 1 - i) * dt,
    source: 'fnirsi',
    volts: s.volts,
    amps: s.amps,
    watts: s.watts,
    tempC: s.tempC,
    dPlus: s.dPlus,
    dMinus: s.dMinus,
    deviceMah: null,
    deviceMwh: null,
  }));
}

export function createSessionStats() {
  return {
    count: 0,
    gaps: 0,
    lastMs: null,
    lastAmps: null,
    lastWatts: null,
    mAh: 0,
    mWh: 0,
    min: {},
    max: {},
  };
}

/**
 * Add one sample. Charge is integrated with the trapezoid rule between
 * consecutive samples: A * s / 3.6 = mAh, W * s / 3.6 = mWh.
 * Returns the running computed totals to store with the sample.
 */
export function addSessionSample(stats, sample) {
  if (stats.lastMs !== null) {
    const dtS = (sample.tMs - stats.lastMs) / 1000;
    if (dtS > SESSION_MAX_GAP_S) stats.gaps++;
    else if (dtS > 0) {
      const avgA = (stats.lastAmps + sample.amps) / 2;
      const avgW = (stats.lastWatts + sample.watts) / 2;
      stats.mAh += (avgA * dtS) / 3.6;
      stats.mWh += (avgW * dtS) / 3.6;
    }
  }
  stats.lastMs = sample.tMs;
  stats.lastAmps = sample.amps;
  stats.lastWatts = sample.watts;
  stats.count++;

  for (const k of TRACKED) {
    const v = sample[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (stats.min[k] === undefined || v < stats.min[k]) stats.min[k] = v;
    if (stats.max[k] === undefined || v > stats.max[k]) stats.max[k] = v;
  }
  return { computedMah: stats.mAh, computedMwh: stats.mWh };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export const CSV_COLUMNS = Object.freeze([
  'time_iso', 'elapsed_s', 'source', 'volts', 'amps', 'watts', 'temp_c',
  'd_plus_v', 'd_minus_v', 'device_mah', 'device_mwh', 'computed_mah', 'computed_mwh',
]);

function fmt(v, digits) {
  return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '';
}

/**
 * Rows are sample records with `computedMah`/`computedMwh` attached (see
 * addSessionSample). `startMs` is the session start, used for elapsed_s.
 */
export function samplesToCsv(rows, startMs = rows.length ? rows[0].tMs : 0) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push([
      new Date(r.tMs).toISOString(),
      fmt((r.tMs - startMs) / 1000, 3),
      r.source,
      fmt(r.volts, 4),
      fmt(r.amps, 5),
      fmt(r.watts, 4),
      fmt(r.tempC, 1),
      fmt(r.dPlus, 2),
      fmt(r.dMinus, 2),
      fmt(r.deviceMah, 3),
      fmt(r.deviceMwh, 3),
      fmt(r.computedMah, 4),
      fmt(r.computedMwh, 4),
    ].join(','));
  }
  return `${lines.join('\n')}\n`;
}
