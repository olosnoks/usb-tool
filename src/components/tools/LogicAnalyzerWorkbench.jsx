import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  Play,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  Sparkles,
  Download,
  AlertTriangle,
  Usb,
  Upload,
  Unplug,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FileUp
} from 'lucide-react';
import { SAMPLE_RATES, SumpAnalyzer, Fx2LogicAnalyzer } from '../../utils/logicAnalyzerDriver';
import {
  DECODERS,
  i2cTransactions,
  estimateBaud,
  findTrigger,
  measureChannel,
  exportVcd,
  importVcdFile,
  exportSigrok,
  importSigrok
} from '../../utils/logicDecoders';
import { demoCapture } from '../../utils/logicSynth';
import { SerialLink } from '../../utils/serialLink';
import { parseIntelHex } from '../../utils/firmwareParser';
import { DemoBanner } from '../common/DemoNotice';

import { useSessionError } from '../../utils/sessionLog';
const CHANNEL_DEFAULTS = [
  { id: 0, name: 'D0', color: '#22d3ee' },
  { id: 1, name: 'D1', color: '#38bdf8' },
  { id: 2, name: 'D2', color: '#fbbf24' },
  { id: 3, name: 'D3', color: '#f59e0b' },
  { id: 4, name: 'D4', color: '#34d399' },
  { id: 5, name: 'D5', color: '#10b981' },
  { id: 6, name: 'D6', color: '#a855f7' },
  { id: 7, name: 'D7', color: '#f43f5e' }
];

const KIND_COLORS = { data: '#0e7490', control: '#047857', error: '#be123c' };
const CHANNEL_HEIGHT = 45;
const TOP_MARGIN = 30;
const ANNOTATION_Y = TOP_MARGIN + 8 * CHANNEL_HEIGHT + 4;
const CANVAS_HEIGHT = ANNOTATION_Y + 26;

const fmtTime = (seconds) => {
  const a = Math.abs(seconds);
  if (a >= 1) return `${seconds.toFixed(3)} s`;
  if (a >= 1e-3) return `${(seconds * 1e3).toFixed(3)} ms`;
  if (a >= 1e-6) return `${(seconds * 1e6).toFixed(2)} µs`;
  return `${(seconds * 1e9).toFixed(0)} ns`;
};
const fmtHz = (hz) => (hz >= 1e6 ? `${(hz / 1e6).toFixed(3)} MHz` : hz >= 1e3 ? `${(hz / 1e3).toFixed(2)} kHz` : `${hz.toFixed(1)} Hz`);

const PARAM_CHOICES = {
  parity: ['none', 'even', 'odd', 'mark', 'space'],
  dataBits: [5, 6, 7, 8, 9],
  stopBits: [1, 1.5, 2],
  mode: [0, 1, 2, 3],
  wordSize: [8, 16, 32],
  order: ['GRB', 'RGB', 'BRG'],
  protocol: ['nec', 'rc5'],
  bitrate: [125000, 250000, 500000, 1000000]
};

const downloadBlob = (data, name, type = 'application/octet-stream') => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function LogicAnalyzerWorkbench() {
  const [sampleRate, setSampleRate] = useState(4000000); // 4 MHz
  const [sampleDepth, setSampleDepth] = useState(25000);
  const [isCapturing, setIsCapturing] = useState(false);
  // Where captures come from: null (nothing connected), 'sump', 'fx2', 'demo' or 'file'.
  const [source, setSource] = useState(null);
  const [deviceLabel, setDeviceLabel] = useState('');
  const [error, setError] = useSessionError('Logic Analyzer');
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState(0);
  const [triggerMask, setTriggerMask] = useState('00');
  const [triggerValue, setTriggerValue] = useState('00');
  const [captureRate, setCaptureRate] = useState(null); // rate the device actually used
  const sumpRef = useRef(null);
  const fx2Ref = useRef(null);
  const fwInputRef = useRef(null);
  const importRef = useRef(null);
  const isSimulated = source === 'demo';

  // Digital Sample Buffer (Uint8Array: each byte is 8 channels). Empty until a capture.
  const [samples, setSamples] = useState(() => new Uint8Array(0));
  const [channels, setChannels] = useState(CHANNEL_DEFAULTS);

  // Protocol decoder: which one, and each decoder's channel mapping and options.
  const [decoderId, setDecoderId] = useState('i2c');
  const [decoderConfig, setDecoderConfig] = useState(() => Object.fromEntries(
    Object.entries(DECODERS).map(([id, d]) => [id, { channels: { ...d.channels }, params: { ...d.params } }])
  ));

  // View: `zoom` 1 shows the whole capture; `viewOffset` is the first visible sample.
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewOffset, setViewOffset] = useState(0);
  const [cursorA, setCursorA] = useState(0);
  const [cursorB, setCursorB] = useState(0);

  // Software trigger search over the captured buffer.
  const [search, setSearch] = useState({ kind: 'rising', channel: 0, mask: '03', value: '01', maxWidth: 2 });

  const canvasRef = useRef(null);
  const rate = captureRate || sampleRate;
  const visibleSamples = Math.max(50, Math.floor(samples.length / zoomLevel) || 1200);

  const cfg = decoderConfig[decoderId];
  const decoded = useMemo(() => {
    if (!samples.length) return [];
    try {
      return DECODERS[decoderId].run(samples, cfg.channels, cfg.params, rate);
    } catch (e) {
      return [{ type: 'error', start: 0, end: 0, kind: 'error', label: e.message }];
    }
  }, [samples, decoderId, cfg, rate]);

  const measurements = useMemo(
    () => (samples.length ? channels.map((c) => measureChannel(samples, c.id, rate)) : []),
    [samples, channels, rate]
  );

  const updateDecoder = (part, key, value) => setDecoderConfig((prev) => ({
    ...prev,
    [decoderId]: { ...prev[decoderId], [part]: { ...prev[decoderId][part], [key]: value } }
  }));

  // Canvas Drawing Routine
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;
    for (let c = 0; c <= 8; c++) {
      const y = TOP_MARGIN + c * CHANNEL_HEIGHT;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    if (!samples.length) return;

    const samplesPerPixel = visibleSamples / width;
    const xOf = (sample) => (sample - viewOffset) / samplesPerPixel;

    // Waveforms: each pixel covers a range of samples, so draw a vertical
    // bar wherever a pixel holds both levels (keeps short pulses visible).
    for (let ch = 0; ch < 8; ch++) {
      const mask = 1 << ch;
      const low = TOP_MARGIN + ch * CHANNEL_HEIGHT + 35;
      const high = low - 24;
      ctx.strokeStyle = channels[ch].color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let last = null;
      for (let x = 0; x < width; x++) {
        const from = Math.floor(viewOffset + x * samplesPerPixel);
        if (from >= samples.length) break;
        const to = Math.min(samples.length, Math.max(from + 1, Math.floor(viewOffset + (x + 1) * samplesPerPixel)));
        let any1 = false;
        let any0 = false;
        for (let i = from; i < to && !(any1 && any0); i++) {
          if (samples[i] & mask) any1 = true; else any0 = true;
        }
        const endHigh = (samples[to - 1] & mask) !== 0;
        if (x === 0) ctx.moveTo(x, (samples[from] & mask) ? high : low);
        if (any1 && any0) {
          ctx.lineTo(x, last ? high : low);
          ctx.lineTo(x, high);
          ctx.lineTo(x, low);
          ctx.lineTo(x, endHigh ? high : low);
        } else {
          const y = any1 ? high : low;
          if (last !== null && last !== any1) ctx.lineTo(x, last ? high : low);
          ctx.lineTo(x, y);
        }
        last = endHigh;
      }
      ctx.stroke();
    }

    // Decoder annotations
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    for (const item of decoded) {
      const x0 = xOf(item.start);
      const x1 = Math.max(x0 + 2, xOf(item.end));
      if (x1 < 0 || x0 > width) continue;
      ctx.fillStyle = KIND_COLORS[item.kind] || KIND_COLORS.data;
      ctx.fillRect(x0, ANNOTATION_Y, x1 - x0, 20);
      const textW = ctx.measureText(item.label).width;
      if (textW < x1 - x0 - 4) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillText(item.label, (x0 + x1) / 2, ANNOTATION_Y + 14);
      }
    }

    const drawCursor = (sampleIdx, color, label) => {
      const x = xOf(sampleIdx);
      if (x < 0 || x > width) return;
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
      ctx.textAlign = 'center';
      ctx.fillText(label, x, 16);
    };
    drawCursor(cursorA, '#22d3ee', 'A');
    drawCursor(cursorB, '#fbbf24', 'B');
  }, [samples, visibleSamples, viewOffset, channels, cursorA, cursorB, decoded]);

  const deltaSeconds = Math.abs(cursorB - cursorA) / rate;
  const frequencyHz = deltaSeconds > 0 ? 1 / deltaSeconds : 0;

  const clampOffset = (o, vis = visibleSamples) => Math.max(0, Math.min(Math.max(0, samples.length - vis), Math.round(o)));
  const centerOn = (sample, vis = visibleSamples) => setViewOffset(clampOffset(sample - vis / 2, vis));
  const zoomBy = (factor) => {
    const maxZoom = Math.max(1, samples.length / 50);
    const next = Math.min(maxZoom, Math.max(1, zoomLevel * factor));
    const vis = Math.max(50, Math.floor(samples.length / next));
    const mid = viewOffset + visibleSamples / 2;
    setZoomLevel(next);
    setViewOffset(clampOffset(mid - vis / 2, vis));
  };

  // Left click places cursor A, shift-click cursor B.
  const handleCanvasClick = (e) => {
    if (!samples.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * e.currentTarget.width;
    const sample = Math.round(viewOffset + (x * visibleSamples) / e.currentTarget.width);
    if (e.shiftKey) setCursorB(sample); else setCursorA(sample);
  };

  const handleWheel = (e) => {
    if (!samples.length) return;
    e.preventDefault(); // keep the page (and Ctrl+wheel browser zoom) still
    if (e.ctrlKey || e.metaKey) zoomBy(e.deltaY < 0 ? 1.5 : 1 / 1.5);
    else setViewOffset((o) => clampOffset(o + (e.deltaY / 400) * visibleSamples));
  };
  // React registers wheel listeners as passive, so preventDefault needs a native one.
  const wheelRef = useRef(handleWheel);
  wheelRef.current = handleWheel;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (e) => wheelRef.current(e);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const jumpTo = (sample) => {
    setCursorA(sample);
    // Zoom in enough that the spot is readable, then center on it.
    if (visibleSamples > 4000 && samples.length > 4000) {
      const z = samples.length / 4000;
      setZoomLevel(z);
      centerOn(sample, 4000);
    } else centerOn(sample);
  };

  const runSearch = (direction) => {
    const from = cursorA || (direction > 0 ? 0 : samples.length);
    const hit = findTrigger(samples, {
      kind: search.kind,
      channel: Number(search.channel),
      mask: parseInt(search.mask, 16) || 0,
      value: parseInt(search.value, 16) || 0,
      maxWidth: Number(search.maxWidth) || 1,
      from,
      direction
    });
    if (hit < 0) setNotice(`No ${search.kind} found ${direction > 0 ? 'after' : 'before'} cursor A.`);
    else { setNotice(''); jumpTo(hit); }
  };

  const loadSamples = (buf, rateHz) => {
    setSamples(buf);
    setCaptureRate(rateHz);
    setZoomLevel(1);
    setViewOffset(0);
    setCursorA(0);
    setCursorB(Math.min(buf.length - 1, Math.round(buf.length / 10)));
  };

  const closeSources = async () => {
    if (sumpRef.current) {
      const { la, link } = sumpRef.current;
      sumpRef.current = null;
      await la.reset();
      await link.close();
    }
    if (fx2Ref.current) {
      const la = fx2Ref.current;
      fx2Ref.current = null;
      await la.close();
    }
  };

  const handleDisconnect = async () => {
    await closeSources();
    setSource(null);
    setDeviceLabel('');
    setSamples(new Uint8Array(0));
    setCaptureRate(null);
  };

  const handleConnectSump = async () => {
    setError(''); setNotice('');
    try {
      await closeSources();
      const owner = { name: 'Logic Analyzer', release: () => handleDisconnect() };
      const link = await SerialLink.request(owner, { baudRate: 115200 });
      const la = new SumpAnalyzer(link);
      try {
        const id = await la.identify();
        sumpRef.current = { la, link };
        setSource('sump');
        setDeviceLabel(`SUMP: ${id.name || 'device'}${id.probes ? ` · ${id.probes} ch` : ''}${id.maxSampleRate ? ` · max ${id.maxSampleRate / 1e6} MS/s` : ''}`);
        setSamples(new Uint8Array(0));
      } catch (e) {
        await link.close();
        throw e;
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleConnectFx2 = async () => {
    setError(''); setNotice('');
    try {
      await closeSources();
      const la = await Fx2LogicAnalyzer.request();
      await la.open();
      if (la.needsFirmware) {
        fx2Ref.current = la;
        setSource(null);
        setNotice('This board has no fx2lafw firmware loaded yet. Load the fx2lafw .fw file for it (sigrok-firmware-fx2lafw, e.g. fx2lafw-saleae-logic.fw).');
        return;
      }
      const fw = await la.start();
      fx2Ref.current = la;
      setSource('fx2');
      setDeviceLabel(`fx2lafw ${fw} · ${la.device.productName || 'FX2 analyzer'}`);
      setSamples(new Uint8Array(0));
    } catch (err) {
      setError(`${err.message}${/Access denied|claim/i.test(err.message) ? ' On Windows the board needs the WinUSB driver (install it with Zadig).' : ''}`);
    }
  };

  const handleFirmwareFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !fx2Ref.current) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const bytes = new Uint8Array(ev.target.result);
        const isHex = /\.(hex|ihx)$/i.test(file.name);
        const image = isHex ? parseIntelHex(new TextDecoder().decode(bytes)) : bytes;
        await fx2Ref.current.uploadFirmware(image);
        fx2Ref.current = null;
        setNotice('Firmware loaded. The board restarts as "fx2lafw": click CONNECT FX2 (USB) again and choose it.');
      } catch (err) {
        setError(`Firmware upload failed: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleCapture = async () => {
    setError('');
    setIsCapturing(true);
    setProgress(0);
    try {
      if (source === 'demo') {
        await new Promise((r) => setTimeout(r, 200));
        const d = demoCapture(decoderId);
        // Demo traffic is drawn on the decoder's default channels.
        setDecoderConfig((prev) => ({ ...prev, [decoderId]: { ...prev[decoderId], channels: { ...DECODERS[decoderId].channels } } }));
        loadSamples(d.samples, d.sampleRate);
      } else if (source === 'sump') {
        const mask = parseInt(triggerMask, 16) || 0;
        const value = parseInt(triggerValue, 16) || 0;
        const r = await sumpRef.current.la.capture({ sampleRate, samples: sampleDepth, triggerMask: mask, triggerValue: value });
        loadSamples(r.samples, r.sampleRate);
      } else if (source === 'fx2') {
        const r = await fx2Ref.current.capture({ sampleRate, samples: sampleDepth, onProgress: (p) => setProgress(Math.round(p * 100)) });
        loadSamples(r.samples, r.sampleRate);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsCapturing(false);
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = /\.vcd$/i.test(file.name)
        ? importVcdFile(new TextDecoder().decode(bytes))
        : await importSigrok(bytes);
      if (source !== 'sump' && source !== 'fx2') {
        setSource('file');
        setDeviceLabel(`File: ${file.name}`);
      }
      setChannels((prev) => prev.map((c, i) => ({ ...c, name: r.names?.[i] || c.name })));
      loadSamples(r.samples, r.sampleRate);
      setNotice(`Loaded ${r.samples.length.toLocaleString()} samples at ${fmtHz(r.sampleRate).replace('Hz', 'S/s')} from ${file.name}.`);
    } catch (err) {
      setError(`Could not read ${file.name}: ${err.message}`);
    }
  };

  const names = channels.map((c) => c.name);
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
  const exportVcdFile = () => downloadBlob(exportVcd(samples, rate, names), `capture-${stamp()}.vcd`, 'text/plain');
  const exportSrFile = async () => downloadBlob(await exportSigrok(samples, rate, names), `capture-${stamp()}.sr`);
  const exportDecodedCsv = () => {
    const rows = [['start_s', 'end_s', 'type', 'label']];
    for (const it of decoded) rows.push([(it.start / rate).toFixed(9), (it.end / rate).toFixed(9), it.type, `"${String(it.label).replace(/"/g, '""')}"`]);
    downloadBlob(rows.map((r) => r.join(',')).join('\n'), `${decoderId}-decode-${stamp()}.csv`, 'text/csv');
  };

  const guessBaud = () => {
    const g = estimateBaud(samples, Number(cfg.channels.rx), rate);
    if (!g) { setNotice('Not enough edges on that channel to guess a baud rate.'); return; }
    updateDecoder('params', 'baud', g.baud);
    setNotice(`Shortest pulses suggest ${g.raw} baud; using ${g.baud}.`);
  };

  useEffect(() => () => { closeSources(); }, []);

  const select = 'bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-cyan-300 font-bold outline-none text-[11px]';
  const btn = 'flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300 text-[11px] font-bold disabled:opacity-40';
  const errors = decoded.filter((d) => d.kind === 'error').length;

  return (
    <div className="flex flex-col gap-4 font-mono">
      {isSimulated && <DemoBanner>Demo capture: the waveforms and decodes below are generated, not sampled. Each decoder tab has its own demo traffic.</DemoBanner>}
      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 text-xs">
          <span>{notice}</span>
          {fx2Ref.current && source !== 'fx2' && (
            <button onClick={() => fwInputRef.current?.click()} className="flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/50 font-bold">
              <Upload className="w-3.5 h-3.5" /> LOAD FIRMWARE FILE
            </button>
          )}
        </div>
      )}
      <input ref={fwInputRef} type="file" accept=".fw,.bin,.hex,.ihx" className="hidden" onChange={handleFirmwareFile} />
      <input ref={importRef} type="file" accept=".vcd,.sr" className="hidden" onChange={handleImport} />

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span>24MHz 8-CHANNEL LOGIC ANALYZER & PROTOCOL DECODER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Capture 8 channels (D0–D7) from a SUMP device over serial or an FX2 "24MHz 8CH" board running fx2lafw over WebUSB, or open a VCD / PulseView .sr file.
              Decoders: I2C, UART, SPI, 1-Wire, CAN, WS2812, IR (NEC / RC-5) and SWD.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!source || source === 'file' ? (
              <>
                <button onClick={handleConnectSump} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-cyan-500/40 text-xs font-bold">
                  <Usb className="w-3.5 h-3.5" /> CONNECT SUMP (SERIAL)
                </button>
                <button onClick={handleConnectFx2} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-cyan-500/40 text-xs font-bold">
                  <Usb className="w-3.5 h-3.5" /> CONNECT FX2 (USB)
                </button>
                <button onClick={() => { setSource('demo'); setDeviceLabel('Demo signal generator'); setError(''); setNotice(''); }} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-amber-300 border border-amber-500/40 text-xs font-bold">
                  <Sparkles className="w-3.5 h-3.5" /> DEMO
                </button>
              </>
            ) : (
              <>
                <span className="text-[11px] text-emerald-300 font-bold">{deviceLabel}</span>
                <button onClick={handleDisconnect} className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
                  <Unplug className="w-3.5 h-3.5" /> DISCONNECT
                </button>
              </>
            )}
            <button onClick={() => importRef.current?.click()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-700 text-xs font-bold">
              <FileUp className="w-3.5 h-3.5" /> OPEN .VCD / .SR
            </button>
            <button
              onClick={handleCapture}
              disabled={isCapturing || !source || source === 'file'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs shadow-cyan-glow transition-all active:scale-95 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{isCapturing ? (progress ? `CAPTURING ${progress}%` : 'CAPTURING...') : 'CAPTURE SIGNAL'}</span>
            </button>
          </div>
        </div>

        <div className="pt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">RATE:</span>
              <select value={sampleRate} onChange={(e) => setSampleRate(Number(e.target.value))} className={select}>
                {SAMPLE_RATES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">SAMPLES:</span>
              <select value={sampleDepth} onChange={(e) => setSampleDepth(Number(e.target.value))} className={select}>
                {[1024, 4096, 10000, 25000, 50000, 100000, 250000, 1000000].map((s) => (
                  <option key={s} value={s}>{s < 10000 ? `${s}` : s < 1e6 ? `${(s / 1000).toFixed(0)}k` : `${s / 1e6}M`} Samples</option>
                ))}
              </select>
            </div>
            {source === 'sump' && (
              <div className="flex items-center gap-1.5" title="Hardware trigger: channels in the mask must match the value (hex). Mask 00 starts at once.">
                <span className="text-slate-500 font-bold text-[11px]">HW TRIGGER MASK:</span>
                <input value={triggerMask} onChange={(e) => setTriggerMask(e.target.value)} className="w-10 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
                <span className="text-slate-500 font-bold text-[11px]">VALUE:</span>
                <input value={triggerValue} onChange={(e) => setTriggerValue(e.target.value)} className="w-10 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
              </div>
            )}
            {captureRate && captureRate !== sampleRate && (
              <span className="text-[10px] text-amber-300">capture is {fmtHz(captureRate).replace('Hz', 'S/s')}</span>
            )}
            {source === 'sump' && <span className="text-[10px] text-slate-500">Small SUMP sketches hold only a few KB of samples; pick a depth the device supports.</span>}
            {source === 'fx2' && sampleRate >= 12000000 && <span className="text-[10px] text-amber-300">At 12 MS/s and above the browser may not keep up with USB, which leaves gaps.</span>}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button onClick={() => zoomBy(1 / 2)} className="p-1 rounded text-slate-400 hover:text-slate-200" title="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></button>
              <span className="px-2 font-bold text-slate-300">{zoomLevel < 10 ? zoomLevel.toFixed(1) : Math.round(zoomLevel)}x</span>
              <button onClick={() => zoomBy(2)} className="p-1 rounded text-slate-400 hover:text-slate-200" title="Zoom in"><ZoomIn className="w-3.5 h-3.5" /></button>
              <button onClick={() => { setZoomLevel(1); setViewOffset(0); }} className="p-1 rounded text-slate-400 hover:text-slate-200" title="Fit whole capture"><Maximize2 className="w-3.5 h-3.5" /></button>
            </div>
            <div className="bg-slate-950 px-3 py-1 rounded-lg border border-slate-800 text-[11px] text-slate-300 flex items-center gap-3">
              <span>ΔT: <strong className="text-cyan-400">{fmtTime(deltaSeconds)}</strong></span>
              <span>1/ΔT: <strong className="text-amber-400">{fmtHz(frequencyHz)}</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Waveform Viewport Canvas */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pb-1 border-b border-slate-800">
          <span className="font-bold text-slate-200">DIGITAL CHANNELS (D0 - D7)</span>
          <span className="text-[10px] text-slate-500">Click: cursor A · Shift-click: cursor B · Wheel: pan · Ctrl+wheel: zoom</span>
          <div className="flex items-center gap-1.5">
            <button onClick={exportVcdFile} disabled={!samples.length} className={btn}><Download className="w-3 h-3" /> VCD</button>
            <button onClick={exportSrFile} disabled={!samples.length} className={btn}><Download className="w-3 h-3" /> PULSEVIEW .SR</button>
          </div>
        </div>

        {/* Trigger search */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-slate-500 font-bold">FIND:</span>
          <select value={search.kind} onChange={(e) => setSearch({ ...search, kind: e.target.value })} className={select}>
            <option value="rising">rising edge</option>
            <option value="falling">falling edge</option>
            <option value="edge">any edge</option>
            <option value="pulse">glitch (short pulse)</option>
            <option value="pattern">pattern</option>
          </select>
          {search.kind === 'pattern' ? (
            <>
              <span className="text-slate-500">mask</span>
              <input value={search.mask} onChange={(e) => setSearch({ ...search, mask: e.target.value })} className="w-10 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
              <span className="text-slate-500">value</span>
              <input value={search.value} onChange={(e) => setSearch({ ...search, value: e.target.value })} className="w-10 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
            </>
          ) : (
            <select value={search.channel} onChange={(e) => setSearch({ ...search, channel: Number(e.target.value) })} className={select}>
              {channels.map((c) => <option key={c.id} value={c.id}>D{c.id} {c.name !== `D${c.id}` ? c.name : ''}</option>)}
            </select>
          )}
          {search.kind === 'pulse' && (
            <>
              <span className="text-slate-500">≤</span>
              <input type="number" min="1" value={search.maxWidth} onChange={(e) => setSearch({ ...search, maxWidth: e.target.value })} className="w-14 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
              <span className="text-slate-500">samples ({fmtTime((Number(search.maxWidth) || 1) / rate)})</span>
            </>
          )}
          <button onClick={() => runSearch(-1)} disabled={!samples.length} className={btn}><ChevronLeft className="w-3 h-3" /> PREV</button>
          <button onClick={() => runSearch(1)} disabled={!samples.length} className={btn}>NEXT <ChevronRight className="w-3 h-3" /></button>
          {samples.length > 0 && <span className="text-slate-500">A @ {fmtTime(cursorA / rate)} · B @ {fmtTime(cursorB / rate)}</span>}
        </div>

        <div className="relative overflow-hidden rounded-lg border border-slate-850">
          <canvas
            ref={canvasRef}
            width={1200}
            height={CANVAS_HEIGHT}
            onClick={handleCanvasClick}
            className="w-full block cursor-crosshair"
            style={{ height: CANVAS_HEIGHT }}
          />
          <div className="absolute left-2 top-[34px] space-y-[21px] pointer-events-none select-none">
            {channels.map((ch) => (
              <div key={ch.id} className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-950/90 border border-slate-800 shadow" style={{ color: ch.color }}>
                D{ch.id}{ch.name !== `D${ch.id}` ? `: ${ch.name}` : ''}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 text-xs">
          <span className="text-[10px] text-slate-500 font-bold">TIMELINE PAN:</span>
          <input
            type="range"
            min="0"
            max={Math.max(0, samples.length - visibleSamples)}
            step={Math.max(1, Math.floor(visibleSamples / 50))}
            value={viewOffset}
            onChange={(e) => setViewOffset(Number(e.target.value))}
            className="flex-1 accent-cyan-500 cursor-pointer"
          />
          {samples.length > 0 && <span className="text-[10px] text-slate-500">{fmtTime(viewOffset / rate)} – {fmtTime((viewOffset + visibleSamples) / rate)}</span>}
        </div>
      </div>

      {/* Protocol decoder */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-3.5 shadow-xl flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
          <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-cyan-400" /> PROTOCOL DECODER
          </span>
          <div className="flex flex-wrap gap-1">
            {Object.entries(DECODERS).map(([id, d]) => (
              <button
                key={id}
                onClick={() => setDecoderId(id)}
                className={`px-2 py-1 rounded text-[11px] font-bold border ${decoderId === id ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50' : 'bg-slate-900 text-slate-400 border-slate-800'}`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-[11px]">
          {Object.entries(cfg.channels).map(([role, ch]) => (
            <label key={role} className="flex items-center gap-1">
              <span className="text-slate-500 font-bold uppercase">{role}</span>
              <select value={ch} onChange={(e) => updateDecoder('channels', role, Number(e.target.value))} className={select}>
                {role === 'miso' || role === 'cs' ? <option value={-1}>none</option> : null}
                {channels.map((c) => <option key={c.id} value={c.id}>D{c.id}</option>)}
              </select>
            </label>
          ))}
          {Object.entries(cfg.params).map(([key, value]) => (
            <label key={key} className="flex items-center gap-1">
              <span className="text-slate-500 font-bold">{key}</span>
              {typeof value === 'boolean' ? (
                <input type="checkbox" checked={value} onChange={(e) => updateDecoder('params', key, e.target.checked)} className="accent-cyan-500" />
              ) : PARAM_CHOICES[key] ? (
                <select value={value} onChange={(e) => updateDecoder('params', key, typeof value === 'number' ? Number(e.target.value) : e.target.value)} className={select}>
                  {PARAM_CHOICES[key].map((o) => <option key={o} value={o}>{key === 'bitrate' ? `${o / 1000} kbit/s` : o}</option>)}
                </select>
              ) : (
                <input type="number" value={value} onChange={(e) => updateDecoder('params', key, Number(e.target.value))} className="w-24 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-cyan-300" />
              )}
            </label>
          ))}
          {decoderId === 'uart' && <button onClick={guessBaud} disabled={!samples.length} className={btn}>AUTO-BAUD</button>}
          <span className="ml-auto text-slate-500">{decoded.length} items{errors ? <span className="text-rose-400"> · {errors} errors</span> : null}</span>
          <button onClick={exportDecodedCsv} disabled={!decoded.length} className={btn}><Download className="w-3 h-3" /> CSV</button>
        </div>

        {decoderId === 'i2c' && decoded.length > 0 && (
          <div className="text-[11px] text-slate-300 bg-slate-950 border border-slate-800 rounded p-2 max-h-28 overflow-y-auto">
            {i2cTransactions(decoded).map((t, i) => (
              <div key={i} className={t.nacked ? 'text-rose-300' : ''}>
                {t.read ? 'READ ' : 'WRITE'} 0x{t.addr.toString(16).toUpperCase().padStart(2, '0')}{t.name ? ` (${t.name})` : ''}: {t.bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') || '-'}{!t.ack ? ' [address NACK]' : ''}
              </div>
            ))}
          </div>
        )}
        {decoderId === 'uart' && decoded.length > 0 && (
          <pre className="text-[11px] text-amber-200 bg-slate-950 border border-slate-800 rounded p-2 max-h-28 overflow-y-auto whitespace-pre-wrap break-all">
            {decoded.filter((d) => d.type === 'uart').map((d) => (d.byte === 10 || d.byte === 13 || d.byte === 9 || (d.byte >= 32 && d.byte < 127) ? String.fromCharCode(d.byte) : `\\x${d.byte.toString(16).padStart(2, '0')}`)).join('')}
          </pre>
        )}
        {decoderId === 'ws2812' && decoded.some((d) => d.type === 'led') && (
          <div className="flex flex-wrap gap-1 bg-slate-950 border border-slate-800 rounded p-2">
            {decoded.filter((d) => d.type === 'led').map((d, i) => (
              <span key={i} title={d.label} className="w-5 h-5 rounded border border-slate-700" style={{ background: `rgb(${d.r},${d.g},${d.b})` }} />
            ))}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto border border-slate-800 rounded">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-slate-900 text-slate-500">
              <tr><th className="text-left px-2 py-1">TIME</th><th className="text-left px-2 py-1">DURATION</th><th className="text-left px-2 py-1">TYPE</th><th className="text-left px-2 py-1">DECODED</th></tr>
            </thead>
            <tbody>
              {decoded.slice(0, 2000).map((it, i) => (
                <tr key={i} onClick={() => jumpTo(it.start)} className="cursor-pointer hover:bg-slate-900 border-t border-slate-900">
                  <td className="px-2 py-0.5 text-slate-400">{fmtTime(it.start / rate)}</td>
                  <td className="px-2 py-0.5 text-slate-500">{fmtTime((it.end - it.start) / rate)}</td>
                  <td className="px-2 py-0.5 text-slate-400">{it.type}</td>
                  <td className={`px-2 py-0.5 font-bold ${it.kind === 'error' ? 'text-rose-300' : it.kind === 'control' ? 'text-emerald-300' : 'text-cyan-200'}`}>{it.label}</td>
                </tr>
              ))}
              {!decoded.length && (
                <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-500">{samples.length ? 'Nothing decoded on these channels. Check the channel mapping and options.' : 'Capture or open a file to decode.'}</td></tr>
              )}
            </tbody>
          </table>
          {decoded.length > 2000 && <div className="text-[10px] text-slate-500 px-2 py-1">Showing the first 2000 of {decoded.length}; export CSV for all.</div>}
        </div>
      </div>

      {/* Channel measurements */}
      {samples.length > 0 && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-3.5 shadow-xl">
          <div className="font-bold text-xs text-slate-200 mb-2">CHANNEL MEASUREMENTS</div>
          <table className="w-full text-[11px]">
            <thead className="text-slate-500">
              <tr><th className="text-left px-2">CH</th><th className="text-left px-2">NAME</th><th className="text-left px-2">EDGES</th><th className="text-left px-2">FREQ</th><th className="text-left px-2">DUTY</th><th className="text-left px-2">MIN PULSE</th><th className="text-left px-2">MAX PULSE</th></tr>
            </thead>
            <tbody>
              {channels.map((c, i) => {
                const m = measurements[i];
                return (
                  <tr key={c.id} className="border-t border-slate-900">
                    <td className="px-2 py-0.5 font-bold" style={{ color: c.color }}>D{c.id}</td>
                    <td className="px-2 py-0.5">
                      <input value={c.name} onChange={(e) => setChannels((prev) => prev.map((p) => (p.id === c.id ? { ...p, name: e.target.value } : p)))} className="w-28 bg-slate-950 border border-slate-800 rounded px-1 text-slate-200" />
                    </td>
                    <td className="px-2 py-0.5 text-slate-300">{m?.edges ?? 0}{m?.level !== null && m?.level !== undefined ? ` (stuck ${m.level ? 'high' : 'low'})` : ''}</td>
                    <td className="px-2 py-0.5 text-slate-300">{m?.frequency ? fmtHz(m.frequency) : '-'}</td>
                    <td className="px-2 py-0.5 text-slate-300">{m?.duty !== null && m?.duty !== undefined ? `${m.duty.toFixed(1)}%` : '-'}</td>
                    <td className="px-2 py-0.5 text-slate-300">{m?.minPulseUs !== null && m?.minPulseUs !== undefined ? fmtTime(m.minPulseUs / 1e6) : '-'}</td>
                    <td className="px-2 py-0.5 text-slate-300">{m?.maxPulseUs !== null && m?.maxPulseUs !== undefined ? fmtTime(m.maxPulseUs / 1e6) : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[10px] text-slate-500 mt-1">Frequency and duty assume a regular signal; for bursty traffic, use the cursors.</p>
        </div>
      )}
    </div>
  );
}
