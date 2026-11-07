import React, { useState, useEffect } from 'react';
import { loadZapEngine } from '../../utils/zapWrapper';
import { runPassiveScan } from '../../utils/webScan';
import { isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';

/**
 * Web security scanner.
 *
 * By default this runs a real passive scan (src/utils/webScan.js): it inspects the
 * target's response for missing security headers, information disclosure, insecure
 * cookies, cleartext transport, and permissive CORS, each mapped to a severity and
 * CWE. Reading cross-origin headers needs CORS, so a proxy gives the most complete
 * results.
 *
 * Active scanning (crafting malicious requests) cannot be done from a browser; if a
 * WebAssembly engine is present at public/wasm/zap.wasm it is used for that. See
 * docs/WASM_ENGINES.md.
 */
const SEV_COLOR = { High: 'text-red-400', Medium: 'text-orange-400', Low: 'text-yellow-400', Info: 'text-gray-400' };

function reportMarkdown(url, alerts) {
  if (!alerts || alerts.length === 0) return 'No passive findings.';
  const out = [`${alerts.length} finding(s):`, ''];
  alerts.forEach((a) => out.push(`- **${a.severity}**${a.cwe ? ` (CWE-${a.cwe})` : ''} — ${a.desc}`));
  return out.join('\n');
}

export default function OwaspZapWorkbench({ onLogMessage, hideProxyConfig = false, onReport }) {
  const [target, setTarget] = useState('');
  const [running, setRunning] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [note, setNote] = useState('');
  const [hasEngine, setHasEngine] = useState(false);

  const log = (msg) => onLogMessage?.(msg);

  useEffect(() => {
    (async () => {
      const res = await loadZapEngine();
      setHasEngine(res.ok);
      log(res.ok ? 'Active scan engine loaded' : 'Passive scan mode (no active engine present)');
    })();
  }, []);

  const startScan = async () => {
    const url = target.trim();
    if (!url) return;
    setRunning(true);
    setAlerts([]);
    setNote('');
    log(`Passive scan of ${url}${isProxyEnabled() ? ' (via proxy)' : ' (direct)'}…`);
    const passive = await runPassiveScan(url);
    if (!passive.ok) {
      setNote(`Error: ${passive.error}`);
      log(`Scan error: ${passive.error}`);
      setRunning(false);
      return;
    }
    let combined = passive.alerts;
    setNote(passive.note);
    log(`Passive scan done — ${passive.alerts.length} finding(s)`);

    if (hasEngine) {
      try {
        const res = await loadZapEngine();
        const active = await res.scan(url);
        combined = [...active, ...passive.alerts];
        log(`Active engine added ${active.length} finding(s)`);
      } catch (e) {
        log(`Active engine error: ${e.message}`);
      }
    }
    setAlerts(combined);
    onReport?.({ url, markdown: reportMarkdown(url, combined) });
    setRunning(false);
  };

  return (
    <div className="p-4 space-y-3">
      <p className="text-sm text-gray-400">
        Passive checks on a target's response (headers, cookies, transport, CORS).
        {hasEngine ? ' Active WASM engine present.' : ' Active scanning needs the optional WASM engine.'}
      </p>
      {!hideProxyConfig && <ProxyConfig onLogMessage={onLogMessage} />}
      <div className="flex gap-2">
        <input type="url" placeholder="Target URL (e.g. https://example.com)" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={startScan} disabled={running} className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-500 disabled:opacity-40">
          {running ? 'Scanning…' : 'Start Scan'}
        </button>
      </div>
      {note && <p className="text-xs text-gray-500">{note}</p>}
      {alerts.length > 0 && (
        <div className="overflow-auto max-h-96">
          <table className="w-full table-auto border-collapse border border-slate-600 text-sm">
            <thead className="bg-slate-800 text-slate-100"><tr><th className="p-1 border border-slate-600 text-left">Severity</th><th className="p-1 border border-slate-600 text-left">CWE</th><th className="p-1 border border-slate-600 text-left">Finding</th></tr></thead>
            <tbody>
              {alerts.map((a, i) => (
                <tr key={i} className={i % 2 ? 'bg-slate-900' : ''}>
                  <td className={`p-1 border border-slate-700 font-semibold ${SEV_COLOR[a.severity] || ''}`}>{a.severity}</td>
                  <td className="p-1 border border-slate-700 font-mono">{a.cwe ? `CWE-${a.cwe}` : '—'}</td>
                  <td className="p-1 border border-slate-700">{a.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
