import React, { useState, useEffect, useRef } from 'react';
import { loadWasmStatus } from '../../utils/wasmLoader';
import { scanHost, parsePorts } from '../../utils/portScan';
import { isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';

/**
 * TCP port scanner.
 *
 * Browsers cannot open raw sockets, so by default this uses a connect-timing
 * heuristic over fetch (see src/utils/portScan.js): a port that answers HTTP is
 * "open", a fast connection refusal is "closed", and a stall is "open|filtered".
 * If a WebAssembly scanning engine (public/wasm/portscanner.wasm) is present, it
 * is used instead for real results. See docs/WASM_ENGINES.md.
 */
export default function NmapScannerWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [portInput, setPortInput] = useState('80,443,8080,8443,8000,3000,5000,5173,9000');
  const [results, setResults] = useState([]);
  const [method, setMethod] = useState('browser'); // 'browser' | 'wasm'
  const [wasmExports, setWasmExports] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const cancelRef = useRef(false);

  const log = (msg) => onLogMessage?.(msg);

  // Probe for the optional WASM accelerator; fall back to the browser scanner.
  useEffect(() => {
    (async () => {
      const status = await loadWasmStatus('/wasm/portscanner.wasm', {});
      if (status.ok && typeof status.exports.scan === 'function') {
        setWasmExports(status.exports);
        setMethod('wasm');
        log('Port-scanner WASM engine loaded');
      } else {
        setMethod('browser');
        log('Using browser connect-timing scanner (no WASM engine present)');
      }
    })();
  }, []);

  const runWasmScan = (host, ports) => {
    const { memory, scan, malloc, free } = wasmExports;
    const write = (str, ptr) => new Uint8Array(memory.buffer, ptr, str.length).set(new TextEncoder().encode(str));
    const portsStr = ports.join(',');
    const tPtr = malloc(host.length + 1);
    const pPtr = malloc(portsStr.length + 1);
    write(host, tPtr); write(portsStr, pPtr);
    const resultPtr = scan(tPtr, host.length, pPtr, portsStr.length);
    const memU8 = new Uint8Array(memory.buffer);
    let end = resultPtr;
    while (memU8[end] !== 0) end++;
    const json = new TextDecoder().decode(memU8.subarray(resultPtr, end));
    free(tPtr); free(pPtr); free(resultPtr);
    return JSON.parse(json);
  };

  const runScan = async () => {
    const host = target.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) return;
    const ports = parsePorts(portInput);
    if (ports.length === 0) { log('No valid ports'); return; }
    setScanning(true);
    setResults([]);
    setProgress({ done: 0, total: ports.length });
    cancelRef.current = false;
    log(`Scanning ${host} across ${ports.length} port(s) via ${method}${isProxyEnabled() ? ' + proxy' : ''}…`);
    try {
      if (method === 'wasm') {
        const parsed = runWasmScan(host, ports);
        setResults(parsed);
        setProgress({ done: ports.length, total: ports.length });
      } else {
        let done = 0;
        const collected = [];
        await scanHost(host, ports, {
          concurrency: 8,
          shouldStop: () => cancelRef.current,
          onResult: (r) => {
            done++;
            collected.push(r);
            setProgress({ done, total: ports.length });
            if (r.state.startsWith('open') || r.state === 'blocked') setResults((prev) => [...prev, r].sort((a, b) => a.port - b.port));
            log(`${host}:${r.port} ${r.state}${r.service ? ' (' + r.service + ')' : ''}`);
          },
        });
        if (collected.every((r) => r.state === 'closed')) {
          log('All ports closed/unreachable. From an HTTPS page only HTTPS targets and localhost are reachable without a proxy.');
        }
      }
      log('Scan complete');
    } catch (e) {
      log(`Scan error: ${e.message}`);
    }
    setScanning(false);
  };

  const openResults = results.filter((r) => r.state.startsWith('open'));
  const confirmedOpen = results.filter((r) => r.state === 'open');
  const ambiguous = results.filter((r) => r.state === 'open|filtered');
  const blockedResults = results.filter((r) => r.state === 'blocked');
  const shownResults = [...openResults, ...blockedResults].sort((a, b) => a.port - b.port);

  return (
    <div className="p-4">
      <p className="text-sm text-gray-400 mb-3">
        {method === 'wasm'
          ? 'Scanning via the WebAssembly engine.'
          : 'Connect-timing scan over fetch (browser heuristic). Open = HTTP service answered; closed = refused; open|filtered = stalled.'}
      </p>
      <ProxyConfig onLogMessage={onLogMessage} />
      <div className="flex gap-2 mb-2">
        <input type="text" placeholder="target host (e.g. scanme.nmap.org or 127.0.0.1)" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <input type="text" placeholder="ports (e.g. 1-100,443,8080)" value={portInput} onChange={(e) => setPortInput(e.target.value)} className="w-56 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={runScan} disabled={scanning} className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-40">
          {scanning ? `Scanning ${progress.done}/${progress.total}` : 'Scan'}
        </button>
        {scanning && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded hover:bg-slate-600">Stop</button>}
      </div>
      {!scanning && progress.total > 0 && (
        <p className="text-xs text-gray-500 mb-2">
          {progress.done}/{progress.total} probed · {confirmedOpen.length} open
          {ambiguous.length ? ` · ${ambiguous.length} open|filtered` : ''}
          {blockedResults.length ? ` · ${blockedResults.length} browser-blocked` : ''}.
        </p>
      )}
      {shownResults.length > 0 && (
        <table className="w-full text-sm text-gray-200 border-collapse mt-2">
          <thead><tr className="border-b border-gray-600 text-left"><th className="pr-3">Port</th><th className="pr-3">State</th><th className="pr-3">Service</th><th>Time</th></tr></thead>
          <tbody>
            {shownResults.map((r, i) => (
              <tr key={i} className="border-b border-gray-800">
                <td className="pr-3 font-mono">{r.port}</td>
                <td className={`pr-3 ${r.state === 'open' ? 'text-green-400' : r.state === 'blocked' ? 'text-gray-500' : 'text-yellow-400'}`}>{r.state}</td>
                <td className="pr-3">{r.service || '—'}</td>
                <td className="text-gray-500">{r.ms != null ? `${r.ms}ms` : r.state === 'blocked' ? 'browser-restricted' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
