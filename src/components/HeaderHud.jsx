import React, { useState } from 'react';
import { 
  Usb, 
  Unplug, 
  Sliders, 
  Activity, 
  Zap, 
  Terminal, 
  CheckCircle2, 
  AlertTriangle, 
  Cpu, 
  RefreshCw,
  Trash2
} from 'lucide-react';

export default function HeaderHud({
  isConnected,
  isConnecting,
  portInfo,
  baudRate,
  onBaudRateChange,
  serialConfig,
  onSerialConfigChange,
  onConnect,
  onDisconnect,
  hardwareSignals, // { dtr, rts, cts, dsr, dcd, ri }
  onToggleSignal,
  onAssertBreak,
  stats, // { rxBytes, txBytes, rxCount, txCount }
  onResetStats,
  rxActivity,
  txActivity,
  hasWebSerialSupport
}) {
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [customBaud, setCustomBaud] = useState('');
  const [isAssertingBreak, setIsAssertingBreak] = useState(false);

  const standardBauds = [
    300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 
    230400, 460800, 921600, 1000000, 1500000, 2000000
  ];

  const handleBreak = async () => {
    setIsAssertingBreak(true);
    await onAssertBreak(250);
    setTimeout(() => setIsAssertingBreak(false), 300);
  };

  const formatByteSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <header className="border-b border-cyber-border bg-[#070c18]/90 backdrop-blur-md sticky top-0 z-40 px-4 py-2.5 shadow-lg">
      <div className="max-w-[1920px] mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Brand & System Title */}
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-lg bg-cyber-card border border-amber-500/40 shadow-amber-glow">
            <Cpu className="w-5 h-5 text-cyber-amber animate-pulse" />
            <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-cyber-emerald rounded-full border border-slate-900 animate-ping"></div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold font-display tracking-widest text-slate-100 flex items-center gap-1.5">
                SKON'S <span className="text-cyber-amber cyber-glow-amber">WEB FLASHER</span>
              </h1>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800 text-cyber-cyan border border-cyber-cyan/30">
                PRO v1.0
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono tracking-tight flex items-center gap-2">
              <span>HARDWARE RE & SERIAL WORKBENCH</span>
              <span className="text-slate-600">|</span>
              <span className="text-emerald-400/80">W3C WEB SERIAL</span>
            </p>
          </div>
        </div>

        {/* Global Warning if Web Serial is unsupported */}
        {!hasWebSerialSupport && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-950/80 border border-rose-500/50 text-rose-300 text-xs font-mono animate-pulse">
            <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>Web Serial API not detected. Please run on Google Chrome, Microsoft Edge, or Chromium.</span>
          </div>
        )}

        {/* Center HUD: Hardware Pin Status & Control */}
        <div className="flex items-center gap-2 bg-cyber-card px-3 py-1.5 rounded-lg border border-slate-800 shadow-inner">
          <div className="text-[10px] text-slate-400 uppercase tracking-widest font-bold pr-1 border-r border-slate-800">
            BUS LINES
          </div>

          {/* DTR Output */}
          <button
            onClick={() => onToggleSignal('dtr')}
            disabled={!isConnected}
            title="Data Terminal Ready (DTR) - Click to toggle line"
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono transition-all border ${
              hardwareSignals.dtr 
                ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50 shadow-amber-glow' 
                : 'bg-slate-900/60 text-slate-500 border-slate-800 hover:text-slate-400'
            } ${!isConnected && 'opacity-50 cursor-not-allowed'}`}
          >
            <span className={`w-2 h-2 rounded-full ${hardwareSignals.dtr ? 'bg-cyber-amber shadow-amber-glow' : 'bg-slate-700'}`}></span>
            DTR
          </button>

          {/* RTS Output */}
          <button
            onClick={() => onToggleSignal('rts')}
            disabled={!isConnected}
            title="Request To Send (RTS) - Click to toggle line"
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono transition-all border ${
              hardwareSignals.rts 
                ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50 shadow-amber-glow' 
                : 'bg-slate-900/60 text-slate-500 border-slate-800 hover:text-slate-400'
            } ${!isConnected && 'opacity-50 cursor-not-allowed'}`}
          >
            <span className={`w-2 h-2 rounded-full ${hardwareSignals.rts ? 'bg-cyber-amber shadow-amber-glow' : 'bg-slate-700'}`}></span>
            RTS
          </button>

          {/* 250ms Break Trigger */}
          <button
            onClick={handleBreak}
            disabled={!isConnected || isAssertingBreak}
            title="Assert 250ms UART Break signal"
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono transition-all border ${
              isAssertingBreak
                ? 'bg-rose-500/30 text-rose-300 border-rose-500 shadow-rose-glow animate-pulse'
                : 'bg-slate-900/80 text-rose-400 border-rose-900/50 hover:bg-rose-950/40 hover:border-rose-600'
            } ${!isConnected && 'opacity-50 cursor-not-allowed'}`}
          >
            <Zap className="w-3 h-3 text-rose-400" />
            <span>BREAK</span>
          </button>

          <div className="h-4 w-[1px] bg-slate-800 mx-1"></div>

          {/* Polled Hardware Inputs: CTS, DSR, DCD, RI */}
          <div className="flex items-center gap-2">
            {/* CTS */}
            <div 
              title="Clear To Send (CTS) - Hardware flow input"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                hardwareSignals.cts ? 'bg-emerald-950/40 text-cyber-emerald border-emerald-500/40' : 'bg-slate-900/40 text-slate-600 border-slate-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${hardwareSignals.cts ? 'bg-cyber-emerald shadow-emerald-glow' : 'bg-slate-700'}`}></span>
              CTS
            </div>

            {/* DSR */}
            <div 
              title="Data Set Ready (DSR) - Modem/DCE status input"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                hardwareSignals.dsr ? 'bg-cyan-950/40 text-cyber-cyan border-cyan-500/40' : 'bg-slate-900/40 text-slate-600 border-slate-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${hardwareSignals.dsr ? 'bg-cyber-cyan shadow-cyan-glow' : 'bg-slate-700'}`}></span>
              DSR
            </div>

            {/* DCD */}
            <div 
              title="Data Carrier Detect (DCD) - Carrier status input"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                hardwareSignals.dcd ? 'bg-amber-950/40 text-cyber-amber border-amber-500/40' : 'bg-slate-900/40 text-slate-600 border-slate-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${hardwareSignals.dcd ? 'bg-cyber-amber shadow-amber-glow' : 'bg-slate-700'}`}></span>
              DCD
            </div>

            {/* RI */}
            <div 
              title="Ring Indicator (RI) - Incoming call/ring signal"
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono border ${
                hardwareSignals.ri ? 'bg-violet-950/40 text-cyber-violet border-violet-500/40' : 'bg-slate-900/40 text-slate-600 border-slate-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${hardwareSignals.ri ? 'bg-cyber-violet' : 'bg-slate-700'}`}></span>
              RI
            </div>
          </div>
        </div>

        {/* Telemetry Stats: Rx / Tx byte meters */}
        <div className="hidden lg:flex items-center gap-3 bg-cyber-card px-3 py-1.5 rounded-lg border border-slate-800 text-xs font-mono">
          {/* Rx Activity */}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full transition-all duration-75 ${
              rxActivity ? 'bg-cyber-cyan shadow-cyan-glow scale-125' : 'bg-slate-700'
            }`}></span>
            <span className="text-slate-400">Rx:</span>
            <span className="text-cyber-cyan font-semibold">{formatByteSize(stats.rxBytes)}</span>
          </div>

          <span className="text-slate-700">|</span>

          {/* Tx Activity */}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full transition-all duration-75 ${
              txActivity ? 'bg-cyber-amber shadow-amber-glow scale-125' : 'bg-slate-700'
            }`}></span>
            <span className="text-slate-400">Tx:</span>
            <span className="text-cyber-amber font-semibold">{formatByteSize(stats.txBytes)}</span>
          </div>

          <button
            onClick={onResetStats}
            title="Reset Byte Counters"
            className="text-slate-600 hover:text-slate-300 ml-1 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right HUD: Baud Rate, Serial Config & Connection Control */}
        <div className="flex items-center gap-2">
          {/* Baud Rate Picker */}
          <div className="flex items-center bg-cyber-card rounded-lg border border-slate-800 p-0.5">
            <select
              value={baudRate}
              onChange={(e) => onBaudRateChange(Number(e.target.value))}
              disabled={isConnected}
              className="bg-transparent text-xs font-mono text-cyber-amber font-bold px-2 py-1.5 outline-none cursor-pointer disabled:opacity-60"
            >
              {standardBauds.map((rate) => (
                <option key={rate} value={rate} className="bg-slate-900 text-slate-200">
                  {rate} bps {rate === 115200 ? '(Default)' : rate === 74880 ? '(ESP Rom)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* UART Config Drawer Trigger */}
          <button
            onClick={() => setShowConfigModal(!showConfigModal)}
            title="Configure Data bits, Stop bits, Parity & Flow control"
            className="flex items-center gap-1 bg-cyber-card hover:bg-slate-800 text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs font-mono transition-all"
          >
            <Sliders className="w-3.5 h-3.5 text-cyber-cyan" />
            <span className="hidden sm:inline">
              {serialConfig.dataBits}{serialConfig.parity[0].toUpperCase()}{serialConfig.stopBits}
            </span>
          </button>

          {/* Connect / Disconnect Action Button */}
          {!isConnected ? (
            <button
              onClick={onConnect}
              disabled={isConnecting || !hasWebSerialSupport}
              className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 px-4 py-1.5 rounded-lg font-mono font-bold text-xs tracking-wider uppercase transition-all shadow-amber-glow disabled:opacity-50"
            >
              <Usb className={`w-4 h-4 ${isConnecting ? 'animate-spin' : ''}`} />
              <span>{isConnecting ? 'OPENING...' : 'CONNECT PORT'}</span>
            </button>
          ) : (
            <button
              onClick={onDisconnect}
              className="flex items-center gap-2 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 hover:border-rose-400 px-3.5 py-1.5 rounded-lg font-mono font-bold text-xs tracking-wider uppercase transition-all shadow-rose-glow"
            >
              <Unplug className="w-4 h-4 text-rose-400" />
              <span>DISCONNECT</span>
            </button>
          )}
        </div>
      </div>

      {/* Advanced UART Framing & Flow Control Modal / Popover */}
      {showConfigModal && (
        <div className="absolute right-4 top-14 w-80 bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
            <h3 className="text-xs font-bold font-mono tracking-wider text-slate-200 flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5 text-cyber-amber" />
              UART SERIAL FRAMING
            </h3>
            <button 
              onClick={() => setShowConfigModal(false)}
              className="text-slate-500 hover:text-slate-300 text-sm font-mono"
            >
              &times;
            </button>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-slate-400 block mb-1">Data Bits</label>
              <div className="grid grid-cols-2 gap-2">
                {[8, 7].map(bits => (
                  <button
                    key={bits}
                    onClick={() => onSerialConfigChange({ ...serialConfig, dataBits: bits })}
                    disabled={isConnected}
                    className={`py-1 rounded border text-center ${
                      serialConfig.dataBits === bits 
                        ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {bits} Bits
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Stop Bits</label>
              <div className="grid grid-cols-2 gap-2">
                {[1, 2].map(stops => (
                  <button
                    key={stops}
                    onClick={() => onSerialConfigChange({ ...serialConfig, stopBits: stops })}
                    disabled={isConnected}
                    className={`py-1 rounded border text-center ${
                      serialConfig.stopBits === stops 
                        ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {stops} Stop Bit{stops > 1 ? 's' : ''}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Parity</label>
              <div className="grid grid-cols-3 gap-2">
                {['none', 'even', 'odd'].map(p => (
                  <button
                    key={p}
                    onClick={() => onSerialConfigChange({ ...serialConfig, parity: p })}
                    disabled={isConnected}
                    className={`py-1 rounded border text-center capitalize ${
                      serialConfig.parity === p 
                        ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-slate-400 block mb-1">Flow Control</label>
              <div className="grid grid-cols-2 gap-2">
                {['none', 'hardware'].map(fc => (
                  <button
                    key={fc}
                    onClick={() => onSerialConfigChange({ ...serialConfig, flowControl: fc })}
                    disabled={isConnected}
                    className={`py-1 rounded border text-center capitalize ${
                      serialConfig.flowControl === fc 
                        ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50' 
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {fc}
                  </button>
                ))}
              </div>
            </div>

            {isConnected && (
              <p className="text-[10px] text-amber-400/80 italic pt-1 border-t border-slate-800">
                * Disconnect port before changing framing parameters.
              </p>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
