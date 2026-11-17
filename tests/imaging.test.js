import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { imageRange, verifyRange, badSectorMap, formatImageLog } from '../src/utils/imaging';
import { Md5, Sha1, MultiHasher } from '../src/utils/streamHash';

const BS = 512;
const source = (sectors) => {
  let s = 12345;
  return Uint8Array.from({ length: sectors * BS }, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s >> 16) & 0xff; });
};
const hashesOf = (bytes) => ({
  md5: createHash('md5').update(bytes).digest('hex'),
  sha1: createHash('sha1').update(bytes).digest('hex'),
  sha256: createHash('sha256').update(bytes).digest('hex')
});
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.length).equals(Buffer.from(b.buffer, b.byteOffset, b.length));
const concat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out; };

/** A reader over `data` that fails for any request touching a bad LBA. */
const flaky = (data, bad) => async (lba, n) => {
  for (let l = lba; l < lba + n; l++) if (bad(l)) throw new Error(`I/O error at LBA ${l}`);
  return data.slice(lba * BS, (lba + n) * BS);
};
const zeroed = (data, ranges) => { const e = data.slice(); ranges.forEach((r) => e.fill(0, r.startLba * BS, (r.startLba + r.sectors) * BS)); return e; };

describe('hashes', () => {
  const enc = (s) => new TextEncoder().encode(s);
  it('MD5 and SHA-1 match the RFC test vectors', () => {
    expect(new Md5().hex()).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(new Md5().update(enc('abc')).hex()).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(new Md5().update(enc('message digest')).hex()).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(new Sha1().hex()).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
    expect(new Sha1().update(enc('abc')).hex()).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(new Sha1().update(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).hex()).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1');
  });

  it('streams in odd chunk sizes and agrees with node:crypto, including the 1,000,000 x a vector', () => {
    const a = new Uint8Array(1000).fill(0x61);
    const m = new MultiHasher();
    for (let i = 0; i < 1000; i++) m.update(a);
    expect(m.hex()).toEqual({
      md5: '7707d6ae4e027c70eea2a935c2296f21',
      sha1: '34aa973cd4c4daa4f61eeb2bdbad27316534016f',
      sha256: 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'
    });
    const data = source(37);
    const odd = new MultiHasher();
    for (let o = 0, step = 1; o < data.length; o += step, step = ((step * 3 + 1) % 211) + 1) odd.update(data.subarray(o, Math.min(data.length, o + step)));
    expect(odd.hex()).toEqual(hashesOf(data));
  });
});

describe('imageRange', () => {
  it('images a clean source and hashes it', async () => {
    const data = source(1000);
    const parts = [];
    const res = await imageRange({ readSectors: async (l, n) => data.slice(l * BS, (l + n) * BS), startLba: 0, sectors: 1000, write: async (d) => { parts.push(d); } });
    expect(same(concat(parts), data)).toBe(true);
    expect(res.hashes).toEqual(hashesOf(data));
    expect(res.badRanges).toEqual([]);
  });

  it('stops at the first read error by default', async () => {
    const data = source(1000);
    await expect(imageRange({ readSectors: flaky(data, (l) => l === 300), startLba: 0, sectors: 1000, write: async () => {} })).rejects.toThrow(/LBA 300/);
  });

  it('with continueOnError keeps full length, zero-fills the bad sectors and logs the range', async () => {
    const data = source(1000);
    const parts = [];
    const res = await imageRange({
      readSectors: flaky(data, (l) => l >= 300 && l < 304), startLba: 0, sectors: 1000, continueOnError: true, write: async (d) => { parts.push(d); }
    });
    const image = concat(parts);
    const expected = zeroed(data, [{ startLba: 300, sectors: 4 }]);
    expect(image.length).toBe(1000 * BS);
    expect(same(image, expected)).toBe(true);
    expect(res.badRanges).toHaveLength(1);
    expect(res.badRanges[0]).toMatchObject({ startLba: 300, sectors: 4, skipped: false });
    expect(res.badRanges[0].error).toMatch(/LBA 300/);
    expect(res.hashes).toEqual(hashesOf(expected));
    expect(res.badSectors).toBe(4);
  });

  it('retries a flaky sector (with the recover hook) before giving up on it', async () => {
    const data = source(300);
    let failures = 0; let recovered = 0;
    const readSectors = async (l, n) => {
      if (l <= 100 && l + n > 100 && failures < 2) { failures++; throw new Error('transient'); }
      return data.slice(l * BS, (l + n) * BS);
    };
    const res = await imageRange({ readSectors, startLba: 0, sectors: 300, continueOnError: true, retries: 2, recover: async () => { recovered++; }, write: async () => {} });
    expect(res.badRanges).toEqual([]);
    expect(res.hashes).toEqual(hashesOf(data));
    expect(recovered).toBeGreaterThan(0);
  });

  it('backs off over a large dead region: every bad sector is covered (failed or skipped), the rest is intact', async () => {
    const data = source(3000);
    const parts = [];
    const res = await imageRange({
      readSectors: flaky(data, (l) => l >= 500 && l < 1500), startLba: 0, sectors: 3000, continueOnError: true, write: async (d) => { parts.push(d); }
    });
    const image = concat(parts);
    expect(image.length).toBe(3000 * BS);
    expect(res.badRanges.some((r) => r.skipped)).toBe(true);
    expect(same(image, zeroed(data, res.badRanges))).toBe(true);
    const covered = new Set();
    res.badRanges.forEach((r) => { for (let l = r.startLba; l < r.startLba + r.sectors; l++) covered.add(l); });
    for (let l = 500; l < 1500; l++) expect(covered.has(l)).toBe(true);
    for (let l = 0; l < 500; l++) expect(covered.has(l)).toBe(false);
    expect(res.hashes).toEqual(hashesOf(image));
  });

  it('can hash without a writer, trim to byteLength, and be cancelled', async () => {
    const data = source(10);
    const res = await imageRange({ readSectors: async (l, n) => data.slice(l * BS, (l + n) * BS), startLba: 0, sectors: 10, byteLength: 10 * BS - 100 });
    expect(res.bytes).toBe(10 * BS - 100);
    expect(res.hashes).toEqual(hashesOf(data.subarray(0, 10 * BS - 100)));
    await expect(imageRange({ readSectors: async () => new Uint8Array(BS), startLba: 0, sectors: 5, chunkSectors: 1, shouldCancel: () => true })).rejects.toThrow(/cancelled/);
  });

  it('verify pass compares a re-read with the first hashes', async () => {
    const data = source(200);
    const opts = { readSectors: async (l, n) => data.slice(l * BS, (l + n) * BS), startLba: 0, sectors: 200 };
    const first = await imageRange(opts);
    expect((await verifyRange(opts, first.hashes.sha256)).ok).toBe(true);
    const changed = data.slice(); changed[5000] ^= 1;
    expect((await verifyRange({ ...opts, readSectors: async (l, n) => changed.slice(l * BS, (l + n) * BS) }, first.hashes.sha256)).ok).toBe(false);
  });
});

describe('bad sector reporting', () => {
  it('maps ranges onto a coverage strip and writes a log', () => {
    const ranges = [{ startLba: 0, sectors: 10, skipped: false, error: 'x' }, { startLba: 50, sectors: 10, skipped: true, error: 'y' }];
    const cells = badSectorMap(ranges, 0, 100, 10);
    expect(cells.map((c) => [c.bad, c.skipped])).toEqual([[10, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 10], [0, 0], [0, 0], [0, 0], [0, 0]]);
    const log = formatImageLog({ name: 'x.img', startLba: 0, sectors: 100, blockSize: 512, hashes: { md5: 'a', sha1: 'b', sha256: 'c' }, badRanges: ranges });
    expect(log).toMatch(/MD5:\s+a/);
    expect(log).toMatch(/LBA 0-9 \(10 sectors, byte offset 0\) read error: x/);
    expect(log).toMatch(/LBA 50-59 .*SKIPPED/);
  });
});
