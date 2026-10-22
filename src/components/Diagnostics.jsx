import React, { useState, useRef } from 'react';
import { 
  Radar, 
  Zap, 
  Cpu, 
  RotateCcw, 
  Play, 
  Square, 
  CheckCircle2, 
  Flame, 
  Clock, 
  Activity,
  ArrowRight,
  Terminal,
  HelpCircle
} from 'lucide-react';
import { CANDIDATE_BAUD_RATES, evaluateSample } from '../utils/baudScanner';

export default function Diagnostics({
  isConnected,
  currentBaudRate,
  onBaudRateChange,
  onRunBaudScan, // function(baud): Promise<Uint8Array>
  onSendRawByte, // function(Uint8Array): Promise<void>
  onSetSignals,  // function({ dtr, rts, break }): Promise<void>
  onLogMessage
}) {
  const [activeTab, setActiveTab] = useState('baud-hunter'); // 'baud-hunter' | 'uboot-spammer' | 'esp32-strap' | 'uart-break'

  // Baud Hunter State
  const [isScanningBaud, setIsScanningBaud] = useState(false);
  const [currentScanningBaud, setCurrentScanningBaud] = useState(null);
  const [baudResults, setBaudResults] = useState([]);
  const [probeMode, setProbeMode] = useState('active'); // 'active' (sends \r\n) or 'passive'
  const isScanningBaudRef = useRef(false);

  // U-Boot Spammer State
  const [isSpamming, setIsSpamming] = useState(false);
  const [spamChar, setSpamChar] = useState('space'); // 'space' | 'enter' | 'ctrl-c' | 'esc' | 'custom'
  const [customSpam, setCustomSpam] = useState('s');
  const [spamIntervalMs, setSpamIntervalMs] = useState(20); // 20ms burst loop as requested
  const [spamCount, setSpamCount] = useState(0);
  const spamIntervalRef = useRef(null);

  // ESP32 Strapping State
  const [isStrapping, setIsStrapping] = useState(false);
  const [strapStep, setStrapStep] = useState(0);
  const [invertLogic, setInvertLogic] = useState(false);

  // UART Break State
  const [breakDurationMs, setBreakDurationMs] = useState(250);
  const [isBreaking, setIsBreaking] = useState(false);

  // 1. Baud Hunter Logic
  const startBaudHunt = async () => {
    if (!isConnected) {
      alert('Please connect to a serial port first to run the Baud Rate Hunter.');
      return;
    }

    setIsScanningBaud(true);
    isScanningBaudRef.current = true;
    setBaudResults([]);
    onLogMessage?.('[BAUD HUNTER] Starting automated baud scan across 9 standard rates...', 'sys');

    const results = [];

    for (const baud of CANDIDATE_BAUD_RATES) {
      if (!isScanningBaudRef.current) {
        onLogMessage?.('[BAUD HUNTER] Scan canceled by user.', 'sys');
        break;
      }

      setCurrentScanningBaud(baud);
      try {
        const sampleBytes = await onRunBaudScan(baud, probeMode === 'active');
        const evalResult = evaluateSample(sampleBytes);
        
        const entry = {
          baud,
          byteCount: sampleBytes ? sampleBytes.length : 0,
          printableRatio: evalResult.printableRatio,
          entropy: evalResult.entropy,
          confidence: evalResult.confidence,
          verdict: evalResult.verdict,
          previewText: evalResult.previewText
        };
        
        results.push(entry);
        setBaudResults([...results]);
      } catch (err) {
        console.error(`Error scanning at ${baud}:`, err);
      }
    }

    setIsScanningBaud(false);
    isScanningBaudRef.current = false;
    setCurrentScanningBaud(null);
    onLogMessage?.('[BAUD HUNTER] Scan cycle completed.', 'sys');
  };

  const stopBaudHunt = () => {
    isScanningBaudRef.current = false;
    setIsScanningBaud(false);
  };

  // 2. U-Boot Spammer Logic
  const startSpammer = () => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }

    let payload;
    if (spamChar === 'space') payload = new Uint8Array([0x20]);
    else if (spamChar === 'enter') payload = new Uint8Array([0x0D, 0x0A]);
    else if (spamChar === 'ctrl-c') payload = new Uint8Array([0x03]);
    else if (spamChar === 'esc') payload = new Uint8Array([0x1B]);
    else payload = new TextEncoder().encode(customSpam || ' ');

    setIsSpamming(true);
    setSpamCount(0);
    onLogMessage?.(`[U-BOOT SPAMMER] Starting ${spamIntervalMs}ms burst loop to halt bootloader...`, 'sys');

    let count = 0;
    spamIntervalRef.current = setInterval(async () => {
      try {
        await onSendRawByte(payload);
        count++;
        setSpamCount(count);
      } catch (err) {
        console.error(err);
        stopSpammer();
      }
    }, spamIntervalMs);
  };

  const stopSpammer = () => {
    if (spamIntervalRef.current) {
      clearInterval(spamIntervalRef.current);
      spamIntervalRef.current = null;
    }
    setIsSpamming(false);
    onLogMessage?.(`[U-BOOT SPAMMER] Stopped after sending ${spamCount} interrupts.`, 'sys');
  };

  // 3. ESP32 Bootloader Strapping Sequence
  const triggerEsp32Strapping = async () => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }

    setIsStrapping(true);
    setStrapStep(1);
    onLogMessage?.('[ESP32 STRAP] Commencing hardware bootloader strapping sequence...', 'sys');

    try {
      // Step 1: Assert Reset (RTS=1, DTR=0)
      setStrapStep(1);
      await onSetSignals({
        requestToSend: !invertLogic ? true : false,
        dataTerminalReady: !invertLogic ? false : true
      });
      await new Promise(r => setTimeout(r, 100));

      // Step 2: Pull GPIO0 low while releasing Reset (RTS=0, DTR=1)
      setStrapStep(2);
      await onSetSignals({
        requestToSend: !invertLogic ? false : true,
        dataTerminalReady: !invertLogic ? true : false
      });
      await new Promise(r => setTimeout(r, 80));

      // Step 3: Release GPIO0 (DTR=0)
      setStrapStep(3);
      await onSetSignals({
        dataTerminalReady: !invertLogic ? false : true
      });
      await new Promise(r => setTimeout(r, 50));

      setStrapStep(4);
      onLogMessage?.('[ESP32 STRAP] ESP32 strapping pulse complete. Device ready in ROM bootloader.', 'sys');
    } catch (err) {
      console.error(err);
      onLogMessage?.(`[ESP32 STRAP ERROR] ${err.message}`, 'sys');
    } finally {
      setTimeout(() => {
        setIsStrapping(false);
        setStrapStep(0);
      }, 1200);
    }
  };

  // 4. Sustained UART Break
  const triggerUartBreak = async () => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }

    setIsBreaking(true);
    onLogMessage?.(`[UART BREAK] Asserting sustained ${breakDurationMs}ms line break...`, 'sys');
    try {
      await onSetSignals({ break: true });
      await new Promise(r => setTimeout(r, breakDurationMs));
      await onSetSignals({ break: false });
      onLogMessage?.('[UART BREAK] Line break released.', 'sys');
    } catch (err) {
      console.error(err);
      onLogMessage?.(`[UART BREAK ERROR] ${err.message}`, 'sys');
    } finally {
      setIsBreaking(false);
    }
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Radar className="w-4 h-4 text-cyber-amber" />
          <h2 className="font-bold text-slate-100 tracking-wider">REVERSE-ENGINEERING DIAGNOSTICS</h2>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
          <button
            onClick={() => setActiveTab('baud-hunter')}
            className={`px-2.5 py-1 rounded font-bold transition-all ${
              activeTab === 'baud-hunter' ? 'bg-amber-500/20 text-cyber-amber' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Baud Hunter
          </button>
          <button
            onClick={() => setActiveTab('uboot-spammer')}
            className={`px-2.5 py-1 rounded font-bold transition-all ${
              activeTab === 'uboot-spammer' ? 'bg-rose-500/20 text-rose-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            U-Boot Spammer
          </button>
          <button
            onClick={() => setActiveTab('esp32-strap')}
            className={`px-2.5 py-1 rounded font-bold transition-all ${
              activeTab === 'esp32-strap' ? 'bg-cyan-500/20 text-cyber-cyan' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ESP32 Strap
          </button>
          <button
            onClick={() => setActiveTab('uart-break')}
            className={`px-2.5 py-1 rounded font-bold transition-all ${
              activeTab === 'uart-break' ? 'bg-purple-500/20 text-purple-400' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            UART Break
          </button>
        </div>
      </div>

      {/* Tab 1: Automated Baud Rate Hunter */}
      {activeTab === 'baud-hunter' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-slate-400 text-[11px]">
              Sweeps 9600 to 921600 bps, sampling serial bytes and computing printable ASCII % & Shannon entropy.
            </p>
            <div className="flex items-center gap-2">
              <select
                value={probeMode}
                onChange={(e) => setProbeMode(e.target.value)}
                disabled={isScanningBaud}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-300 outline-none"
              >
                <option value="active">Active Probe (\r\n Ping)</option>
                <option value="passive">Passive Listening</option>
              </select>

              {!isScanningBaud ? (
                <button
                  onClick={startBaudHunt}
                  disabled={!isConnected}
                  className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold px-3 py-1 rounded text-xs shadow-amber-glow disabled:opacity-50"
                >
                  <Radar className="w-3.5 h-3.5" />
                  <span>START SCAN</span>
                </button>
              ) : (
                <button
                  onClick={stopBaudHunt}
                  className="flex items-center gap-1.5 bg-rose-500/30 text-rose-300 border border-rose-500/50 px-3 py-1 rounded text-xs"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>ABORT SCAN</span>
                </button>
              )}
            </div>
          </div>

          {/* Progress / Status banner */}
          {isScanningBaud && (
            <div className="bg-amber-950/20 border border-amber-500/40 rounded-lg p-2 flex items-center justify-between text-xs text-cyber-amber animate-pulse">
              <span>SCANNING FREQUENCY: <strong className="text-white text-sm">{currentScanningBaud} bps</strong></span>
              <span>Sampling Entropy...</span>
            </div>
          )}

          {/* Results Table */}
          <div className="overflow-x-auto border border-slate-800 rounded-lg bg-slate-950">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-[#090e1a] text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-800">
                <tr>
                  <th className="py-1.5 px-3">Baud Rate</th>
                  <th className="py-1.5 px-3">Bytes Read</th>
                  <th className="py-1.5 px-3">Printable ASCII</th>
                  <th className="py-1.5 px-3">Shannon Entropy</th>
                  <th className="py-1.5 px-3">Confidence</th>
                  <th className="py-1.5 px-3">Sample Preview</th>
                  <th className="py-1.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {baudResults.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-slate-600">
                      No scan data. Click "START SCAN" to begin automated baud hunting.
                    </td>
                  </tr>
                ) : (
                  baudResults.map((r) => {
                    const isWinner = r.confidence >= 70;
                    return (
                      <tr 
                        key={r.baud} 
                        className={`hover:bg-slate-900/60 transition-colors ${
                          isWinner ? 'bg-emerald-950/20' : ''
                        }`}
                      >
                        <td className="py-2 px-3 font-bold text-slate-200">
                          {r.baud} bps
                        </td>
                        <td className="py-2 px-3 text-slate-400">
                          {r.byteCount} B
                        </td>
                        <td className="py-2 px-3">
                          <span className={r.printableRatio > 70 ? 'text-cyber-emerald font-bold' : 'text-slate-400'}>
                            {r.printableRatio}%
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-300">
                          {r.entropy} bits/B
                        </td>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            r.confidence >= 80 ? 'bg-emerald-500/20 text-cyber-emerald border border-emerald-500/40' :
                            r.confidence >= 50 ? 'bg-amber-500/20 text-cyber-amber border border-amber-500/40' :
                            'bg-slate-800 text-slate-500'
                          }`}>
                            {r.confidence}% {r.verdict}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-400 font-mono text-[10px] max-w-[180px] truncate">
                          {r.previewText || '—'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            onClick={() => onBaudRateChange(r.baud)}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-cyber-amber hover:text-slate-950 text-slate-300 font-bold transition-all text-[10px]"
                          >
                            Apply
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: High-Frequency U-Boot Spammer */}
      {activeTab === 'uboot-spammer' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <p className="text-slate-400 text-[11px]">
            Transmits high-frequency characters in a 20ms burst loop to catch bootloader autoboot countdowns (e.g. Das U-Boot, RedBoot, CFE, OpenWrt).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Character Selector */}
            <div>
              <label className="text-slate-400 block mb-1">Interrupt Key / Character</label>
              <select
                value={spamChar}
                onChange={(e) => setSpamChar(e.target.value)}
                disabled={isSpamming}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 outline-none"
              >
                <option value="space">Spacebar (0x20 - Standard U-Boot)</option>
                <option value="enter">Enter / Return (\r\n)</option>
                <option value="ctrl-c">Ctrl + C (0x03 Abort)</option>
                <option value="esc">Escape (0x1B)</option>
                <option value="custom">Custom String</option>
              </select>
            </div>

            {/* Custom Input */}
            {spamChar === 'custom' && (
              <div>
                <label className="text-slate-400 block mb-1">Custom Payload</label>
                <input
                  type="text"
                  value={customSpam}
                  onChange={(e) => setCustomSpam(e.target.value)}
                  disabled={isSpamming}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 outline-none"
                />
              </div>
            )}

            {/* Interval Burst Rate */}
            <div>
              <label className="text-slate-400 block mb-1">Burst Frequency</label>
              <select
                value={spamIntervalMs}
                onChange={(e) => setSpamIntervalMs(Number(e.target.value))}
                disabled={isSpamming}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 outline-none"
              >
                <option value={10}>10 ms (Extreme 100 Hz)</option>
                <option value={20}>20 ms (50 Hz - Standard)</option>
                <option value={50}>50 ms (20 Hz)</option>
                <option value={100}>100 ms (10 Hz)</option>
              </select>
            </div>
          </div>

          {/* Action & Live Counter */}
          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              {!isSpamming ? (
                <button
                  onClick={startSpammer}
                  disabled={!isConnected}
                  className="flex items-center gap-2 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold px-4 py-2 rounded-lg text-xs tracking-wider shadow-rose-glow disabled:opacity-50"
                >
                  <Flame className="w-4 h-4" />
                  <span>START U-BOOT SPAMMER BURST</span>
                </button>
              ) : (
                <button
                  onClick={stopSpammer}
                  className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-rose-400 border border-rose-500/50 font-bold px-4 py-2 rounded-lg text-xs"
                >
                  <Square className="w-4 h-4 fill-current" />
                  <span>STOP BURST SPAM</span>
                </button>
              )}
            </div>

            {isSpamming && (
              <div className="flex items-center gap-2 text-rose-400 animate-pulse font-bold">
                <Activity className="w-4 h-4 animate-spin" />
                <span>BURSTING: {spamCount} packets sent @ {1000 / spamIntervalMs} Hz</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: ESP32 Hardware Bootloader Strapping Sequence */}
      {activeTab === 'esp32-strap' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <p className="text-slate-400 text-[11px]">
            Automated DTR / RTS pulse state machine for ESP32/ESP8266 auto-reset transistor strapping circuits (EN + GPIO0) to force ROM bootloader mode.
          </p>

          {/* State Machine Steps Visualizer */}
          <div className="grid grid-cols-4 gap-2 py-2">
            <div className={`p-2 rounded-lg border text-center transition-all ${
              strapStep === 1 ? 'bg-amber-500/20 border-cyber-amber text-cyber-amber shadow-amber-glow' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}>
              <div className="font-bold text-[10px]">STEP 1</div>
              <div className="text-[11px] font-semibold">EN Low (Reset)</div>
              <div className="text-[9px] text-slate-400">RTS=1, DTR=0</div>
            </div>

            <div className={`p-2 rounded-lg border text-center transition-all ${
              strapStep === 2 ? 'bg-amber-500/20 border-cyber-amber text-cyber-amber shadow-amber-glow' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}>
              <div className="font-bold text-[10px]">STEP 2</div>
              <div className="text-[11px] font-semibold">GPIO0 Low</div>
              <div className="text-[9px] text-slate-400">RTS=0, DTR=1</div>
            </div>

            <div className={`p-2 rounded-lg border text-center transition-all ${
              strapStep === 3 ? 'bg-amber-500/20 border-cyber-amber text-cyber-amber shadow-amber-glow' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}>
              <div className="font-bold text-[10px]">STEP 3</div>
              <div className="text-[11px] font-semibold">Release IO0</div>
              <div className="text-[9px] text-slate-400">DTR=0</div>
            </div>

            <div className={`p-2 rounded-lg border text-center transition-all ${
              strapStep === 4 ? 'bg-emerald-500/20 border-cyber-emerald text-cyber-emerald' : 'bg-slate-950 border-slate-800 text-slate-500'
            }`}>
              <div className="font-bold text-[10px]">STEP 4</div>
              <div className="text-[11px] font-semibold">Bootloader Ready</div>
              <div className="text-[9px] text-emerald-400">Waiting for Sync</div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <label className="flex items-center gap-2 cursor-pointer text-slate-400 text-[11px]">
              <input
                type="checkbox"
                checked={invertLogic}
                onChange={(e) => setInvertLogic(e.target.checked)}
                className="rounded bg-slate-900 border-slate-700 text-cyber-amber"
              />
              <span>Invert DTR / RTS Line Polarity (for non-standard / custom programmer circuits)</span>
            </label>

            <button
              onClick={triggerEsp32Strapping}
              disabled={isStrapping || !isConnected}
              className="flex items-center gap-2 bg-gradient-to-r from-cyan-600 to-cyan-700 hover:from-cyan-500 hover:to-cyan-600 text-slate-950 font-bold px-4 py-2 rounded-lg text-xs shadow-cyan-glow disabled:opacity-50"
            >
              <Cpu className={`w-4 h-4 ${isStrapping ? 'animate-spin' : ''}`} />
              <span>{isStrapping ? 'PULSING STRAP SEQUENCE...' : 'EXECUTE ESP32 BOOTLOADER RESET'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Tab 4: Sustained UART Break */}
      {activeTab === 'uart-break' && (
        <div className="space-y-3 animate-in fade-in duration-150">
          <p className="text-slate-400 text-[11px]">
            Asserts a continuous break condition on the UART Tx line (marking line at space level / 0V), triggering boot roms, console debuggers, and Magic SysRq triggers.
          </p>

          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="text-slate-400 block mb-1">Break Duration (Milliseconds)</label>
              <div className="flex gap-2">
                {[100, 250, 500, 1000].map(duration => (
                  <button
                    key={duration}
                    onClick={() => setBreakDurationMs(duration)}
                    className={`flex-1 py-1.5 rounded border text-center transition-all ${
                      breakDurationMs === duration
                        ? 'bg-purple-500/20 text-purple-300 border-purple-500/50 font-bold'
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {duration} ms {duration === 250 ? '(Standard)' : ''}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={triggerUartBreak}
              disabled={isBreaking || !isConnected}
              className={`mt-4 flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-xs tracking-wider uppercase transition-all border ${
                isBreaking
                  ? 'bg-purple-500/30 text-purple-200 border-purple-400 animate-pulse'
                  : 'bg-purple-600 hover:bg-purple-500 text-white border-purple-500'
              } disabled:opacity-50`}
            >
              <Zap className="w-4 h-4" />
              <span>{isBreaking ? 'ASSERTING BREAK...' : 'ASSERT UART BREAK'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
