// Pure helpers for the MIDI monitor log: text search, CSV/text export, rate statistics.

/** True when the log entry matches every whitespace-separated term (case-insensitive) of the query. */
export function matchesQuery(entry, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = [entry.text, entry.raw, entry.category, entry.from, entry.to, entry.manufacturer]
    .filter((v) => v !== undefined && v !== null).join(' ').toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function csvCell(v) {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Log entries to CSV: time_ms, direction, port, category, channel, text, raw_hex. */
export function logToCsv(entries) {
  const head = ['time_ms', 'direction', 'port', 'category', 'channel', 'text', 'raw_hex'];
  const rows = entries.map((e) => [
    e.t === null || e.t === undefined ? '' : Number(e.t).toFixed(3),
    e.dir === 'out' ? 'out' : 'in',
    e.dir === 'out' ? e.to : e.from,
    e.category, e.channel, e.text, e.raw,
  ].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\r\n');
}

/** Log entries to plain text, one line each. */
export function logToText(entries) {
  return entries.map((e) => {
    const t = e.t === null || e.t === undefined ? '-' : `${(e.t / 1000).toFixed(3)}s`;
    return `${t} ${e.dir === 'out' ? '>' : '<'} ${e.dir === 'out' ? e.to : e.from} | ${e.text}${e.raw ? ` | ${e.raw}` : ''}`;
  }).join('\n');
}

/** Counts per category plus overall messages per second over the stored time span. */
export function logStats(entries) {
  const byCategory = {};
  let first = null;
  let last = null;
  for (const e of entries) {
    byCategory[e.category || 'other'] = (byCategory[e.category || 'other'] || 0) + 1;
    if (Number.isFinite(e.t)) {
      if (first === null || e.t < first) first = e.t;
      if (last === null || e.t > last) last = e.t;
    }
  }
  const spanMs = first === null ? 0 : last - first;
  return { total: entries.length, byCategory, spanMs, perSecond: spanMs > 0 ? (entries.length / spanMs) * 1000 : null };
}
