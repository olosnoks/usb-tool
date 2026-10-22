import React, { useState, useEffect, useRef } from 'react';
import { 
  Bot, 
  Play, 
  Square, 
  Bell, 
  BellOff, 
  Plus, 
  Trash2, 
  Clock, 
  Zap, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  Volume2, 
  VolumeX, 
  Cpu
} from 'lucide-react';

const DEFAULT_RULES = [
  { id: 'rule-1', name: 'AT Ping-Pong', match: 'AT', isRegex: false, response: 'OK\\r\\n', delayMs: 50, enabled: true, triggerCount: 0 },
  { id: 'rule-2', name: 'Heartbeat Ping', match: 'PING', isRegex: false, response: 'PONG\\r\\n', delayMs: 20, enabled: true, triggerCount: 0 },
  { id: 'rule-3', name: 'Status Query', match: 'STATUS\\?', isRegex: true, response: 'STATUS:OK,TEMP=24.5C\\r\\n', delayMs: 100, enabled: false, triggerCount: 0 }
];

export default function AutoResponderDeck({
  isConnected,
  latestRxText,
  onSendString,
  onLogMessage,
  boards = [],
  activeBoardId = 'board-1',
  onSelectBoard
}) {
  // Rules State
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleMatch, setNewRuleMatch] = useState('');
  const [newRuleResponse, setNewRuleResponse] = useState('');
  const [newRuleDelay, setNewRuleDelay] = useState(50);
  const [newRuleIsRegex, setNewRuleIsRegex] = useState(false);

  // Alarms State
  const [alarmKeywords, setAlarmKeywords] = useState('PANIC, HardFault, CORRUPT, Watchdog, Exception');
  const [alarmSoundEnabled, setAlarmSoundEnabled] = useState(true);
  const [activeAlarms, setActiveAlarms] = useState([]);
  const [lastAlarmTime, setLastAlarmTime] = useState(null);

  // Periodic Heartbeat Pulse State
  const [heartbeatActive, setHeartbeatActive] = useState(false);
  const [heartbeatIntervalMs, setHeartbeatIntervalMs] = useState(1000);
  const [heartbeatPayload, setHeartbeatPayload] = useState('POLL:SEQ={seq}\\r\\n');
  const [heartbeatSeq, setHeartbeatSeq] = useState(1);
  const [heartbeatSentCount, setHeartbeatSentCount] = useState(0);

  const audioContextRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const processedTextRef = useRef('');

  // Sound synthesizer for alarms
  const playAlarmTone = () => {
    if (!alarmSoundEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.26);
    } catch {
      // Audio playback restrictions or fallback
    }
  };

  // Inspect incoming text stream for auto-reply rules and alarms
  useEffect(() => {
    if (!latestRxText || latestRxText === processedTextRef.current) return;
    const newChunk = latestRxText.slice(processedTextRef.current.length);
    processedTextRef.current = latestRxText;

    if (!newChunk) return;

    // 1. Evaluate Alarm Keywords
    const keywords = alarmKeywords.split(',').map(k => k.trim()).filter(Boolean);
    for (const kw of keywords) {
      if (newChunk.toUpperCase().includes(kw.toUpperCase())) {
        const time = new Date().toLocaleTimeString();
        playAlarmTone();
        setLastAlarmTime(time);
        setActiveAlarms(prev => [
          { id: Date.now(), keyword: kw, time, snippet: newChunk.slice(0, 80) },
          ...prev.slice(0, 19)
        ]);
        onLogMessage?.(`[ALARM TRIGGERED] Pattern "${kw}" detected in serial stream!`, 'err');
      }
    }

    // 2. Evaluate Auto-Responder Rules
    rules.forEach((rule, idx) => {
      if (!rule.enabled || !isConnected) return;
      let matched = false;

      if (rule.isRegex) {
        try {
          const regex = new RegExp(rule.match, 'i');
          matched = regex.test(newChunk);
        } catch {
          // invalid regex
        }
      } else {
        matched = newChunk.includes(rule.match);
      }

      if (matched) {
        // Increment trigger counter
        setRules(prev => {
          const updated = [...prev];
          updated[idx] = { ...updated[idx], triggerCount: updated[idx].triggerCount + 1 };
          return updated;
        });

        // Parse escape characters (e.g. \r\n)
        const unescaped = rule.response
          .replace(/\\r/g, '\r')
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t');

        setTimeout(() => {
          onSendString?.(unescaped);
          onLogMessage?.(`[AUTO-REPLY] Rule "${rule.name}" triggered: Sent "${rule.response}"`, 'tx');
        }, rule.delayMs || 0);
      }
    });
  }, [latestRxText, rules, isConnected, alarmKeywords, alarmSoundEnabled]);

  // Periodic Heartbeat Pulse loop
  useEffect(() => {
    if (!heartbeatActive || !isConnected) {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      return;
    }

    heartbeatTimerRef.current = setInterval(() => {
      setHeartbeatSeq(seq => {
        const currentSeq = seq;
        const payloadToSend = heartbeatPayload
          .replace(/\{seq\}/g, String(currentSeq))
          .replace(/\\r/g, '\r')
          .replace(/\\n/g, '\n');

        onSendString?.(payloadToSend);
        setHeartbeatSentCount(c => c + 1);
        return currentSeq + 1;
      });
    }, Math.max(50, heartbeatIntervalMs));

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    };
  }, [heartbeatActive, heartbeatIntervalMs, heartbeatPayload, isConnected]);

  const handleAddRule = (e) => {
    e.preventDefault();
    if (!newRuleName || !newRuleMatch || !newRuleResponse) return;
    const rule = {
      id: `rule-${Date.now()}`,
      name: newRuleName,
      match: newRuleMatch,
      isRegex: newRuleIsRegex,
      response: newRuleResponse,
      delayMs: Number(newRuleDelay) || 0,
      enabled: true,
      triggerCount: 0
    };
    setRules([...rules, rule]);
    setNewRuleName('');
    setNewRuleMatch('');
    setNewRuleResponse('');
  };

  const handleDeleteRule = (id) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const handleToggleRule = (id) => {
    setRules(rules.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  return (
    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-slate-200 text-xs font-mono space-y-4">
      {/* Top Header & Target Board Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-purple-400" />
          <div>
            <h2 className="font-bold text-sm text-slate-100 uppercase tracking-wider flex items-center gap-2">
              AUTO-RESPONDER & TRIGGER ALARMS
              <span className="text-[10px] px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                DOCKLIGHT / SERIALTOOL ENGINE
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Rule-based automatic responses, panic alarm acoustic synthesis, and periodic pulse scheduler.
            </p>
          </div>
        </div>

        {boards.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-bold">TARGET:</span>
            <select
              value={activeBoardId}
              onChange={(e) => onSelectBoard?.(e.target.value)}
              className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-cyber-cyan font-bold"
            >
              {boards.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Rules Table & Add Rule Form */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-300 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-purple-400" />
              AUTO-REPLY RULES ({rules.filter(r => r.enabled).length} ACTIVE)
            </span>
            <span className="text-[10px] text-slate-500">
              {isConnected ? '● ENGINE ARMED' : '○ DISCONNECTED (REPLIES PAUSED)'}
            </span>
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="p-2 w-12 text-center">ON</th>
                  <th className="p-2">RULE NAME</th>
                  <th className="p-2">MATCH PATTERN</th>
                  <th className="p-2">RESPONSE PAYLOAD</th>
                  <th className="p-2 w-16">DELAY</th>
                  <th className="p-2 w-16 text-center">HITS</th>
                  <th className="p-2 w-12 text-center">DEL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {rules.map(rule => (
                  <tr key={rule.id} className={rule.enabled ? 'bg-slate-900/40 hover:bg-slate-800/40' : 'opacity-40 hover:bg-slate-900/20'}>
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={() => handleToggleRule(rule.id)}
                        className="accent-purple-500 rounded cursor-pointer"
                      />
                    </td>
                    <td className="p-2 font-bold text-slate-200">{rule.name}</td>
                    <td className="p-2 text-purple-300">
                      <code className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800">
                        {rule.match}
                      </code>
                      {rule.isRegex && <span className="ml-1 text-[9px] text-slate-500">REGEX</span>}
                    </td>
                    <td className="p-2 text-cyber-cyan">
                      <code className="bg-slate-950 px-1 py-0.5 rounded border border-slate-800">
                        {rule.response}
                      </code>
                    </td>
                    <td className="p-2 text-slate-400">{rule.delayMs}ms</td>
                    <td className="p-2 text-center">
                      <span className="px-1.5 py-0.5 rounded bg-purple-950/80 text-purple-300 font-bold border border-purple-800/60">
                        {rule.triggerCount}
                      </span>
                    </td>
                    <td className="p-2 text-center">
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="text-slate-500 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add New Rule Form */}
          <form onSubmit={handleAddRule} className="bg-slate-900/50 p-3 rounded-xl border border-slate-800 space-y-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Plus className="w-3.5 h-3.5 text-purple-400" />
              CREATE NEW AUTO-ANSWER TRIGGER
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-xs">
              <input
                type="text"
                placeholder="Rule Name (e.g. Echo Ack)"
                value={newRuleName}
                onChange={e => setNewRuleName(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none"
              />
              <input
                type="text"
                placeholder="Match pattern (e.g. PING)"
                value={newRuleMatch}
                onChange={e => setNewRuleMatch(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-purple-300 font-mono outline-none"
              />
              <input
                type="text"
                placeholder="Reply payload (e.g. PONG\r\n)"
                value={newRuleResponse}
                onChange={e => setNewRuleResponse(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-cyber-cyan font-mono outline-none"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Delay ms"
                  value={newRuleDelay}
                  onChange={e => setNewRuleDelay(e.target.value)}
                  className="w-16 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 outline-none"
                />
                <button
                  type="submit"
                  className="flex-1 bg-purple-600 hover:bg-purple-500 text-white font-bold py-1 px-3 rounded flex items-center justify-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  ADD
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newRuleIsRegex}
                  onChange={e => setNewRuleIsRegex(e.target.checked)}
                  className="accent-purple-500 rounded"
                />
                <span>Treat pattern as Regular Expression (RegEx)</span>
              </label>
              <span className="text-slate-600">|</span>
              <span className="text-slate-500">Supports escape sequences like \r, \n, and \t</span>
            </div>
          </form>
        </div>

        {/* Right Column: Trigger Alarms & Periodic Heartbeat Scheduler */}
        <div className="space-y-4">
          {/* Panic / Error Alarms */}
          <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Bell className="w-4 h-4 text-rose-500" />
                TRIGGER ALARMS & PANIC DETECTOR
              </span>
              <button
                onClick={() => setAlarmSoundEnabled(!alarmSoundEnabled)}
                title={alarmSoundEnabled ? "Disable acoustic alarm" : "Enable acoustic alarm"}
                className={`p-1 rounded border transition-colors ${
                  alarmSoundEnabled 
                    ? 'bg-rose-950/60 text-rose-300 border-rose-800' 
                    : 'bg-slate-950 text-slate-500 border-slate-800'
                }`}
              >
                {alarmSoundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                Alarm Watchlist (Comma Separated):
              </label>
              <input
                type="text"
                value={alarmKeywords}
                onChange={e => setAlarmKeywords(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-rose-400 font-mono text-[11px] outline-none"
              />
            </div>

            {activeAlarms.length > 0 ? (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>DETECTED EVENTS ({activeAlarms.length})</span>
                  <button onClick={() => setActiveAlarms([])} className="text-rose-400 hover:underline">
                    CLEAR
                  </button>
                </div>
                {activeAlarms.slice(0, 5).map(alarm => (
                  <div key={alarm.id} className="p-1.5 rounded bg-rose-950/40 border border-rose-900/60 text-[10px] flex items-start gap-1.5 animate-pulse">
                    <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
                    <div className="truncate">
                      <span className="text-rose-300 font-bold">[{alarm.time}] MATCH: {alarm.keyword}</span>
                      <p className="text-slate-400 truncate font-mono">{alarm.snippet}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-2.5 rounded bg-slate-950/60 border border-slate-800/80 text-center text-[10px] text-slate-500">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
                No panic/fault keywords detected in active stream.
              </div>
            )}
          </div>

          {/* Periodic Pulse / Heartbeat Generator */}
          <div className="bg-slate-900/60 p-3.5 rounded-xl border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-cyber-cyan" />
                PERIODIC PULSE / HEARTBEAT
              </span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                heartbeatActive ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-950 text-slate-500'
              }`}>
                {heartbeatActive ? 'TRANSMITTING' : 'IDLE'}
              </span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={heartbeatPayload}
                  onChange={e => setHeartbeatPayload(e.target.value)}
                  placeholder="Payload (e.g. POLL:SEQ={seq}\r\n)"
                  className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-cyber-cyan font-mono text-[11px] outline-none"
                />
                <input
                  type="number"
                  value={heartbeatIntervalMs}
                  onChange={e => setHeartbeatIntervalMs(Number(e.target.value))}
                  placeholder="Interval (ms)"
                  className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-300 font-mono text-[11px] outline-none"
                />
                <span className="text-slate-500 text-[10px]">ms</span>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                <span>Sent: <strong className="text-cyber-cyan">{heartbeatSentCount}</strong> | Seq: <strong className="text-purple-400">{heartbeatSeq}</strong></span>
                <button
                  onClick={() => setHeartbeatActive(!heartbeatActive)}
                  disabled={!isConnected}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded font-bold transition-all ${
                    !isConnected 
                      ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500'
                      : heartbeatActive 
                        ? 'bg-rose-600 hover:bg-rose-500 text-white' 
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  }`}
                >
                  {heartbeatActive ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {heartbeatActive ? 'STOP PULSE' : 'START PULSE'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
