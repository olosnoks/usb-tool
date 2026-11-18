/**
 * Pure helpers for the Telemetry dashboard: turn parsed lines into channel state.
 * Channels start empty; nothing is invented before data arrives.
 */

export const HISTORY_OPTIONS = [20, 100, 500];

export function cleanChannelKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** Map a parseTelemetryLine result to [key, value] pairs (`ch_1..` for unnamed columns). */
export function samplePairs(parsed) {
  if (!parsed) return [];
  const pairs = [];
  parsed.values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const raw = parsed.labels ? parsed.labels[i] : `ch_${i + 1}`;
    const key = cleanChannelKey(raw);
    if (key) pairs.push([key, v]);
  });
  return pairs;
}

/**
 * Apply a batch of samples (each an array of [key, value]) to the channel map.
 * Returns a new map; `history` is capped at `historyLen`.
 */
export function applySamples(channels, samples, historyLen = 20) {
  const next = { ...channels };
  for (const pairs of samples) {
    for (const [key, num] of pairs) {
      const cur = next[key];
      if (!cur) {
        next[key] = { value: num, min: num, max: num, history: [num] };
      } else {
        const history = cur.history.length >= historyLen
          ? [...cur.history.slice(cur.history.length - historyLen + 1), num]
          : [...cur.history, num];
        next[key] = { value: num, min: Math.min(cur.min, num), max: Math.max(cur.max, num), history };
      }
    }
  }
  return next;
}

export function trimHistory(channels, historyLen) {
  const next = {};
  for (const [k, c] of Object.entries(channels)) next[k] = { ...c, history: c.history.slice(-historyLen) };
  return next;
}

export function resetChannelStats(channels) {
  const next = {};
  for (const [k, c] of Object.entries(channels)) next[k] = { ...c, min: c.value, max: c.value, history: [c.value] };
  return next;
}

/** CSV of the timestamped sample log: `samples` = [{ t, pairs: [[key, value]...] }]. */
export function buildTelemetryCsv(samples, config = {}) {
  const keys = [];
  for (const s of samples) for (const [k] of s.pairs) if (!keys.includes(k)) keys.push(k);
  const head = ['timestamp', ...keys.map((k) => {
    const c = config[k] || {};
    const name = c.label || k;
    return c.unit ? `${name} (${c.unit})` : name;
  })];
  const rows = samples.map((s) => {
    const m = new Map(s.pairs);
    return [new Date(s.t).toISOString(), ...keys.map((k) => (m.has(k) ? m.get(k) : ''))].join(',');
  });
  return [head.map((h) => (/[",\n]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h)).join(','), ...rows].join('\n');
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Classify a value against optional per-channel limits.
 * cfg: { warnLow, warnHigh, alarmLow, alarmHigh } (any may be missing). Alarm wins over warn.
 * Returns 'ok' | 'warn' | 'alarm'.
 */
export function thresholdState(value, cfg = {}) {
  if (!Number.isFinite(value)) return 'ok';
  const aH = num(cfg.alarmHigh), aL = num(cfg.alarmLow), wH = num(cfg.warnHigh), wL = num(cfg.warnLow);
  if ((aH !== undefined && value >= aH) || (aL !== undefined && value <= aL)) return 'alarm';
  if ((wH !== undefined && value >= wH) || (wL !== undefined && value <= wL)) return 'warn';
  return 'ok';
}

/**
 * Update rate (Hz) per channel from the timestamped sample log, using samples in the last windowMs.
 * Needs at least 2 samples in the window; otherwise the channel is omitted (nothing invented).
 */
export function channelRates(samples, now, windowMs = 5000) {
  const times = {};
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (now - s.t > windowMs) break;
    for (const [k] of s.pairs) (times[k] ||= []).push(s.t);
  }
  const rates = {};
  for (const [k, ts] of Object.entries(times)) {
    const span = ts[0] - ts[ts.length - 1];
    if (ts.length >= 2 && span > 0) rates[k] = ((ts.length - 1) * 1000) / span;
  }
  return rates;
}

/** Count of channels currently in each non-ok state. */
export function countAlerts(channels, config = {}) {
  let warn = 0, alarm = 0;
  for (const [k, c] of Object.entries(channels)) {
    const s = thresholdState(c.value, config[k]);
    if (s === 'alarm') alarm++; else if (s === 'warn') warn++;
  }
  return { warn, alarm };
}
