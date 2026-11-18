/**
 * Schema-less protobuf decoder (like `protoc --decode_raw`), with byte offsets.
 *
 * Varint fields show uint / sint (zigzag) / bool. Fixed32 shows uint / int / float,
 * fixed64 shows uint / int / double. Length-delimited fields are ambiguous: the default
 * follows protoc's order (printable text, then nested message, then packed varints,
 * then raw bytes). Callers can override any LEN field by its absolute byte offset.
 * Deprecated groups (wire types 3 and 4) are supported.
 */
import { DecodeError, isPrintableText, utf8Strict, toHex, makeNode } from './bytes.js';

const MAX_DEPTH = 64;
const MAX_FIELD = 536870911n; // 2^29 - 1
const U64_MASK = (1n << 64n) - 1n;
const WIRE_NAMES = ['varint', 'fixed64', 'len', 'group-start', 'group-end', 'fixed32'];

function readVarint(ctx, pos, end) {
  const b = ctx.b;
  const start = pos;
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    if (pos >= end) throw new DecodeError('truncated varint', start);
    const byte = b[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    shift += 7n;
    if (!(byte & 0x80)) return { value: result & U64_MASK, next: pos };
  }
  throw new DecodeError('varint longer than 10 bytes', start);
}

const zigzag = (u) => (u >> 1n) ^ -(u & 1n);

function countItem(ctx, offset) {
  ctx.count++;
  if (ctx.count > ctx.maxItems) {
    throw new DecodeError(`more than ${ctx.maxItems} items; input too large for the tree view`, offset, true);
  }
}

function varintDisplay(u) {
  let out = `uint ${u} · sint ${zigzag(u)}`;
  if (u === 0n || u === 1n) out += ` · bool ${u === 1n}`;
  return out;
}

function readLE(b, pos, n) {
  let v = 0n;
  for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[pos + i]);
  return v;
}

function floatAt(b, pos, n) {
  const dv = new DataView(b.buffer, b.byteOffset + pos, n);
  return n === 4 ? dv.getFloat32(0, true) : dv.getFloat64(0, true);
}

/**
 * Parse fields in [pos, end). For a group (groupField set) parsing stops after the
 * matching end-group tag and `closed` is true.
 */
function parseFields(ctx, pos, end, depth, groupField) {
  if (depth > MAX_DEPTH) throw new DecodeError('nesting too deep', pos);
  const nodes = [];
  let closed = false;
  while (pos < end) {
    const start = pos;
    const key = readVarint(ctx, pos, end);
    pos = key.next;
    const fieldBig = key.value >> 3n;
    const wire = Number(key.value & 7n);
    if (fieldBig < 1n || fieldBig > MAX_FIELD) throw new DecodeError(`invalid field number ${fieldBig}`, start);
    const field = Number(fieldBig);

    if (wire === 4) {
      if (groupField !== field) throw new DecodeError(`unexpected end-group for field ${field}`, start);
      closed = true;
      break;
    }
    if (wire === 6 || wire === 7) throw new DecodeError(`invalid wire type ${wire}`, start);

    countItem(ctx, start);
    const b = ctx.b;
    const meta = { field, wire, wireName: WIRE_NAMES[wire] };

    if (wire === 0) {
      const v = readVarint(ctx, pos, end);
      pos = v.next;
      nodes.push({ ...makeNode(start, pos - start, `${field}`, 'varint', varintDisplay(v.value)), meta: { ...meta, raw: v.value.toString() } });
    } else if (wire === 1 || wire === 5) {
      const n = wire === 1 ? 8 : 4;
      if (pos + n > end) throw new DecodeError(`truncated fixed${n * 8}`, start);
      const u = readLE(b, pos, n);
      const sVal = BigInt.asIntN(n * 8, u);
      const fl = floatAt(b, pos, n);
      pos += n;
      const display = wire === 1
        ? `uint ${u} · int ${sVal} · double ${fl}`
        : `uint ${u} · int ${sVal} · float ${fl}`;
      nodes.push({ ...makeNode(start, pos - start, `${field}`, wire === 1 ? 'fixed64' : 'fixed32', display), meta: { ...meta, raw: u.toString() } });
    } else if (wire === 2) {
      const len = readVarint(ctx, pos, end);
      pos = len.next;
      if (len.value > BigInt(end - pos)) throw new DecodeError('length-delimited field exceeds its container', start);
      const dataStart = pos;
      const dataEnd = dataStart + Number(len.value);
      nodes.push(lenField(ctx, start, dataStart, dataEnd, field, depth, meta));
      pos = dataEnd;
    } else if (wire === 3) {
      const inner = parseFields(ctx, pos, end, depth + 1, field);
      if (!inner.closed) throw new DecodeError(`group for field ${field} is not terminated`, start);
      pos = inner.pos;
      nodes.push({ ...makeNode(start, pos - start, `${field}`, 'group', `group (${inner.nodes.length} field${inner.nodes.length === 1 ? '' : 's'})`, inner.nodes), meta: { ...meta, wireName: 'group' } });
    }
  }
  if (groupField !== undefined && !closed) throw new DecodeError(`group for field ${groupField} is not terminated`, pos);
  return { nodes, pos, closed };
}

/** Candidate parse of a length-delimited payload as a nested message. */
function tryMessage(ctx, dataStart, dataEnd, depth) {
  if (dataEnd === dataStart) return { nodes: [] };
  try {
    return { nodes: parseFields(ctx, dataStart, dataEnd, depth + 1, undefined).nodes };
  } catch (e) {
    if (e instanceof DecodeError && !e.fatal) return { error: e.message };
    throw e;
  }
}

/** Candidate parse of a length-delimited payload as packed varints. */
function tryPacked(ctx, dataStart, dataEnd) {
  if (dataEnd === dataStart) return null;
  const items = [];
  let pos = dataStart;
  try {
    while (pos < dataEnd) {
      const start = pos;
      const v = readVarint(ctx, pos, dataEnd);
      pos = v.next;
      countItem(ctx, start);
      items.push(makeNode(start, pos - start, `[${items.length}]`, 'varint', varintDisplay(v.value)));
    }
  } catch (e) {
    if (e instanceof DecodeError && !e.fatal) return null;
    throw e;
  }
  return items;
}

function lenField(ctx, start, dataStart, dataEnd, field, depth, meta) {
  const data = ctx.b.subarray(dataStart, dataEnd);
  const len = data.length;
  const text = len > 0 && isPrintableText(data) ? utf8Strict(data, dataStart) : null;
  const msg = tryMessage(ctx, dataStart, dataEnd, depth);
  const message = msg.nodes ?? null;
  const packed = tryPacked(ctx, dataStart, dataEnd);

  const options = ['bytes'];
  if (text !== null) options.push('string');
  if (message) options.push('message');
  if (packed) options.push('packed');

  const override = ctx.overrides[start];
  let mode;
  if (override && options.includes(override)) mode = override;
  else if (len === 0) mode = 'bytes';
  else if (text !== null) mode = 'string';
  else if (message) mode = 'message';
  else if (packed) mode = 'packed';
  else mode = 'bytes';

  const total = dataEnd - start;
  let node;
  if (mode === 'string') {
    const shown = text.length > 200 ? `${text.slice(0, 200)}...` : text;
    node = makeNode(start, total, `${field}`, 'string', `string ${JSON.stringify(shown)}`);
  } else if (mode === 'message') {
    node = makeNode(start, total, `${field}`, 'message', `message (${message.length} field${message.length === 1 ? '' : 's'})`, message);
  } else if (mode === 'packed') {
    node = makeNode(start, total, `${field}`, 'packed', `packed varints (${packed.length})`, packed);
  } else {
    const preview = toHex(data.subarray(0, 32));
    node = makeNode(start, total, `${field}`, 'bytes', `bytes[${len}] ${preview}${len > 32 ? '...' : ''}`);
  }
  node.meta = { ...meta, mode, options };
  if (override === 'message' && mode !== 'message') node.error = msg.error || 'not a valid nested message';
  return node;
}

/**
 * Decode raw protobuf bytes.
 * @param {Uint8Array} bytes
 * @param {{overrides?: Record<number, 'bytes'|'string'|'message'|'packed'>, maxItems?: number}} [opts]
 *   overrides are keyed by the absolute byte offset of a length-delimited field.
 */
export function decodeProtobuf(bytes, { overrides = {}, maxItems = 200000 } = {}) {
  const ctx = { b: bytes, overrides, count: 0, maxItems };
  const { nodes } = parseFields(ctx, 0, bytes.length, 0, undefined);
  const n = nodes.length;
  return {
    format: 'protobuf',
    root: makeNode(0, bytes.length, 'message', 'message', `${n} top-level field${n === 1 ? '' : 's'}`, nodes),
    value: null,
    diag: null,
    warnings: [],
  };
}

/** Heuristic confidence (0..1) that the bytes are a raw protobuf message. */
export function protobufScore(bytes) {
  if (bytes.length < 2) return 0;
  let res;
  try {
    res = decodeProtobuf(bytes);
  } catch {
    return 0;
  }
  const top = res.root.children;
  if (!top.length) return 0;
  let score = 0.45 + Math.min(0.25, top.length * 0.05);
  if (top.every((n) => Number(n.label) <= 30)) score += 0.1;
  const hasGroup = (n) => n.type === 'group' || (n.children || []).some(hasGroup);
  if (hasGroup(res.root)) score -= 0.1;
  return Math.min(0.85, Math.max(0, score));
}
