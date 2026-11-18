import React, { useState, useRef, useEffect } from 'react';
import { Zap, Plug, Power, Play, Square, Pause, Download, Trash2, Gauge } from 'lucide-react';
import {
  MODE_AMPERE,
  MODE_SOURCE,
  SAMPLE_RATE_HZ,
  VDD_MIN_MV,
  VDD_MAX_MV,
  CSV_HEADER,
  SampleRing,
  createSampleDecoder,
  decodeWords,
  convertWords,
  envelope,
  rangeStats,
  recentAverageUa,
  csvRows,
  parseMetadata,
  requestPpk2Port,
  Ppk2Device,
} from '../../utils/ppk2';

const CAPTURE_S = 60; // ring buffer length: 60 s of raw samples (about 30 MB)
const WINDOWS_S = [1, 2, 5, 10, 30, 60];
const CANVAS_H = 300;
const CHART_H = 200;
const LANE_TOP = 214;
const LANE_PITCH = 11;
const LANE_H = 9;
const EXPORT_CHUNK = 100000;
const CONTROL_BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed';

export function fmtCurrent(uA) {
  if (uA == null || !Number.isFinite(uA)) return '—';
  const a = Math.abs(uA);
  if (a >= 1000) return `${(uA / 1000).toFixed(3)} mA`;
  return `${uA.toFixed(2)} µA`;
}

function fmtCharge(s) {
  if (s.chargeUc == null) return '—';
  return `${fmtCurrentChargeUc(s.chargeUc)} · ${s.chargeMah.toExponential(3)} mAh`;
}

function fmtCurrentChargeUc(uc) {
  const a = Math.abs(uc);
  if (a >= 1e6) return `${(uc / 1e6).toFixed(3)} C`;
  if (a >= 1000) return `${(uc / 1000).toFixed(3)} mC`;
  return `${uc.toFixed(3)} µC`;
}

function fmtEnergy(s) {
  if (s.energyUj == null) return '—';
  const uj = s.energyUj;
  const a = Math.abs(uj);
  const txt = a >= 1e6 ? `${(uj / 1e6).toFixed(3)} J` : a >= 1000 ? `${(uj / 1000).toFixed(3)} mJ` : `${uj.toFixed(3)} µJ`;
  return `${txt} · ${s.energyMwh.toExponential(3)} mWh`;
}

function exportCsv(ring, from, to, label) {
  if (!ring || to <= from || typeof document === 'undefined') return;
  const parts = [`${CSV_HEADER}\n`];
  for (let s = from; s < to; s += EXPORT_CHUNK) {
    parts.push(`${csvRows(ring, s, Math.min(to, s + EXPORT_CHUNK))}\n`);
  }
  const blob = new Blob(parts, { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ppk2-${label}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function StatCard({ title, stats, voltageV, testId }) {
  const rows = [
    ['Avg', fmtCurrent(stats.avgUa)],
    ['Min', fmtCurrent(stats.minUa)],
    ['Max', fmtCurrent(stats.maxUa)],
    ['Charge', fmtCharge(stats)],
    [`Energy @ ${voltageV ? voltageV.toFixed(2) : '—'} V`, fmtEnergy(stats)],
    ['Duration', stats.samples ? `${stats.durationS.toFixed(3)} s (${stats.samples.toLocaleString()} samples)` : '—'],
  ];
  return (
    <div data-testid={testId} className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1">
      <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1">{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 text-xs font-mono">
          <span className="text-slate-500 shrink-0">{k}</span>
          <span className="text-slate-200 text-right break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

export default function PowerProfilerWorkbench({ onLogMessage }) {
  const [connected, setConnected] = useState(false);
  const [info, setInfo] = useState(null); // parseMetadata() result
  const [mode, setMode] = useState(MODE_SOURCE);
  const [voltageInput, setVoltageInput] = useState('3300');
  const [dutOn, setDutOn] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [paused, setPaused] = useState(false);
  const [windowS, setWindowS] = useState(5);
  const [error, setError] = useState('');
  const [nowUa, setNowUa] = useState(null);
  const [rateKs, setRateKs] = useState(null);
  const [liveStats, setLiveStats] = useState(null);
  const [selStats, setSelStats] = useState(null);
  const [selection, setSelection] = useState(null); // { a, b } absolute sample indices
  const [captured, setCaptured] = useState(0);

  const deviceRef = useRef(null);
  const infoRef = useRef(null);
  const ringRef = useRef(null);
  const decRef = useRef(null);
  const calRef = useRef(null); // { cal, vdd }
  const pausedRef = useRef(false);
  const frozenEndRef = useRef(0);
  const windowRef = useRef(5);
  const viewRef = useRef(null); // { from, to, width } of the last drawn frame
  const selRef = useRef(null);
  const dragRef = useRef(null);
  const canvasRef = useRef(null);
  const countRef = useRef(0);
  const connectedRef = useRef(false);
  const voltageRef = useRef(null);

  const log = (text, level = 'info') => { if (onLogMessage) onLogMessage(text, level); };
  const voltageMv = Number(voltageInput);
  const voltageValid = Number.isFinite(voltageMv) && voltageMv >= VDD_MIN_MV && voltageMv <= VDD_MAX_MV;
  const canMeasure = connected && !!info?.complete;

  useEffect(() => { windowRef.current = windowS; }, [windowS]);
  useEffect(() => { connectedRef.current = connected; }, [connected]);
  useEffect(() => { voltageRef.current = Number.isFinite(voltageMv) ? voltageMv / 1000 : null; }, [voltageMv]);
  useEffect(() => { selRef.current = selection; }, [selection]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Close the port when the tool window is closed.
  useEffect(() => () => {
    const dev = deviceRef.current;
    deviceRef.current = null;
    if (dev) dev.close().catch(() => {});
  }, []);

  // Chart redraw, live readout and throughput.
  useEffect(() => {
    const draw = () => drawFrame();
    const drawId = setInterval(draw, 100);
    let lastTick = Date.now();
    const statsId = setInterval(() => {
      const ring = ringRef.current;
      if (!ring) return;
      const end = pausedRef.current ? frozenEndRef.current : ring.total;
      setCaptured(ring.total);
      setNowUa(recentAverageUa(ring, end, 200));
      const v = voltageRef.current;
      const from = Math.max(ring.oldest, end - windowRef.current * SAMPLE_RATE_HZ);
      setLiveStats(rangeStats(ring, from, end, v));
      const sel = selRef.current;
      if (sel) {
        const a = Math.max(ring.oldest, Math.min(sel.a, ring.total));
        const b = Math.max(ring.oldest, Math.min(sel.b, ring.total));
        setSelStats(rangeStats(ring, a, b, v));
      } else setSelStats(null);
      const now = Date.now();
      const dt = (now - lastTick) / 1000;
      if (dt >= 1) {
        const n = countRef.current;
        setRateKs(dt > 0 ? (n / dt) / 1000 : null);
        countRef.current = 0;
        lastTick = now;
      }
    }, 300);
    return () => { clearInterval(drawId); clearInterval(statsId); };
    // drawFrame and voltageRef are read through refs, so the interval is created once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawFrame() {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === 'undefined') return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(200, canvas.clientWidth || 800);
    const pxW = Math.floor(cssW * dpr);
    if (canvas.width !== pxW || canvas.height !== CANVAS_H * dpr) {
      canvas.width = pxW;
      canvas.height = CANVAS_H * dpr;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, cssW, CANVAS_H);

    const ring = ringRef.current;
    if (!ring || ring.total === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '12px monospace';
      ctx.fillText(connectedRef.current ? 'Press Start to capture.' : 'Connect a PPK2 to begin.', 12, 24);
      viewRef.current = null;
      return;
    }
    const end = pausedRef.current ? frozenEndRef.current : ring.total;
    const from = Math.max(ring.oldest, end - windowRef.current * SAMPLE_RATE_HZ);
    const to = end;
    viewRef.current = { from, to, width: cssW };
    const buckets = Math.max(1, Math.floor(cssW));
    const env = envelope(ring, from, to, buckets);

    let maxUa = 0;
    for (let b = 0; b < buckets; b++) if (env.valid[b] && env.max[b] > maxUa) maxUa = env.max[b];
    const yMax = Math.max(maxUa * 1.1, 1);
    const yOf = (v) => 4 + (1 - Math.min(v, yMax) / yMax) * (CHART_H - 8);

    // Grid and axis labels
    ctx.strokeStyle = '#1e293b';
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = (yMax * g) / 4;
      const y = Math.round(yOf(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(cssW, y);
      ctx.stroke();
      ctx.fillText(fmtCurrent(v), 2, y - 2);
    }

    // Min/max envelope (cyan) with average line (emerald)
    for (let b = 0; b < buckets; b++) {
      if (!env.valid[b]) continue;
      const y1 = yOf(env.max[b]);
      const y2 = yOf(env.min[b]);
      ctx.fillStyle = 'rgba(34,211,238,0.35)';
      ctx.fillRect(40 + b * ((cssW - 40) / buckets), y1, Math.max(1, (cssW - 40) / buckets), Math.max(1, y2 - y1));
    }
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let started = false;
    for (let b = 0; b < buckets; b++) {
      if (!env.valid[b]) { started = false; continue; }
      const x = 40 + b * ((cssW - 40) / buckets);
      const y = yOf(env.avg[b]);
      if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Digital lanes D0-D7
    ctx.font = '10px monospace';
    for (let lane = 0; lane < 8; lane++) {
      const top = LANE_TOP + lane * LANE_PITCH;
      const hiY = top;
      const loY = top + LANE_H;
      ctx.fillStyle = '#64748b';
      ctx.fillText(`D${lane}`, 2, loY);
      for (let b = 0; b < buckets; b++) {
        if (!env.valid[b]) continue;
        const x = 40 + b * ((cssW - 40) / buckets);
        const w = Math.max(1, (cssW - 40) / buckets);
        const bit = 1 << lane;
        if (env.andBits[b] & bit) {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(x, hiY, w, 1.5);
        } else if (env.orBits[b] & bit) {
          ctx.fillStyle = 'rgba(245,158,11,0.35)';
          ctx.fillRect(x, hiY, w, LANE_H);
        } else {
          ctx.fillStyle = '#f59e0b';
          ctx.fillRect(x, loY - 1.5, w, 1.5);
        }
      }
    }

    // Time axis
    ctx.fillStyle = '#64748b';
    ctx.fillText(`-${((to - from) / SAMPLE_RATE_HZ).toFixed(1)} s`, 42, CANVAS_H - 4);
    ctx.fillText(pausedRef.current ? 'paused' : 'now', cssW - 34, CANVAS_H - 4);

    // Selection overlay
    const sel = selRef.current;
    if (sel && sel.b > from && sel.a < to) {
      const x1 = 40 + ((Math.max(sel.a, from) - from) / (to - from)) * (cssW - 40);
      const x2 = 40 + ((Math.min(sel.b, to) - from) / (to - from)) * (cssW - 40);
      ctx.fillStyle = 'rgba(251,191,36,0.15)';
      ctx.fillRect(x1, 0, Math.max(1, x2 - x1), LANE_TOP + 8 * LANE_PITCH);
      ctx.strokeStyle = '#fbbf24';
      ctx.strokeRect(x1 + 0.5, 0.5, Math.max(1, x2 - x1), LANE_TOP + 8 * LANE_PITCH - 1);
    }
  }

  const onSamples = (bytes) => {
    const ring = ringRef.current;
    const dec = decRef.current;
    const c = calRef.current;
    if (!ring || !dec || !c) return;
    const words = decodeWords(dec, bytes);
    if (!words.length) return;
    const { uA, bits } = convertWords(words, c.cal, c.vdd);
    ring.push(uA, bits);
    countRef.current += words.length;
  };

  const handleDisconnect = (err) => {
    deviceRef.current = null;
    setConnected(false);
    setMeasuring(false);
    setDutOn(false);
    setInfo(null);
    infoRef.current = null;
    if (err) setError(`PPK2 disconnected: ${err.message || err}`);
    log('PPK2 disconnected', 'warn');
  };

  const connect = async () => {
    setError('');
    let dev = null;
    try {
      const port = await requestPpk2Port();
      dev = new Ppk2Device(port);
      dev.onSamples = onSamples;
      dev.onDisconnect = handleDisconnect;
      await dev.open();
      const text = await dev.readMetadata();
      const parsed = parseMetadata(text);
      deviceRef.current = dev;
      infoRef.current = parsed;
      calRef.current = null;
      setInfo(parsed);
      setConnected(true);
      if (!parsed.complete) {
        setError(`Calibration metadata is incomplete (missing ${parsed.missing.join(', ')}). Currents are not shown and measuring is disabled.`);
      }
      log(`PPK2 connected (HW ${parsed.meta.hw ?? '?'}, VDD ${parsed.meta.vdd ?? '?'} mV)`, 'success');
    } catch (e) {
      setError(e?.message || String(e));
      if (dev) { try { await dev.close(); } catch (x) { /* ignore */ } }
    }
  };

  const disconnect = async () => {
    const dev = deviceRef.current;
    deviceRef.current = null;
    setMeasuring(false);
    setConnected(false);
    setDutOn(false);
    setInfo(null);
    infoRef.current = null;
    if (dev) {
      try { await dev.stopAverage(); } catch (e) { /* not measuring */ }
      try { await dev.close(); } catch (e) { /* ignore */ }
    }
    log('PPK2 disconnected', 'info');
  };

  const applyVoltage = async () => {
    const dev = deviceRef.current;
    if (!voltageValid) { setError(`Voltage must be between ${VDD_MIN_MV} and ${VDD_MAX_MV} mV.`); return; }
    setError('');
    calRef.current = calRef.current ? { ...calRef.current, vdd: voltageMv } : calRef.current;
    if (dev && mode === MODE_SOURCE) {
      try { await dev.setVoltageMv(voltageMv); } catch (e) { setError(e.message); }
    }
  };

  const toggleDut = async () => {
    const dev = deviceRef.current;
    if (!dev || mode !== MODE_SOURCE) return;
    const next = !dutOn;
    try {
      await dev.setDutPower(next);
      setDutOn(next);
      setError('');
    } catch (e) { setError(e.message); }
  };

  const changeMode = async (next) => {
    if (measuring || next === mode) return;
    setMode(next);
    const dev = deviceRef.current;
    if (dev && next === MODE_AMPERE && dutOn) {
      try { await dev.setDutPower(false); setDutOn(false); } catch (e) { setError(e.message); }
    }
  };

  const start = async () => {
    const dev = deviceRef.current;
    const parsed = infoRef.current;
    if (!dev || !parsed?.complete) return;
    if (mode === MODE_SOURCE && !voltageValid) { setError(`Voltage must be between ${VDD_MIN_MV} and ${VDD_MAX_MV} mV.`); return; }
    setError('');
    try {
      if (mode === MODE_AMPERE) {
        if (dutOn) { await dev.setDutPower(false); setDutOn(false); }
        await dev.setPowerMode(MODE_AMPERE);
      } else {
        await dev.setVoltageMv(voltageMv);
        await dev.setPowerMode(MODE_SOURCE);
      }
      // Fresh capture for every Start. The UI's voltage is used for the calibration offset term.
      ringRef.current = new SampleRing(CAPTURE_S * SAMPLE_RATE_HZ);
      decRef.current = createSampleDecoder();
      calRef.current = { cal: parsed.calibration, vdd: voltageMv };
      countRef.current = 0;
      setSelection(null);
      selRef.current = null;
      setSelStats(null);
      setPaused(false);
      pausedRef.current = false;
      await dev.startAverage();
      setMeasuring(true);
      log(`PPK2 measuring in ${mode === MODE_SOURCE ? `source meter at ${voltageMv} mV` : 'ampere meter'} mode`, 'info');
    } catch (e) {
      setError(e.message || String(e));
    }
  };

  const stop = async () => {
    const dev = deviceRef.current;
    if (!dev) return;
    try {
      await dev.stopAverage();
    } catch (e) {
      setError(e.message);
    }
    setMeasuring(false);
    setPaused(false);
  };

  const togglePause = () => {
    if (!ringRef.current) return;
    if (!pausedRef.current) {
      frozenEndRef.current = ringRef.current.total;
      pausedRef.current = true;
      setPaused(true);
    } else {
      pausedRef.current = false;
      setPaused(false);
    }
  };

  const clearCapture = () => {
    if (measuring) return;
    ringRef.current = null;
    setSelection(null);
    selRef.current = null;
    setSelStats(null);
    setCaptured(0);
    setLiveStats(null);
    setNowUa(null);
  };

  // Mouse selection on the chart: drag to select a time range (click clears it).
  const xToAbs = (clientX) => {
    const canvas = canvasRef.current;
    const view = viewRef.current;
    if (!canvas || !view) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const frac = Math.max(0, Math.min(1, (x - 40) / Math.max(1, rect.width - 40)));
    return Math.round(view.from + frac * (view.to - view.from));
  };

  const onPointerDown = (e) => {
    const abs = xToAbs(e.clientX);
    if (abs == null) return;
    dragRef.current = { start: abs };
    if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const abs = xToAbs(e.clientX);
    if (abs == null) return;
    const sel = { a: Math.min(d.start, abs), b: Math.max(d.start, abs) };
    selRef.current = sel;
  };

  const onPointerUp = (e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const abs = xToAbs(e.clientX);
    if (abs == null || Math.abs(abs - d.start) < 2) {
      selRef.current = null;
      setSelection(null);
      return;
    }
    const sel = { a: Math.min(d.start, abs), b: Math.max(d.start, abs) };
    selRef.current = sel;
    setSelection(sel);
  };

  const doExport = () => {
    const ring = ringRef.current;
    if (!ring || ring.total === 0) return;
    const sel = selRef.current;
    if (sel) {
      const a = Math.max(ring.oldest, sel.a);
      const b = Math.min(ring.total, sel.b);
      exportCsv(ring, a, b, 'selection');
    } else {
      exportCsv(ring, ring.oldest, ring.total, 'capture');
    }
  };

  const rowsAvailable = (() => {
    const sel = selection;
    if (sel && ringRef.current) return Math.max(0, Math.min(ringRef.current.total, sel.b) - Math.max(ringRef.current.oldest, sel.a));
    return ringRef.current ? ringRef.current.total - ringRef.current.oldest : 0;
  })();

  const webSerialAvailable = typeof navigator !== 'undefined' && !!navigator.serial;
  const meta = info?.meta;
  const energyV = Number.isFinite(voltageMv) ? voltageMv / 1000 : null;

  return (
    <div className="h-full overflow-auto bg-slate-950 text-slate-200 p-4 space-y-4 font-sans">
      <div className="flex flex-wrap items-center gap-3">
        <Zap className="w-5 h-5 text-amber-400" />
        <h2 className="text-base font-semibold">Power Profiler (PPK2)</h2>
        <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${connected ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        {measuring && (
          <span className="text-[11px] font-mono px-2 py-0.5 rounded border border-cyan-700 text-cyan-300">
            {paused ? 'MEASURING (PAUSED VIEW)' : 'MEASURING'}
          </span>
        )}
        <div className="ml-auto flex gap-2">
          {!connected ? (
            <button type="button" onClick={connect} disabled={!webSerialAvailable || measuring}
              className={`${CONTROL_BTN} border-cyan-700 text-cyan-300 hover:bg-cyan-950`}>
              <Plug className="w-3.5 h-3.5" /> Connect PPK2
            </button>
          ) : (
            <button type="button" onClick={disconnect} disabled={measuring}
              className={`${CONTROL_BTN} border-slate-700 text-slate-300 hover:bg-slate-800`}>
              <Plug className="w-3.5 h-3.5" /> Disconnect
            </button>
          )}
        </div>
      </div>

      {!webSerialAvailable && (
        <div className="text-xs text-amber-300 border border-amber-800 bg-amber-950/40 rounded p-2">
          Web Serial is not available in this browser. Use Chrome or Edge on desktop.
        </div>
      )}
      {error && (
        <div className="text-xs text-rose-300 border border-rose-800 bg-rose-950/40 rounded p-2 font-mono break-words">{error}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Controls */}
        <div className="space-y-3">
          <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-3">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Mode</div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => changeMode(MODE_SOURCE)} disabled={measuring}
                className={`${CONTROL_BTN} justify-center ${mode === MODE_SOURCE ? 'border-cyan-600 text-cyan-300 bg-cyan-950/40' : 'border-slate-700 text-slate-400'}`}>
                Source meter
              </button>
              <button type="button" onClick={() => changeMode(MODE_AMPERE)} disabled={measuring}
                className={`${CONTROL_BTN} justify-center ${mode === MODE_AMPERE ? 'border-cyan-600 text-cyan-300 bg-cyan-950/40' : 'border-slate-700 text-slate-400'}`}>
                Ampere meter
              </button>
            </div>
            {mode === MODE_SOURCE ? (
              <div className="space-y-2">
                <label className="block text-xs text-slate-400" htmlFor="ppk2-voltage">Output voltage (mV, {VDD_MIN_MV}–{VDD_MAX_MV})</label>
                <div className="flex gap-2">
                  <input id="ppk2-voltage" type="number" min={VDD_MIN_MV} max={VDD_MAX_MV} step={10}
                    value={voltageInput} onChange={(e) => setVoltageInput(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs" />
                  <button type="button" onClick={applyVoltage} disabled={!connected || !voltageValid}
                    className={`${CONTROL_BTN} border-slate-700 text-slate-300 hover:bg-slate-800`}>Apply</button>
                </div>
                <button type="button" onClick={toggleDut} disabled={!connected}
                  className={`${CONTROL_BTN} w-full justify-center ${dutOn ? 'border-emerald-600 text-emerald-300 bg-emerald-950/40' : 'border-slate-700 text-slate-300'}`}>
                  <Power className="w-3.5 h-3.5" /> DUT power {dutOn ? 'ON' : 'OFF'}
                </button>
              </div>
            ) : (
              <p className="text-xs text-slate-400 leading-relaxed">
                The PPK2 measures current flowing through it from an external supply. DUT power is switched off in this mode.
              </p>
            )}
            <div className="text-xs text-slate-400">
              Energy uses {energyV != null ? <span className="font-mono text-slate-300">{energyV.toFixed(3)} V</span> : 'no voltage'} from the mV field
              {mode === MODE_AMPERE ? ' (set it to your supply voltage)' : ''}.
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-slate-400">Capture</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={start} disabled={!canMeasure || measuring}
                className={`${CONTROL_BTN} border-emerald-700 text-emerald-300 hover:bg-emerald-950`}>
                <Play className="w-3.5 h-3.5" /> Start
              </button>
              <button type="button" onClick={stop} disabled={!measuring}
                className={`${CONTROL_BTN} border-rose-700 text-rose-300 hover:bg-rose-950`}>
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
              <button type="button" onClick={togglePause} disabled={!ringRef.current}
                className={`${CONTROL_BTN} border-slate-700 text-slate-300 hover:bg-slate-800`}>
                <Pause className="w-3.5 h-3.5" /> {paused ? 'Resume view' : 'Pause view'}
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              Window
              <select value={windowS} onChange={(e) => setWindowS(Number(e.target.value))}
                className="bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs">
                {WINDOWS_S.map((s) => <option key={s} value={s}>{s} s</option>)}
              </select>
            </div>
            <div className="text-[11px] font-mono text-slate-500">
              Captured: {captured.toLocaleString()} samples
              {' · '}rate: {rateKs != null ? `${rateKs.toFixed(1)} kS/s` : '—'} (nominal {SAMPLE_RATE_HZ / 1000} kS/s)
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={doExport} disabled={!rowsAvailable}
                className={`${CONTROL_BTN} border-slate-700 text-slate-300 hover:bg-slate-800`}>
                <Download className="w-3.5 h-3.5" /> CSV ({rowsAvailable.toLocaleString()} rows)
              </button>
              <button type="button" onClick={clearCapture} disabled={measuring || !ringRef.current}
                className={`${CONTROL_BTN} border-slate-700 text-slate-400 hover:bg-slate-800`}>
                <Trash2 className="w-3.5 h-3.5" /> Clear
              </button>
            </div>
            <div className="text-[11px] text-slate-500">
              Export uses the selected range if you have one, otherwise everything captured (up to the last {CAPTURE_S} s).
            </div>
          </div>

          {info && (
            <div className="bg-slate-900 border border-slate-800 rounded p-3 space-y-1 text-[11px] font-mono text-slate-400">
              <div className="text-[11px] uppercase tracking-wider text-slate-400 mb-1 font-sans">Device</div>
              <div>HW: {meta.hw ?? '—'}</div>
              <div>VDD (metadata): {meta.vdd != null ? `${meta.vdd} mV` : '—'}</div>
              <div>Mode (device): {meta.mode ?? '—'}</div>
              <div>Calibration: {info.complete ? 'complete' : `INCOMPLETE (${info.missing.length} keys)`}</div>
              {info.warnings.map((w) => <div key={w} className="text-amber-400">{w}</div>)}
            </div>
          )}
        </div>

        {/* Chart and stats */}
        <div className="space-y-3 min-w-0">
          <div className="bg-slate-900 border border-slate-800 rounded p-3">
            <div className="flex flex-wrap items-baseline gap-3 mb-2">
              <Gauge className="w-4 h-4 text-cyan-400" />
              <span className="text-[11px] uppercase tracking-wider text-slate-400">Current</span>
              <span className="font-mono text-lg text-cyan-200">{fmtCurrent(nowUa)}</span>
              <span className="text-[11px] text-slate-500 font-mono">avg of last 2 ms</span>
              <span className="ml-auto text-[11px] text-slate-500 font-mono">
                <span className="text-cyan-300">■</span> min/max &nbsp;<span className="text-emerald-400">—</span> avg &nbsp;<span className="text-amber-400">■</span> D0–D7
              </span>
            </div>
            <canvas
              ref={canvasRef}
              data-testid="ppk2-chart"
              style={{ width: '100%', height: CANVAS_H }}
              className="block rounded border border-slate-800 cursor-crosshair touch-none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => { dragRef.current = null; }}
            />
            <div className="text-[11px] text-slate-500 mt-1 font-mono">
              Drag across the chart to select a range for stats and CSV export. A single click clears the selection.
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <StatCard title={`Last ${windowS} s`} stats={liveStats || rangeStats(null, 0, 0)} voltageV={energyV} testId="ppk2-window-stats" />
            {selection ? (
              <StatCard title="Selection" stats={selStats || rangeStats(null, 0, 0)} voltageV={energyV} testId="ppk2-selection-stats" />
            ) : (
              <div className="bg-slate-950 border border-dashed border-slate-800 rounded p-3 text-xs text-slate-500 flex items-center">
                Drag on the chart to get stats for a selected time range.
              </div>
            )}
          </div>
          <p className="text-[11px] text-slate-500">
            Charge is the integral of current over time (µA × s = µC; 1 mAh = 3.6×10⁶ µC). Energy is charge × the voltage above.
            Stats use the live window or selection as captured; they are not corrected for the PPK2 spike filter.
          </p>
        </div>
      </div>
    </div>
  );
}
