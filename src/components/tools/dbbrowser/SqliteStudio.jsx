import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FilePlus, FolderOpen, Save, Undo2, SaveAll, FileInput, FileOutput, Combine, Wrench, ScrollText, Database,
  Table as TableIcon, Boxes, SlidersHorizontal, Terminal, ShieldCheck, Link2, Gauge, Minimize2, XCircle, FileSpreadsheet,
  FileCode, FileJson, HardDriveDownload, Circle, Lock, Paperclip, History, FolderCog, Trash, Unplug,
} from 'lucide-react';
import { useDbSession, SQLITE_ACCEPT, hasFsAccess, downloadBytes } from './useDbSession.js';
import { btn, btnPrimary, input, label, Menu, Modal, ResultGrid, pickFile, downloadText } from './common.jsx';
import StructureTab from './StructureTab.jsx';
import BrowseTab from './BrowseTab.jsx';
import PragmasTab from './PragmasTab.jsx';
import ExecuteTab, { STORE_KEY as SQL_TABS_KEY } from './ExecuteTab.jsx';
import CombinePanel from './CombinePanel.jsx';
import { ImportCsvDialog, ExportDialog } from './ImportExport.jsx';
import { executeScript, queryAll, scalar, parseSqbpro, buildSqbpro } from '../../../utils/sqliteStudio.js';

const TABS = [
  { id: 'structure', label: 'Database Structure', icon: Boxes },
  { id: 'browse', label: 'Browse Data', icon: TableIcon },
  { id: 'pragmas', label: 'Edit Pragmas', icon: SlidersHorizontal },
  { id: 'sql', label: 'Execute SQL', icon: Terminal },
];

/**
 * SQLite studio modelled on DB Browser for SQLite: structure / browse / pragmas
 * / execute tabs over one in-memory database, with write-back, revert, import,
 * export, combine and an SQL log.
 *
 * Embedding (src/dbstudio.jsx builds it on its own for the WarHog flasher):
 *   onApi(api)      called after every render with { session, db, open, create, browse,
 *                   setTab, writeChanges, writeTo(sink), close } so the host can drive the studio
 *   onChange(state) called when the database, its name or its dirty flag changes
 *   onDrop(files, e) return true to take over a file drop (the host imports its own formats)
 */
export default function SqliteStudio({ log, onApi, onChange, onDrop: onDropProp }) {
  const session = useDbSession(log);
  const { db, info, dirty } = session;
  const [tab, setTab] = useState('structure');
  const [browseTarget, setBrowseTarget] = useState(null);
  const [dialog, setDialog] = useState(null); // { kind, ... }
  const [combining, setCombining] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const openMode = useRef({});        // options for the <input type=file> fallback
  const sqlTabsRef = useRef(null);    // { tabs, cur } published by ExecuteTab
  const [sqlTabsKey, setSqlTabsKey] = useState(0);

  const guard = async (fn) => { setError(''); try { await fn(); } catch (e) { setError(e.message || String(e)); log?.(`DB Browser: ${e.message}`); } };
  // Like guard, for the host API: shows the error here and rethrows so the caller knows.
  const run = async (fn) => { setError(''); try { return await fn(); } catch (e) { setError(e.message || String(e)); log?.(`DB Browser: ${e.message}`); throw e; } };
  const confirmDiscard = () => !dirty || window.confirm(`"${info?.name}" has changes that haven't been written. Discard them?`);

  const openBytes = (name, bytes, handle) => guard(async () => { await session.open(name, bytes, handle); setTab('structure'); setCombining(false); });
  const openDb = (opts = {}) => guard(async () => {
    if (!confirmDiscard()) return;
    if (await session.openWithPicker(opts)) { setCombining(false); setTab('structure'); return; }
    openMode.current = opts;
    fileRef.current?.click();
  });
  const onFileInput = async (e) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (f) guard(async () => { await session.open(f.name, new Uint8Array(await f.arrayBuffer()), null, openMode.current); setTab('structure'); setCombining(false); });
  };
  const openRecent = (entry) => guard(async () => { if (!confirmDiscard()) return; await session.openRecent(entry); setTab('structure'); setCombining(false); });
  const attachDb = () => guard(async () => {
    const f = await pickFile(SQLITE_ACCEPT);
    if (!f) return;
    const alias = (f.name.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || 'attached').toLowerCase();
    setDialog({ kind: 'attach', file: f, alias });
  });

  // ---- projects (.sqbpro, compatible with DB Browser for SQLite) ----
  const loadProject = (text, fileName) => guard(async () => {
    const proj = parseSqbpro(text);
    if (proj.tabs.length) {
      localStorage.setItem(SQL_TABS_KEY, JSON.stringify(proj.tabs.map((t, i) => ({ id: i + 1, title: t.title, text: t.text }))));
      setSqlTabsKey((k) => k + 1);
    }
    const dbName = proj.dbPath.split(/[\\/]/).pop();
    setDialog({ kind: 'result', ok: true, title: `Project ${fileName}`, text: `Loaded ${proj.tabs.length} SQL tab(s).${dbName ? ` The project refers to database "${dbName}"${info?.name === dbName ? ' (already open).' : ' — open it with Open Database.'}` : ''}` });
    if (proj.tabs.length) setTab('sql');
  });
  const openProject = () => guard(async () => {
    const f = await pickFile('.sqbpro,application/xml,text/xml');
    if (f) loadProject(await f.text(), f.name);
  });
  const saveProject = () => {
    const st = sqlTabsRef.current;
    const tabs = st?.tabs || JSON.parse(localStorage.getItem(SQL_TABS_KEY) || '[]');
    const base = (info?.name || 'project').replace(/\.[^.]*$/, '');
    downloadText(`${base}.sqbpro`, buildSqbpro({ dbPath: info?.name || '', tabs, currentTab: Math.max(0, tabs.findIndex((t) => t.id === st?.cur)) }), 'application/xml');
  };
  const newDb = () => guard(async () => {
    if (!confirmDiscard()) return;
    await session.create('untitled.sqlite');
    setCombining(false); setTab('structure');
    setDialog({ kind: 'hint', text: 'New in-memory database created. Add tables in Database Structure → Create Table (or with Execute SQL), then Write Changes to save it as a file.' });
  });
  const closeDb = () => { if (confirmDiscard()) session.close(); };

  const importSql = () => guard(async () => {
    const f = await pickFile('.sql,.txt,text/plain');
    if (!f) return;
    const text = await f.text();
    if (!db) await session.create(f.name.replace(/\.[^.]*$/, '') + '.sqlite');
    const d = session.db;
    const r = executeScript(d, text, { maxRows: 0 });
    session.logSql(`-- import ${f.name}: ${r.results.length} statement(s)${r.error ? `, error: ${r.error}` : ''}`);
    session.refresh();
    setDialog({ kind: 'result', title: `Import ${f.name}`, text: r.error ? `Stopped after ${r.results.length} statement(s): ${r.error}` : `Executed ${r.results.length} statement(s) in ${r.ms.toFixed(0)} ms.`, ok: !r.error });
  });

  const tool = (title, sql, mutating) => guard(async () => {
    const t0 = performance.now();
    const before = mutating ? scalar(db, 'SELECT page_count * page_size FROM pragma_page_count, pragma_page_size') : 0;
    const res = mutating ? (session.exec(sql), null) : queryAll(db, sql);
    if (!mutating) session.logSql(sql);
    const after = mutating ? scalar(db, 'SELECT page_count * page_size FROM pragma_page_count, pragma_page_size') : 0;
    setDialog({ kind: 'result', title, grid: res, ok: true, text: mutating ? `${sql} finished in ${(performance.now() - t0).toFixed(0)} ms.${sql === 'VACUUM' ? ` Size ${(before / 1024).toFixed(0)} KB → ${(after / 1024).toFixed(0)} KB.` : ''}` : (res.rows.length === 0 ? 'No problems found.' : null) });
  });

  const browse = (name, schema) => { setBrowseTarget({ name, schema, n: Date.now() }); setTab('browse'); };

  // ---- host API (embedding) ----
  const api = {
    session, get db() { return session.db; },
    open: (name, bytes, opts) => run(async () => { await session.open(name, bytes, null, opts); setTab('structure'); setCombining(false); }),
    create: (name, opts) => run(async () => { await session.open(name || 'untitled.sqlite', null, null, opts); setTab('structure'); setCombining(false); }),
    browse, setTab, writeChanges: () => run(session.writeChanges), writeTo: (sink) => run(() => session.writeTo(sink)), close: () => session.close(),
  };
  useEffect(() => { onApi?.(api); });
  useEffect(() => { onChange?.({ db: session.db, info, dirty, version: session.version, readOnly: session.readOnly }); }, [info, dirty, session.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDrop = async (e) => {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files || []);
    if (onDropProp && onDropProp(files, e) === true) return;   // the host took the drop
    const f = files[0];
    if (!f) return;
    if (/\.(csv|tsv)$/i.test(f.name)) { if (db) setDialog({ kind: 'csv' }); return; }
    if (/\.sqbpro$/i.test(f.name)) { loadProject(await f.text(), f.name); return; }
    if (/\.sql$/i.test(f.name)) return;
    if (!confirmDiscard()) return;
    const handle = e.dataTransfer.items?.[0]?.getAsFileSystemHandle ? await e.dataTransfer.items[0].getAsFileSystemHandle().catch(() => null) : null;
    openBytes(f.name, new Uint8Array(await f.arrayBuffer()), handle && handle.kind === 'file' ? handle : null);
  };

  const sqliteVersion = useMemo(() => { try { return db ? scalar(db, 'SELECT sqlite_version()') : ''; } catch { return ''; } }, [db]);
  const encoding = useMemo(() => { try { return db ? scalar(db, 'PRAGMA encoding') : ''; } catch { return ''; } }, [db, session.version]);

  return (
    <div onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && db) { e.preventDefault(); guard(session.writeChanges); } }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
      className={`relative ${dragging ? 'outline-dashed outline-2 outline-cyan-700 rounded' : ''}`}>
      <input ref={fileRef} type="file" accept={SQLITE_ACCEPT} className="hidden" onChange={onFileInput} />

      <div className="flex items-center gap-1 mb-2 flex-wrap">
        <button className={btn} onClick={newDb}><FilePlus size={13} /> New Database</button>
        <Menu label="Open Database" icon={FolderOpen} items={[
          { label: 'Open Database…', icon: FolderOpen, onClick: () => openDb() },
          { label: 'Open Database Read-Only…', icon: Lock, onClick: () => openDb({ readOnly: true }) },
          { label: 'Attach Database…', icon: Paperclip, disabled: !db, onClick: attachDb },
          ...session.attachments.map((a) => ({ label: `Detach ${a.alias}`, icon: Unplug, onClick: () => session.detach(a.alias) })),
          { sep: true },
          { label: 'Open Project (.sqbpro)…', icon: FolderCog, onClick: openProject },
          { label: 'Save Project (.sqbpro)…', icon: FolderCog, onClick: saveProject },
          ...(session.recent.length ? [{ sep: true }, ...session.recent.map((r) => ({ label: r.name, icon: History, onClick: () => openRecent(r) })), { label: 'Clear recent files', icon: Trash, onClick: session.forgetRecent }] : []),
        ]} />
        <button className={btn + (dirty ? ' !border-amber-700 !text-amber-200' : '')} disabled={!db || session.readOnly} onClick={() => guard(session.writeChanges)} title={info?.handle ? `Save to ${info.name} (Ctrl+S)` : info?.sink ? `Save to ${info.sink.label} (Ctrl+S)` : 'Save to a file (Ctrl+S)'}><Save size={13} /> Write Changes</button>
        <button className={btn} disabled={!db || !dirty} onClick={() => { if (window.confirm('Discard all changes since the last write?')) guard(session.revert); }}><Undo2 size={13} /> Revert Changes</button>
        <button className={btn} disabled={!db} onClick={() => guard(() => session.saveAs())}><SaveAll size={13} /> Save As…</button>
        <span className="mx-1 h-4 border-l border-slate-700" />
        <Menu label="Import" icon={FileInput} items={[
          { label: 'Table from CSV file…', icon: FileSpreadsheet, onClick: () => setDialog({ kind: 'csv' }), disabled: !db },
          { label: 'Database from SQL file…', icon: FileCode, onClick: importSql },
        ]} />
        <Menu label="Export" icon={FileOutput} disabled={!db} items={[
          { label: 'Database to SQL file…', icon: FileCode, onClick: () => setDialog({ kind: 'export', format: 'sql' }) },
          { label: 'Table(s) as CSV file…', icon: FileSpreadsheet, onClick: () => setDialog({ kind: 'export', format: 'csv' }) },
          { label: 'Table(s) to JSON…', icon: FileJson, onClick: () => setDialog({ kind: 'export', format: 'json' }) },
          { sep: true },
          { label: 'Download a copy (.sqlite)', icon: HardDriveDownload, onClick: () => downloadBytes((info?.name || 'database.sqlite').replace(/(\.\w+)?$/, '-copy$1'), session.currentBytes(), 'application/x-sqlite3') },
        ]} />
        <button className={btn + (combining ? ' !border-cyan-700' : '')} onClick={() => setCombining((c) => !c)}><Combine size={13} /> Combine</button>
        <Menu label="Tools" icon={Wrench} disabled={!db} items={[
          { label: 'Integrity Check', icon: ShieldCheck, onClick: () => tool('Integrity Check', 'PRAGMA integrity_check') },
          { label: 'Quick Integrity Check', icon: ShieldCheck, onClick: () => tool('Quick Integrity Check', 'PRAGMA quick_check') },
          { label: 'Foreign-Key Check', icon: Link2, onClick: () => tool('Foreign-Key Check', 'PRAGMA foreign_key_check') },
          { label: 'Optimize', icon: Gauge, onClick: () => tool('Optimize', 'PRAGMA optimize', true) },
          { label: 'Compact Database (VACUUM)', icon: Minimize2, onClick: () => tool('Compact Database', 'VACUUM', true) },
          { sep: true },
          { label: 'Close Database', icon: XCircle, onClick: closeDb },
        ]} />
        <button className={btn + (showLog ? ' !border-cyan-700' : '') + ' ml-auto'} disabled={!db} onClick={() => setShowLog((s) => !s)}><ScrollText size={13} /> SQL Log</button>
      </div>

      {error && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 flex items-start gap-2"><span className="flex-1 font-mono">{error}</span><button onClick={() => setError('')} className="text-red-400">×</button></div>}

      {combining && (
        <CombinePanel log={log} current={db ? { name: info?.name, getDb: async () => session.db } : null} onClose={() => setCombining(false)}
          onOpen={(name, bytes) => { if (confirmDiscard()) openBytes(name, bytes, null); }} />
      )}

      {db ? (
        <>
          <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit mb-2">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === t.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
                <t.icon size={12} /> {t.label}
              </button>
            ))}
          </div>
          <div className={tab === 'structure' ? '' : 'hidden'}><StructureTab session={session} onBrowse={browse} /></div>
          <div className={tab === 'browse' ? '' : 'hidden'}><BrowseTab session={session} target={browseTarget} /></div>
          <div className={tab === 'pragmas' ? '' : 'hidden'}><PragmasTab session={session} /></div>
          <div className={tab === 'sql' ? '' : 'hidden'}><ExecuteTab key={sqlTabsKey} session={session} tabsRef={sqlTabsRef} /></div>
          {showLog && <SqlLog session={session} />}
          <div className="mt-2 pt-1 border-t border-slate-800 flex items-center gap-3 text-[10px] text-slate-500 flex-wrap">
            <span className="inline-flex items-center gap-1 font-mono text-slate-300"><Database size={11} className="text-cyan-500" /> {info?.name}</span>
            {session.readOnly && <span className="inline-flex items-center gap-1 text-sky-300"><Lock size={10} /> read-only</span>}
            {session.attachments.length > 0 && <span className="text-sky-400">attached: {session.attachments.map((a) => a.alias).join(', ')}</span>}
            <span>{((info?.size || 0) / 1024).toFixed(0)} KB on disk</span>
            <span>{encoding}</span>
            <span>{info?.handle ? 'Write Changes saves back to the original file' : info?.sink ? `Write Changes saves to ${info.sink.label}` : hasFsAccess() ? 'In-browser copy — Write Changes asks where to save' : 'In-browser copy — Write Changes downloads a file'}</span>
            {dirty ? <span className="inline-flex items-center gap-1 text-amber-300"><Circle size={7} fill="currentColor" /> unsaved changes</span> : <span className="text-emerald-500/70">saved</span>}
            <span className="ml-auto">SQLite {sqliteVersion} (sql.js)</span>
          </div>
        </>
      ) : !combining && (
        <div className="border border-dashed border-slate-700 rounded p-6 text-center">
          <Database size={28} className="mx-auto text-cyan-500/70 mb-2" />
          <div className="text-sm text-gray-200 mb-1">DB Browser for SQLite — in your browser</div>
          <p className="text-xs text-slate-500 max-w-xl mx-auto mb-3">
            Create, design, browse and edit SQLite database files. Everything runs locally (sql.js / WASM) — files never leave the machine.
            Changes stay in memory until you Write Changes{hasFsAccess() ? ', which saves straight back to the file you opened' : ''}.
          </p>
          <div className="flex justify-center gap-2 flex-wrap">
            <button className={btn} onClick={newDb}><FilePlus size={13} /> New Database</button>
            <button className={btn} onClick={() => openDb()}><FolderOpen size={13} /> Open Database</button>
            <button className={btn} onClick={importSql}><FileCode size={13} /> Import SQL file</button>
            <button className={btn} onClick={() => setCombining(true)}><Combine size={13} /> Combine databases</button>
          </div>
          <div className="text-[10px] text-slate-600 mt-3">…or drop a .sqlite / .db file here.</div>
        </div>
      )}

      {dialog?.kind === 'attach' && (
        <Modal title="Attach database" onClose={() => setDialog(null)} footer={<><button className={btn} onClick={() => setDialog(null)}>Cancel</button>
          <button className={btnPrimary} onClick={() => guard(async () => { await session.attach(dialog.file.name, new Uint8Array(await dialog.file.arrayBuffer()), dialog.alias); setDialog(null); setTab('structure'); })}><Paperclip size={12} /> Attach</button></>}>
          <div className="mb-2">Attach <span className="font-mono text-cyan-300">{dialog.file.name}</span> to the open database. Its tables can then be queried as <span className="font-mono">schema.table</span> in Execute SQL and browsed and edited like the main database's.</div>
          <div className="flex items-center gap-2"><span className={label}>Schema name</span><input autoFocus value={dialog.alias} onChange={(e) => setDialog({ ...dialog, alias: e.target.value })} className={input + ' w-48'} /></div>
          <div className="mt-2 text-[10px] text-slate-500">Changes to an attached database aren't part of Write Changes / Revert — use "save copy" next to it in Database Structure.</div>
        </Modal>
      )}
      {dialog?.kind === 'csv' && <ImportCsvDialog session={session} onClose={(ok, name) => { setDialog(null); if (ok && name) browse(name); }} />}
      {dialog?.kind === 'export' && <ExportDialog session={session} initialFormat={dialog.format} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'hint' && <Modal title="New database" onClose={() => setDialog(null)} footer={<button className={btn} onClick={() => setDialog(null)}>OK</button>}>{dialog.text}</Modal>}
      {dialog?.kind === 'result' && (
        <Modal wide={!!dialog.grid?.rows.length} title={dialog.title} onClose={() => setDialog(null)} footer={<button className={btn} onClick={() => setDialog(null)}>Close</button>}>
          {dialog.text && <div className={dialog.ok ? 'text-emerald-300 mb-2' : 'text-red-300 mb-2'}>{dialog.text}</div>}
          {dialog.grid && dialog.grid.rows.length > 0 && <ResultGrid columns={dialog.grid.columns} rows={dialog.grid.rows} />}
        </Modal>
      )}
    </div>
  );
}

function SqlLog({ session }) {
  const [filter, setFilter] = useState('all');
  const entries = session.sqlLog.filter((e) => filter === 'all' || e.source === filter);
  const text = entries.map((e) => `-- ${e.t.toLocaleTimeString()} [${e.source}]\n${e.sql}`).join('\n');
  return (
    <div className="mt-2 border border-slate-800 rounded bg-slate-950">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-slate-800 text-xs">
        <span className="text-[11px] uppercase tracking-wide text-cyan-400">SQL Log</span>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1 text-xs">
          <option value="all">All</option><option value="user">Submitted by user</option><option value="app">Submitted by application</option>
        </select>
        <button className="ml-auto text-slate-400 hover:text-gray-200" onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <button className="text-slate-400 hover:text-gray-200" onClick={session.clearLog}>Clear</button>
      </div>
      <pre className="p-2 text-[11px] text-gray-300 font-mono max-h-48 overflow-auto whitespace-pre-wrap">{entries.length ? text : <span className="text-slate-600">Nothing logged yet.</span>}</pre>
    </div>
  );
}
