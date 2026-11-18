// Pure helpers for the DB Browser "Execute SQL" tab: query history,
// EXPLAIN QUERY PLAN rendering and copy-as-Markdown/TSV.
// Imported only by src/components/tools/dbbrowser/ExecuteTab.jsx.

export const HISTORY_LIMIT = 200;

const norm = (sql) => String(sql || '').replace(/\s+/g, ' ').trim();

/**
 * Add a successfully executed statement to the history (newest first).
 * Re-running an identical statement moves it to the top and bumps its count.
 */
export function addHistory(history, sql, { ok = true, ms = 0, rows = 0, at = Date.now() } = {}, limit = HISTORY_LIMIT) {
  const text = String(sql || '').trim();
  if (!text) return history;
  const key = norm(text);
  const prev = history.find((h) => norm(h.sql) === key);
  const entry = { sql: text, at, ok, ms, rows, runs: (prev?.runs || 0) + 1, pinned: !!prev?.pinned };
  return [entry, ...history.filter((h) => h !== prev)].slice(0, limit * 2).filter((h, i) => h.pinned || i < limit);
}

export function togglePin(history, sql) {
  const key = norm(sql);
  return history.map((h) => (norm(h.sql) === key ? { ...h, pinned: !h.pinned } : h));
}

export function removeHistory(history, sql) {
  const key = norm(sql);
  return history.filter((h) => norm(h.sql) !== key);
}

/** Case-insensitive substring filter; pinned entries first, otherwise order is kept. */
export function filterHistory(history, q = '') {
  const needle = q.trim().toLowerCase();
  const list = needle ? history.filter((h) => h.sql.toLowerCase().includes(needle)) : history;
  return [...list.filter((h) => h.pinned), ...list.filter((h) => !h.pinned)];
}

export function parseHistory(raw) {
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((h) => h && typeof h.sql === 'string' && h.sql.trim())
      .map((h) => ({ sql: h.sql, at: +h.at || 0, ok: h.ok !== false, ms: +h.ms || 0, rows: +h.rows || 0, runs: +h.runs || 1, pinned: !!h.pinned }))
      .slice(0, HISTORY_LIMIT * 2);
  } catch { return []; }
}

/** Statements that EXPLAIN QUERY PLAN can describe. */
export const canExplain = (sql) => /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE|VALUES)\b/i.test(sql || '');

/** Build a prefixed query; strips a trailing semicolon and any existing EXPLAIN prefix. */
export function explainSql(sql) {
  const body = String(sql || '').trim().replace(/;+\s*$/, '').replace(/^EXPLAIN(\s+QUERY\s+PLAN)?\s+/i, '');
  return `EXPLAIN QUERY PLAN ${body}`;
}

/**
 * Turn EXPLAIN QUERY PLAN rows ([id, parent, notused, detail]) into an
 * indented tree. Returns [{ depth, detail, scan, usesIndex }].
 */
export function planTree(rows) {
  const byId = new Map();
  const out = [];
  const depthOf = (id) => (byId.has(id) ? byId.get(id) + 1 : 0);
  for (const r of rows) {
    const [id, parent, , detail] = r;
    const depth = depthOf(parent);
    byId.set(id, depth);
    const d = String(detail ?? '');
    out.push({ depth, detail: d, scan: /^SCAN\b/i.test(d) && !/USING (COVERING )?INDEX/i.test(d), usesIndex: /USING (COVERING )?(INTEGER PRIMARY KEY|INDEX)|PRIMARY KEY/i.test(d) });
  }
  return out;
}

const cell = (v) => (v === null || v === undefined ? '' : v instanceof Uint8Array ? `<blob ${v.length}B>` : String(v));

export function toMarkdown(columns, rows) {
  const esc = (v) => cell(v).replace(/[\\|]/g, (c) => '\\' + c).replace(/\r?\n/g, '<br>');
  const head = `| ${columns.map(esc).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  return [head, sep, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n') + '\n';
}

/** Tab-separated, pastes straight into spreadsheets. Tabs/newlines in values become spaces. */
export function toTsv(columns, rows) {
  const esc = (v) => cell(v).replace(/[\t\r\n]+/g, ' ');
  return [columns.map(esc).join('\t'), ...rows.map((r) => r.map(esc).join('\t'))].join('\n') + '\n';
}
