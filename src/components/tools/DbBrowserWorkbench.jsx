import React, { useState, useMemo, useCallback } from 'react';
import { Database, Table as TableIcon, FileUp, Globe, RefreshCw, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { openDatabase, listSchema, readRows, countRows } from '../../utils/sqlite.js';
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

function SqliteTab({ log }) {
  const [db, setDb] = useState(null);
  const [fileName, setFileName] = useState('');
  const [schema, setSchema] = useState([]);
  const [active, setActive] = useState(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');

  const tables = useMemo(() => schema.filter((s) => s.type === 'table' && s.rootpage), [schema]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(''); setDb(null); setSchema([]); setActive(null); setPage(0);
    try {
      const ab = await file.arrayBuffer();
      const handle = openDatabase(ab);
      const sch = listSchema(handle);
      setDb(handle); setFileName(file.name); setSchema(sch);
      const firstTable = sch.find((s) => s.type === 'table' && s.rootpage);
      if (firstTable) selectTable(handle, firstTable);
      log?.(`Opened ${file.name} (${(file.size / 1024).toFixed(0)} KB) — ${sch.filter((s) => s.type === 'table').length} table(s)`);
    } catch (err) {
      setError(err.message || String(err));
      log?.(`SQLite open failed: ${err.message}`);
    }
  };

  const selectTable = (handle, t) => {
    const count = countRows(handle, t.rootpage, 2000000);
    setActive({ ...t, count });
    setPage(0);
  };

  const view = useMemo(() => {
    if (!db || !active) return null;
    const { rows } = readRows(db, active.rootpage, { limit: PAGE_SIZE, offset: page * PAGE_SIZE });
    const columns = active.columns?.length ? active.columns : (rows[0]?.values.map((_, i) => `col${i}`) || []);
    return {
      columns,
      rowIds: rows.map((r) => r.rowid),
      rows: rows.map((r) => r.values.map(cellText)),
    };
  }, [db, active, page]);

  const totalPages = active ? Math.max(1, Math.ceil(active.count / PAGE_SIZE)) : 1;

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-cyan-900/40 border border-cyan-800 rounded text-xs text-cyan-200 cursor-pointer hover:bg-cyan-900/60">
          <FileUp size={14} /> Open .sqlite / .db file
          <input type="file" accept=".sqlite,.sqlite3,.db,.db3,.s3db,application/x-sqlite3,application/vnd.sqlite3" className="hidden" onChange={onFile} />
        </label>
        {fileName && <span className="text-xs text-gray-400 font-mono">{fileName}</span>}
      </div>
      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}
      {db && (
        <div className="grid grid-cols-[minmax(10rem,14rem)_1fr] gap-3">
          <div className="border border-slate-800 rounded bg-slate-900/40 p-2 max-h-[60vh] overflow-auto">
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Tables</div>
            {tables.map((t) => (
              <button
                key={t.name}
                onClick={() => selectTable(db, t)}
                className={`w-full text-left px-2 py-1 rounded text-xs font-mono flex items-center gap-1.5 mb-0.5 ${active?.name === t.name ? 'bg-cyan-900/50 text-cyan-200' : 'text-gray-300 hover:bg-slate-800'}`}
              >
                <TableIcon size={12} className="shrink-0" /> <span className="truncate">{t.name}</span>
              </button>
            ))}
            {tables.length === 0 && <div className="text-xs text-slate-600">No tables.</div>}
          </div>
          <div className="min-w-0">
            {active && (
              <>
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="text-xs text-gray-300 font-mono">
                    <span className="text-cyan-300">{active.name}</span> · {active.count.toLocaleString()} row(s)
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="px-2 py-1 bg-slate-800 rounded disabled:opacity-40"><ChevronLeft size={12} /></button>
                    <span className="text-gray-400">page {page + 1} / {totalPages}</span>
                    <button disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 bg-slate-800 rounded disabled:opacity-40"><ChevronRight size={12} /></button>
                  </div>
                </div>
                {active.sql && <pre className="mb-2 p-2 bg-slate-950 border border-slate-800 rounded text-[10px] text-slate-400 overflow-auto max-h-24 whitespace-pre-wrap">{active.sql}</pre>}
                {view && <DataGrid columns={view.columns} rows={view.rows} rowIds={view.rowIds} />}
              </>
            )}
          </div>
        </div>
      )}
      {!db && !error && (
        <p className="text-xs text-slate-500">
          Open a local SQLite database to browse its tables and rows. Parsing is read-only and fully in-browser —
          the file is never uploaded. <code className="text-slate-400">INTEGER PRIMARY KEY</code> columns alias the
          <code className="text-slate-400"> rowid</code> shown in the first column.
        </p>
      )}
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
