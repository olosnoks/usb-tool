import React, { useMemo, useState } from 'react';
import {
  Search, RefreshCw, Plus, X, Copy, Download, ExternalLink, ChevronDown, ChevronRight,
  Server, Globe, Database, Wrench, Minus, Info, ListFilter, Hash, Clock, Check,
} from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../../utils/netClient';
import { getKey, ApiKeyField } from './apiKeys';
import {
  SHODAN_FILTERS, SHODAN_FILTER_GROUPS, SHODAN_FACETS, SHODAN_PRESETS, SHODAN_ENDPOINTS,
  filterInfo, buildQuery, parseQuery, buildFacets, buildShodanUrl, redactKey,
  parseShodanResponse, summarizeMatch, matchesToCsv, shodanWebUrl,
} from '../../../utils/shodan';

/**
 * Shodan client — granular front-end for the Shodan REST API.
 *
 * Search / Count use a query builder (one row per filter, negatable, with the
 * raw query string editable alongside), facets, paging and minify. Host, DNS,
 * Exploits and the account/tool endpoints each get their own form. Every reply
 * is parsed defensively: HTML error pages (404s, proxy failures) are reported
 * with the HTTP status instead of crashing on JSON.parse.
 */

const DRAFT_KEY = 'skon.osint.shodanQueryDraft';
const loadDraft = () => { try { return localStorage.getItem(DRAFT_KEY) || ''; } catch { return ''; } };
const saveDraft = (q) => { try { q ? localStorage.setItem(DRAFT_KEY, q) : localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

const PAGE_SIZE = 100;

/* ---------------------------------------------------------------- shared --- */

const btn = 'px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap';
const btnGhost = 'px-2 py-1.5 bg-slate-800 border border-slate-700 text-gray-300 rounded text-xs hover:bg-slate-700 disabled:opacity-50 inline-flex items-center gap-1 whitespace-nowrap';
const inp = 'bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono text-gray-200 min-w-0';
const sel = 'bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs text-gray-200';
const lbl = 'text-[11px] text-slate-400 inline-flex items-center gap-1';

function Pre({ children }) {
  return <pre className="border border-slate-800 rounded bg-slate-950 p-2 text-[11px] text-gray-300 overflow-auto max-h-[50vh] whitespace-pre-wrap break-all">{children}</pre>;
}

function downloadText(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function CopyBtn({ text, label = 'Copy', title }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(typeof text === 'function' ? text() : text); setOk(true); setTimeout(() => setOk(false), 1200); } catch { /* ignore */ }
  };
  return <button onClick={copy} title={title} className={btnGhost}>{ok ? <Check size={12} /> : <Copy size={12} />} {ok ? 'Copied' : label}</button>;
}

function RawJson({ data, name = 'shodan.json', defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (data === null || data === undefined) return null;
  const text = () => JSON.stringify(data, null, 2);
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-1">
        <button onClick={() => setOpen((o) => !o)} className="text-[11px] text-slate-400 hover:text-gray-200 inline-flex items-center gap-1">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Raw JSON
        </button>
        <CopyBtn text={text} label="Copy JSON" />
        <button onClick={() => downloadText(name, text(), 'application/json')} className={btnGhost}><Download size={12} /> JSON</button>
      </div>
      {open && <Pre>{text()}</Pre>}
    </div>
  );
}

function ErrorBox({ err }) {
  if (!err) return null;
  return <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 whitespace-pre-wrap break-words">{err}</div>;
}

function RequestInfo({ last }) {
  if (!last) return null;
  const ok = last.status >= 200 && last.status < 300;
  return (
    <div className="mb-2 text-[10px] text-slate-500 font-mono flex flex-wrap items-center gap-x-3 gap-y-1 break-all">
      <span className={ok ? 'text-emerald-400' : 'text-red-400'}>HTTP {last.status || 'ERR'}</span>
      <span className="inline-flex items-center gap-1"><Clock size={10} /> {last.ms} ms</span>
      <span>{SHODAN_ENDPOINTS[last.endpoint]?.method} {last.url}</span>
    </div>
  );
}

// One hook per mode: performs a request against an endpoint, keeping busy/error
// state and the last request's metadata for the RequestInfo strip.
function useShodanRequest(log) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [last, setLast] = useState(null);

  const run = async (endpointId, params = {}) => {
    const key = getKey('shodan');
    if (!key) { setErr('Enter and save your Shodan API key first.'); return null; }
    let url;
    try { url = buildShodanUrl(endpointId, params, key); } catch (e) { setErr(e.message); return null; }
    const safeUrl = redactKey(url);
    setBusy(true); setErr('');
    const t0 = performance.now();
    log(`Shodan ${SHODAN_ENDPOINTS[endpointId].label}: ${safeUrl}${isProxyEnabled() ? ' (via proxy)' : ''}`);
    try {
      const resp = await proxiedFetch(url);
      const text = await resp.text();
      const r = parseShodanResponse(resp.status, text);
      setLast({ url: safeUrl, status: resp.status, ms: Math.round(performance.now() - t0), endpoint: endpointId });
      if (!r.ok) { setErr(r.error); log(`Shodan error: ${r.error}`); return null; }
      return r.data;
    } catch (e) {
      setLast({ url: safeUrl, status: 0, ms: Math.round(performance.now() - t0), endpoint: endpointId });
      setErr(describeNetworkError(e));
      return null;
    } finally { setBusy(false); }
  };
  return { busy, err, setErr, last, run };
}

function Chip({ children, onRemove, title }) {
  return (
    <span title={title} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono text-gray-200">
      {children}
      {onRemove && <button onClick={onRemove} className="text-slate-400 hover:text-red-300"><X size={10} /></button>}
    </span>
  );
}

/* --------------------------------------------------------- query builder --- */

function FilterRow({ token, onChange, onRemove }) {
  const info = token.type === 'filter' ? filterInfo(token.key) : null;
  const isCustom = token.type === 'filter' && !info;
  const selectValue = token.type === 'term' ? '__term' : (info ? token.key : '__custom');
  const changeKey = (v) => {
    if (v === '__term') onChange({ type: 'term', value: token.value || '', negate: token.negate });
    else if (v === '__custom') onChange({ type: 'filter', key: token.key && !info ? token.key : '', value: token.value || '', negate: token.negate });
    else onChange({ type: 'filter', key: v, value: token.type === 'filter' ? token.value || '' : '', negate: token.negate });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        onClick={() => onChange({ ...token, negate: !token.negate })}
        title={token.negate ? 'Excluding (click to include)' : 'Including (click to exclude)'}
        className={`w-7 h-7 rounded border text-xs font-bold ${token.negate ? 'bg-red-950/50 border-red-800 text-red-300' : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-gray-200'}`}
      >{token.negate ? <Minus size={12} className="mx-auto" /> : <Plus size={12} className="mx-auto" />}</button>
      <select value={selectValue} onChange={(e) => changeKey(e.target.value)} className={`${sel} w-44`} title={info?.hint || ''}>
        <option value="__term">free text</option>
        <option value="__custom">custom filter…</option>
        {SHODAN_FILTER_GROUPS.map((g) => (
          <optgroup key={g} label={g}>
            {SHODAN_FILTERS.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label} — {f.key}</option>)}
          </optgroup>
        ))}
      </select>
      {isCustom && (
        <input value={token.key} onChange={(e) => onChange({ ...token, key: e.target.value.trim() })} placeholder="filter.name" className={`${inp} text-xs w-36`} />
      )}
      {info?.type === 'bool' ? (
        <select value={token.value || 'true'} onChange={(e) => onChange({ ...token, value: e.target.value })} className={`${sel} w-24`}>
          <option value="true">true</option><option value="false">false</option>
        </select>
      ) : (
        <input
          value={token.value}
          onChange={(e) => onChange({ ...token, value: e.target.value })}
          placeholder={info?.example || (token.type === 'term' ? 'banner text' : 'value')}
          type={info?.type === 'number' ? 'text' : 'text'}
          inputMode={info?.type === 'number' ? 'numeric' : undefined}
          className={`${inp} text-xs flex-1 min-w-[8rem]`}
        />
      )}
      <button onClick={onRemove} title="Remove" className="text-slate-500 hover:text-red-300 p-1"><X size={13} /></button>
      {info?.hint && <span className="basis-full text-[10px] text-slate-500 pl-9 -mt-0.5">{info.hint}{info.type === 'date' ? '' : ' · comma-separate values for OR (port:80,443)'}</span>}
    </div>
  );
}

function QueryBuilder({ tokens, raw, onTokens, onRaw }) {
  const update = (i, t) => { const next = tokens.map((x, j) => (j === i ? t : x)); onTokens(next); };
  const remove = (i) => onTokens(tokens.filter((_, j) => j !== i));
  const add = (key) => onTokens([...tokens, key ? { type: 'filter', key, value: '', negate: false } : { type: 'term', value: '', negate: false }]);
  return (
    <div className="mb-2 p-2 border border-slate-800 rounded bg-slate-900/40">
      <div className="flex items-center justify-between mb-1.5">
        <span className={lbl}><ListFilter size={12} /> Query builder</span>
        <div className="flex items-center gap-1.5">
          <select defaultValue="" onChange={(e) => { if (e.target.value) { add(e.target.value === '__term' ? '' : e.target.value); e.target.value = ''; } }} className={sel} title="Add a filter row">
            <option value="">+ add filter…</option>
            <option value="__term">free text</option>
            {SHODAN_FILTER_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {SHODAN_FILTERS.filter((f) => f.group === g).map((f) => <option key={f.key} value={f.key}>{f.label} — {f.key}</option>)}
              </optgroup>
            ))}
          </select>
          <select defaultValue="" onChange={(e) => { if (e.target.value) { onRaw(e.target.value); e.target.value = ''; } }} className={sel} title="Load an example query">
            <option value="">presets…</option>
            {SHODAN_PRESETS.map((p) => <option key={p.label} value={p.query}>{p.label}</option>)}
          </select>
          {tokens.length > 0 && <button onClick={() => onTokens([])} className={btnGhost} title="Clear all rows"><X size={12} /> clear</button>}
        </div>
      </div>
      <div className="space-y-1.5 mb-2">
        {tokens.length === 0 && <div className="text-[11px] text-slate-500">No filters yet — add one above, pick a preset, or type the query directly below.</div>}
        {tokens.map((t, i) => <FilterRow key={i} token={t} onChange={(nt) => update(i, nt)} onRemove={() => remove(i)} />)}
      </div>
      <div className="flex items-start gap-2">
        <span className={`${lbl} pt-1.5 whitespace-nowrap`}><Hash size={12} /> Query</span>
        <textarea
          value={raw}
          onChange={(e) => onRaw(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder='port:14000 country:US -tag:honeypot http.title:"Dashboard"'
          className={`${inp} flex-1 text-xs resize-y`}
        />
      </div>
      <p className="text-[10px] text-slate-500 mt-1">Rows and the raw query stay in sync. Values with spaces are quoted automatically; <code>-</code> excludes; <code>a,b</code> means OR.</p>
    </div>
  );
}

function FacetPicker({ facets, onChange }) {
  const [key, setKey] = useState('country');
  const [count, setCount] = useState(10);
  const add = () => { if (!key || facets.some((f) => f.key === key)) return; onChange([...facets, { key, count: Number(count) || 10 }]); };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className={lbl} title="Aggregate the matching hosts by field">Facets</span>
      <select value={key} onChange={(e) => setKey(e.target.value)} className={sel}>
        {SHODAN_FACETS.map((f) => <option key={f} value={f}>{f}</option>)}
      </select>
      <input type="number" min={1} max={1000} value={count} onChange={(e) => setCount(e.target.value)} className={`${inp} text-xs w-16`} title="Top-N values" />
      <button onClick={add} className={btnGhost}><Plus size={12} /> facet</button>
      {facets.map((f, i) => <Chip key={f.key} onRemove={() => onChange(facets.filter((_, j) => j !== i))}>{f.key}:{f.count}</Chip>)}
    </div>
  );
}

function FacetsPanel({ facets, onPick }) {
  if (!facets || typeof facets !== 'object') return null;
  const keys = Object.keys(facets);
  if (!keys.length) return null;
  return (
    <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))' }}>
      {keys.map((k) => (
        <div key={k} className="border border-slate-800 rounded bg-slate-950 p-1.5">
          <div className="text-[11px] text-amber-300 font-semibold mb-1">{k}</div>
          <div className="max-h-40 overflow-auto text-[11px] font-mono">
            {(facets[k] || []).map((v, i) => (
              <button key={i} onClick={() => onPick(k, String(v.value))} title={`Add ${k}:${v.value} to the query`} className="w-full flex justify-between gap-2 px-1 py-0.5 hover:bg-slate-800 rounded text-left">
                <span className="truncate text-gray-300">{String(v.value)}</span>
                <span className="text-cyan-400 shrink-0">{v.count?.toLocaleString?.() ?? v.count}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchTable({ matches }) {
  const [open, setOpen] = useState(null);
  if (!matches?.length) return <div className="text-xs text-slate-500 mb-2">No matches on this page.</div>;
  return (
    <div className="border border-slate-800 rounded bg-slate-950 max-h-[55vh] overflow-auto mb-2">
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 bg-slate-900 text-slate-400 text-left">
          <tr>
            <th className="px-2 py-1">IP:port</th><th className="px-2 py-1">Org / ISP</th><th className="px-2 py-1">Hostnames</th>
            <th className="px-2 py-1">Product</th><th className="px-2 py-1">Location</th><th className="px-2 py-1">Title</th><th className="px-2 py-1">Vulns</th><th className="px-2 py-1">Seen</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => {
            const s = summarizeMatch(m);
            return (
              <React.Fragment key={i}>
                <tr onClick={() => setOpen(open === i ? null : i)} className="border-t border-slate-900 hover:bg-slate-900/60 cursor-pointer">
                  <td className="px-2 py-1 whitespace-nowrap text-cyan-300">{s.ip}<span className="text-amber-300">:{s.port}</span><span className="text-slate-500">/{s.transport}</span></td>
                  <td className="px-2 py-1 text-gray-300 max-w-[12rem] truncate" title={`${s.org} · ${s.isp} · ${s.asn}`}>{s.org || s.isp || '—'}</td>
                  <td className="px-2 py-1 text-gray-300 max-w-[12rem] truncate" title={s.hostnames}>{s.hostnames || '—'}</td>
                  <td className="px-2 py-1 text-gray-300 max-w-[10rem] truncate" title={`${s.product} ${s.version} ${s.os}`.trim()}>{[s.product, s.version].filter(Boolean).join(' ') || s.server || '—'}</td>
                  <td className="px-2 py-1 text-gray-300 whitespace-nowrap">{[s.city, s.country].filter(Boolean).join(', ') || '—'}</td>
                  <td className="px-2 py-1 text-gray-300 max-w-[12rem] truncate" title={s.title}>{s.title || '—'}</td>
                  <td className={`px-2 py-1 ${s.vulnCount ? 'text-red-300' : 'text-slate-600'}`} title={s.vulns}>{s.vulnCount || '—'}</td>
                  <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{s.timestamp.slice(0, 10)}</td>
                </tr>
                {open === i && (
                  <tr className="bg-slate-900/40"><td colSpan={8} className="p-2"><Pre>{JSON.stringify(m, null, 2)}</Pre></td></tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchMode({ log }) {
  const [raw, setRawState] = useState(loadDraft);
  const [tokens, setTokens] = useState(() => parseQuery(loadDraft()));
  const [facets, setFacets] = useState([]);
  const [page, setPage] = useState(1);
  const [minify, setMinify] = useState(false);
  const [result, setResult] = useState(null);     // search reply
  const [count, setCount] = useState(null);       // count reply
  const { busy, err, setErr, last, run } = useShodanRequest(log);

  const setRaw = (v) => { setRawState(v); setTokens(parseQuery(v)); saveDraft(v); };
  const setToks = (t) => { setTokens(t); const q = buildQuery(t); setRawState(q); saveDraft(q); };
  const query = useMemo(() => buildQuery(tokens), [tokens]);
  const facetSpec = buildFacets(facets);

  const doSearch = async (p = page) => {
    if (!query.trim()) { setErr('Build or type a query first.'); return; }
    setCount(null);
    const data = await run('search', { query, facets: facetSpec, page: p > 1 ? p : '', minify });
    if (data) { setResult(data); setPage(p); }
  };
  const doCount = async () => {
    if (!query.trim()) { setErr('Build or type a query first.'); return; }
    setResult(null);
    const data = await run('count', { query, facets: facetSpec });
    if (data) setCount(data);
  };
  const pickFacet = (k, v) => {
    const key = k === 'domain' ? 'hostname' : k;
    setToks([...tokens, { type: 'filter', key, value: v, negate: false }]);
  };

  const total = result?.total ?? count?.total;
  const pages = total ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;

  return (
    <div>
      <QueryBuilder tokens={tokens} raw={raw} onTokens={setToks} onRaw={setRaw} />
      <div className="mb-2 p-2 border border-slate-800 rounded bg-slate-900/40 space-y-1.5">
        <FacetPicker facets={facets} onChange={setFacets} />
        <div className="flex flex-wrap items-center gap-3">
          <label className={lbl}>Page <input type="number" min={1} value={page} onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))} className={`${inp} text-xs w-16 ml-1`} /></label>
          <label className={lbl}><input type="checkbox" checked={minify} onChange={(e) => setMinify(e.target.checked)} className="mr-1" /> minify (truncate large banner fields)</label>
          <span className="text-[10px] text-slate-500 inline-flex items-center gap-1"><Info size={10} /> {PAGE_SIZE} results per page · search with filters costs 1 query credit per page · count is free</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => doSearch(page)} disabled={busy} className={btn}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Search</button>
        <button onClick={doCount} disabled={busy} className={btnGhost}><Hash size={12} /> Count only (free)</button>
        <CopyBtn text={query} label="Copy query" />
        <a href={shodanWebUrl(query)} target="_blank" rel="noopener noreferrer" className={btnGhost}><ExternalLink size={12} /> open on shodan.io</a>
      </div>
      <RequestInfo last={last} />
      <ErrorBox err={err} />

      {count && (
        <div className="mb-2">
          <div className="text-sm text-gray-200 mb-2"><span className="text-cyan-300 font-semibold">{Number(count.total || 0).toLocaleString()}</span> matching services for <code className="text-amber-300">{query}</code></div>
          <FacetsPanel facets={count.facets} onPick={pickFacet} />
          <RawJson data={count} name="shodan-count.json" />
        </div>
      )}

      {result && (
        <div className="mb-2">
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-gray-300">
            <span><span className="text-cyan-300 font-semibold">{Number(total || 0).toLocaleString()}</span> total · page {page} / {pages} · showing {result.matches?.length || 0}</span>
            <button onClick={() => doSearch(page - 1)} disabled={busy || page <= 1} className={btnGhost}>‹ prev</button>
            <button onClick={() => doSearch(page + 1)} disabled={busy || page >= pages} className={btnGhost}>next ›</button>
            <button onClick={() => downloadText(`shodan-${Date.now()}.csv`, matchesToCsv(result.matches), 'text/csv')} className={btnGhost}><Download size={12} /> CSV</button>
            <CopyBtn text={() => (result.matches || []).map((m) => m.ip_str).filter(Boolean).join('\n')} label="Copy IPs" />
          </div>
          <FacetsPanel facets={result.facets} onPick={pickFacet} />
          <MatchTable matches={result.matches} />
          <RawJson data={result} name="shodan-search.json" />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- host mode --- */

function HostMode({ log }) {
  const [ip, setIp] = useState('');
  const [history, setHistory] = useState(false);
  const [minify, setMinify] = useState(false);
  const [out, setOut] = useState(null);
  const [honey, setHoney] = useState(null);
  const { busy, err, last, run } = useShodanRequest(log);

  const lookup = async () => { setHoney(null); const d = await run('host', { ip: ip.trim(), history, minify }); if (d) setOut(d); };
  const score = async () => { const d = await run('honeyscore', { ip: ip.trim() }); if (d !== null) setHoney(d); };
  const vulns = out?.vulns ? (Array.isArray(out.vulns) ? out.vulns : Object.keys(out.vulns)) : [];

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <input value={ip} onChange={(e) => setIp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="IP address (e.g. 8.8.8.8)" className={`${inp} flex-1 min-w-[12rem]`} />
        <label className={lbl}><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="mr-1" /> history (all banners ever seen)</label>
        <label className={lbl}><input type="checkbox" checked={minify} onChange={(e) => setMinify(e.target.checked)} className="mr-1" /> minify (ports + general info only)</label>
        <button onClick={lookup} disabled={busy || !ip.trim()} className={btn}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Lookup</button>
        <button onClick={score} disabled={busy || !ip.trim()} className={btnGhost} title="Probability that this host is a honeypot (0–1)">honeypot score</button>
      </div>
      <p className="text-[10px] text-slate-500 mb-2">Host lookups are free. To search by filter (e.g. <code>port:14000</code>) use the <b>Search</b> mode.</p>
      <RequestInfo last={last} />
      <ErrorBox err={err} />
      {honey !== null && <div className="mb-2 text-xs text-gray-300">Honeypot score: <span className={`font-semibold ${Number(honey) >= 0.5 ? 'text-red-300' : 'text-emerald-300'}`}>{String(honey)}</span> (0 = real, 1 = honeypot)</div>}
      {out && (
        <>
          <div className="mb-2 text-xs text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
            <span>IP: <span className="text-cyan-300">{out.ip_str || ip}</span></span>
            <span>Org: <span className="text-cyan-300">{out.org || '—'}</span></span>
            <span>ISP: <span className="text-cyan-300">{out.isp || '—'}</span></span>
            <span>ASN: <span className="text-cyan-300">{out.asn || '—'}</span></span>
            <span>Location: <span className="text-cyan-300">{[out.city, out.country_name].filter(Boolean).join(', ') || '—'}</span></span>
            <span>OS: <span className="text-cyan-300">{out.os || '—'}</span></span>
            <span>Ports: <span className="text-amber-300">{(out.ports || []).join(', ') || '—'}</span></span>
            {out.hostnames?.length ? <span>Hostnames: <span className="text-cyan-300">{out.hostnames.join(', ')}</span></span> : null}
            {out.domains?.length ? <span>Domains: <span className="text-cyan-300">{out.domains.join(', ')}</span></span> : null}
            {out.tags?.length ? <span>Tags: <span className="text-cyan-300">{out.tags.join(', ')}</span></span> : null}
            {vulns.length ? <span>Vulns: <span className="text-red-300">{vulns.join(', ')}</span></span> : null}
            <span>Last update: <span className="text-cyan-300">{out.last_update || '—'}</span></span>
          </div>
          {out.data?.length ? (
            <div className="border border-slate-800 rounded bg-slate-950 max-h-[45vh] overflow-auto mb-2">
              <table className="w-full text-[11px] font-mono">
                <thead className="sticky top-0 bg-slate-900 text-slate-400 text-left"><tr><th className="px-2 py-1">Port</th><th className="px-2 py-1">Module</th><th className="px-2 py-1">Product</th><th className="px-2 py-1">Title / banner</th><th className="px-2 py-1">Seen</th></tr></thead>
                <tbody>
                  {out.data.map((b, i) => <HostBannerRow key={i} b={b} />)}
                </tbody>
              </table>
            </div>
          ) : null}
          <RawJson data={out} name={`shodan-host-${out.ip_str || ip}.json`} />
        </>
      )}
    </div>
  );
}

function HostBannerRow({ b }) {
  const [open, setOpen] = useState(false);
  const banner = (b.data || '').split('\n')[0].slice(0, 100);
  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} className="border-t border-slate-900 hover:bg-slate-900/60 cursor-pointer">
        <td className="px-2 py-1 whitespace-nowrap text-amber-300">{b.port}<span className="text-slate-500">/{b.transport}</span></td>
        <td className="px-2 py-1 text-gray-300">{b._shodan?.module || '—'}</td>
        <td className="px-2 py-1 text-gray-300">{[b.product, b.version].filter(Boolean).join(' ') || '—'}</td>
        <td className="px-2 py-1 text-gray-300 max-w-[20rem] truncate" title={b.http?.title || banner}>{b.http?.title || banner || '—'}</td>
        <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{(b.timestamp || '').slice(0, 10)}</td>
      </tr>
      {open && <tr className="bg-slate-900/40"><td colSpan={5} className="p-2"><Pre>{JSON.stringify(b, null, 2)}</Pre></td></tr>}
    </>
  );
}

/* -------------------------------------------------------------- dns mode --- */

const DNS_TYPES = ['', 'A', 'AAAA', 'CNAME', 'NS', 'SOA', 'MX', 'TXT'];

function DnsMode({ log }) {
  const [sub, setSub] = useState('domain');
  const [domain, setDomain] = useState('');
  const [history, setHistory] = useState(false);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [names, setNames] = useState('');
  const [out, setOut] = useState(null);
  const { busy, err, last, run } = useShodanRequest(log);

  const splitList = (s) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const go = async () => {
    let d = null;
    if (sub === 'domain') d = await run('dnsDomain', { domain: domain.trim(), history, type, page: page > 1 ? page : '' });
    else if (sub === 'resolve') d = await run('dnsResolve', { hostnames: splitList(names) });
    else d = await run('dnsReverse', { ips: splitList(names) });
    if (d) setOut({ sub, d });
  };

  return (
    <div>
      <div className="flex rounded overflow-hidden border border-slate-800 text-xs mb-2 w-fit">
        {[['domain', 'Domain info (1 credit)'], ['resolve', 'Resolve hostnames'], ['reverse', 'Reverse DNS']].map(([id, label]) => (
          <button key={id} onClick={() => { setSub(id); setOut(null); }} className={`px-3 py-1.5 ${sub === id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>{label}</button>
        ))}
      </div>
      {sub === 'domain' ? (
        <div className="flex flex-wrap gap-2 mb-2 items-center">
          <input value={domain} onChange={(e) => setDomain(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} placeholder="example.com" className={`${inp} flex-1 min-w-[12rem]`} />
          <label className={lbl}>Type <select value={type} onChange={(e) => setType(e.target.value)} className={`${sel} ml-1`}>{DNS_TYPES.map((t) => <option key={t} value={t}>{t || 'any'}</option>)}</select></label>
          <label className={lbl}>Page <input type="number" min={1} value={page} onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))} className={`${inp} text-xs w-16 ml-1`} /></label>
          <label className={lbl}><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} className="mr-1" /> history</label>
          <button onClick={go} disabled={busy || !domain.trim()} className={btn}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Lookup</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-2 items-start">
          <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={2} placeholder={sub === 'resolve' ? 'hostnames, comma or newline separated' : 'IPs, comma or newline separated'} className={`${inp} flex-1 min-w-[12rem] text-xs`} />
          <button onClick={go} disabled={busy || !names.trim()} className={btn}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} {sub === 'resolve' ? 'Resolve' : 'Reverse'}</button>
        </div>
      )}
      <RequestInfo last={last} />
      <ErrorBox err={err} />
      {out?.sub === 'domain' && out.d && (
        <>
          <div className="mb-2 text-xs text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
            <span>Domain: <span className="text-cyan-300">{out.d.domain}</span></span>
            <span>Records: <span className="text-cyan-300">{out.d.data?.length ?? 0}</span>{out.d.more ? ' (more pages)' : ''}</span>
            {out.d.tags?.length ? <span>Tags: <span className="text-cyan-300">{out.d.tags.join(', ')}</span></span> : null}
            {out.d.subdomains?.length ? <span>Subdomains: <span className="text-cyan-300">{out.d.subdomains.length}</span></span> : null}
          </div>
          {out.d.subdomains?.length ? <div className="mb-2 flex flex-wrap gap-1">{out.d.subdomains.map((s) => <Chip key={s}>{s}.{out.d.domain}</Chip>)}</div> : null}
          <div className="border border-slate-800 rounded bg-slate-950 max-h-[45vh] overflow-auto mb-2">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-slate-900 text-slate-400 text-left"><tr><th className="px-2 py-1">Name</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Value</th><th className="px-2 py-1">Last seen</th></tr></thead>
              <tbody>
                {(out.d.data || []).map((r, i) => (
                  <tr key={i} className="border-t border-slate-900">
                    <td className="px-2 py-1 text-cyan-300">{r.subdomain ? `${r.subdomain}.` : ''}{out.d.domain}</td>
                    <td className="px-2 py-1 text-amber-300">{r.type}</td>
                    <td className="px-2 py-1 text-gray-300 break-all">{r.value}</td>
                    <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{(r.last_seen || '').slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RawJson data={out.d} name={`shodan-dns-${out.d.domain}.json`} />
        </>
      )}
      {out && out.sub !== 'domain' && out.d && (
        <>
          <div className="border border-slate-800 rounded bg-slate-950 max-h-[45vh] overflow-auto mb-2">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-slate-900 text-slate-400 text-left"><tr><th className="px-2 py-1">{out.sub === 'resolve' ? 'Hostname' : 'IP'}</th><th className="px-2 py-1">{out.sub === 'resolve' ? 'IP' : 'Hostnames'}</th></tr></thead>
              <tbody>
                {Object.entries(out.d).map(([k, v]) => (
                  <tr key={k} className="border-t border-slate-900"><td className="px-2 py-1 text-cyan-300">{k}</td><td className="px-2 py-1 text-gray-300 break-all">{Array.isArray(v) ? v.join(', ') : (v ?? '—')}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <RawJson data={out.d} name="shodan-dns.json" />
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------- exploits mode --- */

function ExploitsMode({ log }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [out, setOut] = useState(null);
  const { busy, err, last, run } = useShodanRequest(log);
  const go = async (p = page) => { const d = await run('exploits', { query: query.trim(), page: p > 1 ? p : '' }); if (d) { setOut(d); setPage(p); } };
  const pages = out?.total ? Math.max(1, Math.ceil(out.total / 100)) : 1;
  return (
    <div>
      <p className="text-[10px] text-slate-500 mb-2">Searches Exploit-DB / Metasploit / CVE entries indexed by Shodan. Filters: <code>cve:CVE-2021-44228</code>, <code>platform:linux</code>, <code>type:remote</code>, <code>port:445</code>, <code>author:…</code>, <code>source:…</code>. 1 query credit per page.</p>
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go(1)} placeholder='apache type:remote' className={`${inp} flex-1 min-w-[12rem]`} />
        <label className={lbl}>Page <input type="number" min={1} value={page} onChange={(e) => setPage(Math.max(1, Number(e.target.value) || 1))} className={`${inp} text-xs w-16 ml-1`} /></label>
        <button onClick={() => go(page)} disabled={busy || !query.trim()} className={btn}>{busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Search</button>
      </div>
      <RequestInfo last={last} />
      <ErrorBox err={err} />
      {out && (
        <>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-gray-300">
            <span><span className="text-cyan-300 font-semibold">{Number(out.total || 0).toLocaleString()}</span> total · page {page} / {pages}</span>
            <button onClick={() => go(page - 1)} disabled={busy || page <= 1} className={btnGhost}>‹ prev</button>
            <button onClick={() => go(page + 1)} disabled={busy || page >= pages} className={btnGhost}>next ›</button>
          </div>
          <div className="border border-slate-800 rounded bg-slate-950 max-h-[50vh] overflow-auto mb-2">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-slate-900 text-slate-400 text-left"><tr><th className="px-2 py-1">Source / ID</th><th className="px-2 py-1">Description</th><th className="px-2 py-1">CVE</th><th className="px-2 py-1">Platform</th><th className="px-2 py-1">Type</th><th className="px-2 py-1">Date</th></tr></thead>
              <tbody>
                {(out.matches || []).map((m, i) => (
                  <tr key={i} className="border-t border-slate-900">
                    <td className="px-2 py-1 text-cyan-300 whitespace-nowrap">{m.source}<span className="text-slate-500"> {m._id}</span></td>
                    <td className="px-2 py-1 text-gray-300">{m.description}</td>
                    <td className="px-2 py-1 text-red-300">{(Array.isArray(m.cve) ? m.cve : [m.cve]).filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-2 py-1 text-gray-300">{(Array.isArray(m.platform) ? m.platform : [m.platform]).filter(Boolean).join(', ') || '—'}</td>
                    <td className="px-2 py-1 text-gray-300">{m.type || '—'}</td>
                    <td className="px-2 py-1 text-slate-500 whitespace-nowrap">{(m.date || '').slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <RawJson data={out} name="shodan-exploits.json" />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------- account & tools mode --- */

const TOOL_ENDPOINTS = ['apiInfo', 'myip', 'httpHeaders', 'ports', 'protocols', 'searchFilters', 'searchFacets', 'queryTags'];

function AccountMode({ log }) {
  const [out, setOut] = useState(null);
  const [cq, setCq] = useState('');
  const { busy, err, last, run } = useShodanRequest(log);
  const call = async (id, params = {}) => { const d = await run(id, params); if (d !== null) setOut({ id, d }); };
  const info = out?.id === 'apiInfo' ? out.d : null;
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-2">
        {TOOL_ENDPOINTS.map((id) => (
          <button key={id} onClick={() => call(id)} disabled={busy} className={btnGhost} title={`${SHODAN_ENDPOINTS[id].method} ${SHODAN_ENDPOINTS[id].path} · ${SHODAN_ENDPOINTS[id].credits}`}>
            <Wrench size={12} /> {SHODAN_ENDPOINTS[id].label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <input value={cq} onChange={(e) => setCq(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && call('savedQueries', { query: cq.trim() })} placeholder="search community-shared queries (e.g. webcam)" className={`${inp} flex-1 min-w-[12rem]`} />
        <button onClick={() => call('savedQueries', { query: cq.trim() })} disabled={busy} className={btn}><Search size={14} /> Community queries</button>
      </div>
      <RequestInfo last={last} />
      <ErrorBox err={err} />
      {info && (
        <div className="mb-2 text-xs text-gray-300 flex flex-wrap gap-x-4 gap-y-1">
          <span>Plan: <span className="text-cyan-300">{info.plan || '—'}</span></span>
          <span>Query credits: <span className="text-amber-300">{info.query_credits ?? '—'}</span></span>
          <span>Scan credits: <span className="text-amber-300">{info.scan_credits ?? '—'}</span></span>
          <span>Monitored IPs: <span className="text-cyan-300">{info.monitored_ips ?? '—'}</span> / {info.usage_limits?.monitored_ips ?? '—'}</span>
          <span>HTTPS: <span className="text-cyan-300">{String(info.https ?? '—')}</span></span>
          <span>Telnet: <span className="text-cyan-300">{String(info.telnet ?? '—')}</span></span>
          <span>Unlocked: <span className="text-cyan-300">{String(info.unlocked ?? '—')}</span></span>
        </div>
      )}
      {out?.id === 'savedQueries' && out.d?.matches && (
        <div className="border border-slate-800 rounded bg-slate-950 max-h-[45vh] overflow-auto mb-2 text-[11px] font-mono">
          {out.d.matches.map((m, i) => (
            <div key={i} className="px-2 py-1 border-b border-slate-900 last:border-0">
              <div className="text-gray-200">{m.title} <span className="text-slate-500">· {m.votes} votes · {(m.tags || []).join(', ')}</span></div>
              <div className="text-amber-300 break-all">{m.query}</div>
              {m.description && <div className="text-slate-400">{m.description}</div>}
            </div>
          ))}
        </div>
      )}
      {out && (typeof out.d !== 'object' || out.d === null) && <Pre>{String(out.d)}</Pre>}
      {out && typeof out.d === 'object' && out.d !== null && <RawJson data={out.d} name={`shodan-${out.id}.json`} defaultOpen={!info && out.id !== 'savedQueries'} />}
    </div>
  );
}

/* ----------------------------------------------------------------- root --- */

const MODES = [
  { id: 'search', label: 'Search', icon: Search, comp: SearchMode, desc: 'Filter the Shodan index (port, country, product, http.title, …)' },
  { id: 'host', label: 'Host', icon: Server, comp: HostMode, desc: 'Everything Shodan knows about one IP' },
  { id: 'dns', label: 'DNS', icon: Globe, comp: DnsMode, desc: 'Domain records, resolve, reverse' },
  { id: 'exploits', label: 'Exploits', icon: Database, comp: ExploitsMode, desc: 'Exploit-DB / Metasploit / CVE search' },
  { id: 'account', label: 'Account & tools', icon: Wrench, comp: AccountMode, desc: 'Plan, credits, my IP, crawled ports, filter lists' },
];

export default function ShodanClient({ log }) {
  const [mode, setMode] = useState('search');
  const active = MODES.find((m) => m.id === mode);
  const Active = active.comp;
  return (
    <div>
      <ApiKeyField service="shodan" label="Shodan" required hint="Find your key at account.shodan.io → API. A free account includes a key (host lookups and plain-text search are free; filtered searches use query credits)." />
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit">
          {MODES.map((m) => (
            <button key={m.id} onClick={() => setMode(m.id)} title={m.desc} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${mode === m.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
              <m.icon size={12} /> {m.label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-slate-500">{active.desc}</span>
      </div>
      <Active log={log} />
    </div>
  );
}
