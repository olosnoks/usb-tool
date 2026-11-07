import React, { useState, useEffect } from 'react';
import { loadWasm } from '../../utils/wasmLoader';

/**
 * Production‑ready port scanner using a WebAssembly‑compiled port‑scanning engine.
 * The WASM binary (public/wasm/portscanner.wasm) exports a `scan` function that
 * accepts a target string and a comma‑separated list of ports, returning a JSON
 * string describing the results. GPU acceleration can be leveraged inside the
 * WASM implementation (e.g., using WebGPU via Emscripten).
 */
export default function NmapScannerWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [portInput, setPortInput] = useState('80,443,22,21,23,8080,8443');
  const [results, setResults] = useState([]);
  const [wasm, setWasm] = useState(null);

  const log = (msg) => onLogMessage?.(msg);

  // Load the WASM module once on mount
  useEffect(() => {
    (async () => {
      log('Loading port‑scanner WASM…');
      const module = await loadWasm('/wasm/portscanner.wasm', {});
      if (module) {
        setWasm(module);
        log('WASM loaded');
      } else {
        log('Failed to load WASM');
      }
    })();
  }, []);

  const writeStringToMemory = (str, memory, offset) => {
    const encoder = new TextEncoder();
    const view = new Uint8Array(memory.buffer, offset, str.length);
    view.set(encoder.encode(str));
    return str.length;
  };

  const runScan = async () => {
    if (!wasm) {
      log('WASM not ready');
      return;
    }
    if (!target) return;
    log(`Scanning ${target} on ports ${portInput}…`);
    const { memory, scan, malloc, free } = wasm;
    // Allocate memory for the two input strings
    const targetPtr = malloc(target.length + 1);
    const portsPtr = malloc(portInput.length + 1);
    writeStringToMemory(target, memory, targetPtr);
    writeStringToMemory(portInput, memory, portsPtr);
    // Call the scanner – it returns a pointer to a null‑terminated JSON string
    const resultPtr = scan(targetPtr, target.length, portsPtr, portInput.length);
    // Read the JSON result string
    const memU8 = new Uint8Array(memory.buffer);
    let end = resultPtr;
    while (memU8[end] !== 0) end++;
    const jsonStr = new TextDecoder().decode(memU8.subarray(resultPtr, end));
    // Clean up allocations
    free(targetPtr);
    free(portsPtr);
    free(resultPtr);
    let parsed = [];
    try {
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      log('Failed to parse scan result');
    }
    setResults(parsed);
    log('Scan complete');
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Port Scanner (WASM)</h2>
      <p className="text-sm text-gray-400 mb-4">
        Scans the specified host for open TCP ports using a WebAssembly engine (no backend).
      </p>
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="target host (e.g. example.com)"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"
        />
        <input
          type="text"
          placeholder="ports (comma‑separated)"
          value={portInput}
          onChange={(e) => setPortInput(e.target.value)}
          className="w-48 bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"
        />
        <button
          onClick={runScan}
          className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500"
        >
          Scan
        </button>
      </div>
      {results.length > 0 && (
        <table className="w-full text-sm text-gray-200 mb-4 border-collapse">
          <thead><tr className="border-b border-gray-600"><th className="text-left">Port</th><th className="text-left">State</th><th className="text-left">Service</th></tr></thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-b border-gray-700">
                <td>{r.port}</td><td>{r.state}</td><td>{r.service || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'30vh'}} />
    </div>
  );
}

