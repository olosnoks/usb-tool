import React, { useState, useMemo, useRef } from 'react';
import { proxiedFetch, isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import { sendHttp, hexDumpBytes, timeoutFromSeconds, downloadBlob, toCsv } from '../../utils/httpSend';
import { toCurl } from '../../utils/httpImport';
import {
  parseSpec, listOperations, getServers, buildRequest, exampleBody, fuzzCases, paramKey, isAbsoluteUrl, bodyContentType,
} from '../../utils/openapi';
import ProxyConfig from './common/ProxyConfig';

/**
 * OpenAPI/Swagger-driven API client, inspired by Hoppscotch + Swagger UI +
 * Schemathesis. Import a spec, browse endpoints, send requests through the
 * configurable proxy, and run schema-based negative fuzzing. All client-side.
 */
function parseHeaderText(text) {
  const h = {};
  (text || '').split('\n').forEach((line) => {
    const i = line.indexOf(':');
    if (i > 0) { const k = line.slice(0, i).trim(); if (k) h[k] = line.slice(i + 1).trim(); }
  });
  return h;
}

async function sendBuilt(built, { signal, timeoutMs } = {}) {
  const opts = { method: built.method, headers: parseHeaderText(built.headers), redirect: 'follow' };
  if (built.body && built.method !== 'GET' && built.method !== 'HEAD') opts.body = built.body;
  return sendHttp(built.url, opts, { signal, timeoutMs });
}

const isCancel = (e) => e?.name === 'AbortError' || e?.name === 'TimeoutError';
const errText = (e) => (isCancel(e) ? e.message : describeNetworkError(e));

function parseVars(text) {
  const env = {};
  (text || '').split('\n').forEach((line) => {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  });
  return env;
}

const METHOD_COLORS = { GET: 'text-green-400', POST: 'text-amber-400', PUT: 'text-blue-400', PATCH: 'text-purple-400', DELETE: 'text-red-400', HEAD: 'text-gray-400', OPTIONS: 'text-gray-400' };

export default function ApiClientWorkbench({ onLogMessage, hideProxyConfig = false }) {
  const [specText, setSpecText] = useState('');
  const [specUrl, setSpecUrl] = useState('');
  const [spec, setSpec] = useState(null);
  const [specError, setSpecError] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [servers, setServers] = useState([]);
  const [varsText, setVarsText] = useState('');
  const [auth, setAuth] = useState({ type: 'none', token: '', user: '', pass: '', headerName: 'X-API-Key' });
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [paramValues, setParamValues] = useState({});
  const [bodyText, setBodyText] = useState('');
  const [response, setResponse] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fuzzRows, setFuzzRows] = useState([]);
  const [fuzzing, setFuzzing] = useState(false);
  const [timeoutSec, setTimeoutSec] = useState('30');
  const abortRef = useRef(null);

  const log = (msg) => onLogMessage?.(msg);
  const ops = useMemo(() => (spec ? listOperations(spec) : []), [spec]);
  const env = useMemo(() => parseVars(varsText), [varsText]);

  const loadSpec = (text) => {
    try {
      const s = parseSpec(text);
      const srv = getServers(s, specUrl.trim());
      setSpec(s); setServers(srv); setBaseUrl(srv[0] || ''); setSpecError(''); setSelected(null);
      log(`Loaded spec: ${s.info?.title || 'untitled'} — ${listOperations(s).length} operation(s)`);
    } catch (e) { setSpecError(e.message); setSpec(null); log(`Spec error: ${e.message}`); }
  };

  const fetchSpec = async () => {
    if (!specUrl.trim()) return;
    try {
      const resp = await proxiedFetch(specUrl.trim());
      const text = await resp.text();
      setSpecText(text);
      loadSpec(text);
    } catch (e) { setSpecError(describeNetworkError(e)); }
  };

  const selectOp = (op) => {
    setSelected(op);
    setResponse(null);
    setFuzzRows([]);
    const pv = {};
    (op.parameters || []).forEach((p) => { if (p.example !== undefined) pv[paramKey(p)] = p.example; });
    setParamValues(pv);
    setBodyText(exampleBody(op, spec));
  };

  const timeoutMs = timeoutFromSeconds(timeoutSec);
  const baseOk = isAbsoluteUrl(baseUrl.replace(/\{\{(\w+)\}\}/g, (_, k) => env[k] ?? ''));

  const cancel = () => abortRef.current?.abort();

  const send = async () => {
    if (!selected) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true); setResponse(null);
    try {
      const built = buildRequest({ op: selected, spec, baseUrl, paramValues, bodyText, auth, env });
      log(`${built.method} ${built.url}${isProxyEnabled() ? ' (via proxy)' : ''}`);
      setResponse({ ...(await sendBuilt(built, { signal: ctrl.signal, timeoutMs })), built });
    } catch (e) { setResponse({ error: isCancel(e) || /Base URL/.test(e.message) ? e.message : describeNetworkError(e) }); }
    abortRef.current = null;
    setBusy(false);
  };

  const runFuzz = async () => {
    if (!selected) return;
    const cases = fuzzCases(selected, spec, paramValues, bodyText);
    if (!cases.length) { log('No fuzz cases for this endpoint'); return; }
    if (typeof window !== 'undefined' && !window.confirm(`This sends ${cases.length} request(s) to ${baseUrl}. Only fuzz APIs you own or are authorized to test. Continue?`)) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setFuzzing(true); setFuzzRows([]);
    log(`Fuzzing ${selected.method} ${selected.path}: ${cases.length} case(s)`);
    const rows = [];
    for (const c of cases) {
      if (ctrl.signal.aborted) break;
      try {
        const built = buildRequest({ op: selected, spec, baseUrl, paramValues: c.paramValues, bodyText: c.bodyText, auth, env });
        const res = await sendBuilt(built, { signal: ctrl.signal, timeoutMs });
        rows.push({ label: c.label, status: res.status, length: res.size, flag: res.status >= 500 });
      } catch (e) {
        if (ctrl.signal.aborted) break;
        rows.push({ label: c.label, status: 'err', length: 0, flag: true, note: errText(e) });
      }
      setFuzzRows([...rows]);
    }
    log(ctrl.signal.aborted ? 'Fuzz cancelled' : 'Fuzz complete');
    abortRef.current = null;
    setFuzzing(false);
  };

  const exportFuzz = () => {
    downloadBlob(toCsv(['case', 'status', 'length', 'flagged', 'note'], fuzzRows.map((r) => [r.label, r.status, r.length, r.flag ? 'yes' : 'no', r.note || ''])), 'api-fuzz-results.csv', 'text/csv');
  };

  const copyCurl = () => {
    if (!response?.built) return;
    navigator.clipboard?.writeText(toCurl(response.built));
    log('Copied as curl');
  };

  const shownOps = ops.filter((o) => !filter || `${o.method} ${o.path} ${o.summary}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="p-4 text-sm">
      {!hideProxyConfig && <ProxyConfig onLogMessage={onLogMessage} />}

      {!spec ? (
        <div className="space-y-2">
          <p className="text-gray-400 text-xs">Import an OpenAPI 3 / Swagger 2 spec (JSON or YAML).</p>
          <div className="flex gap-2">
            <input value={specUrl} onChange={(e) => setSpecUrl(e.target.value)} placeholder="spec URL (fetched via proxy if set)" className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />
            <button onClick={fetchSpec} className="px-3 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Fetch</button>
          </div>
          <textarea value={specText} onChange={(e) => setSpecText(e.target.value)} rows={10} placeholder="…or paste the spec here" className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs text-gray-200 font-mono" />
          <button onClick={() => loadSpec(specText)} className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500">Load spec</button>
          {specError && <p className="text-red-400 text-xs">Error: {specError}</p>}
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-gray-200 font-semibold">{spec.info?.title || 'API'} <span className="text-gray-500 text-xs">{spec.info?.version || ''}</span></span>
            <button onClick={() => { setSpec(null); setSelected(null); }} className="text-xs text-gray-400 hover:text-gray-200 underline">load another spec</button>
          </div>
          <div className="flex flex-wrap gap-2 mb-2 items-center">
            <label className="text-xs text-gray-400">Base URL</label>
            {servers.length > 1 && (
              <select onChange={(e) => setBaseUrl(e.target.value)} value={baseUrl} className="bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200">
                {servers.map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.example.com" className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />
          </div>
          {!baseOk && <p role="alert" className="mb-2 text-xs text-amber-300">The base URL must be absolute (http:// or https://). This spec declares a relative server URL; enter the full API origin to enable Send.</p>}
          <div className="flex flex-wrap gap-2 mb-3 items-start">
            <div className="flex-1 min-w-[12rem]">
              <label className="text-xs text-gray-400">Variables ({'{{name}}'} — one NAME=value per line)</label>
              <textarea value={varsText} onChange={(e) => setVarsText(e.target.value)} rows={2} placeholder="token=abc123" className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
            </div>
            <div>
              <label className="text-xs text-gray-400 block">Auth</label>
              <select value={auth.type} onChange={(e) => setAuth({ ...auth, type: e.target.value })} className="bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200">
                <option value="none">None</option><option value="bearer">Bearer</option><option value="basic">Basic</option><option value="apikey">API key</option>
              </select>
              {auth.type === 'bearer' && <input value={auth.token} onChange={(e) => setAuth({ ...auth, token: e.target.value })} placeholder="token (or {{token}})" className="block mt-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />}
              {auth.type === 'basic' && <span className="flex gap-1 mt-1"><input value={auth.user} onChange={(e) => setAuth({ ...auth, user: e.target.value })} placeholder="user" className="w-20 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" /><input value={auth.pass} onChange={(e) => setAuth({ ...auth, pass: e.target.value })} placeholder="pass" className="w-20 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" /></span>}
              {auth.type === 'apikey' && <span className="flex gap-1 mt-1"><input value={auth.headerName} onChange={(e) => setAuth({ ...auth, headerName: e.target.value })} className="w-24 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" /><input value={auth.token} onChange={(e) => setAuth({ ...auth, token: e.target.value })} placeholder="key" className="w-24 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" /></span>}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="w-72 shrink-0">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`filter ${ops.length} endpoints…`} className="w-full mb-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />
              <div className="overflow-auto border border-slate-800 rounded" style={{ maxHeight: '60vh' }}>
                {shownOps.map((o, i) => (
                  <button key={i} onClick={() => selectOp(o)} className={`block w-full text-left px-2 py-1 text-xs border-b border-slate-900 hover:bg-slate-800 ${selected === o ? 'bg-slate-800' : ''}`}>
                    <span className={`font-bold ${METHOD_COLORS[o.method] || ''}`}>{o.method}</span> <span className="text-gray-300 break-all">{o.path}</span>
                    {o.summary && <div className="text-gray-500 truncate">{o.summary}</div>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              {!selected ? (
                <p className="text-gray-500 text-xs">Select an endpoint to build a request.</p>
              ) : (
                <div>
                  <div className="mb-2"><span className={`font-bold ${METHOD_COLORS[selected.method]}`}>{selected.method}</span> <span className="text-gray-200 break-all">{selected.path}</span></div>
                  {(selected.parameters || []).some((p) => p.in !== 'body') && (
                    <div className="mb-2 space-y-1">
                      {selected.parameters.filter((p) => p.in !== 'body').map((p) => (
                        <div key={paramKey(p)} className="flex items-center gap-2">
                          <label className="text-xs text-gray-400 w-40 shrink-0 truncate" title={p.description || ''}>{p.name} <span className="text-gray-600">({p.in}{p.required ? ', req' : ''})</span></label>
                          <input value={paramValues[paramKey(p)] ?? ''} onChange={(e) => setParamValues({ ...paramValues, [paramKey(p)]: e.target.value })} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />
                        </div>
                      ))}
                    </div>
                  )}
                  {(selected.method !== 'GET' && selected.method !== 'HEAD') && (
                    <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={5} placeholder={`request body (${bodyContentType(selected) || 'application/json'})`} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
                  )}
                  <div className="flex gap-2">
                    <button onClick={send} disabled={busy || fuzzing || !baseOk} className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-40">{busy ? 'Sending…' : 'Send'}</button>
                    <button onClick={runFuzz} disabled={busy || fuzzing || !baseOk} className="px-3 py-1 bg-rose-600 text-white rounded hover:bg-rose-500 disabled:opacity-40">{fuzzing ? 'Fuzzing…' : 'Fuzz endpoint'}</button>
                    {(busy || fuzzing) && <button onClick={cancel} className="px-3 py-1 bg-red-700 text-white rounded hover:bg-red-600">Cancel</button>}
                    <label className="text-xs text-gray-400 self-center">Timeout <input aria-label="Timeout seconds" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className="w-12 bg-slate-900 border border-slate-800 rounded p-0.5 text-xs text-gray-200 text-center" /> s</label>
                  </div>

                  {response && !response.error && (
                    <div className="mt-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>Status: <span className={response.status < 400 ? 'text-green-400' : 'text-red-400'}>{response.status} {response.statusText}</span></span>
                        <span className="text-gray-500 text-xs">{response.size} bytes · {response.timeMs}ms{response.isBinary ? ' · binary' : ''}</span>
                        <button onClick={copyCurl} className="px-2 py-0.5 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Copy as curl</button>
                        {response.isBinary && <button onClick={() => downloadBlob(response.bytes, `response-${response.status}.bin`, response.contentType || 'application/octet-stream')} className="px-2 py-0.5 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Save response</button>}
                      </div>
                      <div className="mt-1 text-xs text-gray-400">Response headers:</div>
                      <pre className="bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '12vh' }}>{response.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
                      <pre className="mt-1 bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '30vh' }}>{response.isBinary ? hexDumpBytes(response.bytes) : response.body}</pre>
                    </div>
                  )}
                  {response?.error && <p className="text-red-400 text-xs mt-2">{response.error}</p>}

                  {fuzzRows.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-400 mb-1 flex items-center gap-2">Fuzz results (5xx / errors highlighted): <button onClick={exportFuzz} className="px-2 py-0.5 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Export CSV</button></div>
                      <div className="overflow-auto" style={{ maxHeight: '28vh' }}>
                        <table className="w-full text-xs font-mono border-collapse">
                          <thead className="bg-slate-800 text-left"><tr><th className="p-1">Case</th><th className="p-1">Status</th><th className="p-1">Length</th></tr></thead>
                          <tbody>
                            {fuzzRows.map((r, i) => (
                              <tr key={i} className={`border-b border-slate-800 ${r.flag ? 'bg-yellow-950/30' : ''}`}>
                                <td className="p-1 break-all">{r.label}</td>
                                <td className={`p-1 ${r.status === 'err' || r.status >= 500 ? 'text-red-400' : r.status >= 400 ? 'text-yellow-400' : 'text-green-400'}`}>{r.status}</td>
                                <td className="p-1 text-gray-400">{r.length}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
