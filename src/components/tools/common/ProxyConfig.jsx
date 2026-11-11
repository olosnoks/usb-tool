import React, { useState } from 'react';
import { Copy, Check, Plug } from 'lucide-react';
import { getProxyUrl, setProxyUrl } from '../../../utils/netClient';
import { getBackendUrl } from '../../../utils/backendClient';
import DockerBackendControl from './DockerBackendControl';

/**
 * Shared proxy configuration bar for the network security workbenches.
 * Lets the user switch between direct-from-browser requests (CORS-limited) and
 * routing through a local proxy that can reach arbitrary targets. The Docker
 * button spins that proxy (and, for specialized tools, their own backend) up
 * locally. Pass `backend` to point the button at this tool's service.
 */
export default function ProxyConfig({ onLogMessage, backend = 'cors-proxy' }) {
  const [url, setUrl] = useState(getProxyUrl());
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  // The bundled CORS proxy's URL (backend/cors-proxy, port 47101 unless changed
  // in the Docker control below) in the {url} placeholder form netClient expects.
  const localProxyUrl = `${getBackendUrl('cors-proxy')}/fetch?url={url}`;

  const save = () => {
    setProxyUrl(url.trim());
    setSaved(true);
    onLogMessage?.(url.trim() ? `Proxy set: ${url.trim()}` : 'Proxy cleared (direct mode)');
    setTimeout(() => setSaved(false), 1500);
  };
  const useLocal = () => {
    setUrl(localProxyUrl);
    setProxyUrl(localProxyUrl);
    setSaved(true);
    onLogMessage?.(`Proxy set: ${localProxyUrl}`);
    setTimeout(() => setSaved(false), 1500);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url.trim() || localProxyUrl); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* clipboard blocked */ }
  };

  return (
    <div className="mb-3 p-2 border border-slate-800 rounded bg-slate-900/50">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-400 whitespace-nowrap">Proxy:</span>
        <input
          type="text"
          placeholder={`direct (CORS-limited) — e.g. ${localProxyUrl}`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200"
        />
        <button onClick={useLocal} title={`Fill in and save the bundled local proxy: ${localProxyUrl}`} className="px-2 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 inline-flex items-center gap-1 whitespace-nowrap">
          <Plug size={11} /> Use localhost
        </button>
        <button onClick={copy} title={url.trim() ? 'Copy the proxy URL' : `Copy the local proxy URL (${localProxyUrl})`} className="px-2 py-1 bg-slate-800 text-gray-300 rounded text-xs hover:bg-slate-700">
          {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        </button>
        <button onClick={save} className="px-2 py-1 bg-slate-700 text-gray-200 rounded text-xs hover:bg-slate-600">
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
      <p className="text-[10px] text-gray-500 mt-1">
        Empty = direct browser fetch (only CORS-permissive targets). <b>Use localhost</b> fills in the bundled proxy
        (<code>node backend/cors-proxy/server.cjs</code> or the Docker control below); or set any proxy URL with a{' '}
        <code>{'{url}'}</code> placeholder, or a prefix the target URL is appended to.
      </p>
      <DockerBackendControl backend={backend} onLogMessage={onLogMessage} />
    </div>
  );
}
