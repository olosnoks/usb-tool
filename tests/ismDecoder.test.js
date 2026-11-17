import { describe, it, expect } from 'vitest';
import {
  parseRtl433Filename, formatFromFilename, runsFromLevels, despikeRuns, clusterValues,
  analyzeIqBuffer, sliceRows, analyzeSegments, boxcar, demodBuffer,
} from '../src/utils/ismDecoder.js';
import { crc8, lfsrDigest8, sumBytes, bitsToHex, invertBits } from '../src/utils/ismDecoder/devices.js';

const SR = 250000;

// ---- synthetic IQ (cu8) built from on/off runs in microseconds --------------------
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const clamp8 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** runs: [{ on: boolean, us }] -> cu8 ArrayBuffer. ON = amplitude 0.5, OFF = 0.02 plus noise. */
function cu8FromRuns(runs, sr = SR, seed = 7) {
  const rnd = lcg(seed);
  const parts = [];
  let t = 0;
  for (const r of runs) {
    const a = Math.round((t * sr) / 1e6);
    t += r.us;
    const b = Math.round((t * sr) / 1e6);
    parts.push({ on: r.on, n: b - a });
  }
  // 5 ms of idle at the start and end so the noise floor is measured on noise.
  const pad = Math.round(sr * 0.005);
  const total = pad * 2 + parts.reduce((s, p) => s + p.n, 0);
  const buf = new Uint8Array(total * 2);
  let k = 0;
  const put = (on) => {
    const amp = on ? 0.5 : 0.02;
    const I = amp + (rnd() - 0.5) * 0.02;
    const Q = (rnd() - 0.5) * 0.02;
    buf[2 * k] = clamp8(127.5 + 127.5 * I);
    buf[2 * k + 1] = clamp8(127.5 + 127.5 * Q);
    k++;
  };
  for (let i = 0; i < pad; i++) put(false);
  for (const p of parts) for (let i = 0; i < p.n; i++) put(p.on);
  for (let i = 0; i < pad; i++) put(false);
  return buf.buffer;
}

/** Bits -> PWM runs. Each bit is a mark (short for 1, long for 0) then a gap. */
function pwmRuns(bits, { shortUs, longUs, periodUs, gapUs }) {
  const runs = [];
  for (const b of bits) {
    const mark = b ? shortUs : longUs;
    runs.push({ on: true, us: mark });
    runs.push({ on: false, us: gapUs ?? (periodUs - mark) });
  }
  return runs;
}

/** Bits -> PPM runs: fixed mark, gap decides the bit. */
function ppmRuns(bits, { markUs, gap0, gap1 }) {
  const runs = [];
  for (const b of bits) {
    runs.push({ on: true, us: markUs });
    runs.push({ on: false, us: b ? gap1 : gap0 });
  }
  return runs;
}

/** Bits -> Manchester runs with IEEE pairs: 1 = (high, low), 0 = (low, high). */
function manRuns(bits, halfUs) {
  const half = [];
  for (const b of bits) half.push(...(b ? [1, 0] : [0, 1]));
  const runs = [];
  let i = 0;
  while (i < half.length) {
    let j = i + 1;
    while (j < half.length && half[j] === half[i]) j++;
    runs.push({ on: half[i] === 1, us: (j - i) * halfUs });
    i = j;
  }
  return runs;
}

const bitsOf = (bytes) => {
  const out = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) out.push((b >> i) & 1);
  return out;
};

const runBits = (str) => Array.from(str, (c) => (c === '1' ? 1 : 0));

const IDLE = { on: false, us: 5000 };

describe('filename convention', () => {
  it('parses rtl_433 style names', () => {
    expect(parseRtl433Filename('g001_433.92M_250k.cu8')).toEqual({ centerFreqHz: 433920000, sampleRate: 250000, format: 'cu8' });
    expect(parseRtl433Filename('C:\\caps\\g002_915M_2.048M.cs8')).toEqual({ centerFreqHz: 915000000, sampleRate: 2048000, format: 'cs8' });
  });

  it('returns nulls when nothing matches', () => {
    expect(parseRtl433Filename('capture.bin')).toEqual({ centerFreqHz: null, sampleRate: null, format: null });
    expect(formatFromFilename('x.cf32')).toBe('cf32');
    expect(formatFromFilename('x.wav')).toBeNull();
  });
});

describe('sample decoding', () => {
  it('cu8 centre value maps to 0 and full scale to ~1', () => {
    const env = demodBuffer(new Uint8Array([128, 128, 255, 127]).buffer, 'cu8', 'ook');
    expect(env[0]).toBeCloseTo(Math.hypot(0.0039, 0.0039), 3);
    expect(env[1]).toBeGreaterThan(0.99);
  });

  it('cs16 and cf32 are read little-endian', () => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setInt16(0, 16384, true); dv.setInt16(2, 0, true);
    expect(demodBuffer(dv.buffer, 'cs16', 'ook')[0]).toBeCloseTo(0.5, 4);
    const f = new DataView(new ArrayBuffer(8));
    f.setFloat32(0, 0.25, true); f.setFloat32(4, 0, true);
    expect(demodBuffer(f.buffer, 'cf32', 'ook')[0]).toBeCloseTo(0.25, 5);
  });

  it('boxcar smooths a step without shifting it', () => {
    const x = new Float32Array([0, 0, 0, 1, 1, 1, 1]);
    const y = boxcar(x, 3);
    expect(y[2]).toBeCloseTo(1 / 3, 5);
    expect(y[3]).toBeCloseTo(2 / 3, 5);
  });
});

describe('runs, despike and clustering', () => {
  it('run-length encodes levels and drops glitches', () => {
    const lv = Uint8Array.from([0, 0, 1, 1, 1, 0, 1, 0, 0]);
    expect(runsFromLevels(lv).map((r) => [r.level, r.len])).toEqual([[0, 2], [1, 3], [0, 1], [1, 1], [0, 2]]);
    const clean = despikeRuns(runsFromLevels(lv), 2);
    expect(clean.every((r, i) => i === 0 || r.level !== clean[i - 1].level)).toBe(true);
  });

  it('clusters durations with a relative tolerance', () => {
    const c = clusterValues([218, 221, 220, 405, 410, 408, 1600]);
    expect(c.map((x) => x.count)).toEqual([3, 3, 1]);
    expect(c[0].mean).toBeCloseTo(219.7, 0);
  });
});

describe('slicers from synthetic pulses', () => {
  it('PWM: short mark = 1 (rtl_433 convention), fixed period', () => {
    const want = runBits('1011001110');
    const iq = cu8FromRuns([...pwmRuns(want, { shortUs: 220, longUs: 408, periodUs: 612 }), { on: false, us: 4000 }, IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    const rows = sliceRows(res.segments, { modulation: 'pwm', thresholdUs: 314, resetUs: 2500 });
    expect(rows.length).toBe(1);
    expect(Array.from(rows[0].bits.slice(0, want.length))).toEqual(want);
    expect(res.analysis.guess.modulation).toBe('pwm');
    expect(res.analysis.guess.thresholdUs).toBeGreaterThan(310);
    expect(res.analysis.guess.thresholdUs).toBeLessThan(320);
  });

  it('PPM: gap width carries the bit', () => {
    const want = runBits('110010110');
    // a stop mark, then the 4 ms packet gap, so the last data gap is not merged with it
    const iq = cu8FromRuns([...ppmRuns(want, { markUs: 500, gap0: 1000, gap1: 2000 }), { on: true, us: 500 }, { on: false, us: 4000 }, IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    expect(res.analysis.guess.modulation).toBe('ppm');
    const rows = sliceRows(res.segments, { modulation: 'ppm', thresholdUs: 1500, resetUs: 3500 });
    expect(Array.from(rows[0].bits)).toEqual(want);
  });

  it('Manchester: IEEE pairs at a 500 us half-bit clock', () => {
    const want = runBits('1001101011');
    const iq = cu8FromRuns([...manRuns(want, 500), IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    expect(res.analysis.guess.modulation).toBe('manchester');
    expect(res.analysis.guess.halfBitUs).toBeGreaterThan(495);
    expect(res.analysis.guess.halfBitUs).toBeLessThan(505);
    const rows = sliceRows(res.segments, { modulation: 'manchester', halfBitUs: 500, resetUs: 5000 });
    const hit = rows.find((r) => r.bits.length >= want.length && Array.from(r.bits.slice(0, want.length)).join('') === want.join(''));
    expect(hit).toBeTruthy();
  });

  it('segment durations are recovered within a few microseconds', () => {
    const iq = cu8FromRuns([{ on: true, us: 1000 }, { on: false, us: 800 }, { on: true, us: 300 }, { on: false, us: 2000 }, IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    const m = res.segments.map((s) => Math.round(s.markUs));
    expect(m[0]).toBeGreaterThan(990);
    expect(m[0]).toBeLessThan(1010);
    expect(Math.round(res.segments[0].gapUs)).toBeGreaterThan(790);
    expect(res.segments[1].markUs).toBeGreaterThan(290);
  });
});

describe('device decoders through the full pipeline', () => {
  it('Acurite 592TXR: byte sum validated, fields decoded', () => {
    const id = 0x2a7;
    const cc = 2;
    const raw1215 = 1215;
    const b = [
      ((cc << 6) | ((id >> 8) & 0x3f)) & 0xff, id & 0xff,
      0x04 | 0x40, // battery OK (bit 6 set)
      55,
      (raw1215 >> 7) & 0x7f, raw1215 & 0x7f,
    ];
    b.push(sumBytes(Uint8Array.from(b), 6));
    const dataBits = bitsOf(b);
    const rawBits = invertBits(Uint8Array.from(dataBits)); // rtl_433 inverts before decoding
    const runs = [];
    for (const r of rawBits) {
      runs.push({ on: true, us: r ? 220 : 408 });
      runs.push({ on: false, us: r ? 392 : 204 });
    }
    const iq = cu8FromRuns([...runs, { on: false, us: 3000 }, IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    const d = res.decodes.find((x) => x.deviceId === 'acurite-txr');
    expect(d).toBeTruthy();
    expect(d.ok).toBe(true);
    const f = Object.fromEntries(d.fields.map((x) => [x.k, x.v]));
    expect(f.ID).toBe(id);
    expect(f.Battery).toBe('OK');
    expect(f.Humidity).toBe('55 %');
    expect(f.Temperature).toBe('21.5 C');
  });

  it('Acurite: a wrong byte-sum is rejected', () => {
    const b = [0x81, 0x23, 0x44, 40, 0x10, 0x20, 0x00];
    const bits = bitsOf(b);
    const raw = invertBits(Uint8Array.from(bits));
    const runs = [];
    for (const r of raw) { runs.push({ on: true, us: r ? 220 : 408 }); runs.push({ on: false, us: r ? 392 : 204 }); }
    const res = analyzeIqBuffer(cu8FromRuns([...runs, { on: false, us: 3000 }, IDLE]), { format: 'cu8', sampleRate: SR });
    expect(res.decodes.filter((x) => x.deviceId === 'acurite-txr')).toHaveLength(0);
  });

  it('Fine Offset WH2: 0xFF preamble and CRC-8 poly 0x31', () => {
    const b0 = 0x45; // type 4, id high nibble 5
    const b = [b0, 0xa0, 0xd5, 63]; // id 0x5A, temperature 213 -> 21.3 C, humidity 63
    b.push(crc8(Uint8Array.from(b), 4, 0x31, 0));
    const bits = [...Array(8).fill(1), ...bitsOf(b)];
    const iq = cu8FromRuns([...pwmRuns(bits, { shortUs: 544, longUs: 1524, periodUs: 0, gapUs: 1036 }), { on: false, us: 4000 }, IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    const d = res.decodes.find((x) => x.deviceId === 'fineoffset-wh2');
    expect(d).toBeTruthy();
    expect(d.ok).toBe(true);
    const f = Object.fromEntries(d.fields.map((x) => [x.k, x.v]));
    expect(f.ID).toBe(0x5a);
    expect(f.Temperature).toBe('21.3 C');
    expect(f.Humidity).toBe('63 %');
  });

  it('Ambient F007TH: Manchester, 0x01 0x45 preamble, LFSR digest', () => {
    // Body bytes; the high nibble of byte 0 is the leftover 0100 of the preamble.
    const body = [0x45, 0x6b, 0x04, 0x4c, 0x2d, 0];
    body[5] = (lfsrDigest8(Uint8Array.from(body), 5, 0x98, 0x3e) ^ 0x64) & 0xff;
    // Stream = first 8 bits of preamble (0x01) followed by the 48-bit body.
    const bits = [...bitsOf([0x01]), ...bitsOf(body)];
    const iq = cu8FromRuns([...manRuns(bits, 500), IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    const d = res.decodes.find((x) => x.deviceId === 'ambient-f007th');
    expect(d).toBeTruthy();
    expect(d.ok).toBe(true);
    const f = Object.fromEntries(d.fields.map((x) => [x.k, x.v]));
    expect(f.ID).toBe(0x6b);
    expect(f.Humidity).toBe('45 %');
    expect(f.Temperature).toMatch(/^21\.1 C/);
  });

  it('Nexus temperature: 36-bit frame, constant nibble, stop mark excluded', () => {
    // nibbles: id 0x2D, flags 0x9 (battery OK, channel 2), temp12 0x0D2 (21.0 C), const F, humidity 60
    const n = [0x2, 0xd, 0x9, 0x0, 0xd, 0x2, 0xf, 0x3, 0xc];
    const bits = [];
    for (const v of n) for (let i = 3; i >= 0; i--) bits.push((v >> i) & 1);
    const iq = cu8FromRuns([...ppmRuns(bits, { markUs: 500, gap0: 1000, gap1: 2000 }), { on: true, us: 500 }, { on: false, us: 4000 }, IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    const d = res.decodes.find((x) => x.deviceId === 'nexus-temp');
    expect(d).toBeTruthy();
    expect(d.ok).toBe(true);
    const f = Object.fromEntries(d.fields.map((x) => [x.k, x.v]));
    expect(f.ID).toBe(0x2d);
    expect(f.Channel).toBe(2);
    expect(f.Temperature).toBe('21.0 C');
    expect(f.Humidity).toBe('60 %');
  });

  it('EV1527: 24-bit code from a PWM sync-terminated frame', () => {
    const code = 0xabcdef;
    const bits = [];
    for (let i = 23; i >= 0; i--) bits.push((code >> i) & 1);
    // '0' = high 320 / low 960, '1' = high 960 / low 320; sync = high 320, low 9600
    const runs = [];
    for (const b of bits) { runs.push({ on: true, us: b ? 960 : 320 }); runs.push({ on: false, us: b ? 320 : 960 }); }
    runs.push({ on: true, us: 320 }, { on: false, us: 9600 });
    const iq = cu8FromRuns([...runs, IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    const d = res.decodes.find((x) => x.deviceId === 'ev1527');
    expect(d).toBeTruthy();
    expect(d.fields[0].v).toBe('0xABCDEF');
    expect(d.ok).toBe(true);
  });

  it('a noise-only recording produces no device decodes', () => {
    const iq = cu8FromRuns([IDLE]);
    const res = analyzeIqBuffer(iq, { format: 'cu8', sampleRate: SR });
    expect(res.decodes).toHaveLength(0);
  });
});

describe('helpers', () => {
  it('hex packing and analyzer on an empty segment list', () => {
    expect(bitsToHex(Uint8Array.from([1, 0, 1, 1, 1, 1, 0, 0]))).toBe('BC');
    const a = analyzeSegments([], 'ook');
    expect(a.guess.modulation).toBe('unknown');
  });

  it('rejects files over the size limit before decoding', () => {
    const big = new ArrayBuffer(64 * 1024 * 1024 + 2);
    expect(() => analyzeIqBuffer(big, { format: 'cu8', sampleRate: SR })).toThrow(/limit/);
  });
});
