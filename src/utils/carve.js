/**
 * carve.js — read-only signature file carving over a disk image (or a drive
 * through the same `read(offset, length)` function): JPEG, PNG, GIF, PDF,
 * ZIP / Office Open XML, SQLite and MP4 / MOV.
 *
 * Carving finds files by their content, not by a directory entry, so it also
 * finds files whose filesystem metadata is gone (deleted, formatted, damaged).
 * It reads sequentially and never writes.
 *
 * Where the format records its own length (PNG chunks, GIF blocks, JPEG
 * segments, ZIP central directory, SQLite header, MP4 boxes) that length is
 * used, which is more reliable than "first footer found". Hits are only
 * accepted at multiples of `align` (default 512, the sector size) because files
 * start on sector boundaries; this removes most false positives. A hit whose
 * end cannot be found within the size cap or the scanned range is dropped
 * unless `includeUnterminated` is set (then it is flagged `truncated`).
 *
 * Limits worth knowing: fragmented files are carved only as far as their first
 * contiguous run is intact; PDFs with incremental updates are followed while
 * the next bytes look like another object/xref section.
 */

const MB = 1024 * 1024;
const be16 = (b, o) => (b[o] << 8) | b[o + 1];
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const bytesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));
const matchAt = (buf, pos, sig) => { for (let i = 0; i < sig.length; i++) if (buf[pos + i] !== sig[i]) return false; return true; };

/** Random-access window over `read`, with a sync accessor after an async ensure(). */
function makeCursor(read, limit, size = 256 * 1024) {
  let base = 0;
  let buf = new Uint8Array(0);
  return {
    async ensure(off, n = 1) {
      if (off + n > limit) return false;
      if (off < base || off + n > base + buf.length) {
        base = off;
        buf = await read(off, Math.min(Math.max(size, n), limit - off));
      }
      return off + n <= base + buf.length;
    },
    get(off) { return buf[off - base]; },
    /** Last offset that can be read without another ensure(). */
    get end() { return base + buf.length; }
  };
}

async function measureJpeg(read, off, limit) {
  const c = makeCursor(read, limit);
  let p = off + 2;
  for (;;) {
    if (!await c.ensure(p, 2)) return null;
    if (c.get(p) !== 0xff) return null;
    let m = c.get(p + 1);
    while (m === 0xff) { p++; if (!await c.ensure(p, 2)) return null; m = c.get(p + 1); }
    if (m === 0xd9) return p + 2 - off;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8) || m === 0x00) { p += 2; continue; }
    if (!await c.ensure(p, 4)) return null;
    const len = be16({ 0: c.get(p + 2), 1: c.get(p + 3) }, 0);
    if (len < 2) return null;
    p += 2 + len;
    if (m === 0xda) {
      // Entropy-coded scan data: runs to the next real marker.
      let q = p;
      for (;;) {
        if (!await c.ensure(q, 2)) return null;
        const stop = c.end - 1;
        let found = false;
        while (q < stop) {
          if (c.get(q) === 0xff) {
            const n = c.get(q + 1);
            if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { q += 2; continue; }
            if (n === 0xff) { q += 1; continue; }
            found = true; break;
          }
          q++;
        }
        if (found) break;
      }
      p = q;
    }
  }
}

async function measurePng(read, off, limit, maxSize) {
  const c = makeCursor(read, limit, 64 * 1024);
  let p = off + 8;
  for (;;) {
    if (!await c.ensure(p, 12)) return null;
    const len = be32({ 0: c.get(p), 1: c.get(p + 1), 2: c.get(p + 2), 3: c.get(p + 3) }, 0);
    const type = String.fromCharCode(c.get(p + 4), c.get(p + 5), c.get(p + 6), c.get(p + 7));
    if (!/^[A-Za-z]{4}$/.test(type) || len > 0x7fffffff) return null;
    p += 12 + len;
    if (p - off > maxSize) return null;
    if (type === 'IEND') return p - off;
  }
}

async function measureGif(read, off, limit) {
  const c = makeCursor(read, limit, 64 * 1024);
  if (!await c.ensure(off, 13)) return null;
  let p = off + 13;
  const flags = c.get(off + 10);
  if (flags & 0x80) p += 3 * 2 ** ((flags & 7) + 1);
  const skipSubBlocks = async () => {
    for (;;) {
      if (!await c.ensure(p, 1)) return false;
      const n = c.get(p);
      p += 1 + n;
      if (n === 0) return true;
    }
  };
  for (;;) {
    if (!await c.ensure(p, 1)) return null;
    const b = c.get(p);
    if (b === 0x3b) return p + 1 - off;
    if (b === 0x21) { p += 2; if (!await skipSubBlocks()) return null; continue; }
    if (b === 0x2c) {
      if (!await c.ensure(p, 10)) return null;
      const f = c.get(p + 9);
      p += 10;
      if (f & 0x80) p += 3 * 2 ** ((f & 7) + 1);
      p += 1; // LZW minimum code size
      if (!await skipSubBlocks()) return null;
      continue;
    }
    return null;
  }
}

async function measurePdf(read, off, limit, maxSize) {
  const eof = bytesOf('%%EOF');
  const cap = Math.min(limit, off + maxSize);
  let p = off + 8;
  const piece = 1 * MB;
  while (p < cap) {
    const buf = await read(p, Math.min(piece + eof.length, cap - p));
    let hit = -1;
    for (let i = 0; i + eof.length <= buf.length; i++) {
      if (buf[i] === 0x25 && matchAt(buf, i, eof)) { hit = i; break; }
    }
    if (hit < 0) { p += piece; continue; }
    const end = p + hit + eof.length;
    // Another section follows (linearized file or incremental update)?
    const tail = await read(end, Math.min(24, limit - end));
    let k = 0;
    while (k < tail.length && (tail[k] === 0x0d || tail[k] === 0x0a || tail[k] === 0x20)) k++;
    const rest = String.fromCharCode(...tail.subarray(k));
    if (/^(\d+ \d+ obj|xref)/.test(rest)) { p = end; continue; }
    return end - off;
  }
  return null;
}

async function measureZip(read, off, limit, maxSize) {
  const eocd = bytesOf('PK\x05\x06');
  const cap = Math.min(limit, off + maxSize);
  let p = off + 30;
  const piece = 1 * MB;
  while (p < cap) {
    const buf = await read(p, Math.min(piece + 22, cap - p));
    for (let i = 0; i + 22 <= buf.length; i++) {
      if (buf[i] !== 0x50 || !matchAt(buf, i, eocd)) continue;
      const at = p + i;
      const cdSize = ((buf[i + 12]) | (buf[i + 13] << 8) | (buf[i + 14] << 16) | (buf[i + 15] << 24)) >>> 0;
      const cdOff = ((buf[i + 16]) | (buf[i + 17] << 8) | (buf[i + 18] << 16) | (buf[i + 19] << 24)) >>> 0;
      const comment = buf[i + 20] | (buf[i + 21] << 8);
      if (off + cdOff + cdSize !== at) continue; // an EOCD of something nested, not ours
      const length = at + 22 + comment - off;
      if (off + length > limit) return null;
      let ext = 'zip'; let label = 'ZIP';
      if (cdSize <= 4 * MB) {
        const cd = await read(off + cdOff, cdSize);
        const s = String.fromCharCode(...cd.subarray(0, Math.min(cd.length, 65536)).map((x) => (x >= 32 && x < 127 ? x : 32)));
        if (/\bword\//.test(s)) { ext = 'docx'; label = 'Word document (OOXML)'; }
        else if (/\bxl\//.test(s)) { ext = 'xlsx'; label = 'Excel workbook (OOXML)'; }
        else if (/\bppt\//.test(s)) { ext = 'pptx'; label = 'PowerPoint (OOXML)'; }
        else if (/AndroidManifest\.xml/.test(s)) { ext = 'apk'; label = 'Android package (ZIP)'; }
        else if (/META-INF\/MANIFEST\.MF/.test(s)) { ext = 'jar'; label = 'Java archive (ZIP)'; }
      }
      return { length, ext, label };
    }
    p += piece;
  }
  return null;
}

async function measureSqlite(read, off, limit) {
  const h = await read(off, 100);
  let pageSize = be16(h, 16);
  if (pageSize === 1) pageSize = 65536;
  const pages = be32(h, 28);
  if (pageSize < 512 || (pageSize & (pageSize - 1)) !== 0 || !pages) return null;
  const length = pageSize * pages;
  return off + length > limit ? null : length;
}

const MP4_BOXES = new Set(['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide', 'uuid', 'pnot', 'mfra', 'moof', 'styp', 'sidx', 'meta', 'pdin']);
async function measureMp4(read, off, limit) {
  const c = makeCursor(read, limit, 64 * 1024);
  let p = off;
  let seenData = false;
  for (;;) {
    if (!await c.ensure(p, 16)) break;
    const g = (o) => c.get(p + o);
    let size = be32({ 0: g(0), 1: g(1), 2: g(2), 3: g(3) }, 0);
    const type = String.fromCharCode(g(4), g(5), g(6), g(7));
    if (!MP4_BOXES.has(type)) break;
    if (p === off && type !== 'ftyp') return null;
    if (size === 1) size = be32({ 0: g(8), 1: g(9), 2: g(10), 3: g(11) }, 0) * 2 ** 32 + be32({ 0: g(12), 1: g(13), 2: g(14), 3: g(15) }, 0);
    if (size === 0 || size < 8) break; // "to end of file" has no recoverable length
    if (type === 'moov' || type === 'mdat') seenData = true;
    p += size;
  }
  if (!seenData || p <= off) return null;
  return p > limit ? null : p - off;
}

export const SIGNATURES = [
  { id: 'jpeg', label: 'JPEG image', ext: 'jpg', mime: 'image/jpeg', magic: { offset: 0, bytes: [0xff, 0xd8, 0xff] }, check: (b, i) => [0xe0, 0xe1, 0xe2, 0xdb, 0xee, 0xfe, 0xc0, 0xc4].includes(b[i + 3]), maxSize: 64 * MB, measure: (r, o, l) => measureJpeg(r, o, l) },
  { id: 'png', label: 'PNG image', ext: 'png', mime: 'image/png', magic: { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, maxSize: 64 * MB, measure: measurePng },
  { id: 'gif', label: 'GIF image', ext: 'gif', mime: 'image/gif', magic: { offset: 0, bytes: bytesOf('GIF8') }, check: (b, i) => (b[i + 4] === 0x37 || b[i + 4] === 0x39) && b[i + 5] === 0x61, maxSize: 64 * MB, measure: (r, o, l) => measureGif(r, o, l) },
  { id: 'pdf', label: 'PDF document', ext: 'pdf', mime: 'application/pdf', magic: { offset: 0, bytes: bytesOf('%PDF-1') }, maxSize: 256 * MB, measure: measurePdf },
  { id: 'zip', label: 'ZIP archive / Office document', ext: 'zip', mime: 'application/zip', magic: { offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] }, maxSize: 512 * MB, measure: measureZip },
  { id: 'sqlite', label: 'SQLite database', ext: 'sqlite', mime: 'application/vnd.sqlite3', magic: { offset: 0, bytes: bytesOf('SQLite format 3\0') }, maxSize: 2 * 1024 * MB, measure: (r, o, l) => measureSqlite(r, o, l) },
  { id: 'mp4', label: 'MP4 / MOV video', ext: 'mp4', mime: 'video/mp4', magic: { offset: 4, bytes: bytesOf('ftyp') }, maxSize: 4 * 1024 * MB, measure: (r, o, l) => measureMp4(r, o, l) }
];

/**
 * Scan for files. `read(offset, length)` is any disk reader; `totalBytes` is its size.
 * options: { types, ranges: [{ start, length }], align = 512, chunkBytes = 4 MB,
 *   maxResults = 5000, includeUnterminated = false, onProgress({ done, total }), shouldCancel() }
 * Returns { files: [{ type, label, ext, mime, offset, length, truncated? }], scannedBytes, cancelled }.
 */
export async function carve(read, totalBytes, {
  types = null, ranges = null, align = 512, chunkBytes = 4 * MB, maxResults = 5000,
  includeUnterminated = false, onProgress = () => {}, shouldCancel = () => false
} = {}) {
  const sigs = SIGNATURES.filter((s) => !types || types.includes(s.id));
  const scan = (ranges && ranges.length ? ranges : [{ start: 0, length: totalBytes }])
    .map((r) => ({ start: r.start, end: Math.min(totalBytes, r.start + r.length) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const work = scan.reduce((n, r) => n + (r.end - r.start), 0);
  const files = [];
  let done = 0;
  let nextAllowed = 0;
  let cancelled = false;
  const overlap = 32;
  outer:
  for (const range of scan) {
    for (let pos = range.start; pos < range.end; pos += chunkBytes) {
      if (shouldCancel()) { cancelled = true; break outer; }
      const scanEnd = Math.min(range.end, pos + chunkBytes);
      const buf = await read(pos, Math.min(totalBytes - pos, scanEnd - pos + overlap));
      const first = Math.ceil(pos / align) * align;
      for (let abs = first; abs < scanEnd; abs += align) {
        if (abs < nextAllowed) continue;
        const i = abs - pos;
        for (const sig of sigs) {
          const mo = i + sig.magic.offset;
          if (mo + sig.magic.bytes.length > buf.length || !matchAt(buf, mo, sig.magic.bytes)) continue;
          if (sig.check && !sig.check(buf, i)) continue;
          const limit = range.end;
          let m = await sig.measure(read, abs, limit, sig.maxSize);
          let truncated = false;
          if (m === null && includeUnterminated) {
            m = Math.min(sig.maxSize, limit - abs);
            truncated = true;
          }
          if (m === null) continue;
          const info = typeof m === 'number' ? { length: m } : m;
          if (info.length <= 0 || info.length > sig.maxSize) continue;
          files.push({
            type: sig.id, label: info.label || sig.label, ext: info.ext || sig.ext, mime: sig.mime,
            offset: abs, length: info.length, ...(truncated ? { truncated: true } : {})
          });
          nextAllowed = abs + info.length;
          break;
        }
        if (files.length >= maxResults) break outer;
      }
      done += scanEnd - pos;
      onProgress({ done, total: work });
    }
  }
  return { files, scannedBytes: done, cancelled };
}
