import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ShieldAlert, Volume2, VolumeX, Copy, Check, Pause, Bell, BellOff, Download, Terminal } from 'lucide-react';
import { alertSynth } from '../utils/audioAlert';
import { useSerial } from '../context/SerialContext';
import {
  PATTERN_PRESETS, mergePatterns, extractAddresses, buildAddr2line, extractExceptionCause,
  shouldAct, formatLogText, formatLogJson, TOOLCHAINS
} from '../utils/crashAlertUtils';

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
const PATTERNS_KEY = 'usb-tool.alerts.patterns';

function loadPatterns() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PATTERNS_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')) return parsed;
  } catch { /* ignore */ }
  return DEFAULT_PATTERNS;
}

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
  onPauseTerminal,
  onLogMessage
}) {
  const { subscribeRx } = useSerial();
  const [audioEnabled, setAudioEnabled] = useState(true);
  const [autoPauseEnabled, setAutoPauseEnabled] = useState(true);
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const [contextLines, setContextLines] = useState(5);
  const [customPattern, setCustomPattern] = useState('');
  const [activePatterns, setActivePatterns] = useState(loadPatterns);
  const [crashHistory, setCrashHistory] = useState([]);
  const [counters, setCounters] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [cooldownSec, setCooldownSec] = useState(0);
  const [toolchain, setToolchain] = useState('esp32');
  const [elfPath, setElfPath] = useState('build/firmware.elf');
  const lastActRef = useRef(null);

  const [patternWarning, setPatternWarning] = useState('');
  const tailRef = useRef('');
  const pendingContextRef = useRef(null); // { id, remaining } while capturing lines after a hit
  const compiled = useMemo(() => activePatterns.map(compilePattern), [activePatterns]);

  // The receive callback outlives renders, so it reads the latest settings through a ref.
  const liveRef = useRef({});
  liveRef.current = { compiled, audioEnabled, autoPauseEnabled, notifyEnabled, contextLines, cooldownSec, onPauseTerminal, onLogMessage };

  useEffect(() => {
    try { localStorage.setItem(PATTERNS_KEY, JSON.stringify(activePatterns)); } catch { /* storage unavailable */ }
  }, [activePatterns]);

  // Title flash while the tab is hidden and an alert is unread.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const original = document.title;
    let timer = null;
    const stop = () => { clearInterval(timer); timer = null; document.title = original; };
    const start = () => {
      if (timer || !document.hidden) return;
      let on = false;
      timer = setInterval(() => { on = !on; document.title = on ? '\u26a0 CRASH ALERT' : original; }, 800);
    };
    const onVisible = () => { if (!document.hidden) stop(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('usb-tool-crash-alert', start);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('usb-tool-crash-alert', start);
      stop();
    };
  }, []);

  // Monitor every received chunk (unbatched), so nothing is dropped between renders and
  // identical consecutive chunks are each scanned.
  useEffect(() => {
    if (!subscribeRx) return undefined;
    const decoder = new TextDecoder();
    return subscribeRx((bytes) => {
      const text = decoder.decode(bytes, { stream: true });
      if (!text) return;
      const live = liveRef.current;

      // Capture "N lines after" a previous hit into that incident.
      const pend = pendingContextRef.current;
      if (pend && pend.remaining > 0) {
        let taken = '';
        for (const ch of text) {
          if (pend.remaining <= 0) break;
          taken += ch;
          if (ch === '\n') pend.remaining -= 1;
        }
        if (taken) setCrashHistory((prev) => prev.map((c) => (c.id === pend.id ? { ...c, snippet: c.snippet + taken } : c)));
        if (pend.remaining <= 0) pendingContextRef.current = null;
      }

      const { tail, hit } = scanChunk(tailRef.current, text, live.compiled);
      tailRef.current = tail;
      if (!hit) return;

      const now = new Date();
      const time = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
      const id = Math.random().toString(36).substring(2, 9);
      const crash = { id, time, signature: hit.pattern, snippet: hit.snippet };
      setCrashHistory(prev => [crash, ...prev.slice(0, 49)]);
      setCounters(prev => ({ ...prev, [hit.pattern]: (prev[hit.pattern] || 0) + 1 }));
      pendingContextRef.current = live.contextLines > 0 ? { id, remaining: live.contextLines } : null;

      const act = shouldAct(lastActRef.current, now.getTime(), live.cooldownSec);
      if (act) lastActRef.current = now.getTime();
      if (act && live.audioEnabled) alertSynth.playCrashAlarm();
      if (act && live.autoPauseEnabled && live.onPauseTerminal) live.onPauseTerminal(true);
      live.onLogMessage?.(`[CRASH ALERT] Matched signature "${hit.pattern}" @ ${time}!${act ? '' : ' (cooldown: no alarm)'}`, 'sys');

      if (typeof document !== 'undefined' && document.hidden) {
        if (live.notifyEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification('Crash alert', { body: `Matched "${hit.pattern}"` }); } catch { /* unsupported context */ }
        }
        try { window.dispatchEvent(new Event('usb-tool-crash-alert')); } catch { /* no window */ }
      }
    });
  }, [subscribeRx]);

  const toggleNotifications = async () => {
    if (notifyEnabled) { setNotifyEnabled(false); return; }
    if (typeof Notification === 'undefined') {
      setPatternWarning('Desktop notifications are not supported in this browser.');
      return;
    }
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission === 'granted') { setNotifyEnabled(true); setPatternWarning(''); }
    else setPatternWarning('Notification permission was not granted.');
  };

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

  const addPreset = (name) => {
    if (!PATTERN_PRESETS[name]) return;
    setActivePatterns((prev) => mergePatterns(prev, PATTERN_PRESETS[name]));
  };

  const downloadLog = (kind) => {
    const body = kind === 'json' ? formatLogJson(crashHistory) : formatLogText(crashHistory);
    const blob = new Blob([body], { type: kind === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `crash-log-${new Date().toISOString().replace(/[:.]/g, '-')}.${kind === 'json' ? 'json' : 'txt'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copyAddr2line = (crash) => {
    const addrs = extractAddresses(crash.snippet);
    if (!addrs.length) return;
    navigator.clipboard.writeText(buildAddr2line(addrs, { toolchain, elf: elfPath }));
    setCopiedId(`a2l-${crash.id}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const copyCrashSnippet = (crash) => {
    navigator.clipboard.writeText(crash.snippet);
    setCopiedId(crash.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const tgl = (on, cls) => `flex items-center gap-1 px-2 py-1 rounded-lg border transition-all ${on ? cls : 'bg-slate-900 text-slate-500 border-slate-800'}`;
  const inp = 'bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-300 outline-none focus:border-rose-500';

  return (
    <div className="flex flex-col gap-2 font-mono text-xs">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => setAudioEnabled(!audioEnabled)}
          aria-pressed={audioEnabled}
          title="Play an alarm when a pattern matches"
          className={tgl(audioEnabled, 'bg-amber-500/20 text-cyber-amber border-amber-500/40')}
        >
          {audioEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>Audio Chime</span>
        </button>

        <button
          onClick={toggleNotifications}
          aria-pressed={notifyEnabled}
          title="Desktop notification when an alert fires while this tab is hidden"
          className={tgl(notifyEnabled, 'bg-rose-500/20 text-rose-300 border-rose-500/40')}
        >
          {notifyEnabled ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
          <span>Notify</span>
        </button>

        <button
          onClick={() => setAutoPauseEnabled(!autoPauseEnabled)}
          aria-pressed={autoPauseEnabled}
          title="Pause the terminal when a pattern matches"
          className={tgl(autoPauseEnabled, 'bg-cyan-500/20 text-cyber-cyan border-cyan-500/40')}
        >
          <Pause className="w-3.5 h-3.5" />
          <span>Auto-Pause Terminal</span>
        </button>

        <label className="flex items-center gap-1 text-[11px] text-slate-400" title="Lines captured after a match">
          <span>+</span>
          <input
            type="number"
            min={0}
            max={50}
            value={contextLines}
            onChange={(e) => setContextLines(Math.max(0, Math.min(50, Number(e.target.value) || 0)))}
            aria-label="Lines of context after a match"
            className={`w-12 ${inp}`}
          />
          <span>lines</span>
        </label>

        <label className="flex items-center gap-1 text-[11px] text-slate-400" title="After an alarm, further matches within this many seconds are logged but do not sound the alarm or pause the terminal. 0 = off.">
          <span>cooldown</span>
          <input
            type="number"
            min={0}
            max={600}
            value={cooldownSec}
            onChange={(e) => setCooldownSec(Math.max(0, Math.min(600, Number(e.target.value) || 0)))}
            aria-label="Alarm cooldown in seconds"
            className={`w-12 ${inp}`}
          />
          <span>s</span>
        </label>
      </div>

      {/* Active Trigger Signatures */}
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-500 uppercase font-bold">
          <span className="flex items-center gap-1"><ShieldAlert className="w-3 h-3 text-rose-500" />Watchdog patterns</span>
          <select
            value=""
            onChange={(e) => addPreset(e.target.value)}
            aria-label="Add a preset pattern set"
            className={`${inp} normal-case font-normal text-[11px]`}
          >
            <option value="">+ Add preset...</option>
            {Object.keys(PATTERN_PRESETS).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {activePatterns.map((pat) => (
            <span
              key={pat}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-[11px] text-rose-400"
            >
              <span>{pat}</span>
              {counters[pat] > 0 && (
                <span className="px-1 rounded bg-rose-950 text-rose-300 text-[10px]" title="Times matched">{counters[pat]}</span>
              )}
              <button
                onClick={() => removePattern(pat)}
                aria-label={`Remove pattern ${pat}`}
                title="Remove pattern"
                className="text-slate-600 hover:text-slate-300 ml-0.5"
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
              aria-label="Add a text or /regex/ pattern"
              placeholder="+ text or /regex/i"
              className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-xs text-slate-200 outline-none focus:border-rose-500 w-36"
            />
          </form>
        </div>
        {patternWarning && <div className="text-[10px] text-amber-400">{patternWarning}</div>}
      </div>

      {/* addr2line settings (collapsed) */}
      <details className="text-[11px] text-slate-400">
        <summary className="cursor-pointer select-none text-[10px] uppercase font-bold text-slate-500">Symbol lookup command (addr2line)</summary>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <label className="flex items-center gap-1">
            <span>toolchain</span>
            <select value={toolchain} onChange={(e) => setToolchain(e.target.value)} aria-label="addr2line toolchain" className={inp}>
              {Object.entries(TOOLCHAINS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 min-w-0 flex-1">
            <span>ELF</span>
            <input
              type="text"
              value={elfPath}
              onChange={(e) => setElfPath(e.target.value)}
              aria-label="Path to the firmware ELF file"
              className={`${inp} min-w-0 flex-1`}
            />
          </label>
        </div>
        <p className="pt-1 text-[10px] text-slate-500">
          An incident card shows an ADDR2LINE button when its dump contains code addresses. It copies a command for you to run locally; the browser does not resolve symbols.
        </p>
      </details>

      {/* Crash Incident Log Feed */}
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-[10px] text-slate-500 uppercase font-bold">
          <span>Detected Crash Incidents ({crashHistory.length})</span>
          {crashHistory.length > 0 && (
            <span className="flex items-center gap-2">
              <button onClick={() => downloadLog('txt')} title="Download the log as a text file" className="flex items-center gap-1 hover:text-slate-200">
                <Download className="w-3 h-3" />TXT
              </button>
              <button onClick={() => downloadLog('json')} title="Download the log as JSON" className="flex items-center gap-1 hover:text-slate-200">
                <Download className="w-3 h-3" />JSON
              </button>
              <button onClick={() => setCrashHistory([])} className="hover:text-rose-400">
                Clear Log
              </button>
            </span>
          )}
        </div>

        <div className="max-h-[60vh] min-h-24 overflow-y-auto bg-[#030712] border border-slate-800 rounded-lg p-2 flex flex-col gap-2">
          {crashHistory.length === 0 ? (
            <div className="py-6 flex flex-col items-center justify-center text-slate-600 gap-1 select-none">
              <ShieldAlert className="w-5 h-5 text-slate-800" />
              <span>No crashes detected. Monitoring active UART stream...</span>
            </div>
          ) : (
            crashHistory.map((crash) => {
              const cause = extractExceptionCause(crash.snippet);
              const hasAddrs = extractAddresses(crash.snippet).length > 0;
              return (
                <div
                  key={crash.id}
                  className="bg-rose-950/20 border border-rose-500/40 rounded-lg p-2 flex flex-col gap-1 text-[11px]"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-slate-500 text-[10px]">{crash.time}</span>
                      <span className="font-bold text-rose-400 uppercase bg-rose-950/80 px-1.5 rounded border border-rose-500/30">
                        {crash.signature}
                      </span>
                      {cause && <span className="text-[10px] text-amber-400" title="Exception cause from the Guru Meditation line">{cause}</span>}
                    </div>

                    <div className="flex items-center gap-2">
                      {hasAddrs && (
                        <button
                          onClick={() => copyAddr2line(crash)}
                          title="Copy an addr2line command for the addresses in this dump (run it locally)"
                          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
                        >
                          {copiedId === `a2l-${crash.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Terminal className="w-3 h-3" />}
                          <span>{copiedId === `a2l-${crash.id}` ? 'COPIED' : 'ADDR2LINE'}</span>
                        </button>
                      )}
                      <button
                        onClick={() => copyCrashSnippet(crash)}
                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
                      >
                        {copiedId === crash.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedId === crash.id ? 'COPIED' : 'COPY DUMP'}</span>
                      </button>
                    </div>
                  </div>

                  <pre className="text-slate-300 font-mono text-[10px] whitespace-pre-wrap break-all bg-slate-950/70 p-1.5 rounded border border-slate-900">
                    {crash.snippet}
                  </pre>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
