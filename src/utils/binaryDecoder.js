/**
 * Binary Payload Decoder: offline, schema-less decoding of serialized formats.
 *
 * Facade over src/utils/binaryDecoder/*: text unwrapping (hex / base64 / base64url / base32),
 * format auto-detection with heuristic confidence, decoding to an offset-annotated tree,
 * framing (COBS, COBS/R, SLIP, HDLC-style) and encoding JSON to CBOR / MessagePack.
 */
import { DecodeError, parseHex, parseBase64, parseBase32, toHex, toBase64, isPrintableText, jsonSafe, treeToJson, utf8Encode } from './binaryDecoder/bytes.js';
import { decodeProtobuf, protobufScore } from './binaryDecoder/protobuf.js';
import { decodeCbor, encodeCbor } from './binaryDecoder/cbor.js';
import { decodeMsgpack, encodeMsgpack } from './binaryDecoder/msgpack.js';
import { decodeBson, bsonScore } from './binaryDecoder/bson.js';

export { DecodeError, toHex, toBase64, parseHex, jsonSafe } from './binaryDecoder/bytes.js';
export { cobsEncode, cobsDecode, cobsrEncode, cobsrDecode, slipEncode, slipSplit, hdlcEncode, hdlcSplit, splitFrames, FRAMINGS } from './binaryDecoder/framing.js';

export const FORMAT_LABELS = {
  protobuf: 'Protobuf (raw, no schema)',
  cbor: 'CBOR (RFC 8949)',
  msgpack: 'MessagePack',
  bson: 'BSON',
};

export const TEXT_ENCODINGS = {
  auto: 'Auto',
  raw: 'Raw bytes / UTF-8 text',
  hex: 'Hex',
  base64: 'Base64',
  base64url: 'Base64url',
  base32: 'Base32',
};

const MIN_CONFIDENCE = 0.5;

/**
 * Candidate byte interpretations of a text input (hex, base64, base64url, base32).
 * Returns candidates sorted by confidence (0..1); the confidence is a heuristic.
 */
export function detectTextEncodings(text) {
  const s = String(text).trim();
  const compact = s.replace(/\s/g, '');
  const out = [];
  if (compact.length >= 2) {
    try {
      const bytes = parseHex(s);
      if (bytes.length) {
        const bare = /^[0-9a-fA-F]+$/.test(compact);
        out.push({ encoding: 'hex', confidence: bare ? 0.95 : 0.85, bytes });
      }
    } catch { /* not hex */ }
  }
  if (compact.length >= 4 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) {
    try {
      const bytes = parseBase64(compact);
      if (bytes.length) {
        // auto only trusts base64 that looks like base64 (+ / = - _ or digits mixed with letter case);
        // plain words such as "test" are ambiguous and stay as text unless the user forces base64
        const mixed = /[a-z]/.test(compact) && /[A-Z]/.test(compact) && /\d/.test(compact);
        const conf = /[+/=_-]/.test(compact) || mixed ? 0.7 : /\d/.test(compact) ? 0.55 : 0.3;
        out.push({ encoding: /[-_]/.test(compact) && !/[+/]/.test(compact) ? 'base64url' : 'base64', confidence: conf, bytes });
      }
    } catch { /* not base64 */ }
  }
  if (compact.length >= 8 && /^[A-Z2-7]+={0,6}$/.test(compact)) {
    try {
      const bytes = parseBase32(compact);
      if (bytes.length) out.push({ encoding: 'base32', confidence: 0.4, bytes });
    } catch { /* not base32 */ }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Turn user input into bytes.
 * @param {{text?: string, bytes?: Uint8Array, encoding?: string}} input
 *   text: pasted text; bytes: a file's contents. encoding: one of TEXT_ENCODINGS keys.
 * @returns {{bytes: Uint8Array, encoding: string, candidates: object[], note: string}}
 */
export function resolveInput({ text, bytes, encoding = 'auto' }) {
  let source = text;
  if (source === undefined && bytes) {
    const printable = bytes.length > 0 && Array.from(bytes).every((c) => (c >= 0x20 && c < 0x7f) || c === 0x0a || c === 0x0d || c === 0x09);
    if (!printable) {
      return { bytes, encoding: 'raw', candidates: [], note: 'file contents used as raw bytes' };
    }
    source = new TextDecoder().decode(bytes);
  }
  if (source === undefined) source = '';
  const candidates = detectTextEncodings(source).map(({ encoding: e, confidence }) => ({ encoding: e, confidence }));
  if (encoding !== 'auto' && encoding !== 'raw') {
    const cand = detectTextEncodings(source).find((c) => c.encoding === encoding) ||
      (() => {
        const compact = source.replace(/\s/g, '');
        if (encoding === 'hex') return { encoding, bytes: parseHex(source) };
        if (encoding === 'base64' || encoding === 'base64url') return { encoding, bytes: parseBase64(compact) };
        if (encoding === 'base32') return { encoding, bytes: parseBase32(compact) };
        return null;
      })();
    if (!cand) throw new Error(`input is not valid ${TEXT_ENCODINGS[encoding]}`);
    return { bytes: cand.bytes, encoding, candidates, note: `forced ${TEXT_ENCODINGS[encoding]}` };
  }
  if (encoding === 'raw') {
    return { bytes: utf8Encode(source), encoding: 'raw', candidates, note: 'raw UTF-8 text' };
  }
  const top = candidates[0];
  if (top && top.confidence >= MIN_CONFIDENCE) {
    const unwrapped = detectTextEncodings(source).find((c) => c.encoding === top.encoding);
    return { bytes: unwrapped.bytes, encoding: top.encoding, candidates, note: `auto: ${TEXT_ENCODINGS[top.encoding]} text unwrapped` };
  }
  return { bytes: utf8Encode(source), encoding: 'raw', candidates, note: 'auto: no base-N text detected, using UTF-8 text' };
}

function hasNode(node, pred) {
  if (pred(node)) return true;
  return !!node.children && node.children.some((c) => hasNode(c, pred));
}

/**
 * Heuristic detection of the serialization format of a byte buffer.
 * @returns {{format:string, confidence:number, reason:string}[]} sorted, best first
 */
export function detectFormats(bytes) {
  const out = [];
  if (!bytes || bytes.length === 0) return out;
  const add = (format, confidence, reason) => {
    if (confidence > 0) out.push({ format, confidence: Math.min(0.95, confidence), reason });
  };

  const pb = protobufScore(bytes);
  add('protobuf', pb, 'every field key has a valid field number and wire type');

  try {
    const r = decodeCbor(bytes);
    let c = 0.5;
    const single = r.warnings.length === 0;
    if (single) c += 0.1;
    if (hasNode(r.root, (n) => n.type === 'tag' || n.type === 'bignum' || n.type === 'datetime' || n.type === 'epoch' || n.type === 'embedded')) c += 0.15;
    if (hasNode(r.root, (n) => n.type === 'simple' || n.type === 'float')) c += 0.05;
    add('cbor', c, 'decodes completely as CBOR data items');
  } catch { /* not CBOR */ }

  try {
    const r = decodeMsgpack(bytes);
    let c = 0.5;
    if (r.warnings.length === 0) c += 0.1;
    if (hasNode(r.root, (n) => n.type === 'ext' || n.type === 'timestamp' || n.type === 'bin' || n.type === 'map')) c += 0.15;
    add('msgpack', c, 'decodes completely as MessagePack objects');
  } catch { /* not MessagePack */ }

  const bs = bsonScore(bytes);
  add('bson', bs, 'length prefix matches and the document parses as BSON');

  let list = out.sort((a, b) => b.confidence - a.confidence);
  if (bytes.length < 3) list = list.map((x) => ({ ...x, confidence: Math.min(x.confidence, 0.3) }));
  return list;
}

/**
 * Decode bytes with a given format.
 * @returns {{format:string, root:object, value:any, json:any, diag:string, warnings:string[]}}
 *   root is the offset-annotated tree; json is a JSON-safe export (protobuf: the tree).
 */
export function decodeAs(bytes, format, opts = {}) {
  let r;
  if (format === 'protobuf') r = decodeProtobuf(bytes, opts);
  else if (format === 'cbor') r = decodeCbor(bytes, opts);
  else if (format === 'msgpack') r = decodeMsgpack(bytes, opts);
  else if (format === 'bson') r = decodeBson(bytes, opts);
  else throw new Error(`unknown format "${format}"`);
  r.json = format === 'protobuf' ? treeToJson(r.root) : jsonSafe(r.value);
  return r;
}

/** Encode JSON text as CBOR or MessagePack. Returns bytes plus a decode check. */
export function encodeJson(jsonText, format) {
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`JSON is not valid: ${e.message}`);
  }
  const bytes = format === 'cbor' ? encodeCbor(value) : format === 'msgpack' ? encodeMsgpack(value) : null;
  if (!bytes) throw new Error(`no encoder for "${format}"`);
  const check = decodeAs(bytes, format);
  return { bytes, hex: toHex(bytes), base64: toBase64(bytes), diag: format === 'cbor' ? check.diag : '', roundTrip: check };
}
