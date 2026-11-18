/**
 * ISM device decoders for the offline IQ decoder (src/utils/ismDecoder.js).
 *
 * Bit layouts and pulse timings are ported from the rtl_433 device decoders
 * (https://github.com/merbanan/rtl_433, src/devices/*.c), which are GPL-2.0-or-later.
 * This file is therefore distributed under the same terms as those sources; the
 * app's MIT licence does not cover this module. Each decoder's header comment names
 * the rtl_433 file it was taken from.
 *
 * Conventions used here (they match the slicer in ismDecoder.js):
 *  - A row is a Uint8Array of 0/1 values, MSB first within each byte.
 *  - PWM slicer: bit = 1 when the mark (ON) is shorter than `thresholdUs`
 *    (rtl_433 convention: short pulse = 1), then optionally inverted.
 *  - PPM slicer: bit = 1 when the gap after the mark is >= `thresholdUs`.
 *  - Manchester slicer: IEEE-style pairs, (1,0) = 1 and (0,1) = 0, per half-bit
 *    clock `halfBitUs`; the row is built at both alignments and each is tried.
 *
 * Honesty: these decoders have only been checked against self-consistent frames
 * built from the same layouts (see tests/ismDecoder.test.js). Real captures may
 * need polarity or timing tweaks; the UI reports every decode with its checks.
 */

/** Pack `n` bytes starting at bit `offset` (MSB first). */
export function bitsToBytes(bits, offset, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[offset + i * 8 + j];
    out[i] = v;
  }
  return out;
}

/** Nibbles (4-bit values) starting at bit `offset`. */
export function bitsToNibbles(bits, offset, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let v = 0;
    for (let j = 0; j < 4; j++) v = (v << 1) | bits[offset + i * 4 + j];
    out[i] = v;
  }
  return out;
}

export function invertBits(bits) {
  const out = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) out[i] = bits[i] ? 0 : 1;
  return out;
}

export function bitsToHex(bits) {
  let s = '';
  for (let i = 0; i < bits.length; i += 4) {
    let v = 0;
    for (let j = 0; j < 4; j++) v = (v << 1) | (i + j < bits.length ? bits[i + j] : 0);
    s += v.toString(16);
  }
  return s.toUpperCase();
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** CRC-8, MSB-first, given polynomial and initial value (rtl_433 crc8). */
export function crc8(bytes, len, poly, init) {
  let crc = init & 0xff;
  for (let k = 0; k < len; k++) {
    crc ^= bytes[k];
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? (((crc << 1) ^ poly) & 0xff) : ((crc << 1) & 0xff);
    }
  }
  return crc;
}

/** Byte sum modulo 256 over the first `len` bytes. */
export function sumBytes(bytes, len) {
  let s = 0;
  for (let k = 0; k < len; k++) s += bytes[k];
  return s & 0xff;
}

/** LFSR digest (rtl_433 lfsr_digest8): gen = feedback polynomial, key = initial key. */
export function lfsrDigest8(msg, bytes, gen, key) {
  let sum = 0;
  let k2 = key & 0xff;
  for (let k = 0; k < bytes; k++) {
    for (let i = 8; i > 0; i--) {
      if (msg[k] & (1 << (i - 1))) sum ^= k2;
      k2 = (k2 & 0x80) ? (((k2 << 1) ^ gen) & 0xff) : ((k2 << 1) & 0xff);
    }
  }
  return sum & 0xff;
}

const hex2 = (v) => '0x' + v.toString(16).padStart(2, '0').toUpperCase();

/* ------------------------------------------------------------------ */
/* Acurite 592TXR / Tower sensor (rtl_433 src/devices/acurite.c)        */
/* PWM, fixed period 612 us: short mark 220 us, long mark 408 us.        */
/* Message type 0x04, 7 bytes, byte sum of bytes 0..5 = byte 6.          */
/* Layout: b0 CCII IIII, b1 IIII IIII, b2 pB00 0100, b3 pHHH HHHH,        */
/* b4 p??T TTTT, b5 pTTT TTTT, b6 KKKK KKKK. Temp = (raw - 1000) * 0.1 C.  */
/* ------------------------------------------------------------------ */
const decodeAcurite = (bits) => {
  const out = [];
  const N = 7;
  for (let o = 0; o + N * 8 <= bits.length; o++) {
    const b = bitsToBytes(bits, o, N);
    if ((b[2] & 0x3f) !== 0x04) continue;
    const sumOk = sumBytes(b, 6) === b[6];
    if (!sumOk) continue;
    const id = ((b[0] & 0x3f) << 8) | b[1];
    const humidity = b[3] & 0x7f;
    const tempRaw = ((b[4] & 0x7f) << 7) | (b[5] & 0x7f);
    const tempC = (tempRaw - 1000) * 0.1;
    const checks = [
      { name: 'message type', pass: true, detail: 'low 6 bits of byte 2 = 0x04' },
      { name: 'byte sum', pass: true, detail: `sum(b0..b5) = ${hex2(b[6])}` },
      { name: 'humidity 0..100', pass: humidity <= 100, detail: `${humidity}%` },
    ];
    out.push({
      offset: o,
      ok: checks.every((c) => c.pass),
      checksum: 'byte sum',
      checks,
      fields: [
        { k: 'ID', v: id },
        { k: 'Channel bits (CC)', v: (b[0] >> 6) },
        { k: 'Battery', v: (b[2] & 0x40) === 0 ? 'LOW' : 'OK' },
        { k: 'Temperature', v: `${tempC.toFixed(1)} C` },
        { k: 'Humidity', v: `${humidity} %` },
      ],
      bytes: b,
    });
    break;
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Ambient Weather F007TH (rtl_433 src/devices/ambient_weather.c)       */
/* Manchester, half-bit 500 us. Preamble 0x01 0x45 (12 bits) or the     */
/* inverted variant 0xFD 0x45; the body starts 8 bits after the match.  */
/* Body 6 bytes: model nibble, id, battery/channel/temp-high, temp-low, */
/* humidity, LFSR digest. Temp raw is Fahrenheit * 10 + 400.            */
/* ------------------------------------------------------------------ */
const AMB_PRE = [0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0];
const AMB_PRE_INV = [1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 0, 0];

const matchAt = (bits, p, pat) => pat.every((v, i) => bits[p + i] === v);

const decodeAmbient = (bits) => {
  const out = [];
  for (let p = 0; p + 56 <= bits.length; p++) {
    const inverted = matchAt(bits, p, AMB_PRE_INV);
    if (!inverted && !matchAt(bits, p, AMB_PRE)) continue;
    const src = inverted ? invertBits(bits) : bits;
    const b = bitsToBytes(src, p + 8, 6);
    const digest = lfsrDigest8(b, 5, 0x98, 0x3e) ^ 0x64;
    if (digest !== b[5]) continue;
    const tempRaw = ((b[2] & 0x0f) << 8) | b[3];
    const tempF = (tempRaw - 400) * 0.1;
    const tempC = (tempF - 32) * 5 / 9;
    const humidity = b[4];
    const checks = [
      { name: 'preamble', pass: true, detail: inverted ? 'inverted 0xFD 0x45' : '0x01 0x45' },
      { name: 'LFSR digest8', pass: true, detail: `poly 0x98, key 0x3e, xor 0x64 = ${hex2(b[5])}` },
      { name: 'humidity 0..100', pass: humidity <= 100, detail: `${humidity}%` },
      { name: 'temperature range', pass: tempF >= -40 && tempF < 344, detail: `${tempF.toFixed(1)} F` },
    ];
    out.push({
      offset: p,
      ok: checks.every((c) => c.pass),
      checksum: 'LFSR digest8',
      checks,
      fields: [
        { k: 'Model nibble', v: b[0] & 0x0f },
        { k: 'ID', v: b[1] },
        { k: 'Battery', v: (b[2] & 0x80) ? 'LOW' : 'OK' },
        { k: 'Channel', v: ((b[2] & 0x70) >> 4) + 1 },
        { k: 'Temperature', v: `${tempC.toFixed(1)} C (${tempF.toFixed(1)} F)` },
        { k: 'Humidity', v: `${humidity} %` },
      ],
      bytes: b,
    });
    break;
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Fine Offset WH2 (rtl_433 src/devices/fineoffset.c, fineoffset_WH2)   */
/* PWM: short 544 us, long 1524 us, fixed gap 1036 us. 0xFF preamble,    */
/* 40 bits of body: type nibble 4, id, temperature (sign-magnitude,       */
/* 0.1 C), humidity, CRC-8 poly 0x31 init 0 over bytes 0..3.             */
/* ------------------------------------------------------------------ */
const decodeFineOffsetWH2 = (bits) => {
  const out = [];
  for (let p = 0; p + 48 <= bits.length; p++) {
    let pre = true;
    for (let i = 0; i < 8; i++) if (!bits[p + i]) { pre = false; break; }
    if (!pre) continue;
    const b = bitsToBytes(bits, p + 8, 5);
    if ((b[0] >> 4) !== 4) continue;
    const crcOk = crc8(b, 4, 0x31, 0) === b[4];
    if (!crcOk) continue;
    const id = ((b[0] & 0x0f) << 4) | ((b[1] & 0xf0) >> 4);
    let temp = ((b[1] & 0x0f) << 8) | b[2];
    if (temp & 0x800) temp = -(temp & 0x7ff);
    const tempC = temp * 0.1;
    const humidity = b[3];
    const checks = [
      { name: 'preamble 0xFF', pass: true, detail: '8 ones before body' },
      { name: 'type nibble', pass: true, detail: 'high nibble of byte 0 = 4' },
      { name: 'CRC-8 poly 0x31', pass: true, detail: `${hex2(b[4])} matches` },
      { name: 'humidity 0..100', pass: humidity <= 100 || humidity === 0xff, detail: humidity === 0xff ? 'no sensor' : `${humidity}%` },
    ];
    out.push({
      offset: p,
      ok: checks.every((c) => c.pass),
      checksum: 'CRC-8 0x31',
      checks,
      fields: [
        { k: 'ID', v: id },
        { k: 'Temperature', v: `${tempC.toFixed(1)} C` },
        { k: 'Humidity', v: humidity === 0xff ? 'n/a' : `${humidity} %` },
      ],
      bytes: b,
    });
    break;
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Nexus / Rubicson temperature (rtl_433 src/devices/nexus.c)           */
/* PPM: mark ~500 us, gap 1000 us = 0, 2000 us = 1, 36-bit frame.       */
/* Nine nibbles: id0 id1 flags temp0 temp1 temp2 const(F) humi0 humi1.   */
/* rtl_433 has no checksum here; the constant nibble, humidity range and  */
/* a CRC-8 false-positive filter are the only checks.                     */
/* ------------------------------------------------------------------ */
const decodeNexus = (bits) => {
  if (bits.length < 36 || bits.length > 37) return [];
  const n = bitsToNibbles(bits, 0, 9);
  const out = [];
  const constOk = n[6] === 0xf;
  const humidity = (n[7] << 4) | n[8];
  // rtl_433 rejects frames whose CRC-8 comes out zero (Rubicson / EMOS false positives)
  // rtl_433 crc_in: bytes 0..2 as-is, byte 3 = const nibble << 4, byte 4 = humi0 << 4 | humi1
  const crcIn = Uint8Array.from([(n[0] << 4) | n[1], (n[2] << 4) | n[3], (n[4] << 4) | n[5], n[6] << 4, (n[7] << 4) | n[8]]);
  const v = ((n[3] << 12) | (n[4] << 8) | (n[5] << 4)) << 16 >> 16;
  const tempC = (v >> 4) * 0.1;
  const checks = [
    { name: 'constant nibble 0xF', pass: constOk, detail: `nibble 6 = ${n[6].toString(16)}` },
    { name: 'humidity 0..100 (0 = thermo only)', pass: humidity <= 100, detail: `${humidity}` },
    { name: 'not a Rubicson CRC frame', pass: crc8(crcIn, 5, 0x31, 0x6c) !== 0, detail: 'CRC-8 0x31 init 0x6c' },
  ];
  out.push({
    offset: 0,
    ok: checks.every((c) => c.pass),
    checksum: 'structural (no checksum in protocol)',
    checks,
    fields: [
      { k: 'ID', v: (n[0] << 4) | n[1] },
      { k: 'Battery', v: (n[2] & 0x8) ? 'OK' : 'LOW' },
      { k: 'Test', v: (n[2] & 0x4) ? 'yes' : 'no' },
      { k: 'Channel', v: (n[2] & 0x3) + 1 },
      { k: 'Temperature', v: `${tempC.toFixed(1)} C` },
      { k: 'Humidity', v: humidity === 0 ? 'thermo only' : `${humidity} %` },
    ],
    bytes: null,
  });
  return out;
};

/* ------------------------------------------------------------------ */
/* Prologue temperature/humidity (rtl_433 src/devices/prologue.c)       */
/* PPM as implemented here: mark ~500 us, gap 2000 us = 0, 4000 us = 1  */
/* (threshold 3000 us). 36-bit frame: type (9 or 5), id, flags, temp    */
/* (12-bit signed, 0.1 C), humidity (0xCC = no sensor).                 */
/* rtl_433 has no checksum for this frame; checks are structural.       */
/* ------------------------------------------------------------------ */
const decodePrologue = (bits) => {
  if (bits.length < 36 || bits.length > 37) return [];
  const n = bitsToNibbles(bits, 0, 9);
  const v = ((n[4] << 12) | (n[5] << 8) | (n[6] << 4)) << 16 >> 16;
  const tempC = (v >> 4) * 0.1;
  const humidity = (n[7] << 4) | n[8];
  const type = n[0];
  const checks = [
    { name: 'type nibble 0x9 or 0x5', pass: type === 0x9 || type === 0x5, detail: `0x${type.toString(16)}` },
    { name: 'humidity 0..100 or 0xCC', pass: humidity <= 100 || humidity === 0xcc, detail: humidity === 0xcc ? 'no sensor' : `${humidity}` },
  ];
  return [{
    offset: 0,
    ok: checks.every((c) => c.pass),
    checksum: 'structural (no checksum in protocol)',
    checks,
    fields: [
      { k: 'Type', v: `0x${type.toString(16)}` },
      { k: 'ID', v: (n[1] << 4) | n[2] },
      { k: 'Battery', v: (n[3] & 0x8) ? 'OK' : 'LOW' },
      { k: 'Button', v: (n[3] & 0x4) ? 'pressed' : 'no' },
      { k: 'Channel', v: (n[3] & 0x3) + 1 },
      { k: 'Temperature', v: `${tempC.toFixed(1)} C` },
      { k: 'Humidity', v: humidity === 0xcc ? 'n/a' : `${humidity} %` },
    ],
    bytes: null,
  }];
};

/* ------------------------------------------------------------------ */
/* EV1527 / PT2262 style 24-bit remote code (generic, not from rtl_433)  */
/* PWM: '0' = high 320 us, '1' = high 960 us, period 1280 us, sync gap   */
/* long. Slicer threshold 640 us, inverted so that a long mark = 1.       */
/* These chips carry no checksum: the 24-bit code is reported as-is and   */
/* is marked unverified.                                                  */
/* ------------------------------------------------------------------ */
const decodeEv1527 = (bits) => {
  if (bits.length < 24 || bits.length > 25) return [];
  const b = bitsToBytes(bits, 0, 3);
  const code = (b[0] << 16) | (b[1] << 8) | b[2];
  return [{
    offset: 0,
    ok: true,
    checksum: 'none (unverified 24-bit code)',
    checks: [{ name: 'length 24 bits', pass: true, detail: `${bits.length} bits in row` }],
    fields: [
      { k: '24-bit code', v: '0x' + code.toString(16).padStart(6, '0').toUpperCase() },
      { k: 'Binary', v: Array.from(bits.slice(0, 24)).join('') },
    ],
    bytes: b,
  }];
};

/**
 * Device table. `modulation` and the timing fields drive how the pipeline slices
 * pulses into rows before `decode` is called.
 */
export const ISM_DEVICES = [
  {
    id: 'acurite-txr',
    name: 'Acurite 592TXR / Tower (type 0x04)',
    band: '433.92 MHz',
    modulation: 'pwm',
    thresholdUs: 314,
    invert: true,
    resetUs: 2500,
    decode: decodeAcurite,
  },
  {
    id: 'ambient-f007th',
    name: 'Ambient Weather F007TH',
    band: '433.92 MHz',
    modulation: 'manchester',
    halfBitUs: 500,
    invert: false,
    resetUs: 5000,
    decode: decodeAmbient,
  },
  {
    id: 'fineoffset-wh2',
    name: 'Fine Offset WH2 / WH2A',
    band: '433.92 MHz',
    modulation: 'pwm',
    thresholdUs: 1034,
    invert: false,
    resetUs: 2000,
    decode: decodeFineOffsetWH2,
  },
  {
    id: 'nexus-temp',
    name: 'Nexus / Rubicson temperature',
    band: '433.92 MHz',
    modulation: 'ppm',
    thresholdUs: 1500,
    invert: false,
    resetUs: 3500,
    decode: decodeNexus,
  },
  {
    id: 'prologue',
    name: 'Prologue temperature / humidity',
    band: '433.92 MHz',
    modulation: 'ppm',
    thresholdUs: 3000,
    invert: false,
    resetUs: 7000,
    decode: decodePrologue,
  },
  {
    id: 'ev1527',
    name: 'EV1527 / PT2262 24-bit remote',
    band: '315 / 433.92 MHz',
    modulation: 'pwm',
    thresholdUs: 640,
    invert: true,
    resetUs: 5000,
    decode: decodeEv1527,
  },
];
