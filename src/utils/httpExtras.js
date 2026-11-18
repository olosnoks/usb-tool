// Pure helpers for the HTTP Workbench Repeater: variables, JSON path extraction, extra "copy as" formats.
import { shQuote, headerPairs } from './httpImport';

/** "NAME=value" lines -> { NAME: value }. Blank lines and #comments are ignored. */
export function parseVars(text) {
  const out = {};
  String(text || '').split('\n').forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i > 0) out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  });
  return out;
}

/** Replace {{NAME}} with its value; unknown names are left untouched (so Intruder markers survive). */
export function substituteVars(text, vars) {
  return String(text ?? '').replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars || {}, k) ? vars[k] : m));
}

/** Names used as {{NAME}} that have no value. */
export function missingVars(texts, vars) {
  const miss = new Set();
  texts.forEach((t) => String(t ?? '').replace(/\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g, (m, k) => { if (!Object.prototype.hasOwnProperty.call(vars || {}, k)) miss.add(k); return m; }));
  return [...miss];
}

/**
 * Minimal JSON path: `a.b[0].c`, `$.a["b c"]`, `items[*].id` (wildcard returns an array).
 * Returns { ok, value } or { ok:false, error }.
 */
export function jsonPath(data, path) {
  const p = String(path || '').trim().replace(/^\$\.?/, '');
  if (!p) return { ok: true, value: data };
  const tokens = [];
  const re = /\.?([^.[\]]+)|\[(\d+|\*|"[^"]*"|'[^']*')\]/g;
  let m; let last = 0;
  while ((m = re.exec(p))) {
    if (m.index !== last) return { ok: false, error: `Bad path near "${p.slice(last)}"` };
    last = re.lastIndex;
    if (m[1] !== undefined) tokens.push(m[1]);
    else if (m[2] === '*') tokens.push({ wild: true });
    else if (/^\d+$/.test(m[2])) tokens.push(Number(m[2]));
    else tokens.push(m[2].slice(1, -1));
  }
  if (last !== p.length) return { ok: false, error: `Bad path near "${p.slice(last)}"` };
  let cur = [data];
  let multi = false;
  for (const t of tokens) {
    const next = [];
    for (const v of cur) {
      if (t && t.wild) { multi = true; if (Array.isArray(v)) next.push(...v); else if (v && typeof v === 'object') next.push(...Object.values(v)); }
      else if (v != null && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, t)) next.push(v[t]);
    }
    cur = next;
    if (!cur.length) return { ok: false, error: 'No match' };
  }
  return { ok: true, value: multi ? cur : cur[0] };
}

/** Parse a JSON string and apply a path; value rendered as a string for use as a variable. */
export function extractFromJson(bodyText, path) {
  let data;
  try { data = JSON.parse(bodyText); } catch { return { ok: false, error: 'Response body is not JSON' }; }
  const r = jsonPath(data, path);
  if (!r.ok) return r;
  const v = r.value;
  return { ok: true, value: v, text: typeof v === 'string' ? v : JSON.stringify(v) };
}

const hasBody = (method, body) => !!body && method !== 'GET' && method !== 'HEAD';

/** Raw HTTP/1.1 message text. */
export function toRawHttp({ method, url, headers, body }) {
  let u;
  try { u = new URL(url); } catch { u = null; }
  const pairs = headerPairs(headers);
  const lines = [`${method} ${u ? u.pathname + u.search : url} HTTP/1.1`];
  if (u && !pairs.some(([k]) => k.toLowerCase() === 'host')) lines.push(`Host: ${u.host}`);
  pairs.forEach(([k, v]) => lines.push(`${k}: ${v}`));
  return lines.join('\r\n') + '\r\n\r\n' + (hasBody(method, body) ? body : '');
}

/** HTTPie command (an export for the CLI tool; not run here). */
export function toHttpie({ method, url, headers, body }) {
  const parts = ['http'];
  if (hasBody(method, body)) parts.push('--raw', shQuote(body));
  parts.push(method, shQuote(url));
  headerPairs(headers).forEach(([k, v]) => parts.push(shQuote(`${k}:${v}`)));
  return parts.join(' ');
}

/** Go net/http snippet. */
export function toGo({ method, url, headers, body }) {
  const q = (v) => JSON.stringify(String(v ?? ''));
  const withBody = hasBody(method, body);
  const lines = ['package main', '', 'import (', '\t"fmt"', '\t"io"', '\t"net/http"', ...(withBody ? ['\t"strings"'] : []), ')', '', 'func main() {',
    `\treq, _ := http.NewRequest(${q(method)}, ${q(url)}, ${withBody ? `strings.NewReader(${q(body)})` : 'nil'})`];
  headerPairs(headers).forEach(([k, v]) => lines.push(`\treq.Header.Set(${q(k)}, ${q(v)})`));
  lines.push('\tresp, err := http.DefaultClient.Do(req)', '\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer resp.Body.Close()', '\tb, _ := io.ReadAll(resp.Body)', '\tfmt.Println(resp.Status)', '\tfmt.Println(string(b))', '}');
  return lines.join('\n');
}
