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
    isDemo: true,
    frequency: 433920000,
    amp: 0,
    lnaGain: 16,
    vgaGain: 20,
    sampleRate: 2000000,
    activeApp: 'menu',
    selectedMenuIndex: 0,
    firmwareVersion: 'Mayhem v2.0.0 (Nightly)',
    boardId: 'HackRF One (rev. r9)',
    cpldVersion: 'CPLD v1.0.0',
    batteryMv: 4050,
    sdCardMounted: true,
    sdCardFreeGb: '14.2 GB / 16 GB',
    rssi: -85
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
  const isSerialHw = !state.isDemo && state.connectionType === 'serial';
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
  const [txMode, setTxMode] = useState('tone');
  const [txConfirmed, setTxConfirmed] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [txVga, setTxVga] = useState(24);
  const [txText, setTxText] = useState('MAYHEM TEST 73 DE SKON');

  const canvasRef = useRef(null);
  const waterfallCanvasRef = useRef(null);
  const logContainerRef = useRef(null);

  // Setup state callbacks and initial demo connection
  useEffect(() => {
    driver.onStateChangeCallback = (s) => setState({ ...s });
    driver.onLogCallback = (log) => {
      setLogs(prev => [...prev.slice(-100), log]);
    };

    driver.connectDemo();

    return () => {
      driver.disconnect();
    };
  }, [driver]);

  // Scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Real-time Inferno Waterfall Animation for Audio Tab (RocketGod Style)
  useEffect(() => {
    if (activeTab !== 'audio') return;
    let animId;
    const canvas = waterfallCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let tick = 0;
    const width = canvas.width || 600;
    const height = canvas.height || 300;
    const spectrumHeight = 110;
    const waterfallHeight = height - spectrumHeight;

    const render = () => {
      tick++;

      // 1. Draw Spectrum trace (upper section)
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, spectrumHeight);

      // dB Grid lines (-120 dBm to -20 dBm)
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      const dbLevels = [-100, -80, -60, -40];
      ctx.fillStyle = '#475569';
      ctx.font = '8px monospace';
      dbLevels.forEach(db => {
        const y = Math.floor(((db - (-20)) / -100) * spectrumHeight);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(`${db} dBm`, 4, y - 2);
      });

      // Squelch Line
      const squelchY = Math.floor(((squelchDb - (-20)) / -100) * spectrumHeight);
      ctx.strokeStyle = '#f59e0b';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, squelchY);
      ctx.lineTo(width, squelchY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText(`SQL: ${squelchDb} dBm`, width - 75, squelchY - 2);

      // Synthetic RF Spectrum Trace with Carrier Peak
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const centerBin = width / 2;
      for (let x = 0; x < width; x += 2) {
        const distFromCenter = Math.abs(x - centerBin);
        const noise = Math.sin(x * 0.05 + tick * 0.1) * 6 + (Math.random() - 0.5) * 8;
        const carrier = distFromCenter < 12 ? (12 - distFromCenter) * 5 : 0;
        const sideband = distFromCenter > 30 && distFromCenter < 50 ? (10 - Math.abs(distFromCenter - 40)) * 2 : 0;
        const ampBoost = state.amp > 0 ? 8 : 0;
        const lnaBoost = (state.lnaGain / 40) * 15;
        const levelY = spectrumHeight - 20 - noise - carrier - sideband - ampBoost - lnaBoost;
        if (x === 0) ctx.moveTo(x, levelY);
        else ctx.lineTo(x, levelY);
      }
      ctx.stroke();

      // Peak Carrier Label (RocketGod feature)
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(centerBin - 1, 10, 2, spectrumHeight - 10);
      ctx.fillStyle = 'rgba(2, 6, 23, 0.9)';
      ctx.strokeStyle = '#38bdf8';
      ctx.strokeRect(centerBin - 35, 12, 70, 16);
      ctx.fillRect(centerBin - 35, 12, 70, 16);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 8px monospace';
      ctx.fillText(`${(state.frequency / 1e6).toFixed(3)} MHz`, centerBin - 30, 23);

      // 2. Scroll Waterfall Down (lower section)
      const imgData = ctx.getImageData(0, spectrumHeight, width, waterfallHeight - 2);
      ctx.putImageData(imgData, 0, spectrumHeight + 2);

      // Generate New Waterfall Row using RocketGod Inferno palette
      for (let x = 0; x < width; x += 2) {
        const dist = Math.abs(x - centerBin);
        const noiseVal = Math.random() * 0.15;
        const carrierVal = dist < 14 ? (14 - dist) / 14 * 0.75 : 0;
        const ampBoost = state.amp > 0 ? 0.1 : 0;
        const val = Math.min(1.0, noiseVal + carrierVal + ampBoost);

        // Inferno Colormap
        const r = Math.min(255, Math.floor(val * 280));
        const g = Math.min(255, Math.floor(Math.pow(val, 2.2) * 260));
        const b = Math.min(255, Math.floor(Math.sin(val * Math.PI) * 160 + val * 60));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(x, spectrumHeight, 2, 2);
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animId);
  }, [activeTab, state.frequency, state.lnaGain, state.vgaGain, state.amp, squelchDb]);

  // Live Canvas Renderer (320x240 PortaPack LCD Display)
  useEffect(() => {
    let animId;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (!state.isDemo) {
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
        msg.forEach((m, i) => ctx.fillText(m, 16, 100 + i * 16));
      }
      return undefined;
    }

    let tick = 0;
    const waterfallHistory = [];

    const render = () => {
      tick++;
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, 320, 240);

      // 1. TOP STATUS BAR (Height: 20px)
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, 320, 20);
      ctx.fillStyle = '#06b6d4';
      ctx.font = 'bold 10px monospace';
      ctx.fillText(`${(state.frequency / 1000000).toFixed(4)} MHz`, 6, 14);

      // Amp status
      ctx.fillStyle = state.amp > 0 ? '#ef4444' : '#64748b';
      ctx.fillText(state.amp > 0 ? 'AMP:14dB' : 'AMP:OFF', 110, 14);

      // LNA / VGA
      ctx.fillStyle = '#10b981';
      ctx.fillText(`L:${state.lnaGain} V:${state.vgaGain}`, 180, 14);

      // SD Card & Battery
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('SD', 245, 14);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('92%', 270, 14);

      // Battery Icon
      ctx.strokeStyle = '#38bdf8';
      ctx.strokeRect(295, 6, 18, 9);
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(297, 8, 14, 5);

      // 2. MAIN APP VIEW
      if (state.activeApp === 'menu') {
        // App Grid (3 cols x 4 rows)
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText('MAYHEM APP LAUNCHER', 10, 36);

        MAYHEM_APPS.forEach((app, idx) => {
          const col = idx % 3;
          const row = Math.floor(idx / 3);
          const x = 10 + col * 102;
          const y = 46 + row * 45;
          const isSelected = idx === state.selectedMenuIndex;

          ctx.fillStyle = isSelected ? '#1e293b' : '#020617';
          ctx.strokeStyle = isSelected ? '#38bdf8' : '#334155';
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.beginPath();
          ctx.roundRect(x, y, 96, 38, 4);
          ctx.fill();
          ctx.stroke();

          // Text & Category
          ctx.fillStyle = isSelected ? '#38bdf8' : '#94a3b8';
          ctx.font = 'bold 9px monospace';
          ctx.fillText(app.name.substring(0, 14), x + 6, y + 16);

          ctx.fillStyle = '#64748b';
          ctx.font = '8px monospace';
          ctx.fillText(app.category.toUpperCase(), x + 6, y + 30);
        });
      } else if (state.activeApp === 'audio_rx') {
        // Audio RX Spectrum & Waterfall
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 12px monospace';
        ctx.fillText('AUDIO RECEIVER (NFM / AM)', 10, 36);

        // Huge Frequency display
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 18px monospace';
        ctx.fillText(`${(state.frequency / 1000000).toFixed(4)} MHz`, 10, 60);

        // RSSI S-Meter Bar
        const rssiVal = -95 + Math.sin(tick * 0.05) * 15;
        const rssiPct = Math.min(1, Math.max(0, (rssiVal + 120) / 90));
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(10, 70, 300, 10);
        ctx.fillStyle = rssiPct > 0.7 ? '#ef4444' : rssiPct > 0.4 ? '#f59e0b' : '#10b981';
        ctx.fillRect(10, 70, 300 * rssiPct, 10);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.fillText(`RSSI: ${rssiVal.toFixed(1)} dBm (S9+10)`, 10, 92);

        // Live FFT Spectrum Graph
        ctx.fillStyle = '#020617';
        ctx.fillRect(10, 98, 300, 65);
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 300; i++) {
          const noise = Math.sin((i + tick * 2) * 0.08) * 8 + Math.random() * 4;
          const peak = Math.exp(-Math.pow((i - 150) / 12, 2)) * 45;
          const y = 160 - Math.min(60, Math.max(5, noise + peak));
          if (i === 0) ctx.moveTo(10 + i, y);
          else ctx.lineTo(10 + i, y);
        }
        ctx.stroke();

        // Waterfall
        ctx.fillStyle = '#020617';
        ctx.fillRect(10, 168, 300, 65);
        for (let row = 0; row < 12; row++) {
          const rowY = 168 + row * 5;
          const hue = (tick * 2 + row * 20) % 360;
          ctx.fillStyle = `hsla(${hue}, 80%, 50%, 0.6)`;
          ctx.fillRect(140 - Math.sin(tick * 0.1) * 10, rowY, 20 + Math.random() * 5, 4);
        }
      } else if (state.activeApp === 'adsb') {
        // Real Geographic ADS-B Map on 320x240 LCD
        // Ocean background
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 20, 320, 220);

        // Header Title
        ctx.fillStyle = '#e2e8f0';
        ctx.font = 'bold 11px monospace';
        ctx.fillText('ADS-B 1090 MHz // REAL WORLD MAP', 10, 34);

        // Map mode indicator pill
        ctx.fillStyle = '#065f46';
        ctx.fillRect(230, 24, 82, 13);
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 8px monospace';
        ctx.fillText('GEO MAP ACTIVE', 234, 33);

        // Draw Real Geographic Coastline & Landmass (California Coast, SF Bay, Monterey Bay)
        ctx.fillStyle = '#06281c';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1.2;

        ctx.beginPath();
        // Landmass polygon for coastline
        ctx.moveTo(110, 36);   // North coast
        ctx.lineTo(135, 65);   // Point Reyes
        ctx.lineTo(155, 95);   // Marin headlands
        ctx.lineTo(170, 95);   // San Pablo bay north
        ctx.lineTo(195, 80);   // Carquinez strait
        ctx.lineTo(240, 75);   // Sacramento delta
        ctx.lineTo(315, 75);   // Sierra foothills
        ctx.lineTo(315, 222);  // Central valley
        ctx.lineTo(210, 222);  // South bay
        ctx.lineTo(170, 190);  // Santa Cruz / Monterey bay
        ctx.lineTo(150, 180);
        ctx.lineTo(162, 140);  // San Mateo coast
        ctx.lineTo(150, 120);  // SF peninsula west
        ctx.lineTo(156, 105);  // Golden gate south
        ctx.lineTo(175, 115);  // SF Bay inner
        ctx.lineTo(170, 135);  // SFO airport shoreline
        ctx.lineTo(185, 150);  // Dumbarton
        ctx.lineTo(205, 140);  // East bay shoreline
        ctx.lineTo(188, 105);  // Berkeley / Richmond
        ctx.lineTo(170, 95);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Real Airports on the map
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 8px monospace';
        // SFO Airport
        ctx.fillRect(168, 132, 4, 4);
        ctx.fillText('SFO', 174, 136);
        // OAK Airport
        ctx.fillRect(190, 120, 4, 4);
        ctx.fillText('OAK', 196, 124);
        // SJC Airport
        ctx.fillRect(205, 165, 4, 4);
        ctx.fillText('SJC', 211, 169);

        // Concentric Tactical Distance Rings (50 nm, 100 nm)
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(170, 132, 45, 0, Math.PI * 2);
        ctx.arc(170, 132, 90, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#06b6d4';
        ctx.font = '7px monospace';
        ctx.fillText('50 NM', 218, 132);
        ctx.fillText('100 NM', 263, 132);

        // Moving Aircraft with Dynamic Heading Vectors and Flight Trails
        const livePlanes = [
          { call: 'UAL421', x: 195 + Math.sin(tick * 0.04) * 20, y: 95 - Math.cos(tick * 0.04) * 15, alt: 'FL340', spd: '485kt', hdg: 68 },
          { call: 'DLH789', x: 130 + Math.sin(tick * 0.03) * 12, y: 155 + Math.cos(tick * 0.03) * 10, alt: 'FL185', spd: '360kt', hdg: 145 },
          { call: 'AAL102', x: 235 - Math.sin(tick * 0.05) * 15, y: 175 - Math.cos(tick * 0.05) * 12, alt: 'FL370', spd: '512kt', hdg: 52 },
          { call: 'REACH412', x: 145 + Math.cos(tick * 0.02) * 8, y: 80 + Math.sin(tick * 0.02) * 8, alt: 'FL290', spd: '440kt', hdg: 240, squawk: '7700' }
        ];

        livePlanes.forEach(p => {
          const isEmg = p.squawk === '7700';
          const pColor = isEmg ? '#ef4444' : '#38bdf8';

          // Dotted flight trail behind aircraft
          ctx.strokeStyle = isEmg ? 'rgba(239, 68, 68, 0.5)' : 'rgba(56, 189, 248, 0.4)';
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(p.x - 18, p.y + 12);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // Vector Airplane Glyph
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.hdg * Math.PI) / 180);
          ctx.fillStyle = pColor;
          ctx.beginPath();
          ctx.moveTo(0, -6);
          ctx.lineTo(1.5, -2);
          ctx.lineTo(6, 1);
          ctx.lineTo(1.5, 1);
          ctx.lineTo(1.5, 4);
          ctx.lineTo(4, 6);
          ctx.lineTo(0, 5);
          ctx.lineTo(-4, 6);
          ctx.lineTo(-1.5, 4);
          ctx.lineTo(-1.5, 1);
          ctx.lineTo(-6, 1);
          ctx.lineTo(-1.5, -2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();

          // Flight Tag Pill
          ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
          ctx.strokeStyle = pColor;
          ctx.lineWidth = 1;
          ctx.fillRect(p.x + 8, p.y - 8, 66, 18);
          ctx.strokeRect(p.x + 8, p.y - 8, 66, 18);

          ctx.fillStyle = isEmg ? '#ef4444' : '#ffffff';
          ctx.font = 'bold 8px monospace';
          ctx.fillText(p.call, p.x + 11, p.y - 1);

          ctx.fillStyle = isEmg ? '#fca5a5' : '#34d399';
          ctx.font = '7px monospace';
          ctx.fillText(`${p.alt} ${p.spd}`, p.x + 11, p.y + 7);
        });

        // Bottom Telemetry Footer
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 222, 320, 18);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px monospace';
        ctx.fillText('TARGETS: 7 | HOME: 37.77°N 122.42°W | RANGE: 100 NM', 8, 234);
      } else if (state.activeApp === 'capture') {
        // Raw C16 IQ Capture Screen
        ctx.fillStyle = '#ef4444';
        ctx.font = 'bold 14px monospace';
        const pulse = Math.sin(tick * 0.1) > 0;
        if (pulse) {
          ctx.beginPath();
          ctx.arc(20, 45, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillText('REC // RAW C16 IQ CAPTURE', 35, 50);

        ctx.fillStyle = '#e2e8f0';
        ctx.font = '10px monospace';
        ctx.fillText('Target File: /CAPTURES/20261022_433M92.C16', 20, 80);
        ctx.fillText(`Center Freq: ${(state.frequency / 1000000).toFixed(4)} MHz`, 20, 100);
        ctx.fillText(`Sample Rate: ${(state.sampleRate / 1000000).toFixed(1)} MSPS (Complex Signed 16-bit)`, 20, 120);
        ctx.fillText('Buffer Fill: 18% [========                  ]', 20, 140);
        ctx.fillText('Data Rate: 8.0 MB/s to SD Card (FAT32)', 20, 160);
        ctx.fillText('Free Space: 14.2 GB (~29 minutes capacity)', 20, 180);

        ctx.fillStyle = '#06b6d4';
        ctx.fillText('Press SELECT or BACK to stop and flush to SD card.', 20, 220);
      } else {
        // Generic App View
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 14px monospace';
        ctx.fillText(`APP: ${state.activeApp.toUpperCase()}`, 20, 50);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px monospace';
        ctx.fillText('PortaPack active. Listening for sub-GHz RF frames.', 20, 80);
        ctx.fillText(`Frequency: ${(state.frequency / 1000000).toFixed(4)} MHz`, 20, 105);
        ctx.fillText('Press [BACK] button to return to App Launcher.', 20, 140);
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(animId);
    };
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
              {state.firmwareVersion || (state.isDemo ? 'Mayhem v2.0.0' : 'Mayhem (version unknown)')}
            </span>
            <StatusBadge status={state.isDemo ? 'warning' : 'success'} label={state.isDemo ? 'DEMO' : 'CONNECTED'} />
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
            <CheckCircle2 className={`w-3.5 h-3.5 flex-shrink-0 ${state.isConnected && !state.isDemo ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span>
              {state.isDemo ? 'Demo (no device)'
                : !state.isConnected ? 'Not connected'
                : state.connectionType === 'serial' ? 'Mayhem serial console (1D50:6018)'
                : 'HackRF One (1D50:6089 WinUSB)'}
            </span>
          </div>

          {!state.isDemo ? (
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
            onClick={() => {
              setConnectError(null);
              driver.connectDemo();
            }}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-400 border border-slate-700 rounded text-xs font-mono transition flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" /> Demo
          </button>

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
              ) : state.isDemo ? (
                <>
                  <span>BAT: {state.batteryMv}mV (demo)</span>
                  <span>•</span>
                  <span>SD: FAT32 (demo)</span>
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
              waterfallCanvasRef={waterfallCanvasRef}
            />
          )}

          {/* Subtab: HAM Radio & Digital Decoders (RocketGod Port) */}
          {activeTab === 'ham' && (
            <div className="flex-1">
              <HamRadioDeck
                driver={driver}
                isDemo={state.isDemo}
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
                isDemo={state.isDemo}
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
                isDemo={state.isDemo}
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
