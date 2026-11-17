/**
 * Minimal protobuf (proto3 subset) wire-format codec. No dependencies.
 *
 * Messages are described by schemas built with defineMessage() (see ./schema.js).
 * Supported scalar types: uint32 uint64 int32 int64 sint32 sint64 bool enum fixed32
 * sfixed32 fixed64 float double string bytes, plus nested messages. Repeated fields
 * (`rep: true`) are read packed or unpacked and written unpacked.
 *
 * Decoding is lenient in the way protobuf is meant to be: fields the schema does not
 * know are kept in `_unknown` ({ no, wire, value }) instead of being dropped, so a
 * newer firmware message still decodes. Groups (wire types 3/4) are rejected.
 *
 * 64-bit integers: varints are decoded through BigInt and returned as Number, which is
 * exact up to 2^53. Fields that need the full 64 bits should use the `fixed64` type
 * (returned as BigInt).
 */

export class ProtoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProtoError';
  }
}

export const WIRE_VARINT = 0;
export const WIRE_I64 = 1;
export const WIRE_LEN = 2;
export const WIRE_I32 = 5;

const WIRE_FOR_TYPE = {
  uint32: WIRE_VARINT, uint64: WIRE_VARINT, int32: WIRE_VARINT, int64: WIRE_VARINT,
  sint32: WIRE_VARINT, sint64: WIRE_VARINT, bool: WIRE_VARINT, enum: WIRE_VARINT,
  fixed32: WIRE_I32, sfixed32: WIRE_I32, float: WIRE_I32,
  fixed64: WIRE_I64, double: WIRE_I64,
  string: WIRE_LEN, bytes: WIRE_LEN, message: WIRE_LEN,
};

const PACKABLE = new Set(Object.keys(WIRE_FOR_TYPE).filter((t) => t !== 'string' && t !== 'bytes' && t !== 'message'));

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

/**
 * Build a message schema. Each field spec is [fieldNumber, name, type, options?] where
 * options may carry { rep: true } for repeated fields or { msg: Schema } for nested messages.
 */
export function defineMessage(name, specs) {
  const fields = specs.map(([no, fieldName, type, opts = {}]) => {
    if (!(type in WIRE_FOR_TYPE)) throw new Error(`Unknown protobuf type "${type}" for ${name}.${fieldName}`);
    if (type === 'message' && !opts.msg) throw new Error(`Missing msg schema for ${name}.${fieldName}`);
    return { no, name: fieldName, type, rep: !!opts.rep, msg: opts.msg || null };
  });
  fields.sort((a, b) => a.no - b.no);
  const byNo = new Map(fields.map((f) => [f.no, f]));
  return Object.freeze({ name, fields, byNo });
}

/** Scalar field spec helpers used by the schema module. */
export const f = (no, name, type, opts) => [no, name, type, opts];

// ---------------------------------------------------------------------------
// Low-level reader / writer
// ---------------------------------------------------------------------------

class Reader {
  constructor(bytes) {
    this.buf = bytes;
    this.pos = 0;
  }

  get eof() {
    return this.pos >= this.buf.length;
  }

  byte() {
    if (this.pos >= this.buf.length) throw new ProtoError('Truncated message');
    return this.buf[this.pos++];
  }

  varintBig() {
    let result = 0n;
    let shift = 0n;
    for (;;) {
      const b = this.byte();
      result |= BigInt(b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7n;
      if (shift >= 70n) throw new ProtoError('Varint longer than 10 bytes');
    }
    return result;
  }

  varint() {
    return Number(BigInt.asUintN(64, this.varintBig()));
  }

  take(n) {
    if (n < 0 || this.pos + n > this.buf.length) throw new ProtoError('Length runs past end of message');
    const out = this.buf.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  fixed32() {
    const b = this.take(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }

  fixed64() {
    const lo = BigInt(this.fixed32());
    const hi = BigInt(this.fixed32());
    return (hi << 32n) | lo;
  }
}

class Writer {
  constructor() {
    this.parts = [];
  }

  push(bytes) {
    this.parts.push(bytes);
  }

  varint(value) {
    let v = BigInt.asUintN(64, typeof value === 'bigint' ? value : BigInt(Math.trunc(value)));
    const out = [];
    do {
      let b = Number(v & 0x7fn);
      v >>= 7n;
      if (v !== 0n) b |= 0x80;
      out.push(b);
    } while (v !== 0n);
    this.parts.push(Uint8Array.from(out));
  }

  tag(no, wire) {
    this.varint((BigInt(no) << 3n) | BigInt(wire));
  }

  dv(size, fn) {
    const buf = new Uint8Array(size);
    fn(new DataView(buf.buffer));
    this.parts.push(buf);
  }

  finish() {
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of this.parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Scalar conversions
// ---------------------------------------------------------------------------

function zigzagEncode(n) {
  const b = BigInt(Math.trunc(Number(n)));
  return b >= 0n ? b * 2n : -b * 2n - 1n;
}

function zigzagDecode(big) {
  return Number((big >> 1n) ^ -(big & 1n));
}

function readScalar(r, type, wire) {
  switch (type) {
    case 'uint32': return Number(BigInt.asUintN(32, r.varintBig()));
    case 'uint64': return Number(BigInt.asUintN(64, r.varintBig()));
    case 'int32': case 'enum': return Number(BigInt.asIntN(32, r.varintBig()));
    case 'int64': return Number(BigInt.asIntN(64, r.varintBig()));
    case 'sint32': case 'sint64': return zigzagDecode(r.varintBig());
    case 'bool': return r.varintBig() !== 0n;
    case 'fixed32': return r.fixed32();
    case 'sfixed32': return r.fixed32() | 0;
    case 'float': {
      const b = r.take(4);
      return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
    }
    case 'fixed64': return r.fixed64();
    case 'double': {
      const b = r.take(8);
      return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true);
    }
    default:
      throw new ProtoError(`readScalar: unsupported type ${type} (wire ${wire})`);
  }
}

function writeScalar(w, type, v) {
  switch (type) {
    case 'uint32': case 'uint64': case 'int32': case 'int64': case 'enum':
      w.varint(typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v))));
      return;
    case 'bool':
      w.varint(v ? 1n : 0n);
      return;
    case 'sint32': case 'sint64':
      w.varint(zigzagEncode(v));
      return;
    case 'fixed32':
      w.dv(4, (dv) => dv.setUint32(0, Number(v) >>> 0, true));
      return;
    case 'sfixed32':
      w.dv(4, (dv) => dv.setInt32(0, Number(v) | 0, true));
      return;
    case 'float':
      w.dv(4, (dv) => dv.setFloat32(0, Number(v), true));
      return;
    case 'fixed64':
      w.dv(8, (dv) => dv.setBigUint64(0, BigInt.asUintN(64, BigInt(v)), true));
      return;
    case 'double':
      w.dv(8, (dv) => dv.setFloat64(0, Number(v), true));
      return;
    default:
      throw new ProtoError(`writeScalar: unsupported type ${type}`);
  }
}

// ---------------------------------------------------------------------------
// Message encode / decode
// ---------------------------------------------------------------------------

/** Encode a plain object using `schema`. Fields whose value is undefined/null are skipped. */
export function encodeMessage(schema, obj = {}) {
  const w = new Writer();
  writeFields(w, schema, obj);
  return w.finish();
}

function writeFields(w, schema, obj) {
  for (const spec of schema.fields) {
    const v = obj[spec.name];
    if (v === undefined || v === null) continue;
    const items = spec.rep ? v : [v];
    for (const item of items) writeField(w, spec, item);
  }
}

function writeField(w, spec, v) {
  const wire = WIRE_FOR_TYPE[spec.type];
  if (spec.type === 'message') {
    const inner = encodeMessage(spec.msg, v);
    w.tag(spec.no, WIRE_LEN);
    w.varint(inner.length);
    w.push(inner);
    return;
  }
  if (spec.type === 'string' || spec.type === 'bytes') {
    const bytes = spec.type === 'string' ? textEncoder.encode(String(v)) : Uint8Array.from(v);
    w.tag(spec.no, WIRE_LEN);
    w.varint(bytes.length);
    w.push(bytes);
    return;
  }
  w.tag(spec.no, wire);
  writeScalar(w, spec.type, v);
}

/** Decode bytes into a plain object using `schema`. Unknown fields go to `_unknown`. */
export function decodeMessage(schema, bytes) {
  const r = new Reader(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  const out = {};
  while (!r.eof) {
    const key = r.varint();
    const no = Math.floor(key / 8);
    const wire = key % 8;
    if (no === 0) throw new ProtoError('Field number 0 is invalid');
    const spec = schema.byNo.get(no);
    // A repeated numeric field may arrive packed (length-delimited) even though the
    // schema describes its elements' natural wire type.
    const packed = !!spec && spec.rep && wire === WIRE_LEN && PACKABLE.has(spec.type);
    if (!spec || (WIRE_FOR_TYPE[spec.type] !== wire && !packed)) {
      (out._unknown ||= []).push({ no, wire, value: skipValue(r, wire) });
      continue;
    }
    if (wire === WIRE_LEN) {
      const body = r.take(r.varint());
      if (spec.type === 'message') pushValue(out, spec, decodeMessage(spec.msg, body));
      else if (spec.type === 'string') pushValue(out, spec, textDecoder.decode(body));
      else if (spec.type === 'bytes') pushValue(out, spec, body);
      else {
        const inner = new Reader(body);
        while (!inner.eof) pushValue(out, spec, readScalar(inner, spec.type, wire));
      }
      continue;
    }
    pushValue(out, spec, readScalar(r, spec.type, wire));
  }
  return out;
}

function pushValue(out, spec, value) {
  if (spec.rep) (out[spec.name] ||= []).push(value);
  else out[spec.name] = value;
}

function skipValue(r, wire) {
  switch (wire) {
    case WIRE_VARINT: return r.varint();
    case WIRE_I64: return r.fixed64();
    case WIRE_I32: return r.fixed32();
    case WIRE_LEN: return r.take(r.varint());
    default: throw new ProtoError(`Unsupported wire type ${wire} (groups are not supported)`);
  }
}

/**
 * JSON-safe copy of a decoded message: bytes become lowercase hex strings, BigInts become
 * decimal strings. Keys whose names look like secrets are replaced by '[redacted]'.
 */
const SECRET_KEY = /psk|password|private_key|secret/i;
export function toJsonSafe(value, redact = true) {
  if (value instanceof Uint8Array) {
    return Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map((v) => toJsonSafe(v, redact));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redact && SECRET_KEY.test(k) && v !== undefined ? '[redacted]' : toJsonSafe(v, redact);
    }
    return out;
  }
  return value;
}
