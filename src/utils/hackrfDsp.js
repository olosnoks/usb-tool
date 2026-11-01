/**
 * hackrfDsp.js — the receive-side DSP core shared by the Web Worker
 * (workers/hackrfDspWorker.js) and the in-thread fallback (hackrfDspClient.js).
 *
 * SpectrumAverager: Hann-windowed FFTs over EVERY sample that arrives between
 * display frames (not one short FFT per buffer), power-averaged, then
 * peak-downsampled to the requested bin count. A full-scale tone reads 0 dBFS.
 * Also reports the median noise floor (smoothed) and the IQ RMS in ADC counts
 * for the AGC.
 *
 * DspCore: owns an averager plus a Demodulator and turns IQ buffers into
 * spectrum frames and squelched audio chunks. Pure JS, no DOM — unit tested.
 */
import { fft } from './fft.js';
import { Demodulator } from './hackrfDemod.js';

export const SPEC_INTERVAL_MS = 33;   // ~30 spectrum frames per second
export const SPEC_RANGE_DB = 40;      // waterfall dynamic range above the floor
export const SPEC_FLOOR_PAD_DB = 4;   // how far below the floor the colormap starts

export class SpectrumAverager {
  constructor({ fftN = 4096, bins = 1024, maxFramesPerPush = 16 } = {}) {
    this.fftN = fftN;
    this.bins = Math.min(bins, fftN);
    this.maxFramesPerPush = maxFramesPerPush;
    this.window = new Float32Array(fftN);
    let sum = 0;
    for (let k = 0; k < fftN; k++) { this.window[k] = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (fftN - 1)); sum += this.window[k]; }
    this.normDb = -20 * Math.log10(sum * 128);   // |X| of a full-scale (128-count) tone = 128·Σw -> 0 dBFS
    this.re = new Float32Array(fftN);
    this.im = new Float32Array(fftN);
    this.acc = new Float32Array(fftN);
    this.count = 0;
    this.carry = new Int8Array(fftN * 2);  // partial frame between pushes
    this.carryLen = 0;
    this.rmsAcc = 0; this.rmsCnt = 0;
    this.floorDb = null;
  }

  /** Accumulate one IQ buffer (Int8Array or DataView of interleaved int8 I,Q). */
  push(iq) {
    const bytes = iq instanceof DataView ? new Int8Array(iq.buffer, iq.byteOffset, iq.byteLength)
      : iq instanceof Int8Array ? iq : new Int8Array(iq.buffer || iq);
    const frameBytes = this.fftN * 2;
    let pos = 0;
    let frames = 0;
    // RMS in ADC counts over a thin subsample (for the AGC).
    for (let i = 0; i + 1 < bytes.length; i += 64) { const I = bytes[i], Q = bytes[i + 1]; this.rmsAcc += I * I + Q * Q; this.rmsCnt++; }
    // Finish a carried partial frame first.
    if (this.carryLen) {
      const need = frameBytes - this.carryLen;
      const take = Math.min(need, bytes.length);
      this.carry.set(bytes.subarray(0, take), this.carryLen);
      this.carryLen += take; pos = take;
      if (this.carryLen < frameBytes) return;
      this._accumulate(this.carry, 0); frames++;
      this.carryLen = 0;
    }
    while (pos + frameBytes <= bytes.length && frames < this.maxFramesPerPush) {
      this._accumulate(bytes, pos); frames++;
      pos += frameBytes;
    }
    // Skip the rest of a long buffer once the frame budget is spent (keeps the
    // worker ahead of the USB stream), but carry a trailing partial frame.
    const rest = bytes.length - pos;
    if (rest > 0 && rest < frameBytes) { this.carry.set(bytes.subarray(pos)); this.carryLen = rest; }
  }

  _accumulate(bytes, off) {
    const N = this.fftN, re = this.re, im = this.im, w = this.window;
    for (let k = 0; k < N; k++) { re[k] = bytes[off + 2 * k] * w[k]; im[k] = bytes[off + 2 * k + 1] * w[k]; }
    fft(re, im);
    const acc = this.acc;
    for (let k = 0; k < N; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    this.count++;
  }

  get hasData() { return this.count > 0; }

  /**
   * Finish the averaging period. Returns { spec, peakDb, floorDb, rmsCounts }
   * with spec = Float32Array(bins) of dBFS, lowest frequency first (DC in the
   * middle), or null if nothing was accumulated. Resets the accumulators.
   */
  frame() {
    if (!this.count) return null;
    const N = this.fftN, bins = this.bins, per = N / bins, half = N >> 1;
    const spec = new Float32Array(bins);
    const scale = 1 / this.count;
    let peak = -Infinity;
    for (let b = 0; b < bins; b++) {
      let pk = 0;
      const start = Math.floor(b * per);
      const end = Math.floor((b + 1) * per);
      for (let k = start; k < end; k++) { const v = this.acc[(k + half) % N]; if (v > pk) pk = v; }   // fftshift + peak pick
      const db = 10 * Math.log10(pk * scale + 1e-12) + this.normDb;
      spec[b] = db;
      if (db > peak) peak = db;
    }
    this.acc.fill(0); this.count = 0;
    // Median of the bins = noise floor; smoothed like RocketGod's floorEma.
    const sorted = Float32Array.from(spec).sort();
    const median = sorted[sorted.length >> 1];
    this.floorDb = this.floorDb === null ? median : this.floorDb + 0.2 * (median - this.floorDb);
    const rmsCounts = this.rmsCnt ? Math.sqrt(this.rmsAcc / (2 * this.rmsCnt)) : 0;
    this.rmsAcc = 0; this.rmsCnt = 0;
    return { spec, peakDb: peak, floorDb: this.floorDb, rmsCounts };
  }
}

/** Default receiver configuration; the UI changes it through configure(). */
export const DEFAULT_DSP_CONFIG = {
  sampleRate: 2000000,
  bins: 1024,
  fftN: 4096,
  mode: 'WFM',
  offsetHz: 0,
  audioOn: false,
  squelchDb: -200,     // dBFS of the channel power; -200 = always open
  audioChunk: 2048
};

export class DspCore {
  constructor(config = {}) {
    this.cfg = { ...DEFAULT_DSP_CONFIG };
    this.averager = null;
    this.demod = null;
    this.lastSpecTs = 0;
    this.audioPending = [];
    this.audioPendingLen = 0;
    this.configure(config);
  }

  configure(partial = {}) {
    const prev = this.cfg;
    const cfg = { ...prev, ...partial };
    this.cfg = cfg;
    if (!this.averager || cfg.bins !== prev.bins || cfg.fftN !== prev.fftN) {
      this.averager = new SpectrumAverager({ fftN: cfg.fftN, bins: cfg.bins });
    }
    if (cfg.sampleRate !== prev.sampleRate) this.demod = null;
    if (cfg.audioOn) {
      if (!this.demod) this.demod = new Demodulator({ inRate: cfg.sampleRate, audioRate: 48000, mode: cfg.mode, offsetHz: cfg.offsetHz });
      else {
        if (this.demod.mode !== cfg.mode) this.demod.setMode(cfg.mode);
        if (this.demod.offsetHz !== cfg.offsetHz) this.demod.setOffset(cfg.offsetHz);
      }
    } else if (!cfg.audioOn && this.demod) {
      this.demod = null;
      this.audioPending = []; this.audioPendingLen = 0;
    }
  }

  /**
   * Process one IQ buffer. Returns { spectrum?, audio? }:
   *   spectrum = { spec, peakDb, floorDb, rmsCounts, sampleRate }
   *   audio    = { samples (Float32Array), rate, channelDb, open }
   */
  process(iq, now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const out = {};
    this.averager.push(iq);
    if (now - this.lastSpecTs >= SPEC_INTERVAL_MS && this.averager.hasData) {
      this.lastSpecTs = now;
      const f = this.averager.frame();
      if (f) out.spectrum = { ...f, sampleRate: this.cfg.sampleRate };
    }
    if (this.demod) {
      const audio = this.demod.process(iq);
      const channelDb = this.demod.channelPowerDb;
      const open = channelDb >= this.cfg.squelchDb;
      if (audio.length) {
        this.audioPending.push(audio); this.audioPendingLen += audio.length;
        if (this.audioPendingLen >= this.cfg.audioChunk) {
          const samples = new Float32Array(this.audioPendingLen);
          let o = 0;
          for (const a of this.audioPending) { samples.set(a, o); o += a.length; }
          this.audioPending = []; this.audioPendingLen = 0;
          out.audio = { samples, rate: this.demod.audioRate, channelDb, open };
        }
      }
    }
    return out;
  }
}
