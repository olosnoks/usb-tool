import React, { useState, useRef } from 'react';
import { proxiedFetch, isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import { countMarkers, stripMarkers, applyMarkers } from '../../utils/intruder';
import { CODECS } from '../../utils/codec';
import ProxyConfig from './common/ProxyConfig';

/**
 * Web request toolkit modelled on Burp Suite, within browser limits.
 *  - Repeater: craft a request, send it, inspect the response, with history.
 *  - Intruder: mark {{positions}} and fuzz them with a payload list (sniper).
 *  - Decoder:  encode/decode Base64, URL, Hex, HTML.
 *
 * A browser cannot act as a transparent intercepting proxy; requests go through
 * fetch and are CORS-limited. Configure a proxy (netClient) to reach arbitrary
 * hosts and read their responses.
 */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

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

async function sendRequest({ method, url, headers, body }) {
  const opts = { method, headers: parseHeaders(headers), redirect: 'follow' };
  if (method !== 'GET' && method !== 'HEAD' && body) opts.body = body;
  const start = performance.now();
  const resp = await proxiedFetch(url, opts);
  const text = await resp.text();
  return {
    status: resp.status,
    statusText: resp.statusText,
    headers: [...resp.headers.entries()],
    body: text,
    size: text.length,
    timeMs: Math.round(performance.now() - start),
  };
}

export default function BurpProxyWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('repeater');
  // Shared request (Repeater <-> Intruder)
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');

  const log = (msg) => onLogMessage?.(msg);
  const reqProps = { method, url, headers, body, setMethod, setUrl, setHeaders, setBody };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Web Request Toolkit</h2>
      <ProxyConfig onLogMessage={onLogMessage} />
      <div className="flex gap-1 mb-3 border-b border-slate-800">
        {['repeater', 'intruder', 'decoder'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1 text-sm capitalize rounded-t ${tab === t ? 'bg-slate-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'repeater' && <Repeater {...reqProps} log={log} />}
      {tab === 'intruder' && <Intruder {...reqProps} log={log} />}
      {tab === 'decoder' && <Decoder />}
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

function Repeater(props) {
  const { method, url, headers, body, log } = props;
  const [response, setResponse] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);

  const send = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setResponse(null);
    log(`${method} ${url}${isProxyEnabled() ? ' (via proxy)' : ' (direct)'}`);
    try {
      const res = await sendRequest({ method, url, headers, body });
      setResponse(res);
      setHistory((h) => [{ method, url, status: res.status, size: res.size, timeMs: res.timeMs, req: { method, url, headers, body }, res }, ...h].slice(0, 25));
      log(`Response ${res.status} ${res.statusText} — ${res.size} bytes, ${res.timeMs}ms`);
    } catch (e) {
      setResponse({ error: describeNetworkError(e) });
      log(`Error: ${describeNetworkError(e)}`);
    }
    setBusy(false);
  };

  const restore = (h) => {
    props.setMethod(h.req.method); props.setUrl(h.req.url); props.setHeaders(h.req.headers); props.setBody(h.req.body);
    setResponse(h.res);
  };

  return (
    <div className="flex gap-3">
      <div className="flex-1 min-w-0">
        <RequestEditor {...props} />
        <button onClick={send} disabled={busy} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-40">{busy ? 'Sending…' : 'Send'}</button>
        {response && !response.error && (
          <div className="mt-3 text-sm text-gray-200">
            <div>Status: <span className={response.status < 400 ? 'text-green-400' : 'text-red-400'}>{response.status} {response.statusText}</span>
              <span className="text-gray-500 text-xs"> · {response.size} bytes · {response.timeMs}ms</span></div>
            <div className="mt-2 text-xs text-gray-400">Response headers:</div>
            <pre className="bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '12vh' }}>{response.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
            <div className="mt-2 text-xs text-gray-400">Body:</div>
            <pre className="bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '28vh' }}>{response.body}</pre>
          </div>
        )}
        {response?.error && <p className="text-red-400 text-sm mt-2">{response.error}</p>}
      </div>
      {history.length > 0 && (
        <div className="w-56 shrink-0">
          <div className="text-xs text-gray-400 mb-1">History</div>
          <div className="space-y-1 overflow-auto" style={{ maxHeight: '60vh' }}>
            {history.map((h, i) => (
              <button key={i} onClick={() => restore(h)} className="block w-full text-left bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded p-1 text-[11px] text-gray-300">
                <span className={h.status < 400 ? 'text-green-400' : 'text-red-400'}>{h.status}</span> {h.method} <span className="text-gray-500">{h.size}b</span>
                <div className="truncate text-gray-500">{h.url}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Intruder(props) {
  const { method, url, headers, body, log } = props;
  const [payloads, setPayloads] = useState('');
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [baseline, setBaseline] = useState(null);
  const cancelRef = useRef(false);

  const positions = countMarkers([url, headers, body]);

  const run = async () => {
    const list = payloads.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
    if (!url.trim() || positions === 0 || list.length === 0) {
      log('Intruder needs a URL, at least one {{marker}}, and payloads.');
      return;
    }
    setRunning(true);
    setResults([]);
    cancelRef.current = false;
    const total = positions * list.length;
    setProgress({ done: 0, total });
    log(`Intruder: ${positions} position(s) × ${list.length} payload(s) = ${total} request(s)`);

    // Baseline request (markers at defaults)
    try {
      const base = await sendRequest({ method, url: stripMarkers(url), headers: stripMarkers(headers), body: stripMarkers(body) });
      setBaseline({ status: base.status, size: base.size });
    } catch { setBaseline(null); }

    const jobs = [];
    for (let p = 0; p < positions; p++) {
      for (const payload of list) jobs.push({ p, payload });
    }
    let done = 0;
    const collected = [];
    const concurrency = 5;
    let idx = 0;
    const worker = async () => {
      while (idx < jobs.length) {
        if (cancelRef.current) return;
        const job = jobs[idx++];
        const fields = applyMarkers({ url, headers, body }, job.p, job.payload);
        let row;
        try {
          const res = await sendRequest({ method, url: fields.url, headers: fields.headers, body: fields.body });
          row = { position: job.p + 1, payload: job.payload, status: res.status, length: res.size, timeMs: res.timeMs };
        } catch (e) {
          row = { position: job.p + 1, payload: job.payload, status: 'err', length: 0, timeMs: 0, error: describeNetworkError(e) };
        }
        done += 1;
        collected.push(row);
        setProgress({ done, total });
        setResults([...collected].sort((a, b) => a.position - b.position || a.payload.localeCompare(b.payload)));
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
    log(cancelRef.current ? 'Intruder cancelled' : 'Intruder complete');
    setRunning(false);
  };

  const anomaly = (r) => baseline && (r.status !== baseline.status || Math.abs(r.length - baseline.size) > 0);

  return (
    <div>
      <RequestEditor {...props} markerHint />
      <div className="text-xs text-gray-400 mb-1">{positions} marker position(s) detected. Mark fuzz points with <code>{'{{value}}'}</code>.</div>
      <textarea placeholder="Payloads (one per line)" rows={4} value={payloads} onChange={(e) => setPayloads(e.target.value)} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
      <div className="flex gap-2 mb-2">
        <button onClick={run} disabled={running} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-40">
          {running ? `Attacking ${progress.done}/${progress.total}` : 'Start attack'}
        </button>
        {running && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded hover:bg-slate-600">Stop</button>}
      </div>
      {baseline && <div className="text-xs text-gray-500 mb-1">Baseline: status {baseline.status}, {baseline.size} bytes. Rows differing from baseline are highlighted.</div>}
      {results.length > 0 && (
        <div className="overflow-auto" style={{ maxHeight: '45vh' }}>
          <table className="w-full text-xs text-gray-200 border-collapse font-mono">
            <thead className="sticky top-0 bg-slate-800"><tr className="text-left"><th className="p-1">Pos</th><th className="p-1">Payload</th><th className="p-1">Status</th><th className="p-1">Length</th><th className="p-1">Time</th></tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className={`border-b border-slate-800 ${anomaly(r) ? 'bg-yellow-950/30' : ''}`}>
                  <td className="p-1 text-gray-500">{r.position}</td>
                  <td className="p-1 break-all">{r.payload}</td>
                  <td className={`p-1 ${r.status === 'err' ? 'text-red-400' : r.status < 400 ? 'text-green-400' : 'text-yellow-400'}`}>{r.status}</td>
                  <td className="p-1">{r.length}</td>
                  <td className="p-1 text-gray-500">{r.timeMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Decoder() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');

  const apply = (fn) => {
    try { setOutput(fn(input)); setError(''); }
    catch (e) { setError(e.message); }
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
        <button onClick={() => { setInput(output); setOutput(''); }} className="px-2 py-1 bg-slate-800 text-gray-300 rounded text-xs hover:bg-slate-700">↑ output → input</button>
      </div>
      {error && <p className="text-red-400 text-xs mb-1">Error: {error}</p>}
      <textarea placeholder="Output" rows={5} readOnly value={output} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-gray-200 font-mono" />
    </div>
  );
}
