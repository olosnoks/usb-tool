import { describe, it, expect } from 'vitest';
import {
  R820T, computePll, freqRangeIndex, manualGainSettings, bitrev, INIT_ARRAY, FREQ_RANGES, LNA_GAIN_STEPS,
} from '../src/utils/rtlSdr/r820t.js';
import {
  Rtl2832u, beBytes, isValidSampleRate, resamplerRatio, ifMultiplier, INIT_SEQUENCE,
} from '../src/utils/rtlSdr/rtl2832u.js';
import { u8ToInt8, u8ToFloat, IqRecorder, cu8FileName } from '../src/utils/rtlSdr/iq.js';
import { RtlSdrReceiver, xtalWithPpm } from '../src/utils/rtlSdr.js';
import { Demodulator } from '../src/utils/hackrfDemod.js';

// A fake RTL2832U USB bus: records every control transfer and answers tuner I2C reads
// with a healthy status block (chip id 0x69, PLL locked, VCO fine-tune 2, cal code 0).
function makeBus() {
  const writes = [];
  const reads = [];
  const status = [0x69, 0x00, 0x40, 0x00, 0x20];
  return {
    writes,
    reads,
    async ctrlOut(value, index, bytes) {
      writes.push({ value, index, bytes: Array.from(bytes) });
    },
    async ctrlIn(value, index, len) {
      reads.push({ value, index, len });
      if (index === (6 << 8)) {
        // R820T returns bit-reversed status bytes; the driver reverses them back.
        return Uint8Array.from({ length: len }, (_, i) => bitrev(status[i] ?? 0));
      }
      return new Uint8Array(len);
    },
  };
}

// The tuner talks to the demod's I2C repeater; this adapter forwards through a bus.
function tunerIoOver(bus) {
  const demod = new Rtl2832u(bus);
  return {
    demod,
    io: { i2cWrite: (a, b) => demod.i2cWrite(a, b), i2cRead: (a, l) => demod.i2cRead(a, l) },
  };
}

// Goertzel power of `freq` in a real signal sampled at `fs`.
function tonePower(x, fs, freq) {
  const w = (2 * Math.PI * freq) / fs;
  const coeff = 2 * Math.cos(w);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < x.length; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

describe('R820T PLL solver (librtlsdr r82xx_set_pll arithmetic)', () => {
  // Expected values from an independent integer-arithmetic reference (see the commit notes),
  // for a 28.8 MHz reference and zero base registers.
  it('103.57 MHz LO (100 MHz + 3.57 MHz IF): mixer /32, div 4, N=57, SDM=35317', () => {
    const p = computePll(103570000, 28800000, new Uint8Array(7));
    expect(p.mixDiv).toBe(32);
    expect(p.divNum).toBe(4);
    expect(p.nint).toBe(57);
    expect(p.sdm).toBe(35317);
    expect(Array.from(p.regs)).toEqual([0x80, 0x00, 0x80, 0x00, 11, 245, 137]);
  });

  it('1093.57 MHz LO (1090 MHz ADS-B + IF): mixer /2, div 0, N=37, SDM=63647', () => {
    const p = computePll(1093570000, 28800000, new Uint8Array(7));
    expect(p.mixDiv).toBe(2);
    expect(p.divNum).toBe(0);
    expect(p.nint).toBe(37);
    expect(p.sdm).toBe(63647);
    expect(Array.from(p.regs.subarray(4))).toEqual([6, 159, 248]);
  });

  it('433.57 MHz LO: mixer /8, div 2, N=60 (ni 11, si 3), SDM=14290', () => {
    const p = computePll(433570000, 28800000, new Uint8Array(7));
    expect(p.mixDiv).toBe(8);
    expect(p.divNum).toBe(2);
    expect(p.nint).toBe(60);
    expect(p.sdm).toBe(14290);
    expect(p.regs[0]).toBe(0x40);
    expect(Array.from(p.regs.subarray(4))).toEqual([203, 210, 55]);
  });

  it('the fractional-N pw_sdm bit is cleared when SDM is non-zero', () => {
    const p = computePll(103570000, 28800000, new Uint8Array(7));
    expect(p.sdm).not.toBe(0);
    expect(p.regs[2] & 0x08).toBe(0);
    expect(p.regs[2] & 0xe0).toBe(0x80);   // VCO current bits set to 100
  });

  it('rejects an LO outside the synthesiser range', () => {
    expect(() => computePll(10000, 28800000, new Uint8Array(7))).toThrow(/no VCO divider/);
  });

  it('mixer range lookup matches the librtlsdr freq_ranges table', () => {
    expect(FREQ_RANGES[freqRangeIndex(100)].freq).toBe(100);
    expect(freqRangeIndex(1093)).toBe(FREQ_RANGES.length - 1);
    expect(FREQ_RANGES[freqRangeIndex(49)].freq).toBe(0);
    expect(FREQ_RANGES[freqRangeIndex(89)].freq).toBe(80);
  });
});

describe('R820T tables and gain', () => {
  it('init array covers registers 0x05..0x24 and starts with the upstream values', () => {
    expect(INIT_ARRAY.length).toBe(32);
    expect(Array.from(INIT_ARRAY.subarray(0, 4))).toEqual([0x83, 0x32, 0x75, 0xc0]);
  });

  it('bit reversal is its own inverse on every byte', () => {
    expect(bitrev(0x01)).toBe(0x80);
    expect(bitrev(0x69)).toBe(0x96);
    for (let b = 0; b < 256; b++) expect(bitrev(bitrev(b))).toBe(b);
  });

  it('manual gain walks the LNA then mixer tables (tenths of dB)', () => {
    expect(manualGainSettings(0)).toEqual({ lnaIndex: 0, mixIndex: 0, totalGainTenths: 0 });
    // 9 + 5 + 13 + 10 + 40 + 10 = 87 (< 100); next LNA step 38 -> 125 >= 100 stops.
    expect(manualGainSettings(100)).toEqual({ lnaIndex: 4, mixIndex: 3, totalGainTenths: 125 });
    expect(LNA_GAIN_STEPS[1]).toBe(9);
  });

  it('tuner init sends the register array in 8-byte I2C messages starting at 0x05', async () => {
    const bus = makeBus();
    const { io } = tunerIoOver(bus);
    const tuner = new R820T(io);
    await tuner.init();
    const first = bus.writes.find((w) => w.index === (6 << 8) | 0x10);
    expect(first.value).toBe(0x34);
    expect(first.bytes).toEqual([0x05, 0x83, 0x32, 0x75, 0xc0, 0x40, 0xd6, 0x6c]);
    const i2c = bus.writes.filter((w) => w.index === (6 << 8) | 0x10);
    for (const w of i2c) expect(w.bytes.length).toBeLessThanOrEqual(8);
    expect(tuner.initDone).toBe(true);
  });
});

describe('RTL2832U register maths', () => {
  it('IF multiplier for 3.57 MHz at 28.8 MHz matches the reference bytes', () => {
    // -floor(3570000 * 2^22 / 28800000) = -519918 = 0xf81112
    expect(ifMultiplier(3570000, 28800000)).toBe(-519918);
  });

  it('resampler ratio for 2.048 MS/s is 58982400 (0x0384 / 0x0000 registers)', () => {
    const r = resamplerRatio(2048000, 28800000);
    expect(r).toBe(58982400);
    expect(beBytes((r >> 16) & 0xffff, 2)).toEqual(Uint8Array.from([0x03, 0x84]));
    expect(r & 0xffff).toBe(0);
  });

  it('sample-rate validation follows the RTL2832U ranges', () => {
    expect(isValidSampleRate(2048000)).toBe(true);
    expect(isValidSampleRate(250000)).toBe(true);
    expect(isValidSampleRate(3200000)).toBe(true);
    expect(isValidSampleRate(225000)).toBe(false);
    expect(isValidSampleRate(500000)).toBe(false);
    expect(isValidSampleRate(3200001)).toBe(false);
  });

  it('demod writes use (addr<<8)|0x20 as value and 0x10|page as index, then a dummy read', async () => {
    const bus = makeBus();
    const demod = new Rtl2832u(bus);
    await demod.demodWrite(1, 0x9f, 0x0384, 2);
    expect(bus.writes[0]).toEqual({ value: 0x9f20, index: 0x11, bytes: [0x03, 0x84] });
    expect(bus.reads[0]).toEqual({ value: (0x01 << 8) | 0x20, index: 0x0a, len: 1 });
  });

  it('the baseband init list starts with the USB sysctl write and ends with demod page 0 reg 0x0d', () => {
    expect(INIT_SEQUENCE[0]).toEqual(['usb', 0x2000, 0b00001001, 1]);
    expect(INIT_SEQUENCE[INIT_SEQUENCE.length - 1]).toEqual(['demod', 0, 0x0d, 0b10000011, 1]);
  });
});

describe('RtlSdrReceiver tuning sequence (fake bus)', () => {
  it('2.048 MS/s writes the resampler ratio registers', async () => {
    const bus = makeBus();
    const rx = new RtlSdrReceiver(bus);
    rx.tuner = new R820T(tunerIoOver(bus).io);
    await rx.setSampleRate(2048000);
    const w9f = bus.writes.find((w) => w.value === 0x9f20);
    const wa1 = bus.writes.find((w) => w.value === 0xa120);
    expect(w9f.index).toBe(0x11);
    expect(w9f.bytes).toEqual([0x03, 0x84]);
    expect(wa1.bytes).toEqual([0x00, 0x00]);
    expect(rx.sampleRate).toBe(2048000);
  });

  it('rejects an unsupported sample rate without touching the bus', async () => {
    const bus = makeBus();
    const rx = new RtlSdrReceiver(bus);
    await expect(rx.setSampleRate(500000)).rejects.toThrow(/Unsupported/);
    expect(bus.writes.length).toBe(0);
  });

  it('open() runs the baseband init, sets IF 3.57 MHz and programs the tuner through the repeater', async () => {
    const bus = makeBus();
    const rx = new RtlSdrReceiver(bus);
    await rx.open();
    expect(rx.opened).toBe(true);
    expect(rx.tunerProbe).toEqual({ chipId: 0x69, looksLikeRafael: true });
    // IF multiplier bytes 0x38 0x11 0x12 on demod page 1, regs 0x19..0x1b.
    // The last write to each address is the IF one (the init list also touches these registers).
    const last = (v) => bus.writes.filter((w) => w.value === v).pop();
    expect(last(0x1920)).toMatchObject({ index: 0x11, bytes: [0x38] });
    expect(last(0x1a20)).toMatchObject({ index: 0x11, bytes: [0x11] });
    expect(last(0x1b20)).toMatchObject({ index: 0x11, bytes: [0x12] });
    // Repeater enabled (0x18) before the tuner I2C traffic, disabled (0x10) after.
    const repeaterOn = bus.writes.findIndex((w) => w.value === 0x0120 + 0 && w.bytes[0] === 0x18);
    const repeaterOff = bus.writes.findIndex((w, i) => i > repeaterOn && w.value === 0x0120 && w.bytes[0] === 0x10);
    const firstTunerWrite = bus.writes.findIndex((w) => w.index === ((6 << 8) | 0x10));
    expect(repeaterOn).toBeGreaterThan(-1);
    expect(firstTunerWrite).toBeGreaterThan(repeaterOn);
    expect(repeaterOff).toBeGreaterThan(firstTunerWrite);
  });

  it('tuning to 100 MHz programs the 0x10..0x16 PLL block for a 103.57 MHz LO', async () => {
    const bus = makeBus();
    const rx = new RtlSdrReceiver(bus);
    await rx.open();
    bus.writes.length = 0;
    await rx.tune(100000000);
    // The 7-byte PLL block is the only 8-byte I2C message addressed at 0x10 (the mux writes are 2 bytes).
    const pll = bus.writes.find((w) => w.index === ((6 << 8) | 0x10) && w.bytes[0] === 0x10 && w.bytes.length === 8);
    expect(pll).toBeTruthy();
    // bytes after the register address: regs 0x10..0x16; the last three are 0x14..0x16 = N, SDM lo, SDM hi.
    expect(pll.bytes.slice(-3)).toEqual([11, 245, 137]);
    // RF mux range for 100 MHz: tracking filter band 0x34 written to reg 0x1b.
    expect(bus.writes.find((w) => w.index === ((6 << 8) | 0x10) && w.bytes[0] === 0x1b)?.bytes[1]).toBe(0x34);
    expect(rx.centerHz).toBe(100000000);
  });

  it('tuning to 1093.57 MHz (ADS-B) uses mixer /2 and N=37', async () => {
    const bus = makeBus();
    const rx = new RtlSdrReceiver(bus);
    await rx.open();
    bus.writes.length = 0;
    await rx.tune(1090000000);
    const pll = bus.writes.find((w) => w.index === ((6 << 8) | 0x10) && w.bytes[0] === 0x10 && w.bytes.length === 8);
    expect(pll.bytes.slice(-3)).toEqual([6, 159, 248]);
  });

  it('a PPM correction scales the crystal used in the IF and PLL maths', () => {
    expect(xtalWithPpm(0)).toBe(28800000);
    expect(xtalWithPpm(100)).toBe(28802880);
    expect(xtalWithPpm(-50)).toBe(28798560);
  });

  it('manual gain 10 dB selects LNA step 4 and mixer step 3', async () => {
    const bus = makeBus();
    const rx = new RtlSdrReceiver(bus);
    await rx.open();
    bus.writes.length = 0;
    await rx.setGain(100);
    const tunerWrites = bus.writes.filter((w) => w.index === ((6 << 8) | 0x10));
    // Last write to reg 0x05 / 0x07 holds the chosen LNA / mixer index in the low nibble.
    const lastLna = tunerWrites.filter((w) => w.bytes[0] === 0x05).pop();
    const lastMix = tunerWrites.filter((w) => w.bytes[0] === 0x07).pop();
    expect(lastLna.bytes[1] & 0x0f).toBe(4);
    expect(lastMix.bytes[1] & 0x0f).toBe(3);
  });
});

describe('IQ helpers', () => {
  it('unsigned u8 IQ converts to signed int8 around zero', () => {
    expect(Array.from(u8ToInt8(Uint8Array.from([0, 128, 255])))).toEqual([-128, 0, 127]);
  });

  it('unsigned u8 IQ converts to floats in [-1, 1] centred on 127.5', () => {
    const f = u8ToFloat(Uint8Array.from([0, 128, 255]));
    expect(f[0]).toBeCloseTo(-1, 6);
    expect(f[1]).toBeCloseTo(0.0039215, 6);
    expect(f[2]).toBeCloseTo(1, 6);
  });

  it('recorder keeps bytes in order and stops at its cap', () => {
    const rec = new IqRecorder({ maxBytes: 10 });
    expect(rec.push(Uint8Array.from([1, 2, 3, 4]))).toBe(true);
    expect(rec.push(Uint8Array.from([5, 6, 7, 8, 9, 10, 11]))).toBe(false);
    expect(rec.truncated).toBe(true);
    expect(rec.bytes).toBe(10);
    expect(rec.chunks.length).toBe(2);
    expect(Array.from(rec.chunks[1])).toEqual([5, 6, 7, 8, 9, 10]);
    expect(rec.push(Uint8Array.from([0]))).toBe(false);
  });

  it('cu8 file name carries the centre frequency and rate', () => {
    expect(cu8FileName(100000000, 2048000)).toBe('rtlsdr_100000000Hz_2048000sps.cu8');
  });
});

describe('Demodulation of synthetic tones (hackrfDemod.Demodulator)', () => {
  const FS = 2048000;
  const N = 512000; // 0.25 s
  const AMP = 0.5;

  // Quantise a complex baseband signal to signed int8, like an RTL-SDR after u8 -> int8 conversion.
  const toInt8 = (re, im) => {
    const out = new Int8Array(re.length * 2);
    for (let k = 0; k < re.length; k++) {
      out[2 * k] = Math.max(-127, Math.min(127, Math.round(re[k] * 127)));
      out[2 * k + 1] = Math.max(-127, Math.min(127, Math.round(im[k] * 127)));
    }
    return out;
  };

  it('WFM: a 1 kHz tone on a 75 kHz deviation FM carrier demodulates to 1 kHz audio', () => {
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    let phase = 0;
    for (let k = 0; k < N; k++) {
      const m = Math.sin((2 * Math.PI * 1000 * k) / FS);
      phase += (2 * Math.PI * 75000 * m) / FS;
      re[k] = AMP * Math.cos(phase);
      im[k] = AMP * Math.sin(phase);
    }
    const d = new Demodulator({ inRate: FS, audioRate: 48000, mode: 'WFM' });
    const audio = d.process(toInt8(re, im));
    const steady = audio.subarray(Math.floor(audio.length * 0.3));
    const p1k = tonePower(steady, d.audioRate, 1000);
    const pOff = tonePower(steady, d.audioRate, 2700);
    expect(p1k).toBeGreaterThan(pOff * 20);
    expect(d.audioRate).toBeGreaterThan(40000);
  });

  it('NFM: a 1 kHz tone on a 2.5 kHz deviation carrier comes out at 1 kHz', () => {
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    let phase = 0;
    for (let k = 0; k < N; k++) {
      const m = Math.sin((2 * Math.PI * 1000 * k) / FS);
      phase += (2 * Math.PI * 2500 * m) / FS;
      re[k] = AMP * Math.cos(phase);
      im[k] = AMP * Math.sin(phase);
    }
    const d = new Demodulator({ inRate: FS, audioRate: 48000, mode: 'NFM' });
    const audio = d.process(toInt8(re, im));
    const steady = audio.subarray(Math.floor(audio.length * 0.3));
    expect(tonePower(steady, d.audioRate, 1000)).toBeGreaterThan(tonePower(steady, d.audioRate, 1600) * 20);
  });

  it('AM: a 1 kHz modulated carrier demodulates to a 1 kHz tone', () => {
    const I = new Int8Array(N * 2);
    for (let k = 0; k < N; k++) {
      const env = 0.5 * (1 + 0.5 * Math.sin((2 * Math.PI * 1000 * k) / FS));
      I[2 * k] = Math.round(env * 127);
      I[2 * k + 1] = 0;
    }
    const d = new Demodulator({ inRate: FS, audioRate: 48000, mode: 'AM' });
    const audio = d.process(I);
    const steady = audio.subarray(Math.floor(audio.length * 0.3));
    expect(tonePower(steady, d.audioRate, 1000)).toBeGreaterThan(tonePower(steady, d.audioRate, 1700) * 20);
  });

  it('a silent (zero) carrier produces near-silent WFM audio', () => {
    const I = new Int8Array(N * 2);
    const d = new Demodulator({ inRate: FS, audioRate: 48000, mode: 'WFM' });
    const audio = d.process(I);
    let peak = 0;
    for (let i = 0; i < audio.length; i++) peak = Math.max(peak, Math.abs(audio[i]));
    expect(peak).toBeLessThan(0.01);
  });
});
