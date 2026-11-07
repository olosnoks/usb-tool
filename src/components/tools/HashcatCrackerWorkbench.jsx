import React, { useState, useRef } from 'react';
import { md5Hex } from '../../utils/md5';

/**
 * Client-side dictionary hash cracker.
 * Hashes each wordlist candidate with the selected algorithm and reports the
 * first match. MD5 is implemented locally (Web Crypto omits it); SHA-1/SHA-256/
 * SHA-384/SHA-512 use the browser's SubtleCrypto. All work runs in the browser;
 * no data leaves the page.
 */
export default function HashcatCrackerWorkbench({ onLogMessage }) {
  const [hashAlg, setHashAlg] = useState('MD5');
  const [targetHash, setTargetHash] = useState('');
  const [wordlist, setWordlist] = useState('');
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const cancelRef = useRef(false);

  const log = (msg) => onLogMessage?.(msg);

  const subtleAlg = { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA384: 'SHA-384', SHA512: 'SHA-512' };

  const hashText = async (algo, text) => {
    if (algo === 'MD5') return md5Hex(text);
    const data = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest(subtleAlg[algo], data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const startCrack = async () => {
    const target = targetHash.trim().toLowerCase();
    if (!target || !wordlist.trim()) return;
    const candidates = wordlist.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
    setRunning(true);
    setResult(null);
    setProgress(0);
    cancelRef.current = false;
    log(`Cracking ${hashAlg} hash against ${candidates.length} candidate(s)…`);
    const t0 = performance.now();
    for (let i = 0; i < candidates.length; i++) {
      if (cancelRef.current) { log('Cancelled'); setRunning(false); return; }
      const h = await hashText(hashAlg, candidates[i]);
      if (h === target) {
        const rate = Math.round((i + 1) / ((performance.now() - t0) / 1000));
        setResult({ password: candidates[i], tried: i + 1 });
        log(`Match: "${candidates[i]}" after ${i + 1} tries (~${rate} H/s)`);
        setRunning(false);
        setProgress(100);
        return;
      }
      if (i % 500 === 0) {
        setProgress(Math.round((i / candidates.length) * 100));
        await new Promise((r) => setTimeout(r, 0)); // yield so UI stays responsive
      }
    }
    setResult({ password: null, tried: candidates.length });
    log(`No match in ${candidates.length} candidates`);
    setRunning(false);
    setProgress(100);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Hash Cracker</h2>
      <p className="text-sm text-gray-400 mb-4">
        Dictionary attack against a hash using MD5 or SHA-1/256/384/512. Runs entirely in your browser.
      </p>
      <div className="grid gap-2 mb-4">
        <label className="block text-sm text-gray-300">Algorithm</label>
        <select value={hashAlg} onChange={(e) => setHashAlg(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200">
          <option>MD5</option><option value="SHA1">SHA-1</option><option value="SHA256">SHA-256</option><option value="SHA384">SHA-384</option><option value="SHA512">SHA-512</option>
        </select>
        <label className="block text-sm text-gray-300">Target hash (hex)</label>
        <input type="text" value={targetHash} onChange={(e) => setTargetHash(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" placeholder="e.g. 5d41402abc4b2a76b9719d911017c592" />
        <label className="block text-sm text-gray-300">Wordlist (one candidate per line)</label>
        <textarea value={wordlist} onChange={(e) => setWordlist(e.target.value)} rows={6} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200 font-mono" />
        <div className="flex gap-2 mt-2">
          <button onClick={startCrack} disabled={running} className="px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-500 disabled:opacity-40">
            {running ? `Cracking… ${progress}%` : 'Crack'}
          </button>
          {running && <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1 bg-slate-700 text-gray-200 rounded hover:bg-slate-600">Stop</button>}
        </div>
      </div>
      {result && (
        <div className="mt-2 text-sm text-gray-200">
          {result.password ? (
            <span>✅ Password found: <strong className="font-mono">{result.password}</strong></span>
          ) : (
            <span>❌ No candidate matched (tried {result.tried}).</span>
          )}
        </div>
      )}
    </div>
  );
}
