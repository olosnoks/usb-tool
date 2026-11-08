import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Plus, Trash2, Filter, FilterX, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PanelRight,
  LineChart, ArrowUp, ArrowDown, Download, Upload, Ban, Check, Eye, FileDown, KeyRound,
} from 'lucide-react';
import { btn, btnPrimary, input, label, cellPreview, valueType, valueText, Plot, downloadText, pickFile } from './common.jsx';
import { ViewEditor } from './SchemaEditors.jsx';
import {
  listObjects, columnsOf, rowKeyFor, buildBrowseQuery, queryAll, scalar, updateCell, insertRow, deleteRows,
  detectBlobType, looksLikeText, hexDump, tokenize, sqlLiteral, toCsv,
} from '../../../utils/sqliteStudio.js';

const PAGE_SIZES = [50, 100, 250, 500, 1000];

/** Inline the ? params of a query (for "save filter as view"). */
function inlineParams(sql, params) {
  let i = 0;
  return tokenize(sql).map((t) => (t.t === 'param' && t.v === '?' ? sqlLiteral(params[i++]) : t.v)).join('');
}

function FilterInput({ value, onChange, placeholder }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);
  useEffect(() => {
    if ((value || '') === v) return undefined;
    const t = setTimeout(() => onChange(v), 300);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') onChange(v); }}
    className="w-full min-w-[5rem] bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[11px] font-mono text-gray-200 placeholder:text-slate-700 focus:outline-none focus:border-cyan-800" />;
}

export default function BrowseTab({ session, target }) {
  const { db, version } = session;
  const [table, setTable] = useState('');
  const [filters, setFilters] = useState({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [sort, setSort] = useState([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [selCell, setSelCell] = useState(null); // { r, c }
  const [selRows, setSelRows] = useState(new Set());
  const [editing, setEditing] = useState(null); // { r, c, text }
  const [showFilters, setShowFilters] = useState(true);
  const [showEditor, setShowEditor] = useState(true);
  const [showPlot, setShowPlot] = useState(false);
  const [error, setError] = useState('');
  const [gotoRow, setGotoRow] = useState('');
  const [viewDialog, setViewDialog] = useState(null);
  const [tick, setTick] = useState(0);
  const gridRef = useRef(null);
  const editDone = useRef(true); // guards against Enter + blur committing twice

  const objects = useMemo(() => (db ? listObjects(db).filter((o) => (o.type === 'table' || o.type === 'view') && !o.shadow) : []), [db, version]);

  const resetView = () => { setFilters({}); setGlobalFilter(''); setSort([]); setPage(0); setSelCell(null); setSelRows(new Set()); setEditing(null); setError(''); };
  const switchTable = (name) => { setTable(name); resetView(); };

  useEffect(() => { if (target?.name) switchTable(target.name); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!objects.length) { if (table) setTable(''); return; }
    if (!objects.some((o) => o.name === table)) switchTable((objects.find((o) => o.type === 'table') || objects[0]).name);
  }, [objects]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = useMemo(() => {
    if (!db || !table || !objects.some((o) => o.name === table)) return null;
    try {
      const cols = columnsOf(db, table).filter((c) => c.hidden !== 1);
      return { cols, key: rowKeyFor(db, table), isView: objects.find((o) => o.name === table)?.type === 'view' };
    } catch (e) { return { cols: [], key: { editable: false, keyCols: [] }, err: e.message }; }
  }, [db, version, table, objects]);

  const data = useMemo(() => {
    if (!meta || meta.err) return null;
    const q = buildBrowseQuery({ table, columns: meta.cols.map((c) => c.name), keyCols: meta.key.keyCols, filters, global: globalFilter, sort, limit: pageSize, offset: page * pageSize });
    try {
      const r = queryAll(db, q.sql, q.params);
      const count = scalar(db, q.countSql, q.countParams);
      const hasRid = r.columns[0] === '__rowid__';
      return { q, count, columns: hasRid ? r.columns.slice(1) : r.columns, rowids: hasRid ? r.rows.map((x) => x[0]) : null, rows: hasRid ? r.rows.map((x) => x.slice(1)) : r.rows, err: null };
    } catch (e) {
      return { q, count: 0, columns: meta.cols.map((c) => c.name), rowids: null, rows: [], err: e.message };
    }
  }, [db, version, meta, table, filters, globalFilter, sort, page, pageSize, tick]);

  const total = data?.count || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [pages, page]);

  const editable = !!meta?.key.editable && !meta?.isView;
  const keyOf = (r) => {
    if (!data || !meta) return null;
    if (meta.key.keyCols[0] === '_rowid_') return data.rowids ? [data.rowids[r]] : null;
    return meta.key.keyCols.map((k) => data.rows[r][data.columns.indexOf(k)]);
  };
  const colInfo = (c) => meta?.cols.find((x) => x.name === data?.columns[c]);
  const generated = (c) => { const ci = colInfo(c); return ci && (ci.hidden === 2 || ci.hidden === 3); };

  const commit = (r, c, value) => {
    setError('');
    try {
      const key = keyOf(r);
      if (!key) throw new Error('Rows of this table cannot be identified for editing');
      session.mutate((d) => ({ sql: updateCell(d, table, meta.key.keyCols, key, data.columns[c], value) }));
    } catch (e) { setError(e.message); }
  };

  const addRecord = () => {
    setError('');
    try {
      session.mutate((d) => insertRow(d, table));
      setFilters({}); setGlobalFilter('');
      const newTotal = scalar(db, `SELECT COUNT(*) FROM "${table.replace(/"/g, '""')}"`);
      const p = sort.length ? page : Math.max(0, Math.ceil(newTotal / pageSize) - 1);
      setPage(p);
      if (!sort.length) setSelCell({ r: (newTotal - 1) % pageSize, c: 0 });
    } catch (e) { setError(e.message); }
  };

  const deleteRecords = () => {
    const rs = selRows.size ? [...selRows] : selCell ? [selCell.r] : [];
    if (!rs.length) return;
    setError('');
    try {
      const keys = rs.map(keyOf);
      session.mutate((d) => ({ sql: `${deleteRows(d, table, meta.key.keyCols, keys)} -- ${keys.length} row(s)` }));
      setSelRows(new Set()); setSelCell(null);
    } catch (e) { setError(e.message); }
  };

  const toggleSort = (col, add) => setSort((s) => {
    const cur = s.find((x) => x.column === col);
    const next = !cur ? { column: col, dir: 'asc' } : cur.dir === 'asc' ? { column: col, dir: 'desc' } : null;
    if (add) { const rest = s.filter((x) => x.column !== col); return next ? [...rest, next] : rest; }
    return next ? [next] : [];
  });

  const startEdit = (r, c) => {
    if (!editable || generated(c)) return;
    const v = data.rows[r][c];
    if (v instanceof Uint8Array) { setShowEditor(true); return; }
    editDone.current = false;
    setEditing({ r, c, text: v === null ? '' : String(v), wasNull: v === null });
  };
  const finishEdit = (save) => {
    if (!editing || editDone.current) return;
    editDone.current = true;
    const { r, c, text, wasNull } = editing;
    setEditing(null);
    if (save && !(wasNull && text === '')) {
      const old = data.rows[r][c];
      if (String(old ?? '') !== text || old === null) commit(r, c, text);
    }
    gridRef.current?.focus();
  };

  const onGridKey = (e) => {
    if (editing || !data || !selCell) return;
    const { r, c } = selCell;
    const mv = (dr, dc) => { e.preventDefault(); setSelCell({ r: Math.max(0, Math.min(data.rows.length - 1, r + dr)), c: Math.max(0, Math.min(data.columns.length - 1, c + dc)) }); setSelRows(new Set()); };
    if (e.key === 'ArrowDown') mv(1, 0); else if (e.key === 'ArrowUp') mv(-1, 0);
    else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) mv(0, 1); else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) mv(0, -1);
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(r, c); }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      const text = selRows.size ? [...selRows].sort((a, b) => a - b).map((ri) => data.rows[ri].map(valueText).join('\t')).join('\n') : valueText(data.rows[r][c]);
      navigator.clipboard?.writeText(text);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && editable && !generated(c)) {
      e.preventDefault();
      navigator.clipboard?.readText().then((t) => commit(r, c, t)).catch(() => {});
    } else if (e.key === 'Delete' && selRows.size) { e.preventDefault(); deleteRecords(); }
  };

  const toggleRow = (r, e) => {
    setSelCell(null);
    setSelRows((s) => {
      const n = new Set(e.ctrlKey || e.metaKey ? s : []);
      if (e.shiftKey && s.size) { const last = Math.max(...s); for (let i = Math.min(last, r); i <= Math.max(last, r); i++) n.add(i); } else if (n.has(r) && (e.ctrlKey || e.metaKey)) n.delete(r); else n.add(r);
      return n;
    });
  };

  const goto = () => {
    const n = parseInt(gotoRow, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const idx = Math.min(n, total) - 1;
    setPage(Math.floor(idx / pageSize)); setSelCell({ r: idx % pageSize, c: 0 }); setSelRows(new Set());
  };

  const exportFiltered = () => {
    const q = buildBrowseQuery({ table, columns: meta.cols.map((c) => c.name), keyCols: [], filters, global: globalFilter, sort, limit: 1e12, offset: 0 });
    const r = queryAll(db, q.sql, q.params);
    downloadText(`${table}.csv`, toCsv(r.columns, r.rows), 'text/csv');
  };
  const filterViewSql = () => {
    const q = buildBrowseQuery({ table, columns: meta.cols.map((c) => c.name), keyCols: [], filters, global: globalFilter, sort, limit: 1, offset: 0 });
    return inlineParams(q.sql.replace(/ LIMIT \d+ OFFSET \d+$/, ''), q.params);
  };

  const hasFilter = Object.values(filters).some((v) => v && v.trim()) || globalFilter.trim() || sort.length;
  const cell = selCell && data?.rows[selCell.r] ? { value: data.rows[selCell.r][selCell.c], column: data.columns[selCell.c], type: colInfo(selCell.c)?.type } : null;

  if (!objects.length) return <div className="text-xs text-slate-500 p-4">This database has no tables yet. Create one in Database Structure or Execute SQL.</div>;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className={label}>Table</span>
        <select value={table} onChange={(e) => switchTable(e.target.value)} className={input + ' max-w-[16rem]'}>
          <optgroup label="Tables">{objects.filter((o) => o.type === 'table').map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}</optgroup>
          {objects.some((o) => o.type === 'view') && <optgroup label="Views">{objects.filter((o) => o.type === 'view').map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}</optgroup>}
        </select>
        <button className={btn} title="Refresh" onClick={() => { setTick((t) => t + 1); session.refresh(); }}><RefreshCw size={12} /></button>
        <button className={btn} title="Clear filters and sorting" disabled={!hasFilter} onClick={() => { setFilters({}); setGlobalFilter(''); setSort([]); setPage(0); }}><FilterX size={12} /></button>
        <button className={btn + (showFilters ? ' !border-cyan-800' : '')} title="Show/hide the column filter row" onClick={() => setShowFilters((s) => !s)}><Filter size={12} /></button>
        <div className="w-44"><FilterInput value={globalFilter} onChange={(v) => { setGlobalFilter(v); setPage(0); }} placeholder="Filter in any column" /></div>
        <span className="mx-1 h-4 border-l border-slate-700" />
        <button className={btn} disabled={!editable} onClick={addRecord} title={editable ? 'Insert a new record' : 'Views and tables without a usable key are read-only'}><Plus size={12} /> New Record</button>
        <button className={btn} disabled={!editable || (!selRows.size && !selCell)} onClick={deleteRecords}><Trash2 size={12} /> Delete Record{selRows.size > 1 ? `s (${selRows.size})` : ''}</button>
        <span className="mx-1 h-4 border-l border-slate-700" />
        <button className={btn} onClick={exportFiltered} title="Export all rows matching the current filter/sort as CSV"><FileDown size={12} /> CSV</button>
        <button className={btn} disabled={!hasFilter} onClick={() => setViewDialog(filterViewSql())} title="Save the current filter/sort as a view"><Eye size={12} /> Save as view</button>
        <button className={btn + (showPlot ? ' !border-cyan-800' : '')} onClick={() => setShowPlot((s) => !s)}><LineChart size={12} /> Plot</button>
        <button className={btn + (showEditor ? ' !border-cyan-800' : '')} onClick={() => setShowEditor((s) => !s)}><PanelRight size={12} /> Edit Cell</button>
      </div>
      {(error || data?.err || meta?.err) && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 font-mono">{error || data?.err || meta?.err}</div>}

      <div className={`grid gap-2 ${showEditor ? 'grid-cols-[minmax(0,1fr)_18rem]' : 'grid-cols-1'}`}>
        <div className="min-w-0">
          <div ref={gridRef} tabIndex={0} onKeyDown={onGridKey} className="overflow-auto border border-slate-800 rounded max-h-[58vh] focus:outline-none focus:border-slate-700">
            <table className="text-xs font-mono border-collapse min-w-full">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr>
                  <th className="px-2 py-1 text-right text-slate-600 border-b border-r border-slate-800 w-12 font-normal">{meta?.key.keyCols[0] === '_rowid_' ? 'rowid' : '#'}</th>
                  {data?.columns.map((c, ci) => {
                    const s = sort.findIndex((x) => x.column === c);
                    const info = meta.cols.find((x) => x.name === c);
                    return (
                      <th key={ci} onClick={(e) => toggleSort(c, e.shiftKey)} title={`${info?.type || 'untyped'}${info?.pk ? ' · primary key' : ''}${info?.notnull ? ' · NOT NULL' : ''} — click to sort, Shift+click to add a sort column`}
                        className="px-2 py-1 text-left text-slate-200 border-b border-r border-slate-800 whitespace-nowrap cursor-pointer select-none hover:bg-slate-800 font-semibold">
                        {info?.pk ? <KeyRound size={10} className="inline mr-1 text-amber-400" /> : null}{c}
                        {s >= 0 && <span className="ml-1 text-cyan-400">{sort[s].dir === 'asc' ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />}{sort.length > 1 ? <sup>{s + 1}</sup> : null}</span>}
                      </th>
                    );
                  })}
                </tr>
                {showFilters && (
                  <tr>
                    <th className="px-1 py-0.5 border-b border-r border-slate-800 bg-slate-900"><Filter size={10} className="inline text-slate-600" /></th>
                    {data?.columns.map((c) => (
                      <th key={c} className="px-1 py-0.5 border-b border-r border-slate-800 bg-slate-900 font-normal">
                        <FilterInput value={filters[c]} onChange={(v) => { setFilters((f) => ({ ...f, [c]: v })); setPage(0); }} placeholder="Filter" />
                      </th>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {data?.rows.map((row, ri) => (
                  <tr key={ri} className={selRows.has(ri) ? 'bg-cyan-950/50' : 'odd:bg-slate-900/30 hover:bg-slate-800/30'}>
                    <td onClick={(e) => toggleRow(ri, e)} className="px-2 py-0.5 text-right text-slate-500 border-b border-r border-slate-900 cursor-pointer select-none hover:text-cyan-300">
                      {data.rowids ? data.rowids[ri] : page * pageSize + ri + 1}
                    </td>
                    {row.map((v, ci) => {
                      const isSel = selCell && selCell.r === ri && selCell.c === ci;
                      if (editing && editing.r === ri && editing.c === ci) {
                        return (
                          <td key={ci} className="p-0 border-b border-r border-cyan-700">
                            <input autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); } else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); } e.stopPropagation(); }}
                              onBlur={() => finishEdit(true)} className="w-full min-w-[8rem] bg-slate-950 px-2 py-0.5 text-xs font-mono text-white outline-none" />
                          </td>
                        );
                      }
                      const p = cellPreview(v);
                      return (
                        <td key={ci} onClick={() => { setSelCell({ r: ri, c: ci }); setSelRows(new Set()); gridRef.current?.focus(); }} onDoubleClick={() => startEdit(ri, ci)}
                          title={typeof v === 'string' && v.length > 40 ? v.slice(0, 1000) : undefined}
                          className={`px-2 py-0.5 border-b border-r border-slate-900 max-w-[22rem] truncate cursor-default ${p.cls} ${generated(ci) ? 'opacity-70' : ''} ${isSel ? 'outline outline-1 -outline-offset-1 outline-cyan-500 bg-cyan-950/40' : ''}`}>{p.text}</td>
                      );
                    })}
                  </tr>
                ))}
                {data && data.rows.length === 0 && <tr><td colSpan={data.columns.length + 1} className="px-2 py-4 text-center text-slate-600">No rows{hasFilter ? ' match the filter' : ''}.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-1.5 mt-2 text-xs flex-wrap">
            <button className={btn} disabled={page === 0} onClick={() => setPage(0)}><ChevronsLeft size={12} /></button>
            <button className={btn} disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft size={12} /></button>
            <span className="text-gray-400">{total ? `${(page * pageSize + 1).toLocaleString()} – ${Math.min(total, (page + 1) * pageSize).toLocaleString()} of ${total.toLocaleString()}` : '0 rows'}</span>
            <button className={btn} disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={12} /></button>
            <button className={btn} disabled={page + 1 >= pages} onClick={() => setPage(pages - 1)}><ChevronsRight size={12} /></button>
            <select value={pageSize} onChange={(e) => { setPageSize(+e.target.value); setPage(0); }} className={input}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / page</option>)}</select>
            <span className="ml-2 text-slate-500">Go to</span>
            <input value={gotoRow} onChange={(e) => setGotoRow(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goto()} className={input + ' w-20'} placeholder="row #" />
            <span className="ml-auto text-[10px] text-slate-500">
              {editable ? 'Double-click or Enter to edit · Ctrl+C / Ctrl+V · click row numbers to select rows' : 'Read-only (view or table without a usable key)'}
              {' · filters: text, =x, >x, <x, a~b, /regex/, =NULL'}
            </span>
          </div>
          {showPlot && data && <div className="mt-2"><Plot columns={data.columns} rows={data.rows} /></div>}
        </div>

        {showEditor && (
          <EditCellPanel cell={cell} editable={editable && selCell && !generated(selCell.c)} onApply={(v) => selCell && commit(selCell.r, selCell.c, v)} />
        )}
      </div>
      {viewDialog !== null && <ViewEditor session={session} initialSelect={viewDialog} onClose={() => setViewDialog(null)} />}
    </div>
  );
}

const MODES = ['Text', 'JSON', 'Binary', 'Image'];

function autoMode(v) {
  if (v instanceof Uint8Array) return detectBlobType(v)?.startsWith('image/') ? 'Image' : looksLikeText(v) ? 'Text' : 'Binary';
  if (typeof v === 'string' && /^\s*[[{]/.test(v)) { try { JSON.parse(v); return 'JSON'; } catch { /* not json */ } }
  return 'Text';
}

/** DB4S's "Edit Database Cell" dock. */
function EditCellPanel({ cell, editable, onApply }) {
  const v = cell?.value;
  const [mode, setMode] = useState('Text');
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [imgUrl, setImgUrl] = useState(null);

  useEffect(() => {
    const m = autoMode(v);
    setMode(m); setErr('');
    if (v instanceof Uint8Array) setText(looksLikeText(v) ? new TextDecoder().decode(v) : '');
    else if (m === 'JSON') setText(JSON.stringify(JSON.parse(v), null, 2));
    else setText(v === null || v === undefined ? '' : String(v));
  }, [cell?.value, cell?.column]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!(v instanceof Uint8Array) || mode !== 'Image') { setImgUrl(null); return undefined; }
    const url = URL.createObjectURL(new Blob([v], { type: detectBlobType(v) || 'image/png' }));
    setImgUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [v, mode]);

  const apply = () => {
    setErr('');
    if (mode === 'JSON') { try { JSON.parse(text); } catch (e) { setErr(`Invalid JSON: ${e.message}`); return; } }
    if (mode === 'Binary' || mode === 'Image') return; // nothing to apply from the read-only views
    onApply(text);
  };
  const importFile = async () => {
    const f = await pickFile('');
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    onApply(mode === 'Text' && looksLikeText(bytes) ? new TextDecoder().decode(bytes) : bytes);
  };
  const exportFile = () => {
    if (v === null || v === undefined) return;
    const t = v instanceof Uint8Array ? detectBlobType(v) : null;
    const ext = t ? t.split('/')[1].replace('svg+xml', 'svg').replace('jpeg', 'jpg') : v instanceof Uint8Array ? 'bin' : mode === 'JSON' ? 'json' : 'txt';
    const blob = new Blob([v instanceof Uint8Array ? v : String(v)], { type: t || 'application/octet-stream' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cell.column || 'cell'}.${ext}`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return (
    <div className="border border-slate-800 rounded bg-slate-900/40 p-2 text-xs flex flex-col max-h-[64vh]">
      <div className="text-[11px] uppercase tracking-wide text-cyan-400 mb-1">Edit Database Cell</div>
      {!cell ? <div className="text-slate-600">Select a cell.</div> : (
        <>
          <div className="flex items-center gap-1 mb-1">
            <span className="font-mono text-gray-300 truncate" title={cell.column}>{cell.column}</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={input + ' ml-auto'}>{MODES.map((m) => <option key={m}>{m}</option>)}</select>
          </div>
          <div className="text-[10px] text-slate-500 mb-1">Type of data currently in cell: <span className="text-gray-300">{valueType(v)}</span>{v instanceof Uint8Array ? ` · ${v.length.toLocaleString()} bytes` : typeof v === 'string' ? ` · ${v.length.toLocaleString()} chars` : ''}{cell.type ? ` · column ${cell.type}` : ''}</div>
          {mode === 'Image' ? (
            imgUrl ? <div className="flex-1 overflow-auto bg-[repeating-conic-gradient(#1e293b_0_25%,#0f172a_0_50%)] bg-[length:16px_16px] rounded p-1"><img src={imgUrl} alt="" className="max-w-full" /></div> : <div className="text-slate-600">Not an image.</div>
          ) : mode === 'Binary' ? (
            <pre className="flex-1 overflow-auto bg-slate-950 border border-slate-800 rounded p-1 text-[10px] text-gray-300 whitespace-pre">{v instanceof Uint8Array ? hexDump(v) : hexDump(new TextEncoder().encode(valueText(v)))}</pre>
          ) : (
            <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); apply(); } }}
              readOnly={!editable} spellCheck={false} className="flex-1 min-h-[12rem] bg-slate-950 border border-slate-800 rounded p-1.5 font-mono text-[11px] text-gray-200 resize-none focus:outline-none focus:border-cyan-800" />
          )}
          {err && <div className="mt-1 text-red-300">{err}</div>}
          <div className="flex flex-wrap gap-1 mt-2">
            <button className={btnPrimary} disabled={!editable || mode === 'Binary' || mode === 'Image'} onClick={apply} title="Ctrl+Enter"><Check size={12} /> Apply</button>
            <button className={btn} disabled={!editable || v === null} onClick={() => onApply(null)}><Ban size={12} /> Set as NULL</button>
            <button className={btn} disabled={!editable} onClick={importFile} title="Load a file into this cell"><Upload size={12} /> Import</button>
            <button className={btn} disabled={v === null || v === undefined} onClick={exportFile}><Download size={12} /> Export</button>
          </div>
        </>
      )}
    </div>
  );
}

