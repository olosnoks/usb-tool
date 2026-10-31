import React, { useState, useEffect, useRef } from 'react';
import { useSerial } from '../context/SerialContext';
import { 
  ArrowLeftRight, 
  Play, 
  Pause, 
  Trash2, 
  Download, 
  Search, 
  Radio, 
  CheckCircle2, 
  Clock, 
  Share2, 
  Sliders,
  Cpu
} from 'lucide-react';

export default function SerialBridgeDeck({
  boards = [],
  bridgeConfig: parentBridgeConfig,
  onToggleBridge: parentToggleBridge,
  bridgeLog: parentBridgeLog,
  onClearBridgeLog: parentClearBridgeLog,
  onSendRawBytes,
  onLogMessage
}) {
  const [internalBoardAId, setInternalBoardAId] = useState(boards[0]?.id || '');
  const [internalBoardBId, setInternalBoardBId] = useState(boards[1]?.id || '');
  const [internalBridgeActive, setInternalBridgeActive] = useState(false);
  const [internalBridgeLog, setInternalBridgeLog] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const boardAId = parentBridgeConfig ? parentBridgeConfig.boardAId : internalBoardAId;
  const boardBId = parentBridgeConfig ? parentBridgeConfig.boardBId : internalBoardBId;
  const isBridgeActive = parentBridgeConfig ? parentBridgeConfig.active : internalBridgeActive;
  const bridgeLog = parentBridgeLog || internalBridgeLog;

  const setBoardAId = (id) => {
    if (parentToggleBridge) {
      parentToggleBridge(id, boardBId, false);
    } else {
      setInternalBoardAId(id);
    }
  };

  const setBoardBId = (id) => {
    if (parentToggleBridge) {
      parentToggleBridge(boardAId, id, false);
    } else {
      setInternalBoardBId(id);
    }
  };

  const logContainerRef = useRef(null);

  // The relay: while active, every chunk received on one board is written to
  // the other and logged with its direction. (Used when no parent drives the
  // bridge; nothing else in the app forwards bytes between ports.)
  const { subscribeRx, sendRawToBoard } = useSerial();
  const sendToRef = useRef(sendRawToBoard);
  sendToRef.current = sendRawToBoard;
  const lastTsRef = useRef(0);
  useEffect(() => {
    if (parentBridgeConfig || !internalBridgeActive || !subscribeRx || !boardAId || !boardBId) return undefined;
    const dec = new TextDecoder();
    return subscribeRx((bytes, fromId) => {
      let dir, toId;
      if (fromId === boardAId) { dir = 'A->B'; toId = boardBId; }
      else if (fromId === boardBId) { dir = 'B->A'; toId = boardAId; }
      else return;
      sendToRef.current(toId, bytes).catch((e) => onLogMessage?.(`[BRIDGE] write to ${toId} failed: ${e.message}`, 'sys'));
      const now = Date.now();
      const deltaMs = lastTsRef.current ? now - lastTsRef.current : 0;
      lastTsRef.current = now;
      const entry = {
        id: `${now}-${Math.round(performance.now() * 1000)}`,
        time: new Date(now).toTimeString().split(' ')[0] + '.' + String(now % 1000).padStart(3, '0'),
        dir,
        deltaMs,
        hex: Array.from(bytes).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
        text: dec.decode(bytes).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '.')
      };
      setInternalBridgeLog((prev) => [...prev.slice(-1999), entry]);
    });
  }, [parentBridgeConfig, internalBridgeActive, subscribeRx, boardAId, boardBId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [bridgeLog, autoScroll]);

  const toggleBridge = () => {
    if (!boardAId || !boardBId || boardAId === boardBId) {
      alert('Please select two distinct connected boards to create a MitM serial bridge.');
      return;
    }
    if (parentToggleBridge) {
      parentToggleBridge(boardAId, boardBId, !isBridgeActive);
    } else {
      setInternalBridgeActive(!internalBridgeActive);
    }
  };

  const handleExportJson = () => {
    if (bridgeLog.length === 0) return;
    const jsonStr = JSON.stringify(bridgeLog, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `serial_bridge_capture_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredLogs = searchQuery.trim()
    ? bridgeLog.filter(l => l.text.toLowerCase().includes(searchQuery.toLowerCase()) || l.hex.includes(searchQuery))
    : bridgeLog;

  const boardA = boards.find(b => b.id === boardAId);
  const boardB = boards.find(b => b.id === boardBId);

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <ArrowLeftRight className="w-4 h-4 text-cyber-cyan" />
          <h2 className="font-bold text-slate-100 tracking-wider">MULTI-BOARD MitM SERIAL BRIDGE & PACKET SNIFFER</h2>
        </div>

        {/* Port Selectors & Activation Button */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-[10px] text-cyber-cyan font-bold pl-1">PORT A:</span>
            <select
              value={boardAId}
              onChange={(e) => setBoardAId(e.target.value)}
              disabled={isBridgeActive}
              className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-slate-200 outline-none text-xs"
            >
              {boards.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.baudRate})</option>
              ))}
            </select>

            <span className="text-slate-600 px-1">⟷</span>

            <span className="text-[10px] text-cyber-amber font-bold">PORT B:</span>
            <select
              value={boardBId}
              onChange={(e) => setBoardBId(e.target.value)}
              disabled={isBridgeActive}
              className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-slate-200 outline-none text-xs"
            >
              {boards.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.baudRate})</option>
              ))}
            </select>
          </div>

          <button
            onClick={toggleBridge}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition-all border ${
              isBridgeActive
                ? 'bg-emerald-500/20 text-cyber-emerald border-emerald-500/50 shadow-emerald-glow animate-pulse'
                : 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-cyan-glow hover:brightness-110'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span>{isBridgeActive ? 'BRIDGE ACTIVE (SNIFFING)' : 'START MitM BRIDGE'}</span>
          </button>
        </div>
      </div>

      {/* Control / Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#030712] border border-slate-800 rounded-lg p-2">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
          <input
            type="text"
            placeholder="Search dialogue text or hex..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded pl-7 pr-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500 w-48 sm:w-64"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportJson}
            disabled={bridgeLog.length === 0}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>

          <button
            onClick={() => parentClearBridgeLog ? parentClearBridgeLog() : setInternalBridgeLog([])}
            className="p-1 rounded bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800"
            title="Clear Feed"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Synchronized Sniffer Feed Viewport */}
      <div 
        ref={logContainerRef}
        className="h-64 overflow-y-auto bg-[#030712] border border-slate-800 rounded-xl p-3 flex flex-col gap-1.5"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-1 select-none">
            <Radio className="w-6 h-6 animate-pulse text-slate-700" />
            <span>{isBridgeActive ? 'Awaiting serial traffic between Port A and Port B...' : 'Select two boards and click "START MitM BRIDGE"'}</span>
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div 
              key={entry.id}
              className={`flex items-start gap-2.5 p-1.5 rounded border text-[11px] font-mono ${
                entry.dir === 'A->B' 
                  ? 'bg-cyan-950/20 border-cyan-500/30 text-cyan-200' 
                  : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
              }`}
            >
              <span className="text-[10px] text-slate-500 whitespace-nowrap">
                {entry.time}
              </span>

              <span className={`px-1.5 py-0.2 rounded font-bold text-[9px] uppercase whitespace-nowrap ${
                entry.dir === 'A->B' ? 'bg-cyan-500/20 text-cyber-cyan' : 'bg-amber-500/20 text-cyber-amber'
              }`}>
                {entry.dir === 'A->B' ? `${boardA?.name || 'A'} ➔ ${boardB?.name || 'B'}` : `${boardB?.name || 'B'} ➔ ${boardA?.name || 'A'}`}
              </span>

              {entry.deltaMs > 0 && (
                <span className="text-[9px] text-slate-500">
                  +{entry.deltaMs}ms
                </span>
              )}

              <div className="flex-1 break-all">
                <span className="text-slate-100">{entry.text}</span>
                {entry.hex && (
                  <span className="text-[10px] text-slate-500 block font-mono">
                    HEX: {entry.hex}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
