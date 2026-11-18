import React, { useState, useMemo } from 'react';
import { Search, Download, Globe, RefreshCw, FileText } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import { groupCertificates, duplicateGroups, recentlyLogged, expiryOverview, expiryBucket, parseExpectedIssuers, isUnexpectedIssuer, monitorReport, certificatesToCsv } from '../../utils/crtshMonitor.js';
import { crtShUrl, crtShRelayUrl, extractCerts, issuerSummary, certsToCsv, safeFilename } from '../../utils/crtsh.js';

/**
 * crt.sh Certificate Transparency finder / monitor. Queries crt.sh for all
 * certificates issued under a domain and lists hostnames, distinct certificates,
 * duplicates (same name set) and recent issuance, with an expiry overview and an
 * optional expected-issuer check. Passive: the target is never contacted.
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

const EXPIRY_ORDER = ['expired', '7d', '30d', '90d', 'later', 'unknown'];
const BUCKET_LABEL = { expired: 'expired', '7d': '≤7d', '30d': '≤30d', '90d': '≤90d', later: 'later', unknown: 'n/a' };
const BUCKET_CLASS = {
  expired: 'border-red-900 text-red-300 bg-red-950/40',
  '7d': 'border-red-900 text-red-300 bg-red-950/30',
  '30d': 'border-amber-900 text-amber-300 bg-amber-950/30',
  '90d': 'border-yellow-900 text-yellow-300 bg-yellow-950/20',
  later: 'border-slate-800 text-slate-300 bg-slate-900',
  unknown: 'border-slate-800 text-slate-500 bg-slate-900',
};
const VIEWS = [['hosts', 'Hosts'], ['certs', 'Certificates'], ['dups', 'Duplicates'], ['recent', 'Recent']];
const btn = 'inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300';
const th = 'px-2 py-1';

export default function CrtShFinderWorkbench({ onLogMessage }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [certs, setCerts] = useState(null);
  const [certList, setCertList] = useState([]);
  const [issuers, setIssuers] = useState([]);
  const [rowCount, setRowCount] = useState(0);
  const [route, setRoute] = useState('');
  const [filter, setFilter] = useState('');
  const [excludeExpired, setExcludeExpired] = useState(false);
  const [dedupe, setDedupe] = useState(true);
  const [view, setView] = useState('hosts');
  const [bucket, setBucket] = useState('');
  const [issuerSel, setIssuerSel] = useState('');
  const [expectedText, setExpectedText] = useState('');
  const [recentDays, setRecentDays] = useState(30);

  const log = (m) => onLogMessage?.(m);
  const cleanDomain = () => domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*?\.+/, '');

  const run = async () => {
    const base = cleanDomain();
    if (!base) return;
    setBusy(true); setError(''); setCerts(null); setCertList([]); setBucket(''); setIssuerSel('');
    log(`crt.sh lookup for ${base}…`);
    try {
      const { resp, text, route: used } = await crtFetch(base, { excludeExpired, dedupe }, (n) => log(`crt.sh busy, retrying (${n}/2)…`));
      if (!resp.ok) throw new Error(`crt.sh returned HTTP ${resp.status}${RETRY_STATUS.has(resp.status) ? ' (overloaded; try again shortly)' : ''}`);
      let rows;
      try { rows = JSON.parse(text); }
      catch { throw new Error('crt.sh did not return JSON (often rate-limiting or a proxy issue). Try again shortly.'); }
      if (!Array.isArray(rows)) throw new Error('crt.sh returned an unexpected response.');
      const found = extractCerts(rows, base);
      const grouped = groupCertificates(rows, base);
      setCerts(found); setCertList(grouped); setIssuers(issuerSummary(rows)); setRowCount(rows.length); setRoute(used);
      log(`crt.sh: ${found.length} unique host(s), ${grouped.length} certificate(s) from ${rows.length} record(s) (${used})`);
    } catch (e) {
      setError(describeNetworkError(e));
    }
    setBusy(false);
  };

  const needle = filter.trim().toLowerCase();
  const expected = useMemo(() => parseExpectedIssuers(expectedText), [expectedText]);
  const hostOverview = useMemo(() => expiryOverview(certs || []), [certs]);
  const certOverview = useMemo(() => expiryOverview(certList), [certList]);
  const overview = view === 'hosts' ? hostOverview : certOverview;
  const dups = useMemo(() => duplicateGroups(certList), [certList]);
  const recent = useMemo(() => recentlyLogged(certList, recentDays), [certList, recentDays]);
  const oddCount = certList.filter((c) => isUnexpectedIssuer(c, expected)).length;

  const shown = certs?.filter((c) => (!needle || c.host.includes(needle) || c.issuer.toLowerCase().includes(needle))
    && (!bucket || expiryBucket(c.daysLeft) === bucket) && (!issuerSel || c.issuer === issuerSel)) || [];
  const certMatch = (c) => (!needle || c.names.some((n) => n.includes(needle)) || c.issuer.toLowerCase().includes(needle))
    && (!bucket || c.bucket === bucket) && (!issuerSel || c.issuer === issuerSel);
  const shownCerts = certList.filter(certMatch);
  const shownRecent = recent.filter(certMatch);
  const expiredCount = certs?.filter((c) => c.expired).length || 0;
  const fname = (ext) => safeFilename(cleanDomain(), ext);

  const exportTxt = () => download(shown.map((c) => c.host).join('\n'), 'text/plain', fname('txt').replace('-certs', '-subdomains'));
  const exportCsv = () => (view === 'hosts'
    ? download(certsToCsv(shown), 'text/csv', fname('csv'))
    : download(certificatesToCsv(view === 'recent' ? shownRecent : shownCerts), 'text/csv', fname('csv').replace('-certs', '-certificates')));
  const exportJson = () => download(JSON.stringify(view === 'hosts' ? shown : (view === 'recent' ? shownRecent : shownCerts), null, 2), 'application/json', fname('json'));
  const exportMd = () => download(monitorReport({ domain: cleanDomain(), certs: certList, hosts: (certs || []).map((c) => c.host), expected }), 'text/markdown', fname('md').replace('-certs', '-ct-report'));

  const badge = (c) => {
    if (c.expired) return <span className="text-[10px] px-1 rounded bg-red-950 border border-red-900 text-red-300">expired</span>;
    if (c.daysLeft != null && c.daysLeft <= 30) return <span className="text-[10px] px-1 rounded bg-amber-950 border border-amber-900 text-amber-300">expires in {c.daysLeft}d</span>;
    return null;
  };
  const oddBadge = (c) => (isUnexpectedIssuer(c, expected)
    ? <span className="text-[10px] px-1 rounded bg-fuchsia-950 border border-fuchsia-900 text-fuchsia-300" title="Issuer is not in your expected list">unexpected CA</span> : null);

  const certTable = (list, empty) => (
    <table className="w-full text-xs font-mono border-collapse">
      <thead className="sticky top-0 bg-slate-900"><tr className="text-left text-slate-400">
        <th className={th}>Names</th><th className={th}>Issuer</th><th className={th}>Valid</th><th className={th}>Logged</th><th className={th}></th>
      </tr></thead>
      <tbody>
        {list.map((c) => (
          <tr key={c.key} className="border-b border-slate-900 last:border-0 align-top">
            <td className="px-2 py-1 break-all text-gray-200">{c.names.join(', ')}</td>
            <td className="px-2 py-1 text-slate-400">{c.issuer} {oddBadge(c)}</td>
            <td className="px-2 py-1 whitespace-nowrap text-slate-400">{c.notBefore} → <span className={c.expired ? 'text-red-300' : ''}>{c.notAfter || '—'}</span></td>
            <td className="px-2 py-1 whitespace-nowrap text-slate-500">{c.loggedAt || '—'}</td>
            <td className="px-2 py-1">{badge(c)}</td>
          </tr>
        ))}
      </tbody>
      {list.length === 0 && <caption className="caption-bottom px-2 py-4 text-slate-600 text-xs">{empty}</caption>}
    </table>
  );

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200 space-y-2">
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-2 items-center">
        <input
          aria-label="Domain"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
          placeholder="example.com"
          className="flex-1 min-w-[10rem] bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
        />
        <label className="flex items-center gap-1 text-[11px] text-slate-300"><input type="checkbox" checked={excludeExpired} onChange={(e) => setExcludeExpired(e.target.checked)} /> exclude expired</label>
        <label className="flex items-center gap-1 text-[11px] text-slate-300"><input type="checkbox" checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} /> dedupe</label>
        <button onClick={run} disabled={busy} className="px-2.5 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={12} className="animate-spin" /> : <Search size={12} />} {busy ? 'Querying…' : 'Look up'}
        </button>
      </div>

      {error && <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {certs && (
        <>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-gray-300">
              <Globe size={12} className="inline mr-1 text-cyan-400" />{certs.length} host(s) · {certList.length} cert(s) · {rowCount} record(s)
              {expiredCount > 0 && <span className="text-red-300"> · {expiredCount} expired host(s)</span>}
              <span className="text-slate-500"> · via {route === 'relay' ? 'site relay' : route}</span>
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <input aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter…" className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-[11px] font-mono w-28" />
              {view === 'hosts' && <button onClick={exportTxt} title="Download the shown hostnames" className={btn}><Download size={12} /> .txt</button>}
              <button onClick={exportCsv} title="Download the shown rows as CSV" className={btn}><Download size={12} /> .csv</button>
              <button onClick={exportJson} title="Download the shown rows as JSON" className={btn}><Download size={12} /> .json</button>
              <button onClick={exportMd} title="Markdown report: expiry, issuers, duplicates, all certificates" className={btn}><FileText size={12} /> report</button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Expiry overview">
            <span className="text-[10px] text-slate-500 mr-1">Expiry</span>
            {EXPIRY_ORDER.map((b) => (
              <button key={b} onClick={() => setBucket(bucket === b ? '' : b)} aria-pressed={bucket === b} title={`Show only ${BUCKET_LABEL[b]}`}
                className={`text-[10px] px-1.5 py-0.5 rounded border ${BUCKET_CLASS[b]} ${bucket === b ? 'ring-1 ring-cyan-500' : ''} ${overview[b] ? '' : 'opacity-40'}`}>
                {BUCKET_LABEL[b]} {overview[b]}
              </button>
            ))}
          </div>

          {issuers.length > 0 && (
            <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-slate-500 mr-1">Issuers</span>
              {issuers.slice(0, 8).map((s) => (
                <button key={s.issuer} onClick={() => setIssuerSel(issuerSel === s.issuer ? '' : s.issuer)} aria-pressed={issuerSel === s.issuer} title="Filter by this issuer"
                  className={`px-1.5 py-0.5 rounded border border-slate-800 bg-slate-900 hover:border-slate-600 ${issuerSel === s.issuer ? 'ring-1 ring-cyan-500' : ''}`}>
                  {s.issuer} <span className="text-slate-600">×{s.count}</span>
                </button>
              ))}
              {issuers.length > 8 && <span className="text-slate-600">+{issuers.length - 8} more</span>}
            </div>
          )}

          <details className="text-[11px]">
            <summary className="cursor-pointer text-slate-400">Expected issuers{expected.length > 0 && <span className="text-slate-500"> ({oddCount} cert(s) from other CAs)</span>}</summary>
            <div className="mt-1 flex flex-col gap-1">
              <input aria-label="Expected issuers" value={expectedText} onChange={(e) => setExpectedText(e.target.value)} placeholder="Let's Encrypt, Google Trust Services"
                className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] font-mono" />
              <span className="text-slate-500">Comma-separated CA names you actually use. Certificates from any other issuer are flagged as &quot;unexpected CA&quot; (possible mis-issuance or shadow IT).</span>
            </div>
          </details>

          <div className="flex gap-1 border-b border-slate-800" role="tablist">
            {VIEWS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`px-2 py-1 text-[11px] border-b-2 ${view === k ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                {label}{k === 'dups' ? ` (${dups.length})` : k === 'recent' ? ` (${recent.length})` : ''}
              </button>
            ))}
            {view === 'recent' && (
              <label className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">last
                <select aria-label="Recent window" value={recentDays} onChange={(e) => setRecentDays(Number(e.target.value))} className="bg-slate-900 border border-slate-800 rounded text-[10px]">
                  {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{d}d</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="border border-slate-800 rounded bg-slate-950 max-h-[55vh] overflow-auto">
            {view === 'hosts' && (
              <table className="w-full text-xs font-mono border-collapse">
                <thead className="sticky top-0 bg-slate-900"><tr className="text-left text-slate-400">
                  <th className={th}>Host</th><th className={th}>Issuer</th><th className={th}>Not after</th><th className={th}></th>
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
            )}
            {view === 'hosts' && shown.length === 0 && <div className="px-2 py-4 text-center text-slate-600 text-xs">No hosts match.</div>}
            {view === 'certs' && certTable(shownCerts, 'No certificates match.')}
            {view === 'recent' && certTable(shownRecent, `No certificates logged in the last ${recentDays} days.`)}
            {view === 'dups' && (
              <div className="divide-y divide-slate-900 text-xs font-mono">
                {dups.map((g) => (
                  <div key={g.names.join('|')} className="px-2 py-1.5">
                    <div className="text-gray-200 break-all">{g.names.join(', ')}</div>
                    <div className="text-[11px] text-slate-500">{g.count} certificates ({g.activeCount} unexpired) · {g.issuers.join(', ')} · logged {g.certs.map((c) => c.loggedAt || '?').join(', ')}</div>
                  </div>
                ))}
                {dups.length === 0 && <div className="px-2 py-4 text-center text-slate-600">No certificates share the same name set.</div>}
              </div>
            )}
          </div>
        </>
      )}

      {!certs && !error && (
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer">About this tool</summary>
          <p className="mt-1">
            Look up the certificates in public Certificate Transparency logs for a domain via crt.sh: hostnames, issuer, expiry,
            duplicates and recent issuance. It never contacts the target. On the hosted site the Worker relays crt.sh; elsewhere set a
            proxy above because crt.sh sends no CORS headers. Use only on domains you own or are authorized to assess.
          </p>
        </details>
      )}
    </div>
  );
}
