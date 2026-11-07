import React, { useState } from 'react';
import { Cookie, Search, RefreshCw, ShieldCheck, ShieldAlert, ClipboardPaste } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../../utils/netClient';
import { analyzeSetCookies } from '../../../utils/cookies.js';

/**
 * Cookie security analysis (OWASP PTK/ZAP-style). Fetch a URL and inspect the
 * Set-Cookie flags, or paste a Set-Cookie header to analyze offline. Flags
 * Secure / HttpOnly / SameSite and common misconfigurations.
 *
 * Caveat: browsers hide Set-Cookie from fetch() unless a proxy forwards it, so
 * the "paste" box is provided for when the live fetch can't see it.
 */
function toMarkdown(list, note) {
  if (!list || list.length === 0) return note || 'No cookies analyzed.';
  const out = [];
  for (const c of list) {
    out.push(`### \`${c.name}\``);
    out.push(`- Secure: ${c.secure ? '✅' : '❌'} · HttpOnly: ${c.httpOnly ? '✅' : '❌'} · SameSite: ${c.sameSite || '❌ (none)'}`);
    out.push(`- ${c.session ? 'session' : 'persistent'}${c.domain ? ` · domain ${c.domain}` : ''} · path ${c.path}`);
    c.warnings.forEach((w) => out.push(`- ⚠ ${w}`));
    out.push('');
  }
  return out.join('\n').trim();
}

export default function CookieAnalyzerTab({ onLogMessage, onReport }) {
  const [url, setUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cookies, setCookies] = useState(null);
  const [note, setNote] = useState('');

  const show = (list, msg, reportUrl) => {
    setCookies(list); setNote(msg || '');
    onReport?.({ url: reportUrl, markdown: toMarkdown(list, msg) });
  };

  const run = async () => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    setBusy(true); setError(''); setCookies(null); setNote('');
    onLogMessage?.(`Cookie check ${target}${isProxyEnabled() ? ' (via proxy)' : ''}`);
    try {
      const resp = await proxiedFetch(target, { redirect: 'follow' });
      await resp.text();
      const sc = resp.headers.get('set-cookie');
      if (!sc) { show([], 'No Set-Cookie header was visible to the browser on this response. Browsers hide Set-Cookie from fetch() unless a proxy forwards it — paste the header below to analyze it.', target); }
      else { const list = analyzeSetCookies(sc); show(list, `${list.length} cookie(s) from the live response.`, target); onLogMessage?.(`Cookies: ${list.length}, ${list.filter((c) => !c.ok).length} with warnings`); }
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  const analyzePasted = () => {
    if (!pasted.trim()) return;
    const list = analyzeSetCookies(pasted.replace(/^set-cookie:\s*/i, ''));
    show(list, `${list.length} cookie(s) from pasted header.`);
  };

  return (
    <div className="px-4 pb-4">
      <div className="flex flex-wrap gap-2 my-3">
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="https://example.com" className="flex-1 min-w-[14rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} Fetch
        </button>
      </div>
      <div className="flex gap-2 mb-3">
        <input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="…or paste a Set-Cookie header value" className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono" />
        <button onClick={analyzePasted} className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-gray-200 rounded text-xs hover:bg-slate-700 inline-flex items-center gap-1"><ClipboardPaste size={13} /> Analyze</button>
      </div>
      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}
      {note && <div className="mb-3 text-xs text-slate-400">{note}</div>}
      {cookies && cookies.map((c, i) => (
        <div key={i} className="mb-2 border border-slate-800 rounded bg-slate-950 p-2">
          <div className="flex items-center gap-2 mb-1">
            {c.ok ? <ShieldCheck size={14} className="text-emerald-400" /> : <ShieldAlert size={14} className="text-amber-400" />}
            <span className="font-mono text-sm text-gray-100">{c.name}</span>
            <span className="text-[10px] text-slate-500">{c.session ? 'session' : 'persistent'}{c.domain ? ` · ${c.domain}` : ''} · path {c.path}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-1">
            {[['Secure', c.secure], ['HttpOnly', c.httpOnly], ['SameSite' + (c.sameSite ? `=${c.sameSite}` : ''), !!c.sameSite]].map(([label, on]) => (
              <span key={label} className={`px-2 py-0.5 rounded text-[10px] border ${on ? 'border-emerald-800 bg-emerald-950/20 text-emerald-300' : 'border-red-900 bg-red-950/20 text-red-300'}`}>{on ? '✓' : '✗'} {label}</span>
            ))}
          </div>
          {c.warnings.map((w, j) => <div key={j} className="text-[11px] text-amber-300/90 pl-1">⚠ {w}</div>)}
        </div>
      ))}
    </div>
  );
}
