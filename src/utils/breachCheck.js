import { md4Hex } from './md4.js';
// Pure helpers for the breach-exposure checker (email + catalog tabs).
// These services only report WHICH breaches an address appears in, never the data.

export const MAX_EMAILS = 20;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export const isValidEmail = (e) => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);

/** Mask for logs/tables: j•••@example.com. */
export function maskEmail(email) {
  const s = String(email);
  const at = s.lastIndexOf('@');
  if (at < 1) return `${s.slice(0, 1)}•••`;
  return `${Array.from(s.slice(0, at))[0]}•••${s.slice(at)}`;
}

/** Split textarea input into unique, validated emails. */
export function parseEmailInput(text, max = MAX_EMAILS) {
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const e = raw.trim();
    if (!e) continue;
    const k = e.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    (isValidEmail(e) ? valid : invalid).push(e);
  }
  const tooMany = valid.length > max;
  return { valid: valid.slice(0, max), invalid, tooMany, total: valid.length };
}

const dateOnly = (d) => (d ? String(d).slice(0, 10) : '');

/** Normalise an XposedOrNot /v1/breaches body into a lookup keyed by breachID (lowercase). */
export function parseXonCatalog(body) {
  const map = {};
  for (const b of body?.exposedBreaches || []) {
    if (!b?.breachID) continue;
    map[String(b.breachID).toLowerCase()] = {
      name: b.breachID,
      domain: b.domain || '',
      date: dateOnly(b.breachedDate),
      dataClasses: Array.isArray(b.exposedData) ? b.exposedData : [],
      verified: b.verified === true,
      records: b.exposedRecords ?? null,
    };
  }
  return map;
}

/** XposedOrNot /v1/check-email body -> list of breach names (it nests them one level). */
export function parseXonCheck(body) {
  const first = body?.breaches;
  const names = Array.isArray(first) ? first.flat() : [];
  return names.filter((n) => typeof n === 'string');
}

/** Combine check names with the catalog (if loaded) into display rows. */
export function xonRows(names, catalog = {}) {
  return names.map((n) => catalog[n.toLowerCase()] || { name: n, domain: '', date: '', dataClasses: [], verified: null, records: null });
}

/** HIBP breach (full or truncated) -> display row. Truncated has only Name. */
export function parseHibpBreach(b) {
  return {
    name: b?.Name || b?.Title || '',
    domain: b?.Domain || '',
    date: dateOnly(b?.BreachDate),
    dataClasses: Array.isArray(b?.DataClasses) ? b.DataClasses : [],
    verified: typeof b?.IsVerified === 'boolean' ? b.IsVerified : null,
    records: b?.PwnCount ?? null,
  };
}

export const parseHibpAccount = (body) => (Array.isArray(body) ? body.map(parseHibpBreach) : []);

/** Catalog entry for the HIBP breach list (adds title/description text, HTML stripped). */
export function parseHibpCatalog(body) {
  if (!Array.isArray(body)) return [];
  return body.map((b) => ({
    ...parseHibpBreach(b),
    title: b.Title || b.Name || '',
    description: String(b.Description || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
    sensitive: !!b.IsSensitive,
  }));
}

/** Case-insensitive name/title/domain filter. */
export function filterCatalog(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((b) => b.name.toLowerCase().includes(q) || (b.title || '').toLowerCase().includes(q) || b.domain.toLowerCase().includes(q));
}

/** Plain-language message for an upstream HTTP status. */
export function statusMessage(service, status) {
  if (status === 429) return `${service} rate limit reached (HTTP 429). Wait a minute and retry with fewer addresses.`;
  if (status === 401) return `${service} rejected the API key (HTTP 401). Check the saved key.`;
  if (status === 403) return `${service} refused the request (HTTP 403).`;
  if (status >= 500) return `${service} is having problems (HTTP ${status}). Try again later.`;
  return `${service} returned HTTP ${status}.`;
}

// ---------------------------------------------------------------------------
// Pwned Passwords (k-anonymity range API). Plaintext never leaves the browser
// and is never logged: only the first 5 hex characters of the hash are sent.
// ---------------------------------------------------------------------------

export const MAX_PASSWORD_ENTRIES = 5000;

/** Masked form for logs/tables: first char + bullets + length. Never the plaintext. */
export function maskPassword(pwd) {
  const chars = Array.from(String(pwd));
  return `${chars[0] || ''}•••(${chars.length})`;
}

const toHexUpper = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

export async function sha1Upper(text) {
  return toHexUpper(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text)));
}

/** NTLM hash (MD4 of UTF-16LE), uppercase hex. Used only to query the HIBP NTLM range API. */
export function ntlmUpper(text) {
  const s = String(text);
  const bytes = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes[i * 2] = c & 0xff;
    bytes[i * 2 + 1] = c >> 8;
  }
  return md4Hex(bytes).toUpperCase();
}

/** Valid hash lines for direct-hash input: SHA-1 (40 hex) or NTLM (32 hex), deduplicated, uppercased. */
export function parseHashList(text, mode) {
  const len = mode === 'ntlm' ? 32 : 40;
  const seen = new Set();
  const valid = [];
  const invalid = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const h = raw.trim().toUpperCase();
    if (!h) continue;
    if (!new RegExp(`^[0-9A-F]{${len}}$`).test(h)) { invalid.push(raw.trim().slice(0, 12)); continue; }
    if (seen.has(h)) continue;
    seen.add(h);
    valid.push(h);
  }
  return { valid, invalid };
}

/** Parse a range response ("SUFFIX:COUNT" lines, padding rows have count 0) into a Map. */
export function parseRangeBody(txt) {
  const map = new Map();
  for (const line of String(txt).split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const count = parseInt(line.slice(i + 1), 10);
    map.set(line.slice(0, i).trim().toUpperCase(), Number.isFinite(count) ? count : 0);
  }
  return map;
}

/** Builds fetchRange(prefix, mode, signal) -> text on top of a fetch-like function. Always sends Add-Padding. */
export function makeRangeFetcher(fetchImpl) {
  return async (prefix, mode, signal) => {
    const url = `https://api.pwnedpasswords.com/range/${prefix}${mode === 'ntlm' ? '?mode=ntlm' : ''}`;
    const resp = await fetchImpl(url, { headers: { 'Add-Padding': 'true' }, signal });
    if (!resp.ok) throw new Error(statusMessage('Pwned Passwords', resp.status));
    return resp.text();
  };
}

/**
 * Check entries against the range API. entry = { site?, username?, password? | hash? }.
 * One request per distinct 5-char prefix (per-run cache), sequential, abortable.
 * Results never contain the plaintext: { index, site, username, masked, count, error?, reuse }.
 * `reuse` is how many entries in this run share the same password/hash.
 */
export async function checkEntries(entries, { mode = 'sha1', fetchRange, signal, onProgress, cache = new Map() } = {}) {
  const hashes = [];
  for (const e of entries) {
    if (e.hash) hashes.push(String(e.hash).toUpperCase());
    else hashes.push(mode === 'ntlm' ? ntlmUpper(e.password ?? '') : await sha1Upper(e.password ?? ''));
  }
  const reuseCount = new Map();
  hashes.forEach((h) => reuseCount.set(h, (reuseCount.get(h) || 0) + 1));

  const failed = new Map(); // prefix -> error message, so one outage is not retried per row
  const results = [];
  let requests = 0;
  let cancelled = false;
  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) { cancelled = true; break; }
    const e = entries[i];
    const hash = hashes[i];
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);
    const row = {
      index: i,
      site: e.site || '',
      username: e.username || '',
      masked: e.hash ? `${hash.slice(0, 5)}…` : maskPassword(e.password ?? ''),
      count: 0,
      reuse: reuseCount.get(hash) || 1,
    };
    try {
      if (failed.has(prefix)) throw new Error(failed.get(prefix));
      let table = cache.get(prefix);
      if (!table) {
        table = parseRangeBody(await fetchRange(prefix, mode, signal));
        requests++;
        cache.set(prefix, table);
      }
      row.count = table.get(suffix) || 0;
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') { cancelled = true; break; }
      const msg = err?.message || String(err);
      failed.set(prefix, msg);
      row.count = -1;
      row.error = msg;
    }
    results.push(row);
    onProgress?.({ done: results.length, total: entries.length, requests, row });
  }
  return { results, requests, cancelled };
}

// ---- password-manager CSV import ----

/** RFC 4180 CSV parser: quoted fields, doubled quotes, embedded newlines, BOM. */
export function parseCsv(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.length > 1 || row[0] !== '') rows.push(row); }
  return rows;
}

const hostOf = (u) => {
  const first = String(u || '').split(/\s+/)[0];
  if (!first) return '';
  try { return new URL(first.includes('://') ? first : `https://${first}`).hostname; } catch { return first.slice(0, 60); }
};

/**
 * Parse a Bitwarden, 1Password, Chrome or Firefox password export.
 * Returns { format, entries: [{site, username, password}], skipped, error }.
 */
export function parsePasswordCsv(text, max = MAX_PASSWORD_ENTRIES) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { format: '', entries: [], skipped: 0, error: 'The file has no data rows.' };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const pw = col(['login_password', 'password']);
  if (pw < 0) return { format: '', entries: [], skipped: 0, error: 'No password column found. Expected a Bitwarden, 1Password, Chrome or Firefox export.' };
  const user = col(['login_username', 'username', 'user name', 'login']);
  const name = col(['name', 'title']);
  const url = col(['login_uri', 'url', 'website', 'web site']);
  const type = col(['type']);
  let format = 'CSV';
  if (header.includes('login_password')) format = 'Bitwarden';
  else if (header.includes('httprealm') || header.includes('guid') || header.includes('formactionorigin')) format = 'Firefox';
  else if (header.includes('title')) format = '1Password';
  else if (header.includes('name') && header.includes('url')) format = 'Chrome';
  const entries = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const password = r[pw] ?? '';
    if (!password || (type >= 0 && format === 'Bitwarden' && r[type] && r[type].toLowerCase() !== 'login')) { skipped++; continue; }
    if (entries.length >= max) { skipped++; continue; }
    entries.push({
      site: (name >= 0 && r[name]) || hostOf(url >= 0 ? r[url] : '') || '',
      username: user >= 0 ? r[user] || '' : '',
      password,
    });
  }
  return { format, entries, skipped, error: entries.length ? '' : 'No rows with a password were found.' };
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV of masked results: never the password. */
export function resultsToCsv(results) {
  const lines = [['site', 'username', 'password_masked', 'breach_count', 'status', 'reused_in_entries'].join(',')];
  for (const r of results) {
    const status = r.count < 0 ? 'error' : r.count > 0 ? 'compromised' : 'not found';
    lines.push([r.site, r.username, r.masked, r.count < 0 ? '' : r.count, status, r.reuse > 1 ? r.reuse : ''].map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** Newest breach first (by date, undated last); stable for equal dates. */
export function sortCatalogNewest(list) {
  return list
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (y.b.date || '').localeCompare(x.b.date || '') || x.i - y.i)
    .map((x) => x.b);
}

export const CATALOG_PAGE = 50;

/** Probe the same-origin /api/hibp relay without a key or any email: a live relay answers 401 asking for the key. */
export async function hibpRelayAvailable(fetchImpl = fetch) {
  try {
    const r = await fetchImpl('/api/hibp/breachedaccount/probe%40example.com');
    if (r.status !== 401) return false;
    return /hibp-api-key/i.test(await r.text());
  } catch { return false; }
}
