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
  BarChart2,
  Code,
  Copy,
  Check,
  X
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
  const [showSketchModal, setShowSketchModal] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState('arduino');
  const [copiedCode, setCopiedCode] = useState(false);

  const canvasRef = useRef(null);
  const lastProcessedTextRef = useRef('');

  // Parse numbers or key-value pairs from text line
  const parseLineTelemetry = useCallback((line) => {
    if (!line || typeof line !== 'string') return null;
    const clean = line.trim();
    if (!clean || clean.length < 1) return null;

    // Ignore known bootloader logs or text commands
    if (
      clean.startsWith('rst:') || 
      clean.startsWith('boot:') || 
      clean.startsWith('=>') || 
      clean.startsWith('Hit any key') ||
      clean.startsWith('[SYS]') ||
      clean.startsWith('[WiFi]') ||
      clean.startsWith('starting')
    ) {
      return null;
    }

    // Check key:value pattern e.g. "temp:24.5 hum:62.1"
    const kvRegex = /([a-zA-Z0-9_\-]+)\s*[:=]\s*([+-]?\d+(?:\.\d+)?)/g;
    const kvMatches = [...clean.matchAll(kvRegex)];
    if (kvMatches.length > 0) {
      // Must cover a significant portion of the line to avoid false positives
      const matchedLength = kvMatches.reduce((acc, m) => acc + m[0].length, 0);
      if (matchedLength >= clean.length * 0.4) {
        const labels = kvMatches.map(m => m[1]);
        const values = kvMatches.map(m => parseFloat(m[2]));
        return { labels, values };
      }
    }

    // Check strictly formatted numeric lines e.g. "12.4, 45.1, -8.0" or "100 200 150"
    if (/^[\s,;\t+-0-9.]+$/.test(clean)) {
      const numRegex = /[+-]?(?:\d+\.\d+|\d+)/g;
      const numbers = clean.match(numRegex);
      if (numbers && numbers.length > 0) {
        const values = numbers.map(n => parseFloat(n)).filter(n => !isNaN(n));
        if (values.length > 0) {
          const labels = values.map((_, idx) => `CH ${idx}`);
          return { labels, values };
        }
      }
    }

    return null;
  }, []);

  // Ingest stream changes (splits multi-line chunks to preserve high sampling rates)
  useEffect(() => {
    if (isPaused || !latestTextStream) return;
    if (latestTextStream === lastProcessedTextRef.current) return;
    lastProcessedTextRef.current = latestTextStream;

    const lines = latestTextStream.split(/\r?\n/);
    const newPoints = [];
    let updatedLabels = null;

    for (const line of lines) {
      const parsed = parseLineTelemetry(line);
      if (parsed && parsed.values.length > 0) {
        if (!updatedLabels || parsed.labels.length > updatedLabels.length) {
          updatedLabels = parsed.labels;
        }
        newPoints.push({
          time: Date.now(),
          values: parsed.values,
          labels: parsed.labels
        });
      }
    }

    if (newPoints.length === 0) return;

    if (updatedLabels && updatedLabels.length > channelLabels.length) {
      setChannelLabels(updatedLabels);
    }

    setDataPoints(prev => {
      return [...prev.slice(-(windowSize * 2)), ...newPoints];
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
            onClick={() => setShowSketchModal(true)}
            className="flex items-center gap-1 text-[11px] bg-slate-900 hover:bg-slate-800 text-cyber-cyan px-2.5 py-1 rounded-lg border border-slate-800 transition-colors"
          >
            <Code className="w-3.5 h-3.5 text-cyber-cyan" />
            <span>Firmware Sketches</span>
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
