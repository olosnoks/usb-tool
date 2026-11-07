import React from 'react';
import { Unplug, RefreshCw, Bluetooth } from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import StatusBadge from '../common/StatusBadge';

const STANDARD_BAUDS = [
  300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200,
  230400, 460800, 921600, 1000000, 1500000, 2000000,
];

/**
 * Compact serial connection controls (board selector, baud, RX/TX activity,
 * status, connect / BLE / disconnect). Driven entirely by SerialContext, so it
 * can live anywhere the serial state is relevant — it now sits in the terminal
 * drawer's header bar rather than the app header.
 */
export default function SerialControls() {
  const {
    isConnected, isConnecting, baudRate, setBaudRate, connect, disconnect,
    connectBle, hasWebBluetoothSupport, rxActivity, txActivity,
    boards, activeBoardId, setActiveBoardId,
  } = useSerial();

  return (
    <div className="flex items-center gap-1.5">
      {boards.length > 1 && (
        <select
          value={activeBoardId}
          onChange={(e) => setActiveBoardId(e.target.value)}
          className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-cyan-300 text-[11px] font-bold outline-none cursor-pointer"
          title="Active board"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id} className="bg-slate-900 text-slate-200">{b.name} {b.isConnected ? '●' : '○'}</option>
          ))}
        </select>
      )}

      <div className="flex items-center bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[11px]">
        <span className="text-slate-500 text-[10px] font-bold mr-1 hidden sm:inline">BAUD</span>
        <select
          value={baudRate}
          onChange={(e) => setBaudRate(Number(e.target.value))}
          disabled={isConnected}
          title={isConnected ? 'Disconnect to change baud rate' : 'Select baud rate'}
          className={`bg-transparent outline-none font-bold text-[11px] cursor-pointer ${isConnected ? 'text-amber-400 cursor-not-allowed' : 'text-slate-200 hover:text-cyan-300'}`}
        >
          {STANDARD_BAUDS.map((b) => <option key={b} value={b} className="bg-slate-900 text-slate-200">{b}{b === 115200 ? ' ★' : ''}</option>)}
        </select>
      </div>

      <div className="hidden sm:flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[10px]">
        <span className={`w-1.5 h-1.5 rounded-full ${rxActivity ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-slate-800'}`} />
        <span className={rxActivity ? 'text-cyan-400 font-bold' : 'text-slate-500'}>RX</span>
        <span className="text-slate-700">|</span>
        <span className={`w-1.5 h-1.5 rounded-full ${txActivity ? 'bg-amber-400 shadow-[0_0_8px_#fbbf24]' : 'bg-slate-800'}`} />
        <span className={txActivity ? 'text-amber-400 font-bold' : 'text-slate-500'}>TX</span>
      </div>

      <StatusBadge
        status={isConnected ? 'online' : isConnecting ? 'connecting' : 'offline'}
        value={isConnected ? 'ONLINE' : isConnecting ? 'CONN…' : 'OFFLINE'}
        size="sm"
        pulse={isConnecting}
      />

      {!isConnected && (
        <button
          onClick={connect}
          disabled={isConnecting}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-gradient-to-r from-cyan-500 to-emerald-500 hover:from-cyan-400 hover:to-emerald-400 text-slate-950 font-bold text-[11px] shadow-cyan-glow transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
          <span>{isConnecting ? '…' : 'CONNECT'}</span>
        </button>
      )}
      {!isConnected && hasWebBluetoothSupport && (
        <button
          onClick={() => connectBle()}
          disabled={isConnecting}
          title="Connect a Bluetooth LE serial device"
          className="flex items-center gap-1 px-2 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-sky-300 border border-sky-500/40 text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50"
        >
          <Bluetooth className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">BLE</span>
        </button>
      )}
      {isConnected && (
        <button
          onClick={disconnect}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 hover:border-rose-400 text-[11px] font-bold transition-all active:scale-95"
        >
          <Unplug className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">DISCONNECT</span>
        </button>
      )}
    </div>
  );
}
