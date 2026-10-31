import { describe, it, expect } from 'vitest';
import {
  DiskReader, memoryReader, readPartitionTable, detectFilesystem, FatVolume, ExFatVolume, openVolume, Sha256,
  buildFatVolume, buildMbrDisk, guidToString
} from '../src/utils/diskImage';
import { MassStorageDevice, createSimulatedMassStorage, parseSense, buildDemoDisk } from '../src/utils/massStorageDriver';

const text = (b) => new TextDecoder().decode(b);
const enc = (s) => new TextEncoder().encode(s);

describe('SHA-256', () => {
  it('matches the FIPS 180 test vectors, streamed in odd chunks', () => {
    expect(new Sha256().hex()).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(new Sha256().update(enc('abc')).hex()).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(new Sha256().update(enc('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).hex())
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    const h = new Sha256();
    const a = new Uint8Array(1000).fill(0x61);
    for (let i = 0; i < 1000; i++) h.update(a.subarray(0, i % 7 === 0 ? 1000 : 1000)); // 1,000,000 x 'a'
    expect(h.hex()).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
    const odd = new Sha256();
    const msg = enc('The quick brown fox jumps over the lazy dog');
    for (let i = 0; i < msg.length; i += 5) odd.update(msg.subarray(i, i + 5));
    expect(odd.hex()).toBe('d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592');
  });
});

describe('FAT', () => {
  const files = [
    { path: 'README.TXT', data: 'hello\r\n' },
    { path: 'Long file name.txt', data: 'long names work' },
    { path: 'DCIM/100DEMO/IMG_0001.JPG', data: new Uint8Array(1500).map((_, i) => i & 0xff) },
    { path: 'gone.txt', data: 'deleted data', deleted: true }
  ];

  it('finds the MBR partition and reads FAT16 files, folders and long names', async () => {
    const disk = buildMbrDisk(buildFatVolume({ sectors: 8192, fatBits: 16, label: 'TESTVOL', files }));
    const read = memoryReader(disk);
    const pt = await readPartitionTable(read);
    expect(pt.scheme).toBe('mbr');
    expect(pt.partitions).toEqual([expect.objectContaining({ index: 1, type: 0x06, startLba: 2048, sectors: 8192, typeName: 'FAT16', bootable: true })]);
    const partRead = (o, n) => read(2048 * 512 + o, n);
    expect(await detectFilesystem(partRead)).toMatchObject({ type: 'FAT16', label: 'TESTVOL', serial: '1234ABCD' });
    const vol = await openVolume(partRead);
    const root = await vol.list();
    expect(root.map((e) => e.name)).toEqual(['README.TXT', 'Long file name.txt', 'DCIM', 'gone.txt']);
    expect(text(await vol.readFile(root[1]))).toBe('long names work');
    const dcim = await vol.list(root[2].cluster);
    const sub = await vol.list(dcim[0].cluster);
    expect(sub[0]).toMatchObject({ name: 'IMG_0001.JPG', size: 1500 });
    expect(Array.from((await vol.readFile(sub[0])).subarray(0, 4))).toEqual([0, 1, 2, 3]);
    expect(root[3]).toMatchObject({ deleted: true, size: 12 });
    expect(text(await vol.readFile(root[3]))).toBe('deleted data');
    expect(root[0].modified.getUTCFullYear()).toBe(2024);
  });

  it('reads FAT12 and FAT32 volumes', async () => {
    const f12 = buildFatVolume({ sectors: 2880, fatBits: 12, files: [{ path: 'A.TXT', data: 'x'.repeat(2000) }, { path: 'B.TXT', data: 'b' }] });
    const v12 = await FatVolume.open(memoryReader(f12));
    expect(v12.type).toBe('FAT12');
    const l12 = await v12.list();
    expect(text(await v12.readFile(l12[0]))).toBe('x'.repeat(2000));
    expect(text(await v12.readFile(l12[1]))).toBe('b');

    const f32 = buildFatVolume({ sectors: 70000, fatBits: 32, label: 'BIG', files: [{ path: 'docs/manual.txt', data: 'fat32 ok' }] });
    expect(await detectFilesystem(memoryReader(f32))).toMatchObject({ type: 'FAT32', label: 'BIG' });
    const v32 = await FatVolume.open(memoryReader(f32));
    const docs = (await v32.list())[0];
    expect(docs).toMatchObject({ name: 'docs', isDir: true });
    const [manual] = await v32.list(docs.cluster);
    expect(text(await v32.readFile(manual))).toBe('fat32 ok');
  });

  it('treats an unpartitioned FAT stick as one volume', async () => {
    const vol = buildFatVolume({ sectors: 4096, files: [] });
    const pt = await readPartitionTable(memoryReader(vol));
    expect(pt.partitions).toEqual([expect.objectContaining({ startLba: 0, typeName: 'Unpartitioned' })]);
  });
});

describe('partition tables', () => {
  it('reads GPT entries with names and type GUIDs', async () => {
    const disk = new Uint8Array(64 * 512);
    disk[446 + 4] = 0xee; new DataView(disk.buffer).setUint32(446 + 8, 1, true); new DataView(disk.buffer).setUint32(446 + 12, 63, true);
    disk[510] = 0x55; disk[511] = 0xaa;
    const h = 512;
    disk.set(enc('EFI PART'), h);
    const dv = new DataView(disk.buffer);
    dv.setUint32(h + 72, 2, true); dv.setUint32(h + 80, 4, true); dv.setUint32(h + 84, 128, true);
    const guid = (s) => {
      const x = s.replace(/-/g, '').match(/../g).map((p) => parseInt(p, 16));
      return [x[3], x[2], x[1], x[0], x[5], x[4], x[7], x[6], ...x.slice(8)];
    };
    const entry = (i, type, first, last, name) => {
      const o = 1024 + i * 128;
      disk.set(guid(type), o);
      disk.set(guid('11111111-2222-3333-4444-555555555555'), o + 16);
      dv.setUint32(o + 32, first, true); dv.setUint32(o + 40, last, true);
      [...name].forEach((c, k) => dv.setUint16(o + 56 + k * 2, c.charCodeAt(0), true));
    };
    entry(0, 'C12A7328-F81F-11D2-BA4B-00A0C93EC93B', 34, 40, 'EFI');
    entry(1, '0FC63DAF-8483-4772-8E79-3D69D8477DE4', 41, 63, 'rootfs');
    const pt = await readPartitionTable(memoryReader(disk));
    expect(pt.scheme).toBe('gpt');
    expect(pt.partitions.map((p) => [p.typeName, p.name, p.startLba, p.sectors])).toEqual([['EFI System', 'EFI', 34, 7], ['Linux filesystem', 'rootfs', 41, 23]]);
    expect(guidToString(Uint8Array.from(guid('C12A7328-F81F-11D2-BA4B-00A0C93EC93B')))).toBe('C12A7328-F81F-11D2-BA4B-00A0C93EC93B');
  });

  it('follows the extended partition chain', async () => {
    const disk = new Uint8Array(400 * 512);
    const dv = new DataView(disk.buffer);
    const put = (sector, idx, type, start, count) => {
      const o = sector * 512 + 446 + idx * 16;
      disk[o + 4] = type; dv.setUint32(o + 8, start, true); dv.setUint32(o + 12, count, true);
      disk[sector * 512 + 510] = 0x55; disk[sector * 512 + 511] = 0xaa;
    };
    put(0, 0, 0x83, 10, 50);
    put(0, 1, 0x0f, 100, 300);
    put(100, 0, 0x0b, 10, 40); // logical 5 at 110
    put(100, 1, 0x05, 60, 100); // next EBR at 160
    put(160, 0, 0x82, 10, 50); // logical 6 at 170
    const pt = await readPartitionTable(memoryReader(disk));
    expect(pt.partitions.map((p) => [p.index, p.typeName, p.startLba])).toEqual([[1, 'Linux', 10], [5, 'FAT32 (CHS)', 110], [6, 'Linux swap', 170]]);
  });
});

describe('other filesystems', () => {
  it('recognises ext4 with label and UUID', async () => {
    const b = new Uint8Array(8192);
    const dv = new DataView(b.buffer);
    dv.setUint16(1024 + 56, 0xef53, true);
    dv.setUint32(1024 + 96, 0x40, true);
    b.set([0xde, 0xad, 0xbe, 0xef, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 1024 + 104);
    b.set(enc('rootfs'), 1024 + 120);
    expect(await detectFilesystem(memoryReader(b))).toEqual({ type: 'ext4', label: 'rootfs', uuid: 'deadbeef-0102-0304-0506-0708090a0b0c' });
  });

  it('browses exFAT, including contiguous files and deleted entries', async () => {
    const sector = 512;
    const img = new Uint8Array(64 * sector);
    const dv = new DataView(img.buffer);
    img.set(enc('EXFAT   '), 3);
    dv.setUint32(80, 8, true);    // FAT at sector 8
    dv.setUint32(84, 1, true);
    dv.setUint32(88, 16, true);   // cluster heap at sector 16
    dv.setUint32(92, 40, true);
    dv.setUint32(96, 2, true);    // root dir cluster 2
    dv.setUint32(100, 0xcafef00d, true);
    img[108] = 9; img[109] = 0;   // 512-byte sectors, 1 sector per cluster
    const fat = 8 * sector;
    dv.setUint32(fat + 2 * 4, 0xffffffff, true); // root: one cluster
    dv.setUint32(fat + 3 * 4, 5, true);          // fragmented file: 3 -> 5
    dv.setUint32(fat + 5 * 4, 0xffffffff, true);
    const cl = (c) => 16 * sector + (c - 2) * sector;
    const entrySet = (o, name, { first, size, contiguous, deleted }) => {
      img[o] = deleted ? 0x05 : 0x85; img[o + 1] = 1 + Math.ceil(name.length / 15); dv.setUint16(o + 4, 0x20, true);
      img[o + 32] = deleted ? 0x40 : 0xc0; img[o + 33] = 1 | (contiguous ? 2 : 0); img[o + 35] = name.length;
      dv.setUint32(o + 32 + 8, size, true); dv.setUint32(o + 32 + 20, first, true); dv.setUint32(o + 32 + 24, size, true);
      for (let k = 0; k * 15 < name.length; k++) {
        const e = o + 64 + k * 32;
        img[e] = deleted ? 0x41 : 0xc1;
        [...name.slice(k * 15, k * 15 + 15)].forEach((ch, i) => dv.setUint16(e + 2 + i * 2, ch.charCodeAt(0), true));
      }
      return o + 32 * (2 + Math.ceil(name.length / 15));
    };
    let o = cl(2);
    o = entrySet(o, 'fragmented-file-name.bin', { first: 3, size: 700 });
    o = entrySet(o, 'photo.jpg', { first: 6, size: 600, contiguous: true });
    entrySet(o, 'removed.txt', { first: 9, size: 5, contiguous: true, deleted: true });
    img.fill(0x41, cl(3), cl(3) + 512); img.fill(0x42, cl(5), cl(5) + 512);
    img.fill(0x43, cl(6), cl(6) + 1024);
    img.set(enc('hello'), cl(9));

    expect(await detectFilesystem(memoryReader(img))).toMatchObject({ type: 'exFAT', serial: 'CAFEF00D' });
    const vol = await ExFatVolume.open(memoryReader(img));
    const list = await vol.list();
    expect(list.map((e) => [e.name, e.size, e.deleted])).toEqual([['fragmented-file-name.bin', 700, false], ['photo.jpg', 600, false], ['removed.txt', 5, true]]);
    const frag = await vol.readFile(list[0]);
    expect([frag[0], frag[511], frag[512], frag[699]]).toEqual([0x41, 0x41, 0x42, 0x42]);
    expect((await vol.readFile(list[1])).every((x) => x === 0x43)).toBe(true);
    expect(text(await vol.readFile(list[2]))).toBe('hello');
  });
});

describe('drive access', () => {
  it('caches chunks and reads across chunk boundaries', async () => {
    const disk = Uint8Array.from({ length: 512 * 300 }, (_, i) => (i * 7) & 0xff);
    let reads = 0;
    const r = new DiskReader(async (lba, count) => { reads++; return disk.slice(lba * 512, (lba + count) * 512); }, { chunkSectors: 16 });
    const got = await r.read(512 * 15 + 100, 1000);
    expect(Array.from(got)).toEqual(Array.from(disk.subarray(512 * 15 + 100, 512 * 15 + 1100)));
    await r.read(512 * 15, 10);
    expect(reads).toBe(2);
  });

  it('explains failed commands with REQUEST SENSE', () => {
    const s = new Uint8Array(18);
    s[2] = 0x02; s[12] = 0x3a;
    expect(parseSense(s).text).toBe('not ready: medium not present');
  });

  it('serves a browsable FAT16 disk in demo mode', async () => {
    const dev = new MassStorageDevice(createSimulatedMassStorage());
    await dev.open();
    const cap = await dev.readCapacity();
    const reader = new DiskReader((lba, n) => dev.read(lba, n), { blockSize: cap.blockSize });
    const pt = await readPartitionTable((o, n) => reader.read(o, n));
    const vol = await openVolume(reader.at(pt.partitions[0].startLba * 512));
    const names = (await vol.list()).map((e) => e.name);
    expect(names).toEqual(['README.TXT', 'Meeting notes 2024.txt', 'DCIM', 'secret-plans.txt']);
    expect(buildDemoDisk().length).toBe(cap.totalBytes);
  });
});
