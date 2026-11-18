// Firmware image analyzer: a binwalk-style signature scanner, header parsers,
// entropy profile, string extraction, hex view, carving and gzip/zlib
// decompression. Pure logic: no React, no network. Runs in the browser (or a
// worker). The scanner and the entropy/strings passes are async and yield to
// the event loop between chunks so a 16 MB image does not freeze the UI.
//
// Hits are only reported when the header parses and passes its own checks
// (CRC, reserved bits, sizes, checksums) where the format has one. Entries
// marked `heuristic` are weaker: they match a few bytes plus plausibility
// checks and are hints, not proof.

import { crc32 } from './hashSuite.js';
import { parsePartitionTable } from './espPartitions.js';

export const FIRMWARE_ANALYZER_VERSION = 1;

const yieldNow = () => new Promise((resolve) => setTimeout(resolve, 0));
const enc = (s) => Array.from(s, (c) => c.charCodeAt(0) & 0xff);

const le16 = (b, o) => b[o] | (b[o + 1] << 8);
const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const le64 = (b, o) => le32(b, o) + le32(b, o + 4) * 4294967296;
const be64 = (b, o) => be32(b, o) * 4294967296 + be32(b, o + 4);
const hex8 = (v) => `0x${v.toString(16).padStart(8, '0')}`;
const lookup = (map, v) => `${map[v] ?? 'unknown'} (${v})`;
const isPow2 = (v) => v > 0 && (v & (v - 1)) === 0;

/** Printable ASCII view of bytes (non-printable becomes '.'). */
export function asciiOf(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : '.';
  }
  return s;
}

/** NUL-terminated string inside a fixed-size field. */
function cstr(b, o, max) {
  let e = o;
  const lim = Math.min(b.length, o + max);
  while (e < lim && b[e] !== 0) e++;
  return asciiOf(b.subarray(o, e));
}

/** First index of `pat` in b within [from, to), or -1. */
export function findBytes(b, pat, from = 0, to = b.length) {
  const last = Math.min(to, b.length) - pat.length;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer;
    return i;
  }
  return -1;
}

const HEXV = new Int8Array(256).fill(-1);
for (let i = 0; i < 10; i++) HEXV[0x30 + i] = i;
for (let i = 0; i < 6; i++) { HEXV[0x61 + i] = 10 + i; HEXV[0x41 + i] = 10 + i; }

const B64 = new Uint8Array(256);
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=') B64[c.charCodeAt(0)] = 1;

const timeStr = (t) => (t === 0 ? 'not set' : new Date(t * 1000).toISOString());

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

const UIMAGE_OS = { 1: 'OpenBSD', 2: 'NetBSD', 3: 'FreeBSD', 4: '4.4BSD', 5: 'Linux', 6: 'SVR4', 8: 'Solaris', 9: 'IRIX', 14: 'VxWorks', 16: 'QNX', 17: 'U-Boot', 18: 'RTEMS' };
const UIMAGE_ARCH = { 1: 'Alpha', 2: 'ARM', 3: 'x86', 4: 'IA-64', 5: 'MIPS', 6: 'MIPS64', 7: 'PowerPC', 8: 'S/390', 9: 'SuperH', 10: 'SPARC', 11: 'SPARC64' };
const UIMAGE_TYPE = { 1: 'standalone', 2: 'kernel', 3: 'ramdisk', 4: 'multi-file', 5: 'firmware', 6: 'script' };
const UIMAGE_COMP = { 0: 'none', 1: 'gzip', 2: 'bzip2', 3: 'lzma', 4: 'lzo', 5: 'lz4' };
const SQUASH_COMP = { 1: 'gzip', 2: 'lzma', 3: 'lzo', 4: 'xz', 5: 'lz4', 6: 'zstd' };
const JFFS2_NODE = { 0x2003: 'clean marker', 0x2004: 'padding', 0x2006: 'summary', 0xe001: 'dirent', 0xe002: 'inode', 0xe008: 'xattr', 0xe009: 'xref' };
const UBIFS_NODE = ['inode', 'data', 'directory entry', 'extended attribute', 'truncation', 'padding', 'superblock', 'master', 'reference', 'index', 'commit start', 'orphan', 'authentication', 'signature'];
const ZIP_METHODS = { 0: 'stored', 8: 'deflate', 9: 'deflate64', 12: 'bzip2', 14: 'LZMA', 93: 'zstd', 95: 'xz', 98: 'PPMd', 99: 'AES (WinZip)' };
const ELF_MACHINE = { 2: 'SPARC', 3: 'x86', 8: 'MIPS', 20: 'PowerPC', 21: 'PowerPC64', 40: 'ARM', 42: 'SuperH', 50: 'IA-64', 62: 'x86-64', 183: 'AArch64', 243: 'RISC-V' };
const PE_MACHINE = { 0x14c: 'x86', 0x8664: 'x86-64', 0x1c0: 'ARM', 0x1c4: 'ARMv7 Thumb-2', 0xaa64: 'ARM64', 0x200: 'IA-64' };
const ESP_CHIP = { 0x0000: 'ESP32', 0x0002: 'ESP32-S2', 0x0005: 'ESP32-C3', 0x0009: 'ESP32-S3', 0x000c: 'ESP32-C2', 0x000d: 'ESP32-C6', 0x0010: 'ESP32-H2' };
const TAR_TYPES = { '0': 'regular file', '1': 'hard link', '2': 'symbolic link', '3': 'character device', '4': 'block device', '5': 'directory', x: 'pax extended header', g: 'pax global header', L: 'GNU long name' };

// ---------------------------------------------------------------------------
// Header parsers. Each receives (bytes, start, length) where `start` is the
// start of the structure (the scanner subtracts the magic's relative offset).
// Return null to reject the candidate, or { size, fields, notes, name }.
// `size` is the structure's length when the header states it (null otherwise).
// ---------------------------------------------------------------------------

function parseUImage(b, s, n) {
  if (s + 64 > n) return null;
  const hdr = b.slice(s, s + 64);
  const storedHcrc = be32(b, s + 4);
  hdr[4] = hdr[5] = hdr[6] = hdr[7] = 0;
  if (crc32(hdr) !== storedHcrc) return null;
  const size = be32(b, s + 12);
  const dcrc = be32(b, s + 24);
  const notes = [];
  const fields = [
    ['Created', timeStr(be32(b, s + 8))],
    ['Data size', size],
    ['Load address', hex8(be32(b, s + 16))],
    ['Entry point', hex8(be32(b, s + 20))],
    ['OS', lookup(UIMAGE_OS, b[s + 28])],
    ['Architecture', lookup(UIMAGE_ARCH, b[s + 29])],
    ['Image type', lookup(UIMAGE_TYPE, b[s + 30])],
    ['Compression', lookup(UIMAGE_COMP, b[s + 31])],
    ['Name', cstr(b, s + 32, 32)],
    ['Header CRC', 'valid']
  ];
  if (s + 64 + size <= n) {
    fields.push(['Data CRC', crc32(b.subarray(s + 64, s + 64 + size)) === dcrc ? 'valid' : 'MISMATCH']);
  } else {
    notes.push('Data runs past the end of the file.');
  }
  return { size: 64 + size, fields, notes };
}

function parseDtb(b, s, n) {
  if (s + 40 > n) return null;
  const total = be32(b, s + 4);
  const offStruct = be32(b, s + 8);
  const offStrings = be32(b, s + 12);
  const version = be32(b, s + 20);
  const sizeStrings = be32(b, s + 32);
  const sizeStruct = be32(b, s + 36);
  if (version < 1 || version > 17 || total < 40) return null;
  if (offStruct + sizeStruct > total || offStrings + sizeStrings > total) return null;
  const structFrom = s + offStruct;
  const structTo = Math.min(n, s + offStruct + sizeStruct);
  const isFit = findBytes(b, enc('images\0'), structFrom, structTo) >= 0 &&
    findBytes(b, enc('configurations\0'), structFrom, structTo) >= 0;
  const notes = s + total > n ? ['Blob runs past the end of the file.'] : [];
  return {
    name: isFit ? 'Flattened image tree (FIT)' : 'Device tree blob (DTB)',
    size: total,
    fields: [['Total size', total], ['Version', version], ['Structure size', sizeStruct], ['Strings size', sizeStrings], ['Contains images/configurations', isFit ? 'yes' : 'no']],
    notes
  };
}

function squashfsParser(endian) {
  const rd32 = endian === 'le' ? le32 : be32;
  const rd16 = endian === 'le' ? le16 : be16;
  const rd64 = endian === 'le' ? le64 : be64;
  return (b, s, n) => {
    if (s + 96 > n) return null;
    const major = rd16(b, s + 28);
    const blockSize = rd32(b, s + 12);
    const blockLog = rd16(b, s + 22);
    const comp = rd16(b, s + 20);
    if (major !== 4) return null;
    if (blockSize < 4096 || blockSize > 1048576 || !isPow2(blockSize)) return null;
    if (2 ** blockLog !== blockSize) return null;
    if (comp < 1 || comp > 6) return null;
    const bytesUsed = rd64(b, s + 40);
    const notes = s + bytesUsed > n ? ['Filesystem runs past the end of the file (truncated image).'] : [];
    return {
      name: 'SquashFS filesystem',
      size: bytesUsed,
      fields: [
        ['Byte order', endian === 'le' ? 'little' : 'big'],
        ['Version', `${major}.${rd16(b, s + 30)}`],
        ['Inodes', rd32(b, s + 4)],
        ['Block size', blockSize],
        ['Compression', SQUASH_COMP[comp]],
        ['Bytes used', bytesUsed]
      ],
      notes
    };
  };
}

function parseCramfs(b, s, n) {
  if (s + 64 > n) return null;
  if (asciiOf(b.subarray(s + 16, s + 32)) !== 'Compressed ROMFS') return null;
  return {
    name: 'CramFS filesystem',
    size: le32(b, s + 4),
    fields: [['Size', le32(b, s + 4)], ['Flags', hex8(le32(b, s + 8))], ['Volume name', cstr(b, s + 48, 16)]],
    notes: []
  };
}

function parseJffs2Node(b, s, n) {
  if (s + 12 > n) return null;
  const type = le16(b, s + 2);
  const len = le32(b, s + 4);
  if (!(type in JFFS2_NODE) || len < 12) return null;
  return {
    name: 'JFFS2 node',
    size: null,
    fields: [['Node type', JFFS2_NODE[type]], ['Length', len]],
    notes: s + len > n ? ['Node runs past the end of the file.'] : []
  };
}

function parseUbiEc(b, s, n) {
  if (s + 64 > n) return null;
  const version = b[s + 4];
  const vidOff = be32(b, s + 16);
  const dataOff = be32(b, s + 20);
  if (version !== 1 || vidOff < 64 || dataOff <= vidOff || dataOff > 1 << 22) return null;
  return {
    name: 'UBI erase counter header',
    size: null,
    fields: [['Erase counter', be32(b, s + 8) * 4294967296 + be32(b, s + 12)], ['VID header offset', vidOff], ['Data offset', dataOff], ['Image sequence', be32(b, s + 24)]],
    notes: []
  };
}

function parseUbiVid(b, s, n) {
  if (s + 64 > n) return null;
  const type = b[s + 5];
  const copy = b[s + 6];
  const compat = b[s + 7];
  if ((type !== 1 && type !== 2) || copy > 1 || ![0, 1, 2, 4, 5].includes(compat)) return null;
  return {
    name: 'UBI volume header',
    size: null,
    fields: [['Volume type', type === 1 ? 'static' : 'dynamic'], ['Volume ID', be32(b, s + 8)], ['LEB number', be32(b, s + 12)], ['Data size', be32(b, s + 20)]],
    notes: []
  };
}

function parseUbifs(b, s, n) {
  if (s + 24 > n) return null;
  const len = le32(b, s + 16);
  const type = b[s + 20];
  if (len < 24 || type > 13) return null;
  const fields = [['Node type', UBIFS_NODE[type]], ['Length', len]];
  if (type === 6) {
    if (s + 120 > n) return null;
    const minIo = le32(b, s + 32);
    const lebSize = le32(b, s + 36);
    if (!isPow2(lebSize) || lebSize < 4096 || !isPow2(minIo)) return null;
    fields.push(['Min I/O size', minIo], ['LEB size', lebSize], ['LEB count', le32(b, s + 40)], ['Format version', le32(b, s + 80)]);
  }
  return { name: 'UBIFS node', size: null, fields, notes: [] };
}

function parseExt(b, s, n) {
  const sb = s + 1024;
  if (sb + 104 > n) return null;
  const logBs = le32(b, sb + 24);
  const rev = le32(b, sb + 76);
  const bpg = le32(b, sb + 32);
  const ipg = le32(b, sb + 40);
  if (logBs > 6 || rev > 1 || bpg === 0 || ipg === 0) return null;
  const compat = le32(b, sb + 92);
  const incompat = le32(b, sb + 96);
  const kind = incompat & 0x40 ? 'ext4' : compat & 0x4 ? 'ext3' : 'ext2';
  const blockSize = 1024 * 2 ** logBs;
  const blocks = le32(b, sb + 4);
  return {
    name: `${kind} filesystem`,
    size: blocks * blockSize,
    fields: [
      ['Kind', kind],
      ['Block size', blockSize],
      ['Blocks (low 32 bits)', blocks],
      ['Inodes', le32(b, sb)],
      ['Volume name', cstr(b, sb + 120, 16)],
      ['Incompat features', hex8(incompat)]
    ],
    notes: ['Only the low 32 bits of the block count are decoded (64-bit ext4 is partly decoded).']
  };
}

function parseGzip(b, s, n) {
  if (s + 10 > n) return null;
  const flg = b[s + 3];
  if (flg & 0xe0) return null;
  const mtime = le32(b, s + 4);
  const osNames = { 0: 'FAT', 3: 'Unix', 7: 'Macintosh', 11: 'NTFS' };
  const fields = [
    ['Method', 'deflate'],
    ['Modified', timeStr(mtime)],
    ['Origin OS', osNames[b[s + 9]] || `code ${b[s + 9]}`]
  ];
  let p = s + 10;
  if (flg & 0x04 && p + 2 <= n) p += 2 + le16(b, p);
  if (flg & 0x08 && p < n) {
    const name = cstr(b, p, 256);
    fields.push(['Original name', name]);
  }
  return { name: 'gzip stream', size: null, fields, notes: ['Decompress from the Decompress tab (uses the browser DecompressionStream).'] };
}

function parseXz(b, s, n) {
  if (s + 12 > n) return null;
  if (b[s + 6] !== 0) return null;
  const check = b[s + 7];
  if ((check & 0xf0) !== 0) return null;
  const checks = { 0: 'none', 1: 'CRC32', 4: 'CRC64', 10: 'SHA-256' };
  if (!(check in checks)) return null;
  if (crc32(b.subarray(s + 6, s + 8)) !== le32(b, s + 8)) return null;
  return {
    name: 'xz stream',
    size: null,
    fields: [['Integrity check', checks[check]], ['Stream header CRC', 'valid']],
    notes: ['The index and footer are not parsed, so the stream end is not known.']
  };
}

function isLzmaDict(d) {
  if (d < 4096) return false;
  const k = Math.floor(Math.log2(d));
  const p = 2 ** k;
  return p === d || (k >= 1 && d === p + p / 2);
}

function parseLzma(b, s, n) {
  if (s + 13 > n) return null;
  const props = b[s];
  const dict = le32(b, s + 1);
  if (props >= 225 || !isLzmaDict(dict)) return null;
  const unknown = b.subarray(s + 5, s + 13).every((x) => x === 0xff);
  const usize = le64(b, s + 5);
  if (!unknown && usize > 2 ** 40) return null;
  const lc = props % 9;
  const lp = Math.floor(props / 9) % 5;
  const pb = Math.floor(props / 45);
  return {
    name: 'LZMA stream (heuristic)',
    size: null,
    fields: [['Properties', `lc=${lc} lp=${lp} pb=${pb}`], ['Dictionary size', dict], ['Uncompressed size', unknown ? 'unknown (end marker)' : usize]],
    notes: ['Heuristic: a 13-byte "LZMA alone" header with no magic. Treat as a hint.']
  };
}

const ZSTD_DICT_BYTES = [0, 1, 2, 4];
function parseZstd(b, s, n) {
  if (s + 6 > n) return null;
  const fhd = b[s + 4];
  if (fhd & 0x08) return null;
  const single = (fhd >> 5) & 1;
  const fcsFlag = fhd >> 6;
  const dictFlag = fhd & 3;
  const fcsBytes = fcsFlag === 0 ? (single ? 1 : 0) : [0, 2, 4, 8][fcsFlag];
  let p = s + 5;
  const fields = [];
  if (!single) {
    const wd = b[p];
    p += 1;
    const base = 2 ** (10 + (wd >> 3));
    fields.push(['Window size', base + (base / 8) * (wd & 7)]);
  }
  p += ZSTD_DICT_BYTES[dictFlag];
  if (p + fcsBytes > n) return null;
  if (fcsBytes) {
    let v = 0;
    for (let i = 0; i < fcsBytes; i++) v += b[p + i] * 256 ** i;
    if (fcsFlag === 1) v += 256;
    fields.push(['Frame content size', v]);
  }
  fields.push(['Checksum', fhd & 0x04 ? 'yes' : 'no']);
  return { name: 'zstd frame', size: null, fields, notes: [] };
}

function parseBzip2(b, s, n) {
  if (s + 10 > n) return null;
  const level = b[s + 3] - 0x30;
  if (level < 1 || level > 9) return null;
  const blockMagic = [0x31, 0x41, 0x59, 0x26, 0x53, 0x59];
  const eosMagic = [0x17, 0x72, 0x45, 0x38, 0x50, 0x90];
  const at = (pat) => pat.every((v, i) => b[s + 4 + i] === v);
  const isBlock = at(blockMagic);
  if (!isBlock && !at(eosMagic)) return null;
  return {
    name: 'bzip2 stream',
    size: null,
    fields: [['Block size', `${level * 100} kB`], ['First block', isBlock ? 'data block' : 'end of stream (empty)']],
    notes: []
  };
}

function parseLz4(b, s, n) {
  if (s + 6 > n) return null;
  const flg = b[s + 4];
  const bd = b[s + 5];
  if (flg >> 6 !== 1 || flg & 0x02 || bd & 0x8f) return null;
  const bmax = (bd >> 4) & 7;
  if (bmax < 4) return null;
  const maxSizes = { 4: '64 KiB', 5: '256 KiB', 6: '1 MiB', 7: '4 MiB' };
  const fields = [
    ['Block max size', maxSizes[bmax]],
    ['Block checksum', flg & 0x10 ? 'yes' : 'no'],
    ['Content checksum', flg & 0x04 ? 'yes' : 'no']
  ];
  if (flg & 0x08 && s + 14 <= n) fields.push(['Content size', le64(b, s + 6)]);
  return { name: 'LZ4 frame', size: null, fields, notes: [] };
}

function parseZlib(b, s, n) {
  if (s + 3 > n) return null;
  const cmf = b[s];
  const flg = b[s + 1];
  if ((cmf & 0x0f) !== 8 || cmf >> 4 > 7) return null;
  if (((cmf << 8) | flg) % 31 !== 0 || flg & 0x20) return null;
  // The first deflate block header must not use the reserved block type 3.
  if (((b[s + 2] >> 1) & 3) === 3) return null;
  const levels = ['fastest', 'fast', 'default', 'maximum'];
  return {
    name: 'zlib stream (heuristic)',
    size: null,
    fields: [['Window size', 2 ** ((cmf >> 4) + 8)], ['Compression level', levels[flg >> 6]]],
    notes: ['Two-byte header match. Common byte pairs can occur by chance in compressed data.']
  };
}

function parse7z(b, s, n) {
  if (s + 32 > n) return null;
  if (b[s + 6] !== 0 || b[s + 7] > 4) return null;
  if (crc32(b.subarray(s + 12, s + 32)) !== le32(b, s + 8)) return null;
  const off = le64(b, s + 12);
  const nsize = le64(b, s + 20);
  const size = 32 + off + nsize;
  return {
    name: '7z archive',
    size,
    fields: [['Format version', `${b[s + 6]}.${b[s + 7]}`], ['Next header offset', off], ['Next header size', nsize], ['Start header CRC', 'valid']],
    notes: s + size > n ? ['Archive runs past the end of the file.'] : []
  };
}

function parseZipLocal(b, s, n) {
  if (s + 30 > n) return null;
  const flags = le16(b, s + 6);
  const method = le16(b, s + 8);
  const csize = le32(b, s + 18);
  const usize = le32(b, s + 22);
  const nlen = le16(b, s + 26);
  const xlen = le16(b, s + 28);
  if (nlen < 1 || nlen > 512 || s + 30 + nlen > n) return null;
  if (!(method in ZIP_METHODS)) return null;
  for (let i = 0; i < nlen; i++) if (b[s + 30 + i] < 0x20 || b[s + 30 + i] > 0x7e) return null;
  const name = asciiOf(b.subarray(s + 30, s + 30 + nlen));
  const size = flags & 0x08 ? null : 30 + nlen + xlen + csize;
  return {
    name: 'ZIP local file header',
    size,
    fields: [['File name', name], ['Method', ZIP_METHODS[method]], ['Compressed size', csize], ['Uncompressed size', usize], ['Encrypted', flags & 1 ? 'yes' : 'no']],
    notes: size && s + size > n ? ['Entry runs past the end of the file.'] : []
  };
}

function parseTrx(b, s, n) {
  if (s + 28 > n) return null;
  const len = le32(b, s + 4);
  const version = le16(b, s + 14);
  if (len < 28 || version < 1 || version > 2) return null;
  return {
    name: 'TRX firmware image',
    size: len,
    fields: [
      ['Length', len],
      ['Stored CRC32', hex8(le32(b, s + 8))],
      ['Flags', hex8(le16(b, s + 12))],
      ['Version', version],
      ['Partition offsets', [le32(b, s + 16), le32(b, s + 20), le32(b, s + 24)].join(', ')]
    ],
    notes: ['The CRC is reported but not recomputed by this tool.', ...(s + len > n ? ['Image runs past the end of the file.'] : [])]
  };
}

function parseAndroidBoot(b, s, n) {
  if (s + 608 > n) return null;
  const page = le32(b, s + 36);
  if (page < 1024 || page > 65536 || !isPow2(page)) return null;
  const kernel = le32(b, s + 8);
  const ramdisk = le32(b, s + 16);
  const second = le32(b, s + 24);
  const hv = le32(b, s + 40);
  const pages = (x) => Math.ceil(x / page);
  const size = page * (1 + pages(kernel) + pages(ramdisk) + pages(second));
  return {
    name: 'Android boot image',
    size,
    fields: [
      ['Header version', hv],
      ['Page size', page],
      ['Kernel size', kernel],
      ['Kernel load address', hex8(le32(b, s + 12))],
      ['Ramdisk size', ramdisk],
      ['Second stage size', second],
      ['OS version (packed)', hex8(le32(b, s + 44))],
      ['Name', cstr(b, s + 48, 16)],
      ['Command line', cstr(b, s + 64, 512)]
    ],
    notes: [
      'Size is the estimate from the v0 layout (header, kernel, ramdisk, second stage).',
      ...(hv >= 1 ? ['Header v1+ trailing sections (recovery DTBO, DTB) are not counted.'] : [])
    ]
  };
}

function parseElf(b, s, n) {
  if (s + 52 > n) return null;
  const cls = b[s + 4];
  const dat = b[s + 5];
  if (b[s + 6] !== 1 || (cls !== 1 && cls !== 2) || (dat !== 1 && dat !== 2)) return null;
  const le = dat === 1;
  const r16 = (o) => (le ? le16(b, s + o) : be16(b, s + o));
  const r32 = (o) => (le ? le32(b, s + o) : be32(b, s + o));
  const r64 = (o) => (le ? le64(b, s + o) : be64(b, s + o));
  let shoff;
  let shentsize;
  let shnum;
  let entry;
  if (cls === 2) {
    if (s + 64 > n) return null;
    shoff = r64(40);
    shentsize = r16(58);
    shnum = r16(60);
    entry = r64(24);
  } else {
    shoff = r32(32);
    shentsize = r16(46);
    shnum = r16(48);
    entry = r32(24);
  }
  const end = shnum && shentsize ? shoff + shnum * shentsize : null;
  const elfType = { 1: 'relocatable', 2: 'executable', 3: 'shared object', 4: 'core' }[r16(16)] || `type ${r16(16)}`;
  return {
    name: 'ELF object',
    size: end !== null && end <= n - s ? end : null,
    fields: [
      ['Class', cls === 2 ? 'ELF64' : 'ELF32'],
      ['Byte order', le ? 'little' : 'big'],
      ['Type', elfType],
      ['Machine', ELF_MACHINE[r16(18)] || `0x${r16(18).toString(16)}`],
      ['Entry point', `0x${entry.toString(16)}`],
      ['Section headers', shnum]
    ],
    notes: end !== null && end > n - s ? ['Section header table is past the end of the file.'] : []
  };
}

function parsePe(b, s, n) {
  if (s + 64 > n) return null;
  const lf = le32(b, s + 0x3c);
  const p = s + lf;
  if (lf < 0x40 || p + 24 > n) return null;
  if (b[p] !== 0x50 || b[p + 1] !== 0x45 || b[p + 2] !== 0 || b[p + 3] !== 0) return null;
  const sections = le16(b, p + 6);
  if (sections > 96) return null;
  const chars = le16(b, p + 22);
  const optMagic = le16(b, p + 24);
  const fmt = { 0x10b: 'PE32', 0x20b: 'PE32+', 0x107: 'ROM' }[optMagic] || `unknown (0x${optMagic.toString(16)})`;
  const machine = le16(b, p + 4);
  return {
    name: chars & 0x2000 ? 'PE DLL' : 'PE executable',
    size: null,
    fields: [
      ['Machine', PE_MACHINE[machine] || `0x${machine.toString(16)}`],
      ['Sections', sections],
      ['Timestamp', timeStr(le32(b, p + 8))],
      ['Optional header', fmt]
    ],
    notes: []
  };
}

function parseArmVectors(b, s, n) {
  if (s + 32 > n) return null;
  let ok = 0;
  for (let i = 0; i < 8; i++) {
    const w = le32(b, s + 4 * i);
    if (((w & 0xfffff000) >>> 0) === 0xe59ff000 || w >>> 24 === 0xea) ok++;
  }
  if (ok < 6) return null;
  return {
    name: 'ARM exception vector table (heuristic)',
    size: 32,
    fields: [['Entries decoding as LDR PC or B', `${ok} of 8`]],
    notes: ['Heuristic on the first 8 words only. A match is a hint, not proof.']
  };
}

const PEM_KINDS = [
  [/PRIVATE KEY/, 'private key (sensitive)'],
  [/CERTIFICATE REQUEST/, 'certificate request'],
  [/CERTIFICATE/, 'certificate'],
  [/X509 CRL/, 'certificate revocation list'],
  [/PUBLIC KEY/, 'public key']
];
function parsePem(b, s, n) {
  // Match the BEGIN line only: stop at the first line break.
  let nl = s;
  const lim = Math.min(n, s + 160);
  while (nl < lim && b[nl] !== 0x0a && b[nl] !== 0x0d) nl++;
  const head = asciiOf(b.subarray(s, nl));
  const m = /^-----BEGIN ([A-Z0-9 #+.-]+?)-----$/.exec(head);
  if (!m) return null;
  const label = m[1];
  const endPat = enc(`-----END ${label}-----`);
  const at = findBytes(b, endPat, s + m[0].length, Math.min(n, s + 16 * 1024 * 1024));
  if (at < 0) return null;
  let end = at + endPat.length;
  while (end < n && (b[end] === 0x0a || b[end] === 0x0d)) end++;
  const kind = (PEM_KINDS.find(([re]) => re.test(label)) || [null, 'PEM block'])[1];
  const isKey = /PRIVATE KEY/.test(label);
  return {
    name: `PEM ${kind}`,
    size: end - s,
    fields: [['Label', label], ['Kind', kind], ['Length', end - s]],
    notes: isKey ? ['Contains private key material. Treat this image as sensitive.'] : []
  };
}

function isB64Char(c) { return B64[c] === 1; }
function parseSshPublic(type) {
  return (b, s, n) => {
    const start = s + type.length + 1;
    let e = start;
    const lim = Math.min(n, start + 16384);
    while (e < lim && isB64Char(b[e])) e++;
    const keyLen = e - start;
    if (keyLen < 40 || keyLen % 4 !== 0) return null;
    let lineEnd = e;
    while (lineEnd < n && b[lineEnd] !== 0x0a && b[lineEnd] !== 0x0d && lineEnd - e < 256) lineEnd++;
    const comment = e < lineEnd ? asciiOf(b.subarray(e, lineEnd)).trim() : '';
    return {
      name: `SSH public key (${type})`,
      size: lineEnd - s,
      fields: [['Key type', type], ['Base64 length', keyLen], ['Comment', comment || '(none)']],
      notes: ['Public key: not secret, but it identifies the host or user it was generated for.']
    };
  };
}

function parseEspAppImage(b, s, n) {
  if (s < 0 || s + 0x20 + 176 > n || b[s] !== 0xe9) return null;
  const segments = b[s + 1];
  if (segments < 1 || segments > 16) return null;
  let p = 24;
  let truncated = false;
  for (let i = 0; i < segments; i++) {
    if (p + 8 > n - s) { truncated = true; break; }
    p += 8 + le32(b, s + p + 4);
  }
  const hashed = b[s + 23] === 1;
  const size = Math.ceil((p + 1) / 16) * 16 + (hashed ? 32 : 0);
  const d = s + 0x20;
  return {
    name: 'ESP32 application image',
    size: truncated || s + size > n ? null : size,
    fields: [
      ['Chip', ESP_CHIP[le16(b, s + 12)] || `chip id ${le16(b, s + 12)}`],
      ['Segments', segments],
      ['Entry point', hex8(le32(b, s + 4))],
      ['App version', cstr(b, d + 16, 32)],
      ['Project', cstr(b, d + 48, 32)],
      ['Built', `${cstr(b, d + 80, 16)} ${cstr(b, d + 96, 16)}`.trim()],
      ['IDF version', cstr(b, d + 112, 32)],
      ['Secure version', le32(b, d + 4)]
    ],
    notes: [
      'Size is computed from the segment headers and the hash flag.',
      ...(truncated ? ['Segment table runs past the end of the file.'] : [])
    ]
  };
}

function parseEspPartitionTable(b, s, n) {
  const slice = b.subarray(s, Math.min(n, s + 0x1000));
  let table;
  try {
    table = parsePartitionTable(slice);
  } catch (e) {
    return null;
  }
  if (table.partitions.some((p) => p.size === 0 || p.offset % 0x1000 !== 0)) return null;
  return {
    name: 'ESP-IDF partition table',
    size: 0x1000,
    fields: [
      ['Partitions', table.partitions.length],
      ['Names', table.partitions.map((p) => p.name).join(', ')],
      ['MD5 entry', table.md5.present ? (table.md5.valid ? 'valid' : 'MISMATCH') : 'absent']
    ],
    notes: table.warnings
  };
}

// Intel HEX: a record is ":" + count + addr(2) + type + data + checksum, all
// hex, with the byte sum (mod 256) equal to zero.
function hexRecordAt(b, s, n) {
  if (s + 11 > n || b[s] !== 0x3a) return null;
  const byteAt = (p) => {
    if (p + 1 >= n) return -1;
    const h = HEXV[b[p]];
    const l = HEXV[b[p + 1]];
    return h < 0 || l < 0 ? -1 : (h << 4) | l;
  };
  const count = byteAt(s + 1);
  if (count < 0) return null;
  const total = count + 5;
  const endChars = s + 1 + total * 2;
  if (endChars > n) return null;
  let sum = 0;
  for (let i = 0; i < total; i++) {
    const v = byteAt(s + 1 + 2 * i);
    if (v < 0) return null;
    sum = (sum + v) & 0xff;
  }
  if (sum !== 0) return null;
  const type = byteAt(s + 7);
  if (type > 5) return null;
  let next = endChars;
  if (next < n && b[next] === 0x0d) next++;
  if (next < n && b[next] === 0x0a) next++;
  else if (endChars < n) return null;
  return { count, type, addr: (byteAt(s + 3) << 8) | byteAt(s + 5), next };
}

function parseIntelHex(b, s, n) {
  let p = s;
  let records = 0;
  let dataBytes = 0;
  let first = null;
  let eof = false;
  for (;;) {
    const rec = hexRecordAt(b, p, n);
    if (!rec) break;
    if (!first) first = rec;
    records++;
    dataBytes += rec.count;
    p = rec.next;
    if (rec.type === 1) { eof = true; break; }
  }
  if (!first || (records < 2 && !eof)) return null;
  return {
    name: 'Intel HEX text',
    size: p - s,
    fields: [
      ['Records', records],
      ['Data bytes', dataBytes],
      ['First record type', first.type],
      ['First address', hex8(first.addr)],
      ['EOF record', eof ? 'present' : 'absent']
    ],
    notes: eof ? [] : ['No end-of-file record: the text may be truncated.']
  };
}

function parseCpio(b, s, n) {
  if (s + 110 > n) return null;
  const field = (o) => {
    let v = 0;
    for (let i = 0; i < 8; i++) {
      const d = HEXV[b[s + o + i]];
      if (d < 0) return NaN;
      v = v * 16 + d;
    }
    return v;
  };
  const mode = field(14);
  const mtime = field(46);
  const filesize = field(54);
  const namesize = field(94);
  if ([mode, mtime, filesize, namesize].some(Number.isNaN)) return null;
  if (namesize < 1 || namesize > 4096 || s + 110 + namesize > n) return null;
  const name = cstr(b, s + 110, namesize - 1);
  if (!name) return null;
  const dataStart = Math.ceil((110 + namesize) / 4) * 4;
  const size = Math.ceil((dataStart + filesize) / 4) * 4;
  const trailer = name === 'TRAILER!!!';
  return {
    name: trailer ? 'CPIO archive trailer' : 'CPIO newc entry',
    size,
    fields: [['Path', name], ['Mode', `0${mode.toString(8)}`], ['File size', filesize], ['Modified', timeStr(mtime)]],
    notes: trailer ? ['End-of-archive marker.'] : []
  };
}

function octalField(b, o, len) {
  let i = 0;
  while (i < len && (b[o + i] === 0x20 || b[o + i] === 0)) i++;
  let v = 0;
  for (; i < len; i++) {
    const c = b[o + i];
    if (c === 0 || c === 0x20) break;
    if (c < 0x30 || c > 0x37) return NaN;
    v = v * 8 + (c - 0x30);
  }
  return v;
}

function parseTar(b, s, n) {
  if (s + 512 > n) return null;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : b[s + i];
  const stored = octalField(b, s + 148, 8);
  if (stored !== sum) return null;
  const size = octalField(b, s + 124, 12);
  if (Number.isNaN(size)) return null;
  const typeChar = String.fromCharCode(b[s + 156] || 0x30);
  const typeName = TAR_TYPES[typeChar] || `type '${typeChar}'`;
  const prefix = cstr(b, s + 345, 155);
  const name = cstr(b, s, 100);
  const full = prefix ? `${prefix}/${name}` : name;
  const regular = typeName === 'regular file';
  const mode = octalField(b, s + 100, 8);
  return {
    name: 'tar entry (ustar)',
    size: regular ? 512 + Math.ceil(size / 512) * 512 : 512,
    fields: [['Path', full], ['Type', typeName], ['Size', size], ['Mode', Number.isNaN(mode) ? 'unreadable' : `0${mode.toString(8)}`]],
    notes: regular ? [] : ['Header only: the entry has no data block.']
  };
}

function parsePng(b, s, n) {
  if (s + 33 > n || cstr(b, s + 12, 4) !== 'IHDR') return null;
  let p = s + 8;
  let size = null;
  for (let i = 0; i < 100000 && p + 12 <= n; i++) {
    const len = be32(b, p);
    const type = asciiOf(b.subarray(p + 4, p + 8));
    p += 12 + len;
    if (type === 'IEND') { size = p - s; break; }
  }
  return {
    name: 'PNG image',
    size,
    fields: [['Width', be32(b, s + 16)], ['Height', be32(b, s + 20)], ['Bit depth', b[s + 24]], ['Colour type', b[s + 25]]],
    notes: size === null ? ['IEND not found: the image may be truncated.'] : []
  };
}

// ---------------------------------------------------------------------------
// Signature table. `patterns` are byte arrays; `at` is where the magic sits
// relative to the structure start (0 for almost everything).
// ---------------------------------------------------------------------------

const sig = (id, name, category, patterns, parse, opts = {}) => ({
  id,
  name,
  category,
  patterns: patterns.map((p) => (typeof p === 'string' ? enc(p) : p)),
  at: opts.at || 0,
  heuristic: !!opts.heuristic,
  maxHits: opts.maxHits || 512,
  parse
});

export const SIGNATURES = [
  sig('uimage', 'U-Boot uImage', 'boot', [[0x27, 0x05, 0x19, 0x56]], parseUImage),
  sig('dtb', 'Device tree blob / FIT', 'boot', [[0xd0, 0x0d, 0xfe, 0xed]], parseDtb),
  sig('squashfs-le', 'SquashFS (little endian)', 'filesystem', ['hsqs'], squashfsParser('le')),
  sig('squashfs-be', 'SquashFS (big endian)', 'filesystem', ['sqsh'], squashfsParser('be')),
  sig('cramfs', 'CramFS', 'filesystem', [[0x45, 0x3d, 0xcd, 0x28]], parseCramfs),
  sig('jffs2', 'JFFS2 node', 'filesystem', [[0x85, 0x19]], parseJffs2Node, { maxHits: 5000 }),
  sig('ubi-ec', 'UBI erase counter header', 'filesystem', ['UBI#'], parseUbiEc),
  sig('ubi-vid', 'UBI volume header', 'filesystem', ['UBI!'], parseUbiVid),
  sig('ubifs', 'UBIFS node', 'filesystem', [[0x31, 0x18, 0x10, 0x06]], parseUbifs, { maxHits: 5000 }),
  sig('ext', 'ext2/3/4 superblock', 'filesystem', [[0x53, 0xef]], parseExt, { at: 1080 }),
  sig('cpio', 'CPIO newc archive', 'container', ['070701', '070702'], parseCpio, { maxHits: 2000 }),
  sig('tar', 'tar (ustar)', 'container', ['ustar'], parseTar, { at: 257, maxHits: 2000 }),
  sig('zip', 'ZIP local file header', 'container', [[0x50, 0x4b, 0x03, 0x04]], parseZipLocal, { maxHits: 2000 }),
  sig('7z', '7z archive', 'container', [[0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]], parse7z),
  sig('trx', 'TRX firmware image', 'boot', ['HDR0'], parseTrx),
  sig('android', 'Android boot image', 'boot', ['ANDROID!'], parseAndroidBoot),
  sig('esp32-app', 'ESP32 application image', 'boot', [[0x32, 0x54, 0xcd, 0xab]], parseEspAppImage, { at: 0x20 }),
  sig('esp-partitions', 'ESP-IDF partition table', 'boot', [[0xaa, 0x50]], parseEspPartitionTable, { maxHits: 64 }),
  sig('gzip', 'gzip', 'compression', [[0x1f, 0x8b, 0x08]], parseGzip),
  sig('xz', 'xz', 'compression', [[0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]], parseXz),
  sig('lzma', 'LZMA (heuristic)', 'compression', [[0x5d, 0x00]], parseLzma, { heuristic: true, maxHits: 2000 }),
  sig('zstd', 'zstd', 'compression', [[0x28, 0xb5, 0x2f, 0xfd]], parseZstd),
  sig('bzip2', 'bzip2', 'compression', ['BZh'], parseBzip2),
  sig('lz4', 'LZ4 frame', 'compression', [[0x04, 0x22, 0x4d, 0x18]], parseLz4),
  sig('zlib', 'zlib stream (heuristic)', 'compression', [[0x78, 0x01], [0x78, 0x5e], [0x78, 0x9c], [0x78, 0xda]], parseZlib, { heuristic: true, maxHits: 2000 }),
  sig('elf', 'ELF', 'executable', [[0x7f, 0x45, 0x4c, 0x46]], parseElf),
  sig('pe', 'PE (MZ header)', 'executable', ['MZ'], parsePe, { maxHits: 2000 }),
  sig('arm-vectors', 'ARM vector table (heuristic)', 'executable', [[0xf0, 0x9f, 0xe5]], parseArmVectors, { at: 1, heuristic: true, maxHits: 2000 }),
  sig('png', 'PNG image', 'image', [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]], parsePng),
  sig('pem', 'PEM certificate or key', 'crypto', ['-----BEGIN '], parsePem, { maxHits: 512 }),
  sig('ssh-rsa', 'SSH public key (RSA)', 'crypto', ['ssh-rsa AAAA'], parseSshPublic('ssh-rsa'), { maxHits: 256 }),
  sig('ssh-ed25519', 'SSH public key (Ed25519)', 'crypto', ['ssh-ed25519 AAAA'], parseSshPublic('ssh-ed25519'), { maxHits: 256 }),
  sig('ssh-ecdsa', 'SSH public key (ECDSA)', 'crypto', ['ecdsa-sha2-nistp256 AAAA'], parseSshPublic('ecdsa-sha2-nistp256'), { maxHits: 256 }),
  sig('intel-hex', 'Intel HEX text', 'text', [':'], parseIntelHex, { heuristic: false, maxHits: 64 })
];

export const CATEGORY_LABELS = {
  boot: 'Boot / firmware header',
  filesystem: 'Filesystem',
  compression: 'Compressed stream',
  container: 'Container / archive',
  executable: 'Executable / code',
  crypto: 'Key / certificate',
  image: 'Image',
  text: 'Text encoding'
};

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function makeBuckets(signatures) {
  const buckets = Array.from({ length: 256 }, () => []);
  for (const s of signatures) {
    for (const pat of s.patterns) buckets[pat[0]].push({ s, pat });
  }
  return buckets;
}

/**
 * Scan for every signature. Chunked: yields to the event loop between chunks.
 * @param {Uint8Array} bytes
 * @param {{ signal?: AbortSignal, onProgress?: (fraction:number)=>void, chunkSize?: number, signatures?: object[] }} [opts]
 * @returns {Promise<{ hits: object[], truncated: object[], scannedBytes: number }>}
 *   hits sorted by offset; `truncated` lists signatures that hit their maxHits cap.
 */
export async function scanSignatures(bytes, opts = {}) {
  const { signal, onProgress, chunkSize = 1 << 20, signatures = SIGNATURES } = opts;
  const n = bytes.length;
  const buckets = makeBuckets(signatures);
  const hits = [];
  const counts = new Map();
  const capped = new Set();
  const suppressUntil = new Map();

  for (let start = 0; start < n; start += chunkSize) {
    if (signal?.aborted) throw new DOMException('Scan cancelled', 'AbortError');
    const end = Math.min(n, start + chunkSize);
    for (let pos = start; pos < end; pos++) {
      const list = buckets[bytes[pos]];
      if (list.length === 0) continue;
      for (const { s, pat } of list) {
        if (pos + pat.length > n) continue;
        let match = true;
        for (let k = 1; k < pat.length; k++) {
          if (bytes[pos + k] !== pat[k]) { match = false; break; }
        }
        if (!match) continue;
        const from = pos - s.at;
        if (from < 0) continue;
        if (suppressUntil.has(s.id) && from < suppressUntil.get(s.id)) continue;
        const have = counts.get(s.id) || 0;
        if (have >= s.maxHits) { capped.add(s.id); continue; }
        const info = s.parse(bytes, from, n);
        if (!info) continue;
        counts.set(s.id, have + 1);
        hits.push({
          offset: from,
          id: s.id,
          name: info.name || s.name,
          category: s.category,
          categoryLabel: CATEGORY_LABELS[s.category],
          heuristic: s.heuristic,
          size: info.size && info.size > 0 ? info.size : null,
          fields: info.fields || [],
          notes: info.notes || []
        });
        if (info.size && info.size > 0) suppressUntil.set(s.id, from + info.size);
      }
    }
    onProgress?.(end / Math.max(1, n));
    await yieldNow();
  }

  hits.sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
  const truncated = signatures.filter((s) => capped.has(s.id)).map((s) => ({ id: s.id, name: s.name, limit: s.maxHits }));
  return { hits, truncated, scannedBytes: n };
}

/**
 * For a hit, the range to carve: the parsed size when known, otherwise up to
 * the next hit, otherwise to the end of the file. `basis` says which applied.
 */
export function carveRangeForHit(hit, hits, fileSize) {
  const idx = hits.indexOf(hit);
  let next = null;
  for (let i = idx + 1; i < hits.length; i++) {
    if (hits[i].offset > hit.offset) { next = hits[i]; break; }
  }
  if (hit.size) {
    return { start: hit.offset, end: Math.min(fileSize, hit.offset + hit.size), basis: 'parsed size' };
  }
  if (next) return { start: hit.offset, end: Math.min(fileSize, next.offset), basis: 'next hit' };
  return { start: hit.offset, end: fileSize, basis: 'end of file' };
}

/** Copy of bytes [start, end), clamped to the buffer. */
export function carveBytes(bytes, start, end) {
  const s = Math.max(0, Math.min(bytes.length, start));
  const e = Math.max(s, Math.min(bytes.length, end));
  return bytes.slice(s, e);
}

// ---------------------------------------------------------------------------
// Entropy
// ---------------------------------------------------------------------------

export function shannonEntropy(bytes, start = 0, end = bytes.length) {
  const n = end - start;
  if (n <= 0) return 0;
  const counts = new Uint32Array(256);
  for (let i = start; i < end; i++) counts[bytes[i]]++;
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const c = counts[i];
    if (c) {
      const p = c / n;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

/** Block size giving roughly 2048 blocks, a power of two from 256 to 65536. */
export function autoBlockSize(length) {
  let bs = 256;
  while (bs < 65536 && length / bs > 2048) bs *= 2;
  return bs;
}

/** Per-block Shannon entropy (bits per byte, 0 to 8). Chunked. */
export async function entropyProfile(bytes, opts = {}) {
  const { blockSize = autoBlockSize(bytes.length), onProgress, signal } = opts;
  const n = bytes.length;
  const count = Math.max(1, Math.ceil(n / blockSize));
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    values[i] = shannonEntropy(bytes, i * blockSize, Math.min(n, (i + 1) * blockSize));
    if (i % 256 === 255) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      onProgress?.((i + 1) / count);
      await yieldNow();
    }
  }
  return { blockSize, values, length: n };
}

export const HIGH_ENTROPY = 7.5;

export function classifyEntropy(h) {
  if (h >= HIGH_ENTROPY) return 'high';
  if (h >= 6) return 'medium';
  return 'low';
}

/** Runs of consecutive blocks at or above `threshold`. */
export function highEntropyRegions(profile, threshold = HIGH_ENTROPY) {
  const { values, blockSize, length } = profile;
  const regions = [];
  let run = null;
  for (let i = 0; i <= values.length; i++) {
    const hot = i < values.length && values[i] >= threshold;
    if (hot) {
      if (!run) run = { first: i, sum: 0, blocks: 0 };
      run.sum += values[i];
      run.blocks++;
    } else if (run) {
      regions.push({
        start: run.first * blockSize,
        end: Math.min(length, (run.first + run.blocks) * blockSize),
        meanEntropy: run.sum / run.blocks
      });
      run = null;
    }
  }
  return regions;
}

export function entropySummary(profile) {
  const { values } = profile;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let high = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
    if (v >= HIGH_ENTROPY) high++;
  }
  return {
    blockSize: profile.blockSize,
    blocks: values.length,
    min: +min.toFixed(3),
    max: +max.toFixed(3),
    mean: +(sum / values.length).toFixed(3),
    highBlocks: high
  };
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const isPrint = (c) => (c >= 0x20 && c <= 0x7e) || c === 0x09;

/**
 * ASCII and UTF-16LE (ASCII character followed by 0x00) runs of at least
 * `minLen` characters. Chunked. Stops at `maxResults` and sets `truncated`.
 */
export async function extractStrings(bytes, opts = {}) {
  const { minLen = 6, ascii = true, utf16 = true, maxResults = 20000, onProgress, signal } = opts;
  const n = bytes.length;
  const min = Math.max(1, minLen | 0);
  const out = [];
  let truncated = false;
  const CH = 1 << 20;

  const passes = [];
  if (ascii) passes.push('ascii');
  if (utf16) passes.push('utf16le');

  for (let pi = 0; pi < passes.length && !truncated; pi++) {
    const mode = passes[pi];
    let i = 0;
    let nextYield = CH;
    while (i < n) {
      if (i >= nextYield) {
        nextYield += CH;
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        onProgress?.((pi + i / n) / passes.length);
        await yieldNow();
      }
      if (mode === 'ascii') {
        if (!isPrint(bytes[i])) { i++; continue; }
        let j = i;
        while (j < n && isPrint(bytes[j])) j++;
        if (j - i >= min) {
          if (out.length >= maxResults) { truncated = true; break; }
          out.push({ offset: i, encoding: 'ascii', text: asciiOf(bytes.subarray(i, Math.min(j, i + 4096))) });
        }
        i = j;
      } else {
        if (!(isPrint(bytes[i]) && bytes[i + 1] === 0)) { i++; continue; }
        let j = i;
        let chars = '';
        while (j + 1 < n && isPrint(bytes[j]) && bytes[j + 1] === 0 && chars.length < 4096) {
          chars += String.fromCharCode(bytes[j]);
          j += 2;
        }
        if (chars.length >= min) {
          if (out.length >= maxResults) { truncated = true; break; }
          out.push({ offset: i, encoding: 'utf16le', text: chars });
        }
        i = j > i ? j : i + 1;
      }
    }
  }
  out.sort((a, b) => a.offset - b.offset);
  return { strings: out, truncated };
}

// ---------------------------------------------------------------------------
// Hex view
// ---------------------------------------------------------------------------

/** Rows of a hex dump: { offset, hex, ascii }. */
export function hexRows(bytes, offset = 0, length = 256, width = 16) {
  const start = Math.max(0, Math.min(bytes.length, offset));
  const end = Math.min(bytes.length, start + length);
  const rows = [];
  for (let r = start; r < end; r += width) {
    const slice = bytes.subarray(r, Math.min(end, r + width));
    rows.push({
      offset: r,
      hex: Array.from(slice, (v) => v.toString(16).padStart(2, '0')).join(' '),
      ascii: Array.from(slice, (v) => (v >= 0x20 && v <= 0x7e ? String.fromCharCode(v) : '.')).join('')
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Decompression (browser DecompressionStream)
// ---------------------------------------------------------------------------

export const DECOMPRESS_FORMATS = {
  gzip: 'gzip (RFC 1952)',
  deflate: 'zlib (RFC 1950)',
  'deflate-raw': 'raw deflate (RFC 1951)'
};

/**
 * Decompress from `bytes` (pass a slice starting at the stream). Returns the
 * output produced so far even when the stream is damaged or has trailing data:
 * `complete` is false and `error` says why.
 */
export async function decompressStream(bytes, format = 'gzip', opts = {}) {
  const { maxOutput = 64 * 1024 * 1024 } = opts;
  if (typeof DecompressionStream !== 'function') {
    throw new Error('DecompressionStream is not available in this browser. Use a current Chromium, Firefox or Safari.');
  }
  const chunks = [];
  let total = 0;
  let error = null;
  try {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > maxOutput) {
        error = `Output limit of ${maxOutput} bytes reached`;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch (e) {
    error = e?.message || String(e);
  }
  const size = Math.min(total, maxOutput);
  const data = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    if (o >= size) break;
    const take = Math.min(c.length, size - o);
    data.set(c.subarray(0, take), o);
    o += take;
  }
  return { data, complete: error === null, error, outputBytes: size };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const hexOff = (n) => `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;

/** Structured report object (JSON-serialisable). */
export function buildReport({ fileName, size, hits, truncated = [], entropy = null, strings = null, generatedAt = new Date().toISOString() }) {
  return {
    tool: 'Firmware Image Analyzer',
    version: FIRMWARE_ANALYZER_VERSION,
    generatedAt,
    file: { name: fileName, size },
    signatures: hits.map((h) => ({
      offset: h.offset,
      offsetHex: hexOff(h.offset),
      id: h.id,
      name: h.name,
      category: h.categoryLabel,
      heuristic: h.heuristic,
      size: h.size,
      fields: Object.fromEntries(h.fields),
      notes: h.notes
    })),
    capped: truncated,
    entropy: entropy ? { ...entropySummary(entropy), highRegions: highEntropyRegions(entropy).map((r) => ({ start: r.start, end: r.end, meanEntropy: +r.meanEntropy.toFixed(3) })) } : null,
    strings: strings ? { count: strings.count, truncated: strings.truncated, minLength: strings.minLength } : null
  };
}

/** Markdown rendering of buildReport() output. */
export function reportToMarkdown(report) {
  const lines = [];
  lines.push(`# Firmware analysis: ${report.file.name}`, '');
  lines.push(`- File size: ${report.file.size} bytes`);
  if (report.file.hash) lines.push(`- ${report.file.hash.algorithm}: ${report.file.hash.hex}`);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Tool: ${report.tool} v${report.version} (offline, client-side)`, '');
  lines.push('## Signatures', '');
  if (report.signatures.length === 0) {
    lines.push('No signatures matched.', '');
  } else {
    lines.push('| Offset | Type | Size | Details |', '| --- | --- | --- | --- |');
    for (const s of report.signatures) {
      const details = Object.entries(s.fields).map(([k, v]) => `${k}: ${v}`).join('; ').replace(/\|/g, '\\|');
      const flag = s.heuristic ? ' (heuristic)' : '';
      lines.push(`| ${s.offsetHex} | ${s.name}${flag} | ${s.size ?? '-'} | ${details} |`);
    }
    lines.push('');
  }
  for (const s of report.signatures) {
    if (s.notes.length) lines.push(`- ${s.offsetHex} ${s.name}: ${s.notes.join(' ')}`);
  }
  if (report.capped.length) {
    lines.push('', `Signatures stopped at their hit cap: ${report.capped.map((c) => `${c.name} (${c.limit})`).join(', ')}.`);
  }
  if (report.entropy) {
    const e = report.entropy;
    lines.push('', '## Entropy', '');
    lines.push(`Block size ${e.blockSize} bytes, ${e.blocks} blocks. Min ${e.min}, max ${e.max}, mean ${e.mean} bits/byte. ${e.highBlocks} block(s) at or above ${HIGH_ENTROPY} (likely compressed or encrypted).`);
    for (const r of e.highRegions) lines.push(`- High-entropy region ${hexOff(r.start)} to ${hexOff(r.end)} (mean ${r.meanEntropy})`);
  }
  if (report.strings) {
    lines.push('', '## Strings', '');
    lines.push(`${report.strings.count} string(s) of at least ${report.strings.minLength} characters${report.strings.truncated ? ' (list truncated)' : ''}.`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Hex string for display, e.g. "0x0000A0". */
export const formatOffset = (n) => `0x${n.toString(16).toUpperCase()}`;
