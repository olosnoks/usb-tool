/**
 * sessionLogFilter.js: pure helpers for the Session Log panel.
 * Search-query parsing (text, /regex/, -negation, tool: and level: keys),
 * time-window filtering, per-level counts and CSV export.
 */
import { redactEntries } from './sessionLog';

/**
 * Split a query into terms. Space-separated terms are ANDed. Supported:
 *   word        substring (case-insensitive)
 *   "a phrase"  quoted substring
 *   /re/        regular expression (case-insensitive); /re/s is also accepted
 *   -term       negate any term
 *   tool:name   tool name contains name
 *   level:warn  exact level
 * An invalid regex is reported in `error` and ignored.
 */
export function parseQuery(input) {
  const terms = [];
  let error = '';
  const src = String(input ?? '').trim();
  const re = /(-?)(?:(tool|level):)?(?:"([^"]*)"|(\/(?:\\.|[^/\\])+\/[a-z]*)|(\S+))/gi;
  let m;
  while ((m = re.exec(src))) {
    const neg = m[1] === '-';
    const key = m[2] ? m[2].toLowerCase() : null;
    if (m[4] && !key) {
      const last = m[4].lastIndexOf('/');
      try {
        terms.push({ neg, kind: 'regex', re: new RegExp(m[4].slice(1, last), 'i') });
      } catch (e) {
        error = `Invalid regex ${m[4]}: ${e.message}`;
      }
      continue;
    }
    const value = (m[3] ?? m[4] ?? m[5] ?? '').toLowerCase();
    if (!value) continue;
    terms.push({ neg, kind: key || 'text', value });
  }
  return { terms, error };
}

function termMatches(t, e) {
  if (t.kind === 'regex') return t.re.test(e.text) || t.re.test(e.tool);
  if (t.kind === 'tool') return String(e.tool).toLowerCase().includes(t.value);
  if (t.kind === 'level') return e.level === t.value;
  return String(e.text).toLowerCase().includes(t.value);
}

export function matchesQuery(entry, parsed) {
  return parsed.terms.every((t) => termMatches(t, entry) !== t.neg);
}

/** Keep entries newer than `minutes` before `now` (0 or falsy = all). */
export function withinMinutes(list, minutes, now = Date.now()) {
  if (!minutes) return list;
  const cutoff = now - minutes * 60000;
  return list.filter((e) => e.t >= cutoff);
}

/** Entries per level, counting folded repeats. */
export function levelCounts(list) {
  const out = {};
  list.forEach((e) => { out[e.level] = (out[e.level] || 0) + (e.count || 1); });
  return out;
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) || /^[=+\-@\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * CSV with a header row: time (ISO), seq, tool, level, count, text.
 * Text cells starting with = + - @ get a leading apostrophe so spreadsheets do not read them as formulas. Redacted unless `redactOptions` is false.
 */
export function exportCsv(list, redactOptions = {}) {
  const rows = redactOptions === false ? list : redactEntries(list, redactOptions);
  const safe = (s) => (/^[=+\-@\t]/.test(String(s)) ? `'${s}` : s);
  const lines = ['time,seq,tool,level,count,text'];
  rows.forEach((e) => {
    lines.push([new Date(e.t).toISOString(), e.seq ?? '', e.tool, e.level, e.count || 1, safe(e.text)].map(csvCell).join(','));
  });
  return `${lines.join('\r\n')}\r\n`;
}
