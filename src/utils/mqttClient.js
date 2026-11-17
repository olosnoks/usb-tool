/**
 * MQTT 3.1.1 client core for the browser (no dependencies).
 *
 * - Packet encoders and decoders for all 14 control packets, with the remaining-length varint.
 * - A streaming frame parser that copes with packets split across, or combined within, WebSocket messages.
 * - Topic name / topic filter validation and wildcard matching (+, #, and the $-topic rule).
 * - MqttClient: a WebSocket client (subprotocol "mqtt", binary frames) with CONNECT/CONNACK,
 *   keep-alive, SUBSCRIBE/UNSUBSCRIBE, and PUBLISH at QoS 0, 1 and 2.
 *
 * Browsers cannot open raw TCP sockets, so the broker must expose MQTT over WebSocket
 * (ws:// or wss://). MQTT 5.0 is not implemented; brokers accept 3.1.1 (protocol level 4).
 */

export const PACKET_TYPE = Object.freeze({
  CONNECT: 1, CONNACK: 2, PUBLISH: 3, PUBACK: 4, PUBREC: 5, PUBREL: 6, PUBCOMP: 7,
  SUBSCRIBE: 8, SUBACK: 9, UNSUBSCRIBE: 10, UNSUBACK: 11, PINGREQ: 12, PINGRESP: 13, DISCONNECT: 14,
});
export const PACKET_NAME = Object.freeze(Object.fromEntries(Object.entries(PACKET_TYPE).map(([k, v]) => [v, k])));
export const CONNACK_MESSAGES = Object.freeze({
  0: 'Connection accepted',
  1: 'Refused: unacceptable protocol version',
  2: 'Refused: identifier rejected',
  3: 'Refused: server unavailable',
  4: 'Refused: bad user name or password',
  5: 'Refused: not authorized',
});
export const SUBACK_FAILURE = 0x80;
export const MAX_REMAINING_LENGTH = 268435455;
const MAX_STRING_BYTES = 65535;
const WS_OPEN = 1;

const enc = new TextEncoder();
const decStrict = new TextDecoder('utf-8', { fatal: true });

export class MqttProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MqttProtocolError';
  }
}

// ---------------------------------------------------------------------------
// Remaining length (variable-length integer, 1 to 4 bytes, 7 bits per byte)
// ---------------------------------------------------------------------------

export function encodeRemainingLength(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX_REMAINING_LENGTH) {
    throw new RangeError(`Remaining length out of range: ${n}`);
  }
  const out = [];
  let x = n;
  do {
    let b = x % 128;
    x = Math.floor(x / 128);
    if (x > 0) b |= 0x80;
    out.push(b);
  } while (x > 0);
  return out;
}

/**
 * Returns { value, length } for the varint starting at `offset`, or null when more bytes are needed.
 * Throws MqttProtocolError when the varint runs past four bytes.
 */
export function decodeRemainingLength(bytes, offset = 0) {
  let multiplier = 1;
  let value = 0;
  let i = offset;
  for (let count = 0; count < 4; count++) {
    if (i >= bytes.length) return null;
    const b = bytes[i++];
    value += (b & 0x7f) * multiplier;
    if ((b & 0x80) === 0) return { value, length: i - offset };
    multiplier *= 128;
  }
  throw new MqttProtocolError('Malformed remaining length (continuation bit set on the fourth byte)');
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function concat(parts) {
  const arrays = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

const u16 = (n) => [(n >> 8) & 0xff, n & 0xff];
const EMPTY = new Uint8Array(0);

/** Accepts a string (UTF-8 encoded), a Uint8Array, an ArrayBuffer or null/undefined (empty). */
export function toBytes(v) {
  if (v === undefined || v === null) return EMPTY;
  if (typeof v === 'string') return enc.encode(v);
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  throw new TypeError('Payload must be a string, Uint8Array or ArrayBuffer');
}

/** Lossy UTF-8 decode for display (invalid bytes become U+FFFD). */
export function payloadToText(bytes) {
  return new TextDecoder('utf-8').decode(bytes);
}

function encodeString(str) {
  const b = enc.encode(String(str));
  if (b.length > MAX_STRING_BYTES) throw new RangeError('String longer than 65535 bytes');
  return concat([u16(b.length), b]);
}

function encodeBinary(bytes) {
  if (bytes.length > MAX_STRING_BYTES) throw new RangeError('Binary field longer than 65535 bytes');
  return concat([u16(bytes.length), bytes]);
}

function frame(byte0, body) {
  return concat([[byte0], encodeRemainingLength(body.length), body]);
}

// ---------------------------------------------------------------------------
// Topic validation and matching
// ---------------------------------------------------------------------------

/** Returns an error message for an invalid topic name (used in PUBLISH), or null. */
export function topicNameError(topic) {
  if (typeof topic !== 'string' || topic.length === 0) return 'Topic name must not be empty';
  if (/[+#]/.test(topic)) return 'Topic names cannot contain wildcards (+ or #)';
  if (topic.includes('\u0000')) return 'Topic name must not contain U+0000';
  if (enc.encode(topic).length > MAX_STRING_BYTES) return 'Topic name is longer than 65535 bytes';
  return null;
}

/** Returns an error message for an invalid topic filter (used in SUBSCRIBE), or null. */
export function topicFilterError(filter) {
  if (typeof filter !== 'string' || filter.length === 0) return 'Topic filter must not be empty';
  if (filter.includes('\u0000')) return 'Topic filter must not contain U+0000';
  if (enc.encode(filter).length > MAX_STRING_BYTES) return 'Topic filter is longer than 65535 bytes';
  const levels = filter.split('/');
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i];
    if (level.includes('#')) {
      if (level !== '#') return '# must occupy a whole level (for example sport/#)';
      if (i !== levels.length - 1) return '# must be the last level of the filter';
    }
    if (level.includes('+') && level !== '+') return '+ must occupy a whole level (for example sport/+/player)';
  }
  return null;
}

function assertTopicName(topic) {
  const err = topicNameError(topic);
  if (err) throw new Error(err);
  return topic;
}

function assertTopicFilter(filter) {
  const err = topicFilterError(filter);
  if (err) throw new Error(err);
  return filter;
}

/**
 * MQTT 3.1.1 topic matching. `+` matches exactly one level, `#` matches any number of
 * remaining levels including none (so "sport/#" matches "sport"). Filters that begin with a
 * wildcard never match topics that begin with `$` (for example $SYS/...).
 */
export function matchTopic(filter, topic) {
  if (typeof filter !== 'string' || typeof topic !== 'string') return false;
  if (topic.startsWith('$') && (filter.startsWith('#') || filter.startsWith('+'))) return false;
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

// ---------------------------------------------------------------------------
// Encoders (client to broker and broker to client; both directions for tests and symmetry)
// ---------------------------------------------------------------------------

export function encodeConnect(opts = {}) {
  const { clientId = '', cleanSession = true, keepAlive = 60, username, password, will } = opts;
  if (!Number.isInteger(keepAlive) || keepAlive < 0 || keepAlive > 65535) {
    throw new RangeError('Keep-alive must be an integer from 0 to 65535 seconds');
  }
  const hasUser = username !== undefined && username !== null && username !== '';
  const hasPass = password !== undefined && password !== null && password !== '';
  if (hasPass && !hasUser) throw new Error('MQTT 3.1.1 does not allow a password without a user name');
  if (!clientId && !cleanSession) throw new Error('An empty client id requires a clean session');

  let flags = cleanSession ? 0x02 : 0;
  const parts = [encodeString('MQTT'), [4], null, u16(keepAlive), encodeString(clientId)];
  if (will) {
    const qos = will.qos ?? 0;
    assertQos(qos);
    flags |= 0x04 | (qos << 3) | (will.retain ? 0x20 : 0);
    parts.push(encodeString(assertTopicName(will.topic)), encodeBinary(toBytes(will.payload)));
  }
  if (hasUser) {
    flags |= 0x80;
    parts.push(encodeString(username));
  }
  if (hasPass) {
    flags |= 0x40;
    parts.push(encodeBinary(toBytes(password)));
  }
  parts[2] = [flags];
  return frame(0x10, concat(parts));
}

export function encodeConnack({ sessionPresent = false, returnCode = 0 } = {}) {
  if (!Number.isInteger(returnCode) || returnCode < 0 || returnCode > 5) throw new RangeError('CONNACK return code must be 0 to 5');
  return frame(0x20, Uint8Array.from([sessionPresent ? 1 : 0, returnCode]));
}

function assertQos(qos) {
  if (qos !== 0 && qos !== 1 && qos !== 2) throw new RangeError(`QoS must be 0, 1 or 2 (got ${qos})`);
}

function assertPacketId(id) {
  if (!Number.isInteger(id) || id < 1 || id > 65535) throw new RangeError(`Packet identifier must be 1 to 65535 (got ${id})`);
}

export function encodePublish({ topic, payload, qos = 0, retain = false, dup = false, packetId } = {}) {
  assertTopicName(topic);
  assertQos(qos);
  if (dup && qos === 0) throw new Error('DUP must be 0 for QoS 0');
  if (qos > 0) assertPacketId(packetId);
  else if (packetId !== undefined) throw new Error('QoS 0 PUBLISH has no packet identifier');
  const byte0 = 0x30 | (dup ? 0x08 : 0) | (qos << 1) | (retain ? 0x01 : 0);
  const parts = [encodeString(topic)];
  if (qos > 0) parts.push(u16(packetId));
  parts.push(toBytes(payload));
  return frame(byte0, concat(parts));
}

function encodeIdOnly(byte0, packetId) {
  assertPacketId(packetId);
  return frame(byte0, Uint8Array.from(u16(packetId)));
}

export const encodePuback = (packetId) => encodeIdOnly(0x40, packetId);
export const encodePubrec = (packetId) => encodeIdOnly(0x50, packetId);
export const encodePubrel = (packetId) => encodeIdOnly(0x62, packetId);
export const encodePubcomp = (packetId) => encodeIdOnly(0x70, packetId);
export const encodeUnsuback = (packetId) => encodeIdOnly(0xb0, packetId);

export function encodeSubscribe({ packetId, subscriptions = [] } = {}) {
  assertPacketId(packetId);
  if (subscriptions.length === 0) throw new Error('SUBSCRIBE needs at least one topic filter');
  const parts = [u16(packetId)];
  for (const s of subscriptions) {
    const qos = s.qos ?? 0;
    assertQos(qos);
    parts.push(encodeString(assertTopicFilter(s.filter)), [qos]);
  }
  return frame(0x82, concat(parts));
}

export function encodeSuback({ packetId, returnCodes = [] } = {}) {
  assertPacketId(packetId);
  for (const c of returnCodes) {
    if (c !== 0 && c !== 1 && c !== 2 && c !== SUBACK_FAILURE) throw new RangeError(`Invalid SUBACK return code ${c}`);
  }
  return frame(0x90, concat([u16(packetId), returnCodes]));
}

export function encodeUnsubscribe({ packetId, filters = [] } = {}) {
  assertPacketId(packetId);
  if (filters.length === 0) throw new Error('UNSUBSCRIBE needs at least one topic filter');
  const parts = [u16(packetId)];
  for (const f of filters) parts.push(encodeString(assertTopicFilter(f)));
  return frame(0xa2, concat(parts));
}

export const encodePingreq = () => frame(0xc0, EMPTY);
export const encodePingresp = () => frame(0xd0, EMPTY);
export const encodeDisconnect = () => frame(0xe0, EMPTY);

// ---------------------------------------------------------------------------
// Decoders
// ---------------------------------------------------------------------------

class Reader {
  constructor(bytes) {
    this.b = bytes;
    this.p = 0;
  }
  get remaining() {
    return this.b.length - this.p;
  }
  need(n) {
    if (this.p + n > this.b.length) throw new MqttProtocolError('Truncated packet body');
  }
  u8() {
    this.need(1);
    return this.b[this.p++];
  }
  u16() {
    this.need(2);
    const v = (this.b[this.p] << 8) | this.b[this.p + 1];
    this.p += 2;
    return v;
  }
  packetId() {
    const id = this.u16();
    if (id === 0) throw new MqttProtocolError('Packet identifier must not be zero');
    return id;
  }
  str() {
    const n = this.u16();
    this.need(n);
    const slice = this.b.slice(this.p, this.p + n);
    this.p += n;
    try {
      return decStrict.decode(slice);
    } catch {
      throw new MqttProtocolError('String field is not valid UTF-8');
    }
  }
  bin() {
    const n = this.u16();
    this.need(n);
    const v = this.b.slice(this.p, this.p + n);
    this.p += n;
    return v;
  }
  rest() {
    const v = this.b.slice(this.p);
    this.p = this.b.length;
    return v;
  }
  end(what) {
    if (this.remaining !== 0) throw new MqttProtocolError(`Extra bytes after ${what}`);
  }
}

/**
 * Finds one complete frame at `offset`. Returns { type, flags, body, end } or null when the
 * frame is not complete yet. `type` is the numeric packet type; body is a copy.
 */
export function parseFrame(buf, offset = 0) {
  if (offset >= buf.length) return null;
  const byte0 = buf[offset];
  const rl = decodeRemainingLength(buf, offset + 1);
  if (!rl) return null;
  const start = offset + 1 + rl.length;
  const end = start + rl.value;
  if (end > buf.length) return null;
  return { type: byte0 >> 4, flags: byte0 & 0x0f, body: buf.slice(start, end), end };
}

/** Decodes the body of one packet. Returns an object whose `type` is the packet name. */
export function decodeBody(type, flags, body) {
  const name = PACKET_NAME[type];
  if (!name) throw new MqttProtocolError(`Unknown packet type ${type}`);
  const r = new Reader(body);
  const expectFlags = (want) => {
    if (flags !== want) throw new MqttProtocolError(`${name} must have fixed-header flags 0x${want.toString(16)} (got 0x${flags.toString(16)})`);
  };

  switch (type) {
    case PACKET_TYPE.CONNECT: {
      expectFlags(0);
      const protocolName = r.str();
      const protocolLevel = r.u8();
      const cf = r.u8();
      const keepAlive = r.u16();
      const clientId = r.str();
      if (cf & 0x01) throw new MqttProtocolError('CONNECT reserved flag bit is set');
      const willFlag = !!(cf & 0x04);
      const willQos = (cf >> 3) & 3;
      const willRetain = !!(cf & 0x20);
      if (!willFlag && (willQos !== 0 || willRetain)) throw new MqttProtocolError('Will QoS/retain set without the will flag');
      if (willQos === 3) throw new MqttProtocolError('Will QoS 3 is invalid');
      const pkt = {
        type: name, protocolName, protocolLevel, cleanSession: !!(cf & 0x02), keepAlive, clientId,
        will: null, username: undefined, password: undefined,
      };
      if (willFlag) pkt.will = { topic: r.str(), payload: r.bin(), qos: willQos, retain: willRetain };
      if (cf & 0x80) pkt.username = r.str();
      if (cf & 0x40) {
        if (!(cf & 0x80)) throw new MqttProtocolError('Password flag set without user name flag');
        pkt.password = r.bin();
      }
      r.end('CONNECT');
      return pkt;
    }
    case PACKET_TYPE.CONNACK: {
      expectFlags(0);
      const ack = r.u8();
      const returnCode = r.u8();
      if (ack & 0xfe) throw new MqttProtocolError('CONNACK reserved bits are set');
      r.end('CONNACK');
      return { type: name, sessionPresent: !!(ack & 1), returnCode };
    }
    case PACKET_TYPE.PUBLISH: {
      const dup = !!(flags & 0x08);
      const qos = (flags >> 1) & 3;
      const retain = !!(flags & 0x01);
      if (qos === 3) throw new MqttProtocolError('PUBLISH QoS 3 is invalid');
      if (dup && qos === 0) throw new MqttProtocolError('PUBLISH DUP must be 0 for QoS 0');
      const topic = r.str();
      if (topicNameError(topic)) throw new MqttProtocolError(`Invalid topic name in PUBLISH: ${topic}`);
      const packetId = qos > 0 ? r.packetId() : undefined;
      return { type: name, dup, qos, retain, topic, packetId, payload: r.rest() };
    }
    case PACKET_TYPE.PUBACK:
    case PACKET_TYPE.PUBREC:
    case PACKET_TYPE.PUBCOMP:
    case PACKET_TYPE.UNSUBACK: {
      expectFlags(0);
      const packetId = r.packetId();
      r.end(name);
      return { type: name, packetId };
    }
    case PACKET_TYPE.PUBREL: {
      expectFlags(2);
      const packetId = r.packetId();
      r.end(name);
      return { type: name, packetId };
    }
    case PACKET_TYPE.SUBSCRIBE: {
      expectFlags(2);
      const packetId = r.packetId();
      const subscriptions = [];
      while (r.remaining > 0) {
        const filter = r.str();
        const qos = r.u8();
        if (qos > 2) throw new MqttProtocolError('Requested QoS must be 0 to 2');
        if (topicFilterError(filter)) throw new MqttProtocolError(`Invalid topic filter: ${filter}`);
        subscriptions.push({ filter, qos });
      }
      if (subscriptions.length === 0) throw new MqttProtocolError('SUBSCRIBE has no topic filters');
      return { type: name, packetId, subscriptions };
    }
    case PACKET_TYPE.SUBACK: {
      expectFlags(0);
      const packetId = r.packetId();
      const returnCodes = [];
      while (r.remaining > 0) {
        const c = r.u8();
        if (c !== 0 && c !== 1 && c !== 2 && c !== SUBACK_FAILURE) throw new MqttProtocolError(`Invalid SUBACK return code ${c}`);
        returnCodes.push(c);
      }
      return { type: name, packetId, returnCodes };
    }
    case PACKET_TYPE.UNSUBSCRIBE: {
      expectFlags(2);
      const packetId = r.packetId();
      const filters = [];
      while (r.remaining > 0) filters.push(r.str());
      if (filters.length === 0) throw new MqttProtocolError('UNSUBSCRIBE has no topic filters');
      return { type: name, packetId, filters };
    }
    case PACKET_TYPE.PINGREQ:
    case PACKET_TYPE.PINGRESP:
    case PACKET_TYPE.DISCONNECT: {
      expectFlags(0);
      r.end(name);
      return { type: name };
    }
    default:
      throw new MqttProtocolError(`Unknown packet type ${type}`);
  }
}

/** Decodes exactly one complete packet (header included). Throws if bytes are incomplete or extra. */
export function decodePacket(bytes) {
  const f = parseFrame(bytes, 0);
  if (!f) throw new MqttProtocolError('Incomplete packet');
  if (f.end !== bytes.length) throw new MqttProtocolError('Extra bytes after packet');
  return decodeBody(f.type, f.flags, f.body);
}

/**
 * Streaming parser. push() accepts any slicing of the byte stream (a WebSocket message may hold
 * part of a packet, one packet, or several) and returns the packets completed by that chunk.
 */
export class MqttStreamParser {
  constructor() {
    this.buf = EMPTY;
  }
  reset() {
    this.buf = EMPTY;
  }
  get pendingBytes() {
    return this.buf.length;
  }
  push(chunk) {
    const bytes = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : chunk;
    if (!(bytes instanceof Uint8Array)) throw new TypeError('MqttStreamParser.push expects bytes');
    this.buf = this.buf.length ? concat([this.buf, bytes]) : bytes.slice();
    const out = [];
    let off = 0;
    try {
      for (;;) {
        const f = parseFrame(this.buf, off);
        if (!f) break;
        out.push(decodeBody(f.type, f.flags, f.body));
        off = f.end;
      }
    } catch (e) {
      this.reset();
      throw e;
    }
    this.buf = this.buf.slice(off);
    return out;
  }
}

// ---------------------------------------------------------------------------
// Connection-form helpers (pure; used by the workbench and its tests)
// ---------------------------------------------------------------------------

/** Returns an error message for a broker URL that a browser WebSocket can use, or null. */
export function brokerUrlError(url) {
  if (typeof url !== 'string' || !url.trim()) return 'Enter a broker URL such as wss://broker.example.com:8884/mqtt';
  if (!/^wss?:\/\/[^/\s]+/i.test(url.trim())) return 'The URL must start with ws:// or wss:// (MQTT over WebSocket)';
  return null;
}

/**
 * An https page cannot open a ws:// socket (mixed content is blocked by the browser), so the
 * broker must offer wss://. Returns a warning string or null.
 */
export function mixedContentWarning(pageProtocol, url) {
  if (pageProtocol === 'https:' && typeof url === 'string' && /^ws:\/\//i.test(url.trim())) {
    return 'This page is served over https, so the browser blocks ws:// connections (mixed content). Use wss:// with a TLS WebSocket listener on the broker.';
  }
  return null;
}

export const PROFILE_STORAGE_KEY = 'usbtool.mqttClient.profiles.v1';

/**
 * Removes the password unless the profile was saved with "remember password" ticked.
 */
export function stripProfileSecrets(profile) {
  const { password, ...rest } = profile || {};
  return rest.savePassword ? { ...rest, password: password ?? '' } : rest;
}

export function loadProfiles(storage) {
  try {
    const raw = storage?.getItem?.(PROFILE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => p && typeof p.name === 'string') : [];
  } catch {
    return [];
  }
}

export function saveProfiles(storage, profiles) {
  if (!storage?.setItem) return false;
  storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles.map(stripProfileSecrets)));
  return true;
}

// ---------------------------------------------------------------------------
// Payload views
// ---------------------------------------------------------------------------

/** Pretty-printed JSON for a payload, or null when it is not valid JSON. */
export function prettyJson(bytes) {
  try {
    return JSON.stringify(JSON.parse(payloadToText(bytes)), null, 2);
  } catch {
    return null;
  }
}

export function hexDump(bytes, maxBytes = 4096) {
  const n = Math.min(bytes.length, maxBytes);
  const lines = [];
  for (let off = 0; off < n; off += 16) {
    const row = bytes.subarray(off, Math.min(off + 16, n));
    const hex = Array.from(row, (b) => b.toString(16).padStart(2, '0'));
    const left = hex.slice(0, 8).join(' ').padEnd(23, ' ');
    const right = hex.slice(8).join(' ').padEnd(23, ' ');
    const ascii = Array.from(row, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${left}  ${right}  |${ascii}|`);
  }
  if (bytes.length > n) lines.push(`... ${bytes.length - n} more bytes not shown`);
  return lines.join('\n');
}

/** Parses hex digits (spaces, colons, dashes and an optional 0x prefix are ignored). */
export function parseHex(text) {
  const clean = String(text).replace(/[\s:,_-]/g, '').replace(/^0x/i, '');
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new Error('Hex payload must be an even number of hex digits');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function bytesToBase64(bytes) {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(s);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

/**
 * WebSocket MQTT 3.1.1 client.
 *
 * Callbacks: onStatus(state, detail) with state 'disconnected' | 'connecting' | 'connected';
 * onMessage({ topic, payload, qos, retain, dup, time, direction: 'in' });
 * onLog(text, level).
 *
 * Messages in flight when the connection drops are rejected; they are not retried after a
 * reconnect (no session resumption).
 */
export class MqttClient {
  constructor(opts = {}) {
    this.url = opts.url ?? '';
    this.clientId = opts.clientId ?? '';
    this.username = opts.username;
    this.password = opts.password;
    this.keepAlive = opts.keepAlive ?? 60;
    this.cleanSession = opts.cleanSession ?? true;
    this.will = opts.will ?? null;
    this.connectTimeoutMs = opts.connectTimeoutMs ?? 10000;
    this.ackTimeoutMs = opts.ackTimeoutMs ?? 15000;
    this.WebSocketImpl = opts.WebSocketImpl ?? (typeof WebSocket !== 'undefined' ? WebSocket : undefined);
    this.onStatus = opts.onStatus ?? (() => {});
    this.onMessage = opts.onMessage ?? (() => {});
    this.onLog = opts.onLog ?? (() => {});

    this.state = 'disconnected';
    this.ws = null;
    this.parser = new MqttStreamParser();
    this.pending = new Map();
    this.incomingQos2 = new Set();
    this.nextId = 0;
    this.connectWaiter = null;
    this.connectTimer = null;
    this.keepTimer = null;
    this.lastSentAt = 0;
    this.pingSentAt = 0;
  }

  connect() {
    if (this.state !== 'disconnected') return Promise.reject(new Error(`Already ${this.state}`));
    if (!this.WebSocketImpl) return Promise.reject(new Error('WebSocket is not available in this browser'));
    const urlErr = brokerUrlError(this.url);
    if (urlErr) return Promise.reject(new Error(urlErr));
    if (!this.clientId && !this.cleanSession) return Promise.reject(new Error('An empty client id requires a clean session'));

    this.parser.reset();
    this.incomingQos2.clear();
    this._setState('connecting', this.url);
    return new Promise((resolve, reject) => {
      this.connectWaiter = { resolve, reject };
      this.connectTimer = setTimeout(() => this._fail(new Error('Timed out waiting for CONNACK')), this.connectTimeoutMs);
      let ws;
      try {
        ws = new this.WebSocketImpl(this.url, 'mqtt');
        ws.binaryType = 'arraybuffer';
      } catch (e) {
        this._fail(e);
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        if (this.ws !== ws) return;
        try {
          this._sendRaw(encodeConnect({
            clientId: this.clientId, cleanSession: this.cleanSession, keepAlive: this.keepAlive,
            username: this.username, password: this.password, will: this.will,
          }));
          this._log(`CONNECT sent (client id "${this.clientId}", keep-alive ${this.keepAlive}s, clean session ${this.cleanSession ? 'yes' : 'no'})`);
        } catch (e) {
          this._fail(e);
        }
      };
      ws.onmessage = (ev) => {
        if (this.ws === ws) this._onData(ev.data);
      };
      ws.onerror = () => {
        if (this.ws === ws) this._log('WebSocket error. Browsers hide the details: check the URL, port, TLS certificate and that the broker has a WebSocket listener.', 'error');
      };
      ws.onclose = (ev) => {
        if (this.ws === ws) this._onClose(ev);
      };
    });
  }

  /** Sends DISCONNECT and closes the socket. Safe to call when already disconnected. */
  disconnect() {
    if (!this.ws) return;
    try {
      if (this.state === 'connected') this._sendRaw(encodeDisconnect());
    } catch {
      /* socket already gone */
    }
    this._log('Disconnected');
    this._teardown(null);
  }

  async subscribe(filter, qos = 0) {
    this._requireConnected();
    assertTopicFilter(filter);
    assertQos(qos);
    const id = this._allocId();
    const codes = await this._track(id, 'sub', encodeSubscribe({ packetId: id, subscriptions: [{ filter, qos }] }));
    const code = codes[0];
    if (code === SUBACK_FAILURE) return { filter, granted: null, failed: true };
    return { filter, granted: code, failed: false };
  }

  async unsubscribe(filter) {
    this._requireConnected();
    assertTopicFilter(filter);
    const id = this._allocId();
    await this._track(id, 'unsub', encodeUnsubscribe({ packetId: id, filters: [filter] }));
    return { filter };
  }

  /** Resolves when the message is handed to the socket (QoS 0), PUBACK received (QoS 1) or PUBCOMP received (QoS 2). */
  async publish(topic, payload, opts = {}) {
    this._requireConnected();
    const qos = opts.qos ?? 0;
    const retain = !!opts.retain;
    assertTopicName(topic);
    assertQos(qos);
    const body = toBytes(payload);
    if (qos === 0) {
      this._sendRaw(encodePublish({ topic, payload: body, qos: 0, retain }));
      return { qos: 0, packetId: undefined };
    }
    const id = this._allocId();
    const bytes = encodePublish({ topic, payload: body, qos, retain, packetId: id });
    await this._track(id, qos === 2 ? 'qos2' : 'qos1', bytes);
    return { qos, packetId: id };
  }

  // -- internals -----------------------------------------------------------

  _requireConnected() {
    if (this.state !== 'connected' || !this.ws) throw new Error('Not connected');
  }

  _allocId() {
    for (let i = 0; i < 65535; i++) {
      this.nextId = this.nextId >= 65535 ? 1 : this.nextId + 1;
      if (!this.pending.has(this.nextId)) return this.nextId;
    }
    throw new Error('No free packet identifiers (65535 in flight)');
  }

  _track(id, kind, bytes) {
    return new Promise((resolve, reject) => {
      const entry = { kind, stage: 'publish', resolve, reject, timer: null };
      entry.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`No ${kind} acknowledgement for packet ${id} within ${this.ackTimeoutMs} ms`));
      }, this.ackTimeoutMs);
      this.pending.set(id, entry);
      try {
        this._sendRaw(bytes);
      } catch (e) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }

  _take(id, kinds) {
    const e = this.pending.get(id);
    if (!e || !kinds.includes(e.kind)) return null;
    clearTimeout(e.timer);
    this.pending.delete(id);
    return e;
  }

  _sendRaw(bytes) {
    if (!this.ws || this.ws.readyState !== WS_OPEN) throw new Error('Socket is not open');
    this.ws.send(bytes);
    this.lastSentAt = Date.now();
  }

  _onData(data) {
    if (typeof data === 'string') {
      this._fail(new Error('Broker sent a text frame; MQTT requires binary frames'));
      return;
    }
    let packets;
    try {
      packets = this.parser.push(data);
    } catch (e) {
      this._fail(e);
      return;
    }
    for (const p of packets) {
      if (!this.ws) return;
      try {
        this._handle(p);
      } catch (e) {
        this._fail(e);
        return;
      }
    }
  }

  _handle(p) {
    switch (p.type) {
      case 'CONNACK': {
        if (this.state !== 'connecting' || !this.connectWaiter) throw new MqttProtocolError('Unexpected CONNACK');
        if (p.returnCode !== 0) {
          this._fail(new Error(CONNACK_MESSAGES[p.returnCode] ?? `Refused: return code ${p.returnCode}`));
          return;
        }
        if (p.sessionPresent && this.cleanSession) throw new MqttProtocolError('Session present flag set after a clean-session CONNECT');
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
        const waiter = this.connectWaiter;
        this.connectWaiter = null;
        this._log(`CONNACK: ${CONNACK_MESSAGES[0]}${p.sessionPresent ? ' (session present)' : ''}`);
        this._startKeepalive();
        this._setState('connected', this.url);
        waiter.resolve();
        return;
      }
      case 'PUBLISH': {
        const msg = { direction: 'in', topic: p.topic, payload: p.payload, qos: p.qos, retain: p.retain, dup: p.dup, time: Date.now() };
        if (p.qos === 0) {
          this._emit(msg);
        } else if (p.qos === 1) {
          this._emit(msg);
          this._sendRaw(encodePuback(p.packetId));
        } else {
          if (!this.incomingQos2.has(p.packetId)) {
            this.incomingQos2.add(p.packetId);
            this._emit(msg);
          }
          this._sendRaw(encodePubrec(p.packetId));
        }
        return;
      }
      case 'PUBREL': {
        this.incomingQos2.delete(p.packetId);
        this._sendRaw(encodePubcomp(p.packetId));
        return;
      }
      case 'PUBACK': {
        const e = this._take(p.packetId, ['qos1']);
        if (e) e.resolve(undefined);
        else this._log(`PUBACK for unknown packet ${p.packetId} ignored`, 'warn');
        return;
      }
      case 'PUBREC': {
        const e = this.pending.get(p.packetId);
        if (e && e.kind === 'qos2' && e.stage === 'publish') {
          e.stage = 'release';
          this._sendRaw(encodePubrel(p.packetId));
        } else {
          this._log(`PUBREC for unexpected packet ${p.packetId} ignored`, 'warn');
        }
        return;
      }
      case 'PUBCOMP': {
        const e = this.pending.get(p.packetId);
        if (e && e.kind === 'qos2' && e.stage === 'release') {
          this._take(p.packetId, ['qos2']).resolve(undefined);
        } else {
          this._log(`PUBCOMP for unexpected packet ${p.packetId} ignored`, 'warn');
        }
        return;
      }
      case 'SUBACK': {
        const e = this._take(p.packetId, ['sub']);
        if (e) e.resolve(p.returnCodes);
        else this._log(`SUBACK for unknown packet ${p.packetId} ignored`, 'warn');
        return;
      }
      case 'UNSUBACK': {
        const e = this._take(p.packetId, ['unsub']);
        if (e) e.resolve(undefined);
        else this._log(`UNSUBACK for unknown packet ${p.packetId} ignored`, 'warn');
        return;
      }
      case 'PINGRESP':
        this.pingSentAt = 0;
        return;
      default:
        throw new MqttProtocolError(`Broker sent ${p.type}, which a client must not receive`);
    }
  }

  _startKeepalive() {
    clearInterval(this.keepTimer);
    this.keepTimer = null;
    this.pingSentAt = 0;
    if (!this.keepAlive) return;
    const ms = this.keepAlive * 1000;
    this.keepTimer = setInterval(() => {
      const now = Date.now();
      if (this.pingSentAt && now - this.pingSentAt > ms) {
        this._fail(new Error('No PINGRESP from broker within the keep-alive period; closing'));
        return;
      }
      if (!this.pingSentAt && now - this.lastSentAt >= ms) {
        try {
          this._sendRaw(encodePingreq());
          this.pingSentAt = now;
        } catch (e) {
          this._fail(e);
        }
      }
    }, Math.max(500, Math.floor(ms / 4)));
  }

  _onClose(ev) {
    const detail = `Connection closed (code ${ev?.code ?? '?'}${ev?.reason ? `, ${ev.reason}` : ''})`;
    this._log(detail, 'warn');
    this._teardown(new Error(detail));
  }

  _fail(err) {
    this._log(err?.message ?? String(err), 'error');
    this._teardown(err instanceof Error ? err : new Error(String(err)));
  }

  _teardown(err) {
    clearTimeout(this.connectTimer);
    clearInterval(this.keepTimer);
    this.connectTimer = null;
    this.keepTimer = null;
    const reason = err ? err.message : 'Disconnected';
    const waiter = this.connectWaiter;
    this.connectWaiter = null;
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        ws.close();
      } catch {
        /* already closed */
      }
    }
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
    this.incomingQos2.clear();
    this.parser.reset();
    if (waiter) waiter.reject(err ?? new Error('Disconnected'));
    this._setState('disconnected', reason);
  }

  _setState(state, detail) {
    this.state = state;
    try {
      this.onStatus(state, detail);
    } catch {
      /* UI callback errors must not break the protocol */
    }
  }

  _emit(msg) {
    try {
      this.onMessage(msg);
    } catch {
      /* ignore */
    }
  }

  _log(text, level = 'info') {
    try {
      this.onLog(text, level);
    } catch {
      /* ignore */
    }
  }
}
