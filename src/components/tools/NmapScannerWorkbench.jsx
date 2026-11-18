import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Square, Download, AlertTriangle, Copy, Upload } from 'lucide-react';
import { SCAN_TYPES, buildNmapCommand, explainNmapCommand, parseNmapOutput, summarizeScan, flattenScan, scanToCsv, diffScans } from '../../utils/nmapTools';
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
  const [mode, setMode] = useState('scan'); // scan | command | import
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

  const tabs = [['scan', 'Scan'], ['command', 'Command builder'], ['import', 'Import results']];
  return (
    <div className="text-gray-200 space-y-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Nmap workbench sections">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} onClick={() => setMode(id)}
            className={`px-2 py-0.5 rounded text-[11px] border ${mode === id ? 'bg-cyan-900/50 border-cyan-700 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-gray-200'}`}>{label}</button>
        ))}
      </div>
      {mode === 'command' && <CommandBuilder target={target} />}
      {mode === 'import' && <ImportPanel />}
      {mode === 'scan' && (<div className="space-y-2">
      <p className="text-[11px] text-gray-400">
        {method === 'wasm' ? 'Scanning via the WebAssembly engine.' : 'Browser connect-timing scan: open = a service answered; closed = refused fast; open|filtered = stalled; blocked = port Chrome refuses to fetch. Scan only hosts you own or have permission to test.'}
      </p>
      <ProxyConfig onLogMessage={onLogMessage} backend="nmap" />

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
      </div>)}
    </div>
  );
}

const inp = 'bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-xs font-mono';
const download = (name, body, type) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([body], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
};

/** Builds an nmap command line for the user to run in their own terminal, and explains pasted commands. Never executes anything. */
function CommandBuilder({ target }) {
  const [o, setO] = useState({ scanType: '-sT', serviceVersion: false, defaultScripts: false, osDetect: false, skipDiscovery: false, noDns: false, openOnly: true, reason: false, timing: '3', ports: '', topPorts: '', xmlOut: '', target });
  const [pasted, setPasted] = useState('');
  const set = (k, v) => setO((x) => ({ ...x, [k]: v }));
  const cmd = buildNmapCommand(o);
  const ex = useMemo(() => explainNmapCommand(pasted || cmd), [pasted, cmd]);
  const box = (k, label) => <label className="flex items-center gap-1 text-slate-300"><input type="checkbox" checked={o[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[11px] text-slate-400">Builds a command for the real nmap CLI; nothing is run here. Scan only networks you own or are authorised to test.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="Target" value={o.target} onChange={(e) => set('target', e.target.value)} placeholder="target" className={`${inp} flex-1 min-w-[10rem]`} />
        <label className="flex items-center gap-1 text-slate-400">Scan
          <select value={o.scanType} onChange={(e) => set('scanType', e.target.value)} className={inp} title={SCAN_TYPES.find((t) => t.flag === o.scanType)?.desc}>
            {SCAN_TYPES.map((t) => <option key={t.flag} value={t.flag}>{t.flag} {t.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-400">Timing
          <select value={o.timing} onChange={(e) => set('timing', e.target.value)} className={inp}>
            {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>T{n}</option>)}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="Ports" value={o.ports} onChange={(e) => set('ports', e.target.value)} placeholder="ports e.g. 22,80,8000-8100" className={`${inp} flex-1 min-w-[10rem]`} />
        <input aria-label="Top ports" value={o.topPorts} onChange={(e) => set('topPorts', e.target.value)} placeholder="or top N" className={`${inp} w-24`} />
        <input aria-label="XML output file" value={o.xmlOut} onChange={(e) => set('xmlOut', e.target.value)} placeholder="-oX file.xml" className={`${inp} w-32`} />
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {box('serviceVersion', '-sV versions')}{box('defaultScripts', '-sC scripts')}{box('osDetect', '-O OS')}
        {box('skipDiscovery', '-Pn no ping')}{box('noDns', '-n no DNS')}{box('openOnly', '--open')}{box('reason', '--reason')}
      </div>
      <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded p-1.5">
        <code className="flex-1 font-mono text-cyan-200 break-all select-all">{cmd}</code>
        <button title="Copy command" aria-label="Copy command" onClick={() => navigator.clipboard?.writeText(cmd)} className="text-cyan-400 hover:text-cyan-300"><Copy size={13} /></button>
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Explain a command (paste one, or leave empty to explain the one above)</div>
        <input aria-label="Command to explain" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="nmap -sS -p- host" className={`${inp} w-full mb-1`} />
        <ul className="space-y-0.5">
          {ex.tokens.map((t, i) => <li key={i}><code className="font-mono text-cyan-300">{t.text}</code> <span className="text-slate-400">{t.explain}</span></li>)}
        </ul>
        {ex.warnings.map((w, i) => <div key={i} className="text-amber-400 mt-0.5 flex items-center gap-1"><AlertTriangle size={11} /> {w}</div>)}
      </div>
    </div>
  );
}

/** Loads nmap XML (-oX) or grepable (-oG) output produced by the user, summarises it, exports CSV and compares two scans. */
function ImportPanel() {
  const [scans, setScans] = useState([]); // [{name, scan}]
  const [err, setErr] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const load = async (files) => {
    setErr('');
    const next = [];
    for (const f of files) {
      try { next.push({ name: f.name, scan: parseNmapOutput(await f.text()) }); } catch (e) { setErr(`${f.name}: ${e.message}`); }
    }
    if (next.length) setScans((s) => [...s, ...next].slice(-2));
  };
  const cur = scans[scans.length - 1];
  const diff = scans.length === 2 ? diffScans(scans[0].scan, scans[1].scan) : null;
  const rows = cur ? flattenScan(cur.scan).filter((r) => !onlyOpen || r.state === 'open') : [];
  const sum = cur ? summarizeScan(cur.scan) : null;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-[11px] text-slate-400">Load output you produced with <code>nmap -oX</code> or <code>-oG</code>. Files are parsed locally and never uploaded. Load a second file to compare.</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="px-2 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded cursor-pointer inline-flex items-center gap-1">
          <Upload size={12} /> Open file(s)
          <input type="file" multiple accept=".xml,.gnmap,.txt" className="sr-only" onChange={(e) => { load([...e.target.files]); e.target.value = ''; }} />
        </label>
        {scans.length > 0 && <button onClick={() => setScans([])} className="text-slate-400 hover:text-gray-200">Clear</button>}
        {cur && <button onClick={() => download('nmap-results.csv', scanToCsv(cur.scan), 'text/csv')} className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><Download size={11} /> CSV</button>}
        <label className="flex items-center gap-1 text-slate-300"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> open only</label>
      </div>
      {err && <div className="text-red-400">{err}</div>}
      {cur && (
        <div className="text-slate-400">
          {scans.map((s) => s.name).join(' vs ')} · {sum.hosts} host(s), {sum.up} up · <span className="text-green-400">{sum.open} open</span> · {sum.filtered} filtered · {sum.closed} closed
          {cur.scan.args && <div className="font-mono text-[11px] text-slate-500 break-all">{cur.scan.args}</div>}
        </div>
      )}
      {diff && (
        <div className="border border-slate-800 rounded p-2 bg-slate-950 space-y-0.5">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">Changes: {scans[0].name} to {scans[1].name}</div>
          {diff.opened.map((r, i) => <div key={'o' + i} className="text-green-400 font-mono">+ {r.host}:{r.port}/{r.proto} {r.service}</div>)}
          {diff.closed.map((r, i) => <div key={'c' + i} className="text-red-400 font-mono">- {r.host}:{r.port}/{r.proto} {r.service}</div>)}
          {diff.changed.map((r, i) => <div key={'m' + i} className="text-yellow-400 font-mono">~ {r.host}:{r.port}/{r.proto} {r.before} to {r.after}</div>)}
          {!diff.opened.length && !diff.closed.length && !diff.changed.length && <div className="text-slate-500">No differences in open ports.</div>}
        </div>
      )}
      {rows.length > 0 && (
        <div className="border border-slate-800 rounded bg-slate-950 overflow-auto max-h-[50vh]">
          <table className="w-full text-xs text-gray-200 border-collapse font-mono">
            <thead className="sticky top-0 bg-slate-900"><tr className="text-left"><th className="px-2 py-1">Host</th><th className="px-2 py-1">Port</th><th className="px-2 py-1">State</th><th className="px-2 py-1">Service</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={i} className="border-b border-slate-900 last:border-0">
                <td className="px-2 py-1">{r.host}{r.hostname ? ` (${r.hostname})` : ''}</td>
                <td className="px-2 py-1">{r.port}/{r.proto}</td>
                <td className={`px-2 py-1 ${r.state === 'open' ? 'text-green-400' : r.state === 'closed' ? 'text-slate-600' : 'text-yellow-400'}`}>{r.state}</td>
                <td className="px-2 py-1 text-slate-300">{[r.service, r.product, r.version].filter(Boolean).join(' ') || '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
