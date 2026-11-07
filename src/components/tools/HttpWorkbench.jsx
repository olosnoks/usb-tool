import React, { useState } from 'react';
import { Send, FileCode } from 'lucide-react';
import ProxyConfig from './common/ProxyConfig';
import BurpProxyWorkbench from './BurpProxyWorkbench';
import ApiClientWorkbench from './ApiClientWorkbench';

/**
 * HTTP Workbench — combines the HTTP/HTTPS Repeater (Repeater / Intruder /
 * Comparer / Decoder) and the OpenAPI API Client under one tool. A single proxy
 * bar is shared across both; each section keeps its own layout.
 *
 * All requests go through fetch and are CORS-limited; set a proxy to reach
 * arbitrary hosts. Test only targets you own or are authorized to assess.
 */

const OUTER = [
  { id: 'request', label: 'Request Toolkit', icon: Send },
  { id: 'api', label: 'API Client (OpenAPI)', icon: FileCode },
];

export default function HttpWorkbench({ onLogMessage, initialSection = 'request' }) {
  const [section, setSection] = useState(OUTER.some((o) => o.id === initialSection) ? initialSection : 'request');
  const log = (m) => onLogMessage?.(m);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="px-4 pt-3">
        <ProxyConfig onLogMessage={log} />
        <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit">
          {OUTER.map((o) => {
            const Icon = o.icon;
            return (
              <button
                key={o.id}
                onClick={() => setSection(o.id)}
                className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${section === o.id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}
              >
                <Icon size={13} /> {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Keep both mounted so switching sections preserves their state. */}
      <div className={section === 'request' ? '' : 'hidden'}>
        <BurpProxyWorkbench onLogMessage={onLogMessage} hideProxyConfig />
      </div>
      <div className={section === 'api' ? '' : 'hidden'}>
        <ApiClientWorkbench onLogMessage={onLogMessage} hideProxyConfig />
      </div>
    </div>
  );
}
