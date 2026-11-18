/**
 * Custom CRC models: parse RevEng-style strings, validate field input, check or append CRCs on frames,
 * and generate reference C / Python / JavaScript code for a model. Pure functions, no I/O.
 */
import { crcOf, hexOf } from './engine.js';

/** Parse one number token: 0x-prefixed hex or plain decimal. */
function parseNum(token) {
  const t = String(token).trim();
  if (/^0x[0-9a-f]+$/i.test(t)) return BigInt(t);
  if (/^[0-9]+$/.test(t)) return BigInt(t);
  throw new Error(`Bad number: ${token}`);
}

function parseBool(v) {
  const t = String(v).trim().toLowerCase();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  throw new Error(`Bad boolean: ${v}`);
}

/**
 * Validate and normalise a model. Throws on problems.
 * Numbers may be BigInt, "0x..." hex or decimal strings. Missing init/xorout default to 0.
 * @returns {{width:number, poly:bigint, init:bigint, refin:boolean, refout:boolean, xorout:bigint}}
 */
export function normalizeModel(f) {
  const width = Number(f.width);
  if (!Number.isInteger(width) || width < 1 || width > 64) throw new Error('Width must be an integer from 1 to 64.');
  const mask = (1n << BigInt(width)) - 1n;
  const get = (v, d) => {
    if (v === undefined || v === null || String(v).trim() === '') return d;
    return typeof v === 'bigint' ? v : parseNum(v);
  };
  const poly = get(f.poly, undefined);
  if (poly === undefined) throw new Error('Polynomial is required.');
  const init = get(f.init, 0n);
  const xorout = get(f.xorout, 0n);
  for (const [n, v] of [['poly', poly], ['init', init], ['xorout', xorout]]) {
    if (v > mask) throw new Error(`${n} does not fit in ${width} bits.`);
  }
  if (poly === 0n) throw new Error('Polynomial must not be zero.');
  return { width, poly, init, refin: !!f.refin, refout: !!f.refout, xorout };
}

/**
 * Parse a RevEng-style line such as
 * `width=16 poly=0x1021 init=0xffff refin=false refout=false xorout=0x0000 check=0x29b1 name="CRC-16/IBM-3740"`.
 * Unknown keys (check, residue, name) are ignored. Missing init/xorout default to 0, refin/refout to false.
 */
export function parseRevengModel(text) {
  const fields = {};
  const re = /([a-z]+)\s*=\s*("[^"]*"|\S+)/gi;
  let m;
  while ((m = re.exec(String(text ?? '')))) fields[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, '');
  if (fields.width === undefined) throw new Error('Missing width=...');
  if (fields.poly === undefined) throw new Error('Missing poly=...');
  return normalizeModel({
    width: fields.width,
    poly: fields.poly,
    init: fields.init,
    xorout: fields.xorout,
    refin: fields.refin === undefined ? false : parseBool(fields.refin),
    refout: fields.refout === undefined ? false : parseBool(fields.refout),
  });
}

/** Byte length of a stored checksum for a model. */
export function checksumByteLength(model) {
  return Math.ceil(model.width / 8);
}

/** Split a CRC value into bytes (big- or little-endian). */
export function crcToBytes(value, model, order = 'be') {
  const n = checksumByteLength(model);
  const out = new Uint8Array(n);
  const v = BigInt(value);
  for (let i = 0; i < n; i++) {
    const byte = Number((v >> BigInt(8 * i)) & 0xffn);
    out[order === 'be' ? n - 1 - i : i] = byte;
  }
  return out;
}

function bytesToBig(bytes, order) {
  let v = 0n;
  const list = order === 'be' ? Array.from(bytes) : Array.from(bytes).reverse();
  for (const b of list) v = (v << 8n) | BigInt(b);
  return v;
}

const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');

/**
 * Check frames (checksum at the tail) against a model.
 * @param {object} model normalised model
 * @param {Uint8Array[]} frames
 * @returns {Array<{index:number, ok:boolean, stored:string, computed:string, error?:string}>}
 */
export function verifyFrames(model, frames, order = 'be') {
  const n = checksumByteLength(model);
  return frames.map((frame, index) => {
    if (frame.length < n) {
      return { index, ok: false, stored: '', computed: '', error: `Frame shorter than the ${n}-byte checksum.` };
    }
    const payload = frame.subarray(0, frame.length - n);
    const stored = bytesToBig(frame.subarray(frame.length - n), order);
    const computed = crcOf(payload, model);
    return {
      index,
      ok: stored === computed,
      stored: `0x${hexOf(stored, model.width)}`,
      computed: `0x${hexOf(computed, model.width)}`,
    };
  });
}

/** Append the CRC to each payload. Returns [{crc, frame}] with hex strings. */
export function appendCrc(model, payloads, order = 'be') {
  return payloads.map((payload) => {
    const crc = crcOf(payload, model);
    const tail = crcToBytes(crc, model, order);
    const frame = new Uint8Array(payload.length + tail.length);
    frame.set(payload, 0);
    frame.set(tail, payload.length);
    return { crc: `0x${hexOf(crc, model.width)}`, frame: toHex(frame) };
  });
}

/** Parse several hex lines into byte arrays (blank lines skipped). Throws with the line number on bad input. */
export function parseHexLines(text) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    const clean = line.replace(/0x/gi, '').replace(/[\s,:;-]/g, '');
    if (!clean) return;
    if (!/^[0-9a-f]+$/i.test(clean)) throw new Error(`Line ${i + 1}: not hex.`);
    if (clean.length % 2) throw new Error(`Line ${i + 1}: odd number of hex digits.`);
    out.push(Uint8Array.from(clean.match(/../g), (h) => parseInt(h, 16)));
  });
  return out;
}

function cType(width) {
  if (width <= 8) return 'uint8_t';
  if (width <= 16) return 'uint16_t';
  if (width <= 32) return 'uint32_t';
  return 'uint64_t';
}

/**
 * Reference implementation of a model in C, Python or JavaScript. Bit-at-a-time, so it is slow but
 * short and easy to check against the Rocksoft definition. Not a table-driven or optimised version.
 * @param {object} model
 * @param {'c'|'python'|'js'} lang
 */
export function generateCode(model, lang = 'c') {
  const m = normalizeModel(model);
  const w = m.width;
  const hex = (v) => `0x${hexOf(v, w)}`;
  const name = `crc${w}`;
  if (lang === 'python') {
    return `def reflect(x, n):
    r = 0
    for _ in range(n):
        r = (r << 1) | (x & 1)
        x >>= 1
    return r


def ${name}(data: bytes) -> int:
    width, poly, init, xorout = ${w}, ${hex(m.poly)}, ${hex(m.init)}, ${hex(m.xorout)}
    mask = (1 << width) - 1
    crc = init
    for byte in data:
        ${m.refin ? 'byte = reflect(byte, 8)' : 'pass  # refin=false'}
        for k in range(7, -1, -1):
            fb = ((crc >> (width - 1)) & 1) ^ ((byte >> k) & 1)
            crc = (crc << 1) & mask
            if fb:
                crc ^= poly
    ${m.refout ? 'crc = reflect(crc, width)' : 'pass  # refout=false'}
    return (crc ^ xorout) & mask
`;
  }
  if (lang === 'js') {
    return `function reflect(x, n) {
  let r = 0n;
  for (let i = 0; i < n; i++) { r = (r << 1n) | (x & 1n); x >>= 1n; }
  return r;
}

function ${name}(data) {
  const width = ${w}n, poly = ${hex(m.poly)}n, init = ${hex(m.init)}n, xorout = ${hex(m.xorout)}n;
  const mask = (1n << width) - 1n;
  let crc = init;
  for (const b of data) {
    const byte = ${m.refin ? 'Number(reflect(BigInt(b), 8))' : 'b'};
    for (let k = 7; k >= 0; k--) {
      const fb = ((crc >> (width - 1n)) & 1n) ^ BigInt((byte >> k) & 1);
      crc = (crc << 1n) & mask;
      if (fb) crc ^= poly;
    }
  }
  ${m.refout ? 'crc = reflect(crc, width);' : '// refout=false'}
  return (crc ^ xorout) & mask;
}
`;
  }
  if (lang !== 'c') throw new Error(`Unknown language: ${lang}`);
  const T = cType(w);
  const suffix = w > 32 ? 'ULL' : 'u';
  const lit = (v) => `${hex(v)}${suffix}`;
  const maskLit = lit((1n << BigInt(w)) - 1n);
  return `#include <stdint.h>
#include <stddef.h>

static ${T} reflect(${T} x, int n) {
    ${T} r = 0;
    for (int i = 0; i < n; i++) { r = (${T})((r << 1) | (x & 1)); x >>= 1; }
    return r;
}

${T} ${name}(const uint8_t *data, size_t len) {
    const ${T} poly = ${lit(m.poly)}, xorout = ${lit(m.xorout)}, mask = ${maskLit};
    ${T} crc = ${lit(m.init)};
    for (size_t i = 0; i < len; i++) {
        uint8_t byte = ${m.refin ? '(uint8_t)reflect(data[i], 8)' : 'data[i]'};
        for (int k = 7; k >= 0; k--) {
            int fb = (int)((crc >> ${w - 1}) & 1) ^ ((byte >> k) & 1);
            crc = (${T})((crc << 1) & mask);
            if (fb) crc ^= poly;
        }
    }
    ${m.refout ? `crc = reflect(crc, ${w});` : '/* refout=false */'}
    return (${T})((crc ^ xorout) & mask);
}
`;
}
