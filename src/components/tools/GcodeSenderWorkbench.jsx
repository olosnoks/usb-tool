import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Printer, Usb, Power, Thermometer, Flame, Home, Crosshair, Play, Pause, Square, Upload, Terminal, Fan, Gauge, RotateCcw, Unlock, Send, Activity, Target, Loader2, Wrench } from 'lucide-react';
import { useOptionalSerial } from '../../context/SerialContext';
import {
  REALTIME, prepareGcodeLines, classifyLine, createLineSplitter, resolveCoordinates, buildJog, homeLines, zeroLines,
  hotendLines, bedLines, fanLines, autoReportLines, extrudeLines, normalizeConsoleLine, makeTempSample, appendTempSample,
  estimateRemainingMs, utf8Length, GcodeStreamer,
} from '../../utils/gcodeSender';

const enc = new TextEncoder();
const JOG_STEPS = [0.1, 1, 10, 100];
const CHART_WINDOW_S = 300;

/** Small SVG line chart of temperature samples (only real reported values are drawn). */
function TempChart({ history }) {
  const W = 600;
  const H = 160;
  if (history.length < 2) {
    return <div className="h-40 flex items-center justify-center text-xs text-slate-600 border border-slate-800 rounded bg-slate-950">Waiting for temperature reports...</div>;
  }
  const tEnd = history[history.length - 1].t;
  const tStart = Math.max(0, tEnd - CHART_WINDOW_S);
  const visible = history.filter((s) => s.t >= tStart);
  const values = visible.flatMap((s) => [s.hotend, s.hotendTarget, s.bed, s.bedTarget]).filter((v) => Number.isFinite(v));
  const yMax = Math.max(50, ...values) * 1.08;
  const x = (t) => ((t - tStart) / Math.max(1, tEnd - tStart)) * W;
  const y = (v) => H - (v / yMax) * H;
  const line = (key) => {
    let d = '';
    for (const s of visible) {
      const v = s[key];
      if (Number.isFinite(v)) d += `${d ? 'L' : 'M'}${x(s.t).toFixed(1)},${y(v).toFixed(1)}`;
    }
    return d;
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full bg-slate-950 border border-slate-800 rounded" style={{ height: H }}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#1e293b" />)}
        <path d={line('hotend')} fill="none" stroke="#f97316" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={line('hotendTarget')} fill="none" stroke="#f97316" strokeOpacity="0.5" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={line('bed')} fill="none" stroke="#22d3ee" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={line('bedTarget')} fill="none" stroke="#22d3ee" strokeOpacity="0.5" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute top-1 left-2 text-[10px] text-slate-500 font-mono">{yMax.toFixed(0)} C</div>
      <div className="absolute bottom-1 left-2 text-[10px] text-slate-500 font-mono">0 C</div>
      <div className="absolute bottom-1 right-2 text-[10px] text-slate-500 font-mono">last {Math.round(tEnd - tStart)} s</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-slate-500">
      {label}
      {children}
    </label>
  );
}

const inputCls = 'bg-slate-950 border border-slate-700 rounded px-2 py-1 font-mono text-xs text-gray-200 w-full';
const btnCls = 'px-2.5 py-1.5 rounded border text-xs font-mono flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed';
const btnNeutral = `${btnCls} border-slate-700 text-slate-300 hover:border-cyan-500 hover:text-cyan-300`;
const btnAccent = `${btnCls} border-cyan-700 text-cyan-300 hover:bg-cyan-950`;
const btnWarn = `${btnCls} border-amber-700 text-amber-300 hover:bg-amber-950`;
const btnDanger = `${btnCls} border-rose-700 text-rose-300 hover:bg-rose-950`;

export default function GcodeSenderWorkbench({ onLogMessage }) {
  const serial = useOptionalSerial();
  const connected = !!serial?.isConnected;

  // Latest serial context for callbacks that outlive a render.
  const serialRef = useRef(serial);
  serialRef.current = serial;

  const [detected, setDetected] = useState(null);      // { firmware, version } from a real reply
  const [fwChoice, setFwChoice] = useState('auto');    // 'auto' | 'marlin' | 'grbl'
  const fw = fwChoice === 'auto' ? (detected?.firmware ?? null) : fwChoice;
  const detectedRef = useRef(detected);
  detectedRef.current = detected;

  const [log, setLog] = useState([]);
  const [consoleText, setConsoleText] = useState('');
  const t0Ref = useRef(Date.now());

  // Marlin temperatures
  const [tempHistory, setTempHistory] = useState([]);
  const [lastTemps, setLastTemps] = useState(null);
  const [hotendSet, setHotendSet] = useState('210');
  const [bedSet, setBedSet] = useState('60');
  const [autoSec, setAutoSec] = useState('2');
  const [fanValue, setFanValue] = useState(255);
  const [extrudeMm, setExtrudeMm] = useState('5');
  const [extrudeFeed, setExtrudeFeed] = useState('300');
  const pendingReadRef = useRef(0);

  // GRBL status and settings
  const [grblStatus, setGrblStatus] = useState(null);
  const [polling, setPolling] = useState(true);
  const wcoRef = useRef(null);
  const [settings, setSettings] = useState(null);
  const collectSettingsRef = useRef(false);

  // Jog
  const [step, setStep] = useState(1);
  const [feed, setFeed] = useState('1000');

  // File streaming
  const [fileName, setFileName] = useState('');
  const [commands, setCommands] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [loadError, setLoadError] = useState('');
  const streamerRef = useRef(null);
  const streamStartRef = useRef(0);
  const [streamProg, setStreamProg] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  const streaming = !!streamProg && (streamProg.state === 'running' || streamProg.state === 'paused');
  const streamingRef = useRef(false);
  streamingRef.current = streaming;

  const addLog = useCallback((dir, text) => {
    setLog((prev) => [...prev.slice(-399), { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, dir, text }]);
  }, []);

  const writeBytes = useCallback((bytes) => {
    const s = serialRef.current;
    if (!s?.isConnected) {
      addLog('err', 'Not connected. Connect the serial port first.');
      return false;
    }
    Promise.resolve(s.sendRawBytes(bytes)).catch((err) => addLog('err', `Write failed: ${err.message}`));
    return true;
  }, [addLog]);

  const sendLine = useCallback((text) => {
    const t = normalizeConsoleLine(text);
    if (!t) return false;
    if (streamingRef.current) {
      addLog('err', 'A file is streaming. Manual commands are disabled until it finishes or stops.');
      return false;
    }
    if (!writeBytes(enc.encode(`${t}\n`))) return false;
    addLog('tx', t);
    return true;
  }, [addLog, writeBytes]);

  const sendLines = (lines) => {
    for (const l of lines) if (!sendLine(l)) return;
  };

  // --- Receive path -------------------------------------------------------------

  const refreshProgress = () => {
    const s = streamerRef.current;
    if (!s) return;
    setStreamProg(s.progress());
  };

  const pumpStream = () => {
    const s = streamerRef.current;
    if (!s) return;
    for (const text of s.pump()) {
      writeBytes(enc.encode(text));
      addLog('tx', text.trim());
    }
    refreshProgress();
  };

  const handleLine = (line) => {
    const c = classifyLine(line);
    const streamingNow = streamingRef.current;

    switch (c.type) {
      case 'grbl-status': {
        const r = resolveCoordinates(c.status, wcoRef.current);
        if (r.wco) wcoRef.current = r.wco;
        setGrblStatus({ ...c.status, ...r, at: Date.now() });
        if (!detectedRef.current) setDetected({ firmware: 'grbl', version: null });
        return;
      }
      case 'grbl-version':
        setDetected({ firmware: 'grbl', version: c.version });
        addLog('rx', line);
        return;
      case 'marlin-firmware':
        setDetected({ firmware: 'marlin', version: c.info.version });
        addLog('rx', line);
        return;
      case 'grbl-setting':
        if (collectSettingsRef.current) setSettings((prev) => [...(prev || []), { id: c.id, value: c.value, comment: c.comment }]);
        return;
      default:
        break;
    }

    if (c.type !== 'ok' || !streamingNow) addLog('rx', line);

    const temps = c.type === 'temp' ? c.temps : c.type === 'ok' ? c.temp : null;
    if (temps) {
      pendingReadRef.current = 0;
      setLastTemps(temps);
      setTempHistory((h) => appendTempSample(h, makeTempSample((Date.now() - t0Ref.current) / 1000, temps)));
    }

    if (c.type === 'ok' && collectSettingsRef.current) collectSettingsRef.current = false;

    const s = streamerRef.current;
    if (s && ['ok', 'resend', 'grbl-error', 'grbl-alarm', 'marlin-error'].includes(c.type)) {
      const before = s.state;
      const events = s.receive(c);
      for (const e of events) {
        if (e.type === 'resend') addLog('err', `Printer asked for line ${e.lineNumber}; resending from there.`);
        if (e.type === 'warning') addLog('err', `Warning (Marlin will resend): ${e.message}`);
        if (e.type === 'error') addLog('err', e.message);
      }
      if (s.state !== before && s.state === 'done') addLog('sys', 'Stream finished.');
      if (s.state !== before && s.state === 'halted') addLog('err', `Stream halted: ${s.reason}`);
      pumpStream();
    }
  };
  const handleLineRef = useRef(handleLine);
  handleLineRef.current = handleLine;

  useEffect(() => {
    if (!serial?.subscribeRx) return undefined;
    const splitter = createLineSplitter();
    return serial.subscribeRx((bytes) => {
      for (const line of splitter.push(bytes)) handleLineRef.current?.(line);
    });
  }, [serial?.subscribeRx]);

  // --- Connection lifecycle ----------------------------------------------------------

  const detect = useCallback(() => {
    if (streamingRef.current) return;
    addLog('sys', 'Detecting firmware: sending $I (GRBL) and M115 (Marlin).');
    sendLine('$I');
    sendLine('M115');
  }, [addLog, sendLine]);

  useEffect(() => {
    if (connected) {
      const id = setTimeout(() => detect(), 400);
      return () => clearTimeout(id);
    }
    // Disconnected: stop any stream and forget what the device told us.
    if (streamerRef.current) {
      streamerRef.current.stop();
      refreshProgress();
    }
    setDetected(null);
    setGrblStatus(null);
    wcoRef.current = null;
    return undefined;
  }, [connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // GRBL status polling (realtime '?', not queued and never counted as an ok).
  useEffect(() => {
    if (!connected || fw !== 'grbl' || !polling) return undefined;
    const id = setInterval(() => writeBytes(Uint8Array.of(REALTIME.STATUS)), 250);
    return () => clearInterval(id);
  }, [connected, fw, polling, writeBytes]);

  // Clock for elapsed time and ETA while a stream runs.
  useEffect(() => {
    if (!streaming) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [streaming]);

  // --- Actions ----------------------------------------------------------------------

  const realtime = (byte, label) => {
    if (!writeBytes(Uint8Array.of(byte))) return;
    addLog('tx', label);
  };

  const readTemps = () => {
    pendingReadRef.current = Date.now();
    sendLine('M105');
  };

  const setAuto = (seconds) => {
    try { sendLines(autoReportLines(seconds)); } catch (e) { addLog('err', e.message); }
  };

  const doJog = (axis, dir) => {
    if (!fw) return;
    try {
      const lines = buildJog(fw, { axis, distance: dir * step, feed: Number(feed) });
      sendLines(lines);
    } catch (e) { addLog('err', e.message); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (streamingRef.current) return;
    setLoadError('');
    try {
      const text = await file.text();
      const { commands: cmds, skipped: sk } = prepareGcodeLines(text);
      setFileName(file.name);
      setCommands(cmds);
      setSkipped(sk);
      streamerRef.current = null;
      setStreamProg(null);
      addLog('sys', `Loaded ${file.name}: ${cmds.length} commands, ${sk} blank/comment lines skipped.`);
    } catch (err) {
      setLoadError(`Could not read the file: ${err.message}`);
    }
  };

  const tooLongForGrbl = useMemo(
    () => (fw === 'grbl' ? commands.filter((c) => utf8Length(c) + 1 > 127).length : 0),
    [fw, commands],
  );

  const startStream = () => {
    if (!connected || !fw || commands.length === 0 || streamingRef.current) return;
    if (pendingReadRef.current && Date.now() - pendingReadRef.current < 2000) {
      addLog('err', 'Wait for the temperature reply before starting a file.');
      return;
    }
    let s;
    try {
      s = new GcodeStreamer({ firmware: fw, commands });
    } catch (err) {
      addLog('err', err.message);
      return;
    }
    streamerRef.current = s;
    streamStartRef.current = Date.now();
    setNow(Date.now());
    addLog('sys', `Streaming ${commands.length} commands (${fw === 'marlin' ? 'one line at a time, numbered, with checksums' : 'character-counted 127-byte buffer'}).`);
    for (const text of s.start()) {
      writeBytes(enc.encode(text));
      addLog('tx', text.trim());
    }
    refreshProgress();
  };

  const pauseStream = () => {
    const s = streamerRef.current;
    if (!s) return;
    s.pause();
    if (fw === 'grbl') realtime(REALTIME.FEED_HOLD, 'feed hold (!)');
    refreshProgress();
    addLog('sys', 'Paused: no new lines are sent.');
  };

  const resumeStream = () => {
    const s = streamerRef.current;
    if (!s) return;
    if (fw === 'grbl') realtime(REALTIME.CYCLE_START, 'cycle start (~)');
    for (const text of s.resume()) {
      writeBytes(enc.encode(text));
      addLog('tx', text.trim());
    }
    refreshProgress();
  };

  const stopStream = () => {
    const s = streamerRef.current;
    if (!s) return;
    s.stop();
    if (fw === 'grbl') realtime(REALTIME.FEED_HOLD, 'feed hold (!)');
    refreshProgress();
    addLog('sys', fw === 'grbl'
      ? 'Stopped. Feed hold sent; use Soft reset to flush the controller buffer.'
      : 'Stopped. Lines already sent to the printer will still finish.');
  };

  const readSettings = () => {
    collectSettingsRef.current = true;
    setSettings([]);
    sendLine('$$');
  };

  const onConsoleKey = (e) => {
    if (e.key === 'Enter' && sendLine(consoleText)) setConsoleText('');
  };

  // --- Derived values --------------------------------------------------------------

  const elapsedMs = streaming ? now - streamStartRef.current : 0;
  const eta = streaming && streamProg
    ? estimateRemainingMs({ done: streamProg.done, total: streamProg.total, elapsedMs })
    : null;
  const busyDisabled = !connected || !fw || streaming;
  const fwLabel = fw === 'marlin' ? 'MARLIN' : fw === 'grbl' ? 'GRBL 1.1' : 'UNKNOWN';

  return (
    <div className="flex flex-col gap-3 p-3 text-gray-200 font-sans bg-slate-950 min-h-full">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border border-slate-800 rounded p-3 bg-slate-900/60">
        <Printer size={20} className="text-cyan-400" />
        <div className="flex-1 min-w-[200px]">
          <div className="font-mono text-sm text-cyan-300">G-CODE SENDER</div>
          <div className="text-[11px] text-slate-500">Marlin 3D printers and GRBL 1.1 CNC over the shared serial port</div>
        </div>
        <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${connected ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
          {connected ? `CONNECTED @ ${serial?.baudRate ?? '?'} bps` : 'NOT CONNECTED'}
        </span>
        <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${fw ? 'border-cyan-700 text-cyan-300' : 'border-slate-700 text-slate-500'}`}>
          FIRMWARE: {fw ? fwLabel : 'not detected'}
          {detected?.version ? ` ${detected.version}` : ''}
        </span>
        <Field label="Firmware">
          <select className={inputCls} value={fwChoice} onChange={(e) => setFwChoice(e.target.value)} aria-label="Firmware">
            <option value="auto">Auto-detect</option>
            <option value="marlin">Marlin</option>
            <option value="grbl">GRBL 1.1</option>
          </select>
        </Field>
        {!connected ? (
          <button className={btnAccent} onClick={() => serial?.connect?.()} disabled={!serial}>
            <Usb size={13} /> CONNECT SERIAL
          </button>
        ) : (
          <button className={btnNeutral} onClick={detect} disabled={streaming}>
            <Activity size={13} /> DETECT FIRMWARE
          </button>
        )}
      </div>

      {!serial && (
        <div className="text-xs text-amber-300 border border-amber-900 rounded p-2 bg-amber-950/30">
          The serial context is not available here, so this tool cannot talk to a device.
        </div>
      )}
      {serial && !connected && (
        <div className="text-xs text-slate-400 border border-slate-800 rounded p-2">
          Not connected. Connect the shared serial port (115200 baud is typical for GRBL and most printers; some Marlin boards use 250000 bps,
          so set the baud rate in the header before connecting). The firmware is detected from a real reply once connected.
        </div>
      )}
      {connected && !fw && (
        <div className="text-xs text-slate-400 border border-slate-800 rounded p-2">
          No firmware reply yet. Marlin answers M115 and GRBL answers $I. If nothing comes back, check the baud rate and that the
          controller is not in another program, then press DETECT FIRMWARE.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Left column: temperatures (Marlin) or status (GRBL) */}
        <div className="flex flex-col gap-3">
          {fw === 'marlin' && (
            <section className="border border-slate-800 rounded p-3 bg-slate-900/60 flex flex-col gap-3">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300"><Thermometer size={14} /> TEMPERATURE</div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="border border-slate-800 rounded p-2 bg-slate-950">
                  <div className="text-[10px] text-slate-500 uppercase">Hotend</div>
                  <div className="font-mono text-lg text-orange-300">{lastTemps?.hotends[0] ? `${lastTemps.hotends[0].actual.toFixed(1)} C` : '—'}</div>
                  <div className="font-mono text-[10px] text-slate-500">target {lastTemps?.hotends[0]?.target ?? '—'}</div>
                </div>
                <div className="border border-slate-800 rounded p-2 bg-slate-950">
                  <div className="text-[10px] text-slate-500 uppercase">Bed</div>
                  <div className="font-mono text-lg text-cyan-300">{lastTemps?.bed ? `${lastTemps.bed.actual.toFixed(1)} C` : '—'}</div>
                  <div className="font-mono text-[10px] text-slate-500">target {lastTemps?.bed?.target ?? '—'}</div>
                </div>
              </div>
              <TempChart history={tempHistory} />
              <div className="flex flex-wrap gap-2">
                <button className={btnNeutral} onClick={readTemps} disabled={busyDisabled}>READ (M105)</button>
                <button className={btnNeutral} onClick={() => setAuto(autoSec)} disabled={busyDisabled}>AUTO-REPORT (M155)</button>
                <button className={btnNeutral} onClick={() => setAuto(0)} disabled={busyDisabled}>AUTO OFF</button>
                <input className={`${inputCls} w-20`} value={autoSec} onChange={(e) => setAutoSec(e.target.value)} aria-label="Auto-report seconds" />
                <span className="text-[10px] text-slate-500 self-center">seconds</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Hotend target (C)">
                  <div className="flex gap-1">
                    <input className={inputCls} value={hotendSet} onChange={(e) => setHotendSet(e.target.value)} />
                    <button className={btnWarn} disabled={busyDisabled} onClick={() => { try { sendLines(hotendLines(hotendSet)); } catch (err) { addLog('err', err.message); } }}><Flame size={12} />SET</button>
                  </div>
                </Field>
                <Field label="Bed target (C)">
                  <div className="flex gap-1">
                    <input className={inputCls} value={bedSet} onChange={(e) => setBedSet(e.target.value)} />
                    <button className={btnWarn} disabled={busyDisabled} onClick={() => { try { sendLines(bedLines(bedSet)); } catch (err) { addLog('err', err.message); } }}><Flame size={12} />SET</button>
                  </div>
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label={`Fan ${fanValue}/255`}>
                  <div className="flex gap-1 items-center">
                    <input type="range" min="0" max="255" value={fanValue} onChange={(e) => setFanValue(Number(e.target.value))} className="flex-1" aria-label="Fan speed" />
                    <button className={btnNeutral} disabled={busyDisabled} onClick={() => { try { sendLines(fanLines(fanValue)); } catch (err) { addLog('err', err.message); } }}><Fan size={12} />SET</button>
                    <button className={btnNeutral} disabled={busyDisabled} onClick={() => sendLines(fanLines(0))}>OFF</button>
                  </div>
                </Field>
                <Field label="Extrude / retract">
                  <div className="flex gap-1">
                    <input className={`${inputCls} w-16`} value={extrudeMm} onChange={(e) => setExtrudeMm(e.target.value)} aria-label="Extrude mm" />
                    <input className={`${inputCls} w-20`} value={extrudeFeed} onChange={(e) => setExtrudeFeed(e.target.value)} aria-label="Extrude feed" />
                    <button className={btnNeutral} disabled={busyDisabled} onClick={() => { try { sendLines(extrudeLines(Math.abs(Number(extrudeMm)), Number(extrudeFeed))); } catch (err) { addLog('err', err.message); } }}>EXTRUDE</button>
                    <button className={btnNeutral} disabled={busyDisabled} onClick={() => { try { sendLines(extrudeLines(-Math.abs(Number(extrudeMm)), Number(extrudeFeed))); } catch (err) { addLog('err', err.message); } }}>RETRACT</button>
                  </div>
                </Field>
              </div>
              <p className="text-[10px] text-slate-500">Extrude and retract use M83 (relative E) and then M82 (absolute E) around the move. The chart only plots temperatures the printer actually reported.</p>
            </section>
          )}

          {fw === 'grbl' && (
            <section className="border border-slate-800 rounded p-3 bg-slate-900/60 flex flex-col gap-3">
              <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                <span className="flex items-center gap-2"><Gauge size={14} /> STATUS</span>
                <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <input type="checkbox" checked={polling} onChange={(e) => setPolling(e.target.checked)} /> poll '?' every 250 ms
                </label>
              </div>
              {grblStatus ? (
                <>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-sm px-2 py-0.5 rounded border ${grblStatus.state === 'Alarm' ? 'border-rose-700 text-rose-300' : grblStatus.state === 'Idle' ? 'border-emerald-700 text-emerald-300' : 'border-amber-700 text-amber-300'}`}>
                      {grblStatus.state}{grblStatus.substate ? `:${grblStatus.substate}` : ''}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">last report {new Date(grblStatus.at).toLocaleTimeString()}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 font-mono text-xs">
                    {[['MPos', grblStatus.mpos], ['WPos', grblStatus.wpos]].map(([k, v]) => (
                      <div key={k} className="border border-slate-800 rounded p-2 bg-slate-950">
                        <div className="text-[10px] text-slate-500">{k}</div>
                        {v ? ['X', 'Y', 'Z'].map((a, i) => <div key={a}>{a} {v[i].toFixed(3)}</div>) : <div className="text-slate-600">not reported</div>}
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400">
                    Feed {grblStatus.feed ?? '—'} mm/min
                    {grblStatus.speed !== null ? `  Spindle ${grblStatus.speed}` : ''}
                    {grblStatus.overrides ? `  Ov feed ${grblStatus.overrides.feed}% rapid ${grblStatus.overrides.rapid}% spindle ${grblStatus.overrides.spindle}%` : ''}
                    {grblStatus.buffer ? `  Buffer planner ${grblStatus.buffer.planner} rx ${grblStatus.buffer.rx}` : ''}
                    {grblStatus.pins ? `  Pins ${grblStatus.pins}` : ''}
                  </div>
                </>
              ) : (
                <div className="text-xs text-slate-600">No status report yet.</div>
              )}
              <div className="flex flex-wrap gap-2">
                <button className={btnWarn} disabled={!connected} onClick={() => realtime(REALTIME.FEED_HOLD, 'feed hold (!)')}><Pause size={12} />FEED HOLD</button>
                <button className={btnNeutral} disabled={!connected} onClick={() => realtime(REALTIME.CYCLE_START, 'resume (~)')}><Play size={12} />RESUME</button>
                <button className={btnDanger} disabled={!connected} onClick={() => realtime(REALTIME.SOFT_RESET, 'soft reset (Ctrl-X)')}><RotateCcw size={12} />SOFT RESET</button>
                <button className={btnNeutral} disabled={!connected || streaming} onClick={() => sendLine('$X')}><Unlock size={12} />UNLOCK ($X)</button>
                <button className={btnNeutral} disabled={!connected} onClick={() => realtime(REALTIME.JOG_CANCEL, 'jog cancel')}>JOG CANCEL</button>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex gap-2 items-center">
                  <button className={btnNeutral} disabled={busyDisabled} onClick={readSettings}><Wrench size={12} />READ SETTINGS ($$)</button>
                  {settings && <span className="text-[10px] text-slate-500">{settings.length} settings{collectSettingsRef.current ? ' (reading...)' : ''}</span>}
                </div>
                {settings && settings.length > 0 && (
                  <div className="max-h-48 overflow-auto border border-slate-800 rounded bg-slate-950 font-mono text-[11px]">
                    {settings.map((s) => (
                      <div key={s.id} className="flex justify-between gap-2 px-2 py-0.5 border-b border-slate-900 last:border-0">
                        <span className="text-cyan-300">${s.id}</span>
                        <span className="text-gray-200">{s.value}</span>
                        <span className="text-slate-500 truncate">{s.comment}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* File streaming */}
          <section className="border border-slate-800 rounded p-3 bg-slate-900/60 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-300"><Upload size={14} /> FILE</div>
            <div className="flex flex-wrap items-center gap-2">
              <label className={`${btnNeutral} cursor-pointer ${streaming ? 'opacity-40 pointer-events-none' : ''}`}>
                <Upload size={12} /> LOAD .gcode
                <input type="file" accept=".gcode,.gc,.nc,.ngc,.tap,.txt" className="hidden" onChange={onFile} disabled={streaming} />
              </label>
              <span className="text-xs font-mono text-slate-400 truncate max-w-[16rem]">{fileName || 'no file loaded'}</span>
              {commands.length > 0 && <span className="text-[11px] font-mono text-slate-500">{commands.length} commands, {skipped} skipped</span>}
            </div>
            {loadError && <div className="text-xs text-rose-300">{loadError}</div>}
            {tooLongForGrbl > 0 && (
              <div className="text-xs text-amber-300">{tooLongForGrbl} line(s) are longer than the GRBL 127-byte buffer and will be refused at start.</div>
            )}
            {fw === 'marlin' && commands.length > 0 && (
              <div className="text-[10px] text-slate-500">Marlin: one line in flight, each with a line number and checksum. Slower than GRBL, but resends are handled.</div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className={btnAccent} disabled={!connected || !fw || commands.length === 0 || streaming} onClick={startStream}><Play size={12} />START</button>
              <button className={btnNeutral} disabled={!streaming || streamProg?.state !== 'running'} onClick={pauseStream}><Pause size={12} />PAUSE</button>
              <button className={btnNeutral} disabled={streamProg?.state !== 'paused'} onClick={resumeStream}><Play size={12} />RESUME</button>
              <button className={btnDanger} disabled={!streaming} onClick={stopStream}><Square size={12} />STOP</button>
            </div>
            {streamProg && (
              <div className="flex flex-col gap-1.5">
                <div className="h-2 bg-slate-800 rounded overflow-hidden">
                  <div className="h-full bg-cyan-500 transition-all" style={{ width: `${Math.min(100, streamProg.percent).toFixed(1)}%` }} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-mono text-slate-400">
                  <span>state <span className="text-slate-200">{streamProg.state}</span></span>
                  <span>{streamProg.done} / {streamProg.total} ({streamProg.percent.toFixed(1)}%)</span>
                  <span>elapsed {Math.round(elapsedMs / 1000)} s</span>
                  <span>ETA {streaming ? (eta === null ? 'estimating...' : `${Math.round(eta / 1000)} s`) : '—'}</span>
                  <span>resends {streamProg.resends}</span>
                  <span>errors {streamProg.errors}</span>
                </div>
                {streamProg.reason && <div className="text-xs text-rose-300">{streamProg.reason}</div>}
                {streaming && streamProg.state === 'paused' && <div className="text-xs text-amber-300 flex items-center gap-1"><Loader2 size={12} className="animate-spin" />Paused</div>}
              </div>
            )}
          </section>
        </div>

        {/* Right column: jog, zero and console */}
        <div className="flex flex-col gap-3">
          <section className="border border-slate-800 rounded p-3 bg-slate-900/60 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-300"><Crosshair size={14} /> JOG</div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Step (mm)">
                <div className="flex gap-1">
                  {JOG_STEPS.map((s) => (
                    <button key={s} onClick={() => setStep(s)} className={`${btnCls} flex-1 ${step === s ? 'border-cyan-500 text-cyan-300 bg-cyan-950' : 'border-slate-700 text-slate-400'}`}>{s}</button>
                  ))}
                </div>
              </Field>
              <Field label="Feed (mm/min)">
                <input className={inputCls} value={feed} onChange={(e) => setFeed(e.target.value)} aria-label="Jog feed" />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['X', 'Y', 'Z'].map((ax) => (
                <div key={ax} className="flex flex-col gap-1">
                  <button className={btnNeutral} disabled={busyDisabled} onClick={() => doJog(ax, 1)} aria-label={`Jog ${ax} plus`}>{ax}+</button>
                  <button className={btnNeutral} disabled={busyDisabled} onClick={() => doJog(ax, -1)} aria-label={`Jog ${ax} minus`}>{ax}-</button>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={btnAccent} disabled={busyDisabled} onClick={() => sendLines(homeLines(fw))}><Home size={12} />HOME ALL</button>
              {['X', 'Y', 'Z'].map((ax) => (
                <button key={ax} className={btnNeutral} disabled={busyDisabled} onClick={() => sendLines(zeroLines(fw, [ax]))}>
                  <Target size={12} />ZERO {ax}
                </button>
              ))}
              <button className={btnNeutral} disabled={busyDisabled} onClick={() => sendLines(zeroLines(fw, ['X', 'Y', 'Z']))}>ZERO ALL</button>
            </div>
            <p className="text-[10px] text-slate-500">
              {fw === 'grbl'
                ? 'GRBL: $J jog moves, $H homes (needs homing enabled), ZERO sets a work offset (G10 L20 P1).'
                : fw === 'marlin'
                  ? 'Marlin: G91 relative move then G90 back to absolute. HOME is G28. ZERO is G92, which changes the coordinate system until the next home.'
                  : 'Pick the firmware or detect it to enable the controls.'}
            </p>
          </section>

          <section className="border border-slate-800 rounded p-3 bg-slate-900/60 flex flex-col gap-2 min-h-[260px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300"><Terminal size={14} /> CONSOLE</div>
              <button className={btnNeutral} onClick={() => setLog([])}>CLEAR</button>
            </div>
            <div className="flex-1 min-h-[180px] max-h-[360px] overflow-auto border border-slate-800 rounded bg-black p-2 font-mono text-[11px] leading-5">
              {log.length === 0 && <div className="text-slate-600">Nothing yet. Replies from the device and what you send appear here.</div>}
              {log.map((l) => (
                <div key={l.id} className={l.dir === 'tx' ? 'text-cyan-300' : l.dir === 'err' ? 'text-rose-300' : l.dir === 'sys' ? 'text-amber-300' : 'text-gray-300'}>
                  <span className="text-slate-600 mr-2">{l.dir === 'tx' ? '>' : l.dir === 'rx' ? '<' : l.dir === 'err' ? '!' : '#'}</span>
                  {l.text}
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className={`${inputCls} flex-1`}
                placeholder={streaming ? 'Disabled while a file streams' : fw === 'grbl' ? 'e.g. $I, $$, G0 X10' : fw === 'marlin' ? 'e.g. M115, G28, M105' : 'Send a line (connect first)'}
                value={consoleText}
                onChange={(e) => setConsoleText(e.target.value)}
                onKeyDown={onConsoleKey}
                disabled={busyDisabled}
                aria-label="Console input"
              />
              <button className={btnNeutral} disabled={busyDisabled || !consoleText.trim()} onClick={() => { if (sendLine(consoleText)) setConsoleText(''); }}>
                <Send size={12} />SEND
              </button>
            </div>
            <div className="text-[10px] text-slate-500">Manual lines are disabled while a file streams, because their replies would be counted as acknowledgements of the file.</div>
          </section>
        </div>
      </div>

      <div className="text-[10px] text-slate-600 font-mono flex items-center gap-1">
        <Power size={10} /> Nothing is sent until you connect a device and press a control. No simulated temperatures or positions are shown.
      </div>
    </div>
  );
}
