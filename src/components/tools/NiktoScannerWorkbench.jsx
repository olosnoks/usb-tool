import React, { useState } from 'react';
import { proxiedFetch, isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';

/**
 * Web path prober. Requests a list of commonly sensitive paths and reports the
 * HTTP status of each, plus the Server response header.
 *
 * Honest limitation: a browser can only read cross-origin responses when the
 * target sends permissive CORS headers. Without a proxy, most responses are
 * unreadable (the request may still reach the server, but the status is hidden).
 * Configure a proxy to get real status codes against arbitrary hosts.
 */
const COMMON_PATHS = [
  '/.git/HEAD', '/.env', '/.htaccess', '/admin', '/administrator', '/login',
  '/wp-login.php', '/phpinfo.php', '/server-status', '/.well-known/security.txt',
  '/robots.txt', '/config.php.bak', '/backup.zip', '/.DS_Store', '/api', '/swagger.json',
];

function interesting(status) {
  return [200, 201, 301, 302, 401, 403, 500].includes(status);
}

export default function NiktoScannerWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [results, setResults] = useState([]);
  const [server, setServer] = useState(null);
  const [busy, setBusy] = useState(false);

  const log = (msg) => onLogMessage?.(msg);

  const runScan = async () => {
    const base = target.trim().replace(/\/+$/, '');
    if (!base) return;
    setBusy(true);
    setResults([]);
    setServer(null);
    log(`Probing ${base}${isProxyEnabled() ? ' (via proxy)' : ' (direct, CORS-limited)'}…`);

    try {
      const resp = await proxiedFetch(base, { method: 'HEAD' });
      setServer(resp.headers.get('server') || 'not disclosed');
      log(`Server header: ${resp.headers.get('server') || 'not disclosed'}`);
    } catch (e) {
      setServer(`unreadable (${describeNetworkError(e)})`);
    }

    const out = [];
    for (const p of COMMON_PATHS) {
      try {
        const resp = await proxiedFetch(`${base}${p}`, { method: 'GET' });
        out.push({ path: p, status: resp.status, flag: interesting(resp.status) });
        log(`${p} → ${resp.status}`);
      } catch (e) {
        out.push({ path: p, status: 'blocked', note: 'CORS/unreachable' });
      }
      setResults([...out]);
    }
    if (!isProxyEnabled() && out.every((r) => r.status === 'blocked')) {
      log('All responses blocked by CORS. Configure a proxy to read real statuses.');
    }
    setBusy(false);
  };

  return (
    <div className="p-4">
      <p className="text-sm text-gray-400 mb-3">Check common sensitive paths and the server header.</p>
      <ProxyConfig onLogMessage={onLogMessage} />
      <div className="flex gap-2 mb-3">
        <input type="text" placeholder="https://example.com" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={runScan} disabled={busy} className="px-3 py-1 bg-rose-600 text-white rounded hover:bg-rose-500 disabled:opacity-40">{busy ? 'Scanning…' : 'Scan'}</button>
      </div>
      {server && <div className="mb-2 text-sm text-gray-300">Server: <span className="font-mono text-gray-100">{server}</span></div>}
      {results.length > 0 && (
        <table className="w-full text-sm text-gray-200 border-collapse font-mono">
          <thead><tr className="border-b border-gray-600 text-left"><th className="pr-2">Path</th><th>Status</th></tr></thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-gray-800">
                <td className="pr-2">{r.path}</td>
                <td className={r.flag ? 'text-yellow-400 font-bold' : r.status === 'blocked' ? 'text-gray-500' : 'text-gray-300'}>
                  {r.status}{r.note ? ` (${r.note})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
