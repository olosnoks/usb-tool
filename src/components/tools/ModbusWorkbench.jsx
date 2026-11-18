import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Square,
  RotateCcw,
  Layers,
  AlertTriangle,
  Edit3,
  Radio,
  Check,
  Search,
  Copy,
  Terminal
} from 'lucide-react';
import {
  ModbusClient,
  createRxTransceive
} from '../../utils/modbusDriver';
import {
  READ_TABLES,
  DATA_TYPES,
  WORD_ORDERS,
  EXAMPLE_SOLAR_INVERTER_MAP,
  buildRegisterRows,
  encodeValue,
  typeWordCount,
  parseRegisterMap,
  serializeRegisterMap,
  normalizeRange,
  modiconNumber,
  pollLogToCsv
} from '../../utils/modbusTypes';
import { readRequestHex, mbpollCommand, pushHistory, sparklinePoints, changedAddresses } from '../../utils/modbusTools';
import { useSerial } from '../../context/SerialContext';

export function formatWriteFeedback(result, addr, val) {
  if (result && result.ok) return `Wrote ${val} to ${40001 + addr} successfully.`;
  return `Write to ${40001 + addr} FAILED: ${(result && result.message) || 'unknown error'}`;
}

const BAUDS = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400];
const LOG_CAP = 5000;
const inputCls = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs font-bold font-mono outline-none';
const btnCls = 'flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-bold disabled:opacity-40';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function Field({ label, children }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-slate-500 uppercase font-bold">{label}</span>
      {children}
    </div>
  );
}

export default function ModbusWorkbench() {
  const {
    isConnected: portConnected,
    transceive,
    sendRawBytes,
    subscribeRx,
    reconfigureActivePort,
    connect: connectPort,
    addLog
  } = useSerial();

  // Route driver TX/RX frame logs into the app's live terminal
  const loggerRef = useRef(addLog);
  useEffect(() => { loggerRef.current = addLog; }, [addLog]);

  const [client] = useState(() => new ModbusClient((msg) => loggerRef.current?.(msg, 'sys')));
  const [isConnected, setIsConnected] = useState(false);

  // Line / bus settings
  const [slaveId, setSlaveId] = useState(1);
  const [baudRate, setBaudRate] = useState(9600);
  const [parity, setParity] = useState('none');
  const [stopBits, setStopBits] = useState(1);
  const [timeoutMs, setTimeoutMs] = useState(800);
  const [retries, setRetries] = useState(0);
  const [pollMs, setPollMs] = useState(1000);

  // What to read
  const [table, setTable] = useState('holding');
  const [startAddr, setStartAddr] = useState(0);
  const [quantity, setQuantity] = useState(8);

  const [isAutoPolling, setIsAutoPolling] = useState(false);
  const [rows, setRows] = useState([]);
  const [bitRows, setBitRows] = useState([]);
  const [history, setHistory] = useState({});
  const [changed, setChanged] = useState(() => new Set());
  const prevRowsRef = useRef([]);
  const [portName, setPortName] = useState('/dev/ttyUSB0');
  const [cmdCopied, setCmdCopied] = useState(false);
  const [pollError, setPollError] = useState('');
  const [stats, setStats] = useState(client.stats);

  // Register map (user-defined; empty = generic rows)
  const [map, setMap] = useState({ name: 'Untitled map', ranges: [] });
  const [mapJson, setMapJson] = useState('');
  const [mapError, setMapError] = useState('');

  // CSV log
  const [logging, setLogging] = useState(false);
  const logRef = useRef([]);
  const [logCount, setLogCount] = useState(0);

  // Writes
  const [writeAddr, setWriteAddr] = useState('0');
  const [writeValue, setWriteValue] = useState('0');
  const [writeKind, setWriteKind] = useState('fc06'); // fc06 | fc05 | fc16 | fc15
  const [writeType, setWriteType] = useState('u16');
  const [writeOrder, setWriteOrder] = useState('ABCD');
  const [writeFeedback, setWriteFeedback] = useState('');

  // Device info + scan
  const [info, setInfo] = useState('');
  const [scanFrom, setScanFrom] = useState(1);
  const [scanTo, setScanTo] = useState(247);
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scanFound, setScanFound] = useState([]);
  const scanSignal = useRef({ aborted: false });

  // Latest settings for the non-overlapping poll loop
  const cfgRef = useRef({});
  cfgRef.current = { table, startAddr, quantity, map, logging, slaveId };

  useEffect(() => {
    client.timeoutMs = timeoutMs;
    client.retries = retries;
  }, [client, timeoutMs, retries]);

  const tableInfo = READ_TABLES[table];
  const clampQty = (q) => Math.max(1, Math.min(tableInfo.max, Math.floor(Number(q) || 1)));

  const pollOnce = async () => {
    const c = cfgRef.current;
    const t = READ_TABLES[c.table];
    const qty = Math.max(1, Math.min(t.max, Math.floor(Number(c.quantity) || 1)));
    const addr = Math.max(0, Math.min(65535, Math.floor(Number(c.startAddr) || 0)));
    const res = await client.request(t.fc, addr, qty);
    setStats({ ...client.stats });
    if (!res.ok) {
      setPollError(`FC${String(t.fc).padStart(2, '0')} @ ${addr}: ${res.message}`);
      return;
    }
    setPollError('');
    const stamp = new Date().toISOString();
    if (t.bits) {
      const br = res.bits.map((v, i) => ({ address: addr + i, number: modiconNumber(c.table, addr + i), on: v }));
      setBitRows(br);
      setRows([]);
      if (c.logging) {
        br.forEach((b) => logRef.current.push({ t: stamp, slaveId: c.slaveId, fc: t.fc, address: b.address, label: `${c.table === 'coils' ? 'Coil' : 'Input'} ${b.address}`, value: b.on ? 1 : 0, unit: '', hex: '' }));
      }
    } else {
      const rr = buildRegisterRows(addr, res.words, c.map, c.table);
      setChanged(changedAddresses(prevRowsRef.current, rr));
      prevRowsRef.current = rr;
      setHistory((h) => pushHistory(h, Object.fromEntries(rr.map((r) => [r.address, r.mapped && typeof r.value === 'number' ? r.value : r.rawUint16]))));
      setRows(rr);
      setBitRows([]);
      if (c.logging) {
        rr.forEach((r) => logRef.current.push({ t: stamp, slaveId: c.slaveId, fc: t.fc, address: r.address, label: r.label, value: r.value, unit: r.unit, hex: r.hex }));
      }
    }
    if (c.logging) {
      if (logRef.current.length > LOG_CAP) logRef.current.splice(0, logRef.current.length - LOG_CAP);
      setLogCount(logRef.current.length);
    }
  };

  // Non-overlapping poll loop: the next request starts only after the previous
  // finished (response or timeout) plus the interval.
  useEffect(() => {
    if (!isConnected || !isAutoPolling) return undefined;
    let cancelled = false;
    (async () => {
      while (!cancelled) {
        await pollOnce();
        if (cancelled) break;
        await sleep(Math.max(0, pollMs));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, isAutoPolling, pollMs, client]);

  useEffect(() => () => { scanSignal.current.aborted = true; }, []);

  const handleConnectLive = async () => {
    try {
      // Reopen the already-connected serial port with the chosen Modbus RTU framing
      await reconfigureActivePort({ baudRate, dataBits: 8, stopBits, parity });
    } catch (err) {
      addLog?.(`[MODBUS] Could not reconfigure port: ${err.message}`, 'sys');
      return;
    }
    // Prefer the subscribeRx transport (ends on a complete or exception frame);
    // fall back to the context's length/quiet-gap transceive.
    const transport = (subscribeRx && sendRawBytes)
      ? createRxTransceive({ send: sendRawBytes, subscribeRx })
      : transceive;
    client.timeoutMs = timeoutMs;
    client.retries = retries;
    client.connectLive(transport, slaveId, baudRate, { parity, stopBits });
    setIsConnected(true);
    await pollOnce();
  };

  const handleDisconnect = () => {
    scanSignal.current.aborted = true;
    client.disconnect();
    setIsConnected(false);
    setIsAutoPolling(false);
    setRows([]);
    setBitRows([]);
    setPollError('');
    prevRowsRef.current = [];
    setChanged(new Set());
    setHistory({});
  };

  const handleManualPoll = async () => {
    if (!isConnected) return;
    client.slaveId = slaveId;
    await pollOnce();
  };

  const flash = (msg, ms) => {
    setWriteFeedback(msg);
    setTimeout(() => setWriteFeedback(''), ms);
  };

  const handleWrite = async () => {
    if (!isConnected) return;
    const addr = parseInt(writeAddr, 10);
    if (Number.isNaN(addr)) { flash('Write FAILED: invalid address', 6000); return; }
    client.slaveId = slaveId;
    let result;
    try {
      if (writeKind === 'fc06') {
        const val = parseInt(writeValue, 10);
        if (Number.isNaN(val)) { flash('Write FAILED: invalid value', 6000); return; }
        result = await client.writeSingleRegisterDetailed(addr, val);
        flash(formatWriteFeedback(result, addr, val), result.ok ? 2500 : 6000);
      } else if (writeKind === 'fc05') {
        const on = ['1', 'on', 'true'].includes(String(writeValue).trim().toLowerCase());
        result = await client.writeSingleCoil(addr, on);
        flash(result.ok ? `Wrote coil ${addr} = ${on ? 'ON' : 'OFF'}.` : `Write coil ${addr} FAILED: ${result.message}`, result.ok ? 2500 : 6000);
      } else if (writeKind === 'fc16') {
        const parts = String(writeValue).split(/[\s,;]+/).filter(Boolean);
        let words = [];
        if (writeType === 'u16') {
          words = parts.map((p) => parseInt(p, 10));
        } else {
          for (const p of parts) words.push(...encodeValue(Number(p), writeType, writeOrder));
        }
        if (words.some((w) => Number.isNaN(w))) { flash('Write FAILED: invalid value list', 6000); return; }
        result = await client.writeMultipleRegisters(addr, words);
        flash(result.ok ? `Wrote ${words.length} registers at ${addr}.` : `Write registers at ${addr} FAILED: ${result.message}`, result.ok ? 2500 : 6000);
      } else {
        const bits = String(writeValue).split(/[\s,;]+/).filter(Boolean).map((p) => ['1', 'on', 'true'].includes(p.toLowerCase()));
        result = await client.writeMultipleCoils(addr, bits);
        flash(result.ok ? `Wrote ${bits.length} coils at ${addr}.` : `Write coils at ${addr} FAILED: ${result.message}`, result.ok ? 2500 : 6000);
      }
    } catch (err) {
      flash(`Write FAILED: ${err.message}`, 6000);
      return;
    }
    setStats({ ...client.stats });
    if (result.ok) handleManualPoll();
  };

  const readDeviceInfo = async (which) => {
    if (!isConnected) return;
    client.slaveId = slaveId;
    const r = which === 'fc17' ? await client.reportServerId() : await client.readDeviceId(1, 0);
    setStats({ ...client.stats });
    if (!r.ok) { setInfo(`${which === 'fc17' ? 'FC17' : 'FC43/14'} failed: ${r.message}`); return; }
    if (which === 'fc17') {
      setInfo(`Server ID ${r.serverId}${r.running === null ? '' : r.running ? ', running' : ', stopped'}${r.text ? `, "${r.text}"` : ''}`);
    } else {
      setInfo(r.objects.map((o) => `${o.name}: ${o.value}`).join(' | ') || 'No objects returned.');
    }
  };

  const startScan = async () => {
    if (!isConnected || scanning) return;
    setIsAutoPolling(false);
    scanSignal.current = { aborted: false };
    setScanning(true);
    setScanFound([]);
    const from = Math.max(1, Math.min(247, Number(scanFrom) || 1));
    const to = Math.max(from, Math.min(247, Number(scanTo) || 247));
    try {
      const found = await client.scan({
        from,
        to,
        timeoutMs: Math.min(timeoutMs, 300),
        signal: scanSignal.current,
        probe: { fc: READ_TABLES[table].fc, addr: Math.max(0, Number(startAddr) || 0), qty: 1 },
        onProgress: (p) => {
          setScanProgress(`Probing slave ${p.slaveId} of ${p.to}...`);
          setScanFound(p.found);
        }
      });
      setScanFound(found);
      setScanProgress(scanSignal.current.aborted ? 'Scan cancelled.' : `Scan finished: ${found.length} responding.`);
    } finally {
      setScanning(false);
      setStats({ ...client.stats });
    }
  };

  const stopScan = () => { scanSignal.current.aborted = true; };

  // ---- Register map editing ----
  const updateRange = (i, patch) => {
    setMap((m) => ({ ...m, ranges: m.ranges.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) }));
  };
  const addRange = () => setMap((m) => ({ ...m, ranges: [...m.ranges, { start: Number(startAddr) || 0, type: 'u16', wordOrder: 'ABCD', scale: 1, offset: 0, unit: '', label: '' }] }));
  const applyMapJson = () => {
    try {
      setMap(parseRegisterMap(mapJson));
      setMapError('');
    } catch (err) {
      setMapError(err.message);
    }
  };
  const normalizedMapForView = () => {
    // Live-edit values may be strings or partial; ignore ranges that do not validate yet.
    const ranges = [];
    for (const r of map.ranges) {
      try { ranges.push(normalizeRange(r)); } catch { /* skip invalid */ }
    }
    return { ...map, ranges };
  };
  cfgRef.current.map = normalizedMapForView();

  const downloadCsv = () => {
    const blob = new Blob([pollLogToCsv(logRef.current)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `modbus-log-${Date.now()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const mbpollCmd = mbpollCommand({ port: portName || '/dev/ttyUSB0', slaveId, baud: baudRate, parity, stopBits, table, start: Number(startAddr) || 0, qty: Number(quantity) || 1 });
  const fmtMs = (v) => (v === null || v === undefined ? '-' : `${v.toFixed(0)} ms`);

  return (
    <div className="space-y-2 font-mono text-xs">
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <p className="text-[10px] text-slate-500 min-w-0 flex-1" title="Register meaning comes from a map you define; nothing is assumed about the device.">
            Modbus RTU master over a USB-RS485 adapter.
          </p>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <>
                {portConnected ? (
                  <button
                    onClick={handleConnectLive}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 hover:bg-cyan-500/30 text-xs font-bold transition-all"
                    title="Reopen the connected serial port with the selected baud and parity and poll the real slave"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>CONNECT LIVE (RS-485)</span>
                  </button>
                ) : (
                  <button
                    onClick={connectPort}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-xs font-bold transition-all"
                    title="Open a USB-RS485 adapter first, then connect live"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>CONNECT SERIAL PORT…</span>
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
              >
                <span>DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {/* Bus Configuration Bar */}
        <div className="pt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Field label="Slave ID:">
            <input type="number" min="1" max="247" value={slaveId}
              onChange={(e) => { const v = Number(e.target.value); setSlaveId(v); client.slaveId = v; }}
              className={`w-16 ${inputCls}`} />
          </Field>
          <Field label="Baud:">
            <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))} disabled={isConnected} className={inputCls}>
              {BAUDS.map((b) => <option key={b} value={b}>{b} bps</option>)}
            </select>
          </Field>
          <Field label="Parity:">
            <select value={parity} onChange={(e) => setParity(e.target.value)} disabled={isConnected} className={inputCls}>
              <option value="none">None</option>
              <option value="even">Even</option>
              <option value="odd">Odd</option>
            </select>
          </Field>
          <Field label="Stop bits:">
            <select value={stopBits} onChange={(e) => setStopBits(Number(e.target.value))} disabled={isConnected} className={inputCls}>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </Field>
          <Field label="Timeout:">
            <input type="number" min="50" max="10000" step="50" value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} className={`w-20 ${inputCls}`} />
            <span className="text-slate-500">ms</span>
          </Field>
          <Field label="Retries:">
            <input type="number" min="0" max="5" value={retries} onChange={(e) => setRetries(Number(e.target.value))} className={`w-14 ${inputCls}`} />
          </Field>
          <span className="text-[10px] text-slate-500 ml-auto">
            Protocol: <strong className="text-amber-400">Modbus RTU (CRC-16, 8-{{ none: 'N', even: 'E', odd: 'O' }[parity]}-{stopBits})</strong>
          </span>
        </div>

        {/* Read configuration + poll controls */}
        <div className="pt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <Field label="Table:">
            <select value={table}
              onChange={(e) => { setTable(e.target.value); prevRowsRef.current = []; setHistory({}); setChanged(new Set()); setRows([]); setBitRows([]); setPollError(''); setQuantity((q) => Math.min(q, READ_TABLES[e.target.value].max)); }}
              className={inputCls}>
              {Object.entries(READ_TABLES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Start:">
            <input type="number" min="0" max="65535" value={startAddr} onChange={(e) => setStartAddr(Number(e.target.value))} className={`w-20 ${inputCls}`} />
          </Field>
          <Field label={`Qty (max ${tableInfo.max}):`}>
            <input type="number" min="1" max={tableInfo.max} value={quantity} onChange={(e) => setQuantity(clampQty(e.target.value))} className={`w-20 ${inputCls}`} />
          </Field>
          <Field label="Interval:">
            <input type="number" min="0" max="60000" step="100" value={pollMs} onChange={(e) => setPollMs(Number(e.target.value))} className={`w-20 ${inputCls}`} />
            <span className="text-slate-500">ms</span>
          </Field>

          <button onClick={handleManualPoll} disabled={!isConnected} className={btnCls}>
            <RotateCcw className="w-3 h-3" />
            <span>POLL ONCE</span>
          </button>

          <button
            onClick={() => setIsAutoPolling(!isAutoPolling)}
            disabled={!isConnected || scanning}
            className={`flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-bold transition-all ${
              isAutoPolling
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-emerald-glow'
                : 'bg-slate-900 text-slate-400 border-slate-800'
            } disabled:opacity-40`}
          >
            {isAutoPolling ? <Square className="w-3 h-3 text-rose-400 fill-rose-400" /> : <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />}
            <span>{isAutoPolling ? `AUTO-POLLING (${pollMs} ms after each reply)` : 'START AUTO-POLL'}</span>
          </button>
        </div>
      </div>

      {/* Data-source banner */}
      {isConnected && (
        <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold">
          <Radio className="w-3.5 h-3.5 shrink-0" />
          <span>LIVE RS-485 — slave {slaveId} at {baudRate} bps (8-{{ none: 'N', even: 'E', odd: 'O' }[parity]}-{stopBits}). Frames are CRC, slave-ID and function validated; an error line below means no valid reply.</span>
        </div>
      )}

      {/* Result table */}
      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 shadow-xl space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>{tableInfo.label.toUpperCase()}</span>
          </span>
          <span className="text-[10px] text-slate-500">
            {modiconNumber(table, Number(startAddr) || 0)} - {modiconNumber(table, (Number(startAddr) || 0) + quantity - 1)}
          </span>
        </div>

        {pollError && (
          <div className="flex items-center gap-2 text-[11px] text-rose-300 bg-rose-950/30 border border-rose-500/40 rounded-lg p-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>{pollError}</span>
          </div>
        )}

        <div className="overflow-x-auto">
          {tableInfo.bits ? (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] text-slate-500 border-b border-slate-800">
                  <th className="p-1 font-bold">ADDRESS</th>
                  <th className="p-1 font-bold">NUMBER</th>
                  <th className="p-1 font-bold">STATE</th>
                </tr>
              </thead>
              <tbody>
                {bitRows.map((b) => (
                  <tr key={b.address} className="border-b border-slate-900/60">
                    <td className="p-1 text-cyan-400 font-bold">{b.address}</td>
                    <td className="p-1 text-slate-400">{b.number}</td>
                    <td className={`p-2 font-bold ${b.on ? 'text-emerald-400' : 'text-slate-500'}`}>{b.on ? 'ON (1)' : 'OFF (0)'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-[10px] text-slate-500 border-b border-slate-800">
                  <th className="p-1 font-bold">ADDRESS</th>
                  <th className="p-1 font-bold">REGISTER</th>
                  <th className="p-1 font-bold">LABEL</th>
                  <th className="p-1 font-bold">TYPE</th>
                  <th className="p-1 font-bold text-right">RAW HEX</th>
                  <th className="p-1 font-bold text-right">UINT16</th>
                  <th className="p-1 font-bold text-right">INT16</th>
                  <th className="p-1 font-bold text-right">VALUE</th>
                  <th className="p-1 font-bold text-right" title="Last 60 polls of this register">TREND</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.address} className={`border-b border-slate-900/60 hover:bg-slate-900/30 transition-colors ${changed.has(r.address) ? 'bg-amber-500/10' : ''}`}>
                    <td className="p-1 text-cyan-400 font-bold">{r.address}</td>
                    <td className="p-1 text-slate-400">{r.registerNumber}</td>
                    <td className="p-1 font-semibold text-slate-200">{r.label}</td>
                    <td className="p-1 text-slate-400">{r.type}</td>
                    <td className="p-1 text-amber-300 text-right">{r.hex}</td>
                    <td className="p-1 text-slate-300 text-right">{r.words.length === 1 ? r.rawUint16 : '-'}</td>
                    <td className="p-1 text-slate-300 text-right">{r.words.length === 1 ? r.int16 : '-'}</td>
                    <td className="p-1 font-extrabold text-emerald-400 text-right">{r.mapped ? r.display : `${r.rawUint16}`}</td>
                    <td className="p-1 text-right">
                      {(history[r.address] || []).length > 1 ? (
                        <svg width="60" height="14" viewBox="0 0 60 14" className="inline-block" role="img" aria-label={`Trend of ${r.label}`}>
                          <polyline points={sparklinePoints(history[r.address])} fill="none" stroke="currentColor" strokeWidth="1" className="text-cyan-400" />
                        </svg>
                      ) : <span className="text-slate-600">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Stats + CSV */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
          <span>Sent {stats.sent}</span>
          <span className="text-emerald-400">OK {stats.ok}</span>
          <span className="text-amber-400">Timeouts {stats.timeouts}</span>
          <span className="text-rose-400">CRC {stats.crcErrors}</span>
          <span className="text-rose-400">Exceptions {stats.exceptions}</span>
          <span className="text-rose-400">ID/FC mismatch {stats.mismatches}</span>
          <span>Response min/avg/max {fmtMs(stats.minMs)} / {fmtMs(stats.avgMs)} / {fmtMs(stats.maxMs)}</span>
          <button onClick={() => { client.resetStats(); setStats({ ...client.stats }); }} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800">reset</button>
          <label className="flex items-center gap-1 ml-auto">
            <input type="checkbox" checked={logging} onChange={(e) => setLogging(e.target.checked)} />
            <span>Log polls to CSV ({logCount} rows)</span>
          </label>
          <button onClick={downloadCsv} disabled={logCount === 0} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 disabled:opacity-40">Download CSV</button>
          <button onClick={() => { logRef.current = []; setLogCount(0); }} disabled={logCount === 0} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 disabled:opacity-40">Clear</button>
        </div>
      </div>

      {/* Register map */}
      {!tableInfo.bits && (
        <details className="bg-[#030712] border border-cyber-border rounded-lg p-2 shadow-xl">
          <summary className="font-bold text-slate-200 text-xs cursor-pointer">REGISTER MAP ({map.ranges.length} ranges{map.ranges.length === 0 ? ', generic labels' : `, ${map.name}`})</summary>
          <div className="space-y-2 pt-2">
            <p className="text-[11px] text-slate-400">
              Give a register range a type, word order, scale, offset, unit and label. Unmapped registers stay as generic &quot;Register N&quot; uint16 values.
            </p>
            {map.ranges.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-[11px]">
                <input type="number" min="0" max="65535" value={r.start} onChange={(e) => updateRange(i, { start: Number(e.target.value) })} className={`w-20 ${inputCls}`} title="start address" />
                <select value={r.type || 'u16'} onChange={(e) => updateRange(i, { type: e.target.value })} className={inputCls}>
                  {DATA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={r.wordOrder || 'ABCD'} onChange={(e) => updateRange(i, { wordOrder: e.target.value })} className={inputCls} title="word/byte order">
                  {WORD_ORDERS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                {r.type === 'ascii' && (
                  <input type="number" min="1" max="125" value={r.words || 1} onChange={(e) => updateRange(i, { words: Number(e.target.value) })} className={`w-16 ${inputCls}`} title="registers of text" />
                )}
                <input type="number" step="any" value={r.scale ?? 1} onChange={(e) => updateRange(i, { scale: e.target.value })} className={`w-20 ${inputCls}`} title="scale (multiply)" />
                <input type="number" step="any" value={r.offset ?? 0} onChange={(e) => updateRange(i, { offset: e.target.value })} className={`w-20 ${inputCls}`} title="offset (add)" />
                <input type="text" placeholder="unit" value={r.unit || ''} onChange={(e) => updateRange(i, { unit: e.target.value })} className={`w-16 ${inputCls}`} />
                <input type="text" placeholder="label" value={r.label || ''} onChange={(e) => updateRange(i, { label: e.target.value })} className={`w-28 @md:w-40 ${inputCls}`} />
                <span className="text-slate-500">({typeWordCount(r.type || 'u16', r.words)} reg)</span>
                <button onClick={() => setMap((m) => ({ ...m, ranges: m.ranges.filter((_, idx) => idx !== i) }))} className="px-1.5 rounded bg-slate-900 border border-slate-700 text-rose-300">remove</button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={addRange} className={btnCls}>+ range</button>
              <button onClick={() => { setMap(EXAMPLE_SOLAR_INVERTER_MAP); setStartAddr(0); setQuantity(8); setTable('holding'); }} className={btnCls}>Load example: solar inverter</button>
              <button onClick={() => setMap({ name: 'Untitled map', ranges: [] })} className={btnCls}>Clear map</button>
              <button onClick={() => setMapJson(serializeRegisterMap(normalizedMapForView()))} className={btnCls}>Export JSON</button>
              <button onClick={applyMapJson} className={btnCls}>Import JSON</button>
            </div>
            <textarea
              value={mapJson}
              onChange={(e) => setMapJson(e.target.value)}
              rows={4}
              placeholder='{"name":"My meter","ranges":[{"start":0,"type":"f32","wordOrder":"CDAB","scale":1,"unit":"V","label":"Voltage"}]}'
              className="w-full bg-slate-900 border border-slate-700 rounded p-2 text-[11px] font-mono text-slate-200"
            />
            {mapError && <span className="text-[11px] text-rose-400">{mapError}</span>}
          </div>
        </details>
      )}

      {/* Request preview + mbpoll export */}
      <details className="bg-[#030712] border border-cyber-border rounded-lg p-2 shadow-xl">
        <summary className="font-bold text-slate-200 text-xs cursor-pointer">
          <span className="inline-flex items-center gap-1.5"><Terminal className="w-3.5 h-3.5 text-cyan-400" /> REQUEST FRAME &amp; CLI EXPORT</span>
        </summary>
        <div className="space-y-1.5 pt-2 text-[11px]">
          <div className="text-slate-400">
            Read request frame (with CRC-16):{' '}
            <code className="text-amber-300 break-all">{readRequestHex(slaveId, tableInfo.fc, Number(startAddr) || 0, Number(quantity) || 1)}</code>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Field label="Port:">
              <input type="text" value={portName} onChange={(e) => setPortName(e.target.value)} className={`w-32 ${inputCls}`} title="Serial port name to put in the command, e.g. COM3 or /dev/ttyUSB0" />
            </Field>
            <button
              onClick={async () => {
                try { await navigator.clipboard.writeText(mbpollCmd); setCmdCopied(true); setTimeout(() => setCmdCopied(false), 1500); } catch { /* clipboard unavailable */ }
              }}
              className={btnCls}
              title="Copy the command"
            >
              <Copy className="w-3 h-3" /><span>{cmdCopied ? 'COPIED' : 'COPY'}</span>
            </button>
          </div>
          <code className="block bg-slate-950 border border-slate-800 rounded p-1.5 text-emerald-300 break-all">{mbpollCmd}</code>
          <p className="text-[10px] text-slate-500">
            This is an export for the separate open-source <strong>mbpoll</strong> command-line tool; this page does not run it. Settings follow the controls above, with -0 for 0-based addresses.
          </p>
        </div>
      </details>

      {/* Write panel */}
      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 shadow-xl space-y-2">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
            <Edit3 className="w-4 h-4 text-amber-400" />
            <span>WRITE (FC05 / FC06 / FC15 / FC16)</span>
          </span>
          {writeFeedback && (
            <span className={`text-[10px] font-bold flex items-center gap-1 ${writeFeedback.includes('FAILED') ? 'text-rose-400' : 'text-emerald-400'}`}>
              {writeFeedback.includes('FAILED') ? <AlertTriangle className="w-3 h-3" /> : <Check className="w-3 h-3" />}
              <span>{writeFeedback}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Field label="Function:">
            <select value={writeKind} onChange={(e) => setWriteKind(e.target.value)} className={inputCls}>
              <option value="fc06">FC06 single register</option>
              <option value="fc16">FC16 multiple registers</option>
              <option value="fc05">FC05 single coil</option>
              <option value="fc15">FC15 multiple coils</option>
            </select>
          </Field>
          <Field label="Address:">
            <input type="text" placeholder="0" value={writeAddr} onChange={(e) => setWriteAddr(e.target.value)} className={`w-24 ${inputCls}`} />
          </Field>
          {writeKind === 'fc16' && (
            <>
              <Field label="Type:">
                <select value={writeType} onChange={(e) => setWriteType(e.target.value)} className={inputCls}>
                  {['u16', 'i16', 'u32', 'i32', 'f32', 'f64'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Order:">
                <select value={writeOrder} onChange={(e) => setWriteOrder(e.target.value)} className={inputCls}>
                  {WORD_ORDERS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </Field>
            </>
          )}
          <Field label={writeKind === 'fc05' ? 'State (0/1):' : writeKind === 'fc15' ? 'Bits (e.g. 1 0 1):' : writeKind === 'fc16' ? 'Values (space/comma separated):' : 'Value (uint16):'}>
            <input type="text" value={writeValue} onChange={(e) => setWriteValue(e.target.value)} className={`w-40 @md:w-56 ${inputCls}`} />
          </Field>
          <button
            onClick={handleWrite}
            disabled={!isConnected}
            className="px-3 py-1 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow transition-all disabled:opacity-40"
          >
            WRITE
          </button>
        </div>
      </div>

      {/* Device info + slave scan */}
      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 shadow-xl space-y-2">
        <div className="flex items-center gap-1.5 pb-2 border-b border-slate-800 font-bold text-slate-200 text-xs">
          <Search className="w-4 h-4 text-cyan-400" />
          <span>DEVICE INFO &amp; SLAVE-ID SCAN</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => readDeviceInfo('fc17')} disabled={!isConnected} className={btnCls}>Report Server ID (FC17)</button>
          <button onClick={() => readDeviceInfo('fc2b')} disabled={!isConnected} className={btnCls}>Read Device ID (FC43/14)</button>
          {info && <span className="text-[11px] text-slate-300">{info}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Field label="Scan from:">
            <input type="number" min="1" max="247" value={scanFrom} onChange={(e) => setScanFrom(Number(e.target.value))} disabled={scanning} className={`w-16 ${inputCls}`} />
          </Field>
          <Field label="to:">
            <input type="number" min="1" max="247" value={scanTo} onChange={(e) => setScanTo(Number(e.target.value))} disabled={scanning} className={`w-16 ${inputCls}`} />
          </Field>
          {!scanning ? (
            <button onClick={startScan} disabled={!isConnected} className={btnCls}>SCAN SLAVE IDs</button>
          ) : (
            <button onClick={stopScan} className="flex items-center gap-1 px-3 py-1 rounded bg-slate-900 border border-rose-500 text-rose-400 text-xs font-bold">
              <Square className="w-3 h-3 fill-current" /><span>STOP SCAN</span>
            </button>
          )}
          <span className="text-[11px] text-slate-400">{scanProgress}</span>
        </div>
        <p className="text-[10px] text-slate-500">
          The scan probes each ID with a one-register read of the selected table and start address; a valid exception reply also counts as a device. Unanswered IDs wait for the timeout (capped at 300 ms), so a full 1-247 scan can take over a minute.
        </p>
        {scanFound.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {scanFound.map((f) => (
              <button key={f.slaveId} onClick={() => { setSlaveId(f.slaveId); client.slaveId = f.slaveId; }}
                className="px-2 py-1 rounded bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold"
                title={f.message}>
                Slave {f.slaveId} ({f.kind === 'ok' ? 'replied' : 'exception reply'})
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
