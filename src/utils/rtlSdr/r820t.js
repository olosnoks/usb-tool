/**
 * r820t.js — Rafael Micro R820T / R820T2 / R828D tuner driver for RTL-SDR dongles.
 *
 * Ported from librtlsdr's src/tuner_r82xx.c (GPL-2.0-or-later, Copyright (C) 2013
 * Mauro Carvalho Chehab and Steve Markgraf). The register tables, frequency
 * ranges, gain step tables, PLL/mux/filter/AGC sequences and the shadow-register
 * behaviour follow that file; the RTL-SDR Blog V4 upconverter branches are NOT
 * ported (generic dongle path only).
 *
 * The register I/O is injected: `io.i2cWrite(addr, bytes)` and
 * `io.i2cRead(addr, len)` must already have the RTL2832U I2C repeater open
 * (see rtl2832u.js openI2C/closeI2C). That keeps this file free of USB and
 * testable with a fake bus.
 *
 * Register-level values are the 8-bit "address" form librtlsdr passes to its
 * I2C helpers (R820T 0x34, R828D 0x74).
 */

export const R820T_I2C_ADDR = 0x34;
export const R828D_I2C_ADDR = 0x74;
export const R82XX_CHECK_ADDR = 0x00;
export const R82XX_CHECK_VAL = 0x69;

/** Intermediate frequency the tuner outputs for the RTL2832U to mix down (3.57 MHz). */
export const R82XX_IF_HZ = 3570000;
/** Default RTL2832U reference crystal (Hz). */
export const RTL_XTAL_HZ = 28800000;

const REG_SHADOW_START = 0x05;
const NUM_REGS = 32;
const VER_NUM = 49;
const FILT_CAL_LO_KHZ = 56000;
const VCO_MIN_KHZ = 1770000;
const VCO_MAX_KHZ = VCO_MIN_KHZ * 2;

export const TUNER_ANALOG_TV = 0;
export const TUNER_RADIO = 1;
export const TUNER_DIGITAL_TV = 2;

export const SYS_DVBT = 1;
export const SYS_DVBT2 = 2;
export const SYS_ISDBT = 3;

const XTAL_HIGH_CAP_0P = 0;

/** Register 0x05..0x24 defaults (librtlsdr r82xx_init_array, zero-padded to NUM_REGS). */
export const INIT_ARRAY = Uint8Array.from([
  0x83, 0x32, 0x75,             // 05 to 07
  0xc0, 0x40, 0xd6, 0x6c,       // 08 to 0b
  0xf5, 0x63, 0x75, 0x68,       // 0c to 0f
  0x6c, 0x83, 0x80, 0x00,       // 10 to 13
  0x0f, 0x00, 0xc0, 0x30,       // 14 to 17
  0x48, 0xcc, 0x60, 0x00,       // 18 to 1b
  0x54, 0xae, 0x4a, 0xc0,       // 1c to 1f
  0, 0, 0, 0,                   // 20 to 23 (not listed upstream; zero)
  0,                            // 24
]);

/**
 * Frequency ranges for the RF mux / tracking filter / XTAL cap (librtlsdr freq_ranges[]).
 * `freq` is the range start in MHz; the range applies until the next entry's start.
 */
export const FREQ_RANGES = Object.freeze([
  { freq: 0,   openD: 0x08, rfMuxPoly: 0x02, tfC: 0xdf, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 50,  openD: 0x08, rfMuxPoly: 0x02, tfC: 0xbe, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 55,  openD: 0x08, rfMuxPoly: 0x02, tfC: 0x8b, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 60,  openD: 0x08, rfMuxPoly: 0x02, tfC: 0x7b, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 65,  openD: 0x08, rfMuxPoly: 0x02, tfC: 0x69, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 70,  openD: 0x08, rfMuxPoly: 0x02, tfC: 0x58, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 75,  openD: 0x00, rfMuxPoly: 0x02, tfC: 0x44, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 80,  openD: 0x00, rfMuxPoly: 0x02, tfC: 0x44, xtalCap20p: 0x02, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 90,  openD: 0x00, rfMuxPoly: 0x02, tfC: 0x34, xtalCap20p: 0x01, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 100, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x34, xtalCap20p: 0x01, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 110, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x24, xtalCap20p: 0x01, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 120, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x24, xtalCap20p: 0x01, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 140, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x14, xtalCap20p: 0x01, xtalCap10p: 0x01, xtalCap0p: 0x00 },
  { freq: 180, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x13, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
  { freq: 220, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x13, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
  { freq: 250, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x11, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
  { freq: 280, openD: 0x00, rfMuxPoly: 0x02, tfC: 0x00, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
  { freq: 310, openD: 0x00, rfMuxPoly: 0x41, tfC: 0x00, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
  { freq: 450, openD: 0x00, rfMuxPoly: 0x41, tfC: 0x00, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
  { freq: 588, openD: 0x00, rfMuxPoly: 0x40, tfC: 0x00, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
  { freq: 650, openD: 0x00, rfMuxPoly: 0x40, tfC: 0x00, xtalCap20p: 0x00, xtalCap10p: 0x00, xtalCap0p: 0x00 },
]);

/**
 * Gain step tables in tenths of a dB (librtlsdr, measured with a GSM test set).
 * Index 0 is the "minimum" entry, so a total gain is the sum of the entries up to
 * the chosen LNA / mixer index.
 */
export const LNA_GAIN_STEPS = Object.freeze([0, 9, 13, 40, 38, 13, 31, 22, 26, 31, 26, 14, 19, 5, 35, 13]);
export const MIXER_GAIN_STEPS = Object.freeze([0, 5, 10, 10, 19, 9, 10, 25, 17, 10, 8, 16, 13, 6, 3, -8]);
export const VGA_GAIN_STEPS = Object.freeze([0, 26, 26, 30, 42, 35, 24, 13, 14, 32, 36, 34, 35, 37, 35, 36]);

/** Reverse the bit order of one byte (the R820T returns status bytes bit-reversed). */
export function bitrev(byte) {
  const lut = [0x0, 0x8, 0x4, 0xc, 0x2, 0xa, 0x6, 0xe, 0x1, 0x9, 0x5, 0xd, 0x3, 0xb, 0x7, 0xf];
  return ((lut[byte & 0xf] << 4) | lut[(byte >> 4) & 0xf]) & 0xff;
}

const maskReg8 = (reg, val, mask) => ((reg & ~mask) | (val & mask)) & 0xff;

/** Index of the FREQ_RANGES entry for an RF frequency in MHz (librtlsdr r82xx_set_mux loop). */
export function freqRangeIndex(freqMHz) {
  let i;
  for (i = 0; i < FREQ_RANGES.length - 1; i++) {
    if (freqMHz < FREQ_RANGES[i + 1].freq) break;
  }
  return i;
}

/**
 * Pure PLL solver: the divider, integer N and fractional SDM for an LO frequency
 * (librtlsdr r82xx_set_pll). `baseRegs` are the cached values of registers
 * 0x10..0x16 (7 bytes); the returned `regs` are what gets written to 0x10..0x16.
 *
 * vco_fine_tune is normally read back from the tuner (status register 0x04 bits 5:4).
 * The default of 2 equals vco_power_ref, so no divider correction is applied.
 */
export function computePll(loHz, xtalHz, baseRegs, { vcoFineTune = 2, vcoPowerRef = 2 } = {}) {
  const regs = Uint8Array.from(baseRegs);
  const freqKhz = Math.floor((loHz + 500) / 1000);

  regs[0] = maskReg8(regs[0], 0, 0x10);      // refdiv2 = 0
  regs[2] = maskReg8(regs[2], 0x80, 0xe0);   // VCO current = 100

  // Find the mixer divider that puts the VCO in [1770, 3540) MHz.
  let mixDiv = 2;
  let found = false;
  let divNum = 0;
  for (; mixDiv <= 64; mixDiv <<= 1) {
    if (freqKhz * mixDiv >= VCO_MIN_KHZ && freqKhz * mixDiv < VCO_MAX_KHZ) {
      let divBuf = mixDiv;
      while (divBuf > 2) { divBuf >>= 1; divNum++; }
      found = true;
      break;
    }
  }
  if (!found) throw new Error(`R820T: no VCO divider for ${loHz} Hz`);

  if (vcoFineTune > vcoPowerRef) divNum -= 1;
  else if (vcoFineTune < vcoPowerRef) divNum += 1;
  regs[0] = maskReg8(regs[0], divNum << 5, 0xe0);

  // vco_div = int((pll_ref + 65536 * vco_freq) / (2 * pll_ref)); nint = vco_div / 65536, sdm = vco_div % 65536.
  const vcoFreq = BigInt(loHz) * BigInt(mixDiv);
  const pllRef = BigInt(xtalHz);
  const vcoDiv = (pllRef + 65536n * vcoFreq) / (2n * pllRef);
  const nint = Number(vcoDiv / 65536n);
  const sdm = Number(vcoDiv % 65536n);

  if (nint > (128 / vcoPowerRef) - 1) throw new Error(`R820T: no valid PLL values for ${loHz} Hz`);

  const ni = Math.floor((nint - 13) / 4);
  const si = nint - 4 * ni - 13;
  regs[4] = (ni + (si << 6)) & 0xff;

  regs[2] = maskReg8(regs[2], sdm === 0 ? 0x08 : 0x00, 0x08);   // pw_sdm
  regs[5] = sdm & 0xff;
  regs[6] = (sdm >> 8) & 0xff;

  return { regs, mixDiv, divNum, nint, sdm, ni, si, vcoFreqHz: Number(vcoFreq) };
}

/**
 * Gain selection for manual gain (librtlsdr r82xx_set_gain, manual branch).
 * `gainTenths` is the requested total gain in tenths of a dB.
 */
export function manualGainSettings(gainTenths) {
  let totalGain = 0;
  let mixIndex = 0;
  let lnaIndex = 0;
  for (let i = 0; i < 15; i++) {
    if (totalGain >= gainTenths) break;
    totalGain += LNA_GAIN_STEPS[++lnaIndex];
    if (totalGain >= gainTenths) break;
    totalGain += MIXER_GAIN_STEPS[++mixIndex];
  }
  return { lnaIndex, mixIndex, totalGainTenths: totalGain };
}

export class R820T {
  /**
   * @param {{i2cWrite:(addr:number, bytes:Uint8Array)=>Promise<void>, i2cRead:(addr:number, len:number)=>Promise<Uint8Array>}} io
   * @param {{ i2cAddr?: number, xtalHz?: number, chip?: 'R820T'|'R828D' }} [opts]
   */
  constructor(io, { i2cAddr = R820T_I2C_ADDR, xtalHz = RTL_XTAL_HZ, chip = 'R820T' } = {}) {
    this.io = io;
    this.i2cAddr = i2cAddr;
    this.xtalHz = xtalHz;
    this.chip = chip;
    this.maxI2cMsgLen = 8;          // librtlsdr r820t config
    this.usePredetect = false;
    this.regs = new Uint8Array(NUM_REGS);   // shadow registers, index = reg - 0x05
    this.xtalCapSel = XTAL_HIGH_CAP_0P;
    this.hasLock = false;
    this.input = 0;
    this.intFreq = 0;
    this.filCalCode = 0;
    this.initDone = false;
    this.type = null;
    this.delsys = null;
    this.bw = 0;
  }

  setXtal(xtalHz) { this.xtalHz = xtalHz; }

  // ---- shadow-register I/O (r82xx_write / r82xx_read / r82xx_write_reg_mask) ----

  cacheRead(reg) {
    const i = reg - REG_SHADOW_START;
    return i >= 0 && i < NUM_REGS ? this.regs[i] : -1;
  }

  shadowEqual(reg, bytes) {
    for (let i = 0; i < bytes.length; i++) {
      if (this.regs[reg - REG_SHADOW_START + i] !== bytes[i]) return false;
    }
    return true;
  }

  shadowStore(reg, bytes) {
    for (let i = 0; i < bytes.length; i++) this.regs[reg - REG_SHADOW_START + i] = bytes[i];
  }

  async write(reg, bytes) {
    const data = Uint8Array.from(bytes);
    if (this.shadowEqual(reg, data)) return;          // skip unchanged registers, as librtlsdr does
    this.shadowStore(reg, data);
    let pos = 0;
    let len = data.length;
    let r = reg;
    while (len > 0) {
      const size = Math.min(len, this.maxI2cMsgLen - 1);
      const msg = new Uint8Array(size + 1);
      msg[0] = r;
      msg.set(data.subarray(pos, pos + size), 1);
      await this.io.i2cWrite(this.i2cAddr, msg);
      r += size;
      len -= size;
      pos += size;
    }
  }

  writeReg(reg, val) {
    return this.write(reg, [val & 0xff]);
  }

  async writeRegMask(reg, val, mask) {
    const cur = this.cacheRead(reg);
    const v = ((cur & ~mask) | (val & mask)) & 0xff;
    return this.write(reg, [v]);
  }

  /** Read `len` status bytes starting at register `reg`; returns bit-reversed values. */
  async read(reg, len) {
    await this.io.i2cWrite(this.i2cAddr, Uint8Array.of(reg));
    const raw = await this.io.i2cRead(this.i2cAddr, len);
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = bitrev(raw[i]);
    return out;
  }

  // ---- tuner programming ----

  async setPll(freqHz) {
    await this.writeRegMask(0x1a, 0x00, 0x0c);           // PLL autotune = 128 kHz
    const base = this.regs.subarray(0x10 - REG_SHADOW_START, 0x10 - REG_SHADOW_START + 7);
    const data5 = await this.read(0x00, 5);
    const vcoFineTune = (data5[4] & 0x30) >> 4;
    const pll = computePll(freqHz, this.xtalHz, base, {
      vcoFineTune,
      vcoPowerRef: this.chip === 'R828D' ? 1 : 2,
    });
    await this.write(0x10, pll.regs);

    let data3 = null;
    for (let i = 0; i < 2; i++) {
      data3 = await this.read(0x00, 3);                  // check PLL lock
      if (data3[2] & 0x40) break;
      if (!i) await this.writeRegMask(0x12, 0x60, 0xe0); // didn't lock: raise VCO current
    }
    if (!(data3[2] & 0x40)) {
      this.hasLock = false;
      return { locked: false, ...pll };
    }
    this.hasLock = true;
    await this.writeRegMask(0x1a, 0x08, 0x08);          // PLL autotune = 8 kHz
    return { locked: true, ...pll };
  }

  async setMux(freqHz) {
    const range = FREQ_RANGES[freqRangeIndex(Math.floor(freqHz / 1000000))];
    await this.writeRegMask(0x17, range.openD, 0x08);
    await this.writeRegMask(0x1a, range.rfMuxPoly, 0xc3);
    await this.writeReg(0x1b, range.tfC);
    let val;
    switch (this.xtalCapSel) {
      case 1: // XTAL_LOW_CAP_30P
      case 2: // XTAL_LOW_CAP_20P
        val = range.xtalCap20p | 0x08; break;
      case 3: // XTAL_LOW_CAP_10P
        val = range.xtalCap10p | 0x08; break;
      case XTAL_HIGH_CAP_0P:
        val = range.xtalCap0p | 0x00; break;
      default: // XTAL_LOW_CAP_0P
        val = range.xtalCap0p | 0x08; break;
    }
    await this.writeRegMask(0x10, val, 0x0b);
    await this.writeRegMask(0x08, 0x00, 0x3f);
    await this.writeRegMask(0x09, 0x00, 0x3f);
  }

  /**
   * Tune the RF input to `freqHz`. The LO is freq + IF; the R828D also switches its
   * cable/air input at 345 MHz. Throws if the PLL does not lock.
   */
  async setFrequency(freqHz) {
    const loHz = freqHz + this.intFreq;
    await this.setMux(loHz);
    const pll = await this.setPll(loHz);
    if (!pll.locked) throw new Error(`R820T PLL did not lock at ${loHz} Hz`);
    if (this.chip === 'R828D') {
      const air = freqHz > 345000000 ? 0x00 : 0x60;
      if (air !== this.input) {
        this.input = air;
        await this.writeRegMask(0x05, air, 0x60);
      }
    }
    return { loHz, ...pll };
  }

  /** Gain control (librtlsdr r82xx_set_gain). `gainTenths` in tenths of dB. */
  async setGain(manual, gainTenths = 0) {
    if (manual) {
      await this.writeRegMask(0x05, 0x10, 0x10);     // LNA auto off
      await this.writeRegMask(0x07, 0, 0x10);        // mixer auto off
      await this.read(0x00, 4);
      await this.writeRegMask(0x0c, 0x08, 0x9f);     // fixed VGA gain (16.3 dB)
      const s = manualGainSettings(gainTenths);
      await this.writeRegMask(0x05, s.lnaIndex, 0x0f);
      await this.writeRegMask(0x07, s.mixIndex, 0x0f);
      return s;
    }
    await this.writeRegMask(0x05, 0, 0x10);          // LNA auto on
    await this.writeRegMask(0x07, 0x10, 0x10);       // mixer auto on
    await this.writeRegMask(0x0c, 0x0b, 0x9f);       // fixed VGA gain (26.5 dB)
    return null;
  }

  async setTvStandard(bw, type, delsys) {
    const ifKhz = 3570;
    const filtCalLoKhz = FILT_CAL_LO_KHZ;
    const filtGain = 0x10;
    const imgR = 0x00;
    const filtQ = 0x10;
    const hpCor = 0x6b;
    const extEnable = 0x60;
    const loopThrough = 0x01;
    const ltAtt = 0x00;
    const fltExtWidest = 0x00;
    const polyfilCur = 0x60;

    this.regs.set(INIT_ARRAY.subarray(0, NUM_REGS));   // initialise shadow registers
    await this.writeRegMask(0x0c, 0x00, 0x0f);
    await this.writeRegMask(0x13, VER_NUM, 0x3f);
    if (type !== TUNER_ANALOG_TV) await this.writeRegMask(0x1d, 0x00, 0x38);
    this.intFreq = ifKhz * 1000;

    // Filter calibration (always forced, as librtlsdr does on first call).
    for (let i = 0; i < 2; i++) {
      await this.writeRegMask(0x0b, hpCor, 0x60);
      await this.writeRegMask(0x0f, 0x04, 0x04);       // calibration clock on
      await this.writeRegMask(0x10, 0x00, 0x03);       // XTAL cap 0 pF for PLL
      const pll = await this.setPll(filtCalLoKhz * 1000);
      if (!pll.locked) return;                         // librtlsdr returns here without storing the standard
      await this.writeRegMask(0x0b, 0x10, 0x10);       // start trigger
      await this.writeRegMask(0x0b, 0x00, 0x10);       // stop trigger
      await this.writeRegMask(0x0f, 0x00, 0x04);       // calibration clock off
      const data = await this.read(0x00, 5);
      this.filCalCode = data[4] & 0x0f;
      if (this.filCalCode && this.filCalCode !== 0x0f) break;
    }
    if (this.filCalCode === 0x0f) this.filCalCode = 0;

    await this.writeRegMask(0x0a, filtQ | this.filCalCode, 0x1f);
    await this.writeRegMask(0x0b, hpCor, 0xef);
    await this.writeRegMask(0x07, imgR, 0x80);
    await this.writeRegMask(0x06, filtGain, 0x30);
    await this.writeRegMask(0x1e, extEnable, 0x60);
    await this.writeRegMask(0x05, loopThrough, 0x80);
    await this.writeRegMask(0x1f, ltAtt, 0x80);
    await this.writeRegMask(0x0f, fltExtWidest, 0x80);
    await this.writeRegMask(0x19, polyfilCur, 0x60);

    this.delsys = delsys;
    this.type = type;
    this.bw = bw;
  }

  /** LNA/mixer/filter bias sequence for the selected delivery system (librtlsdr r82xx_sysfreq_sel). */
  async sysfreqSel(freqHz, type, delsys) {
    let p;
    switch (delsys) {
      case SYS_DVBT:
        if (freqHz === 506000000 || freqHz === 666000000 || freqHz === 818000000) {
          p = { mixerTop: 0x14, lnaTop: 0xe5, cpCur: 0x28, divBufCur: 0x20 };
        } else {
          p = { mixerTop: 0x24, lnaTop: 0xe5, cpCur: 0x38, divBufCur: 0x30 };
        }
        p = { ...p, lnaVthL: 0x53, mixerVthL: 0x75, air: 0x00, cable2: 0x00, preDect: 0x40, lnaDischarge: 14, filterCur: 0x40 };
        break;
      case SYS_DVBT2:
        p = { mixerTop: 0x24, lnaTop: 0xe5, lnaVthL: 0x53, mixerVthL: 0x75, air: 0x00, cable2: 0x00, preDect: 0x40, lnaDischarge: 14, cpCur: 0x38, divBufCur: 0x30, filterCur: 0x40 };
        break;
      case SYS_ISDBT:
        p = { mixerTop: 0x24, lnaTop: 0xe5, lnaVthL: 0x75, mixerVthL: 0x75, air: 0x00, cable2: 0x00, preDect: 0x40, lnaDischarge: 14, cpCur: 0x38, divBufCur: 0x30, filterCur: 0x40 };
        break;
      default: // DVB-T 8 MHz
        p = { mixerTop: 0x24, lnaTop: 0xe5, lnaVthL: 0x53, mixerVthL: 0x75, air: 0x00, cable2: 0x00, preDect: 0x40, lnaDischarge: 14, cpCur: 0x38, divBufCur: 0x30, filterCur: 0x40 };
        break;
    }

    if (this.usePredetect) await this.writeRegMask(0x06, p.preDect, 0x40);
    await this.writeRegMask(0x1d, p.lnaTop, 0xc7);
    await this.writeRegMask(0x1c, p.mixerTop, 0xf8);
    await this.writeReg(0x0d, p.lnaVthL);
    await this.writeReg(0x0e, p.mixerVthL);

    this.input = p.air;
    await this.writeRegMask(0x05, p.air, 0x60);
    await this.writeRegMask(0x06, p.cable2, 0x08);
    await this.writeRegMask(0x11, p.cpCur, 0x38);
    await this.writeRegMask(0x17, p.divBufCur, 0x30);
    await this.writeRegMask(0x0a, p.filterCur, 0x60);

    if (type !== TUNER_ANALOG_TV) {
      await this.writeRegMask(0x1d, 0, 0x38);          // LNA top lowest
      await this.writeRegMask(0x1c, 0, 0x04);          // normal mode
      await this.writeRegMask(0x06, 0, 0x40);          // pre-detect off
      await this.writeRegMask(0x1a, 0x30, 0x30);       // AGC clock 250 Hz
      await this.writeRegMask(0x1d, 0x18, 0x38);       // LNA top = 3
      await this.writeRegMask(0x1c, p.mixerTop, 0x04); // discharge mode
      await this.writeRegMask(0x1e, p.lnaDischarge, 0x1f);
      await this.writeRegMask(0x1a, 0x20, 0x30);       // AGC clock 60 Hz
    } else {
      await this.writeRegMask(0x06, 0, 0x40);
      await this.writeRegMask(0x1d, p.lnaTop, 0x38);
      await this.writeRegMask(0x1c, p.mixerTop, 0x04);
      await this.writeRegMask(0x1e, p.lnaDischarge, 0x1f);
      await this.writeRegMask(0x1a, 0x00, 0x30);
      await this.writeRegMask(0x10, 0x00, 0x04);
    }
  }

  /**
   * Read the chip-ID register (0x00). A healthy R820T/R828D reads R82XX_CHECK_VAL (0x69).
   * Informational only: the value is reported to the UI, not used to refuse the device.
   */
  async probe() {
    const [id] = await this.read(R82XX_CHECK_ADDR, 1);
    return { chipId: id, looksLikeRafael: id === R82XX_CHECK_VAL };
  }

  /** Full tuner initialisation (librtlsdr r82xx_init, generic dongle path). */
  async init() {
    this.xtalCapSel = XTAL_HIGH_CAP_0P;
    this.regs.fill(0);
    await this.write(0x05, INIT_ARRAY);
    await this.setTvStandard(3, TUNER_DIGITAL_TV, 0);
    await this.sysfreqSel(0, TUNER_DIGITAL_TV, SYS_DVBT);
    this.initDone = true;
  }

  /** Put the tuner into standby (librtlsdr r82xx_standby). */
  async standby() {
    if (!this.initDone) return;
    const seq = [[0x06, 0xb1], [0x05, 0xa0], [0x07, 0x3a], [0x08, 0x40], [0x09, 0xc0], [0x0a, 0x36],
      [0x0c, 0x35], [0x0f, 0x68], [0x11, 0x03], [0x17, 0xf4], [0x19, 0x0c]];
    for (const [reg, val] of seq) await this.writeReg(reg, val);
    this.type = -1;   // force calibration on next init
  }
}
