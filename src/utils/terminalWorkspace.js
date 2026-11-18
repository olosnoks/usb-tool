// Pure helpers for the Terminal workspace tab: session statistics, custom
// baud-hunt candidate lists, hunt-report formatting and persisted layout prefs.

const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const MIN_BAUD = 50;
const MAX_BAUD = 4000000;

function byteLength(entry) {
  if (entry.rawBytes && typeof entry.rawBytes.length === 'number') return entry.rawBytes.length;
  if (typeof entry.text === 'string') return encoder ? encoder.encode(entry.text).length : entry.text.length;
  return 0;
}

/**
 * Totals over the retained log entries (the app keeps only the newest ~1500).
 * rxBps is the average receive rate between the first and last RX entry.
 */
export function sessionStats(entries) {
  let rxBytes = 0, txBytes = 0, rxChunks = 0, txChunks = 0;
  let firstRx = null, lastRx = null;
  for (const e of entries || []) {
    if (e.type === 'rx') {
      rxBytes += byteLength(e);
      rxChunks++;
      if (typeof e.rawTime === 'number') {
        if (firstRx === null) firstRx = e.rawTime;
        lastRx = e.rawTime;
      }
    } else if (e.type === 'tx') {
      txBytes += byteLength(e);
      txChunks++;
    }
  }
  const spanMs = firstRx !== null && lastRx !== null ? lastRx - firstRx : 0;
  const rxBps = spanMs > 0 ? Math.round((rxBytes * 1000) / spanMs) : 0;
  return { rxBytes, txBytes, rxChunks, txChunks, spanMs, rxBps };
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * Parse "9600, 115200 250000" into a unique list of valid baud rates, in the
 * order given. Returns { rates, invalid } (invalid tokens are reported, not dropped silently).
 */
export function parseBaudList(text) {
  const rates = [];
  const invalid = [];
  for (const tok of String(text || '').split(/[\s,;]+/).filter(Boolean)) {
    const n = /^\d+$/.test(tok) ? Number(tok) : NaN;
    if (!Number.isInteger(n) || n < MIN_BAUD || n > MAX_BAUD) invalid.push(tok);
    else if (!rates.includes(n)) rates.push(n);
  }
  return { rates, invalid };
}

/** Highest-confidence result at or above minConfidence, or null. Ties go to the earlier (lower) baud. */
export function bestBaudResult(results, minConfidence = 50) {
  let best = null;
  for (const r of results || []) {
    if (r.confidence >= minConfidence && (!best || r.confidence > best.confidence)) best = r;
  }
  return best;
}

/** Plain-text table of hunt results (for copy / paste into a bug report). */
export function formatHuntReport(results) {
  const lines = ['baud\tconfidence\tprintable%\tentropy\tbytes\tverdict'];
  for (const r of results || []) {
    lines.push([r.baud, `${r.confidence}%`, r.printableRatio, r.entropy, r.byteCount, r.verdict].join('\t'));
  }
  return lines.join('\n');
}

export const PREFS_KEY = 'skons.terminal.workspace';
const SIDE_PANELS = ['hex', 'hunter', 'injector', 'none'];
const MODES = ['log', 'interactive'];
const PROBES = ['active', 'passive'];

export function sanitizePrefs(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  return {
    sidePanel: SIDE_PANELS.includes(p.sidePanel) ? p.sidePanel : 'hex',
    termMode: MODES.includes(p.termMode) ? p.termMode : 'log',
    probeMode: PROBES.includes(p.probeMode) ? p.probeMode : 'active',
    customBauds: typeof p.customBauds === 'string' ? p.customBauds.slice(0, 200) : ''
  };
}

export function loadPrefs(storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { return sanitizePrefs(JSON.parse(storage.getItem(PREFS_KEY))); } catch (e) { return sanitizePrefs(null); }
}

export function savePrefs(prefs, storage = typeof localStorage !== 'undefined' ? localStorage : null) {
  try { storage.setItem(PREFS_KEY, JSON.stringify(sanitizePrefs(prefs))); } catch (e) { /* storage unavailable */ }
}
