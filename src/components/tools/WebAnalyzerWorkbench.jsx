import React, { useState, useRef, useCallback } from 'react';
import { Search, RefreshCw, FileDown, ShieldCheck, ShieldAlert, Link2, FileCode, Image, Code2, Fingerprint, Cookie, Globe } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import { extractTitle, extractLinks, extractResources, extractMeta, extractForms, assessSecurityHeaders } from '../../utils/urlinspect.js';
import { detectTech } from '../../utils/fingerprint.js';
import { analyzeSetCookies, cookieNames } from '../../utils/cookies.js';
import { runPassiveScan } from '../../utils/webScan.js';
import NiktoScannerWorkbench from './NiktoScannerWorkbench';
import CrawlerTab from './webanalyzer/CrawlerTab';

/**
 * Web Analyzer — one Analyze does a single fetch and shows everything about the
 * URL in one pane: summary + security headers, technology fingerprint, cookie
 * security, passive-scan findings, links/resources, and forms. Path Prober and
 * Crawler (multi-request, long-running) are on-demand sections below, seeded
 * with the same URL. Export compiles all of it to one Markdown file.
 *
 * Requests go through fetch and are CORS-limited; set a proxy to reach arbitrary
 * hosts. Analyze only targets you own or are authorized to assess.
 */

function Section({ icon: Icon, title, count, accent = 'text-cyan-400', children }) {
  return (
    <section className="mb-3">
      <h3 className={`text-xs font-semibold uppercase tracking-wide mb-1 flex items-center gap-1.5 ${accent}`}>
        <Icon size={13} /> {title}{count !== undefined && <span className="text-slate-500">({count})</span>}
      </h3>
      <div className="bg-slate-950 border border-slate-800 rounded p-2 text-xs">{children}</div>
    </section>
  );
}

function List({ items, linkify = true }) {
  if (!items?.length) return <div className="text-slate-600 text-xs">none</div>;
  return (
    <div className="max-h-44 overflow-auto font-mono text-[11px]">
      {items.map((it, i) => (
        <div key={i} className="py-0.5 border-b border-slate-900 last:border-0 break-all">
          {linkify ? <a href={it} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300">{it}</a> : <span className="text-gray-300">{it}</span>}
        </div>
      ))}
    </div>
  );
}

const SEV_COLOR = { High: 'text-red-400', Medium: 'text-orange-400', Low: 'text-yellow-400', Info: 'text-gray-400' };

export default function WebAnalyzerWorkbench({ onLogMessage }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState(null); // { page, tech, cookies, cookieNote, passive }
  const extraRef = useRef({}); // onReport output from Path Prober / Crawler

  const log = (m) => onLogMessage?.(m);
  const normalized = () => { let t = url.trim(); if (t && !/^https?:\/\//i.test(t)) t = 'https://' + t; return t; };

  const analyze = async () => {
    const target = normalized();
    if (!target) return;
    setBusy(true); setError(''); setData(null);
    log(`Analyze ${target}${isProxyEnabled() ? ' (via proxy)' : ''}`);
    const start = performance.now();
    try {
      const resp = await proxiedFetch(target, { redirect: 'follow' });
      const html = await resp.text();
      const headersLower = {};
      [...resp.headers.entries()].forEach(([k, v]) => { headersLower[k.toLowerCase()] = v; });
      const resources = extractResources(html, target);
      const names = headersLower['set-cookie'] ? cookieNames(headersLower['set-cookie']) : [];
      const page = {
        finalUrl: resp.url || target,
        status: resp.status, statusText: resp.statusText,
        timeMs: Math.round(performance.now() - start), size: html.length,
        headers: Object.fromEntries([...resp.headers.entries()]),
        security: assessSecurityHeaders(headersLower),
        title: extractTitle(html), meta: extractMeta(html),
        links: extractLinks(html, target), resources, forms: extractForms(html, target),
      };
      const tech = detectTech({ headers: headersLower, html, cookieNames: names, scripts: resources.scripts });
      const cookies = headersLower['set-cookie'] ? analyzeSetCookies(headersLower['set-cookie']) : [];
      const cookieNote = headersLower['set-cookie'] ? '' : 'No Set-Cookie header was visible to the browser (browsers hide it from fetch() unless a proxy forwards it).';
      // passive scan does its own fetch; tolerate failure independently
      let passive = null;
      try { const r = await runPassiveScan(target); passive = r.ok ? { alerts: r.alerts, note: r.note } : { alerts: [], note: r.error }; } catch (e) { passive = { alerts: [], note: describeNetworkError(e) }; }
      setData({ target, page, tech, cookies, cookieNote, passive });
      log(`Analyze done — ${page.status}, ${tech.length} tech, ${cookies.length} cookie(s), ${passive.alerts.length} passive finding(s)`);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  const onExtraReport = useCallback((key, payload) => { extraRef.current[key] = payload; }, []);

  const buildMarkdown = () => {
    const now = new Date().toISOString();
    const L = [`# Web analysis — ${data?.target || normalized()}`, '', `_Generated ${now} by Skon's USB Tool — Web Analyzer._`, ''];
    if (data) {
      const { page, tech, cookies, cookieNote, passive } = data;
      L.push('## Summary', '', `- **Status:** ${page.status} ${page.statusText} · ${(page.size / 1024).toFixed(1)} KB · ${page.timeMs} ms`, `- **Final URL:** ${page.finalUrl}`);
      if (page.title) L.push(`- **Title:** ${page.title}`);
      L.push('', '### Security headers');
      page.security.forEach((h) => L.push(`- ${h.present ? '✅' : '❌'} ${h.header}${h.value ? `: \`${h.value}\`` : ''}`));
      L.push('');
      L.push('## Technology', '');
      if (tech.length) tech.forEach((t) => L.push(`- **${t.name}** (${t.category}) — \`${t.evidence}\``)); else L.push('_No technologies matched._');
      L.push('');
      L.push('## Cookies', '');
      if (cookies.length) cookies.forEach((c) => { L.push(`- \`${c.name}\` — Secure ${c.secure ? '✅' : '❌'} · HttpOnly ${c.httpOnly ? '✅' : '❌'} · SameSite ${c.sameSite || '❌'}`); c.warnings.forEach((w) => L.push(`  - ⚠ ${w}`)); });
      else L.push(cookieNote || '_No cookies._');
      L.push('');
      L.push('## Passive scan', '');
      if (passive.alerts.length) passive.alerts.forEach((a) => L.push(`- **${a.severity}**${a.cwe ? ` (CWE-${a.cwe})` : ''} — ${a.desc}`)); else L.push(passive.note || '_No findings._');
      L.push('');
      L.push('## Resources', '', `- Links: ${page.links.length}`, `- Scripts: ${page.resources.scripts.length}`, `- Stylesheets: ${page.resources.styles.length}`, `- Images: ${page.resources.images.length}`, '');
      if (page.forms.length) { L.push('### Forms'); page.forms.forEach((f) => L.push(`- ${f.method} ${f.action} — ${f.inputs.map((i) => `${i.name || '—'}:${i.type}`).join(', ') || 'no inputs'}`)); L.push(''); }
    } else { L.push('_No analysis has been run._', ''); }
    if (extraRef.current.paths) { L.push('## Path Prober', '', extraRef.current.paths.markdown || '_No findings._', ''); }
    if (extraRef.current.crawler) { L.push('## Crawler', '', extraRef.current.crawler.markdown || '_No pages._', ''); }
    return L.join('\n');
  };

  const exportMd = () => {
    const host = (() => { try { return new URL(data?.target || normalized()).hostname; } catch { return 'report'; } })();
    const blob = new Blob([buildMarkdown()], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `web-analysis-${host}-${new Date().toISOString().slice(0, 10)}.md`; a.click(); URL.revokeObjectURL(a.href);
    log('Exported Web Analyzer report (.md)');
  };

  const d = data;
  const seedTarget = d?.target || '';

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200 px-4 pt-3 pb-4">
      <ProxyConfig onLogMessage={log} />
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !busy && analyze()} placeholder="https://example.com" className="flex-1 min-w-[14rem] bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-sm font-mono" />
        <button onClick={analyze} disabled={busy} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
          {busy ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />} {busy ? 'Analyzing…' : 'Analyze'}
        </button>
        <button onClick={exportMd} disabled={!d} title={d ? 'Export everything to Markdown' : 'Analyze first'} className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-gray-200 rounded text-sm hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1">
          <FileDown size={14} /> Export (.md)
        </button>
      </div>

      {error && <div className="mb-3 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{error}</div>}

      {d && (
        <>
          <div className="mb-3 flex items-center gap-3 flex-wrap text-xs">
            <span className={d.page.status >= 400 ? 'text-red-400' : d.page.status >= 300 ? 'text-amber-400' : 'text-green-400'}>{d.page.status} {d.page.statusText}</span>
            <span className="text-gray-500">{(d.page.size / 1024).toFixed(1)} KB · {d.page.timeMs} ms</span>
            <span className="text-slate-400 font-mono break-all">{d.page.finalUrl}</span>
          </div>
          {d.page.title && <div className="text-sm text-gray-200 mb-2">{d.page.title}</div>}

          <Section icon={ShieldCheck} title="Security headers">
            <div className="flex flex-wrap gap-1.5">
              {d.page.security.map((h) => (
                <span key={h.header} title={h.value || 'absent'} className={`px-2 py-0.5 rounded text-[10px] border inline-flex items-center gap-1 ${h.present ? 'border-emerald-800 bg-emerald-950/20 text-emerald-300' : 'border-red-900 bg-red-950/20 text-red-300'}`}>
                  {h.present ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />} {h.header}
                </span>
              ))}
            </div>
          </Section>

          <Section icon={Fingerprint} title="Technology" count={d.tech.length} accent="text-purple-400">
            {d.tech.length === 0 ? <div className="text-slate-600">No technologies matched.</div> : (
              <div className="flex flex-wrap gap-1.5">
                {d.tech.map((t) => <span key={t.name} title={t.evidence} className="px-2 py-0.5 rounded text-[11px] bg-slate-800 border border-slate-700 text-gray-200">{t.name} <span className="text-slate-500">· {t.category}</span></span>)}
              </div>
            )}
          </Section>

          <Section icon={Cookie} title="Cookies" count={d.cookies.length} accent="text-amber-400">
            {d.cookies.length === 0 ? <div className="text-slate-500">{d.cookieNote || 'No cookies.'}</div> : d.cookies.map((c, i) => (
              <div key={i} className="mb-1.5 last:mb-0">
                <span className="font-mono text-gray-100">{c.name}</span>
                <span className="ml-2 inline-flex gap-1">
                  {[['Secure', c.secure], ['HttpOnly', c.httpOnly], [`SameSite${c.sameSite ? '=' + c.sameSite : ''}`, !!c.sameSite]].map(([l, on]) => (
                    <span key={l} className={`px-1.5 py-0.5 rounded text-[10px] border ${on ? 'border-emerald-800 text-emerald-300' : 'border-red-900 text-red-300'}`}>{on ? '✓' : '✗'} {l}</span>
                  ))}
                </span>
                {c.warnings.map((w, j) => <div key={j} className="text-[10px] text-amber-300/80 pl-2">⚠ {w}</div>)}
              </div>
            ))}
          </Section>

          <Section icon={ShieldAlert} title="Passive scan" count={d.passive.alerts.length} accent="text-orange-400">
            {d.passive.note && <div className="text-[10px] text-slate-500 mb-1">{d.passive.note}</div>}
            {d.passive.alerts.map((a, i) => (
              <div key={i} className="py-0.5"><span className={`font-semibold ${SEV_COLOR[a.severity] || ''}`}>{a.severity}</span>{a.cwe ? <span className="text-slate-500 font-mono"> CWE-{a.cwe}</span> : ''} — <span className="text-gray-300">{a.desc}</span></div>
            ))}
          </Section>

          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
            <Section icon={Link2} title="Links" count={d.page.links.length}><List items={d.page.links} /></Section>
            <Section icon={FileCode} title="Scripts" count={d.page.resources.scripts.length}><List items={d.page.resources.scripts} /></Section>
            <Section icon={Code2} title="Stylesheets" count={d.page.resources.styles.length}><List items={d.page.resources.styles} /></Section>
            <Section icon={Image} title="Images" count={d.page.resources.images.length}><List items={d.page.resources.images} /></Section>
          </div>

          <Section icon={FileCode} title="Forms" count={d.page.forms.length}>
            {d.page.forms.length === 0 ? <div className="text-slate-600">none</div> : d.page.forms.map((f, i) => (
              <div key={i} className="mb-1.5 pb-1.5 border-b border-slate-900 last:border-0 text-[11px] font-mono">
                <div><span className={f.method === 'POST' ? 'text-amber-400' : 'text-green-400'}>{f.method}</span> <span className="text-cyan-400 break-all">{f.action}</span></div>
                <div className="text-slate-500 pl-2">{f.inputs.map((inp) => `${inp.name || '—'}:${inp.type}`).join('  ·  ') || 'no named inputs'}</div>
              </div>
            ))}
          </Section>

          <details className="mb-3">
            <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-gray-200">Response headers & meta ({Object.keys(d.page.headers).length} + {Object.keys(d.page.meta).length})</summary>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))] mt-2">
              <Section icon={Globe} title="Response headers"><List items={Object.entries(d.page.headers).map(([k, v]) => `${k}: ${v}`)} linkify={false} /></Section>
              <Section icon={FileCode} title="Meta tags"><List items={Object.entries(d.page.meta).map(([k, v]) => `${k}: ${v}`)} linkify={false} /></Section>
            </div>
          </details>
        </>
      )}

      {/* On-demand, long-running sections */}
      <details className="mt-2 border-t border-slate-800 pt-3" open={false}>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-rose-300">Path Prober (on-demand)</summary>
        <div className="mt-1"><NiktoScannerWorkbench onLogMessage={onLogMessage} hideProxyConfig initialTarget={seedTarget} onReport={(p) => onExtraReport('paths', p)} /></div>
      </details>
      <details className="mt-2 border-t border-slate-800 pt-3">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-emerald-300">Crawler (on-demand)</summary>
        <div className="mt-1"><CrawlerTab onLogMessage={onLogMessage} initialTarget={seedTarget} onReport={(p) => onExtraReport('crawler', p)} /></div>
      </details>

      {!d && !error && <p className="text-[10px] text-slate-500 mt-3">One Analyze fetches the page once and shows its security headers, technology stack, cookie flags, passive-scan findings, links/resources and forms together. Path Prober and Crawler run on demand below. Export compiles everything to one Markdown file.</p>}
    </div>
  );
}
