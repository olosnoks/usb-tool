/**
 * BSON document decoder (MongoDB wire/storage format) with byte offsets.
 * Covers every element type in the BSON 1.1 spec, including the deprecated ones
 * (undefined, DBPointer, symbol, code with scope, old binary subtype 2).
 */
import { DecodeError, toHex, utf8Strict, makeNode, normInt, readBigUint } from './bytes.js';

const MAX_DEPTH = 100;

const TYPE_NAMES = {
  0x01: 'double', 0x02: 'string', 0x03: 'document', 0x04: 'array', 0x05: 'binary',
  0x06: 'undefined', 0x07: 'objectid', 0x08: 'bool', 0x09: 'datetime', 0x0a: 'null',
  0x0b: 'regex', 0x0c: 'dbpointer', 0x0d: 'js-code', 0x0e: 'symbol', 0x0f: 'code-scope',
  0x10: 'int32', 0x11: 'timestamp', 0x12: 'int64', 0x13: 'decimal128', 0xff: 'minkey', 0x7f: 'maxkey',
};

function ctxCount(ctx, at) {
  ctx.count++;
  if (ctx.count > ctx.maxItems) throw new DecodeError(`more than ${ctx.maxItems} elements; input too large for the tree view`, at, true);
}

function need(ctx, n, at) {
  if (ctx.pos + n > ctx.end) throw new DecodeError(`truncated: ${n} byte(s) needed`, at);
}

function i32(ctx, at) {
  need(ctx, 4, at);
  const dv = new DataView(ctx.b.buffer, ctx.b.byteOffset + ctx.pos, 4);
  ctx.pos += 4;
  return dv.getInt32(0, true);
}

function cstring(ctx, at) {
  const start = ctx.pos;
  let end = start;
  while (end < ctx.end && ctx.b[end] !== 0) end++;
  if (end >= ctx.end) throw new DecodeError('unterminated cstring', at);
  const s = utf8Strict(ctx.b.subarray(start, end), start);
  ctx.pos = end + 1;
  return s;
}

function bsonString(ctx, at) {
  const len = i32(ctx, at);
  if (len < 1 || ctx.pos + len > ctx.end) throw new DecodeError('invalid string length', at);
  const data = ctx.b.subarray(ctx.pos, ctx.pos + len - 1);
  if (ctx.b[ctx.pos + len - 1] !== 0) throw new DecodeError('string is not NUL-terminated', at);
  ctx.pos += len;
  return utf8Strict(data, at);
}

function bytesOf(ctx, n, at) {
  need(ctx, n, at);
  const d = ctx.b.subarray(ctx.pos, ctx.pos + n);
  ctx.pos += n;
  return d;
}

/** Read a document or array starting at ctx.pos. */
function readDocument(ctx, depth, asArray) {
  if (depth > MAX_DEPTH) throw new DecodeError('nesting too deep', ctx.pos);
  const start = ctx.pos;
  const total = i32(ctx, start);
  if (total < 5 || start + total > ctx.end) throw new DecodeError(`document length ${total} is invalid`, start);
  const docEnd = start + total;
  if (ctx.b[docEnd - 1] !== 0) throw new DecodeError('document is not terminated by 0x00', docEnd - 1);
  const elemEnd = docEnd - 1;
  const saveEnd = ctx.end;
  ctx.end = elemEnd;
  const children = [];
  const obj = asArray ? [] : {};
  while (ctx.pos < elemEnd) {
    const el = readElement(ctx, depth);
    children.push(el.node);
    if (asArray) obj.push(el.js);
    else obj[el.node.label] = el.js;
  }
  ctx.end = saveEnd;
  ctx.pos = docEnd;
  if (asArray) children.forEach((c, i) => { c.label = `[${i}]`; });
  const node = makeNode(start, total, '', asArray ? 'array' : 'document', `${asArray ? 'array' : 'document'} (${children.length} element${children.length === 1 ? '' : 's'})`, children);
  return { node, js: obj };
}

function readElement(ctx, depth) {
  const start = ctx.pos;
  ctxCount(ctx, start);
  need(ctx, 1, start);
  const t = ctx.b[ctx.pos++];
  const name = cstring(ctx, start);
  const label = name;
  const typeName = TYPE_NAMES[t];
  if (!typeName) throw new DecodeError(`unknown element type 0x${t.toString(16).padStart(2, '0')}`, start);

  const leaf = (type, value, js, extra = {}) => {
    const node = makeNode(start, ctx.pos - start, label, type, value);
    Object.assign(node, extra);
    return { node, js };
  };

  switch (t) {
    case 0x01: {
      need(ctx, 8, ctx.pos);
      const v = new DataView(ctx.b.buffer, ctx.b.byteOffset + ctx.pos, 8).getFloat64(0, true);
      ctx.pos += 8;
      return leaf('double', String(v), v);
    }
    case 0x02: {
      const s = bsonString(ctx, start);
      return leaf('string', JSON.stringify(s), s);
    }
    case 0x03:
    case 0x04: {
      const d = readDocument(ctx, depth + 1, t === 0x04);
      d.node.label = label;
      return { node: d.node, js: d.js };
    }
    case 0x05: {
      const len = i32(ctx, start);
      need(ctx, 1, ctx.pos);
      const subtype = ctx.b[ctx.pos++];
      let data;
      if (subtype === 0x02) {
        const inner = i32(ctx, start);
        if (inner !== len - 4) throw new DecodeError('old binary subtype length mismatch', start);
        data = bytesOf(ctx, inner, start);
      } else {
        if (len < 0) throw new DecodeError('negative binary length', start);
        data = bytesOf(ctx, len, start);
      }
      const hex = toHex(data);
      return leaf('binary', `binary subtype 0x${subtype.toString(16).padStart(2, '0')} h'${hex}'`, new Uint8Array(data), { note: subtype === 4 && data.length === 16 ? 'UUID' : undefined });
    }
    case 0x06:
      return leaf('undefined', 'undefined (deprecated)', undefined);
    case 0x07: {
      const d = bytesOf(ctx, 12, start);
      const hex = toHex(d);
      return leaf('objectid', `ObjectId("${hex}")`, hex);
    }
    case 0x08: {
      need(ctx, 1, ctx.pos);
      const b = ctx.b[ctx.pos++];
      if (b > 1) throw new DecodeError('boolean byte must be 0 or 1', ctx.pos - 1);
      return leaf('bool', b ? 'true' : 'false', b === 1);
    }
    case 0x09: {
      need(ctx, 8, ctx.pos);
      const ms = BigInt.asIntN(64, readBigUint(ctx.b, ctx.pos, 8));
      ctx.pos += 8;
      const n = Number(ms);
      const iso = Math.abs(n) <= 8.64e15 ? new Date(n).toISOString() : `${ms} ms`;
      return leaf('datetime', `ISODate("${iso}")`, iso);
    }
    case 0x0a:
      return leaf('null', 'null', null);
    case 0x0b: {
      const pattern = cstring(ctx, start);
      const options = cstring(ctx, start);
      return leaf('regex', `/${pattern}/${options}`, `/${pattern}/${options}`);
    }
    case 0x0c: {
      const s = bsonString(ctx, start);
      const id = toHex(bytesOf(ctx, 12, start));
      return leaf('dbpointer', `DBPointer("${s}", "${id}") (deprecated)`, { $dbPointer: s, id });
    }
    case 0x0d: {
      const s = bsonString(ctx, start);
      return leaf('js-code', JSON.stringify(s), s);
    }
    case 0x0e: {
      const s = bsonString(ctx, start);
      return leaf('symbol', `symbol ${JSON.stringify(s)} (deprecated)`, s);
    }
    case 0x0f: {
      const total = i32(ctx, start);
      if (total < 14 || start + total > ctx.end) throw new DecodeError('code-with-scope length is invalid', start);
      const code = bsonString(ctx, start);
      const scope = readDocument(ctx, depth + 1, false);
      if (ctx.pos !== start + total) throw new DecodeError('code-with-scope length mismatch', start);
      const node = makeNode(start, ctx.pos - start, label, 'code-scope', `code ${JSON.stringify(code)} with scope`, [scope.node]);
      return { node, js: { $code: code, scope: scope.js } };
    }
    case 0x10: {
      const v = i32(ctx, start);
      return leaf('int32', String(v), v);
    }
    case 0x11: {
      need(ctx, 8, ctx.pos);
      const u = readBigUint(ctx.b, ctx.pos, 8);
      ctx.pos += 8;
      const secs = u >> 32n;
      const inc = u & 0xffffffffn;
      return leaf('timestamp', `Timestamp(${secs}, ${inc})`, { $timestamp: { t: Number(secs), i: Number(inc) } });
    }
    case 0x12: {
      need(ctx, 8, ctx.pos);
      const v = BigInt.asIntN(64, readBigUint(ctx.b, ctx.pos, 8));
      ctx.pos += 8;
      return leaf('int64', v.toString(), normInt(v));
    }
    case 0x13: {
      const d = bytesOf(ctx, 16, start);
      return leaf('decimal128', `decimal128 h'${toHex(d)}'`, { $decimal: toHex(d) });
    }
    case 0xff:
      return leaf('minkey', 'MinKey', { $minKey: 1 });
    case 0x7f:
      return leaf('maxkey', 'MaxKey', { $maxKey: 1 });
    default:
      throw new DecodeError(`unsupported element type ${typeName}`, start);
  }
}

/** Decode a single BSON document occupying the whole input. */
export function decodeBson(bytes, { maxItems = 200000 } = {}) {
  const ctx = { b: bytes, pos: 0, end: bytes.length, count: 0, maxItems };
  const { node, js } = readDocument(ctx, 0, false);
  if (ctx.pos !== bytes.length) throw new DecodeError('trailing bytes after the BSON document', ctx.pos);
  node.label = 'root';
  return {
    format: 'bson',
    root: node,
    value: js,
    diag: '',
    warnings: [],
  };
}

/** Heuristic confidence that the bytes are one BSON document. */
export function bsonScore(bytes) {
  if (bytes.length < 5) return 0;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getInt32(0, true) !== bytes.length) return 0;
  try {
    decodeBson(bytes);
    return 0.9;
  } catch {
    return 0;
  }
}
