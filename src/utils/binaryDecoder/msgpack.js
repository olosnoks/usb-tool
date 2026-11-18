/**
 * MessagePack decoder (full spec, including ext types and the timestamp extension -1)
 * with byte offsets, plus an encoder for JSON-like values.
 *
 * Decoded JS values follow the same conventions as cbor.js: BigInt for integers outside
 * the safe range, Uint8Array for bin, {$ext, $hex} for ext values (timestamps are shown
 * as ISO text in the tree but kept as ext in the JS value so they round-trip).
 */
import { DecodeError, toHex, utf8Strict, utf8Encode, makeNode, shiftOffsets, normInt, readBigUint, parseHex, MAX_SAFE } from './bytes.js';

const MAX_DEPTH = 256;
const TWO64 = 1n << 64n;

function ensure(ctx, n, at) {
  if (ctx.pos + n > ctx.end) throw new DecodeError(`truncated input: ${n} more byte(s) needed`, at);
}

function readUint(ctx, n) {
  const at = ctx.pos;
  ensure(ctx, n, at);
  const v = readBigUint(ctx.b, ctx.pos, n);
  ctx.pos += n;
  return v;
}

function readInt(ctx, n) {
  return BigInt.asIntN(n * 8, readUint(ctx, n));
}

function checkLen(ctx, n, at) {
  if (BigInt(n) > BigInt(ctx.end - ctx.pos)) throw new DecodeError('length exceeds remaining input', at);
  return n;
}

function countItem(ctx, at) {
  ctx.count++;
  if (ctx.count > ctx.maxItems) throw new DecodeError(`more than ${ctx.maxItems} items; input too large for the tree view`, at, true);
}

function leaf(start, ctx, type, diag, js) {
  const node = makeNode(start, ctx.pos - start, '', type, diag);
  node.js = js;
  return node;
}

function readBytesData(ctx, len, start) {
  checkLen(ctx, len, start);
  const data = ctx.b.subarray(ctx.pos, ctx.pos + len);
  ctx.pos += len;
  return data;
}

function readExt(ctx, start, len) {
  const type = readInt(ctx, 1);
  const data = readBytesData(ctx, len, start);
  const t = Number(type);
  const hex = toHex(data);
  const js = { $ext: t, $hex: hex };
  if (t === -1) {
    const ts = timestampOf(data);
    if (ts) {
      const node = leaf(start, ctx, 'timestamp', `timestamp ${ts.iso}`, js);
      node.note = `${ts.seconds} s, ${ts.nanos} ns`;
      return node;
    }
  }
  return leaf(start, ctx, 'ext', `ext ${t} h'${hex}'`, js);
}

/** Timestamp extension (type -1): 4, 8 or 12 byte payloads. */
function timestampOf(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let seconds;
  let nanos;
  if (data.length === 4) {
    seconds = BigInt(dv.getUint32(0));
    nanos = 0n;
  } else if (data.length === 8) {
    const d64 = dv.getBigUint64(0);
    nanos = d64 >> 34n;
    seconds = d64 & ((1n << 34n) - 1n);
  } else if (data.length === 12) {
    nanos = BigInt(dv.getUint32(0));
    seconds = dv.getBigInt64(4);
  } else {
    return null;
  }
  const ms = Number(seconds) * 1000 + Number(nanos) / 1e6;
  const iso = Math.abs(ms) < 8.64e15 ? new Date(ms).toISOString() : `${seconds}s`;
  return { seconds: seconds.toString(), nanos: nanos.toString(), iso };
}

function readItem(ctx, depth) {
  if (depth > MAX_DEPTH) throw new DecodeError('nesting too deep', ctx.pos);
  const start = ctx.pos;
  countItem(ctx, start);
  ensure(ctx, 1, start);
  const m = ctx.b[ctx.pos++];

  if (m <= 0x7f) return leaf(start, ctx, 'uint', `${m}`, m);
  if (m >= 0xe0) return leaf(start, ctx, 'int', `${m - 256}`, m - 256);
  if (m >= 0x80 && m <= 0x8f) return readMap(ctx, start, m & 0x0f, depth);
  if (m >= 0x90 && m <= 0x9f) return readArray(ctx, start, m & 0x0f, depth);
  if (m >= 0xa0 && m <= 0xbf) return readStr(ctx, start, m & 0x1f);

  switch (m) {
    case 0xc0: return leaf(start, ctx, 'null', 'nil', null);
    case 0xc1: throw new DecodeError('0xc1 is never used in MessagePack', start);
    case 0xc2: return leaf(start, ctx, 'bool', 'false', false);
    case 0xc3: return leaf(start, ctx, 'bool', 'true', true);
    case 0xc4: return readBin(ctx, start, Number(readUint(ctx, 1)));
    case 0xc5: return readBin(ctx, start, Number(readUint(ctx, 2)));
    case 0xc6: return readBin(ctx, start, Number(readUint(ctx, 4)));
    case 0xc7: return readExt(ctx, start, Number(readUint(ctx, 1)));
    case 0xc8: return readExt(ctx, start, Number(readUint(ctx, 2)));
    case 0xc9: return readExt(ctx, start, Number(readUint(ctx, 4)));
    case 0xca: {
      const dv = new DataView(new ArrayBuffer(4));
      dv.setUint32(0, Number(readUint(ctx, 4)));
      const v = dv.getFloat32(0);
      return leaf(start, ctx, 'float', String(v), v);
    }
    case 0xcb: {
      const dv = new DataView(new ArrayBuffer(8));
      dv.setBigUint64(0, readUint(ctx, 8));
      const v = dv.getFloat64(0);
      return leaf(start, ctx, 'float', String(v), v);
    }
    case 0xcc: return intLeaf(ctx, start, readUint(ctx, 1));
    case 0xcd: return intLeaf(ctx, start, readUint(ctx, 2));
    case 0xce: return intLeaf(ctx, start, readUint(ctx, 4));
    case 0xcf: return intLeaf(ctx, start, readUint(ctx, 8));
    case 0xd0: return intLeaf(ctx, start, readInt(ctx, 1));
    case 0xd1: return intLeaf(ctx, start, readInt(ctx, 2));
    case 0xd2: return intLeaf(ctx, start, readInt(ctx, 4));
    case 0xd3: return intLeaf(ctx, start, readInt(ctx, 8));
    case 0xd4: return readExt(ctx, start, 1);
    case 0xd5: return readExt(ctx, start, 2);
    case 0xd6: return readExt(ctx, start, 4);
    case 0xd7: return readExt(ctx, start, 8);
    case 0xd8: return readExt(ctx, start, 16);
    case 0xd9: return readStr(ctx, start, Number(readUint(ctx, 1)));
    case 0xda: return readStr(ctx, start, Number(readUint(ctx, 2)));
    case 0xdb: return readStr(ctx, start, Number(readUint(ctx, 4)));
    case 0xdc: return readArray(ctx, start, Number(readUint(ctx, 2)), depth);
    case 0xdd: return readArray(ctx, start, Number(readUint(ctx, 4)), depth);
    case 0xde: return readMap(ctx, start, Number(readUint(ctx, 2)), depth);
    case 0xdf: return readMap(ctx, start, Number(readUint(ctx, 4)), depth);
    default:
      throw new DecodeError('unknown format byte', start);
  }
}

function intLeaf(ctx, start, big) {
  return leaf(start, ctx, big < 0n ? 'int' : 'uint', big.toString(), normInt(big));
}

function readBin(ctx, start, len) {
  const data = readBytesData(ctx, len, start);
  return leaf(start, ctx, 'bin', `h'${toHex(data)}'`, new Uint8Array(data));
}

function readStr(ctx, start, len) {
  const data = readBytesData(ctx, len, start);
  const s = utf8Strict(data, start);
  return leaf(start, ctx, 'str', JSON.stringify(s), s);
}

function readArray(ctx, start, n, depth) {
  checkLen(ctx, n, start);
  const items = [];
  for (let i = 0; i < n; i++) items.push(readItem(ctx, depth + 1));
  items.forEach((it, i) => { it.label = `[${i}]`; });
  const node = makeNode(start, ctx.pos - start, '', 'array', `array(${n})`, items);
  node.js = items.map((i) => i.js);
  return node;
}

function readMap(ctx, start, n, depth) {
  checkLen(ctx, n * 2, start);
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const k = readItem(ctx, depth + 1);
    const v = readItem(ctx, depth + 1);
    pairs.push({ k, v });
  }
  const children = pairs.map((p, i) => makeNode(p.k.offset, p.v.offset + p.v.length - p.k.offset, `pair ${i}`, 'pair', `${p.k.value}: ${p.v.value}`, [p.k, p.v]));
  const obj = {};
  for (const p of pairs) obj[typeof p.k.js === 'string' ? p.k.js : p.k.value] = p.v.js;
  const node = makeNode(start, ctx.pos - start, '', 'map', `map(${n})`, children);
  node.js = obj;
  return node;
}

/** Decode one or more concatenated MessagePack objects. */
export function decodeMsgpack(bytes, { maxItems = 200000 } = {}) {
  const ctx = { b: bytes, pos: 0, end: bytes.length, count: 0, maxItems };
  const items = [];
  while (ctx.pos < ctx.end) items.push(readItem(ctx, 0));
  if (items.length === 0) throw new DecodeError('empty input', 0);
  const single = items.length === 1;
  const root = single ? items[0] : makeNode(0, bytes.length, 'sequence', 'sequence', `${items.length} top-level objects`, items);
  if (single) root.label = 'root';
  return {
    format: 'msgpack',
    root,
    value: single ? items[0].js : items.map((i) => i.js),
    diag: '',
    warnings: single ? [] : ['input holds several concatenated MessagePack objects'],
  };
}

// ---------- encoder ----------

function push(out, bytes) {
  for (const x of bytes) out.push(x);
}

function encodeUint(out, v) {
  if (v < 128n) return out.push(Number(v));
  if (v < 0x100n) return out.push(0xcc, Number(v));
  if (v < 0x10000n) return out.push(0xcd, Number(v >> 8n), Number(v & 255n));
  if (v < 0x100000000n) {
    out.push(0xce);
    for (let s = 24n; s >= 0n; s -= 8n) out.push(Number((v >> s) & 255n));
    return undefined;
  }
  out.push(0xcf);
  for (let s = 56n; s >= 0n; s -= 8n) out.push(Number((v >> s) & 255n));
  return undefined;
}

function encodeInt(out, v) {
  if (v >= 0n) return encodeUint(out, v);
  if (v >= -32n) return out.push(Number(BigInt.asUintN(8, v)));
  if (v >= -128n) return out.push(0xd0, Number(BigInt.asUintN(8, v)));
  const size = v >= -32768n ? 2 : v >= -2147483648n ? 4 : 8;
  const code = { 2: 0xd1, 4: 0xd2, 8: 0xd3 }[size];
  out.push(code);
  const u = BigInt.asUintN(size * 8, v);
  for (let s = BigInt(size * 8 - 8); s >= 0n; s -= 8n) out.push(Number((u >> s) & 255n));
  return undefined;
}

function encodeBigInt(out, v) {
  if (v >= 0n && v < TWO64) return encodeUint(out, v);
  if (v < 0n && v >= -(1n << 63n)) return encodeInt(out, v);
  throw new Error('integer does not fit in 64 bits (MessagePack has no bignum)');
}

function encodeValue(out, v, depth) {
  if (depth > MAX_DEPTH) throw new Error('value nested too deeply');
  if (v === null || v === undefined) return out.push(0xc0);
  if (v === true) return out.push(0xc3);
  if (v === false) return out.push(0xc2);
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) <= Number(MAX_SAFE)) return encodeInt(out, BigInt(v));
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, v);
    return out.push(0xcb, ...new Uint8Array(dv.buffer));
  }
  if (typeof v === 'bigint') return encodeBigInt(out, v);
  if (typeof v === 'string') {
    const bytes = utf8Encode(v);
    const n = bytes.length;
    if (n < 32) out.push(0xa0 | n);
    else if (n < 0x100) out.push(0xd9, n);
    else if (n < 0x10000) out.push(0xda, n >> 8, n & 255);
    else {
      out.push(0xdb);
      for (let s = 24; s >= 0; s -= 8) out.push((n >>> s) & 255);
    }
    return push(out, bytes);
  }
  if (v instanceof Uint8Array) {
    encodeLen(out, v.length, [0xc4, 0xc5, 0xc6]);
    return push(out, v);
  }
  if (Array.isArray(v)) {
    const n = v.length;
    if (n < 16) out.push(0x90 | n);
    else if (n < 0x10000) out.push(0xdc, n >> 8, n & 255);
    else {
      out.push(0xdd);
      for (let s = 24; s >= 0; s -= 8) out.push((n >>> s) & 255);
    }
    for (const item of v) encodeValue(out, item, depth + 1);
    return undefined;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && typeof v.$hex === 'string') {
      const bytes = parseHex(v.$hex);
      encodeLen(out, bytes.length, [0xc4, 0xc5, 0xc6]);
      return push(out, bytes);
    }
    if (keys.length === 1 && typeof v.$int === 'string') return encodeBigInt(out, BigInt(v.$int));
    if (keys.length === 1 && typeof v.$float === 'string') return encodeValue(out, Number(v.$float), depth + 1);
    if (keys.length === 2 && typeof v.$ext === 'number' && typeof v.$hex === 'string') {
      const data = parseHex(v.$hex);
      if (v.$ext < -128 || v.$ext > 127) throw new Error('ext type must be -128..127');
      const fixed = { 1: 0xd4, 2: 0xd5, 4: 0xd6, 8: 0xd7, 16: 0xd8 }[data.length];
      if (fixed !== undefined) out.push(fixed);
      else encodeLen(out, data.length, [0xc7, 0xc8, 0xc9]);
      out.push(v.$ext & 0xff);
      return push(out, data);
    }
    if (keys.some((k) => k.startsWith('$') && (k === '$tag' || k === '$simple'))) {
      throw new Error('MessagePack has no tags or simple values; remove $tag/$simple');
    }
    const n = keys.length;
    if (n < 16) out.push(0x80 | n);
    else if (n < 0x10000) out.push(0xde, n >> 8, n & 255);
    else {
      out.push(0xdf);
      for (let s = 24; s >= 0; s -= 8) out.push((n >>> s) & 255);
    }
    for (const k of keys) {
      encodeValue(out, k, depth + 1);
      encodeValue(out, v[k], depth + 1);
    }
    return undefined;
  }
  throw new TypeError(`cannot encode ${typeof v} as MessagePack`);
}

function encodeLen(out, n, [c8, c16, c32]) {
  if (n < 256) out.push(c8, n);
  else if (n < 0x10000) out.push(c16, n >> 8, n & 255);
  else {
    out.push(c32);
    for (let s = 24; s >= 0; s -= 8) out.push((n >>> s) & 255);
  }
}

/**
 * Encode a JSON-like value as MessagePack. Wrappers: {"$hex":"0102"} bin,
 * {"$ext":t,"$hex":"..."} ext, {"$int":"..."} 64-bit integer, {"$float":"NaN"} float.
 */
export function encodeMsgpack(value) {
  const out = [];
  encodeValue(out, value, 0);
  return Uint8Array.from(out);
}
