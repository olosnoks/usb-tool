import React, { useEffect, useRef, useState } from 'react';
import {
  Radio, Plug, Unplug, RefreshCw, Users, Map as MapIcon, Send, Activity, Terminal, Settings2, Layers, Download, Trash2, Signal,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { useOptionalSerial } from '../../context/SerialContext';
import {
  BROADCAST_NUM, HEARTBEAT_INTERVAL_MS, FrameParser, appendConsoleText, applyFromRadio, beginSync,
  buildHeartbeatFrame, buildTextFrame, configJson, createSession, decodeFromRadioPayload, nodeIdFromNum,
  recordOutgoingText, summarizeChannels, summarizeNodes,
} from '../../utils/meshtastic.js';

const TABS = [
  ['nodes', 'NODES', Users],
  ['map', 'MAP', MapIcon],
  ['channels', 'CHANNELS', Layers],
  ['messages', 'MESSAGES', Send],
  ['telemetry', 'TELEMETRY', Activity],
  ['config', 'CONFIG (READ-ONLY)', Settings2],
  ['log', 'DEVICE LOG', Terminal],
];

const MAX_LOG_SHOWN = 400;
const STATUS_STYLE = {
  sent: 'text-amber-300',
  acked: 'text-emerald-300',
  failed: 'text-rose-400',
  received: 'text-cyan-300',
};

function formatAge(secs) {
  if (secs === null || secs === undefined) return '—';
  return `${formatDuration(secs)} ago`;
}

function formatDuration(secs) {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

function formatBattery(level) {
  if (level === undefined || level === null) return '—';
  // Meshtastic reports values above 100 when the node is on external power.
  if (level > 100) return 'external power';
  return `${level}%`;
}

const pct = (v) => (v === undefined || v === null ? '—' : `${Number(v).toFixed(1)}%`);
const fmtTime = (ms) => new Date(ms).toTimeString().split(' ')[0];

export default function MeshtasticWorkbench({ onLogMessage }) {
  const serial = useOptionalSerial();
  const serialRef = useRef(serial);
  serialRef.current = serial;
  const logRef = useRef(onLogMessage);
  logRef.current = onLogMessage;

  const sessionRef = useRef(null);
  if (sessionRef.current === null) sessionRef.current = createSession();
  const parserRef = useRef(null);
  if (parserRef.current === null) parserRef.current = new FrameParser();
  const pendingSyncRef = useRef(false);
  const renderScheduled = useRef(false);
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState('nodes');
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState('broadcast');
  const [channelIndex, setChannelIndex] = useState(0);
  const [notice, setNotice] = useState(null);

  const log = (text, level = 'info') => {
    if (typeof logRef.current === 'function') logRef.current(text, level);
  };

  // Radio traffic arrives in many small chunks; coalesce re-renders.
  const refresh = () => {
    if (renderScheduled.current) return;
    renderScheduled.current = true;
    setTimeout(() => {
      renderScheduled.current = false;
      setVersion((v) => v + 1);
    }, 80);
  };

  const session = sessionRef.current;
  const phase = session.phase;
  const isConnected = !!serial?.isConnected;
  const sessionLabel = !isConnected ? 'NOT CONNECTED' : phase === 'ready' ? 'READY' : phase === 'syncing' ? 'SYNCING' : 'CONNECTED';

  // Receive path: every chunk from the shared port goes through the frame parser.
  const subscribeRx = serial?.subscribeRx;
  useEffect(() => {
    if (typeof subscribeRx !== 'function') return undefined;
    const onBytes = (bytes, boardId) => {
      const activeId = serialRef.current?.activeBoardId;
      if (boardId && activeId && boardId !== activeId) return;
      const state = sessionRef.current;
      const before = state.phase;
      for (const ev of parserRef.current.push(bytes)) {
        if (ev.type === 'log') {
          appendConsoleText(state, ev.text);
          continue;
        }
        const res = decodeFromRadioPayload(ev.payload);
        if (!res.ok) {
          state.counters.decodeErrors++;
          state.logs.push({ time: Date.now(), kind: 'sys', text: `Undecodable frame (${ev.payload.length} bytes): ${res.error}` });
          continue;
        }
        applyFromRadio(state, res.message);
      }
      if (before !== 'ready' && state.phase === 'ready') {
        log(`Meshtastic: config sync complete (${state.nodes.size} nodes, ${state.channels.size} channels).`, 'success');
      }
      refresh();
    };
    return subscribeRx(onBytes);
    // subscribeRx is stable in SerialContext; the handler reads only refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeRx]);

  const sendFrame = async (frame) => {
    const s = serialRef.current;
    if (!s?.isConnected) return false;
    await s.sendRawBytes(frame);
    return true;
  };

  const startSync = async () => {
    const prev = sessionRef.current;
    const { state, frame } = beginSync();
    // Keep the device console history across syncs.
    state.logs = prev.logs;
    state.logTail = prev.logTail;
    sessionRef.current = state;
    parserRef.current.reset();
    setNotice(null);
    const ok = await sendFrame(frame);
    if (!ok) {
      state.phase = 'idle';
      setNotice('The port is not connected, so the config request was not sent.');
    } else {
      log('Meshtastic: config requested (want_config_id sent).', 'sys');
    }
    refresh();
  };

  // Connect first when needed; the sync starts from the effect below, once the
  // port reports connected and the context value is fresh.
  const connectAndSync = async () => {
    const s = serialRef.current;
    if (!s) return;
    if (s.isConnected) {
      await startSync();
      return;
    }
    pendingSyncRef.current = true;
    try {
      await s.connect();
    } catch (err) {
      pendingSyncRef.current = false;
      setNotice(`Connect failed: ${err?.message || err}`);
    }
  };

  useEffect(() => {
    if (isConnected && pendingSyncRef.current) {
      pendingSyncRef.current = false;
      startSync();
    }
    if (!isConnected && sessionRef.current.phase !== 'idle') {
      const state = sessionRef.current;
      state.phase = 'idle';
      state.logs.push({ time: Date.now(), kind: 'sys', text: 'Port disconnected. Data shown is from the last session.' });
      refresh();
    }
    // startSync only reads refs; re-running on isConnected changes is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // Keep the link warm while a session is ready.
  useEffect(() => {
    if (!isConnected || phase !== 'ready') return undefined;
    const id = setInterval(() => {
      sendFrame(buildHeartbeatFrame()).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, phase]);

  const disconnect = async () => {
    const s = serialRef.current;
    if (s?.disconnect) await s.disconnect();
  };

  const sendText = async () => {
    const text = draft.trim();
    const state = sessionRef.current;
    if (!text) return;
    if (!isConnected) {
      setNotice('Connect to a device before sending.');
      return;
    }
    if (state.phase !== 'ready') {
      setNotice('Wait for the config sync to finish before sending.');
      return;
    }
    const to = target === 'broadcast' ? BROADCAST_NUM : Number(target);
    let built;
    try {
      built = buildTextFrame({ text, to, channel: channelIndex });
    } catch (err) {
      setNotice(`Message not sent: ${err.message}`);
      return;
    }
    try {
      await sendFrame(built.frame);
    } catch (err) {
      setNotice(`Write failed: ${err?.message || err}`);
      return;
    }
    recordOutgoingText(state, { id: built.packetId, to, channel: channelIndex, text });
    setDraft('');
    setNotice(null);
    refresh();
  };

  const clearLog = () => {
    sessionRef.current.logs = [];
    sessionRef.current.logTail = '';
    refresh();
  };

  const nodes = summarizeNodes(session);
  const channels = summarizeChannels(session);
  const peers = nodes.filter((n) => !n.isMe);
  const positioned = nodes.filter((n) => n.position);
  const myNode = nodes.find((n) => n.isMe);
  const myFirmware = session.metadata?.firmware_version || '';
  const channelOptions = channels.length ? channels : [{ index: 0, name: '', role: 1 }];
  const draftBytes = new TextEncoder().encode(draft).length;

  if (!serial) {
    return (
      <div className="flex flex-col gap-3 p-3 text-slate-200">
        <div className="rounded border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
          The Meshtastic client uses the app's shared serial port. Open it from the app shell.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-3 text-slate-200">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-800 bg-[#171920] p-3">
        <Radio className="h-4 w-4 text-cyan-400" />
        <div className="mr-auto min-w-0">
          <div className="text-sm font-semibold text-cyan-200">Meshtastic Client</div>
          <div className="text-[11px] text-slate-500">
            Meshtastic serial API at 115200 baud over the shared port. Read-only: no config writes.
          </div>
        </div>
        {!isConnected ? (
          <button type="button" onClick={connectAndSync} className="flex items-center gap-1.5 rounded border border-cyan-700 bg-cyan-950/40 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-900/40">
            <Plug className="h-3.5 w-3.5" /> CONNECT &amp; SYNC
          </button>
        ) : (
          <>
            <button type="button" onClick={startSync} className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">
              <RefreshCw className="h-3.5 w-3.5" /> RE-SYNC CONFIG
            </button>
            <button type="button" onClick={disconnect} className="flex items-center gap-1.5 rounded border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800">
              <Unplug className="h-3.5 w-3.5" /> DISCONNECT
            </button>
          </>
        )}
      </div>

      {notice && <div className="rounded border border-amber-800 bg-amber-950/30 p-2 text-xs text-amber-200">{notice}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label="Session" value={sessionLabel} tone={sessionLabel === 'READY' ? 'emerald' : 'slate'} />
        <Kpi
          label="My node"
          value={myNode ? (myNode.longName || myNode.id) : session.myNum !== null ? nodeIdFromNum(session.myNum) : '—'}
          sub={myFirmware}
        />
        <Kpi label="Nodes" value={String(nodes.length)} sub={`${positioned.length} with a position`} />
        <Kpi label="Channels" value={String(channels.length)} />
        <Kpi label="Packets" value={String(session.counters.packets)} sub={`${session.counters.encrypted} encrypted (not decoded)`} />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-1">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1 rounded-t px-2.5 py-1 font-mono text-[11px] ${tab === id ? 'bg-slate-800 text-cyan-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {tab === 'nodes' && (
        <div className="overflow-x-auto">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              disabled={nodes.length === 0}
              onClick={() => downloadJson(nodes, 'meshtastic-nodes.json')}
              className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-800 disabled:opacity-40"
            >
              <Download className="h-3 w-3" /> EXPORT NODES (JSON)
            </button>
          </div>
          {nodes.length === 0 ? (
            <Empty>No nodes yet. Connect and sync to read the device's node database.</Empty>
          ) : (
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="py-1 pr-2">Name</th>
                  <th className="pr-2">Short</th>
                  <th className="pr-2">ID</th>
                  <th className="pr-2">Hardware</th>
                  <th className="pr-2">Role</th>
                  <th className="pr-2">Last heard</th>
                  <th className="pr-2">SNR</th>
                  <th className="pr-2">Battery</th>
                  <th className="pr-2">Position</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.num} className="border-b border-slate-900 hover:bg-slate-900/60">
                    <td className="py-1 pr-2 text-slate-200">
                      {n.longName || <span className="text-slate-600">(no name yet)</span>}
                      {n.isMe && <span className="ml-1 rounded bg-cyan-900/60 px-1 text-[9px] text-cyan-200">ME</span>}
                    </td>
                    <td className="pr-2">{n.shortName || '—'}</td>
                    <td className="pr-2 text-cyan-300">{n.id}</td>
                    <td className="pr-2">{n.hwModel !== undefined ? `${n.hwModel} ${n.hwName}` : '—'}</td>
                    <td className="pr-2 text-slate-400">{n.role || '—'}</td>
                    <td className="pr-2">{formatAge(n.ageSecs)}</td>
                    <td className="pr-2">{n.snr !== null && n.snr !== undefined ? `${Number(n.snr).toFixed(1)} dB` : '—'}</td>
                    <td className="pr-2">{formatBattery(n.battery)}</td>
                    <td className="pr-2">{n.position ? `${n.position.lat.toFixed(5)}, ${n.position.lon.toFixed(5)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="mt-2 text-[10px] text-slate-600">
            Node IDs use the !xxxxxxxx form. Roles, hop counts and SNR are shown only where the device reports them.
          </div>
        </div>
      )}

      {tab === 'map' && <NodeMap positioned={positioned} />}

      {tab === 'channels' && (
        <div className="space-y-2">
          {channels.length === 0 ? (
            <Empty>No channels received yet.</Empty>
          ) : (
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="text-slate-500">
                <tr className="border-b border-slate-800">
                  <th className="py-1 pr-2">Index</th>
                  <th className="pr-2">Role</th>
                  <th className="pr-2">Name</th>
                  <th className="pr-2">Key</th>
                  <th className="pr-2">Uplink</th>
                  <th className="pr-2">Downlink</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.index} className="border-b border-slate-900">
                    <td className="py-1 pr-2">{c.index}</td>
                    <td className="pr-2">{['DISABLED', 'PRIMARY', 'SECONDARY'][c.role] || c.role}</td>
                    <td className="pr-2 text-slate-200">{c.name || (c.role === 1 ? '(default primary)' : '—')}</td>
                    <td className="pr-2 text-slate-400">{c.pskBytes ? `${c.pskBytes}-byte PSK` : 'none'}</td>
                    <td className="pr-2">{c.uplink ? 'yes' : 'no'}</td>
                    <td className="pr-2">{c.downlink ? 'yes' : 'no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="text-[10px] text-slate-600">Only the key length is shown. Key bytes are never displayed.</div>
        </div>
      )}

      {tab === 'messages' && (
        <div className="flex flex-col gap-2">
          <div className="max-h-[320px] min-h-[120px] overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px]">
            {session.messages.length === 0 ? (
              <Empty>No text messages yet. Incoming TEXT_MESSAGE_APP packets appear here.</Empty>
            ) : session.messages.map((m) => {
              const sender = session.nodes.get(m.from)?.user?.long_name || nodeIdFromNum(m.from);
              return (
                <div key={`${m.id}-${m.direction}-${m.time}`} className="border-b border-slate-900 py-1">
                  <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
                    <span>{fmtTime(m.time)}</span>
                    <span className={m.direction === 'out' ? 'text-cyan-300' : 'text-emerald-300'}>{m.direction === 'out' ? 'you' : sender}</span>
                    <span>{m.direct ? 'direct' : `channel ${m.channel}`}</span>
                    {m.snr !== null && <span>SNR {Number(m.snr).toFixed(1)}</span>}
                    {m.direction === 'out' && <span className={STATUS_STYLE[m.status] || ''}>{m.status}{m.error ? ` (${m.error})` : ''}</span>}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-slate-200">{m.text}</div>
                </div>
              );
            })}
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }}
              rows={2}
              placeholder="Message (Enter sends, Shift+Enter for a new line)"
              className="rounded border border-slate-700 bg-slate-950 p-2 font-mono text-xs text-slate-100 focus:border-cyan-600 focus:outline-none"
            />
            <div className="flex flex-col gap-1 text-[11px]">
              <select value={target} onChange={(e) => setTarget(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono">
                <option value="broadcast">Broadcast on channel</option>
                {peers.map((p) => <option key={p.num} value={String(p.num)}>{p.longName || p.id} ({p.id})</option>)}
              </select>
              {target === 'broadcast' && (
                <select value={channelIndex} onChange={(e) => setChannelIndex(Number(e.target.value))} className="rounded border border-slate-700 bg-slate-950 px-2 py-1 font-mono">
                  {channelOptions.map((c) => <option key={c.index} value={c.index}>Channel {c.index}{c.name ? ` ${c.name}` : ''}</option>)}
                </select>
              )}
            </div>
            <button
              type="button"
              onClick={sendText}
              disabled={!draft.trim() || phase !== 'ready' || !isConnected}
              className="flex items-center justify-center gap-1.5 rounded border border-cyan-700 bg-cyan-950/40 px-4 py-2 text-xs text-cyan-200 hover:bg-cyan-900/40 disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" /> SEND
            </button>
          </div>
          <div className="text-[10px] text-slate-600">
            {draftBytes} bytes UTF-8. A sent message shows "acked" only after the device reports a routing acknowledgement for it.
            A routing error from the mesh is shown in the status column with its reason.
          </div>
        </div>
      )}

      {tab === 'telemetry' && <TelemetryTable session={session} nodes={nodes} />}

      {tab === 'config' && (
        <div className="space-y-2">
          <div className="text-[11px] text-slate-500">
            Decoded from the device's config and module config. Passwords are redacted. Security and key sections are not decoded.
            This tool does not write config.
          </div>
          {Object.keys(session.config).length + Object.keys(session.moduleConfig).length === 0 ? (
            <Empty>No config received yet.</Empty>
          ) : (
            <pre className="max-h-[420px] overflow-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px] text-slate-300">
              {JSON.stringify(configJson(session), null, 2)}
            </pre>
          )}
        </div>
      )}

      {tab === 'log' && (
        <div className="space-y-2">
          <div className="flex justify-between gap-2 text-[11px] text-slate-500">
            <span>{session.logs.length} entries: device console text and decoded device log records.</span>
            <button type="button" onClick={clearLog} className="flex items-center gap-1 rounded border border-slate-700 px-2 py-0.5 hover:bg-slate-800">
              <Trash2 className="h-3 w-3" /> CLEAR
            </button>
          </div>
          <div className="h-[340px] overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px]">
            {session.logs.length === 0 ? (
              <Empty>No device output yet.</Empty>
            ) : session.logs.slice(-MAX_LOG_SHOWN).map((l, i) => (
              <div key={i} className={l.kind === 'sys' ? 'text-amber-300' : l.kind === 'device' ? 'text-slate-200' : 'text-slate-400'}>
                <span className="text-slate-600">{fmtTime(l.time)} </span>
                {l.source ? <span className="text-cyan-600">[{l.source}] </span> : null}
                {l.text}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-[10px] text-slate-600">
        <span className="flex items-center gap-1"><Signal className="h-3 w-3" /> frames {session.counters.frames}</span>
        <span>decode errors {session.counters.decodeErrors}</span>
        <span>undecoded config fields {session.configUnknown.length}</span>
        {session.rebooted && <span className="text-amber-400">device rebooted during this session</span>}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-950 p-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`truncate font-mono text-sm ${tone === 'emerald' ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</div>
      {sub ? <div className="truncate text-[10px] text-slate-600">{sub}</div> : null}
    </div>
  );
}

function Empty({ children }) {
  return <div className="p-4 text-center text-xs text-slate-500">{children}</div>;
}

function TelemetryTable({ session, nodes }) {
  const rows = nodes.filter((n) => n.deviceMetrics || session.telemetry.has(n.num));
  if (rows.length === 0) return <Empty>No device telemetry yet. Nodes publish device metrics periodically.</Empty>;
  return (
    <table className="w-full text-left font-mono text-[11px]">
      <thead className="text-slate-500">
        <tr className="border-b border-slate-800">
          <th className="py-1 pr-2">Node</th>
          <th className="pr-2">Battery</th>
          <th className="pr-2">Voltage</th>
          <th className="pr-2">Channel util</th>
          <th className="pr-2">Air util TX</th>
          <th className="pr-2">Uptime</th>
          <th className="pr-2">Source</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((n) => {
          const rec = session.telemetry.get(n.num);
          const m = rec?.metrics || n.deviceMetrics || {};
          return (
            <tr key={n.num} className="border-b border-slate-900">
              <td className="py-1 pr-2 text-slate-200">{n.longName || n.id}</td>
              <td className="pr-2">{formatBattery(m.battery_level)}</td>
              <td className="pr-2">{m.voltage !== undefined ? `${Number(m.voltage).toFixed(2)} V` : '—'}</td>
              <td className="pr-2">{pct(m.channel_utilization)}</td>
              <td className="pr-2">{pct(m.air_util_tx)}</td>
              <td className="pr-2">{m.uptime_seconds !== undefined ? formatDuration(m.uptime_seconds) : '—'}</td>
              <td className="pr-2 text-slate-500">{rec ? `telemetry ${fmtTime(rec.receivedAt)}` : 'node info'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Leaflet map of nodes with a GPS fix. Leaflet is imported only when this tab mounts. */
function NodeMap({ positioned }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const leafletRef = useRef(null);
  const layerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const L = (await import('leaflet')).default;
        if (cancelled || !containerRef.current) return;
        const map = L.map(containerRef.current, { worldCopyJump: true }).setView([20, 0], 2);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        mapRef.current = map;
        leafletRef.current = L;
        layerRef.current = L.layerGroup().addTo(map);
        setReady(true);
      } catch (err) {
        if (!cancelled) setMapError(err?.message || 'Map failed to load');
      }
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) mapRef.current.remove();
      mapRef.current = null;
      leafletRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const L = leafletRef.current;
    if (!ready || !map || !layer || !L) return;
    layer.clearLayers();
    const points = [];
    for (const n of positioned) {
      const { lat, lon } = n.position;
      points.push([lat, lon]);
      L.circleMarker([lat, lon], { radius: 6, color: n.isMe ? '#22d3ee' : '#34d399', weight: 2, fillOpacity: 0.5 })
        .bindTooltip(`${n.longName || n.id} (${n.id})`)
        .addTo(layer);
    }
    if (points.length) map.fitBounds(points, { maxZoom: 12, padding: [20, 20] });
  }, [ready, positioned]);

  return (
    <div className="space-y-2">
      {mapError && <div className="text-xs text-rose-400">{mapError}</div>}
      <div ref={containerRef} className="h-[360px] w-full rounded border border-slate-800" />
      <div className="text-[10px] text-slate-600">
        {positioned.length} node{positioned.length === 1 ? '' : 's'} with a GPS fix. Nodes without a fix are not plotted.
      </div>
    </div>
  );
}

function downloadJson(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
