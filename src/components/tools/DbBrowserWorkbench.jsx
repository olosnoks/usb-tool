import React, { useState, useMemo, useCallback } from 'react';
import { Database, Table as TableIcon, FileUp, Globe, RefreshCw, ChevronLeft, ChevronRight, Download, Boxes, Terminal, Play } from 'lucide-react';
import { openDatabase, listSchema, readRows, countRows, parseColumnDefs } from '../../utils/sqlite.js';
import { openSqlDatabase, runSql, exportSqlDatabase } from '../../utils/sqljs.js';
import { proxiedFetch, isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';

/**
 * Lite database browser.
 *
 *  - "SQLite file" tab: open a .sqlite/.db file and browse its tables and rows,
 *    fully client-side (parsed by src/utils/sqlite.js; the file never leaves the
 *    browser). Read-only.
 *  - "Endpoint" tab: connect to an HTTP database/REST endpoint (PostgREST,
 *    CouchDB, Elasticsearch _search, a SQLite-over-HTTP query endpoint, or any
 *    JSON API) through the configurable proxy and render the JSON as a table.
 *
 * Nothing here runs SQL against a local engine or writes to any database.
 */

const PAGE_SIZE = 100;

function cellText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Uint8Array) {
    const hex = Array.from(v.subarray(0, 24)).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    return `⟨blob ${v.length}B⟩ ${hex}${v.length > 24 ? '…' : ''}`;
  }
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Flatten an array of JSON objects into { columns, rows } for the grid. */
function tabulate(data) {
  let records = data;
  if (!Array.isArray(records)) {
    // common envelope shapes: {rows:[...]}, {results:[...]}, {data:[...]},
    // Elasticsearch {hits:{hits:[{_source}]}}, CouchDB {rows:[{doc|value}]}
    if (data?.hits?.hits) records = data.hits.hits.map((h) => h._source ?? h);
    else if (Array.isArray(data?.rows)) records = data.rows.map((r) => r.doc ?? r.value ?? r);
    else if (Array.isArray(data?.results)) records = data.results;
    else if (Array.isArray(data?.data)) records = data.data;
    else records = [data];
  }
  const colSet = [];
  const seen = new Set();
  for (const rec of records) {
    if (rec && typeof rec === 'object' && !Array.isArray(rec)) {
      for (const k of Object.keys(rec)) if (!seen.has(k)) { seen.add(k); colSet.push(k); }
    }
  }
  if (colSet.length === 0) {
    return { columns: ['value'], rows: records.map((r) => [cellText(r)]) };
  }
  const rows = records.map((rec) => colSet.map((c) => cellText(rec?.[c])));
  return { columns: colSet, rows };
}

function DataGrid({ columns, rows, rowIds }) {
  return (
    <div className="overflow-auto border border-slate-800 rounded max-h-[55vh]">
      <table className="w-full text-xs font-mono border-collapse">
        <thead className="sticky top-0 bg-slate-900">
          <tr>
            {rowIds && <th className="px-2 py-1 text-left text-cyan-400 border-b border-slate-800 whitespace-nowrap">rowid</th>}
            {columns.map((c, i) => (
              <th key={i} className="px-2 py-1 text-left text-slate-300 border-b border-slate-800 whitespace-nowrap">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="odd:bg-slate-900/40 hover:bg-slate-800/50">
              {rowIds && <td className="px-2 py-1 text-cyan-500/80 border-b border-slate-900 align-top">{rowIds[ri]}</td>}
              {r.map((cell, ci) => (
                <td key={ci} className="px-2 py-1 text-gray-300 border-b border-slate-900 align-top max-w-[28rem] truncate" title={cell}>{cell}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={(columns.length || 1) + (rowIds ? 1 : 0)} className="px-2 py-4 text-center text-slate-600">No rows.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function downloadText(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function toCsv(columns, rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
}

// --- sql.js query helpers (used once the engine is live) ---
const qid = (n) => '"' + String(n).replace(/"/g, '""') + '"';
function sqlSchema(db) {
  const r = runSql(db, "SELECT type,name,tbl_name,rootpage,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY (type='table') DESC, type, name");
  if (!r.length) return [];
  const c = Object.fromEntries(r[0].columns.map((x, i) => [x, i]));
  return r[0].rows.map((row) => ({ type: row[c.type], name: row[c.name], tblName: row[c.tbl_name], rootpage: row[c.rootpage], sql: row[c.sql] }));
}
function sqlColumns(db, name) {
  const r = runSql(db, `PRAGMA table_info(${qid(name)})`);
  if (!r.length) return [];
  const c = Object.fromEntries(r[0].columns.map((x, i) => [x, i]));
  return r[0].rows.map((row) => ({ name: row[c.name], type: row[c.type], notnull: !!row[c.notnull], dflt: row[c.dflt_value], pk: !!row[c.pk] }));
}
function sqlCount(db, name) {
  try { const r = runSql(db, `SELECT COUNT(*) FROM ${qid(name)}`); return r.length ? r[0].rows[0][0] : 0; } catch { return 0; }
}
function sqlRows(db, name, limit, offset) {
  let r;
  try { r = runSql(db, `SELECT rowid AS __rowid__, * FROM ${qid(name)} LIMIT ${limit} OFFSET ${offset}`); }
  catch { r = runSql(db, `SELECT * FROM ${qid(name)} LIMIT ${limit} OFFSET ${offset}`); }
  if (!r.length) return { columns: [], rows: [], rowIds: null };
  const cols = r[0].columns;
  const hasRid = cols[0] === '__rowid__';
  return { columns: hasRid ? cols.slice(1) : cols, rowIds: hasRid ? r[0].rows.map((x) => x[0]) : null, rows: r[0].rows.map((x) => (hasRid ? x.slice(1) : x)) };
}

function SqliteTab({ log }) {
  const [db, setDb] = useState(null);           // dependency-free parser handle
  const [bytes, setBytes] = useState(null);     // raw bytes for sql.js
  const [fileName, setFileName] = useState('');
  const [fileSize, setFileSize] = useState(0);
  const [schema, setSchema] = useState([]);     // parser schema (fallback)
  const [active, setActive] = useState(null);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [mode, setMode] = useState('browse');   // browse | structure | sql
  const [refreshKey, setRefreshKey] = useState(0); // bumps after SQL edits

  // sql.js engine (lazy)
  const [engine, setEngine] = useState({ state: 'idle', err: '' }); // idle|loading|ready|error
  const [sqlDb, setSqlDb] = useState(null);
  const [sqlText, setSqlText] = useState('SELECT name, type FROM sqlite_master ORDER BY type, name;');
  const [sqlResults, setSqlResults] = useState(null);
  const [sqlError, setSqlError] = useState('');
  const [sqlRunning, setSqlRunning] = useState(false);

  const ready = engine.state === 'ready' && !!sqlDb;

  // Prefer the live sql.js schema (reflects in-session edits) when the engine is up.
  const liveSchema = useMemo(() => {
    if (!ready) return null;
    try { return sqlSchema(sqlDb); } catch { return null; }
  }, [ready, sqlDb, refreshKey]);
  const effSchema = liveSchema || schema;
  const tables = useMemo(() => effSchema.filter((s) => s.type === 'table'), [effSchema]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setDb(null); setSchema([]); setActive(null); setPage(0); setFilter(''); setRefreshKey(0);
    setEngine({ state: 'idle', err: '' }); setSqlDb(null); setSqlResults(null); setSqlError('');
    try {
      const ab = await file.arrayBuffer();
      const handle = openDatabase(ab);
      const sch = listSchema(handle);
      setDb(handle); setBytes(new Uint8Array(ab)); setFileName(file.name); setFileSize(file.size); setSchema(sch);
      const firstTable = sch.find((s) => s.type === 'table' && s.rootpage);
      if (firstTable) selectTable(firstTable);
      log?.(`Opened ${file.name} (${(file.size / 1024).toFixed(0)} KB) — ${sch.filter((s) => s.type === 'table').length} table(s)`);
      // Bring up the live engine so Browse/Structure/SQL all share one state.
      setEngine({ state: 'loading', err: '' });
      openSqlDatabase(new Uint8Array(ab))
        .then((d) => { setSqlDb(d); setEngine({ state: 'ready', err: '' }); log?.('sql.js engine ready'); })
        .catch((err2) => { setEngine({ state: 'error', err: err2.message || String(err2) }); log?.(`sql.js engine failed: ${err2.message}`); });
    } catch (err) {
      setError(err.message || String(err));
      log?.(`SQLite open failed: ${err.message}`);
    }
  };

  const selectTable = (t) => { setActive({ name: t.name, sql: t.sql, rootpage: t.rootpage }); setPage(0); setFilter(''); };

  const activeCount = useMemo(() => {
    if (!active) return 0;
    if (ready) return sqlCount(sqlDb, active.name);
    return active.rootpage ? countRows(db, active.rootpage, 2000000) : 0;
  }, [active, ready, sqlDb, db, refreshKey]);

  // Browse view — live via sql.js when ready, else the dependency-free parser.
  // A client-side filter narrows the current page.
  const view = useMemo(() => {
    if (!active) return null;
    let columns; let rowIds; let rows;
    if (ready) {
      const v = sqlRows(sqlDb, active.name, PAGE_SIZE, page * PAGE_SIZE);
      columns = v.columns; rowIds = v.rowIds; rows = v.rows.map((r) => r.map(cellText));
    } else if (db) {
      const r = readRows(db, active.rootpage, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
      columns = active.columns?.length ? active.columns : (r.rows[0]?.values.map((_, i) => `col${i}`) || []);
      rowIds = r.rows.map((x) => x.rowid); rows = r.rows.map((x) => x.values.map(cellText));
    } else return null;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      const keep = rows.map((r, i) => (r.some((c) => c.toLowerCase().includes(q)) ? i : -1)).filter((i) => i >= 0);
      rows = keep.map((i) => rows[i]); rowIds = rowIds ? keep.map((i) => rowIds[i]) : null;
    }
    return { columns, rowIds, rows };
  }, [ready, sqlDb, db, active, page, filter, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(activeCount / PAGE_SIZE));

  const exportTableCsv = () => {
    if (!view) return;
    downloadText(`${active.name}-page${page + 1}.csv`, toCsv(view.columns, view.rows), 'text/csv');
  };

  // Lazily bring up sql.js when the Execute-SQL tab is first used.
  const ensureEngine = useCallback(async () => {
    if (sqlDb || engine.state === 'loading') return sqlDb;
    setEngine({ state: 'loading', err: '' });
    try {
      const d = await openSqlDatabase(bytes);
      setSqlDb(d); setEngine({ state: 'ready', err: '' });
      log?.('sql.js engine ready');
      return d;
    } catch (e) {
      setEngine({ state: 'error', err: e.message || String(e) });
      log?.(`sql.js engine failed: ${e.message}`);
      return null;
    }
  }, [bytes, sqlDb, engine.state, log]);

  const [exporting, setExporting] = useState(false);
  const exportDb = async () => {
    setExporting(true);
    const d = sqlDb || await ensureEngine();
    if (d) {
      try {
        const out = exportSqlDatabase(d);
        const name = (fileName || 'database.sqlite').replace(/(\.(sqlite3?|db3?|s3db))?$/i, '') + '-export.sqlite';
        const blob = new Blob([out], { type: 'application/x-sqlite3' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
        log?.(`Exported database (${(out.length / 1024).toFixed(0)} KB)`);
      } catch (e) { log?.(`Export failed: ${e.message}`); }
    }
    setExporting(false);
  };

  const runQuery = async () => {
    setSqlRunning(true); setSqlError(''); setSqlResults(null);
    const d = sqlDb || await ensureEngine();
    if (!d) { setSqlRunning(false); return; }
    try {
      const sets = runSql(d, sqlText);
      setSqlResults(sets);
      setRefreshKey((k) => k + 1);
      log?.(`SQL ok — ${sets.length} result set(s)`);
    } catch (e) { setSqlError(e.message || String(e)); }
    setSqlRunning(false);
  };

  const MODES = [
    { id: 'browse', label: 'Browse Data', icon: TableIcon },
    { id: 'structure', label: 'Structure', icon: Boxes },
    { id: 'sql', label: 'Execute SQL', icon: Terminal },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-900/40 border border-cyan-800 rounded text-xs text-cyan-200 cursor-pointer hover:bg-cyan-900/60">
          <FileUp size={14} /> Open .sqlite / .db file
          <input type="file" accept=".sqlite,.sqlite3,.db,.db3,.s3db,application/x-sqlite3,application/vnd.sqlite3" className="hidden" onChange={onFile} />
        </label>
        {fileName && <span className="text-xs text-gray-400 font-mono">{fileName} · {(fileSize / 1024).toFixed(0)} KB · {db?.pageSize}B pages · {db?.encoding}</span>}
        {db && (
          <button onClick={exportDb} disabled={exporting} title="Serialize the in-memory database (including any SQL edits) to a .sqlite file" className="ml-auto px-3 py-1.5 bg-slate-800 border border-slate-700 text-gray-200 rounded text-xs hover:bg-slate-700 disabled:opacity-50 inline-flex items-center gap-1">
            {exporting ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />} Export database (.sqlite)
          </button>
        )}
      </div>
      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {db && (
        <>
          <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit mb-3">
            {MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button key={m.id} onClick={() => { setMode(m.id); if (m.id === 'sql') ensureEngine(); }}
                  className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${mode === m.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
                  <Icon size={12} /> {m.label}
                </button>
              );
            })}
          </div>

          {mode !== 'sql' && (
            <div className="grid grid-cols-[minmax(10rem,14rem)_1fr] gap-3">
              <div className="border border-slate-800 rounded bg-slate-900/40 p-2 max-h-[60vh] overflow-auto">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Tables ({tables.length})</div>
                {tables.map((t) => (
                  <button key={t.name} onClick={() => selectTable(t)}
                    className={`w-full text-left px-2 py-1 rounded text-xs font-mono flex items-center gap-1.5 mb-0.5 ${active?.name === t.name ? 'bg-cyan-900/50 text-cyan-200' : 'text-gray-300 hover:bg-slate-800'}`}>
                    <TableIcon size={12} className="shrink-0" /> <span className="truncate">{t.name}</span>
                  </button>
                ))}
                {tables.length === 0 && <div className="text-xs text-slate-600">No tables.</div>}
              </div>

              <div className="min-w-0">
                {mode === 'browse' && active && (
                  <>
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <div className="text-xs text-gray-300 font-mono"><span className="text-cyan-300">{active.name}</span> · {activeCount.toLocaleString()} row(s) {ready ? <span className="text-emerald-500/70">live</span> : <span className="text-slate-600">read-only</span>}</div>
                      <div className="flex items-center gap-2 text-xs">
                        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter this page…" className="bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono w-40" />
                        <button onClick={exportTableCsv} className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"><Download size={11} /> CSV</button>
                        <button disabled={page === 0} onClick={() => { setPage((p) => Math.max(0, p - 1)); setFilter(''); }} className="px-2 py-1 bg-slate-800 rounded disabled:opacity-40"><ChevronLeft size={12} /></button>
                        <span className="text-gray-400">page {page + 1} / {totalPages}</span>
                        <button disabled={page + 1 >= totalPages} onClick={() => { setPage((p) => p + 1); setFilter(''); }} className="px-2 py-1 bg-slate-800 rounded disabled:opacity-40"><ChevronRight size={12} /></button>
                      </div>
                    </div>
                    {view && <DataGrid columns={view.columns} rows={view.rows} rowIds={view.rowIds} />}
                  </>
                )}

                {mode === 'structure' && (
                  <StructureView db={db} schema={effSchema} ready={ready} sqlDb={sqlDb} refreshKey={refreshKey} />
                )}
              </div>
            </div>
          )}

          {mode === 'sql' && (
            <ExecuteSql
              engine={engine} ensureEngine={ensureEngine} runQuery={runQuery}
              sqlText={sqlText} setSqlText={setSqlText} sqlResults={sqlResults} sqlError={sqlError} sqlRunning={sqlRunning}
              tables={tables}
            />
          )}
        </>
      )}

      {!db && !error && (
        <p className="text-xs text-slate-500">
          Open a local SQLite database to browse data, inspect its structure, and run SQL. The file never leaves the
          browser. Browse & Structure are read-only and dependency-free; Execute SQL loads an in-browser SQLite engine
          (sql.js, WASM) and can modify the in-memory copy — the original file on disk is never changed.
        </p>
      )}
    </div>
  );
}

function StructureView({ db, schema, ready, sqlDb, refreshKey }) {
  const data = useMemo(() => schema, [schema, refreshKey]);
  const tables = data.filter((s) => s.type === 'table');
  const indexes = data.filter((s) => s.type === 'index');
  const views = data.filter((s) => s.type === 'view');
  const triggers = data.filter((s) => s.type === 'trigger');
  return (
    <div className="text-xs max-h-[60vh] overflow-auto pr-1">
      <div className="mb-3 text-slate-400 font-mono">DB: {db.pageSize}B pages · {db.encoding} · {db.pageCount.toLocaleString()} pages · {(db.byteLength / 1024).toFixed(0)} KB {ready ? <span className="text-emerald-500/70">· live</span> : null}</div>
      <div className="text-[10px] uppercase tracking-wide text-cyan-400 mb-1">Tables ({tables.length})</div>
      {tables.map((t) => {
        const cols = ready ? sqlColumns(sqlDb, t.name) : parseColumnDefs(t.sql);
        const count = ready ? sqlCount(sqlDb, t.name) : (t.rootpage ? countRows(db, t.rootpage, 2000000) : 0);
        return (
          <div key={t.name} className="mb-2 border border-slate-800 rounded bg-slate-950 p-2">
            <div className="font-mono text-gray-100 mb-1">{t.name} <span className="text-slate-500">· {count.toLocaleString()} row(s)</span></div>
            <table className="w-full font-mono text-[11px]">
              <thead><tr className="text-slate-500 text-left"><th className="pr-2">column</th><th className="pr-2">type</th><th className="pr-2">pk</th><th className="pr-2">notnull</th><th>default</th></tr></thead>
              <tbody>
                {cols.map((c) => (
                  <tr key={c.name} className="border-t border-slate-900">
                    <td className="pr-2 text-gray-200">{c.name}</td>
                    <td className="pr-2 text-cyan-300">{c.type || '—'}</td>
                    <td className="pr-2">{c.pk ? '🔑' : ''}</td>
                    <td className="pr-2">{c.notnull ? '•' : ''}</td>
                    <td className="text-slate-400">{c.dflt ?? ''}</td>
                  </tr>
                ))}
                {cols.length === 0 && <tr><td colSpan={5} className="text-slate-600">(could not parse columns)</td></tr>}
              </tbody>
            </table>
          </div>
        );
      })}
      {[['Indexes', indexes], ['Views', views], ['Triggers', triggers]].map(([label, items]) => items.length > 0 && (
        <div key={label}>
          <div className="text-[10px] uppercase tracking-wide text-cyan-400 mb-1 mt-2">{label} ({items.length})</div>
          {items.map((o) => (
            <div key={o.name} className="mb-1 border border-slate-800 rounded bg-slate-950 p-2">
              <div className="font-mono text-gray-200">{o.name} {o.tblName ? <span className="text-slate-500">on {o.tblName}</span> : null}</div>
              {o.sql && <pre className="text-[10px] text-slate-500 whitespace-pre-wrap mt-1">{o.sql}</pre>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ExecuteSql({ engine, ensureEngine, runQuery, sqlText, setSqlText, sqlResults, sqlError, sqlRunning, tables }) {
  const samples = [
    "SELECT name, type FROM sqlite_master ORDER BY type, name;",
    tables[0] ? `SELECT * FROM "${tables[0].name}" LIMIT 50;` : 'SELECT 1;',
    tables[0] ? `SELECT COUNT(*) AS n FROM "${tables[0].name}";` : 'SELECT sqlite_version();',
  ];
  const exportCsv = (set, i) => downloadText(`query-result-${i + 1}.csv`, toCsv(set.columns, set.rows), 'text/csv');

  return (
    <div>
      {engine.state === 'loading' && <div className="mb-2 p-2 border border-slate-800 rounded bg-slate-900/50 text-xs text-gray-400">Loading SQLite (sql.js) engine…</div>}
      {engine.state === 'error' && (
        <div className="mb-2 p-2 border border-yellow-900 rounded bg-yellow-950/20 text-xs text-yellow-300">
          Could not load the sql.js engine ({engine.err}). Browse Data and Structure still work read-only.
          <button onClick={ensureEngine} className="ml-2 underline">retry</button>
        </div>
      )}
      <div className="flex flex-wrap gap-1 mb-1">
        {samples.map((s, i) => <button key={i} onClick={() => setSqlText(s)} className="px-2 py-0.5 text-[10px] bg-slate-800 text-gray-300 rounded hover:bg-slate-700 border border-slate-700 font-mono truncate max-w-[16rem]" title={s}>{s}</button>)}
      </div>
      <textarea
        value={sqlText}
        onChange={(e) => setSqlText(e.target.value)}
        onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') runQuery(); }}
        rows={5}
        spellCheck={false}
        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono text-gray-200 resize-y"
        placeholder="SELECT * FROM table;  — Ctrl/Cmd+Enter to run"
      />
      <div className="flex items-center gap-2 my-2">
        <button onClick={runQuery} disabled={sqlRunning || engine.state === 'loading'} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {sqlRunning ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} Run (Ctrl+Enter)
        </button>
        <span className="text-[10px] text-slate-500">Runs against an in-memory copy; your file on disk is never modified.</span>
      </div>
      {sqlError && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 font-mono">{sqlError}</div>}
      {sqlResults && sqlResults.length === 0 && <div className="text-xs text-slate-500">Statement executed. No rows returned.</div>}
      {sqlResults && sqlResults.map((set, i) => (
        <div key={i} className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-slate-400">{set.rows.length} row(s){sqlResults.length > 1 ? ` · set ${i + 1}` : ''}</span>
            <button onClick={() => exportCsv(set, i)} className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300"><Download size={11} /> CSV</button>
          </div>
          <DataGrid columns={set.columns} rows={set.rows.map((r) => r.map(cellText))} />
        </div>
      ))}
    </div>
  );
}

function EndpointTab({ log }) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('Accept: application/json');
  const [bodyText, setBodyText] = useState('');
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState(null);
  const [grid, setGrid] = useState(null);
  const [raw, setRaw] = useState('');
  const [showRaw, setShowRaw] = useState(false);

  const PRESETS = [
    { label: 'PostgREST', method: 'GET', url: 'https://host/tablename?limit=100', headers: 'Accept: application/json' },
    { label: 'CouchDB _all_docs', method: 'GET', url: 'https://host/db/_all_docs?include_docs=true&limit=100', headers: 'Accept: application/json' },
    { label: 'Elasticsearch _search', method: 'POST', url: 'https://host/index/_search', headers: 'Content-Type: application/json', body: '{\n  "size": 100,\n  "query": { "match_all": {} }\n}' },
    { label: 'SQLite-over-HTTP (datasette)', method: 'GET', url: 'https://host/db/table.json?_shape=array', headers: 'Accept: application/json' },
  ];

  const parseHeaders = (text) => {
    const h = {};
    (text || '').split('\n').forEach((line) => { const i = line.indexOf(':'); if (i > 0) h[line.slice(0, i).trim()] = line.slice(i + 1).trim(); });
    return h;
  };

  const run = useCallback(async () => {
    if (!url.trim()) return;
    setBusy(true); setResp(null); setGrid(null); setRaw('');
    const opts = { method, headers: parseHeaders(headersText), redirect: 'follow' };
    if (bodyText && method !== 'GET' && method !== 'HEAD') opts.body = bodyText;
    const start = performance.now();
    log?.(`${method} ${url}${isProxyEnabled() ? ' (via proxy)' : ''}`);
    try {
      const r = await proxiedFetch(url.trim(), opts);
      const text = await r.text();
      const timeMs = Math.round(performance.now() - start);
      setResp({ status: r.status, statusText: r.statusText, size: text.length, timeMs });
      setRaw(text);
      try {
        const json = JSON.parse(text);
        setGrid(tabulate(json));
      } catch {
        setGrid(null); setShowRaw(true);
      }
    } catch (e) {
      setResp({ error: describeNetworkError(e) });
    }
    setBusy(false);
  }, [method, url, headersText, bodyText, log]);

  const applyPreset = (p) => { setMethod(p.method); setUrl(p.url); setHeadersText(p.headers); setBodyText(p.body || ''); };

  const download = () => {
    const blob = new Blob([raw], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'db-endpoint-response.json'; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div>
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-1 mb-2">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => applyPreset(p)} className="px-2 py-0.5 text-[10px] bg-slate-800 text-gray-300 rounded hover:bg-slate-700 border border-slate-700">{p.label}</button>
        ))}
      </div>
      <div className="flex gap-2 mb-2">
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200">
          {['GET', 'POST', 'PUT', 'DELETE', 'HEAD'].map((m) => <option key={m}>{m}</option>)}
        </select>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://db-host/endpoint" className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
        <button onClick={run} disabled={busy} className="px-3 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Globe size={12} />} Query
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <textarea value={headersText} onChange={(e) => setHeadersText(e.target.value)} rows={3} placeholder="Header: value (one per line)" className="bg-slate-900 border border-slate-800 rounded p-1 text-[11px] text-gray-200 font-mono resize-y" />
        <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={3} placeholder="Request body (POST/PUT) — e.g. JSON query" className="bg-slate-900 border border-slate-800 rounded p-1 text-[11px] text-gray-200 font-mono resize-y" />
      </div>
      {resp && (
        <div className="mb-2 text-xs flex items-center gap-3 flex-wrap">
          {resp.error ? <span className="text-red-300">{resp.error}</span> : (
            <>
              <span className={resp.status >= 500 ? 'text-red-400' : resp.status >= 400 ? 'text-amber-400' : 'text-green-400'}>{resp.status} {resp.statusText}</span>
              <span className="text-gray-500">{resp.size.toLocaleString()} bytes · {resp.timeMs} ms</span>
              {raw && <button onClick={download} className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"><Download size={11} /> JSON</button>}
              {grid && <button onClick={() => setShowRaw((s) => !s)} className="text-slate-400 hover:text-slate-200">{showRaw ? 'Show table' : 'Show raw'}</button>}
            </>
          )}
        </div>
      )}
      {resp && !resp.error && (
        showRaw || !grid
          ? <pre className="border border-slate-800 rounded bg-slate-950 p-2 text-[11px] text-gray-300 overflow-auto max-h-[55vh] whitespace-pre-wrap">{raw}</pre>
          : <DataGrid columns={grid.columns} rows={grid.rows} />
      )}
      {!resp && (
        <p className="text-xs text-slate-500 mt-2">
          Query a database exposed over HTTP (PostgREST, CouchDB, Elasticsearch, Datasette, or any JSON API) and the
          response is rendered as a table. Browsers enforce CORS, so for hosts without CORS headers set a proxy above.
          Test only endpoints you own or are authorized to access.
        </p>
      )}
    </div>
  );
}

export default function DbBrowserWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('sqlite');
  const log = (m) => onLogMessage?.(m);
  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <div className="flex rounded overflow-hidden border border-slate-800 text-xs">
          <button onClick={() => setTab('sqlite')} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === 'sqlite' ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}><Database size={13} /> SQLite file</button>
          <button onClick={() => setTab('endpoint')} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === 'endpoint' ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}><Globe size={13} /> Endpoint</button>
        </div>
      </div>
      {tab === 'sqlite' ? <SqliteTab log={log} /> : <EndpointTab log={log} />}
    </div>
  );
}
