// Pure helpers for the Mass Storage workbench: hash comparison, byte-pattern search,
// file-listing CSV export and hex dump text. No browser or USB access in here.

const HASH_LENGTHS = { 32: 'md5', 40: 'sha1', 64: 'sha256' };

/**
 * Compare a pasted expected hash against computed hashes ({ md5, sha1, sha256 }).
 * The algorithm is guessed from the digit count. Accepts "sha256: abc...", "abc... *file.img",
 * colons/spaces inside the digits and any letter case.
 * Returns { state: 'empty' | 'invalid' | 'match' | 'mismatch', algo?, expected? }.
 */
export function compareHash(input, hashes) {
  let text = String(input || '').trim();
  if (!text) return { state: 'empty' };
  text = text.replace(/^(md5|sha-?1|sha-?256)\s*[:=(]?\s*/i, '');
  const token = text.split(/\s+/).filter((t) => /^[0-9a-f:]+$/i.test(t)).join('');
  const hex = token.replace(/:/g, '').toLowerCase();
  const algo = HASH_LENGTHS[hex.length];
  if (!algo || !/^[0-9a-f]+$/.test(hex)) return { state: 'invalid' };
  const actual = hashes?.[algo];
  return { state: actual && actual.toLowerCase() === hex ? 'match' : 'mismatch', algo, expected: hex };
}

/**
 * Turn the search box text into bytes. mode 'hex': "55 AA", "55aa", "0x55 0xAA". mode 'text': ASCII/UTF-8.
 * Throws a readable Error for bad input.
 */
export function parseSearchPattern(text, mode) {
  const s = String(text ?? '');
  if (mode === 'text') {
    if (!s) throw new Error('Enter text to search for.');
    return new TextEncoder().encode(s);
  }
  const clean = s.replace(/0x/gi, '').replace(/[\s,:-]+/g, '');
  if (!clean) throw new Error('Enter hex bytes to search for, for example 55 AA.');
  if (!/^[0-9a-f]+$/i.test(clean)) throw new Error('Hex search accepts only 0-9 and A-F.');
  if (clean.length % 2) throw new Error('Hex search needs whole bytes (an even number of digits).');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Index of the first occurrence of `needle` in `hay` at or after `from`, or -1. */
export function indexOfBytes(hay, needle, from = 0) {
  const n = needle.length;
  if (!n) return -1;
  const last = hay.length - n;
  outer: for (let i = Math.max(0, from); i <= last; i++) {
    if (hay[i] !== needle[0]) continue;
    for (let j = 1; j < n; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Search sectors [startLba, startLba + sectors) for a byte pattern, reading in chunks and
 * handling matches that straddle chunk edges. Resolves to { lba, offset, byteOffset } of the
 * first hit (offset is within that sector) or null, plus how far it scanned.
 * readSectors(start, n) -> Uint8Array; shouldCancel() optional; onProgress({ done, total }) optional.
 */
export async function searchSectors({ readSectors, startLba, sectors, blockSize, pattern, chunkSectors = 256, shouldCancel, onProgress }) {
  if (!pattern?.length) throw new Error('Empty search pattern.');
  const keep = pattern.length - 1;
  let tail = new Uint8Array(0);
  let tailStart = startLba * blockSize;
  let scanned = 0;
  for (let done = 0; done < sectors; done += chunkSectors) {
    if (shouldCancel?.()) return { hit: null, scanned, cancelled: true };
    const take = Math.min(chunkSectors, sectors - done);
    const data = await readSectors(startLba + done, take);
    const buf = new Uint8Array(tail.length + data.length);
    buf.set(tail, 0); buf.set(data, tail.length);
    const at = indexOfBytes(buf, pattern, 0);
    if (at >= 0) {
      const byteOffset = tailStart + at;
      return { hit: { lba: Math.floor(byteOffset / blockSize), offset: byteOffset % blockSize, byteOffset }, scanned: scanned + take, cancelled: false };
    }
    const keepLen = Math.min(keep, buf.length);
    tail = buf.slice(buf.length - keepLen);
    tailStart = tailStart + (buf.length - keepLen);
    scanned += take;
    onProgress?.({ done: scanned, total: sectors });
  }
  return { hit: null, scanned, cancelled: false };
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of a directory listing: path, name, type, size, modified (UTC), attributes, deleted. */
export function fileListingCsv(entries, dirPath = '/') {
  const rows = [['path', 'name', 'type', 'size', 'modified_utc', 'attributes', 'deleted']];
  for (const e of entries) {
    const mod = e.modified && !Number.isNaN(e.modified.getTime()) ? e.modified.toISOString().replace('T', ' ').slice(0, 19) : '';
    const attrs = [e.readOnly && 'R', e.hidden && 'H', e.system && 'S'].filter(Boolean).join('');
    rows.push([dirPath, e.name, e.isDir ? 'dir' : 'file', e.isDir ? '' : e.size, mod, attrs, e.deleted ? 'yes' : 'no']);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Classic offset / hex / ASCII dump text (xxd-like). */
export function hexDumpText(data, baseOffset = 0) {
  const lines = [];
  for (let off = 0; off < data.length; off += 16) {
    const slice = data.subarray(off, off + 16);
    const hex = Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const ascii = Array.from(slice).map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${(baseOffset + off).toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  return lines.join('\n') + '\n';
}
