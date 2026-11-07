import React, { useState } from 'react';
import { Radar, Search, RefreshCw, KeyRound, Globe } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';

/**
 * OSINT API clients — thin in-app front-ends for Shodan, urlscan.io and
 * HackerTarget. They call each vendor's public API with YOUR OWN API key (kept
 * in localStorage, never sent anywhere but the vendor) through the configurable
 * proxy. This app has no dataset of its own; it just renders the vendor's reply.
 *
 * Use only against hosts/domains you own or are authorized to assess.
 */

const KEY_STORE = {
  shodan: 'skon.osint.shodanKey',
  urlscan: 'skon.osint.urlscanKey',
  hackertarget: 'skon.osint.htKey',
};
const getKey = (s) => { try { return localStorage.getItem(KEY_STORE[s]) || ''; } catch { return ''; } };
const setKey = (s, v) => { try { v ? localStorage.setItem(KEY_STORE[s], v) : localStorage.removeItem(KEY_STORE[s]); } catch { /* ignore */ } };

function ApiKeyField({ service, label, required }) {
  const [val, setVal] = useState(getKey(service));
  const [saved, setSaved] = useState(false);
  const save = () => { setKey(service, val.trim()); setSaved(true); setTimeout(() => setSaved(false), 1200); };
  return (
    <div className="flex items-center gap-2 mb-2">
      <KeyRound size={13} className="text-amber-400 shrink-0" />
      <input
        type="password"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={`${label} API key${required ? '' : ' (optional)'}`}
        className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono"
      />
      <button onClick={save} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">{saved ? 'Saved' : 'Save key'}</button>
    </div>
  );
}

function Pre({ children }) {
  return <pre className="border border-slate-800 rounded bg-slate-950 p-2 text-[11px] text-gray-300 overflow-auto max-h-[50vh] whitespace-pre-wrap break-all">{children}</pre>;
}

function ShodanTab({ log }) {
  const [ip, setIp] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');

  const run = async () => {
    const key = getKey('shodan');
    if (!key) { setErr('Enter and save your Shodan API key first.'); return; }
    if (!ip.trim()) return;
    setBusy(true); setErr(''); setOut(null);
    log(`Shodan host lookup ${ip.trim()}${isProxyEnabled() ? ' (via proxy)' : ''}`);
    try {
      const resp = await proxiedFetch(`https://api.shodan.io/shodan/host/${encodeURIComponent(ip.trim())}?key=${encodeURIComponent(key)}`);
      const data = await resp.json();
      if (data.error) { setErr(data.error); setBusy(false); return; }
      setOut(data);
    } catch (e) { setErr(describeNetworkError(e)); }
    setBusy(false);
  };

  return (
    <div>
      <ApiKeyField service="shodan" label="Shodan" required />
      <div className="flex gap-2 mb-2">
        <input value={ip} onChange={(e) => setIp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="IP address (e.g. 8.8.8.8)" className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Lookup</button>
      </div>
      {err && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{err}</div>}
      {out && (
        <>
          <div className="mb-2 text-xs text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
            <span>Org: <span className="text-cyan-300">{out.org || '—'}</span></span>
            <span>ISP: <span className="text-cyan-300">{out.isp || '—'}</span></span>
            <span>Country: <span className="text-cyan-300">{out.country_name || '—'}</span></span>
            <span>Ports: <span className="text-amber-300">{(out.ports || []).join(', ') || '—'}</span></span>
            {out.hostnames?.length ? <span>Hostnames: <span className="text-cyan-300">{out.hostnames.join(', ')}</span></span> : null}
          </div>
          <Pre>{JSON.stringify(out, null, 2)}</Pre>
        </>
      )}
    </div>
  );
}

function UrlscanTab({ log }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const [err, setErr] = useState('');

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true); setErr(''); setOut(null);
    log(`urlscan search: ${query.trim()}`);
    try {
      const resp = await proxiedFetch(`https://urlscan.io/api/v1/search/?q=${encodeURIComponent(query.trim())}`);
      const data = await resp.json();
      setOut(data);
    } catch (e) { setErr(describeNetworkError(e)); }
    setBusy(false);
  };

  return (
    <div>
      <ApiKeyField service="urlscan" label="urlscan.io" />
      <p className="text-[10px] text-slate-500 mb-2">Public search needs no key. A key is only required to submit scans (not done here). Query syntax e.g. <code>domain:example.com</code> or <code>page.url:"login"</code>.</p>
      <div className="flex gap-2 mb-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder='domain:example.com' className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Search</button>
      </div>
      {err && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{err}</div>}
      {out?.results && (
        <>
          <div className="mb-1 text-xs text-gray-400">{out.total ?? out.results.length} result(s)</div>
          <div className="border border-slate-800 rounded bg-slate-950 max-h-[45vh] overflow-auto text-[11px] font-mono">
            {out.results.slice(0, 100).map((r, i) => (
              <div key={i} className="px-2 py-1 border-b border-slate-900 last:border-0">
                <a href={r.result} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 break-all">{r.page?.url || r.task?.url}</a>
                <div className="text-slate-500">{r.page?.ip || '—'} · {r.page?.server || '—'} · {r.task?.time?.slice(0, 10)}</div>
              </div>
            ))}
          </div>
        </>
      )}
      {out && !out.results && <Pre>{JSON.stringify(out, null, 2)}</Pre>}
    </div>
  );
}

const HT_ENDPOINTS = [
  { id: 'dnslookup', label: 'DNS lookup' },
  { id: 'reverseiplookup', label: 'Reverse IP' },
  { id: 'hostsearch', label: 'Host search' },
  { id: 'aslookup', label: 'AS lookup' },
  { id: 'httpheaders', label: 'HTTP headers' },
  { id: 'pagelinks', label: 'Page links' },
];

function HackerTargetTab({ log }) {
  const [endpoint, setEndpoint] = useState('dnslookup');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState('');
  const [err, setErr] = useState('');

  const run = async () => {
    if (!target.trim()) return;
    setBusy(true); setErr(''); setOut('');
    const key = getKey('hackertarget');
    const q = `https://api.hackertarget.com/${endpoint}/?q=${encodeURIComponent(target.trim())}${key ? `&apikey=${encodeURIComponent(key)}` : ''}`;
    log(`HackerTarget ${endpoint}: ${target.trim()}`);
    try {
      const resp = await proxiedFetch(q);
      setOut(await resp.text());
    } catch (e) { setErr(describeNetworkError(e)); }
    setBusy(false);
  };

  return (
    <div>
      <ApiKeyField service="hackertarget" label="HackerTarget" />
      <p className="text-[10px] text-slate-500 mb-2">Free tier works without a key (rate-limited by IP); a key raises limits.</p>
      <div className="flex flex-wrap gap-2 mb-2">
        <select value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm">
          {HT_ENDPOINTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        <input value={target} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="domain or IP" className="flex-1 min-w-[10rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Run</button>
      </div>
      {err && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{err}</div>}
      {out && <Pre>{out}</Pre>}
    </div>
  );
}

const TABS = [
  { id: 'shodan', label: 'Shodan', comp: ShodanTab },
  { id: 'urlscan', label: 'urlscan.io', comp: UrlscanTab },
  { id: 'hackertarget', label: 'HackerTarget', comp: HackerTargetTab },
];

export default function OsintClientsWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('shodan');
  const log = (m) => onLogMessage?.(m);
  const Active = TABS.find((t) => t.id === tab).comp;
  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="mb-3 p-2 border border-slate-800 rounded bg-slate-900/40 text-[11px] text-slate-400 flex items-start gap-1.5">
        <Radar size={13} className="text-cyan-400 shrink-0 mt-0.5" />
        <span>These call each vendor's API with your own key (saved locally in this browser) via the proxy. Most vendor APIs block cross-origin browser calls, so a proxy is usually required. Assess only what you're authorized to.</span>
      </div>
      <ProxyConfig onLogMessage={log} />
      <div className="flex rounded overflow-hidden border border-slate-800 text-xs mb-3 w-fit">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === t.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
            <Globe size={12} /> {t.label}
          </button>
        ))}
      </div>
      <Active log={log} />
    </div>
  );
}
