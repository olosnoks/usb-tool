import React, { useState, useEffect } from 'react';
import { loadZapEngine } from '../../utils/zapWrapper';
import EngineNotice from './common/EngineNotice';

/**
 * Front-end for a WebAssembly web-scanning engine (OWASP ZAP-style).
 * Active scanning of arbitrary origins is not possible from a browser alone;
 * the WASM engine (public/wasm/zap.wasm) must carry the scanning logic and its
 * own transport. Until it is built this tool reports its absence rather than
 * faking alerts. See docs/WASM_ENGINES.md.
 */
const CONTRACT = `// public/wasm/zap.wasm exports:
memory : WebAssembly.Memory
malloc(size:i32) -> ptr:i32
free(ptr:i32) -> void
// scan(urlPtr, urlLen) -> resultPtr (null-terminated UTF-8 JSON)
// JSON: [{ "severity": "High", "cwe": "79", "desc": "Reflected XSS in q param" }, ...]
scan(i32,i32) -> i32`;

const BUILD_HINT = `Build the engine with the emsdk submodule and place it at public/wasm/zap.wasm.
The engine must route HTTP through a transport it controls; the browser cannot scan cross-origin targets directly.`;

export default function OwaspZapWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [running, setRunning] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [engine, setEngine] = useState({ state: 'loading', error: '' });

  const log = (msg) => onLogMessage?.(msg);

  useEffect(() => {
    (async () => {
      const res = await loadZapEngine();
      if (res.ok) {
        setEngine({ state: 'ready', error: '' });
        log('ZAP engine loaded');
      } else {
        setEngine({ state: 'unavailable', error: res.error });
        log(`ZAP engine unavailable: ${res.error}`);
      }
    })();
  }, []);

  const startScan = async () => {
    if (!target || engine.state !== 'ready') return;
    setRunning(true);
    setAlerts([]);
    log(`Scanning ${target}…`);
    try {
      const res = await loadZapEngine();
      const found = await res.scan(target);
      setAlerts(found);
      log(`Scan complete — ${found.length} alert(s)`);
    } catch (e) {
      log(`Scan error: ${e.message}`);
    }
    setRunning(false);
  };

  return (
    <div className="p-4 space-y-3">
      <h2 className="text-lg font-bold">Web Scanner (WASM engine)</h2>
      <p className="text-sm text-gray-400">Passive/active web vulnerability scan via a WebAssembly engine.</p>
      <EngineNotice title="Web scanner" state={engine.state} error={engine.error} buildHint={BUILD_HINT} contract={CONTRACT} />
      <div className="flex gap-2">
        <input type="url" placeholder="Target URL (e.g. https://example.com)" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={startScan} disabled={engine.state !== 'ready' || running} className="px-3 py-1 bg-orange-600 text-white rounded hover:bg-orange-500 disabled:opacity-40">
          {running ? 'Scanning…' : 'Start Scan'}
        </button>
      </div>
      {alerts.length > 0 && (
        <div className="overflow-auto max-h-96">
          <table className="w-full table-auto border-collapse border border-slate-600 text-sm">
            <thead className="bg-slate-800 text-slate-100"><tr><th className="p-1 border border-slate-600">Severity</th><th className="p-1 border border-slate-600">CWE</th><th className="p-1 border border-slate-600">Description</th></tr></thead>
            <tbody>
              {alerts.map((a, i) => (
                <tr key={i} className={i % 2 ? 'bg-slate-900' : ''}>
                  <td className="p-1 border border-slate-700">{a.severity}</td>
                  <td className="p-1 border border-slate-700">{a.cwe || '—'}</td>
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
