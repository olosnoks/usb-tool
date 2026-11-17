import React, { useState, useRef } from 'react';
import { isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import { sendHttp, hexDumpBytes, timeoutFromSeconds, downloadBlob, toCsv } from '../../utils/httpSend';
import { historyToHar, harToRequests, loadHistory, saveHistory, clearHistory, HISTORY_CAP, redactHeaders } from '../../utils/httpHar';
import { countMarkers, stripMarkers, applyMarkers, applyAllMarkers } from '../../utils/intruder';
import { CODECS, jwtDecode } from '../../utils/codec';
import { md5Hex } from '../../utils/md5';
import { parseCurl, parseRawHttp, toCurl, toFetch, toPowerShell, toPython } from '../../utils/httpImport';
import { lineDiff, diffStats } from '../../utils/diff';
import ProxyConfig from './common/ProxyConfig';
import WordlistPicker from './common/WordlistPicker';

/**
 * Burp-style web request toolkit (within browser limits).
 *  - Repeater: craft HTTP/HTTPS requests, multi-view response, history, import.
 *  - Intruder: sniper / battering-ram / pitchfork / cluster-bomb with grep-match.
 *  - Comparer: line diff of two responses/texts.
 *  - Decoder: Base64/URL/Hex/HTML, JWT decode, hashing, smart-decode.
 *
 * A browser cannot be a transparent intercepting proxy; requests go through fetch
 * and are CORS-limited. Configure a proxy to reach arbitrary hosts.
 */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function normalizeUrl(raw) {
  const u = (raw || '').trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  return `https://${u}`;
}

function parseHeaders(text) {
  const h = {};
  (text || '').split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (k) h[k] = v;
    }
  });
  return h;
}

async function sendRequest({ method, url, headers, body }, { signal, timeoutMs } = {}) {
  const opts = { method, headers: parseHeaders(headers), redirect: 'follow' };
  if (method !== 'GET' && method !== 'HEAD' && body) opts.body = body;
  return sendHttp(normalizeUrl(url), opts, { signal, timeoutMs });
}

const isCancel = (e) => e?.name === 'AbortError' || e?.name === 'TimeoutError';
const errText = (e) => (isCancel(e) ? e.message : describeNetworkError(e));

function prettyBody(body, headers) {
  const ct = (headers || []).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
  if (/json/i.test(ct) || /^\s*[[{]/.test(body)) {
    try { return JSON.stringify(JSON.parse(body), null, 2); } catch { /* fall through */ }
  }
  return body;
}

// Render text with case-insensitive <mark> highlights for a search term.
function Highlighted({ text, term }) {
  if (!term) return <>{text}</>;
  const parts = [];
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let i = 0;
  let k = 0;
  while (i < text.length) {
    const idx = lower.indexOf(t, i);
    if (idx < 0) { parts.push(text.slice(i)); break; }
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push(<mark key={k++} className="bg-amber-400/40 text-amber-100">{text.slice(idx, idx + term.length)}</mark>);
    i = idx + term.length;
  }
  return <>{parts}</>;
}

export default function BurpProxyWorkbench({ onLogMessage, hideProxyConfig = false }) {
  const [tab, setTab] = useState('repeater');
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');
  const [cmpA, setCmpA] = useState('');
  const [cmpB, setCmpB] = useState('');
  const [timeoutSec, setTimeoutSec] = useState('30');

  const log = (msg) => onLogMessage?.(msg);
  const req = { method, url, headers, body, setMethod, setUrl, setHeaders, setBody, timeoutMs: timeoutFromSeconds(timeoutSec), timeoutSec, setTimeoutSec };
  const toComparer = (text, slot) => { if (slot === 'b') setCmpB(text); else setCmpA(text); setTab('comparer'); };

  return (
    <div className="p-4">
      {!hideProxyConfig && <ProxyConfig onLogMessage={onLogMessage} />}
      <div className="flex gap-1 mb-3 border-b border-slate-800">
        {['repeater', 'intruder', 'comparer', 'decoder'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-sm capitalize rounded-t ${tab === t ? 'bg-slate-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'repeater' && <Repeater {...req} log={log} toComparer={toComparer} />}
      {tab === 'intruder' && <Intruder {...req} log={log} toComparer={toComparer} />}
      {tab === 'comparer' && <Comparer a={cmpA} b={cmpB} setA={setCmpA} setB={setCmpB} />}
      {tab === 'decoder' && <Decoder />}
    </div>
  );
}

function ImportBar({ setMethod, setUrl, setHeaders, setBody, log }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const doImport = (fn, kind) => {
    try {
      const r = fn(text);
      setMethod(r.method); setUrl(r.url); setHeaders(r.headers); setBody(r.body);
      setOpen(false); setText('');
      log?.(`Imported ${kind} request: ${r.method} ${r.url}`);
    } catch (e) { log?.(`Import failed: ${e.message}`); alert(`Import failed: ${e.message}`); }
  };
  return (
    <div className="mb-2">
      <button onClick={() => setOpen((o) => !o)} className="text-xs text-cyan-300 hover:text-cyan-200">
        {open ? '▾ Import request' : '▸ Import request (curl / raw HTTP)'}
      </button>
      {open && (
        <div className="mt-1">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4}
            placeholder={"Paste a curl command or a raw HTTP request, then parse…"}
            className="w-full bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
          <div className="flex gap-2 mt-1">
            <button onClick={() => doImport(parseCurl, 'curl')} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Parse as curl</button>
            <button onClick={() => doImport(parseRawHttp, 'raw')} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Parse as raw HTTP</button>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestEditor({ method, url, headers, body, setMethod, setUrl, setHeaders, setBody, markerHint }) {
  return (
    <>
      <div className="flex gap-2 mb-2">
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200">
          {METHODS.map((m) => <option key={m}>{m}</option>)}
        </select>
        <input type="text" placeholder="https://example.com/api" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
      </div>
      <textarea placeholder={`Request headers (one per line, Key: Value)${markerHint ? ' — use {{marker}} to fuzz' : ''}`} rows={4} value={headers} onChange={(e) => setHeaders(e.target.value)} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
      <textarea placeholder={`Request body${markerHint ? ' — use {{marker}} to fuzz' : ''}`} rows={4} value={body} onChange={(e) => setBody(e.target.value)} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
    </>
  );
}

function ResponseView({ response, toComparer }) {
  const [view, setView] = useState('pretty');
  const [search, setSearch] = useState('');
  if (!response) return null;
  if (response.error) return <p className="text-red-400 text-sm mt-2">{response.error}</p>;

  const binary = !!response.isBinary;
  const pretty = binary ? '' : prettyBody(response.body, response.headers);
  const shown = binary || view === 'hex' ? hexDumpBytes(response.bytes || new TextEncoder().encode(response.body || '')) : view === 'pretty' ? pretty : response.body;
  const save = () => downloadBlob(response.bytes, `response-${response.status}.bin`, response.contentType || 'application/octet-stream');

  return (
    <div className="mt-3 text-sm text-gray-200">
      <div className="flex flex-wrap items-center gap-2">
        <span>Status: <span className={response.status < 400 ? 'text-green-400' : 'text-red-400'}>{response.status} {response.statusText}</span></span>
        <span className="text-gray-500 text-xs">{response.size} bytes · {response.timeMs}ms{binary ? ' · binary' : ''}</span>
        {binary && response.bytes && <button onClick={save} className="px-2 py-0.5 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Save response</button>}
        <div className="ml-auto flex gap-1">
          {(binary ? ['hex'] : ['pretty', 'raw', 'hex', 'render']).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-2 py-0.5 rounded text-xs capitalize ${view === v ? 'bg-slate-700 text-white' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>{v}</button>
          ))}
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search response…" className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />
        {toComparer && !binary && <button onClick={() => toComparer(response.body, 'a')} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">→ Comparer A</button>}
        {toComparer && !binary && <button onClick={() => toComparer(response.body, 'b')} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">→ Comparer B</button>}
      </div>
      <div className="mt-2 text-xs text-gray-400">Response headers:</div>
      <pre className="bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '12vh' }}>{response.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
      <div className="mt-2 text-xs text-gray-400">Body{binary ? ' (binary, shown as hex)' : ''}:</div>
      {!binary && view === 'render' ? (
        <iframe title="response" sandbox="" srcDoc={response.body} className="w-full bg-white rounded" style={{ height: '32vh' }} />
      ) : (
        <pre className="bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '32vh' }}><Highlighted text={shown} term={search} /></pre>
      )}
    </div>
  );
}

function CopyAsMenu({ request, log }) {
  const [open, setOpen] = useState(false);
  const FORMATS = [['curl', toCurl], ['fetch', toFetch], ['PowerShell', toPowerShell], ['Python requests', toPython]];
  const pick = (name, fn) => { navigator.clipboard?.writeText(fn(request)); log(`Copied as ${name}`); setOpen(false); };
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} className="px-3 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Copy as ▾</button>
      {open && (
        <div role="menu" className="absolute z-10 mt-1 bg-slate-900 border border-slate-700 rounded shadow text-xs">
          {FORMATS.map(([name, fn]) => (
            <button key={name} role="menuitem" onClick={() => pick(name, fn)} className="block w-full text-left px-3 py-1 text-gray-200 hover:bg-slate-800">{name}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function Repeater(props) {
  const { method, url, headers, body, log, toComparer, timeoutMs, timeoutSec, setTimeoutSec } = props;
  const [response, setResponse] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(() => loadHistory());
  const abortRef = useRef(null);
  const fileRef = useRef(null);

  const commitHistory = (next) => { const capped = next.slice(0, HISTORY_CAP); saveHistory(capped); return capped; };

  const send = async () => {
    if (!url.trim()) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setResponse(null);
    log(`${method} ${url}${isProxyEnabled() ? ' (via proxy)' : ' (direct)'}`);
    try {
      const res = await sendRequest({ method, url, headers, body }, { signal: ctrl.signal, timeoutMs });
      setResponse(res);
      setHistory((h) => commitHistory([{ req: { method, url, headers, body }, res, status: res.status, statusText: res.statusText, size: res.size, timeMs: res.timeMs, startedAt: Date.now() }, ...h]));
      log(`Response ${res.status} ${res.statusText} — ${res.size} bytes, ${res.timeMs}ms`);
    } catch (e) {
      setResponse({ error: errText(e) });
      log(`${isCancel(e) ? '' : 'Error: '}${errText(e)}`);
    }
    abortRef.current = null;
    setBusy(false);
  };

  const cancel = () => abortRef.current?.abort();

  const restore = (h) => {
    props.setMethod(h.req.method); props.setUrl(h.req.url); props.setHeaders(h.req.headers); props.setBody(h.req.body);
    setResponse(h.res || null);
  };

  const exportHar = () => {
    // credential headers (Authorization, Cookie, API keys) are redacted in exported files, as in saved history
    const redacted = history.map((e) => ({ ...e, req: { ...e.req, headers: redactHeaders(e.req?.headers) } }));
    downloadBlob(JSON.stringify(historyToHar(redacted), null, 2), `repeater-history-${new Date().toISOString().slice(0, 10)}.har`, 'application/json');
    log(`Exported ${history.length} history entr${history.length === 1 ? 'y' : 'ies'} as HAR`);
  };

  const importHar = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const reqs = harToRequests(await file.text());
      const entries = reqs.map((r) => ({ req: { method: r.method, url: r.url, headers: r.headers, body: r.body }, status: r.status, statusText: r.statusText, size: r.size, timeMs: r.timeMs, startedAt: Date.now() }));
      setHistory((h) => commitHistory([...entries, ...h]));
      log(`Imported ${entries.length} request(s) from HAR`);
    } catch (err) { log(`HAR import failed: ${err.message}`); }
  };

  const clear = () => { clearHistory(); setHistory([]); log('History cleared'); };

  return (
    <div className="flex gap-3">
      <div className="flex-1 min-w-0">
        <ImportBar {...props} />
        <RequestEditor {...props} />
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={send} disabled={busy} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-40">{busy ? 'Sending…' : 'Send'}</button>
          {busy && <button onClick={cancel} className="px-3 py-1 bg-red-700 text-white rounded hover:bg-red-600">Cancel</button>}
          <CopyAsMenu request={{ method, url, headers, body }} log={log} />
          <label className="text-xs text-gray-400">Timeout <input aria-label="Timeout seconds" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className="w-12 bg-slate-900 border border-slate-800 rounded p-0.5 text-xs text-gray-200 text-center" /> s</label>
        </div>
        <ResponseView response={response} toComparer={toComparer} />
      </div>
      <div className="w-56 shrink-0">
        <div className="flex items-center gap-1 mb-1 text-xs text-gray-400">
          <span className="mr-auto">History ({history.length}/{HISTORY_CAP})</span>
          <button onClick={exportHar} disabled={!history.length} className="text-cyan-300 hover:text-cyan-200 disabled:opacity-40">Export HAR</button>
          <button onClick={() => fileRef.current?.click()} className="text-cyan-300 hover:text-cyan-200">Import</button>
          <button onClick={clear} disabled={!history.length} className="text-red-300 hover:text-red-200 disabled:opacity-40">Clear</button>
          <input ref={fileRef} type="file" accept=".har,application/json" onChange={importHar} className="hidden" />
        </div>
        {history.length > 0 && (
          <div className="space-y-1 overflow-auto" style={{ maxHeight: '60vh' }}>
            {history.map((h, i) => (
              <button key={i} onClick={() => restore(h)} className="block w-full text-left bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded p-1 text-[11px] text-gray-300">
                <span className={h.status < 400 ? 'text-green-400' : 'text-red-400'}>{h.status || '—'}</span> {h.req.method} <span className="text-gray-500">{h.size ?? 0}b</span>
                <div className="truncate text-gray-500">{h.req.url}</div>
              </button>
            ))}
          </div>
        )}
        <p className="mt-1 text-[10px] text-slate-500">Saved locally in this browser. Authorization/Cookie style header values are replaced with [redacted]; request bodies are stored as typed.</p>
      </div>
    </div>
  );
}

const ATTACKS = [
  { id: 'sniper', label: 'Sniper (one position at a time)' },
  { id: 'battering', label: 'Battering ram (same payload, all positions)' },
  { id: 'pitchfork', label: 'Pitchfork (parallel sets)' },
  { id: 'clusterbomb', label: 'Cluster bomb (all combinations)' },
];

function buildJobs(attack, positions, sets) {
  if (positions === 0) return [];
  if (attack === 'sniper') {
    const list = sets[0] || [];
    const jobs = [];
    for (let p = 0; p < positions; p++) for (const pl of list) jobs.push({ values: Array.from({ length: positions }, (_, i) => (i === p ? pl : null)), label: `p${p + 1}=${pl}` });
    return jobs;
  }
  if (attack === 'battering') {
    return (sets[0] || []).map((pl) => ({ values: Array(positions).fill(pl), label: pl }));
  }
  if (attack === 'pitchfork') {
    const len = Math.min(...Array.from({ length: positions }, (_, i) => (sets[i] || []).length));
    const jobs = [];
    for (let k = 0; k < len; k++) { const vals = Array.from({ length: positions }, (_, i) => sets[i][k]); jobs.push({ values: vals, label: vals.join(' | ') }); }
    return jobs;
  }
  // cluster bomb
  let combos = [[]];
  for (let i = 0; i < positions; i++) {
    const set = sets[i] || [];
    const next = [];
    for (const c of combos) for (const pl of set) next.push([...c, pl]);
    combos = next;
  }
  return combos.map((vals) => ({ values: vals, label: vals.join(' | ') }));
}

function Intruder(props) {
  const { method, url, headers, body, log, toComparer, timeoutMs, timeoutSec, setTimeoutSec } = props;
  const [attack, setAttack] = useState('sniper');
  const [payloadText, setPayloadText] = useState('');
  const [perPos, setPerPos] = useState({}); // { posIndex: payloadText } for pitchfork/cluster
  const [grep, setGrep] = useState('');
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [sort, setSort] = useState({ key: 'idx', dir: 1 });
  const [filter, setFilter] = useState('');
  const cancelRef = useRef(false);
  const abortRef = useRef(null);

  const positions = countMarkers([url, headers, body]);
  const multiSet = attack === 'pitchfork' || attack === 'clusterbomb';
  const linesOf = (t) => (t || '').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);

  const run = async () => {
    const sets = multiSet
      ? Array.from({ length: positions }, (_, i) => linesOf(perPos[i]))
      : [linesOf(payloadText)];
    if (!url.trim() || positions === 0 || sets.every((s) => s.length === 0)) {
      log('Intruder needs a URL, at least one {{marker}}, and payloads.');
      return;
    }
    const jobs = buildJobs(attack, positions, sets);
    if (jobs.length === 0) { log('No payload combinations to run.'); return; }
    setRunning(true);
    setResults([]);
    cancelRef.current = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ done: 0, total: jobs.length });
    log(`Intruder (${attack}): ${positions} position(s), ${jobs.length} request(s)`);

    let done = 0;
    const collected = [];
    const concurrency = 5;
    let idx = 0;
    const worker = async () => {
      while (idx < jobs.length) {
        if (cancelRef.current) return;
        const myIdx = idx++;
        const job = jobs[myIdx];
        const fields = applyAllMarkers({ url, headers, body }, job.values);
        let row;
        try {
          const res = await sendRequest({ method, url: fields.url, headers: fields.headers, body: fields.body }, { signal: ctrl.signal, timeoutMs });
          row = { idx: myIdx + 1, label: job.label, status: res.status, length: res.size, timeMs: res.timeMs, match: grep ? (res.isBinary ? false : res.body.includes(grep)) : null, body: res.isBinary ? null : res.body };
        } catch (e) {
          if (isCancel(e) && cancelRef.current) return; // user cancelled: drop the aborted in-flight request
          row = { idx: myIdx + 1, label: job.label, status: 'err', length: 0, timeMs: 0, match: null, error: errText(e) };
        }
        done += 1;
        collected.push(row);
        setProgress({ done, total: jobs.length });
        setResults([...collected]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    log(cancelRef.current ? 'Intruder cancelled' : 'Intruder complete');
    abortRef.current = null;
    setRunning(false);
  };

  const sorted = [...results]
    .filter((r) => !filter || String(r.label).toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const va = a[sort.key]; const vb = b[sort.key];
      if (va === vb) return 0;
      return (va > vb ? 1 : -1) * sort.dir;
    });
  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }));
  const Th = ({ k, children }) => <th onClick={() => toggleSort(k)} className="p-1 cursor-pointer select-none hover:text-white">{children}{sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>;

  return (
    <div>
      <ImportBar {...props} />
      <RequestEditor {...props} markerHint />
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <select value={attack} onChange={(e) => setAttack(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200">
          {ATTACKS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <label className="text-xs text-gray-400">Timeout <input aria-label="Timeout seconds" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} className="w-12 bg-slate-900 border border-slate-800 rounded p-0.5 text-xs text-gray-200 text-center" /> s</label>
        <span className="text-xs text-gray-400">{positions} marker position(s) — mark with <code>{'{{value}}'}</code></span>
      </div>
      {multiSet ? (
        Array.from({ length: positions }, (_, i) => (
          <textarea key={i} value={perPos[i] || ''} onChange={(e) => setPerPos((p) => ({ ...p, [i]: e.target.value }))} rows={3}
            placeholder={`Payload set for position ${i + 1} (one per line)`} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
        ))
      ) : (
        <>
          <WordlistPicker max={20000} label="Payloads" onLoad={(lines) => setPayloadText(lines.join('\n'))} />
          <textarea value={payloadText} onChange={(e) => setPayloadText(e.target.value)} rows={4} placeholder="Payloads (one per line)" className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
        </>
      )}
      <input value={grep} onChange={(e) => setGrep(e.target.value)} placeholder="grep-match: flag responses containing this string" className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />
      <div className="flex gap-2 mb-2">
        <button onClick={run} disabled={running} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-40">
          {running ? `Attacking ${progress.done}/${progress.total}` : 'Start attack'}
        </button>
        {running && <button onClick={() => { cancelRef.current = true; abortRef.current?.abort(); }} className="px-3 py-1 bg-red-700 text-white rounded hover:bg-red-600">Cancel</button>}
        {results.length > 0 && !running && <button onClick={() => downloadBlob(toCsv(['#', 'payload', 'status', 'length', 'time_ms', 'match'], results.map((r) => [r.idx, r.label, r.status, r.length, r.timeMs, r.match === null ? '' : r.match ? 'yes' : 'no'])), 'intruder-results.csv', 'text/csv')} className="px-3 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">Export CSV</button>}
        {results.length > 0 && <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter payloads…" className="bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200" />}
      </div>
      {results.length > 0 && (
        <div className="overflow-auto" style={{ maxHeight: '45vh' }}>
          <table className="w-full text-xs text-gray-200 border-collapse font-mono">
            <thead className="sticky top-0 bg-slate-800 text-left">
              <tr><Th k="idx">#</Th><Th k="label">Payload</Th><Th k="status">Status</Th><Th k="length">Length</Th><Th k="timeMs">Time</Th>{grep && <Th k="match">Match</Th>}<th className="p-1"></th></tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className={`border-b border-slate-800 ${r.match ? 'bg-yellow-950/30' : ''}`}>
                  <td className="p-1 text-gray-500">{r.idx}</td>
                  <td className="p-1 break-all">{r.label}</td>
                  <td className={`p-1 ${r.status === 'err' ? 'text-red-400' : r.status < 400 ? 'text-green-400' : 'text-yellow-400'}`}>{r.status}</td>
                  <td className="p-1">{r.length}</td>
                  <td className="p-1 text-gray-500">{r.timeMs}ms</td>
                  {grep && <td className={`p-1 ${r.match ? 'text-yellow-300 font-bold' : 'text-gray-600'}`}>{r.match ? 'yes' : 'no'}</td>}
                  <td className="p-1">{r.body != null && <button onClick={() => toComparer(r.body, 'b')} className="text-cyan-400 hover:text-cyan-200">→cmp</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Comparer({ a, b, setA, setB }) {
  const [rows, setRows] = useState(null);
  const compare = () => setRows(lineDiff(a, b));
  const stats = rows ? diffStats(rows) : null;
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <textarea value={a} onChange={(e) => setA(e.target.value)} rows={8} placeholder="A" className="bg-slate-900 border border-slate-800 rounded p-2 text-xs text-gray-200 font-mono" />
        <textarea value={b} onChange={(e) => setB(e.target.value)} rows={8} placeholder="B" className="bg-slate-900 border border-slate-800 rounded p-2 text-xs text-gray-200 font-mono" />
      </div>
      <button onClick={compare} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500 text-sm">Compare</button>
      {stats && <span className="ml-3 text-xs text-gray-400">+{stats.added} added · -{stats.removed} removed · {stats.same} unchanged</span>}
      {rows && (
        <pre className="mt-2 bg-slate-900 p-2 rounded overflow-auto text-xs font-mono" style={{ maxHeight: '55vh' }}>
          {rows.map((r, i) => (
            <div key={i} className={r.type === 'add' ? 'bg-green-950/40 text-green-300' : r.type === 'del' ? 'bg-red-950/40 text-red-300' : 'text-gray-400'}>
              {r.type === 'add' ? '+ ' : r.type === 'del' ? '- ' : '  '}{r.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}

function Decoder() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');

  const apply = (fn) => { try { setOutput(fn(input)); setError(''); } catch (e) { setError(e.message); } };
  const hash = async (alg) => {
    try {
      if (alg === 'MD5') { setOutput(md5Hex(input)); setError(''); return; }
      const buf = await crypto.subtle.digest(alg, new TextEncoder().encode(input));
      setOutput(Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''));
      setError('');
    } catch (e) { setError(e.message); }
  };
  const smartDecode = () => {
    for (const c of CODECS) {
      try { const d = c.decode(input); if (d && d !== input && /[\x20-\x7e]/.test(d)) { setOutput(`[${c.label}]\n${d}`); setError(''); return; } } catch { /* next */ }
    }
    setError('Smart decode could not interpret the input.');
  };

  return (
    <div>
      <textarea placeholder="Input" rows={5} value={input} onChange={(e) => setInput(e.target.value)} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-2 text-sm text-gray-200 font-mono" />
      <div className="flex flex-wrap gap-2 mb-2">
        {CODECS.map((c) => (
          <span key={c.id} className="flex gap-1">
            <button onClick={() => apply(c.encode)} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">{c.label} enc</button>
            <button onClick={() => apply(c.decode)} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">{c.label} dec</button>
          </span>
        ))}
        <button onClick={() => apply(jwtDecode)} className="px-2 py-1 bg-indigo-700 text-gray-100 rounded text-xs hover:bg-indigo-600">JWT decode</button>
        <button onClick={smartDecode} className="px-2 py-1 bg-cyan-700 text-gray-100 rounded text-xs hover:bg-cyan-600">Smart decode</button>
        {['MD5', 'SHA-1', 'SHA-256'].map((a) => (
          <button key={a} onClick={() => hash(a)} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">{a}</button>
        ))}
        <button onClick={() => { setInput(output.replace(/^\[[^\]]+\]\n/, '')); setOutput(''); }} className="px-2 py-1 bg-slate-800 text-gray-300 rounded text-xs hover:bg-slate-700">↑ output → input</button>
      </div>
      {error && <p className="text-red-400 text-xs mb-1">Error: {error}</p>}
      <textarea placeholder="Output" rows={6} readOnly value={output} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-gray-200 font-mono" />
    </div>
  );
}
