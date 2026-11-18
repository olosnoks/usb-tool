/**
 * Bits & Numbers converter: pure logic, no React, no hardware.
 *
 * Integer math is BigInt throughout so 64-bit values are exact. Widths are 8/16/32/64 bits
 * (two's complement). Floating point is implemented from the IEEE 754 bit layout for
 * half, bfloat16, single and double. Fixed-point is Qm.n with m integer bits (including the
 * sign bit for signed formats) and n fractional bits.
 */

export const WIDTHS = [8, 16, 32, 64];

/** 2^width as BigInt. */
export function modulus(width) {
  return 1n << BigInt(width);
}

/** Reduce any integer to its unsigned two's-complement pattern at `width` bits. */
export function toUnsigned(value, width) {
  const m = modulus(width);
  const v = BigInt(value);
  return ((v % m) + m) % m;
}

/** Interpret an integer's `width`-bit two's-complement pattern as signed. */
export function toSigned(value, width) {
  const u = toUnsigned(value, width);
  return u >= 1n << BigInt(width - 1) ? u - modulus(width) : u;
}

/** Number of bits needed to represent a non-negative integer (0 for 0). */
export function bitLength(value) {
  const v = BigInt(value);
  return v <= 0n ? 0 : v.toString(2).length;
}

/** Zero-padded uppercase hex of an unsigned value at `width` bits. */
export function hexOf(unsigned, width) {
  return '0x' + BigInt(unsigned).toString(16).toUpperCase().padStart(Math.ceil(width / 4), '0');
}

/**
 * Parse an integer literal: optional sign, then 0x (hex), 0b (binary), 0o (octal) or decimal.
 * Single underscores between digits are allowed (0xDEAD_BEEF, 1_000_000).
 * Result must fit the 64-bit range [-2^63, 2^64 - 1].
 */
export function parseNumber(input) {
  if (typeof input !== 'string') return { ok: false, error: 'Enter a number' };
  let s = input.trim();
  if (!s) return { ok: false, error: 'Empty input' };
  let negative = false;
  if (s[0] === '-' || s[0] === '+') {
    negative = s[0] === '-';
    s = s.slice(1).trim();
  }
  let base = 10;
  let digitsRe = /^[0-9]+(?:_[0-9]+)*$/;
  let baseName = 'decimal';
  const prefixed = /^0([xXbBoO])(.*)$/.exec(s);
  if (prefixed) {
    const k = prefixed[1].toLowerCase();
    base = k === 'x' ? 16 : k === 'b' ? 2 : 8;
    baseName = k === 'x' ? 'hex' : k === 'b' ? 'binary' : 'octal';
    s = prefixed[2];
    digitsRe = base === 16 ? /^[0-9a-fA-F]+(?:_[0-9a-fA-F]+)*$/ : base === 2 ? /^[01]+(?:_[01]+)*$/ : /^[0-7]+(?:_[0-7]+)*$/;
  }
  if (!digitsRe.test(s)) return { ok: false, error: `"${input.trim()}" is not a valid ${baseName} number` };
  const digits = s.replace(/_/g, '');
  const prefix = base === 16 ? '0x' : base === 2 ? '0b' : base === 8 ? '0o' : '';
  const magnitude = BigInt(prefix + digits);
  const value = negative ? -magnitude : magnitude;
  if (value > (1n << 64n) - 1n || value < -(1n << 63n)) {
    return { ok: false, error: 'Out of the 64-bit range (-2^63 .. 2^64-1)' };
  }
  return { ok: true, value, negative: value < 0n };
}

const hex2 = (b) => b.toString(16).toUpperCase().padStart(2, '0');

/**
 * Full number analysis at a chosen width.
 * Returns the unsigned/signed views, radix strings, byte-order views, ASCII view, bit counts
 * and the next power of two. `truncated` is true when the literal does not fit the width.
 */
export function analyzeNumber(input, width = 32) {
  if (!WIDTHS.includes(width)) return { ok: false, error: `Unsupported width ${width}` };
  const p = parseNumber(input);
  if (!p.ok) return p;
  const v = p.value;
  const u = toUnsigned(v, width);
  const bits = u.toString(2);
  const n = width / 8;

  const bytesBE = [];
  for (let i = n - 1; i >= 0; i--) bytesBE.push(Number((u >> BigInt(i * 8)) & 0xffn));
  const bytesLE = bytesBE.slice().reverse();
  // Byte-swapped value: the little-endian bytes read as a big-endian number.
  let swapped = 0n;
  for (const b of bytesLE) swapped = (swapped << 8n) | BigInt(b);

  const bl = u === 0n ? 0 : bits.length;
  const popcount = bits.split('').filter((c) => c === '1').length;
  const trailingZeros = u === 0n ? width : bits.length - 1 - bits.lastIndexOf('1');
  const nextPow2 = u <= 1n ? 1n : 1n << BigInt(bitLength(u - 1n));

  return {
    ok: true,
    value: v,
    width,
    negative: v < 0n,
    truncated: v < -(1n << BigInt(width - 1)) || v >= modulus(width),
    unsigned: u,
    signed: toSigned(v, width),
    hex: hexOf(u, width),
    dec: u.toString(),
    oct: '0o' + u.toString(8),
    bin: '0b' + bits.padStart(width, '0'),
    bytesBE,
    bytesLE,
    bytesText: bytesBE.map(hex2).join(' '),
    swapped,
    swappedHex: hexOf(swapped, width),
    ascii: bytesBE.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join(''),
    popcount,
    bitLength: bl,
    leadingZeros: width - bl,
    trailingZeros,
    nextPow2,
    nextPow2Fits: nextPow2 < modulus(width),
    widths: WIDTHS.map((w) => {
      const uw = toUnsigned(v, w);
      return { width: w, unsigned: uw, signed: toSigned(v, w), hex: hexOf(uw, w) };
    }),
  };
}

/** Flip one bit of a `width`-bit value. Returns the new unsigned pattern. */
export function toggleBit(value, index, width) {
  if (!Number.isInteger(index) || index < 0 || index >= width) throw new RangeError(`Bit ${index} is outside 0..${width - 1}`);
  return toUnsigned(value, width) ^ (1n << BigInt(index));
}

export function getBit(value, index) {
  return (BigInt(value) >> BigInt(index)) & 1n;
}

/* ------------------------------------------------------------------ bitfields */

const FIELD_TOKEN = /^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)(?:(?::|\.\.)(\d+))?\]$/;

/**
 * Parse a C-style register description, e.g. `EN[0] MODE[3:1] DIV[11:4]`.
 * Tokens may be separated by spaces, commas or semicolons. `NAME[bit]`, `NAME[msb:lsb]` and
 * `NAME[msb..lsb]` are accepted. Returns the valid fields plus a list of error messages.
 */
export function parseFieldSpec(text, width = 32) {
  const fields = [];
  const errors = [];
  const normalized = String(text ?? '')
    .replace(/\s*\[\s*/g, '[')
    .replace(/\s*\]/g, ']')
    .replace(/\s*:\s*/g, ':');
  const seen = new Set();
  for (const tok of normalized.split(/[\s,;]+/).filter(Boolean)) {
    const m = FIELD_TOKEN.exec(tok);
    if (!m) {
      errors.push(`Cannot parse "${tok}" (expected NAME[msb:lsb] or NAME[bit])`);
      continue;
    }
    const name = m[1];
    const msb = Number(m[2]);
    const lsb = m[3] === undefined ? msb : Number(m[3]);
    if (msb < lsb) {
      errors.push(`${name}: msb (${msb}) is below lsb (${lsb})`);
      continue;
    }
    if (msb >= width) {
      errors.push(`${name}: bit ${msb} is outside the ${width}-bit register`);
      continue;
    }
    const key = name.toUpperCase();
    if (seen.has(key)) {
      errors.push(`Duplicate field name ${name}`);
      continue;
    }
    const overlap = fields.find((o) => o.lsb <= msb && lsb <= o.msb);
    if (overlap) {
      errors.push(`${name} overlaps ${overlap.name}`);
      continue;
    }
    seen.add(key);
    fields.push({ name, msb, lsb, width: msb - lsb + 1 });
  }
  return { fields, errors };
}

export function fieldMax(field) {
  return (1n << BigInt(field.width)) - 1n;
}

export function fieldMask(field) {
  return fieldMax(field) << BigInt(field.lsb);
}

/** Extract a field value (right-aligned). Works for negative inputs via two's complement. */
export function getField(value, field) {
  return (BigInt(value) >> BigInt(field.lsb)) & fieldMax(field);
}

/** Insert a field value into a register value, leaving other bits untouched. */
export function setField(value, field, fieldValue, width) {
  const fv = BigInt(fieldValue);
  if (fv < 0n || fv > fieldMax(field)) {
    return { ok: false, error: `${field.name} takes 0..${fieldMax(field)} (${field.width} bit${field.width > 1 ? 's' : ''})` };
  }
  const u = toUnsigned(value, width);
  return { ok: true, value: toUnsigned((u & ~fieldMask(field)) | (fv << BigInt(field.lsb)), width) };
}

/**
 * C macros for each field: _MASK, _SHIFT, _SET(v) and _GET(r).
 * `prefix` is prepended to every name (an underscore is added if missing).
 */
export function genCMacros(fields, { width = 32, prefix = '' } = {}) {
  let pre = String(prefix ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (pre && !pre.endsWith('_')) pre += '_';
  const wide = width > 32;
  const ty = wide ? 'uint64_t' : 'uint32_t';
  const suf = wide ? 'ULL' : 'U';
  const lines = [`/* ${width}-bit register. Generated by Skon's USB Tool Bit Converter. Requires <stdint.h>. */`];
  for (const f of fields) {
    const N = pre + f.name.toUpperCase();
    const mask = '0x' + fieldMask(f).toString(16).toUpperCase();
    lines.push(`#define ${N}_MASK  (${mask}${suf}) /* bits [${f.msb}:${f.lsb}] */`);
    lines.push(`#define ${N}_SHIFT (${f.lsb}U)`);
    lines.push(`#define ${N}_SET(v) ((((${ty})(v)) << ${N}_SHIFT) & ${N}_MASK)`);
    lines.push(`#define ${N}_GET(r) ((((${ty})(r)) & ${N}_MASK) >> ${N}_SHIFT)`);
  }
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------- floating point */

export const FLOAT_FORMATS = {
  half: { label: 'IEEE 754 half (float16)', ebits: 5, mbits: 10 },
  bfloat16: { label: 'bfloat16', ebits: 8, mbits: 7 },
  single: { label: 'IEEE 754 single (float32)', ebits: 8, mbits: 23 },
  double: { label: 'IEEE 754 double (float64)', ebits: 11, mbits: 52 },
};

export function floatFormat(key) {
  const f = FLOAT_FORMATS[key];
  if (!f) throw new RangeError(`Unknown float format ${key}`);
  return { key, ...f, bits: 1 + f.ebits + f.mbits, bias: (1 << (f.ebits - 1)) - 1, maxExp: (1 << f.ebits) - 1 };
}

/** Decode a bit pattern (BigInt or number) of the given format. */
export function decodeFloat(key, bitsIn) {
  const f = floatFormat(key);
  const B = BigInt;
  const u = BigInt.asUintN(f.bits, B(bitsIn));
  const sign = Number((u >> B(f.bits - 1)) & 1n);
  const expField = Number((u >> B(f.mbits)) & B(f.maxExp));
  const mantField = u & ((1n << B(f.mbits)) - 1n);
  const mantNum = Number(mantField);
  const sgn = sign ? -1 : 1;
  let kind;
  let value;
  let unbiased = null;
  let quiet = null;
  if (expField === f.maxExp) {
    if (mantField === 0n) {
      kind = 'infinity';
      value = sgn * Infinity;
    } else {
      kind = 'nan';
      value = NaN;
      quiet = ((mantField >> B(f.mbits - 1)) & 1n) === 1n;
    }
  } else if (expField === 0) {
    unbiased = 1 - f.bias;
    if (mantField === 0n) {
      kind = 'zero';
      value = sgn * 0;
    } else {
      kind = 'subnormal';
      value = sgn * mantNum * 2 ** (unbiased - f.mbits);
    }
  } else {
    kind = 'normal';
    unbiased = expField - f.bias;
    value = sgn * (mantNum + 2 ** f.mbits) * 2 ** (unbiased - f.mbits);
  }
  return {
    format: key,
    totalBits: f.bits,
    bits: u,
    hex: hexOf(u, f.bits),
    sign,
    expField,
    mantField,
    bias: f.bias,
    unbiasedExponent: unbiased,
    kind,
    quiet,
    value,
    signBits: String(sign),
    expBits: expField.toString(2).padStart(f.ebits, '0'),
    mantBits: mantField.toString(2).padStart(f.mbits, '0'),
  };
}

/** Round half to even on an exact double (works for negatives). */
function roundHalfEven(v) {
  const r = Math.floor(v);
  const d = v - r;
  if (d > 0.5) return r + 1;
  if (d < 0.5) return r;
  return r % 2 === 0 ? r : r + 1;
}

/**
 * Nearest representable value of `x` in the format (round to nearest, ties to even).
 * Returns the decoded result plus the error (decoded - x), or null for non-finite x.
 */
export function encodeFloat(key, x) {
  const f = floatFormat(key);
  const B = BigInt;
  const mb = f.mbits;
  const signShift = B(f.bits - 1);
  let bits;
  if (Number.isNaN(x)) {
    bits = (B(f.maxExp) << B(mb)) | (1n << B(mb - 1));
  } else {
    const sign = x < 0 || Object.is(x, -0) ? 1n : 0n;
    const signPart = sign << signShift;
    const a = Math.abs(x);
    if (a === Infinity) {
      bits = signPart | (B(f.maxExp) << B(mb));
    } else if (a === 0) {
      bits = signPart;
    } else {
      let E = Math.floor(Math.log2(a));
      while (2 ** E > a) E -= 1;
      while (2 ** (E + 1) <= a) E += 1;
      const emin = 1 - f.bias;
      if (E < emin) {
        // Subnormal: fixed quantum 2^(emin - mb). A rounding carry into 2^mb lands on the
        // smallest normal, which is exactly the right bit pattern.
        bits = signPart | B(roundHalfEven(a / 2 ** (emin - mb)));
      } else {
        let m = roundHalfEven(a / 2 ** (E - mb));
        if (m >= 2 ** (mb + 1)) {
          m = 2 ** mb;
          E += 1;
        }
        if (E + f.bias >= f.maxExp) {
          bits = signPart | (B(f.maxExp) << B(mb));
        } else {
          bits = signPart | (B(E + f.bias) << B(mb)) | B(m - 2 ** mb);
        }
      }
    }
  }
  const decoded = decodeFloat(key, bits);
  const finite = Number.isFinite(x) && Number.isFinite(decoded.value);
  const error = finite ? decoded.value - x : null;
  return {
    ...decoded,
    input: x,
    exact: decoded.value === x,
    error,
    relativeError: finite && x !== 0 ? error / Math.abs(x) : null,
  };
}

/** Decimal text to number: accepts JS number syntax, hex, and inf/-inf/nan. */
export function parseDecimal(text) {
  const s = String(text ?? '').trim();
  if (!s) return { ok: false, error: 'Empty input' };
  const low = s.toLowerCase();
  if (low === 'inf' || low === '+inf' || low === 'infinity' || low === '+infinity') return { ok: true, value: Infinity };
  if (low === '-inf' || low === '-infinity') return { ok: true, value: -Infinity };
  if (low === 'nan' || low === '+nan' || low === '-nan') return { ok: true, value: NaN };
  const n = Number(s.replace(/_/g, ''));
  if (Number.isNaN(n)) return { ok: false, error: `"${s}" is not a number` };
  return { ok: true, value: n };
}

/** Bytes (as numbers) to an unsigned BigInt, little or big endian. */
export function bytesToUint(bytes, littleEndian) {
  const seq = littleEndian ? bytes.slice().reverse() : bytes;
  let acc = 0n;
  for (const b of seq) acc = (acc << 8n) | BigInt(b & 0xff);
  return acc;
}

/** Decode a float from raw bytes; the byte count must equal the format size. */
export function floatFromBytes(key, bytes, littleEndian) {
  const f = floatFormat(key);
  if (bytes.length !== f.bits / 8) return { ok: false, error: `${key} needs exactly ${f.bits / 8} bytes, got ${bytes.length}` };
  return { ok: true, ...decodeFloat(key, bytesToUint(bytes, littleEndian)) };
}

/** Bit patterns of the special values of a format. */
export function floatSpecials(key) {
  const f = floatFormat(key);
  const B = BigInt;
  const mb = B(f.mbits);
  const maxE = B(f.maxExp);
  const signBit = 1n << B(f.bits - 1);
  const one = B(f.bias) << mb;
  return {
    '+0': 0n,
    '-0': signBit,
    '+1': one,
    '-1': one | signBit,
    '+inf': maxE << mb,
    '-inf': (maxE << mb) | signBit,
    NaN: (maxE << mb) | (1n << (mb - 1n)),
    'max finite': ((maxE - 1n) << mb) | ((1n << mb) - 1n),
    'min normal': 1n << mb,
    'min subnormal': 1n,
  };
}

/* ---------------------------------------------------------------- fixed-point */

/**
 * Parse a Q format. `Qm.n` is signed with m integer bits including the sign bit (Q1.15 is
 * the 16-bit DSP Q15 format). `UQm.n` is unsigned. `Qn` alone means Q1.n.
 */
export function parseQFormat(text) {
  const m = /^\s*(U?)Q(\d+)(?:\.(\d+))?\s*$/i.exec(String(text ?? ''));
  if (!m) return { ok: false, error: 'Use Qm.n (signed) or UQm.n (unsigned), for example Q1.15, Q16.16, UQ8.8' };
  const signed = m[1] === '';
  if (m[3] === undefined && !signed) return { ok: false, error: 'Unsigned formats need both parts, e.g. UQ8.8' };
  const intBits = m[3] === undefined ? 1 : Number(m[2]);
  const fracBits = m[3] === undefined ? Number(m[2]) : Number(m[3]);
  if (signed && intBits < 1) return { ok: false, error: 'A signed Q format needs at least 1 integer bit (the sign)' };
  const width = intBits + fracBits;
  if (width < 1 || width > 64) return { ok: false, error: 'Total width must be between 1 and 64 bits' };
  return { ok: true, signed, intBits, fracBits, width, label: `${signed ? 'Q' : 'UQ'}${intBits}.${fracBits}` };
}

export function qRawRange(q) {
  if (q.signed) return { minRaw: -(1n << BigInt(q.width - 1)), maxRaw: (1n << BigInt(q.width - 1)) - 1n };
  return { minRaw: 0n, maxRaw: (1n << BigInt(q.width)) - 1n };
}

export function qInfo(q) {
  const { minRaw, maxRaw } = qRawRange(q);
  const scale = 2 ** q.fracBits;
  return {
    ...q,
    minRaw,
    maxRaw,
    minValue: Number(minRaw) / scale,
    maxValue: Number(maxRaw) / scale,
    resolution: 1 / scale,
  };
}

/** Raw register pattern (integer literal, two's complement at the Q width) to real value. */
export function qFromRaw(q, rawInput) {
  const p = parseNumber(rawInput);
  if (!p.ok) return p;
  const { minRaw, maxRaw } = qRawRange(q);
  const outOfRange = p.value < minRaw || p.value > maxRaw;
  const raw = q.signed ? toSigned(p.value, q.width) : toUnsigned(p.value, q.width);
  return {
    ok: true,
    raw,
    rawHex: hexOf(toUnsigned(raw, q.width), q.width),
    value: Number(raw) / 2 ** q.fracBits,
    outOfRange,
  };
}

/**
 * Real value to Q raw. rounding: 'nearest' (ties to even) or 'truncate'.
 * overflow: 'saturate' clamps to the range, 'wrap' keeps the low bits.
 */
export function qFromReal(q, x, { rounding = 'nearest', overflow = 'saturate' } = {}) {
  if (!Number.isFinite(x)) return { ok: false, error: 'Value must be a finite number' };
  const scaled = x * 2 ** q.fracBits;
  const r = rounding === 'truncate' ? Math.trunc(scaled) : roundHalfEven(scaled);
  const { minRaw, maxRaw } = qRawRange(q);
  let raw = BigInt(r);
  const overflowed = raw < minRaw || raw > maxRaw;
  if (overflowed) {
    if (overflow === 'saturate') raw = raw < minRaw ? minRaw : maxRaw;
    else raw = q.signed ? toSigned(raw, q.width) : toUnsigned(raw, q.width);
  }
  const value = Number(raw) / 2 ** q.fracBits;
  return {
    ok: true,
    raw,
    rawHex: hexOf(toUnsigned(raw, q.width), q.width),
    value,
    error: value - x,
    overflowed,
  };
}

/* ------------------------------------------------------------------ bitwise */

/** Rotate left by n bits within `width` bits. */
export function rotl(value, n, width) {
  const w = BigInt(width);
  const k = BigInt(n) % w;
  const u = toUnsigned(value, width);
  if (k === 0n) return u;
  return toUnsigned((u << k) | (u >> (w - k)), width);
}

/** Rotate right by n bits within `width` bits. */
export function rotr(value, n, width) {
  const k = BigInt(n) % BigInt(width);
  return rotl(value, (BigInt(width) - k) % BigInt(width), width);
}

export const BITWISE_OPS = ['and', 'or', 'xor', 'not', 'shl', 'shr', 'sar', 'rol', 'ror'];

/**
 * Bitwise operation at a width. Returns the unsigned result pattern.
 * Shifts by >= width give 0 (SHL/SHR) or sign fill (SAR). Rotates use n mod width.
 * `b` is ignored for NOT. Negative shift or rotate counts are rejected.
 */
export function bitwiseOp(op, a, b, width) {
  const u = toUnsigned(a, width);
  if (op === 'not') return { ok: true, result: toUnsigned(~u, width) };
  if (!BITWISE_OPS.includes(op)) return { ok: false, error: `Unknown operation ${op}` };
  if (op === 'and') return { ok: true, result: u & toUnsigned(b, width) };
  if (op === 'or') return { ok: true, result: u | toUnsigned(b, width) };
  if (op === 'xor') return { ok: true, result: u ^ toUnsigned(b, width) };
  const n = BigInt(b);
  if (n < 0n) return { ok: false, error: 'Shift and rotate counts must be zero or positive' };
  if (op === 'shl') return { ok: true, result: n >= BigInt(width) ? 0n : toUnsigned(u << n, width) };
  if (op === 'shr') return { ok: true, result: n >= BigInt(width) ? 0n : u >> n };
  if (op === 'sar') {
    const s = toSigned(u, width);
    if (n >= BigInt(width)) return { ok: true, result: s < 0n ? toUnsigned(-1n, width) : 0n };
    return { ok: true, result: toUnsigned(s >> n, width) };
  }
  if (op === 'rol') return { ok: true, result: rotl(u, n, width) };
  return { ok: true, result: rotr(u, n, width) };
}

/* ------------------------------------------------------------ data inspector */

/** Bytes from a hex string: spaces, commas, colons, dashes, underscores and 0x prefixes are ignored. */
export function parseHexBytes(text) {
  const s = String(text ?? '').replace(/0x/gi, '').replace(/[\s,:;_-]+/g, '');
  if (!/^[0-9a-fA-F]*$/.test(s)) return { ok: false, error: 'Bytes must be hex digits (spaces, commas or colons between bytes are fine)' };
  if (s.length % 2) return { ok: false, error: 'Odd number of hex digits: every byte needs two' };
  const bytes = [];
  for (let i = 0; i < s.length; i += 2) bytes.push(parseInt(s.slice(i, i + 2), 16));
  return { ok: true, bytes };
}

const isoFromMs = (ms) => {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? 'out of range' : d.toISOString();
};

/**
 * Hex-editor style data inspector at `offset`. Returns rows of { label, value, note }.
 * `value` is null when there are not enough bytes left; `note` says how many are needed.
 */
export function inspectBytes(bytes, offset = 0) {
  const u8 = Uint8Array.from(bytes);
  const dv = new DataView(u8.buffer);
  const n = u8.length;
  const off = Math.max(0, Math.floor(offset));
  const left = Math.max(0, n - off);
  const rows = [];
  const need = (label, size) => rows.push({ label, value: null, note: `needs ${size} bytes, ${left} left` });
  const row = (label, size, read) => {
    if (left < size) need(label, size);
    else rows.push({ label, value: String(read()), note: '' });
  };
  const slice = (size) => u8.subarray(off, Math.min(n, off + size));

  row('int8', 1, () => dv.getInt8(off));
  row('uint8', 1, () => dv.getUint8(off));
  for (const le of [true, false]) {
    const e = le ? 'LE' : 'BE';
    row(`int16 ${e}`, 2, () => dv.getInt16(off, le));
    row(`uint16 ${e}`, 2, () => dv.getUint16(off, le));
    row(`int32 ${e}`, 4, () => dv.getInt32(off, le));
    row(`uint32 ${e}`, 4, () => dv.getUint32(off, le));
    row(`int64 ${e}`, 8, () => dv.getBigInt64(off, le));
    row(`uint64 ${e}`, 8, () => dv.getBigUint64(off, le));
  }
  for (const le of [true, false]) {
    const e = le ? 'LE' : 'BE';
    row(`float16 ${e}`, 2, () => decodeFloat('half', bytesToUint(Array.from(slice(2)), le)).value);
    row(`bfloat16 ${e}`, 2, () => decodeFloat('bfloat16', bytesToUint(Array.from(slice(2)), le)).value);
    row(`float32 ${e}`, 4, () => dv.getFloat32(off, le));
    row(`float64 ${e}`, 8, () => dv.getFloat64(off, le));
  }

  // Text: up to 32 bytes, stopping at the first NUL.
  const textBytes = Array.from(slice(32));
  const nul = textBytes.indexOf(0);
  const used = nul === -1 ? textBytes : textBytes.slice(0, nul);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(used));
  rows.push({ label: 'UTF-8 text', value: utf8.replace(/[\x00-\x1f\x7f]/g, '.'), note: left === 0 ? 'no bytes at this offset' : '' });
  const units = [];
  for (let i = 0; i + 1 < Math.min(left, 32); i += 2) {
    const le = u8[off + i] | (u8[off + i + 1] << 8);
    units.push(le);
  }
  const u16le = units.slice(0, units.indexOf(0) === -1 ? units.length : units.indexOf(0));
  const u16be = [];
  for (let i = 0; i + 1 < Math.min(left, 32); i += 2) u16be.push((u8[off + i] << 8) | u8[off + i + 1]);
  const u16beCut = u16be.slice(0, u16be.indexOf(0) === -1 ? u16be.length : u16be.indexOf(0));
  rows.push({ label: 'UTF-16LE text', value: String.fromCharCode(...u16le).replace(/[\x00-\x1f\x7f]/g, '.'), note: '' });
  rows.push({ label: 'UTF-16BE text', value: String.fromCharCode(...u16beCut).replace(/[\x00-\x1f\x7f]/g, '.'), note: '' });

  // Unix timestamps (UTC).
  row('unix s  u32 LE', 4, () => isoFromMs(dv.getUint32(off, true) * 1000));
  row('unix s  u32 BE', 4, () => isoFromMs(dv.getUint32(off, false) * 1000));
  row('unix ms u32 LE', 4, () => isoFromMs(dv.getUint32(off, true)));
  row('unix ms u32 BE', 4, () => isoFromMs(dv.getUint32(off, false)));
  const big = (le, ms) => {
    const t = dv.getBigUint64(off, le);
    const v = Number(t);
    return isoFromMs(ms ? v : v * 1000);
  };
  row('unix s  u64 LE', 8, () => big(true, false));
  row('unix s  u64 BE', 8, () => big(false, false));
  row('unix ms u64 LE', 8, () => big(true, true));
  row('unix ms u64 BE', 8, () => big(false, true));
  return rows;
}

/* ---------------------------------------------------------------- additions */

/** Reverse the order of the low `width` bits (bit 0 becomes bit width-1). */
export function reverseBits(value, width) {
  const u = toUnsigned(value, width);
  let out = 0n;
  for (let i = 0; i < width; i++) if ((u >> BigInt(i)) & 1n) out |= 1n << BigInt(width - 1 - i);
  return out;
}

/** Flip one bit of a float bit pattern (index 0 = LSB). Returns the new unsigned pattern. */
export function toggleFloatBit(key, bitsIn, index) {
  const f = floatFormat(key);
  if (!Number.isInteger(index) || index < 0 || index >= f.bits) throw new RangeError('Bit index out of range');
  return BigInt.asUintN(f.bits, BigInt(bitsIn)) ^ (1n << BigInt(index));
}

/**
 * Neighbouring float patterns: the next value up and down in magnitude-ordered numeric order.
 * Returns { up, down } as bit patterns, or null for a direction with no finite/infinite neighbour
 * (NaN input gives { up: null, down: null }).
 */
export function floatNeighbors(key, bitsIn) {
  const f = floatFormat(key);
  const u = BigInt.asUintN(f.bits, BigInt(bitsIn));
  const signBit = 1n << BigInt(f.bits - 1);
  const mag = u & (signBit - 1n);
  const infMag = BigInt(f.maxExp) << BigInt(f.mbits);
  if (mag > infMag) return { up: null, down: null };
  const neg = (u & signBit) !== 0n;
  const step = (m, delta) => m + delta;
  // Move toward +inf (dir +1) or -inf (dir -1) in value order.
  const move = (dir) => {
    if (mag === 0n) {
      // +0 and -0 both step to the smallest subnormals.
      return dir > 0 ? 1n : signBit | 1n;
    }
    const grow = (dir > 0) !== neg; // magnitude grows when moving away from zero
    if (grow) return mag === infMag ? null : (neg ? signBit : 0n) | step(mag, 1n);
    return (neg ? signBit : 0n) | step(mag, -1n);
  };
  return { up: move(1), down: move(-1) };
}

/**
 * Evaluate a C-style integer expression at a width. Operators by precedence: unary - + ~,
 * * / %, + -, << >>, &, ^, |. Literals as in parseNumber. Math is exact (BigInt) and the
 * result is wrapped to the width, so the same text gives the same bits as C unsigned math.
 * Division truncates toward zero.
 */
export function evalExpression(text, width = 32) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, error: 'Empty expression' };
  const tokens = [];
  const re = /\s*(?:(0[xXbBoO][0-9a-fA-F_]+|[0-9][0-9_]*)|(<<|>>|[-+*/%&|^~()]))/y;
  let pos = 0;
  while (pos < text.length) {
    if (/^\s*$/.test(text.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) return { ok: false, error: `Unexpected character at position ${pos + 1}: "${text.slice(pos).trim()[0]}"` };
    if (m[1] !== undefined) {
      const p = parseNumber(m[1]);
      if (!p.ok) return { ok: false, error: p.error };
      tokens.push({ n: p.value });
    } else tokens.push({ op: m[2] });
    pos = re.lastIndex;
  }
  let i = 0;
  const fail = (error) => { throw new Error(error); };
  const peek = () => tokens[i]?.op;
  const binary = (next, ops, apply) => () => {
    let l = next();
    while (ops.includes(peek())) {
      const op = tokens[i++].op;
      l = apply(op, l, next());
    }
    return l;
  };
  const unary = () => {
    const op = peek();
    if (op === '-' || op === '+' || op === '~') {
      i++;
      const v = unary();
      return op === '-' ? -v : op === '~' ? ~v : v;
    }
    if (op === '(') {
      i++;
      const v = orExpr();
      if (peek() !== ')') fail('Missing closing parenthesis');
      i++;
      return v;
    }
    const t = tokens[i];
    if (!t || t.op) fail(t ? `Unexpected "${t.op}"` : 'Expression ends early');
    i++;
    return t.n;
  };
  const mul = binary(unary, ['*', '/', '%'], (op, a, b) => {
    if (op === '*') return a * b;
    if (b === 0n) fail('Division by zero');
    return op === '/' ? a / b : a % b;
  });
  const add = binary(mul, ['+', '-'], (op, a, b) => (op === '+' ? a + b : a - b));
  const shift = binary(add, ['<<', '>>'], (op, a, b) => {
    if (b < 0n || b > 256n) fail('Shift count must be 0 to 256');
    return op === '<<' ? a << b : a >> b;
  });
  const andE = binary(shift, ['&'], (_o, a, b) => a & b);
  const xorE = binary(andE, ['^'], (_o, a, b) => a ^ b);
  const orExpr = binary(xorE, ['|'], (_o, a, b) => a | b);
  try {
    const raw = orExpr();
    if (i < tokens.length) fail(`Unexpected "${tokens[i].op ?? tokens[i].n}"`);
    const u = toUnsigned(raw, width);
    return { ok: true, raw, value: u, signed: toSigned(u, width), wrapped: raw !== u && raw !== toSigned(u, width) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
