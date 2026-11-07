import React, { useState, useEffect } from 'react';
import { loadWasmStatus } from '../../utils/wasmLoader';
import EngineNotice from './common/EngineNotice';

/**
 * Port scanner front-end for a WebAssembly scanning engine.
 *
 * Important: a browser cannot open raw TCP sockets, so real port scanning is not
 * possible from the page alone. This tool is wired to a WASM engine
 * (public/wasm/portscanner.wasm) that must perform the scanning (for example by
 * proxying connections through a companion transport the engine provides). Until
 * that engine is built, the tool reports its absence honestly rather than faking
 * results. See docs/WASM_ENGINES.md for the export contract.
 */
const CONTRACT = `// public/wasm/portscanner.wasm exports:
memory : WebAssembly.Memory
malloc(size:i32) -> ptr:i32
free(ptr:i32) -> void
// scan(targetPtr, targetLen, portsPtr, portsLen) -> resultPtr (null-terminated UTF-8 JSON)
// JSON: [{ "port": 80, "state": "open", "service": "http" }, ...]
scan(i32,i32,i32,i32) -> i32`;

const BUILD_HINT = `Build the engine with the emsdk submodule, then place the output at public/wasm/portscanner.wasm.
A browser engine must route TCP through a transport it controls (e.g. a WebSocket/WebTransport relay); raw sockets are unavailable in the page.`;

export default function NmapScannerWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [portInput, setPortInput] = useState('80,443,22,21,23,8080,8443');
  const [results, setResults] = useState([]);
  const [engine, setEngine] = useState({ state: 'loading', error: '', exports: null });
  const [scanning, setScanning] = useState(false);

  const log = (msg) => onLogMessage?.(msg);

  useEffect(() => {
    (async () => {
      log('Loading port-scanner engine…');
      const status = await loadWasmStatus('/wasm/portscanner.wasm', {});
      if (status.ok && typeof status.exports.scan === 'function') {
        setEngine({ state: 'ready', error: '', exports: status.exports });
        log('Port-scanner engine loaded');
      } else {
        setEngine({ state: 'unavailable', error: status.error || 'scan export missing', exports: null });
        log(`Port-scanner engine unavailable: ${status.error}`);
      }
    })();
  }, []);

  const writeString = (str, memory, ptr) => {
    new Uint8Array(memory.buffer, ptr, str.length).set(new TextEncoder().encode(str));
  };

  const runScan = async () => {
    if (engine.state !== 'ready' || !target) return;
    setScanning(true);
    setResults([]);
    log(`Scanning ${target} on ports ${portInput}…`);
    try {
      const { memory, scan, malloc, free } = engine.exports;
      const tPtr = malloc(target.length + 1);
      const pPtr = malloc(portInput.length + 1);
      writeString(target, memory, tPtr);
      writeString(portInput, memory, pPtr);
      const resultPtr = scan(tPtr, target.length, pPtr, portInput.length);
      const memU8 = new Uint8Array(memory.buffer);
      let end = resultPtr;
      while (memU8[end] !== 0) end++;
      const json = new TextDecoder().decode(memU8.subarray(resultPtr, end));
      free(tPtr); free(pPtr); free(resultPtr);
      setResults(JSON.parse(json));
      log('Scan complete');
    } catch (e) {
      log(`Scan error: ${e.message}`);
    }
    setScanning(false);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Port Scanner (WASM engine)</h2>
      <p className="text-sm text-gray-400 mb-3">Scan a host for open TCP ports via a WebAssembly engine.</p>
      <div className="mb-3">
        <EngineNotice
          title="Port scanner"
          state={engine.state === 'unavailable' ? 'unavailable' : engine.state}
          error={engine.error}
          buildHint={BUILD_HINT}
          contract={CONTRACT}
        />
      </div>
      <div className="flex gap-2 mb-4">
        <input type="text" placeholder="target host (e.g. example.com)" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <input type="text" placeholder="ports (comma-separated)" value={portInput} onChange={(e) => setPortInput(e.target.value)} className="w-48 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={runScan} disabled={engine.state !== 'ready' || scanning} className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-40">
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
      </div>
      {results.length > 0 && (
        <table className="w-full text-sm text-gray-200 border-collapse">
          <thead><tr className="border-b border-gray-600 text-left"><th>Port</th><th>State</th><th>Service</th></tr></thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-gray-800"><td>{r.port}</td><td>{r.state}</td><td>{r.service || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
