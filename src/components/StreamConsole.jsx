import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal as TerminalIcon, 
  Send, 
  Trash2, 
  Download, 
  Search, 
  ArrowDown, 
  Pause, 
  Play, 
  Clock, 
  CornerDownLeft,
  ChevronDown,
  Sparkles
} from 'lucide-react';

/**
 * Parses ANSI escape sequences into React styled elements
 * Handles 3-bit / 4-bit ANSI colors (30-37, 90-97, 40-47, 100-107), bold, dim, reset.
 */
function parseAnsi(text) {
  if (!text) return null;

  // Split by ANSI escape sequences \x1b[...m
  const regex = /\x1B\[[0-9;]*m/g;
  const parts = [];
  let lastIndex = 0;
  let currentStyle = {};
  let match;

  const colorMap = {
    '30': 'text-slate-500',
    '31': 'text-rose-400',
    '32': 'text-emerald-400',
    '33': 'text-amber-400',
    '34': 'text-cyan-400',
    '35': 'text-purple-400',
    '36': 'text-teal-400',
    '37': 'text-slate-200',
    '90': 'text-slate-600',
    '91': 'text-rose-300',
    '92': 'text-emerald-300',
    '93': 'text-amber-300',
    '94': 'text-cyan-300',
    '95': 'text-purple-300',
    '96': 'text-teal-300',
    '97': 'text-white',
  };

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        text: text.slice(lastIndex, match.index),
        className: Object.values(currentStyle).join(' ')
      });
    }

    // Extract codes e.g. "1;32"
    const codeStr = match[0].slice(2, -1);
    const codes = codeStr.split(';').map(c => c.trim());

    for (const code of codes) {
      if (code === '0' || code === '') {
        currentStyle = {};
      } else if (code === '1') {
        currentStyle.weight = 'font-bold';
      } else if (code === '2') {
        currentStyle.dim = 'opacity-60';
      } else if (code === '4') {
        currentStyle.underline = 'underline';
      } else if (colorMap[code]) {
        currentStyle.color = colorMap[code];
      }
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({
      text: text.slice(lastIndex),
      className: Object.values(currentStyle).join(' ')
    });
  }

  return parts;
}

export default function StreamConsole({
  entries, // array of { id, type: 'rx' | 'tx' | 'sys', text, timestamp, rawBytes }
  onClear,
  onSend,
  isConnected
}) {
  const [inputText, setInputText] = useState('');
  const [lineEnding, setLineEnding] = useState('\r\n'); // '\r\n', '\n', '\r', '', 'hex'
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const consoleEndRef = useRef(null);
  const consoleContainerRef = useRef(null);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && !isPaused && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll, isPaused]);

  // Handle scroll detection for user manual scrolling
  const handleScroll = () => {
    if (!consoleContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    }
  };

  const handleTransmit = (e) => {
    e?.preventDefault();
    if (!inputText && lineEnding !== '\r\n' && lineEnding !== '\n') return;

    onSend(inputText, lineEnding);

    // Save to history
    if (inputText.trim()) {
      setHistory(prev => [inputText, ...prev.slice(0, 49)]);
    }
    setHistoryIndex(-1);
    setInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0 && historyIndex < history.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setInputText(history[nextIdx]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setInputText(history[nextIdx]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInputText('');
      }
    }
  };

  const handleExportLog = () => {
    const rawLines = entries.map(e => {
      const ts = showTimestamps ? `[${e.timestamp}] ` : '';
      const prefix = e.type === 'rx' ? '<- ' : e.type === 'tx' ? '-> ' : '[SYS] ';
      return `${ts}${prefix}${e.text}`;
    }).join('\n');

    const blob = new Blob([rawLines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `skons-serial-log-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Filtered entries
  const filteredEntries = searchQuery.trim()
    ? entries.filter(e => e.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : entries;

  return (
    <div className="flex flex-col h-full bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl overflow-hidden">
      {/* Terminal Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#090e1a] border-b border-cyber-border text-xs font-mono">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-cyber-cyan" />
          <span className="font-bold text-slate-200 tracking-wider">ANSI STREAM CONSOLE</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
            {entries.length} Lines
          </span>
        </div>

        {/* Console Controls */}
        <div className="flex items-center gap-2">
          {/* Search Query */}
          <div className="relative flex items-center">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search stream..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-0.5 text-[11px] text-slate-200 focus:border-cyber-cyan outline-none w-32 sm:w-44 transition-all"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-1 text-slate-500 hover:text-slate-300 text-xs px-1"
              >
                &times;
              </button>
            )}
          </div>

          {/* Timestamps Toggle */}
          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            title="Toggle Timestamps"
            className={`p-1.5 rounded-lg border transition-all ${
              showTimestamps 
                ? 'bg-cyan-500/10 text-cyber-cyan border-cyan-500/30' 
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
          </button>

          {/* Pause Stream */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume Live Stream" : "Pause Stream Buffer"}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-all ${
              isPaused 
                ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50 animate-pulse' 
                : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
            }`}
          >
            {isPaused ? <Play className="w-3 h-3 text-cyber-amber" /> : <Pause className="w-3 h-3" />}
            <span className="hidden sm:inline">{isPaused ? 'PAUSED' : 'PAUSE'}</span>
          </button>

          {/* AutoScroll Lock */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            title="Auto-scroll to bottom"
            className={`p-1.5 rounded-lg border transition-all ${
              autoScroll 
                ? 'bg-emerald-500/10 text-cyber-emerald border-emerald-500/30' 
                : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-300'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Export Log */}
          <button
            onClick={handleExportLog}
            title="Export Session Log (.log)"
            className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {/* Clear Console */}
          <button
            onClick={onClear}
            title="Clear Terminal Buffer"
            className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Output Display */}
      <div
        ref={consoleContainerRef}
        onScroll={handleScroll}
        className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-1 select-text bg-[#030712] relative scanlines min-h-[220px]"
      >
        {filteredEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 py-12 select-none">
            <TerminalIcon className="w-8 h-8 mb-2 opacity-40 text-cyber-cyan" />
            <p className="text-xs">SERIAL STREAM CONSOLE READY</p>
            <p className="text-[10px] text-slate-700">Connect a port to begin reading real-time ANSI stream</p>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const ansiParts = parseAnsi(entry.text);
            const isRx = entry.type === 'rx';
            const isTx = entry.type === 'tx';
            const isSys = entry.type === 'sys';

            return (
              <div 
                key={entry.id} 
                className={`flex items-start gap-2 leading-relaxed transition-colors hover:bg-slate-900/40 rounded px-1 -mx-1 ${
                  isSys ? 'text-slate-400 italic' : ''
                }`}
              >
                {/* Timestamp */}
                {showTimestamps && (
                  <span className="text-[10px] text-slate-600 select-none flex-shrink-0 pt-0.5">
                    {entry.timestamp}
                  </span>
                )}

                {/* Direction Flag */}
                <span className={`select-none text-[10px] font-bold px-1 rounded flex-shrink-0 ${
                  isRx ? 'bg-cyan-950/60 text-cyber-cyan border border-cyan-800/40' :
                  isTx ? 'bg-amber-950/60 text-cyber-amber border border-amber-800/40' :
                  'bg-slate-800 text-slate-400'
                }`}>
                  {isRx ? 'RX' : isTx ? 'TX' : 'SYS'}
                </span>

                {/* Content with ANSI Support */}
                <span className="break-all whitespace-pre-wrap flex-1 text-slate-200">
                  {ansiParts ? (
                    ansiParts.map((part, idx) => (
                      <span key={idx} className={part.className}>
                        {part.text}
                      </span>
                    ))
                  ) : (
                    entry.text
                  )}
                </span>
              </div>
            );
          })
        )}
        <div ref={consoleEndRef} />
      </div>

      {/* Input / Transmit Command Bar */}
      <form
        onSubmit={handleTransmit}
        className="p-2.5 bg-[#090e1a] border-t border-cyber-border flex items-center gap-2"
      >
        <span className="text-cyber-amber select-none font-bold text-xs pl-1 animate-cursor">
          &gt;
        </span>

        {/* Command Input Field */}
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? "Enter ASCII command or serial string..." : "Connect port to transmit data..."}
          disabled={!isConnected}
          className="flex-1 bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-cyber-amber/60 font-mono disabled:opacity-50 transition-colors"
        />

        {/* Line Ending Selector */}
        <div className="relative">
          <select
            value={lineEnding}
            onChange={(e) => setLineEnding(e.target.value)}
            className="bg-[#030712] border border-slate-800 text-[11px] font-mono text-slate-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer hover:border-slate-700"
            title="Line Termination Format"
          >
            <option value="\r\n">CRLF (\r\n)</option>
            <option value="\n">LF (\n)</option>
            <option value="\r">CR (\r)</option>
            <option value="">None (Raw)</option>
            <option value="hex">Hex Bytes</option>
          </select>
        </div>

        {/* Send Button */}
        <button
          type="submit"
          disabled={!isConnected}
          className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold px-3.5 py-1.5 rounded-lg text-xs font-mono tracking-wider transition-all shadow-amber-glow disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <span>SEND</span>
          <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
