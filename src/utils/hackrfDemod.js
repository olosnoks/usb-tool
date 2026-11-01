/**
 * hackrfDemod.js — turn a HackRF IQ stream into audio.
 *
 * Input is interleaved signed 8-bit IQ (I,Q,I,Q…) at the SDR sample rate, the
 * same bytes the FFT path reads. Output is a Float32Array of mono audio at
 * `audioRate` (close to the requested rate; the exact value is exposed so the
 * player can resample), ready for an AudioWorklet or AudioBuffer.
 *
 * Pipeline (the same shape as RocketGod's mayhem-mobile dsp.worker.ts):
 *   1. Mix by a complex NCO so the wanted channel (center + offsetHz) sits at DC.
 *   2. Stage-1 boxcar decimation to an intermediate rate
 *      (~240 kHz for WFM, ~48 kHz for everything else).
 *   3. Channel filter: 4th-order Butterworth low-pass (two biquads) on I and Q
 *      for NFM (6.5 kHz) and AM (5 kHz); DC blocker ahead of it.
 *   4. Detector: FM discriminator (atan2 of conj(prev)*cur), AM envelope with a
 *      DC blocker, or Weaver-method SSB (1.5 kHz pivot, 3 kHz passband).
 *   5. Stage-2 boxcar decimation to the audio rate; WFM gets 75 µs de-emphasis.
 *
 * `channelPowerDb` (dBFS of the filtered channel, full-scale IQ = 0 dBFS) is
 * updated by every process() call and drives the squelch.
 */

const clampIndex = (iq) => (iq instanceof DataView ? iq.byteLength : iq.length);
const readI8 = (iq) => (iq instanceof DataView ? (i) => iq.getInt8(i) : (i) => (iq[i] << 24) >> 24);

/** RBJ low-pass biquad (direct form I). */
export class Biquad {
  constructor(fc, fs, q) {
    const w0 = (2 * Math.PI * Math.min(fc, fs * 0.45)) / fs;
    const cosw = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = ((1 - cosw) / 2) / a0;
    this.b1 = (1 - cosw) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cosw) / a0;
    this.a2 = (1 - alpha) / a0;
    this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0;
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/** 4th-order Butterworth low-pass as two cascaded biquads (Q 0.5412 / 1.3066). */
export class Butterworth4 {
  constructor(fc, fs) {
    this.s1 = new Biquad(fc, fs, 0.5412);
    this.s2 = new Biquad(fc, fs, 1.3066);
  }
  process(x) { return this.s2.process(this.s1.process(x)); }
}

/** Channel bandwidth (Hz) each mode listens to; used for the filter and the UI marker. */
export const MODE_BANDWIDTH_HZ = { WFM: 200000, NFM: 12500, AM: 10000, USB: 3000, LSB: 3000 };

export class Demodulator {
  constructor({ inRate = 2000000, audioRate = 48000, mode = 'WFM', offsetHz = 0 } = {}) {
    this.inRate = inRate;
    this.targetAudioRate = audioRate;
    this.channelPowerDb = -200;
    this.setOffset(offsetHz);
    this.setMode(mode);
  }

  /** Pick the decimation stages and filters for a mode; resets filter state. */
  setMode(mode) {
    this.mode = mode;
    const isWfm = mode === 'WFM';
    this.stage1 = Math.max(1, Math.floor(this.inRate / (isWfm ? 240000 : this.targetAudioRate)));
    this.interRate = this.inRate / this.stage1;
    this.stage2 = Math.max(1, Math.floor(this.interRate / this.targetAudioRate));
    this.audioRate = this.interRate / this.stage2;
    this.decim = this.stage1 * this.stage2;

    // Discriminator gain per mode (keeps recovered audio near unit scale).
    this.fmGain = isWfm ? 0.6 : 2.2;
    this.amGain = 2.5;
    this.ssbGain = 3.0;

    // Channel filter (NFM/AM) at the intermediate rate.
    const cutoff = mode === 'AM' ? 5000 : mode === 'NFM' ? 6500 : 0;
    this.chanI = cutoff ? new Butterworth4(cutoff, this.interRate) : null;
    this.chanQ = cutoff ? new Butterworth4(cutoff, this.interRate) : null;

    // Weaver SSB: pivot at 1.5 kHz, 4th-order low-passes at 1.5 kHz on both arms
    // (a one-pole is too gentle to reject the opposite sideband).
    this.weaverStep = (2 * Math.PI * 1500) / this.interRate;
    this.weaverLpI = new Butterworth4(1500, this.interRate);
    this.weaverLpQ = new Butterworth4(1500, this.interRate);

    // 75 µs de-emphasis coefficient at the output rate.
    this.deemphA = 1 - Math.exp(-1 / (this.audioRate * 75e-6));

    // Detector / filter state carried between buffers.
    this.prevI = 0; this.prevQ = 0;
    this.dcI = 0; this.dcQ = 0;
    this.amDc = 0; this.amCount = 0;
    this.deemph = 0;
    this.weaverPhase = 0;
    this.acc1I = 0; this.acc1Q = 0; this.cnt1 = 0;
    this.acc2 = 0; this.cnt2 = 0;
  }

  /** Listen `hz` away from the LO center (positive = above center). */
  setOffset(hz) {
    this.offsetHz = hz || 0;
    this.ncoStep = (-2 * Math.PI * this.offsetHz) / this.inRate;
    if (this.ncoStep === 0) { this.ncoRe = 1; this.ncoIm = 0; }
    else if (this.ncoRe === undefined) { this.ncoRe = 1; this.ncoIm = 0; }
  }

  /** Demodulate one IQ buffer. Returns Float32Array of ~ pairs/decim samples. */
  process(iq) {
    const len = clampIndex(iq);
    const get = readI8(iq);
    const n = len >> 1;                 // IQ sample pairs
    const out = new Float32Array(Math.floor(n / this.decim) + 2);
    let oi = 0;
    const mode = this.mode;
    const isFm = mode === 'WFM' || mode === 'NFM';
    const isWfm = mode === 'WFM';
    const isAm = mode === 'AM';
    const isSsb = mode === 'USB' || mode === 'LSB';
    const ssbSign = mode === 'LSB' ? -1 : 1;
    const mixing = this.ncoStep !== 0;
    const stepCos = Math.cos(this.ncoStep), stepSin = Math.sin(this.ncoStep);
    let ncoRe = this.ncoRe, ncoIm = this.ncoIm;
    let acc1I = this.acc1I, acc1Q = this.acc1Q, cnt1 = this.cnt1;
    let acc2 = this.acc2, cnt2 = this.cnt2;
    let powAcc = 0, powCnt = 0;
    const stage1 = this.stage1, stage2 = this.stage2;

    for (let k = 0; k < n; k++) {
      let I = get(2 * k) / 128;
      let Q = get(2 * k + 1) / 128;
      if (mixing) {
        // Rotate by the NCO (complex multiply), renormalise now and then.
        const mi = I * ncoRe - Q * ncoIm;
        const mq = I * ncoIm + Q * ncoRe;
        I = mi; Q = mq;
        const nr = ncoRe * stepCos - ncoIm * stepSin;
        ncoIm = ncoRe * stepSin + ncoIm * stepCos;
        ncoRe = nr;
        if ((k & 1023) === 1023) {
          const mag = Math.hypot(ncoRe, ncoIm) || 1;
          ncoRe /= mag; ncoIm /= mag;
        }
      }
      acc1I += I; acc1Q += Q;
      if (++cnt1 < stage1) continue;
      let ci = acc1I / stage1, cq = acc1Q / stage1;
      acc1I = 0; acc1Q = 0; cnt1 = 0;

      if (!isWfm && !isAm) {
        // Slow DC blocker: the HackRF's DC spike would otherwise bias the FM
        // discriminator and SSB. (AM keeps it: the envelope needs the carrier.)
        this.dcI += 2e-3 * (ci - this.dcI);
        this.dcQ += 2e-3 * (cq - this.dcQ);
        ci -= this.dcI; cq -= this.dcQ;
      }
      if (this.chanI) { ci = this.chanI.process(ci); cq = this.chanQ.process(cq); }
      powAcc += ci * ci + cq * cq; powCnt++;

      let sample;
      if (isFm) {
        // Instantaneous frequency = arg(conj(prev) * cur).
        const re = ci * this.prevI + cq * this.prevQ;
        const im = cq * this.prevI - ci * this.prevQ;
        sample = Math.atan2(im, re) * this.fmGain;
        this.prevI = ci; this.prevQ = cq;
      } else if (isAm) {
        const mag = Math.sqrt(ci * ci + cq * cq);
        // Carrier tracker: a running mean while the channel filter settles
        // (~20 ms), then a slow EMA, so the DC blocker starts on the carrier.
        const a = this.amCount < 1000 ? 1 / (++this.amCount) : 0.001;
        this.amDc += a * (mag - this.amDc);
        sample = (mag - this.amDc) * this.amGain;
      } else if (isSsb) {
        // Weaver: shift the sideband down onto the pivot, low-pass, shift back, take the real arm.
        const c = Math.cos(this.weaverPhase), s = Math.sin(this.weaverPhase);
        const si = ci * c + ssbSign * cq * s;
        const sq = cq * c - ssbSign * ci * s;
        const wI = this.weaverLpI.process(si);
        const wQ = this.weaverLpQ.process(sq);
        sample = (wI * c - ssbSign * wQ * s) * this.ssbGain;
        this.weaverPhase += this.weaverStep;
        if (this.weaverPhase > Math.PI) this.weaverPhase -= 2 * Math.PI;
      } else {
        sample = 0;
      }

      acc2 += sample;
      if (++cnt2 < stage2) continue;
      let a = acc2 / stage2;
      acc2 = 0; cnt2 = 0;
      if (isWfm) {
        this.deemph += this.deemphA * (a - this.deemph);
        a = this.deemph;
      }
      if (oi < out.length) out[oi++] = Math.max(-1, Math.min(1, a));
    }

    this.ncoRe = ncoRe; this.ncoIm = ncoIm;
    this.acc1I = acc1I; this.acc1Q = acc1Q; this.cnt1 = cnt1;
    this.acc2 = acc2; this.cnt2 = cnt2;
    if (powCnt) this.channelPowerDb = 10 * Math.log10(powAcc / powCnt + 1e-12);
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
