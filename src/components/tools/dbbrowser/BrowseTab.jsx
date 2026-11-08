import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  RefreshCw, Plus, Trash2, Filter, FilterX, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, PanelRight,
  LineChart, ArrowUp, ArrowDown, Eye, FileDown, KeyRound, Undo2, Redo2, Copy, ClipboardPaste, Ban, CopyPlus,
  Link2, EyeOff, Columns3, Database,
} from 'lucide-react';
import { btn, input, label, cellPreview, valueText, Plot, downloadText } from './common.jsx';
import { ViewEditor } from './SchemaEditors.jsx';
import EditCellPanel from './EditCellPanel.jsx';
import {
  listObjects, listSchemas, columnsOf, rowKeyFor, buildBrowseQuery, queryAll, scalar, updateCell, insertRow, deleteRows,
  tokenize, sqlLiteral, toCsv, parseCsv, qid, qname, foreignKeysOf, snapshotRows, restoreRows, rowsToInsertSql,
  DISPLAY_FORMATS, formatValue,
} from '../../../utils/sqliteStudio.js';

const PAGE_SIZES = [50, 100, 250, 500, 1000];
const SEP = '\u0000';
const keyOfRef = (schema, name) => schema + SEP + name;
const refOfKey = (k) => { const [schema, name] = k.split(SEP); return schema === 'main' ? name : { schema, name }; };
const nameOfKey = (k) => { const [schema, name] = k.split(SEP); return schema === 'main' ? name : `${schema}.${name}`; };

/** Inline the ? params of a query (for "save filter as view"). */
function inlineParams(sql, params) {
  let i = 0;
  return tokenize(sql).map((t) => (t.t === 'param' && t.v === '?' ? sqlLiteral(params[i++]) : t.v)).join('');
}
const eqFilter = (v) => (v === null ? '=NULL' : typeof v === 'number' ? `=${v}` : `='${String(v)}'`);

function FilterInput({ value, onChange, placeholder }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);
  useEffect(() => {
    if ((value || '') === v) return undefined;
    const t = setTimeout(() => onChange(v), 300);
    return () => clearTimeout(t);
  }, [v]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} onKeyDown={(e) => { if (e.key === 'Enter') onChange(v); e.stopPropagation(); }}
    className="w-full min-w-[5rem] bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[11px] font-mono text-gray-200 placeholder:text-slate-700 focus:outline-none focus:border-cyan-800" />;
}

function ContextMenu({ menu, onClose }) {
  useEffect(() => {
    const h = () => onClose();
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('mousedown', h); window.addEventListener('keydown', k); window.addEventListener('scroll', h, true);
    return () => { window.removeEventListener('mousedown', h); window.removeEventListener('keydown', k); window.removeEventListener('scroll', h, true); };
  }, [onClose]);
  const x = Math.min(menu.x, window.innerWidth - 260); const y = Math.min(menu.y, window.innerHeight - menu.items.length * 28 - 16);
  return (
    <div className="fixed z-[150] min-w-[15rem] max-h-[80vh] overflow-auto bg-slate-900 border border-slate-700 rounded shadow-xl py-1 text-xs" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => (it.sep ? <div key={i} className="my-1 border-t border-slate-800" /> : it.heading ? <div key={i} className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500">{it.heading}</div> : (
        <button key={i} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }} className="w-full text-left px-3 py-1.5 text-gray-200 hover:bg-slate-800 disabled:opacity-40 inline-flex items-center gap-2">
          {it.icon ? <it.icon size={12} className="text-slate-400" /> : <span className="w-3" />}<span className={it.checked ? 'text-cyan-300' : ''}>{it.label}</span>
          {it.hint && <span className="ml-auto pl-4 text-[10px] text-slate-500">{it.hint}</span>}
        </button>
      )))}
    </div>
  );
}

export default function BrowseTab({ session, target }) {
  const { db, version } = session;
  const [tkey, setTkey] = useState('');
  const [filters, setFilters] = useState({});
  const [globalFilter, setGlobalFilter] = useState('');
  const [sort, setSort] = useState([]);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(100);
  const [anchor, setAnchor] = useState(null); // { r, c } range start
  const [focus, setFocus] = useState(null);   // { r, c } range end / current cell
  const [selRows, setSelRows] = useState(new Set());
  const [editing, setEditing] = useState(null); // { r, c, text }
  const [showFilters, setShowFilters] = useState(true);
  const [showEditor, setShowEditor] = useState(true);
  const [showPlot, setShowPlot] = useState(false);
  const [error, setError] = useState('');
  const [gotoRow, setGotoRow] = useState('');
  const [viewDialog, setViewDialog] = useState(null);
  const [menu, setMenu] = useState(null);
  const [hidden, setHidden] = useState({});   // tkey -> [col]
  const [formats, setFormats] = useState({}); // tkey -> { col: fmt }
  const [tick, setTick] = useState(0);
  const gridRef = useRef(null);
  const editDone = useRef(true); // guards against Enter + blur committing twice
  const pendingFilter = useRef(null);

  const ref = tkey ? refOfKey(tkey) : null;
  const tname = tkey ? nameOfKey(tkey) : '';

  const objects = useMemo(() => {
    if (!db) return [];
    const out = [];
    for (const schema of listSchemas(db)) {
      try { for (const o of listObjects(db, schema)) if ((o.type === 'table' || o.type === 'view') && !o.shadow) out.push({ ...o, schema, key: keyOfRef(schema, o.name) }); } catch { /* detached meanwhile */ }
    }
    return out;
  }, [db, version]);

  const resetView = () => { setFilters({}); setGlobalFilter(''); setSort([]); setPage(0); setAnchor(null); setFocus(null); setSelRows(new Set()); setEditing(null); setError(''); };
  const switchTable = (k) => { setTkey(k); resetView(); };

  useEffect(() => { if (target?.name) switchTable(keyOfRef(target.schema || 'main', target.name)); }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!objects.length) { if (tkey) setTkey(''); return; }
    if (!objects.some((o) => o.key === tkey)) switchTable((objects.find((o) => o.type === 'table' && o.schema === 'main') || objects[0]).key);
  }, [objects]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pendingFilter.current && pendingFilter.current.key === tkey) { setFilters(pendingFilter.current.filters); pendingFilter.current = null; } }, [tkey]);

  const meta = useMemo(() => {
    if (!db || !ref || !objects.some((o) => o.key === tkey)) return null;
    try {
      const cols = columnsOf(db, ref).filter((c) => c.hidden !== 1);
      const fks = {};
      for (const f of foreignKeysOf(db, ref)) if (!fks[f.from]) fks[f.from] = f;
      const pks = cols.filter((c) => c.pk);
      const rowidAlias = pks.length === 1 && /^INTEGER$/i.test(pks[0].type) ? pks[0].name : null;
      return { cols, fks, rowidAlias, key: rowKeyFor(db, ref), isView: objects.find((o) => o.key === tkey)?.type === 'view' };
    } catch (e) { return { cols: [], fks: {}, key: { editable: false, keyCols: [] }, err: e.message }; }
  }, [db, version, tkey, objects]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = useMemo(() => {
    if (!meta || meta.err) return null;
    const q = buildBrowseQuery({ table: ref, columns: meta.cols.map((c) => c.name), keyCols: meta.key.keyCols, filters, global: globalFilter, sort, limit: pageSize, offset: page * pageSize });
    try {
      const r = queryAll(db, q.sql, q.params);
      const count = scalar(db, q.countSql, q.countParams);
      const hasRid = r.columns[0] === '__rowid__';
      return { q, count, columns: hasRid ? r.columns.slice(1) : r.columns, rowids: hasRid ? r.rows.map((x) => x[0]) : null, rows: hasRid ? r.rows.map((x) => x.slice(1)) : r.rows, err: null };
    } catch (e) {
      return { q, count: 0, columns: meta.cols.map((c) => c.name), rowids: null, rows: [], err: e.message };
    }
  }, [db, version, meta, filters, globalFilter, sort, page, pageSize, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = data?.count || 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page >= pages) setPage(pages - 1); }, [pages, page]);

  const hiddenCols = hidden[tkey] || [];
  const fmt = formats[tkey] || {};
  const vis = data ? data.columns.map((_, i) => i).filter((i) => !hiddenCols.includes(data.columns[i])) : [];

  const editable = !!meta?.key.editable && !meta?.isView && !session.readOnly;
  const keyOf = (r) => {
    if (!data || !meta) return null;
    if (meta.key.keyCols[0] === '_rowid_') return data.rowids ? [data.rowids[r]] : null;
    return meta.key.keyCols.map((k) => data.rows[r][data.columns.indexOf(k)]);
  };
  const colInfo = (c) => meta?.cols.find((x) => x.name === data?.columns[c]);
  const generated = (c) => { const ci = colInfo(c); return ci && (ci.hidden === 2 || ci.hidden === 3); };

  // Selection range in data coordinates (rows × visible column positions).
  const range = useMemo(() => {
    if (!focus) return null;
    const a = anchor || focus;
    const ca = vis.indexOf(a.c); const cf = vis.indexOf(focus.c);
    return { r1: Math.min(a.r, focus.r), r2: Math.max(a.r, focus.r), v1: Math.min(ca, cf), v2: Math.max(ca, cf) };
  }, [anchor, focus, vis.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const inRange = (r, c) => range && r >= range.r1 && r <= range.r2 && vis.indexOf(c) >= range.v1 && vis.indexOf(c) <= range.v2;
  const rangeCols = () => (range ? vis.slice(range.v1, range.v2 + 1) : []);
  const selectedRowIdx = () => (selRows.size ? [...selRows].sort((a, b) => a - b) : range ? Array.from({ length: range.r2 - range.r1 + 1 }, (_, i) => range.r1 + i) : []);

  /** Apply cell changes [{ r, c, value }] as one undoable step. */
  const applyCells = (changes, label) => {
    setError('');
    if (!changes.length) return;
    try {
      const keyCols = meta.key.keyCols;
      const edits = changes.map(({ r, c, value }) => {
        const column = data.columns[c];
        const before = keyOf(r);
        if (!before) throw new Error('Rows of this table cannot be identified for editing');
        let after = before;
        if (keyCols[0] === '_rowid_' && column === meta.rowidAlias) after = [value];
        else if (keyCols.includes(column)) after = keyCols.map((k, i) => (k === column ? value : before[i]));
        return { column, before, after, oldValue: data.rows[r][c], value };
      });
      const t = ref;
      session.mutate((d) => {
        d.run('SAVEPOINT sqlb_edit');
        try { for (const e of edits) updateCell(d, t, keyCols, e.before, e.column, e.value); d.run('RELEASE sqlb_edit'); } catch (err) { d.run('ROLLBACK TO sqlb_edit'); d.run('RELEASE sqlb_edit'); throw err; }
        return { sqls: edits.map((e) => `UPDATE ${qname(t)} SET ${qid(e.column)} = ${sqlLiteral(e.value)} WHERE ${keyCols.join(',')} = ${e.before.map(sqlLiteral).join(',')}`) };
      });
      session.pushUndo({
        label: label || `edit ${edits.length === 1 ? edits[0].column : `${edits.length} cells`} in ${tname}`,
        undo: (d) => { for (const e of [...edits].reverse()) updateCell(d, t, keyCols, e.after, e.column, e.oldValue); },
        redo: (d) => { for (const e of edits) updateCell(d, t, keyCols, e.before, e.column, e.value); },
      });
    } catch (e) { setError(e.message); }
  };
  const commit = (r, c, value) => applyCells([{ r, c, value }]);

  const addRecord = () => {
    setError('');
    try {
      const t = ref;
      const res = session.mutate((d) => insertRow(d, t));
      if (meta.key.keyCols[0] === '_rowid_') {
        const snap = snapshotRows(db, t, ['_rowid_'], [[res.rowid]]);
        session.pushUndo({ label: `new record in ${tname}`, undo: (d) => deleteRows(d, t, ['_rowid_'], [[res.rowid]]), redo: (d) => restoreRows(d, t, snap) });
      }
      setFilters({}); setGlobalFilter('');
      const newTotal = scalar(db, `SELECT COUNT(*) FROM ${qname(t)}`);
      if (!sort.length) { setPage(Math.max(0, Math.ceil(newTotal / pageSize) - 1)); const cell = { r: (newTotal - 1) % pageSize, c: vis[0] ?? 0 }; setAnchor(cell); setFocus(cell); }
    } catch (e) { setError(e.message); }
  };

  const duplicateRecords = () => {
    const rs = selectedRowIdx();
    if (!rs.length) return;
    setError('');
    try {
      const t = ref;
      const keyCols = meta.key.keyCols;
      const keys = rs.map(keyOf);
      const copyCols = meta.cols.filter((c) => !c.hidden && c.name !== meta.rowidAlias).map((c) => qid(c.name)).join(', ');
      const newIds = [];
      session.mutate((d) => {
        for (const k of keys) {
          d.run(`INSERT INTO ${qname(t)} (${copyCols}) SELECT ${copyCols} FROM ${qname(t)} WHERE ${keyCols.map((x) => (x === '_rowid_' ? x : qid(x)) + ' = ?').join(' AND ')}`, k);
          newIds.push(scalar(d, 'SELECT last_insert_rowid()'));
        }
        return { sql: `-- duplicate ${keys.length} record(s) in ${tname}` };
      });
      if (keyCols[0] === '_rowid_') {
        const snap = snapshotRows(db, t, ['_rowid_'], newIds.map((x) => [x]));
        session.pushUndo({ label: `duplicate ${keys.length} record(s)`, undo: (d) => deleteRows(d, t, ['_rowid_'], newIds.map((x) => [x])), redo: (d) => restoreRows(d, t, snap) });
      }
    } catch (e) { setError(e.message); }
  };

  const deleteRecords = () => {
    const rs = selectedRowIdx();
    if (!rs.length) return;
    setError('');
    try {
      const t = ref;
      const keyCols = meta.key.keyCols;
      const keys = rs.map(keyOf);
      const snap = snapshotRows(db, t, keyCols, keys);
      session.mutate((d) => ({ sql: `${deleteRows(d, t, keyCols, keys)} -- ${keys.length} row(s)` }));
      session.pushUndo({ label: `delete ${keys.length} record(s) from ${tname}`, undo: (d) => restoreRows(d, t, snap), redo: (d) => deleteRows(d, t, keyCols, keys) });
      setSelRows(new Set()); setAnchor(null); setFocus(null);
    } catch (e) { setError(e.message); }
  };

  const doUndo = () => { setError(''); try { session.undo(); } catch (e) { setError(e.message); } };
  const doRedo = () => { setError(''); try { session.redo(); } catch (e) { setError(e.message); } };

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

  // ---- clipboard ----
  const copyText = (withHeaders) => {
    if (!data) return '';
    if (selRows.size) {
      const lines = selectedRowIdx().map((ri) => vis.map((c) => valueText(data.rows[ri][c])).join('\t'));
      if (withHeaders) lines.unshift(vis.map((c) => data.columns[c]).join('\t'));
      return lines.join('\n');
    }
    if (!range) return '';
    const cols = rangeCols();
    const lines = [];
    for (let r = range.r1; r <= range.r2; r++) lines.push(cols.map((c) => valueText(data.rows[r][c])).join('\t'));
    if (withHeaders) lines.unshift(cols.map((c) => data.columns[c]).join('\t'));
    return lines.join('\n');
  };
  const copy = (withHeaders = false) => navigator.clipboard?.writeText(copyText(withHeaders));
  const copySql = () => {
    const rs = selectedRowIdx();
    const cols = selRows.size || !range ? vis : rangeCols();
    navigator.clipboard?.writeText(rowsToInsertSql(tname, cols.map((c) => data.columns[c]), rs.map((ri) => cols.map((c) => data.rows[ri][c]))));
  };
  const paste = async () => {
    if (!editable || !range) return;
    let text;
    try { text = await navigator.clipboard.readText(); } catch { setError('The browser did not allow reading the clipboard'); return; }
    const grid = parseCsv(text.replace(/\r?\n$/, ''), { separator: '\t', quote: '"' });
    if (!grid.length) return;
    const changes = [];
    if (grid.length === 1 && grid[0].length === 1) {
      // one value: fill the whole selection
      for (let r = range.r1; r <= range.r2; r++) for (const c of rangeCols()) if (!generated(c)) changes.push({ r, c, value: grid[0][0] });
    } else {
      grid.forEach((line, i) => line.forEach((v, j) => {
        const r = range.r1 + i; const c = vis[range.v1 + j];
        if (r < data.rows.length && c !== undefined && !generated(c)) changes.push({ r, c, value: v });
      }));
    }
    applyCells(changes, `paste ${changes.length} cell(s) into ${tname}`);
  };
  const setNull = () => {
    if (!range) return;
    const changes = [];
    for (let r = range.r1; r <= range.r2; r++) for (const c of rangeCols()) if (!generated(c)) changes.push({ r, c, value: null });
    applyCells(changes, `set ${changes.length} cell(s) to NULL`);
  };

  const jumpToFk = (r, c) => {
    const fk = meta?.fks[data.columns[c]];
    const v = data.rows[r][c];
    if (!fk || v === null) return;
    const schema = typeof ref === 'string' ? 'main' : ref.schema;
    const k = keyOfRef(schema, fk.table);
    if (!objects.some((o) => o.key === k)) { setError(`Referenced table ${fk.table} not found`); return; }
    pendingFilter.current = { key: k, filters: fk.to === '_rowid_' ? {} : { [fk.to]: eqFilter(v) } };
    if (k === tkey) { setFilters(pendingFilter.current.filters); pendingFilter.current = null; setPage(0); } else switchTable(k);
  };

  const onGridKey = (e) => {
    if (editing || !data) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); return; }
    if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); copy(e.shiftKey); return; }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); paste(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); if (data.rows.length && vis.length) { setAnchor({ r: 0, c: vis[0] }); setFocus({ r: data.rows.length - 1, c: vis[vis.length - 1] }); setSelRows(new Set()); } return; }
    if (e.key === 'Delete' && selRows.size) { e.preventDefault(); deleteRecords(); return; }
    if (e.key === 'Delete' && range && editable) { e.preventDefault(); setNull(); return; }
    if (!focus) return;
    const { r, c } = focus;
    const vi = vis.indexOf(c);
    const mv = (dr, dv) => {
      e.preventDefault();
      const next = { r: Math.max(0, Math.min(data.rows.length - 1, r + dr)), c: vis[Math.max(0, Math.min(vis.length - 1, vi + dv))] };
      if (e.shiftKey && e.key !== 'Tab') setFocus(next); else { setAnchor(next); setFocus(next); }
      setSelRows(new Set());
    };
    if (e.key === 'ArrowDown') mv(1, 0); else if (e.key === 'ArrowUp') mv(-1, 0);
    else if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) mv(0, 1); else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) mv(0, -1);
    else if (e.key === 'PageDown') mv(20, 0); else if (e.key === 'PageUp') mv(-20, 0);
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(r, c); }
  };

  const clickCell = (e, r, c) => {
    if ((e.ctrlKey || e.metaKey) && meta?.fks[data.columns[c]]) { jumpToFk(r, c); return; }
    if (e.shiftKey && focus) setFocus({ r, c }); else { setAnchor({ r, c }); setFocus({ r, c }); }
    setSelRows(new Set());
    gridRef.current?.focus();
  };

  const toggleRow = (r, e) => {
    setAnchor(null); setFocus(null);
    gridRef.current?.focus();
    setSelRows((s) => {
      const n = new Set(e.ctrlKey || e.metaKey ? s : []);
      if (e.shiftKey && s.size) { const last = Math.max(...s); for (let i = Math.min(last, r); i <= Math.max(last, r); i++) n.add(i); } else if (n.has(r) && (e.ctrlKey || e.metaKey)) n.delete(r); else n.add(r);
      return n;
    });
  };

  // Menus store only what was clicked; items are built at render time so the
  // actions see the selection as updated by the right-click.
  const cellMenu = (e, r, c) => {
    e.preventDefault();
    if (!inRange(r, c) && !selRows.has(r)) { setAnchor({ r, c }); setFocus({ r, c }); setSelRows(new Set()); }
    setMenu({ x: e.clientX, y: e.clientY, kind: 'cell', r, c });
  };
  const cellMenuItems = (r, c) => {
    if (!data?.rows[r]) return [];
    const fk = meta?.fks[data.columns[c]];
    const v = data.rows[r][c];
    return [
      { label: 'Copy', icon: Copy, hint: 'Ctrl+C', onClick: () => copy(false) },
      { label: 'Copy with Headers', icon: Copy, hint: 'Ctrl+Shift+C', onClick: () => copy(true) },
      { label: 'Copy as SQL', icon: Copy, onClick: copySql },
      { label: 'Paste', icon: ClipboardPaste, hint: 'Ctrl+V', disabled: !editable, onClick: paste },
      { sep: true },
      { label: 'Set as NULL', icon: Ban, hint: 'Del', disabled: !editable, onClick: setNull },
      { label: `Use as filter (${data.columns[c]} ${eqFilter(v)})`.slice(0, 60), icon: Filter, onClick: () => { setFilters((f) => ({ ...f, [data.columns[c]]: eqFilter(v) })); setPage(0); } },
      ...(fk ? [{ label: `Jump to referenced row in ${fk.table}`, icon: Link2, hint: 'Ctrl+click', disabled: v === null, onClick: () => jumpToFk(r, c) }] : []),
      { sep: true },
      { label: 'Duplicate Record', icon: CopyPlus, disabled: !editable, onClick: duplicateRecords },
      { label: 'Delete Record(s)', icon: Trash2, disabled: !editable, onClick: deleteRecords },
    ];
  };

  const headerMenu = (e, col) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, kind: 'header', col }); };
  const headerMenuItems = (col) => {
    const cur = fmt[col] || '';
    return [
      { label: 'Sort ascending', icon: ArrowUp, onClick: () => setSort([{ column: col, dir: 'asc' }]) },
      { label: 'Sort descending', icon: ArrowDown, onClick: () => setSort([{ column: col, dir: 'desc' }]) },
      { label: 'Hide column', icon: EyeOff, disabled: vis.length <= 1, onClick: () => setHidden((h) => ({ ...h, [tkey]: [...hiddenCols, col] })) },
      { label: 'Show all columns', icon: Columns3, disabled: !hiddenCols.length, onClick: () => setHidden((h) => ({ ...h, [tkey]: [] })) },
      { sep: true },
      { heading: 'Display format' },
      ...DISPLAY_FORMATS.map((f) => ({ label: f.label, checked: cur === f.id, onClick: () => setFormats((m) => ({ ...m, [tkey]: { ...fmt, [col]: f.id } })) })),
    ];
  };

  const goto = () => {
    const n = parseInt(gotoRow, 10);
    if (!Number.isFinite(n) || n < 1) return;
    const idx = Math.min(n, total) - 1;
    setPage(Math.floor(idx / pageSize));
    const cell = { r: idx % pageSize, c: vis[0] ?? 0 }; setAnchor(cell); setFocus(cell); setSelRows(new Set());
  };

  const allRowsQuery = () => buildBrowseQuery({ table: ref, columns: meta.cols.map((c) => c.name), keyCols: [], filters, global: globalFilter, sort, limit: 1e12, offset: 0 });
  const exportFiltered = () => {
    const q = allRowsQuery();
    const r = queryAll(db, q.sql, q.params);
    const keep = r.columns.map((c, i) => i).filter((i) => !hiddenCols.includes(r.columns[i]));
    downloadText(`${tname}.csv`, toCsv(keep.map((i) => r.columns[i]), r.rows.map((row) => keep.map((i) => row[i]))), 'text/csv');
  };
  const filterViewSql = () => { const q = allRowsQuery(); return inlineParams(q.sql.replace(/ LIMIT \d+ OFFSET \d+$/, ''), q.params); };

  const hasFilter = Object.values(filters).some((v) => v && v.trim()) || globalFilter.trim() || sort.length;
  const cell = focus && data?.rows[focus.r] ? { value: data.rows[focus.r][focus.c], column: data.columns[focus.c], type: colInfo(focus.c)?.type } : null;
  const schemas = [...new Set(objects.map((o) => o.schema))];

  if (!objects.length) return <div className="text-xs text-slate-500 p-4">This database has no tables yet. Create one in Database Structure or Execute SQL.</div>;

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <span className={label}>Table</span>
        <select value={tkey} onChange={(e) => switchTable(e.target.value)} className={input + ' max-w-[18rem]'}>
          {schemas.map((s) => ['table', 'view'].map((type) => {
            const items = objects.filter((o) => o.schema === s && o.type === type);
            if (!items.length) return null;
            return <optgroup key={s + type} label={`${s === 'main' ? '' : `${s}: `}${type === 'table' ? 'Tables' : 'Views'}`}>{items.map((o) => <option key={o.key} value={o.key}>{s === 'main' ? o.name : `${s}.${o.name}`}</option>)}</optgroup>;
          }))}
        </select>
        <button className={btn} title="Refresh" onClick={() => { setTick((t) => t + 1); session.refresh(); }}><RefreshCw size={12} /></button>
        <button className={btn} title="Clear filters and sorting" disabled={!hasFilter} onClick={() => { setFilters({}); setGlobalFilter(''); setSort([]); setPage(0); }}><FilterX size={12} /></button>
        <button className={btn + (showFilters ? ' !border-cyan-800' : '')} title="Show/hide the column filter row" onClick={() => setShowFilters((s) => !s)}><Filter size={12} /></button>
        <div className="w-40"><FilterInput value={globalFilter} onChange={(v) => { setGlobalFilter(v); setPage(0); }} placeholder="Filter in any column" /></div>
        <span className="mx-0.5 h-4 border-l border-slate-700" />
        <button className={btn} disabled={!session.canUndo} onClick={doUndo} title={session.canUndo ? `Undo ${session.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)'}><Undo2 size={12} /></button>
        <button className={btn} disabled={!session.canRedo} onClick={doRedo} title={session.canRedo ? `Redo ${session.redoLabel} (Ctrl+Y)` : 'Redo (Ctrl+Y)'}><Redo2 size={12} /></button>
        <button className={btn} disabled={!editable} onClick={addRecord} title={editable ? 'Insert a new record' : 'Read-only'}><Plus size={12} /> New Record</button>
        <button className={btn} disabled={!editable || (!selRows.size && !range)} onClick={deleteRecords}><Trash2 size={12} /> Delete Record{selectedRowIdx().length > 1 ? `s (${selectedRowIdx().length})` : ''}</button>
        <span className="mx-0.5 h-4 border-l border-slate-700" />
        <button className={btn} onClick={exportFiltered} title="Export all rows matching the current filter/sort as CSV"><FileDown size={12} /> CSV</button>
        <button className={btn} disabled={!hasFilter} onClick={() => setViewDialog(filterViewSql())} title="Save the current filter/sort as a view"><Eye size={12} /> Save as view</button>
        <button className={btn + (showPlot ? ' !border-cyan-800' : '')} onClick={() => setShowPlot((s) => !s)}><LineChart size={12} /> Plot</button>
        <button className={btn + (showEditor ? ' !border-cyan-800' : '')} onClick={() => setShowEditor((s) => !s)}><PanelRight size={12} /> Edit Cell</button>
      </div>
      {(error || data?.err || meta?.err) && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 font-mono flex"><span className="flex-1">{error || data?.err || meta?.err}</span>{error && <button onClick={() => setError('')}>×</button>}</div>}
      {hiddenCols.length > 0 && <div className="mb-1 text-[10px] text-slate-500">{hiddenCols.length} hidden column(s): {hiddenCols.join(', ')} · <button className="text-cyan-400" onClick={() => setHidden((h) => ({ ...h, [tkey]: [] }))}>show all</button></div>}

      <div className={`grid gap-2 ${showEditor ? 'grid-cols-[minmax(0,1fr)_18rem]' : 'grid-cols-1'}`}>
        <div className="min-w-0">
          <div ref={gridRef} tabIndex={0} onKeyDown={onGridKey} className="overflow-auto border border-slate-800 rounded max-h-[58vh] focus:outline-none focus:border-slate-700">
            <table className="text-xs font-mono border-collapse min-w-full select-none">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr>
                  <th className="px-2 py-1 text-right text-slate-600 border-b border-r border-slate-800 w-12 font-normal">{meta?.key.keyCols[0] === '_rowid_' ? 'rowid' : '#'}</th>
                  {vis.map((ci) => {
                    const c = data.columns[ci];
                    const s = sort.findIndex((x) => x.column === c);
                    const info = meta.cols.find((x) => x.name === c);
                    const fk = meta.fks[c];
                    return (
                      <th key={ci} onClick={(e) => toggleSort(c, e.shiftKey)} onContextMenu={(e) => headerMenu(e, c)}
                        title={`${info?.type || 'untyped'}${info?.pk ? ' · primary key' : ''}${info?.notnull ? ' · NOT NULL' : ''}${fk ? ` · references ${fk.table}(${fk.to})` : ''}${fmt[c] ? ` · shown as ${DISPLAY_FORMATS.find((f) => f.id === fmt[c])?.label}` : ''} — click to sort, Shift+click to add, right-click for options`}
                        className="px-2 py-1 text-left text-slate-200 border-b border-r border-slate-800 whitespace-nowrap cursor-pointer hover:bg-slate-800 font-semibold">
                        {info?.pk ? <KeyRound size={10} className="inline mr-1 text-amber-400" /> : null}{fk ? <Link2 size={10} className="inline mr-1 text-sky-400" /> : null}{c}
                        {fmt[c] ? <span className="ml-1 text-[9px] text-violet-400">fmt</span> : null}
                        {s >= 0 && <span className="ml-1 text-cyan-400">{sort[s].dir === 'asc' ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />}{sort.length > 1 ? <sup>{s + 1}</sup> : null}</span>}
                      </th>
                    );
                  })}
                </tr>
                {showFilters && (
                  <tr>
                    <th className="px-1 py-0.5 border-b border-r border-slate-800 bg-slate-900"><Filter size={10} className="inline text-slate-600" /></th>
                    {vis.map((ci) => {
                      const c = data.columns[ci];
                      return <th key={c} className="px-1 py-0.5 border-b border-r border-slate-800 bg-slate-900 font-normal"><FilterInput value={filters[c]} onChange={(v) => { setFilters((f) => ({ ...f, [c]: v })); setPage(0); }} placeholder="Filter" /></th>;
                    })}
                  </tr>
                )}
              </thead>
              <tbody>
                {data?.rows.map((row, ri) => (
                  <tr key={ri} className={selRows.has(ri) ? 'bg-cyan-950/50' : 'odd:bg-slate-900/30 hover:bg-slate-800/30'}>
                    <td onClick={(e) => toggleRow(ri, e)} onContextMenu={(e) => { if (!selRows.has(ri)) toggleRow(ri, e); cellMenu(e, ri, vis[0]); }} className="px-2 py-0.5 text-right text-slate-500 border-b border-r border-slate-900 cursor-pointer hover:text-cyan-300">
                      {data.rowids ? data.rowids[ri] : page * pageSize + ri + 1}
                    </td>
                    {vis.map((ci) => {
                      const v = row[ci];
                      const isFocus = focus && focus.r === ri && focus.c === ci;
                      const sel = inRange(ri, ci);
                      if (editing && editing.r === ri && editing.c === ci) {
                        return (
                          <td key={ci} className="p-0 border-b border-r border-cyan-700">
                            <input autoFocus value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); } else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); } e.stopPropagation(); }}
                              onBlur={() => finishEdit(true)} className="w-full min-w-[8rem] bg-slate-950 px-2 py-0.5 text-xs font-mono text-white outline-none select-text" />
                          </td>
                        );
                      }
                      const f = formatValue(v, fmt[data.columns[ci]]);
                      const p = f !== null ? { text: f, cls: 'text-violet-200' } : cellPreview(v);
                      const fk = meta.fks[data.columns[ci]] && v !== null;
                      return (
                        <td key={ci} onMouseDown={(e) => { if (e.button === 0) clickCell(e, ri, ci); }} onMouseEnter={(e) => { if (e.buttons === 1 && anchor && !editing) setFocus({ r: ri, c: ci }); }}
                          onDoubleClick={() => startEdit(ri, ci)} onContextMenu={(e) => cellMenu(e, ri, ci)}
                          title={typeof v === 'string' && v.length > 40 ? v.slice(0, 1000) : fk ? 'Ctrl+click to jump to the referenced row' : undefined}
                          className={`px-2 py-0.5 border-b border-r border-slate-900 max-w-[22rem] truncate cursor-default ${p.cls} ${fk ? 'underline decoration-sky-700 decoration-dotted underline-offset-2' : ''} ${generated(ci) ? 'opacity-70' : ''} ${sel ? 'bg-cyan-950/50' : ''} ${isFocus ? 'outline outline-1 -outline-offset-1 outline-cyan-500' : ''}`}>{p.text}</td>
                      );
                    })}
                  </tr>
                ))}
                {data && data.rows.length === 0 && <tr><td colSpan={vis.length + 1} className="px-2 py-4 text-center text-slate-600">No rows{hasFilter ? ' match the filter' : ''}.</td></tr>}
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
            {typeof ref === 'object' && ref && <span className="inline-flex items-center gap-1 text-[10px] text-sky-400"><Database size={10} /> attached: {ref.schema}</span>}
            <span className="ml-auto text-[10px] text-slate-500">
              {editable ? 'Double-click / Enter to edit · Shift+click or drag to select a range · right-click for more' : session.readOnly ? 'Database opened read-only' : 'Read-only (view or table without a usable key)'}
            </span>
          </div>
          {showPlot && data && <div className="mt-2"><Plot columns={vis.map((c) => data.columns[c])} rows={data.rows.map((r) => vis.map((c) => r[c]))} /></div>}
        </div>

        {showEditor && <EditCellPanel cell={cell} editable={editable && focus && !generated(focus.c)} onApply={(v) => focus && commit(focus.r, focus.c, v)} />}
      </div>
      {viewDialog !== null && <ViewEditor session={session} initialSelect={viewDialog} onClose={() => setViewDialog(null)} />}
      {menu && <ContextMenu menu={{ ...menu, items: menu.kind === 'cell' ? cellMenuItems(menu.r, menu.c) : headerMenuItems(menu.col) }} onClose={() => setMenu(null)} />}
    </div>
  );
}
