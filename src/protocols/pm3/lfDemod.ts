/**
 * Client-side demodulation of raw 125 kHz ADC samples (8 bits per sample, one
 * sample per carrier cycle, as `lf read` captures them). Pure.
 */

export interface Em410xDemod {
  /** 5-byte tag ID, 10 hex digits. */
  idHex: string;
  /** Samples per bit (RF/64, RF/32 or RF/16). */
  clock: number;
  /** Peak-to-peak modulation depth in ADC counts. */
  swing: number;
}

/** Peak-to-peak swing of a capture, ignoring the top and bottom 1% as outliers. */
export function signalSwing(samples: Uint8Array): number {
  if (samples.byteLength === 0) return 0;
  const hist = new Uint32Array(256);
  for (const s of samples) hist[s]++;
  const cut = Math.floor(samples.byteLength / 100);
  let lo = 0;
  for (let seen = 0; lo < 255 && (seen += hist[lo]) <= cut; lo++);
  let hi = 255;
  for (let seen = 0; hi > 0 && (seen += hist[hi]) <= cut; hi--);
  return Math.max(0, hi - lo);
}

/** Returns the 10 ID nibbles if bits[at..at+64) is a valid EM410x frame, else null. */
function em410xFrameAt(bits: Uint8Array, at: number, invert: number): number[] | null {
  const bit = (i: number) => bits[at + i] ^ invert;
  for (let i = 0; i < 9; i++) if (bit(i) !== 1) return null;
  const nibbles: number[] = [];
  const cols = [0, 0, 0, 0];
  for (let row = 0; row < 10; row++) {
    let nib = 0;
    let ones = 0;
    for (let c = 0; c < 4; c++) {
      const b = bit(9 + row * 5 + c);
      nib = (nib << 1) | b;
      ones += b;
      cols[c] ^= b;
    }
    if ((ones & 1) !== bit(9 + row * 5 + 4)) return null;
    nibbles.push(nib);
  }
  for (let c = 0; c < 4; c++) if (cols[c] !== bit(59 + c)) return null;
  return bit(63) === 0 ? nibbles : null;
}

/**
 * Finds an EM410x tag (ASK, Manchester) in a raw capture. A frame only counts
 * when its header, all 14 parity bits and the stop bit check out and the same
 * 64 bits repeat immediately after, so noise does not produce IDs.
 */
export function demodEm410x(samples: Uint8Array): Em410xDemod | null {
  const swing = signalSwing(samples);
  if (swing < 6) return null;

  const n = samples.byteLength;
  const prefix = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + samples[i];
  const sum = (from: number, to: number) => prefix[to] - prefix[from];

  for (const clock of [64, 32, 16]) {
    const half = clock / 2;
    const count = Math.floor((n - clock) / clock);
    if (count < 128) continue;

    // Manchester has an edge in the middle of every bit, so the right phase is
    // the one where the two halves of each bit window differ the most.
    let bestPhase = 0;
    let bestScore = -1;
    for (let phase = 0; phase < clock; phase++) {
      let score = 0;
      for (let i = 0; i < count; i++) {
        const start = phase + i * clock;
        score += Math.abs(sum(start, start + half) - sum(start + half, start + clock));
      }
      if (score > bestScore) {
        bestScore = score;
        bestPhase = phase;
      }
    }

    const bits = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const start = bestPhase + i * clock;
      bits[i] = sum(start, start + half) > sum(start + half, start + clock) ? 1 : 0;
    }

    for (const invert of [0, 1]) {
      for (let at = 0; at + 128 <= count; at++) {
        const nibbles = em410xFrameAt(bits, at, invert);
        if (!nibbles) continue;
        let repeats = true;
        for (let i = 0; i < 64 && repeats; i++) repeats = bits[at + i] === bits[at + 64 + i];
        if (!repeats) continue;
        return { idHex: nibbles.map((x) => x.toString(16).toUpperCase()).join(''), clock, swing };
      }
    }
  }
  return null;
}
