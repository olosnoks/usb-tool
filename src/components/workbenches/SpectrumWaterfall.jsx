import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  Play, 
  Pause, 
  RotateCcw, 
  Sliders, 
  Layers, 
  Radio, 
  Info,
  Maximize2
} from 'lucide-react';

const CHANNELS_24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const CHANNELS_5G = [
  36, 40, 44, 48, 52, 56, 60, 64, 
  100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 
  149, 153, 157, 161, 165
];
const ALL_CHANNELS = [...CHANNELS_24, ...CHANNELS_5G];

/**
 * Colormap for waterfall density mapping.
 * Returns an RGB string based on packet density (0 to max).
 */
function getWaterfallColor(count, maxVal = 10) {
  if (!count || count <= 0) return 'rgb(7, 11, 20)'; // Base dark background
  const ratio = Math.min(1.0, count / Math.max(1, maxVal));

  if (ratio < 0.15) {
    // Deep Blue -> Cyan
    const t = ratio / 0.15;
    const r = Math.round(30 * (1 - t) + 6 * t);
    const g = Math.round(58 * (1 - t) + 182 * t);
    const b = Math.round(138 * (1 - t) + 212 * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (ratio < 0.45) {
    // Cyan -> Emerald Green
    const t = (ratio - 0.15) / 0.30;
    const r = Math.round(6 * (1 - t) + 16 * t);
    const g = Math.round(182 * (1 - t) + 185 * t);
    const b = Math.round(212 * (1 - t) + 129 * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else if (ratio < 0.75) {
    // Emerald Green -> Amber / Orange
    const t = (ratio - 0.45) / 0.30;
    const r = Math.round(16 * (1 - t) + 245 * t);
    const g = Math.round(185 * (1 - t) + 158 * t);
    const b = Math.round(129 * (1 - t) + 11 * t);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    // Orange -> Crimson Red / White
    const t = (ratio - 0.75) / 0.25;
    const r = Math.round(245 * (1 - t) + 255 * t);
    const g = Math.round(158 * (1 - t) + 68 * t);
    const b = Math.round(11 * (1 - t) + 68 * t);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

/**
 * Real-Time Spectrum Waterfall Component
 * Displays a rolling spectrogram of RF channel packet density over time.
 * - Y-axis: Channels (2.4 GHz and 5 GHz)
 * - X-axis: Time (scrolling right to left)
 * - Heatmap Color: Packet count / RF density
 */
export default function SpectrumWaterfall({
  latestSlice = {}, // { channel: count, ... } from high-frequency sampler
  currentChannel = 6,
  isMonitoring = false
}) {
  const [bandFilter, setBandFilter] = useState('all'); // 'all' | '2.4' | '5'
  const [isPaused, setIsPaused] = useState(false);
  const [maxDensity, setMaxDensity] = useState(12); // Dynamic scale ceiling

  const canvasRef = useRef(null);
  const historyRef = useRef([]); // Array of time slices, each is { [ch]: count }
  const MAX_HISTORY_COLS = 200; // Total time columns rendered

  // Selected channel list based on active band filter
  const activeChannels = useMemo(() => {
    if (bandFilter === '2.4') return CHANNELS_24;
    if (bandFilter === '5') return CHANNELS_5G;
    return ALL_CHANNELS;
  }, [bandFilter]);

  // Append new high-frequency slice to history buffer
  useEffect(() => {
    if (isPaused) return;

    const slice = { ...latestSlice };
    historyRef.current.push(slice);
    if (historyRef.current.length > MAX_HISTORY_COLS) {
      historyRef.current.shift();
    }
  }, [latestSlice, isPaused]);

  // Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) return; // Headless / test environment fallback

    let animationId = null;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      if (!width || !height) return;

      const history = historyRef.current;
      const numCols = MAX_HISTORY_COLS;
      const numChannels = activeChannels.length;
      if (numChannels === 0) return;

      const labelGutter = 54; // Left margin for channel labels
      const timeGutter = 24;  // Bottom margin for time labels
      const effWidth = Math.max(10, width - labelGutter);
      const effHeight = Math.max(10, height - timeGutter);

      // 1. Clear background
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, width, height);

      // 2. Draw Y-axis Channel background & gridlines
      const rowHeight = effHeight / numChannels;

      for (let i = 0; i < numChannels; i++) {
        const ch = activeChannels[i];
        const y = i * rowHeight;
        const isCurCh = ch === currentChannel;

        // Channel gutter label
        ctx.fillStyle = isCurCh ? '#06b6d4' : '#64748b';
        ctx.font = isCurCh ? 'bold 10px monospace' : '10px monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`CH ${ch}`, labelGutter - 8, y + rowHeight / 2);

        // Subtle horizontal channel divider
        ctx.strokeStyle = isCurCh ? 'rgba(6, 182, 212, 0.3)' : 'rgba(30, 41, 59, 0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(labelGutter, y + rowHeight);
        ctx.lineTo(width, y + rowHeight);
        ctx.stroke();
      }

      // 3. Draw Waterfall Spectrogram Columns (scrolling right to left)
      const colWidth = effWidth / numCols;
      const historyLen = history.length;

      for (let c = 0; c < historyLen; c++) {
        const slice = history[c];
        // Right-aligned: newest slice at c === historyLen - 1 appears at right edge
        const x = labelGutter + effWidth - ((historyLen - c) * colWidth);
        if (x < labelGutter) continue;

        for (let r = 0; r < numChannels; r++) {
          const ch = activeChannels[r];
          const count = slice[ch] || 0;
          const y = r * rowHeight;

          ctx.fillStyle = getWaterfallColor(count, maxDensity);
          ctx.fillRect(x, y, Math.ceil(colWidth), Math.ceil(rowHeight));
        }
      }

      // 4. Draw Time Axis at Bottom
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, effHeight, width, timeGutter);
      ctx.strokeStyle = '#1e293b';
      ctx.beginPath();
      ctx.moveTo(0, effHeight);
      ctx.lineTo(width, effHeight);
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const timeY = effHeight + timeGutter / 2;
      ctx.fillText('-20s', labelGutter + 10, timeY);
      ctx.fillText('-15s', labelGutter + effWidth * 0.25, timeY);
      ctx.fillText('-10s', labelGutter + effWidth * 0.50, timeY);
      ctx.fillText('-5s', labelGutter + effWidth * 0.75, timeY);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#22d3ee';
      ctx.fillText('0s (Now)', width - 6, timeY);

      animationId = requestAnimationFrame(render);
    };

    animationId = requestAnimationFrame(render);

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [activeChannels, currentChannel, maxDensity]);

  // Handle Resize of HTML5 Canvas
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas || !canvas.parentElement) return;
      canvas.width = canvas.parentElement.clientWidth || 800;
      canvas.height = canvas.parentElement.clientHeight || 450;
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Clear waterfall history
  const handleClear = () => {
    historyRef.current = [];
  };

  return (
    <div className="flex flex-col h-full bg-slate-900/60 rounded-xl border border-slate-800 overflow-hidden shadow-2xl">
      {/* Top Controls Toolbar */}
      <div className="p-3 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-cyan-400 font-semibold tracking-wider uppercase font-mono">
            <Activity className="w-4 h-4 text-cyan-400 animate-pulse" />
            <span>Spectrum Waterfall</span>
          </div>

          {/* Band Selector */}
          <div className="flex bg-slate-950 rounded-lg p-0.5 border border-slate-800 font-mono text-[11px]">
            <button
              onClick={() => setBandFilter('all')}
              className={`px-2.5 py-1 rounded transition ${
                bandFilter === 'all' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Channels ({ALL_CHANNELS.length})
            </button>
            <button
              onClick={() => setBandFilter('2.4')}
              className={`px-2.5 py-1 rounded transition ${
                bandFilter === '2.4' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              2.4 GHz (1-14)
            </button>
            <button
              onClick={() => setBandFilter('5')}
              className={`px-2.5 py-1 rounded transition ${
                bandFilter === '5' ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              5 GHz UNII
            </button>
          </div>
        </div>

        {/* Playback Controls & Legend */}
        <div className="flex items-center gap-3 font-mono">
          {/* Colormap Legend */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 px-2.5 py-1 rounded border border-slate-800 text-[10px]">
            <span className="text-slate-400">Density:</span>
            <span className="w-2.5 h-2.5 rounded-sm bg-[#1e3a8a]" title="Low"></span>
            <span className="w-2.5 h-2.5 rounded-sm bg-[#06b6d4]" title="Moderate"></span>
            <span className="w-2.5 h-2.5 rounded-sm bg-[#10b981]" title="Active"></span>
            <span className="w-2.5 h-2.5 rounded-sm bg-[#f59e0b]" title="High"></span>
            <span className="w-2.5 h-2.5 rounded-sm bg-[#ef4444]" title="Congested / Jammed"></span>
            <span className="text-slate-400 ml-1">High</span>
          </div>

          {/* Pause / Resume */}
          <button
            onClick={() => setIsPaused(p => !p)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold border transition ${
              isPaused 
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30' 
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
            <span>{isPaused ? 'Resume' : 'Freeze'}</span>
          </button>

          {/* Clear */}
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Clear spectrogram history"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Main Waterfall Canvas Area */}
      <div className="relative flex-1 w-full min-h-[420px] bg-[#070b14] overflow-hidden">
        <canvas
          ref={canvasRef}
          width={900}
          height={480}
          className="w-full h-full block"
        />

        {/* Fallback Vector Indicator if no canvas context (SSR / Test Environments) */}
        {typeof window !== 'undefined' && canvasRef.current && !canvasRef.current.getContext && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs">
            Canvas context not supported.
          </div>
        )}
      </div>

      {/* Footer Info Strip */}
      <div className="px-3 py-2 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <Info className="w-3.5 h-3.5 text-slate-500" />
          <span>Real-time channel packet density spectrogram. Scrolling right (newest) to left (historical).</span>
        </div>
        <div className="flex items-center gap-3">
          <span>Tuned CH: <span className="text-cyan-400 font-bold">CH {currentChannel}</span></span>
          <span>Sampling: <span className="text-emerald-400 font-bold">100ms</span></span>
        </div>
      </div>
    </div>
  );
}
