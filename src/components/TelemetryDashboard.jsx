import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Gauge, 
  Activity, 
  Compass, 
  RotateCcw, 
  Download
} from 'lucide-react';
import { useSerial } from '../context/SerialContext';
import { createLineAssembler, parseTelemetryLine } from '../utils/rxLines';
import {
  HISTORY_OPTIONS,
  samplePairs,
  applySamples,
  trimHistory,
  resetChannelStats,
  buildTelemetryCsv
} from '../utils/telemetryModel';

const SAMPLE_LOG_LIMIT = 5000;

function Sparkline({ history }) {
  if (!history || history.length < 2) return null;
  const min = Math.min(...history);
  const max = Math.max(...history);
  const span = max - min || 1;
  const pts = history.map((v, i) => `${(i / (history.length - 1)) * 100},${20 - ((v - min) / span) * 18 - 1}`).join(' ');
  return (
    <svg viewBox="0 0 100 20" className="w-full h-5 mt-1" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function TelemetryDashboard() {
  const { subscribeRx } = useSerial();

  // Channels appear only when data arrives: { [key]: { value, min, max, history: number[] } }
  const [telemetryData, setTelemetryData] = useState({});
  // User config per channel: { [key]: { label, unit, min, max } } (min/max are gauge range overrides)
  const [channelConfig, setChannelConfig] = useState({});
  const [historyLen, setHistoryLen] = useState(20);
  const [activeGaugeChannel, setActiveGaugeChannel] = useState('');
  const historyLenRef = useRef(20);
  const samplesRef = useRef([]); // [{ t, pairs }] for CSV export

  // Every received chunk: bytes -> lines -> samples, applied as one batch per chunk.
  useEffect(() => {
    if (!subscribeRx) return undefined;
    const assembler = createLineAssembler();
    return subscribeRx((bytes) => {
      const batch = [];
      for (const { text, t } of assembler.push(bytes, Date.now())) {
        const pairs = samplePairs(parseTelemetryLine(text));
        if (pairs.length) batch.push({ t, pairs });
      }
      if (!batch.length) return;
      samplesRef.current = [...samplesRef.current, ...batch].slice(-SAMPLE_LOG_LIMIT);
      setTelemetryData((prev) => applySamples(prev, batch.map((b) => b.pairs), historyLenRef.current));
    });
  }, [subscribeRx]);

  // Select the first channel that appears.
  useEffect(() => {
    const keys = Object.keys(telemetryData);
    if (keys.length && !telemetryData[activeGaugeChannel]) setActiveGaugeChannel(keys[0]);
  }, [telemetryData, activeGaugeChannel]);

  const handleHistoryLen = (n) => {
    historyLenRef.current = n;
    setHistoryLen(n);
    setTelemetryData((prev) => trimHistory(prev, n));
  };

  const handleResetStats = () => setTelemetryData((prev) => resetChannelStats(prev));

  const updateConfig = useCallback((key, patch) => {
    setChannelConfig((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }, []);

  const handleExportCsv = () => {
    if (!samplesRef.current.length) return;
    const csv = buildTelemetryCsv(samplesRef.current, channelConfig);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `telemetry-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const channelKeys = Object.keys(telemetryData);
  const hasData = channelKeys.length > 0;
  const labelOf = (k) => channelConfig[k]?.label || k;
  const unitOf = (k) => channelConfig[k]?.unit || '';

  const activeChannelData = telemetryData[activeGaugeChannel] || {
    value: 0,
    min: 0,
    max: 100,
    history: []
  };
  const activeCfg = channelConfig[activeGaugeChannel] || {};

  // Radial gauge: user range if set, otherwise the observed min/max (0-100 until a span exists)
  const observedSpan = activeChannelData.min !== activeChannelData.max;
  const gaugeMin = Number.isFinite(activeCfg.min) ? activeCfg.min : observedSpan ? activeChannelData.min : 0;
  const gaugeMax = Number.isFinite(activeCfg.max) ? activeCfg.max : observedSpan ? activeChannelData.max : 100;
  const range = gaugeMax - gaugeMin || 1;
  const clampedVal = Math.min(Math.max(activeChannelData.value, gaugeMin), gaugeMax);
  const normalized = hasData ? (clampedVal - gaugeMin) / range : 0;
  // Arc from -135deg to +135deg (total 270deg)
  const needleAngle = -135 + normalized * 270;

  // Attitude gyro binds to channels named pitch / roll (absent until they arrive)
  const hasPitch = telemetryData.pitch !== undefined;
  const hasRoll = telemetryData.roll !== undefined;
  const currentPitch = telemetryData.pitch?.value ?? 0;
  const currentRoll = telemetryData.roll?.value ?? 0;
  const fmt = (v, has) => (has ? `${v.toFixed(1)}°` : '--');

  return (
    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-slate-200 text-xs font-mono space-y-4">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Gauge className="w-5 h-5 text-cyan-400" />
          <div>
            <h2 className="font-bold text-sm text-slate-100 uppercase tracking-wider flex items-center gap-2">
              TELEMETRY & ATTITUDE DASHBOARD
              <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                SERIAL STUDIO ENGINE
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Gauges, pitch/roll horizon and min/max cards for any JSON, key=value or CSV line the device prints.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={historyLen}
            onChange={(e) => handleHistoryLen(Number(e.target.value))}
            aria-label="History length"
            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300"
          >
            {HISTORY_OPTIONS.map((n) => <option key={n} value={n}>{n} samples</option>)}
          </select>
          <button
            onClick={handleExportCsv}
            disabled={!hasData}
            title="Export every sample received as CSV"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>CSV</span>
          </button>
          <button
            onClick={handleResetStats}
            title="Reset min/max peak statistics"
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>RESET STATS</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-4">
        {/* Visual 1: Artificial Horizon / Attitude Gyro */}
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex flex-col items-center justify-between">
          <div className="w-full flex items-center justify-between border-b border-slate-800/80 pb-2 mb-3">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-cyan-400" />
              ATTITUDE HORIZON // 3D GYRO
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-cyan-400">PITCH: <strong>{fmt(currentPitch, hasPitch)}</strong></span>
              <span className="text-amber-400">ROLL: <strong>{fmt(currentRoll, hasRoll)}</strong></span>
            </div>
          </div>

          {/* SVG Artificial Horizon Display */}
          <div className="relative w-48 h-48 rounded-full border-4 border-slate-800 overflow-hidden bg-slate-950 shadow-inner">
            {/* Horizon Disc (Rotates with Roll, Translates with Pitch) */}
            <svg 
              className="absolute inset-0 w-full h-full"
              viewBox="0 0 200 200"
              style={{
                transform: `rotate(${-currentRoll}deg)`,
                transition: 'transform 0.1s linear'
              }}
            >
              <g style={{ transform: `translateY(${currentPitch * 1.8}px)` }}>
                {/* Sky (Cyan/Blue Gradient) */}
                <rect x="0" y="-100" width="200" height="200" fill="url(#skyGradient)" />
                {/* Ground (Amber/Brown Gradient) */}
                <rect x="0" y="100" width="200" height="200" fill="url(#groundGradient)" />
                {/* Horizon Line */}
                <line x1="0" y1="100" x2="200" y2="100" stroke="#00f3ff" strokeWidth="3" />

                {/* Pitch Ladder Marks */}
                {[-20, -10, 10, 20].map(deg => {
                  const y = 100 - deg * 1.8;
                  const width = deg % 20 === 0 ? 50 : 30;
                  return (
                    <g key={deg}>
                      <line 
                        x1={100 - width / 2} 
                        y1={y} 
                        x2={100 + width / 2} 
                        y2={y} 
                        stroke="#ffffff" 
                        strokeWidth="1.5" 
                        opacity="0.8" 
                      />
                      <text 
                        x={100 + width / 2 + 5} 
                        y={y + 3} 
                        fill="#ffffff" 
                        fontSize="8" 
                        fontFamily="monospace"
                        opacity="0.7"
                      >
                        {Math.abs(deg)}
                      </text>
                    </g>
                  );
                })}
              </g>

              {/* Definitions */}
              <defs>
                <linearGradient id="skyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#082f49" />
                  <stop offset="100%" stopColor="#0284c7" />
                </linearGradient>
                <linearGradient id="groundGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#78350f" />
                  <stop offset="100%" stopColor="#451a03" />
                </linearGradient>
              </defs>
            </svg>

            {/* Static Aircraft Reticle (Center Reference) */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-16 h-0.5 bg-amber-400 relative">
                <div className="absolute left-1/2 -top-1.5 -translate-x-1/2 w-3 h-3 border-2 border-amber-400 rounded-full" />
              </div>
            </div>
          </div>

          <div className="w-full text-center text-[10px] text-slate-500 pt-3">
            {hasPitch || hasRoll
              ? <>Bound to channels <code className="text-cyan-400">pitch</code> and <code className="text-amber-400">roll</code></>
              : <>Waiting for channels named <code className="text-cyan-400">pitch</code> and <code className="text-amber-400">roll</code></>}
          </div>
        </div>

        {/* Visual 2: Circular Speedometer / Dial Gauge */}
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex flex-col items-center justify-between">
          <div className="w-full flex items-center justify-between border-b border-slate-800/80 pb-2 mb-2">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Gauge className="w-4 h-4 text-cyan-400" />
              CIRCULAR SPEEDOMETER
            </span>
            <select
              value={activeGaugeChannel}
              onChange={e => setActiveGaugeChannel(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-cyber-cyan font-bold text-[11px]"
            >
              {!hasData && <option value="">NO DATA</option>}
              {channelKeys.map(k => (
                <option key={k} value={k}>{labelOf(k).toUpperCase()}</option>
              ))}
            </select>
          </div>

          {/* SVG Dial Gauge */}
          <div className="relative w-48 h-44 flex items-center justify-center">
            <svg className="w-48 h-48 -rotate-90" viewBox="0 0 160 160">
              {/* Background Arc */}
              <circle
                cx="80"
                cy="80"
                r="60"
                fill="none"
                stroke="#1e293b"
                strokeWidth="12"
                strokeDasharray="282.7"
                strokeDashoffset="70.6"
                strokeLinecap="round"
              />
              {/* Active Value Arc */}
              <circle
                cx="80"
                cy="80"
                r="60"
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth="12"
                strokeDasharray="282.7"
                strokeDashoffset={282.7 - (normalized * 212.1)}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.15s ease-out' }}
              />
              <defs>
                <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="60%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
            </svg>

            {/* Needle Pivot */}
            <div 
              className="absolute w-1 h-20 bg-cyber-cyan origin-bottom rounded-full shadow-cyan-glow"
              style={{
                top: '20px',
                transform: `rotate(${needleAngle}deg)`,
                transition: 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            >
              <div className="w-3 h-3 rounded-full bg-cyan-300 absolute -bottom-1 -left-1 shadow-lg" />
            </div>

            {/* Digital Readout Center Badge */}
            <div className="absolute bottom-2 flex flex-col items-center">
              <span className="text-xl font-extrabold text-white font-mono tracking-tight">
                {hasData ? activeChannelData.value : '--'}
              </span>
              <span className="text-[10px] text-cyan-400 font-bold uppercase">
                {hasData ? `${labelOf(activeGaugeChannel)} ${unitOf(activeGaugeChannel)}` : 'waiting for data'}
              </span>
            </div>
          </div>

          <div className="w-full flex items-center justify-between text-[10px] text-slate-500 pt-1">
            <span>MIN: <strong className="text-slate-300">{hasData ? activeChannelData.min : '--'}</strong></span>
            <span>MAX: <strong className="text-slate-300">{hasData ? activeChannelData.max : '--'}</strong></span>
          </div>
        </div>

        {/* Visual 3: Live Metric Cards Grid */}
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-emerald-400" />
              LIVE TELEMETRY FEEDS ({channelKeys.length})
            </span>
            <span className="text-[10px] text-slate-500">FORMAT: JSON / CSV / K-V</span>
          </div>

          {!hasData ? (
            <div className="text-center text-slate-600 py-6 text-[11px]">
              Waiting for data. Print lines such as <code>temp=24.5 rpm=3200</code>, a JSON object, or <code>$TAG,1,2,3</code> over serial.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {channelKeys.map((name) => {
                const data = telemetryData[name];
                const cfg = channelConfig[name] || {};
                return (
                  <div
                    key={name}
                    onClick={() => setActiveGaugeChannel(name)}
                    className={`p-2 rounded-lg border cursor-pointer transition-all ${
                      activeGaugeChannel === name
                        ? 'bg-slate-800 border-cyan-500/60 shadow-cyan-glow/20'
                        : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] text-slate-400 uppercase font-bold">
                      <span>{labelOf(name)}</span>
                      <span className="text-slate-500">{cfg.unit || ''}</span>
                    </div>
                    <div className="text-base font-extrabold text-slate-100 font-mono mt-0.5">
                      {data.value}
                    </div>
                    <Sparkline history={data.history} />
                    <div className="flex items-center justify-between text-[9px] text-slate-500 mt-1">
                      <span>↓ {data.min}</span>
                      <span>↑ {data.max}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 mt-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        value={cfg.label || ''}
                        onChange={(e) => updateConfig(name, { label: e.target.value })}
                        placeholder="name"
                        aria-label={`Name for ${name}`}
                        className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 min-w-0"
                      />
                      <input
                        value={cfg.unit || ''}
                        onChange={(e) => updateConfig(name, { unit: e.target.value })}
                        placeholder="unit"
                        aria-label={`Unit for ${name}`}
                        className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 min-w-0"
                      />
                      <input
                        type="number"
                        value={Number.isFinite(cfg.min) ? cfg.min : ''}
                        onChange={(e) => updateConfig(name, { min: e.target.value === '' ? undefined : Number(e.target.value) })}
                        placeholder="gauge min"
                        aria-label={`Gauge minimum for ${name}`}
                        className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 min-w-0"
                      />
                      <input
                        type="number"
                        value={Number.isFinite(cfg.max) ? cfg.max : ''}
                        onChange={(e) => updateConfig(name, { max: e.target.value === '' ? undefined : Number(e.target.value) })}
                        placeholder="gauge max"
                        aria-label={`Gauge maximum for ${name}`}
                        className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-[10px] text-slate-300 min-w-0"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
