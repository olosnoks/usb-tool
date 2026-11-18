/**
 * Meshtastic client logic (no React, no hardware access).
 *
 * Builds ToRadio frames (want_config, text packets, heartbeat), decodes FromRadio frames,
 * and keeps a session model of the device: my node, the node database, channels, config,
 * text messages, telemetry and the device log. The workbench feeds it serial bytes and
 * renders the model.
 *
 * Protocol reference: meshtastic/protobufs (mesh.proto, portnums.proto, ...) and the
 * serial framing described in src/utils/meshtastic/frames.js.
 */
import { decodeMessage, encodeMessage, ProtoError, toJsonSafe } from './meshtastic/protobuf.js';
import { encodeFrame, FrameParser } from './meshtastic/frames.js';
import {
  ToRadio, FromRadio, Position, User, Routing, Telemetry,
} from './meshtastic/schema.js';
import {
  HARDWARE_MODEL, PORT_NUM, DEVICE_ROLE, ROUTING_ERROR,
} from './meshtastic/enums.js';

export { FrameParser, encodeFrame, toJsonSafe };

export const MESHTASTIC_BAUD = 115200;
export const BROADCAST_NUM = 0xffffffff;
export const DEFAULT_HOP_LIMIT = 3;
export const HEARTBEAT_INTERVAL_MS = 60000;
const MAX_MESSAGES = 500;
const MAX_LOGS = 1000;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

/** Reverse lookup for an enum table: number -> name. */
function reverse(table) {
  const out = new Map();
  for (const [name, value] of Object.entries(table)) if (!out.has(value)) out.set(value, name);
  return out;
}
const HW_NAMES = reverse(HARDWARE_MODEL);
const ROLE_NAMES = reverse(DEVICE_ROLE);
const ROUTING_NAMES = reverse(ROUTING_ERROR);

export function hardwareModelName(value) {
  return HW_NAMES.get(value) || (value === undefined ? '' : `UNKNOWN_HW_${value}`);
}
export function deviceRoleName(value) {
  return ROLE_NAMES.get(value) || (value === undefined ? '' : `ROLE_${value}`);
}
export function routingErrorName(value) {
  return ROUTING_NAMES.get(value) || `ERROR_${value}`;
}

/** Node number to the "!xxxxxxxx" form used by the apps. */
export function nodeIdFromNum(num) {
  return '!' + (num >>> 0).toString(16).padStart(8, '0');
}

/** "!a1b2c3d4" or "a1b2c3d4" to a node number; null when it is not a node id. */
export function numFromNodeId(text) {
  const s = String(text || '').trim().replace(/^!/, '');
  if (!/^[0-9a-fA-F]{1,8}$/.test(s)) return null;
  return parseInt(s, 16) >>> 0;
}

/** Protobuf sfixed32 latitude/longitude (1e-7 degrees) to decimal degrees. */
export function coordFromI(value) {
  return value * 1e-7;
}

/** Random non-zero u32 for want_config_id and packet ids. */
export function randomU32(rand = Math.random) {
  let v = 0;
  while (v === 0) v = Math.floor(rand() * 0x100000000) >>> 0;
  return v;
}

// ---------------------------------------------------------------------------
// Outgoing frames
// ---------------------------------------------------------------------------

/** Frame asking the device to start the config handshake; replies carry this id. */
export function buildWantConfigFrame(wantConfigId) {
  return encodeFrame(encodeMessage(ToRadio, { want_config_id: wantConfigId >>> 0 }));
}

export function buildHeartbeatFrame() {
  return encodeFrame(encodeMessage(ToRadio, { heartbeat: {} }));
}

/**
 * Text message frame (TEXT_MESSAGE_APP). `to` is a node number, or BROADCAST_NUM for the
 * channel. Throws if the encoded frame would exceed the serial frame limit.
 */
export function buildTextFrame({
  text,
  to = BROADCAST_NUM,
  channel = 0,
  packetId = randomU32(),
  wantAck = true,
  hopLimit = DEFAULT_HOP_LIMIT,
}) {
  const payload = textEncoder.encode(String(text));
  const packet = {
    to: to >>> 0,
    channel: channel >>> 0,
    decoded: { portnum: PORT_NUM.TEXT_MESSAGE_APP, payload },
    id: packetId >>> 0,
    want_ack: !!wantAck,
    hop_limit: hopLimit,
  };
  const body = encodeMessage(ToRadio, { packet });
  return { frame: encodeFrame(body), packetId: packetId >>> 0, byteLength: payload.length };
}

// ---------------------------------------------------------------------------
// Incoming decode
// ---------------------------------------------------------------------------

/** Decode one FromRadio payload. Returns { ok: true, message } or { ok: false, error }. */
export function decodeFromRadioPayload(payload) {
  try {
    return { ok: true, message: decodeMessage(FromRadio, payload) };
  } catch (error) {
    if (error instanceof ProtoError) return { ok: false, error: error.message };
    throw error;
  }
}

export function decodeToRadioPayload(payload) {
  return decodeMessage(ToRadio, payload);
}

// ---------------------------------------------------------------------------
// Session model
// ---------------------------------------------------------------------------

export function createSession() {
  return {
    phase: 'idle', // idle | syncing | ready
    wantConfigId: null,
    myNum: null,
    myInfo: null,
    metadata: null,
    nodes: new Map(), // num -> node record
    channels: new Map(), // index -> Channel
    config: {}, // variant name -> decoded section
    moduleConfig: {}, // variant name -> decoded section
    configUnknown: [],
    messages: [],
    telemetry: new Map(), // num -> { time, metrics, receivedAt }
    logs: [],
    logTail: '', // unterminated console text
    counters: { frames: 0, packets: 0, encrypted: 0, unknownFrames: 0, decodeErrors: 0, configFields: 0 },
    rebooted: false,
  };
}

function ensureNode(state, num) {
  let node = state.nodes.get(num);
  if (!node) {
    node = {
      num,
      id: nodeIdFromNum(num),
      user: null,
      position: null,
      snr: null,
      lastHeard: 0, // unix seconds, from NodeInfo or the last packet we saw
      deviceMetrics: null,
      hopsAway: null,
      viaMqtt: false,
      role: undefined,
      hwModel: undefined,
    };
    state.nodes.set(num, node);
  }
  return node;
}

function positionFromProto(pos) {
  if (!pos || pos.latitude_i === undefined || pos.longitude_i === undefined) return null;
  const lat = coordFromI(pos.latitude_i);
  const lon = coordFromI(pos.longitude_i);
  // A zero fix is how firmware reports "no fix" in practice; do not plot it.
  if (lat === 0 && lon === 0) return null;
  return {
    lat,
    lon,
    altitude: pos.altitude ?? null,
    time: pos.time ?? null,
    satsInView: pos.sats_in_view ?? null,
  };
}

function nowSeconds(nowMs) {
  return Math.floor(nowMs / 1000);
}

function pushCapped(list, item, cap) {
  list.push(item);
  if (list.length > cap) list.splice(0, list.length - cap);
}

/** Apply one decoded FromRadio message to the session. Mutates and returns `state`. */
export function applyFromRadio(state, fr, nowMs = Date.now()) {
  state.counters.frames++;

  if (fr.my_info) {
    state.myInfo = fr.my_info;
    state.myNum = fr.my_info.my_node_num >>> 0;
    ensureNode(state, state.myNum);
  }
  if (fr.metadata) state.metadata = fr.metadata;
  if (fr.node_info) {
    const ni = fr.node_info;
    const node = ensureNode(state, ni.num >>> 0);
    if (ni.user) {
      node.user = ni.user;
      node.role = ni.user.role;
      node.hwModel = ni.user.hw_model;
    }
    const pos = positionFromProto(ni.position);
    if (pos) node.position = pos;
    if (ni.snr !== undefined) node.snr = ni.snr;
    if (ni.last_heard) node.lastHeard = Math.max(node.lastHeard, ni.last_heard);
    if (ni.device_metrics) node.deviceMetrics = ni.device_metrics;
    if (ni.hops_away !== undefined) node.hopsAway = ni.hops_away;
    if (ni.via_mqtt !== undefined) node.viaMqtt = !!ni.via_mqtt;
  }
  if (fr.channel) {
    const idx = fr.channel.index ?? 0;
    state.channels.set(idx, fr.channel);
  }
  if (fr.config) mergeSections(state, state.config, fr.config);
  if (fr.moduleConfig) mergeSections(state, state.moduleConfig, fr.moduleConfig);
  if (fr.log_record) {
    pushCapped(state.logs, {
      time: nowMs,
      level: fr.log_record.level ?? null,
      source: fr.log_record.source || '',
      text: fr.log_record.message || '',
      kind: 'device',
    }, MAX_LOGS);
  }
  if (fr.rebooted) {
    state.rebooted = true;
    pushCapped(state.logs, { time: nowMs, text: 'Device reported a reboot.', kind: 'sys' }, MAX_LOGS);
  }
  if (fr.config_complete_id !== undefined) {
    if (state.wantConfigId !== null && fr.config_complete_id === state.wantConfigId) {
      state.phase = 'ready';
      pushCapped(state.logs, { time: nowMs, text: 'Config handshake complete.', kind: 'sys' }, MAX_LOGS);
    } else {
      pushCapped(state.logs, { time: nowMs, text: 'Ignored config_complete for an older request.', kind: 'sys' }, MAX_LOGS);
    }
  }
  if (fr.packet) applyPacket(state, fr.packet, nowMs);
  return state;
}

function mergeSections(state, target, container) {
  for (const [key, value] of Object.entries(container)) {
    if (key === '_unknown') {
      for (const u of value) {
        state.configUnknown.push({ ...u, scope: target === state.config ? 'config' : 'moduleConfig' });
        state.counters.configFields++;
      }
      continue;
    }
    target[key] = value;
  }
}

function decodeText(payload) {
  return textDecoder.decode(payload);
}

function applyPacket(state, pk, nowMs) {
  state.counters.packets++;
  const heardSecs = pk.rx_time ? pk.rx_time : nowSeconds(nowMs);
  if (!pk.decoded) {
    state.counters.encrypted++;
    if (pk.from !== undefined) {
      const node = ensureNode(state, pk.from >>> 0);
      node.lastHeard = Math.max(node.lastHeard, heardSecs);
    }
    return;
  }
  const data = pk.decoded;
  const from = (pk.from ?? 0) >>> 0;
  const to = (pk.to ?? 0) >>> 0;
  if (from) {
    const node = ensureNode(state, from);
    node.lastHeard = Math.max(node.lastHeard, heardSecs);
    if (pk.rx_snr !== undefined) node.snr = pk.rx_snr;
  }
  switch (data.portnum) {
    case PORT_NUM.TEXT_MESSAGE_APP: {
      const outgoing = state.myNum !== null && from === state.myNum;
      // Firmware may echo our own transmissions back; keep one copy per packet id.
      if (outgoing && state.messages.some((m) => m.id === pk.id && m.direction === 'out')) return;
      pushCapped(state.messages, {
        id: pk.id >>> 0,
        from,
        to,
        channel: pk.channel ?? 0,
        direct: to !== BROADCAST_NUM,
        text: decodeText(data.payload || new Uint8Array(0)),
        direction: outgoing ? 'out' : 'in',
        status: outgoing ? 'sent' : 'received',
        error: null,
        snr: pk.rx_snr ?? null,
        rssi: pk.rx_rssi ?? null,
        hopStart: pk.hop_start ?? null,
        hopLimit: pk.hop_limit ?? null,
        time: nowMs,
      }, MAX_MESSAGES);
      return;
    }
    case PORT_NUM.POSITION_APP: {
      const pos = decodeInner(Position, data.payload, state, 'position');
      const node = ensureNode(state, from);
      const fix = pos && positionFromProto(pos);
      if (fix) node.position = fix;
      return;
    }
    case PORT_NUM.NODEINFO_APP: {
      const user = decodeInner(User, data.payload, state, 'user');
      if (user && from) {
        const node = ensureNode(state, from);
        node.user = user;
        node.role = user.role;
        node.hwModel = user.hw_model;
      }
      return;
    }
    case PORT_NUM.ROUTING_APP: {
      const routing = decodeInner(Routing, data.payload, state, 'routing');
      const reqId = data.request_id >>> 0;
      if (!routing || !reqId || routing.error_reason === undefined) return;
      const msg = state.messages.find((m) => m.direction === 'out' && m.id === reqId);
      if (!msg) return;
      if (routing.error_reason === ROUTING_ERROR.NONE) {
        msg.status = 'acked';
        msg.error = null;
      } else {
        msg.status = 'failed';
        msg.error = routingErrorName(routing.error_reason);
      }
      return;
    }
    case PORT_NUM.TELEMETRY_APP: {
      const tel = decodeInner(Telemetry, data.payload, state, 'telemetry');
      if (tel && tel.device_metrics && from) {
        const metrics = tel.device_metrics;
        state.telemetry.set(from, { time: tel.time ?? null, metrics, receivedAt: nowMs });
        ensureNode(state, from).deviceMetrics = metrics;
      }
      return;
    }
    default:
      return;
  }
}

function decodeInner(schema, payload, state, label) {
  try {
    return decodeMessage(schema, payload || new Uint8Array(0));
  } catch (error) {
    if (!(error instanceof ProtoError)) throw error;
    state.counters.decodeErrors++;
    pushCapped(state.logs, { time: Date.now(), text: `Could not decode ${label} payload: ${error.message}`, kind: 'sys' }, MAX_LOGS);
    return null;
  }
}

/** Record a text message we just transmitted (status 'sent' until an ack arrives). */
export function recordOutgoingText(state, { id, to, channel, text, nowMs = Date.now() }) {
  pushCapped(state.messages, {
    id: id >>> 0,
    from: state.myNum ?? 0,
    to: to >>> 0,
    channel,
    direct: (to >>> 0) !== BROADCAST_NUM,
    text,
    direction: 'out',
    status: 'sent',
    error: null,
    snr: null,
    rssi: null,
    hopStart: null,
    hopLimit: null,
    time: nowMs,
  }, MAX_MESSAGES);
}

/** Start a new session. Returns the state plus the want_config frame to transmit. */
export function beginSync(rand = Math.random) {
  const state = createSession();
  state.phase = 'syncing';
  state.wantConfigId = randomU32(rand);
  return { state, frame: buildWantConfigFrame(state.wantConfigId) };
}

/** Split accumulated device console text into lines for display. */
export function appendConsoleText(state, text, nowMs = Date.now()) {
  const joined = state.logTail + text;
  const parts = joined.split(/\r?\n/);
  state.logTail = parts.pop();
  for (const line of parts) {
    if (line.length === 0) continue;
    pushCapped(state.logs, { time: nowMs, text: line, kind: 'console' }, MAX_LOGS);
  }
}

/** Summaries used by the node table and the map. */
export function summarizeNodes(state, nowSecs = nowSeconds(Date.now())) {
  const rows = [];
  for (const node of state.nodes.values()) {
    const user = node.user || {};
    rows.push({
      num: node.num,
      id: node.id,
      longName: user.long_name || '',
      shortName: user.short_name || '',
      hwModel: node.hwModel,
      hwName: hardwareModelName(node.hwModel),
      role: deviceRoleName(node.role),
      lastHeard: node.lastHeard || 0,
      ageSecs: node.lastHeard ? Math.max(0, nowSecs - node.lastHeard) : null,
      snr: node.snr,
      battery: node.deviceMetrics?.battery_level ?? null,
      voltage: node.deviceMetrics?.voltage ?? null,
      position: node.position,
      hopsAway: node.hopsAway,
      viaMqtt: node.viaMqtt,
      isMe: state.myNum === node.num,
    });
  }
  rows.sort((a, b) => (b.lastHeard - a.lastHeard) || a.num - b.num);
  return rows;
}

/** Channels for display: the PSK is reduced to its byte length, never shown. */
export function summarizeChannels(state) {
  return [...state.channels.values()]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((ch) => {
      const s = ch.settings || {};
      return {
        index: ch.index ?? 0,
        role: ch.role ?? 0,
        name: s.name || '',
        pskBytes: s.psk ? s.psk.length : 0,
        uplink: !!s.uplink_enabled,
        downlink: !!s.downlink_enabled,
      };
    });
}

/** Config sections as JSON with secrets redacted (see toJsonSafe). */
export function configJson(state) {
  return toJsonSafe({
    config: state.config,
    moduleConfig: state.moduleConfig,
    notDecoded: state.configUnknown.map((u) => ({ scope: u.scope, field: u.no, wire: u.wire })),
  });
}
