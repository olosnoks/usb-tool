import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { 
  Activity, 
  Play, 
  Pause, 
  Trash2, 
  Download, 
  Eye, 
  EyeOff, 
  Maximize2, 
  Sliders, 
  Sparkles,
  BarChart2
} from 'lucide-react';

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

export default function SerialPlotter({
  latestTextStream = '',
  isConnected
}) {
  const [dataPoints, setDataPoints] = useState([]); // Array of { time, values: [val1, val2...], labels: [] }
  const [channelLabels, setChannelLabels] = useState(['CH 0', 'CH 1', 'CH 2']);
  const [visibleChannels, setVisibleChannels] = useState({});
  const [windowSize, setWindowSize] = useState(150); // 50, 100, 150, 300, 500
  const [isPaused, setIsPaused] = useState(false);
  const [autoScale, setAutoScale] = useState(true);
  const [customMinY, setCustomMinY] = useState(-50);
  const [customMaxY, setCustomMaxY] = useState(150);

  const canvasRef = useRef(null);
  const lastProcessedTextRef = useRef('');

  // Parse numbers or key-value pairs from text line
  const parseLineTelemetry = useCallback((line) => {
    if (!line || typeof line !== 'string') return null;
    const clean = line.trim();
    if (!clean || clean.length < 1) return null;

    // Check key:value pattern e.g. "temp:24.5 hum:62.1"
    const kvRegex = /([a-zA-Z0-9_\-]+)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/g;
    const kvMatches = [...clean.matchAll(kvRegex)];
    if (kvMatches.length > 0) {
      const labels = kvMatches.map(m => m[1]);
      const values = kvMatches.map(m => parseFloat(m[2]));
      return { labels, values };
    }

    // Check CSV, space, or tab separated numbers e.g. "12.4, 45.1, -8.0"
    const numRegex = /[+-]?(?:\d+\.\d+|\d+)/g;
    const numbers = clean.match(numRegex);
    if (numbers && numbers.length > 0) {
      const values = numbers.map(n => parseFloat(n)).filter(n => !isNaN(n));
      if (values.length > 0) {
        const labels = values.map((_, idx) => `CH ${idx}`);
        return { labels, values };
      }
    }

    return null;
  }, []);

  // Ingest stream changes
  useEffect(() => {
    if (isPaused || !latestTextStream) return;
    if (latestTextStream === lastProcessedTextRef.current) return;
    lastProcessedTextRef.current = latestTextStream;

    const parsed = parseLineTelemetry(latestTextStream);
    if (!parsed) return;

    // Update labels if new
    if (parsed.labels.length > channelLabels.length) {
      setChannelLabels(parsed.labels);
    }

    setDataPoints(prev => {
      const updated = [...prev.slice(-(windowSize * 2)), {
        time: Date.now(),
        values: parsed.values,
        labels: parsed.labels
      }];
      return updated;
    });
  }, [latestTextStream, isPaused, windowSize, parseLineTelemetry, channelLabels.length]);

  // Canvas drawing loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Handle high DPI
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // Background
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    // Grid Lines & Scanlines
    ctx.strokeStyle = '#0e1726';
    ctx.lineWidth = 1;
    const gridCols = 8;
    const gridRows = 6;
    for (let c = 0; c <= gridCols; c++) {
      const x = (width / gridCols) * c;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let r = 0; r <= gridRows; r++) {
      const y = (height / gridRows) * r;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (dataPoints.length === 0) {
      // Empty watermark
      ctx.fillStyle = '#334155';
      ctx.font = '12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('WAITING FOR NUMERIC SERIAL TELEMETRY...', width / 2, height / 2 - 10);
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#1e293b';
      ctx.fillText('Format: "24.5, 45.2, 100" or "temp:25.4 volt:3.3"', width / 2, height / 2 + 12);
      return;
    }

    // Determine Min & Max Y
    const activeSlice = dataPoints.slice(-windowSize);
    let minY = Infinity;
    let maxY = -Infinity;

    if (autoScale) {
      activeSlice.forEach(dp => {
        dp.values.forEach((v, idx) => {
          if (visibleChannels[idx] !== false) {
            if (v < minY) minY = v;
            if (v > maxY) maxY = v;
          }
        });
      });
      if (minY === Infinity) minY = 0;
      if (maxY === -Infinity) maxY = 100;
      // Pad by 10%
      const span = maxY - minY || 1;
      minY = minY - span * 0.1;
      maxY = maxY + span * 0.1;
    } else {
      minY = customMinY;
      maxY = customMaxY;
    }

    const yRange = maxY - minY || 1;

    // Draw Zero Axis Line if 0 is within bounds
    if (minY < 0 && maxY > 0) {
      const zeroY = height - ((0 - minY) / yRange) * height;
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(width, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw Waveforms for each channel
    const maxChannels = Math.max(...activeSlice.map(dp => dp.values.length), 1);

    for (let ch = 0; ch < maxChannels; ch++) {
      if (visibleChannels[ch] === false) continue;

      const color = CHANNEL_COLORS[ch % CHANNEL_COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;

      ctx.beginPath();
      let started = false;

      activeSlice.forEach((dp, i) => {
        const val = dp.values[ch];
        if (val === undefined || isNaN(val)) return;

        const x = (width / (windowSize - 1)) * (windowSize - activeSlice.length + i);
        const y = height - ((val - minY) / yRange) * height;

        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
      ctx.shadowBlur = 0; // reset
    }

    // Axis Labels
    ctx.fillStyle = '#64748b';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Max: ${maxY.toFixed(1)}`, 8, 14);
    ctx.fillText(`Min: ${minY.toFixed(1)}`, 8, height - 6);

  }, [dataPoints, windowSize, visibleChannels, autoScale, customMinY, customMaxY]);

  // Statistics calculation for telemetry card
  const channelStats = useMemo(() => {
    if (dataPoints.length === 0) return [];
    const slice = dataPoints.slice(-windowSize);
    const maxChannels = Math.max(...slice.map(dp => dp.values.length), 0);

    const stats = [];
    for (let ch = 0; ch < maxChannels; ch++) {
      const vals = slice.map(dp => dp.values[ch]).filter(v => v !== undefined && !isNaN(v));
      if (vals.length === 0) continue;

      const current = vals[vals.length - 1];
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const label = channelLabels[ch] || `CH ${ch}`;

      stats.push({
        ch,
        label,
        current: Number(current.toFixed(2)),
        min: Number(min.toFixed(2)),
        max: Number(max.toFixed(2)),
        avg: Number(avg.toFixed(2)),
        color: CHANNEL_COLORS[ch % CHANNEL_COLORS.length]
      });
    }
    return stats;
  }, [dataPoints, windowSize, channelLabels]);

  const toggleChannelVisibility = (ch) => {
    setVisibleChannels(prev => ({ ...prev, [ch]: prev[ch] === false ? true : false }));
  };

  const handleExportCSV = () => {
    if (dataPoints.length === 0) return;
    const header = ['Timestamp', ...channelLabels].join(',');
    const rows = dataPoints.map(dp => [
      new Date(dp.time).toISOString(),
      ...dp.values
    ].join(','));
    const csv = [header, ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `serial-plot-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Generate synthetic sine/cosine test data
  const injectDemoWaveform = () => {
    const now = Date.now();
    const demo = [];
    for (let i = 0; i < 100; i++) {
      const t = i * 0.1;
      const sine = Math.sin(t) * 50 + 20;
      const cosine = Math.cos(t) * 30 + 10;
      const noise = Math.random() * 8 + 5;
      demo.push({
        time: now + i * 20,
        values: [Number(sine.toFixed(1)), Number(cosine.toFixed(1)), Number(noise.toFixed(1))],
        labels: ['Sine', 'Cosine', 'Noise']
      });
    }
    setChannelLabels(['Sine Wave', 'Cosine Wave', 'Analog Noise']);
    setDataPoints(demo);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">REAL-TIME SERIAL OSCILLOSCOPE & PLOTTER</h2>
        </div>

        {/* Top Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={injectDemoWaveform}
            className="flex items-center gap-1 text-[11px] bg-slate-900 hover:bg-slate-800 text-cyber-amber px-2.5 py-1 rounded-lg border border-slate-800"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Generate Test Waveform</span>
          </button>

          {/* Window Size Selector */}
          <select
            value={windowSize}
            onChange={(e) => setWindowSize(Number(e.target.value))}
            className="bg-slate-950 border border-slate-800 text-[11px] text-slate-300 rounded px-2 py-1 outline-none cursor-pointer"
          >
            <option value={50}>50 Samples</option>
            <option value={100}>100 Samples</option>
            <option value={150}>150 Samples</option>
            <option value={300}>300 Samples</option>
            <option value={500}>500 Samples</option>
          </select>

          {/* Pause / Resume */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume Waveform" : "Pause Waveform"}
            className={`p-1.5 rounded border transition-colors ${
              isPaused ? 'bg-amber-500/20 text-cyber-amber border-amber-500/40 animate-pulse' : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 text-cyber-amber" /> : <Pause className="w-3.5 h-3.5" />}
          </button>

          {/* Export CSV */}
          <button
            onClick={handleExportCSV}
            title="Export CSV Dataset"
            className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Clear Plot */}
          <button
            onClick={() => setDataPoints([])}
            title="Clear Waveform Data"
            className="p-1.5 rounded bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="relative w-full h-64 bg-[#030712] rounded-xl border border-slate-800 overflow-hidden shadow-inner">
        <canvas
          ref={canvasRef}
          className="w-full h-full block"
        />
      </div>

      {/* Live Channel Telemetry Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
        {channelStats.length === 0 ? (
          <div className="col-span-full text-center text-slate-600 py-2 text-[11px]">
            No active numeric channels detected. Stream numbers like <code>25.4, 102.1</code> over serial to plot live waveforms.
          </div>
        ) : (
          channelStats.map((st) => (
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
                  className="text-slate-500 hover:text-slate-300"
                >
                  {visibleChannels[st.ch] === false ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              <div className="text-lg font-bold text-slate-100 my-1">
                {st.current}
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-900">
                <span>Min: <strong className="text-slate-400">{st.min}</strong></span>
                <span>Avg: <strong className="text-slate-400">{st.avg}</strong></span>
                <span>Max: <strong className="text-slate-400">{st.max}</strong></span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
