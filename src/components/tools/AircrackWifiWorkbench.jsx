import React, { useState, useRef } from 'react';
import { crackPmkid } from '../../utils/aircrackWrapper';

/**
 * WPA/WPA2 PMKID cracker. Given a captured PMKID (plus SSID, AP MAC, client MAC)
 * and a wordlist, it tries each candidate passphrase and reports a match.
 * Cracking runs entirely in the browser via Web Crypto (PBKDF2-HMAC-SHA1 +
 * HMAC-SHA1); no data leaves the page and no backend is required.
 *
 * Capturing a PMKID requires monitor-mode WiFi hardware and cannot be done in a
 * browser. This tool performs the offline cracking step on a PMKID you supply.
 */
export default function AircrackWifiWorkbench({ onLogMessage }) {
  const [ssid, setSsid] = useState('');
  const [apMac, setApMac] = useState('');
  const [clientMac, setClientMac] = useState('');
  const [pmkid, setPmkid] = useState('');
  const [wordlist, setWordlist] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ tried: 0, total: 0 });
  const cancelRef = useRef(false);

  const log = (msg) => onLogMessage?.(msg);

  const startCrack = async () => {
    if (!ssid || !apMac || !clientMac || !pmkid || !wordlist.trim()) {
      log('Fill in SSID, AP MAC, client MAC, PMKID, and a wordlist.');
      return;
    }
    const candidates = wordlist.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
    setRunning(true);
    setResult(null);
    setProgress({ tried: 0, total: candidates.length });
    cancelRef.current = false;
    log(`PMKID crack started against ${candidates.length} candidate(s)…`);
    const t0 = performance.now();
    try {
      const pwd = await crackPmkid(
        { ssid, apMac, clientMac, pmkid, candidates },
        { onProgress: setProgress, shouldStop: () => cancelRef.current },
      );
      if (cancelRef.current) { log('Cancelled'); setRunning(false); return; }
      if (pwd) {
        const rate = Math.round(progress.total / ((performance.now() - t0) / 1000)) || 0;
        setResult({ password: pwd });
        log(`Password found: ${pwd}`);
      } else {
        setResult({ password: null });
        log('No candidate matched the PMKID');
      }
    } catch (e) {
      log(`Error: ${e.message}`);
      setResult({ error: e.message });
    }
    setRunning(false);
  };

  const pct = progress.total ? Math.round((progress.tried / progress.total) * 100) : 0;

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">WPA PMKID Cracker</h2>
      <p className="text-sm text-gray-400 mb-4">
        Offline dictionary attack on a captured WPA/WPA2 PMKID. Runs in your browser; no backend.
      </p>
      <div className="grid gap-2 mb-4">
        <input placeholder="SSID (network name)" value={ssid} onChange={(e) => setSsid(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" />
        <input placeholder="AP MAC / BSSID (AA:BB:CC:DD:EE:FF)" value={apMac} onChange={(e) => setApMac(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" />
        <input placeholder="Client MAC (station)" value={clientMac} onChange={(e) => setClientMac(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" />
        <input placeholder="Captured PMKID (32 hex chars)" value={pmkid} onChange={(e) => setPmkid(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" />
        <textarea placeholder="Wordlist (one passphrase per line; WPA requires 8–63 chars)" rows={6} value={wordlist} onChange={(e) => setWordlist(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" />
        <div className="flex gap-2 mt-2">
          <button onClick={startCrack} disabled={running} className="px-3 py-1 bg-cyan-600 text-white rounded hover:bg-cyan-500 disabled:opacity-40">
            {running ? `Cracking… ${pct}% (${progress.tried}/${progress.total})` : 'Crack'}
          </button>
          {running && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded hover:bg-slate-600">Stop</button>}
        </div>
      </div>
      {result && (
        <div className="mt-2 text-sm text-gray-200">
          {result.error ? <span className="text-red-400">Error: {result.error}</span>
            : result.password ? <span>✅ Passphrase: <strong className="font-mono">{result.password}</strong></span>
            : <span>❌ No matching passphrase in wordlist.</span>}
        </div>
      )}
    </div>
  );
}
