import { describe, it, expect } from 'vitest';
import {
  encodeRegulatorSet,
  encodeSetPowerMode,
  encodeDutPower,
  encodeAverageStart,
  encodeAverageStop,
  encodeGetMetadata,
  parseMetadata,
  defaultCalibration,
  decodeWord,
  wordToUa,
  createSampleDecoder,
  decodeWords,
  convertWords,
  SampleRing,
  envelope,
  rangeStats,
  csvRows,
  recentAverageUa,
  requestPpk2Port,
  Ppk2Device,
  PPK2_USB_VENDOR_ID,
  PPK2_USB_PRODUCT_ID,
  SAMPLE_RATE_HZ,
} from '../src/utils/ppk2.js';

const flatCal = (over = {}) => ({
  R: [1, 1, 1, 1, 1],
  GS: [0, 0, 0, 0, 0],
  GI: [1, 1, 1, 1, 1],
  O: [0, 0, 0, 0, 0],
  S: [0, 0, 0, 0, 0],
  I: [0, 0, 0, 0, 0],
  UG: [1, 1, 1, 1, 1],
  ...over,
});

const word = (adc, range, bits) => ((bits << 24) | (range << 14) | adc) >>> 0;

function metadataText(over = {}) {
  const lines = [];
  for (const [name, base] of [['R', 1], ['GS', 1], ['GI', 1], ['O', 0], ['S', 0], ['I', 0], ['UG', 1]]) {
    for (let i = 0; i <= 4; i++) lines.push(`${name}${i}: ${base + i / 10}`);
  }
  lines.push('VDD: 3300', 'HW: 2.0.1', 'mode: 2', 'Calibrated: 1', 'IA: 0', 'END');
  return Object.entries(over).reduce((txt, [k, v]) => txt.replace(new RegExp(`^${k}: .*$`, 'm'), `${k}: ${v}`), lines.join('\n'));
}

describe('command encoders', () => {
  it('encodes REGULATOR_SET with the ppk2-api-python offset math', () => {
    // 3300 mV: diff = 3300-800+32 = 2532 -> 3 + 2532//256 = 12, 2532%256 = 228
    expect([...encodeRegulatorSet(3300)]).toEqual([0x0d, 12, 228]);
    expect([...encodeRegulatorSet(800)]).toEqual([0x0d, 3, 32]);
    // 5000 mV: diff = 4232 -> 19, 136
    expect([...encodeRegulatorSet(5000)]).toEqual([0x0d, 19, 136]);
  });

  it('clamps REGULATOR_SET to 800-5000 mV', () => {
    expect([...encodeRegulatorSet(100)]).toEqual([...encodeRegulatorSet(800)]);
    expect([...encodeRegulatorSet(6000)]).toEqual([...encodeRegulatorSet(5000)]);
  });

  it('rejects a non-numeric voltage', () => {
    expect(() => encodeRegulatorSet('abc')).toThrow(RangeError);
  });

  it('encodes power mode, DUT power, averaging and metadata commands', () => {
    expect([...encodeSetPowerMode('ampere')]).toEqual([0x11, 1]);
    expect([...encodeSetPowerMode('source')]).toEqual([0x11, 2]);
    expect(() => encodeSetPowerMode('nope')).toThrow(RangeError);
    expect([...encodeDutPower(true)]).toEqual([0x0c, 1]);
    expect([...encodeDutPower(false)]).toEqual([0x0c, 0]);
    expect([...encodeAverageStart()]).toEqual([0x06]);
    expect([...encodeAverageStop()]).toEqual([0x07]);
    expect([...encodeGetMetadata()]).toEqual([0x19]);
  });
});

describe('parseMetadata', () => {
  it('parses every per-range key and the device fields', () => {
    const r = parseMetadata(metadataText());
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.hasEnd).toBe(true);
    expect(r.calibration.R[0]).toBeCloseTo(1, 9);
    expect(r.calibration.R[4]).toBeCloseTo(1.4, 9);
    expect(r.calibration.UG[2]).toBeCloseTo(1.2, 9);
    expect(r.meta).toEqual({ vdd: 3300, hw: '2.0.1', mode: '2', calibrated: '1', ia: '0' });
  });

  it('tolerates CRLF line endings and leading noise', () => {
    const txt = 'garbage line\r\n' + metadataText().replace(/\n/g, '\r\n');
    const r = parseMetadata(txt);
    expect(r.complete).toBe(true);
    expect(r.calibration.GI[3]).toBeCloseTo(1.3, 9);
  });

  it('keeps the default for a zero resistor and reports a warning', () => {
    const r = parseMetadata(metadataText({ R2: '0' }));
    expect(r.calibration.R[2]).toBe(defaultCalibration().R[2]);
    expect(r.warnings.join(' ')).toMatch(/R2 reads 0/);
    expect(r.complete).toBe(false); // R2 was not applied, so it is not counted as calibrated
    expect(r.missing).toContain('R2');
  });

  it('reports missing keys so the caller can refuse to show calibrated currents', () => {
    const partial = metadataText().split('\n').filter((l) => !l.startsWith('O3:')).join('\n');
    const r = parseMetadata(partial);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(['O3']);
  });

  it('throws on a non-numeric calibration value', () => {
    expect(() => parseMetadata(metadataText({ GS1: 'x' }))).toThrow(/GS1/);
  });

  it('rejects non-string input', () => {
    expect(() => parseMetadata(null)).toThrow(TypeError);
  });
});

describe('sample decoding', () => {
  it('splits a word into ADC value, range and digital bits', () => {
    const w = word(10000, 2, 0xa5);
    expect(decodeWord(w)).toEqual({ adc: 10000, range: 2, bits: 0xa5 });
    expect(decodeWord(word(0x3fff, 4, 0xff))).toEqual({ adc: 0x3fff, range: 4, bits: 0xff });
  });

  it('clips range values above 4 to 4', () => {
    expect(decodeWord(word(1, 7, 0)).range).toBe(4);
  });

  it('decodes little-endian words from a byte stream', () => {
    const bytes = new Uint8Array(8);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, word(123, 1, 0x01), true);
    dv.setUint32(4, word(456, 3, 0x80), true);
    const words = decodeWords(createSampleDecoder(), bytes);
    expect(words.length).toBe(2);
    expect(decodeWord(words[0])).toEqual({ adc: 123, range: 1, bits: 0x01 });
    expect(decodeWord(words[1])).toEqual({ adc: 456, range: 3, bits: 0x80 });
  });

  it('carries a split sample across chunk boundaries', () => {
    const src = new Uint8Array(12);
    const dv = new DataView(src.buffer);
    [word(1, 0, 1), word(2, 1, 2), word(3, 2, 3)].forEach((w, i) => dv.setUint32(i * 4, w, true));
    const whole = decodeWords(createSampleDecoder(), src);
    const dec = createSampleDecoder();
    const parts = [decodeWords(dec, src.slice(0, 5)), decodeWords(dec, src.slice(5, 8)), decodeWords(dec, src.slice(8))];
    const joined = [...parts[0], ...parts[1], ...parts[2]];
    expect(joined).toEqual([...whole]);
    expect(dec.carry.length).toBe(0);
  });
});

describe('current calibration', () => {
  it('converts with the ppk2-api-python formula: adc*4 * 1.8/163840 / R', () => {
    // adc 10000 -> adc*4 = 40000; 40000 * 1.8 / 163840 = 0.439453125 A = 439453.125 uA
    expect(wordToUa(word(10000, 0, 0), flatCal(), 0)).toBeCloseTo(439453.125, 3);
  });

  it('applies the per-range resistor R', () => {
    const cal = flatCal({ R: [1, 2, 1, 1, 1] });
    expect(wordToUa(word(10000, 1, 0), cal, 0)).toBeCloseTo(439453.125 / 2, 3);
  });

  it('subtracts the offset O before scaling', () => {
    // (40000 - 4000) * 1.8 / 163840 = 0.3955078125 A
    const cal = flatCal({ O: [4000, 0, 0, 0, 0] });
    expect(wordToUa(word(10000, 0, 0), cal, 0)).toBeCloseTo(395507.8125, 3);
  });

  it('applies the UG gain to the whole result', () => {
    const cal = flatCal({ UG: [2, 1, 1, 1, 1] });
    expect(wordToUa(word(10000, 0, 0), cal, 0)).toBeCloseTo(878906.25, 3);
  });

  it('adds the S*(VDD in V) + I term in the calibration', () => {
    // S = 0.001 per V, VDD 3300 mV -> +3.3e-3 A = +3300 uA
    const cal = flatCal({ S: [0.001, 0, 0, 0, 0] });
    expect(wordToUa(word(10000, 0, 0), cal, 3300)).toBeCloseTo(439453.125 + 3300, 3);
    // I = 5e-6 A -> +5 uA
    const cal2 = flatCal({ I: [0.000005, 0, 0, 0, 0] });
    expect(wordToUa(word(10000, 0, 0), cal2, 0)).toBeCloseTo(439453.125 + 5, 3);
  });

  it('uses the GS/GI quadratic term', () => {
    // v = 0.439453125; GS=1, GI=0 -> amps = v*(v) = 0.193124...
    const cal = flatCal({ GS: [1, 0, 0, 0, 0], GI: [0, 0, 0, 0, 0] });
    const v = 0.439453125;
    expect(wordToUa(word(10000, 0, 0), cal, 0)).toBeCloseTo(v * v * 1e6, 1);
  });

  it('converts a chunk into µA and digital bytes', () => {
    const words = Uint32Array.of(word(10000, 0, 0x03), word(0, 0, 0x80));
    const { uA, bits } = convertWords(words, flatCal(), 0);
    expect(uA[0]).toBeCloseTo(439453.125, 2);
    expect(uA[1]).toBeCloseTo(0, 6);
    expect([...bits]).toEqual([0x03, 0x80]);
  });
});

describe('SampleRing, envelope and statistics', () => {
  it('overwrites the oldest samples once full and keeps absolute indices', () => {
    const ring = new SampleRing(4);
    ring.push(Float32Array.of(1, 2, 3, 4), new Uint8Array(4));
    ring.push(Float32Array.of(5, 6), new Uint8Array(2));
    expect(ring.total).toBe(6);
    expect(ring.oldest).toBe(2);
    expect(ring.uAt(2)).toBe(3);
    expect(ring.uAt(5)).toBe(6);
  });

  it('computes stats over a range, including across the wrap point', () => {
    const ring = new SampleRing(4);
    ring.push(Float32Array.of(1, 2, 3, 4), new Uint8Array(4));
    ring.push(Float32Array.of(5, 6), new Uint8Array(2));
    const s = rangeStats(ring, 2, 6);
    expect(s.samples).toBe(4);
    expect(s.avgUa).toBeCloseTo(4.5, 6);
    expect(s.minUa).toBe(3);
    expect(s.maxUa).toBe(6);
  });

  it('computes charge, mAh and energy from the 100 kS/s sample period', () => {
    const ring = new SampleRing(8);
    ring.push(Float32Array.of(10, 20, 30, 40), new Uint8Array(4));
    const s = rangeStats(ring, 0, 4, 3.3);
    expect(s.avgUa).toBe(25);
    expect(s.durationS).toBeCloseTo(4 / SAMPLE_RATE_HZ, 12);
    // sum 100 uA-samples * 10 us = 0.001 uC
    expect(s.chargeUc).toBeCloseTo(0.001, 9);
    expect(s.chargeMah).toBeCloseTo(0.001 / 3.6e6, 15);
    expect(s.energyUj).toBeCloseTo(0.001 * 3.3, 9);
    expect(s.energyMwh).toBeCloseTo((0.001 * 3.3) / 3.6e6, 15);
  });

  it('leaves energy null when no voltage is given', () => {
    const ring = new SampleRing(4);
    ring.push(Float32Array.of(1), new Uint8Array(1));
    expect(rangeStats(ring, 0, 1).energyUj).toBeNull();
    expect(rangeStats(ring, 0, 0).avgUa).toBeNull();
  });

  it('builds a min/max/avg envelope and digital AND/OR per column', () => {
    const ring = new SampleRing(100);
    const vals = Float32Array.from({ length: 100 }, (_, k) => k);
    const bits = Uint8Array.from({ length: 100 }, () => 0x80);
    ring.push(vals, bits);
    const env = envelope(ring, 0, 100, 10);
    expect(env.valid[9]).toBe(1);
    expect(env.min[3]).toBe(30);
    expect(env.max[3]).toBe(39);
    expect(env.avg[3]).toBeCloseTo(34.5, 4);
    expect(env.andBits[0]).toBe(0x80);
    expect(env.orBits[0]).toBe(0x80);
  });

  it('marks digital lanes that toggle inside a column as not constant', () => {
    const ring = new SampleRing(4);
    ring.push(Float32Array.of(0, 0), Uint8Array.of(0x00, 0x01));
    const env = envelope(ring, 0, 2, 1);
    expect(env.andBits[0]).toBe(0x00);
    expect(env.orBits[0]).toBe(0x01);
  });

  it('returns an empty envelope for an empty span', () => {
    const ring = new SampleRing(4);
    expect(envelope(ring, 0, 0, 10).valid.every((v) => v === 0)).toBe(true);
  });

  it('averages the most recent samples for the live readout', () => {
    const ring = new SampleRing(16);
    ring.push(Float32Array.of(1, 2, 3, 4), new Uint8Array(4));
    expect(recentAverageUa(ring, 4, 2)).toBeCloseTo(3.5, 6);
    expect(recentAverageUa(ring, 0, 2)).toBeNull();
  });
});

describe('CSV export', () => {
  it('writes time, current and eight digital lanes per sample', () => {
    const ring = new SampleRing(10);
    ring.push(Float32Array.of(1.5, 2), Uint8Array.of(0x81, 0x00));
    const rows = csvRows(ring, 0, 2).split('\n');
    expect(rows[0]).toBe('0.00000,1.500,1,0,0,0,0,0,0,1');
    expect(rows[1]).toBe('0.00001,2.000,0,0,0,0,0,0,0,0');
  });
});

describe('Web Serial access', () => {
  it('asks for the PPK2 vendor and product id only', async () => {
    let asked = null;
    const fakeSerial = { requestPort: async (opts) => { asked = opts; return { id: 'p' }; } };
    const port = await requestPpk2Port(fakeSerial);
    expect(port).toEqual({ id: 'p' });
    expect(asked).toEqual({
      filters: [{ usbVendorId: PPK2_USB_VENDOR_ID, usbProductId: PPK2_USB_PRODUCT_ID }],
    });
  });

  it('explains when Web Serial is missing', async () => {
    await expect(requestPpk2Port(undefined)).rejects.toThrow(/Chrome or Edge/);
  });
});

describe('Ppk2Device over a fake port', () => {
  // A fake Web Serial port: responds to GET_META_DATA with the metadata text, and lets the
  // test push sample bytes into the readable side.
  function fakePort() {
    let ctrl = null;
    const writes = [];
    const push = (b) => ctrl.enqueue(b);
    const port = {
      writes,
      opened: null,
      readable: new ReadableStream({ start(c) { ctrl = c; } }),
      writable: new WritableStream({
        write(chunk) {
          const bytes = Uint8Array.from(chunk);
          writes.push(bytes);
          if (bytes[0] === 0x19) push(new TextEncoder().encode(metadataText()));
        },
      }),
      async open(opts) { port.opened = opts; },
      async close() { try { ctrl.close(); } catch (e) { /* closed */ } },
    };
    return { port, push };
  }

  it('reads metadata text up to END', async () => {
    const { port } = fakePort();
    const dev = new Ppk2Device(port);
    await dev.open();
    const text = await dev.readMetadata(1000);
    expect(parseMetadata(text).complete).toBe(true);
    expect(port.writes[0][0]).toBe(0x19);
    await dev.close();
  });

  it('rejects when the device never answers', async () => {
    const port = {
      readable: new ReadableStream({ start() {} }),
      writable: new WritableStream({ write() {} }),
      async open() {}, async close() {},
    };
    const dev = new Ppk2Device(port);
    await dev.open();
    await expect(dev.readMetadata(50)).rejects.toThrow(/calibration metadata/);
    await dev.close();
  });

  it('delivers sample bytes to onSamples after the start-up discard window', async () => {
    const { port, push } = fakePort();
    const dev = new Ppk2Device(port);
    const got = [];
    dev.onSamples = (b) => got.push(...b);
    await dev.open();
    await new Promise((r) => setTimeout(r, 200));
    push(Uint8Array.of(1, 2, 3, 4));
    await new Promise((r) => setTimeout(r, 20));
    expect(got).toEqual([1, 2, 3, 4]);
    await dev.close();
  });
});
