import React, { useState } from 'react';
import { Link2, ShieldAlert, FolderSearch, Fingerprint, Cookie, Waypoints } from 'lucide-react';
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
  const log = (m) => onLogMessage?.(m);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="px-4 pt-3">
        <ProxyConfig onLogMessage={log} />
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
              </button>
            );
          })}
        </div>
      </div>
      {/* Keep all mounted so switching tabs preserves each section's state. */}
      {TABS.map((t) => {
        const Comp = t.comp;
        return (
          <div key={t.id} className={tab === t.id ? '' : 'hidden'}>
            <Comp onLogMessage={onLogMessage} hideProxyConfig />
          </div>
        );
      })}
    </div>
  );
}
