import React, { useState, useCallback, useRef } from 'react';
import { Link2, ShieldAlert, FolderSearch, Fingerprint, Cookie, Waypoints, FileDown } from 'lucide-react';
import ProxyConfig from './common/ProxyConfig';
import UrlInspectorWorkbench from './UrlInspectorWorkbench';
import OwaspZapWorkbench from './OwaspZapWorkbench';
import NiktoScannerWorkbench from './NiktoScannerWorkbench';
import TechFingerprintTab from './webanalyzer/TechFingerprintTab';
import CookieAnalyzerTab from './webanalyzer/CookieAnalyzerTab';
import CrawlerTab from './webanalyzer/CrawlerTab';

/**
 * Web Analyzer — combines the URL-analysis tools under one roof with a single
 * shared proxy bar:
 *   • Links & Resources (URL/Link Analyzer) — fetch a page and map its links,
 *     scripts, styles, images, forms, meta and security headers.
 *   • Passive Scan (Web Scanner) — header/cookie/CORS/TLS findings.
 *   • Path Prober (Web Path Prober) — probe common sensitive paths.
 *
 * All requests go through fetch and are CORS-limited; set a proxy to reach
 * arbitrary hosts. Analyze only targets you own or are authorized to assess.
 */

const TABS = [
  { id: 'links', label: 'Links & Resources', icon: Link2, comp: UrlInspectorWorkbench },
  { id: 'tech', label: 'Tech Fingerprint', icon: Fingerprint, comp: TechFingerprintTab },
  { id: 'passive', label: 'Passive Scan', icon: ShieldAlert, comp: OwaspZapWorkbench },
  { id: 'cookies', label: 'Cookies', icon: Cookie, comp: CookieAnalyzerTab },
  { id: 'paths', label: 'Path Prober', icon: FolderSearch, comp: NiktoScannerWorkbench },
  { id: 'crawler', label: 'Crawler', icon: Waypoints, comp: CrawlerTab },
];

export default function WebAnalyzerWorkbench({ onLogMessage, initialTab = 'links' }) {
  const [tab, setTab] = useState(TABS.some((t) => t.id === initialTab) ? initialTab : 'links');
  // Latest report per tab, keyed by tab id: { url, markdown, time }.
  const reportsRef = useRef({});
  const [reported, setReported] = useState({}); // id -> true, for UI/count only
  const log = (m) => onLogMessage?.(m);

  const onReport = useCallback((sectionId, payload) => {
    reportsRef.current[sectionId] = { ...payload, time: new Date().toISOString() };
    setReported((r) => (r[sectionId] ? r : { ...r, [sectionId]: true }));
  }, []);

  const reportedCount = Object.keys(reported).length;

  const exportMarkdown = () => {
    const now = new Date();
    const lines = [
      `# Web Analyzer report`,
      '',
      `_Generated ${now.toISOString()} by Skon's USB Tool — Web Analyzer._`,
      '',
    ];
    // collect distinct targets for a summary line
    const targets = [...new Set(TABS.map((t) => reportsRef.current[t.id]?.url).filter(Boolean))];
    if (targets.length) { lines.push(`**Target(s):** ${targets.join(', ')}`, ''); }
    let any = false;
    for (const t of TABS) {
      const r = reportsRef.current[t.id];
      lines.push(`## ${t.label}`, '');
      if (!r) { lines.push('_Not run._', ''); continue; }
      any = true;
      if (r.url) lines.push(`**URL:** ${r.url}  `);
      lines.push(`**Captured:** ${r.time}`, '');
      lines.push((r.markdown || '').trim() || '_No findings._', '');
    }
    if (!any) { log('Nothing to export yet — run at least one tab first.'); }
    const md = lines.join('\n');
    const host = targets[0] ? (() => { try { return new URL(targets[0]).hostname; } catch { return 'report'; } })() : 'report';
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `web-analyzer-${host}-${now.toISOString().slice(0, 19).replace(/[:T]/g, '')}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
    log(`Exported Web Analyzer report (${reportedCount} section${reportedCount === 1 ? '' : 's'})`);
  };

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="px-4 pt-3">
        <ProxyConfig onLogMessage={log} />
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === t.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}
                >
                  <Icon size={13} /> {t.label}
                  {reported[t.id] && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="has findings" />}
                </button>
              );
            })}
          </div>
          <button
            onClick={exportMarkdown}
            disabled={reportedCount === 0}
            title={reportedCount === 0 ? 'Run at least one tab first' : 'Export all tab findings to a Markdown file'}
            className="ml-auto px-3 py-1.5 bg-slate-800 border border-slate-700 text-gray-200 rounded text-xs hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <FileDown size={13} /> Export report (.md){reportedCount ? ` · ${reportedCount}` : ''}
          </button>
        </div>
      </div>
      {/* Keep all mounted so switching tabs preserves each section's state. */}
      {TABS.map((t) => {
        const Comp = t.comp;
        return (
          <div key={t.id} className={tab === t.id ? '' : 'hidden'}>
            <Comp onLogMessage={onLogMessage} hideProxyConfig onReport={(payload) => onReport(t.id, payload)} />
          </div>
        );
      })}
    </div>
  );
}
