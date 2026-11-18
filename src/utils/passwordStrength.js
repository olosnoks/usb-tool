// Local, offline password strength heuristics for the Pwned Passwords tool.
// Not zxcvbn: a small pattern-aware estimate (common words, sequences, keyboard
// walks, repeats, years) that only ever runs in the browser. Nothing is sent anywhere.

const COMMON = [
  'password', 'passw0rd', 'letmein', 'welcome', 'admin', 'administrator', 'login', 'qwerty', 'qwertyuiop', 'iloveyou',
  'monkey', 'dragon', 'football', 'baseball', 'master', 'sunshine', 'princess', 'shadow', 'superman', 'batman',
  'trustno1', 'hello', 'freedom', 'whatever', 'michael', 'jessica', 'charlie', 'secret', 'summer', 'winter',
  'spring', 'autumn', 'abcdef', 'changeme', 'default', 'guest', 'root', 'test', 'user', 'pass', 'google',
  'liverpool', 'chelsea', 'starwars', 'pokemon', 'computer', 'internet', 'killer', 'hunter', 'ranger', 'soccer',
];
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];
const LEET = { 0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };

export const CRACK_RATES = [
  ['Online, throttled (100/hour)', 100 / 3600],
  ['Online, unthrottled (10/s)', 10],
  ['Offline, slow hash (10k/s)', 1e4],
  ['Offline, fast hash (10 billion/s)', 1e10],
];

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'centuries';
  if (seconds < 1) return 'instantly';
  const units = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12], ['year', 100], ['century', Infinity]];
  let v = seconds;
  for (const [name, size] of units) {
    if (v < size) { const n = Math.round(v); return `${n} ${name}${n === 1 ? '' : 's'}`; }
    v /= size;
  }
  return 'centuries';
}

function poolSize(pw) {
  let p = 0;
  if (/[a-z]/.test(pw)) p += 26;
  if (/[A-Z]/.test(pw)) p += 26;
  if (/[0-9]/.test(pw)) p += 10;
  if (/[^A-Za-z0-9]/.test(pw)) p += 33;
  return p || 1;
}

/** Find pattern segments: { start, end, kind, bits }. end is exclusive. */
export function findPatterns(pw) {
  const out = [];
  const lower = pw.toLowerCase();
  const deleet = Array.from(lower).map((c) => LEET[c] || c).join('');
  for (const w of COMMON) {
    for (const text of new Set([lower, deleet])) {
      let i = text.indexOf(w);
      while (i >= 0) {
        out.push({ start: i, end: i + w.length, kind: 'common', bits: Math.log2(COMMON.length) + (text !== lower ? 2 : 0), word: w });
        i = text.indexOf(w, i + 1);
      }
    }
  }
  // repeats of a single char or a short block (aaaa, abab, 123123)
  for (const m of pw.matchAll(/(.+?)\1{1,}/g)) {
    out.push({ start: m.index, end: m.index + m[0].length, kind: 'repeat', bits: m[1].length * Math.log2(poolSize(m[1])) + Math.log2(m[0].length / m[1].length) + 1 });
  }
  // ascending / descending runs (abcd, 4321) of 3 or more
  let s = 0;
  for (let i = 1; i <= pw.length; i++) {
    const d = i < pw.length ? pw.charCodeAt(i) - pw.charCodeAt(i - 1) : 0;
    const d0 = i - 1 > s ? pw.charCodeAt(s + 1) - pw.charCodeAt(s) : d;
    if (i < pw.length && Math.abs(d) === 1 && (i - 1 === s || d === d0)) continue;
    if (i - s >= 3 && Math.abs(d0) === 1) out.push({ start: s, end: i, kind: 'sequence', bits: Math.log2(26) + Math.log2(i - s) + 1 });
    s = i;
  }
  // keyboard walks (qwerty, asdf, 7890), forward or reverse
  for (const row of ROWS) {
    for (const r of [row, [...row].reverse().join('')]) {
      for (let len = r.length; len >= 4; len--) {
        for (let a = 0; a + len <= r.length; a++) {
          const seg = r.slice(a, a + len);
          let i = lower.indexOf(seg);
          while (i >= 0) { out.push({ start: i, end: i + len, kind: 'keyboard', bits: Math.log2(40) + Math.log2(len) + 1 }); i = lower.indexOf(seg, i + 1); }
        }
      }
    }
  }
  // years 1900-2099
  for (const m of pw.matchAll(/(?<!\d)(19|20)\d{2}(?!\d)/g)) out.push({ start: m.index, end: m.index + 4, kind: 'year', bits: Math.log2(200) });
  return out;
}

/** Cheapest non-overlapping cover of the string (dynamic programming over positions). */
function estimateBits(pw, patterns) {
  const n = pw.length;
  const per = Math.log2(poolSize(pw));
  const best = new Array(n + 1).fill(Infinity);
  best[0] = 0;
  for (let i = 0; i < n; i++) {
    if (best[i] === Infinity) continue;
    best[i + 1] = Math.min(best[i + 1], best[i] + per);
    for (const p of patterns) if (p.start === i) best[p.end] = Math.min(best[p.end], best[i] + p.bits);
  }
  return best[n];
}

const KIND_TEXT = {
  common: 'Contains a very common password or word.',
  repeat: 'Contains repeated characters or blocks.',
  sequence: 'Contains a sequence such as abcd or 4321.',
  keyboard: 'Contains a keyboard pattern such as qwerty.',
  year: 'Contains a year, which is easy to guess.',
};

/** Analyse one password: { score 0-4, label, bits, length, crackTimes, warnings, suggestions }. */
export function analyzePassword(pw) {
  const s = String(pw ?? '');
  if (!s) return { score: 0, label: 'Empty', bits: 0, length: 0, crackTimes: [], warnings: [], suggestions: [] };
  const patterns = findPatterns(s);
  const bits = Math.max(1, estimateBits(s, patterns));
  const guesses = 2 ** Math.min(bits, 1000);
  const crackTimes = CRACK_RATES.map(([name, rate]) => ({ name, seconds: guesses / 2 / rate, text: formatDuration(guesses / 2 / rate) }));
  let score;
  if (bits < 28) score = 0;
  else if (bits < 40) score = 1;
  else if (bits < 56) score = 2;
  else if (bits < 72) score = 3;
  else score = 4;
  const warnings = [...new Set(patterns.map((p) => KIND_TEXT[p.kind]))];
  if (patterns.some((p) => p.kind === 'common' && p.end - p.start >= Math.max(1, s.length - 3))) warnings.unshift('Mostly a common password: attackers try these first.');
  const suggestions = [];
  if (s.length < 12) suggestions.push('Use at least 12 characters; length matters most.');
  if (patterns.length) suggestions.push('Avoid dictionary words, sequences and keyboard patterns.');
  if (patterns.some((p) => p.kind === 'common')) suggestions.push('Letter swaps like a for @ barely help; attackers try them.');
  if (score < 3) suggestions.push('Use a password manager to generate a random password, or a passphrase of 4 or more unrelated words.');
  return { score, label: ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][score], bits: Math.round(bits), length: Array.from(s).length, crackTimes, warnings, suggestions };
}

/** Batch summary: counts by score plus how many are weak (score below 2). */
export function summarizeStrength(analyses) {
  const byScore = [0, 0, 0, 0, 0];
  for (const a of analyses) if (a) byScore[a.score]++;
  return { byScore, weak: byScore[0] + byScore[1], total: byScore.reduce((x, y) => x + y, 0) };
}

/** What the k-anonymity request reveals for a hash: the 5-character prefix only. */
export function requestPreview(hash, mode = 'sha1') {
  const h = String(hash).toUpperCase();
  return { prefix: h.slice(0, 5), url: `https://api.pwnedpasswords.com/range/${h.slice(0, 5)}${mode === 'ntlm' ? '?mode=ntlm' : ''}`, keptLocal: h.length - 5 };
}
