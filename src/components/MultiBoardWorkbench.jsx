import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Plus, 
  Layers, 
  Grid3X3, 
  Columns2, 
  Move, 
  Maximize2, 
  Minimize2, 
  Radio, 
  Send, 
  Terminal, 
  Cpu, 
  X, 
  ChevronLeft, 
  ChevronRight, 
  Binary, 
  Sliders, 
  Share2, 
  Sparkles,
  RefreshCw,
  Unplug
} from 'lucide-react';
import StreamConsole from './StreamConsole';
import HexInspection from './HexInspection';

export const BOARD_COLORS = [
  { border: 'border-cyan-500/50', glow: 'shadow-cyan-glow', text: 'text-cyber-cyan', bg: 'bg-cyan-500/10', dot: 'bg-cyber-cyan' },
  { border: 'border-amber-500/50', glow: 'shadow-amber-glow', text: 'text-cyber-amber', bg: 'bg-amber-500/10', dot: 'bg-cyber-amber' },
  { border: 'border-emerald-500/50', glow: 'shadow-emerald-glow', text: 'text-cyber-emerald', bg: 'bg-emerald-500/10', dot: 'bg-cyber-emerald' },
  { border: 'border-rose-500/50', glow: 'shadow-rose-glow', text: 'text-rose-400', bg: 'bg-rose-500/10', dot: 'bg-rose-400' },
  { border: 'border-purple-500/50', glow: 'shadow-purple-glow', text: 'text-purple-400', bg: 'bg-purple-500/10', dot: 'bg-purple-400' },
  { border: 'border-orange-500/50', glow: 'shadow-orange-glow', text: 'text-orange-400', bg: 'bg-orange-500/10', dot: 'bg-orange-400' }
];

export default function MultiBoardWorkbench({
  boards = [],
  activeBoardId,
  onSelectActiveBoard,
  onConnectBoard,
  onDisconnectBoard,
  onAddNewBoard,
  onCloseBoard,
  onSendToBoard,
  onBroadcast,
  onClearBoardLog,
  onMoveBoard,
  onUpdateBoardWindow,
  onBaudRateChange,
  // Hex inspection shared props
  showHexInspection,
  onToggleHexInspection,
  activeHexByteStream = [],
  onClearHexStream,
  isMobileDevice
}) {
  const [layoutMode, setLayoutMode] = useState('tiled'); // 'tiled' | 'floating' | 'tabs'
  const [broadcastInput, setBroadcastInput] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const containerRef = useRef(null);

  // Bring window to front in floating mode
  const bringToFront = (boardId) => {
    onSelectActiveBoard(boardId);
  };

  // Pointer Drag Handlers for Floating Windows
  const handlePointerDown = (e, board) => {
    // Only drag from header handle
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) {
      return;
    }
    setActiveDragId(board.id);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: board.pos?.x || 20,
      posY: board.pos?.y || 20
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    bringToFront(board.id);
  };

  const handlePointerMove = (e, boardId) => {
    if (activeDragId !== boardId) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const newX = Math.max(0, Math.min(window.innerWidth - 300, dragStartRef.current.posX + dx));
    const newY = Math.max(0, Math.min(window.innerHeight - 200, dragStartRef.current.posY + dy));
    onUpdateBoardWindow(boardId, { pos: { x: newX, y: newY } });
  };

  const handlePointerUp = (e) => {
    if (activeDragId) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {}
      setActiveDragId(null);
    }
  };

  const handleSendBroadcast = (e) => {
    e.preventDefault();
    if (!broadcastInput.trim()) return;
    onBroadcast(broadcastInput + '\r\n');
    setBroadcastInput('');
  };

  const activeBoard = boards.find(b => b.id === activeBoardId) || boards[0];
  const minimizedBoards = boards.filter(b => b.isMinimized);
  const visibleBoards = boards.filter(b => !b.isMinimized);

  return (
    <div className="flex flex-col gap-2.5 w-full">
      {/* Multi-Board Control Bar & Session Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#060b17] border border-cyber-border rounded-xl shadow-lg">
        {/* Left: Connected Boards Pills / Switcher */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider pr-1.5 border-r border-slate-800 flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-cyber-cyan" />
            <span className="hidden sm:inline">BOARDS:</span>
          </div>

          {boards.map((board, idx) => {
            const colorTheme = BOARD_COLORS[idx % BOARD_COLORS.length];
            const isActive = board.id === activeBoardId;
            return (
              <div
                key={board.id}
                onClick={() => {
                  onSelectActiveBoard(board.id);
                  if (board.isMinimized) {
                    onUpdateBoardWindow(board.id, { isMinimized: false });
                  }
                }}
                className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-bold cursor-pointer transition-all border ${
                  isActive 
                    ? `${colorTheme.bg} ${colorTheme.text} ${colorTheme.border} ${colorTheme.glow}` 
                    : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${board.isConnected ? `${colorTheme.dot} animate-pulse` : 'bg-slate-600'}`}></span>
                <span>{board.name}</span>
                <span className="text-[10px] opacity-75 font-normal">
                  ({board.baudRate})
                </span>

                {boards.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseBoard(board.id);
                    }}
                    title="Close session"
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-400 p-0.5 rounded transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          })}

          {/* Add Board Button */}
          <div className="flex items-center gap-1 pl-1">
            <button
              onClick={() => onAddNewBoard()}
              title="Connect a new USB serial board"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cyber-card hover:bg-slate-800 text-cyber-cyan border border-cyber-cyan/30 text-xs font-bold transition-all"
            >
              <Plus className="w-3.5 h-3.5 text-cyber-cyan" />
              <span>CONNECT USB</span>
            </button>
          </div>
        </div>

        {/* Right: Layout Switcher & Hex Inspector Toggle */}
        <div className="flex items-center gap-2">
          {/* Layout Mode Selector */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              onClick={() => setLayoutMode('tiled')}
              title="Tiled Grid / Split Screen View"
              className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
                layoutMode === 'tiled' ? 'bg-cyan-500/20 text-cyber-cyan font-bold border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">TILED</span>
            </button>

            <button
              onClick={() => setLayoutMode('floating')}
              title="Floating Movable Windows (Drag around screen)"
              className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
                layoutMode === 'floating' ? 'bg-amber-500/20 text-cyber-amber font-bold border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span className="hidden md:inline">MOVABLE</span>
            </button>

            <button
              onClick={() => setLayoutMode('tabs')}
              title="Tabbed Single Terminal Focus"
              className={`flex items-center gap-1 px-2 py-0.5 rounded transition-all ${
                layoutMode === 'tabs' ? 'bg-emerald-500/20 text-cyber-emerald font-bold border border-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span className="hidden md:inline">TABS</span>
            </button>
          </div>

          {/* Hex Inspection Toggle */}
          <button
            onClick={onToggleHexInspection}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all border ${
              showHexInspection 
                ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50 shadow-amber-glow' 
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            <Binary className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">HEX GRID</span>
          </button>
        </div>
      </div>

      {/* Broadcast Bar (When 2+ boards connected) */}
      {boards.length > 1 && (
        <form
          onSubmit={handleSendBroadcast}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyber-card border border-slate-800 text-xs shadow-inner"
        >
          <div className="flex items-center gap-1.5 text-cyber-amber font-bold whitespace-nowrap">
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            <span>BROADCAST ALL ({boards.length}):</span>
          </div>
          <input
            type="text"
            value={broadcastInput}
            onChange={(e) => setBroadcastInput(e.target.value)}
            placeholder='Transmit command to all connected boards simultaneously (e.g. "AT" or reset)...'
            className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500 font-mono text-xs"
          />
          <button
            type="submit"
            className="flex items-center gap-1 px-3 py-1 rounded bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold hover:brightness-110 shadow-amber-glow"
          >
            <Send className="w-3 h-3" />
            <span>SEND ALL</span>
          </button>
        </form>
      )}

      {/* Workspace Display Area */}
      <div 
        ref={containerRef}
        className={`relative w-full ${layoutMode === 'floating' ? 'min-h-[560px] overflow-hidden' : ''}`}
      >
        {/* LAYOUT MODE 1: TILED GRID */}
        {layoutMode === 'tiled' && (
          <div className={`grid gap-3 ${
            visibleBoards.length === 1 
              ? (showHexInspection ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1')
              : visibleBoards.length === 2 
                ? (showHexInspection ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2')
                : 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3'
          } min-h-[460px]`}>
            {visibleBoards.map((board, idx) => {
              const colorTheme = BOARD_COLORS[idx % BOARD_COLORS.length];
              const isActive = board.id === activeBoardId;
              const isMaximized = board.isMaximized;

              return (
                <div
                  key={board.id}
                  onClick={() => onSelectActiveBoard(board.id)}
                  className={`flex flex-col h-[460px] rounded-xl border transition-all ${
                    isActive ? `${colorTheme.border} ${colorTheme.glow}` : 'border-slate-800'
                  } ${isMaximized ? 'col-span-full h-[600px]' : ''}`}
                >
                  {/* Window Custom Header for Tiled Mode */}
                  <div className={`flex items-center justify-between px-3 py-1.5 bg-[#090e1a] border-b border-cyber-border rounded-t-xl text-xs font-mono select-none`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${board.isConnected ? `${colorTheme.dot} animate-pulse` : 'bg-slate-600'}`}></span>
                      <span className={`font-bold ${colorTheme.text}`}>{board.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-900 text-slate-400 border border-slate-800">
                        {board.baudRate} bps
                      </span>
                      {board.rxActivity && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950 text-cyber-emerald border border-emerald-500/30">
                          RX
                        </span>
                      )}
                      {board.txActivity && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950 text-cyber-amber border border-amber-500/30">
                          TX
                        </span>
                      )}
                    </div>

                    {/* Window Controls: Move Left, Move Right, Maximize, Minimize, Close */}
                    <div className="flex items-center gap-1">
                      {visibleBoards.length > 1 && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); onMoveBoard(board.id, 'left'); }}
                            disabled={idx === 0}
                            title="Move Window Left"
                            className="p-1 rounded text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); onMoveBoard(board.id, 'right'); }}
                            disabled={idx === visibleBoards.length - 1}
                            title="Move Window Right"
                            className="p-1 rounded text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-800"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateBoardWindow(board.id, { isMaximized: !isMaximized });
                        }}
                        title={isMaximized ? "Restore Size" : "Maximize Terminal"}
                        className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateBoardWindow(board.id, { isMinimized: true });
                        }}
                        title="Minimize to Dock"
                        className="p-1 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800"
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                      </button>

                      {boards.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onCloseBoard(board.id); }}
                          title="Disconnect & Close Board"
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Terminal Console */}
                  <div className="flex-1 overflow-hidden">
                    <StreamConsole
                      entries={board.entries}
                      onClear={() => onClearBoardLog(board.id)}
                      onSend={(text) => onSendToBoard(board.id, text)}
                      isConnected={board.isConnected}
                    />
                  </div>
                </div>
              );
            })}

            {/* Optional Hex Inspection Pane in Tiled Grid */}
            {showHexInspection && (
              <div className="h-[460px] rounded-xl overflow-hidden border border-slate-800">
                <HexInspection
                  byteStream={activeHexByteStream}
                  onClear={onClearHexStream}
                />
              </div>
            )}
          </div>
        )}

        {/* LAYOUT MODE 2: FLOATING MOVABLE DRAGGABLE WINDOWS */}
        {layoutMode === 'floating' && (
          <div className="relative w-full h-[580px] bg-[#02050e] rounded-xl border border-slate-900 p-2 overflow-hidden shadow-inner">
            <div className="absolute top-2 right-3 text-[11px] text-slate-600 font-mono pointer-events-none select-none z-0">
              CLICK & DRAG TITLE BARS TO MOVE TERMINAL WINDOWS
            </div>

            {visibleBoards.map((board, idx) => {
              const colorTheme = BOARD_COLORS[idx % BOARD_COLORS.length];
              const isActive = board.id === activeBoardId;
              const isMaximized = board.isMaximized;
              const posX = board.pos?.x ?? (20 + (idx * 50));
              const posY = board.pos?.y ?? (20 + (idx * 40));

              return (
                <div
                  key={board.id}
                  onClick={() => bringToFront(board.id)}
                  style={isMaximized ? {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 30
                  } : {
                    position: 'absolute',
                    left: `${posX}px`,
                    top: `${posY}px`,
                    width: '520px',
                    height: '420px',
                    zIndex: isActive ? 20 : 10 + idx
                  }}
                  className={`flex flex-col bg-[#050a17] rounded-xl border shadow-2xl transition-shadow ${
                    isActive ? `${colorTheme.border} ${colorTheme.glow}` : 'border-slate-800'
                  }`}
                >
                  {/* Draggable Title Bar */}
                  <div
                    onPointerDown={(e) => handlePointerDown(e, board)}
                    onPointerMove={(e) => handlePointerMove(e, board.id)}
                    onPointerUp={handlePointerUp}
                    className={`flex items-center justify-between px-3 py-1.5 bg-[#090e1a] border-b border-cyber-border rounded-t-xl text-xs font-mono select-none cursor-grab active:cursor-grabbing`}
                  >
                    <div className="flex items-center gap-2">
                      <Move className="w-3.5 h-3.5 text-slate-500" />
                      <span className={`w-2 h-2 rounded-full ${board.isConnected ? `${colorTheme.dot} animate-pulse` : 'bg-slate-600'}`}></span>
                      <span className={`font-bold ${colorTheme.text}`}>{board.name}</span>
                      <span className="text-[10px] text-slate-400">({board.baudRate})</span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateBoardWindow(board.id, { isMaximized: !isMaximized });
                        }}
                        title={isMaximized ? "Restore Size" : "Maximize"}
                        className="p-1 rounded text-slate-400 hover:text-white"
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onUpdateBoardWindow(board.id, { isMinimized: true });
                        }}
                        title="Minimize"
                        className="p-1 rounded text-slate-400 hover:text-white"
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                      </button>

                      {boards.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onCloseBoard(board.id); }}
                          title="Close"
                          className="p-1 rounded text-slate-400 hover:text-rose-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Terminal Body */}
                  <div className="flex-1 overflow-hidden">
                    <StreamConsole
                      entries={board.entries}
                      onClear={() => onClearBoardLog(board.id)}
                      onSend={(text) => onSendToBoard(board.id, text)}
                      isConnected={board.isConnected}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* LAYOUT MODE 3: TABBED FOCUS */}
        {layoutMode === 'tabs' && activeBoard && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-[460px]">
            <div className={`flex flex-col h-full rounded-xl border ${BOARD_COLORS[0].border} ${BOARD_COLORS[0].glow} overflow-hidden`}>
              <StreamConsole
                entries={activeBoard.entries}
                onClear={() => onClearBoardLog(activeBoard.id)}
                onSend={(text) => onSendToBoard(activeBoard.id, text)}
                isConnected={activeBoard.isConnected}
              />
            </div>

            <HexInspection
              byteStream={activeHexByteStream}
              onClear={onClearHexStream}
            />
          </div>
        )}
      </div>

      {/* Bottom Minimized Dock Bar */}
      {minimizedBoards.length > 0 && (
        <div className="flex items-center gap-2 p-2 bg-[#060b17] border border-slate-800 rounded-lg text-xs font-mono">
          <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            MINIMIZED BOARDS:
          </span>
          {minimizedBoards.map((b) => (
            <button
              key={b.id}
              onClick={() => onUpdateBoardWindow(b.id, { isMinimized: false })}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold transition-all"
            >
              <Terminal className="w-3 h-3 text-cyber-cyan" />
              <span>{b.name}</span>
              <Maximize2 className="w-3 h-3 text-slate-500" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
