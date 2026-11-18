import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileJson, FileSpreadsheet, Copy, Trash2, Upload, StickyNote, X } from 'lucide-react';
import {
  useSessionEntries, record, clearLog, confirmAction, exportMarkdown, exportJson, parseJsonLog, describeEnvironment, LEVELS
} from '../../utils/sessionLog';
import { parseQuery, matchesQuery, withinMinutes, levelCounts, exportCsv } from '../../utils/sessionLogFilter';

const LEVEL_STYLE = {
  info: 'text-slate-300', ok: 'text-emerald-300', warn: 'text-amber-300', error: 'text-rose-300 font-bold',
  action: 'text-amber-200 font-bold', device: 'text-cyan-300'
};
const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none focus:border-cyan-500/60';
const btn = 'flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold disabled:opacity-40';
const WINDOWS = [[0, 'All time'], [1, 'Last 1 min'], [5, 'Last 5 min'], [15, 'Last 15 min'], [60, 'Last hour']];

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
  const [unredacted, setUnredacted] = useState(false); // off by default: exports are redacted
  const [preview, setPreview] = useState(false);
  const [minutes, setMinutes] = useState(0);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const fileRef = useRef(null);
  const listRef = useRef(null);

  const source = imported ? imported.entries : live;
  const tools = useMemo(() => [...new Set(source.map((e) => e.tool))].sort(), [source]);
  const parsed = useMemo(() => parseQuery(query), [query]);
  const counts = useMemo(() => levelCounts(source), [source]);
  const shown = useMemo(() => {
    const base = withinMinutes(source, minutes);
    return base.filter((e) => (!tool || e.tool === tool) && levels.has(e.level) && matchesQuery(e, parsed));
  }, [source, tool, levels, parsed, minutes]);

  useEffect(() => {
    const el = listRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [shown.length, follow]);

  const filtered = shown.length !== source.length;
  const environment = useMemo(() => describeEnvironment(), []);
  const meta = { userAgent: environment.userAgent, environment, redact: unredacted ? false : {} };
  // JSON export keeps its environment block but never carries the raw userAgent twice.
  const jsonMeta = { environment };
  const redactArg = unredacted ? false : {};
  const reportText = () => exportMarkdown(shown, meta);

  const addNote = () => {
    if (!note.trim()) return;
    record('Note', 'info', note);
    setNote('');
  };

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(reportText());
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
    <div className="space-y-2 font-mono text-xs">
      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="text-slate-400">{imported ? `viewing ${imported.name}` : 'this session'} · {shown.length}/{source.length} entries</span>
          <details className="text-slate-500 max-w-full">
            <summary className="cursor-pointer text-slate-400 hover:text-cyan-300">About / search syntax</summary>
            <div className="mt-1 space-y-1 text-[11px] max-w-3xl">
              <p>Records every device you picked (with its USB IDs), each destructive action you confirmed or declined, errors and the tools' own log lines. It survives a reload but not closing the tab.</p>
              <p>Search: words are ANDed; <code>"a phrase"</code>; <code>/regex/</code>; <code>-term</code> excludes; <code>tool:adb</code>; <code>level:error</code>. Example: <code>tool:flash -/retry/ level:warn</code>.</p>
            </div>
          </details>
        </div>

        {imported && (
          <div className="flex items-center gap-2 p-2 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200">
            Viewing an exported log ({imported.name}), read-only.
            <button onClick={() => setImported(null)} className="ml-auto flex items-center gap-1 text-cyan-300 font-bold"><X className="w-3.5 h-3.5" /> BACK TO THIS SESSION</button>
          </div>
        )}
        {problem && <div className="p-2 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">{problem}</div>}

        <div className="flex flex-wrap items-center gap-1.5">
          <button title="Download a Markdown report of the shown entries" onClick={() => download(`session-${stamp()}.md`, reportText(), 'text/markdown')} disabled={!shown.length} className={`${btn} border-emerald-500/40 text-emerald-300`}>
            <Download className="w-3.5 h-3.5" /> MD
          </button>
          <button title="Download the shown entries as CSV (time, seq, tool, level, count, text)" onClick={() => download(`session-${stamp()}.csv`, exportCsv(shown, redactArg), 'text/csv')} disabled={!shown.length} className={`${btn} border-slate-700 text-slate-200`}>
            <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
          </button>
          <button title="Download the shown entries as JSON (can be re-opened here)" onClick={() => download(`session-${stamp()}.json`, exportJson(shown, jsonMeta, redactArg), 'application/json')} disabled={!shown.length} className={`${btn} border-slate-700 text-slate-200`}>
            <FileJson className="w-3.5 h-3.5" /> JSON
          </button>
          <button title="Copy the Markdown report to the clipboard" onClick={copyReport} disabled={!shown.length} className={`${btn} border-slate-700 text-slate-200`}>
            <Copy className="w-3.5 h-3.5" /> {copied ? 'COPIED' : 'COPY'}
          </button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onOpen} aria-label="Open JSON log file" />
          <button title="Open a previously exported JSON log (read-only)" onClick={() => fileRef.current?.click()} className={`${btn} border-slate-700 text-slate-200`}>
            <Upload className="w-3.5 h-3.5" /> OPEN JSON LOG
          </button>
          {!imported && (
            <button onClick={() => { if (confirmAction('Clear the session log? Export it first if you need it.', 'Session Log')) clearLog(); }} disabled={!live.length} className={`${btn} border-rose-500/40 text-rose-300 ml-auto`}>
              <Trash2 className="w-3.5 h-3.5" /> CLEAR
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-400 text-[11px]">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={unredacted} onChange={(e) => setUnredacted(e.target.checked)} />
            Include unredacted text in exports
          </label>
          <button onClick={() => setPreview((p) => !p)} className="underline text-slate-300 hover:text-cyan-300">{preview ? 'Hide export preview' : 'Preview export'}</button>
          <span className="text-slate-500">{unredacted ? 'Exports are RAW: tokens, keys and passwords are kept.' : 'Exports mask Bearer tokens, api_key= / password= values, JWTs, private keys and long hex/base64 strings.'}</span>
        </div>
        {preview && (
          <pre data-testid="export-preview" className="max-h-64 overflow-auto bg-slate-950 border border-slate-800 rounded p-2 text-[11px] text-slate-300 whitespace-pre-wrap">{reportText()}</pre>
        )}
        {filtered && <p className="text-slate-500">Exports contain the {shown.length} entries matching the filters below.</p>}

        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label="Filter by tool" value={tool} onChange={(e) => setTool(e.target.value)} className={inp}>
            <option value="">All tools</option>
            {tools.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select aria-label="Time window" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={inp}>
            {WINDOWS.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          </select>
          {LEVELS.map((lv) => (
            <button key={lv} aria-pressed={levels.has(lv)} onClick={() => toggleLevel(lv)} className={`px-1.5 py-0.5 rounded border ${levels.has(lv) ? `border-slate-600 ${LEVEL_STYLE[lv]}` : 'border-slate-800 text-slate-600'}`}>{lv}{counts[lv] ? ` ${counts[lv]}` : ''}</button>
          ))}
          <input aria-label="Search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder='word  "phrase"  /regex/  -not  tool:x  level:y' className={`${inp} flex-1 min-w-[10rem]`} />
        </div>
        {parsed.error && <p className="text-rose-300 text-[11px]">{parsed.error}</p>}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow newest</label>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} /> Wrap long lines</label>
        </div>

        {!imported && (
          <div className="flex items-center gap-2">
            <StickyNote className="w-3.5 h-3.5 text-slate-500" />
            <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} placeholder="Add a note to the log (e.g. swapped to the 3.3 V supply)" className={`${inp} flex-1`} />
            <button onClick={addNote} disabled={!note.trim()} className={`${btn} border-slate-700 text-slate-200`}>ADD</button>
          </div>
        )}
      </div>

      <div ref={listRef} className="bg-[#030712] border border-cyber-border rounded-lg p-2 max-h-[60vh] overflow-auto">
        {shown.length === 0 ? (
          <p className="text-slate-500 p-2">{source.length ? 'Nothing matches the filters.' : 'Nothing logged yet. Open a hardware tool and connect a device (or use its DEMO mode).'}</p>
        ) : (
          <table className="w-full">
            <tbody>
              {shown.map((e) => (
                <tr key={e.seq} className="border-t border-slate-900 align-top">
                  <td className="pr-2 py-0.5 text-slate-500 whitespace-nowrap">{new Date(e.t).toLocaleTimeString()}</td>
                  <td className="pr-2 py-0.5 text-slate-400 whitespace-nowrap">{e.tool}</td>
                  <td className={`py-0.5 ${wrap ? 'break-all' : 'whitespace-nowrap'} ${LEVEL_STYLE[e.level] || ''}`}>
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
