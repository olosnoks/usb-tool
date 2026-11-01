import { useState, useEffect, useRef } from 'react';
import {
  Radio,
  RotateCcw,
  Sliders,
  Terminal as TerminalIcon,
  Activity,
  Disc,
  Send,
  Zap,
  RefreshCw,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  MapPin,
  ExternalLink,
  Flame,
  Scan,
  Monitor
} from 'lucide-react';
import { MayhemPortaPackDriver, MAYHEM_APPS } from '../../utils/mayhemDriver';
import TacticalMapDeck from './TacticalMapDeck';
import HamRadioDeck from './hackrf/HamRadioDeck';
import SensorHubDeck from './hackrf/SensorHubDeck';
import LookingGlassDeck from './hackrf/LookingGlassDeck';
import StatusBadge from '../common/StatusBadge';
import AudioView from './portapack/AudioView';
import DisplayView from './portapack/DisplayView';
import TxView from './portapack/TxView';
import FreqmanView from './portapack/FreqmanView';
import CaptureView from './portapack/CaptureView';
import CliView from './portapack/CliView';

export default function PortapackWorkbench() {
  const [driver] = useState(() => new MayhemPortaPackDriver());
  const [state, setState] = useState(() => ({
    isConnected: false,
    connectionType: null,
    frequency: 433920000,
    amp: 0,
    lnaGain: 24,
    vgaGain: 24,
    sampleRate: 2000000,
    activeApp: 'menu',
    selectedMenuIndex: 0,
    firmwareVersion: null,
    boardId: null,
    cpldVersion: null,
    batteryMv: null,
    sdCardMounted: null,
    sdCardFreeGb: null,
    rssi: -120
  }));

  const [activeTab, setActiveTab] = useState('map'); // map, audio, display, tx, freqman, capture, cli
  const [customFreqInput, setCustomFreqInput] = useState('433.920');
  const [customMod, setCustomMod] = useState('NFM');
  const [customLabel, setCustomLabel] = useState('Car Key Fob');
  const [cliInput, setCliInput] = useState('');
  const [logs, setLogs] = useState([]);
  const [fftData, setFftData] = useState([]);
  const [iqFileStats, setIqFileStats] = useState(null);
  const [connectError, setConnectError] = useState(null);
  const [showVirtualLcd, setShowVirtualLcd] = useState(false);
  // Real screen mirror (serial console `screenframeshort`)
  const [mirrorTick, setMirrorTick] = useState(0);
  const [mirrorLive, setMirrorLive] = useState(false);
  const mirrorBusyRef = useRef(false);
  const isSerialHw = state.connectionType === 'serial';
  const captureMirror = async () => {
    if (mirrorBusyRef.current) return;
    mirrorBusyRef.current = true;
    try { await driver.captureScreen(); setMirrorTick((t) => t + 1); }
    catch (e) { driver.log(`screenframeshort failed: ${e.message}`, 'error'); }
    finally { mirrorBusyRef.current = false; }
  };
  useEffect(() => {
    if (!mirrorLive || !isSerialHw || !showVirtualLcd) return undefined;
    captureMirror();
    const iv = setInterval(captureMirror, 1500);
    return () => clearInterval(iv);
  }, [mirrorLive, isSerialHw, showVirtualLcd]);

  // RocketGod HackRF DSP & Transmit States
  const [agcEnabled, setAgcEnabled] = useState(true);
  const [audioMode, setAudioMode] = useState('WFM');
  const [squelchDb, setSquelchDb] = useState(-70);
  const [volume, setVolume] = useState(75);
  const [audioOn, setAudioOn] = useState(false);
  const [txMode, setTxMode] = useState('tone');
  const [txConfirmed, setTxConfirmed] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [txVga, setTxVga] = useState(24);
  const [txText, setTxText] = useState('MAYHEM TEST 73 DE SKON');

  const canvasRef = useRef(null);
  const waterfallCanvasRef = useRef(null);
  const logContainerRef = useRef(null);
  const spectrumRef = useRef(null); // latest live FFT frame { spec, peakDb, ts }
  const audioCtxRef = useRef(null);  // Web Audio context + gain for demodulated sound
  const audioGainRef = useRef(null);
  const audioNextTimeRef = useRef(0);

  // Setup state callbacks and initial demo connection
  useEffect(() => {
    driver.onStateChangeCallback = (s) => setState({ ...s });
    driver.onLogCallback = (log) => {
      setLogs(prev => [...prev.slice(-100), log]);
    };
    // Live FFT frames from the real HackRF IQ stream (WebUSB). Stored in a ref so
    // the waterfall rAF loop can read the latest frame without re-subscribing.
    driver.onSpectrumCallback = (spec, peakDb) => {
      spectrumRef.current = { spec, peakDb, ts: performance.now() };
    };

    return () => {
      driver.onSpectrumCallback = null;
      driver.disconnect();
    };
  }, [driver]);

  // Scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Real-time spectrum + Inferno waterfall for the Audio tab.
  // WebUSB: draws the live FFT of the HackRF IQ stream (spectrumRef, ~25 fps).
  // Demo: a clearly-labelled synthetic trace. Serial: a note that IQ needs WebUSB.
  useEffect(() => {
    if (activeTab !== 'audio') return undefined;
    const canvas = waterfallCanvasRef.current;
    if (!canvas) return undefined;
    // willReadFrequently: the waterfall scroll reads back the canvas every frame.
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return undefined;

    let animId;
    let tick = 0;
    const width = canvas.width || 1200;
    const height = canvas.height || 360;
    const spectrumHeight = 110;
    const waterfallHeight = height - spectrumHeight;
    const isLiveRf = state.connectionType === 'webusb';

    // dBFS display window for the live FFT (HackRF 8-bit IQ sits well under 0 dBFS).
    const DB_TOP = 0;
    const DB_BOTTOM = -90;
    const frac = (db) => Math.min(1, Math.max(0, (db - DB_BOTTOM) / (DB_TOP - DB_BOTTOM)));
    // Inferno-style colormap, val 0..1.
    const inferno = (val) => {
      const r = Math.min(255, Math.floor(val * 280));
      const g = Math.min(255, Math.floor(Math.pow(val, 2.2) * 260));
      const b = Math.min(255, Math.floor(Math.sin(val * Math.PI) * 160 + val * 60));
      return `rgb(${r},${g},${b})`;
    };
    const unit = isLiveRf ? 'dBFS' : 'dBm';

    const render = () => {
      tick++;
      const frame = isLiveRf ? spectrumRef.current : null;
      const spec = frame && frame.spec && frame.spec.length ? frame.spec : null;
      const live = !!spec;
      const bins = live ? spec.length : width;
      // Sample the spectrum at horizontal position x -> value 0..1 (and the peak).
      let peakFrac = 0;
      let peakX = width / 2;
      const valueAt = (x) => {
        if (live) {
          const db = spec[Math.min(bins - 1, Math.floor((x / width) * bins))];
          return frac(db);
        }
        return 0;
      };

      // 1. Spectrum panel background + dBFS/dBm grid.
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, spectrumHeight);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#475569';
      ctx.font = '9px monospace';
      [-20, -40, -60, -80].forEach((db) => {
        const y = Math.floor(spectrumHeight - frac(db) * spectrumHeight);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        ctx.fillText(`${db} ${unit}`, 4, y - 2);
      });

      // Serial-but-no-IQ note.
      if (!live) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '12px monospace';
        ctx.fillText('Live spectrum needs a WebUSB connection (PortaPack in HackRF mode).', 16, spectrumHeight + 30);
        ctx.fillText('The serial console does not stream IQ.', 16, spectrumHeight + 50);
        animId = requestAnimationFrame(render);
        return;
      }

      // 2. Spectrum trace.
      ctx.strokeStyle = live ? '#34d399' : '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let x = 0; x < width; x += 1) {
        const v = valueAt(x);
        if (v > peakFrac) { peakFrac = v; peakX = x; }
        const y = spectrumHeight - 2 - v * (spectrumHeight - 6);
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Squelch reference line (user control; shown on the same axis).
      const squelchY = Math.floor(spectrumHeight - frac(squelchDb) * spectrumHeight);
      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(0, squelchY); ctx.lineTo(width, squelchY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`SQL ${squelchDb} ${unit}`, width - 90, squelchY - 2);

      // Peak marker + center-frequency label.
      ctx.fillStyle = live ? '#34d399' : '#38bdf8';
      ctx.fillRect(peakX - 1, 8, 2, spectrumHeight - 8);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
      ctx.strokeStyle = live ? '#34d399' : '#38bdf8';
      const labelX = Math.min(width - 72, Math.max(2, peakX - 36));
      ctx.fillRect(labelX, 10, 72, 16);
      ctx.strokeRect(labelX, 10, 72, 16);
      ctx.fillStyle = live ? '#34d399' : '#38bdf8';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`${(state.frequency / 1e6).toFixed(3)} MHz`, labelX + 4, 21);
      if (live && frame) {
        ctx.fillStyle = '#64748b';
        ctx.fillText(`peak ${frame.peakDb.toFixed(0)} dBFS`, 4, spectrumHeight - 4);
      }

      // 3. Scroll the waterfall down one row and draw the new row on top.
      const imgData = ctx.getImageData(0, spectrumHeight, width, waterfallHeight - 2);
      ctx.putImageData(imgData, 0, spectrumHeight + 2);
      for (let x = 0; x < width; x += 2) {
        ctx.fillStyle = inferno(valueAt(x));
        ctx.fillRect(x, spectrumHeight, 2, 2);
      }

      animId = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animId);
  }, [activeTab, state.connectionType, state.frequency, state.lnaGain, state.amp, squelchDb]);

  // Live volume/squelch read by the audio callback without re-subscribing.
  const volumeRef = useRef(volume);
  const squelchRef = useRef(squelchDb);
  useEffect(() => { volumeRef.current = volume; if (audioGainRef.current) audioGainRef.current.gain.value = volume / 100; }, [volume]);
  useEffect(() => { squelchRef.current = squelchDb; }, [squelchDb]);
  useEffect(() => { if (audioOn) driver.setAudioMode(audioMode); }, [audioMode, audioOn, driver]);

  // Web Audio playback of the demodulated HackRF stream (WebUSB only).
  useEffect(() => {
    const teardown = () => {
      driver.onAudioCallback = null;
      driver.disableAudio();
      const c = audioCtxRef.current;
      audioCtxRef.current = null; audioGainRef.current = null;
      if (c) c.close().catch(() => {});
    };
    if (!audioOn || state.connectionType !== 'webusb') { teardown(); return teardown; }

    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { driver.log('Web Audio is not supported in this browser.', 'warning'); return undefined; }
    const ctx = new AC();
    const gain = ctx.createGain();
    gain.gain.value = volumeRef.current / 100;
    gain.connect(ctx.destination);
    audioCtxRef.current = ctx;
    audioGainRef.current = gain;
    audioNextTimeRef.current = 0;
    driver.enableAudio(audioMode);

    driver.onAudioCallback = (audio, rate) => {
      const c = audioCtxRef.current;
      const g = audioGainRef.current;
      if (!c || !g) return;
      // Software squelch from the live spectrum peak (dBFS).
      const peak = spectrumRef.current ? spectrumRef.current.peakDb : -200;
      if (peak < squelchRef.current) { audioNextTimeRef.current = 0; return; }
      try {
        const buf = c.createBuffer(1, audio.length, Math.max(3000, Math.round(rate)));
        buf.copyToChannel(audio instanceof Float32Array ? audio : Float32Array.from(audio), 0);
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        const now = c.currentTime;
        let start = audioNextTimeRef.current;
        if (start < now + 0.02) start = now + 0.05; // (re)prime the queue after a gap
        src.start(start);
        audioNextTimeRef.current = start + buf.duration;
      } catch (_) { /* buffer rejected: skip this frame */ }
    };
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return teardown;
  }, [audioOn, state.connectionType, driver]);

  // Virtual LCD: mirrors the real PortaPack screen pulled over the serial console.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, 320, 240);
    const f = driver.lastFrame;
    if (state.connectionType === 'serial' && f) {
      const off = document.createElement('canvas');
      off.width = f.width; off.height = f.height;
      off.getContext('2d').putImageData(new ImageData(f.rgba, f.width, f.height), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, 320, 240);
    } else {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '11px monospace';
      const msg = state.connectionType === 'serial'
        ? ['Press Refresh or Live to pull', 'the real screen from the PortaPack.']
        : ['Screen mirroring needs the serial console:', 'put the PortaPack in normal mode', 'and connect over serial.'];
      msg.forEach((m, idx) => ctx.fillText(m, 16, 100 + idx * 16));
    }
  }, [state, showVirtualLcd, mirrorTick]);

  const handleTunePreset = (preset) => {
    driver.sendCommand(`freq ${preset.freq}`);
    driver.log(`Tuned preset: ${preset.label} (${preset.mod})`, 'success');
  };

  const handleCustomTune = () => {
    const mhz = parseFloat(customFreqInput);
    if (!isNaN(mhz)) {
      const hz = Math.round(mhz * 1000000);
      driver.sendCommand(`freq ${hz}`);
    }
  };

  const handleAddCustomFreq = () => {
    const mhz = parseFloat(customFreqInput);
    if (!isNaN(mhz)) {
      const hz = Math.round(mhz * 1000000);
      driver.addFrequency(hz, customMod, customLabel);
    }
  };

  const handleExportFreqman = () => {
    const text = driver.exportFreqmanTxt();
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'FREQMAN.TXT';
    a.click();
    URL.revokeObjectURL(url);
    driver.log('Exported FREQMAN.TXT for PortaPack MicroSD card.', 'success');
  };

  const handleSendCli = (e) => {
    e.preventDefault();
    if (!cliInput.trim()) return;
    driver.sendCommand(cliInput.trim());
    setCliInput('');
  };

  return (
    <div className="space-y-4">
      {/* Super Condensed Single Header Bar (RocketGod Attribution + Status + Hardware + Connect) */}
      <div className="bg-slate-900/90 border border-purple-500/30 rounded-xl px-4 py-2.5 shadow-xl backdrop-blur flex flex-wrap items-center justify-between gap-3">
        {/* Left: Title + RocketGod Credit & Link + Status */}
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-purple-500/20 border border-purple-500/40 rounded-lg text-purple-400">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-white tracking-wide">
              PORTAPACK MAYHEM & HACKRF
            </span>
            <span className="text-[10px] px-2 py-0.5 bg-purple-950/80 border border-purple-500/40 text-purple-300 rounded font-mono font-semibold">
              {state.firmwareVersion || 'Mayhem (not connected)'}
            </span>
            <StatusBadge status={state.isConnected ? 'success' : 'warning'} label={state.isConnected ? 'CONNECTED' : 'OFFLINE'} />
            <span className="text-slate-600 text-xs">•</span>
            <div className="flex items-center gap-1.5 text-xs text-slate-300">
              <span className="text-slate-400">By</span>
              <a 
                href="https://github.com/RocketGod-git/mayhem-mobile"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-300 hover:text-purple-200 font-mono font-bold underline decoration-purple-500/50 flex items-center gap-1 transition group"
                title="RocketGod mayhem-mobile on GitHub"
              >
                <span>RocketGod / mayhem-mobile</span>
                <ExternalLink className="w-3 h-3 group-hover:scale-110 transition" />
              </a>
            </div>
          </div>
        </div>

        {/* Center/Right: Hardware Chip & Connect Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 bg-cyan-950/60 border border-cyan-500/30 rounded text-[11px] font-mono text-cyan-300">
            <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${state.isConnected ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span>
              {!state.isConnected ? 'Not connected'
                : state.connectionType === 'serial' ? 'Mayhem serial console (1D50:6018)'
                : 'HackRF One (1D50:6089 WinUSB)'}
            </span>
          </div>

          {state.isConnected ? (
            <button
              onClick={() => driver.disconnect()}
              className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 rounded text-xs font-mono transition flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" /> Disconnect
            </button>
          ) : (
            <>
              <button
                onClick={async () => {
                  setConnectError(null);
                  try {
                    await driver.connectWebUsb();
                  } catch (err) {
                    setConnectError(err.message);
                  }
                }}
                className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded text-xs font-mono transition shadow-md shadow-cyan-600/20 flex items-center gap-1.5"
                title="Connect via WebUSB (HackRF One WinUSB driver)"
              >
                <Zap className="w-3.5 h-3.5" /> Connect WebUSB
              </button>

              <button
                onClick={async () => {
                  setConnectError(null);
                  try {
                    await driver.connectHardware({ baudRate: 115200, noFilter: true });
                  } catch (err) {
                    setConnectError(err.message);
                  }
                }}
                className="px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/40 text-purple-200 border border-purple-500/30 rounded text-xs font-mono transition flex items-center gap-1"
                title="Connect via Web Serial (COM Port)"
              >
                <Radio className="w-3 h-3" /> COM Port
              </button>
            </>
          )}

          <button
            onClick={() => setShowVirtualLcd(prev => !prev)}
            className={`px-2.5 py-1 rounded text-xs font-mono transition flex items-center gap-1.5 ${
              showVirtualLcd 
                ? 'bg-purple-600/40 border border-purple-400 text-purple-200 font-bold shadow-lg shadow-purple-600/20' 
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
            }`}
            title="Toggle Virtual PortaPack 320x240 LCD & D-Pad Keypad"
          >
            <Monitor className="w-3.5 h-3.5 text-purple-400" />
            <span>Virtual LCD & Keypad</span>
            <span className="text-[10px]">{showVirtualLcd ? '▲ Hide' : '▼ Show'}</span>
          </button>
        </div>
      </div>


      {connectError && (
        <div className="bg-rose-950/60 border border-rose-500/40 rounded-xl p-3 text-xs font-mono text-rose-300 flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">Connection Error: {connectError}</div>
              <div className="text-[11px] text-rose-400/80 mt-1">
                Tip: Click <strong>"Show All COM Ports"</strong> to pick COM13 directly. If COM13 is in use, make sure SDR#, GQRX, or another terminal is closed.
              </div>
            </div>
          </div>
          <button 
            onClick={() => setConnectError(null)}
            className="text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Collapsible Virtual PortaPack LCD & Hardware Controls Drawer */}
      {showVirtualLcd && (
        <div className="w-full bg-slate-950/95 border border-purple-500/40 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col items-center animate-in slide-in-from-top-2 duration-200">
          <div className="w-full flex items-center justify-between pb-3 border-b border-slate-800/80 mb-4">
            <span className="text-xs font-bold text-purple-400 tracking-wider flex items-center gap-2">
              <Radio className="w-4 h-4" /> 320x240 LCD SCREEN // ILI9341 & HARDWARE CONTROLS
            </span>
            <div className="flex items-center gap-3 text-[10px] text-slate-400 font-mono">
              {isSerialHw ? (
                <>
                  <button onClick={captureMirror} className="px-2 py-0.5 rounded bg-slate-800 text-[10px] border border-slate-700 text-cyan-300 hover:text-white">Refresh</button>
                  <button onClick={() => setMirrorLive((v) => !v)} className={`px-2 py-0.5 rounded text-[10px] border ${mirrorLive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-slate-800 text-slate-300 border-slate-700'}`}>{mirrorLive ? 'Live ●' : 'Live'}</button>
                </>
              ) : null}
              <button
                onClick={() => setShowVirtualLcd(false)}
                className="text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800 text-[10px] border border-slate-700 transition"
              >
                ✕ Close
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-8 w-full">
            {/* Simulated LCD Screen Frame */}
            <div className="relative p-2 bg-slate-900 border-2 border-slate-700 rounded-xl shadow-[0_0_30px_rgba(6,182,212,0.15)] shrink-0">
              <canvas
                ref={canvasRef}
                width={320}
                height={240}
                className="rounded-lg shadow-inner cursor-pointer"
                title={isSerialHw ? 'Click to touch the real screen' : 'Click on screen to simulate touch coordinates'}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const f = driver.lastFrame;
                  if (isSerialHw && f) {
                    const x = Math.floor(((e.clientX - rect.left) / rect.width) * f.width);
                    const y = Math.floor(((e.clientY - rect.top) / rect.height) * f.height);
                    driver.sendTouch(x, y).then(() => captureMirror()).catch((err) => driver.log(`touch failed: ${err.message}`, 'error'));
                    return;
                  }
                  const x = Math.floor(e.clientX - rect.left);
                  const y = Math.floor(e.clientY - rect.top);
                  driver.log(`Touch Event at (${x}, ${y})`, 'info');
                }}
              />
            </div>

            {/* PortaPack Physical Hardware Keypad & D-Pad */}
            <div className="w-full max-w-sm bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col items-center gap-4">
              <div className="text-[11px] font-mono text-slate-400 tracking-wider">
                HARDWARE KEYPAD & ROTARY JOG DIAL
              </div>

              <div className="flex items-center justify-around w-full">
                {/* 4-Way D-Pad */}
                <div className="grid grid-cols-3 gap-1.5 w-28 h-28">
                  <div></div>
                  <button
                    onClick={() => driver.pressKey('up')}
                    className="bg-slate-800 hover:bg-purple-600/40 text-slate-200 border border-slate-700 rounded p-2 flex items-center justify-center transition active:scale-95"
                    title="D-Pad Up"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <div></div>

                  <button
                    onClick={() => driver.pressKey('left')}
                    className="bg-slate-800 hover:bg-purple-600/40 text-slate-200 border border-slate-700 rounded p-2 flex items-center justify-center transition active:scale-95"
                    title="D-Pad Left"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>

                  <button
                    onClick={() => driver.pressKey('select')}
                    className="bg-purple-600 hover:bg-purple-500 text-white font-bold rounded p-2 flex items-center justify-center transition shadow-lg shadow-purple-600/30 active:scale-95 text-xs font-mono"
                    title="Center Select"
                  >
                    SEL
                  </button>

                  <button
                    onClick={() => driver.pressKey('right')}
                    className="bg-slate-800 hover:bg-purple-600/40 text-slate-200 border border-slate-700 rounded p-2 flex items-center justify-center transition active:scale-95"
                    title="D-Pad Right"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>

                  <div></div>
                  <button
                    onClick={() => driver.pressKey('down')}
                    className="bg-slate-800 hover:bg-purple-600/40 text-slate-200 border border-slate-700 rounded p-2 flex items-center justify-center transition active:scale-95"
                    title="D-Pad Down"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  <div></div>
                </div>

                {/* Rotary Jog Dial Tuning & Back Button */}
                <div className="flex flex-col items-center gap-2">
                  <div className="text-[10px] text-slate-400 font-mono">ROTARY WHEEL</div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => driver.pressKey('step_down')}
                      className="p-3 bg-slate-800 hover:bg-cyan-600/30 border border-slate-700 text-cyan-300 rounded-lg text-xs font-mono transition active:scale-90"
                      title="-25 kHz Step"
                    >
                      -25k
                    </button>
                    <button
                      onClick={() => driver.pressKey('step_up')}
                      className="p-3 bg-slate-800 hover:bg-cyan-600/30 border border-slate-700 text-cyan-300 rounded-lg text-xs font-mono transition active:scale-90"
                      title="+25 kHz Step"
                    >
                      +25k
                    </button>
                  </div>

                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => driver.pressKey('back')}
                      className="px-3 py-1 bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/30 text-amber-300 rounded text-xs font-mono transition"
                    >
                      BACK / MENU
                    </button>
                    <button
                      onClick={() => driver.sendCommand('dfu')}
                      className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 rounded text-xs font-mono transition"
                      title="Enter LPC43xx DFU Mode"
                    >
                      DFU
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Full-Width Operational Deck */}
      <div className="w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col">
          {/* Workspace Subtabs */}
          <div className="flex items-center gap-1.5 border-b border-slate-800 pb-3 mb-4 overflow-x-auto">
            {[
              { id: 'map', name: 'Tactical Real Map', icon: MapPin },
              { id: 'audio', name: 'Audio & Waterfall', icon: Flame },
              { id: 'ham', name: 'HAM Radio & Digital', icon: Activity },
              { id: 'sensors', name: 'rtl_433 Sensors Hub', icon: Cpu },
              { id: 'sweep', name: 'Looking Glass Sweep', icon: Scan },
              { id: 'display', name: 'RF Tuner & Gains', icon: Sliders },
              { id: 'tx', name: 'Transmit Lab', icon: Send },
              { id: 'freqman', name: 'FREQMAN (SD Cards)', icon: FileText },
              { id: 'capture', name: 'IQ & C16 Inspector', icon: Disc },
              { id: 'cli', name: 'Mayhem CLI Console', icon: TerminalIcon }
            ].map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono transition flex items-center gap-2 whitespace-nowrap ${
                    isActive 
                      ? 'bg-purple-600/20 border border-purple-500/40 text-purple-300 font-bold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.name}
                </button>
              );
            })}
          </div>

          {/* Subtab 0: Tactical Real Map */}
          {activeTab === 'map' && (
            <div className="flex-1">
              <TacticalMapDeck
                centerFreq={state.frequency}
                onTuneFreq={(hz) => driver.sendCommand(`freq ${hz}`)}
              />
            </div>
          )}

          {/* Subtab 1: Audio & Waterfall (RocketGod Port) */}
          {activeTab === 'audio' && (
            <AudioView
              agcEnabled={agcEnabled}
              audioMode={audioMode}
              setAudioMode={setAudioMode}
              setSquelchDb={setSquelchDb}
              setVolume={setVolume}
              squelchDb={squelchDb}
              volume={volume}
              audioOn={audioOn}
              setAudioOn={setAudioOn}
              canListen={state.connectionType === 'webusb'}
              waterfallCanvasRef={waterfallCanvasRef}
            />
          )}

          {/* Subtab: HAM Radio & Digital Decoders (RocketGod Port) */}
          {activeTab === 'ham' && (
            <div className="flex-1">
              <HamRadioDeck
                driver={driver}
                centerFreq={state.frequency}
                onTuneFreq={(hz) => driver.sendCommand(`freq ${hz}`)}
              />
            </div>
          )}

          {/* Subtab: rtl_433 & Multi-Protocol Sensor Hub (RocketGod Port) */}
          {activeTab === 'sensors' && (
            <div className="flex-1">
              <SensorHubDeck
                driver={driver}
                centerFreq={state.frequency}
                onTuneFreq={(hz) => driver.sendCommand(`freq ${hz}`)}
              />
            </div>
          )}

          {/* Subtab: Looking Glass Sweep & Peak Energy Detector (RocketGod Port) */}
          {activeTab === 'sweep' && (
            <div className="flex-1">
              <LookingGlassDeck
                driver={driver}
                centerFreq={state.frequency}
                sampleRate={state.sampleRate}
                onTuneFreq={(hz) => driver.sendCommand(`freq ${hz}`)}
              />
            </div>
          )}

          {/* Subtab 2: RF Tuner & Gains */}
          {activeTab === 'display' && (
            <DisplayView
              agcEnabled={agcEnabled}
              customFreqInput={customFreqInput}
              driver={driver}
              handleCustomTune={handleCustomTune}
              setAgcEnabled={setAgcEnabled}
              setCustomFreqInput={setCustomFreqInput}
              state={state}
            />
          )}

          {/* Subtab 3: Transmit Lab (RocketGod Port) */}
          {activeTab === 'tx' && (
            <TxView
              driver={driver}
              isTransmitting={isTransmitting}
              setIsTransmitting={setIsTransmitting}
              setTxConfirmed={setTxConfirmed}
              setTxMode={setTxMode}
              setTxText={setTxText}
              setTxVga={setTxVga}
              state={state}
              txConfirmed={txConfirmed}
              txMode={txMode}
              txText={txText}
              txVga={txVga}
            />
          )}


          {/* Subtab 2: FREQMAN (Frequency Manager) */}
          {activeTab === 'freqman' && (
            <FreqmanView
              customFreqInput={customFreqInput}
              customLabel={customLabel}
              customMod={customMod}
              driver={driver}
              handleAddCustomFreq={handleAddCustomFreq}
              handleExportFreqman={handleExportFreqman}
              handleTunePreset={handleTunePreset}
              setCustomFreqInput={setCustomFreqInput}
              setCustomLabel={setCustomLabel}
              setCustomMod={setCustomMod}
            />
          )}

          {/* Subtab 3: Raw IQ & C16 Inspector */}
          {activeTab === 'capture' && (
            <CaptureView
              driver={driver}
              iqFileStats={iqFileStats}
              setIqFileStats={setIqFileStats}
            />
          )}

          {/* Subtab 4: Mayhem CLI Console */}
          {activeTab === 'cli' && (
            <CliView
              cliInput={cliInput}
              driver={driver}
              handleSendCli={handleSendCli}
              logContainerRef={logContainerRef}
              logs={logs}
              setCliInput={setCliInput}
            />
          )}
        </div>
      </div>
    );
  }
