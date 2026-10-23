import React, { useState, useRef, useEffect } from 'react';
import { 
  Sliders, 
  Zap, 
  RotateCcw, 
  Play, 
  Square, 
  ShieldAlert, 
  Cpu, 
  Flame, 
  Activity, 
  CheckCircle2, 
  AlertTriangle,
  Clock,
  Terminal,
  Layers,
  ArrowRight
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { 
  triggerEspBootloader, 
  triggerEspNormalReset, 
  assertUartBreak 
} from '../../utils/serialSignals';
import StatusBadge from '../common/StatusBadge';

const COMMON_PROMPTS = ['=>', 'u-boot>', 'cfe>', 'redboot>', '# ', '$ '];

export default function HardwareControlsTab() {
  const {
    isConnected,
    port,
    hardwareSignals,
    toggleSignal,
    assertBreak,
    sendRawBytes,
    sendString,
    addLog,
    latestRxText
  } = useSerial();

  // Strapping Timing State
  const [resetDurationMs, setResetDurationMs] = useState(150);
  const [bootHoldDurationMs, setBootHoldDurationMs] = useState(50);
  const [isStrapping, setIsStrapping] = useState(false);
  const [strapMessage, setStrapMessage] = useState('');

  // UART Break State
  const [breakDurationMs, setBreakDurationMs] = useState(250);
  const [isBreaking, setIsBreaking] = useState(false);

  // U-Boot Interrupt Spammer State
  const [isSpamming, setIsSpamming] = useState(false);
  const [spamChar, setSpamChar] = useState('space'); // 'space' | 'enter' | 'ctrl-c' | 'esc' | 'custom'
  const [customSpam, setCustomSpam] = useState('s');
  const [spamIntervalMs, setSpamIntervalMs] = useState(25);
  const [spamCount, setSpamCount] = useState(0);
  const [capturedPrompt, setCapturedPrompt] = useState(null);
  const spamIntervalRef = useRef(null);

  // Auto-Prompt Detection while spamming
  useEffect(() => {
    if (!isSpamming || !latestRxText) return;

    const lower = latestRxText.toLowerCase().trim();
    for (const p of COMMON_PROMPTS) {
      if (lower.endsWith(p)) {
        setCapturedPrompt(p);
        stopSpammer();
        addLog(`[U-BOOT TRIAGE] Autoboot successfully halted! Caught prompt: "${p}"`, 'sys');
        break;
      }
    }
  }, [latestRxText, isSpamming, addLog]);

  // Trigger ESP32 Bootloader Strapping Sequence
  const handleTriggerBootloader = async () => {
    if (!isConnected || !port) {
      alert('Please connect to a serial port first.');
      return;
    }

    setIsStrapping(true);
    setStrapMessage('Holding EN & IO0 low...');
    addLog(`[HARDWARE] Commencing bootloader strapping (EN: ${resetDurationMs}ms, IO0: ${bootHoldDurationMs}ms)...`, 'sys');

    try {
      await triggerEspBootloader(port, resetDurationMs, bootHoldDurationMs);
      setStrapMessage('Strapping sequence asserted!');
      addLog('[HARDWARE] Chip successfully placed in ROM bootloader mode.', 'sys');
    } catch (err) {
      console.error(err);
      setStrapMessage(`Error: ${err.message}`);
      addLog(`[HARDWARE ERROR] ${err.message}`, 'sys');
    } finally {
      setTimeout(() => {
        setIsStrapping(false);
        setStrapMessage('');
      }, 1500);
    }
  };

  // Normal Hard Reset / Reboot
  const handleNormalReset = async () => {
    if (!isConnected || !port) {
      alert('Please connect to a serial port first.');
      return;
    }

    addLog('[HARDWARE] Pulse reset EN low -> Rebooting to normal application...', 'sys');
    try {
      await triggerEspNormalReset(port, 120);
      addLog('[HARDWARE] Reset released. Device executing user application.', 'sys');
    } catch (err) {
      addLog(`[HARDWARE ERROR] Reset failed: ${err.message}`, 'sys');
    }
  };

  // Assert UART Break
  const handleAssertBreak = async () => {
    if (!isConnected || !port) {
      alert('Please connect to a serial port first.');
      return;
    }

    setIsBreaking(true);
    addLog(`[HARDWARE] Asserting UART line break for ${breakDurationMs}ms...`, 'sys');
    try {
      await assertUartBreak(port, breakDurationMs);
      addLog('[HARDWARE] UART break condition cleared.', 'sys');
    } catch (err) {
      addLog(`[HARDWARE ERROR] Break failed: ${err.message}`, 'sys');
    } finally {
      setIsBreaking(false);
    }
  };

  // Start U-Boot Interrupt Spammer
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
    setCapturedPrompt(null);
    addLog(`[U-BOOT SPAMMER] Starting ${spamIntervalMs}ms burst cycle to halt autoboot...`, 'sys');

    let count = 0;
    spamIntervalRef.current = setInterval(async () => {
      try {
        await sendRawBytes(payload);
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
  };

  // U-Boot Root Bypass
  const handleBypassPassword = async () => {
    if (!isConnected) return;
    addLog('[U-BOOT TRIAGE] Injecting single-user root shell args (init=/bin/sh)...', 'sys');
    await sendString('setenv bootargs "${bootargs} init=/bin/sh"', '\n');
    await new Promise(r => setTimeout(r, 200));
    await sendString('boot', '\n');
    addLog('[U-BOOT TRIAGE] Boot command executed. Target should drop to root shell #', 'sys');
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* 1. Hardware Strapping Timing Controls */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-bold text-slate-100">
              HARDWARE STRAPPING TIMING CONTROLS (ESP32 / BOOTLOADER)
            </h2>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-400 font-bold">
            Jitter-Free Precision
          </span>
        </div>

        <p className="text-[11px] text-slate-400 pt-2 leading-relaxed">
          Configurable millisecond pulse timings eliminate browser event-loop jitter when driving DTR (IO0) and RTS (EN) lines to reliably place the microcontroller in ROM download mode.
        </p>

        {/* Sliders Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
          {/* Slider 1: Reset Hold Duration */}
          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">Reset Hold Duration (ms)</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                {resetDurationMs} ms
              </span>
            </div>
            <input
              type="range"
              min="50"
              max="500"
              step="10"
              value={resetDurationMs}
              onChange={(e) => setResetDurationMs(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>50 ms (Fast)</span>
              <span>150 ms (Default)</span>
              <span>500 ms (Long)</span>
            </div>
          </div>

          {/* Slider 2: Boot Pin Hold Duration */}
          <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-300">Boot Pin Hold Duration (ms)</span>
              <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40">
                {bootHoldDurationMs} ms
              </span>
            </div>
            <input
              type="range"
              min="20"
              max="250"
              step="5"
              value={bootHoldDurationMs}
              onChange={(e) => setBootHoldDurationMs(Number(e.target.value))}
              className="w-full accent-cyan-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500">
              <span>20 ms (Short)</span>
              <span>50 ms (Default)</span>
              <span>250 ms (Extended)</span>
            </div>
          </div>
        </div>

        {/* Pulse Sequence Visualizer */}
        <div className="mt-3 bg-slate-950/60 p-2.5 rounded-lg border border-slate-850 flex items-center justify-between text-[10px] text-slate-400 overflow-x-auto">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-300">STRAPPING SEQUENCE:</span>
            <span className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400">1. EN=LOW, IO0=LOW</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-1.5 py-0.5 rounded bg-slate-900 text-amber-300 font-semibold">2. EN=HIGH (Release Reset)</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300 font-semibold">3. IO0=HIGH (Idle)</span>
          </div>

          {strapMessage && (
            <span className="text-emerald-400 font-bold animate-pulse">{strapMessage}</span>
          )}
        </div>

        {/* Action Triggers */}
        <div className="flex flex-wrap items-center gap-3 pt-3">
          <button
            onClick={handleTriggerBootloader}
            disabled={isStrapping || !isConnected}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-extrabold text-xs shadow-emerald-glow disabled:opacity-50 transition-all active:scale-95"
          >
            <Zap className={`w-4 h-4 ${isStrapping ? 'animate-bounce' : ''}`} />
            <span>TRIGGER ESP32 BOOTLOADER MODE</span>
          </button>

          <button
            onClick={handleNormalReset}
            disabled={!isConnected}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 hover:border-amber-400 font-bold text-xs transition-all active:scale-95 disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>NORMAL REBOOT TO APP</span>
          </button>
        </div>
      </div>

      {/* 2. Manual DTR / RTS Toggles & Live UART Pin Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Output Controls */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <h3 className="font-bold text-slate-100 text-xs flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>MANUAL UART PIN TOGGLES (OUTPUTS)</span>
            </h3>
            <span className="text-[10px] text-slate-500">DTR / RTS / BREAK</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {/* DTR Toggle */}
            <button
              onClick={() => toggleSignal('dtr')}
              disabled={!isConnected}
              className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 font-bold transition-all disabled:opacity-50 ${
                hardwareSignals.dtr
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-amber-glow'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${hardwareSignals.dtr ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' : 'bg-slate-700'}`} />
                <span className="text-sm">DTR PIN</span>
              </div>
              <span className="text-[10px] font-mono opacity-80">
                STATE: {hardwareSignals.dtr ? 'ASSERTED (HIGH)' : 'IDLE (LOW)'}
              </span>
            </button>

            {/* RTS Toggle */}
            <button
              onClick={() => toggleSignal('rts')}
              disabled={!isConnected}
              className={`p-3 rounded-xl border flex flex-col items-center justify-center gap-1.5 font-bold transition-all disabled:opacity-50 ${
                hardwareSignals.rts
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60 shadow-cyan-glow'
                  : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${hardwareSignals.rts ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-slate-700'}`} />
                <span className="text-sm">RTS PIN</span>
              </div>
              <span className="text-[10px] font-mono opacity-80">
                STATE: {hardwareSignals.rts ? 'ASSERTED (HIGH)' : 'IDLE (LOW)'}
              </span>
            </button>
          </div>

          {/* UART Break Controls */}
          <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800 flex flex-col gap-2 mt-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-bold">UART Line Break:</span>
              <span className="text-rose-400 font-bold">{breakDurationMs} ms</span>
            </div>
            <input
              type="range"
              min="50"
              max="1000"
              step="25"
              value={breakDurationMs}
              onChange={(e) => setBreakDurationMs(Number(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer"
            />
            <button
              onClick={handleAssertBreak}
              disabled={isBreaking || !isConnected}
              className="w-full py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 hover:border-rose-400 font-bold text-xs transition-all active:scale-95 disabled:opacity-50"
            >
              {isBreaking ? 'ASSERTING LINE BREAK...' : `ASSERT ${breakDurationMs}ms UART BREAK`}
            </button>
          </div>
        </div>

        {/* Input Signals Monitor */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <h3 className="font-bold text-slate-100 text-xs flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>LIVE HARDWARE INPUT SIGNALS (POLL)</span>
            </h3>
            <span className="text-[10px] text-slate-500">250ms interval</span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 pt-1">
            {[
              { id: 'cts', name: 'CTS', desc: 'Clear to Send', active: hardwareSignals.cts },
              { id: 'dsr', name: 'DSR', desc: 'Data Set Ready', active: hardwareSignals.dsr },
              { id: 'dcd', name: 'DCD', desc: 'Carrier Detect', active: hardwareSignals.dcd },
              { id: 'ri', name: 'RI', desc: 'Ring Indicator', active: hardwareSignals.ri }
            ].map((sig) => (
              <div
                key={sig.id}
                className={`p-3 rounded-xl border flex flex-col justify-between transition-all ${
                  sig.active 
                    ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/50 shadow-emerald-glow' 
                    : 'bg-slate-950 text-slate-500 border-slate-800'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">{sig.name}</span>
                  <span className={`w-2 h-2 rounded-full ${sig.active ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-800'}`} />
                </div>
                <div className="text-[10px] mt-1 text-slate-400">
                  {sig.desc} • <strong className={sig.active ? 'text-emerald-300' : 'text-slate-600'}>{sig.active ? 'HIGH' : 'LOW'}</strong>
                </div>
              </div>
            ))}
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-950 p-2.5 rounded-lg border border-slate-850 leading-relaxed mt-auto">
            Input signals are read from the USB-UART bridge chip via Web Serial API <code className="text-cyan-400">port.getSignals()</code>.
          </div>
        </div>
      </div>

      {/* 3. U-Boot Interrupt Spammer & Bootloader Halter */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col gap-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-bold text-slate-100">
              U-BOOT INTERRUPT SPAMMER & BOOTLOADER HALTER
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {capturedPrompt && (
              <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-xs font-bold animate-pulse">
                Caught: "{capturedPrompt}"
              </span>
            )}
            <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300 font-bold">
              Bursts: {spamCount}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          Spams rapid keystroke bursts (e.g. 25ms intervals) to interrupt U-Boot, CFE, or RedBoot autoboot countdowns before the kernel boots. Auto-stops upon prompt detection.
        </p>

        {/* Configuration Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-800">
          {/* Character selection */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500">INTERRUPT KEY:</label>
            <select
              value={spamChar}
              onChange={(e) => setSpamChar(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-slate-200 font-bold outline-none"
            >
              <option value="space">Spacebar (0x20)</option>
              <option value="enter">Enter / Return (\r\n)</option>
              <option value="ctrl-c">Ctrl + C (0x03)</option>
              <option value="esc">Escape (0x1B)</option>
              <option value="custom">Custom Keystroke</option>
            </select>
          </div>

          {/* Burst Interval */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold text-slate-500">BURST INTERVAL (MS):</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="10"
                max="100"
                step="5"
                value={spamIntervalMs}
                onChange={(e) => setSpamIntervalMs(Number(e.target.value))}
                className="w-full accent-rose-500 cursor-pointer"
              />
              <span className="text-xs text-rose-300 font-bold w-12">{spamIntervalMs}ms</span>
            </div>
          </div>

          {/* Trigger Button */}
          <div className="flex items-end">
            {!isSpamming ? (
              <button
                onClick={startSpammer}
                disabled={!isConnected}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-extrabold text-xs shadow-rose-glow transition-all active:scale-95 disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>START SPAMMER</span>
              </button>
            ) : (
              <button
                onClick={stopSpammer}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-slate-900 border border-rose-500 text-rose-400 font-extrabold text-xs transition-all active:scale-95"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>STOP SPAMMER</span>
              </button>
            )}
          </div>
        </div>

        {/* 1-Click Exploit / Triage Commands */}
        <div className="pt-1">
          <span className="text-[10px] font-bold text-slate-500 uppercase">Quick Bootloader Actions:</span>
          <div className="flex flex-wrap items-center gap-2 pt-1.5">
            <button
              onClick={handleBypassPassword}
              disabled={!isConnected}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all disabled:opacity-50"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span>Bypass Root Password (init=/bin/sh)</span>
            </button>

            <button
              onClick={() => sendString('printenv', '\n')}
              disabled={!isConnected}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold transition-all disabled:opacity-50"
            >
              Dump Environment (printenv)
            </button>

            <button
              onClick={() => sendString('version', '\n')}
              disabled={!isConnected}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold transition-all disabled:opacity-50"
            >
              Target Version (version)
            </button>

            <button
              onClick={() => sendString('md.b 0x80000000 0x100', '\n')}
              disabled={!isConnected}
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-bold transition-all disabled:opacity-50"
            >
              Memory Hexdump (md.b)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
