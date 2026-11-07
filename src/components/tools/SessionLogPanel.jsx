import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollText, Download, FileJson, Copy, Trash2, Upload, StickyNote, X } from 'lucide-react';
import {
  useSessionEntries, record, clearLog, confirmAction, exportMarkdown, exportJson, parseJsonLog, LEVELS
} from '../../utils/sessionLog';

const LEVEL_STYLE = {
  info: 'text-slate-300', ok: 'text-emerald-300', warn: 'text-amber-300', error: 'text-rose-300 font-bold',
  action: 'text-amber-200 font-bold', device: 'text-cyan-300'
};
const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none';
const btn = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40';

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SessionLogPanel() {
  const live = useSessionEntries();
  const [imported, setImported] = useState(null); // { name, entries } while viewing a log someone sent
  const [tool, setTool] = useState('');
  const [levels, setLevels] = useState(() => new Set(LEVELS));
  const [query, setQuery] = useState('');
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState('');
  const fileRef = useRef(null);
  const listRef = useRef(null);

  const source = imported ? imported.entries : live;
  const tools = useMemo(() => [...new Set(source.map((e) => e.tool))].sort(), [source]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((e) => (!tool || e.tool === tool) && levels.has(e.level) && (!q || e.text.toLowerCase().includes(q)));
  }, [source, tool, levels, query]);

  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  const filtered = shown.length !== source.length;
  const meta = { userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined };

  const addNote = () => {
    if (!note.trim()) return;
    record('Note', 'info', note);
    setNote('');
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(exportMarkdown(shown, meta));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      setProblem(`Copy failed: ${err.message}`);
    }
  };

  const onOpen = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setImported({ name: file.name, entries: parseJsonLog(await file.text()) });
      setTool(''); setProblem('');
    } catch (err) {
      setProblem(`${file.name}: ${err.message}`);
    }
  };

  const toggleLevel = (lv) => setLevels((prev) => {
    const next = new Set(prev);
    if (next.has(lv)) next.delete(lv); else next.add(lv);
    return next;
  });

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              What the hardware tools did in this browser tab: every device you picked (with its USB IDs), every destructive
              action you confirmed or declined, errors, and the tools' own log lines. It survives a reload but not closing the tab.
              Export a Markdown report to attach to a ticket, or JSON to open here later.
            </p>
          </div>
          <span className="text-slate-500">{imported ? `viewing ${imported.name}` : 'this session'} · {source.length} entries</span>
        </div>

        {imported && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200">
            Viewing an exported log ({imported.name}), read-only.
            <button onClick={() => setImported(null)} className="ml-auto flex items-center gap-1 text-cyan-300 font-bold"><X className="w-3.5 h-3.5" /> BACK TO THIS SESSION</button>
          </div>
        )}
        {problem && <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">{problem}</div>}

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => download(`session-${stamp()}.md`, exportMarkdown(shown, meta), 'text/markdown')} disabled={!shown.length} className={`${btn} border-emerald-500/40 text-emerald-300`}>
            <Download className="w-3.5 h-3.5" /> REPORT (.MD)
          </button>
          <button onClick={() => download(`session-${stamp()}.json`, exportJson(shown, meta), 'application/json')} disabled={!shown.length} className={`${btn} border-slate-700 text-slate-200`}>
            <FileJson className="w-3.5 h-3.5" /> JSON
          </button>
          <button onClick={copyReport} disabled={!shown.length} className={`${btn} border-slate-700 text-slate-200`}>
            <Copy className="w-3.5 h-3.5" /> {copied ? 'COPIED' : 'COPY REPORT'}
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onOpen} />
          <button onClick={() => fileRef.current?.click()} className={`${btn} border-slate-700 text-slate-200`}>
            <Upload className="w-3.5 h-3.5" /> OPEN JSON LOG
          </button>
          {!imported && (
            <button onClick={() => { if (confirmAction('Clear the session log? Export it first if you need it.', 'Session Log')) clearLog(); }} disabled={!live.length} className={`${btn} border-rose-500/40 text-rose-300 ml-auto`}>
              <Trash2 className="w-3.5 h-3.5" /> CLEAR
            </button>
          )}
        </div>
        {filtered && <p className="text-slate-500">Exports contain the {shown.length} entries matching the filters below.</p>}

        <div className="flex flex-wrap items-center gap-2">
          <select value={tool} onChange={(e) => setTool(e.target.value)} className={inp}>
            <option value="">All tools</option>
            {tools.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {LEVELS.map((lv) => (
            <button key={lv} onClick={() => toggleLevel(lv)} className={`px-2 py-0.5 rounded border ${levels.has(lv) ? `border-slate-600 ${LEVEL_STYLE[lv]}` : 'border-slate-800 text-slate-600'}`}>{lv}</button>
          ))}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search" className={`${inp} flex-1 min-w-[8rem]`} />
        </div>

        {!imported && (
          <div className="flex items-center gap-2">
            <StickyNote className="w-3.5 h-3.5 text-slate-500" />
            <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Add a note to the log (e.g. swapped to the 3.3 V supply)" className={`${inp} flex-1`} />
            <button onClick={addNote} disabled={!note.trim()} className={`${btn} border-slate-700 text-slate-200`}>ADD</button>
          </div>
        )}
      </div>

      <div ref={listRef} className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl max-h-[60vh] overflow-y-auto">
        {shown.length === 0 ? (
          <p className="text-slate-500 p-2">{source.length ? 'Nothing matches the filters.' : 'Nothing logged yet. Open a hardware tool and connect a device (or use its DEMO mode).'}</p>
        ) : (
          <table className="w-full">
            <tbody>
              {shown.map((e) => (
                <tr key={e.seq} className="border-t border-slate-900 align-top">
                  <td className="pr-2 py-0.5 text-slate-500 whitespace-nowrap">{new Date(e.t).toLocaleTimeString()}</td>
                  <td className="pr-2 py-0.5 text-slate-400 whitespace-nowrap">{e.tool}</td>
                  <td className={`py-0.5 break-all ${LEVEL_STYLE[e.level] || ''}`}>
                    {e.level === 'error' && 'ERROR: '}{e.text}{e.count > 1 && <span className="text-slate-500"> ×{e.count}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
