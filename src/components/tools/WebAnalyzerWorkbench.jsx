import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Search, RefreshCw, FileDown, ShieldCheck, ShieldAlert, Link2, FileCode, Image, Code2, Fingerprint, Cookie, Globe } from 'lucide-react';
import { proxiedFetch, describeNetworkError, isProxyEnabled, getSetCookie, getRedirectChain } from '../../utils/netClient';
import ProxyConfig from './common/ProxyConfig';
import { extractTitle, assessSecurityHeaders, extractLinks, extractResources, extractMeta, extractForms, gradeSecurityHeaders } from '../../utils/urlinspect.js';
import { detectTech } from '../../utils/fingerprint.js';
import { analyzeSetCookies, cookieNames } from '../../utils/cookies.js';
import { scanHeaders } from '../../utils/webScan.js';
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

function Section({ icon: Icon, title, count, accent = 'text-cyan-400', id, children }) {
  return (
    <section id={id} className="mb-3">
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

const ICON = { good: '✅', warn: '⚠️', bad: '❌', absent: '➖' };
const STATUS_CLASS = {
  good: 'border-emerald-800 bg-emerald-950/20 text-emerald-300',
  warn: 'border-amber-800 bg-amber-950/20 text-amber-300',
  bad: 'border-red-900 bg-red-950/20 text-red-300',
  absent: 'border-slate-700 bg-slate-900 text-slate-400',
};
const GRADE_CLASS = { A: 'text-emerald-300 border-emerald-700', B: 'text-lime-300 border-lime-700', C: 'text-amber-300 border-amber-700', D: 'text-orange-300 border-orange-700', F: 'text-red-300 border-red-800' };
const SEV_COLOR = { High: 'text-red-400', Medium: 'text-orange-400', Low: 'text-yellow-400', Info: 'text-gray-400' };

// initialTab -> which section to open/scroll to (paths | crawler open an on-demand
// section; passive | links scroll to that result block once an analysis exists).
export const WEB_ANALYZER_TABS = { paths: 'wa-paths', crawler: 'wa-crawler', passive: 'wa-passive', links: 'wa-links' };

export default function WebAnalyzerWorkbench({ onLogMessage, initialTab }) {
  const [pathsOpen, setPathsOpen] = useState(initialTab === 'paths');
  const [crawlerOpen, setCrawlerOpen] = useState(initialTab === 'crawler');
  const scrolledRef = useRef(false);
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
      // Set-Cookie is hidden from fetch(); only the bundled proxy forwards it (x-proxy-set-cookie).
      const cookieList = getSetCookie(resp);
      const redirects = getRedirectChain(resp);
      const names = cookieList ? cookieNames(cookieList) : [];
      const grade = gradeSecurityHeaders(resp.headers, html, { baseUrl: resp.url || target });
      const page = {
        finalUrl: resp.url || target,
        status: resp.status, statusText: resp.statusText,
        timeMs: Math.round(performance.now() - start), size: new TextEncoder().encode(html).length,
        headers: Object.fromEntries([...resp.headers.entries()]),
        security: assessSecurityHeaders(headersLower),
        grade, redirects,
        title: extractTitle(html), meta: extractMeta(html),
        links: extractLinks(html, target), resources, forms: extractForms(html, target),
      };
      const tech = detectTech({ headers: headersLower, html, cookieNames: names, scripts: resources.scripts });
      const cookies = cookieList ? analyzeSetCookies(cookieList) : [];
      const cookieNote = cookieList
        ? (cookies.length ? '' : 'The proxy reported no Set-Cookie headers.')
        : 'Set-Cookie is hidden by browsers; run the bundled proxy to see cookie flags.';
      // passive scan reuses the headers from this single fetch
      const passive = scanHeaders(target, resp.headers, { status: resp.status, setCookies: cookieList });
      setData({ target, page, tech, cookies, cookieNote, passive });
      log(`Analyze done — ${page.status}, ${tech.length} tech, ${cookies.length} cookie(s), ${passive.alerts.length} passive finding(s)`);
    } catch (e) { setError(describeNetworkError(e)); }
    setBusy(false);
  };

  useEffect(() => {
    if (scrolledRef.current) return;
    const id = WEB_ANALYZER_TABS[initialTab];
    const el = id && document.getElementById(id);
    if (el) { scrolledRef.current = true; el.scrollIntoView?.({ block: 'start' }); }
  }, [initialTab, data]);

  const onExtraReport = useCallback((key, payload) => { extraRef.current[key] = payload; }, []);

  const buildMarkdown = () => {
    const now = new Date().toISOString();
    const L = [`# Web analysis — ${data?.target || normalized()}`, '', `_Generated ${now} by Skon's USB Tool — Web Analyzer._`, ''];
    if (data) {
      const { page, tech, cookies, cookieNote, passive } = data;
      L.push('## Summary', '', `- **Status:** ${page.status} ${page.statusText} · ${(page.size / 1024).toFixed(1)} KB · ${page.timeMs} ms`, `- **Final URL:** ${page.finalUrl}`);
      if (page.title) L.push(`- **Title:** ${page.title}`);
      if (page.redirects?.length) { L.push('- **Redirect chain:** ' + page.redirects.map((r) => `${r.status} ${r.url}`).join(' → ')); }
      L.push('', `### Security headers — grade ${page.grade.grade} (${page.grade.score}/100)`, '');
      page.grade.headers.forEach((h) => L.push(`- ${ICON[h.status]} **${h.header}** (${h.status})${h.value ? `: \`${h.value}\`` : ''} — ${h.reason}`));
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

  const exportJson = () => {
    const host = (() => { try { return new URL(data?.target || normalized()).hostname; } catch { return 'report'; } })();
    const { page, tech, cookies, cookieNote, passive, target } = data;
    const out = { target, generatedAt: new Date().toISOString(), status: page.status, finalUrl: page.finalUrl, sizeBytes: page.size, redirects: page.redirects, grade: page.grade, tech, cookies, cookieNote, passive, forms: page.forms, resources: page.resources };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `web-analysis-${host}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(a.href);
    log('Exported Web Analyzer report (.json)');
  };

  const d = data;

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
        <button onClick={exportJson} disabled={!d} title={d ? 'Export to JSON' : 'Analyze first'} className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-gray-200 rounded text-sm hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1">
          <FileDown size={14} /> Export (.json)
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

          {d.page.redirects?.length > 0 && (
            <Section icon={Link2} title="Redirect chain" count={d.page.redirects.length} accent="text-sky-400">
              <List items={d.page.redirects.map((r) => `${r.status} ${r.url}`)} linkify={false} />
            </Section>
          )}

          <Section icon={ShieldCheck} title="Security headers">
            <div className="flex items-center gap-2 mb-2">
              <span title={`${d.page.grade.score}/100`} className={`px-2.5 py-0.5 rounded border text-lg font-bold ${GRADE_CLASS[d.page.grade.grade]}`}>{d.page.grade.grade}</span>
              <span className="text-slate-500 text-[11px]">{d.page.grade.score}/100, based on header values, not just presence</span>
            </div>
            <div className="space-y-1">
              {d.page.grade.headers.map((h) => (
                <div key={h.header} className="flex items-start gap-2">
                  <span title={h.value || 'absent'} className={`shrink-0 px-2 py-0.5 rounded text-[10px] border inline-flex items-center gap-1 ${STATUS_CLASS[h.status]}`}>
                    {h.status === 'good' ? <ShieldCheck size={10} /> : <ShieldAlert size={10} />} {h.header}
                  </span>
                  <span className="text-[11px] text-gray-400 break-words min-w-0">{h.reason}</span>
                </div>
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

          <Section id="wa-passive" icon={ShieldAlert} title="Passive scan" count={d.passive.alerts.length} accent="text-orange-400">
            {d.passive.note && <div className="text-[10px] text-slate-500 mb-1">{d.passive.note}</div>}
            {d.passive.alerts.map((a, i) => (
              <div key={i} className="py-0.5"><span className={`font-semibold ${SEV_COLOR[a.severity] || ''}`}>{a.severity}</span>{a.cwe ? <span className="text-slate-500 font-mono"> CWE-{a.cwe}</span> : ''} — <span className="text-gray-300">{a.desc}</span></div>
            ))}
          </Section>

          <div id="wa-links" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
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
      <details id="wa-paths" className="mt-2 border-t border-slate-800 pt-3" open={pathsOpen} onToggle={(e) => setPathsOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-rose-300">Path Prober (on-demand)</summary>
        <div className="mt-1"><NiktoScannerWorkbench onLogMessage={onLogMessage} hideProxyConfig fixedTarget={normalized()} onReport={(p) => onExtraReport('paths', p)} /></div>
      </details>
      <details id="wa-crawler" className="mt-2 border-t border-slate-800 pt-3" open={crawlerOpen} onToggle={(e) => setCrawlerOpen(e.currentTarget.open)}>
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-emerald-300">Crawler (on-demand)</summary>
        <div className="mt-1"><CrawlerTab onLogMessage={onLogMessage} fixedTarget={normalized()} onReport={(p) => onExtraReport('crawler', p)} /></div>
      </details>

      {!d && !error && <p className="text-[10px] text-slate-500 mt-3">One Analyze fetches the page once and shows its security headers, technology stack, cookie flags, passive-scan findings, links/resources and forms together. Path Prober and Crawler run on demand below. Export compiles everything to one Markdown file.</p>}
    </div>
  );
}
