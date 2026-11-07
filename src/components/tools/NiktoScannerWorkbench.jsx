import React, { useState, useRef, useEffect } from 'react';
import { proxiedFetch, isProxyEnabled, describeNetworkError } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import WordlistPicker from './common/WordlistPicker';

/**
 * Web path prober / content discovery. Requests a list of paths and reports the
 * HTTP status of each, plus the Server response header. Paths come from a small
 * built-in list or a SecLists wordlist (via the wordlist loader).
 *
 * Honest limitation: a browser can only read cross-origin responses when the
 * target sends permissive CORS headers. Without a proxy, most responses are
 * unreadable (the request may still reach the server, but the status is hidden).
 * Configure a proxy to get real status codes against arbitrary hosts.
 */
const BUILTIN_PATHS = [
  '/.git/HEAD', '/.env', '/.htaccess', '/admin', '/administrator', '/login',
  '/wp-login.php', '/phpinfo.php', '/server-status', '/.well-known/security.txt',
  '/robots.txt', '/config.php.bak', '/backup.zip', '/.DS_Store', '/api', '/swagger.json',
];

// A response is worth showing: any 2xx/3xx, or auth-gated (401/403).
function isInteresting(status) {
  return (status >= 200 && status < 400) || status === 401 || status === 403;
}
const norm = (p) => (p.startsWith('/') || /^https?:\/\//.test(p) ? p : `/${p}`);

function reportMarkdown(base, server, found, probed) {
  const out = [`- **Server:** ${server || 'unknown'}`, `- **Probed:** ${probed} path(s) · ${found.length} interesting`, ''];
  if (found.length === 0) out.push('No interesting paths found.');
  else found.forEach((r) => out.push(`- \`${r.status}\` ${base}${r.path}`));
  return out.join('\n');
}

export default function NiktoScannerWorkbench({ onLogMessage, hideProxyConfig = false, onReport, initialTarget = '', fixedTarget }) {
  // When fixedTarget is provided (embedded in Web Analyzer), the parent owns the
  // URL and this component renders no URL input of its own.
  const controlled = fixedTarget !== undefined;
  const [target, setTarget] = useState(initialTarget);
  useEffect(() => { if (initialTarget) setTarget(initialTarget); }, [initialTarget]);
  const effectiveTarget = controlled ? fixedTarget : target;
  const [paths, setPaths] = useState(null); // loaded wordlist, or null => builtin
  const [results, setResults] = useState([]); // interesting only
  const [server, setServer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, blocked: 0 });
  const cancelRef = useRef(false);

  const log = (msg) => onLogMessage?.(msg);

  const runScan = async () => {
    const base = (effectiveTarget || '').trim().replace(/\/+$/, '');
    if (!base) return;
    const list = (paths && paths.length ? paths : BUILTIN_PATHS).map(norm);
    setBusy(true);
    setResults([]);
    setServer(null);
    setProgress({ done: 0, total: list.length, blocked: 0 });
    cancelRef.current = false;
    log(`Probing ${list.length} path(s) on ${base}${isProxyEnabled() ? ' (via proxy)' : ' (direct, CORS-limited)'}…`);

    let serverVal;
    try {
      const resp = await proxiedFetch(base, { method: 'HEAD' });
      serverVal = resp.headers.get('server') || 'not disclosed';
    } catch (e) {
      serverVal = `unreadable (${describeNetworkError(e)})`;
    }
    setServer(serverVal);

    let done = 0;
    let blocked = 0;
    const found = [];
    const queue = [...list];
    const worker = async () => {
      while (queue.length) {
        if (cancelRef.current) return;
        const p = queue.shift();
        const url = /^https?:\/\//.test(p) ? p : `${base}${p}`;
        try {
          const resp = await proxiedFetch(url, { method: 'GET', redirect: 'manual' });
          if (isInteresting(resp.status)) {
            found.push({ path: p, status: resp.status });
            setResults([...found].sort((a, b) => a.path.localeCompare(b.path)));
          }
        } catch {
          blocked += 1;
        }
        done += 1;
        if (done % 10 === 0 || !queue.length) setProgress({ done, total: list.length, blocked });
      }
    };
    await Promise.all(Array.from({ length: Math.min(12, list.length) }, worker));
    setProgress({ done, total: list.length, blocked });
    if (!isProxyEnabled() && blocked === list.length) log('All responses blocked by CORS. Configure a proxy to read real statuses.');
    log(cancelRef.current ? 'Scan cancelled' : `Scan complete — ${found.length} interesting of ${list.length}`);
    onReport?.({ url: base, markdown: reportMarkdown(base, serverVal, [...found].sort((a, b) => a.path.localeCompare(b.path)), done) });
    setBusy(false);
  };

  return (
    <div className="p-4">
      <p className="text-sm text-gray-400 mb-3">Content discovery: probe paths from a wordlist and flag interesting responses.</p>
      {!hideProxyConfig && <ProxyConfig onLogMessage={onLogMessage} />}
      <WordlistPicker category="paths" max={5000} label="Path list" onLoad={(lines, meta) => { setPaths(lines); log(`Path list: ${lines.length} entries (${meta.name})`); }} />
      <div className="text-xs text-gray-500 mb-2">{paths ? `${paths.length.toLocaleString()} paths loaded` : `Using built-in list (${BUILTIN_PATHS.length} paths)`}</div>
      <div className="flex gap-2 mb-3">
        {!controlled && <input type="text" placeholder="https://example.com" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />}
        <button onClick={runScan} disabled={busy || !effectiveTarget?.trim()} className="px-3 py-1 bg-rose-600 text-white rounded hover:bg-rose-500 disabled:opacity-40">{busy ? `Scanning ${progress.done}/${progress.total}` : 'Scan'}</button>
        {busy && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded hover:bg-slate-600">Stop</button>}
      </div>
      {server && <div className="mb-2 text-sm text-gray-300">Server: <span className="font-mono text-gray-100">{server}</span></div>}
      {progress.total > 0 && <div className="text-xs text-gray-500 mb-2">{progress.done}/{progress.total} probed · {results.length} interesting · {progress.blocked} blocked/unreachable</div>}
      {results.length > 0 && (
        <div className="overflow-auto" style={{ maxHeight: '45vh' }}>
          <table className="w-full text-sm text-gray-200 border-collapse font-mono">
            <thead className="sticky top-0 bg-slate-800"><tr className="text-left"><th className="pr-2 p-1">Path</th><th className="p-1">Status</th></tr></thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className="border-b border-gray-800">
                  <td className="pr-2 p-1 break-all">{r.path}</td>
                  <td className={`p-1 ${r.status >= 200 && r.status < 300 ? 'text-green-400 font-bold' : r.status === 401 || r.status === 403 ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
