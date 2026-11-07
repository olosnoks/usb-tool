import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Radio, Play, Square, Download, AlertTriangle } from 'lucide-react';
import { loadWasmStatus } from '../../utils/wasmLoader';
import { scanHost, parsePorts, buildPortSpec, PORT_PROFILES, TIMINGS, isBrowserBlockedPort } from '../../utils/portScan';
import { isProxyEnabled } from '../../utils/netClient';
import { isBackendConfigured, nmapScan } from '../../utils/backendClient';
import ProxyConfig from './common/ProxyConfig';

/**
 * TCP port scanner (connect-timing over fetch; browsers can't open raw sockets).
 * Toggleable port profiles + custom ports, nmap-style timing templates,
 * adjustable concurrency, show-all/open-only, and result export. If a WASM
 * engine (public/wasm/portscanner.wasm) is present it is used for real results.
 */
export default function NmapScannerWorkbench({ onLogMessage }) {
  const [target, setTarget] = useState('');
  const [selected, setSelected] = useState(['top20']);
  const [customPorts, setCustomPorts] = useState('');
  const [timing, setTiming] = useState('normal');
  const [concurrency, setConcurrency] = useState(8);
  const [forceScheme, setForceScheme] = useState('auto'); // auto | http | https
  const [showAll, setShowAll] = useState(false);
  const [results, setResults] = useState([]);
  const [method, setMethod] = useState('browser');
  const [wasmExports, setWasmExports] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [useBackend, setUseBackend] = useState(false);
  const backendAvailable = isBackendConfigured('nmap');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);
  const cancelRef = useRef(false);
  const startRef = useRef(0);

  const log = (msg) => onLogMessage?.(msg);

  useEffect(() => {
    (async () => {
      const status = await loadWasmStatus('/wasm/portscanner.wasm', {});
      if (status.ok && typeof status.exports.scan === 'function') {
        setWasmExports(status.exports); setMethod('wasm'); log('Port-scanner WASM engine loaded');
      } else { setMethod('browser'); log('Using browser connect-timing scanner (no WASM engine present)'); }
    })();
  }, []);

  // Keep concurrency in sync when the timing template changes.
  useEffect(() => { setConcurrency(TIMINGS[timing].concurrency); }, [timing]);

  // Default to the real nmap backend when one is configured.
  useEffect(() => { setUseBackend(isBackendConfigured('nmap')); }, []);

  const ports = useMemo(() => parsePorts(buildPortSpec(selected, customPorts)), [selected, customPorts]);
  const heavy = ports.length > 1500;

  const toggleProfile = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const runWasmScan = (host, portList) => {
    const { memory, scan, malloc, free } = wasmExports;
    const write = (str, ptr) => new Uint8Array(memory.buffer, ptr, str.length).set(new TextEncoder().encode(str));
    const portsStr = portList.join(',');
    const tPtr = malloc(host.length + 1); const pPtr = malloc(portsStr.length + 1);
    write(host, tPtr); write(portsStr, pPtr);
    const resultPtr = scan(tPtr, host.length, pPtr, portsStr.length);
    const memU8 = new Uint8Array(memory.buffer);
    let end = resultPtr; while (memU8[end] !== 0) end++;
    const json = new TextDecoder().decode(memU8.subarray(resultPtr, end));
    free(tPtr); free(pPtr); free(resultPtr);
    return JSON.parse(json);
  };

  const runScan = async () => {
    const host = target.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) { log('Enter a target host'); return; }
    if (ports.length === 0) { log('No ports selected'); return; }
    setScanning(true); setResults([]); setProgress({ done: 0, total: ports.length }); setElapsed(0);
    cancelRef.current = false; startRef.current = performance.now();
    const t = TIMINGS[timing];
    const via = useBackend && backendAvailable ? 'nmap backend' : method;
    log(`Scanning ${host} — ${ports.length} port(s), ${t.label}, concurrency ${concurrency}, via ${via}${isProxyEnabled() && via !== 'nmap backend' ? ' + proxy' : ''}…`);
    try {
      if (useBackend && backendAvailable) {
        const spec = buildPortSpec(selected, customPorts);
        const res = await nmapScan({ target: host, ports: spec, profile: 'version' });
        const mapped = (res.hosts || []).map((h) => ({
          port: h.port,
          state: h.state === 'open' ? 'open' : h.state === 'filtered' ? 'open|filtered' : 'closed',
          service: [h.service, h.version].filter(Boolean).join(' ').trim(),
          ms: null,
        })).sort((a, b) => a.port - b.port);
        setResults(mapped);
        setProgress({ done: ports.length, total: ports.length });
        log(`nmap backend: ${mapped.filter((r) => r.state === 'open').length} open of ${mapped.length} reported`);
      } else if (method === 'wasm') {
        const parsed = runWasmScan(host, ports);
        setResults(parsed); setProgress({ done: ports.length, total: ports.length });
      } else {
        let done = 0; const collected = [];
        await scanHost(host, ports, {
          concurrency: Math.max(1, Math.min(64, Number(concurrency) || 8)),
          timeoutMs: t.timeoutMs,
          closedThresholdMs: t.closedThresholdMs,
          forceScheme: forceScheme === 'auto' ? undefined : forceScheme,
          shouldStop: () => cancelRef.current,
          onResult: (r) => {
            done++; collected.push(r);
            setProgress({ done, total: ports.length });
            setElapsed(Math.round(performance.now() - startRef.current));
            setResults((prev) => [...prev, r].sort((a, b) => a.port - b.port));
          },
        });
        if (collected.length && collected.every((r) => r.state === 'closed')) {
          log('All ports closed/unreachable. From an HTTPS page only HTTPS targets and localhost are reachable without a proxy.');
        }
      }
      setElapsed(Math.round(performance.now() - startRef.current));
      log(cancelRef.current ? 'Scan stopped' : 'Scan complete');
    } catch (e) { log(`Scan error: ${e.message}`); }
    setScanning(false);
  };

  const counts = useMemo(() => {
    const c = { open: 0, 'open|filtered': 0, closed: 0, blocked: 0 };
    for (const r of results) c[r.state] = (c[r.state] || 0) + 1;
    return c;
  }, [results]);

  const shown = useMemo(() => {
    const list = showAll ? results : results.filter((r) => r.state.startsWith('open') || r.state === 'blocked');
    return [...list].sort((a, b) => a.port - b.port);
  }, [results, showAll]);

  const exportReport = (fmt) => {
    const host = target.trim();
    const header = `Port scan — ${host}\nScanned ${progress.done}/${progress.total} ports · ${TIMINGS[timing].label} · ${elapsed} ms\nopen ${counts.open} · open|filtered ${counts['open|filtered']} · closed ${counts.closed} · blocked ${counts.blocked}\n`;
    let body;
    if (fmt === 'md') {
      body = `# Port scan — ${host}\n\n- Ports probed: ${progress.done}/${progress.total}\n- Timing: ${TIMINGS[timing].label} · ${elapsed} ms\n- open ${counts.open} · open|filtered ${counts['open|filtered']} · closed ${counts.closed} · blocked ${counts.blocked}\n\n| Port | State | Service | Time |\n|---|---|---|---|\n` +
        [...results].sort((a, b) => a.port - b.port).map((r) => `| ${r.port} | ${r.state} | ${r.service || ''} | ${r.ms != null ? r.ms + 'ms' : ''} |`).join('\n') + '\n';
    } else {
      body = header + '\nPORT\tSTATE\tSERVICE\tTIME\n' +
        [...results].sort((a, b) => a.port - b.port).map((r) => `${r.port}\t${r.state}\t${r.service || ''}\t${r.ms != null ? r.ms + 'ms' : ''}`).join('\n') + '\n';
    }
    const blob = new Blob([body], { type: fmt === 'md' ? 'text/markdown' : 'text/plain' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `portscan-${host || 'host'}.${fmt === 'md' ? 'md' : 'txt'}`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-4 text-gray-200">
      <p className="text-xs text-gray-400 mb-2">
        {method === 'wasm' ? 'Scanning via the WebAssembly engine.' : 'Connect-timing scan over fetch (browser heuristic): open = a service answered; closed = refused fast; open|filtered = stalled; blocked = port Chrome refuses to fetch.'}
      </p>
      <ProxyConfig onLogMessage={onLogMessage} />

      {backendAvailable && (
        <label className="mb-2 inline-flex items-center gap-1.5 text-xs text-emerald-300">
          <input type="checkbox" checked={useBackend} onChange={(e) => setUseBackend(e.target.checked)} />
          Use real nmap backend (Docker) — true service/version detection
        </label>
      )}

      <div className="flex flex-wrap gap-2 mb-2">
        <input type="text" placeholder="target host (e.g. scanme.nmap.org or 127.0.0.1)" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1 min-w-[14rem] bg-slate-900 border border-slate-800 rounded p-1.5 text-sm font-mono" />
        {!scanning
          ? <button onClick={runScan} className="px-3 py-1.5 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-sm hover:bg-cyan-900/70 inline-flex items-center gap-1"><Play size={13} /> Scan</button>
          : <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1.5 bg-slate-700 text-gray-200 rounded text-sm hover:bg-slate-600 inline-flex items-center gap-1"><Square size={13} /> Stop</button>}
      </div>

      {/* Port profiles */}
      <div className="mb-2">
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Port profiles (toggle & combine)</div>
        <div className="flex flex-wrap gap-1">
          {PORT_PROFILES.map((p) => (
            <button key={p.id} onClick={() => toggleProfile(p.id)}
              className={`px-2 py-0.5 rounded text-[11px] border ${selected.includes(p.id) ? 'bg-cyan-900/50 border-cyan-700 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-gray-200'}`}>
              {p.label}{p.heavy ? ' ⚠' : ''}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-2 items-center">
        <input type="text" placeholder="custom ports (e.g. 1-100,8080,9000)" value={customPorts} onChange={(e) => setCustomPorts(e.target.value)} className="flex-1 min-w-[12rem] bg-slate-900 border border-slate-800 rounded p-1.5 text-xs font-mono" />
        <span className={`text-xs ${heavy ? 'text-amber-400' : 'text-slate-500'}`}>{ports.length.toLocaleString()} port(s){heavy ? ' — large, slow in a browser' : ''}</span>
      </div>

      {/* Flags */}
      <div className="flex flex-wrap gap-3 mb-3 items-center text-xs">
        <label className="flex items-center gap-1 text-slate-400">Timing
          <select value={timing} onChange={(e) => setTiming(e.target.value)} className="bg-slate-900 border border-slate-800 rounded px-1 py-1 text-gray-200">
            {Object.entries(TIMINGS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-400">Concurrency
          <input type="number" min={1} max={64} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} className="w-14 bg-slate-900 border border-slate-800 rounded px-1 py-1 font-mono" />
        </label>
        <label className="flex items-center gap-1 text-slate-400">Scheme
          <select value={forceScheme} onChange={(e) => setForceScheme(e.target.value)} className="bg-slate-900 border border-slate-800 rounded px-1 py-1 text-gray-200">
            <option value="auto">auto</option><option value="http">http</option><option value="https">https</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-300"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show closed/all</label>
      </div>

      {(scanning || progress.total > 0) && (
        <div className="text-xs text-gray-500 mb-2 flex items-center gap-3 flex-wrap">
          <span>{progress.done}/{progress.total} probed{scanning ? '…' : ''}</span>
          <span className="text-green-400">{counts.open} open</span>
          {counts['open|filtered'] ? <span className="text-yellow-400">{counts['open|filtered']} open|filtered</span> : null}
          <span>{counts.closed} closed</span>
          {counts.blocked ? <span className="text-slate-500">{counts.blocked} blocked</span> : null}
          <span>· {elapsed} ms</span>
          {!scanning && results.length > 0 && (
            <span className="ml-auto flex items-center gap-2">
              <button onClick={() => exportReport('txt')} className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"><Download size={11} /> .txt</button>
              <button onClick={() => exportReport('md')} className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300"><Download size={11} /> .md</button>
            </span>
          )}
        </div>
      )}

      {heavy && !scanning && (
        <div className="mb-2 p-2 border border-amber-900 rounded bg-amber-950/20 text-[11px] text-amber-300 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {ports.length.toLocaleString()} ports selected — a browser connect-scan of this many ports is slow and may be rate-limited. Consider a smaller profile or a higher timing template.
        </div>
      )}

      {shown.length > 0 && (
        <div className="border border-slate-800 rounded bg-slate-950 overflow-auto max-h-[50vh]">
          <table className="w-full text-sm text-gray-200 border-collapse font-mono">
            <thead className="sticky top-0 bg-slate-900"><tr className="text-left"><th className="px-2 py-1">Port</th><th className="px-2 py-1">State</th><th className="px-2 py-1">Service</th><th className="px-2 py-1">Time</th></tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={i} className="border-b border-slate-900 last:border-0">
                  <td className="px-2 py-1">{r.port}</td>
                  <td className={`px-2 py-1 ${r.state === 'open' ? 'text-green-400' : r.state === 'blocked' ? 'text-slate-500' : r.state === 'closed' ? 'text-slate-600' : 'text-yellow-400'}`}>{r.state}</td>
                  <td className="px-2 py-1 text-slate-300">{r.service || '—'}</td>
                  <td className="px-2 py-1 text-slate-500">{r.ms != null ? `${r.ms}ms` : r.state === 'blocked' ? 'browser-restricted' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
