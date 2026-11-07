// Password-audit / CTF hash-cracking engine (browser, client-side). Supports
// several hashcat-style hash modes, three attack modes (dictionary, rule-based,
// mask/brute-force), optional salts and multi-hash "potfile" cracking.
//
// Pure/deterministic helpers (hash functions, rule expansion, mask keyspace and
// iteration) live here and are unit-tested. The component drives the async loop.

import { md5Hex } from './md5';
import { md4Hex } from './md4';

const te = new TextEncoder();
function utf16le(str) {
  const out = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); out[i * 2] = c & 0xff; out[i * 2 + 1] = (c >> 8) & 0xff; }
  return out;
}
function hex(buf) { return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function subtle(alg, bytes) { return hex(await crypto.subtle.digest(alg, bytes)); }
async function subtleRaw(alg, bytes) { return new Uint8Array(await crypto.subtle.digest(alg, bytes)); }

/** Hashcat-style hash modes available in the browser. */
export const HASH_MODES = [
  { id: 'md5', code: 0, label: 'MD5' },
  { id: 'sha1', code: 100, label: 'SHA-1' },
  { id: 'sha256', code: 1400, label: 'SHA-256' },
  { id: 'sha384', code: 10800, label: 'SHA-384' },
  { id: 'sha512', code: 1700, label: 'SHA-512' },
  { id: 'ntlm', code: 1000, label: 'NTLM' },
  { id: 'md5md5', code: 2600, label: 'md5(md5($pass))' },
  { id: 'mysql41', code: 300, label: 'MySQL4.1+ (sha1(sha1_raw))' },
  { id: 'md5ps', code: 10, label: 'md5($pass.$salt)', salt: true },
  { id: 'md5sp', code: 20, label: 'md5($salt.$pass)', salt: true },
  { id: 'sha1ps', code: 110, label: 'sha1($pass.$salt)', salt: true },
  { id: 'sha1sp', code: 120, label: 'sha1($salt.$pass)', salt: true },
  { id: 'sha256ps', code: 1410, label: 'sha256($pass.$salt)', salt: true },
];

const SUBTLE = { sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };

/** Compute one hash (lowercase hex) for a password under the given mode + salt. */
export async function hashOne(mode, password, salt = '') {
  switch (mode) {
    case 'md5': return md5Hex(te.encode(password));
    case 'md5md5': return md5Hex(te.encode(md5Hex(te.encode(password))));
    case 'ntlm': return md4Hex(utf16le(password));
    case 'sha1': return subtle('SHA-1', te.encode(password));
    case 'sha256': return subtle('SHA-256', te.encode(password));
    case 'sha384': return subtle('SHA-384', te.encode(password));
    case 'sha512': return subtle('SHA-512', te.encode(password));
    case 'mysql41': return subtle('SHA-1', await subtleRaw('SHA-1', te.encode(password)));
    case 'md5ps': return md5Hex(te.encode(password + salt));
    case 'md5sp': return md5Hex(te.encode(salt + password));
    case 'sha1ps': return subtle('SHA-1', te.encode(password + salt));
    case 'sha1sp': return subtle('SHA-1', te.encode(salt + password));
    case 'sha256ps': return subtle('SHA-256', te.encode(password + salt));
    default: throw new Error(`Unknown mode: ${mode}`);
  }
}

/** Normalize a target hash for comparison (lowercase, trim, strip MySQL '*'). */
export function normalizeHash(h) {
  return String(h).trim().toLowerCase().replace(/^\*/, '');
}

// ---------- Rule-based expansion (a compact best64-style set) ----------

const LEET = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7' };
const SUFFIXES = ['1', '2', '12', '123', '1234', '!', '!!', '123!', '12345', '007', '01', '69', '2023', '2024', '2025', '#1', '@'];

function leet(w) { return w.replace(/[aeiost]/gi, (c) => LEET[c.toLowerCase()] || c); }
function cap(w) { return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w; }
function toggle(w) { return w.split('').map((c, i) => (i % 2 ? c.toLowerCase() : c.toUpperCase())).join(''); }

/**
 * Expand one base word into candidate variants for a rule set.
 * Returns a de-duplicated array (the base word first).
 */
export function expandRules(word, setId) {
  if (!word) return [];
  if (setId === 'none') return [word];
  const out = new Set([word]);
  if (setId === 'case' || setId === 'best64') {
    out.add(word.toLowerCase()); out.add(word.toUpperCase()); out.add(cap(word)); out.add(toggle(word));
    out.add(word.split('').reverse().join(''));
  }
  if (setId === 'leet' || setId === 'best64') {
    out.add(leet(word)); out.add(leet(cap(word)));
  }
  if (setId === 'append' || setId === 'best64') {
    for (const s of SUFFIXES) { out.add(word + s); out.add(cap(word) + s); }
    for (let d = 0; d <= 9; d++) out.add(word + d);
    out.add(word + word);
  }
  return [...out];
}

export const RULE_SETS = [
  { id: 'none', label: 'None (straight dictionary)' },
  { id: 'case', label: 'Case & reverse' },
  { id: 'leet', label: 'Leetspeak' },
  { id: 'append', label: 'Append digits & suffixes' },
  { id: 'best64', label: 'best64-lite (all of the above)' },
];

/** Rough average number of candidates a rule set yields per base word. */
export function ruleMultiplier(setId) {
  return expandRules('password', setId).length;
}

// ---------- Mask / brute-force (hashcat -a 3) ----------

const CHARSET = {
  l: 'abcdefghijklmnopqrstuvwxyz',
  u: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  d: '0123456789',
  s: ' !"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
};
CHARSET.a = CHARSET.l + CHARSET.u + CHARSET.d + CHARSET.s;

/** Parse a mask like "?l?l?d?d" or "admin?d?d" into an array of charset strings. */
export function parseMask(mask) {
  const sets = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === '?' && i + 1 < mask.length) {
      const t = mask[i + 1];
      if (CHARSET[t]) { sets.push(CHARSET[t]); i++; continue; }
      if (t === '?') { sets.push('?'); i++; continue; } // literal ?
    }
    sets.push(mask[i]); // literal char
  }
  return sets;
}

/** Total keyspace of a parsed mask (product of position sizes). */
export function maskKeyspace(sets) {
  return sets.reduce((acc, s) => acc * s.length, 1);
}

/**
 * Generator over all candidates of a parsed mask, in odometer order.
 * Bounded by maskKeyspace; callers should check the count first.
 */
export function* maskCandidates(sets) {
  const n = sets.length;
  if (n === 0) return;
  const idx = new Array(n).fill(0);
  const total = maskKeyspace(sets);
  for (let count = 0; count < total; count++) {
    let s = '';
    for (let i = 0; i < n; i++) s += sets[i][idx[i]];
    yield s;
    // increment odometer (last position fastest)
    for (let i = n - 1; i >= 0; i--) { if (++idx[i] < sets[i].length) break; idx[i] = 0; }
  }
}
