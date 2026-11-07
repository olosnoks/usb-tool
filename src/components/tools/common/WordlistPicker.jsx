import React, { useState } from 'react';
import { WORDLISTS, CATEGORY_LABELS, wordlistUrl, fetchWordlist } from '../../../utils/wordlists';

/**
 * Reusable SecLists wordlist loader. Pick a curated list, paste a custom URL, or
 * upload a file; on success calls onLoad(lines, meta).
 *
 *   <WordlistPicker category="paths" max={2000} onLoad={(lines) => ...} />
 */
export default function WordlistPicker({ category, max = 50000, onLoad, label = 'Wordlist' }) {
  const allMode = !category || category === 'all';
  const entries = allMode ? Object.values(WORDLISTS).flat() : (WORDLISTS[category] || []);
  const [sel, setSel] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const loadUrl = async (url, name) => {
    setBusy(true); setStatus(`Loading ${name}…`);
    try {
      const { lines, total, truncated } = await fetchWordlist(url, { max });
      onLoad(lines, { name, total, truncated });
      setStatus(`Loaded ${lines.length.toLocaleString()}${truncated ? ` of ${total.toLocaleString()} (capped)` : ''} from ${name}`);
    } catch (e) {
      setStatus(`Failed: ${e.message}`);
    }
    setBusy(false);
  };

  const onFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = String(ev.target.result).split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l && !l.startsWith('#')).slice(0, max);
      onLoad(lines, { name: file.name, total: lines.length, truncated: false });
      setStatus(`Loaded ${lines.length.toLocaleString()} from ${file.name}`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="mb-2 p-2 border border-slate-800 rounded bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400">{label}:</span>
        <select value={sel} onChange={(e) => setSel(e.target.value)} className="bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200 max-w-[16rem]">
          <option value="">SecLists…</option>
          {allMode
            ? Object.entries(WORDLISTS).map(([cat, list]) => (
              <optgroup key={cat} label={CATEGORY_LABELS[cat] || cat}>
                {list.map((e) => <option key={e.path} value={e.path}>{e.name} (~{e.lines.toLocaleString()})</option>)}
              </optgroup>
            ))
            : entries.map((e) => <option key={e.path} value={e.path}>{e.name} (~{e.lines.toLocaleString()})</option>)}
        </select>
        <button
          onClick={() => { const e = entries.find((x) => x.path === sel); if (e) loadUrl(wordlistUrl(e), e.name); }}
          disabled={busy || !sel}
          className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600 disabled:opacity-40"
        >Load</button>
        <label className="px-2 py-1 bg-slate-800 text-gray-300 rounded text-xs hover:bg-slate-700 cursor-pointer">
          Upload<input type="file" accept=".txt,.lst" className="hidden" onChange={onFile} />
        </label>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <input value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="custom wordlist URL (CORS/proxy)" className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-[11px] text-gray-200" />
        <button onClick={() => customUrl.trim() && loadUrl(customUrl.trim(), 'custom URL')} disabled={busy} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600 disabled:opacity-40">Load URL</button>
      </div>
      {status && <div className="text-[11px] text-gray-500 mt-1">{status}</div>}
    </div>
  );
}
