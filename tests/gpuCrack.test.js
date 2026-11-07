import { describe, it, expect } from 'vitest';
import { ordinalToIndices, ordinalToString, packMd5Target } from '../src/utils/gpuCrack.js';
import { parseMask, maskCandidates } from '../src/utils/hashCrack.js';
import { md5Hex } from '../src/utils/md5.js';

describe('gpu helpers (pure)', () => {
  it('ordinalToIndices is an odometer with last position fastest', () => {
    expect(ordinalToIndices(0, [10, 10])).toEqual([0, 0]);
    expect(ordinalToIndices(1, [10, 10])).toEqual([0, 1]);
    expect(ordinalToIndices(10, [10, 10])).toEqual([1, 0]);
    expect(ordinalToIndices(99, [10, 10])).toEqual([9, 9]);
  });

  it('ordinalToString matches the CPU mask generator order', () => {
    const sets = parseMask('?l?d');
    const cpu = [...maskCandidates(sets)];
    for (let o = 0; o < cpu.length; o++) expect(ordinalToString(o, sets)).toBe(cpu[o]);
  });

  it('packMd5Target yields 4 LE u32 words consistent with the digest', () => {
    const hex = md5Hex(new TextEncoder().encode('abcz')); // db3c0a46...
    const words = packMd5Target(hex);
    expect(words).toHaveLength(4);
    // reconstruct hex from the 4 LE words and compare
    const back = words.map((w) => {
      let s = '';
      for (let b = 0; b < 4; b++) s += (((w >>> (b * 8)) & 0xff)).toString(16).padStart(2, '0');
      return s;
    }).join('');
    expect(back).toBe(hex);
  });

  it('self-test ordinal of "abcz" is reachable in a ?l^4 mask', () => {
    const sets = parseMask('?l?l?l?l');
    // find ordinal of abcz and confirm round-trip
    const cpu = [...maskCandidates(sets)];
    const ord = cpu.indexOf('abcz');
    expect(ord).toBeGreaterThan(-1);
    expect(ordinalToString(ord, sets)).toBe('abcz');
  });
});
