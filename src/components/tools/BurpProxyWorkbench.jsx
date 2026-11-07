import React, { useState } from 'react';
import { proxiedFetch, isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';

/**
 * HTTP request repeater. Compose a request (method, headers, body) and inspect
 * the full response (status, headers, body). A browser cannot act as a transparent
 * MITM proxy; direct requests are CORS-limited, so configure a proxy to reach
 * arbitrary hosts and read their responses.
 */
export default function BurpProxyWorkbench({ onLogMessage }) {
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [headersText, setHeadersText] = useState('');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState(null);
  const [busy, setBusy] = useState(false);

  const log = (msg) => onLogMessage?.(msg);

  const parseHeaders = () => {
    const h = {};
    headersText.split('\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) h[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
    return h;
  };

  const send = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setResponse(null);
    log(`${method} ${url}${isProxyEnabled() ? ' (via proxy)' : ' (direct)'}`);
    try {
      const opts = { method, headers: parseHeaders() };
      if (method !== 'GET' && method !== 'HEAD' && body) opts.body = body;
      const resp = await proxiedFetch(url, opts);
      const text = await resp.text();
      setResponse({ status: resp.status, statusText: resp.statusText, headers: [...resp.headers.entries()], body: text });
      log(`Response ${resp.status} ${resp.statusText} (${text.length} bytes)`);
    } catch (e) {
      log(`Error: ${describeNetworkError(e)}`);
      setResponse({ error: describeNetworkError(e) });
    }
    setBusy(false);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">HTTP Repeater</h2>
      <p className="text-sm text-gray-400 mb-3">Send a crafted HTTP request and inspect the response.</p>
      <ProxyConfig onLogMessage={onLogMessage} />
      <div className="flex gap-2 mb-2">
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200">
          <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>HEAD</option>
        </select>
        <input type="text" placeholder="https://example.com/api" value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={send} disabled={busy} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500 disabled:opacity-40">{busy ? 'Sending…' : 'Send'}</button>
      </div>
      <textarea placeholder="Request headers (one per line, Key: Value)" rows={3} value={headersText} onChange={(e) => setHeadersText(e.target.value)} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
      {method !== 'GET' && method !== 'HEAD' && (
        <textarea placeholder="Request body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="w-full mb-2 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 font-mono" />
      )}
      {response && !response.error && (
        <div className="mt-2 text-sm text-gray-200">
          <div>Status: <span className={response.status < 400 ? 'text-green-400' : 'text-red-400'}>{response.status} {response.statusText}</span></div>
          <div className="mt-2 text-xs text-gray-400">Headers:</div>
          <pre className="bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '15vh' }}>{response.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
          <div className="mt-2 text-xs text-gray-400">Body:</div>
          <pre className="bg-slate-800 p-2 rounded overflow-auto text-xs" style={{ maxHeight: '30vh' }}>{response.body}</pre>
        </div>
      )}
      {response?.error && <p className="text-red-400 text-sm mt-2">{response.error}</p>}
    </div>
  );
}
