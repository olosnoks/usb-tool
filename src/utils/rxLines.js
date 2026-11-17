/**
 * Shared RX line assembler and telemetry line parser.
 *
 * Serial data arrives in arbitrary chunks (a line may be split across chunks, a UTF-8
 * character may be split mid-sequence). Every consumer that wants lines should feed the
 * raw bytes from `subscribeRx` through one assembler instead of slicing `latestRxText`.
 */

/**
 * createLineAssembler({ maxLine }) -> { push, flush, partial, reset }
 *  - push(bytesOrString, tMs) -> [{ text, t }]: completed lines (CR, LF and CRLF all end a
 *    line, also when CR and LF arrive in different chunks). `t` is the timestamp of the
 *    chunk that carried the line's first byte. Empty lines are returned as empty text.
 *  - One persistent streaming TextDecoder, so multibyte characters survive chunk splits.
 *  - A line longer than `maxLine` characters is emitted in pieces instead of growing forever.
 *  - flush() returns the unterminated partial line (if any) and resets the carry.
 *  - partial() peeks at the unterminated text (prompt detection).
 */
export function createLineAssembler({ maxLine = 4096 } = {}) {
  let decoder = new TextDecoder('utf-8');
  let buf = '';
  let startT = null;
  let skipLF = false;

  function push(input, tMs = Date.now()) {
    const text = typeof input === 'string'
      ? input
      : decoder.decode(input, { stream: true });
    const out = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (skipLF) {
        skipLF = false;
        if (ch === '\n') continue; // second half of a CRLF
      }
      if (ch === '\r' || ch === '\n') {
        if (ch === '\r') skipLF = true;
        out.push({ text: buf, t: startT ?? tMs });
        buf = '';
        startT = null;
        continue;
      }
      if (startT === null) startT = tMs;
      buf += ch;
      if (buf.length >= maxLine) {
        out.push({ text: buf, t: startT });
        buf = '';
        startT = null;
      }
    }
    return out;
  }

  function flush() {
    const tail = decoder.decode(); // emits U+FFFD for a truncated sequence, resets the decoder
    buf += tail;
    const out = buf.length ? [{ text: buf, t: startT ?? Date.now() }] : [];
    buf = '';
    startT = null;
    skipLF = false;
    return out;
  }

  function reset() {
    decoder = new TextDecoder('utf-8');
    buf = '';
    startT = null;
    skipLF = false;
  }

  return { push, flush, reset, partial: () => buf };
}

// ---------------------------------------------------------------------------------------
// Telemetry line parsing
// ---------------------------------------------------------------------------------------

const NUM_SRC = '[+-]?0[xX][0-9a-fA-F]+|[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?';
const NUM_FULL = new RegExp(`^(?:${NUM_SRC})$`);
const KV_RE = new RegExp(`([A-Za-z_][A-Za-z0-9_.\\-]*)\\s*[:=]\\s*(${NUM_SRC})`, 'g');

const IGNORED_PREFIXES = ['rst:', 'boot:', '=>', 'Hit any key', '[SYS]', '[WiFi]', 'starting'];

/** Parse one numeric token (decimal, scientific, or 0x hex). Returns NaN when not numeric. */
export function parseNumberToken(tok) {
  const s = String(tok).trim();
  if (!NUM_FULL.test(s)) return NaN;
  const m = /^([+-]?)0[xX]([0-9a-fA-F]+)$/.exec(s);
  if (m) {
    const n = parseInt(m[2], 16);
    return m[1] === '-' ? -n : n;
  }
  return Number(s);
}

function flattenJson(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'number' && Number.isFinite(v)) out.push([key, v]);
    else if (typeof v === 'string' && v.trim() && Number.isFinite(parseNumberToken(v))) out.push([key, parseNumberToken(v)]);
    else if (v && typeof v === 'object' && !Array.isArray(v)) flattenJson(v, key, out);
  }
}

function normalizeDelimiter(d) {
  if (!d) return '';
  if (d === '\\t' || d.toLowerCase() === 'tab') return '\t';
  if (d.toLowerCase() === 'space') return ' ';
  return d;
}

/**
 * parseTelemetryLine(line, { delimiter }) ->
 *   { kind: 'json'|'kv'|'csv', labels: string[]|null, values: number[], tag?: string } | null
 *
 * Formats: JSON object, `key=value` / `key:value` pairs (at least 40 % of the line, so prose
 * is not mistaken for data; scientific notation and 0x hex accepted), `$TAG,v1,v2,...`,
 * and plain numeric rows separated by comma / semicolon / space / tab (or `delimiter`).
 * `labels` is null when the format carries no names (CSV rows).
 */
export function parseTelemetryLine(line, opts = {}) {
  if (typeof line !== 'string') return null;
  const clean = line.trim();
  if (!clean) return null;
  if (IGNORED_PREFIXES.some((p) => clean.startsWith(p))) return null;
  const delimiter = normalizeDelimiter(opts.delimiter);

  // 1. JSON object
  if (clean.startsWith('{') && clean.endsWith('}')) {
    try {
      const obj = JSON.parse(clean);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const pairs = [];
        flattenJson(obj, '', pairs);
        if (pairs.length) return { kind: 'json', labels: pairs.map((p) => p[0]), values: pairs.map((p) => p[1]) };
      }
    } catch { /* not JSON, fall through */ }
  }

  // 2. key=value / key:value pairs (skipped when a custom delimiter is configured)
  if (!delimiter) {
    const matches = [...clean.matchAll(KV_RE)];
    if (matches.length) {
      const covered = matches.reduce((a, m) => a + m[0].length, 0);
      if (covered >= clean.length * 0.4) {
        return {
          kind: 'kv',
          labels: matches.map((m) => m[1]),
          values: matches.map((m) => parseNumberToken(m[2]))
        };
      }
    }
  }

  // 3. $TAG,CSV and plain numeric rows
  let body = clean;
  let tag;
  const tm = /^\$([A-Za-z0-9_]+),/.exec(body);
  if (tm) { tag = tm[1]; body = body.slice(tm[0].length); }
  const tokens = delimiter
    ? body.split(delimiter).map((t) => t.trim())
    : body.split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return null;
  const values = tokens.map((t) => parseNumberToken(t));
  const allNumeric = values.every((v) => Number.isFinite(v));
  if (delimiter ? !values.some((v) => Number.isFinite(v)) : !allNumeric) return null;
  const out = { kind: 'csv', labels: null, values };
  if (tag) out.tag = tag;
  return out;
}
