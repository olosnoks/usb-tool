/**
 * Minimal iterative radix-2 complex FFT and a helper to turn a HackRF IQ
 * bulk transfer (interleaved signed 8-bit I,Q) into a power spectrum in dBFS.
 *
 * No external dependency — used to render the real HackRF spectrum/waterfall
 * instead of synthetic data.
 */

/**
 * In-place iterative radix-2 FFT. `re`/`im` must be the same power-of-two length.
 */
export function fft(re, im) {
  const n = re.length;
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wre = Math.cos(ang);
    const wim = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cre = 1, cim = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const vre = re[b] * cre - im[b] * cim;
        const vim = re[b] * cim + im[b] * cre;
        re[b] = re[a] - vre; im[b] = im[a] - vim;
        re[a] = re[a] + vre; im[a] = im[a] + vim;
        const ncre = cre * wre - cim * wim;
        cim = cre * wim + cim * wre;
        cre = ncre;
      }
    }
  }
}

/**
 * Compute an fftshifted power spectrum (dBFS, DC in the center) from a HackRF
 * IQ bulk transfer. HackRF delivers interleaved signed 8-bit I,Q samples.
 *
 * @param {DataView|Int8Array} iq - interleaved int8 I,Q (as returned by transferIn)
 * @param {number} N - FFT size (power of two, default 256)
 * @returns {Float32Array} N bins of power in dBFS, lowest freq first
 */
export function powerSpectrumFromIQ(iq, N = 256) {
  const getI8 = iq instanceof DataView
    ? (idx) => iq.getInt8(idx)
    : (idx) => (iq[idx] << 24) >> 24; // Int8Array already signed; keep generic
  const byteLen = iq instanceof DataView ? iq.byteLength : iq.length;
  const avail = Math.floor(byteLen / 2);

  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    if (k < avail) {
      // Hann window to suppress spectral leakage
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1));
      re[k] = (getI8(2 * k) / 128) * w;
      im[k] = (getI8(2 * k + 1) / 128) * w;
    }
  }

  fft(re, im);

  const mag = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
    mag[k] = 20 * Math.log10(m + 1e-9);
  }

  // fftshift so DC (bin 0) lands in the middle, matching a centered spectrum view
  const shifted = new Float32Array(N);
  const half = N >> 1;
  for (let k = 0; k < N; k++) shifted[k] = mag[(k + half) % N];
  return shifted;
}
