/**
 * imaging.js — read a range of sectors once, in order, hashing it (MD5, SHA-1,
 * SHA-256) and optionally streaming it to a writer. Used for imaging a drive,
 * for hashing an opened image file (no writer), and for the optional verify pass.
 *
 * By default the first read error stops the job. With `continueOnError` it
 * behaves like `ddrescue`'s first pass: the failing chunk is re-read sector by
 * sector (each sector retried, with an optional `recover()` hook such as a BOT
 * reset between tries), unreadable sectors are zero-filled so the image keeps
 * its full length and offsets, and every bad range is logged. After a run of
 * consecutive bad sectors it backs off and skips ahead (doubling) so a dead
 * region does not take hours; skipped ranges are zero-filled and flagged
 * `skipped: true` because they were never actually tried.
 */
import { MultiHasher } from './streamHash';

export async function imageRange({
  readSectors, startLba, sectors, blockSize = 512, write = null, hasher = new MultiHasher(),
  chunkSectors = 128, continueOnError = false, retries = 1, skipAfter = 16, maxSkip = 8192,
  byteLength = null, recover = null, onProgress = () => {}, shouldCancel = () => false
}) {
  const end = startLba + sectors;
  const limit = byteLength ?? sectors * blockSize; // an image file need not end on a sector boundary
  const badRanges = [];
  let bytes = 0;
  let badSectors = 0;
  let degraded = false;
  let goodRun = 0;
  let consecutiveBad = 0;
  let skip = 0;
  let lba = startLba;
  let lastReport = -1;

  const emit = async (data) => {
    if (bytes + data.length > limit) data = data.subarray(0, Math.max(0, limit - bytes));
    if (!data.length) return;
    hasher.update(data);
    if (write) await write(data);
    bytes += data.length;
  };
  const markBad = (at, n, err, skipped = false) => {
    badSectors += n;
    const last = badRanges[badRanges.length - 1];
    if (last && !!last.skipped === skipped && last.startLba + last.sectors === at) last.sectors += n;
    else badRanges.push({ startLba: at, sectors: n, skipped, error: err?.message || String(err) });
  };
  const readChecked = async (at, n) => {
    const data = await readSectors(at, n);
    if (!data || data.length !== n * blockSize) throw new Error(`Short read at LBA ${at} (${data ? data.length : 0} of ${n * blockSize} bytes).`);
    return data;
  };

  while (lba < end) {
    if (shouldCancel()) throw new Error('Imaging cancelled.');
    if (!degraded) {
      const n = Math.min(chunkSectors, end - lba);
      try {
        await emit(await readChecked(lba, n));
        lba += n;
      } catch (e) {
        if (!continueOnError) throw e;
        degraded = true; goodRun = 0;
        if (recover) { try { await recover(); } catch (x) { /* best effort */ } }
      }
    } else {
      let data = null;
      let err = null;
      for (let attempt = 0; attempt <= retries && !data; attempt++) {
        try { data = await readChecked(lba, 1); } catch (e) {
          err = e;
          if (recover) { try { await recover(); } catch (x) { /* best effort */ } }
        }
      }
      if (data) {
        await emit(data);
        lba += 1; consecutiveBad = 0; skip = 0;
        if (++goodRun >= chunkSectors) degraded = false;
      } else {
        goodRun = 0;
        markBad(lba, 1, err);
        await emit(new Uint8Array(blockSize));
        lba += 1; consecutiveBad += 1;
        if (consecutiveBad >= skipAfter && lba < end) {
          skip = Math.min(maxSkip, Math.max(skip * 2, 64));
          const n = Math.min(skip, end - lba);
          markBad(lba, n, new Error('skipped without reading after repeated errors'), true);
          for (let done = 0; done < n; done += chunkSectors) await emit(new Uint8Array(Math.min(chunkSectors, n - done) * blockSize));
          lba += n;
        }
      }
    }
    if (lba - lastReport >= chunkSectors * 16 || lba >= end) {
      lastReport = lba;
      onProgress({ done: bytes, badSectors });
    }
  }
  return { hashes: hasher.hex(), bytes, badRanges, badSectors };
}

/** Re-read the same range (no writer) and compare SHA-256 with the first pass. */
export async function verifyRange(options, expectedSha256) {
  const r = await imageRange({ ...options, write: null, hasher: new MultiHasher() });
  return { ok: r.hashes.sha256 === expectedSha256, hashes: r.hashes, badRanges: r.badRanges };
}

/** Summarise bad ranges into `cells` buckets across the imaged range (for a coverage strip). */
export function badSectorMap(badRanges, startLba, sectors, cells = 100) {
  const n = Math.max(1, Math.min(cells, sectors));
  const out = Array.from({ length: n }, () => ({ bad: 0, skipped: 0 }));
  for (const r of badRanges) {
    const a = Math.max(r.startLba, startLba);
    const b = Math.min(r.startLba + r.sectors, startLba + sectors);
    for (let c = Math.floor(((a - startLba) / sectors) * n); c < n && b > a; c++) {
      const cs = startLba + (c * sectors) / n;
      const ce = startLba + ((c + 1) * sectors) / n;
      const overlap = Math.min(b, ce) - Math.max(a, cs);
      if (overlap > 0) out[c][r.skipped ? 'skipped' : 'bad'] += overlap;
      if (ce >= b) break;
    }
  }
  return out;
}

/** Plain-text error log: one line per unreadable range, plus the hashes of the image as written. */
export function formatImageLog({ name, startLba, sectors, blockSize, hashes, badRanges }) {
  const lines = [
    `Image: ${name}`,
    `Range: LBA ${startLba} + ${sectors} sectors (${blockSize}-byte blocks), ${sectors * blockSize} bytes`,
    `MD5:     ${hashes.md5}`,
    `SHA-1:   ${hashes.sha1}`,
    `SHA-256: ${hashes.sha256}`,
    `Unreadable ranges: ${badRanges.length}`
  ];
  for (const r of badRanges) {
    lines.push(`  LBA ${r.startLba}-${r.startLba + r.sectors - 1} (${r.sectors} sectors, byte offset ${(r.startLba - startLba) * blockSize})${r.skipped ? ' SKIPPED, not read' : ' read error'}: ${r.error}`);
  }
  if (badRanges.length) lines.push('Unreadable and skipped sectors are zero-filled in the image.');
  return lines.join('\n');
}
