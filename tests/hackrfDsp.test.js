import { describe, it, expect } from 'vitest';
import { SpectrumAverager, DspCore } from '../src/utils/hackrfDsp';
import { Demodulator, MODE_BANDWIDTH_HZ } from '../src/utils/hackrfDemod';

const RATE = 2000000;

// Complex tone at `hz` off centre, amplitude in ADC counts, as int8 IQ.
function toneIq(hz, amp, samples, rate = RATE, phase0 = 0) {
  const iq = new Int8Array(samples * 2);
  for (let k = 0; k < samples; k++) {
    const ph = phase0 + (2 * Math.PI * hz * k) / rate;
    iq[2 * k] = Math.round(amp * Math.cos(ph));
    iq[2 * k + 1] = Math.round(amp * Math.sin(ph));
  }
  return iq;
}

function toneHz(audio, rate) {
  let crossings = 0;
  for (let i = 1; i < audio.length; i++) if ((audio[i - 1] <= 0 && audio[i] > 0) || (audio[i - 1] >= 0 && audio[i] < 0)) crossings++;
  return (crossings / 2) / (audio.length / rate);
}

describe('SpectrumAverager', () => {
  it('puts a full-scale tone at 0 dBFS in the right bin and averages across buffers', () => {
    const a = new SpectrumAverager({ fftN: 4096, bins: 1024 });
    // 500 kHz above centre at 2 Msps -> 3/4 of the way across the (DC-centred) spectrum.
    const iq = toneIq(500000, 127, 4096 * 3);
    // Deliver it in odd-sized pieces so the carry path is exercised.
    a.push(iq.subarray(0, 1000)); a.push(iq.subarray(1000, 9000)); a.push(iq.subarray(9000));
    expect(a.hasData).toBe(true);
    const f = a.frame();
    expect(f.spec.length).toBe(1024);
    let pk = -Infinity, pi = 0;
    for (let i = 0; i < f.spec.length; i++) if (f.spec[i] > pk) { pk = f.spec[i]; pi = i; }
    expect(pi).toBe(768);
    expect(pk).toBeGreaterThan(-1.5);
    expect(pk).toBeLessThan(0.5);
    expect(f.peakDb).toBeCloseTo(pk, 5);
    expect(f.floorDb).toBeLessThan(-40);           // the rest is leakage/quantisation
    expect(f.rmsCounts).toBeGreaterThan(85);       // ~127/sqrt(2) per arm
    expect(f.rmsCounts).toBeLessThan(95);
    expect(a.hasData).toBe(false);                 // reset after the frame
    expect(a.frame()).toBe(null);
  });

  it('reports a quiet stream with a low RMS for the AGC', () => {
    const a = new SpectrumAverager({ fftN: 1024, bins: 256 });
    a.push(toneIq(100000, 3, 4096));
    const f = a.frame();
    expect(f.rmsCounts).toBeGreaterThan(1.5);
    expect(f.rmsCounts).toBeLessThan(3);
  });
});

describe('Demodulator channel offset', () => {
  it('recovers NFM audio from a channel 300 kHz above the LO', () => {
    // FM-modulate a 1 kHz tone with 4 kHz deviation on a 300 kHz offset carrier.
    const n = Math.floor(RATE * 0.1);
    const iq = new Int8Array(n * 2);
    let phi = 0;
    for (let k = 0; k < n; k++) {
      phi += (2 * Math.PI * (300000 + 4000 * Math.sin((2 * Math.PI * 1000 * k) / RATE))) / RATE;
      iq[2 * k] = Math.round(100 * Math.cos(phi)); iq[2 * k + 1] = Math.round(100 * Math.sin(phi));
    }
    const off = new Demodulator({ inRate: RATE, mode: 'NFM', offsetHz: 300000 });
    expect(off.audioRate).toBeCloseTo(48780.5, 0);
    const audio = off.process(iq);
    const tail = audio.subarray(Math.floor(audio.length / 4));   // skip the filter settling
    expect(toneHz(tail, off.audioRate)).toBeGreaterThan(900);
    expect(toneHz(tail, off.audioRate)).toBeLessThan(1100);
    expect(off.channelPowerDb).toBeGreaterThan(-6);
    // The same signal with no offset is outside the 6.5 kHz channel filter: far less channel power.
    const on = new Demodulator({ inRate: RATE, mode: 'NFM', offsetHz: 0 });
    on.process(iq);
    expect(on.channelPowerDb).toBeLessThan(off.channelPowerDb - 30);
  });

  it('USB and LSB are mirror images around the carrier', () => {
    const n = Math.floor(RATE * 0.05);
    const above = toneIq(1000, 100, n);     // audio tone 1 kHz ABOVE the (suppressed) carrier
    const usb = new Demodulator({ inRate: RATE, mode: 'USB' });
    const lsb = new Demodulator({ inRate: RATE, mode: 'LSB' });
    const au = usb.process(above), al = lsb.process(above);
    const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(au.subarray(au.length >> 1))).toBeGreaterThan(rms(al.subarray(al.length >> 1)) * 3);
    expect(toneHz(au.subarray(au.length >> 1), usb.audioRate)).toBeGreaterThan(800);
    expect(toneHz(au.subarray(au.length >> 1), usb.audioRate)).toBeLessThan(1200);
  });

  it('WFM uses a two-stage decimation that lands near 48 kHz', () => {
    const d = new Demodulator({ inRate: RATE, mode: 'WFM' });
    expect(d.stage1).toBe(8); expect(d.stage2).toBe(5); expect(d.decim).toBe(40);
    expect(d.audioRate).toBe(50000);
    expect(MODE_BANDWIDTH_HZ.WFM).toBe(200000);
  });
});

describe('DspCore', () => {
  it('emits spectrum frames on the display cadence and squelched audio chunks', () => {
    const core = new DspCore({ sampleRate: RATE, bins: 256, fftN: 1024, mode: 'AM', audioOn: true, squelchDb: -200, audioChunk: 1024 });
    const iq = toneIq(0, 100, 65536 / 2);
    const t = 1000;
    const r1 = core.process(iq, t);
    expect(r1.spectrum).toBeTruthy();
    expect(r1.spectrum.spec.length).toBe(256);
    expect(r1.spectrum.sampleRate).toBe(RATE);
    const r2 = core.process(iq, t + 10);          // too soon for another frame
    expect(r2.spectrum).toBeUndefined();
    const r3 = core.process(iq, t + 40);
    expect(r3.spectrum).toBeTruthy();
    // Audio arrives in >= audioChunk sample chunks with the channel power and squelch state.
    const withAudio = [r1, r2, r3].find((r) => r.audio);
    expect(withAudio).toBeTruthy();
    expect(withAudio.audio.samples.length).toBeGreaterThanOrEqual(1024);
    expect(withAudio.audio.open).toBe(true);
    expect(withAudio.audio.rate).toBeGreaterThan(40000);
    // Raise the squelch above the channel power: audio is still produced but marked closed.
    core.configure({ squelchDb: 50 });
    const r4 = core.process(iq, t + 100);
    if (r4.audio) expect(r4.audio.open).toBe(false);
    // Audio off tears the demodulator down.
    core.configure({ audioOn: false });
    const r5 = core.process(iq, t + 200);
    expect(r5.audio).toBeUndefined();
  });
});
