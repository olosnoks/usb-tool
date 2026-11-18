import React, { useEffect, useRef, useState } from 'react';
import {
  Radio, Plug, Unplug, RefreshCw, Users, Map as MapIcon, Send, Activity, Terminal, Settings2, Layers, Download, Trash2, Signal, Copy, MessageSquare, Search,
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';
import { useOptionalSerial } from '../../context/SerialContext';
import {
  BROADCAST_NUM, HEARTBEAT_INTERVAL_MS, FrameParser, appendConsoleText, applyFromRadio, beginSync,
  buildHeartbeatFrame, buildTextFrame, configJson, createSession, decodeFromRadioPayload, nodeIdFromNum,
  recordOutgoingText, summarizeChannels, summarizeNodes,
} from '../../utils/meshtastic.js';
import {
  annotateNodes, filterNodes, sortNodes, nodesToCsv, filterMessages, messagesToCsv, cliCommands, formatDistance,
} from '../../utils/meshtastic/nodeTools.js';

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
  const [nodeQuery, setNodeQuery] = useState('');
  const [onlyPositioned, setOnlyPositioned] = useState(false);
  const [onlyDirect, setOnlyDirect] = useState(false);
  const [sortKey, setSortKey] = useState('lastHeard');
  const [sortDir, setSortDir] = useState('desc');
  const [msgScope, setMsgScope] = useState('all');

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

  const nodes = annotateNodes(summarizeNodes(session));
  const shownNodes = sortNodes(filterNodes(nodes, { query: nodeQuery, onlyPositioned, onlyDirect }), sortKey, sortDir);
  const shownMessages = filterMessages(session.messages, msgScope);
  const senderName = (num) => session.nodes.get(num)?.user?.long_name || nodeIdFromNum(num);
  const copyText = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice(`Copied ${what}. Run it in a terminal that has the meshtastic CLI installed.`);
    } catch {
      setNotice(`Could not copy to the clipboard. ${what}: ${text}`);
    }
  };
  const sortBy = (key) => {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'name' || key === 'distance' || key === 'hops' ? 'asc' : 'desc'); }
  };
  const channels = summarizeChannels(session);
  const peers = nodes.filter((n) => !n.isMe);
  const positioned = nodes.filter((n) => n.position);
  const myNode = nodes.find((n) => n.isMe);
  const myFirmware = session.metadata?.firmware_version || '';
  const channelOptions = channels.length ? channels : [{ index: 0, name: '', role: 1 }];
  const draftBytes = new TextEncoder().encode(draft).length;

  if (!serial) {
    return (
      <div className="flex flex-col gap-2 text-slate-200">
        <div className="rounded border border-slate-800 bg-slate-950 p-2 text-xs text-slate-400">
          The Meshtastic client uses the app's shared serial port. Open it from the app shell.
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2 text-slate-200">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-800 bg-[#171920] p-2">
        <Radio className="h-3.5 w-3.5 text-cyan-400" />
        <span className="mr-auto min-w-0 truncate text-[11px] text-slate-500" title="Meshtastic serial API at 115200 baud over the shared port. Read-only: no config writes.">
          Serial API, 115200 baud, read-only config
        </span>
        {!isConnected ? (
          <button type="button" onClick={connectAndSync} className="flex items-center gap-1 rounded border border-cyan-700 bg-cyan-950/40 px-2 py-1 text-[11px] text-cyan-200 hover:bg-cyan-900/40">
            <Plug className="h-3 w-3" /> CONNECT &amp; SYNC
          </button>
        ) : (
          <>
            <button type="button" onClick={startSync} title="Repeat the config handshake" className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-800">
              <RefreshCw className="h-3 w-3" /> RE-SYNC
            </button>
            <button type="button" onClick={disconnect} className="flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] hover:bg-slate-800">
              <Unplug className="h-3 w-3" /> DISCONNECT
            </button>
          </>
        )}
      </div>

      {notice && <div className="rounded border border-amber-800 bg-amber-950/30 p-2 text-xs text-amber-200">{notice}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-1.5 @md:grid-cols-5">
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
      <div className="flex flex-wrap gap-0.5 border-b border-slate-800">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex items-center gap-1 rounded-t px-2 py-0.5 font-mono text-[11px] ${tab === id ? 'bg-slate-800 text-cyan-200' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>

      {tab === 'nodes' && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <label className="flex min-w-[8rem] flex-1 items-center gap-1 rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 focus-within:border-cyan-600">
              <Search className="h-3 w-3 text-slate-500" />
              <input
                value={nodeQuery}
                onChange={(e) => setNodeQuery(e.target.value)}
                aria-label="Filter nodes"
                placeholder="Filter name, id, hardware, role"
                className="w-full bg-transparent font-mono text-[11px] text-slate-100 outline-none"
              />
            </label>
            <label className="flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={onlyPositioned} onChange={(e) => setOnlyPositioned(e.target.checked)} /> has position
            </label>
            <label className="flex items-center gap-1 text-slate-400" title="Nodes reporting 0 hops away">
              <input type="checkbox" checked={onlyDirect} onChange={(e) => setOnlyDirect(e.target.checked)} /> direct only
            </label>
            <button
              type="button"
              disabled={shownNodes.length === 0}
              onClick={() => downloadText(nodesToCsv(shownNodes), 'meshtastic-nodes.csv', 'text/csv')}
              title="Save the nodes currently shown as CSV"
              className="flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
            <button
              type="button"
              disabled={nodes.length === 0}
              onClick={() => downloadJson(nodes, 'meshtastic-nodes.json')}
              title="Save all nodes as JSON"
              className="flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            >
              <Download className="h-3 w-3" /> JSON
            </button>
          </div>
          {nodes.length === 0 ? (
            <Empty>No nodes yet. Connect and sync to read the device's node database.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="text-slate-500">
                  <tr className="border-b border-slate-800">
                    <SortTh id="name" label="Name" {...{ sortKey, sortDir, sortBy }} />
                    <th className="pr-2">ID</th>
                    <th className="pr-2">Hardware</th>
                    <th className="pr-2">Role</th>
                    <SortTh id="lastHeard" label="Last heard" {...{ sortKey, sortDir, sortBy }} />
                    <SortTh id="hops" label="Hops" {...{ sortKey, sortDir, sortBy }} />
                    <SortTh id="snr" label="SNR" {...{ sortKey, sortDir, sortBy }} />
                    <SortTh id="battery" label="Battery" {...{ sortKey, sortDir, sortBy }} />
                    <SortTh id="distance" label="Distance" {...{ sortKey, sortDir, sortBy }} />
                    <th className="pr-2">Position</th>
                    <th className="pr-2" />
                  </tr>
                </thead>
                <tbody>
                  {shownNodes.map((n) => (
                    <tr key={n.num} className="border-b border-slate-900 hover:bg-slate-900/60">
                      <td className="py-0.5 pr-2 text-slate-200">
                        {n.longName || <span className="text-slate-600">(no name yet)</span>}
                        {n.shortName ? <span className="ml-1 text-slate-500">[{n.shortName}]</span> : null}
                        {n.isMe && <span className="ml-1 rounded bg-cyan-900/60 px-1 text-[9px] text-cyan-200">ME</span>}
                      </td>
                      <td className="pr-2 text-cyan-300">{n.id}</td>
                      <td className="pr-2">{n.hwModel !== undefined ? `${n.hwModel} ${n.hwName}` : '—'}</td>
                      <td className="pr-2 text-slate-400">{n.role || '—'}</td>
                      <td className="pr-2">{formatAge(n.ageSecs)}</td>
                      <td className="pr-2">{n.hopsAway ?? '—'}{n.viaMqtt ? ' MQTT' : ''}</td>
                      <td className="pr-2" title={n.signal ? `Rough rating from SNR: ${n.signal}` : ''}>
                        {n.snr !== null && n.snr !== undefined ? `${Number(n.snr).toFixed(1)} dB` : '—'}
                        {n.signal ? <span className={`ml-1 ${SIGNAL_STYLE[n.signal]}`}>{n.signal}</span> : null}
                      </td>
                      <td className="pr-2">{formatBattery(n.battery)}</td>
                      <td className="pr-2">{n.distanceKm !== null ? `${formatDistance(n.distanceKm)} ${n.compass}` : '—'}</td>
                      <td className="pr-2">{n.position ? `${n.position.lat.toFixed(5)}, ${n.position.lon.toFixed(5)}` : '—'}</td>
                      <td className="whitespace-nowrap pr-1">
                        {!n.isMe && (
                          <>
                            <button
                              type="button"
                              title={`Direct message ${n.longName || n.id}`}
                              aria-label={`Direct message ${n.longName || n.id}`}
                              onClick={() => { setTarget(String(n.num)); setTab('messages'); }}
                              className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-200"
                            >
                              <MessageSquare className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              title="Copy a meshtastic CLI traceroute command for this node (the browser does not run it)"
                              aria-label={`Copy CLI traceroute command for ${n.id}`}
                              onClick={() => copyText(cliCommands(n.id).traceroute, 'traceroute command')}
                              className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-200"
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shownNodes.length === 0 && <Empty>No nodes match the filter.</Empty>}
            </div>
          )}
          <details className="text-[10px] text-slate-600">
            <summary className="cursor-pointer">About these columns</summary>
            Node IDs use the !xxxxxxxx form. Hops, SNR and role are shown only where the device reports them. Distance and
            direction are measured from your node's last position to the other node's last position. The SNR label is a rough
            guide (good at 0 dB or more, fair down to -10 dB, weak below), not a firmware value. The copy button gives text for
            the meshtastic Python CLI; this tool does not send traceroutes.
          </details>
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
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <select value={msgScope} onChange={(e) => setMsgScope(e.target.value)} aria-label="Message filter" className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 font-mono">
              <option value="all">All messages</option>
              <option value="direct">Direct only</option>
              {channelOptions.map((c) => <option key={c.index} value={`channel:${c.index}`}>Channel {c.index}{c.name ? ` ${c.name}` : ''}</option>)}
            </select>
            <span className="mr-auto text-slate-500">{shownMessages.length} of {session.messages.length}</span>
            <button
              type="button"
              disabled={shownMessages.length === 0}
              onClick={() => downloadText(messagesToCsv(shownMessages, senderName), 'meshtastic-messages.csv', 'text/csv')}
              title="Save the messages shown as CSV"
              className="flex items-center gap-1 rounded border border-slate-700 px-1.5 py-0.5 hover:bg-slate-800 disabled:opacity-40"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
          </div>
          <div className="max-h-[320px] min-h-[120px] overflow-y-auto rounded border border-slate-800 bg-slate-950 p-2 font-mono text-[11px]">
            {shownMessages.length === 0 ? (
              <Empty>{session.messages.length === 0 ? 'No text messages yet. Incoming TEXT_MESSAGE_APP packets appear here.' : 'No messages match this filter.'}</Empty>
            ) : shownMessages.map((m) => {
              const sender = senderName(m.from);
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
          <div className="grid grid-cols-1 gap-1.5 @md:grid-cols-[1fr_auto_auto]">
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
    <div className="rounded border border-slate-800 bg-slate-950 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`truncate font-mono text-sm ${tone === 'emerald' ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</div>
      {sub ? <div className="truncate text-[10px] text-slate-600">{sub}</div> : null}
    </div>
  );
}

const SIGNAL_STYLE = { good: 'text-emerald-400', fair: 'text-amber-300', weak: 'text-rose-400' };

function SortTh({ id, label, sortKey, sortDir, sortBy }) {
  const active = sortKey === id;
  return (
    <th className="py-1 pr-2" aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => sortBy(id)} className={`font-mono ${active ? 'text-cyan-300' : 'hover:text-slate-300'}`}>
        {label}{active ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : ''}
      </button>
    </th>
  );
}

function Empty({ children }) {
  return <div className="p-3 text-center text-xs text-slate-500">{children}</div>;
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
  downloadText(JSON.stringify(data, null, 2), name, 'application/json');
}

function downloadText(text, name, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
