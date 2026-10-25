import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  Send, 
  Play, 
  Square, 
  RotateCcw, 
  Layers, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Edit3, 
  Radio, 
  Sliders,
  Check
} from 'lucide-react';
import {
  ModbusClient,
  buildModbusRtuRequest,
  calculateModbusCrc16
} from '../../utils/modbusDriver';
import StatusBadge from '../common/StatusBadge';
import { useSerial } from '../../context/SerialContext';

export default function ModbusWorkbench() {
  const {
    isConnected: portConnected,
    transceive,
    reconfigureActivePort,
    connect: connectPort,
    addLog
  } = useSerial();

  // Route driver TX/RX frame logs into the app's live terminal
  const loggerRef = React.useRef(addLog);
  useEffect(() => { loggerRef.current = addLog; }, [addLog]);

  const [client] = useState(() => new ModbusClient((msg) => loggerRef.current?.(msg, 'sys')));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);

  // Connection settings
  const [slaveId, setSlaveId] = useState(1);
  const [baudRate, setBaudRate] = useState(9600);
  const [isAutoPolling, setIsAutoPolling] = useState(false);
  const [registers, setRegisters] = useState([]);

  // Write register modal
  const [writeAddr, setWriteAddr] = useState('0');
  const [writeValue, setWriteValue] = useState('2300');
  const [writeFeedback, setWriteFeedback] = useState('');

  // Auto polling loop
  useEffect(() => {
    let interval = null;
    if (isConnected && isAutoPolling) {
      interval = setInterval(async () => {
        const regs = await client.readHoldingRegisters(0, 8);
        setRegisters(regs);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, isAutoPolling, client]);

  const handleConnectSimulation = async () => {
    client.connectSimulation(slaveId, baudRate);
    setIsConnected(true);
    setIsSimulated(true);
    const regs = await client.readHoldingRegisters(0, 8);
    setRegisters(regs);
  };

  const handleConnectLive = async () => {
    try {
      // Reopen the already-connected serial port with Modbus RTU framing (8-N-1)
      await reconfigureActivePort({ baudRate, dataBits: 8, stopBits: 1, parity: 'none' });
    } catch (err) {
      addLog?.(`[MODBUS] Could not reconfigure port: ${err.message}`, 'sys');
      return;
    }
    client.connectLive(transceive, slaveId, baudRate);
    setIsConnected(true);
    setIsSimulated(false);
    const regs = await client.readHoldingRegisters(0, 8);
    setRegisters(regs);
  };

  const handleDisconnect = () => {
    client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setIsAutoPolling(false);
    setRegisters([]);
  };

  const handleManualPoll = async () => {
    if (!isConnected) return;
    const regs = await client.readHoldingRegisters(0, 8);
    setRegisters(regs);
  };

  const handleWriteRegister = async () => {
    if (!isConnected) return;
    const addr = parseInt(writeAddr, 10);
    const val = parseInt(writeValue, 10);
    if (isNaN(addr) || isNaN(val)) {
      alert('Invalid address or value');
      return;
    }
    await client.writeSingleRegister(addr, val);
    setWriteFeedback(`Wrote ${val} to 4000${addr + 1} successfully.`);
    setTimeout(() => setWriteFeedback(''), 2500);
    handleManualPoll();
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>INDUSTRIAL MODBUS RTU & RS-485 FIELD DECK</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Poll Coils, Inputs, and Holding Registers from PLCs, solar inverters, and energy meters over USB-RS485 adapters.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <>
                {portConnected ? (
                  <button
                    onClick={handleConnectLive}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 hover:bg-cyan-500/30 text-xs font-bold transition-all"
                    title="Reopen the connected serial port at the selected baud (8-N-1) and poll the real slave"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>CONNECT LIVE (RS-485)</span>
                  </button>
                ) : (
                  <button
                    onClick={connectPort}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-xs font-bold transition-all"
                    title="Open a USB-RS485 adapter first, then connect live"
                  >
                    <Radio className="w-3.5 h-3.5" />
                    <span>CONNECT SERIAL PORT…</span>
                  </button>
                )}
                <button
                  onClick={handleConnectSimulation}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-slate-400 border border-slate-700 hover:bg-slate-800 text-xs font-bold transition-all"
                  title="No hardware required — synthesized inverter data for UI/demo"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>SIMULATION</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
              >
                <span>DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {/* Bus Configuration Bar */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold">SLAVE ID:</span>
              <input
                type="number"
                min="1"
                max="247"
                value={slaveId}
                onChange={(e) => setSlaveId(Number(e.target.value))}
                disabled={isConnected}
                className="w-16 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs font-bold font-mono outline-none"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-slate-500 uppercase font-bold">BAUD RATE:</span>
              <select
                value={baudRate}
                onChange={(e) => setBaudRate(Number(e.target.value))}
                disabled={isConnected}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 text-xs font-bold font-mono outline-none"
              >
                {[4800, 9600, 19200, 38400, 57600, 115200].map(b => (
                  <option key={b} value={b}>{b} bps</option>
                ))}
              </select>
            </div>

            <button
              onClick={handleManualPoll}
              disabled={!isConnected}
              className="flex items-center gap-1 px-3 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-xs font-bold disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3" />
              <span>POLL ONCE</span>
            </button>

            <button
              onClick={() => setIsAutoPolling(!isAutoPolling)}
              disabled={!isConnected}
              className={`flex items-center gap-1 px-3 py-1 rounded border text-xs font-bold transition-all ${
                isAutoPolling 
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-emerald-glow' 
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              } disabled:opacity-40`}
            >
              {isAutoPolling ? <Square className="w-3 h-3 text-rose-400 fill-rose-400" /> : <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />}
              <span>{isAutoPolling ? 'AUTO-POLLING (1s)' : 'START AUTO-POLL'}</span>
            </button>
          </div>

          <span className="text-[10px] text-slate-500">
            Protocol: <strong className="text-amber-400">Modbus RTU (CRC-16 / 8-N-1)</strong>
          </span>
        </div>
      </div>

      {/* Data-source banner — make it unambiguous whether values are real or synthetic */}
      {isConnected && (
        isSimulated ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 text-[11px] font-bold">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>SIMULATION MODE — values are synthesized, not read from hardware. Use CONNECT LIVE with a USB-RS485 adapter for real data.</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold">
            <Radio className="w-3.5 h-3.5 shrink-0" />
            <span>LIVE RS-485 — polling Slave {slaveId} at {baudRate} bps (8-N-1). Frames are CRC-validated; empty rows mean no/invalid response.</span>
          </div>
        )
      )}

      {/* Live Holding Registers Table */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span>HOLDING REGISTERS (FUNCTION CODE 0x03)</span>
          </span>
          <span className="text-[10px] text-slate-500">Registers 40001 - 40008</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-[10px] text-slate-500 border-b border-slate-800">
                <th className="p-2 font-bold">ADDRESS</th>
                <th className="p-2 font-bold">REGISTER</th>
                <th className="p-2 font-bold">MEASUREMENT DESCRIPTION</th>
                <th className="p-2 font-bold text-right">RAW HEX</th>
                <th className="p-2 font-bold text-right">DECIMAL (UINT16)</th>
                <th className="p-2 font-bold text-right">SCALED VALUE</th>
              </tr>
            </thead>
            <tbody>
              {registers.map((r) => {
                let scaled = `${r.rawUint16}`;
                if (r.address === 0) scaled = `${(r.rawUint16 / 10).toFixed(1)} V AC`;
                else if (r.address === 1) scaled = `${(r.rawUint16 / 10).toFixed(1)} A`;
                else if (r.address === 2) scaled = `${r.rawUint16} W`;
                else if (r.address === 3) scaled = `${(r.rawUint16 / 100).toFixed(2)} Hz`;
                else if (r.address === 4) scaled = `${(r.rawUint16 / 100).toFixed(2)}`;
                else if (r.address === 5) scaled = `${(r.rawUint16 / 10).toFixed(1)} °C`;
                else if (r.address === 6) scaled = `${(r.rawUint16 / 100).toFixed(2)} kWh`;
                else if (r.address === 7) scaled = `${r.rawUint16} kWh`;

                return (
                  <tr key={r.address} className="border-b border-slate-900/60 hover:bg-slate-900/30 transition-colors">
                    <td className="p-2 font-mono text-cyan-400 font-bold">{r.address}</td>
                    <td className="p-2 font-mono text-slate-400">{r.registerNumber}</td>
                    <td className="p-2 font-semibold text-slate-200">{r.label}</td>
                    <td className="p-2 font-mono text-amber-300 text-right">{r.hex}</td>
                    <td className="p-2 font-mono text-slate-300 text-right">{r.rawUint16}</td>
                    <td className="p-2 font-mono font-extrabold text-emerald-400 text-right">{scaled}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Write Single Register Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
            <Edit3 className="w-4 h-4 text-amber-400" />
            <span>WRITE SINGLE REGISTER (FUNCTION CODE 0x06)</span>
          </span>
          {writeFeedback && (
            <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1">
              <Check className="w-3 h-3" />
              <span>{writeFeedback}</span>
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 font-bold">Register Offset:</span>
            <input
              type="text"
              placeholder="0 (40001)"
              value={writeAddr}
              onChange={(e) => setWriteAddr(e.target.value)}
              className="w-24 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono text-xs outline-none focus:border-cyan-500"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400 font-bold">Value (Dec/Uint16):</span>
            <input
              type="text"
              placeholder="e.g. 2350"
              value={writeValue}
              onChange={(e) => setWriteValue(e.target.value)}
              className="w-32 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-200 font-mono text-xs outline-none focus:border-cyan-500"
            />
          </div>

          <button
            onClick={handleWriteRegister}
            disabled={!isConnected}
            className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow transition-all disabled:opacity-40"
          >
            WRITE REGISTER
          </button>
        </div>
      </div>
    </div>
  );
}
