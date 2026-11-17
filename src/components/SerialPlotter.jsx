import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  Play,
  Pause,
  Trash2,
  Download,
  Eye,
  EyeOff,
  Code,
  Copy,
  Check,
  X,
  Image as ImageIcon,
  Save,
  FolderOpen,
  Crosshair
} from 'lucide-react';
import { useSerial } from '../context/SerialContext';
import {
  MAX_POINTS,
  createPlotterEngine,
  parseColumns,
  visibleRange,
  decimateMinMax,
  channelStats,
  applyChannelScale,
  spectrum,
  dominantBin,
  estimateSampleRate,
  buildPlotCsv,
  serializePlotConfig,
  parsePlotConfig
} from '../utils/plotterCore';

const CHANNEL_COLORS = [
  '#22d3ee', // Cyan
  '#fbbf24', // Amber
  '#34d399', // Emerald
  '#f43f5e', // Rose
  '#a78bfa', // Violet
  '#fb923c', // Orange
  '#38bdf8', // Sky
  '#e879f9'  // Fuchsia
];

const PAD = { left: 52, right: 10, top: 8, bottom: 20 };

function fmtNum(v) {
  if (!Number.isFinite(v)) return '--';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(2);
  return String(Number(v.toFixed(a >= 100 ? 1 : 3)));
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const numInput = 'bg-slate-950 border border-slate-800 text-[11px] text-slate-300 rounded px-1.5 py-0.5 outline-none min-w-0';

export default function SerialPlotter({
  isConnected,
  engineRef // optional: receives the ingestion engine (tests / integrations)
}) {
  const { subscribeRx } = useSerial();

  const [version, setVersion] = useState(0); // bumps when the engine has new data
  const [visibleChannels, setVisibleChannels] = useState({});
  const [channelCfg, setChannelCfg] = useState({}); // { [ch]: { scale, offset, unit } }
  const [windowSize, setWindowSize] = useState(150);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const [customMinY, setCustomMinY] = useState(-50);
  const [customMaxY, setCustomMaxY] = useState(150);
  const [view, setView] = useState('time'); // time | fft | xy
  const [delimiter, setDelimiter] = useState('');
  const [columnsText, setColumnsText] = useState('');
  const [sampleRateInput, setSampleRateInput] = useState(0);
  const [fftChannel, setFftChannel] = useState(0);
  const [xyX, setXyX] = useState(0);
  const [xyY, setXyY] = useState(1);
  const [trigCfg, setTrigCfg] = useState({ enabled: false, channel: 0, level: 0, edge: 'rising', pre: 50, post: 100, single: false });
  const [trigStatus, setTrigStatus] = useState('off'); // off | armed | capturing | captured
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState(0); // samples back from newest
  const [hoverIdx, setHoverIdx] = useState(null); // index into the visible slice
  const [configMsg, setConfigMsg] = useState('');
  const [showSketchModal, setShowSketchModal] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState('arduino');
  const [copiedCode, setCopiedCode] = useState(false);

  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const engine = useMemo(() => createPlotterEngine({ cap: MAX_POINTS }), []);
  const frozenRef = useRef(null);   // snapshot while paused
  const geomRef = useRef({ start: 0, n: 0, plotW: 1 }); // set by the draw effect for mouse mapping
  const dragRef = useRef(null);
  const flushTimerRef = useRef(null);
  const pausedRef = useRef(false);
  pausedRef.current = isPaused;
  if (engineRef) engineRef.current = engine;

  // Engine config follows the UI.
  useEffect(() => {
    engine.setConfig({ delimiter, columns: parseColumns(columnsText) });
  }, [engine, delimiter, columnsText]);
  useEffect(() => {
    const wasEnabled = engine.trigger.cfg.enabled;
    engine.trigger.configure(trigCfg);
    if (trigCfg.enabled && !wasEnabled) { engine.trigger.arm(); setTrigStatus('armed'); }
  }, [engine, trigCfg]);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (!pausedRef.current) setVersion((v) => v + 1);
      const t = engine.trigger;
      setTrigStatus(!t.cfg.enabled ? 'off' : t.collecting ? 'capturing' : t.armed ? 'armed' : t.capture ? 'captured' : 'off');
    }, 50);
  }, [engine]);

  // Every received chunk goes through the shared line assembler; each line is one sample.
  useEffect(() => {
    if (!subscribeRx) return undefined;
    const off = subscribeRx((bytes) => {
      if (engine.push(bytes, Date.now()) > 0) scheduleFlush();
    });
    return () => {
      off();
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    };
  }, [subscribeRx, engine, scheduleFlush]);

  const togglePause = () => {
    if (!isPaused) frozenRef.current = engine.points.slice();
    else { frozenRef.current = null; setVersion((v) => v + 1); }
    setIsPaused(!isPaused);
  };

  const clearAll = () => {
    engine.clear();
    frozenRef.current = isPaused ? [] : null;
    setPan(0);
    setHoverIdx(null);
    setTrigStatus('off');
    setVersion((v) => v + 1);
  };

  const armTrigger = () => {
    engine.trigger.configure(trigCfg);
    engine.trigger.arm();
    setTrigStatus(engine.trigger.armed ? 'armed' : 'off');
    setVersion((v) => v + 1);
  };

  // Source of the displayed points: trigger capture, frozen snapshot while paused, or live buffer.
  const captureShown = trigCfg.enabled && engine.trigger.capture ? engine.trigger.capture : null;
  const sourcePoints = captureShown ? captureShown.points : (isPaused && frozenRef.current ? frozenRef.current : engine.points);
  const total = sourcePoints.length;
  const range = visibleRange(total, windowSize, zoom, captureShown ? 0 : pan);
  const slice = useMemo(
    () => sourcePoints.slice(range.start, range.end),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourcePoints, range.start, range.end, version]
  );
  const labels = engine.labels();
  const maxChannels = Math.max(labels.length, 1);

  // Scaled series per channel for the visible slice.
  const series = useMemo(() => {
    const out = [];
    for (let ch = 0; ch < maxChannels; ch++) {
      const cfg = channelCfg[ch];
      out.push(slice.map((p) => applyChannelScale(p.values[ch], cfg)));
    }
    return out;
  }, [slice, maxChannels, channelCfg]);

  const measuredRate = useMemo(() => estimateSampleRate(slice), [slice]);
  const sampleRate = sampleRateInput > 0 ? sampleRateInput : measuredRate;

  // Canvas drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = rect.width;
    const height = rect.height;
    const plotW = Math.max(10, width - PAD.left - PAD.right);
    const plotH = Math.max(10, height - PAD.top - PAD.bottom);
    geomRef.current = { start: range.start, n: slice.length, plotW };

    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = '#0e1726';
    ctx.lineWidth = 1;
    for (let c = 0; c <= 8; c++) {
      const x = PAD.left + (plotW / 8) * c;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + plotH); ctx.stroke();
    }
    for (let r = 0; r <= 6; r++) {
      const y = PAD.top + (plotH / 6) * r;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + plotW, y); ctx.stroke();
    }

    ctx.font = '10px "JetBrains Mono", monospace';

    if (slice.length === 0) {
      ctx.fillStyle = '#334155';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WAITING FOR NUMERIC SERIAL TELEMETRY...', width / 2, height / 2 - 10);
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#1e293b';
      ctx.fillText('Format: "24.5, 45.2, 100" or "temp:25.4 volt:3.3"', width / 2, height / 2 + 12);
      return;
    }

    const isShown = (ch) => visibleChannels[ch] !== false;
    const axisLabel = (txt, x, y, align = 'left') => { ctx.fillStyle = '#64748b'; ctx.textAlign = align; ctx.fillText(txt, x, y); };

    const rangeOf = (arrays, auto, fixedMin, fixedMax) => {
      if (!auto) return [fixedMin, fixedMax];
      let lo = Infinity; let hi = -Infinity;
      for (const arr of arrays) for (const v of arr) { if (v === undefined || !Number.isFinite(v)) continue; if (v < lo) lo = v; if (v > hi) hi = v; }
      if (lo === Infinity) return [0, 100];
      const span = hi - lo || 1;
      return [lo - span * 0.1, hi + span * 0.1];
    };

    if (view === 'time') {
      const shownSeries = series.filter((_, ch) => isShown(ch));
      const [minY, maxY] = rangeOf(shownSeries, autoScale, customMinY, customMaxY);
      const yRange = maxY - minY || 1;
      const yOf = (v) => PAD.top + plotH - ((v - minY) / yRange) * plotH;
      const n = slice.length;
      const xOf = (i) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);

      if (minY < 0 && maxY > 0) {
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD.left, yOf(0)); ctx.lineTo(PAD.left + plotW, yOf(0)); ctx.stroke();
        ctx.setLineDash([]);
      }

      for (let ch = 0; ch < series.length; ch++) {
        if (!isShown(ch)) continue;
        const color = CHANNEL_COLORS[ch % CHANNEL_COLORS.length];
        ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        const pts = decimateMinMax(series[ch], Math.floor(plotW));
        ctx.beginPath();
        pts.forEach((p, k) => { if (k === 0) ctx.moveTo(xOf(p.i), yOf(p.v)); else ctx.lineTo(xOf(p.i), yOf(p.v)); });
        ctx.stroke();
      }

      // Y labels
      for (let r = 0; r <= 6; r += 2) {
        const v = maxY - (yRange / 6) * r;
        axisLabel(fmtNum(v), PAD.left - 4, PAD.top + (plotH / 6) * r + 3, 'right');
      }
      // Time axis: real timestamps relative to the newest visible sample
      const tLast = slice[n - 1].t;
      for (let c = 0; c <= 4; c++) {
        const i = Math.round(((n - 1) * c) / 4);
        const dt = (slice[i].t - tLast) / 1000;
        axisLabel(c === 4 ? 'now' : `${dt.toFixed(Math.abs(dt) < 10 ? 2 : 1)}s`, PAD.left + (plotW / 4) * c, height - 6, c === 0 ? 'left' : c === 4 ? 'right' : 'center');
      }
      // Trigger marker
      if (captureShown) {
        const xi = xOf(captureShown.triggerIndex - range.start);
        if (xi >= PAD.left && xi <= PAD.left + plotW) {
          ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
          ctx.beginPath(); ctx.moveTo(xi, PAD.top); ctx.lineTo(xi, PAD.top + plotH); ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      // Hover cursor
      if (hoverIdx !== null && hoverIdx >= 0 && hoverIdx < n) {
        ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(xOf(hoverIdx), PAD.top); ctx.lineTo(xOf(hoverIdx), PAD.top + plotH); ctx.stroke();
      }
    } else if (view === 'fft') {
      const sp = spectrum(series[fftChannel] || [], sampleRate || 0);
      if (!sp.n) {
        axisLabel(sampleRate ? 'Need at least 8 samples for an FFT.' : 'Sample rate unknown: set it above (Hz).', width / 2, height / 2, 'center');
        return;
      }
      const maxMag = Math.max(...sp.mags, 1e-12);
      const nyq = sp.freqs[sp.freqs.length - 1];
      const bins = sp.mags.length;
      ctx.strokeStyle = CHANNEL_COLORS[fftChannel % CHANNEL_COLORS.length]; ctx.lineWidth = 1.4;
      const dec = decimateMinMax(sp.mags, Math.floor(plotW));
      ctx.beginPath();
      dec.forEach((p, k) => {
        const x = PAD.left + (p.i / Math.max(1, bins - 1)) * plotW;
        const y = PAD.top + plotH - (p.v / maxMag) * plotH;
        if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      const pk = dominantBin(sp.mags);
      axisLabel(`Peak ${sp.freqs[pk].toFixed(2)} Hz  amp ${fmtNum(sp.mags[pk])}  (N=${sp.n}, ${sp.binHz.toFixed(3)} Hz/bin)`, PAD.left + 6, PAD.top + 12);
      for (let c = 0; c <= 4; c++) axisLabel(`${((nyq * c) / 4).toFixed(nyq < 10 ? 2 : 0)} Hz`, PAD.left + (plotW / 4) * c, height - 6, c === 0 ? 'left' : c === 4 ? 'right' : 'center');
      axisLabel(fmtNum(maxMag), PAD.left - 4, PAD.top + 10, 'right');
      axisLabel('0', PAD.left - 4, PAD.top + plotH, 'right');
    } else {
      const xs = series[xyX] || [];
      const ys = series[xyY] || [];
      const [x0, x1] = rangeOf([xs], true);
      const [y0, y1] = rangeOf([ys], true);
      ctx.strokeStyle = CHANNEL_COLORS[xyY % CHANNEL_COLORS.length]; ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < xs.length; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
        const x = PAD.left + ((xs[i] - x0) / (x1 - x0 || 1)) * plotW;
        const y = PAD.top + plotH - ((ys[i] - y0) / (y1 - y0 || 1)) * plotH;
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      axisLabel(`X: ${labels[xyX] || `CH ${xyX}`} ${fmtNum(x0)}..${fmtNum(x1)}`, PAD.left + 6, height - 6);
      axisLabel(`${fmtNum(y1)}`, PAD.left - 4, PAD.top + 10, 'right');
      axisLabel(`${fmtNum(y0)}`, PAD.left - 4, PAD.top + plotH, 'right');
      axisLabel(`Y: ${labels[xyY] || `CH ${xyY}`}`, PAD.left + 6, PAD.top + 12);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slice, series, view, visibleChannels, autoScale, customMinY, customMaxY, hoverIdx, fftChannel, xyX, xyY, sampleRate, captureShown, range.start]);

  // Wheel zoom needs a non-passive listener so the page does not scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      setZoom((z) => Math.min(50, Math.max(0.1, e.deltaY < 0 ? z * 1.25 : z / 1.25)));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const localX = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return e.clientX - r.left - PAD.left;
  };
  const onMouseDown = (e) => { dragRef.current = { x: e.clientX, pan }; };
  const onMouseUp = () => { dragRef.current = null; };
  const onMouseMove = (e) => {
    const g = geomRef.current;
    if (dragRef.current && view === 'time' && !captureShown) {
      const dx = e.clientX - dragRef.current.x;
      setPan(Math.max(0, dragRef.current.pan + Math.round((dx / g.plotW) * g.n)));
      return;
    }
    if (view !== 'time' || g.n === 0) { setHoverIdx(null); return; }
    const frac = Math.min(1, Math.max(0, localX(e) / g.plotW));
    setHoverIdx(Math.round(frac * (g.n - 1)));
  };
  const resetView = () => { setZoom(1); setPan(0); };

  const stats = useMemo(() => {
    const out = [];
    for (let ch = 0; ch < maxChannels; ch++) {
      const st = channelStats(series[ch] || []);
      if (!st) continue;
      out.push({ ch, label: labels[ch] || `CH ${ch}`, color: CHANNEL_COLORS[ch % CHANNEL_COLORS.length], ...st });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, maxChannels, version]);

  const hoverPoint = hoverIdx !== null && slice[hoverIdx] ? slice[hoverIdx] : null;

  const toggleChannelVisibility = (ch) => {
    setVisibleChannels(prev => ({ ...prev, [ch]: prev[ch] === false ? true : false }));
  };
  const updateChannelCfg = (ch, patch) => setChannelCfg((prev) => ({ ...prev, [ch]: { ...prev[ch], ...patch } }));

  const handleExportCSV = () => {
    if (engine.points.length === 0) return;
    download(new Blob([buildPlotCsv(engine.points, engine.labels())], { type: 'text/csv' }), `serial-plot-${Date.now()}.csv`);
  };

  const handleExportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => { if (blob) download(blob, `serial-plot-${Date.now()}.png`); }, 'image/png');
  };

  const handleSaveConfig = () => {
    const hiddenChannels = Object.entries(visibleChannels).filter(([, v]) => v === false).map(([k]) => Number(k));
    const text = serializePlotConfig({
      windowSize, autoScale, customMinY, customMaxY, delimiter, columnsText,
      sampleRate: sampleRateInput, view, channelCfg, hiddenChannels, trigger: trigCfg
    });
    download(new Blob([text], { type: 'application/json' }), 'plotter-config.json');
    setConfigMsg('Config saved.');
  };

  const handleLoadConfig = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const c = parsePlotConfig(await file.text());
      setWindowSize(c.windowSize); setAutoScale(c.autoScale); setCustomMinY(c.customMinY); setCustomMaxY(c.customMaxY);
      setDelimiter(c.delimiter); setColumnsText(c.columnsText); setSampleRateInput(c.sampleRate); setView(c.view);
      setChannelCfg(c.channelCfg);
      setVisibleChannels(Object.fromEntries(c.hiddenChannels.map((k) => [k, false])));
      setTrigCfg(c.trigger);
      setConfigMsg('Config loaded.');
    } catch (err) {
      setConfigMsg(`Could not load config: ${err.message}`);
    }
  };

  const chOptions = Array.from({ length: maxChannels }, (_, i) => (
    <option key={i} value={i}>{labels[i] || `CH ${i}`}</option>
  ));
  const setTrig = (patch) => setTrigCfg((prev) => ({ ...prev, ...patch }));

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">REAL-TIME SERIAL OSCILLOSCOPE & PLOTTER</h2>
          <span className="text-[10px] text-slate-500">{engine.points.length.toLocaleString()} / {MAX_POINTS.toLocaleString()} samples</span>
        </div>

        {/* Top Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowSketchModal(true)}
            className="flex items-center gap-1 text-[11px] bg-slate-900 hover:bg-slate-800 text-cyber-cyan px-2.5 py-1 rounded-lg border border-slate-800 transition-colors"
          >
            <Code className="w-3.5 h-3.5 text-cyber-cyan" />
            <span>Firmware Sketches</span>
          </button>

          <select
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
            aria-label="Window size"
            className="bg-slate-950 border border-slate-800 text-[11px] text-slate-300 rounded px-2 py-1 outline-none cursor-pointer"
          >
            {[50, 100, 150, 300, 500, 1000, 5000].map((n) => <option key={n} value={n}>{n} Samples</option>)}
          </select>

          <label className="flex items-center gap-1 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={autoScale}
              onChange={(e) => setAutoScale(e.target.checked)}
              aria-label="Auto-scale Y axis"
            />
            <span>Auto-scale</span>
          </label>
          <input
            type="number"
            value={customMinY}
            disabled={autoScale}
            onChange={(e) => setCustomMinY(Number(e.target.value))}
            aria-label="Y axis minimum"
            title="Y min"
            className="w-16 bg-slate-950 border border-slate-800 text-[11px] text-slate-300 rounded px-2 py-1 outline-none disabled:opacity-40"
          />
          <input
            type="number"
            value={customMaxY}
            disabled={autoScale}
            onChange={(e) => setCustomMaxY(Number(e.target.value))}
            aria-label="Y axis maximum"
            title="Y max"
            className="w-16 bg-slate-950 border border-slate-800 text-[11px] text-slate-300 rounded px-2 py-1 outline-none disabled:opacity-40"
          />

          <button
            onClick={togglePause}
            title={isPaused ? "Resume (display catches up)" : "Freeze the display (samples keep recording)"}
            className={`p-1.5 rounded border transition-colors ${
              isPaused ? 'bg-amber-500/20 text-cyber-amber border-amber-500/40 animate-pulse' : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-cyber-amber" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          <button onClick={handleExportCSV} title="Export CSV (true per-sample timestamps)" className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800">
            <Download className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleExportPng} title="Export the plot as PNG" className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800">
            <ImageIcon className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleSaveConfig} title="Save plot config" className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800">
            <Save className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()} title="Load plot config" className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800">
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
          <input ref={fileInputRef} type="file" accept="application/json,.json" onChange={handleLoadConfig} className="hidden" aria-label="Load plot config file" />

          <button onClick={clearAll} title="Clear Waveform Data" className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Analysis toolbar: view, parser, trigger */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400">
        <div className="flex items-center gap-1" role="group" aria-label="View mode">
          {['time', 'fft', 'xy'].map((m) => (
            <button
              key={m}
              onClick={() => setView(m)}
              className={`px-2 py-0.5 rounded border uppercase ${view === m ? 'bg-cyan-500/20 text-cyber-cyan border-cyan-500/40' : 'bg-slate-900 border-slate-800 text-slate-400'}`}
            >{m}</button>
          ))}
        </div>

        <label className="flex items-center gap-1">Delimiter
          <input value={delimiter} onChange={(e) => setDelimiter(e.target.value)} placeholder="auto" aria-label="Custom delimiter" className={`${numInput} w-14`} />
        </label>
        <label className="flex items-center gap-1">Columns
          <input value={columnsText} onChange={(e) => setColumnsText(e.target.value)} placeholder="all (0,2,3)" aria-label="Column mapping" className={`${numInput} w-24`} />
        </label>

        {view === 'fft' && (
          <>
            <label className="flex items-center gap-1">Channel
              <select value={fftChannel} onChange={(e) => setFftChannel(Number(e.target.value))} aria-label="FFT channel" className={numInput}>{chOptions}</select>
            </label>
            <label className="flex items-center gap-1">Rate Hz
              <input type="number" min={0} value={sampleRateInput || ''} onChange={(e) => setSampleRateInput(Number(e.target.value) || 0)} placeholder={measuredRate ? measuredRate.toFixed(1) : 'auto'} aria-label="Sample rate in Hz" className={`${numInput} w-20`} />
            </label>
          </>
        )}
        {view === 'xy' && (
          <>
            <label className="flex items-center gap-1">X
              <select value={xyX} onChange={(e) => setXyX(Number(e.target.value))} aria-label="XY X channel" className={numInput}>{chOptions}</select>
            </label>
            <label className="flex items-center gap-1">Y
              <select value={xyY} onChange={(e) => setXyY(Number(e.target.value))} aria-label="XY Y channel" className={numInput}>{chOptions}</select>
            </label>
          </>
        )}

        <span className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
          <Crosshair className="w-3.5 h-3.5 text-slate-500" />
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={trigCfg.enabled} onChange={(e) => setTrig({ enabled: e.target.checked })} aria-label="Enable trigger" />
            Trigger
          </label>
          {trigCfg.enabled && (
            <>
              <select value={trigCfg.channel} onChange={(e) => setTrig({ channel: Number(e.target.value) })} aria-label="Trigger channel" className={numInput}>{chOptions}</select>
              <select value={trigCfg.edge} onChange={(e) => setTrig({ edge: e.target.value })} aria-label="Trigger edge" className={numInput}>
                <option value="rising">rising</option><option value="falling">falling</option><option value="either">either</option>
              </select>
              <label className="flex items-center gap-1">level
                <input type="number" value={trigCfg.level} onChange={(e) => setTrig({ level: Number(e.target.value) })} aria-label="Trigger level" className={`${numInput} w-16`} />
              </label>
              <label className="flex items-center gap-1">pre
                <input type="number" min={0} value={trigCfg.pre} onChange={(e) => setTrig({ pre: Math.max(0, Number(e.target.value) || 0) })} aria-label="Pre-trigger samples" className={`${numInput} w-14`} />
              </label>
              <label className="flex items-center gap-1">post
                <input type="number" min={0} value={trigCfg.post} onChange={(e) => setTrig({ post: Math.max(0, Number(e.target.value) || 0) })} aria-label="Post-trigger samples" className={`${numInput} w-14`} />
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={trigCfg.single} onChange={(e) => setTrig({ single: e.target.checked })} aria-label="Single shot" />
                single
              </label>
              <button onClick={armTrigger} className="px-2 py-0.5 rounded border bg-slate-900 border-slate-800 text-cyber-cyan">Arm</button>
              <span className="text-slate-500">{trigStatus}</span>
            </>
          )}
        </span>

        {(zoom !== 1 || pan !== 0) && (
          <button onClick={resetView} className="px-2 py-0.5 rounded border bg-slate-900 border-slate-800 text-slate-300">
            Reset view ({zoom.toFixed(2)}x)
          </button>
        )}
        {configMsg && <span className="text-slate-500">{configMsg}</span>}
      </div>

      {/* Canvas Viewport */}
      <div className="relative w-full h-64 bg-[#030712] rounded-xl border border-slate-800 overflow-hidden shadow-inner">
        <canvas
          ref={canvasRef}
          className="w-full h-full block cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onMouseMove={onMouseMove}
          onMouseLeave={() => { dragRef.current = null; setHoverIdx(null); }}
          onDoubleClick={resetView}
        />
        {hoverPoint && view === 'time' && (
          <div className="absolute top-1 right-2 bg-slate-950/90 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-300 pointer-events-none">
            <div className="text-slate-500">{new Date(hoverPoint.t).toISOString().slice(11, 23)}</div>
            {hoverPoint.values.map((v, ch) => (v === undefined || visibleChannels[ch] === false ? null : (
              <div key={ch} style={{ color: CHANNEL_COLORS[ch % CHANNEL_COLORS.length] }}>
                {labels[ch] || `CH ${ch}`}: {fmtNum(applyChannelScale(v, channelCfg[ch]))}{channelCfg[ch]?.unit ? ` ${channelCfg[ch].unit}` : ''}
              </div>
            )))}
          </div>
        )}
      </div>

      {/* Live Channel Telemetry Cards */}
      <div className="grid grid-cols-2 @sm:grid-cols-4 gap-2 pt-1">
        {stats.length === 0 ? (
          <div className="col-span-full text-center text-slate-600 py-2 text-[11px]">
            No active numeric channels detected. Stream numbers like <code>25.4, 102.1</code> over serial to plot live waveforms.
          </div>
        ) : (
          stats.map((st) => {
            const cfg = channelCfg[st.ch] || {};
            return (
              <div
                key={st.ch}
                className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5" style={{ color: st.color }}>
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: st.color }}></span>
                    {st.label}
                  </span>
                  <button
                    onClick={() => toggleChannelVisibility(st.ch)}
                    aria-label={`Toggle ${st.label}`}
                    className="text-slate-500 hover:text-slate-300"
                  >
                    {visibleChannels[st.ch] === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="text-lg font-bold text-slate-100 my-1">
                  {fmtNum(st.last)}{cfg.unit ? <span className="text-xs text-slate-500"> {cfg.unit}</span> : null}
                </div>

                <div className="grid grid-cols-2 gap-x-2 text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                  <span>Min: <strong className="text-slate-400">{fmtNum(st.min)}</strong></span>
                  <span>Max: <strong className="text-slate-400">{fmtNum(st.max)}</strong></span>
                  <span>Mean: <strong className="text-slate-400">{fmtNum(st.mean)}</strong></span>
                  <span>RMS: <strong className="text-slate-400">{fmtNum(st.rms)}</strong></span>
                </div>

                <div className="grid grid-cols-3 gap-1 mt-1.5">
                  <input type="number" step="any" value={cfg.scale ?? ''} placeholder="x1" onChange={(e) => updateChannelCfg(st.ch, { scale: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label={`Scale for ${st.label}`} title="Scale" className={numInput} />
                  <input type="number" step="any" value={cfg.offset ?? ''} placeholder="+0" onChange={(e) => updateChannelCfg(st.ch, { offset: e.target.value === '' ? undefined : Number(e.target.value) })} aria-label={`Offset for ${st.label}`} title="Offset" className={numInput} />
                  <input value={cfg.unit || ''} placeholder="unit" onChange={(e) => updateChannelCfg(st.ch, { unit: e.target.value })} aria-label={`Unit for ${st.label}`} title="Unit" className={numInput} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Microcontroller Firmware Helper Modal */}
      {showSketchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0b1329] border border-cyan-500/40 rounded-2xl w-full max-w-2xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Code className="w-5 h-5 text-cyber-cyan" />
                <h3 className="font-bold text-slate-100 text-sm tracking-wide">
                  HARDWARE OSCILLOSCOPE CODE TEMPLATES
                </h3>
              </div>
              <button
                onClick={() => setShowSketchModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              To use your ESP32, Arduino, or RP2040 as an oscilloscope, flash one of these snippets. The microcontroller samples its analog ADC pins and writes comma-separated readings directly over UART.
            </p>

            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setActiveCodeTab('arduino')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeCodeTab === 'arduino'
                    ? 'bg-cyber-cyan text-slate-950 shadow-cyan-glow'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-900'
                }`}
              >
                Arduino C++ (ESP32 / Uno)
              </button>
              <button
                onClick={() => setActiveCodeTab('micropython')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeCodeTab === 'micropython'
                    ? 'bg-cyber-amber text-slate-950 shadow-amber-glow'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-900'
                }`}
              >
                MicroPython (ESP32 / Pico)
              </button>
              <button
                onClick={() => setActiveCodeTab('labeled')}
                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                  activeCodeTab === 'labeled'
                    ? 'bg-cyber-emerald text-slate-950 shadow-emerald-glow'
                    : 'text-slate-400 hover:text-slate-200 bg-slate-900'
                }`}
              >
                Key:Value Named Channels
              </button>
            </div>

            <div className="relative bg-[#030712] border border-slate-800 rounded-xl p-3 font-mono text-[11px] overflow-x-auto text-emerald-400 max-h-60">
              <pre className="whitespace-pre">
                {activeCodeTab === 'arduino' && `// Arduino / ESP32 3-Channel ADC Oscilloscope
void setup() {
  Serial.begin(115200);
}

void loop() {
  int ch0 = analogRead(A0);  // Channel 0 (ADC Raw)
  int ch1 = analogRead(A1);  // Channel 1 (ADC Raw)
  float volt = ch0 * (3.3 / 4095.0); // Channel 2 (Calculated Volts)

  // Output comma-separated telemetry line:
  Serial.print(ch0);
  Serial.print(",");
  Serial.print(ch1);
  Serial.print(",");
  Serial.println(volt);

  delay(20); // 50 Hz sampling rate
}`}
                {activeCodeTab === 'micropython' && `# MicroPython 2-Channel Live ADC Streamer
import time
from machine import ADC, Pin

adc0 = ADC(Pin(34))
adc1 = ADC(Pin(35))
adc0.atten(ADC.ATTN_11DB) # 0 - 3.3V range

while True:
    raw0 = adc0.read()
    raw1 = adc1.read()
    voltage = raw0 * (3.3 / 4095)
    print(f"{raw0},{raw1},{voltage:.2f}")
    time.sleep_ms(20) # 50 Hz`}
                {activeCodeTab === 'labeled' && `// Key:Value Format (Auto-creates channel names in plotter)
void loop() {
  float temp = readInternalTemp();
  float vcc = readVccVoltage();
  
  // Format: "temp:24.5 vcc:3.31"
  Serial.print("temp:");
  Serial.print(temp, 1);
  Serial.print(" vcc:");
  Serial.println(vcc, 2);
  
  delay(50);
}`}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[11px] text-slate-500">
                Baud rate must match the Header HUD setting (e.g. 115200 bps).
              </span>
              <button
                onClick={() => {
                  const snippet = 
                    activeCodeTab === 'arduino' 
                      ? `void setup() {\n  Serial.begin(115200);\n}\nvoid loop() {\n  int ch0 = analogRead(A0);\n  int ch1 = analogRead(A1);\n  float volt = ch0 * (3.3 / 4095.0);\n  Serial.print(ch0);\n  Serial.print(",");\n  Serial.print(ch1);\n  Serial.print(",");\n  Serial.println(volt);\n  delay(20);\n}`
                      : activeCodeTab === 'micropython'
                      ? `import time\nfrom machine import ADC, Pin\nadc0 = ADC(Pin(34))\nadc1 = ADC(Pin(35))\nadc0.atten(ADC.ATTN_11DB)\nwhile True:\n    raw0 = adc0.read()\n    raw1 = adc1.read()\n    voltage = raw0 * (3.3 / 4095)\n    print(f"{raw0},{raw1},{voltage:.2f}")\n    time.sleep_ms(20)`
                      : `void loop() {\n  float temp = readInternalTemp();\n  float vcc = readVccVoltage();\n  Serial.print("temp:");\n  Serial.print(temp, 1);\n  Serial.print(" vcc:");\n  Serial.println(vcc, 2);\n  delay(50);\n}`;
                  navigator.clipboard.writeText(snippet);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyber-card hover:bg-slate-800 text-cyber-cyan border border-cyber-cyan/30 text-xs font-bold transition-all"
              >
                {copiedCode ? <Check className="w-3.5 h-3.5 text-cyber-emerald" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedCode ? 'COPIED TO CLIPBOARD' : 'COPY CODE'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
