import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Activity,
  Send,
  Trash2,
  Play,
  Square,
  Search,
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Upload,
  Download,
  Circle,
  Repeat,
  Stethoscope,
  FileText,
  Camera,
  ListOrdered,
  Settings2
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import {
  CAN_BAUD_RATES,
  CAN_FD_DATA_RATES,
  COMMON_DTCS,
  parseSlcanFrame,
  buildSlcanFrame,
  buildSlcanOpenSequence,
  createSlcanClock,
  autoDetectBitrate,
  SlcanLineReader,
  ObdOverSlcan,
  estimateFrameBits,
  computeBusLoad,
  snapshotBaseline,
  diffAgainstBaseline,
  formatTraceLine,
  toAscLog
} from '../../utils/canBusDriver';
import {
  parseDbc,
  decodeFrame,
  compileIdFilter,
  toCandumpLog,
  parseCandumpLog,
  toCsv,
  replayFrames,
  IsoTpChannel,
  UdsClient,
  UDS_DIDS,
  UdsDeclinedError,
  formatDidValue,
  OBD_PID_TABLE,
  decodeJ1939Frame,
  buildJ1939Request
} from '../../utils/canTools';

import { confirmAction } from '../../utils/sessionLog';

const MAX_LOG = 200000;
const MAX_TRACE = 500;
const hexId = (f) => (f.id ?? 0).toString(16).toUpperCase().padStart(f.isExtended ? 8 : 3, '0');
const hexBytes = (b) => Array.from(b).map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const parseBytes = (s) => s.split(/[\s,]+/).filter(Boolean).map((h) => parseInt(h.replace(/^0x/i, ''), 16)).filter((n) => !Number.isNaN(n) && n >= 0 && n <= 255);
const download = (text, name, type = 'text/plain') => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const MODES = [
  ['sniffer', 'CAN Bus Sniffer'],
  ['obd2', 'OBD-II Scanner & Gauges'],
  ['uds', 'UDS Diagnostics'],
  ['j1939', 'J1939'],
  ['log', 'Record & Replay']
];

export default function CanBusWorkbench({ initialMode = 'sniffer' }) {
  const { isConnected, sendString, addLog, subscribeRx } = useSerial();

  const [mode, setMode] = useState(initialMode);
  const [canBaud, setCanBaud] = useState('S6'); // 500 kbps (standard automotive)
  const [isSniffing, setIsSniffing] = useState(false);
  const [notice, setNotice] = useState('');

  // Sniffer table: key -> { id, isExtended, dlc, data, lastTime, deltaMs, count, diffs }
  const [messages, setMessages] = useState({});
  const [idFilter, setIdFilter] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [dbc, setDbc] = useState(null);
  const [dbcName, setDbcName] = useState('');
  const dbcInput = useRef(null);
  const [diffOnly, setDiffOnly] = useState(false);
  const [baseline, setBaseline] = useState(null);          // snapshot for compare: key -> bytes
  const [view, setView] = useState('grouped');             // 'grouped' per-ID table or chronological 'trace'
  const [trace, setTrace] = useState([]);
  const [stats, setStats] = useState({ fps: 0, load: 0, fdSeen: false });
  const [showOpts, setShowOpts] = useState(false);
  const traceRef = useRef([]);
  const statsRef = useRef({ frames: 0, bits: 0, fd: false, since: performance.now() });
  const traceT0 = useRef(null);

  // Transmit
  const [txId, setTxId] = useState('0x123');
  const [txData, setTxData] = useState('11 22 33 44 55 66 77 88');
  const [txExtended, setTxExtended] = useState(false);
  const [txIntervalMs, setTxIntervalMs] = useState(100);
  const [txPeriodic, setTxPeriodic] = useState(false);
  const [txRtr, setTxRtr] = useState(false);
  const [txRtrDlc, setTxRtrDlc] = useState(0);
  const [txFd, setTxFd] = useState(false);
  const [txBrs, setTxBrs] = useState(true);

  // Channel options: listen-only never transmits or ACKs; FD and timestamps need adapter firmware support.
  const [listenOnly, setListenOnly] = useState(false);
  const [fdRate, setFdRate] = useState('');           // '' = classic CAN only
  // Adapter firmware dialect. Lawicel / CANable 1.x slcan: listen-only is 'L', timestamps 'Z1', no FD.
  // CANable 2.0 (canable2-fw): listen-only is 'M1' (silent), no 'L'/'Z1', FD via 'Y2'/'Y5'.
  const [adapter, setAdapter] = useState('lawicel');
  const isCanable2 = adapter === 'canable2';
  const [hwTimestamps, setHwTimestamps] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const detectRef = useRef(null);                     // { frames, errors } while auto-detecting
  const clockRef = useRef(createSlcanClock());
  const canBaudRef = useRef('S6');
  canBaudRef.current = canBaud;
  const listenOnlyRef = useRef(false);
  listenOnlyRef.current = listenOnly;

  // J1939
  const [j1939Pgn, setJ1939Pgn] = useState('65262');
  const [j1939Da, setJ1939Da] = useState('FF');
  const [j1939Sa, setJ1939Sa] = useState('F9');

  // OBD-II. null = not read yet, 'n/a' = the car doesn't support that PID.
  const EMPTY_OBD = { rpm: null, speed: null, temp: null, load: null, throttle: null, voltage: null };
  const [obdValues, setObdValues] = useState(EMPTY_OBD);
  const [obdLive, setObdLive] = useState(false);
  const [activeDtcs, setActiveDtcs] = useState([]);
  const [isScanningDtcs, setIsScanningDtcs] = useState(false);
  const [dtcStatus, setDtcStatus] = useState(null);
  const [vin, setVin] = useState(null);
  const [pidTable, setPidTable] = useState(null); // [{ pid, name, value, unit }]
  const [obdBusy, setObdBusy] = useState('');

  // Recording / replay
  const [recording, setRecording] = useState(false);
  const [logCount, setLogCount] = useState(0);
  const [replay, setReplay] = useState(null); // { done, total }
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [replayLoop, setReplayLoop] = useState(false);
  const [loadedLog, setLoadedLog] = useState(null); // { name, frames }
  const logRef = useRef([]);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const replayStopRef = useRef(null);
  const logInput = useRef(null);

  // UDS
  const [udsTx, setUdsTx] = useState('7E0');
  const [udsRx, setUdsRx] = useState('7E8');
  const [udsExtended, setUdsExtended] = useState(false);
  const [udsDid, setUdsDid] = useState('F190');
  const [udsRaw, setUdsRaw] = useState('22 F1 90');
  const [udsLog, setUdsLog] = useState([]);
  const [udsBusy, setUdsBusy] = useState('');
  const [testerPresent, setTesterPresent] = useState(false);
  const [udsRoutineId, setUdsRoutineId] = useState('FF00');
  const [udsRoutineType, setUdsRoutineType] = useState(1);
  const [udsRoutineOpt, setUdsRoutineOpt] = useState('');
  const [udsWriteDid, setUdsWriteDid] = useState('F190');
  const [udsWriteData, setUdsWriteData] = useState('');
  const [udsSecLevel, setUdsSecLevel] = useState('01');
  const [udsSeed, setUdsSeed] = useState('');
  const [udsKey, setUdsKey] = useState('');
  const [udsMemAddr, setUdsMemAddr] = useState('');
  const [udsMemSize, setUdsMemSize] = useState('16');
  const [udsCommType, setUdsCommType] = useState('00');
  const [udsDtcSetting, setUdsDtcSetting] = useState('02');
  const udsRef = useRef(null); // { tp, uds, key }

  const sendRef = useRef(sendString);
  sendRef.current = sendString;
  const sniffingRef = useRef(false);
  sniffingRef.current = isSniffing;
  const pendingFramesRef = useRef([]);
  const slcanReaderRef = useRef(new SlcanLineReader());

  // Every frame (received, simulated, or sent by us) goes through ingest().
  const ingest = (frames, { tx = false } = {}) => {
    const now = performance.now();
    for (const f of frames) {
      if (recordingRef.current && logRef.current.length < MAX_LOG) logRef.current.push({ ...f, t: f.hwMs ?? f.t ?? Date.now(), tx });
      if (tx) continue;
      obdRef.current.onFrame(f);
      udsRef.current?.tp.onFrame(f);
      if (sniffingRef.current) {
        pendingFramesRef.current.push({ ...f, seen: now });
        const st = statsRef.current;
        st.frames++;
        const bits = estimateFrameBits(f);
        if (bits === null) st.fd = true; else st.bits += bits;
        if (traceT0.current === null) traceT0.current = f.t ?? Date.now();
        traceRef.current.push(formatTraceLine(f, traceT0.current));
        if (traceRef.current.length > MAX_TRACE) traceRef.current.splice(0, traceRef.current.length - MAX_TRACE);
      }
    }
  };

  // One CAN frame onto the bus.
  const sendFrame = (f) => {
    if (listenOnlyRef.current) throw new Error('The channel is open listen-only, so nothing can be sent. Turn listen-only off and restart the sniffer.');
    const frame = { ...f, dlc: f.rtr ? (f.dlc ?? 0) : f.data.length, t: Date.now() };
    const line = buildSlcanFrame(frame.id, frame.data, frame.isExtended, { rtr: !!f.rtr, fd: !!f.fd, brs: !!f.brs, dlc: frame.dlc });
    sendRef.current(line, '');
    ingest([frame], { tx: true });
  };

  const obdRef = useRef(null);
  if (!obdRef.current) obdRef.current = new ObdOverSlcan((line) => sendFrame(parseSlcanFrame(line)));

  const applyFrames = (frames) => {
    if (!frames.length) return;
    const now = Date.now();
    setMessages((prev) => {
      const next = { ...prev };
      for (const f of frames) {
        const key = (f.isExtended ? 'x' : '') + f.id;
        const old = next[key];
        const diffs = new Set();
        if (old) for (let i = 0; i < f.data.length; i++) if (old.data[i] !== f.data[i]) diffs.add(i);
        next[key] = {
          id: f.id, isExtended: f.isExtended, dlc: f.dlc, data: f.data, lastTime: now,
          rtr: !!f.rtr, fd: !!f.fd, brs: !!f.brs, hwMs: f.hwMs ?? null,
          deltaMs: old ? now - old.lastTime : 0, count: (old?.count || 0) + 1, diffs,
          lastChange: diffs.size || !old ? now : old.lastChange
        };
      }
      return next;
    });
  };

  // Table updates are batched every 100 ms.
  useEffect(() => {
    const flush = setInterval(() => {
      const batch = pendingFramesRef.current;
      if (batch.length) { pendingFramesRef.current = []; applyFrames(batch); setTrace([...traceRef.current]); }
      if (recordingRef.current) setLogCount(logRef.current.length);
      const st = statsRef.current;
      const dt = performance.now() - st.since;
      if (dt >= 1000) {
        const baud = (CAN_BAUD_RATES.find((r) => r.code === canBaudRef.current) || {}).baud || 0;
        setStats({ fps: Math.round((st.frames * 1000) / dt), load: computeBusLoad(st.bits, baud, dt), fdSeen: st.fd });
        statsRef.current = { frames: 0, bits: 0, fd: false, since: performance.now() };
      }
    }, 100);
    return () => clearInterval(flush);
  }, []);

  // Real adapter: SLCAN lines from the serial stream.
  useEffect(() => {
    if (!isConnected || !subscribeRx) return undefined;
    const reader = slcanReaderRef.current;
    const dec = new TextDecoder();
    const unsub = subscribeRx((bytes) => {
      const frames = [];
      for (const line of reader.push(dec.decode(bytes, { stream: true }))) {
        const f = parseSlcanFrame(line);
        if (detectRef.current) {                      // bit-rate probe: only count what the bus gives us
          if (f) detectRef.current.frames++; else if (line.trim()) detectRef.current.errors++;
          continue;
        }
        if (f) frames.push({ ...f, t: Date.now(), hwMs: clockRef.current(f.timestamp) });
      }
      if (frames.length) ingest(frames);
    });
    return () => { unsub(); pendingFramesRef.current = []; };
  }, [isConnected, subscribeRx]);


  // Live gauges: poll mode 01 PIDs one after another while enabled.
  useEffect(() => {
    if (!obdLive || !isConnected || mode !== 'obd2') return undefined;
    let stopped = false;
    const PIDS = [
      ['rpm', 0x0c, (b) => Math.round(((b[0] * 256) + b[1]) / 4)],
      ['speed', 0x0d, (b) => b[0]],
      ['temp', 0x05, (b) => b[0] - 40],
      ['load', 0x04, (b) => Number(((b[0] * 100) / 255).toFixed(1))],
      ['throttle', 0x11, (b) => Number(((b[0] * 100) / 255).toFixed(1))],
      ['voltage', 0x42, (b) => Number((((b[0] * 256) + b[1]) / 1000).toFixed(2))]
    ];
    (async () => {
      if (!sniffingRef.current) await startSniffing();
      while (!stopped) {
        for (const [key, pid, parse] of PIDS) {
          if (stopped) return;
          let v;
          try { const b = await obdRef.current.readPid(pid); v = b ? parse(b) : 'n/a'; } catch (e) { v = 'n/a'; }
          if (!stopped) setObdValues((prev) => ({ ...prev, [key]: v }));
        }
        await new Promise((r) => setTimeout(r, 200));
      }
    })();
    return () => { stopped = true; };
  }, [obdLive, isConnected, mode]);

  // Periodic transmit.
  useEffect(() => {
    if (!txPeriodic) return undefined;
    const t = setInterval(() => { try { transmit(); } catch (e) { setTxPeriodic(false); setNotice(e.message); } }, Math.max(5, Number(txIntervalMs) || 100));
    return () => clearInterval(t);
  }, [txPeriodic, txIntervalMs, txId, txData, txExtended, txRtr, txRtrDlc, txFd, txBrs]);

  // UDS TesterPresent keep-alive (every 2 s) so non-default sessions don't time out.
  useEffect(() => {
    if (!testerPresent) return undefined;
    const t = setInterval(() => {
      const ch = udsChannel();
      if (!udsBusy) ch.tp.sendMessage([0x3e, 0x80]).catch(() => {}); // suppress-positive-response bit
    }, 2000);
    return () => clearInterval(t);
  }, [testerPresent, udsTx, udsRx, udsExtended]);

  useEffect(() => () => replayStopRef.current?.(), []);

  // SLCAN: close, set bitrate, open (listen + transmit).
  const openChannel = async () => {
    clockRef.current = createSlcanClock();
    const seq = buildSlcanOpenSequence({ baudCode: canBaud, mode: listenOnly ? (isCanable2 ? 'silent' : 'listen') : 'normal', timestamps: hwTimestamps && !isCanable2, fdRateCode: isCanable2 ? (fdRate || null) : null });
    for (const cmd of seq) await sendString(cmd, '\r');
    return seq;
  };

  const startSniffing = async () => {
    if (!isConnected) { alert('Connect the SLCAN adapter (CANable / Candlelight) over serial first.'); return false; }
    const seq = await openChannel();
    const rate = (CAN_BAUD_RATES.find((r) => r.code === canBaud) || {}).label || canBaud;
    addLog(`[CAN BUS] SLCAN channel opened at ${rate} (${seq.join(' ')}).`, 'sys');
    setIsSniffing(true);
    sniffingRef.current = true;
    return true;
  };

  const ensureBus = async () => {
    if (sniffingRef.current) return true;
    return startSniffing();
  };

  // Listen-only sweep over the common bit rates; nothing is transmitted.
  const handleAutoDetect = async () => {
    if (!isConnected) { setNotice('Connect the SLCAN adapter first.'); return; }
    setDetecting(true);
    setNotice('Listening at each bit rate (listen-only, nothing is sent)...');
    try {
      if (sniffingRef.current) { setIsSniffing(false); sniffingRef.current = false; }
      const probe = async (code) => {
        detectRef.current = { frames: 0, errors: 0 };
        await sendString('C', '\r');
        await sendString(code, '\r');
        // silent open in this adapter's dialect: CANable 2.0 uses M1 + O, Lawicel uses L
        if (isCanable2) { await sendString('M1', '\r'); await sendString('O', '\r'); }
        else await sendString('L', '\r');
        await new Promise((r) => setTimeout(r, 700));
        const res = detectRef.current;
        detectRef.current = null;
        await sendString('C', '\r');
        return res;
      };
      const r = await autoDetectBitrate(probe);
      if (r.code) {
        setCanBaud(r.code);
        const label = (CAN_BAUD_RATES.find((b) => b.code === r.code) || {}).label || r.code;
        setNotice(`Heard clean frames at ${label}. Bit rate set; press START SNIFFER.`);
        addLog(`[CAN BUS] Auto-detect: ${label} (${r.code}).`, 'sys');
      } else {
        setNotice('No frames heard at 500/250/1000/125/100 kbps. Check the wiring, termination and that something is transmitting on the bus.');
      }
    } catch (e) {
      setNotice(`Auto-detect failed: ${e.message}`);
    } finally {
      detectRef.current = null;
      setDetecting(false);
    }
  };

  const clearCapture = () => { setMessages({}); traceRef.current = []; traceT0.current = null; setTrace([]); };

  const stopSniffing = async () => {
    setIsSniffing(false);
    if (isConnected) {
      await sendString('C', '\r');
      addLog('[CAN BUS] SLCAN channel closed (C).', 'sys');
    }
  };

  const transmit = () => {
    const id = parseInt(String(txId).replace(/^0x/i, ''), 16);
    if (Number.isNaN(id) || id < 0 || id > 0x1fffffff) throw new Error('Invalid hex CAN ID.');
    const bytes = txRtr ? [] : parseBytes(txData);
    if (!isConnected) throw new Error('Connect the SLCAN adapter first.');
    const ext = txExtended || id > 0x7ff;
    const frame = { id, isExtended: ext, data: Uint8Array.from(bytes), rtr: txRtr, fd: txFd && !txRtr, brs: txFd && !txRtr && txBrs };
    if (txRtr) frame.dlc = Math.max(0, Math.min(8, Number(txRtrDlc) || 0));
    if (frame.fd && !fdRate) throw new Error('Pick a CAN FD data rate in the toolbar and restart the sniffer to send FD frames.');
    sendFrame(frame); // throws for payloads the frame type cannot carry
    return { id, ext, bytes, frame };
  };

  const handleTransmitFrame = () => {
    try {
      const { frame } = transmit();
      addLog(`[CAN TX] ${buildSlcanFrame(frame.id, frame.data, frame.isExtended, { rtr: frame.rtr, fd: frame.fd, brs: frame.brs, dlc: frame.dlc }).trim()}`, 'tx');
      setNotice('');
    } catch (e) {
      setNotice(e.message);
    }
  };

  // --- OBD-II ---------------------------------------------------------------

  const handleScanDtcs = async () => {
    if (!isConnected) { alert('Connect the SLCAN adapter over serial first.'); return; }
    setIsScanningDtcs(true);
    try {
      if (!(await ensureBus())) return;
      const { dtcs, ecus } = await obdRef.current.readDtcs();
      setActiveDtcs(dtcs);
      setDtcStatus(ecus.length
        ? `${ecus.length} ECU${ecus.length === 1 ? '' : 's'} answered (${ecus.map((e) => '0x' + e.toString(16).toUpperCase()).join(', ')}).`
        : 'No ECU answered. Check the ignition, the CAN bitrate and the OBD-II wiring.');
      addLog(`[OBD-II] Mode 03: ${ecus.length} ECU(s), ${dtcs.length} code(s)${dtcs.length ? ': ' + dtcs.join(', ') : ''}`, 'sys');
    } catch (e) {
      setDtcStatus(`Read failed: ${e.message}`);
    } finally {
      setIsScanningDtcs(false);
    }
  };

  const handleClearDtcs = async () => {
    if (!confirmAction('Send OBD-II mode 04 to clear stored trouble codes and freeze-frame data on this vehicle?')) return;
    setIsScanningDtcs(true);
    try {
      const { confirmed, refused } = await obdRef.current.clearDtcs();
      const hex = (ids) => ids.map((e) => '0x' + e.toString(16).toUpperCase()).join(', ');
      if (confirmed.length) setActiveDtcs([]);
      const msg = confirmed.length
        ? `Cleared by ${hex(confirmed)}${refused.length ? `; refused by ${hex(refused)} (engine running or not supported)` : ''}.`
        : refused.length ? `Refused by ${hex(refused)} (usually: turn the engine off, ignition on).` : 'No ECU answered the clear request.';
      setDtcStatus(msg);
      addLog(`[OBD-II] Mode 04: ${msg}`, 'sys');
    } finally {
      setIsScanningDtcs(false);
    }
  };

  const handleReadVin = async () => {
    setObdBusy('vin');
    try {
      if (!(await ensureBus())) return;
      setVin((await obdRef.current.readVin()) || 'not reported');
    } finally {
      setObdBusy('');
    }
  };

  const handleScanPids = async () => {
    setObdBusy('pids');
    try {
      if (!(await ensureBus())) return;
      const pids = await obdRef.current.supportedPids();
      const rows = [];
      for (const pid of pids) {
        const def = OBD_PID_TABLE[pid];
        if (!def) { rows.push({ pid, name: `PID 0x${pid.toString(16).toUpperCase()}`, value: 'supported', unit: '' }); continue; }
        let value;
        try { const b = await obdRef.current.readPid(pid); value = b ? def[2](b) : 'no answer'; } catch (e) { value = 'error'; }
        rows.push({ pid, name: def[0], value, unit: def[1] });
        setPidTable([...rows]);
      }
      setPidTable(rows);
      if (!pids.length) setNotice('No ECU answered the supported-PID request.');
    } finally {
      setObdBusy('');
    }
  };

  // --- UDS ------------------------------------------------------------------

  const udsChannel = () => {
    const key = `${udsTx}/${udsRx}/${udsExtended}`;
    if (udsRef.current?.key !== key) {
      const tp = new IsoTpChannel((f) => sendFrame(f), { txId: parseInt(udsTx, 16), rxId: parseInt(udsRx, 16), extended: udsExtended, timeoutMs: 1500 });
      udsRef.current = { key, tp, uds: new UdsClient(tp, { confirm: (m) => confirmAction(m, 'CAN Bus') }) };
    }
    return udsRef.current;
  };

  const logUds = (dir, text, kind = 'info') => setUdsLog((prev) => [...prev.slice(-300), { dir, text, kind, time: new Date().toLocaleTimeString() }]);

  const runUds = async (label, fn) => {
    if (!isConnected) { setNotice('Connect the SLCAN adapter first.'); return; }
    if (Number.isNaN(parseInt(udsTx, 16)) || Number.isNaN(parseInt(udsRx, 16))) { setNotice('Enter hex request and response IDs.'); return; }
    setUdsBusy(label);
    try {
      if (!(await ensureBus())) return;
      await fn(udsChannel().uds);
    } catch (e) {
      logUds('!', e.message, e instanceof UdsDeclinedError ? 'info' : 'error');
    } finally {
      setUdsBusy('');
    }
  };

  const udsSession = (type, name) => runUds('session', async (uds) => {
    const r = await uds.sessionControl(type);
    logUds('<', `${name} session active${r.p2Ms !== undefined ? ` (P2 ${r.p2Ms} ms, P2* ${r.p2StarMs} ms)` : ''}`, 'ok');
  });

  const udsIdent = () => runUds('ident', async (uds) => {
    logUds('>', 'Reading identification DIDs (F186-F19E)...');
    const rows = await uds.readIdentification();
    if (!rows.length) logUds('<', 'The ECU refused every identification DID.', 'error');
    for (const r of rows) logUds('<', `${r.name} (0x${r.did.toString(16).toUpperCase()}): ${r.value}`, 'ok');
  });

  const udsReadDid = () => runUds('did', async (uds) => {
    const did = parseInt(udsDid, 16);
    if (Number.isNaN(did) || did > 0xffff) throw new Error('A DID is 4 hex digits, e.g. F190.');
    const v = await uds.readDid(did);
    logUds('<', `DID 0x${did.toString(16).toUpperCase()}${UDS_DIDS[did] ? ` (${UDS_DIDS[did]})` : ''}: ${formatDidValue(v)}  [${hexBytes(v)}]`, 'ok');
  });

  const udsDtcs = () => runUds('dtc', async (uds) => {
    const { dtcs } = await uds.readDtcs(0xff);
    if (!dtcs.length) logUds('<', 'No DTCs stored.', 'ok');
    for (const d of dtcs) logUds('<', `${d.code} status 0x${d.status.toString(16).toUpperCase()} [${d.flags.join(', ') || 'none'}]`, 'ok');
  });

  const udsClear = () => {
    if (!confirmAction('Send UDS ClearDiagnosticInformation (0x14 FFFFFF) to this ECU?')) return;
    runUds('clear', async (uds) => { await uds.clearDtcs(); logUds('<', 'DTCs cleared.', 'ok'); });
  };

  const udsReset = () => {
    if (!confirmAction('Send UDS ECUReset (hard reset) to this ECU? It restarts immediately.')) return;
    runUds('reset', async (uds) => { await uds.ecuReset(0x01); logUds('<', 'ECU accepted the hard reset.', 'ok'); });
  };

  const udsSendRaw = () => runUds('raw', async (uds) => {
    const bytes = parseBytes(udsRaw);
    if (!bytes.length) throw new Error('Enter request bytes, e.g. 22 F1 90.');
    logUds('>', hexBytes(bytes));
    const r = await uds.request(bytes);
    logUds('<', `${hexBytes(r)}${r.length > 3 ? `  "${formatDidValue(r.slice(3))}"` : ''}`, 'ok');
  });

  // --- UDS: services that change the ECU (each asks for confirmation inside UdsClient) ---

  const needHex = (text, what) => {
    const b = parseBytes(text);
    if (!b.length) throw new Error(`Enter ${what} as hex bytes.`);
    return b;
  };

  const udsRoutine = () => runUds('routine', async (uds) => {
    const id = parseInt(udsRoutineId, 16);
    if (Number.isNaN(id) || id > 0xffff) throw new Error('A routine ID is 4 hex digits, e.g. FF00.');
    const type = Number(udsRoutineType);
    const r = await uds.routineControl(type, id, parseBytes(udsRoutineOpt));
    logUds('<', `Routine 0x${id.toString(16).toUpperCase().padStart(4, '0')} ${['', 'started', 'stopped', 'results'][type]}${r.status.length ? `: ${hexBytes(r.status)}` : ''}`, 'ok');
  });

  const udsWrite = () => runUds('write', async (uds) => {
    const did = parseInt(udsWriteDid, 16);
    if (Number.isNaN(did) || did > 0xffff) throw new Error('A DID is 4 hex digits, e.g. F190.');
    const data = needHex(udsWriteData, 'the data to write');
    await uds.writeDid(did, data);
    logUds('<', `DID 0x${did.toString(16).toUpperCase()} written (${data.length} bytes).`, 'ok');
  });

  const udsSeedRequest = () => runUds('seed', async (uds) => {
    const level = parseInt(udsSecLevel, 16);
    const r = await uds.requestSeed(level);
    setUdsSeed(hexBytes(r.seed));
    logUds('<', r.unlocked ? `Level 0x${level.toString(16)} is already unlocked (seed is all zero).` : `Seed for level 0x${level.toString(16).toUpperCase()}: ${hexBytes(r.seed)}`, 'ok');
  });

  const udsSendKey = () => runUds('key', async (uds) => {
    const level = parseInt(udsSecLevel, 16);
    const r = await uds.sendKey(level, needHex(udsKey, 'the key you computed for this seed'));
    logUds('<', r.accepted ? `Security level 0x${level.toString(16).toUpperCase()} unlocked.` : 'The ECU did not accept the key.', r.accepted ? 'ok' : 'error');
  });

  const udsMemRead = () => runUds('mem', async (uds) => {
    const addr = parseInt(udsMemAddr, 16);
    const size = parseInt(udsMemSize, 10);
    if (Number.isNaN(addr)) throw new Error('Enter the start address in hex.');
    const bytes = await uds.readMemory(addr, size, { addressBytes: addr > 0xffffffff ? 5 : 4 });
    logUds('<', `0x${addr.toString(16).toUpperCase()} (${bytes.length} bytes): ${hexBytes(bytes)}`, 'ok');
  });

  const udsCommControl = (control) => runUds('comm', async (uds) => {
    await uds.communicationControl(control, parseInt(udsCommType, 16) || 0x01);
    logUds('<', `CommunicationControl ${control.toString(16).padStart(2, '0')} accepted.`, 'ok');
  });

  const udsDtcControl = () => runUds('dtcset', async (uds) => {
    const setting = parseInt(udsDtcSetting, 16);
    await uds.controlDtcSetting(setting);
    logUds('<', `DTC setting ${setting === 1 ? 'on' : setting === 2 ? 'off' : `0x${setting.toString(16)}`} accepted.`, 'ok');
  });

  // --- J1939 ----------------------------------------------------------------

  const handleJ1939Request = async () => {
    try {
      const t = String(j1939Pgn).trim();
      const pgn = /^0x/i.test(t) ? parseInt(t, 16) : parseInt(t, 10);
      const da = parseInt(j1939Da, 16);
      const sa = parseInt(j1939Sa, 16);
      if (Number.isNaN(pgn)) throw new Error('Enter the PGN as a number (65262) or hex (0xFEEE).');
      if (Number.isNaN(da) || da > 0xff || Number.isNaN(sa) || sa > 0xff) throw new Error('Addresses are hex bytes, e.g. FF (all) and F9 (diagnostic tool).');
      if (!isConnected) throw new Error('Connect the SLCAN adapter first.');
      if (!(await ensureBus())) return;
      sendFrame(buildJ1939Request(pgn, { da, sa }));
      setNotice(`Requested PGN ${pgn} from ${da === 0xff ? 'all nodes' : `address ${da.toString(16).toUpperCase()}`}. Replies show in the table (multi-packet replies are not reassembled).`);
    } catch (e) {
      setNotice(e.message);
    }
  };

  // --- Logs -------------------------------------------------------------------

  const startRecording = () => {
    logRef.current = [];
    setLogCount(0);
    setRecording(true);
    if (!isSniffing) startSniffing();
  };

  const currentLogFrames = () => (loadedLog && !logRef.current.length ? loadedLog.frames : logRef.current);

  const exportLog = (kind) => {
    const frames = currentLogFrames();
    if (!frames.length) { setNotice('Nothing recorded yet.'); return; }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (kind === 'csv') download(toCsv(frames, dbc), `can-${stamp}.csv`, 'text/csv');
    else if (kind === 'asc') {
      const { text, skipped } = toAscLog(frames);
      download(text, `can-${stamp}.asc`);
      if (skipped) setNotice(`${skipped} CAN FD frame${skipped === 1 ? '' : 's'} left out: the ASC export covers classic CAN only.`);
    } else download(toCandumpLog(frames.filter((f) => !f.tx)), `can-${stamp}.log`);
  };

  const onLogFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const frames = parseCandumpLog(await file.text());
      setLoadedLog({ name: file.name, frames });
      setNotice(`Loaded ${frames.length} frames from ${file.name}.`);
    } catch (err) {
      setNotice(`Could not read ${file.name}: ${err.message}`);
    }
  };

  const viewLogInTable = () => {
    const frames = currentLogFrames();
    setMessages({});
    applyFrames(frames.filter((f) => !f.tx));
    setMode('sniffer');
  };

  const startReplay = () => {
    const frames = currentLogFrames().filter((f) => !f.tx);
    if (!frames.length) { setNotice('Record or load a log first.'); return; }
    if (!isConnected) { setNotice('Connect the SLCAN adapter to replay onto a bus.'); return; }
    if (!confirmAction(`Transmit ${frames.length} recorded frames onto the CAN bus? Replaying traffic into a vehicle can trigger real actions.`)) return;
    ensureBus().then((ok) => {
      if (!ok) return;
      setReplay({ done: 0, total: frames.length });
      replayStopRef.current = replayFrames(frames, (f) => sendFrame({ id: f.id, isExtended: f.isExtended, data: f.data, rtr: f.rtr, fd: f.fd, brs: f.brs, dlc: f.dlc }), {
        speed: Number(replaySpeed) || 1,
        loop: replayLoop,
        onProgress: (done, total) => { if (done % 20 === 0 || done === total) setReplay({ done, total }); },
        onDone: () => { setReplay(null); replayStopRef.current = null; }
      });
    });
  };

  const stopReplay = () => { replayStopRef.current?.(); replayStopRef.current = null; setReplay(null); };

  const onDbcFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const parsed = parseDbc(await file.text());
      if (!parsed.messages.size) throw new Error('no BO_ messages found');
      setDbc(parsed);
      setDbcName(file.name);
    } catch (err) {
      setNotice(`Could not read ${file.name}: ${err.message}`);
    }
  };

  const filterFn = useMemo(() => {
    try { return { fn: compileIdFilter(idFilter), error: '' }; } catch (e) { return { fn: () => true, error: e.message }; }
  }, [idFilter]);

  const now = Date.now();
  const filteredMessageList = Object.values(messages)
    .filter((m) => m && filterFn.fn(m.id) && (!changedOnly || now - (m.lastChange || 0) < 2000))
    .filter((m) => {
      if (!baseline || !diffOnly) return true;
      const d = diffAgainstBaseline(baseline, (m.isExtended ? 'x' : '') + m.id, Array.from(m.data || []));
      return d.isNew || d.bytes.size > 0;
    })
    .sort((a, b) => a.id - b.id);


  const j1939Rows = mode === 'j1939'
    ? Object.values(messages)
      .filter((m) => m && m.isExtended && !m.rtr)
      .map((m) => ({ m, d: decodeJ1939Frame(m) }))
      .sort((a, b) => a.d.pgn - b.d.pgn || a.d.sa - b.d.sa)
    : [];

  const btn = 'flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-bold disabled:opacity-40';
  const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs outline-none';

  return (
    <div className="flex flex-col gap-2 font-mono">
      {notice &&<div className="p-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 text-xs flex justify-between gap-2"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px] self-start max-w-full">
          {MODES.map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} aria-pressed={mode === id} className={`px-2 py-1 rounded font-bold transition-all ${mode === id ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">BAUD</span>
              <select aria-label="CAN bit rate" value={canBaud} onChange={(e) => setCanBaud(e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-emerald-400 font-bold outline-none max-w-[9rem]">
                {CAN_BAUD_RATES.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
              </select>
            </label>
            <button onClick={handleAutoDetect} disabled={detecting || !isConnected || isSniffing} className={btn} title="Listen-only sweep over 500/250/1000/125/100 kbps to find the bus bit rate (stop the sniffer first)">
              {detecting ? 'LISTENING...' : 'AUTO-DETECT'}
            </button>
            {!isSniffing ? (
              <button onClick={startSniffing} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 text-xs font-bold transition-all">
                <Play className="w-3.5 h-3.5 fill-current" /><span>START SNIFFER</span>
              </button>
            ) : (
              <button onClick={stopSniffing} className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
                <Square className="w-3.5 h-3.5 fill-current" /><span>PAUSE</span>
              </button>
            )}
            <button onClick={clearCapture} className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800" title="Clear captured packets" aria-label="Clear captured packets">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setShowOpts((v) => !v)} aria-expanded={showOpts} className={`p-1.5 rounded-lg border ${showOpts ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'}`} title="Adapter options: firmware dialect, listen-only, CAN FD, hardware timestamps" aria-label="Adapter options">
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            {recording && <span className="flex items-center gap-1 text-rose-400 font-bold"><Circle className="w-3 h-3 fill-current animate-pulse" /> REC {logCount}</span>}
            {isSniffing && (
              <span className="flex items-center gap-2 text-[11px] text-slate-400" title="Frames per second and estimated bus load (nominal frame length without stuff bits; CAN FD frames are not counted in the load)">
                <span><span className="text-cyan-300 font-bold">{stats.fps}</span> fps</span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-14 h-1.5 rounded bg-slate-800 overflow-hidden" role="meter" aria-label="Estimated bus load" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stats.load)}><span className={`block h-full ${stats.load > 70 ? 'bg-rose-400' : stats.load > 40 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${Math.round(stats.load)}%` }} /></span>
                  <span className="text-emerald-300 font-bold">{stats.load.toFixed(0)}%{stats.fdSeen ? '+' : ''}</span>
                </span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => dbcInput.current?.click()} className={btn} title="Load a .dbc file to decode signals">
              <FileText className="w-3.5 h-3.5" /> {dbcName ? `DBC: ${dbcName}` : 'LOAD DBC'}
            </button>
            {dbc && <button onClick={() => { setDbc(null); setDbcName(''); }} className="text-slate-500 hover:text-rose-400" title="Unload DBC" aria-label="Unload DBC">×</button>}
            <input ref={dbcInput} type="file" accept=".dbc" className="hidden" onChange={onDbcFile} />
            <div className="relative">
              <input
                type="text"
                aria-label="ID filter"
                placeholder="IDs: 1DC, 200-2FF, !7DF"
                value={idFilter}
                onChange={(e) => setIdFilter(e.target.value)}
                className={`bg-slate-950 border rounded-lg pl-7 pr-2 py-1 text-xs text-slate-200 outline-none w-40 ${filterFn.error ? 'border-rose-500' : 'border-slate-800'}`}
                title={filterFn.error || 'Comma-separated IDs or ranges; prefix ! to hide'}
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-1.5" />
            </div>
            <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} className="accent-amber-500" /> changing only</label>
          </div>
        </div>

        {showOpts && (
          <div className="flex flex-wrap items-center gap-2 text-xs border-t border-slate-800 pt-2">
            <select aria-label="Adapter firmware" value={adapter} disabled={isSniffing} onChange={(e) => { setAdapter(e.target.value); if (e.target.value !== 'canable2') setFdRate(''); }} className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-300 outline-none" title="Adapter firmware: the two speak different SLCAN dialects">
              <option value="lawicel">SLCAN (Lawicel / CANable 1.x)</option>
              <option value="canable2">CANable 2.0 (FD firmware)</option>
            </select>
            <label className="flex items-center gap-1 text-slate-400" title={isCanable2 ? 'Open in silent mode (M1): the adapter never transmits or ACKs' : 'Open with L: the adapter never transmits or ACKs, so it cannot disturb the bus'}><input type="checkbox" checked={listenOnly} disabled={isSniffing} onChange={(e) => setListenOnly(e.target.checked)} className="accent-emerald-500" /> listen-only</label>
            {isCanable2 && (
              <select aria-label="CAN FD data rate" value={fdRate} disabled={isSniffing} onChange={(e) => setFdRate(e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-300 outline-none" title="CAN FD data-phase rate (Y2 / Y5 in canable2-fw)">
                <option value="">Classic CAN</option>
                {CAN_FD_DATA_RATES.map((r) => <option key={r.code} value={r.code}>FD: {r.label}</option>)}
              </select>
            )}
            {!isCanable2 && (
              <label className="flex items-center gap-1 text-slate-400" title="Z1: the adapter appends a millisecond timestamp (16 bit, wraps at 60 s) to each received frame. Not supported by CANable 2.0 firmware."><input type="checkbox" checked={hwTimestamps} disabled={isSniffing} onChange={(e) => setHwTimestamps(e.target.checked)} className="accent-emerald-500" /> HW timestamps</label>
            )}
            <span className="text-[11px] text-slate-500">Options apply when the sniffer is started. Works with SLCAN adapters (CANable / Candlelight in SLCAN mode) over Web Serial.</span>
          </div>
        )}
      </div>

      {mode === 'sniffer' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
              {[['grouped', 'By ID'], ['trace', 'Trace']].map(([id, label]) => (
                <button key={id} onClick={() => setView(id)} aria-pressed={view === id} title={id === 'grouped' ? 'One row per CAN ID with counts and byte-change highlighting' : `Every frame in arrival order (last ${MAX_TRACE})`} className={`px-2 py-0.5 rounded font-bold ${view === id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'}`}>{id === 'trace' && <ListOrdered className="w-3 h-3 inline mr-1" />}{label}</button>
              ))}
            </div>
            {view === 'grouped' && (
              <>
                <button onClick={() => { setBaseline(snapshotBaseline(messages)); setNotice(`Snapshot saved (${Object.keys(messages).length} IDs). Bytes that differ from it are marked in cyan and IDs not in it are tagged NEW.`); }} className={btn} title="Remember the current data of every ID, then do something on the vehicle: bytes that differ from the snapshot are marked">
                  <Camera className="w-3.5 h-3.5" /> SNAPSHOT
                </button>
                {baseline && (
                  <>
                    <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={diffOnly} onChange={(e) => setDiffOnly(e.target.checked)} className="accent-cyan-500" /> differs from snapshot only</label>
                    <button onClick={() => { setBaseline(null); setDiffOnly(false); }} className="text-slate-500 hover:text-rose-400" title="Discard snapshot" aria-label="Discard snapshot">×</button>
                  </>
                )}
              </>
            )}
          </div>
          {view === 'trace' ? (
            <div className="bg-black border border-cyber-border rounded-lg p-2 h-72 overflow-y-auto overflow-x-auto text-[11px] leading-snug whitespace-pre text-slate-300" aria-label="Frame trace">
              {trace.length === 0
                ? <span className="text-slate-600 italic">{isSniffing ? 'Listening on CAN bus... Waiting for frames.' : 'Click "START SNIFFER" to capture packets.'}</span>
                : trace.filter((l) => { const id = parseInt(l.trim().split(/\s+/)[2], 16); return filterFn.fn(id); }).map((l, i) => <div key={i}>{l}</div>)}
            </div>
          ) : (
          <div className="bg-[#030712] border border-cyber-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-bold border-b border-slate-800">
                  <tr>
                    <th className="py-1 px-2">CAN ID</th>
                    <th className="py-1 px-2">Type</th>
                    <th className="py-1 px-2">DLC</th>
                    <th className="py-1 px-2">Data (changed bytes lit)</th>
                    <th className="py-1 px-2">Delta</th>
                    <th className="py-1 px-2">HW time</th>
                    <th className="py-1 px-2 text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {filteredMessageList.length === 0 ? (
                    <tr>
                      <td colSpan="7" className="py-8 text-center text-slate-500 italic">
                        {isSniffing ? 'Listening on CAN bus... Waiting for frames.' : 'Click "START SNIFFER" to capture packets.'}
                      </td>
                    </tr>
                  ) : (
                    filteredMessageList.map((m) => {
                      const decoded = dbc ? decodeFrame(dbc, m) : null;
                      const bd = baseline ? diffAgainstBaseline(baseline, (m.isExtended ? 'x' : '') + m.id, Array.from(m.data || [])) : null;
                      return (
                        <tr key={(m.isExtended ? 'x' : '') + m.id} className="hover:bg-slate-900/40 align-top">
                          <td className="py-1 px-2 font-bold text-amber-300">
                            0x{hexId(m)}{bd?.isNew && <span className="ml-1 text-[9px] px-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">NEW</span>}
                            {decoded && <div className="text-[10px] text-emerald-300 font-normal">{decoded.name}</div>}
                          </td>
                          <td className="py-1 px-2 text-[10px] text-slate-400">{m.isExtended ? 'EXT (29b)' : 'STD (11b)'}{m.fd ? ` FD${m.brs ? '/BRS' : ''}` : ''}{m.rtr ? ' RTR' : ''}</td>
                          <td className="py-1 px-2 text-slate-300 font-bold">{m.dlc}</td>
                          <td className="py-1 px-2">
                            <div className="flex flex-wrap items-center gap-1 font-bold">
                              {m.rtr && <span className="text-slate-500 italic font-normal">remote request for {m.dlc} byte{m.dlc === 1 ? '' : 's'}</span>}
                              {Array.from(m.data || []).map((b, idx) => (
                                <span key={idx} className={`px-1 py-0.5 rounded transition-colors ${m.diffs?.has?.(idx) ? 'bg-amber-400 text-slate-950 font-extrabold shadow-[0_0_8px_rgba(251,191,36,0.6)]' : bd?.bytes?.has(idx) ? 'bg-slate-950 text-cyan-200 border border-cyan-400 ring-1 ring-cyan-400/60' : 'bg-slate-950 text-cyan-300 border border-slate-850'}`}>
                                  {(b ?? 0).toString(16).padStart(2, '0').toUpperCase()}
                                </span>
                              ))}
                            </div>
                            {decoded && decoded.signals.length > 0 && (
                              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                                {decoded.signals.map((s) => (
                                  <span key={s.name} className="text-slate-400">{s.name}: <span className="text-emerald-300 font-bold">{s.text ?? s.value}</span>{s.unit ? ` ${s.unit}` : ''}</span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="py-1 px-2 text-slate-400 text-[10px]">{m.deltaMs} ms</td>
                          <td className="py-1 px-2 text-slate-500 text-[10px]">{m.hwMs != null ? `${(m.hwMs / 1000).toFixed(3)} s` : '-'}</td>
                          <td className="py-1 px-2 text-right text-emerald-400 font-bold">{m.count}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          )}

          <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-cyan-400" /><span>TRANSMIT:</span>
            </span>
            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
              <input type="text" aria-label="CAN ID (hex)" value={txId} onChange={(e) => setTxId(e.target.value)} placeholder="0x123" className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-amber-300 font-bold outline-none w-24 uppercase" />
              <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={txExtended} onChange={(e) => setTxExtended(e.target.checked)} className="accent-cyan-500" /> 29-bit</label>
              <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={txRtr} onChange={(e) => setTxRtr(e.target.checked)} className="accent-cyan-500" /> RTR</label>
              {txRtr && <input type="number" min="0" max="8" value={txRtrDlc} onChange={(e) => setTxRtrDlc(e.target.value)} title="Bytes requested" className={`${inp} w-14 text-slate-200`} />}
              <label className="flex items-center gap-1 text-slate-400" title="Needs an FD data rate selected in the toolbar"><input type="checkbox" checked={txFd} disabled={txRtr} onChange={(e) => setTxFd(e.target.checked)} className="accent-cyan-500" /> FD</label>
              {txFd && !txRtr && <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={txBrs} onChange={(e) => setTxBrs(e.target.checked)} className="accent-cyan-500" /> BRS</label>}
              <input type="text" aria-label="Data bytes (hex)" value={txData} disabled={txRtr} onChange={(e) => setTxData(e.target.value)} placeholder="11 22 33 44 55 66 77 88" className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-cyan-300 font-bold outline-none w-full @md:w-64 uppercase disabled:opacity-40" />
              <button onClick={handleTransmitFrame} className="px-3 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/50 font-bold text-xs">SEND FRAME</button>
              <span className="text-slate-500">every</span>
              <input type="number" min="5" value={txIntervalMs} onChange={(e) => setTxIntervalMs(e.target.value)} className={`${inp} w-16 text-slate-200`} />
              <span className="text-slate-500">ms</span>
              <button
                onClick={() => {
                  if (!txPeriodic) { try { transmit(); } catch (e) { setNotice(e.message); return; } }
                  setTxPeriodic((v) => !v);
                }}
                className={`flex items-center gap-1 px-3 py-1 rounded border font-bold ${txPeriodic ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : 'bg-slate-900 text-slate-300 border-slate-800'}`}
              >
                <Repeat className="w-3.5 h-3.5" /> {txPeriodic ? 'STOP PERIODIC' : 'PERIODIC'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'obd2' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {(
              <button
                onClick={() => { if (!isConnected) { alert('Connect the SLCAN adapter over serial first.'); return; } setObdLive((v) => !v); }}
                className={`px-3 py-1 rounded-lg border font-bold ${obdLive ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-slate-900 text-slate-300 border-slate-800 hover:text-cyan-300'}`}
              >
                {obdLive ? 'LIVE GAUGES ●' : 'START LIVE GAUGES (MODE 01)'}
              </button>
            )}
            <button onClick={handleReadVin} disabled={!!obdBusy} className={btn}>{obdBusy === 'vin' ? 'READING...' : 'READ VIN (09)'}</button>
            <button onClick={handleScanPids} disabled={!!obdBusy} className={btn}>{obdBusy === 'pids' ? 'SCANNING...' : 'SCAN SUPPORTED PIDS'}</button>
            {vin && <span className="text-slate-300">VIN: <span className="text-amber-300 font-bold">{vin}</span></span>}
          </div>
          <div className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-6 gap-2">
            {(() => {
              const fmt = (v, suffix = '') => (v === null || v === undefined ? '--' : v === 'n/a' ? 'n/a' : `${typeof v === 'number' && suffix === '' && v > 100 ? Math.round(v) : v}${suffix}`);
              return [
                { name: 'ENGINE RPM', val: fmt(obdValues.rpm), unit: 'RPM', color: 'text-amber-300' },
                { name: 'SPEED', val: fmt(obdValues.speed), unit: 'km/h', color: 'text-cyan-300' },
                { name: 'COOLANT', val: fmt(obdValues.temp), unit: '°C', color: 'text-emerald-400' },
                { name: 'ENGINE LOAD', val: fmt(obdValues.load, '%'), unit: 'Load', color: 'text-purple-400' },
                { name: 'THROTTLE', val: fmt(obdValues.throttle, '%'), unit: 'TPS', color: 'text-amber-400' },
                { name: 'VOLTAGE', val: fmt(obdValues.voltage, 'V'), unit: 'Module', color: 'text-cyan-400' }
              ];
            })().map((gauge) => (
              <div key={gauge.name} className="bg-slate-950 p-2 rounded-lg border border-slate-800 text-center flex flex-col justify-between">
                <span className="text-[10px] text-slate-500 font-bold">{gauge.name}</span>
                <div className={`text-xl font-extrabold my-1 ${gauge.color}`}>{gauge.val}</div>
                <span className="text-[10px] text-slate-500">{gauge.unit}</span>
              </div>
            ))}
          </div>

          {pidTable && (
            <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 text-xs">
              <div className="font-bold text-slate-200 mb-2">SUPPORTED MODE 01 PIDS ({pidTable.length})</div>
              <div className="grid grid-cols-1 @md:grid-cols-2 gap-x-6">
                {pidTable.map((r) => (
                  <div key={r.pid} className="flex justify-between border-b border-slate-900 py-0.5">
                    <span className="text-slate-400">0x{r.pid.toString(16).toUpperCase().padStart(2, '0')} {r.name}</span>
                    <span className="text-cyan-300 font-bold">{String(r.value)} {r.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 flex flex-col gap-2">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 gap-2 flex-wrap">
              <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-500" /><span>DIAGNOSTIC TROUBLE CODES (DTCs / CHECK ENGINE LIGHT)</span>
              </span>
              <div className="flex items-center gap-2">
                <button onClick={handleScanDtcs} disabled={isScanningDtcs} className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-bold">
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanningDtcs ? 'animate-spin' : ''}`} /><span>READ CODES (03)</span>
                </button>
                {activeDtcs.length > 0 && (
                  <button onClick={handleClearDtcs} className="flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 text-xs font-bold">
                    <span>CLEAR CODES (04)</span>
                  </button>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {dtcStatus && <div className="text-[11px] text-slate-400">{dtcStatus}</div>}
              {activeDtcs.length === 0 ? (
                <div className="py-3 text-center text-slate-500 flex flex-col items-center gap-1.5">
                  {dtcStatus === null ? <span>Not scanned yet. Press READ CODES to query the vehicle.</span> : (<><CheckCircle2 className="w-6 h-6 text-emerald-400" /><span>No stored trouble codes reported.</span></>)}
                </div>
              ) : (
                activeDtcs.map((code) => (
                  <div key={code} className="bg-rose-950/30 border border-rose-500/40 rounded-lg p-2 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-rose-300">{code}</div>
                      <div className="text-xs text-slate-300">{COMMON_DTCS[code] || 'Vehicle Manufacturer Specific Code'}</div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900 text-rose-200 font-bold">STORED</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {mode === 'uds' && (
        <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 flex flex-col gap-2 text-xs">
          <div className="font-bold text-slate-200 flex items-center gap-1.5"><Stethoscope className="w-4 h-4 text-cyan-400" /> UDS (ISO 14229) OVER ISO-TP</div>
          <details className="text-slate-400"><summary className="cursor-pointer text-slate-500">About UDS</summary><p className="mt-1">Talk to one ECU by its physical request/response IDs (engine ECU is usually 7E0 / 7E8). Reading is harmless; clear, reset and non-default sessions change the ECU's state.</p></details>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-bold">REQUEST ID</span>
            <input value={udsTx} onChange={(e) => setUdsTx(e.target.value)} className={`${inp} w-24 text-amber-300`} />
            <span className="text-slate-500 font-bold">RESPONSE ID</span>
            <input value={udsRx} onChange={(e) => setUdsRx(e.target.value)} className={`${inp} w-24 text-amber-300`} />
            <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={udsExtended} onChange={(e) => setUdsExtended(e.target.checked)} className="accent-cyan-500" /> 29-bit IDs</label>
            <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={testerPresent} onChange={(e) => setTesterPresent(e.target.checked)} className="accent-cyan-500" /> TesterPresent keep-alive</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => udsSession(0x01, 'Default')} disabled={!!udsBusy} className={btn}>DEFAULT SESSION</button>
            <button onClick={() => udsSession(0x03, 'Extended')} disabled={!!udsBusy} className={btn}>EXTENDED SESSION</button>
            <button onClick={udsIdent} disabled={!!udsBusy} className={btn}>READ IDENTIFICATION</button>
            <button onClick={udsDtcs} disabled={!!udsBusy} className={btn}>READ DTCs (19 02)</button>
            <button onClick={udsClear} disabled={!!udsBusy} className={`${btn} text-rose-300`}>CLEAR DTCs (14)</button>
            <button onClick={udsReset} disabled={!!udsBusy} className={`${btn} text-rose-300`}>ECU RESET (11 01)</button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-bold">READ DID</span>
            <input value={udsDid} onChange={(e) => setUdsDid(e.target.value)} list="uds-dids" className={`${inp} w-24 text-cyan-300`} />
            <datalist id="uds-dids">
              {Object.entries(UDS_DIDS).map(([did, name]) => <option key={did} value={Number(did).toString(16).toUpperCase()}>{name}</option>)}
            </datalist>
            <button onClick={udsReadDid} disabled={!!udsBusy} className={btn}>READ</button>
            <span className="text-slate-500 font-bold ml-3">RAW REQUEST</span>
            <input value={udsRaw} onChange={(e) => setUdsRaw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && udsSendRaw()} className={`${inp} w-48 text-cyan-300 max-w-full`} />
            <button onClick={udsSendRaw} disabled={!!udsBusy} className={btn}><Send className="w-3.5 h-3.5" /> SEND</button>
            {udsBusy && <span className="text-slate-500">waiting for the ECU...</span>}
          </div>
          <div className="border border-amber-500/30 rounded-lg p-2.5 flex flex-col gap-2 bg-amber-500/5">
            <span className="font-bold text-amber-300">SERVICES THAT ACT ON THE ECU (each asks for confirmation before it is sent)</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-bold">ROUTINE (31)</span>
              <select value={udsRoutineType} onChange={(e) => setUdsRoutineType(e.target.value)} className={`${inp} text-slate-200`}>
                <option value={1}>start</option><option value={2}>stop</option><option value={3}>request results</option>
              </select>
              <input value={udsRoutineId} onChange={(e) => setUdsRoutineId(e.target.value)} title="Routine ID (hex)" className={`${inp} w-20 text-cyan-300`} />
              <input value={udsRoutineOpt} onChange={(e) => setUdsRoutineOpt(e.target.value)} placeholder="option bytes (hex)" className={`${inp} w-40 text-cyan-300 max-w-full`} />
              <button onClick={udsRoutine} disabled={!!udsBusy} className={`${btn} text-amber-300`}>SEND</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-bold">WRITE DID (2E)</span>
              <input value={udsWriteDid} onChange={(e) => setUdsWriteDid(e.target.value)} className={`${inp} w-20 text-cyan-300`} />
              <input value={udsWriteData} onChange={(e) => setUdsWriteData(e.target.value)} placeholder="data bytes (hex)" className={`${inp} w-64 text-cyan-300 max-w-full`} />
              <button onClick={udsWrite} disabled={!!udsBusy} className={`${btn} text-rose-300`}>WRITE</button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-bold">SECURITY ACCESS (27)</span>
              <span className="text-slate-500">level</span>
              <input value={udsSecLevel} onChange={(e) => setUdsSecLevel(e.target.value)} title="Odd request-seed level: 01, 03, ..." className={`${inp} w-14 text-cyan-300`} />
              <button onClick={udsSeedRequest} disabled={!!udsBusy} className={btn}>REQUEST SEED</button>
              <span className="text-slate-300">{udsSeed ? <>seed <span className="text-amber-300 font-bold">{udsSeed}</span></> : ''}</span>
              <input value={udsKey} onChange={(e) => setUdsKey(e.target.value)} placeholder="key (hex) you computed" className={`${inp} w-48 text-cyan-300 max-w-full`} />
              <button onClick={udsSendKey} disabled={!!udsBusy} className={`${btn} text-amber-300`}>SEND KEY</button>
            </div>
            <p className="text-slate-500">The seed and key exchange is the standard UDS one. This tool never computes, guesses or brute-forces keys; enter the key your own algorithm or the vendor's documentation gives. Wrong keys count against the ECU's attempt limit.</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500 font-bold">READ MEMORY (23)</span>
              <input value={udsMemAddr} onChange={(e) => setUdsMemAddr(e.target.value)} placeholder="address (hex)" className={`${inp} w-32 text-cyan-300 max-w-full`} />
              <input value={udsMemSize} onChange={(e) => setUdsMemSize(e.target.value)} title="Bytes (decimal)" className={`${inp} w-16 text-cyan-300`} />
              <button onClick={udsMemRead} disabled={!!udsBusy} className={btn}>READ</button>
              <span className="text-slate-500 font-bold ml-3">COMM CONTROL (28)</span>
              <input value={udsCommType} onChange={(e) => setUdsCommType(e.target.value)} title="Communication type (hex, 01 = normal messages)" className={`${inp} w-12 text-cyan-300`} />
              <button onClick={() => udsCommControl(0x00)} disabled={!!udsBusy} className={`${btn} text-amber-300`}>ENABLE (00)</button>
              <button onClick={() => udsCommControl(0x03)} disabled={!!udsBusy} className={`${btn} text-rose-300`}>DISABLE (03)</button>
              <span className="text-slate-500 font-bold ml-3">DTC SETTING (85)</span>
              <select value={udsDtcSetting} onChange={(e) => setUdsDtcSetting(e.target.value)} className={`${inp} text-slate-200`}>
                <option value="01">on (01)</option><option value="02">off (02)</option>
              </select>
              <button onClick={udsDtcControl} disabled={!!udsBusy} className={`${btn} text-amber-300`}>SEND</button>
            </div>
          </div>
          <div className="bg-black border border-slate-800 rounded p-2 h-48 @lg:h-64 overflow-y-auto">
            {udsLog.length === 0 && <div className="text-slate-600">Responses appear here.</div>}
            {udsLog.map((l, i) => (
              <div key={i} className={l.kind === 'error' ? 'text-rose-300' : l.kind === 'ok' ? 'text-emerald-300' : 'text-slate-300'}>
                <span className="text-slate-600">{l.time} {l.dir}</span> {l.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'j1939' && (
        <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 flex flex-col gap-2 text-xs">
          <div className="font-bold text-slate-200">J1939 (29-bit IDs: priority, PGN, source address)</div>
          <details className="text-slate-400"><summary className="cursor-pointer text-slate-500">About J1939</summary><p className="mt-1">Start the sniffer at the network's bit rate (250 kbps on most trucks, tractors and NMEA 2000 boats; 500 kbps on newer ones). Decoded signals come from a built-in table of common PGNs; values the sender marks not available are shown as such. Multi-packet messages (BAM / RTS-CTS) are not reassembled.</p></details>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 font-bold">REQUEST PGN</span>
            <input value={j1939Pgn} onChange={(e) => setJ1939Pgn(e.target.value)} title="Decimal (65262) or hex (0xFEEE)" className={`${inp} w-24 text-cyan-300`} />
            <span className="text-slate-500">to</span>
            <input value={j1939Da} onChange={(e) => setJ1939Da(e.target.value)} title="Destination address (hex); FF = global" className={`${inp} w-14 text-amber-300`} />
            <span className="text-slate-500">from SA</span>
            <input value={j1939Sa} onChange={(e) => setJ1939Sa(e.target.value)} title="Your source address (hex); F9 is the off-board diagnostic tool address" className={`${inp} w-14 text-amber-300`} />
            <button onClick={handleJ1939Request} className={btn}><Send className="w-3.5 h-3.5" /> REQUEST</button>
          </div>
          <div className="overflow-x-auto border border-slate-800 rounded">
            <table className="w-full text-left">
              <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-bold border-b border-slate-800">
                <tr><th className="py-1 px-2">PGN</th><th className="py-1 px-2">Name</th><th className="py-1 px-2">SA</th><th className="py-1 px-2">DA</th><th className="py-1 px-2">Pri</th><th className="py-1 px-2">Data / signals</th><th className="py-1 px-2 text-right">Count</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-900">
                {j1939Rows.length === 0 && (
                  <tr><td colSpan="7" className="py-8 text-center text-slate-500 italic">{isSniffing ? 'Waiting for 29-bit frames...' : 'Start the sniffer to collect J1939 traffic.'}</td></tr>
                )}
                {j1939Rows.map(({ m, d }) => (
                  <tr key={m.id} className="align-top hover:bg-slate-900/40">
                    <td className="py-1 px-2 text-amber-300 font-bold">{d.pgn}<span className="text-slate-500 font-normal"> 0x{d.pgn.toString(16).toUpperCase()}</span></td>
                    <td className="py-1 px-2 text-emerald-300">{d.acronym ? `${d.acronym} ` : ''}<span className="text-slate-400">{d.name || 'unknown PGN'}</span></td>
                    <td className="py-1 px-2 text-slate-300">{d.sa.toString(16).toUpperCase().padStart(2, '0')}</td>
                    <td className="py-1 px-2 text-slate-300">{d.pdu1 ? d.da.toString(16).toUpperCase().padStart(2, '0') : 'all'}</td>
                    <td className="py-1 px-2 text-slate-300">{d.priority}</td>
                    <td className="py-1 px-2">
                      <div className="text-cyan-300 font-bold">{hexBytes(m.data)}</div>
                      {d.signals.length > 0 && (
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                          {d.signals.map((sg, i) => (
                            <span key={i} className="text-slate-400">{sg.name}: <span className={sg.value === null && !sg.text ? 'text-slate-500' : 'text-emerald-300 font-bold'}>{sg.value !== null ? sg.value : sg.text}</span>{sg.value !== null && sg.unit ? ` ${sg.unit}` : ''}{sg.value !== null && sg.text ? ` (${sg.text})` : ''}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-1 px-2 text-right text-emerald-400 font-bold">{m.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'log' && (
        <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 flex flex-col gap-2 text-xs">
          <div className="font-bold text-slate-200">RECORD, EXPORT AND REPLAY</div>
          <div className="flex flex-wrap items-center gap-2">
            {!recording ? (
              <button onClick={startRecording} className={`${btn} text-rose-300`}><Circle className="w-3.5 h-3.5 fill-current" /> START RECORDING</button>
            ) : (
              <button onClick={() => { setRecording(false); setLogCount(logRef.current.length); }} className={btn}><Square className="w-3.5 h-3.5" /> STOP ({logCount} frames)</button>
            )}
            <button onClick={() => exportLog('candump')} className={btn}><Download className="w-3.5 h-3.5" /> CANDUMP .LOG</button>
            <button onClick={() => exportLog('asc')} className={btn} title="Vector ASCII trace (classic CAN frames); opens in CANalyzer, SavvyCAN, BusMaster"><Download className="w-3.5 h-3.5" /> VECTOR .ASC</button>
            <button onClick={() => exportLog('csv')} className={btn}><Download className="w-3.5 h-3.5" /> CSV{dbc ? ' + SIGNALS' : ''}</button>
            <button onClick={() => logInput.current?.click()} className={btn}><Upload className="w-3.5 h-3.5" /> OPEN CANDUMP LOG</button>
            <input ref={logInput} type="file" accept=".log,.txt" className="hidden" onChange={onLogFile} />
          </div>
          <div className="text-slate-400">
            {logRef.current.length ? `Recorded: ${logRef.current.length} frames (sent frames included in CSV, left out of candump).` : loadedLog ? `Loaded ${loadedLog.name}: ${loadedLog.frames.length} frames.` : 'Nothing recorded or loaded yet.'}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={viewLogInTable} className={btn}>VIEW IN SNIFFER TABLE</button>
            <span className="text-slate-500 font-bold ml-3">REPLAY SPEED</span>
            <select value={replaySpeed} onChange={(e) => setReplaySpeed(e.target.value)} className={`${inp} text-slate-200`}>
              {[0.25, 0.5, 1, 2, 4, 10].map((s) => <option key={s} value={s}>{s}×</option>)}
            </select>
            <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={replayLoop} onChange={(e) => setReplayLoop(e.target.checked)} className="accent-cyan-500" /> loop</label>
            {!replay ? (
              <button onClick={startReplay} className={`${btn} text-amber-300`}><Play className="w-3.5 h-3.5" /> REPLAY ONTO BUS</button>
            ) : (
              <button onClick={stopReplay} className={btn}><Square className="w-3.5 h-3.5" /> STOP REPLAY ({replay.done}/{replay.total})</button>
            )}
          </div>
          <p className="text-slate-500">Replay sends recorded frames with their original timing. On a vehicle, replayed frames can unlock doors, move gauges or set fault codes: only replay onto buses you own.</p>
        </div>
      )}
    </div>
  );
}
