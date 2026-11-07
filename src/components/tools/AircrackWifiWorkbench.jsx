import React, { useState, useEffect } from 'react';
import { crack_pmkid, initAircrack } from '../../utils/aircrackWrapper';

/**
 * Aircrack‑Wifi (PMKID) workbench – client‑side WPA‑PSK cracking using WebAssembly.
 * The UI collects SSID, AP MAC, Client MAC, captured PMKID (hex) and a wordlist.
 * It loads the pre‑compiled `aircrack.wasm` module (pbkdf2_eapol.wasm) which
 * exports a `crack` function. The function returns a null‑terminated string with
 * the cracked password or an empty string if no match.
 *
 * No demo fallback is provided – the workbench requires the WASM binary to be
 * available. If the module fails to load, an error is logged and cracking cannot
 * proceed.
 */
export default function AircrackWifiWorkbench({ onLogMessage }) {
  // Input state
  const [ssid, setSsid] = useState('');
  const [apMac, setApMac] = useState(''); // AA:BB:CC:DD:EE:FF
  const [clientMac, setClientMac] = useState('');
  const [pmkid, setPmkid] = useState(''); // 8‑hex chars
  const [wordlist, setWordlist] = useState('');
  const [result, setResult] = useState(null);

  // WASM loading state
  const [wasmReady, setWasmReady] = useState(false);

  const log = (msg) => {
    onLogMessage?.(msg);
  };

  // Initialise the Aircrack WASM module on mount
  useEffect(() => {
    (async () => {
      log('Loading Aircrack WASM…');
      const module = await initAircrack();
      if (module) {
        setWasmReady(true);
        log('Aircrack WASM loaded');
      } else {
        log('Failed to load Aircrack WASM – cracking unavailable');
      }
    })();
  }, []);

  // Perform cracking using the WASM export
  const startCrack = async () => {
    if (!ssid || !apMac || !clientMac || !pmkid || !wordlist) return;
    if (!wasmReady) {
      log('WASM not loaded – cannot perform cracking');
      return;
    }
    log('Starting PMKID crack …');
    const pwd = await crack_pmkid(ssid, apMac, clientMac, pmkid, wordlist);
    if (pwd) {
      setResult({ password: pwd });
      log(`Password found: ${pwd}`);
    } else {
      setResult({ password: null });
      log('No password matched the PMKID (WASM)');
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Aircrack Wi‑Fi (PMKID)</h2>
      <p className="text-sm text-gray-400 mb-4">
        Enter capture details and a wordlist to brute‑force the PSK.
      </p>
      <div className="grid gap-2 mb-4">
        <input placeholder="SSID" value={ssid} onChange={e => setSsid(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <input placeholder="AP MAC (AA:BB:CC:DD:EE:FF)" value={apMac} onChange={e => setApMac(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <input placeholder="Client MAC" value={clientMac} onChange={e => setClientMac(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <input placeholder="Captured PMKID (8 hex chars)" value={pmkid} onChange={e => setPmkid(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <textarea placeholder="Wordlist (one per line)" rows={6} value={wordlist} onChange={e => setWordlist(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <button onClick={startCrack} className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500 mt-2">Crack</button>
      </div>
      {result && (
        <div className="mt-2 text-sm text-gray-200">
          {result.password ? (
            <span>✅ Password: <strong>{result.password}</strong></span>
          ) : (
            <span>❌ No matching password.</span>
          )}
        </div>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'30vh'}} />
    </div>
  );
}
