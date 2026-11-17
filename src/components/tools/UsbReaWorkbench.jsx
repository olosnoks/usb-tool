// USB Protocol RE — in-browser port of usb-rea (MIT, (c) 2026 Emir Mrkaljević,
// https://github.com/emirmrkaljevic/usb-rea). Load a usbmon/USBPcap capture plus action markers and get a
// protocol report, a Python driver scaffold and a Wireshark Lua dissector. Everything runs locally.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { analyze, sha256 } from '../../utils/usbrea/pipeline';
import { render as renderReport } from '../../utils/usbrea/report';
import { generate as generateScaffold } from '../../utils/usbrea/scaffold';
import { generate as generateDissector } from '../../utils/usbrea/dissector';
import { read_transfers, find_ids } from '../../utils/usbrea/pcap';
import * as lookupDb from '../../utils/usbrea/lookup';
import { make_capture } from '../../utils/usbrea/synth';

const TABS = [
  ['analyze', 'Analyze capture'],
  ['marker', 'Action marker'],
  ['lookup', 'VID:PID lookup'],
  ['guide', 'How to capture'],
];

const btn = 'px-3 py-1.5 rounded text-xs font-semibold border transition-colors';
const btnPrimary = `${btn} bg-amber-500/20 border-amber-500/50 text-amber-200 hover:bg-amber-500/30`;
const btnGhost = `${btn} bg-slate-800/60 border-slate-700 text-gray-300 hover:bg-slate-700/60`;
const field = 'w-full bg-slate-950 border border-slate-800 rounded p-2 text-xs text-gray-200 font-mono';

function download(name, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(new Uint8Array(r.result));
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

function OutputPane({ outputs, baseName }) {
  const [view, setView] = useState('report');
  const files = {
    report: [`${baseName}_report.md`, outputs.report],
    scaffold: [`${baseName}_driver.py`, outputs.scaffold],
    dissector: [`${baseName}.lua`, outputs.dissector],
    json: [`${baseName}_protocol.json`, outputs.json],
  };
  const [name, text] = files[view];
  return (
    <div className="mt-4 border border-slate-800 rounded">
      <div className="flex flex-wrap items-center gap-2 p-2 border-b border-slate-800 bg-slate-900/60">
        {[['report', 'Report (.md)'], ['scaffold', 'Python driver'], ['dissector', 'Wireshark dissector'], ['json', 'Protocol JSON']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setView(k)} className={view === k ? btnPrimary : btnGhost}>{l}</button>
        ))}
        <div className="flex-1" />
        <button type="button" className={btnGhost} onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
        <button type="button" className={btnGhost} onClick={() => download(name, text)}>Download {name}</button>
      </div>
      <pre className="p-3 text-[11px] leading-relaxed text-gray-200 overflow-auto max-h-[60vh] whitespace-pre">{text}</pre>
    </div>
  );
}

function AnalyzeTab({ log, pendingMarkers }) {
  const [capture, setCapture] = useState(null); // { name, bytes }
  const [devices, setDevices] = useState([]);
  const [device, setDevice] = useState('');
  const [markersText, setMarkersText] = useState('');
  const [labelsText, setLabelsText] = useState('');
  const [mode, setMode] = useState('markers');
  const [outputs, setOutputs] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (pendingMarkers) { setMarkersText(pendingMarkers); setMode('markers'); }
  }, [pendingMarkers]);

  const onCapture = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setError(null);
    setOutputs(null);
    try {
      const bytes = await readFile(f);
      const ts = read_transfers(bytes);
      const ids = find_ids(ts);
      const counts = new Map();
      for (const t of ts) counts.set(t.device, (counts.get(t.device) || 0) + 1);
      const idOf = (d) => (ids instanceof Map ? ids.get(d) : ids?.[d]);
      setDevices([...counts.entries()].filter(([d]) => d !== 0).sort((a, b) => b[1] - a[1]).map(([d, n]) => {
        const id = idOf(d);
        return { device: d, packets: n, id: id && id[0] != null ? `${id[0].toString(16).padStart(4, '0')}:${id[1].toString(16).padStart(4, '0')}` : null };
      }));
      setDevice('');
      setCapture({ name: f.name, bytes });
      log?.(`usb-rea: loaded ${f.name} — ${ts.length} transfers`);
    } catch (err) {
      setError(`Could not read capture: ${err.message}`);
    }
  };

  const onMarkers = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setMarkersText(new TextDecoder().decode(await readFile(f)));
    setMode('markers');
  };

  const run = useCallback(async (cap, markers, labels, dev) => {
    setBusy(true);
    setError(null);
    try {
      const proto = analyze(cap.bytes, markers, dev, labels);
      const digest = await sha256(cap.bytes);
      const base = cap.name.replace(/\.(gz)$/i, '').replace(/\.(pcapng|pcap)$/i, '').replace(/[^\w.-]+/g, '_') || 'device';
      setOutputs({
        base,
        report: renderReport(proto, cap.name, digest),
        scaffold: generateScaffold(proto),
        dissector: generateDissector(proto, base),
        json: JSON.stringify(proto.to_dict ? proto.to_dict() : proto, (k, v) => (v instanceof Uint8Array ? Array.from(v, (x) => x.toString(16).padStart(2, '0')).join('') : v === Infinity ? null : v), 1),
      });
      log?.(`usb-rea: ${proto.commands.length} command(s) inferred from ${cap.name}`);
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
      setOutputs(null);
    } finally {
      setBusy(false);
    }
  }, [log]);

  const onAnalyze = () => {
    if (!capture) return;
    const dev = device === '' ? null : Number(device);
    if (mode === 'labels') {
      const labels = labelsText.split('\n').map((s) => s.trim()).filter(Boolean);
      if (!labels.length) { setError('Type the action labels, one per line, in the order you clicked them.'); return; }
      run(capture, null, labels, dev);
    } else {
      if (!markersText.trim()) { setError('Load or paste the actions JSON (from the Action marker tab or `usb-rea mark`).'); return; }
      run(capture, markersText, null, dev);
    }
  };

  const onDemo = () => {
    try {
      const { capture: bytes, markers } = make_capture();
      const cap = { name: 'demo-lamp.pcap', bytes };
      setCapture(cap);
      setDevices([]);
      setDevice('');
      const text = JSON.stringify(markers, null, 1);
      setMarkersText(text);
      setMode('markers');
      run(cap, text, null, null);
    } catch (err) {
      setError(`Demo failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="text-xs font-bold text-gray-300 uppercase tracking-wider">1. Capture</div>
          <input type="file" accept=".pcap,.pcapng,.gz,.cap" onChange={onCapture} className="text-xs text-gray-300" />
          <p className="text-[11px] text-gray-500">pcap or pcapng, gzipped OK. Linux usbmon (DLT 189/220) or Windows USBPcap (DLT 249).</p>
          {capture && <div className="text-xs text-gray-300">Loaded <span className="font-mono text-amber-300">{capture.name}</span></div>}
          {devices.length > 0 && (
            <label className="block text-xs text-gray-300">Target device
              <select value={device} onChange={(e) => setDevice(e.target.value)} className={`${field} mt-1`}>
                <option value="">Auto (most host→device data)</option>
                {devices.map((d) => <option key={d.device} value={d.device}>#{d.device}{d.id ? ` ${d.id}` : ''} — {d.packets} packets</option>)}
              </select>
            </label>
          )}
          <button type="button" className={btnGhost} onClick={onDemo}>Try the demo (synthetic lamp capture)</button>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-bold text-gray-300 uppercase tracking-wider">2. What you did</div>
          <div className="flex gap-2">
            <button type="button" className={mode === 'markers' ? btnPrimary : btnGhost} onClick={() => setMode('markers')}>Timestamped markers</button>
            <button type="button" className={mode === 'labels' ? btnPrimary : btnGhost} onClick={() => setMode('labels')}>Labels only (split on pauses)</button>
          </div>
          {mode === 'markers' ? (
            <>
              <input type="file" accept=".json" onChange={onMarkers} className="text-xs text-gray-300" />
              <textarea value={markersText} onChange={(e) => setMarkersText(e.target.value)} rows={6} className={field}
                placeholder='[{"label": "brightness 0%", "start": 1763337600.12, "end": null}, ...]' />
            </>
          ) : (
            <textarea value={labelsText} onChange={(e) => setLabelsText(e.target.value)} rows={7} className={field}
              placeholder={'brightness 0%\nbrightness 50%\nbrightness 100%\npower off\npower on'} />
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className={btnPrimary} disabled={!capture || busy} onClick={onAnalyze}>{busy ? 'Analyzing…' : '3. Infer protocol'}</button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
      {outputs && <OutputPane outputs={outputs} baseName={outputs.base} />}
    </div>
  );
}

function MarkerTab({ onUse }) {
  const [marks, setMarks] = useState([]);
  const [label, setLabel] = useState('');
  const now = () => Date.now() / 1000;
  const add = (lb) => {
    const text = lb.trim();
    if (!text) return;
    const t = now();
    setMarks((prev) => {
      if (/^\s*seen\b/i.test(text)) return [...prev, { label: text, start: t, end: t }];
      return [...prev.map((m) => (m.end === null ? { ...m, end: t } : m)), { label: text, start: t, end: null }];
    });
    setLabel('');
  };
  const json = JSON.stringify(marks, null, 1);
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">
        Replaces <code className="text-amber-300">usb-rea mark</code>. Start your capture (Wireshark + USBPcap or usbmon) on <b>this same computer</b>,
        then type a label and press Enter <i>right before</i> you click that action in the vendor app. Timestamps use this PC&apos;s clock,
        which is the clock the capture uses. Do 3+ values per setting, e.g. <code>brightness 0%</code>, <code>brightness 50%</code>, <code>brightness 100%</code>.
        Use <code>seen rpm 1180, temp 34</code> to note what the app displayed.
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(label); }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} className={field} placeholder="brightness 50%" autoFocus />
        <button type="submit" className={btnPrimary}>Mark</button>
      </form>
      <div className="flex gap-2">
        <button type="button" className={btnGhost} disabled={!marks.length} onClick={() => setMarks((p) => p.map((m) => (m.end === null ? { ...m, end: now() } : m)))}>End current action</button>
        <button type="button" className={btnGhost} disabled={!marks.length} onClick={() => setMarks((p) => p.slice(0, -1))}>Undo last</button>
        <button type="button" className={btnGhost} disabled={!marks.length} onClick={() => download('capture.pcapng.actions.json', json, 'application/json')}>Download .actions.json</button>
        <button type="button" className={btnPrimary} disabled={!marks.length} onClick={() => onUse(json)}>Use in Analyze →</button>
        <button type="button" className={btnGhost} disabled={!marks.length} onClick={() => setMarks([])}>Clear</button>
      </div>
      <table className="w-full text-xs text-gray-300">
        <thead><tr className="text-left text-gray-500"><th className="py-1">#</th><th>Label</th><th>Start</th><th>Duration</th></tr></thead>
        <tbody>
          {marks.map((m, i) => (
            <tr key={i} className="border-t border-slate-800">
              <td className="py-1">{i + 1}</td>
              <td className="font-mono">{m.label}</td>
              <td className="font-mono">{new Date(m.start * 1000).toLocaleTimeString()}</td>
              <td className="font-mono">{m.end === null ? 'open' : `${(m.end - m.start).toFixed(2)} s`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LookupTab() {
  const [query, setQuery] = useState('');
  const [online, setOnline] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const onLookup = async (e) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const [vid, pid] = lookupDb.parse_id(query);
      const info = await lookupDb.lookup(vid, pid, online);
      setResult(lookupDb.render(info));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400">Before capturing: has an open-source project (liquidctl, rivalcfg, OpenRGB, turing-smart-screen, …) already documented this device? Offline table bundled with usb-rea.</p>
      <form className="flex gap-2 items-center" onSubmit={onLookup}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} className={field} placeholder="1e71:170e  or  ID 1e71:170e" />
        <button type="submit" className={btnPrimary} disabled={busy}>Look up</button>
      </form>
      <label className="flex items-center gap-2 text-xs text-gray-400">
        <input type="checkbox" checked={online} onChange={(e) => setOnline(e.target.checked)} />
        Also ask OpenDeviceDB online (sends only the VID:PID)
      </label>
      {error && <div className="text-xs text-red-400">{error}</div>}
      {result && <pre className="p-3 text-[11px] text-gray-200 bg-slate-950 border border-slate-800 rounded whitespace-pre-wrap">{result}</pre>}
    </div>
  );
}

function GuideTab() {
  return (
    <div className="text-xs text-gray-300 space-y-3 leading-relaxed max-w-3xl">
      <p>The browser can&apos;t sniff USB traffic, so you capture it with the OS tools while the vendor app drives the device. This tab then does the inference locally. Nothing is uploaded.</p>
      <div>
        <div className="font-bold text-amber-300 mb-1">Windows (USBPcap + Wireshark)</div>
        <ol className="list-decimal ml-5 space-y-1">
          <li>Install Wireshark with the USBPcap option, then start a capture on the USBPcap root hub the device sits on.</li>
          <li>Open the <b>Action marker</b> tab here. Before each click in the vendor app, type what you are about to do (<code>fan 40</code>, <code>fan 60</code>, <code>fan 80</code>, <code>color 255 0 0</code>, <code>power off</code>) and press Enter.</li>
          <li>Stop the capture and save it as pcapng. Click <b>Use in Analyze</b>, load the pcapng and run the analysis.</li>
        </ol>
      </div>
      <div>
        <div className="font-bold text-amber-300 mb-1">Linux (usbmon)</div>
        <pre className="bg-slate-950 border border-slate-800 rounded p-2">{'sudo modprobe usbmon\nsudo wireshark   # capture on usbmonN for the bus from lsusb\n# or the original CLI: pipx install usb-rea; usb-rea capture start -o dev.pcapng'}</pre>
      </div>
      <div>
        <div className="font-bold text-amber-300 mb-1">No markers?</div>
        <p>Click each action with a pause of a couple of seconds in between, then use <b>Labels only</b> and list the actions in order. The traffic is split at the pauses.</p>
      </div>
      <div>
        <div className="font-bold text-amber-300 mb-1">What it infers</div>
        <p>Constant headers and command IDs, linear values (8/16/32-bit, LE/BE, several per action), packed bitfields, lookup tables, rolling counters, checksums (sum8, xor8, CRC8, CRC16 variants), device replies and readings (from <code>seen …</code> labels), handshakes and session tokens, state-gated commands, and image streams to device screens (kept apart from the commands).</p>
      </div>
      <p className="text-gray-500">You still need the vendor&apos;s app during the recording, so document the protocol before the vendor drops support. Ported from <a className="text-amber-300 underline" href="https://github.com/emirmrkaljevic/usb-rea" target="_blank" rel="noreferrer">usb-rea</a> by Emir Mrkaljević (MIT).</p>
    </div>
  );
}

export default function UsbReaWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('analyze');
  const [pendingMarkers, setPendingMarkers] = useState(null);
  const log = useMemo(() => (m) => onLogMessage?.(m), [onLogMessage]);
  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([id, name]) => (
          <button key={id} type="button" onClick={() => setTab(id)} className={tab === id ? btnPrimary : btnGhost}>{name}</button>
        ))}
      </div>
      <div className={tab === 'analyze' ? '' : 'hidden'}><AnalyzeTab log={log} pendingMarkers={pendingMarkers} /></div>
      <div className={tab === 'marker' ? '' : 'hidden'}><MarkerTab onUse={(json) => { setPendingMarkers(json); setTab('analyze'); }} /></div>
      {tab === 'lookup' && <LookupTab />}
      {tab === 'guide' && <GuideTab />}
    </div>
  );
}
