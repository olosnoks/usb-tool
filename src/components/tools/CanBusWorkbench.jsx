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
  FileText
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import {
  CAN_BAUD_RATES,
  COMMON_DTCS,
  parseSlcanFrame,
  buildSlcanFrame,
  SlcanLineReader,
  ObdOverSlcan
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
  formatDidValue,
  SimulatedEcu,
  OBD_PID_TABLE
} from '../../utils/canTools';
import { DemoBanner } from '../common/DemoNotice';

import { confirmAction } from '../../utils/sessionLog';
// Signals for the simulation's frames, so DBC decoding can be tried without a car.
const DEMO_DBC = `BO_ 476 ENGINE_STATUS: 8 ECM
 SG_ EngineRPM : 7|16@0+ (1,0) [0|8000] "rpm" DASH
 SG_ VehicleSpeed : 23|8@0+ (1,0) [0|255] "km/h" DASH
 SG_ AliveCounter : 63|8@0+ (1,0) [0|255] "" DASH

BO_ 517 WHEEL_SPEEDS: 8 ABS
 SG_ WheelFL : 7|8@0+ (1,0) [0|255] "km/h" DASH
 SG_ WheelFR : 15|8@0+ (1,0) [0|255] "km/h" DASH
 SG_ WheelRL : 23|8@0+ (1,0) [0|255] "km/h" DASH
 SG_ WheelRR : 31|8@0+ (1,0) [0|255] "km/h" DASH

BO_ 200 BRAKE: 4 ABS
 SG_ BrakePedal : 0|1@1+ (1,0) [0|1] "" DASH

VAL_ 200 BrakePedal 0 "Released" 1 "Pressed" ;
`;

const MAX_LOG = 200000;
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
  ['log', 'Record & Replay']
];

export default function CanBusWorkbench({ initialMode = 'sniffer' }) {
  const { isConnected, sendString, addLog, subscribeRx } = useSerial();

  const [mode, setMode] = useState(initialMode);
  const [canBaud, setCanBaud] = useState('S6'); // 500 kbps (standard automotive)
  const [isSniffing, setIsSniffing] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [notice, setNotice] = useState('');

  // Sniffer table: key -> { id, isExtended, dlc, data, lastTime, deltaMs, count, diffs }
  const [messages, setMessages] = useState({});
  const [idFilter, setIdFilter] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [dbc, setDbc] = useState(null);
  const [dbcName, setDbcName] = useState('');
  const dbcInput = useRef(null);

  // Transmit
  const [txId, setTxId] = useState('0x123');
  const [txData, setTxData] = useState('11 22 33 44 55 66 77 88');
  const [txExtended, setTxExtended] = useState(false);
  const [txIntervalMs, setTxIntervalMs] = useState(100);
  const [txPeriodic, setTxPeriodic] = useState(false);

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
  const udsRef = useRef(null); // { tp, uds, key }

  const sendRef = useRef(sendString);
  sendRef.current = sendString;
  const simRef = useRef(isSimulated);
  simRef.current = isSimulated;
  const simEcuRef = useRef(null);
  const sniffingRef = useRef(false);
  sniffingRef.current = isSniffing;
  const pendingFramesRef = useRef([]);
  const slcanReaderRef = useRef(new SlcanLineReader());
  const simIntervalRef = useRef(null);

  // Every frame (received, simulated, or sent by us) goes through ingest().
  const ingest = (frames, { tx = false } = {}) => {
    const now = performance.now();
    for (const f of frames) {
      if (recordingRef.current && logRef.current.length < MAX_LOG) logRef.current.push({ ...f, t: f.t ?? Date.now(), tx });
      if (tx) continue;
      obdRef.current.onFrame(f);
      udsRef.current?.tp.onFrame(f);
      if (sniffingRef.current) pendingFramesRef.current.push({ ...f, seen: now });
    }
  };

  // One CAN frame onto the bus (or into the simulated ECU).
  const sendFrame = (f) => {
    const frame = { ...f, dlc: f.data.length, t: Date.now() };
    if (simRef.current) {
      if (!simEcuRef.current) simEcuRef.current = new SimulatedEcu((r) => ingest([{ ...r, t: Date.now() }]));
      simEcuRef.current.onFrame(frame);
    } else {
      sendRef.current(buildSlcanFrame(frame.id, frame.data, frame.isExtended), '');
    }
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
        if (old) for (let i = 0; i < f.dlc; i++) if (old.data[i] !== f.data[i]) diffs.add(i);
        next[key] = {
          id: f.id, isExtended: f.isExtended, dlc: f.dlc, data: f.data, lastTime: now,
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
      if (batch.length) { pendingFramesRef.current = []; applyFrames(batch); }
      if (recordingRef.current) setLogCount(logRef.current.length);
    }, 100);
    return () => clearInterval(flush);
  }, []);

  // Real adapter: SLCAN lines from the serial stream.
  useEffect(() => {
    if (isSimulated || !isConnected || !subscribeRx) return undefined;
    const reader = slcanReaderRef.current;
    const dec = new TextDecoder();
    const unsub = subscribeRx((bytes) => {
      const frames = [];
      for (const line of reader.push(dec.decode(bytes, { stream: true }))) {
        const f = parseSlcanFrame(line);
        if (f) frames.push({ ...f, t: Date.now() });
      }
      if (frames.length) ingest(frames);
    });
    return () => { unsub(); pendingFramesRef.current = []; };
  }, [isSimulated, isConnected, subscribeRx]);

  // Simulation traffic generator.

  // Live gauges: poll mode 01 PIDs one after another while enabled.
  useEffect(() => {
    if (!obdLive || isSimulated || !isConnected || mode !== 'obd2') return undefined;
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
  }, [obdLive, isSimulated, isConnected, mode]);

  // Periodic transmit.
  useEffect(() => {
    if (!txPeriodic) return undefined;
    const t = setInterval(() => { try { transmit(); } catch (e) { setTxPeriodic(false); setNotice(e.message); } }, Math.max(5, Number(txIntervalMs) || 100));
    return () => clearInterval(t);
  }, [txPeriodic, txIntervalMs, txId, txData, txExtended]);

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
    await sendString('C', '\r');
    await sendString(canBaud, '\r');
    await sendString('O', '\r');
  };

  const startSniffing = async () => {
    if (!isSimulated) {
      if (!isConnected) { alert('Connect the SLCAN adapter (CANable / Candlelight) over serial first.'); return false; }
      await openChannel();
      const rate = (CAN_BAUD_RATES.find((r) => r.code === canBaud) || {}).label || canBaud;
      addLog(`[CAN BUS] SLCAN channel opened at ${rate} (${canBaud}, O).`, 'sys');
    }
    setIsSniffing(true);
    sniffingRef.current = true;
    return true;
  };

  const ensureBus = async () => {
    if (isSimulated || sniffingRef.current) return true;
    return startSniffing();
  };

  const stopSniffing = async () => {
    setIsSniffing(false);
    if (!isSimulated && isConnected) {
      await sendString('C', '\r');
      addLog('[CAN BUS] SLCAN channel closed (C).', 'sys');
    }
  };

  const transmit = () => {
    const id = parseInt(String(txId).replace(/^0x/i, ''), 16);
    if (Number.isNaN(id) || id < 0 || id > 0x1fffffff) throw new Error('Invalid hex CAN ID.');
    const bytes = parseBytes(txData);
    if (bytes.length > 8) throw new Error('Classic CAN frames carry at most 8 bytes.');
    if (!isSimulated && !isConnected) throw new Error('Connect the SLCAN adapter first.');
    const ext = txExtended || id > 0x7ff;
    sendFrame({ id, isExtended: ext, data: Uint8Array.from(bytes) });
    return { id, ext, bytes };
  };

  const handleTransmitFrame = () => {
    try {
      const { id, ext, bytes } = transmit();
      addLog(`[CAN TX] ${buildSlcanFrame(id, Uint8Array.from(bytes), ext).trim()}`, 'tx');
      setNotice('');
    } catch (e) {
      setNotice(e.message);
    }
  };

  // --- OBD-II ---------------------------------------------------------------

  const handleScanDtcs = async () => {
    if (!isSimulated && !isConnected) { alert('Connect the SLCAN adapter over serial first.'); return; }
    setIsScanningDtcs(true);
    try {
      if (!(await ensureBus())) return;
      const { dtcs, ecus } = await obdRef.current.readDtcs();
      setActiveDtcs(dtcs);
      setDtcStatus(ecus.length
        ? `${ecus.length} ECU${ecus.length === 1 ? '' : 's'} answered (${ecus.map((e) => '0x' + e.toString(16).toUpperCase()).join(', ')}).${isSimulated ? ' (simulated ECU)' : ''}`
        : 'No ECU answered. Check the ignition, the CAN bitrate and the OBD-II wiring.');
      addLog(`[OBD-II] Mode 03: ${ecus.length} ECU(s), ${dtcs.length} code(s)${dtcs.length ? ': ' + dtcs.join(', ') : ''}`, 'sys');
    } catch (e) {
      setDtcStatus(`Read failed: ${e.message}`);
    } finally {
      setIsScanningDtcs(false);
    }
  };

  const handleClearDtcs = async () => {
    if (!isSimulated && !confirmAction('Send OBD-II mode 04 to clear stored trouble codes and freeze-frame data on this vehicle?')) return;
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
      udsRef.current = { key, tp, uds: new UdsClient(tp) };
    }
    return udsRef.current;
  };

  const logUds = (dir, text, kind = 'info') => setUdsLog((prev) => [...prev.slice(-300), { dir, text, kind, time: new Date().toLocaleTimeString() }]);

  const runUds = async (label, fn) => {
    if (!isSimulated && !isConnected) { setNotice('Connect the SLCAN adapter first.'); return; }
    if (Number.isNaN(parseInt(udsTx, 16)) || Number.isNaN(parseInt(udsRx, 16))) { setNotice('Enter hex request and response IDs.'); return; }
    setUdsBusy(label);
    try {
      if (!(await ensureBus())) return;
      await fn(udsChannel().uds);
    } catch (e) {
      logUds('!', e.message, 'error');
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
    if (!isSimulated && !confirmAction('Send UDS ClearDiagnosticInformation (0x14 FFFFFF) to this ECU?')) return;
    runUds('clear', async (uds) => { await uds.clearDtcs(); logUds('<', 'DTCs cleared.', 'ok'); });
  };

  const udsReset = () => {
    if (!isSimulated && !confirmAction('Send UDS ECUReset (hard reset) to this ECU? It restarts immediately.')) return;
    runUds('reset', async (uds) => { await uds.ecuReset(0x01); logUds('<', 'ECU accepted the hard reset.', 'ok'); });
  };

  const udsSendRaw = () => runUds('raw', async (uds) => {
    const bytes = parseBytes(udsRaw);
    if (!bytes.length) throw new Error('Enter request bytes, e.g. 22 F1 90.');
    logUds('>', hexBytes(bytes));
    const r = await uds.request(bytes);
    logUds('<', `${hexBytes(r)}${r.length > 3 ? `  "${formatDidValue(r.slice(3))}"` : ''}`, 'ok');
  });

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
    else download(toCandumpLog(frames.filter((f) => !f.tx)), `can-${stamp}.log`);
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
    if (!isSimulated && !isConnected) { setNotice('Connect the SLCAN adapter to replay onto a bus.'); return; }
    if (!isSimulated && !confirmAction(`Transmit ${frames.length} recorded frames onto the CAN bus? Replaying traffic into a vehicle can trigger real actions.`)) return;
    ensureBus().then((ok) => {
      if (!ok) return;
      setReplay({ done: 0, total: frames.length });
      replayStopRef.current = replayFrames(frames, (f) => sendFrame({ id: f.id, isExtended: f.isExtended, data: f.data }), {
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
    .sort((a, b) => a.id - b.id);

  const toggleSimulation = () => {
    // Switching never carries simulated frames or codes over to hardware (or back).
    const next = !isSimulated;
    stopReplay();
    setTxPeriodic(false);
    setTesterPresent(false);
    setIsSimulated(next);
    simRef.current = next;
    setIsSniffing(next);
    sniffingRef.current = next;
    setMessages({});
    setActiveDtcs([]);
    setDtcStatus(null);
    setObdLive(false);
    setObdValues(EMPTY_OBD);
    setVin(null);
    setPidTable(null);
    setUdsLog([]);
    simEcuRef.current = null;
    udsRef.current = null;
    if (next && !dbc) { setDbc(parseDbc(DEMO_DBC)); setDbcName('demo.dbc (simulation)'); }
    if (!next && dbcName.endsWith('(simulation)')) { setDbc(null); setDbcName(''); }
  };

  const btn = 'flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-bold disabled:opacity-40';
  const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-xs outline-none';

  return (
    <div className="flex flex-col gap-4 font-mono">
      {notice &&<div className="p-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 text-xs flex justify-between gap-2"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400">
              Sniff CAN through an SLCAN adapter (CANable / Candlelight) with byte-change highlighting and DBC signal decoding, transmit and replay frames, read OBD-II data and talk UDS over ISO-TP.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              {MODES.map(([id, label]) => (
                <button key={id} onClick={() => setMode(id)} className={`px-3 py-1 rounded font-bold transition-all ${mode === id ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-slate-200'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">CAN BAUD:</span>
              <select value={canBaud} onChange={(e) => setCanBaud(e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-emerald-400 font-bold outline-none">
                {CAN_BAUD_RATES.map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}
              </select>
            </div>
            {!isSniffing ? (
              <button onClick={startSniffing} className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 text-xs font-bold transition-all">
                <Play className="w-3.5 h-3.5 fill-current" /><span>START SNIFFER</span>
              </button>
            ) : (
              <button onClick={stopSniffing} className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
                <Square className="w-3.5 h-3.5 fill-current" /><span>PAUSE</span>
              </button>
            )}
            <button onClick={() => setMessages({})} className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800" title="Clear captured packets">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {recording && <span className="flex items-center gap-1 text-rose-400 font-bold"><Circle className="w-3 h-3 fill-current animate-pulse" /> REC {logCount}</span>}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => dbcInput.current?.click()} className={btn} title="Load a .dbc file to decode signals">
              <FileText className="w-3.5 h-3.5" /> {dbcName ? `DBC: ${dbcName}` : 'LOAD DBC'}
            </button>
            {dbc && <button onClick={() => { setDbc(null); setDbcName(''); }} className="text-slate-500 hover:text-rose-400" title="Unload DBC">×</button>}
            <input ref={dbcInput} type="file" accept=".dbc" className="hidden" onChange={onDbcFile} />
            <div className="relative">
              <input
                type="text"
                placeholder="IDs: 1DC, 200-2FF, !7DF"
                value={idFilter}
                onChange={(e) => setIdFilter(e.target.value)}
                className={`bg-slate-950 border rounded-lg pl-7 pr-2.5 py-1 text-xs text-slate-200 outline-none w-48 ${filterFn.error ? 'border-rose-500' : 'border-slate-800'}`}
                title={filterFn.error || 'Comma-separated IDs or ranges; prefix ! to hide'}
              />
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
            </div>
            <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} className="accent-amber-500" /> changing only</label>
          </div>
        </div>
      </div>

      {mode === 'sniffer' && (
        <div className="space-y-3">
          <div className="bg-[#030712] border border-cyber-border rounded-xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-bold border-b border-slate-800">
                  <tr>
                    <th className="py-2 px-3">CAN ID (Hex)</th>
                    <th className="py-2 px-3">Type</th>
                    <th className="py-2 px-3">DLC</th>
                    <th className="py-2 px-3">Data Bytes (Live Diff Highlight)</th>
                    <th className="py-2 px-3">Delta</th>
                    <th className="py-2 px-3 text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {filteredMessageList.length === 0 ? (
                    <tr>
                      <td colSpan="6" className="py-12 text-center text-slate-500 italic">
                        {isSniffing ? 'Listening on CAN bus... Waiting for frames.' : 'Click "START SNIFFER" to capture packets.'}
                      </td>
                    </tr>
                  ) : (
                    filteredMessageList.map((m) => {
                      const decoded = dbc ? decodeFrame(dbc, m) : null;
                      return (
                        <tr key={(m.isExtended ? 'x' : '') + m.id} className="hover:bg-slate-900/40 align-top">
                          <td className="py-2 px-3 font-bold text-amber-300">
                            0x{hexId(m)}
                            {decoded && <div className="text-[10px] text-emerald-300 font-normal">{decoded.name}</div>}
                          </td>
                          <td className="py-2 px-3 text-[10px] text-slate-400">{m.isExtended ? 'EXT (29b)' : 'STD (11b)'}</td>
                          <td className="py-2 px-3 text-slate-300 font-bold">{m.dlc}</td>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-1.5 font-bold">
                              {Array.from(m.data || []).map((b, idx) => (
                                <span key={idx} className={`px-1.5 py-0.5 rounded transition-colors ${m.diffs?.has?.(idx) ? 'bg-amber-400 text-slate-950 font-extrabold shadow-[0_0_8px_rgba(251,191,36,0.6)]' : 'bg-slate-950 text-cyan-300 border border-slate-850'}`}>
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
                          <td className="py-2 px-3 text-slate-400 text-[10px]">{m.deltaMs} ms</td>
                          <td className="py-2 px-3 text-right text-emerald-400 font-bold">{m.count}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-xl text-xs">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-cyan-400" /><span>TRANSMIT CAN FRAME:</span>
            </span>
            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
              <input type="text" value={txId} onChange={(e) => setTxId(e.target.value)} placeholder="0x123" className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-amber-300 font-bold outline-none w-24 uppercase" />
              <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={txExtended} onChange={(e) => setTxExtended(e.target.checked)} className="accent-cyan-500" /> 29-bit</label>
              <input type="text" value={txData} onChange={(e) => setTxData(e.target.value)} placeholder="11 22 33 44 55 66 77 88" className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-cyan-300 font-bold outline-none w-64 uppercase" />
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {!isSimulated && (
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
          <div className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-6 gap-3">
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
              <div key={gauge.name} className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center flex flex-col justify-between">
                <span className="text-[10px] text-slate-500 font-bold">{gauge.name}</span>
                <div className={`text-xl font-extrabold my-1 ${gauge.color}`}>{gauge.val}</div>
                <span className="text-[10px] text-slate-500">{gauge.unit}</span>
              </div>
            ))}
          </div>

          {pidTable && (
            <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 text-xs">
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

          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
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
                <div className="py-6 text-center text-slate-500 flex flex-col items-center gap-1.5">
                  {dtcStatus === null ? <span>Not scanned yet. Press READ CODES to query the vehicle.</span> : (<><CheckCircle2 className="w-6 h-6 text-emerald-400" /><span>No stored trouble codes reported.</span></>)}
                </div>
              ) : (
                activeDtcs.map((code) => (
                  <div key={code} className="bg-rose-950/30 border border-rose-500/40 rounded-lg p-3 flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-rose-300">{code}</div>
                      <div className="text-xs text-slate-300">{COMMON_DTCS[code] || 'Vehicle Manufacturer Specific Code'}</div>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-rose-900 text-rose-200 font-bold">{isSimulated ? 'DEMO' : 'STORED'}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {mode === 'uds' && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col gap-3 text-xs">
          <div className="font-bold text-slate-200 flex items-center gap-1.5"><Stethoscope className="w-4 h-4 text-cyan-400" /> UDS (ISO 14229) OVER ISO-TP</div>
          <p className="text-slate-400">Talk to one ECU by its physical request/response IDs (engine ECU is usually 7E0 / 7E8). Reading is harmless; clear, reset and non-default sessions change the ECU's state.</p>
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
            <input value={udsRaw} onChange={(e) => setUdsRaw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && udsSendRaw()} className={`${inp} w-48 text-cyan-300`} />
            <button onClick={udsSendRaw} disabled={!!udsBusy} className={btn}><Send className="w-3.5 h-3.5" /> SEND</button>
            {udsBusy && <span className="text-slate-500">waiting for the ECU...</span>}
          </div>
          <div className="bg-black border border-slate-800 rounded p-2 h-64 overflow-y-auto">
            {udsLog.length === 0 && <div className="text-slate-600">Responses appear here.</div>}
            {udsLog.map((l, i) => (
              <div key={i} className={l.kind === 'error' ? 'text-rose-300' : l.kind === 'ok' ? 'text-emerald-300' : 'text-slate-300'}>
                <span className="text-slate-600">{l.time} {l.dir}</span> {l.text}
              </div>
            ))}
          </div>
        </div>
      )}

      {mode === 'log' && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col gap-3 text-xs">
          <div className="font-bold text-slate-200">RECORD, EXPORT AND REPLAY</div>
          <div className="flex flex-wrap items-center gap-2">
            {!recording ? (
              <button onClick={startRecording} className={`${btn} text-rose-300`}><Circle className="w-3.5 h-3.5 fill-current" /> START RECORDING</button>
            ) : (
              <button onClick={() => { setRecording(false); setLogCount(logRef.current.length); }} className={btn}><Square className="w-3.5 h-3.5" /> STOP ({logCount} frames)</button>
            )}
            <button onClick={() => exportLog('candump')} className={btn}><Download className="w-3.5 h-3.5" /> CANDUMP .LOG</button>
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
