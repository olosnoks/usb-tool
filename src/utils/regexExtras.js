// Pure helpers for the Regex tester extras: a static backtracking-risk lint,
// match-list export (JSON / CSV / lines) and simple match statistics.
// Client-side only; no network.

/**
 * Static heuristics for patterns that can backtrack badly. This is a hint, not
 * a proof: it can miss risky patterns and flag safe ones. Returns
 * [{ id, severity: 'warn'|'info', message }].
 */
export function lintPattern(pattern) {
  const src = String(pattern ?? '');
  const out = [];
  if (!src) return out;
  // Neutralise escapes and class contents so their characters do not look like syntax.
  const flat = src.replace(/\\./g, 'x').replace(/\[(?:[^\]\\]|\\.)*\]/g, 'x');
  const add = (id, severity, message) => { if (!out.some((o) => o.id === id)) out.push({ id, severity, message }); };
  const stack = [];
  for (let i = 0; i < flat.length; i++) {
    const c = flat[i];
    if (c === '(') stack.push({ start: i, inner: false, alt: false });
    else if (c === '|' && stack.length) stack[stack.length - 1].alt = true;
    else if ((c === '*' || c === '+' || (c === '{' && /^\{\d+,\d*\}/.test(flat.slice(i)))) && stack.length) {
      for (const g of stack) g.inner = true;
    } else if (c === ')' && stack.length) {
      const g = stack.pop();
      const repeated = /^(?:[*+]|\{\d+,\d*\})/.test(flat.slice(i + 1));
      if (!repeated) continue;
      if (g.inner) add('nested-quantifier', 'warn', 'Nested unbounded quantifier such as (a+)+ can backtrack exponentially on a failing match.');
      if (g.alt) {
        const body = flat.slice(g.start + 1, i).replace(/^\?(?:[:=!]|<[=!]|<[A-Za-z_]\w*>)/, '');
        const parts = body.split('|');
        if (parts.some((p) => p === '') || new Set(parts).size !== parts.length) {
          add('quantified-alternation', 'warn', 'A repeated group with empty or duplicate alternatives can match the same text in many ways.');
        }
      }
    }
  }
  if (/\.[*+].*\.[*+]/.test(flat)) {
    add('adjacent-wildcards', 'info', 'Several .* or .+ in one pattern can be slow on long text; prefer specific classes or lazy quantifiers.');
  }
  return out;
}

const csvCell = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Format a match list. format: 'json' | 'csv' | 'lines' | 'unique'.
 * matches are runMatch() results ({index,text,groups,named}).
 */
export function exportMatches(matches, format = 'json') {
  const list = Array.isArray(matches) ? matches : [];
  if (format === 'lines') return list.map((m) => m.text).join('\n');
  if (format === 'unique') return [...new Set(list.map((m) => m.text))].join('\n');
  if (format === 'csv') {
    const width = list.reduce((n, m) => Math.max(n, (m.groups || []).length), 0);
    const head = ['#', 'text', 'index', 'length', ...Array.from({ length: width }, (_, k) => `group${k + 1}`)];
    const body = list.map((m, i) => [
      i + 1, m.text, m.index, m.length ?? m.text.length,
      ...Array.from({ length: width }, (_, k) => (m.groups || [])[k]),
    ]);
    return [head, ...body].map((r) => r.map(csvCell).join(',')).join('\n');
  }
  return JSON.stringify(list.map((m) => ({
    index: m.index,
    text: m.text,
    groups: m.groups || [],
    ...(m.named && Object.keys(m.named).length ? { named: m.named } : {}),
  })), null, 2);
}

/** Count, unique count and covered characters. */
export function matchStats(matches, text = '') {
  const list = Array.isArray(matches) ? matches : [];
  const covered = list.reduce((n, m) => n + (m.length ?? m.text?.length ?? 0), 0);
  return {
    count: list.length,
    unique: new Set(list.map((m) => m.text)).size,
    covered,
    percent: text.length ? Math.round((covered / text.length) * 1000) / 10 : 0,
  };
}

/** Append a cheat-sheet token to a pattern; the ellipsis placeholder is dropped. */
export function insertToken(pattern, token) {
  return `${pattern ?? ''}${String(token).replace(/…/g, '')}`;
}
