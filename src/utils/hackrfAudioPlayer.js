/**
 * hackrfAudioPlayer.js — gapless playback of demodulated audio chunks.
 *
 * The DSP hands over Float32 chunks at some rate near 48 kHz (the exact rate
 * depends on the decimation). An AudioWorklet keeps a ring buffer, resamples
 * linearly to the device rate, primes ~100 ms before starting and drops the
 * oldest audio if more than ~0.5 s piles up, so latency stays bounded and a
 * late chunk never clicks. Browsers without AudioWorklet fall back to a queue
 * of scheduled AudioBuffers.
 */

const WORKLET_SRC = `
class HackRfPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = Math.max(16384, Math.round(sampleRate * 2));
    this.buf = new Float32Array(this.cap);
    this.w = 0;           // absolute write index
    this.r = 0;           // absolute (fractional) read index
    this.srcRate = 48000;
    this.primed = false;
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.rate) this.srcRate = m.rate;
      if (m.reset) { this.w = 0; this.r = 0; this.primed = false; }
      if (m.samples) {
        const s = m.samples;
        for (let i = 0; i < s.length; i++) this.buf[(this.w + i) % this.cap] = s[i];
        this.w += s.length;
        if (this.w - this.r > this.srcRate * 0.5) this.r = this.w - this.srcRate * 0.15;
        if (this.w - this.r > this.cap) this.r = this.w - this.cap;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const step = this.srcRate / sampleRate;
    if (!this.primed) {
      if (this.w - this.r < this.srcRate * 0.1) { out.fill(0); return true; }
      this.primed = true;
    }
    for (let i = 0; i < out.length; i++) {
      if (this.r + 1 >= this.w) { out[i] = 0; this.primed = false; continue; }
      const i0 = Math.floor(this.r), frac = this.r - i0;
      const a = this.buf[i0 % this.cap], b = this.buf[(i0 + 1) % this.cap];
      out[i] = a + (b - a) * frac;
      this.r += step;
    }
    return true;
  }
}
registerProcessor('hackrf-player', HackRfPlayer);
`;

export async function createHackRfAudioPlayer({ volume = 0.75 } = {}) {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) throw new Error('Web Audio is not supported in this browser.');
  const ctx = new AC();
  const gain = ctx.createGain();
  gain.gain.value = volume;
  gain.connect(ctx.destination);

  let node = null;
  if (ctx.audioWorklet) {
    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      node = new AudioWorkletNode(ctx, 'hackrf-player', { numberOfInputs: 0, outputChannelCount: [1] });
      node.connect(gain);
    } catch (_) { node = null; }
  }
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (_) {} }

  // Fallback: schedule AudioBuffers back to back.
  let nextTime = 0;
  const pushBuffer = (samples, rate) => {
    try {
      const buf = ctx.createBuffer(1, samples.length, Math.max(3000, Math.round(rate)));
      buf.copyToChannel(samples, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(gain);
      const now = ctx.currentTime;
      let start = nextTime;
      if (start < now + 0.02) start = now + 0.08;
      src.start(start);
      nextTime = start + buf.duration;
    } catch (_) { /* skip the frame */ }
  };

  return {
    kind: node ? 'worklet' : 'buffer',
    context: ctx,
    push(samples, rate) {
      const f32 = samples instanceof Float32Array ? samples : Float32Array.from(samples);
      if (node) node.port.postMessage({ samples: f32, rate }, [f32.buffer]);
      else pushBuffer(f32, rate);
    },
    reset() { if (node) node.port.postMessage({ reset: true }); nextTime = 0; },
    setVolume(v) { gain.gain.value = Math.max(0, Math.min(1, v)); },
    close() {
      try { if (node) node.disconnect(); } catch (_) {}
      ctx.close().catch(() => {});
    }
  };
}
