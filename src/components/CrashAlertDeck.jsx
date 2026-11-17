import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  ShieldAlert, 
  Volume2, 
  VolumeX, 
  Copy, 
  Check, 
  Trash2, 
  AlertTriangle, 
  Pause, 
  Sliders,
  Sparkles
} from 'lucide-react';
import { alertSynth } from '../utils/audioAlert';

const DEFAULT_PATTERNS = [
  'Guru Meditation Error',
  'Kernel panic',
  'wdt reset',
  'Watchdog Reset',
  'assert failed',
  'HardFault',
  'abort() was called',
  'CORRUPT HEAP'
];

export const TAIL_LIMIT = 4096;

/**
 * Patterns written as /body/flags are regular expressions; anything else is a
 * case-insensitive substring. An invalid regex falls back to text (invalid: true).
 */
export function compilePattern(pattern) {
  const m = /^\/(.+)\/([a-z]*)$/.exec(pattern);
  if (m) {
    try {
      const flags = m[2].replace(/[gy]/g, '');
      return { pattern, kind: 'regex', re: new RegExp(m[1], flags), invalid: false };
    } catch {
      return { pattern, kind: 'text', text: pattern.toLowerCase(), invalid: true };
    }
  }
  return { pattern, kind: 'text', text: pattern.toLowerCase(), invalid: false };
}

/**
 * Scan `chunk` appended to the rolling `tail`. A match only counts if it ends inside
 * the new chunk (matches wholly inside the old tail were already reported), so one
 * panic fires once even though it stays in the buffer, and dumps split across chunks
 * are still found. Returns { tail, hit: { pattern, snippet } | null }.
 */
export function scanChunk(tail, chunk, compiled) {
  const oldLen = tail.length;
  const combined = (tail + chunk).slice(-TAIL_LIMIT * 2);
  const offset = (tail + chunk).length - combined.length; // chars dropped from the front
  const newFrom = Math.max(0, oldLen - offset);
  let hit = null;
  for (const c of compiled) {
    let start = -1; let end = -1;
    if (c.kind === 'regex') {
      const re = new RegExp(c.re.source, c.re.flags + 'g');
      let m;
      while ((m = re.exec(combined))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        if (m.index + m[0].length > newFrom) { start = m.index; end = m.index + m[0].length; break; }
      }
    } else {
      const lower = combined.toLowerCase();
      let from = Math.max(0, newFrom - c.text.length + 1);
      const idx = c.text ? lower.indexOf(c.text, from) : -1;
      if (idx >= 0 && idx + c.text.length > newFrom) { start = idx; end = idx + c.text.length; }
    }
    if (start >= 0 && end > newFrom) {
      hit = { pattern: c.pattern, snippet: combined.slice(Math.max(0, start - 200)).trim() };
      break;
    }
  }
  return { tail: combined.slice(-TAIL_LIMIT), hit };
}

export default function CrashAlertDeck({
  latestTextStream = '',
  onPauseTerminal,
  onLogMessage
}) {
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [customPattern, setCustomPattern] = useState('');
  const [activePatterns, setActivePatterns] = useState(DEFAULT_PATTERNS);
  const [crashHistory, setCrashHistory] = useState([]);
  const [copiedId, setCopiedId] = useState(null);

  const [patternWarning, setPatternWarning] = useState('');
  const lastProcessedTextRef = useRef('');
  const tailRef = useRef('');
  const compiled = useMemo(() => activePatterns.map(compilePattern), [activePatterns]);

  // Monitor incoming stream
  useEffect(() => {
    if (!latestTextStream || latestTextStream === lastProcessedTextRef.current) return;
    lastProcessedTextRef.current = latestTextStream;

    const { tail, hit } = scanChunk(tailRef.current, latestTextStream, compiled);
    tailRef.current = tail;
    if (hit) {
      const pattern = hit.pattern;
      const time = new Date().toTimeString().split(' ')[0] + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
      const newCrash = {
        id: Math.random().toString(36).substring(2, 9),
        time,
        signature: pattern,
        snippet: hit.snippet
      };

      setCrashHistory(prev => [newCrash, ...prev.slice(0, 49)]);

      if (audioEnabled) {
        alertSynth.playCrashAlarm();
      }

      if (autoPauseEnabled && onPauseTerminal) {
        onPauseTerminal(true);
      }

      onLogMessage?.(`[CRASH ALERT] Matched signature "${pattern}" @ ${time}!`, 'sys');
    }
  }, [latestTextStream, compiled, audioEnabled, autoPauseEnabled, onPauseTerminal, onLogMessage]);

  const addCustomPattern = (e) => {
    e.preventDefault();
    if (!customPattern.trim() || activePatterns.includes(customPattern.trim())) return;
    const c = compilePattern(customPattern.trim());
    setPatternWarning(c.invalid ? `Invalid regex "${customPattern.trim()}" - matching it as plain text instead.` : '');
    setActivePatterns(prev => [...prev, customPattern.trim()]);
    setCustomPattern('');
  };

  const removePattern = (pat) => {
    setActivePatterns(prev => prev.filter(p => p !== pat));
  };

  const copyCrashSnippet = (crash) => {
    navigator.clipboard.writeText(crash.snippet);
    setCopiedId(crash.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-500 animate-pulse" />
          <h2 className="font-bold text-slate-100 tracking-wider">HARDWARE CRASH TRIGGER & AUDIO ALERT WATCHER</h2>
        </div>

        {/* Audio & Auto-Freeze Toggles */}
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setAudioEnabled(!audioEnabled)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
              audioEnabled ? 'bg-amber-500/20 text-cyber-amber border-amber-500/40' : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            {audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            <span>Audio Chime</span>
          </button>

          <button
            onClick={() => setAutoPauseEnabled(!autoPauseEnabled)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all ${
              autoPauseEnabled ? 'bg-cyan-500/20 text-cyber-cyan border-cyan-500/40' : 'bg-slate-900 text-slate-500 border-slate-800'
            }`}
          >
            <Pause className="w-3.5 h-3.5" />
            <span>Auto-Pause Terminal</span>
          </button>
        </div>
      </div>

      {/* Active Trigger Signatures */}
      <div className="space-y-1.5">
        <span className="text-[10px] text-slate-500 uppercase font-bold block">
          Active Watchdog Patterns:
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {activePatterns.map((pat) => (
            <span
              key={pat}
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-rose-400"
            >
              <span>{pat}</span>
              <button
                onClick={() => removePattern(pat)}
                className="text-slate-600 hover:text-slate-300 ml-1"
              >
                ✕
              </button>
            </span>
          ))}

          <form onSubmit={addCustomPattern} className="flex items-center">
            <input
              type="text"
              value={customPattern}
              onChange={(e) => setCustomPattern(e.target.value)}
              placeholder="+ text or /regex/i"
              className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-rose-500 w-36"
            />
          </form>
        </div>
        {patternWarning && <div className="text-[10px] text-amber-400">{patternWarning}</div>}
      </div>

      {/* Crash Incident Log Feed */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase font-bold">
          <span>Detected Crash Incidents ({crashHistory.length})</span>
          {crashHistory.length > 0 && (
            <button
              onClick={() => setCrashHistory([])}
              className="text-slate-500 hover:text-rose-400"
            >
              Clear Log
            </button>
          )}
        </div>

        <div className="h-52 overflow-y-auto bg-[#030712] border border-slate-800 rounded-xl p-2.5 flex flex-col gap-2">
          {crashHistory.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-600 gap-1 select-none">
              <ShieldAlert className="w-6 h-6 text-slate-800" />
              <span>No crashes detected. Monitoring active UART stream...</span>
            </div>
          ) : (
            crashHistory.map((crash) => (
              <div
                key={crash.id}
                className="bg-rose-950/20 border border-rose-500/40 rounded-lg p-2.5 flex flex-col gap-1 text-[11px]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 text-[10px]">{crash.time}</span>
                    <span className="font-bold text-rose-400 uppercase bg-rose-950/80 px-1.5 py-0.2 rounded border border-rose-500/30">
                      {crash.signature}
                    </span>
                  </div>

                  <button
                    onClick={() => copyCrashSnippet(crash)}
                    className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
                  >
                    {copiedId === crash.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedId === crash.id ? 'COPIED' : 'COPY DUMP'}</span>
                  </button>
                </div>

                <pre className="text-slate-300 font-mono text-[10px] whitespace-pre-wrap break-all bg-slate-950/70 p-1.5 rounded border border-slate-900">
                  {crash.snippet}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
