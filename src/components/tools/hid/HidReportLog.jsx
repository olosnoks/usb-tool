import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Pause, Play, Trash2, Download, Copy } from 'lucide-react';
import { hexDump } from '../../../utils/hidInspector';
import { diffBytes, trimLog, filterLog, seenReportIds, logToCsv, logToText } from '../../../utils/hidLog';

const MAX = 500;
const ib = 'p-1 rounded border border-slate-700 text-slate-300 disabled:opacity-40 hover:border-cyan-500/50';

/** Scrolling log of every input report with delta time, id filter, hex search, and CSV / text export. */
export default function HidReportLog({ addTap }) {
  const [entries, setEntries] = useState([]);
  const [paused, setPaused] = useState(false);
  const [idFilter, setIdFilter] = useState('all');
  const [hexFilter, setHexFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const buf = useRef([]);
  const lastT = useRef(null);
  const lastBytes = useRef({});
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  useEffect(() => addTap((reportId, bytes, t) => {
    if (pausedRef.current) return;
    const prev = lastBytes.current[reportId];
    const copyBytes = Uint8Array.from(bytes);
    lastBytes.current[reportId] = copyBytes;
    buf.current.push({
      t, reportId, hex: hexDump(copyBytes),
      delta: lastT.current == null ? null : t - lastT.current,
      changed: diffBytes(prev, copyBytes)
    });
    lastT.current = t;
  }), [addTap]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!buf.current.length) return;
      const add = buf.current;
      buf.current = [];
      setEntries((p) => trimLog([...p, ...add], MAX));
    }, 250);
    return () => clearInterval(id);
  }, []);

  const shown = useMemo(() => filterLog(entries, { reportId: idFilter, hex: hexFilter }), [entries, idFilter, hexFilter]);
  const ids = useMemo(() => seenReportIds(entries), [entries]);
  const t0 = entries.length ? entries[0].t : 0;
  const rel = (list) => list.map((e) => ({ ...e, t: e.t - t0 }));

  const clear = () => { buf.current = []; setEntries([]); lastT.current = null; lastBytes.current = {}; };
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([logToCsv(rel(shown))], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `hid-reports-${Date.now()}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logToText(rel(shown)));
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (e) { /* clipboard blocked */ }
  };

  return (
    <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 space-y-2 @lg:col-span-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-bold text-slate-200">REPORT LOG</span>
        <span className="text-[11px] text-slate-500">{shown.length}/{entries.length}</span>
        <select value={idFilter} onChange={(e) => setIdFilter(e.target.value)} aria-label="Filter by report id" className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-slate-200 text-[11px]">
          <option value="all">all ids</option>
          {ids.map((i) => <option key={i} value={i}>id {i}</option>)}
        </select>
        <input value={hexFilter} onChange={(e) => setHexFilter(e.target.value)} placeholder="hex contains" aria-label="Filter by hex bytes" className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 text-[11px] w-24 outline-none" />
        <span className="flex-1" />
        <button onClick={() => setPaused((p) => !p)} title={paused ? 'Resume logging' : 'Pause logging'} aria-label={paused ? 'Resume logging' : 'Pause logging'} className={ib}>{paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}</button>
        <button onClick={copy} disabled={!shown.length} title={copied ? 'Copied' : 'Copy shown reports as text'} aria-label="Copy log" className={ib}><Copy className="w-3 h-3" /></button>
        <button onClick={exportCsv} disabled={!shown.length} title="Download shown reports as CSV" aria-label="Download CSV" className={ib}><Download className="w-3 h-3" /></button>
        <button onClick={clear} disabled={!entries.length} title="Clear log" aria-label="Clear log" className={ib}><Trash2 className="w-3 h-3" /></button>
      </div>
      <div className="bg-black border border-slate-800 rounded p-1.5 max-h-40 overflow-auto text-[11px] space-y-0.5" role="log">
        {shown.length === 0 && <div className="text-slate-600">{entries.length ? 'No reports match the filter.' : 'Input reports are listed here as they arrive (last 500 kept). Changed bytes are highlighted.'}</div>}
        {shown.slice(-200).map((e, i) => {
          const set = new Set(e.changed);
          return (
            <div key={i} className="whitespace-nowrap">
              <span className="text-slate-600">{(e.t - t0).toFixed(1).padStart(9)} ms</span>{' '}
              <span className="text-slate-500">{e.delta == null ? '' : `+${e.delta.toFixed(1)}`}</span>{' '}
              <span className="text-purple-300">id {e.reportId}</span>{' '}
              {e.hex.split(' ').map((b, bi) => <span key={bi} className={set.has(bi) ? 'text-amber-300 font-bold' : 'text-cyan-300/70'}>{b} </span>)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
