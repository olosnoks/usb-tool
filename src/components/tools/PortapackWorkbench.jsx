import { useState, useEffect, useRef } from 'react';
import {
  Radio,
  RotateCcw,
  Terminal as TerminalIcon,
  Disc,
  Zap,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  ExternalLink,
  Flame,
  Monitor
} from 'lucide-react';
import { MayhemPortaPackDriver } from '../../utils/mayhemDriver';
import TacticalMapDeck from './TacticalMapDeck';
import ReceiverDeck from './hackrf/ReceiverDeck';
import StatusBadge from '../common/StatusBadge';
import FreqmanView from './portapack/FreqmanView';
import CaptureView from './portapack/CaptureView';
import CliView from './portapack/CliView';

// Tabs kept out of the UI until they do something real over USB:
//   - 'ham' (HamRadioDeck): FT8/PSK/RTTY/CW decoders are not implemented.
//   - 'sensors' (SensorHubDeck): rtl_433-style sensor decoding is not implemented.
//   - 'tx' (TxView): there is no transmit path; the old button only ran a timer.
// The components still exist under tools/hackrf and tools/portapack.
export const HIDDEN_TABS = ['ham', 'sensors', 'tx'];

export default function PortapackWorkbench() {
  const [driver] = useState(() => new MayhemPortaPackDriver());
  const [state, setState] = useState(() => ({
    isConnected: false,
    connectionType: null,
    frequency: 433920000,
    channelOffsetHz: 0,
    amp: 0,
    lnaGain: 24,
    vgaGain: 24,
    agcEnabled: false,
    sampleRate: 2000000,
    capturing: false,
    activeApp: 'menu',
    selectedMenuIndex: 0,
    firmwareVersion: null,
    boardId: null,
    boardRev: null,
    cpldVersion: null,
    batteryMv: null,
    sdCardMounted: null,
    sdCardFreeGb: null,
    rssi: -120
  }));

  const [activeTab, setActiveTab] = useState('receiver'); // receiver, map, freqman, capture, cli
  const [customFreqInput, setCustomFreqInput] = useState('433.920');
  const [customMod, setCustomMod] = useState('NFM');
  const [customLabel, setCustomLabel] = useState('Car Key Fob');
  const [cliInput, setCliInput] = useState('');
  const [logs, setLogs] = useState([]);
  const [connectError, setConnectError] = useState(null);
  const [connectDetails, setConnectDetails] = useState([]);
  const failConnect = (err) => {
    setConnectError(err.message);
    setConnectDetails(driver.logs.filter((l) => l.type === 'warning' || l.type === 'error').slice(-8).map((l) => l.text));
  };
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

  const canvasRef = useRef(null);
  const logContainerRef = useRef(null);

  // Driver state + log subscriptions.
  useEffect(() => {
    driver.onStateChangeCallback = (s) => setState({ ...s });
    driver.onLogCallback = (log) => {
      setLogs(prev => [...prev.slice(-100), log]);
    };
    return () => {
      driver.onStateChangeCallback = null;
      driver.onLogCallback = null;
      driver.disconnect();
    };
  }, [driver]);

  // Scroll logs
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

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

  // Tune the LO and listen right there (clears any channel offset).
  const tuneTo = (hz) => { driver.sendCommand(`freq ${Math.round(hz)}`); driver.setChannelOffset(0); };

  const handleTunePreset = (preset) => {
    tuneTo(preset.freq);
    driver.log(`Tuned preset: ${preset.label} (${preset.mod})`, 'success');
    setActiveTab('receiver');
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
                    failConnect(err);
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
                    failConnect(err);
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
                WebUSB: unplug and replug the HackRF (on a PortaPack, re-enter HackRF mode), close SDR# / SDR++ / hackrf_* tools, then Connect WebUSB again. COM Port: pick the PortaPack's COM port and make sure no terminal has it open.
              </div>
              {connectDetails.length > 0 && (
                <div className="mt-2 text-[10px] text-rose-200/80 space-y-0.5 border-t border-rose-500/20 pt-1.5">
                  {connectDetails.map((t, i) => <div key={i}>{t}</div>)}
                </div>
              )}
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
              { id: 'receiver', name: 'Receiver: Spectrum, Audio & Sweep', icon: Flame },
              { id: 'map', name: 'Tactical Map (ADS-B)', icon: MapPin },
              { id: 'freqman', name: 'FREQMAN (SD Cards)', icon: FileText },
              { id: 'capture', name: 'IQ Recorder', icon: Disc },
              { id: 'cli', name: 'Console & Log', icon: TerminalIcon }
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

          {/* The receiver stays mounted so the waterfall history, audio and a
              running sweep survive a visit to another tab. */}
          <div className={activeTab === 'receiver' ? 'flex-1' : 'hidden'}>
            <ReceiverDeck driver={driver} state={state} />
          </div>

          {activeTab === 'map' && (
            <div className="flex-1">
              <TacticalMapDeck
                centerFreq={state.frequency}
                onTuneFreq={(hz) => tuneTo(hz)}
              />
            </div>
          )}

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

          {activeTab === 'capture' && (
            <CaptureView driver={driver} state={state} />
          )}

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
