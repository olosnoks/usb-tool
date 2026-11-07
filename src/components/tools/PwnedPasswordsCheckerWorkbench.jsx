import React, { useState } from 'react';
import { proxiedFetch, describeNetworkError } from '../../utils/netClient';

/**
 * Pwned Passwords checker (HaveIBeenPwned range API, k-anonymity model).
 * Each password is SHA-1 hashed locally; only the first 5 hex characters of the
 * hash are sent to the API, which returns all suffixes with that prefix. The full
 * password and full hash never leave the browser. The Add-Padding header is sent
 * so the response size does not leak whether the prefix had many or few matches.
 */
export default function PwnedPasswordsCheckerWorkbench({ onLogMessage }) {
  const [input, setInput] = useState('');
  const [results, setResults] = useState([]);
  const [checking, setChecking] = useState(false);

  const log = (msg) => onLogMessage?.(msg);

  const sha1Hex = async (text) => {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  };

  const checkPasswords = async () => {
    const lines = input.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0);
    if (lines.length === 0) return;
    setChecking(true);
    setResults([]);
    const out = [];
    for (const pwd of lines) {
      try {
        const hash = await sha1Hex(pwd);
        const prefix = hash.slice(0, 5);
        const suffix = hash.slice(5);
        const resp = await proxiedFetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
          headers: { 'Add-Padding': 'true' },
        });
        const txt = await resp.text();
        const match = txt.split('\n').find((line) => line.startsWith(suffix));
        const count = match ? parseInt(match.split(':')[1], 10) : 0;
        out.push({ pwd, count });
        log(`"${pwd}": ${count} breach${count !== 1 ? 'es' : ''}`);
      } catch (e) {
        out.push({ pwd, count: -1, error: describeNetworkError(e) });
        log(`"${pwd}": ${describeNetworkError(e)}`);
      }
      setResults([...out]);
    }
    setChecking(false);
  };

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Pwned Passwords Checker</h2>
      <p className="text-sm text-gray-400">
        Checks passwords against HaveIBeenPwned using k-anonymity. Only the first 5 characters of each
        SHA-1 hash are sent; the password never leaves your browser.
      </p>
      <textarea
        rows={6}
        placeholder="Enter one password per line"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-gray-200 font-mono"
      />
      <button onClick={checkPasswords} disabled={checking} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-40">
        {checking ? 'Checking…' : 'Check Passwords'}
      </button>
      {results.length > 0 && (
        <table className="w-full table-auto border-collapse border border-slate-600 text-sm">
          <thead className="bg-slate-800 text-slate-100">
            <tr><th className="p-1 border border-slate-600 text-left">Password</th><th className="p-1 border border-slate-600 text-left">Breach count</th></tr>
          </thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className={i % 2 ? 'bg-slate-900' : ''}>
                <td className="p-1 border border-slate-700 break-all font-mono">{r.pwd}</td>
                <td className={`p-1 border border-slate-700 ${r.count > 0 ? 'text-red-400' : r.count === 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                  {r.count < 0 ? `Error: ${r.error}` : r.count > 0 ? `${r.count.toLocaleString()} — compromised` : 'Not found'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
