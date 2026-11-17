import React, { useState } from 'react';
import { Search, Download, Globe, RefreshCw } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import { crtShUrl, crtShRelayUrl, extractCerts, issuerSummary, certsToCsv, safeFilename } from '../../utils/crtsh.js';

/**
 * crt.sh Certificate Transparency subdomain finder. Queries crt.sh for all
 * certificates issued under a domain and lists the unique hostnames with issuer
 * and expiry — a passive way to map subdomains without touching the target.
 * The site's own Worker relays crt.sh (/api/crtsh), so no proxy is needed there;
 * where the relay is absent (static host, dev without the proxy) it falls
 * through to the Proxy bar. No API key needed.
 */

const looksJson = (t) => /^\s*[[{]/.test(t || '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RETRY_STATUS = new Set([429, 502, 503, 504]);

/** One crt.sh request: relay first, then the Proxy bar / direct. -> { resp, text, route } */
async function crtFetchOnce(base, opts) {
  try {
    const resp = await fetch(crtShRelayUrl(base, opts), { headers: { accept: 'application/json' } });
    const text = await resp.text();
    if (!(resp.status === 404 && !looksJson(text))) return { resp, text, route: 'relay' };
  } catch { /* relay unreachable; fall back */ }
  const resp = await proxiedFetch(crtShUrl(base), { headers: { accept: 'application/json' } });
  const text = await resp.text();
  return { resp, text, route: isProxyEnabled() ? 'proxy' : 'direct' };
}

async function crtFetch(base, opts, onRetry) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      last = await crtFetchOnce(base, opts);
      if (!RETRY_STATUS.has(last.resp.status)) return last;
    } catch (e) {
      if (attempt === 2) throw e;
    }
    if (attempt < 2) { onRetry?.(attempt + 1); await sleep(1500 * 2 ** attempt); }
  }
  return last;
}

const download = (content, type, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  URL.revokeObjectURL(a.href);
};

export default function CrtShFinderWorkbench({ onLogMessage }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [certs, setCerts] = useState(null);
  const [issuers, setIssuers] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [route, setRoute] = useState('');
  const [filter, setFilter] = useState('');
  const [excludeExpired, setExcludeExpired] = useState(false);
  const [dedupe, setDedupe] = useState(true);

  const log = (m) => onLogMessage?.(m);

  const run = async () => {
    const base = domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*?\.+/, '');
    if (!base) return;
    setBusy(true); setError(''); setCerts(null);
    log(`crt.sh lookup for ${base}…`);
    try {
      const { resp, text, route: used } = await crtFetch(base, { excludeExpired, dedupe }, (n) => log(`crt.sh busy, retrying (${n}/2)…`));
      if (!resp.ok) throw new Error(`crt.sh returned HTTP ${resp.status}${RETRY_STATUS.has(resp.status) ? ' (overloaded; try again shortly)' : ''}`);
      let rows;
      try { rows = JSON.parse(text); }
      catch { throw new Error('crt.sh did not return JSON (often rate-limiting or a proxy issue). Try again shortly.'); }
      if (!Array.isArray(rows)) throw new Error('crt.sh returned an unexpected response.');
      const found = extractCerts(rows, base);
      setCerts(found); setIssuers(issuerSummary(rows)); setRowCount(rows.length); setRoute(used);
      log(`crt.sh: ${found.length} unique host(s) from ${rows.length} cert record(s) (${used})`);
    } catch (e) {
      setError(describeNetworkError(e));
    }
    setBusy(false);
  };

  const needle = filter.trim().toLowerCase();
  const shown = certs?.filter((c) => !needle || c.host.includes(needle) || c.issuer.toLowerCase().includes(needle)) || [];
  const expiredCount = certs?.filter((c) => c.expired).length || 0;
  const fname = (ext) => safeFilename(domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, ''), ext);

  const exportTxt = () => download(shown.map((c) => c.host).join('\n'), 'text/plain', fname('txt').replace('-certs', '-subdomains'));
  const exportCsv = () => download(certsToCsv(shown), 'text/csv', fname('csv'));
  const exportJson = () => download(JSON.stringify(shown, null, 2), 'application/json', fname('json'));

  const badge = (c) => {
    if (c.expired) return <span className="text-[10px] px-1 rounded bg-red-950 border border-red-900 text-red-300">expired</span>;
    if (c.daysLeft != null && c.daysLeft <= 30) return <span className="text-[10px] px-1 rounded bg-amber-950 border border-amber-900 text-amber-300">expires in {c.daysLeft}d</span>;
    return null;
  };

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
          placeholder="example.com"
          className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono"
        />
        <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={excludeExpired} onChange={(e) => setExcludeExpired(e.target.checked)} /> exclude expired</label>
        <label className="flex items-center gap-1 text-xs text-slate-300"><input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} /> dedupe</label>
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} {busy ? 'Querying…' : 'Find subdomains'}
        </button>
      </div>

      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {certs && (
        <>
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <span className="text-xs text-gray-300">
              <Globe size={12} className="inline mr-1 text-cyan-400" />{certs.length} unique host(s) from {rowCount} cert record(s)
              {expiredCount > 0 && <span className="text-red-300"> · {expiredCount} expired</span>}
              <span className="text-slate-500"> · via {route === 'relay' ? 'site relay' : route}</span>
            </span>
            <div className="flex items-center gap-2">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono w-32" />
              <button onClick={exportTxt} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"><Download size={12} /> .txt</button>
              <button onClick={exportCsv} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"><Download size={12} /> .csv</button>
              <button onClick={exportJson} className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"><Download size={12} /> .json</button>
            </div>
          </div>
          {issuers.length > 0 && (
            <div className="mb-2 text-[11px] text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="text-slate-500">Issuers:</span>
              {issuers.slice(0, 8).map((s) => <span key={s.issuer}>{s.issuer} <span className="text-slate-600">×{s.count}</span></span>)}
              {issuers.length > 8 && <span className="text-slate-600">+{issuers.length - 8} more</span>}
            </div>
          )}
          <div className="border border-slate-800 rounded bg-slate-950 max-h-[55vh] overflow-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead className="sticky top-0 bg-slate-900"><tr className="text-left text-slate-400">
                <th className="px-2 py-1">Host</th><th className="px-2 py-1">Issuer</th><th className="px-2 py-1">Not after</th><th className="px-2 py-1"></th>
              </tr></thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.host} className="border-b border-slate-900 last:border-0">
                    <td className="px-2 py-1 break-all text-gray-200">{c.wildcard && <span className="text-amber-500 text-[10px] mr-1" title="wildcard certificate">✱</span>}{c.host}</td>
                    <td className="px-2 py-1 text-slate-400">{c.issuer}</td>
                    <td className={`px-2 py-1 whitespace-nowrap ${c.expired ? 'text-red-300' : 'text-slate-400'}`}>{c.notAfter ? c.notAfter.slice(0, 10) : '—'}</td>
                    <td className="px-2 py-1">{badge(c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <div className="px-2 py-4 text-center text-slate-600 text-xs">No hosts match.</div>}
          </div>
        </>
      )}

      {!certs && !error && (
        <p className="text-xs text-slate-500">
          Enumerate a domain's subdomains from public Certificate Transparency logs via crt.sh — passive recon that never
          contacts the target. On the hosted site the Worker relays crt.sh, so no proxy is needed; elsewhere set one above
          because crt.sh doesn't allow cross-origin browser requests. Use only on domains you own or are authorized to assess.
        </p>
      )}
    </div>
  );
}
