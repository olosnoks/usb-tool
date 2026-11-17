import React, { useEffect, useRef, useState } from 'react';
import { Music, Piano, Keyboard, Send, Download, Upload, Trash2, Timer, Square, Pause, Play, RefreshCw, Plug } from 'lucide-react';
import {
  describeMessage, createDecodeState, noteName, MESSAGE_CATEGORIES, NOTE_NAMES, OCTAVE_CONVENTIONS,
  parseHexBytes, parseStream, splitSyx, buildSyx, noteOnBytes, noteOffBytes, controlChangeBytes,
  programChangeBytes, identityRequestBytes, latencyStats, keyboardOffset, toHex,
} from '../../utils/midiTools.js';

/**
 * Web MIDI monitor, sender, SysEx librarian and loopback latency test.
 * Everything here reads or writes real MIDI ports the browser exposes; nothing is simulated.
 */

const LOG_LIMIT = 3000;
const SHOW_LIMIT = 400;
const LIB_KEY = 'skon-usb-tool.midi.sysexLibrary.v1';
const LIB_MAX = 200;
const TEST_CHANNEL = 16;
const TEST_NOTE = 60;
const TABS = [['monitor', 'Monitor'], ['send', 'Send'], ['sysex', 'SysEx Library'], ['latency', 'Latency']];

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200';
const btn = 'px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1';
const btnCyan = 'px-2.5 py-1 text-xs rounded border border-cyan-800 bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isMidiSupported = () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';
const fmtTime = (t) => (t === null || t === undefined ? '-' : `${(t / 1000).toFixed(3)}s`);
const fmtMs = (v) => (Number.isFinite(v) ? `${v.toFixed(2)} ms` : '-');

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function portInfo(p) {
  return { id: p.id, name: p.name || '(unnamed)', manufacturer: p.manufacturer || '', state: p.state, connection: p.connection };
}

function loadLibrary() {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(LIB_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLibrary(list) {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

const newEntry = (name, bytes, source, complete = true) => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name, hex: toHex(bytes, ''), length: bytes.length, source, complete, created: new Date().toISOString(),
});

function LogRow({ e, convention }) {
  const text = e.noteName ? e.text.replace(e.noteName, noteName(e.note, convention)) : e.text;
  const raw = e.raw || '';
  return (
    <div className="flex gap-2 py-0.5 border-b border-slate-900 text-[11px] font-mono items-baseline">
      <span className="text-slate-600 w-20 shrink-0 tabular-nums">{fmtTime(e.t)}</span>
      <span className={`w-3 shrink-0 ${e.dir === 'out' ? 'text-amber-300' : 'text-cyan-300'}`} title={e.dir === 'out' ? 'sent' : 'received'}>{e.dir === 'out' ? '>' : '<'}</span>
      <span className="text-slate-500 w-36 shrink-0 truncate" title={e.dir === 'out' ? e.to : e.from}>{e.dir === 'out' ? e.to : e.from}</span>
      <span className="text-slate-500 w-20 shrink-0 truncate">{e.category}</span>
      <span className="text-gray-200 break-all flex-1 min-w-0">{text}</span>
      <span className="text-slate-600 hidden lg:inline shrink-0 max-w-[12rem] truncate" title={raw}>{raw.length > 36 ? `${raw.slice(0, 36)}...` : raw}</span>
    </div>
  );
}

function PortList({ ports, disabledIds, onToggleInput }) {
  const Section = ({ title, list, isInput }) => (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{title} ({list.length})</div>
      {list.length === 0 && <div className="text-xs text-slate-600">None</div>}
      {list.map((p) => (
        <div key={p.id} className="flex items-center gap-2 text-xs py-0.5 min-w-0">
          {isInput && (
            <input type="checkbox" checked={!disabledIds.has(p.id)} onChange={() => onToggleInput(p.id)} aria-label={`Listen to ${p.name}`} />
          )}
          <span className="text-gray-200 truncate" title={p.name}>{p.name}</span>
          <span className="text-slate-500 truncate">{p.manufacturer}</span>
          <span className={`ml-auto shrink-0 text-[10px] ${p.state === 'connected' ? 'text-emerald-400' : 'text-slate-500'}`}>{p.state}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-950 border border-slate-800 rounded p-2">
      <Section title="Inputs (receive)" list={ports.inputs} isInput />
      <Section title="Outputs (send)" list={ports.outputs} isInput={false} />
    </div>
  );
}

function PortSelect({ label, value, onChange, list }) {
  return (
    <label className="text-xs text-slate-400 flex items-center gap-1.5">
      {label}
      <select className={`${inputCls} max-w-[16rem]`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">(none)</option>
        {list.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </label>
  );
}

export default function MidiMonitorWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('monitor');
  const [access, setAccess] = useState(null);
  const [ports, setPorts] = useState({ inputs: [], outputs: [] });
  const [disabledIds, setDisabledIds] = useState(() => new Set());
  const [status, setStatus] = useState('');
  const [outId, setOutId] = useState('');
  const [convention, setConvention] = useState('C4');
  const [paused, setPaused] = useState(false);
  const [channelFilter, setChannelFilter] = useState('all');
  const [hiddenCats, setHiddenCats] = useState(() => new Set());
  const [, setTick] = useState(0);
  const [library, setLibrary] = useState(loadLibrary);
  const [captureOn, setCaptureOn] = useState(true);
  const [hexInput, setHexInput] = useState('');
  const [decoded, setDecoded] = useState(null);
  const [rawHex, setRawHex] = useState('');
  const [ccNum, setCcNum] = useState(7);
  const [ccVal, setCcVal] = useState(100);
  const [pcNum, setPcNum] = useState(0);
  const [channel, setChannel] = useState(1);
  const [baseNote, setBaseNote] = useState(60);
  const [velocity, setVelocity] = useState(100);
  const [sendDelay, setSendDelay] = useState(50);
  const [selected, setSelected] = useState(() => new Set());
  const [sending, setSending] = useState(false);
  const [latIn, setLatIn] = useState('');
  const [latTrials, setLatTrials] = useState(20);
  const [latRunning, setLatRunning] = useState(false);
  const [latSamples, setLatSamples] = useState([]);
  const [latTimeouts, setLatTimeouts] = useState(0);
  const [latProgress, setLatProgress] = useState('');

  // Refs read by long-lived listeners (Web MIDI handlers, window key handlers, async loops).
  const logRef = useRef([]);
  const seqRef = useRef(0);
  const dirtyRef = useRef(false);
  const decodersRef = useRef(new Map());
  const accessRef = useRef(null);
  const outIdRef = useRef('');
  const convRef = useRef(convention);
  const pausedRef = useRef(paused);
  const captureRef = useRef(captureOn);
  const tabRef = useRef(tab);
  const channelRef = useRef(channel);
  const baseRef = useRef(baseNote);
  const velRef = useRef(velocity);
  const sendAbortRef = useRef(false);
  const latAbortRef = useRef(false);
  const latWaitRef = useRef(null);
  const soundingRef = useRef(new Map());
  const keyHeldRef = useRef(new Map());
  accessRef.current = access;
  outIdRef.current = outId;
  convRef.current = convention;
  pausedRef.current = paused;
  captureRef.current = captureOn;
  tabRef.current = tab;
  channelRef.current = channel;
  baseRef.current = baseNote;
  velRef.current = velocity;

  const onLogRef = useRef(onLogMessage);
  onLogRef.current = onLogMessage;
  const say = (text, level = 'info') => {
    setStatus(text);
    if (onLogRef.current) onLogRef.current(text, level);
  };

  const pushLog = (entry) => {
    const arr = logRef.current;
    arr.push({ id: ++seqRef.current, ...entry });
    if (arr.length > LOG_LIMIT) arr.splice(0, arr.length - LOG_LIMIT);
    dirtyRef.current = true;
  };

  const refreshPorts = (acc) => {
    setPorts({
      inputs: [...acc.inputs.values()].map(portInfo),
      outputs: [...acc.outputs.values()].map(portInfo),
    });
  };

  async function enableMidi() {
    if (!isMidiSupported()) {
      say('Web MIDI is not available here. Use a Chromium-based browser (Chrome, Edge, Opera) on https or localhost.', 'error');
      return;
    }
    try {
      // Triggers the browser's MIDI permission prompt. sysex:true also asks for SysEx access.
      const acc = await navigator.requestMIDIAccess({ sysex: true });
      setAccess(acc);
      refreshPorts(acc);
      say(`MIDI access granted: ${acc.inputs.size} input(s), ${acc.outputs.size} output(s), SysEx enabled.`);
    } catch (e) {
      say(`MIDI access failed (${e.name || 'error'}): ${e.message || e}. If you denied the prompt, allow MIDI for this site in the address bar's site settings and try again.`, 'error');
    }
  }

  // Keep the port list current when devices are plugged in or removed.
  useEffect(() => {
    if (!access) return undefined;
    access.onstatechange = () => refreshPorts(access);
    return () => { access.onstatechange = null; };
  }, [access]);

  // Flush buffered log entries to the screen at a fixed rate (clock messages arrive at ~50/s).
  useEffect(() => {
    const id = setInterval(() => {
      if (dirtyRef.current) {
        dirtyRef.current = false;
        setTick((n) => n + 1);
      }
    }, 150);
    return () => clearInterval(id);
  }, []);

  // Persist the sysex library.
  useEffect(() => {
    if (!saveLibrary(library)) say('Could not save the SysEx library to localStorage (storage full?). Export .syx files to keep them.', 'error');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library]);

  // Listen to every enabled input, decoding each message with per-input state.
  useEffect(() => {
    if (!access) return undefined;
    const attached = [];
    for (const input of access.inputs.values()) {
      if (disabledIds.has(input.id)) continue;
      const handler = (e) => {
        const t = e.timeStamp || performance.now();
        const bytes = new Uint8Array(e.data);
        let st = decodersRef.current.get(input.id);
        if (!st) {
          st = createDecodeState();
          decodersRef.current.set(input.id, st);
        }
        const ev = describeMessage(bytes, { t, state: st, noteConvention: convRef.current });
        if (!ev) return;
        if (ev.type === 'sysex' && captureRef.current) {
          const name = `Captured from ${input.name || 'input'} ${new Date().toLocaleTimeString()}`;
          setLibrary((prev) => [newEntry(name, bytes, 'captured', ev.complete), ...prev].slice(0, LIB_MAX));
        }
        if (pausedRef.current) return;
        pushLog({ dir: 'in', from: input.name || 'input', ...ev });
      };
      input.addEventListener('midimessage', handler);
      attached.push([input, handler]);
    }
    return () => attached.forEach(([input, handler]) => input.removeEventListener('midimessage', handler));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access, disabledIds, ports]);

  // Sending helpers. Outgoing messages are echoed into the monitor log as "sent".
  function sendBytes(bytes) {
    const acc = accessRef.current;
    const out = acc && outIdRef.current ? acc.outputs.get(outIdRef.current) : null;
    if (!out) {
      say('Select an output port first (Send tab or header).', 'error');
      return false;
    }
    try {
      out.send(bytes);
    } catch (e) {
      say(`Send failed: ${e.message}`, 'error');
      return false;
    }
    pushLog({ dir: 'out', to: out.name || 'output', ...describeMessage(bytes, { t: performance.now(), noteConvention: convRef.current }) });
    return true;
  }

  function pressNote(token, note) {
    if (soundingRef.current.has(token)) return;
    if (note < 0 || note > 127) return;
    if (sendBytes(noteOnBytes(channelRef.current, note, velRef.current))) soundingRef.current.set(token, note);
  }

  function releaseNote(token) {
    const note = soundingRef.current.get(token);
    if (note === undefined) return;
    soundingRef.current.delete(token);
    const acc = accessRef.current;
    const out = acc && outIdRef.current ? acc.outputs.get(outIdRef.current) : null;
    if (out) {
      try { out.send(noteOffBytes(channelRef.current, note, 0)); } catch { /* port gone */ }
    }
  }

  // Computer keyboard piano (only while the Send tab is open and no text field has focus).
  useEffect(() => {
    const typing = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    const down = (e) => {
      if (tabRef.current !== 'send' || typing(document.activeElement) || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const off = keyboardOffset(e.code);
      if (off === null || keyHeldRef.current.has(e.code)) return;
      const note = baseRef.current + off;
      if (note > 127) return;
      keyHeldRef.current.set(e.code, note);
      pressNote(`key-${e.code}`, note);
    };
    const up = (e) => {
      if (!keyHeldRef.current.has(e.code)) return;
      keyHeldRef.current.delete(e.code);
      releaseNote(`key-${e.code}`);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    const sounding = soundingRef.current;
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      for (const token of [...sounding.keys()]) releaseNote(token);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop any running .syx send or latency test when leaving the page.
  useEffect(() => () => { sendAbortRef.current = true; latAbortRef.current = true; }, []);

  function toggleInput(id) {
    setDisabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleCategory(cat) {
    setHiddenCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  const visibleEntries = () => {
    const all = logRef.current;
    const out = [];
    for (let i = all.length - 1; i >= 0 && out.length < SHOW_LIMIT; i--) {
      const e = all[i];
      if (channelFilter !== 'all' && e.channel !== undefined && e.channel !== channelFilter) continue;
      if (hiddenCats.has(e.category)) continue;
      out.push(e);
    }
    return out;
  };

  const exportLogJson = () => {
    const rows = logRef.current.map(({ id, ...rest }) => rest);
    downloadBlob(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), `midi-log-${Date.now()}.json`);
  };

  // ---- Monitor tab: decode pasted raw bytes (running status handled, no timing) ----
  function decodePasted() {
    try {
      const bytes = parseHexBytes(hexInput);
      const msgs = parseStream(bytes, 0);
      const st = createDecodeState();
      const rows = msgs.map((m) => {
        const ev = describeMessage(m.bytes, { t: null, state: st, noteConvention: convention });
        return { dir: 'in', from: 'pasted bytes', t: null, ...ev, complete: m.complete };
      });
      setDecoded({ rows, count: bytes.length });
      say(`Decoded ${msgs.length} message(s) from ${bytes.length} byte(s). Clock BPM is not estimated here (no timing in pasted data).`);
    } catch (e) {
      setDecoded(null);
      say(`Hex error: ${e.message}`, 'error');
    }
  }

  // ---- Send tab helpers ----
  function sendRawHex() {
    try {
      const bytes = parseHexBytes(rawHex);
      if (bytes.length === 0) { say('Enter some hex bytes first.', 'error'); return; }
      if (bytes[0] !== 0xF0 && bytes[0] < 0x80) { say('The first byte must be a status byte (0x80 or higher).', 'error'); return; }
      if (sendBytes(bytes)) say(`Sent ${bytes.length} byte(s).`);
    } catch (e) {
      say(`Hex error: ${e.message}`, 'error');
    }
  }

  // ---- SysEx library ----
  function setSelectedIds(fn) {
    setSelected((prev) => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
  }

  async function importSyx(file) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const msgs = splitSyx(bytes);
      if (msgs.length === 0) { say(`${file.name}: no SysEx messages (F0...F7) found.`, 'error'); return; }
      const items = msgs.map((m, i) => newEntry(`${file.name} [${i + 1}/${msgs.length}]`, m.bytes, 'file', m.complete));
      setLibrary((prev) => [...items, ...prev].slice(0, LIB_MAX));
      const bad = msgs.filter((m) => !m.complete).length;
      say(`Imported ${msgs.length} SysEx message(s) from ${file.name}${bad ? ` (${bad} truncated: no F7 end byte)` : ''}.`, bad ? 'error' : 'info');
    } catch (e) {
      say(`Import failed: ${e.message}`, 'error');
    }
  }

  function exportEntries(entries, name) {
    const parts = entries.map((en) => parseHexBytes(en.hex));
    if (parts.length === 0) return;
    downloadBlob(new Blob([buildSyx(parts)], { type: 'application/octet-stream' }), name);
  }

  async function sendEntries(entries) {
    if (sending) return;
    const messages = entries.map((en) => parseHexBytes(en.hex));
    if (messages.length === 0) return;
    sendAbortRef.current = false;
    setSending(true);
    let sent = 0;
    try {
      for (let i = 0; i < messages.length; i++) {
        if (sendAbortRef.current) break;
        if (!sendBytes(messages[i])) break;
        sent++;
        if (i < messages.length - 1 && sendDelay > 0) await sleep(sendDelay);
      }
      say(sendAbortRef.current ? `Stopped after ${sent} of ${messages.length} message(s).` : `Sent ${sent} SysEx message(s).`);
    } finally {
      setSending(false);
    }
  }

  // ---- Latency loopback test ----
  function waitForEcho(timeoutMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { latWaitRef.current = null; resolve(null); }, timeoutMs);
      latWaitRef.current = (ts) => { clearTimeout(timer); latWaitRef.current = null; resolve(ts); };
    });
  }

  async function runLatency() {
    const acc = accessRef.current;
    const out = acc && outIdRef.current ? acc.outputs.get(outIdRef.current) : null;
    const inp = acc && latIn ? acc.inputs.get(latIn) : null;
    if (!out || !inp) { say('Pick an output and the input it is cabled (or routed) back to.', 'error'); return; }
    const trials = Math.max(1, Math.min(200, Number(latTrials) || 20));
    latAbortRef.current = false;
    setLatRunning(true);
    setLatSamples([]);
    setLatTimeouts(0);
    const samples = [];
    let timeouts = 0;
    const onMsg = (e) => {
      const b = e.data;
      if (b[0] === (0x90 | (TEST_CHANNEL - 1)) && b[1] === TEST_NOTE && b[2] > 0 && latWaitRef.current) {
        latWaitRef.current(e.timeStamp || performance.now());
      }
    };
    inp.addEventListener('midimessage', onMsg);
    try {
      for (let i = 0; i < trials && !latAbortRef.current; i++) {
        setLatProgress(`Trial ${i + 1} of ${trials}`);
        const sendT = performance.now();
        const echo = waitForEcho(1000);
        out.send(noteOnBytes(TEST_CHANNEL, TEST_NOTE, 100));
        const recvT = await echo;
        out.send(noteOffBytes(TEST_CHANNEL, TEST_NOTE, 0));
        if (recvT === null) timeouts++;
        else samples.push(recvT - sendT);
        setLatSamples([...samples]);
        setLatTimeouts(timeouts);
        await sleep(100);
      }
    } catch (e) {
      say(`Latency test stopped: ${e.message}`, 'error');
    } finally {
      inp.removeEventListener('midimessage', onMsg);
      latWaitRef.current = null;
      setLatRunning(false);
      setLatProgress(latAbortRef.current ? 'Stopped' : 'Done');
    }
  }

  const stats = latencyStats(latSamples);
  const visible = visibleEntries();
  const libSelected = library.filter((en) => selected.has(en.id));
  const outList = ports.outputs;
  const inList = ports.inputs;

  // On-screen keyboard layout: 25 keys from the base note.
  const keyList = [];
  let whiteCount = 0;
  for (let n = baseNote; n < baseNote + 25 && n <= 127; n++) {
    const black = NOTE_NAMES[n % 12].includes('#');
    keyList.push({ n, black, left: black ? whiteCount * 32 - 10 : whiteCount * 32 });
    if (!black) whiteCount++;
  }
  const keyWidth = Math.max(1, whiteCount) * 32;

  return (
    <div className="p-3 space-y-3 text-gray-200 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Music size={18} className="text-rose-400" />
        <h2 className="font-semibold text-base">MIDI Monitor &amp; SysEx Librarian</h2>
        <span className="text-[10px] text-slate-500 border border-slate-800 rounded px-1.5 py-0.5">Web MIDI, Chromium only</span>
        <div className="ml-auto flex items-center gap-2">
          {!access ? (
            <button className={btnCyan} onClick={enableMidi} disabled={!isMidiSupported()}>
              <Plug size={12} /> Enable MIDI
            </button>
          ) : (
            <button className={btn} onClick={() => refreshPorts(access)}><RefreshCw size={12} /> Refresh ports</button>
          )}
          <PortSelect label="Output" value={outId} onChange={setOutId} list={outList} />
        </div>
      </div>

      {!isMidiSupported() && (
        <div className="p-2 border border-amber-900 rounded bg-amber-950/30 text-xs text-amber-200">
          Web MIDI is not available in this browser or context. Use Chrome, Edge or Opera on https:// or localhost.
        </div>
      )}

      {!access && isMidiSupported() && (
        <div className="p-2 border border-slate-800 rounded bg-slate-950 text-xs text-slate-400 space-y-1">
          <div>Clicking <span className="text-cyan-300">Enable MIDI</span> asks the browser for MIDI access. The browser shows a permission prompt; this tool requests SysEx as well, so the prompt covers SysEx receive and send.</div>
          <div>Nothing is read from your MIDI devices until you allow it. If you deny the prompt, allow MIDI again from the site settings icon in the address bar, then press Enable MIDI.</div>
        </div>
      )}

      {access && <PortList ports={ports} disabledIds={disabledIds} onToggleInput={toggleInput} />}

      {status && (
        <div className="text-xs text-slate-400 border-l-2 border-slate-700 pl-2">{status}</div>
      )}

      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs border-b-2 -mb-px ${tab === id ? 'border-rose-400 text-rose-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'monitor' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={() => setPaused((p) => !p)} disabled={!access}>
              {paused ? <><Play size={12} /> Resume</> : <><Pause size={12} /> Pause</>}
            </button>
            <button className={btn} onClick={() => { logRef.current = []; setTick((n) => n + 1); }}><Trash2 size={12} /> Clear</button>
            <button className={btn} onClick={exportLogJson} disabled={logRef.current.length === 0}><Download size={12} /> Export JSON</button>
            <label className="text-xs text-slate-400 flex items-center gap-1">
              Channel
              <select className={inputCls} value={channelFilter} onChange={(e) => setChannelFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">All</option>
                {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400 flex items-center gap-1">
              Note names
              <select className={inputCls} value={convention} onChange={(e) => setConvention(e.target.value)}>
                {Object.values(OCTAVE_CONVENTIONS).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <button className={btn} onClick={() => setHiddenCats(new Set(['clock', 'sensing']))}>Hide clock + sensing</button>
            <button className={btn} onClick={() => setHiddenCats(new Set())}>Show all</button>
            <span className="text-[10px] text-slate-500 ml-auto">{logRef.current.length} stored, showing {visible.length}</span>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {MESSAGE_CATEGORIES.map(([cat, label]) => (
              <label key={cat} className="flex items-center gap-1">
                <input type="checkbox" checked={!hiddenCats.has(cat)} onChange={() => toggleCategory(cat)} />
                {label}
              </label>
            ))}
          </div>
          <div className="text-[10px] text-slate-500">
            Channel filter hides channel messages on other channels; system and SysEx messages always show. Press Pause to freeze the list.
            Clock BPM and RPN assembly are computed from every message even while paused.
          </div>
          {!access && <div className="text-xs text-slate-600">Enable MIDI to start monitoring.</div>}
          <div className="bg-slate-950 border border-slate-800 rounded p-2 h-80 overflow-auto">
            {visible.length === 0 && <div className="text-xs text-slate-600">No messages yet.</div>}
            {visible.map((e) => <LogRow key={e.id} e={e} convention={convention} />)}
          </div>

          <details className="bg-slate-950 border border-slate-800 rounded p-2">
            <summary className="text-xs text-slate-300 cursor-pointer">Decode raw bytes (paste a MIDI byte stream)</summary>
            <div className="mt-2 space-y-2">
              <div className="text-[10px] text-slate-500">
                Hex bytes such as <span className="font-mono">90 3C 64 40 3E 00 F8 F8 F0 7E 7F 06 01 F7</span>. Running status and real-time bytes are handled. No timing is available, so clock BPM is not estimated.
              </div>
              <textarea className={`${inputCls} w-full h-16`} value={hexInput} onChange={(e) => setHexInput(e.target.value)} placeholder="90 3C 64 3E 64 ..." aria-label="Hex byte stream" />
              <button className={btnCyan} onClick={decodePasted} disabled={!hexInput.trim()}>Decode</button>
              {decoded && (
                <div className="max-h-60 overflow-auto">
                  <div className="text-[10px] text-slate-500 mb-1">{decoded.rows.length} message(s) from {decoded.count} byte(s)</div>
                  {decoded.rows.map((r, i) => <LogRow key={i} e={{ ...r, id: i }} convention={convention} />)}
                </div>
              )}
            </div>
          </details>
        </div>
      )}

      {tab === 'send' && (
        <div className="space-y-3">
          {!access && <div className="text-xs text-slate-600">Enable MIDI and pick an output in the header to send.</div>}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1 text-slate-400">
              Channel
              <select className={inputCls} value={channel} onChange={(e) => setChannel(Number(e.target.value))}>
                {Array.from({ length: 16 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1 text-slate-400">
              Base note
              <input type="number" min={0} max={127} className={`${inputCls} w-20`} value={baseNote}
                onChange={(e) => setBaseNote(Math.max(0, Math.min(127, Number(e.target.value) || 0)))} />
              <span className="font-mono text-slate-500">{noteName(baseNote, convention)}</span>
            </label>
            <label className="flex items-center gap-1 text-slate-400">
              Velocity
              <input type="number" min={1} max={127} className={`${inputCls} w-16`} value={velocity}
                onChange={(e) => setVelocity(Math.max(1, Math.min(127, Number(e.target.value) || 1)))} />
            </label>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Piano size={14} /> Note keyboard
              <span className="text-slate-600 ml-auto flex items-center gap-1"><Keyboard size={12} /> computer keys: A W S E D F T G Y H U J K O L P ; (click the window first, not a text box)</span>
            </div>
            <div className="overflow-x-auto">
              <div className="relative select-none" style={{ width: keyWidth, height: 112 }}>
                {keyList.filter((k) => !k.black).map((k) => (
                  <button key={k.n} aria-label={`Note ${noteName(k.n, convention)}`}
                    className="absolute top-0 h-28 w-8 bg-slate-100 border border-slate-400 rounded-b hover:bg-cyan-100 active:bg-cyan-300"
                    style={{ left: k.left }}
                    onPointerDown={(e) => { e.preventDefault(); pressNote(`ptr-${k.n}`, k.n); }}
                    onPointerUp={() => releaseNote(`ptr-${k.n}`)}
                    onPointerLeave={() => releaseNote(`ptr-${k.n}`)}
                    onPointerCancel={() => releaseNote(`ptr-${k.n}`)}
                  />
                ))}
                {keyList.filter((k) => k.black).map((k) => (
                  <button key={k.n} aria-label={`Note ${noteName(k.n, convention)}`}
                    className="absolute top-0 h-16 w-5 bg-slate-900 border border-slate-700 rounded-b z-10 hover:bg-slate-700 active:bg-cyan-700"
                    style={{ left: k.left }}
                    onPointerDown={(e) => { e.preventDefault(); pressNote(`ptr-${k.n}`, k.n); }}
                    onPointerUp={() => releaseNote(`ptr-${k.n}`)}
                    onPointerLeave={() => releaseNote(`ptr-${k.n}`)}
                    onPointerCancel={() => releaseNote(`ptr-${k.n}`)}
                  />
                ))}
              </div>
            </div>
            <div className="text-[10px] text-slate-500">Notes sent with the chosen channel and velocity. Releasing the mouse or a key sends Note Off.</div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
              <div className="text-xs text-slate-400">Control change</div>
              <div className="flex items-center gap-2 text-xs">
                <label className="flex items-center gap-1">CC
                  <input type="number" min={0} max={127} className={`${inputCls} w-16`} value={ccNum}
                    onChange={(e) => setCcNum(Math.max(0, Math.min(127, Number(e.target.value) || 0)))} />
                </label>
                <span className="text-slate-500 truncate">{ccNum}</span>
              </div>
              <input type="range" min={0} max={127} value={ccVal} className="w-full" aria-label="CC value"
                onChange={(e) => { const v = Number(e.target.value); setCcVal(v); sendBytes(controlChangeBytes(channel, ccNum, v)); }} />
              <div className="flex justify-between text-xs text-slate-400">
                <span>value {ccVal}</span>
                <button className={btn} onClick={() => sendBytes(controlChangeBytes(channel, ccNum, ccVal))} disabled={!access}><Send size={11} /> Send</button>
              </div>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
              <div className="text-xs text-slate-400">Program change</div>
              <label className="flex items-center gap-1 text-xs">Program
                <input type="number" min={0} max={127} className={`${inputCls} w-20`} value={pcNum}
                  onChange={(e) => setPcNum(Math.max(0, Math.min(127, Number(e.target.value) || 0)))} />
              </label>
              <button className={btn} onClick={() => sendBytes(programChangeBytes(channel, pcNum))} disabled={!access}><Send size={11} /> Send program change</button>
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
              <div className="text-xs text-slate-400">Universal SysEx</div>
              <button className={btn} onClick={() => sendBytes(identityRequestBytes(0x7F))} disabled={!access}>
                <Send size={11} /> Identity Request (F0 7E 7F 06 01 F7)
              </button>
              <div className="text-[10px] text-slate-500">Devices answer with an Identity Reply, which the monitor decodes (manufacturer, family, model, version).</div>
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2">
            <div className="text-xs text-slate-400">Raw hex (one MIDI message; a SysEx must include F0 ... F7)</div>
            <div className="flex gap-2">
              <input className={`${inputCls} flex-1`} value={rawHex} onChange={(e) => setRawHex(e.target.value)} placeholder="90 3C 7F   or   F0 7E 7F 06 01 F7" aria-label="Raw hex message" />
              <button className={btnCyan} onClick={sendRawHex} disabled={!access || !rawHex.trim()}><Send size={12} /> Send</button>
            </div>
          </div>
        </div>
      )}

      {tab === 'sysex' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1 text-slate-300">
              <input type="checkbox" checked={captureOn} onChange={(e) => setCaptureOn(e.target.checked)} />
              Capture incoming SysEx from listened inputs
            </label>
            <label className={`${btn} cursor-pointer`}>
              <Upload size={12} /> Import .syx
              <input type="file" accept=".syx,application/octet-stream" className="hidden" onChange={(e) => { importSyx(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <button className={btn} onClick={() => exportEntries(libSelected, `midi-sysex-${Date.now()}.syx`)} disabled={libSelected.length === 0}>
              <Download size={12} /> Export selected ({libSelected.length})
            </button>
            <button className={btn} onClick={() => setSelected(new Set(library.map((en) => en.id)))} disabled={library.length === 0}>Select all</button>
            <button className={btn} onClick={() => setSelected(new Set())}>Clear selection</button>
            <button className={btn} onClick={() => setLibrary([])} disabled={library.length === 0}><Trash2 size={12} /> Delete all</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <label className="flex items-center gap-1 text-slate-400">
              Delay between messages
              <input type="number" min={0} max={5000} className={`${inputCls} w-20`} value={sendDelay}
                onChange={(e) => setSendDelay(Math.max(0, Math.min(5000, Number(e.target.value) || 0)))} /> ms
            </label>
            <button className={btnCyan} onClick={() => sendEntries(libSelected)} disabled={!access || sending || libSelected.length === 0}>
              <Send size={12} /> Send selected to output
            </button>
            {sending && <button className={btn} onClick={() => { sendAbortRef.current = true; }}><Square size={12} /> Stop</button>}
            <span className="text-[10px] text-slate-500">Messages go out in list order; each is one F0...F7 message.</span>
          </div>
          <div className="text-[10px] text-slate-500">
            Library is saved in this browser (localStorage, roughly 5 MB total), so large dumps may not fit. Export .syx to keep copies.
          </div>

          {library.length === 0 && <div className="text-xs text-slate-600">Empty. Import a .syx file or capture SysEx from a connected device.</div>}
          <div className="space-y-1 max-h-96 overflow-auto">
            {library.map((en) => (
              <SysexRow key={en.id} en={en}
                checked={selected.has(en.id)}
                onToggle={() => setSelectedIds((s) => { if (s.has(en.id)) s.delete(en.id); else s.add(en.id); })}
                onRename={(name) => setLibrary((prev) => prev.map((x) => (x.id === en.id ? { ...x, name } : x)))}
                onSend={() => sendEntries([en])}
                onExport={() => exportEntries([en], `${en.name.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'dump'}.syx`)}
                onDelete={() => { setLibrary((prev) => prev.filter((x) => x.id !== en.id)); setSelectedIds((s) => { s.delete(en.id); }); }}
                canSend={!!access && !sending}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'latency' && (
        <div className="space-y-3">
          <div className="bg-slate-950 border border-slate-800 rounded p-3 text-xs text-slate-400 space-y-1">
            <div>Loopback round-trip test. The output must be routed back into the input: a MIDI cable from the output port's MIDI OUT to the input's MIDI IN, or a virtual loopback port (for example loopMIDI or the IAC bus) that feeds the same name back.</div>
            <div>Each trial sends Note On {TEST_NOTE} on channel {TEST_CHANNEL}, waits for the same note to come back (1 s timeout), then sends Note Off. Times are measured in the browser from the send call to the event timestamp on receipt, so they include driver, USB and browser scheduling. They are not hardware-grade measurements.</div>
            <div>Without a loopback route every trial times out and no latency is reported.</div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <PortSelect label="Output" value={outId} onChange={setOutId} list={outList} />
            <PortSelect label="Input" value={latIn} onChange={setLatIn} list={inList} />
            <label className="flex items-center gap-1 text-slate-400">
              Trials
              <input type="number" min={1} max={200} className={`${inputCls} w-20`} value={latTrials}
                onChange={(e) => setLatTrials(Number(e.target.value) || 1)} />
            </label>
            {!latRunning
              ? <button className={btnCyan} onClick={runLatency} disabled={!access || !outId || !latIn}><Timer size={12} /> Run loopback test</button>
              : <button className={btn} onClick={() => { latAbortRef.current = true; }}><Square size={12} /> Stop</button>}
            {latProgress && <span className="text-slate-500">{latProgress}</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
            {[['Samples', stats.count ?? 0], ['Timeouts', latTimeouts], ['Min', fmtMs(stats.min)], ['Median', fmtMs(stats.median)], ['Mean', fmtMs(stats.mean)], ['Max', fmtMs(stats.max)], ['Std dev', fmtMs(stats.stdev)]].map(([k, v]) => (
              <div key={k} className="bg-slate-950 border border-slate-800 rounded p-2">
                <div className="text-[10px] text-slate-500">{k}</div>
                <div className="font-mono text-gray-100">{v}</div>
              </div>
            ))}
          </div>
          {latSamples.length > 0 && (
            <div className="font-mono text-[11px] text-slate-400 break-all">
              {latSamples.map((s, i) => `${i + 1}: ${s.toFixed(2)}`).join('   ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SysexRow({ en, checked, onToggle, onRename, onSend, onExport, onDelete, canSend }) {
  const bytes = parseHexBytes(en.hex);
  const info = describeMessage(bytes);
  const manu = info?.manufacturer || info?.text || '';
  return (
    <div className="flex flex-wrap items-center gap-2 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs">
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${en.name}`} />
      <input className={`${inputCls} flex-1 min-w-[12rem]`} value={en.name} onChange={(e) => onRename(e.target.value)} aria-label="Dump name" />
      <span className="text-slate-500 font-mono">{en.length} B</span>
      <span className="text-slate-500 text-[10px] uppercase">{en.source}</span>
      {!en.complete && <span className="text-amber-400 text-[10px]">truncated</span>}
      <span className="text-slate-400 truncate max-w-[18rem]" title={manu}>{manu}</span>
      <div className="ml-auto flex items-center gap-1">
        <button className={btn} onClick={onSend} disabled={!canSend}><Send size={11} /> Send</button>
        <button className={btn} onClick={onExport}><Download size={11} /> .syx</button>
        <button className={btn} onClick={onDelete} aria-label="Delete dump"><Trash2 size={11} /></button>
      </div>
    </div>
  );
}
