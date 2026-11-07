import React, { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Container, Copy, Download, FolderDown, HeartPulse, CheckCircle2, XCircle, ShieldAlert, Plug } from 'lucide-react';
import { SERVICES, TOOL_BACKENDS, buildComposeYaml, backendFileBundle } from '../../utils/backends';
import { getBackendUrl, setBackendUrl, checkHealth } from '../../utils/backendClient';
import { setProxyUrl } from '../../utils/netClient';

const toolsForService = (sid) =>
  Object.entries(TOOL_BACKENDS).filter(([, v]) => v === sid).map(([k]) => k);

export default function DockerBackendsWorkbench({ onLogMessage }) {
  const log = (m) => onLogMessage?.(m);
  const [includeOffensive, setIncludeOffensive] = useState(false);
  const [authorizeHydra, setAuthorizeHydra] = useState(false);
  const [urls, setUrls] = useState(() => Object.fromEntries(SERVICES.map((s) => [s.id, getBackendUrl(s.id)])));
  const [health, setHealth] = useState({}); // id -> {ok,error,data}
  const [copied, setCopied] = useState(false);

  const compose = useMemo(
    () => buildComposeYaml({ includeOffensive, authorizeHydra }),
    [includeOffensive, authorizeHydra],
  );

  const copyCompose = async () => {
    try { await navigator.clipboard.writeText(compose); setCopied(true); setTimeout(() => setCopied(false), 1500); log('Copied docker-compose.yml'); }
    catch { log('Clipboard blocked — use Download instead'); }
  };
  const downloadCompose = () => {
    const blob = new Blob([compose], { type: 'text/yaml' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'docker-compose.yml'; a.click(); URL.revokeObjectURL(a.href);
    log('Downloaded docker-compose.yml');
  };
  const downloadZip = async () => {
    const zip = new JSZip();
    const root = zip.folder('skons-backend');
    backendFileBundle().forEach(({ path, content }) => root.file(path, content));
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'skons-backend.zip'; a.click(); URL.revokeObjectURL(a.href);
    log('Downloaded skons-backend.zip (all Docker files)');
  };

  const saveUrl = (id) => { setBackendUrl(id, urls[id]); log(`${id} backend URL saved: ${urls[id]}`); };
  const ping = async (id) => {
    setHealth((h) => ({ ...h, [id]: { pending: true } }));
    const r = await checkHealth(id);
    setHealth((h) => ({ ...h, [id]: r }));
    log(`${id} health: ${r.ok ? 'reachable' : `unreachable (${r.error})`}`);
  };
  const useAsProxy = () => {
    const base = getBackendUrl('cors-proxy');
    const url = `${base}/fetch?url={url}`;
    setProxyUrl(url);
    log(`Proxy set to CORS backend: ${url}`);
  };

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200 px-4 pt-3 pb-6">
      <div className="flex items-center gap-2 mb-2">
        <Container size={18} className="text-cyan-400" />
        <h2 className="text-base font-semibold">Docker Backends</h2>
      </div>
      <p className="text-xs text-slate-400 mb-3 max-w-3xl">
        The app runs entirely in your browser. These optional local containers give the security tools
        capabilities a browser cannot have on its own: cross-origin fetches, real nmap scans, live TLS
        handshakes and arbitrary DNS. Each tool talks to its own service on <code>localhost</code>. Save the
        compose file below, run it, then point each tool at its service here. Only assess systems you own or
        are authorized to test.
      </p>

      {/* compose controls */}
      <div className="border border-slate-800 rounded bg-slate-900/50 p-3 mb-4">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-cyan-300">docker-compose.yml</span>
          <label className="text-xs text-slate-300 inline-flex items-center gap-1">
            <input type="checkbox" checked={includeOffensive} onChange={(e) => { setIncludeOffensive(e.target.checked); if (!e.target.checked) setAuthorizeHydra(false); }} />
            include Hydra (offensive)
          </label>
          {includeOffensive && (
            <label className="text-xs text-amber-300 inline-flex items-center gap-1">
              <input type="checkbox" checked={authorizeHydra} onChange={(e) => setAuthorizeHydra(e.target.checked)} />
              I am authorized to test the targets
            </label>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={copyCompose} className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-xs hover:bg-slate-700 inline-flex items-center gap-1"><Copy size={12} /> {copied ? 'Copied' : 'Copy'}</button>
            <button onClick={downloadCompose} title="Single self-contained compose file" className="px-2.5 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 inline-flex items-center gap-1"><Download size={12} /> compose.yml</button>
            <button onClick={downloadZip} title="All Docker files: build-based compose, Dockerfiles, servers, README" className="px-2.5 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 inline-flex items-center gap-1"><FolderDown size={12} /> All files (.zip)</button>
          </div>
        </div>
        {includeOffensive && (
          <div className="mb-2 p-2 border border-amber-900/60 bg-amber-950/20 rounded text-[11px] text-amber-200 inline-flex items-start gap-1.5">
            <ShieldAlert size={13} className="mt-0.5 shrink-0" />
            <span>Hydra performs online credential attacks. Start it only with <code>docker compose --profile offensive up -d</code> and only against systems you are explicitly authorized to test.</span>
          </div>
        )}
        <pre className="max-h-64 overflow-auto bg-slate-950 border border-slate-800 rounded p-2 text-[10px] font-mono leading-relaxed text-slate-300">{compose}</pre>
        <div className="mt-2 text-[11px] text-slate-400 font-mono">
          <div># compose.yml is self-contained (one file). All files (.zip) gives the</div>
          <div># real Dockerfiles + sources if you prefer building. Then, in that folder:</div>
          <div>docker compose up -d{includeOffensive ? '   # add --profile offensive for Hydra' : ''}</div>
        </div>
      </div>

      {/* services */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
        {SERVICES.map((s) => {
          const h = health[s.id];
          const tools = toolsForService(s.id);
          return (
            <div key={s.id} className="border border-slate-800 rounded bg-slate-950 p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-gray-100">{s.name}</span>
                <span className="text-[10px] text-slate-500 font-mono">:{s.port}</span>
                {s.offensive && <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-900 text-amber-300">offensive</span>}
                <div className="ml-auto">
                  {h?.pending ? <span className="text-[10px] text-slate-500">checking…</span>
                    : h ? (h.ok ? <span className="text-[10px] text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={11} /> reachable</span>
                      : <span className="text-[10px] text-red-400 inline-flex items-center gap-1" title={h.error}><XCircle size={11} /> down</span>)
                      : null}
                </div>
              </div>
              <p className="text-[11px] text-slate-400 mb-2">{s.description}</p>
              <div className="text-[10px] text-slate-500 mb-2 font-mono">image: {s.image || s.baseImage}</div>
              {tools.length > 0 && (
                <div className="text-[10px] text-slate-500 mb-2">used by: <span className="text-slate-400">{tools.join(', ')}</span></div>
              )}
              <div className="flex gap-1.5">
                <input
                  value={urls[s.id] ?? ''}
                  onChange={(e) => setUrls((u) => ({ ...u, [s.id]: e.target.value }))}
                  placeholder={`http://localhost:${s.port}`}
                  className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[11px] font-mono"
                />
                <button onClick={() => saveUrl(s.id)} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] hover:bg-slate-700">Save</button>
                <button onClick={() => ping(s.id)} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[11px] hover:bg-slate-700 inline-flex items-center gap-1"><HeartPulse size={11} /> Check</button>
              </div>
              {s.id === 'cors-proxy' && (
                <button onClick={useAsProxy} className="mt-2 w-full px-2 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-[11px] hover:bg-cyan-900/70 inline-flex items-center justify-center gap-1">
                  <Plug size={11} /> Use as proxy for all fetch tools
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
