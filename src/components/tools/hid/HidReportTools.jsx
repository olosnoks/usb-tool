import React, { useState, useEffect, useRef } from 'react';
import { Send, Download, Upload, Circle, Square, Play, Gauge } from 'lucide-react';
import {
  parseHexBytes, hexDump, ledBits, ledReportBytes, LED_USAGES, reportRateStats, serializeRecording, parseRecording
} from '../../../utils/hidInspector';

import { confirmAction } from '../../../utils/sessionLog';
const btn = 'flex items-center gap-1 px-2.5 py-1 rounded border font-bold disabled:opacity-40';
const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none';

/**
 * Output / feature reports, keyboard LEDs, report-rate measurement and
 * input-report recording for the HID inspector.
 * addTap(fn) subscribes to input reports (reportId, bytes, t); inject(reportId, bytes) plays one back into the decoder.
 */
export default function HidReportTools({ device, isSimulated, info, meta, addTap, inject }) {
  const outputs = info.flatMap((c) => c.outputReports);
  const features = info.flatMap((c) => c.featureReports);
  const [outId, setOutId] = useState(outputs[0]?.reportId ?? 0);
  const [outHex, setOutHex] = useState('');
  const [featId, setFeatId] = useState(features[0]?.reportId ?? 0);
  const [featHex, setFeatHex] = useState('');
  const [leds, setLeds] = useState({});
  const [log, setLog] = useState([]);
  const [rate, setRate] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recCount, setRecCount] = useState(0);
  const [playing, setPlaying] = useState(null); // { done, total }
  const times = useRef([]);
  const rec = useRef([]);
  const recStart = useRef(0);
  const recordingRef = useRef(false);
  const stopPlay = useRef(false);
  const fileRef = useRef(null);

  const outReport = outputs.find((r) => r.reportId === Number(outId));
  const ledMap = outReport ? ledBits(outReport) : {};
  const note = (text, kind = 'info') => setLog((p) => [...p.slice(-60), { text, kind, ts: new Date().toLocaleTimeString() }]);

  useEffect(() => { if (outReport && !outHex) setOutHex(hexDump(new Uint8Array(outReport.byteLength))); }, [outId]);

  // Watch every input report: timing for the rate meter, and the recorder.
  useEffect(() => addTap((reportId, bytes, t) => {
    const tt = times.current;
    tt.push(t);
    if (tt.length > 600) tt.splice(0, tt.length - 600);
    if (recordingRef.current) {
      if (!rec.current.length) recStart.current = t;
      rec.current.push({ t: t - recStart.current, reportId, bytes: Uint8Array.from(bytes) });
    }
  }), [addTap]);

  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      setRate(reportRateStats(times.current.filter((t) => now - t < 3000)));
      if (recordingRef.current) setRecCount(rec.current.length);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const send = async (kind, reportId, bytes) => {
    if (isSimulated) { note(`(demo) would send ${kind} report ${reportId}: ${hexDump(bytes)}`); return; }
    try {
      if (kind === 'output') await device.sendReport(Number(reportId), bytes);
      else await device.sendFeatureReport(Number(reportId), bytes);
      note(`Sent ${kind} report ${reportId}: ${hexDump(bytes)}`, 'ok');
    } catch (e) {
      note(`${kind} report ${reportId}: ${e.message}`, 'err');
    }
  };

  const getFeature = async () => {
    if (isSimulated) { note('(demo) the simulated mouse has no feature reports'); return; }
    try {
      const dv = await device.receiveFeatureReport(Number(featId));
      const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      setFeatHex(hexDump(bytes));
      note(`Feature report ${featId}: ${hexDump(bytes)}`, 'ok');
    } catch (e) {
      note(`Feature report ${featId}: ${e.message}`, 'err');
    }
  };

  const toggleLed = (usage) => {
    const next = { ...leds, [usage]: !leds[usage] };
    setLeds(next);
    const bytes = ledReportBytes(outReport, next);
    setOutHex(hexDump(bytes));
    send('output', outReport.reportId, bytes);
  };

  const startRec = () => { rec.current = []; setRecCount(0); recordingRef.current = true; setRecording(true); };
  const stopRec = () => { recordingRef.current = false; setRecording(false); setRecCount(rec.current.length); };
  const saveRec = () => {
    const url = URL.createObjectURL(new Blob([serializeRecording(meta, rec.current)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `hid-${(meta?.productName || 'device').replace(/\W+/g, '_')}-${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const loadRec = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const r = parseRecording(await file.text());
      rec.current = r.reports;
      setRecCount(r.reports.length);
      note(`Loaded ${r.reports.length} reports from ${file.name}${r.device?.productName ? ` (${r.device.productName})` : ''}.`, 'ok');
    } catch (err) {
      note(err.message, 'err');
    }
  };

  const play = async () => {
    const list = rec.current;
    if (!list.length) return;
    stopPlay.current = false;
    setPlaying({ done: 0, total: list.length });
    const t0 = performance.now();
    for (let i = 0; i < list.length && !stopPlay.current; i++) {
      const wait = list[i].t - (performance.now() - t0);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      inject(list[i].reportId, list[i].bytes);
      if (i % 10 === 0) setPlaying({ done: i + 1, total: list.length });
    }
    setPlaying(null);
  };

  return (
    <div className="grid grid-cols-1 @lg:grid-cols-2 gap-4 text-xs">
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
        <div className="font-bold text-slate-200 flex items-center gap-1.5"><Send className="w-3.5 h-3.5 text-cyan-400" /> SEND REPORTS</div>
        {outputs.length ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 font-bold">OUTPUT</span>
              <select value={outId} onChange={(e) => { setOutId(e.target.value); setOutHex(''); }} className={inp}>
                {outputs.map((r) => <option key={r.reportId} value={r.reportId}>report {r.reportId} ({r.byteLength} B)</option>)}
              </select>
              <input value={outHex} onChange={(e) => setOutHex(e.target.value)} className={`${inp} flex-1 min-w-[10rem]`} />
              <button onClick={() => { try { send('output', outId, parseHexBytes(outHex)); } catch (e) { note(e.message, 'err'); } }} className={`${btn} border-cyan-500/40 text-cyan-300`}>SEND</button>
            </div>
            {Object.keys(ledMap).length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-slate-500">keyboard LEDs:</span>
                {Object.keys(ledMap).map((u) => (
                  <button key={u} onClick={() => toggleLed(u)} className={`${btn} ${leds[u] ? 'border-emerald-500/60 text-emerald-300 bg-emerald-500/10' : 'border-slate-700 text-slate-400'}`}>{LED_USAGES[u]}</button>
                ))}
              </div>
            )}
          </div>
        ) : <div className="text-slate-500">This device declares no output reports.</div>}
        {features.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-500 font-bold">FEATURE</span>
            <select value={featId} onChange={(e) => setFeatId(e.target.value)} className={inp}>
              {features.map((r) => <option key={r.reportId} value={r.reportId}>report {r.reportId} ({r.byteLength} B)</option>)}
            </select>
            <button onClick={getFeature} className={`${btn} border-slate-700 text-slate-200`}>GET</button>
            <input value={featHex} onChange={(e) => setFeatHex(e.target.value)} placeholder="bytes to SET" className={`${inp} flex-1 min-w-[8rem]`} />
            <button
              onClick={() => {
                if (!isSimulated && !confirmAction(`Send feature report ${featId}? Vendor feature reports can change device settings or firmware state.`)) return;
                try { send('feature', featId, parseHexBytes(featHex)); } catch (e) { note(e.message, 'err'); }
              }}
              className={`${btn} border-amber-500/40 text-amber-300`}
            >
              SET
            </button>
          </div>
        ) : <div className="text-slate-500">No feature reports.</div>}
        <div className="bg-black border border-slate-800 rounded p-2 max-h-32 overflow-y-auto space-y-0.5">
          {log.length === 0 && <div className="text-slate-600">Sent and received reports appear here.</div>}
          {log.map((l, i) => <div key={i} className={l.kind === 'err' ? 'text-rose-300' : l.kind === 'ok' ? 'text-emerald-300' : 'text-slate-400'}><span className="text-slate-600">{l.ts}</span> {l.text}</div>)}
        </div>
      </div>

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
        <div className="font-bold text-slate-200 flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5 text-emerald-400" /> REPORT RATE</div>
        {rate ? (
          <div className="grid grid-cols-3 gap-1.5">
            {[['RATE', `${rate.rateHz.toFixed(0)} Hz`], ['MEAN', `${rate.meanMs.toFixed(2)} ms`], ['JITTER', `${rate.jitterMs.toFixed(2)} ms`], ['MIN', `${rate.minMs.toFixed(2)} ms`], ['MAX', `${rate.maxMs.toFixed(2)} ms`], ['SAMPLES', rate.samples]].map(([k, v]) => (
              <div key={k} className="bg-slate-950 border border-slate-800 rounded p-1.5 text-center"><div className="text-[10px] text-slate-500 font-bold">{k}</div><div className="text-emerald-300 font-bold">{v}</div></div>
            ))}
          </div>
        ) : <div className="text-slate-500">Move the mouse or press keys: the rate over the last 3 s shows here (a mouse polled at 1000 Hz reads near 1000).</div>}

        <div className="font-bold text-slate-200 pt-2 border-t border-slate-800">RECORD & PLAY BACK</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {!recording ? (
            <button onClick={startRec} className={`${btn} border-rose-500/40 text-rose-300`}><Circle className="w-3 h-3 fill-current" /> RECORD</button>
          ) : (
            <button onClick={stopRec} className={`${btn} border-slate-700 text-slate-200`}><Square className="w-3 h-3" /> STOP</button>
          )}
          <span className="text-slate-400">{recCount} reports</span>
          <button onClick={saveRec} disabled={!recCount || recording} className={`${btn} border-slate-700 text-slate-200`}><Download className="w-3 h-3" /> SAVE</button>
          <button onClick={() => fileRef.current?.click()} disabled={recording} className={`${btn} border-slate-700 text-slate-200`}><Upload className="w-3 h-3" /> OPEN</button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={loadRec} />
          {!playing ? (
            <button onClick={play} disabled={!recCount || recording} className={`${btn} border-cyan-500/40 text-cyan-300`}><Play className="w-3 h-3" /> PLAY</button>
          ) : (
            <button onClick={() => { stopPlay.current = true; }} className={`${btn} border-slate-700 text-slate-200`}><Square className="w-3 h-3" /> STOP ({playing.done}/{playing.total})</button>
          )}
        </div>
        <p className="text-slate-500">Playback feeds the recorded reports through the decoder above with their original timing. A browser can't inject input into the computer, so nothing is typed or clicked.</p>
      </div>
    </div>
  );
}
