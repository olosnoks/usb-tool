import React, { useState, useRef, useEffect } from 'react';
import { isClearShortcut } from '../utils/consoleShortcuts';
import { useConsolePause, useOptionalSerial } from '../context/SerialContext';
import {
  computeDeltas, formatDelta, assembleLines, buildMatcher, textMatches, splitByMatches,
  matchHighlightRule, createDiskLogger, sendPaced, CTRL_KEYS
} from '../utils/consoleTools';
import { loadMacros, saveMacros, exportMacros, importMacros, expandEscapes, normalizeMacro } from '../utils/consoleMacros';
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
  Sparkles,
  Save,
  Disc,
  StopCircle,
  FileSpreadsheet,
  Activity,
  ChevronUp,
  Upload,
  X
} from 'lucide-react';

/**
 * Parses ANSI escape sequences into React styled elements
 */
function parseAnsi(text) {
  if (!text) return null;
  const regex = /\x1B\[[0-9;]*m/g;
  const parts = [];
  let lastIndex = 0;
  let currentStyle = {};
  let match;

  const colorMap = {
    '30': 'text-slate-500',
    '31': 'text-rose-400',
    '32': 'text-emerald-400',
    '33': 'text-cyber-amber',
    '34': 'text-cyber-cyan',
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
  entries = [],
  onClear,
  onSend,
  isConnected,
  boardId,            // enables disk logging (bytes come from subscribeRx for this board)
  subscribeRx: subscribeRxProp,
  onSendRaw,          // (Uint8Array) => Promise, enables Ctrl keys and send-file
  onSys,              // (text) => void, optional system-log hook
  initialViewMode = 'stream'
}) {
  const serialCtx = useOptionalSerial();
  const subscribeRx = subscribeRxProp || serialCtx?.subscribeRx;
  const [inputText, setInputText] = useState('');
  const [lineEnding, setLineEnding] = useState('\r\n');
  const [autoScroll, setAutoScroll] = useState(true);
  // Pause freezes the view on a snapshot of the log (new data keeps being
  // logged and streamed to disk); the flag is shared via SerialContext.
  const [isPaused, setIsPaused] = useConsolePause();
  const frozenRef = useRef(null);
  if (isPaused && !frozenRef.current) frozenRef.current = entries;
  if (!isPaused) frozenRef.current = null;
  const shownEntries = isPaused ? frozenRef.current : entries;
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [filterToMatches, setFilterToMatches] = useState(true);
  const [matchIdx, setMatchIdx] = useState(0);
  const [echoTx, setEchoTx] = useState(true);       // show sent data in the view
  const [rxEnding, setRxEnding] = useState('auto'); // line view: auto | lf | cr | crlf
  const [showTools, setShowTools] = useState(false);
  const [macros, setMacros] = useState(() => loadMacros());
  const [macroDraft, setMacroDraft] = useState({ name: '', text: '' });
  const [highlightRules, setHighlightRules] = useState(() => {
    try { return JSON.parse((typeof localStorage !== 'undefined' && localStorage.getItem('skons.console.highlights')) || '[]'); } catch (e) { return []; }
  });
  const [ruleDraft, setRuleDraft] = useState('');
  const [toolMsg, setToolMsg] = useState('');
  const [fileDelay, setFileDelay] = useState(10);
  const [fileUnit, setFileUnit] = useState('char');
  const [fileProgress, setFileProgress] = useState(null); // { sent, total } | null
  const fileAbortRef = useRef(null);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // View Mode: 'stream' (one row per chunk) | 'lines' (assembled lines) | 'delta' (Wireshark-style timing)
  const [viewMode, setViewMode] = useState(initialViewMode);
  const [directionFilter, setDirectionFilter] = useState('all'); // 'all', 'rx', 'tx'

  // Direct File System Access API disk streaming
  const [isDiskStreaming, setIsDiskStreaming] = useState(false);
  const [diskFileName, setDiskFileName] = useState('');
  const [diskMode, setDiskMode] = useState('raw'); // raw | text | hex
  const diskLoggerRef = useRef(null);
  const diskUnsubRef = useRef(null);

  const consoleEndRef = useRef(null);
  const consoleContainerRef = useRef(null);

  // Auto-scroll effect
  useEffect(() => {
    if (autoScroll && !isPaused && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries, autoScroll, isPaused]);

  // Direct-to-Disk logger: driven by the raw RX byte stream (subscribeRx), not by
  // the batched `entries` list, so every byte is written once, in order, even
  // when 200 chunks arrive in one render tick.
  const stopDiskLogging = async () => {
    if (diskUnsubRef.current) { diskUnsubRef.current(); diskUnsubRef.current = null; }
    const logger = diskLoggerRef.current;
    diskLoggerRef.current = null;
    setIsDiskStreaming(false);
    setDiskFileName('');
    if (logger) {
      await logger.close();
      if (logger.error) setToolMsg(`Disk log error: ${logger.error.message}`);
    }
  };

  const handleStartDiskStream = async () => {
    if (!window.showSaveFilePicker) {
      setToolMsg('File System Access API is not supported in this browser. Use Chrome, Edge, or Opera.');
      return;
    }
    if (!subscribeRx || !boardId) {
      setToolMsg('Disk logging is not available for this console.');
      return;
    }

    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `serial-log-${new Date().toISOString().slice(0, 10)}.${diskMode === 'raw' ? 'bin' : 'log'}`,
        types: [{
          description: 'Serial Log Files',
          accept: { 'text/plain': ['.log', '.txt', '.bin'] }
        }]
      });

      const writable = await handle.createWritable();
      const logger = createDiskLogger(writable, { mode: diskMode });
      diskLoggerRef.current = logger;
      diskUnsubRef.current = subscribeRx((bytes, id) => {
        if (id === boardId) logger.write(bytes);
      });
      setDiskFileName(handle.name);
      setIsDiskStreaming(true);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('File stream open error:', err);
        setToolMsg(`Could not open log file: ${err.message}`);
      }
    }
  };

  const handleStopDiskStream = () => { stopDiskLogging(); };

  // Close the file when the port disconnects or the console unmounts.
  useEffect(() => {
    if (!isConnected && diskLoggerRef.current) stopDiskLogging();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);
  useEffect(() => () => {
    if (diskUnsubRef.current) diskUnsubRef.current();
    if (diskLoggerRef.current) diskLoggerRef.current.close();
  }, []);

  const handleScroll = () => {
    if (!consoleContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!isAtBottom && autoScroll) setAutoScroll(false);
    else if (isAtBottom && !autoScroll) setAutoScroll(true);
  };

  const handleTransmit = (e) => {
    e?.preventDefault();
    if (!inputText && lineEnding !== '\r\n' && lineEnding !== '\n') return;
    onSend(inputText, lineEnding);
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
    const rawLines = baseRows.map(e => {
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

  // Rows for the active view. Deltas are real arrival differences (rawTime is
  // taken at ingest); unknown values show as a dash, never as invented numbers.
  const baseRows = viewMode === 'lines' ? assembleLines(shownEntries, rxEnding) : shownEntries;
  const entriesWithDeltas = computeDeltas(baseRows);
  const { re: searchRe, error: searchError } = buildMatcher(searchQuery, { regex: regexMode });

  const visibleRows = entriesWithDeltas.filter(e => {
    if (!echoTx && e.type === 'tx') return false;
    if (viewMode === 'delta') {
      if (directionFilter === 'rx') return e.type === 'rx';
      if (directionFilter === 'tx') return e.type === 'tx';
    }
    return true;
  });
  const matchingIds = searchRe ? visibleRows.filter(e => textMatches(searchRe, e.text)).map(e => e.id) : [];
  const filteredEntries = searchRe && filterToMatches
    ? visibleRows.filter(e => matchingIds.includes(e.id))
    : visibleRows;
  const currentMatchId = matchingIds.length ? matchingIds[((matchIdx % matchingIds.length) + matchingIds.length) % matchingIds.length] : null;

  const gotoMatch = (dir) => {
    if (!matchingIds.length) return;
    const next = (matchIdx + dir + matchingIds.length) % matchingIds.length;
    setMatchIdx(next);
    setAutoScroll(false);
    const el = typeof document !== 'undefined' ? document.getElementById(`sc-row-${matchingIds[next]}`) : null;
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' });
  };

  const handleExportCsvTimeline = () => {
    const csvHeader = 'Timestamp,Delta_ms,Direction,Length,ASCII,Hex\n';
    const csvRows = filteredEntries.map(e => {
      const hex = Array.from(new TextEncoder().encode(e.text))
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(' ');
      return `"${e.timestamp}","${e.deltaMs == null ? '' : '+' + e.deltaMs + 'ms'}","${e.type.toUpperCase()}","${e.text.length}","${e.text.replace(/"/g, '""')}","${hex}"`;
    }).join('\n');

    const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `skons-serial-delta-timeline-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalMatchesCount = searchRe ? matchingIds.length : 0;

  const renderHighlight = (text) => {
    if (!searchRe || !text) return text;
    const parts = splitByMatches(text, searchRe);
    if (parts.length <= 1 && !parts[0].match) return text;
    return parts.map((part, i) => part.match ? (
      <mark key={i} className="bg-amber-400 text-slate-950 font-bold px-0.5 rounded shadow-amber-glow">
        {part.text}
      </mark>
    ) : part.text);
  };

  // --- tools: macros, highlight rules, Ctrl keys, send-file -----------------
  const persistMacros = (next) => { setMacros(next); saveMacros(next); };
  const runMacro = (m) => {
    if (!isConnected || !onSend) return;
    onSend(m.ending === 'hex' ? m.text : expandEscapes(m.text), m.ending);
  };
  const addMacro = () => {
    const m = normalizeMacro({ name: macroDraft.name, text: macroDraft.text, ending: lineEnding });
    if (!m) { setToolMsg('A macro needs a name and text.'); return; }
    persistMacros([...macros, m]);
    setMacroDraft({ name: '', text: '' });
    setToolMsg('');
  };
  const handleExportMacros = () => {
    const blob = new Blob([exportMacros(macros)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'skons-console-macros.json';
    link.click();
    URL.revokeObjectURL(url);
  };
  const handleImportMacros = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const imported = importMacros(await file.text());
      persistMacros([...macros, ...imported]);
      setToolMsg(`Imported ${imported.length} macro(s).`);
    } catch (err) {
      setToolMsg(`Import failed: ${err.message}`);
    }
  };
  const saveRules = (next) => {
    setHighlightRules(next);
    try { localStorage.setItem('skons.console.highlights', JSON.stringify(next)); } catch (err) {}
  };
  const addRule = () => {
    const { re, error } = buildMatcher(ruleDraft, { regex: true });
    if (!re) { setToolMsg(error ? `Invalid regex: ${error}` : 'Enter a pattern.'); return; }
    const colors = ['bg-rose-500/20 text-rose-300', 'bg-amber-500/20 text-amber-300', 'bg-emerald-500/20 text-emerald-300', 'bg-cyan-500/20 text-cyan-300'];
    saveRules([...highlightRules, { id: `r-${Date.now()}`, pattern: ruleDraft, color: colors[highlightRules.length % colors.length] }]);
    setRuleDraft('');
    setToolMsg('');
  };
  const sendCtrl = (k) => { if (isConnected && onSendRaw) onSendRaw(Uint8Array.from(k.bytes)); };
  const handleSendFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onSendRaw || !isConnected) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ctl = { aborted: false };
    fileAbortRef.current = ctl;
    setFileProgress({ sent: 0, total: bytes.length });
    if (onSys) onSys(`[SEND FILE] ${file.name}: ${bytes.length} bytes, ${fileUnit === 'line' ? 'per-line' : 'per-char'} delay ${fileDelay} ms`);
    try {
      const res = await sendPaced(bytes, {
        unit: fileUnit, delayMs: Number(fileDelay) || 0, sendRaw: onSendRaw, signal: ctl,
        onProgress: (sent, total) => setFileProgress({ sent, total })
      });
      if (onSys) onSys(res.cancelled ? `[SEND FILE] cancelled after ${res.sent}/${res.total} bytes` : `[SEND FILE] done, ${res.sent} bytes sent`);
    } catch (err) {
      setToolMsg(`Send file failed: ${err.message}`);
    } finally {
      fileAbortRef.current = null;
      setFileProgress(null);
    }
  };
  const cancelSendFile = () => { if (fileAbortRef.current) fileAbortRef.current.aborted = true; };

  return (
    <div
      tabIndex={-1}
      onKeyDown={(e) => {
        if (isClearShortcut(e)) {
          e.preventDefault();
          if (onClear) onClear();
        }
      }}
      className="flex flex-col h-full bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl overflow-hidden outline-none"
    >
      {/* Terminal Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#090e1a] border-b border-cyber-border text-xs font-mono">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-cyber-cyan" />
          <span className="font-bold text-slate-200 tracking-wider">ANSI STREAM CONSOLE</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400">
            {entries.length} Chunks
          </span>

          {/* Disk Stream Indicator */}
          {isDiskStreaming && (
            <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-950 text-cyber-emerald border border-emerald-500/40 animate-pulse">
              <Disc className="w-3 h-3 animate-spin" />
              <span>LOGGING TO DISK: {diskFileName}</span>
            </span>
          )}
        </div>

        {/* Console Controls */}
        <div className="flex items-center gap-2">
          {/* View Mode Toggle: Stream vs Wireshark Delta Timeline */}
          <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
            <button
              onClick={() => setViewMode('stream')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                viewMode === 'stream' ? 'bg-cyan-600 text-white shadow-cyan-glow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              STREAM
            </button>
            <button
              onClick={() => setViewMode('lines')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                viewMode === 'lines' ? 'bg-cyan-600 text-white shadow-cyan-glow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              LINES
            </button>
            <button
              onClick={() => setViewMode('delta')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                viewMode === 'delta' ? 'bg-emerald-600 text-white shadow-emerald-glow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Δt TIMELINE
            </button>
          </div>

          {/* Direction Filter (Delta Mode) */}
          {viewMode === 'delta' && (
            <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px]">
              {['all', 'rx', 'tx'].map(dir => (
                <button
                  key={dir}
                  onClick={() => setDirectionFilter(dir)}
                  className={`px-1.5 py-0.5 rounded font-bold uppercase transition-all ${
                    directionFilter === dir ? 'bg-slate-800 text-cyan-300' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {dir}
                </button>
              ))}
            </div>
          )}

          {/* Search Query */}
          <div className="relative flex items-center gap-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              placeholder={regexMode ? 'Regex...' : 'Search stream...'}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setMatchIdx(0); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); gotoMatch(e.shiftKey ? -1 : 1); } }}
              title={searchError || undefined}
              className={`bg-slate-950 border rounded-lg pl-7 pr-2 py-0.5 text-[11px] text-slate-200 outline-none w-24 @sm:w-32 transition-all ${
                searchError ? 'border-rose-500' : 'border-slate-800 focus:border-cyber-cyan'
              }`}
            />
            <button
              onClick={() => setRegexMode(!regexMode)}
              title="Regular expression search"
              className={`p-1 rounded border text-[10px] font-bold ${regexMode ? 'bg-cyan-500/20 text-cyber-cyan border-cyan-500/40' : 'bg-slate-900 text-slate-500 border-slate-800'}`}
            >
              .*
            </button>
            {searchQuery.trim() && (
              <>
                <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-cyber-amber border border-amber-500/40 text-[10px] font-bold">
                  {searchError ? 'ERR' : matchingIds.length ? `${(((matchIdx % matchingIds.length) + matchingIds.length) % matchingIds.length) + 1}/${totalMatchesCount}` : '0'}
                </span>
                <button onClick={() => gotoMatch(-1)} title="Previous match" className="p-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400"><ChevronUp className="w-3 h-3" /></button>
                <button onClick={() => gotoMatch(1)} title="Next match" className="p-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400"><ChevronDown className="w-3 h-3" /></button>
                <button
                  onClick={() => setFilterToMatches(!filterToMatches)}
                  title="Show only matching rows"
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${filterToMatches ? 'bg-amber-500/10 text-cyber-amber border-amber-500/30' : 'bg-slate-900 text-slate-500 border-slate-800'}`}
                >
                  FILTER
                </button>
              </>
            )}
          </div>

          {/* Timestamps */}
          <button
            onClick={() => setShowTimestamps(!showTimestamps)}
            title="Toggle Timestamps"
            className={`p-1.5 rounded-lg border transition-all ${
              showTimestamps ? 'bg-cyan-500/10 text-cyber-cyan border-cyan-500/30' : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
          </button>

          {/* Stream Direct to Disk Toggle (Zero-drop overnight logger) */}
          {boardId && !isDiskStreaming && (
            <select
              value={diskMode}
              onChange={(e) => setDiskMode(e.target.value)}
              title="Disk log format: raw bytes, timestamped text, or timestamped hex"
              className="bg-slate-950 border border-slate-800 text-[10px] text-slate-400 rounded px-1 py-1 outline-none"
            >
              <option value="raw">RAW</option>
              <option value="text">TEXT+TS</option>
              <option value="hex">HEX+TS</option>
            </select>
          )}
          {boardId && (!isDiskStreaming ? (
            <button
              onClick={handleStartDiskStream}
              title="Stream direct to local disk file (Overnight zero-drop logging)"
              className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-cyber-emerald border border-slate-800 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleStopDiskStream}
              title="Stop streaming to disk"
              className="p-1.5 rounded-lg bg-emerald-500/20 text-cyber-emerald border border-emerald-500/50"
            >
              <StopCircle className="w-3.5 h-3.5 text-cyber-emerald" />
            </button>
          ))}

          {/* Tools drawer */}
          <button
            onClick={() => setShowTools(!showTools)}
            title="Macros, highlight rules, Ctrl keys, send file"
            className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${showTools ? 'bg-cyan-500/20 text-cyber-cyan border-cyan-500/40' : 'bg-slate-900 text-slate-400 border-slate-800'}`}
          >
            TOOLS
          </button>

          {/* Pause */}
          <button
            onClick={() => setIsPaused(!isPaused)}
            title={isPaused ? "Resume Live Stream" : "Pause Stream Buffer"}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] transition-all ${
              isPaused ? 'bg-amber-500/20 text-cyber-amber border-amber-500/50 animate-pulse' : 'bg-slate-900 text-slate-400 border-slate-800'
            }`}
          >
            {isPaused ? <Play className="w-3 h-3 text-cyber-amber" /> : <Pause className="w-3 h-3" />}
            <span className="hidden @sm:inline">{isPaused ? 'PAUSED' : 'PAUSE'}</span>
          </button>

          {/* AutoScroll */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            title="Auto-scroll to bottom"
            className={`p-1.5 rounded-lg border transition-all ${
              autoScroll ? 'bg-emerald-500/10 text-cyber-emerald border-emerald-500/30' : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Export Log or CSV Timeline */}
          {viewMode === 'delta' ? (
            <button
              onClick={handleExportCsvTimeline}
              title="Export Wireshark-Style CSV Timeline with Microsecond Deltas"
              className="p-1.5 rounded-lg bg-slate-900 text-cyber-emerald hover:bg-slate-800 border border-slate-800"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleExportLog}
              title="Export Session Log (.log)"
              className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Clear */}
          <button
            onClick={onClear}
            title="Clear Terminal Buffer"
            className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-rose-400 border border-slate-800"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Output Body */}
      {viewMode === 'delta' ? (
        /* Wireshark-style Timing Delta Table View */
        <div 
          ref={consoleContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto font-mono text-xs select-text bg-[#030712] relative min-h-[220px]"
        >
          <table className="w-full text-left text-[11px] border-collapse">
            <thead className="bg-[#090e1a] text-slate-400 border-b border-slate-800 sticky top-0 z-10 text-[10px] uppercase">
              <tr>
                <th className="p-2 w-24">TIME</th>
                <th className="p-2 w-24 text-emerald-400 font-bold">Δt (DELTA)</th>
                <th className="p-2 w-20">DIR</th>
                <th className="p-2 w-16">LEN</th>
                <th className="p-2">ASCII PAYLOAD</th>
                <th className="p-2 text-slate-500 hidden @md:table-cell">HEX BYTES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 font-mono">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan="6" className="p-8 text-center text-slate-600">
                    No packets captured matching filter.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const isRx = entry.type === 'rx';
                  const isTx = entry.type === 'tx';
                  const hexStr = Array.from(new TextEncoder().encode(entry.text))
                    .slice(0, 16)
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ');

                  return (
                    <tr key={entry.id} id={`sc-row-${entry.id}`} className={`hover:bg-slate-900/40 transition-colors ${entry.id === currentMatchId ? 'bg-amber-500/10' : ''}`}>
                      <td className="p-2 text-slate-500 text-[10px]">{entry.timestamp}</td>
                      <td className="p-2 font-bold text-emerald-400">{formatDelta(entry.deltaMs)}</td>
                      <td className="p-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          isRx ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                          isTx ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' :
                          'bg-slate-800 text-slate-400'
                        }`}>
                          {isRx ? 'RX 🠔' : isTx ? 'TX ➔' : 'SYS'}
                        </span>
                      </td>
                      <td className="p-2 text-slate-400">{entry.text.length} B</td>
                      <td className="p-2 text-slate-200 font-mono break-all">
                        {renderHighlight(entry.text)}
                      </td>
                      <td className="p-2 text-slate-500 text-[10px] font-mono hidden @md:table-cell truncate max-w-xs">
                        {hexStr}{entry.text.length > 16 ? '...' : ''}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div ref={consoleEndRef} />
        </div>
      ) : (
        /* Classic ANSI Stream Output */
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
                  id={`sc-row-${entry.id}`}
                  className={`flex items-start gap-2 leading-relaxed transition-colors hover:bg-slate-900/40 rounded px-1 -mx-1 ${
                    isSys ? 'text-slate-400 italic' : ''
                  } ${matchHighlightRule(highlightRules, entry.text)?.color || ''} ${entry.id === currentMatchId ? 'ring-1 ring-amber-400/60' : ''}`}
                >
                  {showTimestamps && (
                    <span className="text-[10px] text-slate-600 select-none flex-shrink-0 pt-0.5">
                      {entry.timestamp}
                    </span>
                  )}

                  <span className={`select-none text-[10px] font-bold px-1 rounded flex-shrink-0 ${
                    isRx ? 'bg-cyan-950/60 text-cyber-cyan border border-cyan-800/40' :
                    isTx ? 'bg-amber-950/60 text-cyber-amber border border-amber-800/40' :
                    'bg-slate-800 text-slate-400'
                  }`}>
                    {isRx ? 'RX' : isTx ? 'TX' : 'SYS'}
                  </span>

                  <span className="break-all whitespace-pre-wrap flex-1 text-slate-200">
                    {ansiParts ? (
                      ansiParts.map((part, idx) => (
                        <span key={idx} className={part.className}>
                          {renderHighlight(part.text)}
                        </span>
                      ))
                    ) : (
                      renderHighlight(entry.text)
                    )}
                  </span>
                </div>
              );
            })
          )}
          <div ref={consoleEndRef} />
        </div>
      )}

      {/* Tools drawer: Ctrl keys, macros, highlight rules, send file, line ending map */}
      {showTools && (
        <div className="px-3 py-2 bg-[#090e1a] border-t border-cyber-border text-[11px] font-mono flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 text-[10px]">CTRL:</span>
            {CTRL_KEYS.map(k => (
              <button
                key={k.label}
                onClick={() => sendCtrl(k)}
                disabled={!isConnected || !onSendRaw}
                className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-cyber-cyan disabled:opacity-40"
              >
                {k.label}
              </button>
            ))}
            <label className="flex items-center gap-1 text-slate-400 cursor-pointer ml-2" title="Show what you send in the console">
              <input type="checkbox" checked={echoTx} onChange={(e) => setEchoTx(e.target.checked)} />
              Local echo (show TX)
            </label>
            <label className="flex items-center gap-1 text-slate-400">
              RX line end
              <select value={rxEnding} onChange={(e) => setRxEnding(e.target.value)} className="bg-[#030712] border border-slate-800 rounded px-1 py-0.5 text-slate-300">
                <option value="auto">Auto (CR/LF/CRLF)</option>
                <option value="lf">LF</option>
                <option value="cr">CR</option>
                <option value="crlf">CRLF</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 text-[10px]">SEND FILE:</span>
            <select value={fileUnit} onChange={(e) => setFileUnit(e.target.value)} className="bg-[#030712] border border-slate-800 rounded px-1 py-0.5 text-slate-300">
              <option value="char">per char</option>
              <option value="line">per line</option>
            </select>
            <input
              type="number" min="0" value={fileDelay}
              onChange={(e) => setFileDelay(e.target.value)}
              className="w-16 bg-[#030712] border border-slate-800 rounded px-1 py-0.5 text-slate-300"
            />
            <span className="text-slate-500">ms</span>
            {fileProgress ? (
              <>
                <span className="text-cyber-amber">{fileProgress.sent}/{fileProgress.total} B</span>
                <button onClick={cancelSendFile} className="px-2 py-0.5 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300">Cancel</button>
              </>
            ) : (
              <label className={`flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 ${isConnected && onSendRaw ? 'cursor-pointer hover:text-cyber-cyan' : 'opacity-40'}`}>
                <Upload className="w-3 h-3" /> Choose file
                <input type="file" className="hidden" onChange={handleSendFile} disabled={!isConnected || !onSendRaw} />
              </label>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 text-[10px]">MACROS:</span>
            {macros.length === 0 && <span className="text-slate-600">none saved</span>}
            {macros.map(m => (
              <span key={m.id} className="flex items-center rounded bg-slate-900 border border-slate-700 overflow-hidden">
                <button onClick={() => runMacro(m)} disabled={!isConnected} title={m.text} className="px-2 py-0.5 text-slate-300 hover:text-cyber-cyan disabled:opacity-40">{m.name}</button>
                <button onClick={() => persistMacros(macros.filter(x => x.id !== m.id))} title="Delete macro" className="px-1 text-slate-600 hover:text-rose-400"><X className="w-3 h-3" /></button>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input value={macroDraft.name} onChange={(e) => setMacroDraft({ ...macroDraft, name: e.target.value })} placeholder="Name" className="w-24 bg-[#030712] border border-slate-800 rounded px-1.5 py-0.5 text-slate-300" />
            <input value={macroDraft.text} onChange={(e) => setMacroDraft({ ...macroDraft, text: e.target.value })} placeholder="Text (\r \n \xNN escapes ok)" className="flex-1 min-w-[8rem] bg-[#030712] border border-slate-800 rounded px-1.5 py-0.5 text-slate-300" />
            <button onClick={addMacro} className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyber-cyan">Save macro</button>
            <button onClick={handleExportMacros} disabled={macros.length === 0} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400 disabled:opacity-40">Export</button>
            <label className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400 cursor-pointer">
              Import
              <input type="file" accept="application/json,.json" className="hidden" onChange={handleImportMacros} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 text-[10px]">HIGHLIGHT:</span>
            {highlightRules.map(r => (
              <span key={r.id} className={`flex items-center gap-1 rounded px-1.5 py-0.5 border border-slate-700 ${r.color}`}>
                {r.pattern}
                <button onClick={() => saveRules(highlightRules.filter(x => x.id !== r.id))} title="Remove rule"><X className="w-3 h-3" /></button>
              </span>
            ))}
            <input value={ruleDraft} onChange={(e) => setRuleDraft(e.target.value)} placeholder="regex (e.g. error|panic)" className="w-40 bg-[#030712] border border-slate-800 rounded px-1.5 py-0.5 text-slate-300" />
            <button onClick={addRule} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-400">Add rule</button>
          </div>
        </div>
      )}
      {toolMsg && (
        <div className="px-3 py-1 bg-[#090e1a] border-t border-cyber-border text-[10px] text-amber-300 font-mono flex items-center justify-between">
          <span>{toolMsg}</span>
          <button onClick={() => setToolMsg('')} className="text-slate-500 hover:text-slate-300"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* Command Input Bar */}
      <form
        onSubmit={handleTransmit}
        className="p-2.5 bg-[#090e1a] border-t border-cyber-border flex items-center gap-2"
      >
        <span className="text-cyber-amber select-none font-bold text-xs pl-1 animate-cursor">&gt;</span>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected ? "Enter ASCII command or serial string..." : "Connect port to transmit data..."}
          disabled={!isConnected}
          className="flex-1 bg-[#030712] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-cyber-amber font-mono disabled:opacity-50"
        />

        <select
          value={lineEnding}
          onChange={(e) => setLineEnding(e.target.value)}
          className="bg-[#030712] border border-slate-800 text-[11px] font-mono text-slate-300 rounded-lg px-2 py-1.5 outline-none cursor-pointer"
        >
          <option value={'\r\n'}>CRLF (\r\n)</option>
          <option value={'\n'}>LF (\n)</option>
          <option value={'\r'}>CR (\r)</option>
          <option value="">None (Raw)</option>
          <option value="hex">Hex Bytes</option>
        </select>

        <button
          type="submit"
          disabled={!isConnected}
          className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold px-3.5 py-1.5 rounded-lg text-xs font-mono tracking-wider transition-all shadow-amber-glow disabled:opacity-40"
        >
          <span>SEND</span>
          <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
      </form>
    </div>
  );
}
