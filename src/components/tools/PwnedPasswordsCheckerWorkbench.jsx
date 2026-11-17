import React, { useEffect, useRef, useState } from 'react';
import { proxiedFetch, describeNetworkError } from '../../utils/netClient';
import { EmailTab, CatalogTab, BREACH_NOTE } from './BreachTabs';
import {
  maskPassword, makeRangeFetcher, checkEntries, parsePasswordCsv, parseHashList, resultsToCsv, MAX_PASSWORD_ENTRIES,
} from '../../utils/breachCheck';

/**
 * Pwned Passwords checker (HaveIBeenPwned range API, k-anonymity model).
 * Each password is hashed locally (SHA-1, or NTLM for the HIBP NTLM range API);
 * only the first 5 hex characters of the hash are sent to the API, which returns
 * all suffixes with that prefix. The full password and full hash never leave the
 * browser. The Add-Padding header is sent so the response size does not leak
 * whether the prefix had many or few matches. Plaintext is never logged.
 */
export { maskPassword };

const SOURCES = [['list', 'Type or paste'], ['csv', 'Password manager CSV'], ['hash', 'Hashes']];

function downloadText(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const readFileText = (file) => (typeof file.text === 'function' ? file.text() : new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result));
  r.onerror = () => rej(r.error);
  r.readAsText(file);
}));

function PasswordsTab({ onLogMessage }) {
  const [source, setSource] = useState('list');
  const [mode, setMode] = useState('sha1');
  const [input, setInput] = useState('');
  const [trim, setTrim] = useState(false);
  const [csvInfo, setCsvInfo] = useState(null); // { format, count, skipped, name }
  const [results, setResults] = useState([]);
  const [plain, setPlain] = useState([]); // list mode only, for the show/hide toggle
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(null);
  const [stats, setStats] = useState(null);
  const [msg, setMsg] = useState('');
  const [shown, setShown] = useState({});
  const csvEntries = useRef(null);
  const controller = useRef(null);

  const log = (m) => onLogMessage?.(m);
  useEffect(() => () => { controller.current?.abort(); csvEntries.current = null; }, []);

  const reset = () => {
    setResults([]); setPlain([]); setShown({}); setStats(null); setProgress(null); setMsg('');
  };

  const changeSource = (s) => { if (checking) return; setSource(s); reset(); };

  const onCsvFile = async (e) => {
    const file = e.target.files?.[0];
    try { e.target.value = ''; } catch { /* ignore */ }
    if (!file) return;
    reset();
    const parsed = parsePasswordCsv(await readFileText(file));
    if (parsed.error) { csvEntries.current = null; setCsvInfo(null); setMsg(parsed.error); return; }
    csvEntries.current = parsed.entries;
    setCsvInfo({ format: parsed.format, count: parsed.entries.length, skipped: parsed.skipped, name: file.name });
    if (parsed.entries.length >= MAX_PASSWORD_ENTRIES) setMsg(`Only the first ${MAX_PASSWORD_ENTRIES} entries are loaded.`);
  };

  const run = async () => {
    let entries = [];
    reset();
    if (source === 'list') {
      const lines = input.split('\n').map((l) => l.replace(/\r$/, '')).map((l) => (trim ? l.trim() : l)).filter((l) => l.length > 0);
      entries = lines.map((password) => ({ password }));
      setPlain(lines);
    } else if (source === 'csv') {
      entries = csvEntries.current || [];
    } else {
      const { valid, invalid } = parseHashList(input, mode);
      entries = valid.map((hash) => ({ hash }));
      if (invalid.length) setMsg(`Skipped ${invalid.length} line${invalid.length > 1 ? 's' : ''} that are not a ${mode === 'ntlm' ? '32' : '40'}-digit hex hash.`);
    }
    if (entries.length === 0) { setMsg((m) => m || (source === 'csv' ? 'Import a CSV file first.' : 'Nothing to check.')); return; }

    const ac = new AbortController();
    controller.current = ac;
    setChecking(true);
    setProgress({ done: 0, total: entries.length, requests: 0 });
    try {
      const { results: out, requests, cancelled } = await checkEntries(entries, {
        mode,
        signal: ac.signal,
        fetchRange: makeRangeFetcher(proxiedFetch),
        onProgress: ({ done, total, requests: req, row }) => {
          setProgress({ done, total, requests: req });
          if (source === 'list') {
            // Only the masked form is ever logged.
            log(`"${row.masked}": ${row.error ? row.error : `${row.count} breach${row.count !== 1 ? 'es' : ''}`}`);
          }
        },
      });
      setResults(out);
      const bad = out.filter((r) => r.count > 0).length;
      const reused = out.filter((r) => r.reuse > 1).length;
      setStats({ checked: out.length, total: entries.length, compromised: bad, reused, requests, cancelled });
      log(`Pwned Passwords (${mode.toUpperCase()}): ${out.length}/${entries.length} checked, ${bad} compromised, ${requests} range request${requests === 1 ? '' : 's'}${cancelled ? ', cancelled' : ''}`);
    } catch (e) {
      setMsg(describeNetworkError(e));
    } finally {
      controller.current = null;
      setChecking(false);
      if (source === 'csv') { csvEntries.current = null; setCsvInfo(null); } // drop the plaintext once the run ends
    }
  };

  const cancel = () => controller.current?.abort();
  const showSite = source === 'csv';

  return (
    <div className="p-4 space-y-4">
      <p className="text-sm text-gray-400">
        Checks passwords against HaveIBeenPwned using k-anonymity. Only the first 5 characters of each
        hash are sent; the password never leaves your browser and is never logged.
      </p>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="flex gap-1">
          {SOURCES.map(([id, label]) => (
            <button key={id} onClick={() => changeSource(id)} disabled={checking}
              className={`px-2 py-0.5 rounded border ${source === id ? 'bg-slate-800 border-slate-600 text-white' : 'border-slate-800 text-gray-400 hover:text-gray-200'}`}>{label}</button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-gray-300">Hash
          <select value={mode} onChange={(e) => { setMode(e.target.value); reset(); }} disabled={checking} aria-label="Hash type" className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5">
            <option value="sha1">SHA-1 (standard)</option>
            <option value="ntlm">NTLM (HIBP NTLM range)</option>
          </select>
        </label>
        {source === 'list' && (
          <label className="flex items-center gap-1 text-gray-300">
            <input type="checkbox" checked={trim} onChange={(e) => setTrim(e.target.checked)} /> Trim whitespace
          </label>
        )}
      </div>
      {mode === 'ntlm' && (
        <p className="text-[11px] text-slate-500">NTLM mode uses the same k-anonymity range API (?mode=ntlm). It only reports how often a hash appears in known breaches; it cannot recover a password.</p>
      )}

      {source === 'csv' ? (
        <div className="space-y-2">
          <label className="inline-block px-3 py-1 bg-slate-800 rounded text-sm text-cyan-300 hover:bg-slate-700 cursor-pointer">
            Choose password export (.csv)
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onCsvFile} disabled={checking} data-testid="pw-csv-input" />
          </label>
          <p className="text-[11px] text-slate-500">Bitwarden, 1Password, Chrome and Firefox exports. The file is read in this tab; passwords are hashed locally, never shown in the report, and dropped from memory when the run ends. Delete the export file when you are done.</p>
          {csvInfo && <div className="text-xs text-gray-300">{csvInfo.format} export "{csvInfo.name}": {csvInfo.count} entries{csvInfo.skipped ? `, ${csvInfo.skipped} skipped (no password or not a login)` : ''}.</div>}
        </div>
      ) : (
        <textarea
          rows={6}
          placeholder={source === 'hash' ? `One ${mode === 'ntlm' ? 'NTLM (32 hex)' : 'SHA-1 (40 hex)'} hash per line` : 'Enter one password per line'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm text-gray-200 font-mono"
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={run} disabled={checking} className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-40">
          {checking ? 'Checking…' : source === 'hash' ? 'Check Hashes' : 'Check Passwords'}
        </button>
        {checking && <button onClick={cancel} className="px-3 py-1 bg-slate-700 text-white rounded hover:bg-slate-600">Cancel</button>}
        {!checking && (input || results.length > 0) && (
          <button onClick={() => { setInput(''); reset(); }} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200">Clear</button>
        )}
        {progress && checking && <span className="text-xs text-gray-400">{progress.done}/{progress.total} checked · {progress.requests} request{progress.requests === 1 ? '' : 's'}</span>}
        {msg && <span className="text-xs text-amber-300">{msg}</span>}
      </div>

      {stats && (
        <div className="text-xs text-gray-300" data-testid="pw-summary">
          {stats.cancelled ? `Cancelled after ${stats.checked} of ${stats.total}. ` : ''}
          {stats.checked} checked, <span className={stats.compromised ? 'text-red-400' : 'text-green-400'}>{stats.compromised} compromised</span>
          {stats.reused ? `, ${stats.reused} in reused groups` : ''} · {stats.requests} range request{stats.requests === 1 ? '' : 's'}.
        </div>
      )}

      {results.length > 0 && (
        <>
          <table className="w-full table-auto border-collapse border border-slate-600 text-sm">
            <thead className="bg-slate-800 text-slate-100">
              <tr>
                {showSite && <th className="p-1 border border-slate-600 text-left">Site</th>}
                {showSite && <th className="p-1 border border-slate-600 text-left">Username</th>}
                {!showSite && <th className="p-1 border border-slate-600 text-left">{source === 'hash' ? 'Hash prefix' : 'Password'}</th>}
                <th className="p-1 border border-slate-600 text-left">Breach count</th>
                <th className="p-1 border border-slate-600 text-left">Reuse</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i} className={i % 2 ? 'bg-slate-900' : ''}>
                  {showSite && <td className="p-1 border border-slate-700 break-all">{r.site || '—'}</td>}
                  {showSite && <td className="p-1 border border-slate-700 break-all">{r.username || '—'}</td>}
                  {!showSite && (
                    <td className="p-1 border border-slate-700 break-all font-mono">
                      {source === 'list' && shown[i] ? plain[r.index] : r.masked}{' '}
                      {source === 'list' && (
                        <button type="button" onClick={() => setShown((s) => ({ ...s, [i]: !s[i] }))} className="ml-2 text-[10px] text-cyan-400 hover:text-cyan-300 font-sans">{shown[i] ? 'hide' : 'show'}</button>
                      )}
                    </td>
                  )}
                  <td className={`p-1 border border-slate-700 ${r.count > 0 ? 'text-red-400' : r.count === 0 ? 'text-green-400' : 'text-yellow-400'}`}>
                    {r.count < 0 ? `Error: ${r.error}` : r.count > 0 ? `${r.count.toLocaleString()} — compromised` : 'Not found'}
                  </td>
                  <td className="p-1 border border-slate-700 text-xs text-gray-400">{r.reuse > 1 ? `reused ×${r.reuse}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={() => downloadText('pwned-passwords-report.csv', resultsToCsv(results))} className="px-3 py-1 text-xs bg-slate-800 rounded hover:bg-slate-700 text-cyan-300">
            Export masked report (CSV)
          </button>
        </>
      )}
    </div>
  );
}

const TABS = [['passwords', 'Passwords'], ['email', 'Email'], ['catalog', 'Breach catalog']];

export default function PwnedPasswordsCheckerWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('passwords');
  return (
    <div>
      <div className="px-4 pt-3 flex gap-1 border-b border-slate-800">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1 text-sm rounded-t ${tab === id ? 'bg-slate-800 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
        ))}
      </div>
      {tab === 'passwords' ? <PasswordsTab onLogMessage={onLogMessage} /> : (
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-400">{BREACH_NOTE}</p>
          {tab === 'email' ? <EmailTab onLogMessage={onLogMessage} /> : <CatalogTab onLogMessage={onLogMessage} />}
        </div>
      )}
    </div>
  );
}
