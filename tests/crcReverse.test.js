import { describe, it, expect } from 'vitest';
import {
  CRC_CATALOGUE,
  findCrcModel,
  crcOf,
  crcNum,
  crcBig,
  residueOf,
  allChecksums,
  matchExpected,
  bytesFromInput,
  parseSampleText,
  reverseCrc,
  locateCrc,
  revengString,
  SIMPLE_SUMS,
} from '../src/utils/crcReverse.js';
import { numModel, bigModel } from '../src/utils/crcReverse/engine.js';
import { sum8, xor8, lrc, fletcher16, adler32, internetChecksum } from '../src/utils/crcReverse/sums.js';

const CHECK = new TextEncoder().encode('123456789');

// Deterministic PRNG so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (r, n) => Math.floor(r() * n);
const randBytes = (r, n) => Uint8Array.from({ length: n }, () => randInt(r, 256));
const frameWith = (payload, crc, width, order) => {
  const nb = width / 8;
  const out = new Uint8Array(payload.length + nb);
  out.set(payload, 0);
  for (let i = 0; i < nb; i++) {
    const byte = Number((crc >> BigInt(8 * i)) & 0xffn);
    out[payload.length + (order === 'le' ? i : nb - 1 - i)] = byte;
  }
  return out;
};

describe('RevEng catalogue', () => {
  it('has at least 60 entries, all widths between 3 and 64', () => {
    expect(CRC_CATALOGUE.length).toBeGreaterThanOrEqual(60);
    for (const m of CRC_CATALOGUE) {
      expect(m.width).toBeGreaterThanOrEqual(3);
      expect(m.width).toBeLessThanOrEqual(64);
    }
  });

  it('every entry reproduces its own check value for "123456789" (BigInt engine)', () => {
    const failures = [];
    for (const m of CRC_CATALOGUE) {
      const got = crcBig(CHECK, bigModel(m));
      if (got !== m.check) failures.push(`${m.name}: got 0x${got.toString(16)} want 0x${m.check.toString(16)}`);
    }
    expect(failures).toEqual([]);
  });

  it('every entry with width <= 32 agrees with the Number engine on the check value', () => {
    for (const m of CRC_CATALOGUE.filter((c) => c.width <= 32)) {
      expect(crcNum(CHECK, numModel(m))).toBe(Number(m.check));
    }
  });

  it('residue is constant across messages for whole-byte models', () => {
    const r = rng(7);
    for (const m of CRC_CATALOGUE.filter((c) => c.width % 8 === 0)) {
      const a = residueOf(randBytes(r, 9), m);
      const b = residueOf(randBytes(r, 33), m);
      expect(a, m.name).toBe(b);
    }
  });

  it('finds models by name and alias', () => {
    expect(findCrcModel('crc-16/modbus').name).toBe('CRC-16/MODBUS');
    expect(findCrcModel('CRC-16/CCITT-FALSE').name).toBe('CRC-16/IBM-3740');
    expect(findCrcModel('CRC-32C').name).toBe('CRC-32/ISCSI');
    expect(findCrcModel('nope')).toBeNull();
  });

  it('known vectors for the named models', () => {
    expect(crcOf(CHECK, findCrcModel('CRC-16/MODBUS'))).toBe(0x4b37n);
    expect(crcOf(CHECK, findCrcModel('CRC-16/XMODEM'))).toBe(0x31c3n);
    expect(crcOf(CHECK, findCrcModel('CRC-32/ISO-HDLC'))).toBe(0xcbf43926n);
    expect(crcOf(CHECK, findCrcModel('CRC-64/XZ'))).toBe(0x995dc9bbdf1939fan);
  });

  it('RevEng string carries the check value', () => {
    const s = revengString(findCrcModel('CRC-16/MODBUS'));
    expect(s).toContain('width=16');
    expect(s).toContain('poly=0x8005');
    expect(s).toContain('check=0x4b37');
  });
});

describe('engine cross-check', () => {
  it('Number and BigInt engines agree on random models up to 32 bits', () => {
    const r = rng(42);
    for (let t = 0; t < 300; t++) {
      const width = 1 + randInt(r, 32);
      const mask = width === 32 ? 0xffffffffn : (1n << BigInt(width)) - 1n;
      const big = {
        width,
        poly: (BigInt(Math.floor(r() * 2 ** 32)) & mask) | 1n,
        init: BigInt(Math.floor(r() * 2 ** 32)) & mask,
        xorout: BigInt(Math.floor(r() * 2 ** 32)) & mask,
        refin: r() < 0.5,
        refout: r() < 0.5,
      };
      const bytes = randBytes(r, randInt(r, 24));
      expect(BigInt(crcNum(bytes, numModel(big)))).toBe(crcBig(bytes, big));
    }
  });
});

describe('simple sums', () => {
  it('match hand-computed values for "123456789"', () => {
    expect(sum8(CHECK)).toBe(0xdd);
    expect(xor8(CHECK)).toBe(0x31);
    expect(lrc(CHECK)).toBe(0x23);
  });

  it('Fletcher-16, Adler-32 and the Internet checksum match published examples', () => {
    expect(fletcher16(new TextEncoder().encode('abcde'))).toBe(0xc8f0);
    expect(adler32(new TextEncoder().encode('Wikipedia'))).toBe(0x11e60398);
    expect(internetChecksum(Uint8Array.from([0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7]))).toBe(0x220d);
  });

  it('every sum returns a value that fits its width', () => {
    for (const s of SIMPLE_SUMS) expect(s.fn(CHECK)).toBeLessThan(2 ** s.width);
  });
});

describe('calculator', () => {
  it('allChecksums lists the catalogue and sums; matchExpected finds CRC-32 of "123456789"', () => {
    const list = allChecksums(CHECK);
    expect(list.length).toBe(CRC_CATALOGUE.length + SIMPLE_SUMS.length);
    const { matches } = matchExpected(list, 'CBF43926');
    expect(matches.map((m) => m.name)).toContain('CRC-32/ISO-HDLC');
  });

  it('ASCII and hex inputs produce the same bytes', () => {
    expect(bytesFromInput('123456789', 'ascii')).toEqual(CHECK);
    expect(bytesFromInput('31 32 33', 'hex')).toEqual(Uint8Array.from([0x31, 0x32, 0x33]));
  });
});

describe('sample parsing', () => {
  it('tail layout splits the last k bytes off as the checksum', () => {
    const { samples, errors } = parseSampleText('01 02 03 04 05\nAA BB CC DD EE', { layout: 'tail', tailBytes: 2 });
    expect(errors).toEqual([]);
    expect(Array.from(samples[0].payload)).toEqual([1, 2, 3]);
    expect(Array.from(samples[0].checksum)).toEqual([4, 5]);
  });

  it('separate layout reads payload:checksum', () => {
    const { samples, errors } = parseSampleText('0102:AABB\n0304:CCDD', { layout: 'separate' });
    expect(errors).toEqual([]);
    expect(Array.from(samples[1].checksum)).toEqual([0xcc, 0xdd]);
  });

  it('reports short frames and mismatched checksum sizes', () => {
    const { errors } = parseSampleText('01\n0102030405', { layout: 'tail', tailBytes: 2 });
    expect(errors.length).toBeGreaterThan(0);
  });
});

// Build samples for a random model and check the solver recovers it.
function makeSamples(model, lengths, r, order = 'be') {
  return lengths.map((n) => {
    const payload = randBytes(r, n);
    const crc = crcOf(payload, model);
    return { payload, checksum: frameWith(new Uint8Array(0), crc, model.width, order).slice(0, model.width / 8) };
  });
}

function randomModel(r, width) {
  const mask = (1n << BigInt(width)) - 1n;
  const rand = () => BigInt(Math.floor(r() * 2 ** width)) & mask;
  return {
    name: `random-${width}`,
    width,
    poly: rand() | 1n,
    init: rand(),
    xorout: rand(),
    refin: r() < 0.5,
    refout: r() < 0.5,
  };
}

describe('solver', () => {
  it('finds a catalogue model from a single frame (MODBUS, little-endian checksum)', async () => {
    const r = rng(1);
    const modbus = findCrcModel('CRC-16/MODBUS');
    const payload = randBytes(r, 12);
    const frame = frameWith(payload, crcOf(payload, modbus), 16, 'le');
    const { samples } = parseSampleText(Array.from(frame, (b) => b.toString(16).padStart(2, '0')).join(' '), {
      layout: 'tail',
      tailBytes: 2,
    });
    const { candidates } = await reverseCrc(samples, { orders: ['le'] });
    expect(candidates.some((c) => c.source === 'catalogue' && c.name === 'CRC-16/MODBUS')).toBe(true);
  });

  it('recovers the sum family from samples (Fletcher-16)', async () => {
    const r = rng(3);
    const payloads = [randBytes(r, 7), randBytes(r, 10)];
    const samples = payloads.map((p) => {
      const v = fletcher16(p);
      return { payload: p, checksum: Uint8Array.from([v & 0xff, v >> 8]) };
    });
    const { candidates } = await reverseCrc(samples, { orders: ['le'] });
    expect(candidates.some((c) => c.source === 'sum' && c.name === 'Fletcher-16')).toBe(true);
  });

  it('brute force width 8 recovers random models (poly, refin, refout, init, xorout)', async () => {
    const r = rng(11);
    for (let t = 0; t < 6; t++) {
      const model = randomModel(r, 8);
      const samples = makeSamples(model, [6, 6, 11], r);
      const { candidates } = await reverseCrc(samples, { bruteWidths: [8], known32: false });
      const hit = candidates.find(
        (c) => c.source === 'brute' && c.poly === model.poly && c.refin === model.refin && c.refout === model.refout,
      );
      expect(hit, `trial ${t}`).toBeTruthy();
      // Every reported model must reproduce every sample.
      for (const c of candidates.filter((x) => x.source === 'brute')) {
        const m = { width: 8, poly: Number(c.poly), init: Number(c.init), xorout: Number(c.xorout), refin: c.refin, refout: c.refout };
        for (const s of samples) expect(crcNum(s.payload, m)).toBe(s.checksum[0]);
      }
      if (hit.determined) {
        expect(hit.init).toBe(model.init);
        expect(hit.xorout).toBe(model.xorout);
      }
    }
  }, 30000);

  it('brute force width 16 (differential method) recovers random models', async () => {
    const r = rng(23);
    for (let t = 0; t < 3; t++) {
      const model = randomModel(r, 16);
      const samples = makeSamples(model, [8, 8, 13], r);
      const { candidates } = await reverseCrc(samples, { bruteWidths: [16], known32: false });
      const hit = candidates.find(
        (c) => c.source === 'brute' && c.poly === model.poly && c.refin === model.refin && c.refout === model.refout,
      );
      expect(hit, `trial ${t}`).toBeTruthy();
      if (hit.determined) {
        expect(hit.init).toBe(model.init);
        expect(hit.xorout).toBe(model.xorout);
      }
    }
  }, 60000);

  it('width 32: a known polynomial with random init/xorout is recovered', async () => {
    const r = rng(31);
    const model = { name: 'k32', width: 32, poly: 0x04c11db7n, init: 0x12345678n, xorout: 0x9abcdef0n, refin: true, refout: false };
    const samples = makeSamples(model, [5, 9, 14], r);
    const { candidates } = await reverseCrc(samples, { bruteWidths: [] });
    const hit = candidates.find((c) => c.source === 'known-poly' && c.poly === model.poly && c.refin === true && c.refout === false);
    expect(hit).toBeTruthy();
    expect(hit.init).toBe(model.init);
    expect(hit.xorout).toBe(model.xorout);
  });

  it('reports no model when the samples are inconsistent', async () => {
    const r = rng(5);
    const samples = [
      { payload: randBytes(r, 6), checksum: Uint8Array.from([1]) },
      { payload: randBytes(r, 6), checksum: Uint8Array.from([2]) },
      { payload: randBytes(r, 9), checksum: Uint8Array.from([3]) },
    ];
    const { candidates } = await reverseCrc(samples, { bruteWidths: [8], known32: false });
    expect(candidates.filter((c) => c.source === 'brute')).toEqual([]);
  });

  it('cancellation stops the search', async () => {
    const r = rng(9);
    const samples = makeSamples(randomModel(r, 16), [8, 8, 13], r);
    const { cancelled } = await reverseCrc(samples, { bruteWidths: [16], known32: false, isCancelled: () => true });
    expect(cancelled).toBe(true);
  });
});

describe('locate CRC inside a frame', () => {
  it('finds a little-endian MODBUS CRC covering a range that starts at offset 3', async () => {
    const payload = Uint8Array.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60]);
    const crc = crcOf(payload, findCrcModel('CRC-16/MODBUS'));
    const head = Uint8Array.from([0xaa, 0xbb, 0xcc]);
    const body = frameWith(payload, crc, 16, 'le');
    const frame = new Uint8Array(head.length + body.length);
    frame.set(head, 0);
    frame.set(body, head.length);
    const { matches, cancelled } = await locateCrc(frame, { k: 2, orders: ['le'] });
    expect(cancelled).toBe(false);
    expect(matches.some((m) => m.name === 'CRC-16/MODBUS' && m.start === 3 && m.end === frame.length - 2)).toBe(true);
  });

  it('rejects frames shorter than the checksum', async () => {
    await expect(locateCrc(Uint8Array.from([1]), { k: 2 })).rejects.toThrow();
  });
});
