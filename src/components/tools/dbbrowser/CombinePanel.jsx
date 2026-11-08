import React, { useState } from 'react';
import { Database, Table as TableIcon, FileUp, RefreshCw, Download, Combine, X, ArrowUp, ArrowDown } from 'lucide-react';
import { getSqlJs, exportSqlDatabase } from '../../../utils/sqljs.js';
import { mergeDatabases } from '../../../utils/sqliteMerge.js';
import { SQLITE_ACCEPT } from './useDbSession.js';

const TABLE_CONFLICT_OPTS = [
  { id: 'append', label: 'Append rows into one table', hint: 'Same-named tables are merged; missing columns are added.' },
  { id: 'rename', label: 'Keep separate (rename)', hint: 'Later copies become <table>_<file>.' },
  { id: 'skip', label: 'Keep first only', hint: 'Later same-named tables are ignored.' },
];
const ROW_CONFLICT_OPTS = [
  { id: 'ignore', label: 'Keep existing row', hint: 'Rows whose primary key / unique value already exists are skipped.' },
  { id: 'replace', label: 'Later file wins', hint: 'Colliding rows are replaced by the later file.' },
  { id: 'newkey', label: 'Keep both (new IDs)', hint: 'Incoming rows get a fresh INTEGER PRIMARY KEY. Foreign keys pointing at old IDs are not rewritten.' },
];

/** Merge several SQLite files into one database. */
export default function CombinePanel({ log, current, onClose, onOpen }) {
  const [files, setFiles] = useState([]);            // [{ id, name, size, file }]
  const [includeCurrent, setIncludeCurrent] = useState(!!current);
  const [tableConflict, setTableConflict] = useState('append');
  const [rowConflict, setRowConflict] = useState('ignore');
  const [tagSource, setTagSource] = useState(false);
  const [sourceColumn, setSourceColumn] = useState('_source');
  const [outName, setOutName] = useState('combined.sqlite');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);        // { bytes, report, name }

  const addFiles = (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    setFiles((fs) => [...fs, ...picked.map((f) => ({ id: `${f.name}-${f.size}-${f.lastModified}-${Math.random()}`, name: f.name, size: f.size, file: f }))]);
    setResult(null);
  };
  const move = (i, d) => setFiles((fs) => { const n = [...fs]; const j = i + d; if (j < 0 || j >= n.length) return fs; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const remove = (i) => setFiles((fs) => fs.filter((_, k) => k !== i));

  const sourceCount = files.length + (current && includeCurrent ? 1 : 0);

  const combine = async () => {
    setBusy(true); setError(''); setResult(null);
    let merged = null;
    try {
      const SQL = await getSqlJs();
      const sources = [];
      if (current && includeCurrent) {
        const live = await current.getDb();
        if (!live) throw new Error('The open database could not be loaded into the SQL engine');
        sources.push({ name: current.name || 'open database', db: live });
      }
      for (const f of files) sources.push({ name: f.name, bytes: new Uint8Array(await f.file.arrayBuffer()) });
      const r = mergeDatabases(SQL, sources, { tableConflict, rowConflict, sourceColumn: tagSource ? sourceColumn : '' });
      merged = r.db;
      const bytes = exportSqlDatabase(merged);
      const name = (outName.trim() || 'combined.sqlite');
      setResult({ bytes, report: r.report, name });
      log?.(`Combined ${sources.length} database(s) → ${r.report.tableCount} table(s), ${r.report.totalRows.toLocaleString()} row(s), ${(bytes.length / 1024).toFixed(0)} KB${r.report.warnings.length ? `, ${r.report.warnings.length} warning(s)` : ''}`);
    } catch (e) {
      setError(e.message || String(e));
      log?.(`Combine failed: ${e.message}`);
    } finally {
      try { merged?.close(); } catch { /* ignore */ }
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([result.bytes], { type: 'application/x-sqlite3' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = result.name; a.click(); URL.revokeObjectURL(a.href);
  };

  const selectCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-gray-200';
  const ACTION_CLS = { created: 'text-emerald-400', appended: 'text-cyan-300', renamed: 'text-amber-300', skipped: 'text-slate-500', failed: 'text-red-400' };

  return (
    <div className="mb-3 border border-slate-800 rounded bg-slate-900/40 p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wide text-cyan-400 inline-flex items-center gap-1.5"><Combine size={13} /> Combine databases</div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300" title="Close"><X size={14} /></button>
      </div>

      <div className="mb-2 text-slate-400">Sources are merged in order — the first file to define a table sets its schema.</div>
      <div className="border border-slate-800 rounded mb-2 divide-y divide-slate-800">
        {current && (
          <label className="flex items-center gap-2 px-2 py-1.5 cursor-pointer">
            <input type="checkbox" checked={includeCurrent} onChange={(e) => { setIncludeCurrent(e.target.checked); setResult(null); }} />
            <Database size={12} className="text-cyan-400" />
            <span className="font-mono text-gray-200 truncate">{current.name}</span>
            <span className="text-slate-500">open database, including SQL edits — merged first</span>
          </label>
        )}
        {files.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2 px-2 py-1.5">
            <span className="text-slate-500 w-5 text-right">{i + 1 + (current && includeCurrent ? 1 : 0)}.</span>
            <span className="font-mono text-gray-200 truncate flex-1">{f.name}</span>
            <span className="text-slate-500">{(f.size / 1024).toFixed(0)} KB</span>
            <button onClick={() => move(i, -1)} disabled={i === 0} className="p-0.5 text-slate-400 hover:text-slate-200 disabled:opacity-30" title="Move up"><ArrowUp size={12} /></button>
            <button onClick={() => move(i, 1)} disabled={i === files.length - 1} className="p-0.5 text-slate-400 hover:text-slate-200 disabled:opacity-30" title="Move down"><ArrowDown size={12} /></button>
            <button onClick={() => remove(i)} className="p-0.5 text-slate-400 hover:text-red-300" title="Remove"><X size={12} /></button>
          </div>
        ))}
        {files.length === 0 && !current && <div className="px-2 py-2 text-slate-600">No files added yet.</div>}
      </div>
      <label className="inline-flex items-center gap-2 px-3 py-1.5 mb-3 bg-slate-800 border border-slate-700 rounded text-gray-200 cursor-pointer hover:bg-slate-700">
        <FileUp size={13} /> Add .sqlite / .db files…
        <input type="file" multiple accept={SQLITE_ACCEPT} className="hidden" onChange={addFiles} />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <div>
          <div className="text-slate-400 mb-1">Tables with the same name</div>
          <select value={tableConflict} onChange={(e) => { setTableConflict(e.target.value); setResult(null); }} className={selectCls + ' w-full'}>
            {TABLE_CONFLICT_OPTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <div className="text-[10px] text-slate-500 mt-1">{TABLE_CONFLICT_OPTS.find((o) => o.id === tableConflict).hint}</div>
        </div>
        <div className={tableConflict === 'append' ? '' : 'opacity-40 pointer-events-none'}>
          <div className="text-slate-400 mb-1">Duplicate keys when appending</div>
          <select value={rowConflict} onChange={(e) => { setRowConflict(e.target.value); setResult(null); }} className={selectCls + ' w-full'}>
            {ROW_CONFLICT_OPTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <div className="text-[10px] text-slate-500 mt-1">{ROW_CONFLICT_OPTS.find((o) => o.id === rowConflict).hint}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <label className="inline-flex items-center gap-2 cursor-pointer text-gray-300">
          <input type="checkbox" checked={tagSource} onChange={(e) => { setTagSource(e.target.checked); setResult(null); }} />
          Add a column recording each row's source file:
        </label>
        <input value={sourceColumn} onChange={(e) => setSourceColumn(e.target.value)} disabled={!tagSource} className="bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono w-32 disabled:opacity-40" />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-slate-400">Output name</span>
        <input value={outName} onChange={(e) => setOutName(e.target.value)} className="bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono w-48" />
        <button onClick={combine} disabled={busy || sourceCount < 2} title={sourceCount < 2 ? 'Add at least two databases' : ''}
          className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Combine size={12} />} Combine {sourceCount} database{sourceCount === 1 ? '' : 's'}
        </button>
      </div>

      {error && <div className="mt-3 p-2 border border-red-900 rounded bg-red-950/30 text-red-300 font-mono">{error}</div>}

      {result && (
        <div className="mt-3 border border-slate-800 rounded bg-slate-950 p-2">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-emerald-400">Combined:</span>
            <span className="text-gray-300">{result.report.tableCount} table(s) · {result.report.totalRows.toLocaleString()} row(s) · {(result.bytes.length / 1024).toFixed(0)} KB</span>
            <button onClick={() => onOpen(result.name, result.bytes)} className="ml-auto px-2 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded hover:bg-cyan-900/70 inline-flex items-center gap-1"><TableIcon size={12} /> Open in browser</button>
            <button onClick={download} className="px-2 py-1 bg-slate-800 border border-slate-700 text-gray-200 rounded hover:bg-slate-700 inline-flex items-center gap-1"><Download size={12} /> Download {result.name}</button>
          </div>
          <div className="max-h-[30vh] overflow-auto">
            <table className="w-full font-mono text-[11px]">
              <thead><tr className="text-slate-500 text-left"><th className="pr-2">source</th><th className="pr-2">table</th><th className="pr-2">result</th><th className="pr-2 text-right">rows added</th><th className="text-right">duplicates skipped</th></tr></thead>
              <tbody>
                {result.report.sources.flatMap((s) => s.tables.map((t) => (
                  <tr key={`${s.name}/${t.source}`} className="border-t border-slate-900">
                    <td className="pr-2 text-slate-400 truncate max-w-[10rem]">{s.name}</td>
                    <td className="pr-2 text-gray-200">{t.source}{t.target && t.target !== t.source ? <span className="text-amber-300"> → {t.target}</span> : null}</td>
                    <td className={`pr-2 ${ACTION_CLS[t.action] || ''}`}>{t.action}</td>
                    <td className="pr-2 text-right text-gray-300">{t.rows.toLocaleString()}</td>
                    <td className={`text-right ${t.skipped ? 'text-amber-300' : 'text-slate-600'}`}>{t.skipped.toLocaleString()}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
          {result.report.warnings.length > 0 && (
            <div className="mt-2 p-2 border border-yellow-900 rounded bg-yellow-950/20 text-yellow-300">
              {result.report.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
