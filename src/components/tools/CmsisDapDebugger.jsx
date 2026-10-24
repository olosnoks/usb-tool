import React, { useState, useEffect } from 'react';
import { 
  Cpu, 
  Play, 
  Pause, 
  RotateCcw, 
  CornerDownRight, 
  Layers, 
  Search, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Edit3,
  RefreshCw,
  Sliders
} from 'lucide-react';
import { 
  CmsisDapClient, 
  CORTEX_REG_NAMES 
} from '../../utils/cmsisDapDriver';
import StatusBadge from '../common/StatusBadge';

export default function CmsisDapDebugger() {
  const [client] = useState(() => new CmsisDapClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [targetState, setTargetState] = useState('disconnected'); // 'running' | 'halted'
  const [registers, setRegisters] = useState([]);
  const [prevRegisters, setPrevRegisters] = useState([]);

  // Memory inspection
  const [memAddress, setMemAddress] = useState('0x20000000');
  const [memWords, setMemWords] = useState([]);
  const [writeAddr, setWriteAddr] = useState('0x20000000');
  const [writeVal, setWriteVal] = useState('0x12345678');

  const handleConnectHardware = async () => {
    try {
      await client.connectHid();
      setIsConnected(true);
      setIsSimulated(false);
      setTargetState('running');
      handleReadMemory();
    } catch (err) {
      alert(`Probe connection error: ${err.message}`);
    }
  };

  const handleConnectSimulation = () => {
    client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    setTargetState('running');
    handleReadMemory('0x20000000');
  };

  const handleDisconnect = () => {
    client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setTargetState('disconnected');
    setRegisters([]);
    setMemWords([]);
  };

  const handleHalt = async () => {
    if (!isConnected) return;
    const regs = await client.halt();
    setPrevRegisters(registers);
    setRegisters(regs);
    setTargetState('halted');
    handleReadMemory(memAddress);
  };

  const handleResume = async () => {
    if (!isConnected) return;
    await client.resume();
    setTargetState('running');
  };

  const handleStep = async () => {
    if (!isConnected) return;
    const regs = await client.step();
    setPrevRegisters(registers);
    setRegisters(regs);
    handleReadMemory(memAddress);
  };

  const handleReadMemory = async (addrStr = memAddress) => {
    if (!isConnected) return;
    const cleanAddr = parseInt(addrStr, 16);
    if (isNaN(cleanAddr)) return;
    const words = await client.readMemory(cleanAddr, 16);
    setMemWords(words);
  };

  const handleWriteMemory = async () => {
    if (!isConnected) return;
    const targetA = parseInt(writeAddr, 16);
    const targetV = parseInt(writeVal, 16);
    if (isNaN(targetA) || isNaN(targetV)) {
      alert('Please enter valid hex address and value.');
      return;
    }
    await client.writeMemoryWord(targetA, targetV);
    handleReadMemory(memAddress);
  };

  return (
    <div className="flex flex-col gap-4 font-mono">
      {/* Probe Header Card */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>CMSIS-DAP / ARM CORTEX-M SWD IN-SYSTEM DEBUGGER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Debug running microcontrollers (Pico Probe, micro:bit, ST-Link, STM32, RP2040) over WebHID. Halt the CPU, single-step, inspect registers, and edit SRAM.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <>
                <button
                  onClick={handleConnectHardware}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs shadow-cyan-glow transition-all active:scale-95"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>CONNECT DAP PROBE (WEBHID)</span>
                </button>
                <button
                  onClick={handleConnectSimulation}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>VIRTUAL TARGET DEMO</span>
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

        {/* Target Status Banner */}
        {isConnected && (
          <div className="pt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-3">
              <span className="text-slate-500 font-bold uppercase">TARGET STATE:</span>
              <StatusBadge
                status={targetState === 'halted' ? 'warning' : 'online'}
                value={targetState === 'halted' ? 'CPU HALTED (DEBUG MODE)' : 'CPU RUNNING'}
                size="md"
                pulse={targetState === 'running'}
              />
              <span className="text-[10px] text-slate-400 hidden sm:inline">
                {isSimulated ? 'ARM Cortex-M4 (STM32F401)' : 'Physical Hardware Probe Active'}
              </span>
            </div>

            {/* Execution Controls */}
            <div className="flex items-center gap-1.5">
              {targetState === 'running' ? (
                <button
                  onClick={handleHalt}
                  className="flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 text-xs font-bold transition-all shadow-amber-glow"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>HALT CPU</span>
                </button>
              ) : (
                <>
                  <button
                    onClick={handleResume}
                    className="flex items-center gap-1 px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 text-xs font-bold transition-all shadow-emerald-glow"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>RESUME / RUN</span>
                  </button>

                  <button
                    onClick={handleStep}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all"
                  >
                    <CornerDownRight className="w-3.5 h-3.5" />
                    <span>STEP (1 INSTRUCTION)</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Debugger Grid */}
      {isConnected && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: ARM Core Registers Table */}
          <div className="lg:col-span-5 bg-[#030712] border border-cyber-border rounded-xl p-3.5 shadow-xl flex flex-col gap-2.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>ARM CORE REGISTERS</span>
              </span>
              <span className="text-[10px] text-slate-500 font-bold">ARMv7-M Thumb</span>
            </div>

            <div className="grid grid-cols-2 gap-1.5 text-xs">
              {CORTEX_REG_NAMES.map((name, idx) => {
                const val = registers[idx] !== undefined ? registers[idx] : 0;
                const prev = prevRegisters[idx];
                const changed = prev !== undefined && prev !== val;

                return (
                  <div
                    key={name}
                    className={`p-2 rounded-lg border flex items-center justify-between font-mono ${
                      changed 
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-300' 
                        : 'bg-slate-950 border-slate-850 text-slate-300'
                    }`}
                  >
                    <span className="text-[10px] text-slate-500 font-bold">{name}:</span>
                    <span className={`font-bold ${name.startsWith('PC') ? 'text-cyan-400' : name.startsWith('SP') ? 'text-purple-400' : ''}`}>
                      0x{(val >>> 0).toString(16).padStart(8, '0').toUpperCase()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: SRAM Memory & Peripheral Inspector */}
          <div className="lg:col-span-7 bg-[#030712] border border-cyber-border rounded-xl p-3.5 shadow-xl flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
              <span className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>MEMORY & PERIPHERAL INSPECTOR</span>
              </span>

              {/* Memory Address Input */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-500 font-bold">ADDR:</span>
                <input
                  type="text"
                  value={memAddress}
                  onChange={(e) => setMemAddress(e.target.value)}
                  placeholder="0x20000000"
                  className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-xs text-cyan-300 font-bold outline-none uppercase w-28"
                />
                <button
                  onClick={() => handleReadMemory(memAddress)}
                  className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Memory Table */}
            <div className="border border-slate-850 rounded-lg overflow-hidden text-[11px]">
              <table className="w-full text-left font-mono">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-bold">
                  <tr>
                    <th className="py-1 px-2.5">Address</th>
                    <th className="py-1 px-2.5">32-Bit Hex</th>
                    <th className="py-1 px-2.5">Decimal</th>
                    <th className="py-1 px-2.5 text-right">ASCII</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900 bg-slate-950/60">
                  {memWords.map((item) => {
                    const bytes = [
                      item.value & 0xFF,
                      (item.value >> 8) & 0xFF,
                      (item.value >> 16) & 0xFF,
                      (item.value >> 24) & 0xFF
                    ];
                    const ascii = bytes.map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '·')).join('');

                    return (
                      <tr key={item.address} className="hover:bg-slate-900/40">
                        <td className="py-1 px-2.5 text-slate-500">
                          0x{(item.address ?? 0).toString(16).padStart(8, '0').toUpperCase()}
                        </td>
                        <td className="py-1 px-2.5 font-bold text-cyan-300">
                          0x{((item.value ?? 0) >>> 0).toString(16).padStart(8, '0').toUpperCase()}
                        </td>
                        <td className="py-1 px-2.5 text-slate-400">
                          {item.value >>> 0}
                        </td>
                        <td className="py-1 px-2.5 text-right text-purple-300 tracking-wider">
                          {ascii}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Memory Write Bar */}
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Edit3 className="w-3.5 h-3.5 text-amber-400" />
                <span>WRITE 32-BIT VALUE:</span>
              </span>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={writeAddr}
                  onChange={(e) => setWriteAddr(e.target.value)}
                  placeholder="Address (0x20000000)"
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-200 outline-none w-28 uppercase"
                />
                <input
                  type="text"
                  value={writeVal}
                  onChange={(e) => setWriteVal(e.target.value)}
                  placeholder="Value (0xDEADBEEF)"
                  className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-amber-300 font-bold outline-none w-28 uppercase"
                />
                <button
                  onClick={handleWriteMemory}
                  className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 text-xs font-bold transition-all"
                >
                  WRITE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
