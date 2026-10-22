import React, { useState, useEffect, useRef } from 'react';
import { 
  Gauge, 
  Activity, 
  Compass, 
  RotateCcw, 
  Play, 
  Square, 
  TrendingUp, 
  Sliders, 
  Cpu, 
  Layers, 
  Zap
} from 'lucide-react';

export default function TelemetryDashboard({
  latestTextStream = '',
  isConnected = false,
  boards = [],
  activeBoardId = 'board-1',
  onSelectBoard
}) {
  // Parsed Telemetry Channels: { [key: string]: { value: number, min: number, max: number, history: number[], unit: string } }
  const [telemetryData, setTelemetryData] = useState({
    pitch: { value: 0, min: -15, max: 25, history: [0], unit: '°' },
    roll: { value: 0, min: -30, max: 30, history: [0], unit: '°' },
    temp: { value: 24.5, min: 20, max: 35, history: [24.5], unit: '°C' },
    volts: { value: 12.1, min: 11.5, max: 12.6, history: [12.1], unit: 'V' },
    rpm: { value: 2400, min: 0, max: 6000, history: [2400], unit: 'RPM' },
    altitude: { value: 145, min: 100, max: 200, history: [145], unit: 'm' }
  });

  const [activeGaugeChannel, setActiveGaugeChannel] = useState('rpm');
  const [demoSimActive, setDemoSimActive] = useState(false);
  const [streamFormat, setStreamFormat] = useState('auto'); // auto, json, csv, kv
  const lastParsedTextRef = useRef('');
  const demoIntervalRef = useRef(null);

  // Helper to ingest and update telemetry channels
  const updateChannelValues = (newValues) => {
    setTelemetryData(prev => {
      const next = { ...prev };
      Object.entries(newValues).forEach(([key, val]) => {
        const num = Number(val);
        if (isNaN(num)) return;

        const cleanKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!cleanKey) return;

        if (!next[cleanKey]) {
          next[cleanKey] = {
            value: num,
            min: num,
            max: num,
            history: [num],
            unit: cleanKey.includes('temp') ? '°C' : cleanKey.includes('volt') ? 'V' : cleanKey.includes('rpm') ? 'RPM' : cleanKey.includes('alt') ? 'm' : ''
          };
        } else {
          const current = next[cleanKey];
          next[cleanKey] = {
            ...current,
            value: num,
            min: Math.min(current.min, num),
            max: Math.max(current.max, num),
            history: [...current.history.slice(-19), num]
          };
        }
      });
      return next;
    });
  };

  // Parse incoming text stream
  useEffect(() => {
    if (!latestTextStream || latestTextStream === lastParsedTextRef.current) return;
    const newText = latestTextStream.slice(lastParsedTextRef.current.length);
    lastParsedTextRef.current = latestTextStream;

    const lines = newText.split(/[\r\n]+/).filter(l => l.trim().length > 0);
    lines.forEach(line => {
      const trimmed = line.trim();

      // 1. Try JSON parsing: {"temp": 24.5, "rpm": 3200}
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          updateChannelValues(parsed);
          return;
        } catch {
          // not valid json
        }
      }

      // 2. Try Key-Value: temp=24.5, rpm=3200 or temp:24.5 rpm:3200
      if (trimmed.includes('=') || trimmed.includes(':')) {
        const kvPairs = trimmed.match(/([a-zA-Z0-9_]+)[=:]\s*([+-]?\d+(?:\.\d+)?)/g);
        if (kvPairs && kvPairs.length > 0) {
          const extracted = {};
          kvPairs.forEach(pair => {
            const [k, v] = pair.split(/[=:]/);
            if (k && v) extracted[k.trim()] = parseFloat(v.trim());
          });
          updateChannelValues(extracted);
          return;
        }
      }

      // 3. Try CSV / Telemetry sentence: $DATA,12.5,-4.2,24.5,12.1,2400
      if (trimmed.startsWith('$') || trimmed.includes(',')) {
        const parts = trimmed.replace(/^\$[A-Z0-9_]+,/, '').split(',');
        const nums = parts.map(p => parseFloat(p.trim())).filter(n => !isNaN(n));
        if (nums.length >= 2) {
          const extracted = {};
          const standardKeys = ['pitch', 'roll', 'temp', 'volts', 'rpm', 'altitude'];
          nums.forEach((val, idx) => {
            const key = standardKeys[idx] || `ch_${idx + 1}`;
            extracted[key] = val;
          });
          updateChannelValues(extracted);
        }
      }
    });
  }, [latestTextStream]);

  // Demo Telemetry Generator
  useEffect(() => {
    if (!demoSimActive) {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
      return;
    }

    let t = 0;
    demoIntervalRef.current = setInterval(() => {
      t += 0.1;
      updateChannelValues({
        pitch: +(Math.sin(t * 0.8) * 18).toFixed(1),
        roll: +(Math.cos(t * 0.5) * 28).toFixed(1),
        temp: +(25 + Math.sin(t * 0.2) * 4).toFixed(1),
        volts: +(12.2 + (Math.random() - 0.5) * 0.2).toFixed(2),
        rpm: Math.round(2600 + Math.sin(t) * 1400 + Math.random() * 80),
        altitude: Math.round(150 + Math.sin(t * 0.3) * 35)
      });
    }, 100);

    return () => {
      if (demoIntervalRef.current) clearInterval(demoIntervalRef.current);
    };
  }, [demoSimActive]);

  const handleResetStats = () => {
    setTelemetryData(prev => {
      const reset = {};
      Object.entries(prev).forEach(([k, v]) => {
        reset[k] = { ...v, min: v.value, max: v.value, history: [v.value] };
      });
      return reset;
    });
  };

  const activeChannelData = telemetryData[activeGaugeChannel] || {
    value: 0,
    min: 0,
    max: 100,
    unit: ''
  };

  // Radial Gauge Calculations
  const gaugeMin = activeChannelData.min !== activeChannelData.max ? activeChannelData.min : 0;
  const gaugeMax = activeChannelData.min !== activeChannelData.max ? activeChannelData.max : 100;
  const range = gaugeMax - gaugeMin || 1;
  const clampedVal = Math.min(Math.max(activeChannelData.value, gaugeMin), gaugeMax);
  const normalized = (clampedVal - gaugeMin) / range;
  // Arc from -135deg to +135deg (total 270deg)
  const needleAngle = -135 + normalized * 270;

  // Attitude Gyro values
  const currentPitch = telemetryData.pitch?.value || 0;
  const currentRoll = telemetryData.roll?.value || 0;

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
              Real-time circular speedometers, pitch/roll artificial horizon, and min/max metric cards.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setDemoSimActive(!demoSimActive)}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all border ${
              demoSimActive 
                ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50 shadow-amber-glow' 
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
            }`}
          >
            {demoSimActive ? <Square className="w-3.5 h-3.5 text-cyber-amber" /> : <Play className="w-3.5 h-3.5 text-cyber-emerald" />}
            {demoSimActive ? 'STOP SIMULATION' : 'DEMO SIMULATION'}
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Visual 1: Artificial Horizon / Attitude Gyro */}
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 flex flex-col items-center justify-between">
          <div className="w-full flex items-center justify-between border-b border-slate-800/80 pb-2 mb-3">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Compass className="w-4 h-4 text-cyan-400" />
              ATTITUDE HORIZON // 3D GYRO
            </span>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-cyan-400">PITCH: <strong>{currentPitch.toFixed(1)}°</strong></span>
              <span className="text-amber-400">ROLL: <strong>{currentRoll.toFixed(1)}°</strong></span>
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
            Coordinates bind to channels: <code className="text-cyan-400">pitch</code> and <code className="text-amber-400">roll</code>
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
              {Object.keys(telemetryData).map(k => (
                <option key={k} value={k}>{k.toUpperCase()}</option>
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
                {activeChannelData.value}
              </span>
              <span className="text-[10px] text-cyan-400 font-bold uppercase">
                {activeGaugeChannel} {activeChannelData.unit}
              </span>
            </div>
          </div>

          <div className="w-full flex items-center justify-between text-[10px] text-slate-500 pt-1">
            <span>MIN: <strong className="text-slate-300">{activeChannelData.min}</strong></span>
            <span>MAX: <strong className="text-slate-300">{activeChannelData.max}</strong></span>
          </div>
        </div>

        {/* Visual 3: Live Metric Cards Grid */}
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-emerald-400" />
              LIVE TELEMETRY FEEDS ({Object.keys(telemetryData).length})
            </span>
            <span className="text-[10px] text-slate-500">FORMAT: JSON / CSV / K-V</span>
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
            {Object.entries(telemetryData).map(([name, data]) => (
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
                  <span>{name}</span>
                  <span className="text-slate-500">{data.unit}</span>
                </div>
                <div className="text-base font-extrabold text-slate-100 font-mono mt-0.5">
                  {data.value}
                </div>
                <div className="flex items-center justify-between text-[9px] text-slate-500 mt-1">
                  <span>↓ {data.min}</span>
                  <span>↑ {data.max}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
