import React, { useState, useRef, useEffect } from 'react';
import { Plane, Cpu, Activity, Gauge, Battery, Terminal, Download, Send, AlertTriangle, Usb } from 'lucide-react';
import { useOptionalSerial } from '../../context/SerialContext';
import { useSessionError } from '../../utils/sessionLog';
import {
  MSP,
  MSP_BAUD_RATE,
  MspClient,
  MspRejectedError,
  MspTimeoutError,
  decodeApiVersion,
  decodeFcVariant,
  decodeFcVersion,
  decodeBoardInfo,
  decodeBuildInfo,
  decodeStatusEx,
  decodeAttitude,
  decodeRawImu,
  decodeChannels,
  decodeAnalog,
  CLI_ENTER_BYTES,
  cliLineBytes,
  endsWithCliPrompt,
  isRebootingCommand,
} from '../../utils/mspProtocol';

const TABS = [
  { id: 'identify', label: 'Identify' },
  { id: 'status', label: 'Status' },
  { id: 'live', label: 'Live' },
  { id: 'cli', label: 'CLI' },
];

// Read-only MSP commands polled while a tab is on screen. Nothing else is ever requested.
const POLL_BY_TAB = {
  identify: [],
  status: [MSP.STATUS_EX],
  live: [MSP.ATTITUDE, MSP.RAW_IMU, MSP.RC, MSP.ANALOG, MSP.MOTOR],
  cli: [],
};

const IDENTIFY_STEPS = [
  { key: 'api', cmd: MSP.API_VERSION, label: 'MSP_API_VERSION (1)', decode: decodeApiVersion },
  { key: 'variant', cmd: MSP.FC_VARIANT, label: 'MSP_FC_VARIANT (2)', decode: decodeFcVariant },
  { key: 'version', cmd: MSP.FC_VERSION, label: 'MSP_FC_VERSION (3)', decode: decodeFcVersion },
  { key: 'board', cmd: MSP.BOARD_INFO, label: 'MSP_BOARD_INFO (4)', decode: decodeBoardInfo },
  { key: 'build', cmd: MSP.BUILD_INFO, label: 'MSP_BUILD_INFO (5)', decode: decodeBuildInfo },
];

const EMPTY_DATA = {
  identify: {},
  identifyErr: {},
  status: null,
  attitude: null,
  imu: null,
  imuHistory: [],
  rc: null,
  analog: null,
  motors: null,
  cmdErrors: {},
};

const ZERO_STATS = { requests: 0, responses: 0, timeouts: 0, rejected: 0, stray: 0, corrupt: 0 };
const CLI_MAX_CHARS = 400000;
const IMU_HISTORY = 240;
const CAPTURE_TIMEOUT_MS = 90000;
const CAPTURE_IDLE_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function describeMspError(err) {
  if (err instanceof MspTimeoutError) return 'no reply (timeout)';
  if (err instanceof MspRejectedError) return 'not supported by this firmware';
  return err && err.message ? err.message : String(err);
}

function downloadTextFile(name, text) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fmt(n, digits = 1) {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '--';
}

function Card({ title, icon: Icon, children, className = '' }) {
  return (
    <section className={`bg-slate-950 border border-slate-800 rounded-lg p-3 min-w-0 ${className}`}>
      <header className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400 mb-2">
        {Icon && <Icon size={13} className="text-cyan-400" />}
        <span>{title}</span>
      </header>
      {children}
    </section>
  );
}

function Field({ label, value }) {
  return (
    <div className="flex justify-between gap-3 text-xs font-mono py-0.5 border-b border-slate-900 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right break-all">{value === undefined || value === null || value === '' ? '--' : String(value)}</span>
    </div>
  );
}

function Bar({ label, value, min, max, unit = '' }) {
  const pct = typeof value === 'number' ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-[11px] font-mono">
      <span className="w-8 text-right text-slate-500 shrink-0">{label}</span>
      <div className="flex-1 h-3 bg-slate-900 rounded overflow-hidden">
        <div className="h-full bg-cyan-500/80" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-14 text-slate-200 shrink-0">{typeof value === 'number' ? `${value}${unit}` : '--'}</span>
    </div>
  );
}

function Horizon({ rollDeg, pitchDeg }) {
  // Positive pitch (nose up) moves the horizon down; positive roll (right wing down) turns it counter-clockwise on screen.
  const offset = Math.max(-80, Math.min(80, (typeof pitchDeg === 'number' ? pitchDeg : 0) * 2.2));
  const roll = typeof rollDeg === 'number' ? rollDeg : 0;
  return (
    <svg viewBox="-100 -100 200 200" className="w-full max-w-[220px] aspect-square rounded-full border border-slate-700 bg-slate-900" role="img" aria-label="Attitude indicator">
      <defs>
        <clipPath id="fc-horizon-clip"><circle cx="0" cy="0" r="96" /></clipPath>
      </defs>
      <g clipPath="url(#fc-horizon-clip)">
        <g transform={`rotate(${-roll}) translate(0 ${offset})`}>
          <rect x="-300" y="-300" width="600" height="300" fill="#0e7490" opacity="0.55" />
          <rect x="-300" y="0" width="600" height="300" fill="#78350f" opacity="0.6" />
          <line x1="-300" y1="0" x2="300" y2="0" stroke="#e2e8f0" strokeWidth="1.5" />
        </g>
      </g>
      <line x1="-42" y1="0" x2="-14" y2="0" stroke="#fbbf24" strokeWidth="3" />
      <line x1="14" y1="0" x2="42" y2="0" stroke="#fbbf24" strokeWidth="3" />
      <circle cx="0" cy="0" r="3" fill="#fbbf24" />
    </svg>
  );
}

function GyroChart({ history }) {
  const W = 300;
  const H = 110;
  const n = history.length;
  if (n < 2) {
    return <div className="h-[110px] flex items-center justify-center text-[11px] text-slate-600 font-mono">waiting for RAW_IMU samples</div>;
  }
  let peak = 1;
  for (const s of history) for (const v of s) peak = Math.max(peak, Math.abs(v));
  const colors = ['#22d3ee', '#34d399', '#fbbf24'];
  const lines = [0, 1, 2].map((axis) => history
    .map((s, i) => `${((i / (n - 1)) * W).toFixed(1)},${(H / 2 - (s[axis] / peak) * (H / 2 - 4)).toFixed(1)}`)
    .join(' '));
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[110px] bg-slate-900 rounded" role="img" aria-label="Raw gyro chart">
        <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#334155" strokeWidth="1" />
        {lines.map((pts, axis) => (
          <polyline key={axis} points={pts} fill="none" stroke={colors[axis]} strokeWidth="1.2" />
        ))}
      </svg>
      <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1">
        <span className="text-cyan-400">gyro X</span>
        <span className="text-emerald-400">gyro Y</span>
        <span className="text-amber-400">gyro Z</span>
        <span>scale +/-{peak} raw</span>
      </div>
    </div>
  );
}

export default function FlightControllerWorkbench({ onLogMessage }) {
  const serial = useOptionalSerial();
  const serialRef = useRef(serial);
  useEffect(() => { serialRef.current = serial; });
  const connected = Boolean(serial && serial.isConnected);
  const [error, setError] = useSessionError('FC');

  const [tab, setTab] = useState('identify');
  const tabRef = useRef(tab);
  useEffect(() => { tabRef.current = tab; }, [tab]);

  // 'msp' = binary MSP traffic, 'entering' = '#' is being sent (MSP replies still decoded), 'cli' = text CLI.
  const [mode, setMode] = useState('msp');
  const modeRef = useRef('msp');

  const [polling, setPolling] = useState(true);
  const [data, setData] = useState(EMPTY_DATA);
  const [stats, setStats] = useState(ZERO_STATS);
  const [identifying, setIdentifying] = useState(false);

  const [cliText, setCliText] = useState('');
  const [cliInput, setCliInput] = useState('');
  const [confirmExit, setConfirmExit] = useState(false);
  const [capture, setCapture] = useState(null); // { label, text, running, incomplete, chars }

  const clientRef = useRef(null);
  const cliDecoderRef = useRef(null);
  const captureRef = useRef(null); // { label, text, timer, timeout }

  const getClient = () => {
    if (!clientRef.current) {
      clientRef.current = new MspClient({
        timeoutMs: 400,
        send: (bytes) => {
          const s = serialRef.current;
          if (!s || !s.isConnected) throw new Error('serial port is not connected');
          return s.sendRawBytes(bytes);
        },
      });
    }
    return clientRef.current;
  };

  const setModeBoth = (next) => {
    modeRef.current = next;
    setMode(next);
  };

  // ---- CLI capture (diff all / dump) -------------------------------------
  const finishCapture = (incomplete) => {
    const cap = captureRef.current;
    if (!cap) return;
    clearTimeout(cap.timer);
    clearTimeout(cap.timeout);
    captureRef.current = null;
    setCapture({ label: cap.label, text: cap.text, running: false, incomplete, chars: cap.text.length });
    if (onLogMessage) onLogMessage(`${cap.label} captured (${cap.text.length} chars${incomplete ? ', incomplete' : ''}).`, incomplete ? 'warn' : 'info');
  };

  const checkCapture = () => {
    const cap = captureRef.current;
    if (cap && endsWithCliPrompt(cap.text)) finishCapture(false);
  };

  // Received text while in CLI mode: transcript for the terminal view, plus any running capture.
  const appendCli = (text) => {
    setCliText((prev) => {
      const next = prev + text;
      return next.length > CLI_MAX_CHARS ? next.slice(next.length - CLI_MAX_CHARS) : next;
    });
    const cap = captureRef.current;
    if (cap) {
      cap.text += text;
      clearTimeout(cap.timer);
      cap.timer = setTimeout(checkCapture, CAPTURE_IDLE_MS);
      setCapture((c) => (c && c.running ? { ...c, chars: cap.text.length } : c));
    }
  };

  // ---- RX routing -----------------------------------------------------------
  useEffect(() => {
    if (!serial || !serial.subscribeRx) return undefined;
    return serial.subscribeRx((bytes, boardId) => {
      const s = serialRef.current;
      if (s && boardId !== undefined && boardId !== s.activeBoardId) return;
      if (modeRef.current === 'cli') {
        if (!cliDecoderRef.current) cliDecoderRef.current = new TextDecoder('utf-8', { fatal: false });
        const text = cliDecoderRef.current.decode(bytes, { stream: true });
        if (text) appendCli(text);
        return;
      }
      clientRef.current?.feed(bytes);
    });
    // appendCli only touches refs and stable setters, so the first closure stays valid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serial && serial.subscribeRx]);

  // ---- Telemetry from polled frames ----------------------------------------
  const handleFrame = (cmd, payload) => {
    const setErr = (msg) => setData((d) => ({ ...d, cmdErrors: { ...d.cmdErrors, [cmd]: msg } }));
    const clearErr = () => setData((d) => (d.cmdErrors[cmd] ? { ...d, cmdErrors: { ...d.cmdErrors, [cmd]: undefined } } : d));
    switch (cmd) {
      case MSP.STATUS_EX: {
        const v = decodeStatusEx(payload);
        if (!v) return setErr(`short payload (${payload.length} bytes)`);
        clearErr();
        return setData((d) => ({ ...d, status: v }));
      }
      case MSP.ATTITUDE: {
        const v = decodeAttitude(payload);
        if (!v) return setErr(`short payload (${payload.length} bytes)`);
        clearErr();
        return setData((d) => ({ ...d, attitude: v }));
      }
      case MSP.RAW_IMU: {
        const v = decodeRawImu(payload);
        if (!v) return setErr(`short payload (${payload.length} bytes)`);
        clearErr();
        return setData((d) => ({ ...d, imu: v, imuHistory: [...d.imuHistory.slice(-(IMU_HISTORY - 1)), v.gyro] }));
      }
      case MSP.RC: {
        const v = decodeChannels(payload);
        clearErr();
        return setData((d) => ({ ...d, rc: v }));
      }
      case MSP.ANALOG: {
        const v = decodeAnalog(payload);
        if (!v) return setErr(`short payload (${payload.length} bytes)`);
        clearErr();
        return setData((d) => ({ ...d, analog: v }));
      }
      case MSP.MOTOR: {
        const v = decodeChannels(payload);
        clearErr();
        return setData((d) => ({ ...d, motors: v }));
      }
      default:
        return undefined;
    }
  };

  // ---- Poll loop: one read at a time, only for the visible tab --------------
  useEffect(() => {
    if (!connected || !polling) return undefined;
    let cancelled = false;
    const run = async () => {
      while (!cancelled) {
        const list = POLL_BY_TAB[tabRef.current] || [];
        if (modeRef.current !== 'msp' || list.length === 0) {
          await sleep(150);
          continue;
        }
        for (const cmd of list) {
          if (cancelled || modeRef.current !== 'msp') break;
          const client = getClient();
          try {
            const frame = await client.request(cmd);
            handleFrame(cmd, frame.payload);
          } catch (err) {
            if (cancelled) break;
            const msg = describeMspError(err);
            setData((d) => ({ ...d, cmdErrors: { ...d.cmdErrors, [cmd]: msg } }));
          }
          if (!cancelled && clientRef.current) setStats({ ...clientRef.current.counts });
        }
      }
    };
    run();
    return () => { cancelled = true; };
    // handleFrame and getClient are only closed over refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, polling]);

  // Drop MSP state when the port goes away.
  useEffect(() => {
    if (connected) return;
    if (clientRef.current) clientRef.current.close();
    clientRef.current = null;
    cliDecoderRef.current = null;
    modeRef.current = 'msp';
    setMode('msp');
    setConfirmExit(false);
    if (captureRef.current) finishCapture(true);
    // finishCapture only uses refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  useEffect(() => () => {
    if (clientRef.current) clientRef.current.close();
    clientRef.current = null;
    const cap = captureRef.current;
    if (cap) { clearTimeout(cap.timer); clearTimeout(cap.timeout); captureRef.current = null; }
  }, []);

  // ---- Actions --------------------------------------------------------------
  const onConnect = async () => {
    setError('');
    try {
      await serial.connect();
      if (onLogMessage) onLogMessage(`Flight controller port opened at ${serial.baudRate} bps.`, 'info');
    } catch (err) {
      setError(`Connect failed: ${err && err.message ? err.message : err}`);
    }
  };

  const runIdentify = async () => {
    if (!connected || modeRef.current !== 'msp' || identifying) return;
    setIdentifying(true);
    const client = getClient();
    const found = {};
    const errs = {};
    for (const step of IDENTIFY_STEPS) {
      try {
        const frame = await client.request(step.cmd);
        const v = step.decode(frame.payload);
        if (v) found[step.key] = v;
        else errs[step.key] = `short payload (${frame.payload.length} bytes)`;
      } catch (err) {
        errs[step.key] = describeMspError(err);
      }
    }
    setData((d) => ({ ...d, identify: found, identifyErr: errs }));
    setStats({ ...client.counts });
    setIdentifying(false);
    if (onLogMessage) {
      const name = found.variant ? found.variant.name : 'unknown firmware';
      onLogMessage(`MSP identify finished: ${name}${found.version ? ` ${found.version.version}` : ''}.`, found.api ? 'info' : 'warn');
    }
  };

  const enterCli = async () => {
    if (!connected || modeRef.current !== 'msp') return;
    setError('');
    setConfirmExit(false);
    setCliText('');
    setModeBoth('entering');
    // Let any in-flight MSP reply finish (it is still decoded: the mode is not 'cli' yet) before sending '#'.
    await sleep(450);
    try {
      modeRef.current = 'cli';
      setMode('cli');
      await serial.sendRawBytes(CLI_ENTER_BYTES);
      if (onLogMessage) onLogMessage('Sent # to enter the CLI. MSP polling is paused.', 'info');
    } catch (err) {
      setError(`CLI entry failed: ${err && err.message ? err.message : err}`);
      setModeBoth('msp');
    }
  };

  const sendCliLine = async (line) => {
    if (!connected || modeRef.current !== 'cli') return;
    try {
      await serial.sendRawBytes(cliLineBytes(line));
    } catch (err) {
      setError(`CLI send failed: ${err && err.message ? err.message : err}`);
    }
  };

  const submitCliInput = () => {
    const line = cliInput.trim();
    if (!line) return;
    if (isRebootingCommand(line)) {
      setConfirmExit(true);
      return;
    }
    sendCliLine(line);
    setCliInput('');
  };

  const confirmExitCli = async () => {
    setConfirmExit(false);
    await sendCliLine('exit');
    if (onLogMessage) onLogMessage('Sent exit: the flight controller reboots.', 'warn');
    // Leave CLI mode after the reboot is requested; the MSP poll resumes if the FC answers again.
    setTimeout(() => setModeBoth('msp'), 500);
  };

  const startCapture = async (label, command) => {
    if (!connected || modeRef.current !== 'cli' || captureRef.current) return;
    const cap = { label, text: '', timer: null, timeout: null };
    captureRef.current = cap;
    cap.timeout = setTimeout(() => finishCapture(true), CAPTURE_TIMEOUT_MS);
    setCapture({ label, text: '', running: true, incomplete: false, chars: 0 });
    await sendCliLine(command);
  };

  const variantName = data.identify.variant ? data.identify.variant.name : 'flight-controller';
  const hasNoReplies = connected && mode === 'msp' && stats.requests >= 3 && stats.responses === 0;

  // ---- Render ---------------------------------------------------------------
  if (!serial) {
    return (
      <div className="p-4 text-xs font-mono text-slate-400">
        The flight controller tools need the app's serial context. Open this tool from the main app.
      </div>
    );
  }

  const webSerialMissing = serial.hasWebSerialSupport === false;
  const baudMismatch = Number(serial.baudRate) !== MSP_BAUD_RATE;

  return (
    <div className="p-3 space-y-3 text-slate-200 bg-slate-900 min-h-full">
      <div className="flex flex-wrap items-center gap-2">
        <Plane size={16} className="text-cyan-400" />
        <h2 className="text-sm font-semibold">Flight Controller Configurator</h2>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${connected ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
          {connected ? `CONNECTED ${serial.baudRate} bps` : 'DISCONNECTED'}
        </span>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${mode === 'cli' ? 'border-amber-700 text-amber-300' : 'border-slate-700 text-slate-400'}`}>
          {mode === 'cli' ? 'CLI MODE' : mode === 'entering' ? 'ENTERING CLI' : 'MSP MODE'}
        </span>
        <div className="flex-1" />
        {connected ? (
          <button type="button" onClick={() => serial.disconnect()} className="text-xs px-2 py-1 rounded border border-slate-700 hover:border-rose-700 text-slate-300">
            Disconnect
          </button>
        ) : (
          <button type="button" onClick={onConnect} disabled={webSerialMissing} className="text-xs px-2 py-1 rounded border border-cyan-700 text-cyan-300 hover:bg-cyan-950 disabled:opacity-40">
            <Usb size={12} className="inline mr-1" />Connect serial port
          </button>
        )}
      </div>

      {webSerialMissing && (
        <div className="text-xs text-amber-300 border border-amber-800 rounded p-2">
          Web Serial is not available in this browser. Use Chrome, Edge or Opera on desktop or Android.
        </div>
      )}
      {baudMismatch && !connected && (
        <div className="text-xs text-amber-300 border border-amber-800 rounded p-2 flex flex-wrap items-center gap-2">
          <AlertTriangle size={13} />
          <span>The port is set to {serial.baudRate} bps. MSP and CLI on this tool use {MSP_BAUD_RATE} bps.</span>
          <button type="button" onClick={() => serial.setBaudRate(MSP_BAUD_RATE)} className="px-2 py-0.5 rounded border border-amber-700 hover:bg-amber-950">
            Set {MSP_BAUD_RATE}
          </button>
        </div>
      )}
      {error && <div className="text-xs text-rose-300 border border-rose-900 rounded p-2 font-mono">{error}</div>}

      <nav className="flex gap-1 border-b border-slate-800 overflow-x-auto" role="tablist" aria-label="Flight controller views">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 text-xs font-mono border-b-2 -mb-px whitespace-nowrap ${tab === t.id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        {tab !== 'cli' && tab !== 'identify' && (
          <button type="button" onClick={() => setPolling((p) => !p)} className="text-[11px] font-mono px-2 py-1 text-slate-400 hover:text-slate-200">
            Polling: {polling ? 'on' : 'off'}
          </button>
        )}
      </nav>

      {!connected && tab !== 'cli' && (
        <div className="text-xs text-slate-400 p-3 border border-dashed border-slate-800 rounded">
          Connect the flight controller's USB serial port (Betaflight or INAV). The tool reads it at {MSP_BAUD_RATE} bps.
          Nothing is shown until the flight controller answers.
        </div>
      )}

      {tab === 'identify' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runIdentify}
              disabled={!connected || mode !== 'msp' || identifying}
              className="text-xs px-3 py-1.5 rounded border border-cyan-700 text-cyan-300 hover:bg-cyan-950 disabled:opacity-40"
            >
              {identifying ? 'Reading...' : 'Read identity'}
            </button>
            <span className="text-[11px] text-slate-500 font-mono">Read-only requests; nothing is written to the flight controller.</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {IDENTIFY_STEPS.map((step) => {
              const v = data.identify[step.key];
              const e = data.identifyErr[step.key];
              return (
                <Card key={step.key} title={step.label} icon={Cpu}>
                  {v ? (
                    <div>
                      {step.key === 'api' && <><Field label="API version" value={v.apiVersion} /><Field label="Protocol" value={v.protocolVersion} /></>}
                      {step.key === 'variant' && <><Field label="Variant" value={v.name} /><Field label="Identifier" value={v.identifier} /></>}
                      {step.key === 'version' && <Field label="Firmware" value={v.version} />}
                      {step.key === 'board' && <>
                        <Field label="Board id" value={v.identifier} />
                        <Field label="Hardware rev" value={v.hardwareRevision} />
                        <Field label="Target" value={v.targetName} />
                        <Field label="Board name" value={v.boardName} />
                        <Field label="Manufacturer" value={v.manufacturerId} />
                      </>}
                      {step.key === 'build' && <>
                        <Field label="Build date" value={v.buildDate} />
                        <Field label="Build time" value={v.buildTime} />
                        <Field label="Git revision" value={v.gitRevision} />
                      </>}
                    </div>
                  ) : (
                    <div className="text-xs font-mono text-slate-500">{e ? `Not available: ${e}` : 'Not read yet.'}</div>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-500">
            Decoders are checked against known byte vectors in the test suite. Field meanings after the first few bytes of BOARD_INFO
            depend on firmware version, so unknown trailing fields are not shown.
          </p>
        </div>
      )}

      {tab === 'status' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card title="MSP_STATUS_EX (150)" icon={Gauge}>
            {data.status ? (
              <>
                <Field label="Cycle time" value={`${data.status.cycleTimeUs} us`} />
                <Field label="Loop rate" value={`${fmt(data.status.sampleRateHz, 0)} Hz`} />
                <Field label="I2C errors" value={data.status.i2cErrors} />
                <Field label="PID profile" value={data.status.pidProfile} />
                <Field label="Mode flags (raw)" value={`0x${data.status.flightModeFlagsRaw.toString(16).padStart(8, '0')}`} />
              </>
            ) : (
              <div className="text-xs font-mono text-slate-500">{data.cmdErrors[MSP.STATUS_EX] ? `Not available: ${data.cmdErrors[MSP.STATUS_EX]}` : 'Waiting for the first status frame.'}</div>
            )}
          </Card>
          <Card title="Sensors" icon={Activity}>
            {data.status ? (
              <div className="grid grid-cols-2 gap-1">
                {data.status.sensors.map((s) => (
                  <div key={s.name} className={`text-xs font-mono px-2 py-1 rounded border ${s.present ? 'border-emerald-800 text-emerald-300' : 'border-slate-800 text-slate-600'}`}>
                    {s.name} {s.present ? 'present' : 'absent'}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs font-mono text-slate-500">No sensor data yet.</div>
            )}
          </Card>
          <p className="md:col-span-2 text-[11px] text-slate-500">
            Arming-disabled reasons are not decoded in this version. The raw mode-flag word is shown above instead, because its bit layout
            differs between Betaflight and INAV and is not decoded here.
          </p>
        </div>
      )}

      {tab === 'live' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card title="Attitude (MSP_ATTITUDE 108)" icon={Plane}>
            <div className="flex flex-col sm:flex-row gap-3 items-center">
              <Horizon rollDeg={data.attitude?.rollDeg} pitchDeg={data.attitude?.pitchDeg} />
              <div className="flex-1 w-full">
                <Field label="Roll" value={data.attitude ? `${fmt(data.attitude.rollDeg)} deg` : '--'} />
                <Field label="Pitch" value={data.attitude ? `${fmt(data.attitude.pitchDeg)} deg` : '--'} />
                <Field label="Yaw" value={data.attitude ? `${data.attitude.yawDeg} deg` : '--'} />
                {data.cmdErrors[MSP.ATTITUDE] && <div className="text-[11px] text-amber-300 mt-1">{data.cmdErrors[MSP.ATTITUDE]}</div>}
              </div>
            </div>
          </Card>
          <Card title="Raw IMU (MSP_RAW_IMU 102)" icon={Activity}>
            <GyroChart history={data.imuHistory} />
            <div className="mt-2">
              <Field label="Accel X/Y/Z (raw)" value={data.imu ? data.imu.acc.join(' / ') : '--'} />
              <Field label="Gyro X/Y/Z (raw)" value={data.imu ? data.imu.gyro.join(' / ') : '--'} />
              <Field label="Mag X/Y/Z (raw)" value={data.imu ? data.imu.mag.join(' / ') : '--'} />
            </div>
            {data.cmdErrors[MSP.RAW_IMU] && <div className="text-[11px] text-amber-300 mt-1">{data.cmdErrors[MSP.RAW_IMU]}</div>}
          </Card>
          <Card title="Receiver (MSP_RC 105)" icon={Activity}>
            {data.rc && data.rc.length ? (
              <div className="space-y-1">
                {data.rc.map((v, i) => <Bar key={i} label={`CH${i + 1}`} value={v} min={1000} max={2000} />)}
              </div>
            ) : (
              <div className="text-xs font-mono text-slate-500">No receiver data yet.</div>
            )}
          </Card>
          <Card title="Battery (MSP_ANALOG 110)" icon={Battery}>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="border border-slate-800 rounded p-2"><div className="text-[10px] text-slate-500 font-mono">VOLTAGE</div><div className="text-lg font-mono">{data.analog ? `${fmt(data.analog.voltageV)} V` : '--'}</div></div>
              <div className="border border-slate-800 rounded p-2"><div className="text-[10px] text-slate-500 font-mono">CURRENT</div><div className="text-lg font-mono">{data.analog ? `${fmt(data.analog.currentA, 2)} A` : '--'}</div></div>
              <div className="border border-slate-800 rounded p-2"><div className="text-[10px] text-slate-500 font-mono">USED</div><div className="text-lg font-mono">{data.analog ? `${data.analog.mahDrawn} mAh` : '--'}</div></div>
              <div className="border border-slate-800 rounded p-2"><div className="text-[10px] text-slate-500 font-mono">RSSI (RAW)</div><div className="text-lg font-mono">{data.analog ? data.analog.rssiRaw : '--'}</div></div>
            </div>
          </Card>
          <Card title="Motors (MSP_MOTOR 104), readout only" icon={Gauge} className="md:col-span-2">
            {data.motors && data.motors.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {data.motors.map((v, i) => <Bar key={i} label={`M${i + 1}`} value={v} min={1000} max={2000} />)}
              </div>
            ) : (
              <div className="text-xs font-mono text-slate-500">No motor readout yet.</div>
            )}
            <p className="text-[11px] text-slate-500 mt-2">This tool only reads motor values. It never spins or tests motors.</p>
          </Card>
          {hasNoReplies && (
            <div className="md:col-span-2 text-xs text-amber-300 border border-amber-800 rounded p-2">
              No MSP replies after {stats.requests} requests. Check that the flight controller is powered, this is its USB serial port,
              the port is at {MSP_BAUD_RATE} bps, and the board is not sitting in the CLI (use Disconnect, reconnect, and try again).
            </div>
          )}
        </div>
      )}

      {tab === 'cli' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {mode === 'msp' ? (
              <button type="button" onClick={enterCli} disabled={!connected} className="text-xs px-3 py-1.5 rounded border border-cyan-700 text-cyan-300 hover:bg-cyan-950 disabled:opacity-40">
                <Terminal size={12} className="inline mr-1" />Enter CLI (#)
              </button>
            ) : (
              <button type="button" onClick={() => setConfirmExit(true)} disabled={mode !== 'cli'} className="text-xs px-3 py-1.5 rounded border border-amber-700 text-amber-300 hover:bg-amber-950 disabled:opacity-40">
                Exit CLI
              </button>
            )}
            <button type="button" onClick={() => startCapture('diff all', 'diff all')} disabled={mode !== 'cli' || Boolean(capture && capture.running)} className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-cyan-700 disabled:opacity-40">
              Capture diff all
            </button>
            <button type="button" onClick={() => startCapture('dump', 'dump')} disabled={mode !== 'cli' || Boolean(capture && capture.running)} className="text-xs px-3 py-1.5 rounded border border-slate-700 text-slate-300 hover:border-cyan-700 disabled:opacity-40">
              Capture dump
            </button>
            {capture && !capture.running && capture.text && (
              <button
                type="button"
                onClick={() => downloadTextFile(`${variantName.replace(/\s+/g, '-').toLowerCase()}-${capture.label.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.txt`, capture.text)}
                className="text-xs px-3 py-1.5 rounded border border-emerald-700 text-emerald-300 hover:bg-emerald-950"
              >
                <Download size={12} className="inline mr-1" />Download {capture.label} ({capture.chars} chars)
              </button>
            )}
          </div>

          {capture && capture.running && (
            <div className="text-[11px] font-mono text-cyan-300">Capturing "{capture.label}"... {capture.chars} chars so far. Finishes when the # prompt returns.</div>
          )}
          {capture && !capture.running && capture.incomplete && (
            <div className="text-[11px] font-mono text-amber-300">Capture of "{capture.label}" stopped before the # prompt returned. The file may be incomplete.</div>
          )}

          {confirmExit && (
            <div className="text-xs border border-amber-700 bg-amber-950/40 rounded p-3 space-y-2">
              <div className="flex items-center gap-2 text-amber-300"><AlertTriangle size={14} />Exiting the CLI reboots the flight controller.</div>
              <div className="text-slate-300">Anything not saved with <code className="font-mono">save</code> is lost on reboot. The USB serial port may drop and need reconnecting.</div>
              <div className="flex gap-2">
                <button type="button" onClick={confirmExitCli} className="px-3 py-1 rounded border border-amber-600 text-amber-200 hover:bg-amber-900">Send exit and reboot</button>
                <button type="button" onClick={() => setConfirmExit(false)} className="px-3 py-1 rounded border border-slate-700 text-slate-300">Cancel</button>
              </div>
            </div>
          )}

          <pre className="bg-slate-950 border border-slate-800 rounded p-2 h-72 overflow-auto text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all" aria-label="CLI output">
            {cliText || (mode === 'cli' ? '' : 'CLI output appears here after you enter the CLI.')}
          </pre>
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); submitCliInput(); }}
          >
            <input
              value={cliInput}
              onChange={(e) => setCliInput(e.target.value)}
              disabled={mode !== 'cli'}
              placeholder={mode === 'cli' ? 'Type a CLI command (set, diff, status, save ...)' : 'Enter the CLI first'}
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-200 disabled:opacity-40"
              aria-label="CLI command"
            />
            <button type="submit" disabled={mode !== 'cli' || !cliInput.trim()} className="text-xs px-3 py-1 rounded border border-cyan-700 text-cyan-300 disabled:opacity-40">
              <Send size={12} className="inline mr-1" />Send
            </button>
          </form>
          <p className="text-[11px] text-slate-500">
            Commands are sent only when you type them. Typing <code className="font-mono">exit</code> asks for confirmation first, because it reboots the board.
            Settings change only through commands you type (for example <code className="font-mono">set</code> and <code className="font-mono">save</code>).
          </p>
        </div>
      )}

      <footer className="text-[10px] font-mono text-slate-600 flex flex-wrap gap-x-4">
        <span>requests {stats.requests}</span>
        <span>replies {stats.responses}</span>
        <span>timeouts {stats.timeouts}</span>
        <span>not supported {stats.rejected}</span>
        <span>bad frames {stats.corrupt}</span>
      </footer>
    </div>
  );
}
