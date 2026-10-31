import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Play, 
  Square, 
  ZoomIn, 
  ZoomOut, 
  Sliders, 
  Layers, 
  Sparkles, 
  RefreshCw, 
  Download, 
  CheckCircle2, 
  AlertTriangle,
  Move,
  CornerDownRight
} from 'lucide-react';
import { 
  SAMPLE_RATES, 
  generateSyntheticSignalBuffer, 
  decodeUart, 
  decodeI2C 
} from '../../utils/logicAnalyzerDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

const CHANNEL_DEFAULTS = [
  { id: 0, name: 'D0: SCL', color: '#22d3ee' },
  { id: 1, name: 'D1: SDA', color: '#38bdf8' },
  { id: 2, name: 'D2: UART TX', color: '#fbbf24' },
  { id: 3, name: 'D3: UART RX', color: '#f59e0b' },
  { id: 4, name: 'D4: SPI CS', color: '#34d399' },
  { id: 5, name: 'D5: SPI MOSI', color: '#10b981' },
  { id: 6, name: 'D6: SPI MISO', color: '#a855f7' },
  { id: 7, name: 'D7: GPIO INT', color: '#f43f5e' }
];

export default function LogicAnalyzerWorkbench() {
  const [sampleRate, setSampleRate] = useState(4000000); // 4 MHz
  const [sampleDepth, setSampleDepth] = useState(25000);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isSimulated, setIsSimulated] = useState(true);

  // Digital Sample Buffer (Uint8Array: each byte is 8 channels)
  const [samples, setSamples] = useState(() => generateSyntheticSignalBuffer(25000, 4000000));
  const [channels, setChannels] = useState(CHANNEL_DEFAULTS);

  // Decoded protocol packets
  const [decodedI2C, setDecodedI2C] = useState([]);
  const [decodedUart, setDecodedUart] = useState([]);

  // Zoom & Viewport Offset
  const [zoomLevel, setZoomLevel] = useState(1); // 1 = normal, higher = zoomed in
  const [viewOffset, setViewOffset] = useState(0); // Sample start index

  // Cursors (A and B) for timeline measurement
  const [cursorA, setCursorA] = useState(400); // Sample index
  const [cursorB, setCursorB] = useState(1200); // Sample index

  const canvasRef = useRef(null);

  // Run protocol decoders on sample change
  useEffect(() => {
    if (!samples || samples.length === 0) return;
    const i2cPackets = decodeI2C(samples, 0, 1);
    const uartPackets = decodeUart(samples, 2, 115200, sampleRate);
    setDecodedI2C(i2cPackets);
    setDecodedUart(uartPackets);
  }, [samples, sampleRate]);

  // Canvas Drawing Routine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    // Background
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    const channelHeight = 45;
    const topMargin = 30;

    for (let c = 0; c < 8; c++) {
      const y = topMargin + (c * channelHeight);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    if (!samples || samples.length === 0) return;

    // Visible sample count
    const visibleSamples = Math.max(100, Math.floor(width / zoomLevel));
    const samplesPerPixel = visibleSamples / width;

    // Draw Waveforms for 8 channels
    for (let ch = 0; ch < 8; ch++) {
      const bitMask = 1 << ch;
      const baseLineY = topMargin + (ch * channelHeight) + 35;
      const highLineY = baseLineY - 24;

      ctx.strokeStyle = channels[ch].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();

      let lastLevel = null;
      for (let x = 0; x < width; x++) {
        const sampleIdx = Math.floor(viewOffset + (x * samplesPerPixel));
        if (sampleIdx >= samples.length) break;

        const isHigh = (samples[sampleIdx] & bitMask) !== 0;
        const curY = isHigh ? highLineY : baseLineY;

        if (x === 0) {
          ctx.moveTo(x, curY);
        } else {
          if (lastLevel !== isHigh) {
            ctx.lineTo(x, lastLevel ? highLineY : baseLineY); // vertical transition
            ctx.lineTo(x, curY);
          } else {
            ctx.lineTo(x, curY);
          }
        }
        lastLevel = isHigh;
      }
      ctx.stroke();
    }

    // Draw Cursors A & B
    const drawCursor = (sampleIdx, color, label) => {
      const x = (sampleIdx - viewOffset) / samplesPerPixel;
      if (x >= 0 && x <= width) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 2]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = color;
        ctx.fillRect(x - 12, 5, 24, 16);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, 16);
      }
    };

    drawCursor(cursorA, '#22d3ee', 'A');
    drawCursor(cursorB, '#fbbf24', 'B');

  }, [samples, zoomLevel, viewOffset, channels, cursorA, cursorB]);

  // Delta Time & Frequency Calculation
  const deltaSamples = Math.abs(cursorB - cursorA);
  const deltaSeconds = deltaSamples / sampleRate;
  const deltaMicroseconds = deltaSeconds * 1000000;
  const frequencyHz = deltaSeconds > 0 ? 1 / deltaSeconds : 0;

  // New synthetic capture
  const handleCaptureSimulation = () => {
    setIsCapturing(true);
    setTimeout(() => {
      const newBuf = generateSyntheticSignalBuffer(sampleDepth, sampleRate);
      setSamples(newBuf);
      setIsCapturing(false);
    }, 400);
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      <DemoBanner demoOnly>No capture hardware is supported yet. Waveforms and protocol decodes below are generated, not sampled.</DemoBanner>
      {/* Logic Analyzer Header Card */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>24MHz 8-CHANNEL LOGIC ANALYZER & PROTOCOL DECODER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Capture 8 digital channels (D0–D7) up to 24MS/s over WebUSB (Saleae / FX2LP clone) with live timeline measurements and I2C/UART/SPI decoders.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCaptureSimulation}
              disabled={isCapturing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs shadow-cyan-glow transition-all active:scale-95 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isCapturing ? 'CAPTURING...' : 'CAPTURE SIGNAL'}</span>
            </button>
          </div>
        </div>

        {/* Sampler Controls Toolbar */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Sample Rate */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">RATE:</span>
              <select
                value={sampleRate}
                onChange={(e) => setSampleRate(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-cyan-300 font-bold outline-none"
              >
                {SAMPLE_RATES.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>

            {/* Depth */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">SAMPLES:</span>
              <select
                value={sampleDepth}
                onChange={(e) => setSampleDepth(Number(e.target.value))}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 font-bold outline-none"
              >
                {[10000, 25000, 50000, 100000].map(s => (
                  <option key={s} value={s}>{(s / 1000).toFixed(0)}k Samples</option>
                ))}
              </select>
            </div>
          </div>

          {/* Zoom and Cursor Telemetry */}
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setZoomLevel(prev => Math.max(0.5, prev - 0.5))}
                className="p-1 rounded text-slate-400 hover:text-slate-200"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="px-2 font-bold text-slate-300">{zoomLevel}x</span>
              <button
                onClick={() => setZoomLevel(prev => Math.min(10, prev + 0.5))}
                className="p-1 rounded text-slate-400 hover:text-slate-200"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Delta Cursors Readout */}
            <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 text-[11px] text-slate-300 flex items-center gap-3">
              <span>ΔT: <strong className="text-cyan-400">{deltaMicroseconds.toFixed(2)} µs</strong></span>
              <span>Freq: <strong className="text-amber-400">{(frequencyHz / 1000).toFixed(1)} kHz</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Waveform Viewport Canvas */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-slate-400 pb-1 border-b border-slate-800">
          <span className="font-bold text-slate-200">DIGITAL CHANNELS (D0 - D7)</span>
          <span className="text-[10px] text-slate-500">Pan slider below adjusts sample window</span>
        </div>

        <div className="relative overflow-hidden rounded-lg border border-slate-850">
          <canvas
            ref={canvasRef}
            width={1200}
            height={390}
            className="w-full h-[390px] block cursor-crosshair"
          />

          {/* Channel Name Pills (Overlaid on left) */}
          <div className="absolute left-2 top-[34px] space-y-[21px] pointer-events-none select-none">
            {channels.map((ch) => (
              <div
                key={ch.id}
                className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-950/90 border border-slate-800 text-slate-300 shadow"
                style={{ color: ch.color }}
              >
                {ch.name}
              </div>
            ))}
          </div>
        </div>

        {/* Viewport Pan Slider */}
        <div className="flex items-center gap-2 pt-1 text-xs">
          <span className="text-[10px] text-slate-500 font-bold">TIMELINE PAN:</span>
          <input
            type="range"
            min="0"
            max={Math.max(0, samples.length - 1000)}
            step="100"
            value={viewOffset}
            onChange={(e) => setViewOffset(Number(e.target.value))}
            className="flex-1 accent-cyan-500 cursor-pointer"
          />
        </div>
      </div>

      {/* Protocol Decoder Results Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* I2C Decoded Packets */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-3.5 shadow-xl flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>I2C PROTOCOL DECODER (D0 SCL / D1 SDA)</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-400 font-bold">
              {decodedI2C.filter(p => p.type === 'DATA').length} Bytes
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-h-36 overflow-y-auto p-1 text-xs">
            {decodedI2C.map((pkt, idx) => (
              <span
                key={idx}
                className={`px-2 py-1 rounded font-bold text-[11px] ${
                  pkt.type === 'START' 
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' 
                    : pkt.type === 'STOP' 
                    ? 'bg-rose-950 text-rose-400 border border-rose-500/40' 
                    : 'bg-slate-900 text-cyan-300 border border-slate-800'
                }`}
              >
                {pkt.type === 'DATA' ? `0x${(pkt.byte ?? 0).toString(16).toUpperCase().padStart(2, '0')} (${pkt.ack ? 'ACK' : 'NACK'})` : pkt.type}
              </span>
            ))}
          </div>
        </div>

        {/* UART Decoded Characters */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-3.5 shadow-xl flex flex-col gap-2.5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-amber-400" />
              <span>UART SERIAL DECODER (D2 TX @ 115200 8N1)</span>
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950 text-amber-400 font-bold">
              {decodedUart.length} Chars
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 max-h-36 overflow-y-auto p-1 text-xs">
            {decodedUart.map((pkt, idx) => (
              <span
                key={idx}
                className="px-2 py-1 rounded font-bold text-[11px] bg-slate-900 text-amber-300 border border-slate-800"
              >
                '{pkt.char}' (0x{(pkt.byte ?? 0).toString(16).toUpperCase()})
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
