// Lazy loader for sql.js (WASM SQLite), used by the DB Browser's Execute SQL
// and query-backed browse. The .wasm is served from public/sql/sql-wasm.wasm.
// Loading is deferred so opening the tool doesn't pull ~650 KB until needed.

let promise = null;

/** Resolve (and cache) the sql.js module. Throws if it can't initialize. */
export async function getSqlJs() {
  if (!promise) {
    promise = (async () => {
      const initSqlJs = (await import('sql.js')).default;
      return initSqlJs({ locateFile: (f) => `${import.meta.env.BASE_URL}sql/${f}` });
    })().catch((e) => { promise = null; throw e; });
  }
  return promise;
}

/** Open a database from bytes. Returns a sql.js Database instance. */
export async function openSqlDatabase(bytes) {
  const SQL = await getSqlJs();
  return new SQL.Database(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/**
 * Run SQL and normalize sql.js output into [{ columns, rows }] result sets.
 * Throws on SQL error (message surfaced to the caller).
 */
export function runSql(db, sql) {
  const res = db.exec(sql); // [{ columns:[], values:[[]] }]
  return res.map((r) => ({ columns: r.columns, rows: r.values }));
}

/** Serialize the in-memory database (including any edits) back to bytes. */
export function exportSqlDatabase(db) {
  return db.export(); // Uint8Array of a valid .sqlite file
}
