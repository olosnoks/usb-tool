import React, { useState, useEffect, useRef } from 'react';
import { useSerial } from '../context/SerialContext';
import {
  ArrowLeftRight,
  Trash2,
  Download,
  Search,
  Radio,
  Plus,
  Plug,
  Pause as PauseIcon,
  FileText
} from 'lucide-react';
import { filterLog, computeStats, logToCsv, logToText } from '../utils/serialBridgeLog';

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
  const [dirFilter, setDirFilter] = useState('both');
  const [viewMode, setViewMode] = useState('both');
  const [frozen, setFrozen] = useState(null);

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

  const { subscribeRx, sendRawToBoard, addNewBoard, connectBoard, updateBoard } = useSerial();

  // Default the selectors as boards appear (e.g. after "+ Add serial port").
  useEffect(() => {
    if (parentBridgeConfig) return;
    const ids = boards.map((b) => b.id);
    if (!ids.includes(internalBoardAId)) setInternalBoardAId(ids[0] || '');
    if (!ids.includes(internalBoardBId) || internalBoardBId === internalBoardAId) {
      setInternalBoardBId(ids.find((id) => id !== (ids.includes(internalBoardAId) ? internalBoardAId : ids[0])) || '');
    }
  }, [boards, parentBridgeConfig, internalBoardAId, internalBoardBId]);

  // The relay: while active, every chunk received on one board is written to
  // the other and logged with its direction. (Used when no parent drives the
  // bridge; nothing else in the app forwards bytes between ports.)
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
        len: bytes.length,
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

  const boardAx = boards.find(b => b.id === boardAId);
  const boardBx = boards.find(b => b.id === boardBId);
  const hasTwoBoards = !!boardAId && !!boardBId && boardAId !== boardBId;
  const canStart = hasTwoBoards || isBridgeActive;
  const notConnected = [boardAx, boardBx].filter((b) => b && !b.isConnected);
  const guidance = boards.length < 2
    ? 'Only one port is available. Click "+ Add serial port" and pick the second device in the browser prompt.'
    : !hasTwoBoards
      ? 'Choose two different boards for PORT A and PORT B.'
      : notConnected.length > 0
        ? `Not connected yet: ${notConnected.map((b) => b.name).join(', ')}. Use Connect below before starting.`
        : '';

  const toggleBridge = () => {
    if (!canStart) return;
    if (parentToggleBridge) {
      parentToggleBridge(boardAId, boardBId, !isBridgeActive);
    } else {
      setInternalBridgeActive(!internalBridgeActive);
    }
  };

  const names = { a: (boards.find((b) => b.id === boardAId) || {}).name, b: (boards.find((b) => b.id === boardBId) || {}).name };

  const download = (content, type, ext) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `serial_bridge_capture_${Date.now()}.${ext}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const shownSource = frozen || bridgeLog;
  const handleExportJson = () => { if (shownSource.length) download(JSON.stringify(shownSource, null, 2), 'application/json', 'json'); };
  const handleExportCsv = () => { if (shownSource.length) download(logToCsv(shownSource, names), 'text/csv', 'csv'); };
  const handleExportText = () => { if (shownSource.length) download(logToText(shownSource, names), 'text/plain', 'txt'); };

  const filteredLogs = filterLog(shownSource, { query: searchQuery, dir: dirFilter });
  const stats = computeStats(bridgeLog);

  const boardA = boardAx;
  const boardB = boardBx;
  const btn = 'flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-[11px] disabled:opacity-40';
  const seg = (active) => `px-1.5 py-0.5 text-[10px] ${active ? 'bg-cyan-500/20 text-cyber-cyan' : 'text-slate-400 hover:text-slate-200'}`;

  return (
    <div className="flex flex-col gap-2 font-mono text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5 bg-slate-950 p-1 rounded border border-slate-800">
          <label className="text-[10px] text-cyber-cyan font-bold pl-1" htmlFor="bridge-port-a">A</label>
          <select
            id="bridge-port-a"
            value={boardAId}
            onChange={(e) => setBoardAId(e.target.value)}
            disabled={isBridgeActive}
            className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 outline-none text-[11px] max-w-[9rem]"
          >
            {boards.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.baudRate})</option>
            ))}
          </select>
          <ArrowLeftRight className="w-3 h-3 text-slate-600" />
          <label className="text-[10px] text-cyber-amber font-bold" htmlFor="bridge-port-b">B</label>
          <select
            id="bridge-port-b"
            value={boardBId}
            onChange={(e) => setBoardBId(e.target.value)}
            disabled={isBridgeActive}
            className="bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-slate-200 outline-none text-[11px] max-w-[9rem]"
          >
            {boards.map(b => (
              <option key={b.id} value={b.id}>{b.name} ({b.baudRate})</option>
            ))}
          </select>
        </div>

        <button
          onClick={() => addNewBoard?.()}
          disabled={isBridgeActive}
          className={btn}
          title="Open the browser serial picker and add another board"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>+ Add serial port</span>
        </button>

        <button
          onClick={toggleBridge}
          disabled={!canStart}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-bold text-[11px] transition-all border ${canStart ? "" : "opacity-40"} ${
            isBridgeActive
              ? 'bg-emerald-500/20 text-cyber-emerald border-emerald-500/50 shadow-emerald-glow animate-pulse'
              : 'bg-gradient-to-r from-cyan-500 to-cyan-600 text-slate-950 shadow-cyan-glow hover:brightness-110'
          }`}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span>{isBridgeActive ? 'BRIDGE ACTIVE (SNIFFING)' : 'START MitM BRIDGE'}</span>
        </button>
      </div>

      {/* Per-board connection state + baud */}
      <div className="flex flex-wrap gap-1.5" data-testid="bridge-board-status">
        {boards.map((b) => (
          <div key={b.id} className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-[11px]">
            <span className={`w-2 h-2 rounded-full ${b.isConnected ? 'bg-emerald-400' : b.isConnecting ? 'bg-amber-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className="text-slate-200">{b.name}</span>
            <span className="text-slate-500">{b.isConnected ? 'connected' : b.isConnecting ? 'connecting' : 'disconnected'}</span>
            <select
              aria-label={`Baud rate for ${b.name}`}
              value={b.baudRate}
              disabled={b.isConnected || b.isConnecting}
              onChange={(e) => updateBoard?.(b.id, { baudRate: Number(e.target.value) })}
              className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5 text-slate-200 text-[11px]"
            >
              {[...new Set([300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, Number(b.baudRate)])]
                .filter(Boolean).sort((x, y) => x - y).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {!b.isConnected && (
              <button
                onClick={() => connectBoard?.(b.id)}
                disabled={b.isConnecting}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyber-cyan border border-cyan-500/40 disabled:opacity-40"
              >
                <Plug className="w-3 h-3" /><span>Connect</span>
              </button>
            )}
          </div>
        ))}
      </div>
      {guidance && !isBridgeActive && (
        <div className="text-[11px] text-amber-300 bg-amber-950/20 border border-amber-500/30 rounded px-2 py-1" role="status">
          {guidance}
        </div>
      )}

      {/* Filter / export bar */}
      <div className="flex flex-wrap items-center gap-1.5 bg-[#030712] border border-slate-800 rounded p-1.5">
        <div className="relative flex items-center flex-1 min-w-[8rem]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
          <input
            type="text"
            aria-label="Search dialogue text or hex"
            placeholder="Search text or hex..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-slate-950 border border-slate-800 rounded pl-7 pr-2 py-0.5 text-[11px] text-slate-200 outline-none focus:border-cyan-500 w-full"
          />
        </div>
        <div className="flex border border-slate-800 rounded overflow-hidden" role="group" aria-label="Direction filter">
          {[['both', 'All'], ['A->B', 'A>B'], ['B->A', 'B>A']].map(([v, l]) => (
            <button key={v} onClick={() => setDirFilter(v)} aria-pressed={dirFilter === v} className={seg(dirFilter === v)} title={`Show ${v === 'both' ? 'both directions' : v.replace('->', ' to ')}`}>{l}</button>
          ))}
        </div>
        <div className="flex border border-slate-800 rounded overflow-hidden" role="group" aria-label="View mode">
          {[['both', 'Text+Hex'], ['text', 'Text'], ['hex', 'Hex']].map(([v, l]) => (
            <button key={v} onClick={() => setViewMode(v)} aria-pressed={viewMode === v} className={seg(viewMode === v)}>{l}</button>
          ))}
        </div>
        <button
          onClick={() => setFrozen(frozen ? null : bridgeLog)}
          aria-pressed={!!frozen}
          className={`${btn} ${frozen ? 'text-cyber-amber border-amber-500/50' : ''}`}
          title="Freeze the displayed feed. Forwarding and capture continue in the background."
        >
          <PauseIcon className="w-3.5 h-3.5" /><span>{frozen ? 'Resume view' : 'Freeze view'}</span>
        </button>
        <label className="flex items-center gap-1 text-[10px] text-slate-400">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> Auto-scroll
        </label>
        <button onClick={handleExportJson} disabled={shownSource.length === 0} className={btn} title="Download the capture as JSON">
          <Download className="w-3.5 h-3.5" /><span>Export JSON</span>
        </button>
        <button onClick={handleExportCsv} disabled={shownSource.length === 0} className={btn} title="Download the capture as CSV">
          <span>CSV</span>
        </button>
        <button onClick={handleExportText} disabled={shownSource.length === 0} className={btn} title="Download the capture as a text hex dump">
          <FileText className="w-3.5 h-3.5" /><span>Hex dump</span>
        </button>
        <button
          onClick={() => { setFrozen(null); if (parentClearBridgeLog) parentClearBridgeLog(); else setInternalBridgeLog([]); }}
          className="p-1 rounded bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800"
          title="Clear Feed"
          aria-label="Clear Feed"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Counters */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500" data-testid="bridge-stats">
        <span className="text-cyber-cyan">A&gt;B {stats.aToB.bytes} B / {stats.aToB.chunks} chunks</span>
        <span className="text-cyber-amber">B&gt;A {stats.bToA.bytes} B / {stats.bToA.chunks} chunks</span>
        <span>total {stats.bytes} B{stats.bytesPerSec ? `, ~${stats.bytesPerSec} B/s avg` : ''}</span>
        {frozen && <span className="text-cyber-amber">view frozen ({Math.max(0, bridgeLog.length - frozen.length)} new hidden)</span>}
        <span>showing {filteredLogs.length}/{shownSource.length}</span>
      </div>

      {/* Sniffer feed */}
      <div
        ref={logContainerRef}
        className="h-64 overflow-y-auto bg-[#030712] border border-slate-800 rounded p-2 flex flex-col gap-1"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-1 select-none text-center">
            <Radio className="w-6 h-6 animate-pulse text-slate-700" />
            <span>{isBridgeActive ? 'Awaiting serial traffic between Port A and Port B...' : 'Select two boards and click "START MitM BRIDGE"'}</span>
          </div>
        ) : (
          filteredLogs.map((entry) => (
            <div
              key={entry.id}
              className={`flex flex-wrap items-start gap-x-2 gap-y-0.5 p-1 rounded border text-[11px] font-mono ${
                entry.dir === 'A->B'
                  ? 'bg-cyan-950/20 border-cyan-500/30 text-cyan-200'
                  : 'bg-amber-950/20 border-amber-500/30 text-amber-200'
              }`}
            >
              <span className="text-[10px] text-slate-500 whitespace-nowrap">{entry.time}</span>
              <span className={`px-1.5 rounded font-bold text-[9px] uppercase whitespace-nowrap ${
                entry.dir === 'A->B' ? 'bg-cyan-500/20 text-cyber-cyan' : 'bg-amber-500/20 text-cyber-amber'
              }`}>
                {entry.dir === 'A->B' ? `${boardA?.name || 'A'} ➔ ${boardB?.name || 'B'}` : `${boardB?.name || 'B'} ➔ ${boardA?.name || 'A'}`}
              </span>
              {entry.deltaMs > 0 && <span className="text-[9px] text-slate-500">+{entry.deltaMs}ms</span>}
              <div className="basis-full @md:basis-0 @md:flex-1 break-all">
                {viewMode !== 'hex' && <span className="text-slate-100">{entry.text}</span>}
                {viewMode !== 'text' && entry.hex && (
                  <span className={`text-[10px] block font-mono ${viewMode === 'hex' ? 'text-slate-200' : 'text-slate-500'}`}>
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
