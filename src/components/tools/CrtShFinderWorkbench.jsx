import React, { useState } from 'react';
import { Search, Download, Globe, RefreshCw } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import { extractSubdomains, crtShUrl } from '../../utils/crtsh.js';

/**
 * crt.sh Certificate Transparency subdomain finder. Queries crt.sh for all
 * certificates issued under a domain and extracts the unique hostnames — a
 * passive way to map subdomains without touching the target. crt.sh does not
 * send CORS headers, so a proxy is required (set it below); no API key needed.
 */

export default function CrtShFinderWorkbench({ onLogMessage }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hosts, setHosts] = useState(null);
  const [filter, setFilter] = useState('');

  const log = (m) => onLogMessage?.(m);

  const run = async () => {
    const base = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*?\.+/, '');
    if (!base) return;
    setBusy(true); setError(''); setHosts(null);
    const url = crtShUrl(base);
    log(`crt.sh lookup for ${base}${isProxyEnabled() ? ' (via proxy)' : ''}…`);
    try {
      const resp = await proxiedFetch(url, { headers: { accept: 'application/json' } });
      if (!resp.ok) throw new Error(`crt.sh returned HTTP ${resp.status}`);
      const text = await resp.text();
      let rows;
      try { rows = JSON.parse(text); }
      catch { throw new Error('crt.sh did not return JSON (often rate-limiting or a proxy issue). Try again shortly.'); }
      const found = extractSubdomains(rows, base);
      setHosts(found);
      log(`crt.sh: ${found.length} unique host(s) from ${rows.length} cert record(s)`);
    } catch (e) {
      setError(describeNetworkError(e));
    }
    setBusy(false);
  };

  const shown = hosts?.filter((h) => !filter.trim() || h.host.includes(filter.trim().toLowerCase())) || [];

  const exportTxt = () => {
    const blob = new Blob([shown.map((h) => h.host).join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${domain.trim() || 'crtsh'}-subdomains.txt`; a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
          placeholder="example.com"
          className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono"
        />
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} {busy ? 'Querying…' : 'Find subdomains'}
        </button>
      </div>

      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {hosts && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="text-xs text-gray-300"><Globe size={12} className="inline mr-1 text-cyan-400" />{hosts.length} unique host(s)</span>
            <div className="flex items-center gap-2">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono w-32" />
              <button onClick={exportTxt} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"><Download size={12} /> .txt</button>
            </div>
          </div>
          <div className="border border-slate-800 rounded bg-slate-950 max-h-[55vh] overflow-auto">
            {shown.map((h) => (
              <div key={h.host} className="px-2 py-1 border-b border-slate-900 last:border-0 font-mono text-xs flex items-center gap-2">
                {h.wildcard && <span className="text-amber-500 text-[10px]">✱</span>}
                <span className="text-gray-200">{h.host}</span>
              </div>
            ))}
            {shown.length === 0 && <div className="px-2 py-4 text-center text-slate-600 text-xs">No hosts match.</div>}
          </div>
        </>
      )}

      {!hosts && !error && (
        <p className="text-xs text-slate-500">
          Enumerate a domain's subdomains from public Certificate Transparency logs via crt.sh — passive recon that never
          contacts the target. A proxy is required because crt.sh doesn't allow cross-origin browser requests. Use only on
          domains you own or are authorized to assess.
        </p>
      )}
    </div>
  );
}
