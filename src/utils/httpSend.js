// Shared send path for the HTTP workbenches (Repeater, Intruder, API client):
// true byte accounting, text/binary detection, hex view, cancel + timeout.

import { proxiedFetch } from './netClient';

export const DEFAULT_TIMEOUT_MS = 30000;

/** Real UTF-8 byte length of a string (not UTF-16 code units). */
export function byteLength(str) {
  return new TextEncoder().encode(String(str ?? '')).length;
}

const TEXT_CT = /^(text\/|application\/(json|xml|javascript|x-javascript|ecmascript|x-www-form-urlencoded|x-ndjson|graphql|yaml|x-yaml|soap\+xml|xhtml\+xml)|image\/svg\+xml)|\+(json|xml)\b/i;
const BINARY_CT = /^(image\/(?!svg)|audio\/|video\/|font\/|application\/(octet-stream|pdf|zip|gzip|x-gzip|x-tar|x-7z|x-rar|java-archive|wasm|x-protobuf|vnd\.))/i;

/**
 * Decide text vs binary. A declared content type wins when it is clearly one or
 * the other; otherwise the bytes must be valid UTF-8 with no NUL bytes.
 */
export function isBinaryContent(contentType, bytes) {
  const ct = String(contentType || '').split(';')[0].trim();
  if (ct && TEXT_CT.test(ct)) return false;
  if (ct && BINARY_CT.test(ct)) return true;
  if (!bytes || bytes.length === 0) return false;
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return true;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes.length > 1048576 ? bytes.subarray(0, 1048576) : bytes); return false; }
  catch { return true; }
}

/** Classic offset / hex / ASCII dump of bytes. */
export function hexDumpBytes(bytes, max = 8192) {
  const view = bytes.subarray(0, max);
  const rows = [];
  for (let i = 0; i < view.length; i += 16) {
    const slice = view.subarray(i, i + 16);
    const hex = Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
    rows.push(`${i.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return rows.join('\n') + (bytes.length > max ? `\n… truncated (${bytes.length - max} more bytes) …` : '');
}

/** Read a Response fully as bytes and describe it. */
export async function readResponse(resp) {
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const headers = [...resp.headers.entries()];
  const contentType = resp.headers.get('content-type') || '';
  const binary = isBinaryContent(contentType, bytes);
  return {
    status: resp.status,
    statusText: resp.statusText,
    headers,
    contentType,
    bytes,
    size: bytes.length,
    isBinary: binary,
    body: binary ? '' : new TextDecoder('utf-8').decode(bytes),
  };
}

/**
 * Send a request through the configured proxy with a timeout and an optional
 * external AbortSignal (Cancel button). Resolves to the readResponse() shape plus
 * timeMs. Rejects with Error name 'AbortError' (cancelled) or 'TimeoutError'.
 */
export async function sendHttp(url, options = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = proxiedFetch } = {}) {
  const ctrl = new AbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs) : null;
  const start = performance.now();
  try {
    const resp = await fetchImpl(url, { ...options, signal: ctrl.signal });
    const res = await readResponse(resp);
    res.timeMs = Math.round(performance.now() - start);
    return res;
  } catch (e) {
    if (timedOut) { const err = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`); err.name = 'TimeoutError'; throw err; }
    if (ctrl.signal.aborted || e?.name === 'AbortError') { const err = new Error('Request cancelled'); err.name = 'AbortError'; throw err; }
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

/** Parse a seconds field to ms; falls back to the default for junk, 0 disables. */
export function timeoutFromSeconds(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) : DEFAULT_TIMEOUT_MS;
}

/** CSV with quoting and a guard against spreadsheet formula injection. */
export function toCsv(header, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
}

/** Trigger a browser download of bytes/text. */
export function downloadBlob(data, filename, type = 'application/octet-stream') {
  const blob = new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
