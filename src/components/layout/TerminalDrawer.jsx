import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal as TerminalIcon, 
  ChevronUp, 
  ChevronDown, 
  Send, 
  Trash2, 
  Maximize2, 
  X, 
  CornerDownLeft, 
  Sparkles,
  ArrowDown
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';

export default function TerminalDrawer({
  isOpen,
  onToggleOpen,
  onNavigateToFullTerminal
}) {
  const {
    isConnected,
    entries,
    sendString,
    clearLogs,
    rxActivity,
    txActivity,
    baudRate
  } = useSerial();

  const [inputVal, setInputVal] = useState('');
  const [lineEnding, setLineEnding] = useState('\r\n');
  const [autoFollow, setAutoFollow] = useState(true);
  const [drawerHeight, setDrawerHeight] = useState(240); // px
  const [isResizing, setIsResizing] = useState(false);

  const logContainerRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll on new entries
  useEffect(() => {
    if (autoFollow && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [entries, autoFollow]);

  const handleSend = (e) => {
    e?.preventDefault();
    if (!inputVal && lineEnding !== '\r\n' && lineEnding !== '\n') return;
    sendString(inputVal, lineEnding);
    setInputVal('');
  };

  // Drag resizer
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing) return;
      const newHeight = window.innerHeight - e.clientY;
      if (newHeight >= 120 && newHeight <= window.innerHeight * 0.7) {
        setDrawerHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const latestEntry = entries[entries.length - 1];

  return (
    <div className="border-t border-cyber-border bg-[#050a16] shadow-2xl transition-all duration-200 z-20 font-mono text-xs flex flex-col shrink-0">
      {/* Drawer Resize Handle */}
      {isOpen && (
        <div
          onMouseDown={() => setIsResizing(true)}
          className="h-1.5 w-full bg-slate-900 hover:bg-cyan-500 cursor-ns-resize transition-colors"
          title="Drag to resize terminal drawer"
        />
      )}

      {/* Drawer Header Bar (Always visible) */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-slate-950 border-b border-slate-900 select-none">
        {/* Left: Drawer title & Live Preview */}
        <div className="flex items-center gap-2.5 truncate flex-1 mr-3">
          <button
            onClick={onToggleOpen}
            className="flex items-center gap-1.5 text-cyan-400 font-bold hover:text-cyan-300 transition-colors"
          >
            <TerminalIcon className="w-4 h-4" />
            <span className="text-xs">LIVE SERIAL DRAWER</span>
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>

          {/* Activity status pill */}
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px]">
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
            <span className={isConnected ? 'text-emerald-400' : 'text-slate-500'}>
              {isConnected ? `${baudRate} bps` : 'OFFLINE'}
            </span>
          </div>

          {/* Collapsed live line preview */}
          {!isOpen && latestEntry && (
            <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400 truncate flex-1">
              <span className="text-slate-600 text-[10px]">{latestEntry.timestamp}</span>
              <span className={`truncate font-mono ${latestEntry.type === 'rx' ? 'text-cyan-300' : latestEntry.type === 'tx' ? 'text-amber-400' : 'text-slate-400'}`}>
                {latestEntry.text}
              </span>
            </div>
          )}
        </div>

        {/* Right: Quick Drawer Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isOpen && (
            <>
              {/* Auto scroll */}
              <button
                onClick={() => setAutoFollow(!autoFollow)}
                title="Auto-scroll to bottom"
                className={`p-1.5 rounded border text-xs transition-all ${
                  autoFollow 
                    ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' 
                    : 'bg-slate-900 border-slate-800 text-slate-400'
                }`}
              >
                <ArrowDown className="w-3 h-3" />
              </button>

              {/* Clear */}
              <button
                onClick={clearLogs}
                title="Clear drawer logs"
                className="p-1.5 rounded bg-slate-900 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-500/40 text-slate-400 hover:text-rose-400"
              >
                <Trash2 className="w-3 h-3" />
              </button>

              {/* Full screen terminal jump */}
              {onNavigateToFullTerminal && (
                <button
                  onClick={onNavigateToFullTerminal}
                  title="Switch to Full Terminal Workspace"
                  className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-cyan-300 text-[10px] font-bold"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span className="hidden sm:inline">FULL VIEW</span>
                </button>
              )}
            </>
          )}

          {/* Toggle / Minimize button */}
          <button
            onClick={onToggleOpen}
            className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800"
            title={isOpen ? "Collapse drawer" : "Expand live terminal drawer"}
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded Content Area */}
      {isOpen && (
        <div 
          style={{ height: `${drawerHeight}px` }} 
          className="flex flex-col bg-[#020510] overflow-hidden"
        >
          {/* Scrollable Log Lines */}
          <div
            ref={logContainerRef}
            className="flex-1 overflow-y-auto p-3 space-y-1 select-text scrollbar-thin scrollbar-thumb-slate-800 font-mono text-[11px] leading-relaxed"
          >
            {entries.length === 0 ? (
              <div className="py-8 text-center text-slate-600 italic">
                Terminal buffer is empty. Connect to a port to view live incoming UART data.
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="flex items-start gap-2 hover:bg-slate-900/30 rounded px-1">
                  <span className="text-slate-600 select-none text-[10px] shrink-0 pt-0.5">
                    [{entry.timestamp}]
                  </span>
                  <span
                    className={`shrink-0 text-[10px] font-bold select-none px-1 rounded ${
                      entry.type === 'rx'
                        ? 'text-cyan-400 bg-cyan-950/40'
                        : entry.type === 'tx'
                        ? 'text-amber-400 bg-amber-950/40'
                        : 'text-purple-400 bg-purple-950/40'
                    }`}
                  >
                    {entry.type.toUpperCase()}
                  </span>
                  <span
                    className={`break-all whitespace-pre-wrap flex-1 ${
                      entry.type === 'rx'
                        ? 'text-slate-200'
                        : entry.type === 'tx'
                        ? 'text-amber-300'
                        : 'text-slate-400'
                    }`}
                  >
                    {entry.text}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Quick TX Bar */}
          <form
            onSubmit={handleSend}
            className="p-2 bg-slate-950 border-t border-slate-900 flex items-center gap-2"
          >
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Send serial command or hex payload..."
                disabled={!isConnected}
                className="w-full bg-[#030712] border border-slate-800 rounded-lg pl-3 pr-8 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-cyan-500 font-mono disabled:opacity-50"
              />
              <CornerDownLeft className="w-3.5 h-3.5 text-slate-600 absolute right-2.5 top-2.5 pointer-events-none" />
            </div>

            {/* Line ending */}
            <select
              value={lineEnding}
              onChange={(e) => setLineEnding(e.target.value)}
              className="bg-[#030712] border border-slate-800 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 font-bold outline-none"
            >
              <option value="\r\n">CR+LF (\r\n)</option>
              <option value="\n">LF Only (\n)</option>
              <option value="\r">CR Only (\r)</option>
              <option value="">None</option>
              <option value="hex">Hex Bytes</option>
            </select>

            {/* Send button */}
            <button
              type="submit"
              disabled={!isConnected}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-bold text-xs shadow-cyan-glow transition-all disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">SEND</span>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
