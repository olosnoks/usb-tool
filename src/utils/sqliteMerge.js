// Combine several SQLite databases into one, using a sql.js module (WASM
// SQLite). Pure logic: no DOM, no network — the caller passes the initialized
// sql.js module (see getSqlJs() in ./sqljs.js), so this also runs under Node
// in tests.
//
// Sources are processed in order. The first source to define a table sets its
// schema; later sources with the same table name are handled per
// `tableConflict`:
//   - 'append' (default): rows go into the existing table. Columns the target
//     lacks are added with ALTER TABLE ADD COLUMN, so nothing is dropped.
//   - 'rename': the table is copied as a separate table, `<table>_<source>`.
//   - 'skip':   the later table is ignored.
//
// When appending, `rowConflict` decides what happens when a row collides with
// an existing PRIMARY KEY / UNIQUE value:
//   - 'ignore' (default): keep the row already there (INSERT OR IGNORE).
//   - 'replace': the later source wins (INSERT OR REPLACE).
//   - 'newkey': give the incoming row a fresh INTEGER PRIMARY KEY so both are
//     kept. Note this does not rewrite foreign keys that pointed at the old id.
//
// Indexes are created alongside their table (before rows go in, so UNIQUE
// indexes are honoured). Views and triggers are created at the very end, so
// triggers don't fire while rows are being copied.

export const TABLE_CONFLICTS = ['append', 'rename', 'skip'];
export const ROW_CONFLICTS = ['ignore', 'replace', 'newkey'];

const qid = (n) => '"' + String(n).replace(/"/g, '""') + '"';

// Internal tables created by common virtual-table modules (FTS3/4/5, R*Tree).
// They're rebuilt automatically when the virtual table is created, so they're
// never copied directly.
export const SHADOW_SUFFIXES = ['_content', '_segments', '_segdir', '_docsize', '_stat', '_data', '_idx', '_config', '_node', '_rowid', '_parent'];

// An SQL identifier as it can appear in a CREATE statement, optionally
// schema-qualified: "quoted", [bracketed], `backticked`, or bare.
const IDENT = String.raw`(?:"(?:[^"]|"")+"|\[[^\]]+\]|` + '`(?:[^`]|``)+`' + String.raw`|[A-Za-z_][\w$]*)`;
const QUALIFIED = `${IDENT}(?:\\s*\\.\\s*${IDENT})?`;

function all(db, sql, params) {
  const st = db.prepare(sql);
  try {
    if (params) st.bind(params);
    const out = [];
    while (st.step()) out.push(st.getAsObject());
    return out;
  } finally {
    st.free();
  }
}

function schemaObjects(db) {
  return all(db, "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL ORDER BY rowid");
}

function columnsOf(db, table) {
  // table_xinfo also reports generated (hidden=2/3) and virtual-table hidden
  // (hidden=1) columns; none of those can be inserted into.
  return all(db, `PRAGMA table_xinfo(${qid(table)})`).map((c) => ({
    name: c.name, type: c.type || '', pk: c.pk || 0, hidden: c.hidden || 0,
  }));
}

const isVirtual = (sql) => /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(sql || '');
const isWithoutRowid = (sql) => /WITHOUT\s+ROWID\s*;?\s*$/i.test(sql || '');

/** Replace the table name in a CREATE [VIRTUAL] TABLE statement. */
export function renameCreateTable(sql, newName) {
  const re = new RegExp(String.raw`^(\s*CREATE\s+(?:TEMP(?:ORARY)?\s+)?(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)${QUALIFIED}`, 'i');
  if (!re.test(sql)) throw new Error('unrecognised CREATE TABLE statement');
  return sql.replace(re, (_, head) => head + qid(newName));
}

/** Rewrite a CREATE INDEX statement to a new index name and/or table name. */
export function renameCreateIndex(sql, newIndexName, newTableName) {
  const re = new RegExp(String.raw`^(\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?)${QUALIFIED}(\s+ON\s+)${IDENT}`, 'i');
  if (!re.test(sql)) throw new Error('unrecognised CREATE INDEX statement');
  return sql.replace(re, (_, head, on) => head + qid(newIndexName) + on + qid(newTableName));
}

/** A short identifier-safe tag derived from a file name ("logs-2024.db" -> "logs_2024"). */
export function sourceTag(name, index) {
  const base = String(name || '').replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return base || `src${index + 1}`;
}

/**
 * Merge `sources` into a fresh in-memory database.
 *
 * @param SQL      initialized sql.js module
 * @param sources  [{ name, bytes }] or [{ name, db }] (an open sql.js Database,
 *                 e.g. the live one with in-session edits; it is not closed)
 * @param opts     { tableConflict, rowConflict, sourceColumn }
 *                 sourceColumn: if a non-empty string, every table gets a TEXT
 *                 column of that name holding the source file name of each row.
 * @returns { db, report } — db is a sql.js Database the caller must close.
 */
export function mergeDatabases(SQL, sources, opts = {}) {
  const tableConflict = TABLE_CONFLICTS.includes(opts.tableConflict) ? opts.tableConflict : 'append';
  const rowConflict = ROW_CONFLICTS.includes(opts.rowConflict) ? opts.rowConflict : 'ignore';
  const sourceColumn = typeof opts.sourceColumn === 'string' ? opts.sourceColumn.trim() : '';
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('No databases to combine');

  const out = new SQL.Database();
  const report = { sources: [], warnings: [], totalRows: 0, tableCount: 0 };
  const warn = (m) => report.warnings.push(m);

  const targetHas = (type, name) => all(out, 'SELECT 1 FROM sqlite_master WHERE type = ? AND name = ? COLLATE NOCASE', [type, name]).length > 0;
  const anyObject = (name) => all(out, 'SELECT 1 FROM sqlite_master WHERE name = ? COLLATE NOCASE', [name]).length > 0;
  const uniqueName = (base) => {
    let n = base; let i = 2;
    while (anyObject(n)) n = `${base}_${i++}`;
    return n;
  };

  const deferred = []; // views + triggers, created after all rows are in

  try {
    out.run('BEGIN');
    sources.forEach((src, si) => {
      const name = src.name || `source ${si + 1}`;
      const tag = sourceTag(name, si);
      const srep = { name, tables: [] };
      report.sources.push(srep);

      let sdb = src.db || null;
      const owned = !sdb;
      try {
        if (!sdb) sdb = new SQL.Database(src.bytes instanceof Uint8Array ? src.bytes : new Uint8Array(src.bytes));
        let objs;
        try { objs = schemaObjects(sdb); } catch (e) { throw new Error(`${name}: not a readable SQLite database (${e.message})`); }

        const virtualNames = objs.filter((o) => o.type === 'table' && isVirtual(o.sql)).map((o) => o.name.toLowerCase());
        const isShadow = (t) => virtualNames.some((v) => SHADOW_SUFFIXES.some((s) => t.toLowerCase() === v + s));
        const indexesFor = (t) => objs.filter((o) => o.type === 'index' && o.tbl_name.toLowerCase() === t.toLowerCase());

        for (const t of objs.filter((o) => o.type === 'table')) {
          if (isShadow(t.name)) continue;
          const virtual = isVirtual(t.sql);
          const exists = targetHas('table', t.name);
          const entry = { source: t.name, target: t.name, action: 'created', rows: 0, skipped: 0 };

          if (exists && tableConflict === 'skip') {
            srep.tables.push({ ...entry, target: null, action: 'skipped' });
            continue;
          }

          let targetName = t.name;
          let created = false;
          if (exists && tableConflict === 'rename') {
            targetName = uniqueName(`${t.name}_${tag}`);
            entry.target = targetName; entry.action = 'renamed';
          } else if (exists) {
            entry.action = 'appended';
          }

          if (!exists || tableConflict === 'rename') {
            try {
              out.run(targetName === t.name ? t.sql : renameCreateTable(t.sql, targetName));
              created = true;
              report.tableCount++;
            } catch (e) {
              warn(`${name}: could not create table ${t.name} (${e.message}) — skipped`);
              srep.tables.push({ ...entry, target: null, action: 'failed' });
              continue;
            }
            // Indexes travel with the table; create them before rows go in.
            for (const ix of indexesFor(t.name)) {
              try {
                if (targetName === t.name && !anyObject(ix.name)) out.run(ix.sql);
                else out.run(renameCreateIndex(ix.sql, uniqueName(`${ix.name}_${tag}`), targetName));
              } catch (e) { warn(`${name}: index ${ix.name} not created (${e.message})`); }
            }
          }

          // Reconcile columns: add any the target lacks (plus the source column).
          const srcCols = columnsOf(sdb, t.name).filter((c) => !c.hidden);
          let tgtNames = new Set(columnsOf(out, targetName).map((c) => c.name.toLowerCase()));
          const wantCols = [...srcCols.map((c) => ({ name: c.name, type: c.type })), ...(sourceColumn ? [{ name: sourceColumn, type: 'TEXT' }] : [])];
          for (const c of wantCols) {
            if (tgtNames.has(c.name.toLowerCase())) continue;
            if (virtual) { if (c.name !== sourceColumn) warn(`${name}: column ${t.name}.${c.name} dropped (cannot alter a virtual table)`); continue; }
            try {
              out.run(`ALTER TABLE ${qid(targetName)} ADD COLUMN ${qid(c.name)}${c.type ? ' ' + c.type : ''}`);
              tgtNames.add(c.name.toLowerCase());
            } catch (e) { warn(`${name}: could not add column ${targetName}.${c.name} (${e.message})`); }
          }
          tgtNames = new Set(columnsOf(out, targetName).filter((c) => !c.hidden).map((c) => c.name.toLowerCase()));

          let cols = srcCols.filter((c) => tgtNames.has(c.name.toLowerCase()));
          // 'newkey': let SQLite assign a fresh rowid alias for appended rows.
          if (rowConflict === 'newkey' && !created && !virtual && !isWithoutRowid(t.sql)) {
            const pks = srcCols.filter((c) => c.pk > 0);
            if (pks.length === 1 && pks[0].type.toUpperCase() === 'INTEGER') cols = cols.filter((c) => c !== pks[0]);
          }
          const tagRows = sourceColumn && tgtNames.has(sourceColumn.toLowerCase()) && !cols.some((c) => c.name.toLowerCase() === sourceColumn.toLowerCase());
          if (cols.length === 0 && !tagRows) { srep.tables.push(entry); continue; }

          const insertCols = [...cols.map((c) => qid(c.name)), ...(tagRows ? [qid(sourceColumn)] : [])];
          const verb = rowConflict === 'replace' ? 'INSERT OR REPLACE' : 'INSERT OR IGNORE';
          const ins = out.prepare(`${verb} INTO ${qid(targetName)} (${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`);
          const sel = sdb.prepare(cols.length ? `SELECT ${cols.map((c) => qid(c.name)).join(', ')} FROM ${qid(t.name)}` : `SELECT 1 FROM ${qid(t.name)}`);
          try {
            while (sel.step()) {
              const vals = cols.length ? sel.get() : [];
              if (tagRows) vals.push(name);
              ins.run(vals);
              if (out.getRowsModified() > 0) entry.rows++; else entry.skipped++;
            }
          } catch (e) {
            warn(`${name}: copying ${t.name} stopped early (${e.message})`);
          } finally {
            sel.free(); ins.free();
          }
          report.totalRows += entry.rows;
          srep.tables.push(entry);
        }

        // Indexes the source has on tables that already existed (append mode).
        for (const ix of objs.filter((o) => o.type === 'index')) {
          if (anyObject(ix.name) || !targetHas('table', ix.tbl_name)) continue;
          if (srep.tables.find((e) => e.source.toLowerCase() === ix.tbl_name.toLowerCase())?.action !== 'appended') continue;
          try { out.run(ix.sql); } catch (e) { warn(`${name}: index ${ix.name} not created (${e.message})`); }
        }

        for (const o of objs.filter((x) => x.type === 'view' || x.type === 'trigger')) deferred.push({ ...o, from: name });
      } finally {
        if (owned && sdb) sdb.close();
      }
    });

    // Views first (INSTEAD OF triggers may target them), then triggers.
    for (const type of ['view', 'trigger']) {
      for (const o of deferred.filter((x) => x.type === type)) {
        if (anyObject(o.name)) continue; // first definition wins
        try { out.run(o.sql); } catch (e) { warn(`${o.from}: ${type} ${o.name} not created (${e.message})`); }
      }
    }
    out.run('COMMIT');
  } catch (e) {
    try { out.run('ROLLBACK'); } catch { /* not in a transaction */ }
    out.close();
    throw e;
  }
  return { db: out, report };
}
