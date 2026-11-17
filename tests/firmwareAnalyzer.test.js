import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import {
  scanSignatures, shannonEntropy, entropyProfile, highEntropyRegions, entropySummary,
  extractStrings, hexRows, carveRangeForHit, carveBytes, decompressStream,
  buildReport, reportToMarkdown, classifyEntropy, autoBlockSize
} from '../src/utils/firmwareAnalyzer.js';

// ---- fixture builders (CRC and gzip come from node:zlib, independent of the module) ----

const ascii = (s) => Array.from(s, (c) => c.charCodeAt(0));

function put(buf, off, bytes) {
  buf.set(bytes, off);
  return buf;
}

function uimage(data, name) {
  const hdr = new Uint8Array(64);
  const dv = new DataView(hdr.buffer);
  dv.setUint32(0, 0x27051956, false);
  dv.setUint32(8, 1700000000, false);
  dv.setUint32(12, data.length, false);
  dv.setUint32(16, 0x80008000, false);
  dv.setUint32(20, 0x80008000, false);
  dv.setUint32(24, zlib.crc32(data), false);
  hdr[28] = 5; // Linux
  hdr[29] = 2; // ARM
  hdr[30] = 2; // kernel
  hdr[31] = 0; // no compression
  hdr.set(ascii(name).slice(0, 32), 32);
  dv.setUint32(4, zlib.crc32(hdr), false); // header CRC with the field zero
  return Uint8Array.from([...hdr, ...data]);
}

function ustar(name, content) {
  const hdr = new Uint8Array(512);
  hdr.set(ascii(name), 0);
  hdr.set(ascii('0000644\0'), 100);
  hdr.set(ascii('0000000\0'), 108);
  hdr.set(ascii('0000000\0'), 116);
  hdr.set(ascii(content.length.toString(8).padStart(11, '0') + '\0'), 124);
  hdr.set(ascii('00000000000\0'), 136);
  hdr[156] = 0x30;
  hdr.set(ascii('ustar\0'), 257);
  hdr.set(ascii('00'), 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : hdr[i];
  hdr.set(ascii(sum.toString(8).padStart(6, '0') + '\0 '), 148);
  const body = new Uint8Array(512);
  body.set(content);
  return Uint8Array.from([...hdr, ...body]);
}

function hexRecord(count, addr, type, data = []) {
  const bytes = [count, (addr >> 8) & 0xff, addr & 0xff, type, ...data];
  const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0);
  const cks = (0x100 - sum) & 0xff;
  return ':' + [...bytes, cks].map((v) => v.toString(16).toUpperCase().padStart(2, '0')).join('');
}

function cpioNewc(name, data) {
  const hex8 = (v) => v.toString(16).padStart(8, '0');
  const nameBytes = ascii(name + '\0');
  const header = '070701' + hex8(1) + hex8(0o100644) + hex8(0) + hex8(0) + hex8(1) +
    hex8(0) + hex8(data.length) + hex8(0) + hex8(0) + hex8(0) + hex8(0) + hex8(nameBytes.length) + hex8(0);
  const out = [...ascii(header), ...nameBytes];
  while (out.length % 4) out.push(0);
  out.push(...data);
  while (out.length % 4) out.push(0);
  return Uint8Array.from(out);
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}

describe('firmware signature scan: mixed image', () => {
  it('finds each signature at its exact offset and parses its fields', async () => {
    const payload = ascii('abcdefghijklmnop');
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from('hello world')));
    const tar = ustar('a.txt', ascii('hello'));
    const pem = ascii('-----BEGIN CERTIFICATE-----\nMIIBAAAA\n-----END CERTIFICATE-----\n');
    const image = new Uint8Array(4096);
    put(image, 0, uimage(Uint8Array.from(payload), 'test'));
    put(image, 128, gz);
    put(image, 512, tar);
    put(image, 1024, Uint8Array.from(pem));

    const { hits, truncated } = await scanSignatures(image);
    expect(truncated).toEqual([]);
    const summary = hits.map((h) => [h.offset, h.id]);
    expect(summary).toEqual([[0, 'uimage'], [128, 'gzip'], [512, 'tar'], [1024, 'pem']]);

    const ui = hits[0];
    expect(ui.size).toBe(64 + 16);
    expect(Object.fromEntries(ui.fields).Name).toBe('test');
    expect(Object.fromEntries(ui.fields)['Data CRC']).toBe('valid');
    expect(Object.fromEntries(ui.fields)['Load address']).toBe('0x80008000');

    const tr = hits[2];
    expect(tr.size).toBe(1024);
    expect(Object.fromEntries(tr.fields).Path).toBe('a.txt');
    expect(Object.fromEntries(tr.fields).Size).toBe(5);

    expect(hits[3].name).toBe('PEM certificate');
    expect(hits[3].size).toBe(pem.length);
  });

  it('rejects a uImage whose header CRC is wrong', async () => {
    const img = uimage(Uint8Array.from(ascii('0123')), 'x');
    img[10] ^= 0xff; // corrupt the stored header CRC area
    const { hits } = await scanSignatures(img);
    expect(hits.find((h) => h.id === 'uimage')).toBeUndefined();
  });

  it('rejects a tar header whose checksum is wrong', async () => {
    const t = ustar('b.txt', ascii('xyz'));
    t[0] = 0x63; // change the name after the checksum was written
    const { hits } = await scanSignatures(t);
    expect(hits.find((h) => h.id === 'tar')).toBeUndefined();
  });

  it('reports zero hits for an all-zero image', async () => {
    const { hits } = await scanSignatures(new Uint8Array(65536));
    expect(hits).toEqual([]);
  });
});

describe('header parsers', () => {
  it('reads an ext superblock whose magic sits 1080 bytes into the filesystem', async () => {
    const img = new Uint8Array(8192);
    const sb = 4096 + 1024;
    const dv = new DataView(img.buffer);
    dv.setUint32(sb + 0, 128, true); // inodes
    dv.setUint32(sb + 4, 1000, true); // blocks
    dv.setUint32(sb + 24, 0, true); // log block size -> 1024
    dv.setUint32(sb + 32, 8192, true); // blocks per group
    dv.setUint32(sb + 40, 128, true); // inodes per group
    dv.setUint32(sb + 76, 1, true); // rev 1
    img[sb + 56] = 0x53;
    img[sb + 57] = 0xef;
    const { hits } = await scanSignatures(img);
    const ext = hits.find((h) => h.id === 'ext');
    expect(ext.offset).toBe(4096);
    expect(ext.name).toBe('ext2 filesystem');
    expect(ext.size).toBe(1000 * 1024);
  });

  it('parses a SquashFS 4.0 superblock (little endian)', async () => {
    const img = new Uint8Array(256);
    img.set(ascii('hsqs'), 0);
    const dv = new DataView(img.buffer);
    dv.setUint32(4, 10, true);
    dv.setUint32(12, 131072, true);
    dv.setUint16(20, 1, true); // gzip
    dv.setUint16(22, 17, true);
    dv.setUint16(28, 4, true);
    dv.setUint16(30, 0, true);
    dv.setBigUint64(40, 4000n, true);
    const { hits } = await scanSignatures(img);
    const sq = hits.find((h) => h.id === 'squashfs-le');
    expect(sq.size).toBe(4000);
    expect(Object.fromEntries(sq.fields).Compression).toBe('gzip');
    expect(Object.fromEntries(sq.fields)['Block size']).toBe(131072);
  });

  it('validates a 7z start header with its CRC and reads the next-header offset', async () => {
    const img = new Uint8Array(32 + 16);
    img.set([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4], 0);
    const dv = new DataView(img.buffer);
    dv.setUint32(12, 0, true); // next header offset lo
    dv.setUint32(20, 16, true); // next header size lo
    const crc = zlib.crc32(img.subarray(12, 32));
    dv.setUint32(8, crc, true);
    const { hits } = await scanSignatures(img);
    const z = hits.find((h) => h.id === '7z');
    expect(z.offset).toBe(0);
    expect(z.size).toBe(48);
  });

  it('parses an xz stream header (CRC64 check) with a valid header CRC', async () => {
    const img = new Uint8Array(32);
    img.set([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00, 0x04], 0);
    new DataView(img.buffer).setUint32(8, zlib.crc32(Uint8Array.from([0x00, 0x04])), true);
    const { hits } = await scanSignatures(img);
    const x = hits.find((h) => h.id === 'xz');
    expect(x).toBeDefined();
    expect(Object.fromEntries(x.fields)['Integrity check']).toBe('CRC64');
  });

  it('parses an ELF64 header and sizes it from the section table', async () => {
    const img = new Uint8Array(256);
    img.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
    const dv = new DataView(img.buffer);
    dv.setUint16(16, 2, true); // executable
    dv.setUint16(18, 62, true); // x86-64
    dv.setBigUint64(40, 64n, true); // section header offset
    dv.setUint16(58, 64, true); // entry size
    dv.setUint16(60, 2, true); // count
    const { hits } = await scanSignatures(img);
    const e = hits.find((h) => h.id === 'elf');
    expect(e.size).toBe(64 + 2 * 64);
    expect(Object.fromEntries(e.fields).Machine).toBe('x86-64');
    expect(Object.fromEntries(e.fields).Class).toBe('ELF64');
  });

  it('parses a ZIP local file header name and sizes the entry', async () => {
    const name = ascii('a.txt');
    const img = new Uint8Array(30 + name.length + 3);
    img.set([0x50, 0x4b, 0x03, 0x04], 0);
    const dv = new DataView(img.buffer);
    dv.setUint16(8, 0, true); // stored
    dv.setUint32(18, 3, true);
    dv.setUint32(22, 3, true);
    dv.setUint16(26, name.length, true);
    img.set(name, 30);
    const { hits } = await scanSignatures(img);
    const z = hits.find((h) => h.id === 'zip');
    expect(Object.fromEntries(z.fields)['File name']).toBe('a.txt');
    expect(z.size).toBe(30 + 5 + 3);
  });

  it('parses an Android boot image and estimates its size from the v0 layout', async () => {
    const img = new Uint8Array(4096 * 4);
    img.set(ascii('ANDROID!'), 0);
    const dv = new DataView(img.buffer);
    dv.setUint32(8, 4096, true); // kernel size
    dv.setUint32(36, 2048, true); // page size
    const { hits } = await scanSignatures(img);
    const a = hits.find((h) => h.id === 'android');
    expect(a.size).toBe(2048 * (1 + 2));
    expect(Object.fromEntries(a.fields)['Page size']).toBe(2048);
  });

  it('parses an ESP32 app image: segment walk and app description', async () => {
    const img = new Uint8Array(256);
    img[0] = 0xe9;
    img[1] = 1; // one segment
    const dv = new DataView(img.buffer);
    dv.setUint32(4, 0x40080000, true); // entry
    dv.setUint16(12, 0, true); // ESP32
    dv.setUint32(24 + 4, 0x20, true); // first segment length 32
    img.set([0x32, 0x54, 0xcd, 0xab], 0x20); // app desc magic 0xABCD5432
    img.set(ascii('1.2.3'), 0x30);
    img.set(ascii('proj'), 0x50);
    const { hits } = await scanSignatures(img);
    const e = hits.find((h) => h.id === 'esp32-app');
    expect(e.offset).toBe(0);
    expect(e.size).toBe(80); // roundup(24 + 8 + 32 + 1, 16)
    expect(Object.fromEntries(e.fields)['App version']).toBe('1.2.3');
    expect(Object.fromEntries(e.fields).Project).toBe('proj');
    expect(Object.fromEntries(e.fields).Chip).toBe('ESP32');
  });

  it('finds a CPIO newc entry and reads its name and size', async () => {
    const img = cpioNewc('hello.txt', ascii('hi there'));
    const { hits } = await scanSignatures(img);
    const c = hits.find((h) => h.id === 'cpio');
    expect(c.offset).toBe(0);
    expect(Object.fromEntries(c.fields).Path).toBe('hello.txt');
    expect(Object.fromEntries(c.fields)['File size']).toBe(8);
  });

  it('finds an Intel HEX block by checksum-valid records and suppresses repeats inside it', async () => {
    const text = [
      hexRecord(2, 0x0100, 0, [0x12, 0x34]),
      hexRecord(1, 0x0200, 0, [0xab]),
      hexRecord(0, 0, 1)
    ].join('\r\n') + '\r\n';
    const junk = ascii('junk:\n');
    const base = junk.length;
    const all = new Uint8Array(base + text.length);
    all.set(junk, 0);
    all.set(ascii(text), base);
    const { hits } = await scanSignatures(all);
    const ih = hits.filter((h) => h.id === 'intel-hex');
    expect(ih.length).toBe(1);
    expect(ih[0].offset).toBe(base);
    expect(Object.fromEntries(ih[0].fields).Records).toBe(3);
    expect(Object.fromEntries(ih[0].fields)['Data bytes']).toBe(3);
  });

  it('rejects an Intel HEX line with a bad checksum', async () => {
    const good = hexRecord(1, 0, 0, [0x41]);
    const bad = good.slice(0, -2) + '00';
    const { hits } = await scanSignatures(ascii(bad + '\n' + good + '\n'));
    expect(hits.filter((h) => h.id === 'intel-hex')).toHaveLength(0);
  });

  it('reads a PEM private key and flags it as sensitive', async () => {
    const pem = ascii('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk=\n-----END OPENSSH PRIVATE KEY-----\n');
    const { hits } = await scanSignatures(Uint8Array.from(pem));
    expect(hits[0].name).toBe('PEM private key (sensitive)');
    expect(hits[0].notes.join(' ')).toMatch(/sensitive/);
  });

  it('reads an SSH public key line with its comment', async () => {
    const line = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl user@host\n';
    const { hits } = await scanSignatures(Uint8Array.from(ascii(line)));
    const k = hits.find((h) => h.id === 'ssh-ed25519');
    expect(k).toBeDefined();
    expect(Object.fromEntries(k.fields).Comment).toBe('user@host');
  });
});

describe('scanner behaviour', () => {
  it('reports progress per chunk and yields between chunks', async () => {
    const img = new Uint8Array(3 * 1024 * 1024);
    const progress = [];
    await scanSignatures(img, { chunkSize: 1024 * 1024, onProgress: (f) => progress.push(f) });
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });

  it('stops when the signal is aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(scanSignatures(new Uint8Array(2 * 1024 * 1024), { signal: ac.signal })).rejects.toThrow();
  });

  it('caps a signature at its hit limit and says so', async () => {
    const sigs = [{ id: 'x', name: 'x', category: 'text', patterns: [[0x41]], at: 0, heuristic: false, maxHits: 2, parse: () => ({ fields: [] }) }];
    const { hits, truncated } = await scanSignatures(Uint8Array.from([0x41, 0x41, 0x41, 0x41]), { signatures: sigs });
    expect(hits).toHaveLength(2);
    expect(truncated).toEqual([{ id: 'x', name: 'x', limit: 2 }]);
  });
});

describe('entropy', () => {
  it('is zero for an all-zero block and about 8 for a block with every byte value', () => {
    expect(shannonEntropy(new Uint8Array(4096))).toBe(0);
    const cycle = new Uint8Array(256);
    for (let i = 0; i < 256; i++) cycle[i] = i;
    expect(shannonEntropy(cycle)).toBeCloseTo(8, 10);
  });

  it('is high for pseudo-random data and low for zeros in the block profile', async () => {
    const r = rng(12345);
    const data = new Uint8Array(16384);
    for (let i = 0; i < data.length; i++) data[i] = r();
    const profile = await entropyProfile(data, { blockSize: 4096 });
    expect(profile.values.length).toBe(4);
    for (const v of profile.values) expect(v).toBeGreaterThan(7.8);
    expect(classifyEntropy(profile.values[0])).toBe('high');
    const zeros = await entropyProfile(new Uint8Array(8192), { blockSize: 4096 });
    expect(Array.from(zeros.values)).toEqual([0, 0]);
    expect(classifyEntropy(0)).toBe('low');
  });

  it('merges consecutive high-entropy blocks into one region', async () => {
    const r = rng(7);
    const data = new Uint8Array(4096 * 4);
    for (let i = 4096; i < 4096 * 3; i++) data[i] = r();
    const profile = await entropyProfile(data, { blockSize: 4096 });
    const regions = highEntropyRegions(profile);
    expect(regions).toHaveLength(1);
    expect(regions[0].start).toBe(4096);
    expect(regions[0].end).toBe(4096 * 3);
    expect(entropySummary(profile).highBlocks).toBe(2);
  });

  it('auto block size keeps the block count near 2048', () => {
    expect(autoBlockSize(16 * 1024 * 1024)).toBe(8192);
    expect(autoBlockSize(1000)).toBe(256);
  });
});

describe('strings', () => {
  it('extracts ASCII and UTF-16LE runs with their offsets', async () => {
    const buf = new Uint8Array(64);
    buf.set(ascii('hello world'), 0);
    buf[11] = 0;
    const wide = [];
    for (const c of 'WIDE!') wide.push(c.charCodeAt(0), 0);
    buf.set(wide, 20);
    const { strings, truncated } = await extractStrings(buf, { minLen: 4 });
    expect(truncated).toBe(false);
    const got = strings.map((s) => [s.offset, s.encoding, s.text]);
    expect(got).toContainEqual([0, 'ascii', 'hello world']);
    expect(got).toContainEqual([20, 'utf16le', 'WIDE!']);
  });

  it('honours the minimum length and the result cap', async () => {
    const buf = Uint8Array.from(ascii('ab\0cdef\0ghijkl\0'));
    const { strings } = await extractStrings(buf, { minLen: 6, utf16: false });
    expect(strings.map((s) => s.text)).toEqual(['ghijkl']);
    const capped = await extractStrings(Uint8Array.from(ascii('aaaaaa\0bbbbbb\0cccccc')), { minLen: 6, utf16: false, maxResults: 2 });
    expect(capped.strings).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });
});

describe('hex view and carving', () => {
  it('formats a hex dump with offsets and printable ASCII', () => {
    const buf = Uint8Array.from([0x48, 0x69, 0x00, 0x7f]);
    const rows = hexRows(buf, 0, 4);
    expect(rows).toEqual([{ offset: 0, hex: '48 69 00 7f', ascii: 'Hi..' }]);
  });

  it('carves to the parsed size, then to the next hit, then to end of file', () => {
    const fileSize = 100;
    const a = { offset: 10, size: 20 };
    const b = { offset: 40, size: null };
    const c = { offset: 60, size: null };
    expect(carveRangeForHit(a, [a, b, c], fileSize)).toEqual({ start: 10, end: 30, basis: 'parsed size' });
    expect(carveRangeForHit(b, [a, b, c], fileSize)).toEqual({ start: 40, end: 60, basis: 'next hit' });
    expect(carveRangeForHit(c, [a, b, c], fileSize)).toEqual({ start: 60, end: 100, basis: 'end of file' });
    const buf = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(Array.from(carveBytes(buf, 1, 4))).toEqual([2, 3, 4]);
  });
});

describe('decompression', () => {
  it('decompresses a gzip stream made by zlib', async () => {
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from('hello firmware')));
    const out = await decompressStream(gz, 'gzip');
    expect(out.complete).toBe(true);
    expect(Buffer.from(out.data).toString('utf8')).toBe('hello firmware');
  });

  it('decompresses a zlib (deflate) stream', async () => {
    const z = new Uint8Array(zlib.deflateSync(Buffer.from('zlib body')));
    const out = await decompressStream(z, 'deflate');
    expect(Buffer.from(out.data).toString('utf8')).toBe('zlib body');
  });

  it('reports an incomplete stream instead of throwing', async () => {
    const gz = new Uint8Array(zlib.gzipSync(Buffer.from('truncate me please')));
    const out = await decompressStream(gz.subarray(0, gz.length - 6), 'gzip');
    expect(out.complete).toBe(false);
    expect(out.error).toBeTruthy();
  });
});

describe('report', () => {
  it('builds JSON and Markdown reports with offsets and parsed fields', async () => {
    const img = ustar('r.txt', ascii('data'));
    const { hits } = await scanSignatures(img);
    const report = buildReport({ fileName: 'test.bin', size: img.length, hits });
    expect(report.signatures[0].offsetHex).toBe('0x00000000');
    expect(report.signatures[0].fields.Path).toBe('r.txt');
    const md = reportToMarkdown(report);
    expect(md).toContain('# Firmware analysis: test.bin');
    expect(md).toContain('tar entry (ustar)');
    expect(md).toContain('0x00000000');
  });
});
