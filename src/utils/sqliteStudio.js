// Core logic for the Lite DB Browser's editing features, on top of a sql.js
// Database. Pure (no DOM), so it is unit-tested under Node.
//
//   - SQL tokenising / statement splitting (for "execute current statement")
//   - CREATE TABLE parsing + generation (for the table designer)
//   - ALTER TABLE via SQLite's recommended table-rebuild procedure
//   - browse query building (column filters, global filter, sorting)
//   - row editing helpers (update cell / insert / delete)
//   - CSV parse/emit + import, SQL dump, JSON export
//   - pragma catalogue, script execution with per-statement results

import { SHADOW_SUFFIXES } from './sqliteMerge.js';

export const qid = (n) => '"' + String(n).replace(/"/g, '""') + '"';

// ---------------------------------------------------------------- tokenizer

/**
 * Tokenize SQL. Token kinds: ws, comment, str ('..'), ident ("..", `..`, [..]),
 * word (bare identifier / keyword), num, blob (X'..'), param, punct.
 */
export function tokenize(sql) {
  const out = [];
  let i = 0;
  const n = sql.length;
  const push = (t, start) => out.push({ t, v: sql.slice(start, i), start, end: i });
  while (i < n) {
    const c = sql[i];
    const s = i;
    if (/\s/.test(c)) { while (i < n && /\s/.test(sql[i])) i++; push('ws', s); continue; }
    if (c === '-' && sql[i + 1] === '-') { while (i < n && sql[i] !== '\n') i++; push('comment', s); continue; }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; push('comment', s); continue; }
    if ((c === 'x' || c === 'X') && sql[i + 1] === "'") { i += 2; while (i < n && sql[i] !== "'") i++; i++; push('blob', s); continue; }
    if (c === "'" || c === '"' || c === '`') {
      i++;
      while (i < n) { if (sql[i] === c) { if (sql[i + 1] === c) { i += 2; continue; } i++; break; } i++; }
      push(c === "'" ? 'str' : 'ident', s); continue;
    }
    if (c === '[') { const e = sql.indexOf(']', i); i = e < 0 ? n : e + 1; push('ident', s); continue; }
    if (/[A-Za-z_\u0080-￿]/.test(c)) { while (i < n && /[\w$\u0080-￿]/.test(sql[i])) i++; push('word', s); continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(sql[i + 1] || ''))) {
      if (c === '0' && /[xX]/.test(sql[i + 1] || '')) { i += 2; while (i < n && /[0-9a-fA-F]/.test(sql[i])) i++; } else {
        while (i < n && /[0-9.]/.test(sql[i])) i++;
        if (/[eE]/.test(sql[i] || '') && /[-+0-9]/.test(sql[i + 1] || '')) { i += 2; while (i < n && /[0-9]/.test(sql[i])) i++; }
      }
      push('num', s); continue;
    }
    if (c === '?' || c === ':' || c === '@' || c === '$') {
      i++; while (i < n && /[\w$]/.test(sql[i])) i++;
      push(i - s > 1 || c === '?' ? 'param' : 'punct', s); continue;
    }
    // multi-char operators
    const two = sql.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '==', '||', '<<', '>>', '->'].includes(two)) { i += two === '->' && sql[i + 2] === '>' ? 3 : 2; push('punct', s); continue; }
    i++; push('punct', s);
  }
  return out;
}

const sig = (toks) => toks.filter((t) => t.t !== 'ws' && t.t !== 'comment');
const kw = (tok, ...words) => !!tok && tok.t === 'word' && words.includes(tok.v.toUpperCase());

/** Unquote an identifier token's text. */
export function unquoteIdent(v) {
  if (!v) return v;
  const f = v[0];
  if (f === '"' || f === '`') return v.slice(1, -1).split(f + f).join(f);
  if (f === '[') return v.slice(1, -1);
  if (f === "'") return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

/**
 * Split a script into statements: [{ sql, start, end }] (offsets into the
 * original text; `sql` is trimmed and excludes nothing but surrounding
 * whitespace). Understands quotes, comments and CREATE TRIGGER ... END bodies.
 */
export function splitStatements(text) {
  const toks = tokenize(text);
  const out = [];
  let stmtStart = null; // index of first significant token
  let words = [];
  let inTrigger = false;
  let caseDepth = 0;
  let prevSig = null;
  const flush = (endTokIdx) => {
    if (stmtStart === null) return;
    const start = toks[stmtStart].start;
    const end = toks[endTokIdx].end;
    out.push({ sql: text.slice(start, end).trim(), start, end });
    stmtStart = null; words = []; inTrigger = false; caseDepth = 0;
  };
  toks.forEach((tok, idx) => {
    if (tok.t === 'ws' || tok.t === 'comment') return;
    if (stmtStart === null) {
      if (tok.t === 'punct' && tok.v === ';') return; // empty statement
      stmtStart = idx;
    }
    if (tok.t === 'word') {
      const u = tok.v.toUpperCase();
      if (words.length < 4) {
        words.push(u);
        const w = words.filter((x) => x !== 'TEMP' && x !== 'TEMPORARY');
        if (w[0] === 'CREATE' && w[1] === 'TRIGGER') inTrigger = true;
      }
      if (inTrigger) {
        if (u === 'CASE') caseDepth++;
        else if (u === 'END' && caseDepth > 0) { caseDepth--; tok.caseEnd = true; }
      }
    }
    if (tok.t === 'punct' && tok.v === ';') {
      if (!inTrigger || (kw(prevSig, 'END') && !prevSig.caseEnd)) { flush(idx); prevSig = null; return; }
    }
    prevSig = tok;
  });
  if (stmtStart !== null) {
    let last = toks.length - 1;
    while (last > stmtStart && (toks[last].t === 'ws' || toks[last].t === 'comment')) last--;
    flush(last);
  }
  return out;
}

/** The statement containing (or nearest before) character offset `pos`. */
export function statementAt(text, pos) {
  const all = splitStatements(text);
  if (!all.length) return null;
  let best = all[0];
  for (const s of all) { if (s.start <= pos) best = s; if (pos <= s.end) break; }
  return best;
}

// --------------------------------------------------------- CREATE TABLE model

const COL_CONSTRAINT_START = ['CONSTRAINT', 'PRIMARY', 'NOT', 'NULL', 'UNIQUE', 'CHECK', 'DEFAULT', 'COLLATE', 'REFERENCES', 'GENERATED', 'AS'];
const TABLE_CONSTRAINT_START = ['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'];

/** Index of the token closing the paren opened at `open` (in a sig-token list). */
function matchParen(toks, open) {
  let d = 0;
  for (let i = open; i < toks.length; i++) {
    if (toks[i].t === 'punct' && toks[i].v === '(') d++;
    else if (toks[i].t === 'punct' && toks[i].v === ')') { d--; if (d === 0) return i; }
  }
  return -1;
}

/**
 * Parse CREATE TABLE into an editable model:
 * { name, columns: [{ name, type, notnull, pk (0 or 1-based order), pkDesc,
 *   autoinc, unique, default, check, collate, fk, generated, extra }],
 *   constraints: [raw table constraints], withoutRowid, strict }
 * Returns null for statements it can't model (CREATE TABLE ... AS SELECT,
 * virtual tables).
 */
export function parseCreateTable(sql) {
  if (!sql) return null;
  const toks = sig(tokenize(sql));
  let i = 0;
  if (!kw(toks[i++], 'CREATE')) return null;
  if (kw(toks[i], 'TEMP', 'TEMPORARY')) i++;
  if (!kw(toks[i++], 'TABLE')) return null;
  if (kw(toks[i], 'IF')) i += 3;
  let nameTok = toks[i++];
  if (toks[i]?.v === '.') { nameTok = toks[i + 1]; i += 2; }
  if (!nameTok) return null;
  if (toks[i]?.v !== '(') return null;
  const close = matchParen(toks, i);
  if (close < 0) return null;
  const raw = (a, b) => sql.slice(toks[a].start, toks[b].end);

  // split body on top-level commas
  const parts = [];
  let d = 0; let s = i + 1;
  for (let k = i + 1; k < close; k++) {
    const v = toks[k].t === 'punct' ? toks[k].v : null;
    if (v === '(') d++; else if (v === ')') d--;
    else if (v === ',' && d === 0) { parts.push([s, k - 1]); s = k + 1; }
  }
  if (s <= close - 1) parts.push([s, close - 1]);

  const model = { name: unquoteIdent(nameTok.v), columns: [], constraints: [], withoutRowid: false, strict: false };
  const tail = toks.slice(close + 1).map((t) => t.v.toUpperCase()).join(' ');
  model.withoutRowid = /\bWITHOUT ROWID\b/.test(tail);
  model.strict = /\bSTRICT\b/.test(tail);

  const tablePk = [];
  for (const [a, b] of parts) {
    if (kw(toks[a], ...TABLE_CONSTRAINT_START)) {
      // Lift a plain PRIMARY KEY(col, ...) into the column flags.
      let k = a;
      if (kw(toks[k], 'CONSTRAINT')) k += 2;
      if (kw(toks[k], 'PRIMARY') && kw(toks[k + 1], 'KEY') && toks[k + 2]?.v === '(') {
        const e = matchParen(toks, k + 2);
        const cols = [];
        let ok = e === b || (e > 0 && toks.slice(e + 1, b + 1).every((t) => kw(t, 'ON', 'CONFLICT', 'ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE')));
        if (ok) {
          let auto = false;
          for (let q = k + 3; q < e; q++) {
            const t = toks[q];
            if (t.v === ',') continue;
            if (kw(t, 'ASC', 'DESC')) { if (cols.length) cols[cols.length - 1].desc = t.v.toUpperCase() === 'DESC'; continue; }
            if (kw(t, 'AUTOINCREMENT')) { auto = true; continue; }
            if (t.t === 'word' || t.t === 'ident') cols.push({ name: unquoteIdent(t.v) }); else { ok = false; break; }
          }
          if (ok) { tablePk.push(...cols.map((c) => ({ ...c, auto }))); continue; }
        }
      }
      model.constraints.push(raw(a, b));
      continue;
    }
    const col = { name: unquoteIdent(toks[a].v), type: '', notnull: false, pk: 0, pkDesc: false, autoinc: false, unique: false, default: null, check: null, collate: null, fk: null, generated: null, extra: [] };
    let k = a + 1;
    const typeStart = k;
    while (k <= b && !kw(toks[k], ...COL_CONSTRAINT_START)) {
      if (toks[k].v === '(') { const e = matchParen(toks, k); k = (e < 0 ? b : e) + 1; } else k++;
    }
    if (k > typeStart) col.type = raw(typeStart, k - 1).replace(/\s+/g, ' ');
    const skipConflict = () => { if (kw(toks[k], 'ON') && kw(toks[k + 1], 'CONFLICT')) k += 3; };
    while (k <= b) {
      const t = toks[k];
      if (kw(t, 'CONSTRAINT')) { k += 2; continue; }
      if (kw(t, 'PRIMARY')) {
        k += 2; col.pk = 1;
        if (kw(toks[k], 'ASC', 'DESC')) { col.pkDesc = toks[k].v.toUpperCase() === 'DESC'; k++; }
        skipConflict();
        if (kw(toks[k], 'AUTOINCREMENT')) { col.autoinc = true; k++; }
        continue;
      }
      if (kw(t, 'NOT') && kw(toks[k + 1], 'NULL')) { col.notnull = true; k += 2; skipConflict(); continue; }
      if (kw(t, 'NULL')) { k++; skipConflict(); continue; }
      if (kw(t, 'UNIQUE')) { col.unique = true; k++; skipConflict(); continue; }
      if (kw(t, 'CHECK') && toks[k + 1]?.v === '(') { const e = matchParen(toks, k + 1); col.check = sql.slice(toks[k + 1].end, toks[e].start).trim(); k = e + 1; continue; }
      if (kw(t, 'DEFAULT')) {
        k++;
        if (toks[k]?.v === '(') { const e = matchParen(toks, k); col.default = raw(k, e); k = e + 1; } else if ((toks[k]?.v === '-' || toks[k]?.v === '+') && toks[k + 1]) { col.default = toks[k].v + toks[k + 1].v; k += 2; } else if (toks[k]) { col.default = toks[k].v; k++; }
        continue;
      }
      if (kw(t, 'COLLATE')) { col.collate = toks[k + 1] ? unquoteIdent(toks[k + 1].v) : null; k += 2; continue; }
      if (kw(t, 'REFERENCES')) {
        const st = k; k++;
        while (k <= b) {
          const u = toks[k];
          if (u.v === '(') { k = matchParen(toks, k) + 1; continue; }
          if (kw(u, 'CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'DEFAULT', 'COLLATE', 'GENERATED', 'AS') || (kw(u, 'NOT') && kw(toks[k + 1], 'NULL')) || (kw(u, 'NULL') && !kw(toks[k - 1], 'SET'))) break;
          k++;
        }
        col.fk = raw(st, k - 1).replace(/^REFERENCES\s+/i, '');
        continue;
      }
      if (kw(t, 'GENERATED') || kw(t, 'AS')) {
        if (kw(t, 'GENERATED')) k += 2; // GENERATED ALWAYS
        k++; // AS
        if (toks[k]?.v === '(') {
          const e = matchParen(toks, k);
          const expr = sql.slice(toks[k].end, toks[e].start).trim();
          k = e + 1;
          let stored = false;
          if (kw(toks[k], 'STORED', 'VIRTUAL')) { stored = toks[k].v.toUpperCase() === 'STORED'; k++; }
          col.generated = { expr, stored };
        }
        continue;
      }
      col.extra.push(t.v); k++;
    }
    model.columns.push(col);
  }
  tablePk.forEach((p, idx) => {
    const c = model.columns.find((x) => x.name.toLowerCase() === p.name.toLowerCase());
    if (c) { c.pk = idx + 1; c.pkDesc = !!p.desc; if (p.auto) c.autoinc = true; }
  });
  // number single inline PKs
  if (!tablePk.length) model.columns.forEach((c) => { if (c.pk) c.pk = 1; });
  return model;
}

/** Generate CREATE TABLE from a model (see parseCreateTable). */
export function buildCreateTable(model, name = model.name) {
  const pkCols = model.columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk);
  const inlinePk = pkCols.length === 1;
  const lines = model.columns.map((c) => {
    let s = '\t' + qid(c.name);
    if (c.type && c.type.trim()) s += '\t' + c.type.trim();
    if (c.notnull) s += ' NOT NULL';
    if (inlinePk && c.pk) s += ' PRIMARY KEY' + (c.pkDesc ? ' DESC' : '') + (c.autoinc ? ' AUTOINCREMENT' : '');
    if (c.unique) s += ' UNIQUE';
    if (c.default !== null && c.default !== undefined && String(c.default).trim() !== '') s += ' DEFAULT ' + formatDefault(String(c.default).trim());
    if (c.check && c.check.trim()) s += ` CHECK(${c.check.trim()})`;
    if (c.collate && c.collate.trim()) s += ' COLLATE ' + c.collate.trim();
    if (c.fk && c.fk.trim()) s += ' REFERENCES ' + c.fk.trim();
    if (c.generated && c.generated.expr) s += ` GENERATED ALWAYS AS (${c.generated.expr})` + (c.generated.stored ? ' STORED' : ' VIRTUAL');
    if (c.extra && c.extra.length) s += ' ' + c.extra.join(' ');
    return s;
  });
  if (pkCols.length > 1) lines.push(`\tPRIMARY KEY(${pkCols.map((c) => qid(c.name) + (c.pkDesc ? ' DESC' : '')).join(',')})`);
  for (const c of model.constraints || []) if (c && c.trim()) lines.push('\t' + c.trim());
  const opts = [model.withoutRowid && 'WITHOUT ROWID', model.strict && 'STRICT'].filter(Boolean);
  return `CREATE TABLE ${qid(name)} (\n${lines.join(',\n')}\n)${opts.length ? ' ' + opts.join(', ') : ''}`;
}

/** A DEFAULT value: numbers, quoted strings, keywords and (expr) pass through; other text is quoted. */
function formatDefault(v) {
  if (/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(v)) return v;
  if (/^'.*'$/s.test(v) || /^\(.*\)$/s.test(v) || /^[xX]'[0-9a-fA-F]*'$/.test(v)) return v;
  if (/^(NULL|TRUE|FALSE|CURRENT_TIME|CURRENT_DATE|CURRENT_TIMESTAMP)$/i.test(v)) return v;
  return "'" + v.replace(/'/g, "''") + "'";
}

// ------------------------------------------------------------ schema queries

export function queryAll(db, sql, params) {
  const st = db.prepare(sql);
  try {
    if (params) st.bind(params);
    const columns = st.getColumnNames();
    const rows = [];
    while (st.step()) rows.push(st.get());
    return { columns, rows };
  } finally { st.free(); }
}

export function queryObjects(db, sql, params) {
  const { columns, rows } = queryAll(db, sql, params);
  return rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
}

export const scalar = (db, sql, params) => queryAll(db, sql, params).rows[0]?.[0];

export const isVirtualSql = (sql) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql || '');
// Table options (WITHOUT ROWID, STRICT) follow the closing parenthesis.
export const isWithoutRowidSql = (sql) => /WITHOUT\s+ROWID/i.test((sql || '').slice((sql || '').lastIndexOf(')')));

/** All schema objects (tables, views, indexes, triggers), shadow tables flagged. */
export function listObjects(db) {
  const objs = queryObjects(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name COLLATE NOCASE");
  const virt = objs.filter((o) => o.type === 'table' && isVirtualSql(o.sql)).map((o) => o.name.toLowerCase());
  for (const o of objs) {
    o.virtual = o.type === 'table' && isVirtualSql(o.sql);
    o.shadow = o.type === 'table' && virt.some((v) => SHADOW_SUFFIXES.some((s) => o.name.toLowerCase() === v + s));
    o.auto = o.type === 'index' && !o.sql; // sqlite_autoindex_* are already excluded; keeps others
  }
  return objs;
}

/** Column info (PRAGMA table_xinfo) for a table or view. */
export function columnsOf(db, name) {
  return queryObjects(db, `PRAGMA table_xinfo(${qid(name)})`).map((c) => ({
    name: c.name, type: c.type || '', notnull: !!c.notnull, dflt: c.dflt_value, pk: c.pk || 0, hidden: c.hidden || 0,
  }));
}

/**
 * How rows of `name` are identified for editing:
 * { editable, keyCols } — keyCols is ['_rowid_'] for rowid tables, the PK
 * columns for WITHOUT ROWID tables, [] for views (not editable).
 */
export function rowKeyFor(db, name) {
  const o = queryObjects(db, 'SELECT type, sql FROM sqlite_master WHERE name = ?', [name])[0];
  if (!o || o.type !== 'table') return { editable: false, keyCols: [] };
  if (isWithoutRowidSql(o.sql)) {
    const pk = columnsOf(db, name).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    return { editable: pk.length > 0, keyCols: pk, withoutRowid: true };
  }
  return { editable: true, keyCols: ['_rowid_'] };
}

// --------------------------------------------------------------- ALTER TABLE

/**
 * Change a table's definition. `model` is the new definition (as from
 * parseCreateTable, possibly with a new name); each column carries `orig`, the
 * column's name in the existing table, or null for a new column. Columns not
 * referenced by any `orig` are dropped.
 *
 * Renames go through ALTER TABLE RENAME (so indexes, triggers and views follow);
 * every other change uses the 12-step rebuild from the SQLite docs, inside a
 * savepoint that's rolled back on failure. Returns { warnings, rebuilt }.
 */
export function alterTable(db, oldName, model) {
  const warnings = [];
  const fkOn = scalar(db, 'PRAGMA foreign_keys') === 1;
  if (fkOn) db.run('PRAGMA foreign_keys = OFF');
  db.run('SAVEPOINT sqlb_alter');
  let rebuilt = false;
  try {
    let name = oldName;
    if (model.name !== oldName) {
      db.run(`ALTER TABLE ${qid(oldName)} RENAME TO ${qid(model.name)}`);
      name = model.name;
    }
    // Column renames (two-phase if a new name collides with an existing one).
    const existing = columnsOf(db, name).map((c) => c.name.toLowerCase());
    const renames = model.columns.filter((c) => c.orig && c.orig !== c.name);
    const collide = renames.some((r) => existing.includes(r.name.toLowerCase()) && r.name.toLowerCase() !== r.orig.toLowerCase());
    if (collide) {
      renames.forEach((r, k) => { db.run(`ALTER TABLE ${qid(name)} RENAME COLUMN ${qid(r.orig)} TO ${qid(`sqlb_tmp_${k}`)}`); r._tmp = `sqlb_tmp_${k}`; });
      renames.forEach((r) => db.run(`ALTER TABLE ${qid(name)} RENAME COLUMN ${qid(r._tmp)} TO ${qid(r.name)}`));
    } else {
      renames.forEach((r) => db.run(`ALTER TABLE ${qid(name)} RENAME COLUMN ${qid(r.orig)} TO ${qid(r.name)}`));
    }

    // Anything beyond renames? Compare against the current definition.
    const curSql = scalar(db, "SELECT sql FROM sqlite_master WHERE type='table' AND name = ?", [name]);
    const cur = parseCreateTable(curSql);
    const wanted = buildCreateTable(model, name);
    if (!cur || buildCreateTable(cur, name) !== wanted) {
      rebuilt = true;
      const deps = queryObjects(db, "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? COLLATE NOCASE AND type IN ('index','trigger') AND sql IS NOT NULL", [name]);
      let tmp = 'sqlb_temp_table'; let n = 1;
      while (scalar(db, 'SELECT 1 FROM sqlite_master WHERE name = ?', [tmp])) tmp = `sqlb_temp_table_${n++}`;
      db.run('PRAGMA legacy_alter_table = ON');
      try {
        db.run(buildCreateTable(model, tmp));
        const copy = model.columns.filter((c) => c.orig && !c.generated);
        const curCols = new Set(columnsOf(db, name).filter((c) => c.hidden !== 2 && c.hidden !== 3).map((c) => c.name.toLowerCase()));
        const usable = copy.filter((c) => curCols.has(c.name.toLowerCase()));
        if (usable.length) {
          const cols = usable.map((c) => qid(c.name)).join(', ');
          db.run(`INSERT INTO ${qid(tmp)} (${cols}) SELECT ${cols} FROM ${qid(name)}`);
        }
        db.run(`DROP TABLE ${qid(name)}`);
        db.run(`ALTER TABLE ${qid(tmp)} RENAME TO ${qid(name)}`);
      } finally {
        db.run('PRAGMA legacy_alter_table = OFF');
      }
      for (const d of deps) {
        try { db.run(d.sql); } catch (e) { warnings.push(`${d.type} ${d.name} was dropped: ${e.message}`); }
      }
    }
    if (fkOn) {
      const bad = queryAll(db, `PRAGMA foreign_key_check(${qid(name)})`).rows;
      if (bad.length) throw new Error(`Foreign key check failed (${bad.length} row(s) reference missing parents)`);
    }
    db.run('RELEASE sqlb_alter');
  } catch (e) {
    try { db.run('ROLLBACK TO sqlb_alter'); db.run('RELEASE sqlb_alter'); } catch { /* ignore */ }
    throw e;
  } finally {
    if (fkOn) db.run('PRAGMA foreign_keys = ON');
  }
  return { warnings, rebuilt };
}

/** CREATE INDEX statement from { name, table, unique, columns: [{name, desc}], where }. */
export function buildCreateIndex({ name, table, unique, columns, where, ifNotExists }) {
  const cols = columns.map((c) => (c.expr ? c.expr : qid(c.name)) + (c.desc ? ' DESC' : ' ASC')).join(', ');
  return `CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${ifNotExists ? 'IF NOT EXISTS ' : ''}${qid(name)} ON ${qid(table)} (${cols})${where && where.trim() ? ` WHERE ${where.trim()}` : ''}`;
}

// --------------------------------------------------------- browse / filtering

const NUMERIC = /^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/;
const numOrStr = (v) => (NUMERIC.test(v.trim()) ? Number(v.trim()) : v);

/**
 * Translate a DB4S-style column filter into SQL. Supported forms:
 *   text        LIKE '%text%'          =x  <>x  !=x  >x  <x  >=x  <=x
 *   a~b         BETWEEN a AND b        /re/  REGEXP (needs the regexp function)
 *   =NULL / IS NULL, <>NULL / IS NOT NULL, ='' (empty string)
 * Returns { sql, params } or null for an empty filter.
 */
export function filterToSql(column, raw) {
  const f = String(raw ?? '').trim();
  if (!f) return null;
  const c = qid(column);
  if (/^(=\s*NULL|IS\s+NULL)$/i.test(f)) return { sql: `${c} IS NULL`, params: [] };
  if (/^((<>|!=)\s*NULL|IS\s+NOT\s+NULL)$/i.test(f)) return { sql: `${c} IS NOT NULL`, params: [] };
  if (f.length > 2 && f.startsWith('/') && f.endsWith('/')) return { sql: `${c} REGEXP ?`, params: [f.slice(1, -1)] };
  const m = f.match(/^(>=|<=|<>|!=|==|=|>|<)\s*(.*)$/s);
  if (m) {
    const op = m[1] === '==' ? '=' : m[1] === '!=' ? '<>' : m[1];
    let v = m[2];
    if (/^'.*'$/s.test(v)) v = v.slice(1, -1); else v = numOrStr(v);
    return { sql: `${c} ${op} ?`, params: [v] };
  }
  const r = f.match(/^([-+]?[\d.]+(?:[eE][-+]?\d+)?)\s*~\s*([-+]?[\d.]+(?:[eE][-+]?\d+)?)$/);
  if (r && NUMERIC.test(r[1]) && NUMERIC.test(r[2])) return { sql: `${c} BETWEEN ? AND ?`, params: [Number(r[1]), Number(r[2])] };
  return { sql: `${c} LIKE ? ESCAPE '\\'`, params: ['%' + f.replace(/[\\%_]/g, (x) => '\\' + x) + '%'] };
}

/**
 * Build the SELECT for the Browse Data grid.
 * opts: { table, columns (names, for global filter), keyCols, filters {col: text},
 *         global (text), sort [{ column, dir }], limit, offset }
 * Returns { sql, params, countSql, countParams }. When keyCols is ['_rowid_'],
 * the row id is selected first as "__rowid__".
 */
export function buildBrowseQuery({ table, columns = [], keyCols = [], filters = {}, global = '', sort = [], limit = 100, offset = 0 }) {
  const where = []; const params = [];
  for (const [col, text] of Object.entries(filters)) {
    const w = filterToSql(col, text);
    if (w) { where.push(w.sql); params.push(...w.params); }
  }
  if (global && global.trim() && columns.length) {
    const g = '%' + global.trim().replace(/[\\%_]/g, (x) => '\\' + x) + '%';
    where.push('(' + columns.map((c) => `CAST(${qid(c)} AS TEXT) LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
    columns.forEach(() => params.push(g));
  }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const order = sort.length ? ` ORDER BY ${sort.map((s) => `${qid(s.column)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`).join(', ')}` : '';
  const rid = keyCols.length === 1 && keyCols[0] === '_rowid_' ? '_rowid_ AS "__rowid__", ' : '';
  return {
    sql: `SELECT ${rid}* FROM ${qid(table)}${w}${order} LIMIT ${Math.max(0, limit | 0)} OFFSET ${Math.max(0, offset | 0)}`,
    params,
    countSql: `SELECT COUNT(*) FROM ${qid(table)}${w}`,
    countParams: params.slice(),
  };
}

const keyWhere = (keyCols) => keyCols.map((k) => (k === '_rowid_' ? '_rowid_' : qid(k)) + ' = ?').join(' AND ');

export function updateCell(db, table, keyCols, keyVals, column, value) {
  const sql = `UPDATE ${qid(table)} SET ${qid(column)} = ? WHERE ${keyWhere(keyCols)}`;
  db.run(sql, [value, ...keyVals]);
  return sql;
}

/**
 * Insert a new row. Tries DEFAULT VALUES first; if a NOT NULL column without a
 * default blocks that, fills such columns with '' (text) or 0 (numeric).
 * Returns { sql, rowid }.
 */
export function insertRow(db, table) {
  let sql = `INSERT INTO ${qid(table)} DEFAULT VALUES`;
  try {
    db.run(sql);
  } catch (e) {
    const cols = columnsOf(db, table).filter((c) => !c.hidden && c.notnull && c.dflt === null && !(c.pk && /^INTEGER$/i.test(c.type)));
    if (!cols.length) throw e;
    const vals = cols.map((c) => (/INT|REAL|FLOA|DOUB|NUM|DEC|BOOL/i.test(c.type) ? 0 : ''));
    sql = `INSERT INTO ${qid(table)} (${cols.map((c) => qid(c.name)).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
    db.run(sql, vals);
  }
  return { sql, rowid: scalar(db, 'SELECT last_insert_rowid()') };
}

export function deleteRows(db, table, keyCols, keyValsList) {
  const sql = `DELETE FROM ${qid(table)} WHERE ${keyWhere(keyCols)}`;
  const st = db.prepare(sql);
  try { for (const kv of keyValsList) st.run(kv); } finally { st.free(); }
  return sql;
}

// ------------------------------------------------------------------ CSV

/** Parse delimited text. opts: { separator=',', quote='"', trim=false }. */
export function parseCsv(text, { separator = ',', quote = '"', trim = false } = {}) {
  const rows = []; let row = []; let field = ''; let inQ = false; let quoted = false;
  const sep = separator || ',';
  const pushField = () => { row.push(trim && !quoted ? field.trim() : field); field = ''; quoted = false; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === quote) { if (text[i + 1] === quote) { field += quote; i++; } else inQ = false; } else field += c;
      continue;
    }
    if (quote && c === quote && (field === '' || (trim && field.trim() === ''))) { inQ = true; quoted = true; field = ''; continue; }
    if (text.startsWith(sep, i)) { pushField(); i += sep.length - 1; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      pushField(); rows.push(row); row = [];
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length || quoted) { pushField(); rows.push(row); }
  if (text.charCodeAt(0) === 0xfeff && rows[0]?.length) rows[0][0] = rows[0][0].replace(/^﻿/, '');
  return rows;
}

const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

/** Emit delimited text. opts: { separator, quote, header, newline }. Blobs are written as hex. */
export function toCsv(columns, rows, { separator = ',', quote = '"', header = true, newline = '\r\n' } = {}) {
  const needs = new RegExp(`[${(separator + quote).replace(/[\]\\^-]/g, '\\$&')}\\r\\n]`);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Uint8Array ? toHex(v) : String(v);
    return quote && (needs.test(s) || /^\s|\s$/.test(s)) ? quote + s.split(quote).join(quote + quote) + quote : s;
  };
  const lines = rows.map((r) => r.map(esc).join(separator));
  if (header) lines.unshift(columns.map(esc).join(separator));
  return lines.join(newline) + (lines.length ? newline : '');
}

/** Guess INTEGER / REAL / TEXT for a column of string values (blanks ignored). */
export function inferType(values) {
  let sawInt = false; let sawReal = false;
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const s = String(v).trim();
    if (/^[-+]?\d+$/.test(s) && !/^[-+]?0\d/.test(s) && Math.abs(Number(s)) <= Number.MAX_SAFE_INTEGER) sawInt = true;
    else if (NUMERIC.test(s) && !/^[-+]?0\d/.test(s)) sawReal = true;
    else return 'TEXT';
  }
  return sawReal ? 'REAL' : sawInt ? 'INTEGER' : 'TEXT';
}

/**
 * Import parsed CSV rows into `table` (created if it doesn't exist).
 * opts: { header (first row = names), inferTypes, emptyAsNull }.
 * Returns { created, rows, columns, sql }.
 */
export function importRows(db, table, data, { header = true, inferTypes = true, emptyAsNull = false } = {}) {
  if (!data.length) throw new Error('Nothing to import');
  const width = Math.max(...data.map((r) => r.length));
  const body = header ? data.slice(1) : data;
  const exists = !!scalar(db, "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?", [table]);
  let names;
  let created = false;
  db.run('SAVEPOINT sqlb_import');
  try {
    if (exists) {
      names = columnsOf(db, table).filter((c) => !c.hidden).map((c) => c.name);
      if (width > names.length) throw new Error(`The file has ${width} column(s) but table ${table} has ${names.length}`);
      names = names.slice(0, width);
    } else {
      const seen = new Map();
      names = Array.from({ length: width }, (_, i) => {
        let n = (header ? String(data[0][i] ?? '').trim() : '') || `field${i + 1}`;
        const k = n.toLowerCase();
        if (seen.has(k)) { seen.set(k, seen.get(k) + 1); n = `${n}_${seen.get(k)}`; } else seen.set(k, 1);
        return n;
      });
      const types = names.map((_, i) => (inferTypes ? inferType(body.map((r) => r[i])) : 'TEXT'));
      db.run(`CREATE TABLE ${qid(table)} (${names.map((n, i) => `${qid(n)} ${types[i]}`).join(', ')})`);
      created = true;
    }
    const sql = `INSERT INTO ${qid(table)} (${names.map(qid).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`;
    const st = db.prepare(sql);
    try {
      for (const r of body) {
        const vals = names.map((_, i) => { const v = r[i]; return v === undefined || (emptyAsNull && v === '') ? null : v; });
        st.run(vals);
      }
    } finally { st.free(); }
    db.run('RELEASE sqlb_import');
    return { created, rows: body.length, columns: names, sql };
  } catch (e) {
    try { db.run('ROLLBACK TO sqlb_import'); db.run('RELEASE sqlb_import'); } catch { /* ignore */ }
    throw e;
  }
}

// ------------------------------------------------------------ export / dump

/** An SQL literal for a value returned by sql.js. */
export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v > 0 ? '9e999' : v < 0 ? '-9e999' : 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Uint8Array) return `X'${toHex(v)}'`;
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/**
 * Dump the database (or some tables) as an SQL script, like sqlite3's .dump.
 * opts: { tables (names|null = all), schema=true, data=true, columnNames=false,
 *         ifNotExists=false, dropTables=false, transaction=true }
 */
export function dumpSql(db, opts = {}) {
  const { tables = null, schema = true, data = true, columnNames = false, ifNotExists = false, dropTables = false, transaction = true } = opts;
  const objs = listObjects(db);
  const pick = (n) => !tables || tables.some((t) => t.toLowerCase() === n.toLowerCase());
  const out = [];
  if (transaction) out.push('BEGIN TRANSACTION;');
  for (const t of objs.filter((o) => o.type === 'table' && !o.shadow && pick(o.name))) {
    if (schema) {
      if (dropTables) out.push(`DROP TABLE IF EXISTS ${qid(t.name)};`);
      let s = t.sql;
      if (ifNotExists) s = s.replace(/^\s*CREATE\s+(VIRTUAL\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, (m, v) => `CREATE ${v || ''}TABLE IF NOT EXISTS `);
      out.push(s + ';');
    }
    if (data) {
      const cols = columnsOf(db, t.name).filter((c) => !c.hidden);
      if (!cols.length) continue;
      const colList = cols.map((c) => qid(c.name)).join(',');
      const st = db.prepare(`SELECT ${colList} FROM ${qid(t.name)}`);
      try {
        const head = `INSERT INTO ${qid(t.name)}${columnNames ? ` (${colList})` : ''} VALUES (`;
        while (st.step()) out.push(head + st.get().map(sqlLiteral).join(',') + ');');
      } finally { st.free(); }
    }
  }
  if (data && !tables && scalar(db, "SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'")) {
    const seq = queryAll(db, 'SELECT name, seq FROM sqlite_sequence').rows;
    if (seq.length) {
      out.push('DELETE FROM "sqlite_sequence";');
      for (const [n, s] of seq) out.push(`INSERT INTO "sqlite_sequence" VALUES (${sqlLiteral(n)},${sqlLiteral(s)});`);
    }
  }
  if (schema) {
    for (const type of ['index', 'view', 'trigger']) {
      for (const o of objs.filter((x) => x.type === type && x.sql && (type === 'view' ? !tables || pick(x.name) : pick(x.tbl_name)))) out.push(o.sql + ';');
    }
  }
  if (transaction) out.push('COMMIT;');
  return out.join('\n') + '\n';
}

const b64 = (u8) => {
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(s) : Buffer.from(u8).toString('base64');
};

/** Rows of a table (or any SELECT) as an array of objects; blobs become base64 strings. */
export function exportJson(db, table, { pretty = true } = {}) {
  const { columns, rows } = queryAll(db, /^\s*SELECT\b/i.test(table) ? table : `SELECT * FROM ${qid(table)}`);
  const objs = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c, r[i] instanceof Uint8Array ? b64(r[i]) : r[i]])));
  return JSON.stringify(objs, null, pretty ? 2 : 0);
}

// ----------------------------------------------------------------- pragmas

/**
 * Pragmas shown in the Edit Pragmas tab. `stored` = saved in the database
 * file; others only affect this session. `vacuum` = takes effect after VACUUM.
 */
export const PRAGMAS = [
  { name: 'auto_vacuum', kind: 'enum', options: ['NONE', 'FULL', 'INCREMENTAL'], stored: true, vacuum: true, help: 'Reclaim free pages automatically.' },
  { name: 'automatic_index', kind: 'bool', help: 'Allow the planner to create transient indexes.' },
  { name: 'cache_size', kind: 'int', help: 'Page cache size (negative = KiB).' },
  { name: 'cell_size_check', kind: 'bool', help: 'Extra corruption checks on b-tree cells.' },
  { name: 'foreign_keys', kind: 'bool', help: 'Enforce FOREIGN KEY constraints.' },
  { name: 'ignore_check_constraints', kind: 'bool', help: 'Skip CHECK constraints.' },
  { name: 'journal_mode', kind: 'enum', options: ['DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'], help: 'Rollback journal mode (in-memory here).' },
  { name: 'max_page_count', kind: 'int', help: 'Maximum number of pages.' },
  { name: 'page_size', kind: 'int', options: [512, 1024, 2048, 4096, 8192, 16384, 32768, 65536], stored: true, vacuum: true, help: 'Page size in bytes.' },
  { name: 'recursive_triggers', kind: 'bool', help: 'Let triggers fire other triggers recursively.' },
  { name: 'reverse_unordered_selects', kind: 'bool', help: 'Reverse un-ORDERed SELECT output (finds order bugs).' },
  { name: 'secure_delete', kind: 'bool', help: 'Overwrite deleted content with zeros.' },
  { name: 'synchronous', kind: 'enum', options: ['OFF', 'NORMAL', 'FULL', 'EXTRA'], help: 'fsync behaviour.' },
  { name: 'temp_store', kind: 'enum', options: ['DEFAULT', 'FILE', 'MEMORY'], help: 'Where temporary tables live.' },
  { name: 'user_version', kind: 'int', stored: true, help: 'Application-defined schema version.' },
  { name: 'application_id', kind: 'int', stored: true, help: 'Application-defined file type id.' },
  { name: 'encoding', kind: 'readonly', stored: true, help: 'Text encoding (fixed once the database has content).' },
  { name: 'schema_version', kind: 'readonly', stored: true, help: 'Incremented on every schema change.' },
  { name: 'page_count', kind: 'readonly', help: 'Pages in the database.' },
  { name: 'freelist_count', kind: 'readonly', help: 'Unused pages (VACUUM reclaims them).' },
];

const ENUM_NUM = {
  auto_vacuum: ['NONE', 'FULL', 'INCREMENTAL'],
  synchronous: ['OFF', 'NORMAL', 'FULL', 'EXTRA'],
  temp_store: ['DEFAULT', 'FILE', 'MEMORY'],
};

export function readPragmas(db) {
  const out = {};
  for (const p of PRAGMAS) {
    try {
      let v = scalar(db, `PRAGMA ${p.name}`);
      if (ENUM_NUM[p.name] && typeof v === 'number') v = ENUM_NUM[p.name][v] ?? v;
      if (p.name === 'journal_mode' && typeof v === 'string') v = v.toUpperCase();
      if (p.kind === 'bool') v = !!v;
      out[p.name] = v;
    } catch { out[p.name] = null; }
  }
  return out;
}

/** Apply changed pragma values; runs VACUUM if a pragma needs it. Returns the statements run. */
export function writePragmas(db, changes) {
  const ran = [];
  let vacuum = false;
  for (const [name, value] of Object.entries(changes)) {
    const p = PRAGMAS.find((x) => x.name === name);
    if (!p || p.kind === 'readonly') continue;
    let v;
    if (p.kind === 'bool') v = value ? 1 : 0;
    else if (p.kind === 'int') { v = parseInt(value, 10); if (!Number.isFinite(v)) throw new Error(`${name}: not an integer`); }
    else { v = String(value).toUpperCase(); if (!p.options.includes(v)) throw new Error(`${name}: invalid value`); }
    const sql = `PRAGMA ${name} = ${v}`;
    db.run(sql); ran.push(sql);
    if (p.vacuum) vacuum = true;
  }
  if (vacuum) { db.run('VACUUM'); ran.push('VACUUM'); }
  return ran;
}

// --------------------------------------------------------------- execution

/**
 * Run a script statement by statement. Returns
 * { results: [{ sql, start, columns, rows, truncated, changes, ms }], error, errorAt, ms }
 * where `start` is the statement's offset into `sql` (plus `offset`). Stops at
 * the first error. Result rows are capped at `maxRows` per statement.
 */
export function executeScript(db, sql, { offset = 0, maxRows = 50000 } = {}) {
  const results = [];
  const t0 = now();
  const it = db.iterateStatements(sql);
  let pos = 0;
  try {
    for (;;) {
      const before = sql.length - it.getRemainingSQL().length;
      const nx = it.next();
      if (nx.done) break;
      const st = nx.value;
      const text = st.getSQL();
      const lead = text.length - text.trimStart().length;
      pos = before + lead;
      const tc0 = scalar(db, 'SELECT total_changes()');
      const s0 = now();
      const columns = st.getColumnNames();
      const rows = [];
      let truncated = false;
      while (st.step()) { if (rows.length < maxRows) rows.push(st.get()); else { truncated = true; } }
      const ms = now() - s0;
      const changes = columns.length ? 0 : scalar(db, 'SELECT total_changes()') - tc0;
      results.push({ sql: text.trim(), start: offset + pos, columns, rows, truncated, changes, ms });
    }
    return { results, error: null, errorAt: null, ms: now() - t0 };
  } catch (e) {
    const rem = it.getRemainingSQL();
    let at = offset + pos;
    if (rem != null) { const p = sql.length - rem.length; at = offset + p + (rem.length - rem.trimStart().length); }
    return { results, error: e.message || String(e), errorAt: at, ms: now() - t0 };
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Line/column (1-based) of a character offset. */
export function lineCol(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, col: offset - before.lastIndexOf('\n') };
}

// --------------------------------------------------------------- blob helpers

export function detectBlobType(u8) {
  if (!(u8 instanceof Uint8Array) || u8.length < 4) return null;
  const h = (...b) => b.every((x, i) => u8[i] === x);
  if (h(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (h(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (h(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (h(0x42, 0x4d)) return 'image/bmp';
  if (h(0x52, 0x49, 0x46, 0x46) && u8[8] === 0x57 && u8[9] === 0x45) return 'image/webp';
  if (h(0x3c, 0x3f, 0x78, 0x6d) || h(0x3c, 0x73, 0x76, 0x67)) return 'image/svg+xml';
  if (h(0x25, 0x50, 0x44, 0x46)) return 'application/pdf';
  return null;
}

/** True if the bytes decode as UTF-8 text without control characters (except tab/newline). */
export function looksLikeText(u8) {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return !/[\x00-\x08\x0e-\x1f]/.test(s);
  } catch { return false; }
}

export function hexDump(u8, max = 4096) {
  const lines = [];
  const n = Math.min(u8.length, max);
  for (let o = 0; o < n; o += 16) {
    const chunk = u8.subarray(o, Math.min(o + 16, n));
    const hex = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ');
    const asc = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${o.toString(16).padStart(8, '0')}  ${hex}  ${asc}`);
  }
  if (u8.length > max) lines.push(`… ${u8.length - max} more byte(s)`);
  return lines.join('\n');
}

/** Register helper SQL functions (REGEXP) on a sql.js Database. */
export function registerFunctions(db) {
  const cache = new Map();
  db.create_function('regexp', (pattern, value) => {
    if (pattern === null || value === null) return null;
    let re = cache.get(pattern);
    if (!re) { re = new RegExp(pattern); if (cache.size > 100) cache.clear(); cache.set(pattern, re); }
    return re.test(String(value)) ? 1 : 0;
  });
}
