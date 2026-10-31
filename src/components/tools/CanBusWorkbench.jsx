import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, 
  Send, 
  Trash2, 
  Play, 
  Square, 
  Filter, 
  Search, 
  Sparkles, 
  Gauge, 
  ShieldAlert, 
  CheckCircle2, 
  AlertTriangle,
  RefreshCw,
  Cpu,
  Layers,
  ArrowRight
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import { 
  CAN_BAUD_RATES, 
  OBD_PIDS, 
  COMMON_DTCS, 
  parseSlcanFrame, 
  buildSlcanFrame,
  SlcanLineReader,
  ObdOverSlcan
} from '../../utils/canBusDriver';
import { DemoBanner } from '../common/DemoNotice';
import StatusBadge from '../common/StatusBadge';

export default function CanBusWorkbench() {
  const { isConnected, sendString, addLog, subscribeRx } = useSerial();

  const [mode, setMode] = useState('sniffer'); // 'sniffer' | 'obd2'
  const [canBaud, setCanBaud] = useState('S6'); // 500 kbps (standard automotive)
  const [isSniffing, setIsSniffing] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);

  // CAN Sniffer message map: id -> { id, isExtended, dlc, data: Uint8Array, lastTime, deltaMs, count, diffs: Set(idx) }
  const [messages, setMessages] = useState({});
  const [idFilter, setIdFilter] = useState('');

  // Transmit State
  const [txId, setTxId] = useState('0x123');
  const [txData, setTxData] = useState('11 22 33 44 55 66 77 88');
  const [txIntervalMs, setTxIntervalMs] = useState(100);

  // OBD-II Live Telemetry State
  const [obdValues, setObdValues] = useState({
    rpm: 0,
    speed: 0,
    temp: 0,
    load: 0,
    throttle: 0,
    voltage: 0
  });
  const [activeDtcs, setActiveDtcs] = useState([]);
  const [isScanningDtcs, setIsScanningDtcs] = useState(false);
  const [dtcStatus, setDtcStatus] = useState(null);   // null = not scanned yet

  // Real adapter: SLCAN frames from the serial stream, and OBD-II over them.
  const sendRef = useRef(sendString);
  sendRef.current = sendString;
  const obdRef = useRef(null);
  if (!obdRef.current) obdRef.current = new ObdOverSlcan((line) => sendRef.current(line, ''));
  const sniffingRef = useRef(false);
  sniffingRef.current = isSniffing;
  const pendingFramesRef = useRef([]);
  const slcanReaderRef = useRef(new SlcanLineReader());   // survives re-subscribes: keeps partial lines

  const simIntervalRef = useRef(null);

  const applyFrames = (frames) => {
    if (!frames.length) return;
    const now = Date.now();
    setMessages(prev => {
      const next = { ...prev };
      for (const f of frames) {
        const key = (f.isExtended ? 'x' : '') + f.id;
        const old = next[key];
        const diffs = new Set();
        if (old) for (let i = 0; i < f.dlc; i++) if (old.data[i] !== f.data[i]) diffs.add(i);
        next[key] = { id: f.id, isExtended: f.isExtended, dlc: f.dlc, data: f.data, lastTime: now,
                      deltaMs: old ? now - old.lastTime : 0, count: (old?.count || 0) + 1, diffs };
      }
      return next;
    });
  };

  // Every received chunk -> SLCAN lines -> frames. OBD replies go to the OBD
  // session; while sniffing, frames are batched into the table every 100 ms.
  useEffect(() => {
    if (isSimulated || !isConnected || !subscribeRx) return undefined;
    const reader = slcanReaderRef.current;
    const dec = new TextDecoder();
    const unsub = subscribeRx((bytes) => {
      for (const line of reader.push(dec.decode(bytes, { stream: true }))) {
        const f = parseSlcanFrame(line);
        if (!f) continue;
        obdRef.current.onFrame(f);
        if (sniffingRef.current) pendingFramesRef.current.push(f);
      }
    });
    const flush = setInterval(() => {
      const batch = pendingFramesRef.current;
      if (batch.length) { pendingFramesRef.current = []; applyFrames(batch); }
    }, 100);
    return () => { unsub(); clearInterval(flush); pendingFramesRef.current = []; };
  }, [isSimulated, isConnected, subscribeRx]);

  // Simulation Traffic Generator
  useEffect(() => {
    if (!isSimulated || !isSniffing) {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      return;
    }

    let simRpm = 1200;
    let simSpeed = 35;
    let simCounter = 0;

    simIntervalRef.current = setInterval(() => {
      simCounter++;
      // Oscillate RPM & Speed
      simRpm = 1200 + Math.floor(Math.sin(simCounter / 10) * 800) + Math.floor(Math.random() * 50);
      simSpeed = Math.max(0, 35 + Math.floor(Math.sin(simCounter / 10) * 25));

      setObdValues({
        rpm: simRpm,
        speed: simSpeed,
        temp: 88,
        load: 28,
        throttle: 18,
        voltage: 14.1
      });

      // Synthetic CAN frames (Engine 0x1DC, Wheel Speed 0x205, Brakes 0x0C8)
      const now = Date.now();
      const frames = [
        {
          id: 0x1DC,
          isExtended: false,
          dlc: 8,
          data: new Uint8Array([
            (simRpm >> 8) & 0xFF,
            simRpm & 0xFF,
            simSpeed & 0xFF,
            0x24, 0x12, 0x88, 0x00, simCounter & 0xFF
          ])
        },
        {
          id: 0x205,
          isExtended: false,
          dlc: 8,
          data: new Uint8Array([simSpeed & 0xFF, simSpeed & 0xFF, simSpeed & 0xFF, simSpeed & 0xFF, 0x00, 0x00, 0x00, 0x00])
        },
        {
          id: 0x0C8,
          isExtended: false,
          dlc: 4,
          data: new Uint8Array([simCounter % 20 < 5 ? 0x01 : 0x00, 0x55, 0xAA, simCounter & 0xFF])
        }
      ];

      setMessages(prev => {
        const next = { ...prev };
        for (const f of frames) {
          const old = next[f.id];
          const diffs = new Set();
          if (old) {
            for (let i = 0; i < f.dlc; i++) {
              if (old.data[i] !== f.data[i]) diffs.add(i);
            }
          }
          next[f.id] = {
            id: f.id,
            isExtended: f.isExtended,
            dlc: f.dlc,
            data: f.data,
            lastTime: now,
            deltaMs: old ? now - old.lastTime : 0,
            count: (old?.count || 0) + 1,
            diffs
          };
        }
        return next;
      });
    }, 60);

    return () => clearInterval(simIntervalRef.current);
  }, [isSimulated, isSniffing]);

  // SLCAN: close, set bitrate, open (listen + transmit). The adapter answers
  // each with "\r", or BELL (0x07) on error.
  const openChannel = async () => {
    await sendString('C', '\r');
    await sendString(canBaud, '\r');
    await sendString('O', '\r');
  };

  const startSniffing = async () => {
    if (!isSimulated) {
      if (!isConnected) { alert('Connect the SLCAN adapter (CANable / Candlelight) over serial first.'); return; }
      await openChannel();
      const rate = (CAN_BAUD_RATES.find(r => r.code === canBaud) || {}).label || canBaud;
      addLog(`[CAN BUS] SLCAN channel opened at ${rate} (${canBaud}, O).`, 'sys');
    }
    setIsSniffing(true);
  };

  const stopSniffing = async () => {
    setIsSniffing(false);
    if (!isSimulated && isConnected) {
      await sendString('C', '\r');
      addLog('[CAN BUS] SLCAN channel closed (C).', 'sys');
    }
  };

  const handleClearMessages = () => {
    setMessages({});
  };

  // Send Single CAN Frame
  const handleTransmitFrame = () => {
    const cleanId = parseInt(txId, 16);
    if (isNaN(cleanId)) {
      alert('Invalid Hex CAN ID');
      return;
    }
    const bytes = txData.split(/\s+/).map(h => parseInt(h, 16)).filter(n => !isNaN(n));
    const slcanStr = buildSlcanFrame(cleanId, new Uint8Array(bytes), cleanId > 0x7FF);
    if (isConnected) {
      sendString(slcanStr, '');
    }
    addLog(`[CAN TX] ${slcanStr.trim()}`, 'tx');
  };

  // Scan OBD-II DTCs
  const handleScanDtcs = async () => {
    if (isSimulated) {
      setActiveDtcs(['P0300', 'P0171']);
      setDtcStatus('Demo codes (simulation): no vehicle was queried.');
      return;
    }
    if (!isConnected) { alert('Connect the SLCAN adapter over serial first.'); return; }
    setIsScanningDtcs(true);
    try {
      if (!isSniffing) await startSniffing();          // the channel must be open to talk OBD
      const { dtcs, ecus } = await obdRef.current.readDtcs();
      setActiveDtcs(dtcs);
      setDtcStatus(ecus.length
        ? `${ecus.length} ECU${ecus.length === 1 ? '' : 's'} answered (${ecus.map(e => '0x' + e.toString(16).toUpperCase()).join(', ')}).`
        : 'No ECU answered. Check the ignition, the CAN bitrate and the OBD-II wiring.');
      addLog(`[OBD-II] Mode 03: ${ecus.length} ECU(s), ${dtcs.length} code(s)${dtcs.length ? ': ' + dtcs.join(', ') : ''}`, 'sys');
    } catch (e) {
      setDtcStatus(`Read failed: ${e.message}`);
    } finally {
      setIsScanningDtcs(false);
    }
  };

  const handleClearDtcs = async () => {
    if (isSimulated) {
      setActiveDtcs([]);
      setDtcStatus('Demo codes cleared (simulation): no vehicle was touched.');
      return;
    }
    if (!window.confirm('Send OBD-II mode 04 to clear stored trouble codes and freeze-frame data on this vehicle?')) return;
    setIsScanningDtcs(true);
    try {
      const { confirmed, refused } = await obdRef.current.clearDtcs();
      const hex = (ids) => ids.map(e => '0x' + e.toString(16).toUpperCase()).join(', ');
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

  const filteredMessageList = Object.values(messages).filter(m => {
    if (!m) return false;
    if (!idFilter) return true;
    const hex = (m.id ?? 0).toString(16).toUpperCase();
    return hex.includes(idFilter.toUpperCase());
  });

  return (
    <div className="flex flex-col gap-4 font-mono">
      {isSimulated && (
        <DemoBanner>CAN frames, gauges and trouble codes are generated by the simulation; no adapter or vehicle is involved.</DemoBanner>
      )}
      {/* CAN Header Card */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>AUTOMOTIVE CAN BUS & OBD-II DIAGNOSTIC DECK</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Sniff vehicle Controller Area Network buses (CANable / Candlelight / SLCAN) with real-time byte change diffing, transmit custom frames, and scan OBD-II trouble codes.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setMode('sniffer')}
                className={`px-3 py-1 rounded font-bold transition-all ${
                  mode === 'sniffer' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                CAN Bus Sniffer
              </button>
              <button
                onClick={() => setMode('obd2')}
                className={`px-3 py-1 rounded font-bold transition-all ${
                  mode === 'obd2' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                OBD-II Scanner & Gauges
              </button>
            </div>

            <button
              onClick={() => {
                // Switching modes never carries simulated frames or codes over to hardware (or back).
                const next = !isSimulated;
                setIsSimulated(next);
                setIsSniffing(next);
                setMessages({});
                setActiveDtcs([]);
                setDtcStatus(null);
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold transition-all ${
                isSimulated 
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-amber-glow' 
                  : 'bg-slate-900 text-slate-400 hover:text-cyan-300 border-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isSimulated ? 'SIMULATION ACTIVE' : 'TEST SIMULATION'}</span>
            </button>
          </div>
        </div>

        {/* Sniffer Toolbar */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {/* Baud rate */}
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-bold text-[11px]">CAN BAUD:</span>
              <select
                value={canBaud}
                onChange={(e) => setCanBaud(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-emerald-400 font-bold outline-none"
              >
                {CAN_BAUD_RATES.map(b => (
                  <option key={b.code} value={b.code}>{b.label}</option>
                ))}
              </select>
            </div>

            {/* Start / Stop */}
            {!isSniffing ? (
              <button
                onClick={startSniffing}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 text-xs font-bold transition-all"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>START SNIFFER</span>
              </button>
            ) : (
              <button
                onClick={stopSniffing}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>PAUSE</span>
              </button>
            )}

            <button
              onClick={handleClearMessages}
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 border border-slate-800"
              title="Clear captured packets"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Filter input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Filter CAN ID (e.g. 1DC)..."
              value={idFilter}
              onChange={(e) => setIdFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2.5 py-1 text-xs text-slate-200 outline-none w-44"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2" />
          </div>
        </div>
      </div>

      {/* MODE 1: CAN Sniffer Table */}
      {mode === 'sniffer' && (
        <div className="space-y-3">
          {/* Packet Table */}
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
                        {isSniffing ? 'Listening on CAN bus... Waiting for frames.' : 'Click "START SNIFFER" or "TEST SIMULATION" to capture packets.'}
                      </td>
                    </tr>
                  ) : (
                    filteredMessageList.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-900/40">
                        <td className="py-2 px-3 font-bold text-amber-300">
                          0x{(m.id ?? 0).toString(16).toUpperCase().padStart(m.isExtended ? 8 : 3, '0')}
                        </td>
                        <td className="py-2 px-3 text-[10px] text-slate-400">
                          {m.isExtended ? 'EXT (29b)' : 'STD (11b)'}
                        </td>
                        <td className="py-2 px-3 text-slate-300 font-bold">{m.dlc}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1.5 font-bold">
                            {Array.from(m.data || []).map((b, idx) => {
                              const isDiff = m.diffs?.has?.(idx);
                              return (
                                <span
                                  key={idx}
                                  className={`px-1.5 py-0.5 rounded transition-colors ${
                                    isDiff 
                                      ? 'bg-amber-400 text-slate-950 font-extrabold shadow-[0_0_8px_rgba(251,191,36,0.6)]' 
                                      : 'bg-slate-950 text-cyan-300 border border-slate-850'
                                  }`}
                                >
                                  {(b ?? 0).toString(16).padStart(2, '0').toUpperCase()}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-slate-400 text-[10px]">
                          {m.deltaMs} ms
                        </td>
                        <td className="py-2 px-3 text-right text-emerald-400 font-bold">
                          {m.count}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Frame Transmitter Bar */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 shadow-xl text-xs">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-cyan-400" />
              <span>TRANSMIT CAN FRAME:</span>
            </span>

            <div className="flex flex-wrap items-center gap-2 flex-1 justify-end">
              <input
                type="text"
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                placeholder="0x123"
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-amber-300 font-bold outline-none w-24 uppercase"
              />
              <input
                type="text"
                value={txData}
                onChange={(e) => setTxData(e.target.value)}
                placeholder="11 22 33 44 55 66 77 88"
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-cyan-300 font-bold outline-none w-64 uppercase"
              />
              <button
                onClick={handleTransmitFrame}
                className="px-3 py-1 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/50 font-bold text-xs"
              >
                SEND FRAME
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: OBD-II Vehicle Scanner & Gauges */}
      {mode === 'obd2' && (
        <div className="space-y-4">
          {/* Virtual Instruments Cluster */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { name: 'ENGINE RPM', val: Math.round(obdValues.rpm), unit: 'RPM', color: 'text-amber-300' },
              { name: 'SPEED', val: obdValues.speed, unit: 'km/h', color: 'text-cyan-300' },
              { name: 'COOLANT', val: obdValues.temp, unit: '°C', color: 'text-emerald-400' },
              { name: 'ENGINE LOAD', val: `${obdValues.load}%`, unit: 'Load', color: 'text-purple-400' },
              { name: 'THROTTLE', val: `${obdValues.throttle}%`, unit: 'TPS', color: 'text-amber-400' },
              { name: 'VOLTAGE', val: `${obdValues.voltage}V`, unit: 'Battery', color: 'text-cyan-400' }
            ].map(gauge => (
              <div key={gauge.name} className="bg-slate-950 p-3 rounded-xl border border-slate-800 text-center flex flex-col justify-between">
                <span className="text-[10px] text-slate-500 font-bold">{gauge.name}</span>
                <div className={`text-xl font-extrabold my-1 ${gauge.color}`}>{gauge.val}</div>
                <span className="text-[10px] text-slate-500">{gauge.unit}</span>
              </div>
            ))}
          </div>

          {/* Diagnostic Trouble Codes (DTCs) */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-rose-500" />
                <span>DIAGNOSTIC TROUBLE CODES (DTCs / CHECK ENGINE LIGHT)</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleScanDtcs}
                  disabled={isScanningDtcs}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-bold"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanningDtcs ? 'animate-spin' : ''}`} />
                  <span>READ CODES (03)</span>
                </button>
                {activeDtcs.length > 0 && (
                  <button
                    onClick={handleClearDtcs}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 text-xs font-bold"
                  >
                    <span>CLEAR CODES (04)</span>
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {dtcStatus && <div className="text-[11px] text-slate-400">{dtcStatus}</div>}
              {activeDtcs.length === 0 ? (
                <div className="py-6 text-center text-slate-500 flex flex-col items-center gap-1.5">
                  {dtcStatus === null ? (
                    <span>Not scanned yet. Press READ CODES to query the vehicle.</span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                      <span>No stored trouble codes reported.</span>
                    </>
                  )}
                </div>
              ) : (
                activeDtcs.map(code => (
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
    </div>
  );
}
