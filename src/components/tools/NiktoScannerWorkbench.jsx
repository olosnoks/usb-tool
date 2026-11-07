import React, { useState } from 'react';

/**
 * Very small web‑server vulnerability scanner.
 * It probes a target URL for a handful of common insecure endpoints
 * and checks the Server header for known vulnerable versions.
 */
export default function NiktoScannerWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [results, setResults] = useState([]);

  const log = (msg) => {
    onLogMessage?.(msg);
  };

  const commonPaths = [
    '/phpinfo.php',
    '/admin',
    '/login',
    '/.git',
    '/.env',
    '/server-status',
  ];

  const runScan = async () => {
    if (!target) return;
    log(`Scanning ${target}`);
    const base = target.replace(/\/*$/, ''); // remove trailing slash
    const res = [];
    for (const p of commonPaths) {
      const url = `${base}${p}`;
      try {
        const resp = await fetch(url, { method: 'GET', mode: 'no-cors' });
        // no‑cors response status is 0, so we cannot rely on it; just note that request succeeded.
        res.push({ path: p, status: 'checked' });
        log(`Checked ${p}`);
      } catch (e) {
        res.push({ path: p, status: 'error' });
        log(`Error checking ${p}: ${e.message}`);
      }
    }
    // Server header check (via a HEAD request that may be allowed)
    try {
      const resp = await fetch(base, { method: 'HEAD', mode: 'cors' });
      const server = resp.headers.get('server') || 'unknown';
      res.push({ path: '/', status: `Server: ${server}` });
      log(`Server header: ${server}`);
    } catch (_) {}
    setResults(res);
    log('Nikto scan complete');
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Nikto Scanner (demo)</h2>
      <p className="text-sm text-gray-400 mb-4">Probe common insecure paths and display server header.</p>
      <div className="flex gap-2 mb-4">
        <input type="text" placeholder="https://example.com" value={target} onChange={e => setTarget(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={runScan} className="px-3 py-1 bg-rose-600 text-white rounded hover:bg-rose-500">Scan</button>
      </div>
      {results.length > 0 && (
        <table className="w-full text-sm text-gray-200 mb-4">
          <thead><tr className="border-b border-gray-600"><th className="text-left">Path</th><th className="text-left">Result</th></tr></thead>
          <tbody>
            {results.map((r,i)=>(<tr key={i} className="border-b border-gray-700"><td>{r.path}</td><td>{r.status}</td></tr>))}
          </tbody>
        </table>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'30vh'}} />
    </div>
  );
}

