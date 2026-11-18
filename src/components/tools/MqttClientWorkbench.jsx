import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Radio, Send, Pause, Play, Trash2, Download, Save, Eraser, Copy } from 'lucide-react';
import {
  MqttClient, brokerUrlError, mixedContentWarning, topicFilterError, topicNameError,
  loadProfiles, saveProfiles, prettyJson, hexDump, payloadToText, bytesToBase64, toBytes, parseHex,
  parseBase64, diffLines, mqttxCommand,
} from '../../utils/mqttClient.js';

/**
 * MQTT 3.1.1 client over WebSocket. Browsers cannot open raw TCP, so the broker must expose
 * MQTT on a WebSocket listener (ws:// or wss://). Everything shown comes from the broker
 * connection; nothing is simulated.
 */

const MAX_MESSAGES = 1000;
const MAX_TOPICS = 5000;
const MAX_QUEUE = 5000;
const MAX_PUB_HISTORY = 8;
const FLUSH_MS = 250;
const PUBLIC_BROKER_HOSTS = ['broker.hivemq.com', 'test.mosquitto.org'];

const PRESETS = [
  { name: 'HiveMQ public (wss)', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'Mosquitto test (wss)', url: 'wss://test.mosquitto.org:8081' },
  { name: 'Local Mosquitto (ws)', url: 'ws://localhost:9001' },
];

const FILTER_CHIPS = ['#', 'homeassistant/#', 'tele/#', 'stat/#', 'zigbee2mqtt/#', '$SYS/#'];

const HINTS = [
  {
    title: 'Home Assistant',
    body: 'The MQTT integration reads discovery configs under homeassistant/<component>/.../config and the state topics those configs name. Subscribe to homeassistant/# to see discovery, or to a device state topic to watch its values.',
    filters: ['homeassistant/#'],
  },
  {
    title: 'Tasmota',
    body: 'Tasmota publishes telemetry to tele/<topic>/SENSOR and tele/<topic>/LWT (Online or Offline), and command results to stat/<topic>/RESULT. Commands go to cmnd/<topic>/<Command>, for example cmnd/plug/POWER with payload ON, OFF or TOGGLE.',
    filters: ['tele/#', 'stat/#'],
  },
  {
    title: 'zigbee2mqtt',
    body: 'zigbee2mqtt publishes device state as JSON under zigbee2mqtt/<friendly name>, and bridge information under zigbee2mqtt/bridge/#. Control a device by publishing JSON such as {"state":"ON"} to zigbee2mqtt/<friendly name>/set.',
    filters: ['zigbee2mqtt/#'],
  },
];

const inputCls = 'w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-700';
const btnCls = 'px-2.5 py-1 rounded text-xs border border-slate-700 bg-slate-800 hover:bg-slate-700 text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1';
const cardCls = 'bg-slate-950 border border-slate-800 rounded p-2.5 min-w-0';
const labelCls = 'block text-[10px] uppercase tracking-wide text-slate-500 mb-0.5';
const STATE_STYLE = {
  connected: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
  connecting: 'bg-amber-900/40 text-amber-300 border-amber-800',
  disconnected: 'bg-slate-800 text-slate-400 border-slate-700',
};

const newClientId = () => `usbtool-${Math.random().toString(16).slice(2, 10)}`;
const defaultForm = () => ({
  url: PRESETS[0].url, clientId: newClientId(), username: '', password: '', savePassword: false,
  keepAlive: '60', cleanSession: true,
  willOn: false, willTopic: '', willMessage: '', willQos: 0, willRetain: false,
});

const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour12: false });

function looksBinary(bytes) {
  const n = Math.min(bytes.length, 256);
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if ((b < 0x09) || (b > 0x0d && b < 0x20) || b === 0x7f) ctrl++;
  }
  return n > 0 && ctrl / n > 0.1;
}

function previewText(bytes) {
  if (bytes.length === 0) return '(empty payload)';
  if (looksBinary(bytes)) return `<binary, ${bytes.length} bytes>`;
  return payloadToText(bytes.subarray(0, 300)).replace(/\s+/g, ' ').slice(0, 160);
}

function foldTopics(prev, batch) {
  let next = null;
  let size = prev.size;
  for (const m of batch) {
    if (m.direction !== 'in') continue;
    const cur = prev.get(m.topic);
    if (!cur && size >= MAX_TOPICS) continue;
    if (!next) next = new Map(prev);
    if (!cur) size++;
    next.set(m.topic, {
      topic: m.topic,
      count: (cur?.count ?? 0) + 1,
      last: m,
      prev: cur?.last ?? null,
      firstSeen: cur?.firstSeen ?? m.time,
    });
  }
  return next ?? prev;
}

function buildTopicRows(entries) {
  const root = { name: '', children: new Map(), entry: null };
  for (const e of entries) {
    let node = root;
    for (const part of e.topic.split('/')) {
      if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map(), entry: null });
      node = node.children.get(part);
    }
    node.entry = e;
  }
  const rows = [];
  const walk = (node, depth, prefix) => {
    const kids = [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const k of kids) {
      const full = prefix ? `${prefix}/${k.name}` : k.name;
      rows.push({ depth, name: k.name, full, entry: k.entry });
      walk(k, depth + 1, full);
    }
  };
  walk(root, 0, '');
  return rows;
}

function PayloadView({ bytes, mode }) {
  if (bytes.length === 0) return <div className="text-[11px] text-slate-500 italic">Empty payload</div>;
  if (mode === 'hex') {
    return <pre className="whitespace-pre overflow-auto max-h-64 text-[11px] font-mono text-gray-300">{hexDump(bytes)}</pre>;
  }
  if (mode === 'json') {
    const pretty = prettyJson(bytes);
    if (pretty !== null) return <pre className="whitespace-pre-wrap break-all max-h-64 overflow-auto text-[11px] font-mono text-emerald-200">{pretty}</pre>;
    return (
      <>
        <div className="text-[10px] text-amber-400 mb-1">Not valid JSON; showing the text.</div>
        <pre className="whitespace-pre-wrap break-all max-h-64 overflow-auto text-[11px] font-mono text-gray-200">{payloadToText(bytes)}</pre>
      </>
    );
  }
  return <pre className="whitespace-pre-wrap break-all max-h-64 overflow-auto text-[11px] font-mono text-gray-200">{looksBinary(bytes) ? `${hexDump(bytes, 256)}` : payloadToText(bytes)}</pre>;
}

function TopicDiff({ entry }) {
  if (!entry) return null;
  const now = payloadToText(entry.last.payload);
  if (!entry.prev) {
    return <div className="text-[11px] text-slate-500">Only one message seen on this topic so far, nothing to compare.</div>;
  }
  const before = prettyJson(entry.prev.payload) ?? payloadToText(entry.prev.payload);
  const after = prettyJson(entry.last.payload) ?? now;
  const lines = diffLines(before, after);
  const changed = lines.some((l) => l.type !== 'same');
  return (
    <div>
      <div className="text-[10px] text-slate-500 mb-1">
        Previous ({fmtTime(entry.prev.time)}) vs latest ({fmtTime(entry.last.time)}){changed ? '' : ': identical'}
      </div>
      <pre className="whitespace-pre-wrap break-all max-h-48 overflow-auto text-[11px] font-mono">
        {lines.map((l, i) => (
          <div key={i} className={l.type === 'add' ? 'bg-emerald-900/30 text-emerald-200' : l.type === 'del' ? 'bg-red-900/30 text-red-300' : 'text-gray-400'}>
            {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}{l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}

function MessageRow({ m, mode }) {
  const out = m.direction === 'out';
  return (
    <details className="border-b border-slate-900 py-1">
      <summary className="cursor-pointer flex items-center gap-2 text-[11px] font-mono min-w-0">
        <span className="text-slate-600 shrink-0">{fmtTime(m.time)}</span>
        <span className={`shrink-0 px-1 rounded text-[9px] ${out ? 'bg-amber-900/40 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{out ? 'OUT' : 'IN'}</span>
        <span className="text-cyan-300 shrink-0 max-w-[40%] truncate">{m.topic}</span>
        <span className="text-slate-500 shrink-0">QoS {m.qos}</span>
        {m.retain && <span className="shrink-0 px-1 rounded text-[9px] bg-purple-900/50 text-purple-300">RET</span>}
        <span className="text-gray-400 truncate min-w-0">{previewText(m.payload)}</span>
      </summary>
      <div className="mt-1 ml-4 bg-slate-900 rounded p-2">
        <PayloadView bytes={m.payload} mode={mode} />
      </div>
    </details>
  );
}

function Hints({ onPick }) {
  return (
    <div className="space-y-2">
      {HINTS.map((h) => (
        <div key={h.title} className="text-[11px] text-gray-400">
          <div className="text-gray-200 font-semibold">{h.title}</div>
          <div className="leading-snug">{h.body}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {h.filters.map((f) => (
              <button key={f} onClick={() => onPick(f)} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-cyan-300">
                subscribe {f}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MqttClientWorkbench({ onLogMessage } = {}) {
  const [form, setForm] = useState(defaultForm);
  const [profiles, setProfiles] = useState([]);
  const [profileName, setProfileName] = useState('');
  const [status, setStatus] = useState({ state: 'disconnected', detail: '' });
  const [error, setError] = useState('');
  const [subs, setSubs] = useState([]);
  const subsRef = useRef(subs);
  subsRef.current = subs;
  const [subFilter, setSubFilter] = useState('');
  const [subQos, setSubQos] = useState(0);
  const [messages, setMessages] = useState([]);
  const [topics, setTopics] = useState(() => new Map());
  const [queued, setQueued] = useState(0);
  const [dropped, setDropped] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const queueRef = useRef([]);
  const droppedRef = useRef(0);
  const [view, setView] = useState('log');
  const [search, setSearch] = useState('');
  const [payloadMode, setPayloadMode] = useState('text');
  const [pubTopic, setPubTopic] = useState('');
  const [pubPayload, setPubPayload] = useState('');
  const [pubFormat, setPubFormat] = useState('text');
  const [pubQos, setPubQos] = useState(0);
  const [pubRetain, setPubRetain] = useState(false);
  const [pubResult, setPubResult] = useState(null);
  const [saveName, setSaveName] = useState('');
  const [selTopic, setSelTopic] = useState('');
  const [pubHistory, setPubHistory] = useState([]);
  const [cliCopied, setCliCopied] = useState('');
  const [sessionLog, setSessionLog] = useState([]);
  const clientRef = useRef(null);

  // Profiles are read from localStorage after mount only (no storage access during render).
  useEffect(() => {
    setProfiles(loadProfiles(typeof window !== 'undefined' ? window.localStorage : undefined));
  }, []);

  // Incoming and outgoing messages are queued and applied in batches, so a busy broker does not re-render per packet.
  useEffect(() => {
    const id = setInterval(() => {
      setDropped(droppedRef.current);
      if (pausedRef.current) {
        setQueued(queueRef.current.length);
        return;
      }
      if (queueRef.current.length === 0) return;
      const batch = queueRef.current;
      queueRef.current = [];
      setQueued(0);
      setMessages((prev) => {
        const all = prev.concat(batch);
        return all.length > MAX_MESSAGES ? all.slice(all.length - MAX_MESSAGES) : all;
      });
      setTopics((prev) => foldTopics(prev, batch));
    }, FLUSH_MS);
    return () => {
      clearInterval(id);
      clientRef.current?.disconnect();
    };
  }, []);

  const enqueue = (m) => {
    if (queueRef.current.length >= MAX_QUEUE) {
      droppedRef.current += 1;
      return;
    }
    queueRef.current.push(m);
  };

  const logLine = (text, level = 'info') => {
    setSessionLog((prev) => [...prev.slice(-199), { t: Date.now(), text, level }]);
    try {
      onLogMessage?.(`MQTT: ${text}`, level);
    } catch {
      /* the host log is optional */
    }
  };

  const setField = (k) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
  };

  const applySubscription = async (client, filter, qos) => {
    setSubs((prev) => prev.map((s) => (s.filter === filter ? { ...s, status: 'pending' } : s)));
    try {
      const r = await client.subscribe(filter, qos);
      if (clientRef.current !== client) return;
      setSubs((prev) => prev.map((s) => (s.filter === filter ? { ...s, status: r.failed ? 'refused' : 'active', granted: r.granted } : s)));
      logLine(r.failed ? `Broker refused subscription to ${filter}` : `Subscribed to ${filter} (granted QoS ${r.granted})`, r.failed ? 'warn' : 'info');
    } catch (e) {
      if (clientRef.current !== client) return;
      setSubs((prev) => prev.map((s) => (s.filter === filter ? { ...s, status: 'failed' } : s)));
      logLine(`Subscribe to ${filter} failed: ${e.message}`, 'error');
    }
  };

  const connect = async () => {
    setError('');
    const url = form.url.trim();
    const urlErr = brokerUrlError(url);
    if (urlErr) {
      setError(urlErr);
      return;
    }
    const keepAlive = Number(form.keepAlive);
    if (!Number.isInteger(keepAlive) || keepAlive < 0 || keepAlive > 65535) {
      setError('Keep-alive must be a whole number of seconds from 0 to 65535');
      return;
    }
    const will = form.willOn && form.willTopic.trim()
      ? { topic: form.willTopic.trim(), payload: form.willMessage, qos: Number(form.willQos), retain: form.willRetain }
      : null;
    clientRef.current?.disconnect();
    const client = new MqttClient({
      url,
      clientId: form.clientId.trim(),
      username: form.username || undefined,
      password: form.password || undefined,
      keepAlive,
      cleanSession: form.cleanSession,
      will,
      onStatus: (state, detail) => {
        if (clientRef.current !== client) return;
        setStatus({ state, detail: detail ?? '' });
        if (state === 'connected') {
          for (const s of subsRef.current) applySubscription(client, s.filter, s.qos);
        }
        if (state === 'disconnected') {
          setSubs((prev) => prev.map((s) => ({ ...s, status: 'inactive', granted: null })));
        }
      },
      onMessage: enqueue,
      onLog: logLine,
    });
    clientRef.current = client;
    try {
      await client.connect();
    } catch (e) {
      setError(e.message);
    }
  };

  const disconnect = () => {
    clientRef.current?.disconnect();
  };

  const addSubscription = () => {
    const filter = subFilter.trim();
    const err = topicFilterError(filter);
    if (err) {
      setError(err);
      return;
    }
    if (subsRef.current.some((s) => s.filter === filter)) {
      setError(`Already subscribed to ${filter}`);
      return;
    }
    setError('');
    setSubs((prev) => [...prev, { filter, qos: subQos, granted: null, status: 'inactive' }]);
    setSubFilter('');
    const client = clientRef.current;
    if (client && client.state === 'connected') applySubscription(client, filter, subQos);
  };

  const removeSubscription = (filter) => {
    setSubs((prev) => prev.filter((s) => s.filter !== filter));
    const client = clientRef.current;
    if (client && client.state === 'connected') {
      client.unsubscribe(filter).catch((e) => logLine(`Unsubscribe ${filter} failed: ${e.message}`, 'error'));
    }
  };

  const publish = async () => {
    const client = clientRef.current;
    setPubResult(null);
    if (!client || client.state !== 'connected') {
      setPubResult({ ok: false, text: 'Not connected' });
      return;
    }
    const topic = pubTopic.trim();
    const topicErr = topicNameError(topic);
    if (topicErr) {
      setPubResult({ ok: false, text: topicErr });
      return;
    }
    let bytes;
    try {
      bytes = pubFormat === 'hex' ? parseHex(pubPayload) : pubFormat === 'base64' ? parseBase64(pubPayload) : toBytes(pubPayload);
    } catch (e) {
      setPubResult({ ok: false, text: e.message });
      return;
    }
    try {
      const r = await client.publish(topic, bytes, { qos: pubQos, retain: pubRetain });
      setPubHistory((h) => {
        const item = { topic, payload: pubPayload, format: pubFormat, qos: pubQos, retain: pubRetain };
        const key = (x) => `${x.topic}|${x.payload}|${x.format}|${x.qos}|${x.retain}`;
        return [item, ...h.filter((x) => key(x) !== key(item))].slice(0, MAX_PUB_HISTORY);
      });
      enqueue({ direction: 'out', topic, payload: bytes, qos: pubQos, retain: pubRetain, dup: false, time: Date.now() });
      setPubResult({
        ok: true,
        text: `Published to ${topic} (QoS ${pubQos}${pubRetain ? ', retained' : ''}${pubQos ? `, packet ${r.packetId}` : ''})`,
      });
    } catch (e) {
      setPubResult({ ok: false, text: e.message });
    }
  };

  // Publishing an empty retained message is how MQTT removes a retained message from the broker.
  const clearRetained = async () => {
    const client = clientRef.current;
    setPubResult(null);
    const topic = pubTopic.trim();
    const topicErr = topicNameError(topic);
    if (!client || client.state !== 'connected') return setPubResult({ ok: false, text: 'Not connected' });
    if (topicErr) return setPubResult({ ok: false, text: topicErr });
    try {
      await client.publish(topic, new Uint8Array(0), { qos: 1, retain: true });
      enqueue({ direction: 'out', topic, payload: new Uint8Array(0), qos: 1, retain: true, dup: false, time: Date.now() });
      setPubResult({ ok: true, text: `Cleared retained message on ${topic}` });
    } catch (e) {
      setPubResult({ ok: false, text: e.message });
    }
  };

  const loadHistory = (h) => {
    setPubTopic(h.topic);
    setPubPayload(h.payload);
    setPubFormat(h.format);
    setPubQos(h.qos);
    setPubRetain(h.retain);
  };

  const copyCli = async (kind) => {
    const text = mqttxCommand(kind, {
      url: form.url.trim(), clientId: form.clientId.trim(), username: form.username,
      filters: subs.map((s) => s.filter), qos: subQos,
      topic: pubTopic.trim(), payload: pubPayload, retain: pubRetain,
    });
    if (!text) {
      setError(kind === 'sub' ? 'Need a ws:// or wss:// broker URL to build the command' : 'Need a ws:// or wss:// URL and a publish topic to build the command');
      return;
    }
    setError('');
    try {
      await navigator.clipboard.writeText(text);
      setCliCopied(kind);
    } catch {
      setError(`Clipboard unavailable. Command: ${text}`);
    }
  };

  const clearAll = () => {
    queueRef.current = [];
    droppedRef.current = 0;
    setQueued(0);
    setDropped(0);
    setMessages([]);
    setTopics(new Map());
  };

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
  };

  const download = (name, text, type) => {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportJson = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      broker: form.url.trim(),
      note: 'Passwords are never included. Only messages currently in the log are exported.',
      messages: messages.map((m) => ({
        time: new Date(m.time).toISOString(),
        direction: m.direction,
        topic: m.topic,
        qos: m.qos,
        retain: !!m.retain,
        text: payloadToText(m.payload),
        base64: bytesToBase64(m.payload),
      })),
    };
    download(`mqtt-log-${Date.now()}.json`, JSON.stringify(data, null, 2), 'application/json');
  };

  // -- profiles ----------------------------------------------------------

  const saveProfile = () => {
    const name = saveName.trim();
    if (!name) {
      setError('Give the profile a name first');
      return;
    }
    const profile = { ...form, name };
    const next = [...profiles.filter((p) => p.name !== name), profile].sort((a, b) => a.name.localeCompare(b.name));
    saveProfiles(typeof window !== 'undefined' ? window.localStorage : undefined, next);
    setProfiles(loadProfiles(typeof window !== 'undefined' ? window.localStorage : undefined));
    setProfileName(name);
    setSaveName('');
    setError('');
    if (!form.savePassword && form.password) {
      logLine('Profile saved without the password (tick "remember password" to store it)', 'info');
    }
  };

  const loadProfile = (name) => {
    const p = profiles.find((x) => x.name === name);
    setProfileName(name);
    if (!p) return;
    setForm({
      ...defaultForm(),
      ...p,
      clientId: p.clientId || newClientId(),
      password: p.savePassword ? p.password ?? '' : '',
    });
  };

  const deleteProfile = () => {
    const next = profiles.filter((p) => p.name !== profileName);
    saveProfiles(typeof window !== 'undefined' ? window.localStorage : undefined, next);
    setProfiles(next);
    setProfileName('');
  };

  // -- derived view data ---------------------------------------------------

  const q = search.trim().toLowerCase();
  const visibleMessages = useMemo(() => {
    const list = q
      ? messages.filter((m) => m.topic.toLowerCase().includes(q) || payloadToText(m.payload).toLowerCase().includes(q))
      : messages;
    return list.slice(-500).reverse();
  }, [messages, q]);

  const topicRows = useMemo(() => {
    const entries = [...topics.values()].filter((e) => !q || e.topic.toLowerCase().includes(q) || payloadToText(e.last.payload).toLowerCase().includes(q));
    return buildTopicRows(entries);
  }, [topics, q]);

  const connected = status.state === 'connected';
  const mixed = typeof window !== 'undefined' ? mixedContentWarning(window.location.protocol, form.url) : null;
  const publicBroker = PUBLIC_BROKER_HOSTS.some((h) => form.url.includes(h));

  return (
    <div className="space-y-2 text-gray-200 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Radio size={14} className="text-emerald-400" aria-hidden="true" />
        <h2 className="sr-only">MQTT Client</h2>
        <span className={`px-1.5 py-0.5 rounded text-[10px] border font-mono ${STATE_STYLE[status.state] ?? STATE_STYLE.disconnected}`}>
          {status.state.toUpperCase()}
        </span>
        <div className="ml-auto flex gap-2">
          {!connected && status.state !== 'connecting' && (
            <button onClick={connect} className={`${btnCls} !bg-emerald-900/50 !border-emerald-800 text-emerald-200`}>Connect</button>
          )}
          {(connected || status.state === 'connecting') && (
            <button onClick={disconnect} className={btnCls}>Disconnect</button>
          )}
        </div>
      </div>

      {error && <div className="p-2 rounded border border-red-900 bg-red-950/30 text-xs text-red-300">{error}</div>}
      {mixed && <div className="p-2 rounded border border-amber-900 bg-amber-950/30 text-xs text-amber-300">{mixed}</div>}
      {publicBroker && (
        <div className="p-2 rounded border border-slate-800 bg-slate-900 text-[11px] text-slate-400">
          Public test broker: anyone can subscribe to <span className="font-mono">#</span> and read what you publish. Use unique topics and never send secrets.
        </div>
      )}
      {status.state === 'disconnected' && status.detail && (
        <div className="text-[11px] text-slate-500 font-mono">Last: {status.detail}</div>
      )}

      <div className="grid grid-cols-1 @lg:grid-cols-[300px_minmax(0,1fr)] gap-2">
        <div className="space-y-2 min-w-0">
          <div className={cardCls}>
            <div className="text-xs font-semibold mb-1.5">Connection</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {PRESETS.map((p) => (
                <button key={p.url} onClick={() => setForm((f) => ({ ...f, url: p.url }))} className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 hover:bg-slate-700 text-gray-400">
                  {p.name}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              <div>
                <span className={labelCls}>Broker URL (WebSocket)</span>
                <input aria-label="Broker URL" value={form.url} onChange={setField('url')} spellCheck={false} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className={labelCls}>Client id</span>
                  <input aria-label="Client id" value={form.clientId} onChange={setField('clientId')} className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>Keep-alive (s)</span>
                  <input aria-label="Keep-alive" value={form.keepAlive} onChange={setField('keepAlive')} className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>User name</span>
                  <input aria-label="User name" value={form.username} onChange={setField('username')} autoComplete="off" className={inputCls} />
                </div>
                <div>
                  <span className={labelCls}>Password</span>
                  <input aria-label="Password" type="password" value={form.password} onChange={setField('password')} autoComplete="new-password" className={inputCls} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-gray-400">
                <input type="checkbox" checked={form.cleanSession} onChange={setField('cleanSession')} /> Clean session
              </label>
              <label className="flex items-center gap-2 text-[11px] text-gray-400">
                <input type="checkbox" checked={form.savePassword} onChange={setField('savePassword')} />
                Remember password in this browser (plain text in localStorage)
              </label>
              <label className="flex items-center gap-2 text-[11px] text-gray-400">
                <input type="checkbox" checked={form.willOn} onChange={setField('willOn')} /> Last will (sent by the broker if we drop)
              </label>
              {form.willOn && (
                <div className="space-y-2 pl-4 border-l border-slate-800">
                  <input aria-label="Will topic" placeholder="will topic" value={form.willTopic} onChange={setField('willTopic')} className={inputCls} />
                  <input aria-label="Will message" placeholder="will message" value={form.willMessage} onChange={setField('willMessage')} className={inputCls} />
                  <div className="flex items-center gap-3 text-[11px] text-gray-400">
                    <label>QoS
                      <select aria-label="Will QoS" value={form.willQos} onChange={setField('willQos')} className="ml-1 bg-slate-900 border border-slate-800 rounded text-xs">
                        <option value={0}>0</option><option value={1}>1</option><option value={2}>2</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1"><input type="checkbox" checked={form.willRetain} onChange={setField('willRetain')} /> retain</label>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-3 pt-3 border-t border-slate-800 space-y-2">
              <span className={labelCls}>Profiles</span>
              <div className="flex gap-1">
                <select aria-label="Saved profile" value={profileName} onChange={(e) => loadProfile(e.target.value)} className="flex-1 min-w-0 bg-slate-900 border border-slate-800 rounded text-xs px-1 py-1">
                  <option value="">{profiles.length ? 'Choose a profile...' : 'No saved profiles'}</option>
                  {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
                </select>
                <button onClick={deleteProfile} disabled={!profileName} className={btnCls}>Delete</button>
              </div>
              <div className="flex gap-1">
                <input aria-label="Profile name" placeholder="profile name" value={saveName} onChange={(e) => setSaveName(e.target.value)} className={inputCls} />
                <button onClick={saveProfile} className={btnCls}><Save size={12} /> Save</button>
              </div>
            </div>
          </div>

          <details className={cardCls}>
            <summary className="cursor-pointer text-xs font-semibold">Home Assistant, Tasmota, zigbee2mqtt</summary>
            <div className="mt-2"><Hints onPick={(f) => setSubFilter(f)} /></div>
          </details>
        </div>

        <div className="space-y-2 min-w-0">
          <div className={cardCls}>
            <div className="text-xs font-semibold mb-1.5">Subscriptions</div>
            <div className="flex flex-wrap gap-2 items-center">
              <input aria-label="Topic filter" placeholder="topic/filter/#" value={subFilter} onChange={(e) => setSubFilter(e.target.value)} spellCheck={false} className={`${inputCls} flex-1 min-w-[10rem]`} onKeyDown={(e) => e.key === 'Enter' && addSubscription()} />
              <select aria-label="Subscribe QoS" value={subQos} onChange={(e) => setSubQos(Number(e.target.value))} className="bg-slate-900 border border-slate-800 rounded text-xs px-1 py-1">
                <option value={0}>QoS 0</option><option value={1}>QoS 1</option><option value={2}>QoS 2</option>
              </select>
              <button onClick={addSubscription} className={btnCls}>Subscribe</button>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {FILTER_CHIPS.map((f) => (
                <button key={f} onClick={() => setSubFilter(f)} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-gray-400">{f}</button>
              ))}
            </div>
            <div className="mt-2 divide-y divide-slate-900">
              {subs.length === 0 && <div className="text-[11px] text-slate-500 py-1">No subscriptions. Subscriptions are re-sent automatically after each connect.</div>}
              {subs.map((s) => (
                <div key={s.filter} className="flex items-center gap-2 py-1 text-xs font-mono min-w-0">
                  <span className="text-cyan-300 truncate flex-1 min-w-0">{s.filter}</span>
                  <span className="text-slate-500 shrink-0">req QoS {s.qos}</span>
                  <span className="text-slate-500 shrink-0">{s.granted !== null && s.granted !== undefined ? `granted ${s.granted}` : ''}</span>
                  <span className={`shrink-0 text-[10px] ${s.status === 'active' ? 'text-emerald-300' : s.status === 'failed' || s.status === 'refused' ? 'text-red-300' : 'text-slate-500'}`}>{s.status}</span>
                  <button onClick={() => removeSubscription(s.filter)} aria-label={`Unsubscribe ${s.filter}`} className="text-slate-500 hover:text-red-300"><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          </div>

          <div className={cardCls}>
            <div className="text-xs font-semibold mb-1.5">Publish</div>
            <div className="grid grid-cols-1 @md:grid-cols-[1fr_auto] gap-2">
              <input aria-label="Publish topic" placeholder="topic (no + or #)" value={pubTopic} onChange={(e) => setPubTopic(e.target.value)} spellCheck={false} className={inputCls} />
              <div className="flex gap-2 items-center text-[11px] text-gray-400">
                <select aria-label="Payload format" value={pubFormat} onChange={(e) => setPubFormat(e.target.value)} className="bg-slate-900 border border-slate-800 rounded text-xs px-1 py-1">
                  <option value="text">text</option><option value="hex">hex</option><option value="base64">base64</option>
                </select>
                <select aria-label="Publish QoS" value={pubQos} onChange={(e) => setPubQos(Number(e.target.value))} className="bg-slate-900 border border-slate-800 rounded text-xs px-1 py-1">
                  <option value={0}>QoS 0</option><option value={1}>QoS 1</option><option value={2}>QoS 2</option>
                </select>
                <label className="flex items-center gap-1"><input type="checkbox" checked={pubRetain} onChange={(e) => setPubRetain(e.target.checked)} /> retain</label>
              </div>
            </div>
            <textarea aria-label="Publish payload" placeholder={pubFormat === 'hex' ? 'de ad be ef' : pubFormat === 'base64' ? '3q2+7w==' : 'payload'} value={pubPayload} onChange={(e) => setPubPayload(e.target.value)} rows={2} spellCheck={false} className={`${inputCls} mt-2`} />
            <div className="flex items-center gap-3 mt-2">
              <button onClick={publish} disabled={!connected} className={btnCls}><Send size={12} /> Publish</button>
              <button onClick={clearRetained} disabled={!connected} title="Publish an empty retained message to the topic above, which removes the retained message from the broker" className={btnCls}><Eraser size={12} /> Clear retained</button>
              {!connected && <span className="text-[11px] text-slate-500">Connect first.</span>}
              {pubResult && <span className={`text-[11px] font-mono ${pubResult.ok ? 'text-emerald-300' : 'text-red-300'}`}>{pubResult.text}</span>}
            </div>
            {pubHistory.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1" aria-label="Publish history">
                <span className="text-[10px] uppercase text-slate-500">Recent</span>
                {pubHistory.map((h, i) => (
                  <button key={i} onClick={() => loadHistory(h)} title={`${h.topic}: ${h.payload}`} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 hover:bg-slate-700 text-gray-300 max-w-[12rem] truncate">
                    {h.topic}
                  </button>
                ))}
              </div>
            )}
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-slate-400">Copy as MQTTX CLI command</summary>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                <button onClick={() => copyCli('sub')} className={btnCls}><Copy size={12} /> mqttx sub</button>
                <button onClick={() => copyCli('pub')} className={btnCls}><Copy size={12} /> mqttx pub</button>
                {cliCopied && <span className="text-emerald-300">Copied {cliCopied} command</span>}
                <span>Text for the MQTTX CLI (npm i -g @emqx/mqttx-cli). Not run here; the password is a placeholder.</span>
              </div>
            </details>
          </div>
        </div>
      </div>

      <div className={cardCls}>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <div className="inline-flex rounded border border-slate-800 overflow-hidden text-xs">
            <button onClick={() => setView('log')} className={`px-2.5 py-1 ${view === 'log' ? 'bg-slate-700 text-gray-100' : 'bg-slate-900 text-gray-400'}`}>Log</button>
            <button onClick={() => setView('tree')} className={`px-2.5 py-1 ${view === 'tree' ? 'bg-slate-700 text-gray-100' : 'bg-slate-900 text-gray-400'}`}>Topic tree ({topics.size})</button>
          </div>
          <input aria-label="Filter messages" placeholder="filter topic or payload" value={search} onChange={(e) => setSearch(e.target.value)} className={`${inputCls} flex-1 min-w-[10rem] max-w-sm`} />
          <select aria-label="Payload view" value={payloadMode} onChange={(e) => setPayloadMode(e.target.value)} className="bg-slate-900 border border-slate-800 rounded text-xs px-1 py-1">
            <option value="text">text</option><option value="json">JSON</option><option value="hex">hex</option>
          </select>
          <button onClick={togglePause} className={btnCls}>{paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Resume' : 'Pause'}</button>
          {paused && <span className="text-[11px] text-amber-300 font-mono">{queued} queued{dropped ? `, ${dropped} dropped` : ''}</span>}
          <button onClick={exportJson} disabled={messages.length === 0} className={btnCls}><Download size={12} /> Export JSON</button>
          <button onClick={clearAll} className={btnCls}><Trash2 size={12} /> Clear</button>
        </div>

        {view === 'log' ? (
          <div className="max-h-96 overflow-auto font-mono">
            {visibleMessages.length === 0 && (
              <div className="text-[11px] text-slate-500 py-2">
                {messages.length === 0 ? 'No messages yet. Connect, subscribe to a topic filter, and messages will appear here.' : 'No messages match the filter.'}
              </div>
            )}
            {visibleMessages.map((m, i) => <MessageRow key={`${m.time}-${i}-${m.topic}`} m={m} mode={payloadMode} />)}
          </div>
        ) : (
          <div className="max-h-96 overflow-auto font-mono">
            {topicRows.length === 0 && <div className="text-[11px] text-slate-500 py-2">No topics yet. Only incoming messages build the tree. Click a topic name to copy it into the publish form and compare its last two payloads.</div>}
            {topicRows.map((r) => (
              <div key={r.full} style={{ paddingLeft: r.depth * 14 }} className="flex items-center gap-2 py-0.5 border-b border-slate-900 text-[11px] min-w-0">
                {r.entry ? (
                  <>
                    <button onClick={() => { setPubTopic(r.full); setSelTopic(r.full); }} title={`${r.full} (click to copy into publish and show changes)`} className="text-gray-200 hover:text-cyan-300 shrink-0 max-w-[35%] truncate text-left">{r.name}</button>
                    <span className="text-slate-500 shrink-0">x{r.entry.count}</span>
                    {r.entry.last.retain && <span className="shrink-0 px-1 rounded text-[9px] bg-purple-900/50 text-purple-300">RET</span>}
                    <span className="text-emerald-300 truncate min-w-0" title={`last ${fmtTime(r.entry.last.time)}`}>{previewText(r.entry.last.payload)}</span>
                  </>
                ) : (
                  <span className="text-cyan-300/80">{r.name}/</span>
                )}
              </div>
            ))}
          </div>
        )}
        {view === 'tree' && selTopic && topics.get(selTopic) && (
          <div className="mt-2 border-t border-slate-800 pt-2">
            <div className="text-[11px] text-cyan-300 font-mono mb-1 truncate">{selTopic}</div>
            <TopicDiff entry={topics.get(selTopic)} />
          </div>
        )}
        <div className="text-[10px] text-slate-600 mt-2">
          Showing up to {MAX_MESSAGES} messages and {MAX_TOPICS} topics. Retained messages arrive right after subscribing and carry the RET marker.
        </div>
      </div>

      <details className={cardCls}>
        <summary className="cursor-pointer text-xs font-semibold">Session log ({sessionLog.length})</summary>
        <div className="mt-2 max-h-40 overflow-auto font-mono text-[11px] space-y-0.5">
          {sessionLog.length === 0 && <div className="text-slate-500">Nothing yet.</div>}
          {[...sessionLog].reverse().map((l, i) => (
            <div key={`${l.t}-${i}`} className={l.level === 'error' ? 'text-red-300' : l.level === 'warn' ? 'text-amber-300' : 'text-slate-400'}>
              <span className="text-slate-600">{fmtTime(l.t)}</span> {l.text}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
