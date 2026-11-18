import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, Download, ZoomIn, ZoomOut, Info, AlertTriangle, Activity, Copy } from 'lucide-react';
import {
  analyzeIqBuffer, exportableAnalysis, formatFromFilename, parseRtl433Filename,
  ISM_FORMATS, ISM_MAX_BYTES, ISM_DEVICES,
  sliceRows,
} from '../../utils/ismDecoder.js';
import {
  flexSpec, segmentsToCsv, groupRows, rowDiff, checksumHints, cursorMeasure, bitsToBinary,
} from '../../utils/ismDecoder/rowTools.js';

/**
 * 433 / 868 / 915 MHz ISM decoder for offline IQ recordings.
 * Loads a file, shows the envelope (or FM discriminator) with the detected pulses,
 * runs the pulse analyzer and the device decoders, and exports the result as JSON.
 * Nothing here talks to hardware and nothing is simulated.
 */

const RATE_PRESETS = [250000, 2048000];
const WAVE_W = 960;
const WAVE_H = 150;
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono';
const btn = 'px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-800 text-gray-200 hover:bg-slate-700 disabled:opacity-40 inline-flex items-center gap-1';

const fmtHz = (hz) => (hz ? `${(hz / 1e6).toFixed(3)} MHz` : 'unknown');
const fmtRate = (r) => (r >= 1e6 ? `${(r / 1e6).toFixed(3)} MS/s` : `${(r / 1e3).toFixed(1)} kS/s`);

function drawWave(canvas, r, start, spp, cursors = []) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#0f1015';
  ctx.fillRect(0, 0, W, H);
  const env = r.envelope;
  const N = env.length;
  if (!N) return;
  const fsk = r.mode === 'fsk';
  const scale = r.scale || 1;
  const yOf = (v) => (fsk
    ? H / 2 - (Math.max(-scale, Math.min(scale, v)) / scale) * (H / 2 - 6)
    : H - 6 - (Math.min(scale, Math.max(0, v)) / scale) * (H - 12));

  // grid: 1 ms ticks
  ctx.strokeStyle = '#1f2430';
  ctx.lineWidth = 1;
  const msPerPx = (spp * 1000) / r.sampleRate;
  const tick = msPerPx > 0 ? Math.pow(10, Math.ceil(Math.log10(msPerPx * 80))) : 1;
  ctx.beginPath();
  const firstMs = (start * 1000) / r.sampleRate;
  for (let t = Math.ceil(firstMs / tick) * tick; t < firstMs + (W * msPerPx); t += tick) {
    const x = Math.round((t - firstMs) / msPerPx) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
  }
  ctx.stroke();

  // envelope min/max per pixel
  ctx.strokeStyle = '#22d3ee';
  ctx.beginPath();
  for (let px = 0; px < W; px++) {
    const s0 = start + px * spp;
    if (s0 >= N) break;
    const s1 = Math.min(N, s0 + spp);
    let mn = Infinity;
    let mx = -Infinity;
    for (let s = s0; s < s1; s++) {
      const v = env[s];
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    ctx.moveTo(px + 0.5, yOf(mx));
    ctx.lineTo(px + 0.5, yOf(mn));
  }
  ctx.stroke();

  // adaptive threshold per chunk (OOK only)
  if (!fsk && r.thresholds) {
    ctx.strokeStyle = '#f59e0b';
    ctx.beginPath();
    const th = r.thresholds.thr;
    for (let px = 0; px < W; px++) {
      const s0 = start + px * spp;
      if (s0 >= N) break;
      const c = Math.min(th.length - 1, Math.floor(s0 / r.chunkSamples));
      const y = yOf(th[c]);
      if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
    }
    ctx.stroke();
  }

  // detected mark pulses along the top
  ctx.fillStyle = 'rgba(16,185,129,0.75)';
  const winEnd = start + W * spp;
  for (const seg of r.segments) {
    const s = seg.startSample;
    if (s + (seg.markUs * r.sampleRate) / 1e6 < start) continue;
    if (s > winEnd) break;
    const x = (s - start) / spp;
    const w = Math.max(1, (seg.markUs * r.sampleRate) / 1e6 / spp);
    ctx.fillRect(x, 3, w, 5);
  }

  // measurement cursors
  cursors.forEach((cs, i) => {
    const x = (cs - start) / spp;
    if (x < 0 || x > W) return;
    ctx.strokeStyle = i === 0 ? '#f472b6' : '#a78bfa';
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, H);
    ctx.stroke();
  });
}

function Waveform({ result }) {
  const canvasRef = useRef(null);
  const [spp, setSpp] = useState(1);
  const [start, setStart] = useState(0);
  const [cursors, setCursors] = useState([]);

  useEffect(() => {
    if (!result) return;
    setCursors([]);
    setSpp(Math.max(1, Math.floor(result.samples / (WAVE_W * 0.9))));
    setStart(0);
  }, [result]);

  const N = result ? result.samples : 0;
  const maxStart = Math.max(0, N - WAVE_W * spp);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !result) return;
    drawWave(c, result, Math.min(start, maxStart), spp, cursors);
  }, [result, start, spp, maxStart, cursors]);

  if (!result) return null;
  const onCanvasClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const px = ((e.clientX - rect.left) / rect.width) * WAVE_W;
    const sample = Math.max(0, Math.min(N - 1, Math.round(Math.min(start, maxStart) + px * spp)));
    setCursors((c) => (c.length === 1 ? [c[0], sample] : [sample]));
  };
  const meas = cursors.length === 2 ? cursorMeasure(cursors[0], cursors[1], result.sampleRate) : null;
  const zoomBy = (f) => setSpp((v) => Math.max(1, Math.min(Math.max(1, Math.floor(N / WAVE_W)), Math.round(v * f))));
  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-2">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-[11px] text-slate-400">{result.mode === 'fsk' ? 'FM discriminator' : 'Envelope'} (cyan), threshold (amber), pulses (green). Click the plot to place cursors A and B.</span>
        <span className="ml-auto flex items-center gap-1">
          {cursors.length > 0 && <button className={btn} onClick={() => setCursors([])} title="Clear cursors">Clear</button>}
          <button className={btn} onClick={() => zoomBy(0.5)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={11} /></button>
          <button className={btn} onClick={() => zoomBy(2)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={11} /></button>
        </span>
      </div>
      <canvas ref={canvasRef} width={WAVE_W} height={WAVE_H} className="w-full h-auto rounded cursor-crosshair" aria-label="Signal waveform" onClick={onCanvasClick} />
      {cursors.length > 0 && (
        <div className="text-[11px] font-mono text-slate-300" data-testid="cursor-readout">
          A {(cursors[0] * 1e3 / result.sampleRate).toFixed(3)} ms
          {meas && ` | B ${(cursors[1] * 1e3 / result.sampleRate).toFixed(3)} ms | delta ${meas.us.toFixed(1)} us${meas.hz ? ` (${meas.hz.toFixed(1)} Hz)` : ''}`}
        </div>
      )}
      <input
        type="range"
        min={0}
        max={maxStart}
        step={Math.max(1, spp)}
        value={Math.min(start, maxStart)}
        onChange={(e) => setStart(Number(e.target.value))}
        className="w-full mt-1"
        aria-label="Waveform position"
      />
      <div className="text-[10px] text-slate-500 font-mono">
        window {(Math.min(start, maxStart) / result.sampleRate * 1000).toFixed(1)} ms to {((Math.min(start, maxStart) + WAVE_W * spp) / result.sampleRate * 1000).toFixed(1)} ms of {(result.durationS * 1000).toFixed(1)} ms; {spp} sample(s) per pixel
      </div>
    </div>
  );
}

function ClusterBars({ title, clusters }) {
  const max = Math.max(1, ...clusters.map((c) => c.count));
  return (
    <div>
      <div className="text-[11px] text-slate-400 mb-1">{title}</div>
      {clusters.length === 0 && <div className="text-[11px] text-slate-600">none</div>}
      <div className="space-y-0.5 max-h-40 overflow-auto">
        {clusters.slice(0, 16).map((c) => (
          <div key={c.mean} className="flex items-center gap-2 text-[11px] font-mono">
            <span className="w-20 text-right text-slate-300">{Math.round(c.mean)} us</span>
            <span className="h-2 bg-cyan-600/70 rounded" style={{ width: `${Math.max(2, (c.count / max) * 180)}px` }} />
            <span className="text-slate-500">x{c.count} ({Math.round(c.min)}-{Math.round(c.max)})</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecodeCard({ d }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-slate-800 rounded p-2 bg-slate-950">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`px-1.5 py-0.5 rounded text-[10px] border ${d.ok ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800' : 'bg-amber-900/30 text-amber-300 border-amber-800'}`}>
          {d.ok ? 'checks pass' : 'check failed'}
        </span>
        <span className="text-xs text-gray-200">{d.deviceName}</span>
        <span className="text-[10px] text-slate-500 font-mono">at {(d.startUs / 1000).toFixed(2)} ms, x{d.repeats} repeat(s)</span>
        <button className="ml-auto text-[10px] text-cyan-400 hover:text-cyan-300" onClick={() => setOpen((v) => !v)}>{open ? 'hide' : 'details'}</button>
      </div>
      <table className="w-full text-xs mt-1">
        <tbody>
          {d.fields.map((f) => (
            <tr key={f.k} className="border-b border-slate-900 last:border-0">
              <td className="py-0.5 text-slate-500 w-40">{f.k}</td>
              <td className="py-0.5 font-mono text-gray-200">{String(f.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-slate-500 mt-1">Checksum: {d.checksum}</div>
      {open && (
        <div className="mt-1 text-[11px] font-mono">
          {d.checks.map((c) => (
            <div key={c.name} className={c.pass ? 'text-emerald-400' : 'text-amber-400'}>
              {c.pass ? 'PASS' : 'FAIL'} {c.name}: {c.detail}
            </div>
          ))}
          <div className="text-slate-500 break-all mt-1">row {d.rowBits} bits, alignment {d.alignment}: {d.rowHex}</div>
        </div>
      )}
    </div>
  );
}

function CustomSlicer({ result }) {
  const g = result.analysis.guess;
  const initMod = g.modulation === 'fsk-pcm' ? 'nrz' : (g.modulation === 'unknown' ? 'pwm' : g.modulation);
  const [modulation, setModulation] = useState(initMod);
  const [threshold, setThreshold] = useState(String(g.thresholdUs || ''));
  const [halfBit, setHalfBit] = useState(String(Math.round(g.halfBitUs || 0) || ''));
  const [reset, setReset] = useState(String(g.resetUs || 3000));
  const [invert, setInvert] = useState(false);
  const [view, setView] = useState('hex');

  const rows = useMemo(() => sliceRows(result.segments, {
    modulation,
    thresholdUs: Number(threshold) || 0,
    halfBitUs: Number(halfBit) || 0,
    invert,
    resetUs: Number(reset) || 3000,
  }), [result, modulation, threshold, halfBit, reset, invert]);
  const groups = useMemo(() => groupRows(rows), [rows]);
  const diff = useMemo(() => rowDiff(rows), [rows]);
  const needsThr = modulation === 'pwm' || modulation === 'ppm';

  return (
    <section className="bg-slate-950 border border-slate-800 rounded p-2 space-y-2">
      <h3 className="text-xs font-semibold text-slate-300">Manual slicer ({rows.length} row(s), {groups.length} distinct)</h3>
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <select className={inputCls} value={modulation} onChange={(e) => setModulation(e.target.value)} aria-label="Slicer modulation">
          <option value="pwm">PWM (mark width)</option>
          <option value="ppm">PPM (gap width)</option>
          <option value="manchester">Manchester</option>
          <option value="nrz">NRZ / PCM</option>
        </select>
        {needsThr ? (
          <label className="flex items-center gap-1 text-slate-500">threshold us
            <input className={`${inputCls} w-16`} type="number" value={threshold} onChange={(e) => setThreshold(e.target.value)} aria-label="Slicer threshold in microseconds" />
          </label>
        ) : (
          <label className="flex items-center gap-1 text-slate-500">half-bit us
            <input className={`${inputCls} w-16`} type="number" value={halfBit} onChange={(e) => setHalfBit(e.target.value)} aria-label="Slicer half-bit in microseconds" />
          </label>
        )}
        <label className="flex items-center gap-1 text-slate-500">reset us
          <input className={`${inputCls} w-16`} type="number" value={reset} onChange={(e) => setReset(e.target.value)} aria-label="Slicer reset gap in microseconds" />
        </label>
        <label className="flex items-center gap-1 text-slate-500">
          <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} /> invert
        </label>
        <select className={inputCls} value={view} onChange={(e) => setView(e.target.value)} aria-label="Row display">
          <option value="hex">hex</option>
          <option value="bin">binary</option>
        </select>
      </div>
      {diff && (
        <div className="text-[11px] font-mono break-all">
          <span className="text-slate-500">bit diff over {diff.length} bits, {diff.varying} vary: </span>
          <span className="text-slate-300">{diff.mask}</span>
        </div>
      )}
      {groups.length === 0 && <div className="text-[11px] text-slate-600">No rows of 8 bits or more with these settings.</div>}
      <div className="max-h-56 overflow-auto font-mono text-[11px] space-y-1">
        {groups.slice(0, 60).map((r, i) => {
          const hints = checksumHints(r.bits);
          return (
            <div key={i} className="border-b border-slate-900 last:border-0 pb-0.5">
              <div className="flex gap-2">
                <span className="text-slate-500 w-16 text-right shrink-0">{(r.firstUs / 1000).toFixed(2)} ms</span>
                <span className="text-slate-500 w-10 shrink-0">{r.bits.length}b</span>
                <span className="text-slate-500 w-8 shrink-0">x{r.count}</span>
                <span className="text-gray-200 break-all">{view === 'bin' ? bitsToBinary(r.bits) : r.hex}</span>
              </div>
              {hints.length > 0 && <div className="text-amber-300/80">checksum hint: {hints.join('; ')} (may be chance)</div>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function IsmDecoderWorkbench({ onLogMessage }) {
  const [file, setFile] = useState(null);
  const [format, setFormat] = useState('cu8');
  const [rate, setRate] = useState('250000');
  const [freqHz, setFreqHz] = useState(null);
  const [mode, setMode] = useState('ook');
  const [sens, setSens] = useState(0.5);
  const [minPulseUs, setMinPulseUs] = useState(30);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const onPickFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setError('');
    setResult(null);
    const parsed = parseRtl433Filename(f.name);
    const fmt = parsed.format || formatFromFilename(f.name) || 'cu8';
    setFormat(fmt);
    setFreqHz(parsed.centerFreqHz);
    if (parsed.sampleRate) setRate(String(parsed.sampleRate));
    if (f.size > ISM_MAX_BYTES) {
      setFile({ name: f.name, size: f.size, buffer: null });
      setError(`File is ${(f.size / 1048576).toFixed(1)} MiB; the limit is ${ISM_MAX_BYTES / 1048576} MiB. Trim the capture or use a shorter recording.`);
      return;
    }
    try {
      const buffer = await f.arrayBuffer();
      setFile({ name: f.name, size: f.size, buffer });
      onLogMessage?.(`ISM decoder: loaded ${f.name}`, 'info');
    } catch (err) {
      setError(`Could not read the file: ${err.message}`);
    }
  };

  const run = () => {
    if (!file || !file.buffer) return;
    const sr = Number(rate);
    if (!(sr > 0)) { setError('Enter a sample rate in samples per second.'); return; }
    setBusy(true);
    setError('');
    // Let the "decoding" state paint before the synchronous analysis runs.
    setTimeout(() => {
      try {
        const r = analyzeIqBuffer(file.buffer, { format, sampleRate: sr, mode, sens, minPulseUs });
        setResult(r);
        onLogMessage?.(`ISM decoder: ${r.pulseCount} pulses, ${r.decodes.length} device decode(s)`, 'info');
      } catch (err) {
        setResult(null);
        setError(err.message);
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const exportJson = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(exportableAnalysis(result), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'ism')}-analysis.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const downloadText = (text, name, type) => {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const baseName = file && file.name ? file.name.replace(/\.[^.]+$/, '') : 'ism';
  const exportCsv = () => result && downloadText(segmentsToCsv(result.segments), `${baseName}-pulses.csv`, 'text/csv');
  const guess = result ? result.analysis.guess : null;
  const flex = result ? flexSpec(guess, result.segments, 'ism-capture') : null;
  const copyFlex = async () => {
    try { await navigator.clipboard.writeText(`rtl_433 -r ${file ? file.name : 'capture.cu8'} ${flex}`); } catch { /* clipboard blocked */ }
  };
  const scale = useMemo(() => {
    if (!result) return 1;
    let m = 0;
    const env = result.envelope;
    for (let i = 0; i < env.length; i++) {
      const v = Math.abs(env[i]);
      if (v > m) m = v;
    }
    return m || 1;
  }, [result]);
  const waveResult = useMemo(() => (result ? { ...result, scale } : null), [result, scale]);

  return (
    <div className="flex flex-col gap-2 text-gray-200 text-xs font-sans">
      <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`${btn} cursor-pointer`}>
            <Upload size={12} /> Load IQ recording
            <input type="file" accept=".cu8,.cs8,.cs16,.complex16u,.cf32" onChange={onPickFile} className="hidden" />
          </label>
          {file && <span className="text-xs font-mono text-slate-300">{file.name} ({(file.size / 1024).toFixed(0)} KiB)</span>}
          {freqHz && <span className="text-[11px] text-slate-400">centre {fmtHz(freqHz)} (from file name)</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-500">Format</span>
          <select className={inputCls} value={format} onChange={(e) => setFormat(e.target.value)} aria-label="Sample format">
            {Object.entries(ISM_FORMATS).map(([k, v]) => <option key={k} value={k}>.{k} - {v.label}</option>)}
          </select>
          <span className="text-slate-500">Sample rate</span>
          <input className={`${inputCls} w-28`} value={rate} onChange={(e) => setRate(e.target.value)} inputMode="numeric" aria-label="Sample rate in samples per second" />
          {RATE_PRESETS.map((r) => (
            <button key={r} className={btn} onClick={() => setRate(String(r))}>{fmtRate(r)}</button>
          ))}
          <span className="text-slate-500 text-[11px]">{Number(rate) > 0 ? fmtRate(Number(rate)) : 'enter a rate'}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-500">Demodulation</span>
          <select className={inputCls} value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Demodulation">
            <option value="ook">AM / OOK envelope</option>
            <option value="fsk">FSK (FM discriminator)</option>
          </select>
          <span className="text-slate-500">Threshold position</span>
          <input type="range" min={0.1} max={0.9} step={0.05} value={sens} onChange={(e) => setSens(Number(e.target.value))} aria-label="Threshold position" />
          <span className="font-mono text-slate-400">{sens.toFixed(2)}</span>
          <span className="text-slate-500">Min pulse</span>
          <input className={`${inputCls} w-16`} type="number" min={1} value={minPulseUs} onChange={(e) => setMinPulseUs(Math.max(1, Number(e.target.value) || 1))} aria-label="Minimum pulse in microseconds" />
          <span className="text-slate-500">us</span>
          <button className={`${btn} ml-auto`} onClick={run} disabled={!file || !file.buffer || busy}>
            <Activity size={12} /> {busy ? 'Decoding...' : 'Analyze'}
          </button>
        </div>
        <details className="text-[11px] text-slate-500">
          <summary className="cursor-pointer flex items-center gap-1"><Info size={12} /> File names and formats</summary>
          <div className="mt-1">
            Recordings from rtl_433 are named like <span className="font-mono">g001_433.92M_250k.cu8</span>; the frequency and rate are read from the name.
            Formats: .cu8 (RTL-SDR), .cs8 (HackRF), .cs16, .complex16u, .cf32. Files up to {ISM_MAX_BYTES / 1048576} MiB. Analysis runs on this tab.
          </div>
        </details>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {error}
        </div>
      )}

      {!result && !error && (
        <div className="p-4 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded">
          Load an IQ recording to analyze. Nothing is shown until a file is loaded and analyzed.
        </div>
      )}

      {result && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="px-2 py-0.5 rounded bg-cyan-900/40 border border-cyan-800 text-cyan-200">{result.pulseCount} pulses</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">{(result.durationS * 1000).toFixed(1)} ms</span>
            <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700">{result.decodes.length} device decode(s)</span>
            {result.truncated && <span className="px-2 py-0.5 rounded bg-amber-900/30 border border-amber-800 text-amber-300">pulse list capped; analysis uses the first pulses</span>}
            <span className="ml-auto flex items-center gap-1">
              <button className={btn} onClick={exportCsv} title="Pulse list as CSV"><Download size={12} /> CSV</button>
              <button className={btn} onClick={exportJson} title="Full analysis as JSON"><Download size={12} /> JSON</button>
            </span>
          </div>

          <Waveform result={waveResult} />

          <div className="grid @lg:grid-cols-2 gap-2">
            <section className="bg-slate-950 border border-slate-800 rounded p-2">
              <h3 className="text-xs font-semibold text-slate-300 mb-2">Pulse analyzer (rtl_433 -A style)</h3>
              <div className="text-xs mb-2">
                <span className="text-slate-500">Guess: </span>
                <span className="text-cyan-300">{guess.label}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono mb-2">
                <span className="text-slate-500">short / long</span><span>{guess.shortUs ? `${Math.round(guess.shortUs)} / ${Math.round(guess.longUs)} us` : '-'}</span>
                <span className="text-slate-500">threshold</span><span>{guess.thresholdUs ? `${guess.thresholdUs} us` : '-'}</span>
                <span className="text-slate-500">half-bit clock</span><span>{guess.halfBitUs ? `${Math.round(guess.halfBitUs)} us` : '-'}</span>
                <span className="text-slate-500">reset (estimate)</span><span>{guess.resetUs ? `${guess.resetUs} us` : '-'}</span>
              </div>
              {flex && (
                <div className="mb-2 text-[11px]">
                  <div className="flex items-center gap-1 text-slate-500">
                    rtl_433 flex spec (export for the rtl_433 CLI, a starting point)
                    <button className={`${btn} ml-auto`} onClick={copyFlex} title="Copy an rtl_433 command"><Copy size={11} /></button>
                  </div>
                  <code className="block font-mono text-cyan-200 break-all" data-testid="flex-spec">{flex}</code>
                </div>
              )}
              <div className="grid grid-cols-1 gap-2">
                <ClusterBars title="Mark (pulse) widths" clusters={result.analysis.clusters.marks} />
                <ClusterBars title="Gap widths" clusters={result.analysis.clusters.gaps} />
                <ClusterBars title="Period (mark + gap)" clusters={result.analysis.clusters.periods} />
              </div>
            </section>

            <section className="bg-slate-950 border border-slate-800 rounded p-2">
              <h3 className="text-xs font-semibold text-slate-300 mb-2">Bit rows (hex, {result.analyzerRowCount} row(s), first {result.analyzerRows.length} shown)</h3>
              {result.analyzerRows.length === 0 && <div className="text-[11px] text-slate-600">No rows: the modulation could not be guessed for this recording.</div>}
              <div className="max-h-72 overflow-auto font-mono text-[11px] space-y-0.5">
                {result.analyzerRows.map((r, i) => (
                  <div key={i} className="flex gap-2 border-b border-slate-900 last:border-0">
                    <span className="text-slate-500 w-20 text-right">{(r.startUs / 1000).toFixed(2)} ms</span>
                    <span className="text-slate-500 w-12">{r.bits}b</span>
                    <span className="text-gray-200 break-all">{r.hex}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <CustomSlicer key={`${result.samples}-${result.pulseCount}-${result.sens}-${result.mode}`} result={result} />

          <section className="bg-slate-950 border border-slate-800 rounded p-2">
            <h3 className="text-xs font-semibold text-slate-300 mb-2">Decoded devices</h3>
            {result.decodes.length === 0 && (
              <div className="text-[11px] text-slate-500">
                No device frame passed its checks. The decoders cover: {ISM_DEVICES.map((d) => d.name).join(', ')}.
                Try the threshold slider or check the sample rate and format.
              </div>
            )}
            <div className="grid @lg:grid-cols-2 gap-2">
              {result.decodes.map((d, i) => <DecodeCard key={`${d.deviceId}-${i}`} d={d} />)}
            </div>
          </section>

          <details className="bg-slate-950 border border-slate-800 rounded p-2 text-[11px] text-slate-400 space-y-1">
            <summary className="cursor-pointer flex items-center gap-1 text-slate-300 text-xs font-semibold"><AlertTriangle size={12} /> Scope and limits</summary>
            <div>Decoders: {ISM_DEVICES.length} rtl_433-derived layouts. Acurite 592TXR/Tower, Ambient F007TH, Fine Offset WH2, Nexus/Rubicson temperature, Prologue, and a generic EV1527/PT2262 24-bit remote.</div>
            <div>Not implemented: LaCrosse TX141x, Oregon Scientific v2.1, Rubicson/EMOS CRC variants, and FSK PCM frame decoders. FSK mode shows the discriminator and bit runs only.</div>
            <div>Nexus, Prologue and EV1527 have no checksum in the protocol; their results are marked as structural or unverified.</div>
            <div>Decoders were tested on synthesized frames built from the same layouts, not on captures from real sensors. Polarity or timing may need adjustment for a specific recording.</div>
            <div>The pulse analyzer is an estimate. Check the histogram and the rows before trusting a guessed modulation.</div>
            <div>The manual slicer re-slices the detected pulses only; it does not re-run demodulation. Checksum hints are guesses on short rows. Receive and decode only; nothing is transmitted.</div>
          </details>
        </>
      )}
    </div>
  );
}
