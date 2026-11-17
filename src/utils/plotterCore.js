/**
 * Pure core of the serial plotter: ingestion engine (line assembler + parser), view window,
 * min/max decimation, per-channel statistics, edge trigger, spectrum and CSV/config helpers.
 * No React, no DOM: everything here is unit-testable.
 */
import { createLineAssembler, parseTelemetryLine } from './rxLines.js';
import { fft } from './fft.js';

export const MAX_POINTS = 50000;
const TRIM_SLACK = 2000;

/** "0, 2,3" -> [0, 2, 3]; empty/invalid -> null (use all columns). */
export function parseColumns(text) {
  if (!text || !String(text).trim()) return null;
  const cols = String(text).split(/[\s,;]+/).filter(Boolean).map((t) => Number(t));
  if (!cols.length || cols.some((c) => !Number.isInteger(c) || c < 0)) return null;
  return cols;
}

// ---------------------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------------------

export function detectEdge(prev, cur, level, edge = 'rising') {
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return false;
  const rising = prev < level && cur >= level;
  const falling = prev > level && cur <= level;
  return edge === 'falling' ? falling : edge === 'either' ? rising || falling : rising;
}

/**
 * Edge trigger with pre-trigger roll and single-shot. Feed it the whole buffer after each
 * appended point (`feed(points)`); the newest point is the last element. A capture is
 * `pre` samples before the trigger sample, the trigger sample, and `post` samples after.
 * `capture` is { points, triggerIndex } once complete; `collecting` is true meanwhile.
 */
export function createTrigger() {
  const t = {
    cfg: { enabled: false, channel: 0, level: 0, edge: 'rising', pre: 50, post: 100, single: false },
    armed: false,
    collecting: false,
    capture: null,
    _buf: null,
    _remaining: 0,
    _triggerIndex: 0,
    configure(patch) {
      t.cfg = { ...t.cfg, ...patch };
      if (!t.cfg.enabled) { t.armed = false; t.collecting = false; }
    },
    arm() { t.armed = t.cfg.enabled; t.collecting = false; t.capture = null; },
    disarm() { t.armed = false; t.collecting = false; },
    clear() { t.capture = null; t.collecting = false; t._buf = null; },
    _finish() {
      t.capture = { points: t._buf, triggerIndex: t._triggerIndex };
      t._buf = null;
      t.collecting = false;
      if (t.cfg.single) t.armed = false;
    },
    feed(points) {
      const n = points.length;
      if (!n || !t.cfg.enabled) return;
      const p = points[n - 1];
      if (t.collecting) {
        t._buf.push(p);
        if (--t._remaining <= 0) t._finish();
        return;
      }
      if (!t.armed || n < 2) return;
      const ch = t.cfg.channel;
      if (!detectEdge(points[n - 2].values[ch], p.values[ch], t.cfg.level, t.cfg.edge)) return;
      const start = Math.max(0, n - 1 - t.cfg.pre);
      t._buf = points.slice(start);
      t._triggerIndex = n - 1 - start;
      t._remaining = Math.max(0, t.cfg.post);
      t.collecting = true;
      if (t._remaining === 0) t._finish();
    }
  };
  return t;
}

// ---------------------------------------------------------------------------------------
// Ingestion engine
// ---------------------------------------------------------------------------------------

/**
 * createPlotterEngine({ cap, delimiter, columns })
 *  push(bytes, tMs) -> number of points added. Bytes go through one persistent line
 *  assembler, so split lines, repeated identical lines and multibyte characters are all
 *  handled; every parsed line becomes exactly one point with its own timestamp.
 *  points: [{ t, values: (number|undefined)[] }], capped near `cap` (oldest dropped).
 */
export function createPlotterEngine({ cap = MAX_POINTS, delimiter = '', columns = null } = {}) {
  const assembler = createLineAssembler();
  const trigger = createTrigger();
  const eng = {
    points: [],
    names: [], // channel names (undefined for unnamed positional channels)
    config: { delimiter, columns },
    trigger,
    totalIngested: 0,
    setConfig(patch) { eng.config = { ...eng.config, ...patch }; },
    labels() {
      const n = Math.max(eng.names.length, ...eng.points.slice(-200).map((p) => p.values.length), 0);
      return Array.from({ length: n }, (_, i) => eng.names[i] || `CH ${i}`);
    },
    clear() {
      eng.points = [];
      eng.names = [];
      eng.totalIngested = 0;
      assembler.reset();
      trigger.clear();
    },
    addLine(text, t) {
      const parsed = parseTelemetryLine(text, { delimiter: eng.config.delimiter });
      if (!parsed || !parsed.values.length) return false;
      let values = [];
      if (parsed.labels) {
        parsed.labels.forEach((name, i) => {
          let idx = eng.names.indexOf(name);
          if (idx < 0) { idx = eng.names.length; eng.names[idx] = name; }
          values[idx] = Number.isFinite(parsed.values[i]) ? parsed.values[i] : undefined;
        });
      } else {
        const cols = eng.config.columns;
        const src = cols ? cols.map((c) => parsed.values[c]) : parsed.values;
        values = src.map((v) => (Number.isFinite(v) ? v : undefined));
        if (eng.names.length < values.length) eng.names.length = values.length;
      }
      if (!values.some((v) => v !== undefined)) return false;
      eng.points.push({ t, values });
      eng.totalIngested += 1;
      if (eng.points.length >= cap + TRIM_SLACK) eng.points.splice(0, eng.points.length - cap);
      trigger.feed(eng.points);
      return true;
    },
    push(bytes, tMs = Date.now()) {
      let added = 0;
      for (const line of assembler.push(bytes, tMs)) if (eng.addLine(line.text, line.t)) added += 1;
      return added;
    }
  };
  return eng;
}

// ---------------------------------------------------------------------------------------
// View window, decimation, statistics
// ---------------------------------------------------------------------------------------

/** Visible slice [start, end) for a window of `windowSize` samples, zoom factor and pan (samples back from newest). */
export function visibleRange(total, windowSize, zoom = 1, pan = 0) {
  if (total <= 0) return { start: 0, end: 0 };
  const count = Math.min(total, Math.max(5, Math.round(windowSize / Math.max(zoom, 0.01))));
  const maxPan = Math.max(0, total - count);
  const p = Math.min(Math.max(0, Math.round(pan)), maxPan);
  const end = total - p;
  return { start: end - count, end };
}

/**
 * Min/max decimation: reduce `values` (numbers, undefined/NaN skipped) to at most
 * 2 * `buckets` points while preserving every extreme. Returns [{ i, v }] in index order.
 */
export function decimateMinMax(values, buckets) {
  const n = values.length;
  const out = [];
  const ok = (v) => v !== undefined && Number.isFinite(v);
  if (n <= buckets * 2) {
    for (let i = 0; i < n; i++) if (ok(values[i])) out.push({ i, v: values[i] });
    return out;
  }
  const size = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * size);
    const to = Math.min(n, Math.floor((b + 1) * size));
    let lo = -1; let hi = -1;
    for (let i = from; i < to; i++) {
      if (!ok(values[i])) continue;
      if (lo < 0 || values[i] < values[lo]) lo = i;
      if (hi < 0 || values[i] > values[hi]) hi = i;
    }
    if (lo < 0) continue;
    if (lo === hi) out.push({ i: lo, v: values[lo] });
    else if (lo < hi) out.push({ i: lo, v: values[lo] }, { i: hi, v: values[hi] });
    else out.push({ i: hi, v: values[hi] }, { i: lo, v: values[lo] });
  }
  return out;
}

export function channelStats(values) {
  let count = 0; let sum = 0; let sumSq = 0; let min = Infinity; let max = -Infinity; let last;
  for (const v of values) {
    if (v === undefined || !Number.isFinite(v)) continue;
    count += 1; sum += v; sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
    last = v;
  }
  if (!count) return null;
  return { count, min, max, mean: sum / count, rms: Math.sqrt(sumSq / count), last };
}

export function applyChannelScale(v, cfg) {
  if (v === undefined || !Number.isFinite(v)) return v;
  const scale = cfg && Number.isFinite(cfg.scale) ? cfg.scale : 1;
  const offset = cfg && Number.isFinite(cfg.offset) ? cfg.offset : 0;
  return v * scale + offset;
}

// ---------------------------------------------------------------------------------------
// Spectrum
// ---------------------------------------------------------------------------------------

/** Median inter-sample rate in Hz from point timestamps, or null if not measurable. */
export function estimateSampleRate(points) {
  const dts = [];
  for (let i = 1; i < points.length; i++) {
    const dt = points[i].t - points[i - 1].t;
    if (dt > 0) dts.push(dt);
  }
  if (dts.length < 3) return null;
  dts.sort((a, b) => a - b);
  return 1000 / dts[Math.floor(dts.length / 2)];
}

/**
 * Amplitude spectrum of the newest power-of-two block of `values` (mean removed, Hann
 * window). Returns { freqs, mags, binHz, n }; a sine of amplitude A peaks near A.
 */
export function spectrum(values, sampleRate, maxN = 8192) {
  const clean = values.filter((v) => v !== undefined && Number.isFinite(v));
  let n = 1;
  while (n * 2 <= Math.min(clean.length, maxN)) n *= 2;
  if (n < 8 || !(sampleRate > 0)) return { freqs: [], mags: [], binHz: 0, n: 0 };
  const block = clean.slice(clean.length - n);
  const mean = block.reduce((a, b) => a + b, 0) / n;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let wsum = 0;
  for (let k = 0; k < n; k++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1));
    re[k] = (block[k] - mean) * w;
    wsum += w;
  }
  fft(re, im);
  const half = n >> 1;
  const freqs = new Array(half);
  const mags = new Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = (k * sampleRate) / n;
    mags[k] = (2 * Math.hypot(re[k], im[k])) / wsum;
  }
  return { freqs, mags, binHz: sampleRate / n, n };
}

/** Index of the largest magnitude, ignoring DC (bin 0). -1 when empty. */
export function dominantBin(mags) {
  let best = -1;
  for (let k = 1; k < mags.length; k++) if (best < 0 || mags[k] > mags[best]) best = k;
  return best;
}

// ---------------------------------------------------------------------------------------
// Export / config
// ---------------------------------------------------------------------------------------

function csvCell(s) {
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV with a true timestamp for every sample (ISO + epoch ms). */
export function buildPlotCsv(points, labels) {
  const header = ['timestamp', 'epoch_ms', ...labels].map(csvCell).join(',');
  const rows = points.map((p) => {
    const cells = labels.map((_, i) => (p.values[i] === undefined ? '' : p.values[i]));
    return [new Date(p.t).toISOString(), p.t, ...cells].join(',');
  });
  return [header, ...rows].join('\n');
}

export const CONFIG_VERSION = 1;

export function serializePlotConfig(cfg) {
  return JSON.stringify({ app: 'usb-tool-plotter', version: CONFIG_VERSION, ...cfg }, null, 2);
}

const num = (v, d) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : d);

/** Parse and sanitise a saved plot config; throws on anything that is not a plotter config. */
export function parsePlotConfig(text) {
  let o;
  try { o = JSON.parse(text); } catch { throw new Error('Not valid JSON'); }
  if (!o || typeof o !== 'object' || o.app !== 'usb-tool-plotter') throw new Error('Not a plotter config');
  const chCfg = {};
  if (o.channelCfg && typeof o.channelCfg === 'object') {
    for (const [k, v] of Object.entries(o.channelCfg)) {
      if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
      chCfg[k] = { scale: num(v.scale, 1), offset: num(v.offset, 0), unit: typeof v.unit === 'string' ? v.unit.slice(0, 12) : '' };
    }
  }
  const trig = o.trigger && typeof o.trigger === 'object' ? o.trigger : {};
  return {
    windowSize: Math.min(5000, Math.max(5, num(o.windowSize, 150))),
    autoScale: o.autoScale !== false,
    customMinY: num(o.customMinY, -50),
    customMaxY: num(o.customMaxY, 150),
    delimiter: typeof o.delimiter === 'string' ? o.delimiter.slice(0, 8) : '',
    columnsText: typeof o.columnsText === 'string' ? o.columnsText.slice(0, 64) : '',
    sampleRate: num(o.sampleRate, 0),
    view: ['time', 'fft', 'xy'].includes(o.view) ? o.view : 'time',
    channelCfg: chCfg,
    hiddenChannels: Array.isArray(o.hiddenChannels) ? o.hiddenChannels.filter((x) => Number.isInteger(x) && x >= 0) : [],
    trigger: {
      enabled: !!trig.enabled,
      channel: Math.max(0, Math.floor(num(trig.channel, 0))),
      level: num(trig.level, 0),
      edge: ['rising', 'falling', 'either'].includes(trig.edge) ? trig.edge : 'rising',
      pre: Math.max(0, Math.floor(num(trig.pre, 50))),
      post: Math.max(0, Math.floor(num(trig.post, 100))),
      single: !!trig.single
    }
  };
}
