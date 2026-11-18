/**
 * rtl2832u.js — Realtek RTL2832U demodulator / USB bridge register layer for RTL-SDR.
 *
 * Wire encoding follows librtlsdr (src/librtlsdr.c, GPL-2.0-or-later, Copyright
 * (C) 2012-2013 Steve Markgraf and Hoernchen, and contributors): control transfers
 * with request 0, `value` = register address, `index` = block/page selector,
 * big-endian data; the I2C repeater is demod page 1 register 0x01; demod writes
 * are followed by a dummy read of page 0x0a.
 *
 * The baseband initialisation register list (INIT_SEQUENCE), the IF/sample-rate
 * register maths and the DAGC register values are taken from jtarrio/webrtlsdr
 * (src/rtlsdr/rtl2832u.ts, Apache License 2.0, Copyright Jacobo Tarrio) and
 * cross-checked against librtlsdr's behaviour described in its source.
 *
 * `transport` must provide:
 *   ctrlOut(value, index, bytes: Uint8Array) -> Promise<void>
 *   ctrlIn(value, index, len)               -> Promise<Uint8Array>
 * so this file runs (and is tested) without WebUSB.
 */

export const BLOCK_DEMOD = 0;
export const BLOCK_USB = 1;
export const BLOCK_SYS = 2;
export const BLOCK_IIC = 6;

export const USB_SYSCTL = 0x2000;
export const USB_EPA_CTL = 0x2148;
export const DEMOD_CTL_1 = 0x300b;
export const DEMOD_CTL = 0x3000;

/** Valid sample-rate ranges in Hz (librtlsdr rtlsdr_set_sample_rate). */
export const SAMPLE_RATE_RANGES = Object.freeze([[225001, 300000], [900001, 3200000]]);

/** Ordered baseband init writes (from webrtlsdr RTL2832U._init). [kind, block|page, addr, value, len] */
export const INIT_SEQUENCE = Object.freeze([
  ['usb', 0x2000, 0b00001001, 1],
  ['usb', 0x2158, 0x0200, 2],
  ['usb', 0x2148, 0b0000001000010000, 2],
  ['sys', 0x300b, 0b00100010, 1],
  ['sys', 0x3000, 0b11101000, 1],
  ['demod', 1, 0x01, 0b00010100, 1],
  ['demod', 1, 0x01, 0b00010000, 1],
  ['demod', 1, 0x15, 0b00000000, 1],
  ['demod', 1, 0x16, 0x00, 1],
  ['demod', 1, 0x17, 0x00, 1],
  ['demod', 1, 0x18, 0x00, 1],
  ['demod', 1, 0x19, 0x00, 1],
  ['demod', 1, 0x1a, 0x00, 1],
  ['demod', 1, 0x1b, 0x00, 1],
  // Channel FIR coefficients (8 x 8-bit, then 8 x 12-bit packed).
  ['demod', 1, 0x1c, 0xca, 1],
  ['demod', 1, 0x1d, 0xdc, 1],
  ['demod', 1, 0x1e, 0xd7, 1],
  ['demod', 1, 0x1f, 0xd8, 1],
  ['demod', 1, 0x20, 0xe0, 1],
  ['demod', 1, 0x21, 0xf2, 1],
  ['demod', 1, 0x22, 0x0e, 1],
  ['demod', 1, 0x23, 0x35, 1],
  ['demod', 1, 0x24, 0x06, 1],
  ['demod', 1, 0x25, 0x50, 1],
  ['demod', 1, 0x26, 0x9c, 1],
  ['demod', 1, 0x27, 0x0d, 1],
  ['demod', 1, 0x28, 0x71, 1],
  ['demod', 1, 0x29, 0x11, 1],
  ['demod', 1, 0x2a, 0x14, 1],
  ['demod', 1, 0x2b, 0x71, 1],
  ['demod', 1, 0x2c, 0x74, 1],
  ['demod', 1, 0x2d, 0x19, 1],
  ['demod', 1, 0x2e, 0x41, 1],
  ['demod', 1, 0x2f, 0xa5, 1],
  ['demod', 0, 0x19, 0b00000101, 1],
  ['demod', 1, 0x93, 0b11110000, 1],
  ['demod', 1, 0x94, 0b00001111, 1],
  ['demod', 1, 0x11, 0b00000000, 1],
  ['demod', 1, 0x04, 0b00000000, 1],
  ['demod', 0, 0x61, 0b01100000, 1],
  ['demod', 0, 0x06, 0b10000000, 1],
  ['demod', 1, 0xb1, 0b00011011, 1],
  ['demod', 0, 0x0d, 0b10000011, 1],
]);

/** Big-endian bytes of `val` in `len` bytes. */
export function beBytes(val, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[len - 1 - i] = (val >> (8 * i)) & 0xff;
  return out;
}

/** True when `hz` is a sample rate the RTL2832U resampler accepts. */
export function isValidSampleRate(hz) {
  return Number.isFinite(hz) && SAMPLE_RATE_RANGES.some(([lo, hi]) => hz >= lo && hz <= hi);
}

/**
 * Resampler ratio register value (librtlsdr / webrtlsdr setSampleRate):
 * floor(xtal * 2^22 / rate) & 0x0ffffffc.
 */
export function resamplerRatio(rate, xtalHz) {
  const raw = Math.floor((xtalHz * 4194304) / rate);
  return Number(BigInt(raw) & 0x0ffffffcn);
}

/** IF multiplier register value (librtlsdr / webrtlsdr setIfFrequency): -floor(ifHz * 2^22 / xtal). */
export function ifMultiplier(ifHz, xtalHz) {
  return -Math.floor((ifHz * 4194304) / xtalHz);
}

export class Rtl2832u {
  constructor(transport) {
    this.t = transport;
  }

  // ---- raw register access ----

  /** Write a USB or SYS block register (librtlsdr rtlsdr_write_reg). */
  async regWrite(block, addr, val, len) {
    await this.t.ctrlOut(addr, (block << 8) | 0x10, beBytes(val, len));
  }

  usbWrite(addr, val, len) { return this.regWrite(BLOCK_USB, addr, val, len); }
  sysWrite(addr, val, len) { return this.regWrite(BLOCK_SYS, addr, val, len); }

  /** Demodulator page write (librtlsdr rtlsdr_demod_write_reg), followed by the dummy read. */
  async demodWrite(page, addr, val, len) {
    await this.t.ctrlOut((addr << 8) | 0x20, 0x10 | page, beBytes(val, len));
    await this.demodRead(0x0a, 0x01, 1);
  }

  async demodRead(page, addr, len) {
    return this.t.ctrlIn((addr << 8) | 0x20, page, len);
  }

  async i2cWrite(i2cAddr, bytes) {
    await this.t.ctrlOut(i2cAddr, (BLOCK_IIC << 8) | 0x10, bytes);
  }

  async i2cRead(i2cAddr, len) {
    return this.t.ctrlIn(i2cAddr, BLOCK_IIC << 8, len);
  }

  /** Enable the I2C repeater so the tuner is reachable (demod page 1, reg 0x01 = 0x18). */
  openI2C() { return this.demodWrite(1, 0x01, 0x18, 1); }
  /** Disable the I2C repeater (demod page 1, reg 0x01 = 0x10). */
  closeI2C() { return this.demodWrite(1, 0x01, 0x10, 1); }

  /** Soft reset of the demodulator (librtlsdr: page 1 reg 0x01 = 0x14 then 0x10). */
  async resetDemod() {
    await this.demodWrite(1, 0x01, 0x14, 1);
    await this.demodWrite(1, 0x01, 0x10, 1);
  }

  // ---- startup and tuning ----

  /** Baseband power-up and register defaults, in webrtlsdr/librtlsdr order. */
  async init() {
    for (const step of INIT_SEQUENCE) {
      const [kind, a, b, c, d] = step;
      if (kind === 'usb') await this.usbWrite(a, b, c);
      else if (kind === 'sys') await this.sysWrite(a, b, c);
      else await this.demodWrite(a, b, c, d);
    }
  }

  /** Digital down-converter IF (demod page 1, regs 0x19..0x1b). Returns nothing; throws on transport error. */
  async setIfFrequency(ifHz, xtalHz) {
    const m = ifMultiplier(ifHz, xtalHz);
    await this.demodWrite(1, 0x19, (m >> 16) & 0x3f, 1);
    await this.demodWrite(1, 0x1a, (m >> 8) & 0xff, 1);
    await this.demodWrite(1, 0x1b, m & 0xff, 1);
  }

  /** Resampler ratio (demod page 1, regs 0x9f/0xa1), then a demod reset. Returns the real rate. */
  async setSampleRate(rate, xtalHz) {
    if (!isValidSampleRate(rate)) throw new Error(`Unsupported RTL-SDR sample rate: ${rate}`);
    const ratio = resamplerRatio(rate, xtalHz);
    await this.demodWrite(1, 0x9f, (ratio >> 16) & 0xffff, 2);
    await this.demodWrite(1, 0xa1, ratio & 0xffff, 2);
    await this.resetDemod();
    return Math.floor((xtalHz * 4194304) / ratio);
  }

  /** RTL2832U digital AGC (demod page 0 reg 0x19: 0x25 on, 0x05 off). */
  setRtlAgc(on) {
    return this.demodWrite(0, 0x19, on ? 0x25 : 0x05, 1);
  }

  /** Clear the bulk IN endpoint FIFO before streaming (librtlsdr rtlsdr_reset_buffer). */
  async resetBuffer() {
    await this.usbWrite(USB_EPA_CTL, 0x1002, 2);
    await this.usbWrite(USB_EPA_CTL, 0x0000, 2);
  }
}
