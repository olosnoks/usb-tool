import React, { useState } from 'react';

/**
 * Pwned Passwords Checker – client‑side integration with the HaveIBeenPwned API.
 * Users paste one or more passwords; the component hashes each with SHA‑1, sends the
 * first 5 hex characters as a prefix to the public API, and displays the breach count.
 * No backend is required; all network calls are CORS‑enabled.
 */
export default function PwnedPasswordsCheckerWorkbench({ onLogMessage }) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [checking, setChecking] = useState(false);

  const log = (msg) => onLogMessage?.(msg);

  const checkPasswords = async () => {
    const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    setChecking(true);
    const out = [];
    for (const pwd of lines) {
      const enc = new TextEncoder();
      const data = enc.encode(pwd);
      const hashBuf = await crypto.subtle.digest('SHA-1', data);
      const hashHex = Array.from(new Uint8Array(hashBuf))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('').toUpperCase();
      const prefix = hashHex.slice(0, 5);
      const suffix = hashHex.slice(5);
      try {
        const resp = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
        const txt = await resp.text();
        const match = txt.split('\n').find(line => line.startsWith(suffix + ':'));
        const count = match ? parseInt(match.split(':')[1], 10) : 0;
        out.push({ pwd, count });
        log(`Checked password "${pwd}" – ${count} breach${count !== 1 ? 'es' : ''}`);
      } catch (e) {
        out.push({ pwd, count: -1, error: e.message });
        log(`Error checking password "${pwd}": ${e.message}`);
      }
    }
    setResults(out);
    setChecking(false);
  };

  return (
    <div className="p-4 space-y-4 font-mono text-xs">
      <h2 className="text-lg font-bold">Pwned Passwords Checker</h2>
      <textarea
        rows={6}
        placeholder="Enter one password per line"
        value={input}
        onChange={e => setInput(e.target.value)}
        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-gray-200"
      />
      <button
        onClick={checkPasswords}
        disabled={checking}
        className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-40"
      >
        {checking ? 'Checking…' : 'Check Passwords'}
      </button>
      {results.length > 0 && (
        <table className="w-full table-auto border-collapse border border-slate-600 text-sm mt-4">
          <thead className="bg-slate-800 text-slate-100">
            <tr>
              <th className="p-1 border">Password</th>
              <th className="p-1 border">Breach Count</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-900' : ''}>
                <td className="p-1 border break-all">{r.pwd}</td>
                <td className="p-1 border">{r.count < 0 ? 'Error' : r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

