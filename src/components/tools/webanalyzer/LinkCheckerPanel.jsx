import React, { useState, useRef } from 'react';
import { RefreshCw, FileDown, Square } from 'lucide-react';
import { proxiedFetch } from '../../../utils/netClient';
import { checkLinks, summarizeLinks, linksToCsv } from '../../../utils/siteAudit.js';

/**
 * Link checker for the links found on the analysed page. Sends one HEAD (GET as
 * fallback) per link, a few at a time, from the browser, so cross-origin links
 * are CORS-limited unless a proxy is set (status "no response" then means
 * blocked or unreachable, not necessarily broken). Only runs on click.
 */
export default function LinkCheckerPanel({ links, baseUrl, onLogMessage, onReport }) {
  const [scope, setScope] = useState('internal');
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef(null);

  const origin = (() => { try { return new URL(baseUrl).origin; } catch { return ''; } })();
  const targets = (scope === 'internal' ? links.filter((l) => l.startsWith(origin)) : links).slice(0, 200);

  const run = async () => {
    const ctl = new AbortController(); abortRef.current = ctl;
    setBusy(true); setResults([]); setProgress(0);
    onLogMessage?.(`Link check: ${targets.length} link(s) (${scope})`);
    let n = 0;
    const res = await checkLinks(targets, (u, init) => proxiedFetch(u, init), {
      concurrency: 4, signal: ctl.signal, onResult: () => setProgress(++n),
    });
    setResults(res); setBusy(false);
    const s = summarizeLinks(res);
    onReport?.({ markdown: `${s.total} checked: ${s.ok} ok (${s.redirected} redirected), ${s.broken} broken, ${s.unreachable} no response.\n\n` + res.filter((r) => !r.ok || r.redirected).map((r) => `- ${r.status || 'no response'} ${r.url}${r.redirected ? ' (redirected)' : ''}`).join('\n') });
    onLogMessage?.(`Link check done: ${s.broken} broken, ${s.unreachable} no response`);
  };

  const exportCsv = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([linksToCsv(results)], { type: 'text/csv' }));
    a.download = `link-check-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const s = summarizeLinks(results);
  const bad = results.filter((r) => !r.ok);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <select aria-label="Link scope" value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy} className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1">
          <option value="internal">Same-origin links</option>
          <option value="all">All links</option>
        </select>
        <span className="text-slate-500">{targets.length} link(s){links.length > 200 && ' (first 200)'}</span>
        {!busy
          ? <button onClick={run} disabled={!targets.length} className="px-2 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded hover:bg-cyan-900/70 disabled:opacity-40">Check links</button>
          : <button onClick={() => abortRef.current?.abort()} className="px-2 py-1 bg-red-950/40 border border-red-900 text-red-300 rounded inline-flex items-center gap-1"><Square size={10} /> Stop</button>}
        {busy && <span className="text-slate-400 inline-flex items-center gap-1"><RefreshCw size={11} className="animate-spin" /> {progress}/{targets.length}</span>}
        <button onClick={exportCsv} disabled={!results.length} title="Export results as CSV" className="px-2 py-1 bg-slate-800 border border-slate-700 rounded disabled:opacity-40 inline-flex items-center gap-1"><FileDown size={11} /> CSV</button>
      </div>
      {results.length > 0 && (
        <>
          <div className="text-[11px] text-slate-400">{s.ok} ok{s.redirected ? ` (${s.redirected} redirected)` : ''} · <span className={s.broken ? 'text-red-400' : ''}>{s.broken} broken</span> · <span className={s.unreachable ? 'text-amber-400' : ''}>{s.unreachable} no response</span></div>
          <div className="max-h-44 overflow-auto font-mono text-[11px]">
            {bad.length === 0 && <div className="text-emerald-400">No broken links.</div>}
            {bad.map((r) => (
              <div key={r.url} className="py-0.5 border-b border-slate-900 last:border-0 break-all">
                <span className={r.status ? 'text-red-400' : 'text-amber-400'}>{r.status || 'no response'}</span> <span className="text-gray-300">{r.url}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
