import React, { useState, useRef } from 'react';
import { proxiedFetch, isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import WordlistPicker from './common/WordlistPicker';

/**
 * HTTP Basic-auth credential tester.
 * Tries each username/password pair against a target via the Authorization header
 * and reports the first 2xx response. Direct from the browser this works only
 * against CORS-permissive targets; configure a proxy to test arbitrary hosts.
 */
export default function HydraBruteforceWorkbench({ onLogMessage }) {
  const [url, setUrl] = useState('');
  const [users, setUsers] = useState('');
  const [passes, setPasses] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [tried, setTried] = useState(0);
  const cancelRef = useRef(false);

  const log = (msg) => onLogMessage?.(msg);

  const start = async () => {
    if (!url.trim()) return;
    const userList = users.split('\n').map((l) => l.trim()).filter(Boolean);
    const passList = passes.split('\n').map((l) => l.trim()).filter(Boolean);
    if (userList.length === 0 || passList.length === 0) return;
    setRunning(true);
    setResult(null);
    setTried(0);
    cancelRef.current = false;
    log(`Testing ${userList.length * passList.length} credential pair(s) against ${url}${isProxyEnabled() ? ' (via proxy)' : ' (direct)'}…`);
    let count = 0;
    for (const u of userList) {
      for (const p of passList) {
        if (cancelRef.current) { log('Cancelled'); setRunning(false); return; }
        count++;
        setTried(count);
        try {
          const resp = await proxiedFetch(url, {
            method: 'GET',
            headers: { Authorization: `Basic ${btoa(`${u}:${p}`)}` },
          });
          if (resp.status >= 200 && resp.status < 300) {
            setResult({ user: u, pass: p, status: resp.status });
            log(`Success: ${u}:${p} (HTTP ${resp.status})`);
            setRunning(false);
            return;
          }
        } catch (e) {
          if (count === 1) log(`Request failed: ${describeNetworkError(e)}`);
        }
      }
    }
    setResult({ user: null });
    log('No credential pair succeeded');
    setRunning(false);
  };

  return (
    <div className="p-4">
      <p className="text-sm text-gray-400 mb-3">Try username/password lists against an HTTP Basic-auth endpoint.</p>
      <ProxyConfig onLogMessage={onLogMessage} />
      <div className="grid gap-2 mb-4">
        <input placeholder="Target URL (e.g. https://example.com/protected)" value={url} onChange={(e) => setUrl(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <WordlistPicker category="usernames" max={5000} label="Usernames" onLoad={(lines) => setUsers(lines.join('\n'))} />
        <textarea placeholder="Usernames (one per line)" rows={4} value={users} onChange={(e) => setUsers(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" />
        <WordlistPicker category="passwords" max={10000} label="Passwords" onLoad={(lines) => setPasses(lines.join('\n'))} />
        <textarea placeholder="Passwords (one per line)" rows={4} value={passes} onChange={(e) => setPasses(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" />
        <div className="flex gap-2 mt-2">
          <button onClick={start} disabled={running} className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-500 disabled:opacity-40">
            {running ? `Trying… (${tried})` : 'Start'}
          </button>
          {running && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded hover:bg-slate-600">Stop</button>}
        </div>
      </div>
      {result && (
        <div className="mt-2 text-sm text-gray-200">
          {result.user ? (
            <span>✅ Success: <strong className="font-mono">{result.user}:{result.pass}</strong> (HTTP {result.status})</span>
          ) : (
            <span>❌ No credentials succeeded.</span>
          )}
        </div>
      )}
    </div>
  );
}
