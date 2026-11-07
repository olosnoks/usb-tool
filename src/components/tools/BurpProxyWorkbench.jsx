import React, { useState } from 'react';

/**
 * Simple MITM proxy demo using the browser's fetch to forward a request.
 * This does NOT implement a real proxy (browsers cannot act as a network proxy),
 * but demonstrates how a user could forward a request and view the response.
 */
export default function BurpProxyWorkbench({ onLogMessage }) {
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [response, setResponse] = useState(null);

  const log = (msg) => {
    onLogMessage?.(msg);
  };

  const send = async () => {
    if (!url) return;
    log(`Sending ${method} to ${url}`);
    try {
      const resp = await fetch(url, { method, mode: 'cors' });
      const text = await resp.text();
      setResponse({ status: resp.status, headers: [...resp.headers.entries()], body: text });
      log(`Received status ${resp.status}`);
    } catch (e) {
      log(`Error: ${e.message}`);
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Burp Proxy (demo)</h2>
      <p className="text-sm text-gray-400 mb-4">Forward a request and view response – illustrative only.</p>
      <div className="flex gap-2 mb-2">
        <select value={method} onChange={e => setMethod(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200">
          <option>GET</option><option>POST</option><option>PUT</option><option>DELETE</option>
        </select>
        <input type="text" placeholder="https://example.com/api" value={url} onChange={e => setUrl(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={send} className="px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-500">Send</button>
      </div>
      {response && (
        <div className="mt-4 text-sm text-gray-200">
          <div>Status: {response.status}</div>
          <div className="mt-2">Headers:</div>
          <pre className="bg-slate-800 p-2 rounded overflow-auto" style={{maxHeight:'10vh'}}>{response.headers.map(([k,v])=>`${k}: ${v}`).join('\n')}</pre>
          <div className="mt-2">Body:</div>
          <pre className="bg-slate-800 p-2 rounded overflow-auto" style={{maxHeight:'20vh'}}>{response.body}</pre>
        </div>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'20vh'}} />
    </div>
  );
}
