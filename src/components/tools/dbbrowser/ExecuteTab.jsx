import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql as sqlLang, SQLite } from '@codemirror/lang-sql';
import { keymap, EditorView } from '@codemirror/view';
import { Prec } from '@codemirror/state';
import { Play, StepForward, FolderOpen, Save, Plus, X, Download, Eye, LineChart, CheckCircle2, XCircle } from 'lucide-react';
import { btn, btnPrimary, ResultGrid, Plot, downloadText, pickFile, input } from './common.jsx';
import { ViewEditor } from './SchemaEditors.jsx';
import { executeScript, statementAt, listObjects, listSchemas, columnsOf, lineCol, toCsv } from '../../../utils/sqliteStudio.js';

export const STORE_KEY = 'dbbrowser.sqlTabs.v1';
const loadTabs = () => {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(t) && t.length) return t.map((x, i) => ({ id: x.id || i + 1, title: x.title || `SQL ${i + 1}`, text: x.text || '' }));
  } catch { /* ignore */ }
  return [{ id: 1, title: 'SQL 1', text: '-- Ctrl+Enter / F5: execute all (or the selection)\n-- Shift+F5 / Ctrl+Shift+Enter: execute the current statement\nSELECT name, type FROM sqlite_master ORDER BY type, name;\n' }];
};

const editorTheme = EditorView.theme({
  '&': { fontSize: '12px', backgroundColor: '#020617' },
  '.cm-gutters': { backgroundColor: '#0f172a', borderRight: '1px solid #1e293b' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
});

export default function ExecuteTab({ session, tabsRef }) {
  const { db, version } = session;
  const [tabs, setTabs] = useState(loadTabs);
  const [cur, setCur] = useState(() => tabs[0].id);
  const [results, setResults] = useState({}); // tabId -> { run, which }
  const [running, setRunning] = useState(false);
  const [showPlot, setShowPlot] = useState(false);
  const [viewSql, setViewSql] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const viewRef = useRef(null);
  const tab = tabs.find((t) => t.id === cur) || tabs[0];
  if (tabsRef) tabsRef.current = { tabs, cur: tab.id };

  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(tabs)); } catch { /* quota */ } }, 400);
    return () => clearTimeout(t);
  }, [tabs]);

  // Schema for autocompletion.
  const schema = useMemo(() => {
    if (!db) return {};
    const s = {};
    try {
      for (const schema of listSchemas(db)) {
        for (const o of listObjects(db, schema)) {
          if (o.type !== 'table' && o.type !== 'view') continue;
          const cols = columnsOf(db, schema === 'main' ? o.name : { schema, name: o.name }).map((c) => c.name);
          s[schema === 'main' ? o.name : `${schema}.${o.name}`] = cols;
        }
      }
    } catch { /* ignore */ }
    return s;
  }, [db, version]);

  const setText = (text) => setTabs((ts) => ts.map((t) => (t.id === tab.id ? { ...t, text } : t)));

  const run = useCallback((mode) => {
    const view = viewRef.current;
    if (!db || !view) return;
    const text = view.state.doc.toString();
    const { from, to, head } = view.state.selection.main;
    let chunk = text; let offset = 0;
    if (mode === 'current') {
      const st = statementAt(text, head);
      if (!st) return;
      chunk = text.slice(st.start, st.end); offset = st.start;
    } else if (from !== to) {
      chunk = text.slice(from, to); offset = from;
    }
    setRunning(true);
    const r = executeScript(db, chunk, { offset });
    session.logSql(r.results.map((x) => x.sql).concat(r.error ? [`-- error: ${r.error}`] : []), 'user');
    session.refresh();
    setRunning(false);
    const lastWithRows = [...r.results].reverse().findIndex((x) => x.columns.length);
    setResults((m) => ({ ...m, [tab.id]: { run: r, which: lastWithRows < 0 ? -1 : r.results.length - 1 - lastWithRows, text } }));
    if (r.error && r.errorAt != null) {
      const pos = Math.min(r.errorAt, view.state.doc.length);
      view.dispatch({ selection: { anchor: pos, head: Math.min(view.state.doc.length, pos + (statementAt(text, pos)?.sql.length || 0)) }, scrollIntoView: true });
    }
  }, [db, session, tab.id]);

  // Keymap reads the latest run() through a ref so the editor isn't reconfigured on every render.
  const runRef = useRef(run);
  runRef.current = run;
  const keys = useMemo(() => Prec.highest(keymap.of([
    { key: 'Mod-Enter', run: () => { runRef.current('all'); return true; } },
    { key: 'F5', run: () => { runRef.current('all'); return true; } },
    { key: 'Shift-F5', run: () => { runRef.current('current'); return true; } },
    { key: 'Mod-Shift-Enter', run: () => { runRef.current('current'); return true; } },
  ])), []);
  const extensions = useMemo(() => [sqlLang({ dialect: SQLite, schema, upperCaseKeywords: true }), keys, editorTheme, EditorView.lineWrapping], [schema, keys]);

  const addTab = (text = '', title) => {
    const id = Math.max(0, ...tabs.map((t) => t.id)) + 1;
    setTabs((ts) => [...ts, { id, title: title || `SQL ${id}`, text }]);
    setCur(id);
  };
  const closeTab = (id) => {
    if (tabs.length === 1) { setTabs([{ ...tabs[0], text: '' }]); return; }
    const t = tabs.find((x) => x.id === id);
    if (t.text.trim() && !window.confirm(`Close "${t.title}"? Its SQL will be discarded.`)) return;
    const rest = tabs.filter((x) => x.id !== id);
    setTabs(rest);
    if (cur === id) setCur(rest[Math.max(0, tabs.findIndex((x) => x.id === id) - 1)].id);
  };
  const openSql = async () => {
    const f = await pickFile('.sql,.txt,text/plain');
    if (f) addTab(await f.text(), f.name);
  };
  const saveSql = () => downloadText(/\.sql$/i.test(tab.title) ? tab.title : `${tab.title.replace(/\s+/g, '_')}.sql`, tab.text, 'application/sql');

  const res = results[tab.id];
  const shown = res && res.which >= 0 ? res.run.results[res.which] : null;
  const errLine = res?.run.error && res.run.errorAt != null ? lineCol(res.text, res.run.errorAt) : null;

  return (
    <div>
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        <button className={btnPrimary} disabled={running || !db} onClick={() => run('all')} title="Execute all, or the selection (Ctrl+Enter / F5)"><Play size={12} /> Execute all</button>
        <button className={btn} disabled={running || !db} onClick={() => run('current')} title="Execute the statement under the cursor (Shift+F5 / Ctrl+Shift+Enter)"><StepForward size={12} /> Execute current</button>
        <span className="mx-1 h-4 border-l border-slate-700" />
        <button className={btn} onClick={openSql}><FolderOpen size={12} /> Open SQL file</button>
        <button className={btn} onClick={saveSql}><Save size={12} /> Save SQL file</button>
      </div>
      <div className="flex items-end gap-0.5 border-b border-slate-800 overflow-x-auto">
        {tabs.map((t) => (
          <div key={t.id} onClick={() => setCur(t.id)} onDoubleClick={() => setRenaming(t.id)}
            className={`group px-2 py-1 text-xs rounded-t border border-b-0 cursor-pointer inline-flex items-center gap-1 ${t.id === tab.id ? 'bg-slate-900 border-slate-700 text-cyan-200' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {renaming === t.id ? (
              <input autoFocus defaultValue={t.title} className={input + ' w-28 py-0'} onBlur={(e) => { const v = e.target.value.trim(); setTabs((ts) => ts.map((x) => (x.id === t.id ? { ...x, title: v || x.title } : x))); setRenaming(null); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur(); }} />
            ) : t.title}
            <button onClick={(e) => { e.stopPropagation(); closeTab(t.id); }} className="opacity-40 group-hover:opacity-100 hover:text-red-300"><X size={11} /></button>
          </div>
        ))}
        <button onClick={() => addTab()} className="px-2 py-1 text-slate-400 hover:text-cyan-300" title="New tab"><Plus size={13} /></button>
      </div>
      <div className="border border-t-0 border-slate-800 rounded-b mb-2">
        <CodeMirror key={tab.id} value={tab.text} onChange={setText} height="220px" theme="dark" extensions={extensions}
          onCreateEditor={(view) => { viewRef.current = view; }} basicSetup={{ foldGutter: false, highlightActiveLine: true, autocompletion: true }} />
      </div>

      {res && (
        <div className={`mb-2 p-2 border rounded text-xs font-mono max-h-36 overflow-auto ${res.run.error ? 'border-red-900 bg-red-950/20' : 'border-slate-800 bg-slate-900/40'}`}>
          {res.run.results.map((r, i) => (
            <button key={i} onClick={() => r.columns.length && setResults((m) => ({ ...m, [tab.id]: { ...res, which: i } }))}
              className={`flex items-start gap-1.5 w-full text-left ${r.columns.length ? 'hover:bg-slate-800/50' : ''} ${i === res.which ? 'text-cyan-200' : 'text-gray-300'}`}>
              <CheckCircle2 size={12} className="text-emerald-500 shrink-0 mt-0.5" />
              <span className="shrink-0 text-slate-400">{r.columns.length ? `${r.rows.length.toLocaleString()}${r.truncated ? '+' : ''} row(s) returned` : `${r.changes.toLocaleString()} row(s) affected`} in {r.ms.toFixed(1)} ms</span>
              <span className="truncate text-slate-500">{r.sql.replace(/\s+/g, ' ')}</span>
            </button>
          ))}
          {res.run.error && <div className="flex items-start gap-1.5 text-red-300"><XCircle size={12} className="shrink-0 mt-0.5" /> {res.run.error}{errLine ? ` — at line ${errLine.line}, column ${errLine.col}` : ''}</div>}
          {!res.run.error && <div className="text-emerald-500/80 mt-0.5">Execution finished without errors ({res.run.results.length} statement(s), {res.run.ms.toFixed(1)} ms).</div>}
        </div>
      )}

      {shown && (
        <>
          <div className="flex items-center gap-1 mb-1 text-xs">
            <span className="text-slate-400 truncate">Result of: <span className="font-mono text-slate-300">{shown.sql.replace(/\s+/g, ' ').slice(0, 120)}</span>{shown.truncated ? ' (first 50,000 rows)' : ''}</span>
            <button className={btn + ' ml-auto'} onClick={() => downloadText('query-result.csv', toCsv(shown.columns, shown.rows), 'text/csv')}><Download size={12} /> CSV</button>
            <button className={btn} onClick={() => downloadText('query-result.json', JSON.stringify(shown.rows.map((r) => Object.fromEntries(shown.columns.map((c, i) => [c, r[i] instanceof Uint8Array ? Array.from(r[i]) : r[i]]))), null, 2), 'application/json')}><Download size={12} /> JSON</button>
            <button className={btn} disabled={!/^\s*(SELECT|WITH|VALUES)\b/i.test(shown.sql)} onClick={() => setViewSql(shown.sql)} title="Save this query as a view"><Eye size={12} /> Save as view</button>
            <button className={btn + (showPlot ? ' !border-cyan-800' : '')} onClick={() => setShowPlot((s) => !s)}><LineChart size={12} /> Plot</button>
          </div>
          <ResultGrid columns={shown.columns} rows={shown.rows} maxHeight="40vh" />
          {showPlot && <div className="mt-2"><Plot columns={shown.columns} rows={shown.rows} /></div>}
        </>
      )}
      {viewSql !== null && <ViewEditor session={session} initialSelect={viewSql} onClose={() => setViewSql(null)} />}
    </div>
  );
}
