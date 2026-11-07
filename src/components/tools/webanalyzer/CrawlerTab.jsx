import React, { useState, useRef } from 'react';
import { Waypoints, Play, Square, Download } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../../utils/netClient';
import { extractLinks } from '../../../utils/urlinspect.js';

/**
 * Bounded same-origin crawler → sitemap. Breadth-first from a seed URL, fetching
 * pages via the proxy, following only same-origin links, up to a depth and page
 * cap. Read-only GETs. Stoppable.
 */
export default function CrawlerTab({ onLogMessage }) {
  const [seed, setSeed] = useState('');
  const [maxDepth, setMaxDepth] = useState(2);
  const [maxPages, setMaxPages] = useState(40);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pages, setPages] = useState([]);
  const cancelRef = useRef(false);

  const run = async () => {
    let start = seed.trim();
    if (!start) return;
    if (!/^https?:\/\//i.test(start)) start = 'https://' + start;
    let origin;
    try { origin = new URL(start).origin; } catch { setError('Invalid URL'); return; }
    setBusy(true); setError(''); setPages([]); cancelRef.current = false;
    onLogMessage?.(`Crawl ${start} (depth ${maxDepth}, ≤${maxPages} pages)${isProxyEnabled() ? ' (via proxy)' : ''}`);

    const seen = new Set([start]);
    const found = [];
    let queue = [{ url: start, depth: 0 }];
    const cap = Math.max(1, Math.min(200, Number(maxPages) || 40));
    const depthCap = Math.max(0, Math.min(5, Number(maxDepth) || 2));

    while (queue.length && found.length < cap && !cancelRef.current) {
      const { url, depth } = queue.shift();
      let status = 'err'; let links = [];
      try {
        const resp = await proxiedFetch(url, { redirect: 'follow' });
        status = resp.status;
        const ct = resp.headers.get('content-type') || '';
        const html = ct.includes('html') ? await resp.text() : '';
        if (html && depth < depthCap) links = extractLinks(html, url).filter((l) => { try { return new URL(l).origin === origin; } catch { return false; } });
      } catch (e) { status = describeNetworkError(e); }
      found.push({ url, depth, status, links: links.length });
      setPages([...found]);
      if (depth < depthCap) {
        for (const l of links) {
          const norm = l.split('#')[0];
          if (!seen.has(norm) && seen.size < cap * 4) { seen.add(norm); queue.push({ url: norm, depth: depth + 1 }); }
        }
      }
    }
    onLogMessage?.(cancelRef.current ? `Crawl stopped at ${found.length} pages` : `Crawl complete: ${found.length} pages`);
    setBusy(false);
  };

  const exportTxt = () => {
    const blob = new Blob([pages.map((p) => p.url).join('\n')], { type: 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'sitemap.txt'; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="px-4 pb-4">
      <div className="flex flex-wrap gap-2 my-3 items-center">
        <input value={seed} onChange={(e) => setSeed(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && run()} placeholder="https://example.com" className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
        <label className="text-xs text-slate-400">depth <input type="number" min={0} max={5} value={maxDepth} onChange={(e) => setMaxDepth(e.target.value)} className="w-14 bg-slate-900 border border-slate-800 rounded px-1 py-1 ml-1 font-mono" /></label>
        <label className="text-xs text-slate-400">max pages <input type="number" min={1} max={200} value={maxPages} onChange={(e) => setMaxPages(e.target.value)} className="w-16 bg-slate-900 border border-slate-800 rounded px-1 py-1 ml-1 font-mono" /></label>
        {!busy
          ? <button onClick={run} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 inline-flex items-center gap-1"><Play size={13} /> Crawl</button>
          : <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1.5 bg-slate-700 text-gray-200 rounded text-sm hover:bg-slate-600 inline-flex items-center gap-1"><Square size={13} /> Stop</button>}
      </div>
      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}
      {pages.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">{pages.length} page(s){busy ? ' · crawling…' : ''}</span>
            <button onClick={exportTxt} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"><Download size={12} /> sitemap.txt</button>
          </div>
          <div className="border border-slate-800 rounded bg-slate-950 max-h-[50vh] overflow-auto font-mono text-[11px]">
            {pages.map((p, i) => (
              <div key={i} className="px-2 py-1 border-b border-slate-900 last:border-0 flex items-center gap-2">
                <span className="text-slate-600 w-4 shrink-0">{p.depth}</span>
                <span className={`shrink-0 w-10 ${typeof p.status === 'number' ? (p.status >= 400 ? 'text-red-400' : p.status >= 300 ? 'text-amber-400' : 'text-green-400') : 'text-red-400'}`}>{p.status}</span>
                <span className="text-gray-300 break-all">{p.url}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {pages.length === 0 && !error && <p className="text-xs text-slate-500">Map a site by following same-origin links breadth-first from a seed URL, bounded by depth and page count. Read-only GETs via the proxy. Crawl only sites you own or are authorized to assess.</p>}
    </div>
  );
}
