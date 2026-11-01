import { describe, it, expect } from 'vitest';
import { Demodulator, frameRms } from '../src/utils/hackrfDemod';

// Count audio-rate zero crossings to estimate the recovered tone frequency.
function toneHz(audio, rate) {
  let crossings = 0;
  for (let i = 1; i < audio.length; i++) {
    if ((audio[i - 1] <= 0 && audio[i] > 0) || (audio[i - 1] >= 0 && audio[i] < 0)) crossings++;
  }
  const seconds = audio.length / rate;
  return (crossings / 2) / seconds;
}

const INRATE = 240000;

// FM-modulate a message tone onto a baseband carrier, as signed-8-bit IQ.
function fmIq(messageHz, devHz, seconds) {
  const n = Math.floor(INRATE * seconds);
  const iq = new Int8Array(n * 2);
  let phi = 0;
  for (let k = 0; k < n; k++) {
    const msg = Math.sin((2 * Math.PI * messageHz * k) / INRATE);
    phi += (2 * Math.PI * devHz * msg) / INRATE;
    iq[2 * k] = Math.round(120 * Math.cos(phi));
    iq[2 * k + 1] = Math.round(120 * Math.sin(phi));
  }
  return iq;
}

// AM: a tone amplitude-modulates the carrier envelope (Q = 0 at baseband).
function amIq(messageHz, depth, seconds) {
  const n = Math.floor(INRATE * seconds);
  const iq = new Int8Array(n * 2);
  for (let k = 0; k < n; k++) {
    const env = 1 + depth * Math.sin((2 * Math.PI * messageHz * k) / INRATE);
    iq[2 * k] = Math.round(70 * env);
    iq[2 * k + 1] = 0;
  }
  return iq;
}

describe('HackRF demodulator', () => {
  it('recovers a 1 kHz tone from narrowband FM', () => {
    const d = new Demodulator({ inRate: INRATE, audioRate: 48000, mode: 'NFM' });
    expect(d.decim).toBe(5);
    expect(d.audioRate).toBe(48000);
    const audio = d.process(fmIq(1000, 5000, 0.08));
    expect(audio.length).toBeGreaterThan(3000);
    expect(frameRms(audio)).toBeGreaterThan(0.01);
    expect(toneHz(audio, d.audioRate)).toBeGreaterThan(850);
    expect(toneHz(audio, d.audioRate)).toBeLessThan(1150);
  });

  it('recovers a tone from AM and blocks the carrier DC', () => {
    const d = new Demodulator({ inRate: INRATE, audioRate: 48000, mode: 'AM' });
    const audio = d.process(amIq(1200, 0.5, 0.08));
    // DC blocker: mean near zero even though the envelope is always positive.
    const mean = audio.reduce((a, b) => a + b, 0) / audio.length;
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(toneHz(audio, d.audioRate)).toBeGreaterThan(1000);
    expect(toneHz(audio, d.audioRate)).toBeLessThan(1400);
  });

  it('runs WFM with de-emphasis and SSB without crashing, producing finite audio', () => {
    for (const mode of ['WFM', 'USB', 'LSB']) {
      const d = new Demodulator({ inRate: INRATE, audioRate: 48000, mode });
      const audio = d.process(fmIq(1000, 40000, 0.04));
      expect(audio.length).toBeGreaterThan(1000);
      expect(audio.every((v) => Number.isFinite(v) && v >= -1 && v <= 1)).toBe(true);
    }
  });

  it('accepts a DataView buffer and keeps state across calls', () => {
    const d = new Demodulator({ inRate: INRATE, audioRate: 48000, mode: 'NFM' });
    const iq = fmIq(1000, 5000, 0.04);
    const a1 = d.process(new DataView(iq.buffer));
    const a2 = d.process(new DataView(iq.buffer));
    expect(a1.length).toBe(a2.length);
    expect(frameRms(a2)).toBeGreaterThan(0.01);
  });

  it('frameRms is zero for empty or silent input', () => {
    expect(frameRms(null)).toBe(0);
    expect(frameRms(new Float32Array(100))).toBe(0);
  });
});
