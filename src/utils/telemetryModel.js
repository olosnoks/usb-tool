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
