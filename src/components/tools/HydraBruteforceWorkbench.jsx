import React, { useState } from 'react';

/**
 * Simple bruteforce demo using HTTP Basic authentication.
 * The user provides a target URL, a list of usernames and a list of passwords.
 * The tool attempts each combination via fetch with the `Authorization` header.
 * This is a demonstration only – real Hydra performs many more protocols.
 */
export default function HydraBruteforceWorkbench({ onLogMessage }) {
  const [url, setUrl] = useState('');
  const [users, setUsers] = useState(''); // newline‑separated
  const [passes, setPasses] = useState(''); // newline‑separated
  const [result, setResult] = useState(null);

  const log = (msg) => {
    onLogMessage?.(msg);
  };

  const encodeCreds = (u, p) => {
    return btoa(`${u}:${p}`);
  };

  const start = async () => {
    if (!url) return;
    const userList = users.split('\n').map(l=>l.trim()).filter(Boolean);
    const passList = passes.split('\n').map(l=>l.trim()).filter(Boolean);
    log(`Starting bruteforce against ${url} …`);
    for (const u of userList) {
      for (const p of passList) {
        const creds = encodeCreds(u, p);
        try {
          const resp = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `Basic ${creds}` },
            mode: 'cors',
          });
          if (resp.status >= 200 && resp.status < 300) {
            setResult({ user: u, pass: p, status: resp.status });
            log(`Success: ${u}:${p} (status ${resp.status})`);
            return;
          }
        } catch (e) {
          // network errors are ignored
        }
      }
    }
    setResult({ user: null });
    log('No valid credential pair found');
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Hydra Bruteforce (demo)</h2>
      <p className="text-sm text-gray-400 mb-4">Attempt HTTP Basic auth with supplied username/password lists.</p>
      <div className="grid gap-2 mb-4">
        <input placeholder="Target URL (e.g. https://example.com/protected)" value={url} onChange={e=>setUrl(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <textarea placeholder="Usernames (one per line)" rows={4} value={users} onChange={e=>setUsers(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"></textarea>
        <textarea placeholder="Passwords (one per line)" rows={4} value={passes} onChange={e=>setPasses(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"></textarea>
        <button onClick={start} className="px-3 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-500 mt-2">Start</button>
      </div>
      {result && (
        <div className="mt-2 text-sm text-gray-200">
          {result.user ? (
            <span>✅ Success: <strong>{result.user}:{result.pass}</strong> (status {result.status})</span>
          ) : (
            <span>❌ No credentials succeeded.</span>
          )}
        </div>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'30vh'}} />
    </div>
  );
}

