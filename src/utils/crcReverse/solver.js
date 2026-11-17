/**
 * CRC reverse-engineering solver.
 *
 * Input: samples, each a payload (Uint8Array) plus the checksum bytes stored after it.
 *
 * Stages (all results are verified against every sample before being reported):
 *  1. Catalogue: every RevEng model whose check matches all samples.
 *  2. Simple sums: Sum-8/16, XOR-8, LRC, Fletcher-16/32, Adler-32, Internet checksum.
 *  3. Brute force, width 8 and 16 (odd polys only): differential method. XOR of two equal-length
 *     payloads cancels init and xorout, leaving CRC(d) = c1 XOR c2, which is linear in d. That filters
 *     the poly x refin x refout space cheaply. Survivors get init/xorout solved by GF(2) elimination.
 *  4. Width 32: known polys x refin x refout, init/xorout solved the same way.
 *
 * Why init and xorout need different payload lengths: for equal-length payloads, init only enters
 * through H_n(init) XOR xorout, so only that combination is determined. Samples of different lengths
 * separate them. The solver reports `determined: false` when the samples leave a free bit.
 */
import { CRC_CATALOGUE } from './catalogue.js';
import { crcNum, crcOf, bigModel, hexOf, residueOf } from './engine.js';
import { SIMPLE_SUMS } from './sums.js';

export const CHECK_BYTES = new TextEncoder().encode('123456789');

/** Known 32-bit polynomials (normal form) tried with solved init/xorout. */
export const KNOWN_POLYS_32 = Object.freeze([
  0x04c11db7, // CRC-32 (IEEE 802.3, ISO-HDLC, BZIP2, MPEG-2, JAMCRC)
  0x1edc6f41, // CRC-32C (Castagnoli, iSCSI)
  0xa833982b, // CRC-32D / BASE91-D
  0x814141ab, // CRC-32Q / AIXM
  0xf4acfb13, // CRC-32/AUTOSAR
  0x741b8cd7, // CRC-32/MEF
  0x000000af, // CRC-32/XFER
  0x8001801b, // CRC-32/CD-ROM-EDC
]);

const sleep0 = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Checksum integers for each sample under a byte order.
 * @param {Array<{payload: Uint8Array, checksum: Uint8Array}>} samples
 * @param {'be'|'le'} order how the stored checksum bytes map to an integer
 */
export function prepareSamples(samples, order = 'be') {
  return samples.map((s) => {
    const cs = order === 'le' ? Uint8Array.from(s.checksum).reverse() : s.checksum;
    let v = 0n;
    for (const b of cs) v = (v << 8n) | BigInt(b);
    return { payload: s.payload, valueBig: v, valueNum: v <= 0xffffffffn ? Number(v) : null };
  });
}

/**
 * Gaussian elimination over GF(2). rows[i] is a BigInt bitmask over nVars variables; bit nVars is the rhs.
 * Returns null if inconsistent, else { x, determined } with free variables set to 0.
 */
export function gf2Solve(rows, nVars) {
  const A = rows.slice();
  const pivotRow = new Array(nVars).fill(-1);
  let r = 0;
  for (let col = 0; col < nVars; col++) {
    const bit = 1n << BigInt(col);
    let k = -1;
    for (let i = r; i < A.length; i++) {
      if (A[i] & bit) {
        k = i;
        break;
      }
    }
    if (k < 0) continue;
    const tmp = A[r];
    A[r] = A[k];
    A[k] = tmp;
    for (let i = 0; i < A.length; i++) {
      if (i !== r && (A[i] & bit)) A[i] ^= A[r];
    }
    pivotRow[col] = r;
    r++;
  }
  const rhs = 1n << BigInt(nVars);
  for (let i = r; i < A.length; i++) {
    if (A[i] & rhs) return null;
  }
  const x = new Array(nVars).fill(0);
  let determined = true;
  for (let col = 0; col < nVars; col++) {
    if (pivotRow[col] < 0) {
      determined = false;
      continue;
    }
    x[col] = A[pivotRow[col]] & rhs ? 1 : 0;
  }
  return { x, determined };
}

/**
 * Solve init and xorout for a fixed poly/refin/refout (width <= 32, numeric fields).
 * Uses CRC(m, init, xo) = CRC(m, 0, 0) XOR H_n(init) XOR xo, where H_n is linear in init.
 * @returns {{init:number, xorout:number, determined:boolean}|null}
 */
export function solveInitXorout(prep, m) {
  const w = m.width;
  const colsByLen = new Map();
  const rows = [];
  for (const s of prep) {
    const n = s.payload.length;
    let cols = colsByLen.get(n);
    if (!cols) {
      const zeros = new Uint8Array(n);
      cols = [];
      for (let j = 0; j < w; j++) cols.push(crcNum(zeros, { ...m, init: 2 ** j, xorout: 0 }));
      colsByLen.set(n, cols);
    }
    const g = crcNum(s.payload, { ...m, init: 0, xorout: 0 });
    const diff = (s.valueNum ^ g) >>> 0;
    for (let b = 0; b < w; b++) {
      let row = 0n;
      for (let j = 0; j < w; j++) {
        if ((cols[j] >>> b) & 1) row |= 1n << BigInt(j);
      }
      row |= 1n << BigInt(w + b);
      if ((diff >>> b) & 1) row |= 1n << BigInt(2 * w);
      rows.push(row);
    }
  }
  const sol = gf2Solve(rows, 2 * w);
  if (!sol) return null;
  let init = 0;
  let xorout = 0;
  for (let j = 0; j < w; j++) if (sol.x[j]) init += 2 ** j;
  for (let b = 0; b < w; b++) if (sol.x[w + b]) xorout += 2 ** b;
  return { init, xorout, determined: sol.determined };
}

/** True if the numeric model reproduces every sample's checksum exactly. */
export function verifyNum(prep, m) {
  return prep.every((s) => s.valueNum !== null && crcNum(s.payload, m) === s.valueNum);
}

/** Pairs of equal-length payloads, as (XOR of payloads, XOR of checksums). */
export function differentialPairs(prep) {
  const byLen = new Map();
  prep.forEach((s, i) => {
    const k = s.payload.length;
    if (!byLen.has(k)) byLen.set(k, []);
    byLen.get(k).push(i);
  });
  const pairs = [];
  for (const idx of byLen.values()) {
    if (idx.length < 2) continue;
    const ref = prep[idx[0]];
    for (const j of idx.slice(1)) {
      const other = prep[j];
      const d = new Uint8Array(ref.payload.length);
      for (let k = 0; k < d.length; k++) d[k] = ref.payload[k] ^ other.payload[k];
      pairs.push({ d, t: (ref.valueNum ^ other.valueNum) >>> 0 });
    }
  }
  return pairs;
}

/** Yield to the UI, report progress, and say whether the user cancelled. */
async function checkpoint(ctl, stage, done, total) {
  ctl.onProgress?.({ stage, done, total });
  await sleep0();
  return !!ctl.isCancelled?.();
}

/** Brute force over odd polys for one width. Pushes {m, determined} into `out`. Returns 'cancelled' or 'done'. */
async function bruteWidth(prep, width, ctl, out) {
  const pairs = differentialPairs(prep);
  const polyCount = 2 ** (width - 1);
  const total = polyCount * 4;
  let done = 0;
  const combos = [
    [false, false],
    [false, true],
    [true, false],
    [true, true],
  ];
  for (let poly = 1; poly < 2 ** width; poly += 2) {
    for (const [refin, refout] of combos) {
      done++;
      const base = { width, poly, refin, refout };
      if (pairs.length && !pairs.every(({ d, t }) => crcNum(d, { ...base, init: 0, xorout: 0 }) === t)) continue;
      const sol = solveInitXorout(prep, base);
      if (!sol) continue;
      const m = { ...base, init: sol.init, xorout: sol.xorout };
      if (verifyNum(prep, m)) out.push({ m, determined: sol.determined });
    }
    if (poly % 512 === 1 && (await checkpoint(ctl, `brute-${width}`, done, total))) return 'cancelled';
  }
  return 'done';
}

/** Width 32: known polys x refin x refout with solved init/xorout. */
async function knownPolys32(prep, ctl, out) {
  const total = KNOWN_POLYS_32.length * 4;
  let done = 0;
  for (const poly of KNOWN_POLYS_32) {
    for (const refin of [false, true]) {
      for (const refout of [false, true]) {
        done++;
        const base = { width: 32, poly, refin, refout };
        const sol = solveInitXorout(prep, base);
        if (!sol) continue;
        const m = { ...base, init: sol.init, xorout: sol.xorout };
        if (verifyNum(prep, m)) out.push({ m, determined: sol.determined });
      }
    }
    if (await checkpoint(ctl, 'known-32', done, total)) return 'cancelled';
  }
  return 'done';
}

/** Name of a catalogue entry with identical parameters, or undefined. */
function catalogueNameFor(m) {
  const bm = bigModel(m);
  return CRC_CATALOGUE.find(
    (c) =>
      c.width === bm.width && c.poly === bm.poly && c.init === bm.init &&
      c.refin === bm.refin && c.refout === bm.refout && c.xorout === bm.xorout,
  )?.name;
}

/** RevEng-style parameter string for a model (BigInt or Number fields). */
export function revengString(m, name) {
  const bm = bigModel(m);
  const w = bm.width;
  const hex = (v) => `0x${hexOf(v, w)}`;
  const check = crcOf(CHECK_BYTES, bm);
  const parts = [
    `width=${w}`,
    `poly=${hex(bm.poly)}`,
    `init=${hex(bm.init)}`,
    `refin=${bm.refin}`,
    `refout=${bm.refout}`,
    `xorout=${hex(bm.xorout)}`,
    `check=${hex(check)}`,
  ];
  const residue = residueOf(CHECK_BYTES, bm);
  if (residue !== null) parts.push(`residue=${hex(residue)}`);
  if (name) parts.push(`name="${name}"`);
  return parts.join(' ');
}

function candidateFromNumeric(found, order, source) {
  const m = found.m;
  const name = catalogueNameFor(m);
  return {
    source,
    name: name || null,
    byteOrder: order,
    width: m.width,
    poly: BigInt(m.poly),
    init: BigInt(m.init),
    refin: m.refin,
    refout: m.refout,
    xorout: BigInt(m.xorout),
    determined: found.determined,
    revEng: revengString({ ...m, poly: BigInt(m.poly), init: BigInt(m.init), xorout: BigInt(m.xorout) }, name),
  };
}

function candidateFromCatalogue(entry, order) {
  return {
    source: 'catalogue',
    name: entry.name,
    byteOrder: order,
    width: entry.width,
    poly: entry.poly,
    init: entry.init,
    refin: entry.refin,
    refout: entry.refout,
    xorout: entry.xorout,
    determined: true,
    revEng: revengString(entry, entry.name),
  };
}

/**
 * Run every stage. Returns { candidates, notes, cancelled }.
 * @param {Array<{payload: Uint8Array, checksum: Uint8Array}>} samples
 * @param {object} opts
 * @param {Array<'be'|'le'>} [opts.orders=['be']] checksum byte orders to try
 * @param {number[]} [opts.bruteWidths=[8,16]]
 * @param {boolean} [opts.known32=true]
 * @param {function} [opts.onProgress] called with {stage, done, total}
 * @param {function} [opts.isCancelled] polled between chunks
 */
export async function reverseCrc(samples, opts = {}) {
  const ctl = { onProgress: opts.onProgress, isCancelled: opts.isCancelled };
  const orders = opts.orders?.length ? opts.orders : ['be'];
  const bruteWidths = opts.bruteWidths ?? [8, 16];
  const candidates = [];
  const notes = [];
  if (!samples.length) return { candidates, notes: ['No samples.'], cancelled: false };
  const size = samples[0].checksum.length;
  if (samples.some((s) => s.checksum.length !== size)) {
    return { candidates, notes: ['Checksum field must have the same length in every sample.'], cancelled: false };
  }
  const fieldBits = size * 8;
  const seen = new Set();
  const push = (c) => {
    const key = `${c.byteOrder}|${c.source}|${c.name || ''}|${c.width}|${c.poly}|${c.init}|${c.refin}|${c.refout}|${c.xorout}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };
  const sizeNote = `Checksum field: ${size} byte(s).`;
  if (samples.length < 2) notes.push('Only one sample: brute-force search and init/xorout solving need at least 2 samples.');

  for (const order of orders) {
    const prep = prepareSamples(samples, order);

    // 1. Catalogue
    let idx = 0;
    for (const entry of CRC_CATALOGUE) {
      if (entry.width > fieldBits) continue;
      idx++;
      if (idx % 16 === 0 && (await checkpoint(ctl, 'catalogue', idx, CRC_CATALOGUE.length))) return { candidates, notes, cancelled: true };
      const ok = prep.every((s) => !(s.valueBig >> BigInt(entry.width)) && crcOf(s.payload, entry) === s.valueBig);
      if (ok) push(candidateFromCatalogue(entry, order));
    }

    // 2. Simple sums
    for (const sum of SIMPLE_SUMS) {
      if (sum.width > fieldBits) continue;
      if (prep.every((s) => BigInt(sum.fn(s.payload)) === s.valueBig)) {
        push({ source: 'sum', name: sum.name, byteOrder: order, width: sum.width });
      }
    }

    // 3. Brute force 8 / 16 (differential method)
    if (samples.length >= 2) {
      for (const w of bruteWidths) {
        if (w > fieldBits) {
          notes.push(`Width ${w} skipped: checksum field is ${size} byte(s).`);
          continue;
        }
        if (prep.some((s) => s.valueNum === null || s.valueNum >= 2 ** w)) {
          notes.push(`Width ${w} skipped (${order}): a checksum value does not fit in ${w} bits.`);
          continue;
        }
        if (w > 8 && differentialPairs(prep).length === 0) {
          notes.push(`Width ${w} skipped: the differential method needs two samples with equal payload length.`);
          continue;
        }
        const out = [];
        if ((await bruteWidth(prep, w, ctl, out)) === 'cancelled') return { candidates, notes, cancelled: true };
        for (const f of out) push(candidateFromNumeric(f, order, 'brute'));
      }
    }

    // 4. Width 32, known polys
    if (opts.known32 !== false && samples.length >= 2 && fieldBits >= 32 && prep.every((s) => s.valueNum !== null)) {
      const out = [];
      if ((await knownPolys32(prep, ctl, out)) === 'cancelled') return { candidates, notes, cancelled: true };
      for (const f of out) push(candidateFromNumeric(f, order, 'known-poly'));
    }
  }

  notes.unshift(sizeNote);
  return { candidates, notes, cancelled: false };
}

/**
 * "Where is the CRC": for a frame whose last k bytes are a stored checksum, test every catalogue model
 * and simple sum (width <= 8k) against every payload range [start, L-k).
 * @returns {Promise<{matches: Array, cancelled: boolean}>}
 */
export async function locateCrc(frame, opts = {}) {
  const k = opts.k ?? 2;
  const ctl = { onProgress: opts.onProgress, isCancelled: opts.isCancelled };
  const orders = opts.orders?.length ? opts.orders : ['be', 'le'];
  const L = frame.length;
  if (!(k >= 1 && k <= 8)) throw new Error('Checksum field must be 1 to 8 bytes.');
  if (L <= k) throw new Error(`Frame has ${L} byte(s); it must be longer than the ${k}-byte checksum.`);
  if (L > 1024) throw new Error('Frame is longer than 1024 bytes; cut it down for the range search.');
  const end = L - k;
  const bits = k * 8;
  const models = CRC_CATALOGUE.filter((m) => m.width <= bits);
  const sums = SIMPLE_SUMS.filter((s) => s.width <= bits);
  const stored = {};
  for (const order of orders) {
    const cs = order === 'le' ? frame.subarray(end).slice().reverse() : frame.subarray(end);
    let v = 0n;
    for (const b of cs) v = (v << 8n) | BigInt(b);
    stored[order] = v;
  }
  const matches = [];
  for (let s = 0; s < end; s++) {
    const payload = frame.subarray(s, end);
    for (const order of orders) {
      const v = stored[order];
      for (const m of models) {
        if (crcOf(payload, m) === v) matches.push({ source: 'catalogue', name: m.name, byteOrder: order, start: s, end });
      }
      for (const sum of sums) {
        if (BigInt(sum.fn(payload)) === v) matches.push({ source: 'sum', name: sum.name, byteOrder: order, start: s, end });
      }
    }
    if (s % 16 === 15 && (await checkpoint(ctl, 'locate', s + 1, end))) return { matches, cancelled: true };
  }
  return { matches, cancelled: false };
}
