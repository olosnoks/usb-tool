import React, { useState } from 'react';
import { getProxyUrl, setProxyUrl } from '../../../utils/netClient';

/**
 * Shared proxy configuration bar for the network security workbenches.
 * Lets the user switch between direct-from-browser requests (CORS-limited) and
 * routing through a local proxy that can reach arbitrary targets.
 */
export default function ProxyConfig({ onLogMessage }) {
  const [url, setUrl] = useState(getProxyUrl());
  const [saved, setSaved] = useState(false);

  const save = () => {
    setProxyUrl(url.trim());
    setSaved(true);
    onLogMessage?.(url.trim() ? `Proxy set: ${url.trim()}` : 'Proxy cleared (direct mode)');
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mb-3 p-2 border border-slate-800 rounded bg-slate-900/50">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 whitespace-nowrap">Proxy:</span>
        <input
          type="text"
          placeholder="direct (CORS-limited) — e.g. http://localhost:8080/{url}"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200"
        />
        <button onClick={save} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mt-1">
        Empty = direct browser fetch (only CORS-permissive targets). Set a proxy URL with a{' '}
        <code>{'{url}'}</code> placeholder, or a prefix the target URL is appended to, to reach any host.
      </p>
    </div>
  );
}
