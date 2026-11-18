/**
 * rtlSdr.js — RTL-SDR receiver facade: RTL2832U demod + R820T/R828D tuner over a transport.
 *
 * Ties together rtlSdr/rtl2832u.js (baseband, IF, resampler, AGC), rtlSdr/r820t.js
 * (tuner) and rtlSdr/webusb.js (transport). Everything here takes an injected
 * transport, so the start-up and tuning sequences are unit-tested with a fake bus.
 *
 * Attribution: the tuner and demod ports are from librtlsdr (GPL-2.0-or-later) and
 * jtarrio/webrtlsdr (Apache-2.0); see the headers of rtlSdr/r820t.js and
 * rtlSdr/rtl2832u.js.
 */
import { Rtl2832u, isValidSampleRate } from './rtlSdr/rtl2832u.js';
import { R820T, R82XX_IF_HZ, RTL_XTAL_HZ } from './rtlSdr/r820t.js';

export { isValidSampleRate } from './rtlSdr/rtl2832u.js';
export { R820T, R82XX_IF_HZ, RTL_XTAL_HZ } from './rtlSdr/r820t.js';
export { u8ToInt8, u8ToFloat, IqRecorder, cu8FileName } from './rtlSdr/iq.js';
export { RtlSdrWebUsb, RTL_SDR_USB_FILTERS, isWebUsbAvailable } from './rtlSdr/webusb.js';

/** Frequency-correction model: the crystal value used in all PLL/IF/rate maths is scaled by ppm. */
export function xtalWithPpm(ppm, baseHz = RTL_XTAL_HZ) {
  return Math.round(baseHz * (1 + (Number(ppm) || 0) / 1e6));
}

/**
 * Receiver: owns the transport, the demod and the tuner. All methods are async;
 * tuning calls wrap the tuner I/O in the I2C repeater, like librtlsdr does.
 */
export class RtlSdrReceiver {
  /** @param {{ctrlOut:Function, ctrlIn:Function, bulkRead:Function, open?:Function, close?:Function}} transport */
  constructor(transport) {
    this.transport = transport;
    this.demod = new Rtl2832u(transport);
    this.tuner = null;
    this.ppm = 0;
    this.xtalHz = RTL_XTAL_HZ;
    this.centerHz = 0;
    this.sampleRate = 0;
    this.streaming = false;
    this.opened = false;
  }

  /** Bring the dongle up: baseband, IF, tuner init. Call after the device is opened. */
  async open() {
    if (this.transport.open) await this.transport.open();
    this.xtalHz = xtalWithPpm(this.ppm);
    this.tuner = new R820T(
      {
        i2cWrite: (addr, bytes) => this.demod.i2cWrite(addr, bytes),
        i2cRead: (addr, len) => this.demod.i2cRead(addr, len),
      },
      { xtalHz: this.xtalHz }
    );
    await this.demod.init();
    await this.demod.setIfFrequency(R82XX_IF_HZ, this.xtalHz);
    await this.demod.openI2C();
    try {
      this.tunerProbe = await this.tuner.probe();
      await this.tuner.init();
    } finally {
      await this.demod.closeI2C();
    }
    this.opened = true;
  }

  /** Re-apply the crystal (after a ppm change): IF, PLL reference and current rate/frequency. */
  async applyCorrection(ppm) {
    this.ppm = Number(ppm) || 0;
    this.xtalHz = xtalWithPpm(this.ppm);
    this.tuner.setXtal(this.xtalHz);
    await this.demod.setIfFrequency(R82XX_IF_HZ, this.xtalHz);
    if (this.sampleRate) await this.demod.setSampleRate(this.sampleRate, this.xtalHz);
    if (this.centerHz) await this.tune(this.centerHz);
  }

  async setSampleRate(rate) {
    if (!isValidSampleRate(rate)) throw new Error(`Unsupported sample rate ${rate}`);
    await this.demod.setSampleRate(rate, this.xtalHz);
    this.sampleRate = rate;
    return rate;
  }

  /** Tune the tuner to `hz` (LO = hz + IF). Throws if the PLL does not lock. */
  async tune(hz) {
    await this.demod.openI2C();
    try {
      await this.tuner.setFrequency(hz);
    } finally {
      await this.demod.closeI2C();
    }
    this.centerHz = hz;
    return hz;
  }

  /** Manual gain in tenths of a dB (e.g. 496 = 49.6 dB), or null for the tuner's automatic gain. */
  async setGain(gainTenths) {
    await this.demod.openI2C();
    try {
      if (gainTenths === null || gainTenths === undefined) await this.tuner.setGain(false, 0);
      else await this.tuner.setGain(true, Math.round(gainTenths));
    } finally {
      await this.demod.closeI2C();
    }
  }

  setRtlAgc(on) {
    return this.demod.setRtlAgc(!!on);
  }

  /**
   * Stream unsigned 8-bit IQ to `onChunk(Uint8Array)` until stopStreaming() or a
   * transport error. Resolves when the loop ends.
   */
  async startStreaming(onChunk) {
    if (this.streaming) return;
    this.streaming = true;
    await this.demod.resetBuffer();
    try {
      while (this.streaming) {
        const bytes = await this.transport.bulkRead();
        if (bytes && bytes.length) onChunk(bytes);
      }
    } finally {
      this.streaming = false;
    }
  }

  stopStreaming() {
    this.streaming = false;
  }

  async close() {
    this.streaming = false;
    try {
      if (this.tuner) {
        await this.demod.openI2C();
        try { await this.tuner.standby(); } finally { await this.demod.closeI2C(); }
      }
    } catch { /* device may already be gone */ }
    if (this.transport.close) await this.transport.close();
    this.opened = false;
  }
}
