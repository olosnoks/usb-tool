import React, { useEffect, useState } from 'react';
import { proxiedFetch, describeNetworkError } from '../../utils/netClient';
import { ApiKeyField, getKey } from './osint/apiKeys';
import {
  MAX_EMAILS, maskEmail, parseEmailInput, parseXonCatalog, parseXonCheck, xonRows,
  parseHibpAccount, parseHibpCatalog, filterCatalog, statusMessage, sortCatalogNewest, CATALOG_PAGE, hibpRelayAvailable,
} from '../../utils/breachCheck';

export const BREACH_NOTE = 'This tool only reports which breaches an email address appears in, never the leaked records. Names, phone numbers, street addresses and usernames are not supported: no reputable breach-notification service accepts them.';

const Pill = ({ children, tone = 'slate' }) => (
  <span className={`px-1.5 py-0.5 rounded text-[10px] border ${tone === 'green' ? 'border-emerald-800 text-emerald-300' : tone === 'amber' ? 'border-amber-800 text-amber-300' : 'border-slate-700 text-slate-300'}`}>{children}</span>
);

function BreachTable({ rows }) {
  return (
    <table className="w-full table-auto border-collapse border border-slate-700 text-xs mt-1">
      <thead className="bg-slate-800 text-slate-100">
        <tr>{['Breach', 'Domain', 'Date', 'Data exposed', 'Verified'].map((h) => <th key={h} className="p-1 border border-slate-700 text-left">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((b, i) => (
          <tr key={`${b.name}-${i}`} className={i % 2 ? 'bg-slate-900' : ''}>
            <td className="p-1 border border-slate-800 font-semibold text-gray-200">{b.name}</td>
            <td className="p-1 border border-slate-800 text-gray-400">{b.domain || '—'}</td>
            <td className="p-1 border border-slate-800 text-gray-400">{b.date || '—'}</td>
            <td className="p-1 border border-slate-800 text-gray-300">{b.dataClasses.length ? b.dataClasses.join(', ') : '—'}</td>
            <td className="p-1 border border-slate-800">{b.verified === null ? '—' : b.verified ? <Pill tone="green">verified</Pill> : <Pill tone="amber">unverified</Pill>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function EmailTab({ onLogMessage }) {
  const [input, setInput] = useState('');
  const [useHibp, setUseHibp] = useState(false);
  const [results, setResults] = useState([]);
  const [checking, setChecking] = useState(false);
  const [msg, setMsg] = useState('');
  const [relayOk, setRelayOk] = useState(null); // null = still probing
  const log = (m) => onLogMessage?.(m);

  useEffect(() => {
    let alive = true;
    hibpRelayAvailable().then((ok) => { if (alive) { setRelayOk(ok); if (!ok) setUseHibp(false); } });
    return () => { alive = false; };
  }, []);

  const run = async () => {
    const { valid, invalid, tooMany, total } = parseEmailInput(input);
    if (valid.length === 0) { setMsg(invalid.length ? `No valid addresses. Invalid: ${invalid.length}.` : 'Enter at least one email address.'); return; }
    const hibpKey = getKey('hibp');
    if (useHibp && !hibpKey) { setMsg('Save your Have I Been Pwned API key first, or untick the HIBP source.'); return; }
    setMsg([
      invalid.length ? `Skipped ${invalid.length} invalid address${invalid.length > 1 ? 'es' : ''}.` : '',
      tooMany ? `Only the first ${MAX_EMAILS} of ${total} addresses are checked.` : '',
    ].filter(Boolean).join(' '));
    setChecking(true);
    setResults([]);
    const out = [];
    let catalog = {};
    try {
      const r = await proxiedFetch('https://api.xposedornot.com/v1/breaches');
      if (r.ok) catalog = parseXonCatalog(await r.json());
    } catch { /* details are optional */ }
    for (const email of valid) {
      const row = { email, sources: [] };
      try {
        const r = await proxiedFetch(`https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`);
        if (r.status === 404) row.sources.push({ name: 'XposedOrNot', rows: [] });
        else if (!r.ok) row.sources.push({ name: 'XposedOrNot', error: statusMessage('XposedOrNot', r.status) });
        else row.sources.push({ name: 'XposedOrNot', rows: xonRows(parseXonCheck(await r.json()), catalog) });
      } catch (e) { row.sources.push({ name: 'XposedOrNot', error: describeNetworkError(e) }); }
      if (useHibp) {
        try {
          const r = await fetch(`/api/hibp/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`, { headers: { 'hibp-api-key': hibpKey } });
          if (r.status === 404) row.sources.push({ name: 'Have I Been Pwned', rows: [] });
          else if (!r.ok) row.sources.push({ name: 'Have I Been Pwned', error: statusMessage('Have I Been Pwned', r.status) });
          else row.sources.push({ name: 'Have I Been Pwned', rows: parseHibpAccount(await r.json()) });
        } catch { row.sources.push({ name: 'Have I Been Pwned', error: 'Relay unreachable (the /api/hibp relay needs the deployed site or the dev server).' }); }
        await sleep(1600); // HIBP rate-limits per key
      }
      out.push(row);
      setResults([...out]);
      log(`${maskEmail(email)}: ${row.sources.map((s) => `${s.name} ${s.error ? 'error' : `${s.rows.length} breach${s.rows.length !== 1 ? 'es' : ''}`}`).join(', ')}`);
      await sleep(250);
    }
    setChecking(false);
  };

  return (
    <div className="space-y-3">
      <textarea rows={5} placeholder={`One email address per line (max ${MAX_EMAILS})`} value={input} onChange={(e) => setInput(e.target.value)}
        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-gray-200 font-mono" />
      <label className={`flex items-center gap-2 text-xs ${relayOk === false ? 'text-gray-500' : 'text-gray-300'}`}>
        <input type="checkbox" checked={useHibp} disabled={relayOk === false} onChange={(e) => setUseHibp(e.target.checked)} /> Also query Have I Been Pwned (needs your own API key)
      </label>
      {relayOk === false && (
        <div className="text-[11px] text-amber-300">The /api/hibp relay is not reachable here (it needs the deployed site or the dev server), so the Have I Been Pwned source is turned off. XposedOrNot still works.</div>
      )}
      {useHibp && <ApiKeyField service="hibp" label="Have I Been Pwned" required hint="Stored only in this browser and sent to haveibeenpwned.com through this site's relay. Get one at haveibeenpwned.com/API/Key." />}
      <div className="flex items-center gap-3">
        <button onClick={run} disabled={checking} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-40">{checking ? 'Checking…' : 'Check Emails'}</button>
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>
      {results.map((r) => (
        <div key={r.email} className="border border-slate-800 rounded p-2">
          <div className="text-sm font-mono text-gray-200 mb-1">{maskEmail(r.email)}</div>
          {r.sources.map((s) => (
            <div key={s.name} className="mb-2">
              <div className="text-xs text-gray-400">{s.name}</div>
              {s.error ? <div className="text-xs text-yellow-400">Error: {s.error}</div>
                : s.rows.length === 0 ? <div className="text-xs text-green-400">No known breaches</div>
                : (<><div className="text-xs text-red-400">{s.rows.length} known breach{s.rows.length !== 1 ? 'es' : ''}</div><BreachTable rows={s.rows} /></>)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function CatalogTab({ onLogMessage }) {
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(CATALOG_PAGE);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const r = await proxiedFetch('https://haveibeenpwned.com/api/v3/breaches');
      if (!r.ok) throw new Error(statusMessage('Have I Been Pwned', r.status));
      const l = sortCatalogNewest(parseHibpCatalog(await r.json()));
      setList(l);
      setLimit(CATALOG_PAGE);
      onLogMessage?.(`Breach catalog loaded: ${l.length} breaches`);
    } catch (e) { setError(describeNetworkError(e)); }
    setLoading(false);
  };

  const hits = list ? filterCatalog(list, q) : [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input value={q} onChange={(e) => { setQ(e.target.value); setLimit(CATALOG_PAGE); }} placeholder="Search by breach name or domain"
          className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-sm text-gray-200" />
        <button onClick={load} disabled={loading} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-40">
          {loading ? 'Loading…' : list ? 'Reload' : 'Load catalog'}
        </button>
      </div>
      {error && <div className="text-xs text-yellow-400">Error: {error}</div>}
      {list && <div className="text-xs text-gray-400">{hits.length} of {list.length} breaches, newest first{hits.length > limit ? ` (showing ${limit})` : ''}</div>}
      {hits.slice(0, limit).map((b) => (
        <div key={b.name} className="border border-slate-800 rounded p-2 text-xs">
          <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-gray-200">{b.title}</span><span className="text-gray-500">{b.domain}</span><span className="text-gray-500">{b.date}</span>
            {b.records != null && <Pill>{b.records.toLocaleString()} accounts</Pill>}{b.verified ? <Pill tone="green">verified</Pill> : <Pill tone="amber">unverified</Pill>}{b.sensitive && <Pill tone="amber">sensitive</Pill>}</div>
          <div className="text-gray-300 mt-1">Exposed: {b.dataClasses.join(', ') || '—'}</div>
          <div className="text-gray-500 mt-1">{b.description}</div>
        </div>
      ))}
      {hits.length > limit && (
        <button onClick={() => setLimit((n) => n + CATALOG_PAGE)} className="px-3 py-1 text-xs bg-slate-800 rounded hover:bg-slate-700 text-cyan-300">
          Show more ({Math.min(CATALOG_PAGE, hits.length - limit)} of {hits.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
