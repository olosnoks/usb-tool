/**
 * Offline ISM (433/868/915 MHz) signal decoder for IQ recordings.
 *
 * Pipeline: read IQ file -> envelope (AM/OOK) or FM discriminator (FSK) ->
 * adaptive per-chunk noise floor and level threshold (with hysteresis) ->
 * ON/OFF runs -> pulse/gap segments in microseconds -> rtl_433 -A style
 * analyzer (width clusters, modulation guess, limits) -> bit rows per
 * modulation -> device decoders from ./ismDecoder/devices.js.
 *
 * Everything here is pure JS and runs without hardware. Nothing is simulated:
 * every result comes from the samples the user loaded.
 */
import { ISM_DEVICES, bitsToHex, invertBits } from './ismDecoder/devices.js';

export { ISM_DEVICES } from './ismDecoder/devices.js';

/** Sample formats. `bps` = bytes per I or Q component. */
export const ISM_FORMATS = {
  cu8: { bps: 1, label: 'RTL-SDR unsigned 8-bit I/Q', read: (dv, o) => (dv.getUint8(o) - 127.5) / 127.5 },
  cs8: { bps: 1, label: 'HackRF signed 8-bit I/Q', read: (dv, o) => dv.getInt8(o) / 128 },
  cs16: { bps: 2, label: 'signed 16-bit little-endian I/Q', read: (dv, o) => dv.getInt16(o, true) / 32768 },
  complex16u: { bps: 2, label: 'unsigned 16-bit little-endian I/Q (centred on 32768)', read: (dv, o) => (dv.getUint16(o, true) - 32768) / 32768 },
  cf32: { bps: 4, label: 'float32 little-endian I/Q', read: (dv, o) => dv.getFloat32(o, true) },
};

/** Upper bound for one analysis; larger files are refused rather than running out of memory. */
export const ISM_MAX_BYTES = 64 * 1024 * 1024;
const MAX_SEGMENTS = 50000;

/** Format from the file extension, or null if unknown. */
export function formatFromFilename(name = '') {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  const ext = m ? m[1].toLowerCase() : '';
  return ISM_FORMATS[ext] ? ext : null;
}

/**
 * Parse rtl_433's capture naming convention, e.g. `g001_433.92M_250k.cu8`:
 * centre frequency in MHz after an underscore, sample rate in k or M after it.
 * Returns { centerFreqHz, sampleRate, format } with nulls for anything not found.
 */
export function parseRtl433Filename(name = '') {
  const base = String(name).split(/[\\/]/).pop();
  const fm = /(?:^|[_\-\s])(\d+(?:\.\d+)?)\s*M(?:Hz)?(?=[_\-\s.]|$)/i.exec(base);
  const centerFreqHz = fm ? Math.round(parseFloat(fm[1]) * 1e6) : null;
  let sampleRate = null;
  const rateRe = /(?:^|[_\-\s])(\d+(?:\.\d+)?)\s*([kKmM])(?:S\/s|sps)?(?=[_\-\s.]|$)/g;
  let rm;
  while ((rm = rateRe.exec(base))) {
    if (fm && rm.index === fm.index) continue;
    const v = parseFloat(rm[1]);
    sampleRate = Math.round(rm[2].toLowerCase() === 'k' ? v * 1e3 : v * 1e6);
    break;
  }
  return { centerFreqHz, sampleRate, format: formatFromFilename(base) };
}

/**
 * Demodulate a whole IQ buffer to one Float32Array per sample.
 *  - mode 'ook': envelope magnitude sqrt(I^2 + Q^2)
 *  - mode 'fsk': FM discriminator angle(x[n] * conj(x[n-1])) in radians/sample
 */
export function demodBuffer(buffer, format, mode = 'ook') {
  const fmt = ISM_FORMATS[format];
  if (!fmt) throw new Error(`Unsupported sample format: ${format}`);
  const dv = new DataView(buffer);
  const stride = fmt.bps * 2;
  const n = Math.floor(buffer.byteLength / stride);
  const out = new Float32Array(n);
  let pI = 0;
  let pQ = 0;
  for (let k = 0; k < n; k++) {
    const o = k * stride;
    const I = fmt.read(dv, o);
    const Q = fmt.read(dv, o + fmt.bps);
    if (mode === 'fsk') {
      out[k] = Math.atan2(Q * pI - I * pQ, I * pI + Q * pQ);
      pI = I;
      pQ = Q;
    } else {
      out[k] = Math.sqrt(I * I + Q * Q);
    }
  }
  return out;
}

/** Boxcar smoothing (centred). Returns a new Float32Array. */
export function boxcar(arr, len) {
  const L = Math.max(1, Math.round(len));
  if (L <= 1) return Float32Array.from(arr);
  const out = new Float32Array(arr.length);
  const half = Math.floor(L / 2);
  let sum = 0;
  let lo = 0;
  let hi = -1;
  for (let i = 0; i < arr.length; i++) {
    const want = Math.min(arr.length - 1, i + half);
    while (hi < want) { hi++; sum += arr[hi]; }
    const from = Math.max(0, i - half);
    while (lo < from) { sum -= arr[lo]; lo++; }
    out[i] = sum / (hi - lo + 1);
  }
  return out;
}

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];

/**
 * Adaptive level per chunk: noise floor = 10th percentile, peak = 98th percentile,
 * threshold = floor + sens * (peak - floor). Chunks are ~50 ms so the floor follows
 * slow drift and fading.
 */
export function adaptiveThresholds(env, sampleRate, sens = 0.5) {
  const chunk = Math.max(2048, Math.round(sampleRate * 0.05));
  const count = Math.max(1, Math.ceil(env.length / chunk));
  const thr = new Float32Array(count);
  const floor = new Float32Array(count);
  const peak = new Float32Array(count);
  const sampleN = 1024;
  for (let c = 0; c < count; c++) {
    const from = c * chunk;
    const to = Math.min(env.length, from + chunk);
    const stride = Math.max(1, Math.floor((to - from) / sampleN));
    const vals = [];
    for (let i = from; i < to; i += stride) vals.push(env[i]);
    vals.sort((a, b) => a - b);
    floor[c] = percentile(vals, 0.1);
    peak[c] = percentile(vals, 0.98);
    thr[c] = floor[c] + sens * (peak[c] - floor[c]);
  }
  return { chunk, thr, floor, peak };
}

/**
 * Binarise the envelope with the per-chunk threshold and a hysteresis band of 10% of
 * (peak - floor). In 'fsk' mode the discriminator sign is the level (mark = 1).
 */
export function binarize(data, mode, levels) {
  const out = new Uint8Array(data.length);
  if (mode === 'fsk') {
    for (let i = 0; i < data.length; i++) out[i] = data[i] > 0 ? 1 : 0;
    return out;
  }
  let state = 0;
  for (let i = 0; i < data.length; i++) {
    const c = Math.min(levels.thr.length - 1, Math.floor(i / levels.chunk));
    const t = levels.thr[c];
    const h = 0.1 * (levels.peak[c] - levels.floor[c]);
    if (!state && data[i] > t + h) state = 1;
    else if (state && data[i] < t - h) state = 0;
    out[i] = state;
  }
  return out;
}

/** Run-length encode a 0/1 level array: [{ level, start, len }] in samples. */
export function runsFromLevels(levels) {
  const runs = [];
  let i = 0;
  while (i < levels.length) {
    const v = levels[i];
    let j = i + 1;
    while (j < levels.length && levels[j] === v) j++;
    runs.push({ level: v, start: i, len: j - i });
    i = j;
  }
  return runs;
}

/**
 * Remove glitches: any run shorter than `minSamples` is absorbed into its neighbours
 * (keeps the level alternation intact).
 */
export function despikeRuns(runs, minSamples) {
  const out = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.level === r.level) { last.len += r.len; continue; }
    out.push({ ...r });
    while (out.length >= 3 && out[out.length - 2].len < minSamples) {
      const a = out[out.length - 3];
      const m = out[out.length - 2];
      const c = out[out.length - 1];
      out.splice(out.length - 3, 3, { level: a.level, start: a.start, len: a.len + m.len + c.len });
    }
  }
  // Interior short runs that were only created by the loop above are already merged;
  // a short run at either end is kept (it may be a truncated pulse).
  return out;
}

/**
 * Pulse/gap segments: each ON run (mark) with the OFF run after it (gap).
 * Times are in microseconds from the start of the recording.
 */
export function segmentsFromRuns(runs, sampleRate) {
  const us = (n) => (n * 1e6) / sampleRate;
  const segs = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    if (r.level !== 1) continue;
    const next = runs[i + 1];
    const prev = runs[i - 1];
    segs.push({
      startSample: r.start,
      startUs: us(r.start),
      markUs: us(r.len),
      gapUs: next ? us(next.len) : 0,
      leadUs: prev && prev.level === 0 ? us(prev.len) : 0,
    });
  }
  return segs;
}

/**
 * 1-D clustering of durations (rtl_433 -A style histogram): sorted values join a
 * cluster while within max(absTolUs, relTol * cluster mean).
 * Returns clusters sorted by mean: [{ mean, min, max, count }].
 */
export function clusterValues(values, relTol = 0.12, absTolUs = 15) {
  const v = values.filter((x) => x > 0 && Number.isFinite(x)).sort((a, b) => a - b);
  const clusters = [];
  for (const x of v) {
    const c = clusters[clusters.length - 1];
    if (c && x - c.max <= Math.max(absTolUs, relTol * c.mean)) {
      c.sum += x;
      c.count++;
      c.max = x;
      c.mean = c.sum / c.count;
    } else {
      clusters.push({ sum: x, mean: x, min: x, max: x, count: 1 });
    }
  }
  return clusters.map(({ sum, ...c }) => ({ ...c, mean: Math.round(c.mean * 10) / 10 }));
}

/** Share of the most populated cluster (1 when there is only one cluster). */
const dominantShare = (clusters) => {
  const total = clusters.reduce((s, c) => s + c.count, 0);
  if (!total) return 0;
  return Math.max(...clusters.map((c) => c.count)) / total;
};

/**
 * Modulation guess and limits (the analyzer part of rtl_433 -A).
 *  - PWM: the mark width carries the bit and either the period or the gap is fixed.
 *  - PPM: the gap width carries the bit and the mark is fixed.
 *  - Manchester: every duration is a small multiple of a half-bit clock.
 */
export function analyzeSegments(segs, mode = 'ook') {
  const marks = segs.map((s) => s.markUs);
  const gaps = segs.filter((s) => s.gapUs > 0 && s.gapUs < 20000).map((s) => s.gapUs);
  const periods = segs.filter((s) => s.gapUs > 0 && s.gapUs < 20000).map((s) => s.markUs + s.gapUs);
  const mc = clusterValues(marks);
  const gc = clusterValues(gaps);
  const pc = clusterValues(periods);
  const marksConst = dominantShare(mc) >= 0.9;
  const gapsConst = dominantShare(gc) >= 0.9;
  const periodConst = dominantShare(pc) >= 0.9;

  const top2 = (cl) => [...cl].sort((a, b) => b.count - a.count).slice(0, 2).sort((a, b) => a.mean - b.mean);
  const guess = { modulation: 'unknown', label: 'Unknown / raw OOK', thresholdUs: null, halfBitUs: null, shortUs: null, longUs: null, resetUs: null };

  if (mode === 'fsk') {
    const base = clusterValues([...marks, ...gaps])[0];
    guess.modulation = 'fsk-pcm';
    guess.label = 'FSK PCM (discriminator runs, NRZ at the shortest run length)';
    guess.halfBitUs = base ? base.mean : null;
  } else if (mc.length >= 2 && (periodConst || gapsConst)) {
    const [s, l] = top2(mc);
    guess.modulation = 'pwm';
    guess.label = 'OOK PWM (pulse width carries the bit)';
    guess.shortUs = s.mean;
    guess.longUs = l.mean;
    guess.thresholdUs = Math.round((s.mean + l.mean) / 2);
  } else if (gc.length >= 2 && marksConst) {
    const [s, l] = top2(gc);
    guess.modulation = 'ppm';
    guess.label = 'OOK PPM (gap width carries the bit)';
    guess.shortUs = s.mean;
    guess.longUs = l.mean;
    guess.thresholdUs = Math.round((s.mean + l.mean) / 2);
  } else {
    const all = clusterValues([...marks, ...gaps]);
    const base = all.length ? all[0].mean : 0;
    const durs = [...marks, ...gaps];
    if (base > 0 && durs.length) {
      let ok = 0;
      for (const d of durs) {
        const k = Math.max(1, Math.round(d / base));
        if (k <= 3 && Math.abs(d - k * base) <= 0.15 * base) ok++;
      }
      if (ok / durs.length >= 0.9) {
        guess.modulation = 'manchester';
        guess.label = 'OOK Manchester (half-bit clock estimated)';
        guess.halfBitUs = Math.round(base);
      }
    }
  }

  // Reset estimate: a gap well above the usual gap is treated as the packet boundary.
  if (gaps.length) {
    const sorted = [...gaps].sort((a, b) => a - b);
    const med = percentile(sorted, 0.5);
    const big = sorted.filter((g) => g > 3 * med);
    guess.resetUs = big.length ? Math.round(big[0] * 0.9) : null;
  }
  return { clusters: { marks: mc, gaps: gc, periods: pc }, guess };
}

/**
 * Slice segments into bit rows for one modulation.
 * Packets are split at gaps larger than `resetUs`. Each row: { bits, startUs }.
 */
export function sliceRows(segs, cfg) {
  const { modulation, thresholdUs, halfBitUs, invert = false, resetUs = 3000 } = cfg;
  const rows = [];
  const packets = [];
  let cur = [];
  for (const s of segs) {
    cur.push(s);
    if (s.gapUs > resetUs) { packets.push({ segs: cur, ended: true }); cur = []; }
  }
  if (cur.length) packets.push({ segs: cur, ended: false });

  for (const p of packets) {
    const list = p.segs;
    const last = list.length - 1;
    const startUs = list[0].startUs;
    let bits = [];
    if (modulation === 'pwm') {
      bits = list.map((s) => (s.markUs < thresholdUs ? 1 : 0));
    } else if (modulation === 'ppm') {
      const use = p.ended ? list.slice(0, last) : list;
      bits = use.map((s) => (s.gapUs >= thresholdUs ? 1 : 0));
    } else if (modulation === 'manchester' || modulation === 'nrz') {
      const half = Math.max(1, halfBitUs || 1);
      const build = (leadZero) => {
        const hb = [];
        if (leadZero) hb.push(0); // the half-bit before the first mark may sit inside the leading gap
        list.forEach((s, idx) => {
          const kMark = Math.max(1, Math.round(s.markUs / half));
          for (let k = 0; k < kMark; k++) hb.push(1);
          if (s.gapUs > 0) {
            // A packet-ending gap is idle time, but its first half-bit can still be the last bit's second half.
            const kGap = p.ended && idx === last ? 1 : Math.max(1, Math.round(s.gapUs / half));
            for (let k = 0; k < kGap; k++) hb.push(0);
          }
        });
        return hb;
      };
      if (modulation === 'nrz') {
        // FSK PCM: the run lengths at the clock are the bits, no pairing.
        const hb = build(false);
        if (hb.length >= 8) rows.push({ bits: invert ? invertBits(Uint8Array.from(hb)) : Uint8Array.from(hb), startUs, alignment: 0 });
        continue;
      }
      const variants = list[0].leadUs > 0 ? [[true, 'lead'], [false, 'no-lead']] : [[false, 'no-lead']];
      for (const [leadZero, tag] of variants) {
        const hb = build(leadZero);
        for (const off of [0, 1]) {
          const b = [];
          for (let i = off; i + 1 < hb.length; i += 2) {
            if (hb[i] === hb[i + 1]) break;
            b.push(hb[i] === 1 ? 1 : 0);
          }
          if (b.length >= 8) rows.push({ bits: invert ? invertBits(b) : Uint8Array.from(b), startUs, alignment: off, variant: tag });
        }
      }
      continue;
    } else {
      continue;
    }
    if (bits.length < 8) continue;
    const arr = Uint8Array.from(bits);
    rows.push({ bits: invert ? invertBits(arr) : arr, startUs, alignment: 0 });
  }
  return rows;
}

/** Decoder configuration for a device, as used by sliceRows. */
const deviceCfg = (dev) => ({
  modulation: dev.modulation,
  thresholdUs: dev.thresholdUs,
  halfBitUs: dev.halfBitUs,
  invert: dev.invert,
  resetUs: dev.resetUs,
});

/**
 * Full analysis of one IQ recording.
 * opts: { format, sampleRate, mode: 'ook' | 'fsk', sens (0..1), minPulseUs }
 */
export function analyzeIqBuffer(buffer, opts) {
  const { format, sampleRate, mode = 'ook', sens = 0.5, minPulseUs = 30 } = opts;
  if (!ISM_FORMATS[format]) throw new Error(`Unsupported sample format: ${format}`);
  if (!(sampleRate > 0)) throw new Error('Sample rate must be a positive number');
  if (buffer.byteLength > ISM_MAX_BYTES) {
    throw new Error(`File is ${(buffer.byteLength / 1048576).toFixed(1)} MiB; the limit is ${ISM_MAX_BYTES / 1048576} MiB. Trim the capture or lower the sample rate.`);
  }
  const raw = demodBuffer(buffer, format, mode);
  const smoothLen = Math.max(1, sampleRate * 0.00002); // 20 us boxcar
  const data = mode === 'fsk' ? boxcar(raw, Math.max(1, sampleRate * 0.00001)) : boxcar(raw, smoothLen);
  const levels = mode === 'fsk' ? null : adaptiveThresholds(data, sampleRate, sens);
  const bin = binarize(data, mode, levels || { thr: [0], floor: [0], peak: [0], chunk: data.length });
  const minSamples = Math.max(1, Math.round((minPulseUs * sampleRate) / 1e6));
  const runs = despikeRuns(runsFromLevels(bin), minSamples);
  const segsAll = segmentsFromRuns(runs, sampleRate);
  const truncated = segsAll.length > MAX_SEGMENTS;
  const segs = truncated ? segsAll.slice(0, MAX_SEGMENTS) : segsAll;
  const analysis = analyzeSegments(segs, mode);
  const g = analysis.guess;

  // Analyzer rows, sliced with the guessed modulation (for display).
  const analyzerRows = g.modulation === 'unknown'
    ? []
    : sliceRows(segs, {
      modulation: g.modulation === 'fsk-pcm' ? 'nrz' : g.modulation,
      thresholdUs: g.thresholdUs,
      halfBitUs: g.halfBitUs,
      resetUs: g.resetUs || 3000,
    });

  // Device decoders: every device slices with its own timing.
  const decodes = [];
  for (const dev of ISM_DEVICES) {
    const rows = sliceRows(segs, deviceCfg(dev));
    for (const row of rows) {
      for (const r of dev.decode(row.bits)) {
        decodes.push({
          deviceId: dev.id,
          deviceName: dev.name,
          startUs: row.startUs,
          alignment: row.alignment,
          rowBits: row.bits.length,
          rowHex: bitsToHex(row.bits),
          ...r,
          fieldsKey: JSON.stringify(r.fields),
        });
      }
    }
  }
  // Collapse repeats of the same decoded message (rtl_433 style "repeats").
  const byKey = new Map();
  for (const d of decodes) {
    const key = `${d.deviceId}|${d.fieldsKey}`;
    const prev = byKey.get(key);
    if (prev) prev.repeats++;
    else byKey.set(key, { ...d, repeats: 1 });
  }
  const dedup = [...byKey.values()].sort((a, b) => a.startUs - b.startUs);

  return {
    format,
    sampleRate,
    mode,
    samples: raw.length,
    durationS: raw.length / sampleRate,
    sens,
    envelope: data,
    thresholds: levels,
    chunkSamples: levels ? levels.chunk : 0,
    runCount: runs.length,
    pulseCount: segs.length,
    truncated,
    segments: segs,
    analysis,
    analyzerRows: analyzerRows.slice(0, 60).map((r) => ({ startUs: r.startUs, bits: r.bits.length, hex: bitsToHex(r.bits) })),
    analyzerRowCount: analyzerRows.length,
    decodes: dedup,
  };
}

/** Pulse table for export: microseconds, durations and the rows. */
export function exportableAnalysis(result) {
  return {
    tool: 'ism-decoder',
    format: result.format,
    sampleRate: result.sampleRate,
    mode: result.mode,
    sens: result.sens,
    durationS: result.durationS,
    samples: result.samples,
    pulseCount: result.pulseCount,
    truncated: result.truncated,
    analyzer: result.analysis,
    analyzerRows: result.analyzerRows,
    decodes: result.decodes.map(({ fieldsKey, ...rest }) => rest),
    segments: result.segments.map((s) => ({ startUs: Math.round(s.startUs), markUs: Math.round(s.markUs * 10) / 10, gapUs: Math.round(s.gapUs * 10) / 10 })),
  };
}
