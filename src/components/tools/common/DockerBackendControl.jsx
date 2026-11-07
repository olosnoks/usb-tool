import React, { useMemo, useState } from 'react';
import JSZip from 'jszip';
import { Container, Copy, Download, FolderDown, HeartPulse, CheckCircle2, XCircle, Plug, ShieldAlert } from 'lucide-react';
import { serviceById, buildComposeYaml, backendFileBundle } from '../../../utils/backends';
import { getBackendUrl, setBackendUrl, checkHealth } from '../../../utils/backendClient';
import { setProxyUrl } from '../../../utils/netClient';

/**
 * Per-tool "Docker backend" control. A tool that needs a local backend drops this
 * in (usually via ProxyConfig). It expands to: this tool's service URL + health
 * check, a one-click proxy setup for the CORS proxy, and copy/download of the
 * compose (single self-contained file) or all Docker files as a zip.
 */
export default function DockerBackendControl({ backend = 'cors-proxy', onLogMessage }) {
  const svc = serviceById(backend) || serviceById('cors-proxy');
  const isProxy = svc.id === 'cors-proxy';
  const isHydra = svc.id === 'hydra';
  const log = (m) => onLogMessage?.(m);

  const [open, setOpen] = useState(false);
  const [includeOffensive, setIncludeOffensive] = useState(isHydra);
  const [authorizeHydra, setAuthorizeHydra] = useState(false);
  const [url, setUrl] = useState(getBackendUrl(svc.id));
  const [health, setHealth] = useState(null);
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
  const save = () => { setBackendUrl(svc.id, url); log(`${svc.id} backend URL saved: ${url}`); };
  const ping = async () => {
    setHealth({ pending: true });
    const r = await checkHealth(svc.id);
    setHealth(r);
    log(`${svc.id} health: ${r.ok ? 'reachable' : `unreachable (${r.error})`}`);
  };
  const useAsProxy = () => {
    const u = `${getBackendUrl('cors-proxy')}/fetch?url={url}`;
    setProxyUrl(u);
    log(`Proxy set to CORS backend: ${u}`);
  };

  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-cyan-900 bg-cyan-950/30 text-cyan-300 hover:bg-cyan-900/40"
        title={`Run the ${svc.name} backend locally with Docker`}
      >
        <Container size={12} /> Docker backend{isProxy ? '' : ` · ${svc.name}`}
      </button>

      {open && (
        <div className="mt-2 border border-slate-800 rounded bg-slate-950 p-2 text-[11px]">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-gray-100">{svc.name}</span>
            <span className="text-slate-500 font-mono">:{svc.port}</span>
            {svc.offensive && <span className="px-1.5 py-0.5 rounded border border-amber-900 text-amber-300">offensive</span>}
            <div className="ml-auto">
              {health?.pending ? <span className="text-slate-500">checking…</span>
                : health ? (health.ok ? <span className="text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 size={11} /> reachable</span>
                  : <span className="text-red-400 inline-flex items-center gap-1" title={health.error}><XCircle size={11} /> down</span>) : null}
            </div>
          </div>
          <p className="text-slate-400 mb-2">{svc.description}</p>

          <div className="flex gap-1.5 mb-2">
            <input value={url ?? ''} onChange={(e) => setUrl(e.target.value)} placeholder={`http://localhost:${svc.port}`}
              className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 font-mono" />
            <button onClick={save} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700">Save</button>
            <button onClick={ping} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 inline-flex items-center gap-1"><HeartPulse size={11} /> Check</button>
          </div>

          {isProxy && (
            <button onClick={useAsProxy} className="mb-2 w-full px-2 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded hover:bg-cyan-900/70 inline-flex items-center justify-center gap-1">
              <Plug size={11} /> Use as proxy for fetch tools
            </button>
          )}

          {isHydra && (
            <div className="mb-2 p-1.5 border border-amber-900/60 bg-amber-950/20 rounded text-amber-200 inline-flex items-start gap-1.5">
              <ShieldAlert size={12} className="mt-0.5 shrink-0" />
              <label className="inline-flex items-center gap-1">
                <input type="checkbox" checked={authorizeHydra} onChange={(e) => setAuthorizeHydra(e.target.checked)} />
                I am authorized to test the targets (enables Hydra in the compose)
              </label>
            </div>
          )}

          <div className="flex flex-wrap gap-1.5 mb-1">
            <button onClick={copyCompose} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 inline-flex items-center gap-1"><Copy size={11} /> {copied ? 'Copied' : 'Copy'}</button>
            <button onClick={downloadCompose} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 inline-flex items-center gap-1"><Download size={11} /> compose.yml</button>
            <button onClick={downloadZip} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded hover:bg-slate-700 inline-flex items-center gap-1"><FolderDown size={11} /> All files (.zip)</button>
          </div>
          <div className="text-slate-500 font-mono">then: docker compose up -d{includeOffensive ? '  (--profile offensive for Hydra)' : ''}</div>
        </div>
      )}
    </div>
  );
}
