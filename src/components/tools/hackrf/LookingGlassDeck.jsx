import React, { useState, useEffect, useRef } from 'react';
import { DemoBanner } from '../../common/DemoNotice';
import { 
  Scan, 
  Activity, 
  ArrowUpRight, 
  Play, 
  Square, 
  Sliders, 
  Flame, 
  Zap, 
  RefreshCw,
  Layers
} from 'lucide-react';

const SWEEP_PRESETS = [
  { name: 'HF Broadcast & Ham (1-30 MHz)', startHz: 1000000, endHz: 30000000, stepHz: 100000 },
  { name: 'FM Broadcast (88-108 MHz)', startHz: 88000000, endHz: 108000000, stepHz: 200000 },
  { name: 'VHF Air & Marine (108-162 MHz)', startHz: 108000000, endHz: 162000000, stepHz: 250000 },
  { name: 'UHF Ham & LMR (400-470 MHz)', startHz: 400000000, endHz: 470000000, stepHz: 500000 },
  { name: 'ISM & LoRa (860-930 MHz)', startHz: 860000000, endHz: 930000000, stepHz: 500000 },
  { name: 'ADS-B & GPS (1080-1600 MHz)', startHz: 1080000000, endHz: 1600000000, stepHz: 1000000 },
  { name: '2.4 GHz ISM / Wi-Fi (2400-2500 MHz)', startHz: 2400000000, endHz: 2500000000, stepHz: 1000000 }
];

export default function LookingGlassDeck({ driver, centerFreq, sampleRate, onTuneFreq, isDemo = true }) {
  const [selectedPreset, setSelectedPreset] = useState(SWEEP_PRESETS[1]);
  const [isSweeping, setIsSweeping] = useState(true);
  const [thresholdDb, setThresholdDb] = useState(-65);
  const canvasRef = useRef(null);

  // Peak emitters detected above threshold
  const [peaks, setPeaks] = useState(() => (isDemo ? [
    { id: 1, freqHz: 91100000, powerDb: -42, bwKhz: 180, type: 'WFM Broadcast', count: 124 },
    { id: 2, freqHz: 96500000, powerDb: -38, bwKhz: 200, type: 'WFM Broadcast', count: 210 },
    { id: 3, freqHz: 101300000, powerDb: -49, bwKhz: 190, type: 'WFM Broadcast', count: 86 },
    { id: 4, freqHz: 104500000, powerDb: -55, bwKhz: 180, type: 'WFM Broadcast', count: 42 }
  ] : []));

  // Drop the demo's sample peaks once real hardware is connected.
  useEffect(() => { if (!isDemo) setPeaks([]); }, [isDemo]);

  // Spectrum canvas: the REAL HackRF IQ FFT when it is streaming. The synthetic
  // sweep is drawn only in demo mode; on hardware with no data yet it waits.
  useEffect(() => {
    let animId;
    let sweepOffset = 0;
    let lastPeakUpdate = 0;

    // Map a dBFS value to a canvas Y (0 dBFS top, -90 dBFS bottom).
    const dbfsToY = (db, h) => {
      const frac = (0 - db) / 90;
      return Math.max(6, Math.min(h - 4, frac * h));
    };

    const render = () => {
      const cvs = canvasRef.current;
      if (!cvs) return;
      const ctx = cvs.getContext('2d');
      const w = cvs.width;
      const h = cvs.height;

      const spec = driver && driver.latestSpectrum;
      const live = !!(spec && spec.length);

      ctx.fillStyle = '#060813';
      ctx.fillRect(0, 0, w, h);

      // Grid lines + dB labels
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.font = '9px monospace';
      for (let y = 30; y < h; y += 30) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillStyle = '#475569';
        const dbVal = live ? -Math.round((y / h) * 90) : (-20 - Math.round((y / h) * 80));
        ctx.fillText(`${dbVal} dB${live ? 'FS' : ''}`, 6, y - 2);
      }

      // Threshold reference line
      const threshY = live ? dbfsToY(thresholdDb, h) : Math.round(((-20 - thresholdDb) / 80) * h);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, threshY);
      ctx.lineTo(w, threshY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ef4444';
      ctx.fillText(`TRIGGER ${thresholdDb} dB`, w - 110, threshY - 4);

      ctx.beginPath();
      if (live) {
        // Real spectrum: one bin per FFT output, spanning the IQ bandwidth.
        const N = spec.length;
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * w;
          const y = dbfsToY(spec[i], h);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      } else if (!isDemo) {
        ctx.fillStyle = '#64748b';
        ctx.font = '12px monospace';
        ctx.fillText('Waiting for spectrum data from the HackRF…', 16, h / 2);
        ctx.moveTo(0, h);
      } else {
        const numBins = 160;
        for (let i = 0; i < numBins; i++) {
          const x = (i / numBins) * w;
          let noise = Math.sin(i * 0.1 + sweepOffset) * 4 + (Math.random() * 6 - 3);
          let signalDb = -78 + noise;
          if (Math.abs(i - 30) < 3) signalDb += 36;
          if (Math.abs(i - 75) < 4) signalDb += 40;
          if (Math.abs(i - 110) < 3) signalDb += 28;
          if (Math.abs(i - 135) < 3) signalDb += 24;
          const y = Math.max(10, Math.min(h - 10, ((-20 - signalDb) / 80) * h));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
      }

      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(168, 85, 247, 0.4)');
      grad.addColorStop(0.5, 'rgba(6, 182, 212, 0.2)');
      grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = live ? '#22d3ee' : '#a855f7';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Real peak detection from the live spectrum (throttled)
      if (live && performance.now() - lastPeakUpdate > 250) {
        lastPeakUpdate = performance.now();
        const N = spec.length;
        const sr = sampleRate || 2000000;
        let sum = 0;
        for (let i = 0; i < N; i++) sum += spec[i];
        const avg = sum / N;
        const found = [];
        for (let i = 2; i < N - 2; i++) {
          if (spec[i] > thresholdDb && spec[i] > avg + 8 && spec[i] >= spec[i - 1] && spec[i] > spec[i + 1]) {
            const freqHz = Math.round((centerFreq || 0) + ((i - N / 2) / N) * sr);
            found.push({ id: i, freqHz, powerDb: Math.round(spec[i]), bwKhz: Math.max(1, Math.round(sr / N / 1000)), type: 'Live Peak', count: 1 });
            if (found.length >= 12) break;
          }
        }
        setPeaks(found);
      }

      sweepOffset += 0.05;
      if (isSweeping) animId = requestAnimationFrame(render);
    };

    render();
    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isSweeping, thresholdDb, selectedPreset, driver, centerFreq, sampleRate, isDemo]);

  return (
    <div className="space-y-4 font-mono text-xs">
      {isDemo && <DemoBanner>The sweep and peaks are synthetic until a real PortaPack is connected.</DemoBanner>}
      {/* Top Banner */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 bg-purple-500/20 border border-purple-500/40 rounded-lg text-purple-300">
            <Scan className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <div className="font-bold text-slate-200 flex items-center gap-2">
              <span>LOOKING GLASS (WIDEBAND SPECTRUM SWEEP)</span>
              <span className="text-[10px] px-2 py-0.5 bg-purple-950/80 border border-purple-500/30 text-purple-300 rounded font-normal">
                RocketGod 1 MHz - 6 GHz Sweep Engine
              </span>
            </div>
            <span className="text-[10px] text-slate-400">
              Stepped fast synthesizer sweeping & automated RF peak energy detector
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSweeping(!isSweeping)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow ${
              isSweeping
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-600/30'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
            }`}
          >
            {isSweeping ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {isSweeping ? 'PAUSE SWEEP' : 'START SWEEP'}
          </button>
        </div>
      </div>

      {/* Preset Bands Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-800">
        <span className="text-slate-500 text-[10px] uppercase font-bold mr-1">SWEEP BANDS:</span>
        {SWEEP_PRESETS.map(preset => {
          const isActive = selectedPreset.name === preset.name;
          return (
            <button
              key={preset.name}
              onClick={() => setSelectedPreset(preset)}
              className={`px-2.5 py-1 rounded text-xs transition whitespace-nowrap ${
                isActive
                  ? 'bg-purple-600/30 border border-purple-500/50 text-purple-200 font-bold'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {preset.name}
            </button>
          );
        })}
      </div>

      {/* Real-Time Wideband Stitched Sweep Spectrum Canvas */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-400">
          <div className="flex items-center gap-2">
            <span className="text-purple-300 font-bold">{selectedPreset.name}</span>
            <span className="text-slate-500">
              Span: {(selectedPreset.startHz / 1e6).toFixed(1)} - {(selectedPreset.endHz / 1e6).toFixed(1)} MHz
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span>DETECTION THRESHOLD:</span>
            <input
              type="range"
              min="-85"
              max="-30"
              value={thresholdDb}
              onChange={(e) => setThresholdDb(parseInt(e.target.value))}
              className="w-24 accent-rose-500"
            />
            <span className="text-rose-400 font-bold w-12 text-right">{thresholdDb} dB</span>
          </div>
        </div>

        <div className="relative border border-slate-800 rounded overflow-hidden shadow-inner">
          <canvas
            ref={canvasRef}
            width={720}
            height={180}
            className="w-full h-44 block"
          />
        </div>
      </div>

      {/* Peak Energy Emitters Detected Table */}
      <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-2">
        <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800">
          <span className="font-bold text-slate-200">
            DETECTED RF PEAKS ABOVE NOISE FLOOR ({peaks.length} EMITTERS)
          </span>
          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
            Auto-Energy Squelch Active
          </span>
        </div>

        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {peaks.map(p => (
            <div
              key={p.id}
              className="p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-purple-500/30 transition flex items-center justify-between gap-3 text-xs"
            >
              <div className="flex items-center gap-3">
                <span className="font-bold text-purple-300 text-sm">
                  {(p.freqHz / 1e6).toFixed(4)} MHz
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-slate-800 rounded text-cyan-300 font-semibold">
                  {p.type}
                </span>
              </div>

              <div className="flex items-center gap-4 text-[11px] text-slate-400">
                <span>Power: <strong className="text-white">{p.powerDb} dBFS</strong></span>
                <span>Bandwidth: <strong className="text-slate-300">{p.bwKhz} kHz</strong></span>
                <span>Hits: {p.count}</span>
              </div>

              <button
                onClick={() => onTuneFreq(p.freqHz)}
                className="px-3 py-1 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded text-xs transition flex items-center gap-1 shadow"
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                Tune & Listen
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
