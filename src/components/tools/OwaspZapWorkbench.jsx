import React, { useState } from 'react';

/**
 * OWASP ZAP‑Lite Workbench – a thin client‑side wrapper around a WebAssembly‑compiled
 * subset of the ZAP scanner. Users provide a target URL, start a passive/active scan,
 * and the component displays the list of alerts (severity, description, CWE).
 *
 * The component loads `zap.wasm` from `/wasm/zap.wasm`. If the binary cannot be
 * loaded, an error message is shown – there is no demo fallback.
 */
export default function OwaspZapWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [running, setRunning] = useState(false);
  const [alerts, setAlerts] = useState([]);

  const log = (msg) => onLogMessage?.(msg);

  const loadZap = async () => {
    try {
      const resp = await fetch('/wasm/zap.wasm');
      const buffer = await resp.arrayBuffer();
      const { default: ZAP } = await import('../../utils/zapWrapper'); // wrapper expected
      const instance = await ZAP(buffer);
      return instance;
    } catch (e) {
      log(`Failed to load ZAP WASM: ${e.message}`);
      return null;
    }
  };

  const startScan = async () => {
    if (!target) return;
    setRunning(true);
    log(`Starting ZAP scan on ${target}`);
    const zap = await loadZap();
    if (!zap) {
      setRunning(false);
      return;
    }
    try {
      const raw = await zap.runScan(target);
      // Assume raw is JSON string of alerts
      const parsed = JSON.parse(raw);
      setAlerts(parsed);
      log(`ZAP scan completed – ${parsed.length} alert(s) found`);
    } catch (e) {
      log(`ZAP scan error: ${e.message}`);
    }
    setRunning(false);
  };

  return (
    <div className="p-4 space-y-4 font-mono text-xs">
      <h2 className="text-lg font-bold">ZAP (client‑side) Security Scan</h2>
      <div className="flex gap-2 mb-2">
        <input
          type="url"
          placeholder="Target URL (e.g. https://example.com)"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"
        />
        <button
          onClick={startScan}
          disabled={running}
          className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-500 disabled:opacity-40"
        >
          {running ? 'Scanning…' : 'Start Scan'}
        </button>
      </div>
      {alerts.length > 0 && (
        <div className="overflow-auto max-h-96">
          <table className="w-full table-auto border-collapse border border-slate-600 text-sm">
            <thead className="bg-slate-800 text-slate-100">
              <tr>
                <th className="p-1 border">Severity</th>
                <th className="p-1 border">CWE</th>
                <th className="p-1 border">Description</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, i) => (
                <tr key={i} className={i % 2 ? 'bg-slate-900' : ''}>
                  <td className="p-1 border">{a.severity}</td>
                  <td className="p-1 border">{a.cwe || '—'}</td>
                  <td className="p-1 border">{a.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

