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
  ArrowRight,
  Copy,
  Trash2
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { 
  triggerEspBootloader, 
  triggerEspNormalReset, 
  assertUartBreak 
} from '../../utils/serialSignals';
import StatusBadge from '../common/StatusBadge';
import {
  RESET_PROFILES,
  getProfile,
  buildProfileSteps,
  suggestProfile,
  runSignalSequence,
  touch1200,
  normalizeSteps,
  invertSteps,
  parseSequence,
  serializeSequence,
  createSpammer
} from '../../utils/resetProfiles';
import {
  parseEsptoolSequence,
  toEsptoolSequence,
  diffInputSignals,
  recordSignalEvents,
  formatSignalEvents,
  pulseSignal
} from '../../utils/hardwareSignalTools';

const COMMON_PROMPTS = ['=>', 'u-boot>', 'cfe>', 'redboot>', '# ', '$ '];

// Tri-state select helpers for the custom sequence editor (keep / assert / release).
const tri = (v) => (v === undefined ? 'keep' : v ? 'assert' : 'release');
const untri = (v) => (v === 'keep' ? undefined : v === 'assert');

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
    subscribeRx,
    portInfo,
    reconfigureActivePort,
    disconnect,
    connect
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
  const spammerRef = useRef(null);

  // Profile-driven reset / bootloader entry
  const [profileId, setProfileId] = useState('esp32-classic');
  const [invertProfile, setInvertProfile] = useState(false);
  const [stm32Cfg, setStm32Cfg] = useState({ boot0: 'dtr', invertBoot0: false, invertNrst: false });
  const [profileBusy, setProfileBusy] = useState(false);
  const [timings, setTimings] = useState(null);
  const [touchNotice, setTouchNotice] = useState('');
  const suggestedProfile = suggestProfile(portInfo);

  // User-defined sequences (saved in localStorage; DTR/RTS levels + hold times)
  const [customSteps, setCustomSteps] = useState([{ dtr: false, rts: true, waitMs: 100 }, { dtr: false, rts: false, waitMs: 50 }]);
  const [customName, setCustomName] = useState('My sequence');
  const [customJson, setCustomJson] = useState('');
  const [customError, setCustomError] = useState('');
  const [savedSequences, setSavedSequences] = useState(() => {
    try { return JSON.parse(localStorage.getItem('usbtool.resetSequences') || '[]'); } catch { return []; }
  });

  // esptool-format sequence text (D0|R1|W0.1|...) for import/export
  const [esptoolText, setEsptoolText] = useState('');

  // Single-line pulse length
  const [pulseMs, setPulseMs] = useState(100);
  const [pulseNote, setPulseNote] = useState('');

  // Input signal change log (CTS/DSR/DCD/RI), recorded from the context's polled values
  const [sigLog, setSigLog] = useState({ events: [], counts: { cts: 0, dsr: 0, dcd: 0, ri: 0 } });
  const prevSignals = useRef(null);
  useEffect(() => {
    if (!isConnected) { prevSignals.current = null; return; }
    const changes = diffInputSignals(prevSignals.current, hardwareSignals);
    prevSignals.current = hardwareSignals;
    if (changes.length) setSigLog((st) => recordSignalEvents(st, changes, Date.now()));
  }, [hardwareSignals, isConnected]);

  // Follow the auto-suggested profile until the user picks one themselves
  const userPickedProfile = useRef(false);
  useEffect(() => {
    if (suggestedProfile && !userPickedProfile.current) setProfileId(suggestedProfile);
  }, [suggestedProfile]);

  // Stop the spammer if the tab unmounts mid-burst
  useEffect(() => () => { spammerRef.current?.stop(); }, []);

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

  const runProfile = async (mode) => {
    if (!isConnected || !port) {
      alert('Please connect to a serial port first.');
      return;
    }
    const profile = getProfile(profileId);
    setProfileBusy(true);
    setTimings(null);
    setTouchNotice('');
    try {
      if (profile.kind === 'touch1200') {
        addLog('[HARDWARE] 1200-baud touch: reopening at 1200 baud, dropping DTR, closing...', 'sys');
        const live = port;
        const res = await touch1200({
          open: (baud) => reconfigureActivePort({ baudRate: baud }),
          setSignals: (sig) => live.setSignals(sig),
          close: () => disconnect()
        });
        if (res.needsNewPort) {
          const msg = 'Touch sent. The board is re-enumerating (a USB drive such as RPI-RP2 may appear). If it comes back as a serial port, connect again and pick the new port.';
          setTouchNotice(msg);
          addLog(`[HARDWARE] ${msg}`, 'sys');
        }
      } else {
        const steps = buildProfileSteps(profileId, mode, {
          invert: invertProfile,
          stm32: stm32Cfg,
          timing: { resetMs: resetDurationMs, bootHoldMs: bootHoldDurationMs }
        });
        addLog(`[HARDWARE] ${profile.label}: ${mode === 'bootloader' ? 'bootloader entry' : 'reset'} (${steps.length} steps)...`, 'sys');
        const t = await runSignalSequence(port, steps);
        setTimings(t);
        addLog(`[HARDWARE] Sequence done. Measured holds: ${t.map((x) => `${x.actualMs}ms`).join(', ')}.`, 'sys');
      }
    } catch (err) {
      addLog(`[HARDWARE ERROR] ${err.message}`, 'sys');
      setTouchNotice(`Error: ${err.message}`);
    } finally {
      setProfileBusy(false);
    }
  };

  const runCustomSequence = async () => {
    if (!isConnected || !port) {
      alert('Please connect to a serial port first.');
      return;
    }
    try {
      const base = normalizeSteps(customSteps);
      const steps = invertProfile ? invertSteps(base) : base;
      setProfileBusy(true);
      const t = await runSignalSequence(port, steps);
      setTimings(t);
      setCustomError('');
      addLog(`[HARDWARE] Custom sequence "${customName}" done. Measured holds: ${t.map((x) => `${x.actualMs}ms`).join(', ')}.`, 'sys');
    } catch (err) {
      setCustomError(err.message);
    } finally {
      setProfileBusy(false);
    }
  };

  const updateCustomStep = (i, patch) => {
    setCustomSteps((prev) => prev.map((s, idx) => {
      if (idx !== i) return s;
      const next = { ...s, ...patch };
      for (const k of ['dtr', 'rts']) if (next[k] === undefined) delete next[k];
      return next;
    }));
  };

  const saveCustomSequence = () => {
    try {
      const steps = normalizeSteps(customSteps);
      const next = [...savedSequences.filter((x) => x.name !== customName), { name: customName, steps }];
      setSavedSequences(next);
      localStorage.setItem('usbtool.resetSequences', JSON.stringify(next));
      setCustomError('');
    } catch (err) {
      setCustomError(err.message);
    }
  };

  const importCustomSequence = () => {
    try {
      const parsed = parseSequence(customJson);
      setCustomSteps(parsed.steps);
      setCustomName(parsed.name);
      setCustomError('');
    } catch (err) {
      setCustomError(err.message);
    }
  };

  const exportCustomSequence = () => {
    try {
      setCustomJson(serializeSequence(customName, customSteps));
      setCustomError('');
    } catch (err) {
      setCustomError(err.message);
    }
  };

  const importEsptool = () => {
    try {
      setCustomSteps(parseEsptoolSequence(esptoolText));
      setCustomError('');
    } catch (err) {
      setCustomError(err.message);
    }
  };

  const exportEsptool = () => {
    try {
      setEsptoolText(toEsptoolSequence(customSteps));
      setCustomError('');
    } catch (err) {
      setCustomError(err.message);
    }
  };

  const handlePulse = async (name) => {
    if (!isConnected || !port) {
      alert('Please connect to a serial port first.');
      return;
    }
    try {
      const held = await pulseSignal(port, name, pulseMs, { restore: !!hardwareSignals[name] });
      setPulseNote(`${name.toUpperCase()} pulsed ${pulseMs} ms (measured ${held} ms).`);
      addLog(`[HARDWARE] ${name.toUpperCase()} pulse ${pulseMs}ms (measured ${held}ms).`, 'sys');
    } catch (err) {
      setPulseNote(`Error: ${err.message}`);
      addLog(`[HARDWARE ERROR] Pulse failed: ${err.message}`, 'sys');
    }
  };

  const copySignalLog = () => {
    try { navigator.clipboard?.writeText(formatSignalEvents(sigLog.events)); } catch { /* clipboard unavailable */ }
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

    // Prompts are matched on the partial line from subscribeRx, so `=>` with no
    // newline is caught and no burst is sent after the catch.
    spammerRef.current?.stop();
    spammerRef.current = createSpammer({
      send: sendRawBytes,
      subscribeRx,
      prompts: COMMON_PROMPTS,
      payload,
      intervalMs: spamIntervalMs,
      onCount: setSpamCount,
      onCatch: (p) => {
        setCapturedPrompt(p);
        setIsSpamming(false);
        addLog(`[U-BOOT TRIAGE] Autoboot successfully halted! Caught prompt: "${p}"`, 'sys');
      },
      onError: (err) => {
        console.error(err);
        setIsSpamming(false);
      }
    });
    spammerRef.current.start();
  };

  const stopSpammer = () => {
    spammerRef.current?.stop();
    setIsSpamming(false);
  };

  // U-Boot Root Bypass
  const handleBypassPassword = async () => {
    if (!isConnected) return;
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' &&
        !window.confirm('This sends setenv bootargs "... init=/bin/sh" and boot to the target, which changes its boot behaviour and drops to a root shell. Only use it on a device you own or are authorised to test. Continue?')) {
      return;
    }
    addLog('[U-BOOT TRIAGE] Injecting single-user root shell args (init=/bin/sh)...', 'sys');
    await sendString('setenv bootargs "${bootargs} init=/bin/sh"', '\n');
    await new Promise(r => setTimeout(r, 200));
    await sendString('boot', '\n');
    addLog('[U-BOOT TRIAGE] Boot command executed. Target should drop to root shell #', 'sys');
  };


  const card = 'bg-[#030712] border border-cyber-border rounded-lg p-2.5 flex flex-col gap-2';
  const subCard = 'bg-slate-950 border border-slate-800 rounded-lg p-2';
  const btn = 'px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[11px] text-slate-300 font-bold hover:border-slate-500 focus-visible:outline focus-visible:outline-1 focus-visible:outline-cyan-400 disabled:opacity-50';
  const selectCls = 'bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus-visible:border-cyan-400';
  const lbl = 'text-[10px] font-bold text-slate-500';
  const heading = 'flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800';
  const h2 = 'text-xs font-bold text-slate-100 flex items-center gap-1.5';
  const profile = getProfile(profileId);

  return (
    <div className="flex flex-col gap-2 font-mono text-xs">
      {/* 1. ESP32 strapping */}
      <section className={card} aria-label="ESP32 strapping timing">
        <div className={heading}>
          <h2 className={h2}><Sliders className="w-3.5 h-3.5 text-emerald-400" />ESP32 STRAPPING TIMING</h2>
          {strapMessage && <span className="text-[10px] text-emerald-400 font-bold animate-pulse">{strapMessage}</span>}
        </div>
        <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
          <div className={`${subCard} flex flex-col gap-1`}>
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="hw-reset-ms" className="font-bold text-slate-300">Reset hold (EN/RTS)</label>
              <span className="px-1.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">{resetDurationMs} ms</span>
            </div>
            <input id="hw-reset-ms" type="range" min="50" max="500" step="10" value={resetDurationMs}
              onChange={(e) => setResetDurationMs(Number(e.target.value))} className="w-full accent-amber-500 cursor-pointer" />
          </div>
          <div className={`${subCard} flex flex-col gap-1`}>
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="hw-boot-ms" className="font-bold text-slate-300">Boot pin hold (IO0/DTR)</label>
              <span className="px-1.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40">{bootHoldDurationMs} ms</span>
            </div>
            <input id="hw-boot-ms" type="range" min="20" max="250" step="5" value={bootHoldDurationMs}
              onChange={(e) => setBootHoldDurationMs(Number(e.target.value))} className="w-full accent-cyan-500 cursor-pointer" />
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-400 overflow-x-auto whitespace-nowrap">
          <span className="font-bold text-slate-300">SEQUENCE:</span>
          <span className="px-1 py-0.5 rounded bg-slate-900">1. EN=LOW, IO0=LOW</span>
          <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
          <span className="px-1 py-0.5 rounded bg-slate-900 text-amber-300">2. EN=HIGH</span>
          <ArrowRight className="w-3 h-3 text-slate-600 shrink-0" />
          <span className="px-1 py-0.5 rounded bg-slate-900 text-cyan-300">3. IO0=HIGH</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleTriggerBootloader}
            disabled={isStrapping || !isConnected}
            className="flex-1 min-w-[10rem] flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-extrabold text-[11px] disabled:opacity-50 transition-all active:scale-95"
          >
            <Zap className={`w-3.5 h-3.5 ${isStrapping ? 'animate-bounce' : ''}`} />
            <span>TRIGGER ESP32 BOOTLOADER MODE</span>
          </button>
          <button
            onClick={handleNormalReset}
            disabled={!isConnected}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 font-bold text-[11px] transition-all active:scale-95 disabled:opacity-50"
          >
            <RotateCcw className="w-3 h-3" />
            <span>NORMAL REBOOT TO APP</span>
          </button>
        </div>
      </section>

      {/* 2. Reset / bootloader profiles */}
      <section className={card} aria-label="Reset and bootloader profiles">
        <div className={heading}>
          <h2 className={h2}><RotateCcw className="w-3.5 h-3.5 text-amber-400" />RESET &amp; BOOTLOADER PROFILES</h2>
          {suggestedProfile && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-500/40 text-cyan-300 font-bold truncate">
              Suggested: {getProfile(suggestedProfile)?.label.split(' (')[0]}
            </span>
          )}
        </div>
        <div className={`${subCard} grid grid-cols-1 @sm:grid-cols-2 gap-2`}>
          <div className="flex flex-col gap-0.5">
            <label htmlFor="hw-profile" className={lbl}>PROFILE</label>
            <select id="hw-profile" value={profileId}
              onChange={(e) => { userPickedProfile.current = true; setProfileId(e.target.value); }}
              className={`${selectCls} font-bold`}>
              {RESET_PROFILES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 self-end">
            <input type="checkbox" checked={invertProfile} onChange={(e) => setInvertProfile(e.target.checked)} />
            <span>Invert DTR/RTS polarity</span>
          </label>
          {profileId === 'stm32' && (
            <div className="col-span-full flex flex-wrap items-center gap-2 text-[11px] text-slate-300">
              <span className={lbl}>BOOT0 on:</span>
              <select aria-label="BOOT0 line" value={stm32Cfg.boot0}
                onChange={(e) => setStm32Cfg({ ...stm32Cfg, boot0: e.target.value })} className={selectCls}>
                <option value="dtr">DTR (NRST on RTS)</option>
                <option value="rts">RTS (NRST on DTR)</option>
              </select>
              <label className="flex items-center gap-1"><input type="checkbox" checked={stm32Cfg.invertBoot0} onChange={(e) => setStm32Cfg({ ...stm32Cfg, invertBoot0: e.target.checked })} /> invert BOOT0</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={stm32Cfg.invertNrst} onChange={(e) => setStm32Cfg({ ...stm32Cfg, invertNrst: e.target.checked })} /> invert NRST</label>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => runProfile('bootloader')}
            disabled={profileBusy || !isConnected}
            className="flex-1 min-w-[10rem] py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-extrabold text-[11px] disabled:opacity-50"
          >
            {profile?.kind === 'touch1200' ? 'SEND 1200-BAUD TOUCH' : 'ENTER BOOTLOADER (PROFILE)'}
          </button>
          {profile?.kind !== 'touch1200' && (
            <button
              onClick={() => runProfile('reset')}
              disabled={profileBusy || !isConnected}
              className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-amber-300 border border-amber-500/40 font-bold text-[11px] disabled:opacity-50"
            >
              RESET (PROFILE)
            </button>
          )}
        </div>
        {touchNotice && (
          <div className="flex items-center gap-2 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-500/40 rounded-lg p-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{touchNotice}</span>
            <button onClick={() => connect()} className="px-2 py-0.5 rounded bg-slate-900 border border-amber-500/50 font-bold">CONNECT NEW PORT</button>
          </div>
        )}
        {timings && (
          <div className="text-[10px] text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-1.5">
            <span className="font-bold text-slate-300">Measured step holds: </span>
            {timings.map((t) => (
              <span key={t.index} className="mr-2">#{t.index + 1} {t.actualMs}ms (asked {t.requestedMs}ms)</span>
            ))}
          </div>
        )}

        <details className={subCard}>
          <summary className="text-[11px] font-bold text-slate-300 cursor-pointer">Custom sequence editor</summary>
          <div className="flex flex-col gap-1.5 pt-2">
            {customSteps.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-300">
                <span className="w-5 text-slate-500">#{i + 1}</span>
                {['dtr', 'rts'].map((k) => (
                  <label key={k} className="flex items-center gap-1">
                    <span className="uppercase font-bold text-slate-500">{k}</span>
                    <select value={tri(s[k])} onChange={(e) => updateCustomStep(i, { [k]: untri(e.target.value) })} className={selectCls}>
                      <option value="keep">keep</option>
                      <option value="assert">assert</option>
                      <option value="release">release</option>
                    </select>
                  </label>
                ))}
                <label className="flex items-center gap-1">
                  <span className="font-bold text-slate-500">hold</span>
                  <input type="number" min="0" max="5000" value={s.waitMs}
                    onChange={(e) => updateCustomStep(i, { waitMs: Number(e.target.value) })}
                    className="w-16 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px]" />
                  <span>ms</span>
                </label>
                <button onClick={() => setCustomSteps(customSteps.filter((_, idx) => idx !== i))} className={`${btn} text-rose-300`} aria-label={`Remove step ${i + 1}`}>remove</button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setCustomSteps([...customSteps, { rts: false, waitMs: 50 }])} className={btn}>+ step</button>
              <input aria-label="Sequence name" value={customName} onChange={(e) => setCustomName(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] w-32" />
              <button onClick={saveCustomSequence} className={btn}>Save</button>
              <button onClick={runCustomSequence} disabled={profileBusy || !isConnected} className="px-2 py-1 rounded bg-amber-500/20 border border-amber-500/50 text-[11px] text-amber-300 font-bold disabled:opacity-50">Run</button>
              <button onClick={exportCustomSequence} className={btn}>Export JSON</button>
              <button onClick={importCustomSequence} className={btn}>Import JSON</button>
            </div>
            {savedSequences.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                <span>Saved:</span>
                {savedSequences.map((q) => (
                  <button key={q.name} onClick={() => { setCustomSteps(q.steps); setCustomName(q.name); }} className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-cyan-300">{q.name}</button>
                ))}
              </div>
            )}
            <textarea aria-label="Sequence JSON" value={customJson} onChange={(e) => setCustomJson(e.target.value)}
              placeholder='{"name":"...","steps":[{"dtr":false,"rts":true,"waitMs":100}]}' rows={2}
              className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-[11px] font-mono text-slate-200" />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={lbl} title="D = DTR, R = RTS (0/1), W = wait in seconds. Same format as esptool custom reset sequences.">ESPTOOL FORMAT</span>
              <input aria-label="esptool sequence string" value={esptoolText} onChange={(e) => setEsptoolText(e.target.value)}
                placeholder="D0|R1|W0.1|D1|R0|W0.05|D0"
                className="flex-1 min-w-[10rem] bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200" />
              <button onClick={importEsptool} className={btn} title="Load the string into the step editor">Import</button>
              <button onClick={exportEsptool} className={btn} title="Write the current steps as an esptool-style string">Export</button>
            </div>
            {customError && <span className="text-[11px] text-rose-400" role="alert">{customError}</span>}
          </div>
        </details>
      </section>

      {/* 3. Manual outputs and live inputs */}
      <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
        <section className={card} aria-label="Manual UART pin toggles">
          <div className={heading}>
            <h3 className={h2}><Sliders className="w-3.5 h-3.5 text-cyan-400" />UART OUTPUTS</h3>
            <span className="text-[10px] text-slate-500">DTR / RTS / BREAK</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'dtr', name: 'DTR', on: 'bg-amber-500/20 text-amber-300 border-amber-500/60', dot: 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' },
              { id: 'rts', name: 'RTS', on: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/60', dot: 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' }
            ].map((o) => (
              <div key={o.id} className="flex flex-col gap-1">
                <button
                  onClick={() => toggleSignal(o.id)}
                  disabled={!isConnected}
                  aria-pressed={!!hardwareSignals[o.id]}
                  className={`p-2 rounded-lg border flex flex-col items-center justify-center gap-0.5 font-bold transition-all disabled:opacity-50 ${
                    hardwareSignals[o.id] ? o.on : 'bg-slate-950 text-slate-400 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs">
                    <span className={`w-2 h-2 rounded-full ${hardwareSignals[o.id] ? o.dot : 'bg-slate-700'}`} />
                    {o.name} PIN
                  </span>
                  <span className="text-[10px] font-mono opacity-80">
                    STATE: {hardwareSignals[o.id] ? 'ASSERTED (HIGH)' : 'IDLE (LOW)'}
                  </span>
                </button>
                <button onClick={() => handlePulse(o.id)} disabled={!isConnected}
                  className={btn} title={`Assert ${o.name} for ${pulseMs} ms, then restore its previous state`}>
                  Pulse {o.name} {pulseMs} ms
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <label htmlFor="hw-pulse-ms" className={lbl}>PULSE</label>
            <input id="hw-pulse-ms" type="range" min="10" max="1000" step="10" value={pulseMs}
              onChange={(e) => setPulseMs(Number(e.target.value))} className="flex-1 accent-amber-500 cursor-pointer" />
            <span className="text-amber-300 font-bold w-14 text-right">{pulseMs} ms</span>
          </div>
          {pulseNote && <div className="text-[10px] text-slate-400" role="status">{pulseNote}</div>}

          <div className={`${subCard} flex flex-col gap-1.5`}>
            <div className="flex items-center justify-between text-[11px]">
              <label htmlFor="hw-break-ms" className="text-slate-400 font-bold">UART line break</label>
              <span className="text-rose-400 font-bold">{breakDurationMs} ms</span>
            </div>
            <input id="hw-break-ms" type="range" min="50" max="1000" step="25" value={breakDurationMs}
              onChange={(e) => setBreakDurationMs(Number(e.target.value))} className="w-full accent-rose-500 cursor-pointer" />
            <button
              onClick={handleAssertBreak}
              disabled={isBreaking || !isConnected}
              className="w-full py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 font-bold text-[11px] transition-all active:scale-95 disabled:opacity-50"
            >
              {isBreaking ? 'ASSERTING LINE BREAK...' : `ASSERT ${breakDurationMs}ms UART BREAK`}
            </button>
          </div>
        </section>

        <section className={card} aria-label="Live hardware input signals">
          <div className={heading}>
            <h3 className={h2}><Activity className="w-3.5 h-3.5 text-emerald-400" />INPUT SIGNALS</h3>
            <span className="text-[10px] text-slate-500">polled every 250 ms</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'cts', name: 'CTS', desc: 'Clear to Send' },
              { id: 'dsr', name: 'DSR', desc: 'Data Set Ready' },
              { id: 'dcd', name: 'DCD', desc: 'Carrier Detect' },
              { id: 'ri', name: 'RI', desc: 'Ring Indicator' }
            ].map((sig) => {
              const active = hardwareSignals[sig.id];
              return (
                <div key={sig.id} className={`p-2 rounded-lg border flex flex-col transition-all ${
                  active ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/50' : 'bg-slate-950 text-slate-500 border-slate-800'
                }`}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold">{sig.name}</span>
                    <span className={`w-2 h-2 rounded-full ${active ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]' : 'bg-slate-800'}`} />
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {sig.desc} &bull; <strong className={active ? 'text-emerald-300' : 'text-slate-600'}>{active ? 'HIGH' : 'LOW'}</strong>
                    <span className="text-slate-500"> &bull; {sigLog.counts[sig.id]} edges</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className={`${subCard} flex flex-col gap-1`}>
            <div className="flex items-center justify-between">
              <span className={lbl}>CHANGE LOG ({sigLog.events.length})</span>
              <span className="flex items-center gap-1">
                <button onClick={copySignalLog} disabled={!sigLog.events.length} className={btn} title="Copy the log to the clipboard" aria-label="Copy change log"><Copy className="w-3 h-3" /></button>
                <button onClick={() => setSigLog({ events: [], counts: { cts: 0, dsr: 0, dcd: 0, ri: 0 } })} className={btn} title="Clear the log and edge counters" aria-label="Clear change log"><Trash2 className="w-3 h-3" /></button>
              </span>
            </div>
            <div className="max-h-20 overflow-y-auto text-[10px] text-slate-400 leading-snug" aria-live="off">
              {sigLog.events.length === 0 ? (
                <span className="text-slate-600">No input changes seen yet. Edges faster than the 250 ms poll can be missed.</span>
              ) : (
                [...sigLog.events].reverse().slice(0, 50).map((e, i) => (
                  <div key={`${e.t}-${e.name}-${i}`}>
                    {new Date(e.t).toLocaleTimeString()} <span className="text-slate-300">{e.name.toUpperCase()}</span> &rarr;{' '}
                    <span className={e.level ? 'text-emerald-300' : 'text-slate-500'}>{e.level ? 'HIGH' : 'LOW'}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {/* 4. U-Boot spammer */}
      <section className={card} aria-label="U-Boot interrupt spammer">
        <div className={heading}>
          <h2 className={h2}><Flame className="w-3.5 h-3.5 text-rose-500" />U-BOOT INTERRUPT SPAMMER</h2>
          <div className="flex items-center gap-1.5">
            {capturedPrompt && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-500/50 text-emerald-300 text-[10px] font-bold animate-pulse">
                Caught: "{capturedPrompt}"
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300 font-bold">Bursts: {spamCount}</span>
          </div>
        </div>
        <div className={`${subCard} grid grid-cols-1 @sm:grid-cols-3 gap-2`}>
          <div className="flex flex-col gap-0.5">
            <label htmlFor="hw-spam-key" className={lbl}>INTERRUPT KEY</label>
            <select id="hw-spam-key" value={spamChar} onChange={(e) => setSpamChar(e.target.value)} className={`${selectCls} font-bold`}>
              <option value="space">Spacebar (0x20)</option>
              <option value="enter">Enter / Return (\r\n)</option>
              <option value="ctrl-c">Ctrl + C (0x03)</option>
              <option value="esc">Escape (0x1B)</option>
              <option value="custom">Custom Keystroke</option>
            </select>
            {spamChar === 'custom' && (
              <input aria-label="Custom keystroke" value={customSpam} onChange={(e) => setCustomSpam(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200" />
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            <label htmlFor="hw-spam-ms" className={lbl}>BURST INTERVAL</label>
            <div className="flex items-center gap-2">
              <input id="hw-spam-ms" type="range" min="10" max="100" step="5" value={spamIntervalMs}
                onChange={(e) => setSpamIntervalMs(Number(e.target.value))} className="w-full accent-rose-500 cursor-pointer" />
              <span className="text-[11px] text-rose-300 font-bold w-10">{spamIntervalMs}ms</span>
            </div>
          </div>
          <div className="flex items-end">
            {!isSpamming ? (
              <button onClick={startSpammer} disabled={!isConnected}
                className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-extrabold text-[11px] transition-all active:scale-95 disabled:opacity-50">
                <Play className="w-3 h-3 fill-current" /><span>START SPAMMER</span>
              </button>
            ) : (
              <button onClick={stopSpammer}
                className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-slate-900 border border-rose-500 text-rose-400 font-extrabold text-[11px] transition-all active:scale-95">
                <Square className="w-3 h-3 fill-current" /><span>STOP SPAMMER</span>
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={lbl}>QUICK ACTIONS</span>
          <button onClick={handleBypassPassword} disabled={!isConnected}
            className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/40 text-[11px] font-bold disabled:opacity-50">
            <ShieldAlert className="w-3 h-3 text-amber-400" /><span>Root shell (init=/bin/sh)</span>
          </button>
          <button onClick={() => sendString('printenv', '\n')} disabled={!isConnected} className={btn}>printenv</button>
          <button onClick={() => sendString('version', '\n')} disabled={!isConnected} className={btn}>version</button>
          <button onClick={() => sendString('md.b 0x80000000 0x100', '\n')} disabled={!isConnected} className={`${btn} text-cyan-300`}>md.b</button>
        </div>
        <details className="text-[11px] text-slate-400">
          <summary className="cursor-pointer font-bold text-slate-300">About this tool</summary>
          <div className="pt-1 leading-relaxed space-y-1">
            <p>Timed DTR/RTS pulses use millisecond timers and report the measured hold time, since browser timers are not exact. Pin wiring varies by board; use the invert toggle for the opposite polarity.</p>
            <p>The spammer sends rapid keystroke bursts to interrupt U-Boot, CFE or RedBoot autoboot and stops when a prompt is detected. Only use it, and the root-shell action, on devices you own or are authorised to test.</p>
            <p>Input signals are read with <code className="text-cyan-400">port.getSignals()</code>.</p>
          </div>
        </details>
      </section>
    </div>
  );
}
