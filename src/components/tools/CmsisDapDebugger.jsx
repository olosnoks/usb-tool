import React, { useState, useEffect, useRef } from 'react';
import {
  Cpu,
  Play,
  Pause,
  RotateCcw,
  CornerDownRight,
  Layers,
  Search,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  RefreshCw,
  Sliders,
  Usb,
  ChevronLeft,
  ChevronRight,
  Copy
} from 'lucide-react';
import {
  CmsisDapClient,
  CORTEX_REG_NAMES
} from '../../utils/cmsisDapDriver';
import StatusBadge from '../common/StatusBadge';
import DebugFeaturesPanel from './cmsis/DebugFeaturesPanel';
import FaultPanel from './cmsis/FaultPanel';
import WatchPanel from './cmsis/WatchPanel';
import { formatXpsr, decodeSpecial, formatMemoryRows, memoryDumpText } from '../../utils/cortexRegs';

import { useSessionError } from '../../utils/sessionLog';
export default function CmsisDapDebugger() {
  const [client] = useState(() => new CmsisDapClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [targetState, setTargetState] = useState('disconnected'); // 'running' | 'halted'
  const [registers, setRegisters] = useState([]);
  const [prevRegisters, setPrevRegisters] = useState([]);

  // Memory inspection
  const [memAddress, setMemAddress] = useState('0x20000000');
  const [memWords, setMemWords] = useState([]);
  const [memCount, setMemCount] = useState(16);
  const [memWidth, setMemWidth] = useState(32);
  const [writeAddr, setWriteAddr] = useState('0x20000000');
  const [writeVal, setWriteVal] = useState('0x12345678');

  const [info, setInfo] = useState(null);
  const [underReset, setUnderReset] = useState(false);
  const [symbolInfo, setSymbolInfo] = useState(null); // { name, count } of the loaded ELF
  const elfRef = useRef(null);
  const [error, setError] = useSessionError('CMSIS-DAP');
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);

  // Run one probe action at a time and show failures inline.
  const guard = async (label, fn) => {
    if (busyRef.current) return undefined;
    busyRef.current = true;
    setBusy(label);
    setError('');
    try {
      return await fn();
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy('');
    }
  };

  const readMemoryNow = async (addrStr = memAddress) => {
    const addr = parseInt(String(addrStr).replace(/^0x/i, ''), 16);
    if (Number.isNaN(addr)) throw new Error('Address must be hex, e.g. 0x20000000.');
    setMemWords(await client.readMemory(addr, memCount));
  };

  const handleConnectHardware = (kind) => guard('connect', async () => {
    const i = await client.connectHardware({ kind, underReset });
    setInfo(i);
    setIsConnected(true);
    setTargetState(client.targetState);
    setRegisters([]);
    setPrevRegisters([]);
    if (client.targetState === 'halted') setRegisters(await client.readRegisters());
    try { await readMemoryNow(); } catch (e) { setError(`Connected, but reading ${memAddress} failed: ${e.message}`); }
  });

  const loadSymbols = (bytes, name) => {
    const count = client.loadSymbols(bytes, name);
    setSymbolInfo({ name, count });
    return count;
  };

  const onElfFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const count = loadSymbols(new Uint8Array(await file.arrayBuffer()), file.name);
      if (!count) setError(`${file.name} has no function or object symbols (stripped?). Addresses stay numeric.`);
    } catch (err) {
      setError(`Could not read symbols from ${file.name}: ${err.message}`);
    }
  };

  const handleDisconnect = async () => {
    await client.disconnect();
    setIsConnected(false);
    setTargetState('disconnected');
    setRegisters([]);
    setMemWords([]);
    setInfo(null);
  };

  const showRegs = (regs) => {
    setPrevRegisters(registers);
    setRegisters(regs);
  };

  const handleHalt = () => guard('halt', async () => {
    showRegs(await client.halt());
    setTargetState('halted');
    await readMemoryNow();
  });

  const handleResume = () => guard('resume', async () => {
    await client.resume();
    setTargetState('running');
  });

  const handleStep = () => guard('step', async () => {
    showRegs(await client.step());
    setTargetState('halted');
    await readMemoryNow();
  });

  const handleReset = (halt) => guard('reset', async () => {
    const regs = await client.reset({ halt });
    setTargetState(client.targetState);
    if (regs) showRegs(regs);
  });

  const handleReadMemory = (addrStr = memAddress) => guard('read', () => readMemoryNow(addrStr));

  const stepPage = (dir) => {
    const cur = parseInt(String(memAddress).replace(/^0x/i, ''), 16);
    if (Number.isNaN(cur)) { setError('Address must be hex, e.g. 0x20000000.'); return; }
    const next = `0x${(((cur + dir * memCount * 4) >>> 0)).toString(16).toUpperCase().padStart(8, '0')}`;
    setMemAddress(next);
    handleReadMemory(next);
  };

  const copyDump = async () => {
    try {
      await navigator.clipboard.writeText(memoryDumpText(memWords, memWidth));
    } catch {
      setError('Clipboard is not available in this browser context.');
    }
  };

  const handleWriteMemory = () => guard('write', async () => {
    const targetA = parseInt(writeAddr.replace(/^0x/i, ''), 16);
    const targetV = parseInt(writeVal.replace(/^0x/i, ''), 16);
    if (Number.isNaN(targetA) || Number.isNaN(targetV)) throw new Error('Enter a hex address and value.');
    const back = await client.writeMemoryWord(targetA, targetV);
    if (back !== (targetV >>> 0)) {
      setError(`Wrote 0x${(targetV >>> 0).toString(16).toUpperCase()} but read back 0x${(back >>> 0).toString(16).toUpperCase()}: read-only memory, flash, or a peripheral register.`);
    }
    await readMemoryNow();
  });

  const handleEditRegister = (idx, name) => {
    if (targetState !== 'halted') { setError('Halt the CPU to change registers.'); return; }
    const cur = `0x${((registers[idx] ?? 0) >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
    const entered = window.prompt(`New value for ${name} (hex):`, cur);
    if (entered === null) return;
    guard('write-reg', async () => {
      const v = parseInt(entered.trim().replace(/^0x/i, ''), 16);
      if (Number.isNaN(v)) throw new Error('Enter a hex value.');
      await client.writeRegister(idx, v);
      showRegs(await client.readRegisters());
    });
  };

  // While a real core runs, notice when it halts by itself (breakpoint, fault).
  useEffect(() => {
    if (!isConnected || targetState !== 'running') return undefined;
    const t = setInterval(async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        if ((await client.pollState()) === 'halted') {
          setTargetState('halted');
          showRegs(await client.readRegisters());
        }
      } catch (e) {
        setError(`Lost the target: ${e.message}`);
      } finally {
        busyRef.current = false;
      }
    }, 750);
    return () => clearInterval(t);
  }, [isConnected, targetState]);

  const regCls = 'p-1 rounded border flex items-center justify-between font-mono';
  const tb = 'flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-[11px] font-bold disabled:opacity-40';
  const memRows = formatMemoryRows(memWords, memWidth);
  const xpsr = registers[16] !== undefined ? formatXpsr(registers[16]) : '';
  const special = registers[19] !== undefined ? decodeSpecial(registers[19]) : null;

  return (
    <div className="flex flex-col gap-2 font-mono">
      {error && (
        <div className="flex items-start gap-2 p-2 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-[11px] font-bold">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Toolbar: connect or run control */}
      <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!isConnected ? (
            <>
              <p className="text-[11px] text-slate-400 flex-1 min-w-[12rem]">SWD debugging for Cortex-M through a CMSIS-DAP probe. ST-Link and J-Link are not CMSIS-DAP.</p>
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="flex items-center gap-1 text-[10px] text-slate-400" title="Hold nRESET low while attaching, then halt at the reset vector: reaches chips that sleep or remap their SWD pins">
                  <input type="checkbox" checked={underReset} onChange={(e) => setUnderReset(e.target.checked)} className="accent-cyan-500" />
                  connect under reset
                </label>
                <button
                  onClick={() => handleConnectHardware('usb')}
                  disabled={!!busy}
                  title="CMSIS-DAP v2 (bulk endpoints): Raspberry Pi Debug Probe, recent DAPLink"
                  className="disabled:opacity-40 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-xs shadow-cyan-glow transition-all active:scale-95"
                >
                  <Usb className="w-3.5 h-3.5" />
                  <span>{busy === 'connect' ? 'ATTACHING...' : 'CONNECT PROBE (WEBUSB)'}</span>
                </button>
                <button
                  onClick={() => handleConnectHardware('hid')}
                  disabled={!!busy}
                  title="CMSIS-DAP v1 (HID): older DAPLink firmware, micro:bit v1"
                  className="disabled:opacity-40 flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition-all"
                >
                  <Cpu className="w-3.5 h-3.5" />
                  <span>HID PROBE</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 min-w-0">
                <StatusBadge
                  status={targetState === 'halted' ? 'warning' : 'online'}
                  value={targetState === 'halted' ? 'HALTED' : 'RUNNING'}
                  size="md"
                  pulse={targetState === 'running'}
                />
                <span className="text-[10px] text-slate-400 truncate hidden @sm:inline">
                  {info ? `${info.core} via ${info.probe} (${info.transport})` : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button onClick={() => handleReset(true)} disabled={!!busy} title="System reset (AIRCR.SYSRESETREQ), halted at the first instruction" className={tb}>
                  <RotateCcw className="w-3 h-3" /><span>RESET+HALT</span>
                </button>
                <button onClick={() => handleReset(false)} disabled={!!busy} title="System reset, then run" className={tb}>RESET+RUN</button>
                {targetState === 'running' ? (
                  <button onClick={handleHalt} disabled={!!busy} className="flex items-center gap-1 px-2.5 py-1 rounded border bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/50 text-[11px] font-bold shadow-amber-glow">
                    <Pause className="w-3 h-3 fill-current" /><span>HALT</span>
                  </button>
                ) : (
                  <>
                    <button onClick={handleResume} disabled={!!busy} className="flex items-center gap-1 px-2.5 py-1 rounded border bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/50 text-[11px] font-bold shadow-emerald-glow">
                      <Play className="w-3 h-3 fill-current" /><span>RUN</span>
                    </button>
                    <button onClick={handleStep} disabled={!!busy} title="Execute one instruction" className="flex items-center gap-1 px-2 py-1 rounded border bg-slate-900 hover:bg-slate-800 text-cyan-300 border-cyan-500/40 text-[11px] font-bold">
                      <CornerDownRight className="w-3 h-3" /><span>STEP</span>
                    </button>
                  </>
                )}
                <input ref={elfRef} type="file" accept=".elf,.axf,.out" className="hidden" onChange={onElfFile} />
                <button
                  onClick={() => elfRef.current?.click()}
                  title="Load function and variable names from an ELF so addresses show as main+0x12"
                  className="px-2 py-1 rounded border bg-slate-900 hover:bg-slate-800 text-cyan-300 border-cyan-500/40 text-[11px] font-bold max-w-[14rem] truncate"
                >
                  {symbolInfo ? `ELF: ${symbolInfo.name} (${symbolInfo.count})` : 'LOAD ELF'}
                </button>
                <button onClick={handleDisconnect} className="px-2 py-1 rounded border bg-rose-500/20 text-rose-300 border-rose-500/40 text-[11px] font-bold">DISCONNECT</button>
              </div>
            </>
          )}
        </div>
        {!isConnected && (
          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer text-slate-500 hover:text-slate-300">Supported probes and features</summary>
            <p className="mt-1">
              Raspberry Pi Debug Probe, DAPLink / micro:bit, LPC-Link2 and EDBG. Halt, step, reset, edit registers and memory, decode fault registers, watch list, RTT console, SWO trace, hardware breakpoints, memory dumps and flash programming with CMSIS-Pack algorithms.
            </p>
          </details>
        )}
      </div>

      {isConnected && (
        <div className="grid grid-cols-1 @lg:grid-cols-12 gap-2">
          {/* Registers */}
          <div className="@lg:col-span-5 bg-[#030712] border border-cyber-border rounded-lg p-2 flex flex-col gap-1.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-1">
              <span className="font-bold text-[11px] text-slate-200 flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                <span>CORE REGISTERS</span>
              </span>
              <span className="text-[10px] text-slate-500">{targetState === 'halted' ? 'click to edit' : 'halt to read'}</span>
            </div>

            <div className="grid grid-cols-2 gap-1 text-[11px]">
              {CORTEX_REG_NAMES.map((name, idx) => {
                const val = registers[idx] !== undefined ? registers[idx] : 0;
                const prev = prevRegisters[idx];
                const changed = prev !== undefined && prev !== val;

                return (
                  <div
                    key={name}
                    onClick={() => handleEditRegister(idx, name)}
                    className={`${regCls} ${targetState === 'halted' ? 'cursor-pointer hover:border-cyan-500/60' : ''} ${
                      changed
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-300'
                        : 'bg-slate-950 border-slate-850 text-slate-300'
                    }`}
                  >
                    <span className="text-[10px] text-slate-500 font-bold">{name}:</span>
                    <span className={`font-bold ${name.startsWith('PC') ? 'text-cyan-400' : name.startsWith('SP') ? 'text-purple-400' : ''}`}>
                      0x{(val >>> 0).toString(16).padStart(8, '0').toUpperCase()}
                      {(name.startsWith('PC') || name.startsWith('LR')) && client.symbolFor(val) && (
                        <span className="block text-[10px] text-emerald-300 text-right">{client.symbolFor(val)}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            {xpsr && (
              <div className="text-[10px] text-slate-400 space-y-0.5" data-testid="reg-decode">
                <p>xPSR: <span className="text-cyan-300 font-bold">{xpsr}</span></p>
                {special && (
                  <p>
                    PRIMASK={special.primask} BASEPRI=0x{special.basepri.toString(16)} FAULTMASK={special.faultmask} CONTROL=0x{special.control.toString(16)} ({special.privileged ? 'privileged' : 'unprivileged'}, {special.stack})
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Memory */}
          <div className="@lg:col-span-7 bg-[#030712] border border-cyber-border rounded-lg p-2 flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-slate-800 pb-1">
              <span className="font-bold text-[11px] text-slate-200 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>MEMORY</span>
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <input
                  type="text"
                  value={memAddress}
                  onChange={(e) => setMemAddress(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleReadMemory(memAddress); }}
                  placeholder="0x20000000"
                  aria-label="Memory address"
                  className="bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[11px] text-cyan-300 font-bold outline-none focus:border-cyan-500/60 uppercase w-24"
                />
                <select value={memCount} onChange={(e) => setMemCount(Number(e.target.value))} aria-label="Words to read" title="Words to read" className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[11px] text-slate-300 outline-none">
                  {[16, 32, 64, 128].map((n) => <option key={n} value={n}>{n} w</option>)}
                </select>
                <select value={memWidth} onChange={(e) => setMemWidth(Number(e.target.value))} aria-label="Cell width" title="Display as bytes, halfwords or words" className="bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-[11px] text-slate-300 outline-none">
                  <option value={8}>8-bit</option>
                  <option value={16}>16-bit</option>
                  <option value={32}>32-bit</option>
                </select>
                <button onClick={() => stepPage(-1)} disabled={!!busy} aria-label="Previous page" title="Previous page" className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 disabled:opacity-40"><ChevronLeft className="w-3 h-3" /></button>
                <button onClick={() => handleReadMemory(memAddress)} disabled={!!busy} aria-label="Read memory" title="Read memory" className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 disabled:opacity-40"><RefreshCw className="w-3 h-3" /></button>
                <button onClick={() => stepPage(1)} disabled={!!busy} aria-label="Next page" title="Next page" className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 disabled:opacity-40"><ChevronRight className="w-3 h-3" /></button>
                <button onClick={copyDump} disabled={!memWords.length} aria-label="Copy hex dump" title="Copy as a text hex dump" className="p-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800 disabled:opacity-40"><Copy className="w-3 h-3" /></button>
              </div>
            </div>

            <div className="border border-slate-850 rounded overflow-auto max-h-64 text-[11px]">
              <table className="w-full text-left font-mono">
                <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-bold sticky top-0">
                  <tr>
                    <th className="py-0.5 px-2">Address</th>
                    <th className="py-0.5 px-2">Hex ({memWidth}-bit)</th>
                    <th className="py-0.5 px-2 text-right">ASCII</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900 bg-slate-950/60">
                  {memRows.map((row) => (
                    <tr key={row.address} className="hover:bg-slate-900/40">
                      <td className="py-0.5 px-2 text-slate-500 whitespace-nowrap">0x{row.address.toString(16).padStart(8, '0').toUpperCase()}</td>
                      <td className="py-0.5 px-2 font-bold text-cyan-300 whitespace-nowrap">{row.cells.join(' ')}</td>
                      <td className="py-0.5 px-2 text-right text-purple-300 tracking-wider">{row.ascii}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-1 text-xs">
              <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                <Edit3 className="w-3 h-3 text-amber-400" /> WRITE WORD
              </span>
              <input
                type="text"
                value={writeAddr}
                onChange={(e) => setWriteAddr(e.target.value)}
                placeholder="Address"
                aria-label="Write address"
                className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[11px] text-slate-200 outline-none focus:border-cyan-500/60 w-24 uppercase"
              />
              <input
                type="text"
                value={writeVal}
                onChange={(e) => setWriteVal(e.target.value)}
                placeholder="Value"
                aria-label="Write value"
                className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[11px] text-amber-300 font-bold outline-none focus:border-cyan-500/60 w-24 uppercase"
              />
              <button
                onClick={handleWriteMemory}
                disabled={!!busy}
                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/50 text-[11px] font-bold disabled:opacity-40"
              >
                WRITE
              </button>
            </div>
          </div>
        </div>
      )}

      {isConnected && (
        <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2">
          <FaultPanel client={client} guard={guard} busy={busy} targetState={targetState} registers={registers} />
          <WatchPanel client={client} guard={guard} busyRef={busyRef} busy={busy} setError={setError} />
        </div>
      )}

      {isConnected && (
        <DebugFeaturesPanel
          client={client}
          guard={guard}
          busyRef={busyRef}
          targetState={targetState}
          setTargetState={setTargetState}
          setError={setError}
          onSymbols={loadSymbols}
        />
      )}
    </div>
  );
}
