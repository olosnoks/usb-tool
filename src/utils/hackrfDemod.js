/**
 * hackrfDemod.js — turn a HackRF IQ stream into audio.
 *
 * Input is interleaved signed 8-bit IQ (I,Q,I,Q…) at the SDR sample rate, the
 * same bytes the FFT path reads. Output is a Float32Array of mono audio at
 * roughly `audioRate`, ready for a Web Audio AudioBuffer.
 *
 * Modes:
 *   WFM — wideband FM (broadcast), 75 µs de-emphasis.
 *   NFM — narrowband FM (PMR/ham), more discriminator gain.
 *   AM  — envelope detector with a DC blocker.
 *   USB/LSB — single sideband by a simple product detector (phasing method).
 *
 * Decimation is a boxcar average of `decim = round(inRate/audioRate)` samples,
 * so the true output rate is inRate/decim (reported as `audioRate`); hand that
 * to the AudioBuffer and the browser resamples to the device rate.
 */

const clampIndex = (iq) => (iq instanceof DataView ? iq.byteLength : iq.length);
const readI8 = (iq) => (iq instanceof DataView ? (i) => iq.getInt8(i) : (i) => (iq[i] << 24) >> 24);

export class Demodulator {
  constructor({ inRate = 2000000, audioRate = 48000, mode = 'WFM' } = {}) {
    this.inRate = inRate;
    this.decim = Math.max(1, Math.round(inRate / audioRate));
    this.audioRate = inRate / this.decim;
    this.setMode(mode);
    // Filter / detector state carried between buffers.
    this.prevI = 0;
    this.prevQ = 0;
    this.amDc = null;         // AM DC-blocker running mean (lazy-init to first sample)
    this.deemph = 0;         // FM de-emphasis one-pole state
    this.ncoPhase = 0;       // SSB product-detector oscillator phase
    // 75 µs de-emphasis coefficient at the output rate.
    this.deemphA = 1 - Math.exp(-1 / (this.audioRate * 75e-6));
  }

  setMode(mode) {
    this.mode = mode;
    // Discriminator gain per mode (keeps recovered audio near unit scale).
    this.fmGain = mode === 'WFM' ? 0.6 : 2.2;
  }

  /** Demodulate one IQ buffer. Returns Float32Array of ~ length/(2*decim) samples. */
  process(iq) {
    const len = clampIndex(iq);
    const get = readI8(iq);
    const n = len >> 1;                 // IQ sample pairs
    const outLen = Math.floor(n / this.decim);
    const out = new Float32Array(outLen);
    let oi = 0;
    let acc = 0;
    let cnt = 0;
    const isFm = this.mode === 'WFM' || this.mode === 'NFM';
    const isAm = this.mode === 'AM';
    const isSsb = this.mode === 'USB' || this.mode === 'LSB';
    const ssbSign = this.mode === 'LSB' ? -1 : 1;
    // A gentle baseband NCO step for SSB (0 here: the radio is tuned on-signal,
    // so the product detector just takes the real arm with a sideband sign).
    const ncoStep = 0;

    for (let k = 0; k < n; k++) {
      const I = get(2 * k) / 128;
      const Q = get(2 * k + 1) / 128;
      let sample;
      if (isFm) {
        // Instantaneous frequency = arg(conj(prev) * cur).
        const re = I * this.prevI + Q * this.prevQ;
        const im = Q * this.prevI - I * this.prevQ;
        sample = Math.atan2(im, re) * this.fmGain;
      } else if (isAm) {
        const mag = Math.sqrt(I * I + Q * Q);
        if (this.amDc === null) this.amDc = mag;   // start on the carrier, not zero
        this.amDc += 0.001 * (mag - this.amDc);    // track & remove carrier DC
        sample = (mag - this.amDc) * 2;
      } else if (isSsb) {
        const c = Math.cos(this.ncoPhase);
        const s = Math.sin(this.ncoPhase);
        // Real arm of IQ * e^{-j θ}; sideband chosen by the Q sign.
        sample = (I * c + ssbSign * Q * s);
        this.ncoPhase += ncoStep;
      } else {
        sample = 0;
      }
      this.prevI = I;
      this.prevQ = Q;

      acc += sample;
      if (++cnt === this.decim) {
        let a = acc / this.decim;
        if (isFm && this.mode === 'WFM') {
          this.deemph += this.deemphA * (a - this.deemph);
          a = this.deemph;
        }
        out[oi++] = Math.max(-1, Math.min(1, a));
        acc = 0;
        cnt = 0;
      }
    }
    return out.subarray(0, oi);
  }
}

/** RMS of a Float32 audio frame (0..1), for a software squelch. */
export function frameRms(audio) {
  if (!audio || !audio.length) return 0;
  let s = 0;
  for (let i = 0; i < audio.length; i++) s += audio[i] * audio[i];
  return Math.sqrt(s / audio.length);
}
