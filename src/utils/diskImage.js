/**
 * diskImage.js — making sense of raw disk sectors: MBR/GPT partition tables,
 * filesystem detection, read-only FAT12/16/32 and exFAT browsing (including
 * deleted entries), a streaming SHA-256 for disk images, and a FAT image
 * builder used by the demo drive and the tests.
 *
 * Readers take an async `read(byteOffset, length) -> Uint8Array` function, so
 * they work on a live drive (through DiskReader) or on an image in memory.
 */

const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const le64 = (b, o) => le32(b, o) + le32(b, o + 4) * 2 ** 32;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n)).replace(/\0+$/, '');
const utf16 = (b, o, n) => { let s = ''; for (let i = 0; i < n; i++) { const c = le16(b, o + i * 2); if (!c) break; s += String.fromCharCode(c); } return s; };

// ---------------------------------------------------------------------------
// Block access with a small cache
// ---------------------------------------------------------------------------

export class DiskReader {
  /** readSectors(lba, count) -> Uint8Array of count * blockSize bytes. */
  constructor(readSectors, { blockSize = 512, chunkSectors = 64, cacheChunks = 64 } = {}) {
    this.readSectors = readSectors;
    this.blockSize = blockSize;
    this.chunk = chunkSectors;
    this.cacheChunks = cacheChunks;
    this.cache = new Map();
  }

  async _chunk(n) {
    if (this.cache.has(n)) {
      const v = this.cache.get(n);
      this.cache.delete(n);
      this.cache.set(n, v);
      return v;
    }
    const data = await this.readSectors(n * this.chunk, this.chunk);
    this.cache.set(n, data);
    if (this.cache.size > this.cacheChunks) this.cache.delete(this.cache.keys().next().value);
    return data;
  }

  async read(offset, length) {
    const out = new Uint8Array(length);
    const chunkBytes = this.chunk * this.blockSize;
    let done = 0;
    while (done < length) {
      const pos = offset + done;
      const n = Math.floor(pos / chunkBytes);
      const data = await this._chunk(n);
      const start = pos - n * chunkBytes;
      const take = Math.min(length - done, chunkBytes - start, Math.max(0, data.length - start));
      if (take <= 0) break; // past the end of the drive
      out.set(data.subarray(start, start + take), done);
      done += take;
    }
    return out;
  }

  /** A read function for a byte range starting at `base` (a partition). */
  at(base) { return (offset, length) => this.read(base + offset, length); }
}

export const memoryReader = (bytes) => async (offset, length) => {
  const out = new Uint8Array(length);
  out.set(bytes.subarray(offset, Math.min(bytes.length, offset + length)));
  return out;
};

/**
 * A `read(offset, length)` over a File / Blob (an opened disk image). Only the
 * requested range is sliced and read, so a multi-GB image is never loaded whole.
 * Like memoryReader, bytes past the end of the file read as zeros.
 */
export const fileReader = (file) => async (offset, length) => {
  const out = new Uint8Array(length);
  const end = Math.min(file.size, offset + length);
  if (offset < 0 || offset >= end) return out;
  out.set(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
  return out;
};

/** `readSectors(lba, count)` over a File, for DiskReader (adds chunk caching) or imaging. */
export const fileSectorReader = (file, blockSize = 512) => {
  const read = fileReader(file);
  return (lba, count) => read(lba * blockSize, count * blockSize);
};

// ---------------------------------------------------------------------------
// Partition tables
// ---------------------------------------------------------------------------

export const MBR_TYPES = {
  0x01: 'FAT12', 0x04: 'FAT16 (<32M)', 0x05: 'Extended', 0x06: 'FAT16', 0x07: 'NTFS / exFAT / HPFS',
  0x0b: 'FAT32 (CHS)', 0x0c: 'FAT32 (LBA)', 0x0e: 'FAT16 (LBA)', 0x0f: 'Extended (LBA)', 0x11: 'Hidden FAT12',
  0x17: 'Hidden NTFS', 0x1b: 'Hidden FAT32', 0x1c: 'Hidden FAT32 (LBA)', 0x27: 'Windows recovery', 0x82: 'Linux swap',
  0x83: 'Linux', 0x85: 'Linux extended', 0x8e: 'Linux LVM', 0xa5: 'FreeBSD', 0xa8: 'Apple UFS', 0xaf: 'Apple HFS+',
  0xda: 'Non-FS data', 0xee: 'GPT protective', 0xef: 'EFI System', 0xfd: 'Linux RAID'
};

export const GPT_TYPES = {
  'C12A7328-F81F-11D2-BA4B-00A0C93EC93B': 'EFI System',
  'EBD0A0A2-B9E5-4433-87C0-68B6B72699C7': 'Microsoft basic data',
  'E3C9E316-0B5C-4DB8-817D-F92DF00215AE': 'Microsoft reserved',
  'DE94BBA4-06D1-4D40-A16A-BFD50179D6AC': 'Windows recovery',
  '0FC63DAF-8483-4772-8E79-3D69D8477DE4': 'Linux filesystem',
  '0657FD6D-A4AB-43C4-84E5-0933C84B4F4F': 'Linux swap',
  'E6D6D379-F507-44C2-A23C-238F2A3DF928': 'Linux LVM',
  'A19D880F-05FC-4D3B-A006-743F0F84911E': 'Linux RAID',
  '4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709': 'Linux root (x86-64)',
  'B921B045-1DF0-41C3-AF44-4C6F280D3FAE': 'Linux root (ARM64)',
  'BC13C2FF-59E6-4262-A352-B275FD6F7172': 'Linux /boot (XBOOTLDR)',
  '48465300-0000-11AA-AA11-00306543ECAC': 'Apple HFS+',
  '7C3457EF-0000-11AA-AA11-00306543ECAC': 'Apple APFS',
  '21686148-6449-6E6F-744E-656564454649': 'BIOS boot',
  'CA7D7CCB-63ED-4C53-861C-1742536059CC': 'LUKS'
};

/** A GPT GUID from its mixed-endian on-disk form. */
export function guidToString(b, o = 0) {
  const h = (i) => b[o + i].toString(16).padStart(2, '0');
  const r = (...idx) => idx.map(h).join('');
  return `${r(3, 2, 1, 0)}-${r(5, 4)}-${r(7, 6)}-${r(8, 9)}-${r(10, 11, 12, 13, 14, 15)}`.toUpperCase();
}

/**
 * Read the partition table. Returns { scheme: 'gpt' | 'mbr' | 'none', partitions: [...] }
 * with startLba / sectors per partition (sectors are `blockSize` bytes).
 */
export async function readPartitionTable(read, { blockSize = 512 } = {}) {
  const mbr = await read(0, 512);
  const hasSig = mbr[510] === 0x55 && mbr[511] === 0xaa;
  if (!hasSig) return { scheme: 'none', partitions: [] };
  const entries = [];
  let validStatus = true;
  for (let i = 0; i < 4; i++) {
    const o = 446 + i * 16;
    if (mbr[o] !== 0x00 && mbr[o] !== 0x80) validStatus = false;
    const type = mbr[o + 4];
    const startLba = le32(mbr, o + 8);
    const sectors = le32(mbr, o + 12);
    if (type && sectors) entries.push({ index: i + 1, type, startLba, sectors, bootable: mbr[o] === 0x80 });
  }
  // A FAT/NTFS boot sector at LBA 0 (a "superfloppy" without partitions) also ends in 55AA.
  const looksLikeVbr = (mbr[0] === 0xeb || mbr[0] === 0xe9) && /FAT|NTFS|EXFAT|MSDOS|MSWIN|mkfs/.test(ascii(mbr, 3, 8) + ascii(mbr, 54, 8) + ascii(mbr, 82, 8));
  if (looksLikeVbr && (!entries.length || !validStatus)) {
    return { scheme: 'none', partitions: [{ index: 0, name: 'Whole disk (no partition table)', typeName: 'Unpartitioned', startLba: 0, sectors: null }] };
  }
  if (entries.some((e) => e.type === 0xee)) {
    const gpt = await readGpt(read, blockSize);
    if (gpt) return gpt;
  }
  const partitions = [];
  for (const e of entries) {
    if (e.type === 0x05 || e.type === 0x0f || e.type === 0x85) {
      partitions.push(...await readEbrChain(read, e.startLba, blockSize));
    } else {
      partitions.push({ ...e, typeName: MBR_TYPES[e.type] || `type 0x${e.type.toString(16)}` });
    }
  }
  return { scheme: 'mbr', diskId: le32(mbr, 440).toString(16).toUpperCase().padStart(8, '0'), partitions };
}

async function readEbrChain(read, extStart, blockSize) {
  const out = [];
  let ebr = extStart;
  for (let n = 5; n < 64; n++) {
    const b = await read(ebr * blockSize, 512);
    if (b[510] !== 0x55 || b[511] !== 0xaa) break;
    const type = b[446 + 4];
    if (type) out.push({ index: n, type, startLba: ebr + le32(b, 446 + 8), sectors: le32(b, 446 + 12), logical: true, typeName: MBR_TYPES[type] || `type 0x${type.toString(16)}` });
    const next = le32(b, 462 + 8);
    if (!b[462 + 4] || !next) break;
    ebr = extStart + next;
  }
  return out;
}

async function readGpt(read, blockSize) {
  const h = await read(blockSize, 92);
  if (ascii(h, 0, 8) !== 'EFI PART') return null;
  const entriesLba = le64(h, 72);
  const count = Math.min(le32(h, 80), 256);
  const size = le32(h, 84);
  const table = await read(entriesLba * blockSize, count * size);
  const partitions = [];
  for (let i = 0; i < count; i++) {
    const o = i * size;
    const typeGuid = guidToString(table, o);
    if (typeGuid === '00000000-0000-0000-0000-000000000000') continue;
    const first = le64(table, o + 32);
    const last = le64(table, o + 40);
    partitions.push({
      index: i + 1,
      typeGuid,
      typeName: GPT_TYPES[typeGuid] || typeGuid,
      uniqueGuid: guidToString(table, o + 16),
      name: utf16(table, o + 56, 36),
      startLba: first,
      sectors: last - first + 1,
      attributes: le64(table, o + 48)
    });
  }
  return { scheme: 'gpt', diskGuid: guidToString(h, 56), partitions };
}

// ---------------------------------------------------------------------------
// Filesystem detection
// ---------------------------------------------------------------------------

/** Identify the filesystem at the start of `read`. Returns { type, label?, uuid?, ... } or { type: 'unknown' }. */
export async function detectFilesystem(read) {
  const b = await read(0, 4096);
  const oem = ascii(b, 3, 8);
  if (oem === 'EXFAT   ') {
    return { type: 'exFAT', serial: le32(b, 100).toString(16).toUpperCase().padStart(8, '0'), clusterSize: 2 ** (b[108] + b[109]) };
  }
  if (oem === 'NTFS    ') {
    return { type: 'NTFS', serial: le64(b, 72).toString(16).toUpperCase(), clusterSize: le16(b, 11) * b[13] };
  }
  if (b[510] === 0x55 && b[511] === 0xaa && le16(b, 11) >= 512 && b[13] && (le16(b, 11) & (le16(b, 11) - 1)) === 0) {
    try {
      const fat = parseFatBoot(b);
      return { type: `FAT${fat.fatBits}`, label: fat.label, serial: fat.serial, clusterSize: fat.clusterSize };
    } catch (e) { /* not FAT after all */ }
  }
  if (ascii(b, 0, 6) === 'LUKS\xba\xbe') return { type: 'LUKS (encrypted)', uuid: ascii(b, 168, 40) };
  if (ascii(b, 32, 4) === 'NXSB') return { type: 'APFS container' };
  if (b[1024] === 0x48 && (b[1025] === 0x2b || b[1025] === 0x58)) return { type: b[1025] === 0x2b ? 'HFS+' : 'HFSX' };
  if (le16(b, 1024 + 56) === 0xef53) {
    const compat = le32(b, 1024 + 92);
    const incompat = le32(b, 1024 + 96);
    const type = incompat & 0x40 ? 'ext4' : compat & 0x4 ? 'ext3' : 'ext2';
    const u = b.subarray(1024 + 104, 1024 + 120);
    const hx = Array.from(u, (x) => x.toString(16).padStart(2, '0')).join('');
    return { type, label: ascii(b, 1024 + 120, 16), uuid: `${hx.slice(0, 8)}-${hx.slice(8, 12)}-${hx.slice(12, 16)}-${hx.slice(16, 20)}-${hx.slice(20)}` };
  }
  if (ascii(b, 4086, 10) === 'SWAPSPACE2') return { type: 'Linux swap' };
  if (ascii(b, 0, 4) === 'hsqs') return { type: 'squashfs' };
  const iso = await read(32768, 8);
  if (ascii(iso, 1, 5) === 'CD001') {
    const pvd = await read(32768, 2048);
    return { type: 'ISO 9660', label: ascii(pvd, 40, 32).trim() };
  }
  return { type: 'unknown' };
}

// ---------------------------------------------------------------------------
// FAT12 / FAT16 / FAT32
// ---------------------------------------------------------------------------

export function parseFatBoot(b) {
  const bytesPerSector = le16(b, 11);
  const sectorsPerCluster = b[13];
  const reserved = le16(b, 14);
  const fats = b[16];
  const rootEntries = le16(b, 17);
  const total = le16(b, 19) || le32(b, 32);
  const fatSize = le16(b, 22) || le32(b, 36);
  if (!bytesPerSector || !sectorsPerCluster || !fats || !fatSize || !total) throw new Error('Not a FAT boot sector.');
  const rootDirSectors = Math.ceil((rootEntries * 32) / bytesPerSector);
  const firstData = reserved + fats * fatSize + rootDirSectors;
  const clusters = Math.floor((total - firstData) / sectorsPerCluster);
  const fatBits = clusters < 4085 ? 12 : clusters < 65525 ? 16 : 32;
  const ext = fatBits === 32 ? 64 : 36; // extended BPB offset
  return {
    fatBits, bytesPerSector, sectorsPerCluster, reserved, fats, rootEntries, total, fatSize, clusters,
    clusterSize: bytesPerSector * sectorsPerCluster,
    fatOffset: reserved * bytesPerSector,
    rootOffset: (reserved + fats * fatSize) * bytesPerSector,
    dataOffset: firstData * bytesPerSector,
    rootCluster: fatBits === 32 ? le32(b, 44) : 0,
    serial: le32(b, ext + 3).toString(16).toUpperCase().padStart(8, '0'),
    label: b[ext + 2] === 0x29 ? ascii(b, ext + 7, 11).trim() : ''
  };
}

const lfnChars = (e) => {
  const idx = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
  let s = '';
  for (const i of idx) {
    const c = le16(e, i);
    if (c === 0 || c === 0xffff) break;
    s += String.fromCharCode(c);
  }
  return s;
};

const fatDate = (d, t) => {
  if (!d) return null;
  return new Date(Date.UTC(1980 + (d >> 9), ((d >> 5) & 0x0f) - 1, d & 0x1f, t >> 11, (t >> 5) & 0x3f, (t & 0x1f) * 2));
};

export class FatVolume {
  constructor(read, boot) {
    this.read = read;
    this.boot = boot;
    this.fatCache = null;
    this.type = `FAT${boot.fatBits}`;
  }

  static async open(read) {
    return new FatVolume(read, parseFatBoot(await read(0, 512)));
  }

  async _fat() {
    if (!this.fatCache) {
      const bytes = Math.min(this.boot.fatSize * this.boot.bytesPerSector, Math.ceil(((this.boot.clusters + 2) * this.boot.fatBits) / 8) + 4);
      this.fatCache = await this.read(this.boot.fatOffset, bytes);
    }
    return this.fatCache;
  }

  async nextCluster(c) {
    const f = await this._fat();
    if (this.boot.fatBits === 12) {
      const o = Math.floor(c * 1.5);
      const v = le16(f, o);
      return c & 1 ? v >> 4 : v & 0xfff;
    }
    if (this.boot.fatBits === 16) return le16(f, c * 2);
    return le32(f, c * 4) & 0x0fffffff;
  }

  isEnd(c) {
    return c < 2 || c >= (this.boot.fatBits === 12 ? 0xff8 : this.boot.fatBits === 16 ? 0xfff8 : 0x0ffffff8);
  }

  async chain(start, limit = 1 << 20) {
    const out = [];
    for (let c = start; !this.isEnd(c) && out.length < limit; c = await this.nextCluster(c)) {
      if (out.length && out.includes(c)) break; // loop in a damaged FAT
      out.push(c);
    }
    return out;
  }

  clusterOffset(c) { return this.boot.dataOffset + (c - 2) * this.boot.clusterSize; }

  /**
   * Unallocated data space as merged byte ranges [{ start, length }] relative to
   * the volume start (clusters the FAT marks free). Deleted files live here, so
   * this is where carving is most productive.
   */
  async freeRanges() {
    const out = [];
    let runStart = -1;
    const last = this.boot.clusters + 1;
    const flush = (end) => {
      if (runStart < 0) return;
      out.push({ start: this.clusterOffset(runStart), length: (end - runStart) * this.boot.clusterSize });
      runStart = -1;
    };
    for (let c = 2; c <= last; c++) {
      const free = (await this.nextCluster(c)) === 0;
      if (free && runStart < 0) runStart = c;
      else if (!free) flush(c);
    }
    flush(last + 1);
    return out;
  }

  async _readClusters(clusters, length) {
    const cs = this.boot.clusterSize;
    const out = new Uint8Array(length ?? clusters.length * cs);
    let pos = 0;
    // Merge runs of consecutive clusters into single reads.
    for (let i = 0; i < clusters.length && pos < out.length; ) {
      let j = i;
      while (j + 1 < clusters.length && clusters[j + 1] === clusters[j] + 1) j++;
      const n = Math.min((j - i + 1) * cs, out.length - pos);
      out.set(await this.read(this.clusterOffset(clusters[i]), n), pos);
      pos += n;
      i = j + 1;
    }
    return out;
  }

  /** List a directory (cluster 0 = root). Entries include deleted ones, flagged. */
  async list(cluster = 0) {
    let raw;
    if (cluster === 0 && this.boot.fatBits !== 32) raw = await this.read(this.boot.rootOffset, this.boot.rootEntries * 32);
    else raw = await this._readClusters(await this.chain(cluster || this.boot.rootCluster));
    const out = [];
    let lfn = [];
    for (let o = 0; o + 32 <= raw.length; o += 32) {
      const e = raw.subarray(o, o + 32);
      if (e[0] === 0x00) break;
      const attr = e[11];
      if (attr === 0x0f) { lfn.unshift(lfnChars(e)); continue; }
      const deleted = e[0] === 0xe5;
      if (attr & 0x08) { lfn = []; continue; } // volume label
      const base = (deleted ? '?' : '') + ascii(e, deleted ? 1 : 0, deleted ? 7 : 8).trimEnd();
      const extn = ascii(e, 8, 3).trimEnd();
      const shortName = extn ? `${base}.${extn}` : base;
      const name = lfn.length ? lfn.join('') : shortName;
      lfn = [];
      if (shortName === '.' || shortName === '..') continue;
      const firstCluster = (this.boot.fatBits === 32 ? le16(e, 20) << 16 : 0) | le16(e, 26);
      out.push({
        name, shortName, deleted,
        isDir: !!(attr & 0x10),
        hidden: !!(attr & 0x02), system: !!(attr & 0x04), readOnly: !!(attr & 0x01),
        size: le32(e, 28),
        cluster: firstCluster,
        modified: fatDate(le16(e, 24), le16(e, 22))
      });
    }
    return out;
  }

  /**
   * Read a file's contents. Deleted files have no FAT chain left, so they are
   * read as contiguous clusters from the first one, which is often (not always) right.
   */
  async readFile(entry) {
    if (!entry.size) return new Uint8Array(0);
    const n = Math.ceil(entry.size / this.boot.clusterSize);
    const clusters = entry.deleted
      ? Array.from({ length: n }, (_, i) => entry.cluster + i)
      : await this.chain(entry.cluster, n);
    if (!entry.deleted && clusters.length < n) throw new Error(`The FAT chain of ${entry.name} is shorter than its size.`);
    return this._readClusters(clusters, entry.size);
  }
}

// ---------------------------------------------------------------------------
// exFAT
// ---------------------------------------------------------------------------

export class ExFatVolume {
  constructor(read, b) {
    this.read = read;
    this.type = 'exFAT';
    this.sectorSize = 2 ** b[108];
    this.clusterSize = this.sectorSize * 2 ** b[109];
    this.fatOffset = le32(b, 80) * this.sectorSize;
    this.heapOffset = le32(b, 88) * this.sectorSize;
    this.clusterCount = le32(b, 92);
    this.rootCluster = le32(b, 96);
    this.serial = le32(b, 100).toString(16).toUpperCase().padStart(8, '0');
  }

  static async open(read) {
    const b = await read(0, 512);
    if (ascii(b, 3, 8) !== 'EXFAT   ') throw new Error('Not an exFAT volume.');
    return new ExFatVolume(read, b);
  }

  async nextCluster(c) { return le32(await this.read(this.fatOffset + c * 4, 4), 0); }

  async chain(start, limit = 1 << 20) {
    const out = [];
    for (let c = start; c >= 2 && c < 0xfffffff7 && out.length < limit; c = await this.nextCluster(c)) out.push(c);
    return out;
  }

  clusterOffset(c) { return this.heapOffset + (c - 2) * this.clusterSize; }

  async _readRun(first, length, contiguous) {
    const n = Math.ceil(length / this.clusterSize);
    const clusters = contiguous ? Array.from({ length: n }, (_, i) => first + i) : await this.chain(first, n);
    const out = new Uint8Array(length);
    let pos = 0;
    for (let i = 0; i < clusters.length && pos < length; ) {
      let j = i;
      while (j + 1 < clusters.length && clusters[j + 1] === clusters[j] + 1) j++;
      const take = Math.min((j - i + 1) * this.clusterSize, length - pos);
      out.set(await this.read(this.clusterOffset(clusters[i]), take), pos);
      pos += take;
      i = j + 1;
    }
    return out;
  }

  async list(dir = null) {
    const raw = dir
      ? await this._readRun(dir.cluster, Math.max(dir.size, this.clusterSize), dir.contiguous)
      : await this._readRun(this.rootCluster, (await this.chain(this.rootCluster)).length * this.clusterSize, false);
    const out = [];
    for (let o = 0; o + 32 <= raw.length; o += 32) {
      const type = raw[o];
      if (type === 0x00) break;
      if ((type & 0x7f) !== 0x05) continue; // file directory entry (0x85, or 0x05 when deleted)
      const deleted = !(type & 0x80);
      const secondary = raw[o + 1];
      const attr = le16(raw, o + 4);
      const stream = raw.subarray(o + 32, o + 64);
      if ((stream[0] & 0x7f) !== 0x40) continue;
      const nameLen = stream[3];
      let name = '';
      for (let k = 2; k <= secondary && name.length < nameLen; k++) {
        const ne = raw.subarray(o + k * 32, o + k * 32 + 32);
        if ((ne[0] & 0x7f) !== 0x41) break;
        name += utf16(ne, 2, 15);
      }
      const ts = le32(raw, o + 12);
      out.push({
        name: name.slice(0, nameLen),
        deleted,
        isDir: !!(attr & 0x10),
        hidden: !!(attr & 0x02),
        system: !!(attr & 0x04),
        readOnly: !!(attr & 0x01),
        size: le64(stream, 24),
        validSize: le64(stream, 8),
        cluster: le32(stream, 20),
        contiguous: !!(stream[1] & 0x02),
        modified: ts ? new Date(Date.UTC(1980 + (ts >>> 25), ((ts >>> 21) & 0x0f) - 1, (ts >>> 16) & 0x1f, (ts >>> 11) & 0x1f, (ts >>> 5) & 0x3f, (ts & 0x1f) * 2)) : null
      });
      o += secondary * 32;
    }
    return out;
  }

  async readFile(entry) {
    if (!entry.size) return new Uint8Array(0);
    return this._readRun(entry.cluster, entry.validSize ?? entry.size, entry.contiguous || entry.deleted);
  }
}

/** Open a browsable volume, or null for filesystems that can't be browsed. */
export async function openVolume(read) {
  const fs = await detectFilesystem(read);
  if (fs.type === 'exFAT') return ExFatVolume.open(read);
  if (/^FAT/.test(fs.type)) return FatVolume.open(read);
  return null;
}

// ---------------------------------------------------------------------------
// Streaming SHA-256 (WebCrypto can't hash incrementally)
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.buf = new Uint8Array(64);
    this.bufLen = 0;
    this.total = 0;
    this.w = new Uint32Array(64);
  }

  _block(b, o) {
    const w = this.w;
    for (let i = 0; i < 16; i++) w[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const c = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((c >>> 17) | (c << 15)) ^ ((c >>> 19) | (c << 13)) ^ (c >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    const H0 = this.h; let a = H0[0], bb = H0[1], c = H0[2], d = H0[3], e = H0[4], f = H0[5], g = H0[6], h = H0[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    const H = this.h;
    H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }

  update(data) {
    let i = 0;
    this.total += data.length;
    if (this.bufLen) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      i = take;
      if (this.bufLen < 64) return this;
      this._block(this.buf, 0);
      this.bufLen = 0;
    }
    for (; i + 64 <= data.length; i += 64) this._block(data, i);
    this.buf.set(data.subarray(i), 0);
    this.bufLen = data.length - i;
    return this;
  }

  hex() {
    const bits = this.total * 8;
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8);
    pad[0] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, Math.floor(bits / 2 ** 32));
    dv.setUint32(pad.length - 4, bits >>> 0);
    const total = this.total;
    this.update(pad);
    this.total = total;
    return Array.from(this.h, (x) => x.toString(16).padStart(8, '0')).join('');
  }
}

// ---------------------------------------------------------------------------
// FAT image builder (demo drive and tests)
// ---------------------------------------------------------------------------

/**
 * Build a FAT12/16/32 volume. files: [{ path: 'DIR/Name.txt', data, deleted? }]
 * Long names get LFN entries. Returns a Uint8Array of `sectors` * 512 bytes.
 */
export function buildFatVolume({ sectors, fatBits = 16, label = 'DEMO', files = [], sectorsPerCluster = 1 }) {
  const bps = 512;
  const img = new Uint8Array(sectors * bps);
  const reserved = fatBits === 32 ? 32 : 1;
  const rootEntries = fatBits === 32 ? 0 : 512;
  const rootSectors = (rootEntries * 32) / bps;
  const clustersGuess = Math.floor(sectors / sectorsPerCluster);
  const fatSize = Math.ceil(((clustersGuess + 2) * fatBits) / 8 / bps);
  const dataStart = reserved + 2 * fatSize + rootSectors;
  const clusterSize = bps * sectorsPerCluster;
  const b = img;
  b.set([0xeb, 0x3c, 0x90]);
  b.set(new TextEncoder().encode('MSWIN4.1'), 3);
  b[11] = 0; b[12] = 2; b[13] = sectorsPerCluster;
  b[14] = reserved & 0xff; b[15] = reserved >> 8; b[16] = 2;
  b[17] = rootEntries & 0xff; b[18] = rootEntries >> 8;
  if (sectors < 65536 && fatBits !== 32) { b[19] = sectors & 0xff; b[20] = sectors >> 8; } else new DataView(b.buffer).setUint32(32, sectors, true);
  b[21] = 0xf8;
  const dv = new DataView(b.buffer);
  if (fatBits !== 32) dv.setUint16(22, fatSize, true);
  else { dv.setUint32(36, fatSize, true); dv.setUint32(44, 2, true); dv.setUint16(48, 1, true); }
  const ext = fatBits === 32 ? 64 : 36;
  b[ext + 2] = 0x29;
  dv.setUint32(ext + 3, 0x1234abcd, true);
  b.set(new TextEncoder().encode(label.padEnd(11).slice(0, 11)), ext + 7);
  b.set(new TextEncoder().encode(`FAT${fatBits}`.padEnd(8)), ext + 18);
  b[510] = 0x55; b[511] = 0xaa;

  let nextFree = 2;
  const setFat = (c, v) => {
    for (const base of [reserved * bps, (reserved + fatSize) * bps]) {
      if (fatBits === 12) {
        const o = base + Math.floor(c * 1.5);
        const cur = b[o] | (b[o + 1] << 8);
        const nv = c & 1 ? (cur & 0x000f) | (v << 4) : (cur & 0xf000) | (v & 0xfff);
        b[o] = nv & 0xff; b[o + 1] = (nv >> 8) & 0xff;
      } else if (fatBits === 16) dv.setUint16(base + c * 2, v, true);
      else dv.setUint32(base + c * 4, v, true);
    }
  };
  const EOC = fatBits === 12 ? 0xfff : fatBits === 16 ? 0xffff : 0x0fffffff;
  setFat(0, fatBits === 12 ? 0xff8 : fatBits === 16 ? 0xfff8 : 0x0ffffff8);
  setFat(1, EOC);
  const coff = (c) => (dataStart + (c - 2) * sectorsPerCluster) * bps;
  const alloc = (bytes, { mark = true } = {}) => {
    const n = Math.max(1, Math.ceil(bytes / clusterSize));
    const first = nextFree;
    for (let i = 0; i < n; i++) if (mark) setFat(first + i, i === n - 1 ? EOC : first + i + 1);
    nextFree += n;
    return first;
  };

  // Directories: path -> { entries: [], cluster }
  const dirs = new Map([['', { entries: [], cluster: fatBits === 32 ? alloc(clusterSize * 4) : 0 }]]);
  const shortNames = new Set();
  const short83 = (name, n = 1) => {
    const dot = name.lastIndexOf('.');
    const base = (dot > 0 ? name.slice(0, dot) : name).toUpperCase().replace(/[^A-Z0-9_]/g, '');
    const ext = (dot > 0 ? name.slice(dot + 1) : '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 3);
    const needsTail = base.length > 8 || name !== `${base}${ext ? `.${ext}` : ''}`;
    const b8 = needsTail ? `${base.slice(0, 6)}~${n}` : base;
    return { base: b8.padEnd(8).slice(0, 8), ext: ext.padEnd(3), lossy: needsTail };
  };
  const entryBytes = (name, attr, cluster, size, deleted) => {
    let s = short83(name);
    for (let n = 2; shortNames.has(s.base + s.ext); n++) s = short83(name, n);
    shortNames.add(s.base + s.ext);
    const sfn = new Uint8Array(32);
    sfn.set(new TextEncoder().encode(s.base + s.ext));
    sfn[11] = attr;
    const date = ((2024 - 1980) << 9) | (5 << 5) | 17;
    const time = (12 << 11) | (30 << 5);
    sfn[22] = time & 0xff; sfn[23] = time >> 8; sfn[24] = date & 0xff; sfn[25] = date >> 8;
    sfn[20] = (cluster >> 16) & 0xff; sfn[21] = (cluster >> 24) & 0xff;
    sfn[26] = cluster & 0xff; sfn[27] = (cluster >> 8) & 0xff;
    new DataView(sfn.buffer).setUint32(28, size, true);
    const out = [];
    if (s.lossy) {
      let sum = 0;
      for (let i = 0; i < 11; i++) sum = (((sum & 1) << 7) + (sum >> 1) + sfn[i]) & 0xff;
      const units = [...name].map((c) => c.charCodeAt(0));
      const count = Math.ceil((units.length + 1) / 13);
      const padded = [...units, 0, ...new Array(count * 13).fill(0xffff)].slice(0, count * 13);
      for (let k = count; k >= 1; k--) {
        const e = new Uint8Array(32);
        e[0] = k | (k === count ? 0x40 : 0);
        e[11] = 0x0f; e[13] = sum;
        const chunk = padded.slice((k - 1) * 13, k * 13);
        [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30].forEach((off, i) => { e[off] = chunk[i] & 0xff; e[off + 1] = chunk[i] >> 8; });
        if (deleted) e[0] = 0xe5;
        out.push(e);
      }
    }
    if (deleted) sfn[0] = 0xe5;
    out.push(sfn);
    return out;
  };
  const ensureDir = (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const parent = ensureDir(path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
    const d = { entries: [], cluster: alloc(clusterSize * 4) };
    parent.entries.push(...entryBytes(path.split('/').pop(), 0x10, d.cluster, 0, false));
    dirs.set(path, d);
    return d;
  };
  for (const f of files) {
    const dirPath = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    const dir = ensureDir(dirPath);
    const data = f.data instanceof Uint8Array ? f.data : new TextEncoder().encode(f.data);
    // Deleted files keep their data but lose their FAT chain, like a real delete.
    const cluster = data.length ? alloc(data.length, { mark: !f.deleted }) : 0;
    if (data.length) img.set(data, coff(cluster));
    dir.entries.push(...entryBytes(f.path.split('/').pop(), 0x20, cluster, data.length, !!f.deleted));
  }
  for (const [path, d] of dirs) {
    const base = path === '' && fatBits !== 32 ? (reserved + 2 * fatSize) * bps : coff(d.cluster);
    if (path !== '') {
      const dot = new Uint8Array(32);
      dot.set(new TextEncoder().encode('.          '));
      dot[11] = 0x10;
      dot[26] = d.cluster & 0xff; dot[27] = (d.cluster >> 8) & 0xff;
      const dotdot = new Uint8Array(32);
      dotdot.set(new TextEncoder().encode('..         '));
      dotdot[11] = 0x10;
      d.entries.unshift(dot, dotdot);
    }
    d.entries.forEach((e, i) => img.set(e, base + i * 32));
  }
  return img;
}

/** Wrap a volume in an MBR with one partition at `startLba`. */
export function buildMbrDisk(volume, { startLba = 2048, type = 0x06, totalSectors } = {}) {
  const total = totalSectors ?? startLba + volume.length / 512;
  const disk = new Uint8Array(total * 512);
  disk.set(volume, startLba * 512);
  const dv = new DataView(disk.buffer);
  dv.setUint32(440, 0x5eedcafe, true);
  disk[446] = 0x80;
  disk[446 + 4] = type;
  dv.setUint32(446 + 8, startLba, true);
  dv.setUint32(446 + 12, volume.length / 512, true);
  disk[510] = 0x55; disk[511] = 0xaa;
  return disk;
}
