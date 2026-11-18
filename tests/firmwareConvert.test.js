import { describe, it, expect } from 'vitest';
import {
  FirmwareError, crc32, sha256Hex, parseNumber, detectFormat, parseFirmware,
  parseIntelHex, writeIntelHex, parseSrec, writeSrec, parseUF2, writeUF2, parseElf,
  writeBinary, convertImage, verifyOutput, describeImage, flatten, gapsOf,
  relocateImage, splitImageAt, splitImageBySegment, mergeImages, buildSegments,
  UF2_MAGIC0, UF2_MAGIC1, UF2_MAGIC_END,
} from '../src/utils/firmwareConvert.js';
import { parseIntelHex as legacyParseIntelHex } from '../src/utils/firmwareParser.js';

const enc = (s) => new TextEncoder().encode(s);

// Deterministic PRNG so the round-trip data is reproducible.
function randomBytes(n, seed) {
  let s = seed >>> 0;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

const plain = (segments, startAddress = null, startKind = null) => ({
  segments, startAddress, startKind, meta: { format: 'test', familyIds: [], uf2Blocks: null, srecHeader: null, filename: '' }, warnings: [], overlapBytes: 0,
});

// Small image (no huge gap): safe for anything that flattens the whole span.
function smallImage() {
  return plain([
    { address: 0x0000fff0, data: randomBytes(64, 4) },
    { address: 0x00010100, data: randomBytes(100, 5) },
  ]);
}

// Three segments: a run crossing a 64 KiB boundary, a gap, and a segment at 0x08000000.
// Span is about 128 MB, so only verify-by-segments and digest-over-data paths apply to it.
function sampleImage() {
  return plain([
    { address: 0x0000fff0, data: randomBytes(64, 1) },
    { address: 0x00010100, data: randomBytes(100, 2) },
    { address: 0x08000000, data: randomBytes(32, 3) },
  ], 0x08000125, 'EIP');
}

function uf2Block({ target, payload, family = null, blockNo = 0, numBlocks = 1, flags = 0 }) {
  const b = new Uint8Array(512);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, UF2_MAGIC0, true);
  dv.setUint32(4, UF2_MAGIC1, true);
  dv.setUint32(8, flags | (family === null ? 0 : 0x2000), true);
  dv.setUint32(12, target, true);
  dv.setUint32(16, payload.length, true);
  dv.setUint32(20, blockNo, true);
  dv.setUint32(24, numBlocks, true);
  dv.setUint32(28, family ?? 0, true);
  b.set(payload, 32);
  dv.setUint32(508, UF2_MAGIC_END, true);
  return b;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('checksums', () => {
  it('CRC-32 check value for "123456789" is CBF43926', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
  it('SHA-256 known answers (empty, "abc", 56-byte two-block message)', () => {
    expect(sha256Hex(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
  it('SHA-256 of one million 0x61 bytes', () => {
    expect(sha256Hex(new Uint8Array(1000000).fill(0x61))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
});

describe('Intel HEX checksum vectors', () => {
  it('parses the classic 3-byte record ":0300300002337A1E"', () => {
    const img = parseFirmware(enc(':0300300002337A1E\n:00000001FF\n'), { format: 'hex' });
    expect(img.segments).toHaveLength(1);
    expect(img.segments[0].address).toBe(0x30);
    expect([...img.segments[0].data]).toEqual([0x02, 0x33, 0x7a]);
    expect(img.warnings).toEqual([]);
  });
  it('accepts the 16-byte record ":10010000...40"', () => {
    const img = parseIntelHex(':10010000214601360121470136007EFE09D2190140\n:00000001FF\n');
    expect(img.chunks[0].address).toBe(0x100);
    expect(img.chunks[0].data.length).toBe(16);
  });
  it('rejects a bad checksum and names the line', () => {
    expect(() => parseIntelHex(':0300300002337A1F\n:00000001FF\n')).toThrow(/Line 1: checksum mismatch/);
  });
  it('writes 0x30 data as ":0300300002337A1E" and the EOF record', () => {
    const img = plain([{ address: 0x30, data: new Uint8Array([2, 0x33, 0x7a]) }]);
    expect(writeIntelHex(img)).toBe(':0300300002337A1E\n:00000001FF\n');
  });
  it('writes the start-address record ":0400000508000125C9" for EIP 0x08000125', () => {
    const img = plain([{ address: 0, data: new Uint8Array([1]) }], 0x08000125, 'EIP');
    expect(writeIntelHex(img).trim().split('\n')).toContain(':0400000508000125C9');
  });
  it('emits type 04 for addresses above 64 KiB, starting at 0x08000000', () => {
    const lines = writeIntelHex(plain([{ address: 0x08000000, data: new Uint8Array([0xaa]) }])).trim().split('\n');
    expect(lines[0]).toBe(':020000040800F2');
    expect(lines[1]).toBe(':01000000AA55');
  });
  it('treats type 02 extended segment addresses as value * 16', () => {
    const img = parseIntelHex(':020000021000EC\n:0100000011EE\n:00000001FF\n');
    expect(img.chunks[0].address).toBe(0x10000);
  });
  it('reports data after EOF as a warning and ignores it', () => {
    const img = parseIntelHex(':00000001FF\n:0100000011EE\n');
    expect(img.chunks).toHaveLength(0);
    expect(img.warnings.join(' ')).toMatch(/after the end-of-file/);
  });
  it('agrees with the existing firmwareParser on the same bytes', () => {
    const data = Uint8Array.from({ length: 32 }, (_, i) => i);
    const src = writeIntelHex(plain([{ address: 0x08000000, data }]));
    const legacy = legacyParseIntelHex(src);
    const ours = flatten(parseFirmware(enc(src), { format: 'hex' }), 0xff);
    expect(legacy.startAddress).toBe(0x08000000);
    expect([...legacy.data]).toEqual([...ours]);
    expect([...ours]).toEqual([...data]);
  });
});

describe('Motorola S-record checksum vectors', () => {
  it('accepts the S9 termination record S9030000FC (start address 0)', () => {
    const img = parseFirmware(enc('S9030000FC\n'), { format: 'srec' });
    expect(img.segments).toHaveLength(0);
    expect(img.startAddress).toBe(0);
  });
  it('accepts the S5 count record S5030001FB', () => {
    expect(() => parseSrec('S5030001FB\nS9030000FC\n')).not.toThrow();
  });
  it('parses S10510000102E7 as bytes 01 02 at 0x1000', () => {
    const img = parseFirmware(enc('S10510000102E7\nS9031000EC\n'), { format: 'srec' });
    expect(img.segments[0].address).toBe(0x1000);
    expect([...img.segments[0].data]).toEqual([1, 2]);
    expect(img.startAddress).toBe(0x1000);
  });
  it('rejects a bad checksum', () => {
    expect(() => parseSrec('S10510000102E8\n')).toThrow(/Line 1: checksum mismatch/);
  });
  it('writes bytes 01 02 at 0x1000 with an S1 data record and an S9 entry record', () => {
    const img = plain([{ address: 0x1000, data: new Uint8Array([1, 2]) }], 0x1000, 'entry');
    expect(writeSrec(img)).toBe('S10510000102E7\nS9031000EC\n');
  });
  it('picks S2 and S3 records (and matching S8/S7 entry) for larger addresses', () => {
    // S2: count 05, addr 01 00 00, data 09, checksum ~(05+01+09) = F0
    const s2 = writeSrec(plain([{ address: 0x10000, data: new Uint8Array([9]) }]));
    expect(s2.startsWith('S20501000009F0')).toBe(true);
    // S3: count 06, addr 08 00 00 00, data 09, checksum ~(06+08+09) = E8
    const s3 = writeSrec(plain([{ address: 0x08000000, data: new Uint8Array([9]) }], 0x08000000, 'entry'));
    expect(s3.startsWith('S3060800000009E8')).toBe(true);
    expect(s3.trim().split('\n').pop().startsWith('S7')).toBe(true);
  });
});

describe('UF2 known header bytes', () => {
  it('writes magic, flags, address, size, block numbers, family and end magic at the spec offsets', () => {
    const img = plain([{ address: 0x10000000, data: new Uint8Array(256).fill(0xab) }]);
    img.meta.familyIds = [0xe48bff56];
    const out = writeUF2(img);
    expect(out.length).toBe(512);
    expect([...out.subarray(0, 8)]).toEqual([0x55, 0x46, 0x32, 0x0a, 0x57, 0x51, 0x5d, 0x9e]);
    expect([...out.subarray(8, 12)]).toEqual([0x00, 0x20, 0x00, 0x00]); // familyID present 0x2000
    expect([...out.subarray(12, 16)]).toEqual([0x00, 0x00, 0x00, 0x10]); // target 0x10000000
    expect([...out.subarray(16, 20)]).toEqual([0x00, 0x01, 0x00, 0x00]); // payload 256
    expect([...out.subarray(20, 24)]).toEqual([0, 0, 0, 0]); // blockNo
    expect([...out.subarray(24, 28)]).toEqual([1, 0, 0, 0]); // numBlocks
    expect([...out.subarray(28, 32)]).toEqual([0x56, 0xff, 0x8b, 0xe4]); // RP2040 0xe48bff56
    expect(out[32]).toBe(0xab);
    expect([...out.subarray(508, 512)]).toEqual([0x30, 0x6f, 0xb1, 0x0a]);
  });
  it('writes no family flag and a zero size word when there is no family', () => {
    const out = writeUF2(plain([{ address: 0, data: new Uint8Array(4) }]), { family: 'none' });
    expect([...out.subarray(8, 12)]).toEqual([0, 0, 0, 0]);
    expect([...out.subarray(28, 32)]).toEqual([0, 0, 0, 0]);
  });
  it('honours a family override and rejects a bad payload size', () => {
    const img = plain([{ address: 0, data: new Uint8Array(4) }]);
    img.meta.familyIds = [0xe48bff56];
    const out = writeUF2(img, { family: 0xada52840 });
    expect(parseUF2(out).familyIds).toEqual([0xada52840]);
    expect(() => writeUF2(img, { payloadSize: 255 })).toThrow(FirmwareError);
  });
  it('reads a hand-built block and reports its header fields', () => {
    const r = parseUF2(uf2Block({ target: 0x20000000, payload: new Uint8Array([1, 2, 3, 4]), family: 0x68ed2b88 }));
    expect(r.blocks[0]).toMatchObject({ targetAddress: 0x20000000, payloadSize: 4, familyId: 0x68ed2b88 });
    expect(r.familyIds).toEqual([0x68ed2b88]);
  });
  it('flags mixed families, misalignment, and bad magic', () => {
    const two = concat([
      uf2Block({ target: 0, payload: new Uint8Array(4), family: 0xe48bff56, blockNo: 0, numBlocks: 2 }),
      uf2Block({ target: 6, payload: new Uint8Array(4), family: 0xada52840, blockNo: 1, numBlocks: 2 }),
    ]);
    const r = parseUF2(two);
    expect(r.warnings.join(' ')).toMatch(/Mixed families/);
    expect(r.warnings.join(' ')).toMatch(/misaligned/);
    expect(() => parseUF2(new Uint8Array(512))).toThrow(/bad magic/);
    expect(() => parseUF2(new Uint8Array(100))).toThrow(/multiple of 512/);
  });
  it('round-trips a family and produces no warnings for aligned data', () => {
    const img = smallImage();
    img.meta.familyIds = [0xc47e5767];
    const back = parseUF2(writeUF2(img, { payloadSize: 256, family: 'auto' }));
    expect(back.familyIds).toEqual([0xc47e5767]);
    expect(back.warnings).toEqual([]);
  });
});

describe('round trip of every output format', () => {
  for (const fmt of ['hex', 'srec', 'uf2']) {
    it(`${fmt}: write then read gives back the same segments, base, and start address`, () => {
      const img = sampleImage();
      const out = convertImage(img, fmt, { recordSize: 16, payloadSize: 256 });
      const v = verifyOutput(img, fmt, out.bytes);
      expect(v.checks.data).toBe(true);
      expect(v.checks.base).toBe(true);
      if (fmt !== 'uf2') expect(v.checks.start).toBe(true);
      expect(v.ok).toBe(true);
    });
  }
  it('bin: write then read gives back the same bytes', () => {
    const img = smallImage();
    const out = convertImage(img, 'bin', { fill: 0xff });
    const v = verifyOutput(img, 'bin', out.bytes, { fill: 0xff });
    expect(v.checks.data).toBe(true);
    expect(v.ok).toBe(true);
  });
  it('bin with a non-0xFF fill reproduces the gaps and has the full span', () => {
    const img = smallImage();
    const out = convertImage(img, 'bin', { fill: 0x00 });
    expect(verifyOutput(img, 'bin', out.bytes, { fill: 0x00 }).checks.data).toBe(true);
    expect(out.bytes.length).toBe(0x10100 + 100 - 0xfff0);
    expect(out.bytes[64]).toBe(0x00); // first gap byte is 0x10030, i.e. offset 64 from 0xFFF0
  });
  it('hex and srec with fillGaps produce one contiguous record run', () => {
    const img = smallImage();
    const hex = convertImage(img, 'hex', { fillGaps: true, fill: 0x5a, recordSize: 32 });
    expect(parseFirmware(hex.bytes, { format: 'hex' }).segments).toHaveLength(1);
    const srec = convertImage(img, 'srec', { fillGaps: true, fill: 0x5a });
    expect(parseFirmware(srec.bytes, { format: 'srec' }).segments).toHaveLength(1);
    expect(verifyOutput(img, 'hex', hex.bytes, { fillGaps: true, fill: 0x5a }).checks.data).toBe(true);
  });
  it('detects UF2, HEX, S-record and ELF by content and falls back to bin', () => {
    expect(detectFormat(uf2Block({ target: 0, payload: new Uint8Array(4) }))).toBe('uf2');
    expect(detectFormat(enc(':00000001FF\n'))).toBe('hex');
    expect(detectFormat(enc('S9030000FC\n'))).toBe('srec');
    expect(detectFormat(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, ...new Uint8Array(60)]))).toBe('elf');
    expect(detectFormat(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe('bin');
  });
  it('ELF is rejected as an output format', () => {
    expect(() => convertImage(sampleImage(), 'elf')).toThrow(/input only/);
  });
});

describe('raw binary input', () => {
  it('honours the base address', () => {
    const img = parseFirmware(new Uint8Array([1, 2, 3, 4]), { format: 'bin', baseAddress: 0x10000000 });
    expect(img.segments[0].address).toBe(0x10000000);
    expect(img.startAddress).toBeNull();
  });
  it('writeBinary fills gaps with the fill byte and gapsOf reports the hole', () => {
    const img = plain([{ address: 0, data: new Uint8Array([1]) }, { address: 3, data: new Uint8Array([4]) }]);
    expect([...writeBinary(img, { fill: 0xaa })]).toEqual([1, 0xaa, 0xaa, 4]);
    expect(gapsOf(img)).toEqual([{ start: 1, end: 3, size: 2 }]);
  });
});

describe('overlaps and merging', () => {
  it('a duplicated HEX record with different bytes is reported and the last write wins', () => {
    const img = parseFirmware(enc(':0100000011EE\n:0100000022DD\n:00000001FF\n'), { format: 'hex' });
    expect([...img.segments[0].data]).toEqual([0x22]);
    expect(img.overlapBytes).toBe(1);
    expect(img.warnings.join(' ')).toMatch(/last write wins/);
  });
  it('buildSegments merges adjacent chunks into one segment', () => {
    const { segments, overlapBytes } = buildSegments([
      { address: 3, data: new Uint8Array([3, 4]) },
      { address: 0, data: new Uint8Array([1, 2]) },
      { address: 2, data: new Uint8Array([9]) },
    ]);
    expect(overlapBytes).toBe(0);
    expect(segments).toHaveLength(1);
    expect([...segments[0].data]).toEqual([1, 2, 9, 3, 4]);
  });
  it('merge keeps the later image on overlap and the first start address', () => {
    const a = parseFirmware(enc(':0100000011EE\n:00000001FF\n'), { format: 'hex' });
    const b = parseFirmware(enc(':010000009966\n:00000001FF\n'), { format: 'hex' });
    const m = mergeImages([a, b]);
    expect([...m.segments[0].data]).toEqual([0x99]);
    expect(m.startAddress).toBeNull();
  });
  it('merge warns about mixed UF2 families', () => {
    const a = parseFirmware(uf2Block({ target: 0, payload: new Uint8Array(4), family: 1 }), { format: 'uf2' });
    const b = parseFirmware(uf2Block({ target: 16, payload: new Uint8Array(4), family: 2 }), { format: 'uf2' });
    const m = mergeImages([a, b]);
    expect(m.meta.familyIds).toEqual([1, 2]);
    expect(m.warnings.join(' ')).toMatch(/mixed families/);
  });
});

describe('relocation and split', () => {
  it('relocates segments and the start address, and refuses to go below 0', () => {
    const img = sampleImage();
    const r = relocateImage(img, 0x100);
    expect(r.segments[0].address).toBe(0xfff0 + 0x100);
    expect(r.startAddress).toBe(0x08000125 + 0x100);
    expect(() => relocateImage(img, -0x1000000)).toThrow(FirmwareError);
  });
  it('splits at an address and keeps the start with the upper part', () => {
    const [low, high] = splitImageAt(sampleImage(), 0x08000000);
    expect(low.segments.map((s) => s.address)).toEqual([0xfff0, 0x10100]);
    expect(high.segments).toHaveLength(1);
    expect(high.segments[0].data.length).toBe(32);
    expect(high.startAddress).toBe(0x08000125);
    expect(low.startAddress).toBeNull();
  });
  it('splits a segment that straddles the cut', () => {
    const [low, high] = splitImageAt(sampleImage(), 0x10000);
    expect(low.segments[0].data.length).toBe(16);
    expect(high.segments[0].address).toBe(0x10000);
    // the straddling run keeps 0x10000..0x10030 (48 bytes); the 0x10100 segment stays separate
    expect(high.segments[0].data.length).toBe(48);
    expect(high.segments[1].address).toBe(0x10100);
  });
  it('splits one image per segment and keeps the start with its segment', () => {
    const img = sampleImage();
    img.startAddress = 0x08000004; // inside the third segment
    const parts = splitImageBySegment(img);
    expect(parts).toHaveLength(3);
    expect(parts[2].startAddress).toBe(0x08000004);
    expect(parts[0].startAddress).toBeNull();
  });
});

describe('ELF input', () => {
  // ELF32 little-endian: one PT_LOAD of 8 bytes at paddr 0x08000000, memsz 24 (16 bytes .bss).
  function elf32({ entry = 0x08000001 } = {}) {
    const phoff = 52;
    const dataOff = 52 + 32;
    const file = new Uint8Array(dataOff + 8);
    const dv = new DataView(file.buffer);
    file.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0]);
    dv.setUint16(16, 2, true); // ET_EXEC
    dv.setUint16(18, 40, true); // EM_ARM
    dv.setUint32(20, 1, true);
    dv.setUint32(24, entry, true);
    dv.setUint32(28, phoff, true);
    dv.setUint16(40, 52, true);
    dv.setUint16(42, 32, true);
    dv.setUint16(44, 1, true);
    dv.setUint32(phoff, 1, true); // PT_LOAD
    dv.setUint32(phoff + 4, dataOff, true);
    dv.setUint32(phoff + 8, 0x08000000, true);
    dv.setUint32(phoff + 12, 0x08000000, true);
    dv.setUint32(phoff + 16, 8, true);
    dv.setUint32(phoff + 20, 24, true);
    dv.setUint32(phoff + 24, 5, true);
    dv.setUint32(phoff + 28, 0x1000, true);
    file.set([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80], dataOff);
    return file;
  }
  it('reads the PT_LOAD into a memory image at p_paddr, with the entry point', () => {
    const img = parseFirmware(elf32(), { format: 'auto' });
    expect(img.meta.format).toBe('elf');
    expect(img.segments).toHaveLength(1);
    expect(img.segments[0].address).toBe(0x08000000);
    expect([...img.segments[0].data]).toEqual([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80]);
    expect(img.startAddress).toBe(0x08000001);
    expect(img.warnings.join(' ')).toMatch(/zero-fill/);
  });
  it('rejects a non-ELF file and a truncated program header table', () => {
    expect(() => parseElf(new Uint8Array(60))).toThrow(/Not an ELF/);
    expect(() => parseElf(elf32().subarray(0, 60))).toThrow(/truncated/);
  });
});

describe('inspector summary', () => {
  it('reports segments, gaps, and digests over the flattened image for a small image', () => {
    const img = smallImage();
    const d = describeImage(img);
    expect(d.segmentCount).toBe(2);
    expect(d.dataBytes).toBe(164);
    expect(d.gaps).toHaveLength(1);
    expect(d.gapBytes).toBe(0x10100 - (0xfff0 + 64));
    expect(d.digestBasis).toMatch(/flattened/);
    expect(d.crc32).toBe(crc32(flatten(img, 0xff)).toString(16).toUpperCase().padStart(8, '0'));
    expect(d.sha256).toHaveLength(64);
  });
  it('falls back to data-only digests when the span is too large to flatten', () => {
    const big = describeImage(sampleImage());
    expect(big.digestBasis).toMatch(/data bytes only/);
    expect(big.gaps).toHaveLength(2);
    expect(big.startAddress).toBe(0x08000125);
    expect(big.crc32).toMatch(/^[0-9A-F]{8}$/);
  });
  it('parseNumber accepts hex, decimal and a leading minus, and rejects junk', () => {
    expect(parseNumber('0x08000000')).toBe(0x08000000);
    expect(parseNumber('4096')).toBe(4096);
    expect(parseNumber('-0x10')).toBe(-16);
    expect(() => parseNumber('zz')).toThrow(FirmwareError);
  });
});

describe('crop, exclude, pad, checksum, srec_cat export', () => {
  const img = () => plain([
    { address: 0x1000, data: Uint8Array.from([1, 2, 3, 4]) },
    { address: 0x2000, data: Uint8Array.from([5, 6, 7, 8]) },
  ], 0x1000, 'entry');

  it('parses ranges (inclusive end and start+length)', async () => {
    const { parseRanges } = await import('../src/utils/firmwareConvert.js');
    expect(parseRanges('0x1000-0x1FFF, 0x3000+0x10')).toEqual([{ start: 0x1000, end: 0x2000 }, { start: 0x3000, end: 0x3010 }]);
    expect(() => parseRanges('')).toThrow(FirmwareError);
    expect(() => parseRanges('0x20-0x10')).toThrow(/reversed/);
    expect(() => parseRanges('nonsense')).toThrow(FirmwareError);
  });

  it('crops and excludes', async () => {
    const { cropImage, excludeImage } = await import('../src/utils/firmwareConvert.js');
    const c = cropImage(img(), [{ start: 0x1002, end: 0x2002 }]);
    expect(c.segments.map((s) => [s.address, [...s.data]])).toEqual([[0x1002, [3, 4]], [0x2000, [5, 6]]]);
    expect(c.startAddress).toBeNull();
    const e = excludeImage(img(), [{ start: 0x1001, end: 0x1003 }]);
    expect(e.segments.map((s) => [s.address, [...s.data]])).toEqual([[0x1000, [1]], [0x1003, [4]], [0x2000, [5, 6, 7, 8]]]);
    expect(e.startAddress).toBe(0x1000);
  });

  it('pads the end to an alignment', async () => {
    const { padImageToAlign } = await import('../src/utils/firmwareConvert.js');
    const p = padImageToAlign(img(), 0x100, 0xaa);
    const last = p.segments[1];
    expect(last.data.length).toBe(0x100);
    expect(last.data[4]).toBe(0xaa);
    expect(() => padImageToAlign(img(), 0)).toThrow(FirmwareError);
  });

  it('inserts a CRC-32 at the end, little-endian', async () => {
    const { insertChecksum } = await import('../src/utils/firmwareConvert.js');
    const base = plain([{ address: 0x100, data: enc('123456789') }]);
    const r = insertChecksum(base, {});
    expect(r.value).toBe(0xcbf43926);
    expect(r.address).toBe(0x109);
    expect([...r.image.segments[0].data.slice(9)]).toEqual([0x26, 0x39, 0xf4, 0xcb]);
    const big = insertChecksum(base, { endian: 'big' });
    expect([...big.image.segments[0].data.slice(9)]).toEqual([0xcb, 0xf4, 0x39, 0x26]);
  });

  it('negated byte sum makes the total zero and rejects a slot below the image', async () => {
    const { insertChecksum } = await import('../src/utils/firmwareConvert.js');
    const base = plain([{ address: 0, data: Uint8Array.from([1, 2, 3]) }]);
    const r = insertChecksum(base, { algo: 'sum32' });
    expect(r.value).toBe((0x100000000 - 6) >>> 0);
    expect(() => insertChecksum(plain([{ address: 0x10, data: Uint8Array.from([1]) }]), { address: 0 })).toThrow(FirmwareError);
  });

  it('builds an srec_cat command and flags unsupported formats', async () => {
    const { srecCatCommand } = await import('../src/utils/firmwareConvert.js');
    const r = srecCatCommand({ inputs: [{ name: 'fw.hex', format: 'hex' }], crop: [{ start: 0x1000, end: 0x2000 }], format: 'srec', recordSize: 32, outName: 'fw' });
    expect(r.command).toBe('srec_cat fw.hex -intel -crop 0x00001000 0x00002000 -output-block-size=32 -o fw.srec');
    expect(r.ok).toBe(true);
    const u = srecCatCommand({ inputs: [{ name: 'fw.uf2', format: 'uf2' }], format: 'uf2' });
    expect(u.ok).toBe(false);
    expect(u.notes.length).toBe(2);
  });
});
