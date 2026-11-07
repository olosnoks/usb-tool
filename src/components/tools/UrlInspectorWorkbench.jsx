import React, { useState } from 'react';
import { Link2, Search, RefreshCw, ShieldCheck, ShieldAlert, Download, FileCode, Image, Code2 } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import { extractTitle, extractLinks, extractResources, extractMeta, extractForms, assessSecurityHeaders } from '../../utils/urlinspect.js';

/**
 * URL / Link Analyzer — fetch a page and map what it references: response
 * headers (with a security-header assessment), title/meta, links, scripts,
 * stylesheets, images and forms. Runs in the browser; most sites need the proxy
 * (CORS). Read-only — it fetches once and parses, nothing is submitted.
 */

function List({ items, empty = 'none', linkify = true }) {
  if (!items?.length) return <div className="text-slate-600 text-xs">{empty}</div>;
  return (
    <div className="max-h-48 overflow-auto font-mono text-[11px]">
      {items.map((it, i) => (
        <div key={i} className="py-0.5 border-b border-slate-900 last:border-0 break-all">
          {linkify ? <a href={it} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">{it}</a> : <span className="text-gray-300">{it}</span>}
        </div>
      ))}
    </div>
  );
}

function Card({ icon: Icon, title, count, children }) {
  return (
    <div className="border border-slate-800 rounded bg-slate-950 p-2">
      <div className="text-[11px] font-semibold text-slate-300 mb-1 flex items-center gap-1.5">
        <Icon size={12} className="text-cyan-400" /> {title} {count !== undefined && <span className="text-slate-500">({count})</span>}
      </div>
      {children}
    </div>
  );
}

export default function UrlInspectorWorkbench({ onLogMessage }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [res, setRes] = useState(null);

  const log = (m) => onLogMessage?.(m);

  const run = async () => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    setBusy(true); setError(''); setRes(null);
    log(`Fetch ${target}${isProxyEnabled() ? ' (via proxy)' : ''}`);
    const start = performance.now();
    try {
      const resp = await proxiedFetch(target, { redirect: 'follow' });
      const html = await resp.text();
      const headers = Object.fromEntries([...resp.headers.entries()]);
      setRes({
        finalUrl: resp.url || target,
        status: resp.status,
        statusText: resp.statusText,
        timeMs: Math.round(performance.now() - start),
        size: html.length,
        headers,
        security: assessSecurityHeaders(headers),
        title: extractTitle(html),
        meta: extractMeta(html),
        links: extractLinks(html, target),
        resources: extractResources(html, target),
        forms: extractForms(html, target),
      });
      log(`${resp.status} · ${(html.length / 1024).toFixed(1)} KB`);
    } catch (e) {
      setError(describeNetworkError(e));
    }
    setBusy(false);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'url-analysis.json'; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="https://example.com"
          className="flex-1 min-w-[14rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono"
        />
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} {busy ? 'Fetching…' : 'Analyze'}
        </button>
      </div>

      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {res && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className={res.status >= 400 ? 'text-red-400' : res.status >= 300 ? 'text-amber-400' : 'text-green-400'}>{res.status} {res.statusText}</span>
            <span className="text-gray-500">{(res.size / 1024).toFixed(1)} KB · {res.timeMs} ms</span>
            <span className="text-slate-400 font-mono break-all">{res.finalUrl}</span>
            <button onClick={exportJson} className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 ml-auto"><Download size={12} /> JSON</button>
          </div>

          {res.title && <div className="text-sm text-gray-200">{res.title}</div>}

          <Card icon={ShieldCheck} title="Security headers">
            <div className="flex flex-wrap gap-1.5">
              {res.security.map((h) => (
                <span key={h.header} title={h.value || 'absent'} className={`px-2 py-0.5 rounded text-[10px] border inline-flex items-center gap-1 ${h.present ? 'border-emerald-800 bg-emerald-950/20 text-emerald-300' : 'border-red-900 bg-red-950/20 text-red-300'}`}>
                  {h.present ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />} {h.header}
                </span>
              ))}
            </div>
          </Card>

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
            <Card icon={Link2} title="Links" count={res.links.length}><List items={res.links} /></Card>
            <Card icon={FileCode} title="Scripts" count={res.resources.scripts.length}><List items={res.resources.scripts} /></Card>
            <Card icon={Code2} title="Stylesheets" count={res.resources.styles.length}><List items={res.resources.styles} /></Card>
            <Card icon={Image} title="Images" count={res.resources.images.length}><List items={res.resources.images} /></Card>
          </div>

          <Card icon={FileCode} title="Forms" count={res.forms.length}>
            {res.forms.length === 0 ? <div className="text-slate-600 text-xs">none</div> : res.forms.map((f, i) => (
              <div key={i} className="mb-1.5 pb-1.5 border-b border-slate-900 last:border-0 text-[11px] font-mono">
                <div><span className={f.method === 'POST' ? 'text-amber-400' : 'text-green-400'}>{f.method}</span> <span className="text-cyan-400 break-all">{f.action}</span></div>
                <div className="text-slate-500 pl-2">{f.inputs.map((inp) => `${inp.name || '—'}:${inp.type}`).join('  ·  ') || 'no named inputs'}</div>
              </div>
            ))}
          </Card>

          <details>
            <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-gray-200">Response headers & meta ({Object.keys(res.headers).length} + {Object.keys(res.meta).length})</summary>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))] mt-2">
              <Card icon={ShieldCheck} title="Response headers"><List items={Object.entries(res.headers).map(([k, v]) => `${k}: ${v}`)} linkify={false} /></Card>
              <Card icon={FileCode} title="Meta tags"><List items={Object.entries(res.meta).map(([k, v]) => `${k}: ${v}`)} linkify={false} /></Card>
            </div>
          </details>
        </div>
      )}

      {!res && !error && (
        <p className="text-xs text-slate-500">
          Fetch a page and map what it references — links, scripts, stylesheets, images, forms — plus its response headers
          with a security-header check. Most sites block cross-origin browser requests, so set a proxy above. Read-only:
          it fetches once and parses. Analyze only sites you own or are authorized to assess.
        </p>
      )}
    </div>
  );
}
