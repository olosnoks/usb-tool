/**
 * CBOR (RFC 8949) decoder with byte offsets, diagnostic notation (section 8) and an encoder
 * for JSON-like values.
 *
 * Decoded JS values use: BigInt for integers outside the safe range, Uint8Array for byte
 * strings, {__simple: n} for simple values, and {$tag, $value} for tags that are not
 * folded into a native value (tag 2/3 bignums become BigInt). Node.value is the
 * diagnostic text of the item.
 */
import {
  DecodeError, toHex, utf8Strict, utf8Encode, formatFloat, halfToNumber, makeNode,
  shiftOffsets, MAX_SAFE, normInt, readBigUint, parseHex,
} from './bytes.js';

const MAX_DEPTH = 256;
const TWO64 = 1n << 64n;

function ensure(ctx, n, at) {
  if (ctx.pos + n > ctx.end) throw new DecodeError(`truncated input: ${n} more byte(s) needed`, at);
}

function readHead(ctx) {
  const start = ctx.pos;
  ensure(ctx, 1, start);
  const ib = ctx.b[ctx.pos++];
  const major = ib >> 5;
  const info = ib & 31;
  if (info >= 28 && info <= 30) throw new DecodeError(`reserved additional information ${info}`, start);
  if (info === 31) return { major, info, arg: 0n, start, indefinite: true };
  let arg = BigInt(info);
  if (info >= 24) {
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : 8;
    ensure(ctx, n, start + 1);
    arg = readBigUint(ctx.b, ctx.pos, n);
    ctx.pos += n;
  }
  return { major, info, arg, start, indefinite: false };
}

function checkLen(ctx, arg, at) {
  if (arg > BigInt(ctx.end - ctx.pos)) throw new DecodeError('length exceeds remaining input', at);
  return Number(arg);
}

function countItem(ctx, at) {
  ctx.count++;
  if (ctx.count > ctx.maxItems) throw new DecodeError(`more than ${ctx.maxItems} items; input too large for the tree view`, at, true);
}

function atBreak(ctx) {
  if (ctx.pos >= ctx.end) throw new DecodeError('unterminated indefinite-length item', ctx.pos);
  return ctx.b[ctx.pos] === 0xff;
}

function quote(s) {
  return JSON.stringify(s);
}

function readString(ctx, h, major) {
  // definite or indefinite byte (major 2) / text (major 3) string
  const start = h.start;
  if (!h.indefinite) {
    const len = checkLen(ctx, h.arg, start);
    const data = ctx.b.subarray(ctx.pos, ctx.pos + len);
    ctx.pos += len;
    const value = major === 2 ? data : utf8Strict(data, start);
    const diag = major === 2 ? `h'${toHex(data)}'` : quote(value);
    return { value, diag, children: undefined, indefinite: false };
  }
  const chunks = [];
  const chunkNodes = [];
  while (!atBreak(ctx)) {
    const cs = ctx.pos;
    const ch = readHead(ctx);
    if (ch.major !== major || ch.indefinite) throw new DecodeError('invalid chunk in indefinite-length string', cs);
    const len = checkLen(ctx, ch.arg, cs);
    const data = ctx.b.subarray(ctx.pos, ctx.pos + len);
    ctx.pos += len;
    countItem(ctx, cs);
    chunks.push(data);
    const txt = major === 3 ? utf8Strict(data, cs) : null;
    chunkNodes.push(makeNode(cs, ctx.pos - cs, `chunk ${chunks.length - 1}`, major === 2 ? 'bytes' : 'text', major === 2 ? `h'${toHex(data)}'` : quote(txt)));
  }
  ctx.pos++; // break
  if (major === 2) {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const value = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) { value.set(c, o); o += c.length; }
    return { value, diag: `(_ ${chunkNodes.map((c) => c.value).join(', ')})`, children: chunkNodes, indefinite: true };
  }
  const text = chunks.map((c) => utf8Strict(c, start)).join('');
  return { value: text, diag: `(_ ${chunkNodes.map((c) => c.value).join(', ')})`, children: chunkNodes, indefinite: true };
}

/** Read one data item at ctx.pos. Breaks are not items and throw here. */
function readItem(ctx, depth) {
  if (depth > MAX_DEPTH) throw new DecodeError('nesting too deep', ctx.pos);
  const start = ctx.pos;
  countItem(ctx, start);
  const h = readHead(ctx);

  switch (h.major) {
    case 0: {
      if (h.indefinite) throw new DecodeError('indefinite length not allowed for integers', start);
      return finish(start, ctx, 'uint', h.arg.toString(), normInt(h.arg));
    }
    case 1: {
      if (h.indefinite) throw new DecodeError('indefinite length not allowed for integers', start);
      const v = -1n - h.arg;
      return finish(start, ctx, 'negint', v.toString(), normInt(v));
    }
    case 2:
    case 3: {
      const s = readString(ctx, h, h.major);
      const type = h.major === 2 ? 'bytes' : 'text';
      const node = finish(start, ctx, type, s.diag, s.value);
      if (s.children) node.children = s.children;
      return node;
    }
    case 4: {
      const items = [];
      const label = (i) => `[${i}]`;
      if (h.indefinite) {
        while (!atBreak(ctx)) items.push(readItem(ctx, depth + 1));
        ctx.pos++;
      } else {
        const n = checkLen(ctx, h.arg, start);
        for (let i = 0; i < n; i++) items.push(readItem(ctx, depth + 1));
      }
      items.forEach((it, i) => { it.label = label(i); });
      const diag = `${h.indefinite ? '[_ ' : '['}${items.map((i) => i.value).join(', ')}]`;
      const node = finish(start, ctx, 'array', diag, items.map((i) => i.js));
      node.children = items;
      return node;
    }
    case 5: {
      const pairs = [];
      const entry = () => {
        const k = readItem(ctx, depth + 1);
        const v = readItem(ctx, depth + 1);
        pairs.push({ k, v });
      };
      if (h.indefinite) {
        while (!atBreak(ctx)) entry();
        ctx.pos++;
      } else {
        const n = checkLen(ctx, h.arg, start);
        for (let i = 0; i < n; i++) entry();
      }
      const children = pairs.map((p, i) => {
        const pn = makeNode(p.k.offset, p.v.offset + p.v.length - p.k.offset, `pair ${i}`, 'pair', `${p.k.value}: ${p.v.value}`, [p.k, p.v]);
        return pn;
      });
      const diag = `${h.indefinite ? '{_ ' : '{'}${pairs.map((p) => `${p.k.value}: ${p.v.value}`).join(', ')}}`;
      const obj = {};
      for (const p of pairs) {
        const key = typeof p.k.js === 'string' ? p.k.js : p.k.value;
        obj[key] = p.v.js;
      }
      const node = finish(start, ctx, 'map', diag, obj);
      node.children = children;
      return node;
    }
    case 6: {
      if (h.indefinite) throw new DecodeError('indefinite length not allowed for tags', start);
      const tag = h.arg;
      const content = readItem(ctx, depth + 1);
      const tagNum = tag.toString();
      const diag = `${tagNum}(${content.value})`;
      let js;
      let type = 'tag';
      let note;
      if ((tag === 2n || tag === 3n)) {
        if (!(content.js instanceof Uint8Array)) throw new DecodeError('bignum tag must wrap a byte string', start);
        let v = 0n;
        for (const byte of content.js) v = (v << 8n) | BigInt(byte);
        js = tag === 2n ? v : -1n - v;
        type = 'bignum';
        note = `= ${js}`;
      } else if (tag === 0n) {
        if (typeof content.js !== 'string') throw new DecodeError('datetime tag 0 must wrap a text string', start);
        js = { $tag: 0, $value: content.js };
        type = 'datetime';
      } else if (tag === 1n) {
        const num = content.js;
        if (typeof num !== 'number' && typeof num !== 'bigint') throw new DecodeError('epoch tag 1 must wrap a number', start);
        const secs = Number(num);
        if (Number.isFinite(secs) && Math.abs(secs * 1000) < 8.64e15) note = `= ${new Date(secs * 1000).toISOString()}`;
        js = { $tag: 1, $value: num };
        type = 'epoch';
      } else if (tag === 24n && content.js instanceof Uint8Array && !content.children) {
        js = { $tag: 24, $value: { $hex: toHex(content.js) } };
        type = 'embedded';
        const dataStart = content.offset + (content.length - content.js.length);
        try {
          const inner = decodeCbor(content.js, { maxItems: ctx.maxItems });
          const rootNode = shiftOffsets(inner.root, dataStart);
          const node = finish(start, ctx, type, diag, js);
          node.note = 'embedded CBOR (tag 24)';
          node.children = [rootNode];
          return node;
        } catch (e) {
          if (e instanceof DecodeError && e.fatal) throw e;
          const node = finish(start, ctx, type, diag, js);
          node.error = `embedded item is not valid CBOR: ${e.message}`;
          node.children = [content];
          return node;
        }
      } else if (tag === 55799n) {
        js = { $tag: 55799, $value: content.js };
        note = 'self-described CBOR';
      } else {
        js = { $tag: Number(tag) <= Number.MAX_SAFE_INTEGER ? Number(tag) : tagNum, $value: content.js };
      }
      const node = finish(start, ctx, type, diag, js);
      node.label = `tag ${tagNum}`;
      if (note) node.note = note;
      node.children = [content];
      return node;
    }
    case 7: {
      if (h.indefinite) throw new DecodeError('unexpected break code', start);
      const info = h.info;
      if (info === 20) return finish(start, ctx, 'bool', 'false', false);
      if (info === 21) return finish(start, ctx, 'bool', 'true', true);
      if (info === 22) return finish(start, ctx, 'null', 'null', null);
      if (info === 23) return finish(start, ctx, 'undefined', 'undefined', undefined);
      if (info === 25) {
        const v = halfToNumber(Number(h.arg));
        return finish(start, ctx, 'float', formatFloat(v), v);
      }
      if (info === 26 || info === 27) {
        const dv = new DataView(new ArrayBuffer(8));
        let v;
        if (info === 26) { dv.setUint32(0, Number(h.arg)); v = dv.getFloat32(0); }
        else { dv.setBigUint64(0, h.arg); v = dv.getFloat64(0); }
        return finish(start, ctx, 'float', formatFloat(v), v);
      }
      let n;
      if (info === 24) {
        n = Number(h.arg);
        if (n < 32) throw new DecodeError(`simple value ${n} must not use the 1-byte form`, start);
      } else {
        n = info;
      }
      return finish(start, ctx, 'simple', `simple(${n})`, { __simple: n });
    }
    default:
      throw new DecodeError('unknown major type', start);
  }
}

function finish(start, ctx, type, diag, js) {
  const node = makeNode(start, ctx.pos - start, '', type, diag);
  node.js = js;
  return node;
}

/**
 * Decode one or more concatenated CBOR data items.
 * @returns {{format:'cbor', root, value, diag, warnings}}
 */
export function decodeCbor(bytes, { maxItems = 200000 } = {}) {
  const ctx = { b: bytes, pos: 0, end: bytes.length, count: 0, maxItems };
  const items = [];
  while (ctx.pos < ctx.end) items.push(readItem(ctx, 0));
  if (items.length === 0) throw new DecodeError('empty input', 0);
  const single = items.length === 1;
  const root = single
    ? items[0]
    : makeNode(0, bytes.length, 'sequence', 'sequence', `${items.length} top-level items`, items);
  if (single) root.label = 'root';
  return {
    format: 'cbor',
    root,
    value: single ? items[0].js : items.map((i) => i.js),
    diag: items.map((i) => i.value).join('\n'),
    warnings: single ? [] : ['input holds a CBOR sequence of several items'],
  };
}

// ---------- encoder ----------

function head(out, major, arg) {
  const a = BigInt(arg);
  const m = major << 5;
  if (a < 24n) out.push(m | Number(a));
  else if (a < 0x100n) out.push(m | 24, Number(a));
  else if (a < 0x10000n) out.push(m | 25, Number((a >> 8n) & 255n), Number(a & 255n));
  else if (a < 0x100000000n) {
    out.push(m | 26);
    for (let s = 24n; s >= 0n; s -= 8n) out.push(Number((a >> s) & 255n));
  } else {
    out.push(m | 27);
    for (let s = 56n; s >= 0n; s -= 8n) out.push(Number((a >> s) & 255n));
  }
}

/** Smallest exact binary16 encoding of x, or null. */
export function toHalfBits(x) {
  if (x === 0) return Object.is(x, -0) ? 0x8000 : 0;
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 0x7e00 : x > 0 ? 0x7c00 : 0xfc00;
  const s = x < 0 ? 0x8000 : 0;
  const a = Math.abs(x);
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e--;
  let bits;
  if (e < -14) {
    const m = a * 2 ** 24;
    if (!Number.isInteger(m) || m > 1023) return null;
    bits = s | m;
  } else if (e > 15) {
    return null;
  } else {
    const m = (a / 2 ** e - 1) * 1024;
    if (!Number.isInteger(m)) return null;
    bits = s | ((e + 15) << 10) | m;
  }
  return halfToNumber(bits) === x ? bits : null;
}

function encodeNumber(out, v) {
  if (Number.isNaN(v)) return out.push(0xf9, 0x7e, 0x00);
  if (!Number.isFinite(v)) return out.push(0xf9, v > 0 ? 0x7c : 0xfc, 0x00);
  if (Number.isInteger(v) && Math.abs(v) < 2 ** 64) return encodeBig(out, BigInt(v));
  const half = toHalfBits(v);
  if (half !== null) return out.push(0xf9, half >> 8, half & 255);
  if (Math.fround(v) === v) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setFloat32(0, v);
    return out.push(0xfa, ...new Uint8Array(dv.buffer));
  }
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, v);
  return out.push(0xfb, ...new Uint8Array(dv.buffer));
}

function encodeBig(out, v) {
  if (v >= 0n) {
    if (v < TWO64) return head(out, 0, v);
    return encodeBignum(out, 2, v);
  }
  const n = -1n - v;
  if (n < TWO64) return head(out, 1, n);
  return encodeBignum(out, 3, n);
}

function encodeBignum(out, tag, magnitude) {
  let hex = magnitude.toString(16);
  if (hex.length % 2) hex = `0${hex}`;
  head(out, 6, tag);
  const bytes = parseHex(hex);
  head(out, 2, bytes.length);
  for (const byte of bytes) out.push(byte);
}

function encodeValue(out, v, depth) {
  if (depth > MAX_DEPTH) throw new Error('value nested too deeply');
  if (v === null || v === undefined) return out.push(v === null ? 0xf6 : 0xf7);
  if (v === true) return out.push(0xf5);
  if (v === false) return out.push(0xf4);
  if (typeof v === 'number') return encodeNumber(out, v);
  if (typeof v === 'bigint') return encodeBig(out, v);
  if (typeof v === 'string') {
    const bytes = utf8Encode(v);
    head(out, 3, bytes.length);
    for (const byte of bytes) out.push(byte);
    return undefined;
  }
  if (v instanceof Uint8Array) {
    head(out, 2, v.length);
    for (const byte of v) out.push(byte);
    return undefined;
  }
  if (Array.isArray(v)) {
    head(out, 4, v.length);
    for (const item of v) encodeValue(out, item, depth + 1);
    return undefined;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1 && typeof v.$hex === 'string') {
      const bytes = parseHex(v.$hex);
      head(out, 2, bytes.length);
      for (const byte of bytes) out.push(byte);
      return undefined;
    }
    if (keys.length === 1 && typeof v.$int === 'string') return encodeBig(out, BigInt(v.$int));
    if (keys.length === 1 && typeof v.$float === 'string') return encodeValue(out, Number(v.$float), depth + 1);
    if (keys.length === 1 && typeof v.$simple === 'number') {
      const n = v.$simple;
      if (n < 0 || n > 255 || (n >= 24 && n < 32)) throw new Error(`invalid simple value ${n}`);
      if (n < 24) return out.push(0xe0 | n);
      return out.push(0xf8, n);
    }
    if (keys.length === 2 && typeof v.$tag === 'number' && '$value' in v) {
      head(out, 6, v.$tag);
      return encodeValue(out, v.$value, depth + 1);
    }
    head(out, 5, keys.length);
    for (const k of keys) {
      encodeValue(out, k, depth + 1);
      encodeValue(out, v[k], depth + 1);
    }
    return undefined;
  }
  throw new TypeError(`cannot encode ${typeof v} as CBOR`);
}

/**
 * Encode a JSON-like value as CBOR. Wrappers: {"$hex":"0102"} byte string,
 * {"$int":"123..."} big integer, {"$float":"NaN"|"Infinity"|"-Infinity"}, {"$simple":n},
 * {"$tag":n,"$value":x} tagged item.
 */
export function encodeCbor(value) {
  const out = [];
  encodeValue(out, value, 0);
  return Uint8Array.from(out);
}
