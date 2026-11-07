import React, { useState } from 'react';

/**
 * Very small client‑side hash‑cracking demo.
 * It supports MD5, SHA‑1 and SHA‑256 using the browser's SubtleCrypto API.
 * User provides a target hash and a newline‑separated wordlist.
 * The tool hashes each candidate and reports the first match.
 */
export default function HashcatCrackerWorkbench({ onLogMessage }) {
  const [hashAlg, setHashAlg] = useState('MD5');
  const [targetHash, setTargetHash] = useState('');
  const [wordlist, setWordlist] = useState('');
  const [result, setResult] = useState(null);

  const log = (msg) => {
    onLogMessage?.(msg);
  };

  const algoMap = {
    MD5: 'MD5',
    SHA1: 'SHA-1',
    SHA256: 'SHA-256',
  };

  const hashText = async (algo, text) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest(algoMap[algo], data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const startCrack = async () => {
    if (!targetHash || !wordlist) return;
    log(`Starting ${hashAlg} cracking …`);
    const candidates = wordlist.split('\n').map(l => l.trim()).filter(Boolean);
    for (const candidate of candidates) {
      const h = await hashText(hashAlg, candidate);
      if (h === targetHash.toLowerCase()) {
        setResult({ password: candidate, hash: h });
        log(`Match found: ${candidate}`);
        return;
      }
    }
    setResult({ password: null });
    log('No match found');
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">Hashcat Cracker (demo)</h2>
      <p className="text-sm text-gray-400 mb-4">Brute‑force a hash using a small wordlist (MD5/SHA‑1/SHA‑256).</p>
      <div className="grid gap-2 mb-4">
        <label className="block text-sm text-gray-300">Algorithm</label>
        <select value={hashAlg} onChange={e => setHashAlg(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200">
          <option>MD5</option>
          <option>SHA1</option>
          <option>SHA256</option>
        </select>
        <label className="block text-sm text-gray-300">Target hash</label>
        <input type="text" value={targetHash} onChange={e => setTargetHash(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200" placeholder="e.g. 5d41402abc4b2a76b9719d911017c592" />
        <label className="block text-sm text-gray-300">Wordlist (one per line)</label>
        <textarea value={wordlist} onChange={e => setWordlist(e.target.value)} rows={6} className="bg-slate-900 border border-slate-800 rounded p-1 text-sm text-gray-200"></textarea>
        <button onClick={startCrack} className="px-3 py-1 bg-amber-600 text-white rounded hover:bg-amber-500 mt-2">Crack</button>
      </div>
      {result && (
        <div className="mt-2 text-sm text-gray-200">
          {result.password ? (
            <span>✅ Password found: <strong>{result.password}</strong></span>
          ) : (
            <span>❌ No matching password in wordlist.</span>
          )}
        </div>
      )}
      <pre className="bg-slate-900 p-2 rounded text-xs overflow-auto" style={{maxHeight:'30vh'}} />
    </div>
  );
}

