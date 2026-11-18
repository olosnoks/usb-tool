import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Cpu, Signal, Globe, Wifi, Mail, Satellite, Play, Terminal, Plug, Power, RefreshCw, Trash2, Send, Copy, Eye, Inbox, Info, Download, FileText, Search } from 'lucide-react';
import { useOptionalSerial } from '../../context/SerialContext';
import {
  createAtEngine, firstValue, detectFamily, parseImei, parseImsi, parseIccid, parseCpin,
  parseCsq, parseCesq, parseCellLine, csqQuality, rsrpQuality, rsrqQuality,
  parseRegistration, parseCops, parseCgdcont, buildCgdcont,
  parseCmgl, parseCmgr, parseCmti, parseCmgs, validateSmsNumber, isAsciiText, smsPartCount,
  parseCgpsinfo, parseQgpsloc, riskyReason, QUICK_COMMANDS, parseQuickCommandText,
} from '../../utils/atModem.js';
import { decodeSmsPdu, signalHistoryToCsv, logToText, searchAtReference } from '../../utils/atModemExtras.js';

/**
 * AT Modem Console for cellular modules (SIMCom SIM7600/SIM800, Quectel EC25/BG96,
 * u-blox SARA) over the shared serial port. Every value shown is the modem's reply to a
 * command this tool sent. Replies are shown as received; nothing is estimated or simulated.
 */

const TABS = [
  ['identify', 'Identify', Cpu],
  ['signal', 'Signal', Signal],
  ['network', 'Network', Globe],
  ['apn', 'APN / PDP', Wifi],
  ['sms', 'SMS', Mail],
  ['pdu', 'PDU decode', FileText],
  ['gnss', 'GNSS', Satellite],
  ['quick', 'Quick commands', Play],
  ['console', 'Console', Terminal],
];

const VENDORS = [['simcom', 'SIMCom'], ['quectel', 'Quectel']];
const PDP_TYPES = ['IP', 'IPV6', 'IPV4V6'];
const POLL_OPTIONS = [2, 5, 10, 30];
const CUSTOM_KEY = 'atModem.quickCommands';
const DEFAULT_CUSTOM = 'AT+CSQ\nAT+COPS?\nAT+CREG?';

const field = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-700 disabled:opacity-50';
const TONE = {
  cyan: 'border-cyan-700/70 text-cyan-300 hover:bg-cyan-950/40',
  emerald: 'border-emerald-700/70 text-emerald-300 hover:bg-emerald-950/40',
  amber: 'border-amber-700/70 text-amber-300 hover:bg-amber-950/40',
  rose: 'border-rose-800/80 text-rose-300 hover:bg-rose-950/40',
  slate: 'border-slate-700 text-slate-300 hover:bg-slate-900',
};

function Btn({ tone = 'cyan', className = '', children, ...rest }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border bg-slate-950 text-[11px] font-mono disabled:opacity-40 disabled:cursor-not-allowed ${TONE[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function Panel({ title, hint, right, children }) {
  return (
    <section className="bg-slate-950 border border-slate-800 rounded-lg p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div>
          <h3 className="text-xs font-bold tracking-wide text-slate-200 uppercase">{title}</h3>
          {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kv({ k, v, mono = true }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 border-b border-slate-900 last:border-0">
      <span className="text-[11px] text-slate-500 shrink-0">{k}</span>
      <span className={`text-xs text-right break-all ${mono ? 'font-mono' : ''} text-gray-200`}>{v ?? '—'}</span>
    </div>
  );
}

function Notice({ tone = 'slate', children }) {
  const cls = {
    slate: 'border-slate-800 text-slate-400',
    amber: 'border-amber-600/50 bg-amber-950/30 text-amber-200',
    rose: 'border-rose-700/50 bg-rose-950/30 text-rose-200',
    emerald: 'border-emerald-700/50 bg-emerald-950/30 text-emerald-200',
  }[tone];
  return <div className={`text-[11px] border rounded px-2 py-1.5 ${cls}`}>{children}</div>;
}

/** Text describing why a command did not succeed; empty for success. */
function describeResult(r) {
  if (!r) return '';
  if (r.timedOut) return 'No response from the modem (timeout).';
  if (r.error) {
    if (r.error.code !== null && r.error.code !== undefined) return `${r.error.type} ERROR ${r.error.code}: ${r.error.text}`;
    return r.error.text;
  }
  return '';
}

const pick = (lines, prefix) => (lines || []).find((l) => l.toUpperCase().startsWith(prefix.toUpperCase()));
const confirmAction = (msg) => (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(msg) : false);

function readStored(key, fallback) {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* storage full or blocked: the list just is not kept */
  }
}

function downloadText(name, text, type = 'text/plain') {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SignalChart({ points }) {
  if (points.length < 2) {
    return (
      <div className="h-24 flex items-center justify-center text-[11px] text-slate-600 border border-slate-800 rounded bg-black">
        Read the signal twice or more to draw the chart.
      </div>
    );
  }
  const W = 600;
  const H = 120;
  const clamp = (v) => Math.min(-40, Math.max(-120, v));
  const x = (i) => (i / (points.length - 1)) * W;
  const y = (v) => H - ((clamp(v) + 120) / 80) * H;
  const series = (key, color) => {
    const pts = points.map((p, i) => [i, p[key]]).filter(([, v]) => v !== null && v !== undefined);
    if (pts.length < 2) return null;
    return (
      <polyline
        key={key}
        fill="none"
        stroke={color}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
        points={pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
      />
    );
  };
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full bg-black border border-slate-800 rounded" style={{ height: 140 }}>
        {[-100, -80, -60].map((v) => <line key={v} x1="0" x2={W} y1={y(v)} y2={y(v)} stroke="#1e293b" strokeWidth="1" />)}
        {series('rssi', '#22d3ee')}
        {series('rsrp', '#fbbf24')}
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] text-slate-500 mt-1">
        <span><span className="text-cyan-300">---</span> RSSI from CSQ</span>
        <span><span className="text-amber-300">---</span> RSRP from CESQ or cell info</span>
        <span>scale -120 to -40 dBm</span>
      </div>
    </div>
  );
}

export default function AtModemWorkbench({ onLogMessage }) {
  const serial = useOptionalSerial();
  const connected = !!serial?.isConnected;

  // Refs the long-lived engine and async handlers read, so they never see stale closures.
  const serialRef = useRef(serial);
  serialRef.current = serial;
  const onLogRef = useRef(onLogMessage);
  onLogRef.current = onLogMessage;
  const onLineRef = useRef(null);
  const signalRef = useRef(null);
  const pollInFlight = useRef(false);
  const logIdRef = useRef(0);
  const logEndRef = useRef(null);

  const [engine] = useState(() => createAtEngine({
    write: (bytes) => {
      const s = serialRef.current;
      if (!s || typeof s.sendRawBytes !== 'function') return undefined;
      return s.sendRawBytes(bytes);
    },
    onLine: (line, isUrc) => onLineRef.current?.(line, isUrc),
    timeoutMs: 5000,
  }));

  const [tab, setTab] = useState('identify');
  const [vendor, setVendor] = useState('simcom');
  const [notice, setNotice] = useState('');
  const [log, setLog] = useState([]);

  // Identify
  const [identity, setIdentity] = useState(null);
  // Signal
  const [signal, setSignal] = useState(null);
  const [history, setHistory] = useState([]);
  const [polling, setPolling] = useState(false);
  const [pollSec, setPollSec] = useState(5);
  // Network
  const [reg, setReg] = useState({});
  const [operator, setOperator] = useState(null);
  // APN
  const [contexts, setContexts] = useState(null);
  const [apnForm, setApnForm] = useState({ cid: 1, type: 'IP', apn: '' });
  const [apnMsg, setApnMsg] = useState('');
  // SMS
  const [messages, setMessages] = useState(null);
  const [smsIndex, setSmsIndex] = useState('');
  const [smsRead, setSmsRead] = useState(null);
  const [smsTo, setSmsTo] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [smsStatus, setSmsStatus] = useState('');
  const [newSms, setNewSms] = useState(null);
  // GNSS
  const [gnss, setGnss] = useState(null);
  const [gnssStatus, setGnssStatus] = useState('');
  // PDU decoder
  const [pduText, setPduText] = useState('');
  const [pduSmsc, setPduSmsc] = useState(true);
  // Command reference
  const [refQuery, setRefQuery] = useState('');
  // Quick commands and console
  const [lastQuick, setLastQuick] = useState(null);
  const [customText, setCustomText] = useState(() => readStored(CUSTOM_KEY, DEFAULT_CUSTOM));
  const [consoleInput, setConsoleInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [histPos, setHistPos] = useState(-1);

  const addLog = useCallback((dir, text) => {
    const id = ++logIdRef.current;
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-499), { id, ts, dir, text }]);
  }, []);

  /** Send one command through the engine. Failures are also written to the console log. */
  const run = (cmd, opts) => {
    if (!serialRef.current?.isConnected) {
      const r = { cmd, ok: false, final: null, error: { type: 'LOCAL', code: null, text: 'Not connected. Connect a port in the header first.' }, lines: [], timedOut: false };
      addLog('sys', r.error.text);
      return Promise.resolve(r);
    }
    addLog('tx', cmd);
    return engine.send(cmd, opts).then((r) => {
      if (r.timedOut || (r.error && r.error.type !== 'AT')) addLog('sys', `${cmd}: ${describeResult(r)}`);
      return r;
    });
  };

  // Lines that arrive without a command in flight (or inside one, unsolicited) come here.
  onLineRef.current = (line, isUrc) => {
    addLog(isUrc ? 'urc' : 'rx', line);
    if (!isUrc) return;
    const r = parseRegistration(line);
    if (r) setReg((prev) => ({ ...prev, [r.kind]: r }));
    const sms = parseCmti(line);
    if (sms) setNewSms(sms);
  };

  // Feed bytes from the shared port into the engine (only the board this tool is attached to).
  useEffect(() => {
    if (!serial?.subscribeRx) return undefined;
    return serial.subscribeRx((bytes, boardId) => {
      if (boardId !== serialRef.current?.activeBoardId) return;
      engine.feed(bytes);
    });
  }, [serial?.subscribeRx, engine]);

  // Port dropped: fail whatever is waiting and stop polling.
  useEffect(() => {
    if (!connected) {
      engine.abort('Port disconnected');
      setPolling(false);
    }
  }, [connected, engine]);

  useEffect(() => {
    if (logEndRef.current) logEndRef.current.scrollTop = logEndRef.current.scrollHeight;
  }, [log.length]);

  useEffect(() => writeStored(CUSTOM_KEY, customText), [customText]);

  // ---- Identify ----------------------------------------------------------
  const identify = async () => {
    setNotice('');
    const ati = await run('ATI');
    const mi = await run('AT+CGMI', { prefixes: [] });
    const mm = await run('AT+CGMM', { prefixes: [] });
    const mr = await run('AT+CGMR', { prefixes: [] });
    const sn = await run('AT+CGSN', { prefixes: [] });
    const im = await run('AT+CIMI', { prefixes: [] });
    let ic = await run('AT+CCID', { prefixes: [] });
    if (!ic.ok) ic = await run('AT+QCCID', { prefixes: [] });
    const cp = await run('AT+CPIN?', { prefixes: ['+CPIN:'] });
    const manufacturer = mi.ok ? firstValue(mi.lines) : '';
    const model = mm.ok ? firstValue(mm.lines) : '';
    const family = detectFamily(manufacturer, model);
    setIdentity({
      ati: ati.lines || [],
      atiError: ati.ok ? '' : describeResult(ati),
      manufacturer,
      model,
      revision: mr.ok ? firstValue(mr.lines) : '',
      imei: sn.ok ? parseImei(sn.lines) : null,
      imsi: im.ok ? parseImsi(im.lines) : null,
      iccid: ic.ok ? parseIccid(ic.lines) : null,
      sim: cp.ok ? parseCpin(cp.lines) : null,
      simError: cp.ok ? '' : describeResult(cp),
      family,
    });
    if (family === 'simcom' || family === 'quectel') setVendor(family);
    if (manufacturer || model) onLogRef.current?.(`AT modem: ${manufacturer} ${model}`.trim(), 'info');
  };

  const initModem = async () => {
    const e = await run('ATE0');
    if (!e.ok) { setNotice(`ATE0 failed: ${describeResult(e)}`); return; }
    await run('ATV1');
    const c = await run('AT+CMEE=1');
    setNotice(c.ok ? 'Echo off, verbose results, numeric errors (CMEE=1) set.' : `AT+CMEE=1 failed: ${describeResult(c)}`);
  };

  // ---- Signal ------------------------------------------------------------
  const readSignal = async () => {
    if (!serialRef.current?.isConnected) { setNotice('Connect a port in the header to read signal.'); return; }
    const csqR = await run('AT+CSQ', { prefixes: ['+CSQ:'] });
    const csq = csqR.ok ? parseCsq(pick(csqR.lines, '+CSQ:')) : null;
    const cesqR = await run('AT+CESQ', { prefixes: ['+CESQ:'] });
    const cesq = cesqR.ok ? parseCesq(pick(cesqR.lines, '+CESQ:')) : null;
    const cellPrefix = vendor === 'quectel' ? '+QENG:' : '+CPSI:';
    const cellR = await run(vendor === 'quectel' ? 'AT+QENG="servingcell"' : 'AT+CPSI?', { prefixes: [cellPrefix] });
    const cell = cellR.ok ? (cellR.lines.map(parseCellLine).find(Boolean) ?? null) : null;
    setSignal({
      at: new Date().toLocaleTimeString(),
      csq, csqError: csqR.ok ? '' : describeResult(csqR),
      cesq, cesqError: cesqR.ok ? (cesq ? '' : 'Reply not recognised') : describeResult(cesqR),
      cell, cellError: cellR.ok ? (cell ? '' : 'Reply not recognised') : describeResult(cellR),
    });
    const rssi = csq?.dbm ?? null;
    const rsrp = cesq?.rsrpDbm ?? cell?.rsrp ?? null;
    if (rssi !== null || rsrp !== null) {
      setHistory((h) => [...h.slice(-119), { t: Date.now(), rssi, rsrp }]);
    }
  };
  signalRef.current = readSignal;

  useEffect(() => {
    if (!polling || !connected) return undefined;
    const id = setInterval(() => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      Promise.resolve(signalRef.current?.()).finally(() => { pollInFlight.current = false; });
    }, Math.max(1, pollSec) * 1000);
    return () => clearInterval(id);
  }, [polling, connected, pollSec]);

  // ---- Network -----------------------------------------------------------
  const readNetwork = async () => {
    const next = {};
    for (const kind of ['CREG', 'CGREG', 'CEREG']) {
      const r = await run(`AT+${kind}?`, { prefixes: [`+${kind}:`] });
      const line = r.ok ? pick(r.lines, `+${kind}:`) : undefined;
      const parsed = line ? parseRegistration(line, { query: true }) : null;
      next[kind] = parsed || { kind, error: r.ok ? 'Reply not recognised' : describeResult(r) };
    }
    setReg(next);
    const op = await run('AT+COPS?', { prefixes: ['+COPS:'] });
    setOperator(op.ok ? parseCops(pick(op.lines, '+COPS:')) : { error: describeResult(op) });
  };

  // ---- APN / PDP ---------------------------------------------------------
  const readContexts = async () => {
    const r = await run('AT+CGDCONT?', { prefixes: ['+CGDCONT:'] });
    if (!r.ok) { setContexts({ error: describeResult(r) }); return; }
    setContexts(parseCgdcont(r.lines));
  };

  const setContext = async () => {
    const built = buildCgdcont(apnForm.cid, apnForm.type, apnForm.apn);
    if (built.error) { setApnMsg(built.error); return; }
    if (!apnForm.apn.trim()) { setApnMsg('Enter the APN name.'); return; }
    const r = await run(built.cmd);
    if (!r.ok) { setApnMsg(describeResult(r)); return; }
    setApnMsg(`Context ${apnForm.cid} saved. Reading the list back.`);
    await readContexts();
  };

  // ---- SMS ---------------------------------------------------------------
  const loadSms = async () => {
    const f = await run('AT+CMGF=1');
    if (!f.ok) { setSmsStatus(describeResult(f)); return; }
    const r = await run('AT+CMGL="ALL"', { prefixes: ['+CMGL:'], timeoutMs: 20000 });
    if (!r.ok) { setSmsStatus(describeResult(r)); return; }
    const list = parseCmgl(r.lines);
    setMessages(list);
    setSmsStatus(`${list.length} message(s) in storage.`);
  };

  const readSms = async (idx) => {
    const n = Number(idx);
    if (!Number.isInteger(n) || n < 0) { setSmsStatus('Enter a message index (0 or more).'); return; }
    const f = await run('AT+CMGF=1');
    if (!f.ok) { setSmsStatus(describeResult(f)); return; }
    const r = await run(`AT+CMGR=${n}`, { prefixes: ['+CMGR:'], timeoutMs: 15000 });
    if (!r.ok) { setSmsStatus(describeResult(r)); return; }
    const msg = parseCmgr(r.lines);
    if (!msg) { setSmsStatus(`No message at index ${n}.`); setSmsRead(null); return; }
    setSmsRead({ ...msg, index: n });
    setSmsStatus(`Read index ${n}.`);
  };

  const deleteSms = async (idx) => {
    if (!confirmAction(`Delete the SMS at index ${idx}? This cannot be undone.`)) return;
    const r = await run(`AT+CMGD=${idx}`);
    if (!r.ok) { setSmsStatus(describeResult(r)); return; }
    setSmsRead((cur) => (cur && cur.index === idx ? null : cur));
    setSmsStatus(`Deleted index ${idx}.`);
    await loadSms();
  };

  const sendSms = async () => {
    const problem = validateSmsNumber(smsTo)
      || (!smsBody.trim() ? 'Enter a message.' : null)
      || (!isAsciiText(smsBody) ? 'Text mode here sends plain ASCII only. Remove accents, emoji or symbols.' : null);
    if (problem) { setSmsStatus(problem); return; }
    const f = await run('AT+CMGF=1');
    if (!f.ok) { setSmsStatus(describeResult(f)); return; }
    const to = smsTo.trim();
    const body = smsBody.replace(/\r?\n/g, '\r');
    addLog('tx', `[SMS body to ${to}, ${smsPartCount(smsBody)} part(s)] ${smsBody}`);
    setSmsStatus('Sending...');
    const r = await run(`AT+CMGS="${to}"`, { prompt: body, prefixes: ['+CMGS:'], timeoutMs: 60000 });
    if (r.ok) {
      const ref = parseCmgs(r.lines);
      setSmsStatus(`Sent${ref !== null ? `, message reference ${ref}` : ''}.`);
      setSmsBody('');
    } else {
      setSmsStatus(`Not sent: ${describeResult(r)}`);
    }
  };

  // ---- GNSS --------------------------------------------------------------
  const gnssCmds = vendor === 'quectel'
    ? { start: 'AT+QGPS=1', stop: 'AT+QGPSEND', read: 'AT+QGPSLOC=2', prefix: '+QGPSLOC:', parse: parseQgpsloc }
    : { start: 'AT+CGPS=1', stop: 'AT+CGPS=0', read: 'AT+CGPSINFO', prefix: '+CGPSINFO:', parse: parseCgpsinfo };

  const gnssStart = async () => {
    const r = await run(gnssCmds.start);
    setGnssStatus(r.ok ? 'GNSS started. Wait for a fix (outdoors, a minute or more), then read the fix.' : `Start failed: ${describeResult(r)}`);
  };
  const gnssStop = async () => {
    const r = await run(gnssCmds.stop);
    setGnssStatus(r.ok ? 'GNSS stopped.' : `Stop failed: ${describeResult(r)}`);
  };
  const gnssRead = async () => {
    const r = await run(gnssCmds.read, { prefixes: [gnssCmds.prefix] });
    if (!r.ok) { setGnssStatus(describeResult(r)); setGnss(null); return; }
    const line = pick(r.lines, gnssCmds.prefix);
    const parsed = line ? gnssCmds.parse(line) : null;
    if (!parsed) { setGnssStatus('Reply not recognised.'); setGnss(null); return; }
    setGnss({ ...parsed, raw: line });
    setGnssStatus(parsed.fix ? 'Fix received.' : 'No fix yet.');
  };

  // ---- Quick commands and console ----------------------------------------
  const runQuick = async (cmd) => {
    const why = riskyReason(cmd);
    if (why && !confirmAction(`${cmd} ${why}. Send it?`)) return;
    const r = await run(cmd);
    setLastQuick({ cmd, r });
  };

  const runCustomList = async () => {
    const cmds = parseQuickCommandText(customText);
    for (const cmd of cmds) {
      const why = riskyReason(cmd);
      if (why && !confirmAction(`${cmd} ${why}. Send it and continue the list?`)) {
        addLog('sys', `List stopped before ${cmd}.`);
        return;
      }
      const r = await run(cmd);
      if (!r.ok) { addLog('sys', `List stopped at ${cmd}.`); return; }
    }
    addLog('sys', `List finished (${cmds.length} command(s)).`);
  };

  const sendConsole = async () => {
    const cmd = consoleInput.trim();
    if (!cmd) return;
    const why = riskyReason(cmd);
    if (why && !confirmAction(`${cmd} ${why}. Send it?`)) return;
    setCmdHistory((h) => [cmd, ...h.filter((c) => c !== cmd)].slice(0, 50));
    setHistPos(-1);
    setConsoleInput('');
    await run(cmd);
  };

  const onConsoleKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendConsole(); return; }
    if (e.key === 'ArrowUp' && cmdHistory.length) {
      e.preventDefault();
      const next = Math.min(histPos + 1, cmdHistory.length - 1);
      setHistPos(next);
      setConsoleInput(cmdHistory[next]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = histPos - 1;
      setHistPos(next);
      setConsoleInput(next < 0 ? '' : cmdHistory[next]);
    }
  };

  const exportLog = () => downloadText('at-modem-log.txt', logToText(log));
  const exportSignal = () => downloadText('at-signal-history.csv', signalHistoryToCsv(history), 'text/csv');
  const pduResult = pduText.trim() ? decodeSmsPdu(pduText, { hasSmsc: pduSmsc }) : null;
  const loadPduFromRead = () => {
    const hit = [...log].reverse().find((e) => e.dir === 'rx' && /^[0-9A-Fa-f]{12,}$/.test(e.text.trim()));
    if (hit) setPduText(hit.text.trim());
  };

  const copyLog = () => {
    const text = log.map((e) => `${e.ts} ${e.dir.toUpperCase()} ${e.text}`).join('\n');
    navigator.clipboard?.writeText(text);
  };

  // ---- Render ------------------------------------------------------------
  const webSerial = typeof navigator !== 'undefined' && 'serial' in navigator;
  const noContext = !serial;
  const lastCell = signal?.cell;

  return (
    <div className="flex flex-col gap-2 text-gray-200 font-sans text-sm">
      <h2 className="sr-only">AT Modem Console</h2>
      <header className="flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${connected ? 'border-emerald-600/60 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
          {connected ? `CONNECTED ${serial?.baudRate ?? ''} bps` : 'NOT CONNECTED'}
        </span>
        {!connected && !noContext && (
          <Btn tone="emerald" onClick={() => serial.connect()} disabled={!webSerial}>
            <Plug className="w-3.5 h-3.5" /> Connect port
          </Btn>
        )}
        {connected && (
          <Btn tone="slate" onClick={() => serial.disconnect()}>
            <Power className="w-3.5 h-3.5" /> Disconnect
          </Btn>
        )}
        <label className="text-[11px] text-slate-500 flex items-center gap-1.5 ml-auto">
          Vendor
          <select className={field} value={vendor} onChange={(e) => setVendor(e.target.value)}>
            {VENDORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
      </header>

      {noContext && (
        <Notice tone="amber">This view has no serial context. Open the app and use the header to connect a port.</Notice>
      )}
      {!noContext && !webSerial && (
        <Notice tone="amber">Web Serial is not available in this browser. Use Chrome, Edge or Opera on desktop or Android.</Notice>
      )}
      {!connected && !noContext && webSerial && (
        <Notice>
          Connect the modem's AT port (baud usually 115200). Vendor only picks the GNSS and cell-info commands.
        </Notice>
      )}
      {notice && <Notice tone="emerald">{notice}</Notice>}

      <nav className="flex flex-wrap gap-1 border-b border-slate-800 pb-1.5" aria-label="AT modem sections">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border ${tab === id ? 'border-cyan-600 bg-cyan-950/40 text-cyan-200' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </nav>

      {tab === 'identify' && (
        <div className="grid gap-2 @md:grid-cols-2">
          <Panel
            title="Identify module"
            hint="ATI, CGMI, CGMM, CGMR, CGSN (IMEI), CIMI (IMSI), CCID or QCCID (ICCID), CPIN?"
            right={(
              <div className="flex gap-2">
                <Btn onClick={identify} disabled={!connected}><Cpu className="w-3.5 h-3.5" /> Identify</Btn>
                <Btn tone="slate" onClick={initModem} disabled={!connected} title="Sends ATE0, ATV1, AT+CMEE=1">Init modem</Btn>
              </div>
            )}
          >
            {!identity && <p className="text-xs text-slate-600">Not identified yet. Press Identify once connected.</p>}
            {identity && (
              <>
                <Kv k="Manufacturer" v={identity.manufacturer} />
                <Kv k="Model" v={identity.model} />
                <Kv k="Revision" v={identity.revision} />
                <Kv k="IMEI" v={identity.imei} />
                <Kv k="IMSI (SIM)" v={identity.imsi} />
                <Kv k="ICCID (SIM)" v={identity.iccid} />
                <Kv k="SIM state (CPIN?)" v={identity.sim || identity.simError} />
                <Kv k="Family from reply text" v={identity.family === 'unknown' ? 'not recognised' : identity.family} />
                <p className="text-[10px] text-slate-600 mt-2">IMEI, IMSI and ICCID are identifiers. Do not paste them into public places.</p>
              </>
            )}
          </Panel>
          <Panel title="ATI raw reply" hint="Exactly what ATI returned.">
            {identity?.atiError && <Notice tone="rose">{identity.atiError}</Notice>}
            <pre className="text-[11px] font-mono text-gray-300 bg-black border border-slate-800 rounded p-2 min-h-[6rem] whitespace-pre-wrap break-all">
              {identity ? (identity.ati.join('\n') || '(no lines)') : ''}
            </pre>
          </Panel>
        </div>
      )}

      {tab === 'signal' && (
        <div className="grid gap-2">
          <Panel
            title="Signal and serving cell"
            hint={`CSQ and CESQ for signal; ${vendor === 'quectel' ? 'AT+QENG="servingcell"' : 'AT+CPSI?'} for the cell.`}
            right={(
              <div className="flex flex-wrap items-center gap-2">
                <Btn onClick={readSignal} disabled={!connected}><RefreshCw className="w-3.5 h-3.5" /> Read now</Btn>
                <label className="text-[11px] text-slate-500 flex items-center gap-1.5">
                  <input type="checkbox" checked={polling} onChange={(e) => setPolling(e.target.checked)} disabled={!connected} />
                  Poll every
                  <select className={field} value={pollSec} onChange={(e) => setPollSec(Number(e.target.value))}>
                    {POLL_OPTIONS.map((s) => <option key={s} value={s}>{s} s</option>)}
                  </select>
                </label>
                <Btn tone="slate" onClick={exportSignal} disabled={!history.length} title="Download the readings as CSV"><Download className="w-3.5 h-3.5" /> CSV</Btn>
                <Btn tone="slate" onClick={() => setHistory([])} disabled={!history.length} title="Clear chart"><Trash2 className="w-3.5 h-3.5" /> Clear</Btn>
              </div>
            )}
          >
            <div className="grid gap-2 @md:grid-cols-3">
              <div>
                <div className="text-[11px] text-slate-500 mb-1">CSQ (RSSI)</div>
                {signal?.csq ? (
                  <>
                    <div className="text-2xl font-mono text-cyan-300">{signal.csq.dbm === null ? 'unknown' : `${signal.csq.dbm} dBm`}</div>
                    <Kv k="Index" v={`${signal.csq.rssi} (${csqQuality(signal.csq.dbm)}, rough guide)`} />
                    <Kv k="BER" v={signal.csq.berText} />
                  </>
                ) : <Notice>{signal?.csqError || 'No reading yet.'}</Notice>}
              </div>
              <div>
                <div className="text-[11px] text-slate-500 mb-1">CESQ (LTE / 3G)</div>
                {signal?.cesq ? (
                  <>
                    <Kv k="RSRP" v={signal.cesq.rsrpDbm === null ? 'unknown' : `${signal.cesq.rsrpDbm} dBm (${rsrpQuality(signal.cesq.rsrpDbm)})`} />
                    <Kv k="RSRQ" v={signal.cesq.rsrqDb === null ? 'unknown' : `${signal.cesq.rsrqDb} dB (${rsrqQuality(signal.cesq.rsrqDb)})`} />
                    <Kv k="RxLev" v={signal.cesq.rxlevDbm === null ? 'unknown' : `${signal.cesq.rxlevDbm} dBm`} />
                  </>
                ) : <Notice>{signal?.cesqError || 'Not read yet. Some firmware does not support CESQ.'}</Notice>}
              </div>
              <div>
                <div className="text-[11px] text-slate-500 mb-1">Serving cell</div>
                {lastCell ? (
                  <>
                    <Kv k="System" v={lastCell.rat || lastCell.system} />
                    <Kv k="Operator (MCC-MNC)" v={lastCell.mcc && lastCell.mnc ? `${lastCell.mcc}-${lastCell.mnc}` : null} />
                    <Kv k="Cell ID" v={lastCell.cellId} />
                    <Kv k="TAC / LAC" v={lastCell.tac} />
                    <Kv k="Band" v={lastCell.band} />
                    <Kv k="EARFCN" v={lastCell.earfcn} />
                    <Kv k="PCI" v={lastCell.pci} />
                    <Kv k="RSRP / RSRQ" v={lastCell.rsrp !== undefined && lastCell.rsrp !== null ? `${lastCell.rsrp} / ${lastCell.rsrq ?? '—'}` : null} />
                    <Kv k="SINR" v={lastCell.sinr ?? null} />
                  </>
                ) : <Notice>{signal?.cellError || 'Not read yet.'}</Notice>}
              </div>
            </div>
            <p className="text-[10px] text-slate-600 mt-2">
              Quality words are a rough guide. The CPSI tail order follows SIMCom's documented LTE layout; check it against your module if the numbers look wrong.
            </p>
          </Panel>
          <Panel title="Signal history" hint="Each reading taken this session. Polling is off by default.">
            <SignalChart points={history} />
          </Panel>
        </div>
      )}

      {tab === 'network' && (
        <div className="grid gap-2 @md:grid-cols-2">
          <Panel
            title="Registration"
            hint="CREG (2G/3G circuit), CGREG (GPRS), CEREG (LTE). URC changes update this panel live."
            right={<Btn onClick={readNetwork} disabled={!connected}><RefreshCw className="w-3.5 h-3.5" /> Read</Btn>}
          >
            {['CREG', 'CGREG', 'CEREG'].map((k) => {
              const r = reg[k];
              return (
                <div key={k} className="py-1.5 border-b border-slate-900 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] text-slate-500">{k}</span>
                    <span className={`text-xs ${r?.registered ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {r ? (r.error ? r.error : r.statusText) : 'not read'}
                    </span>
                  </div>
                  {r && !r.error && (r.lac || r.ci || r.act !== null) && (
                    <div className="text-[10px] font-mono text-slate-500 text-right">
                      {r.lac ? `LAC/TAC ${r.lac} ` : ''}{r.ci ? `CI ${r.ci} ` : ''}{r.act !== null ? `ACT ${r.act}` : ''}
                    </div>
                  )}
                </div>
              );
            })}
          </Panel>
          <Panel title="Operator" hint="AT+COPS? (current operator, not a network scan).">
            {operator?.error && <Notice tone="rose">{operator.error}</Notice>}
            {operator && !operator.error && (
              <>
                <Kv k="Operator" v={operator.operator || 'none registered'} mono={false} />
                <Kv k="Access technology" v={operator.actText} />
                <Kv k="Registration mode" v={operator.mode} />
              </>
            )}
            {!operator && <p className="text-xs text-slate-600">Press Read to query registration and the operator.</p>}
          </Panel>
        </div>
      )}

      {tab === 'apn' && (
        <div className="grid gap-2 @md:grid-cols-2">
          <Panel
            title="PDP contexts"
            hint="AT+CGDCONT? lists the stored APN for each context id."
            right={<Btn onClick={readContexts} disabled={!connected}><RefreshCw className="w-3.5 h-3.5" /> Read</Btn>}
          >
            {contexts?.error && <Notice tone="rose">{contexts.error}</Notice>}
            {Array.isArray(contexts) && contexts.length === 0 && <p className="text-xs text-slate-500">No contexts stored.</p>}
            {Array.isArray(contexts) && contexts.map((c) => (
              <div key={c.cid} className="py-1.5 border-b border-slate-900 last:border-0 text-xs font-mono">
                <span className="text-cyan-300">cid {c.cid}</span> <span className="text-slate-400">{c.type}</span>{' '}
                <span className="text-gray-100">{c.apn || '(empty APN)'}</span>
                {c.addr && c.addr !== '0.0.0.0' && <span className="text-slate-500"> {c.addr}</span>}
              </div>
            ))}
          </Panel>
          <Panel title="Set APN" hint="AT+CGDCONT=<cid>,&quot;type&quot;,&quot;apn&quot;. Setting the APN does not attach or activate data.">
            <div className="grid grid-cols-3 gap-2 text-[11px] text-slate-500">
              <label className="flex flex-col gap-1">Context id
                <input className={field} type="number" min="1" max="16" value={apnForm.cid} onChange={(e) => setApnForm({ ...apnForm, cid: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">PDP type
                <select className={field} value={apnForm.type} onChange={(e) => setApnForm({ ...apnForm, type: e.target.value })}>
                  {PDP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 col-span-3">APN
                <input className={field} value={apnForm.apn} placeholder="e.g. internet" maxLength={100} onChange={(e) => setApnForm({ ...apnForm, apn: e.target.value })} />
              </label>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Btn onClick={setContext} disabled={!connected}><Send className="w-3.5 h-3.5" /> Set APN</Btn>
              {apnMsg && <span className="text-[11px] text-slate-400">{apnMsg}</span>}
            </div>
            <p className="text-[10px] text-slate-600 mt-2">
              Not included: user/password (AT+CGDCONT has none), AT+CGACT activation and AT+CGATT attach. Those are in the Quick commands tab.
            </p>
          </Panel>
        </div>
      )}

      {tab === 'sms' && (
        <div className="grid gap-2">
          {newSms && (
            <Notice tone="amber">
              <span className="inline-flex items-center gap-2 flex-wrap">
                <Inbox className="w-3.5 h-3.5" /> New message stored at index {newSms.index} (+CMTI).
                <Btn tone="amber" onClick={() => { setSmsIndex(String(newSms.index)); readSms(newSms.index); setNewSms(null); setTab('sms'); }}>
                  <Eye className="w-3.5 h-3.5" /> Read it
                </Btn>
                <Btn tone="slate" onClick={() => setNewSms(null)}>Dismiss</Btn>
              </span>
            </Notice>
          )}
          <div className="grid gap-2 @md:grid-cols-2">
            <Panel
              title="Messages (text mode)"
              hint="AT+CMGF=1, then AT+CMGL=&quot;ALL&quot;."
              right={<Btn onClick={loadSms} disabled={!connected}><RefreshCw className="w-3.5 h-3.5" /> Load</Btn>}
            >
              <div className="flex items-center gap-2 mb-2">
                <input className={`${field} w-24`} inputMode="numeric" placeholder="index" value={smsIndex} onChange={(e) => setSmsIndex(e.target.value)} />
                <Btn onClick={() => readSms(smsIndex)} disabled={!connected || smsIndex === ''}><Eye className="w-3.5 h-3.5" /> Read index</Btn>
              </div>
              <div className="max-h-72 overflow-auto border border-slate-800 rounded">
                {messages === null && <p className="p-2 text-xs text-slate-600">Not loaded.</p>}
                {messages && messages.length === 0 && <p className="p-2 text-xs text-slate-500">No messages stored.</p>}
                {messages && messages.map((m) => (
                  <div key={m.index} className="p-2 border-b border-slate-900 last:border-0">
                    <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                      <span className="text-cyan-300">#{m.index} {m.status}</span>
                      <span className="flex gap-1">
                        <Btn tone="slate" onClick={() => { setSmsIndex(String(m.index)); readSms(m.index); }}>Open</Btn>
                        <Btn tone="rose" onClick={() => deleteSms(m.index)}><Trash2 className="w-3 h-3" /> Delete</Btn>
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono">{m.sender || 'unknown sender'} {m.timestamp}</div>
                    <div className="text-xs text-gray-200 truncate">{m.body || '(empty body)'}</div>
                  </div>
                ))}
              </div>
              {smsRead && (
                <div className="mt-2 border border-slate-800 rounded p-2 bg-black">
                  <div className="text-[11px] font-mono text-cyan-300">#{smsRead.index} {smsRead.status} from {smsRead.sender || 'unknown'}</div>
                  <div className="text-[10px] text-slate-500 font-mono">{smsRead.timestamp}</div>
                  <pre className="text-xs whitespace-pre-wrap text-gray-200 mt-1">{smsRead.body || '(empty body)'}</pre>
                </div>
              )}
            </Panel>
            <Panel title="Send (text mode)" hint="Plain ASCII, one message part is 160 characters. Sends to the number you give; there is no confirm step.">
              <div className="flex flex-col gap-2 text-[11px] text-slate-500">
                <label className="flex flex-col gap-1">To
                  <input className={field} value={smsTo} placeholder="+15551234567" onChange={(e) => setSmsTo(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1">Message
                  <textarea className={`${field} min-h-[6rem]`} value={smsBody} onChange={(e) => setSmsBody(e.target.value)} />
                </label>
                <div className="flex items-center justify-between">
                  <span>{smsBody.length} characters, {smsPartCount(smsBody)} part(s)</span>
                  <Btn onClick={sendSms} disabled={!connected}><Send className="w-3.5 h-3.5" /> Send SMS</Btn>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <Btn tone="rose" onClick={() => { const i = smsIndex.trim(); if (i !== '') deleteSms(Number(i)); }} disabled={!connected || smsIndex === ''}>
                  <Trash2 className="w-3.5 h-3.5" /> Delete index above
                </Btn>
              </div>
              {smsStatus && <p className="text-[11px] text-slate-400 mt-2">{smsStatus}</p>}
            </Panel>
          </div>
        </div>
      )}

      {tab === 'pdu' && (
        <Panel
          title="SMS PDU decoder"
          hint="Offline: paste a PDU (hex) from AT+CMGR or AT+CMGL in PDU mode (AT+CMGF=0). Nothing is sent to the modem."
          right={<Btn tone="slate" onClick={loadPduFromRead} disabled={!log.some((e) => e.dir === 'rx' && /^[0-9A-Fa-f]{12,}$/.test(e.text.trim()))} title="Use the latest hex line received in the console log">Use last reply</Btn>}
        >
          <label className="flex flex-col gap-1 text-[11px] text-slate-500">PDU hex
            <textarea className={`${field} min-h-[4.5rem] break-all`} value={pduText} spellCheck={false} placeholder="07911326040000F0040B91..." onChange={(e) => setPduText(e.target.value)} />
          </label>
          <label className="text-[11px] text-slate-500 flex items-center gap-1.5 mt-1.5">
            <input type="checkbox" checked={pduSmsc} onChange={(e) => setPduSmsc(e.target.checked)} />
            PDU starts with the SMSC field (untick for a bare TPDU)
          </label>
          <div className="mt-2">
            {!pduResult && <p className="text-xs text-slate-600">Paste a PDU to decode it.</p>}
            {pduResult && !pduResult.ok && <Notice tone="rose">{pduResult.error}</Notice>}
            {pduResult?.ok && (
              <>
                <Kv k="Type" v={pduResult.type} />
                <Kv k={pduResult.type === 'SMS-SUBMIT' ? 'Recipient' : 'Sender'} v={pduResult.address || '(empty)'} />
                {pduResult.smsc && <Kv k="SMSC" v={pduResult.smsc} />}
                {pduResult.time && <Kv k="Service centre time" v={pduResult.time} />}
                <Kv k="Alphabet (DCS)" v={`${pduResult.alphabet} (0x${pduResult.dcs.toString(16).toUpperCase().padStart(2, '0')})`} />
                {pduResult.concat && <Kv k="Multipart" v={`part ${pduResult.concat.part} of ${pduResult.concat.total}, ref ${pduResult.concat.ref}`} />}
                <pre className="text-xs whitespace-pre-wrap text-gray-200 mt-1 bg-black border border-slate-800 rounded p-2">{pduResult.text || '(empty text)'}</pre>
              </>
            )}
          </div>
        </Panel>
      )}

      {tab === 'gnss' && (
        <Panel
          title="GNSS (module's own receiver)"
          hint={vendor === 'quectel'
            ? 'Quectel: AT+QGPS=1 to start, AT+QGPSLOC=2 to read, AT+QGPSEND to stop.'
            : 'SIMCom: AT+CGPS=1 to start, AT+CGPSINFO to read, AT+CGPS=0 to stop.'}
          right={(
            <div className="flex flex-wrap gap-2">
              <Btn tone="emerald" onClick={gnssStart} disabled={!connected}><Play className="w-3.5 h-3.5" /> Start</Btn>
              <Btn onClick={gnssRead} disabled={!connected}><RefreshCw className="w-3.5 h-3.5" /> Read fix</Btn>
              <Btn tone="rose" onClick={gnssStop} disabled={!connected}>Stop</Btn>
            </div>
          )}
        >
          <div className="grid gap-2 @md:grid-cols-2">
            <div>
              {gnss?.fix && (
                <>
                  <Kv k="Latitude" v={gnss.lat} />
                  <Kv k="Longitude" v={gnss.lon} />
                  <Kv k="Altitude (m)" v={gnss.alt} />
                  <Kv k="Speed" v={gnss.speed !== undefined ? gnss.speed : gnss.speedKmh} />
                  <Kv k="Course" v={gnss.course ?? gnss.cog} />
                  <Kv k="Date (ddmmyy)" v={gnss.date} />
                  <Kv k="UTC time" v={gnss.utc} />
                  {gnss.satellites !== undefined && <Kv k="Satellites" v={gnss.satellites} />}
                  {gnss.fixType && <Kv k="Fix type" v={gnss.fixType} />}
                </>
              )}
              {gnss && !gnss.fix && <Notice>No fix yet. Keep the antenna in open sky.</Notice>}
              {!gnss && <p className="text-xs text-slate-600">No fix read yet.</p>}
            </div>
            <div>
              <div className="text-[11px] text-slate-500 mb-1">Raw reply</div>
              <pre className="text-[11px] font-mono text-gray-300 bg-black border border-slate-800 rounded p-2 whitespace-pre-wrap break-all min-h-[5rem]">{gnss?.raw || ''}</pre>
              {gnssStatus && <p className="text-[11px] text-slate-400 mt-2">{gnssStatus}</p>}
              <p className="text-[10px] text-slate-600 mt-2">
                Coordinates are decimal degrees, negative for S and W. Parsing handles both ddmm.mmmm and decimal input.
              </p>
            </div>
          </div>
        </Panel>
      )}

      {tab === 'quick' && (
        <div className="grid gap-2">
          <Panel title="Quick commands" hint="Built-in commands. Commands that drop the radio, reset, delete or change SIM or facility settings ask first.">
            <div className="grid gap-2 @md:grid-cols-2">
              {[...new Set(QUICK_COMMANDS.map((q) => q.group))].map((group) => (
                <div key={group}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-600 mb-1">{group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_COMMANDS.filter((q) => q.group === group).map((q) => (
                      <Btn key={q.cmd} tone="slate" onClick={() => runQuick(q.cmd)} disabled={!connected} title={q.cmd}>{q.label}</Btn>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {lastQuick && (
              <div className="mt-3 border border-slate-800 rounded p-2 bg-black">
                <div className="text-[11px] font-mono text-cyan-300">&gt; {lastQuick.cmd}</div>
                {lastQuick.r.lines.map((l, i) => <div key={i} className="text-xs font-mono text-gray-200 break-all">{l}</div>)}
                <div className={`text-xs font-mono ${lastQuick.r.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {lastQuick.r.ok ? (lastQuick.r.final || 'OK') : describeResult(lastQuick.r)}
                </div>
              </div>
            )}
          </Panel>
          <Panel
            title="Your command list"
            hint="One command per line; lines starting with # are comments. Saved in this browser. The list stops at the first failing command."
            right={<Btn onClick={runCustomList} disabled={!connected}><Play className="w-3.5 h-3.5" /> Run list</Btn>}
          >
            <textarea className={`${field} w-full min-h-[7rem]`} value={customText} onChange={(e) => setCustomText(e.target.value)} spellCheck={false} />
            <p className="text-[10px] text-slate-600 mt-1">Results appear in the console log below.</p>
          </Panel>
        </div>
      )}

      {tab === 'console' && (
        <Panel
          title="Raw console and URC log"
          hint="rx = reply lines; URC = unsolicited lines (RING, +CMTI, +CREG changes and so on). Enter sends; arrow keys recall history."
          right={(
            <div className="flex gap-2">
              <Btn tone="slate" onClick={copyLog} disabled={!log.length}><Copy className="w-3.5 h-3.5" /> Copy</Btn>
              <Btn tone="slate" onClick={exportLog} disabled={!log.length} title="Download the log as a .txt file"><Download className="w-3.5 h-3.5" /> Save</Btn>
              <Btn tone="slate" onClick={() => setLog([])} disabled={!log.length}><Trash2 className="w-3.5 h-3.5" /> Clear</Btn>
            </div>
          )}
        >
          <div ref={logEndRef} className="h-56 @lg:h-72 overflow-auto bg-black border border-slate-800 rounded p-2 font-mono text-[11px] leading-relaxed">
            {log.length === 0 && <div className="text-slate-600">No traffic yet.</div>}
            {log.map((e) => (
              <div key={e.id} className="whitespace-pre-wrap break-all">
                <span className="text-slate-600">{e.ts} </span>
                {e.dir === 'tx' && <span className="text-cyan-400">&gt; {e.text}</span>}
                {e.dir === 'rx' && <span className="text-gray-200">{e.text}</span>}
                {e.dir === 'urc' && <span className="text-amber-300">URC {e.text}</span>}
                {e.dir === 'sys' && <span className="text-slate-500">[{e.text}]</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <input
              className={`${field} flex-1`}
              placeholder={connected ? 'AT+CSQ' : 'Connect a port first'}
              value={consoleInput}
              onChange={(e) => setConsoleInput(e.target.value)}
              onKeyDown={onConsoleKey}
              disabled={!connected}
              aria-label="AT command"
              list="at-modem-reference"
              autoComplete="off"
            />
            <datalist id="at-modem-reference">
              {searchAtReference('').map(([c, d]) => <option key={c} value={c}>{d}</option>)}
            </datalist>
            <Btn onClick={sendConsole} disabled={!connected || !consoleInput.trim()}><Send className="w-3.5 h-3.5" /> Send</Btn>
          </div>
          <details className="mt-1.5 text-[11px] text-slate-500">
            <summary className="cursor-pointer select-none flex items-center gap-1"><Search className="w-3 h-3" /> AT command reference</summary>
            <input className={`${field} w-full mt-1`} value={refQuery} onChange={(e) => setRefQuery(e.target.value)} placeholder="Filter, e.g. imei, sms, cops" aria-label="Filter AT command reference" />
            <div className="max-h-40 overflow-auto mt-1 border border-slate-800 rounded">
              {searchAtReference(refQuery).map(([c, d]) => (
                <button key={c} type="button" onClick={() => setConsoleInput(c)} className="w-full text-left px-2 py-0.5 hover:bg-slate-900 flex gap-2">
                  <span className="font-mono text-cyan-300 shrink-0">{c}</span><span className="truncate">{d}</span>
                </button>
              ))}
              {searchAtReference(refQuery).length === 0 && <p className="p-2">No match.</p>}
            </div>
            <p className="mt-1">Click a row to put it in the input. Nothing is sent until you press Send.</p>
          </details>
          <p className="text-[10px] text-slate-600 mt-1 flex items-center gap-1">
            <Info className="w-3 h-3" /> The tool adds CR; type the command without a line ending.
          </p>
        </Panel>
      )}
    </div>
  );
}
