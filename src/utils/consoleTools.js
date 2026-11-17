// Pure helpers behind the serial console (StreamConsole): honest timing, line
// assembly, search, disk logging from raw bytes, and paced send-file.
// No React, no DOM: everything is unit-tested in tests/streamConsole.test.jsx.

/**
 * Real arrival deltas. Each entry carries `rawTime` (performance.now() taken at
 * ingest). An entry without a usable `rawTime`, or the first entry, gets
 * `deltaMs: null` ("unknown") instead of an invented number.
 */
export function computeDeltas(entries) {
  return entries.map((entry, idx, arr) => {
    let deltaMs = null;
    if (idx > 0) {
      const prev = arr[idx - 1].rawTime;
      const curr = entry.rawTime;
      if (Number.isFinite(prev) && Number.isFinite(curr) && curr >= prev) {
        deltaMs = +(curr - prev).toFixed(2);
      }
    }
    return { ...entry, deltaMs };
  });
}

/** "12.5" / "—" for display. */
export function formatDelta(deltaMs) {
  return deltaMs == null ? '—' : `+${deltaMs} ms`;
}

const RX_TERMINATORS = {
  auto: /\r\n|\n|\r/,
  lf: /\n/,
  cr: /\r/,
  crlf: /\r\n/,
};

/**
 * Assemble RX chunks into lines. A line's timestamp / rawTime is that of its
 * first byte (first chunk that contributed to it). TX and SYS entries flush
 * any pending partial RX line and are passed through (trailing CR/LF trimmed).
 * The still-open RX tail is emitted last with `partial: true`.
 * `rxEnding`: 'auto' (CR, LF or CRLF), 'lf', 'cr', 'crlf'.
 */
export function assembleLines(entries, rxEnding = 'auto') {
  const term = RX_TERMINATORS[rxEnding] || RX_TERMINATORS.auto;
  const out = [];
  let pending = null; // { text, src }
  // A trailing lone CR in auto/crlf mode is held until we know whether LF follows.
  const holdCr = rxEnding === 'auto' || rxEnding === 'crlf';

  const emitLine = (text, src, partial = false) => {
    out.push({
      id: `${src.id}:${out.length}`,
      type: 'rx',
      text,
      timestamp: src.timestamp,
      rawTime: src.rawTime,
      wallTime: src.wallTime,
      partial,
    });
  };

  for (const entry of entries) {
    if (entry.type !== 'rx') {
      if (pending && pending.text.replace(/\r$/, '')) emitLine(pending.text.replace(/\r$/, ''), pending.src, true);
      pending = null;
      out.push({ ...entry, text: String(entry.text ?? '').replace(/[\r\n]+$/, ''), partial: false });
      continue;
    }
    let rest = String(entry.text ?? '');
    if (!rest) continue;
    if (!pending) pending = { text: '', src: entry };
    for (;;) {
      const buf = pending.text + rest;
      // Lone trailing CR may be half of a CRLF; wait for the next chunk.
      const searchIn = holdCr && buf.endsWith('\r') ? buf.slice(0, -1) : buf;
      const m = term.exec(searchIn);
      if (!m) { pending.text = buf; break; }
      const line = searchIn.slice(0, m.index);
      emitLine(line, pending.src);
      rest = buf.slice(m.index + m[0].length);
      // The remainder starts a new line whose first byte arrived in this entry
      // (only if there is anything left; otherwise the next chunk starts it).
      pending = { text: '', src: entry };
      if (!rest) { pending = null; break; }
    }
  }
  if (pending && pending.text.replace(/\r$/, '')) emitLine(pending.text.replace(/\r$/, ''), pending.src, true);
  return out;
}

/**
 * Build a matcher from the search box. Returns { re, error }. `re` is a global,
 * case-insensitive RegExp (or null for an empty query). Plain-text queries are
 * escaped. An invalid regex yields { re: null, error }.
 */
export function buildMatcher(query, { regex = false } = {}) {
  const q = query ?? '';
  if (!q.trim()) return { re: null, error: null };
  try {
    const source = regex ? q : q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(source, 'gi');
    return { re, error: null };
  } catch (e) {
    return { re: null, error: e.message };
  }
}

/** Does `text` match? (fresh lastIndex each call) */
export function textMatches(re, text) {
  if (!re) return true;
  re.lastIndex = 0;
  const ok = re.test(String(text ?? ''));
  re.lastIndex = 0;
  return ok;
}

/** Split into [{text, match}] segments for highlighting. Zero-length matches are skipped. */
export function splitByMatches(text, re) {
  const s = String(text ?? '');
  if (!re || !s) return [{ text: s, match: false }];
  const parts = [];
  let last = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (m.index > last) parts.push({ text: s.slice(last, m.index), match: false });
    parts.push({ text: m[0], match: true });
    last = m.index + m[0].length;
  }
  re.lastIndex = 0;
  if (last < s.length) parts.push({ text: s.slice(last), match: false });
  return parts.length ? parts : [{ text: s, match: false }];
}

/**
 * Highlight rules: [{ id, pattern, color }] -> first rule whose regex matches
 * the text, or null. Invalid patterns are ignored.
 */
export function matchHighlightRule(rules, text) {
  for (const rule of rules || []) {
    const { re } = buildMatcher(rule.pattern, { regex: true });
    if (re && textMatches(re, text)) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Disk logging from raw bytes
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');
export function formatWallTime(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

/**
 * Writes received bytes to a FileSystemWritableFileStream-like `writable`
 * ({ write(data), close() }). Each byte is written once, in call order; writes
 * are chained so a burst of calls in one tick keeps its order.
 * modes: 'raw' (bytes verbatim), 'text' (UTF-8-safe, `[time] ` before every
 * line), 'hex' (one `[time] 48 65 ..` line per chunk).
 */
export function createDiskLogger(writable, { mode = 'raw', now = Date.now } = {}) {
  let chain = Promise.resolve();
  let closed = false;
  let bytesWritten = 0;
  let firstError = null;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let atLineStart = true;

  const enqueue = (data) => {
    chain = chain.then(() => writable.write(data)).catch((err) => {
      if (!firstError) firstError = err;
    });
  };

  const api = {
    write(bytes, wallMs = now()) {
      if (closed || !bytes || bytes.length === 0) return;
      bytesWritten += bytes.length;
      if (mode === 'raw') {
        enqueue(bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes));
      } else if (mode === 'hex') {
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
        enqueue(`[${formatWallTime(wallMs)}] ${hex}\n`);
      } else {
        const text = decoder.decode(bytes, { stream: true });
        if (!text) return;
        const ts = `[${formatWallTime(wallMs)}] `;
        let out = '';
        for (const ch of text) {
          if (atLineStart && ch !== '\n' && ch !== '\r') { out += ts; atLineStart = false; }
          out += ch;
          if (ch === '\n') atLineStart = true;
        }
        if (out) enqueue(out);
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (mode === 'text') {
        const tail = decoder.decode();
        if (tail) enqueue(tail);
      }
      await chain;
      try { await writable.close(); } catch (e) { if (!firstError) firstError = e; }
    },
    get bytesWritten() { return bytesWritten; },
    get error() { return firstError; },
    get closed() { return closed; },
  };
  return api;
}

// ---------------------------------------------------------------------------
// Paced send-file
// ---------------------------------------------------------------------------

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send `bytes` through `sendRaw(Uint8Array)` in order, paced.
 *  unit 'char': one byte per send, `delayMs` after each (delay 0 -> 256-byte blocks).
 *  unit 'line': one line (through and including LF) per send, `delayMs` after each.
 * Awaits each send before the next. `signal` (AbortSignal-like { aborted })
 * cancels between sends. Returns { sent, total, cancelled }.
 */
export async function sendPaced(bytes, { unit = 'char', delayMs = 0, sendRaw, signal, onProgress, sleep = defaultSleep } = {}) {
  const total = bytes.length;
  let sent = 0;
  const pieces = [];
  if (unit === 'line') {
    let start = 0;
    for (let i = 0; i < total; i++) {
      if (bytes[i] === 0x0a) { pieces.push(bytes.subarray(start, i + 1)); start = i + 1; }
    }
    if (start < total) pieces.push(bytes.subarray(start));
  } else if (delayMs > 0) {
    for (let i = 0; i < total; i++) pieces.push(bytes.subarray(i, i + 1));
  } else {
    for (let i = 0; i < total; i += 256) pieces.push(bytes.subarray(i, Math.min(total, i + 256)));
  }
  for (const piece of pieces) {
    if (signal?.aborted) return { sent, total, cancelled: true };
    await sendRaw(piece);
    sent += piece.length;
    if (onProgress) onProgress(sent, total);
    if (delayMs > 0) await sleep(delayMs);
  }
  return { sent, total, cancelled: false };
}

/** Ctrl-key buttons shown under the console. */
export const CTRL_KEYS = [
  { label: 'Ctrl-C', bytes: [0x03] },
  { label: 'Ctrl-D', bytes: [0x04] },
  { label: 'Ctrl-Z', bytes: [0x1a] },
  { label: 'ESC', bytes: [0x1b] },
];
