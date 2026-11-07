import React, { useState } from 'react';
import { Fingerprint, Search, RefreshCw } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../../utils/netClient';
import { detectTech } from '../../../utils/fingerprint.js';
import { extractResources } from '../../../utils/urlinspect.js';
import { cookieNames } from '../../../utils/cookies.js';

/**
 * Technology fingerprinting (OWASP PTK-style) — fetch a page and infer the
 * stack from response headers, HTML markers, Set-Cookie names and script URLs.
 * Heuristic; evidence is shown for each hit. Via the shared proxy (CORS).
 */
export default function TechFingerprintTab({ onLogMessage }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tech, setTech] = useState(null);

  const run = async () => {
    let target = url.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    setBusy(true); setError(''); setTech(null);
    onLogMessage?.(`Fingerprint ${target}${isProxyEnabled() ? ' (via proxy)' : ''}`);
    try {
      const resp = await proxiedFetch(target, { redirect: 'follow' });
      const html = await resp.text();
      const headers = {};
      [...resp.headers.entries()].forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
      const scripts = extractResources(html, target).scripts;
      const names = headers['set-cookie'] ? cookieNames(headers['set-cookie']) : [];
      const found = detectTech({ headers, html, cookieNames: names, scripts });
      setTech(found);
      onLogMessage?.(`Fingerprint: ${found.length} technolog${found.length === 1 ? 'y' : 'ies'} detected`);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  const byCat = (tech || []).reduce((m, t) => { (m[t.category] ||= []).push(t); return m; }, {});

  return (
    <div className="px-4 pb-4">
      <div className="flex flex-wrap gap-2 my-3">
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="https://example.com" className="flex-1 min-w-[14rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
        <button onClick={run} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Fingerprint size={14} />} {busy ? 'Fetching…' : 'Fingerprint'}
        </button>
      </div>
      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}
      {tech && tech.length === 0 && <div className="text-xs text-slate-500">No technologies matched the signature set.</div>}
      {tech && tech.length > 0 && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
          {Object.entries(byCat).map(([cat, items]) => (
            <div key={cat} className="border border-slate-800 rounded bg-slate-950 p-2">
              <div className="text-[10px] uppercase tracking-wide text-cyan-400 mb-1">{cat}</div>
              {items.map((t) => (
                <div key={t.name} className="mb-1 last:mb-0">
                  <div className="text-sm text-gray-100">{t.name}</div>
                  <div className="text-[10px] text-slate-500 font-mono break-all">{t.evidence}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {!tech && !error && <p className="text-xs text-slate-500">Infer a site's technology stack (server, language, CMS, JS frameworks, CDN/WAF, analytics) from one fetch. Heuristic — evidence is shown per detection.</p>}
    </div>
  );
}
