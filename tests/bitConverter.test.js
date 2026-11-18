import { describe, it, expect } from 'vitest';
import {
  parseNumber, analyzeNumber, toUnsigned, toSigned, toggleBit, getBit,
  parseFieldSpec, getField, setField, fieldMask, genCMacros,
  decodeFloat, encodeFloat, parseDecimal, floatFromBytes, floatSpecials,
  parseQFormat, qInfo, qFromRaw, qFromReal,
  rotl, rotr, bitwiseOp,
  parseHexBytes, inspectBytes, bytesToUint,
} from '../src/utils/bitConverter.js';

const row = (rows, label) => rows.find((r) => r.label === label);

describe('parseNumber', () => {
  it('accepts hex, binary, octal, decimal and underscores', () => {
    expect(parseNumber('0xDEAD_BEEF').value).toBe(0xdeadbeefn);
    expect(parseNumber('0XdeadBEEF').value).toBe(0xdeadbeefn);
    expect(parseNumber('0b1010_0101').value).toBe(0xa5n);
    expect(parseNumber('0o755').value).toBe(493n);
    expect(parseNumber('1_000_000').value).toBe(1000000n);
    expect(parseNumber('  42 ').value).toBe(42n);
  });

  it('handles negatives', () => {
    expect(parseNumber('-1').value).toBe(-1n);
    expect(parseNumber('-0x80').value).toBe(-128n);
    expect(parseNumber('-0x80').negative).toBe(true);
    expect(parseNumber('-0').negative).toBe(false);
  });

  it('covers the 64-bit range exactly and rejects beyond it', () => {
    expect(parseNumber('18446744073709551615').value).toBe(2n ** 64n - 1n);
    expect(parseNumber('-9223372036854775808').value).toBe(-(2n ** 63n));
    expect(parseNumber('18446744073709551616').ok).toBe(false);
    expect(parseNumber('-9223372036854775809').ok).toBe(false);
  });

  it('rejects malformed input', () => {
    for (const bad of ['', '0x', '0b', '0xG1', '12a', '0b102', '1__0', '_1', '1_', '0o8', '-']) {
      expect(parseNumber(bad).ok, bad).toBe(false);
    }
  });
});

describe('two complement edges', () => {
  it('maps 8/16/64-bit boundaries both ways', () => {
    expect(toSigned(0x80n, 8)).toBe(-128n);
    expect(toSigned(0x7fn, 8)).toBe(127n);
    expect(toSigned(0xffn, 8)).toBe(-1n);
    expect(toUnsigned(-1n, 8)).toBe(255n);
    expect(toUnsigned(-128n, 8)).toBe(128n);
    expect(toUnsigned(-128n, 16)).toBe(0xff80n);
    expect(toSigned(0x8000n, 16)).toBe(-32768n);
    expect(toSigned(1n << 63n, 64)).toBe(-(2n ** 63n));
    expect(toUnsigned(-1n, 64)).toBe(2n ** 64n - 1n);
    expect(toSigned(2n ** 64n - 1n, 64)).toBe(-1n);
  });

  it('reduces out-of-range values modulo 2^width', () => {
    expect(toUnsigned(256n, 8)).toBe(0n);
    expect(toUnsigned(-257n, 8)).toBe(255n);
  });
});

describe('analyzeNumber', () => {
  it('shows -1 at 8 bits in all radixes and signed/unsigned views', () => {
    const a = analyzeNumber('-1', 8);
    expect(a.unsigned).toBe(255n);
    expect(a.signed).toBe(-1n);
    expect(a.hex).toBe('0xFF');
    expect(a.dec).toBe('255');
    expect(a.oct).toBe('0o377');
    expect(a.bin).toBe('0b11111111');
    expect(a.popcount).toBe(8);
    expect(a.leadingZeros).toBe(0);
    expect(a.trailingZeros).toBe(0);
    expect(a.truncated).toBe(false);
  });

  it('flags values that do not fit the width', () => {
    const a = analyzeNumber('0x1FF', 8);
    expect(a.truncated).toBe(true);
    expect(a.unsigned).toBe(0xffn);
  });

  it('computes byte order views and byte swap', () => {
    const a = analyzeNumber('0x1234', 32);
    expect(a.bytesBE).toEqual([0x00, 0x00, 0x12, 0x34]);
    expect(a.bytesLE).toEqual([0x34, 0x12, 0x00, 0x00]);
    expect(a.swappedHex).toBe('0x34120000');
    expect(analyzeNumber('0x12345678', 32).swappedHex).toBe('0x78563412');
    expect(analyzeNumber('0x1122', 16).swappedHex).toBe('0x2211');
  });

  it('gives the ASCII view with dots for non-printable bytes', () => {
    expect(analyzeNumber('0x41424344', 32).ascii).toBe('ABCD');
    expect(analyzeNumber('0x00414200', 32).ascii).toBe('.AB.');
  });

  it('counts zeros, popcount and bit length', () => {
    const z = analyzeNumber('0', 16);
    expect(z.leadingZeros).toBe(16);
    expect(z.trailingZeros).toBe(16);
    expect(z.popcount).toBe(0);
    expect(z.bitLength).toBe(0);

    const b = analyzeNumber('0x0F00', 16);
    expect(b.leadingZeros).toBe(4);
    expect(b.trailingZeros).toBe(8);
    expect(b.popcount).toBe(4);
    expect(b.bitLength).toBe(12);
  });

  it('computes next power of two and whether it fits the width', () => {
    expect(analyzeNumber('0', 8).nextPow2).toBe(1n);
    expect(analyzeNumber('1', 8).nextPow2).toBe(1n);
    expect(analyzeNumber('64', 32).nextPow2).toBe(64n);
    expect(analyzeNumber('65', 32).nextPow2).toBe(128n);
    expect(analyzeNumber('0x0F00', 16).nextPow2).toBe(0x1000n);
    const over = analyzeNumber('0xFF', 8);
    expect(over.nextPow2).toBe(256n);
    expect(over.nextPow2Fits).toBe(false);
    expect(analyzeNumber('0xFFFFFFFFFFFFFFFF', 64).nextPow2Fits).toBe(false);
  });

  it('handles the 64-bit extremes', () => {
    const min = analyzeNumber('-0x8000000000000000', 64);
    expect(min.signed).toBe(-(2n ** 63n));
    expect(min.hex).toBe('0x8000000000000000');
    const max = analyzeNumber('0xFFFFFFFFFFFFFFFF', 64);
    expect(max.signed).toBe(-1n);
    expect(max.popcount).toBe(64);
  });

  it('returns the four width views', () => {
    const a = analyzeNumber('-2', 32);
    expect(a.widths.map((w) => w.width)).toEqual([8, 16, 32, 64]);
    expect(a.widths[0]).toMatchObject({ unsigned: 254n, signed: -2n, hex: '0xFE' });
    expect(a.widths[3].hex).toBe('0xFFFFFFFFFFFFFFFE');
  });

  it('rejects an unsupported width or bad input', () => {
    expect(analyzeNumber('1', 12).ok).toBe(false);
    expect(analyzeNumber('zz', 32).ok).toBe(false);
  });
});

describe('bit grid helpers', () => {
  it('toggles one bit and reads bits', () => {
    expect(toggleBit(0, 31, 32)).toBe(0x80000000n);
    expect(toggleBit(0x80000000n, 31, 32)).toBe(0n);
    expect(toggleBit(-1, 0, 8)).toBe(0xfen);
    expect(getBit(0b1010n, 1)).toBe(1n);
    expect(getBit(0b1010n, 0)).toBe(0n);
    expect(() => toggleBit(0, 8, 8)).toThrow(RangeError);
  });
});

describe('bitfields', () => {
  it('parses the C-style register description', () => {
    const { fields, errors } = parseFieldSpec('EN[0] MODE[3:1] DIV[11:4]', 16);
    expect(errors).toEqual([]);
    expect(fields.map((f) => [f.name, f.msb, f.lsb, f.width])).toEqual([
      ['EN', 0, 0, 1],
      ['MODE', 3, 1, 3],
      ['DIV', 11, 4, 8],
    ]);
  });

  it('accepts spaces inside brackets, commas and the .. range form', () => {
    const { fields, errors } = parseFieldSpec('MODE [3 : 1], DIV[7..4]; EN[0]', 8);
    expect(errors).toEqual([]);
    expect(fields.map((f) => [f.name, f.msb, f.lsb])).toEqual([['MODE', 3, 1], ['DIV', 7, 4], ['EN', 0, 0]]);
  });

  it('reports bad specs without dropping the good fields', () => {
    const r = parseFieldSpec('OK[0] A[3:5] B[32] X[1] X[2] Y[7:4] Z[6:5] 1BAD[0] junk', 32);
    expect(r.fields.map((f) => f.name)).toEqual(['OK', 'X', 'Y']);
    expect(r.errors.some((e) => e.includes('msb (3) is below lsb (5)'))).toBe(true);
    expect(r.errors.some((e) => e.includes('B: bit 32 is outside'))).toBe(true);
    expect(r.errors.some((e) => e.includes('Duplicate field name X'))).toBe(true);
    expect(r.errors.some((e) => e.includes('Z overlaps Y'))).toBe(true);
    expect(r.errors.some((e) => e.includes('1BAD'))).toBe(true);
    expect(r.errors.some((e) => e.includes('junk'))).toBe(true);
  });

  it('extracts and inserts field values', () => {
    const mode = { name: 'MODE', msb: 3, lsb: 1, width: 3 };
    const div = { name: 'DIV', msb: 11, lsb: 4, width: 8 };
    expect(getField(0xabc, div)).toBe(0xabn);
    expect(getField(0xabc, mode)).toBe(0x6n);
    expect(getField(-1, mode)).toBe(7n);
    expect(setField(0, mode, 5, 16)).toEqual({ ok: true, value: 0b1010n });
    expect(setField(0xffff, div, 0, 16)).toEqual({ ok: true, value: 0xf00fn });
    expect(setField(0, mode, 8, 16).ok).toBe(false);
    expect(setField(0, mode, -1, 16).ok).toBe(false);
    expect(fieldMask(div)).toBe(0xff0n);
  });

  it('generates C macros for mask, shift, set and get', () => {
    const { fields } = parseFieldSpec('EN[0] MODE[3:1]', 32);
    const c = genCMacros(fields, { width: 32, prefix: 'uart' });
    expect(c).toContain('#define UART_EN_MASK  (0x1U) /* bits [0:0] */');
    expect(c).toContain('#define UART_MODE_MASK  (0xEU) /* bits [3:1] */');
    expect(c).toContain('#define UART_MODE_SHIFT (1U)');
    expect(c).toContain('#define UART_MODE_SET(v) ((((uint32_t)(v)) << UART_MODE_SHIFT) & UART_MODE_MASK)');
    expect(c).toContain('#define UART_MODE_GET(r) ((((uint32_t)(r)) & UART_MODE_MASK) >> UART_MODE_SHIFT)');
  });

  it('uses ULL masks and uint64_t for 64-bit registers', () => {
    const { fields } = parseFieldSpec('HI[63:32]', 64);
    const c = genCMacros(fields, { width: 64 });
    expect(c).toContain('#define HI_MASK  (0xFFFFFFFF00000000ULL)');
    expect(c).toContain('uint64_t');
  });
});

describe('float decode', () => {
  it('decodes known half-precision patterns', () => {
    expect(decodeFloat('half', 0x3c00).value).toBe(1);
    expect(decodeFloat('half', 0xc000).value).toBe(-2);
    expect(decodeFloat('half', 0x7bff).value).toBe(65504);
    expect(decodeFloat('half', 0x0400).value).toBe(2 ** -14);
    expect(decodeFloat('half', 0x0001).value).toBe(2 ** -24);
    expect(decodeFloat('half', 0x3555).value).toBe(1365 / 4096);
    expect(decodeFloat('half', 0x0001).kind).toBe('subnormal');
  });

  it('classifies special values', () => {
    expect(decodeFloat('half', 0x0000).kind).toBe('zero');
    expect(Object.is(decodeFloat('half', 0x8000).value, -0)).toBe(true);
    expect(decodeFloat('half', 0x7c00)).toMatchObject({ kind: 'infinity', value: Infinity });
    expect(decodeFloat('half', 0xfc00).value).toBe(-Infinity);
    expect(decodeFloat('half', 0x7e00)).toMatchObject({ kind: 'nan', quiet: true });
    expect(decodeFloat('half', 0x7c01)).toMatchObject({ kind: 'nan', quiet: false });
  });

  it('breaks a pattern into sign, exponent and mantissa', () => {
    const d = decodeFloat('single', 0xc0490fdb);
    expect(d.sign).toBe(1);
    expect(d.expField).toBe(128);
    expect(d.unbiasedExponent).toBe(1);
    expect(d.expBits).toBe('10000000');
    expect(d.mantBits.length).toBe(23);
    expect(d.value).toBeCloseTo(-3.14159265, 6);
  });

  it('decodes bfloat16 and the bfloat16 limits', () => {
    expect(decodeFloat('bfloat16', 0x3f80).value).toBe(1);
    expect(decodeFloat('bfloat16', 0x4049).value).toBe(3.140625);
    expect(decodeFloat('bfloat16', 0x7f7f).value).toBe((2 - 2 ** -7) * 2 ** 127);
  });

  it('decodes little-endian bytes', () => {
    expect(floatFromBytes('single', [0x00, 0x00, 0x80, 0x3f], true).value).toBe(1);
    expect(floatFromBytes('single', [0x3f, 0x80, 0x00, 0x00], false).value).toBe(1);
    expect(floatFromBytes('half', [0x00, 0x3c], true).value).toBe(1);
    expect(floatFromBytes('half', [0x00], true).ok).toBe(false);
    expect(bytesToUint([0x34, 0x12], true)).toBe(0x1234n);
  });

  it('gives the special value patterns', () => {
    const h = floatSpecials('half');
    expect(h['max finite']).toBe(0x7bffn);
    expect(h['min normal']).toBe(0x0400n);
    expect(h['min subnormal']).toBe(0x0001n);
    expect(h['-0']).toBe(0x8000n);
    expect(h['+1']).toBe(0x3c00n);
    expect(decodeFloat('double', floatSpecials('double')['max finite']).value).toBe(Number.MAX_VALUE);
    expect(decodeFloat('double', floatSpecials('double')['min subnormal']).value).toBe(2 ** -1074);
    expect(decodeFloat('single', floatSpecials('single')['+inf']).value).toBe(Infinity);
    expect(decodeFloat('single', floatSpecials('single')['NaN']).kind).toBe('nan');
  });
});

describe('float encode', () => {
  it('encodes known half-precision values', () => {
    expect(encodeFloat('half', 1).bits).toBe(0x3c00n);
    expect(encodeFloat('half', -2).bits).toBe(0xc000n);
    expect(encodeFloat('half', 65504).bits).toBe(0x7bffn);
    expect(encodeFloat('half', 0.1).bits).toBe(0x2e66n);
    expect(encodeFloat('half', 1 / 3).bits).toBe(0x3555n);
    expect(encodeFloat('half', 2 ** -24).bits).toBe(0x0001n);
  });

  it('reports the nearest value and the error', () => {
    const e = encodeFloat('half', 0.1);
    expect(e.value).toBe(0.0999755859375);
    expect(e.exact).toBe(false);
    expect(e.error).toBeCloseTo(0.0999755859375 - 0.1, 12);
    expect(encodeFloat('half', 1).exact).toBe(true);
    expect(encodeFloat('half', 1).error).toBe(0);
  });

  it('rounds ties to even', () => {
    // 2049 is halfway between 2048 (even mantissa) and 2050.
    expect(encodeFloat('half', 2049).value).toBe(2048);
    // 2051 is halfway between 2050 (odd) and 2052 (even).
    expect(encodeFloat('half', 2051).value).toBe(2052);
  });

  it('overflows to infinity past the largest finite value', () => {
    expect(encodeFloat('half', 65520).value).toBe(Infinity);
    expect(encodeFloat('half', 65519).value).toBe(65504);
    expect(encodeFloat('half', 1e10).bits).toBe(0x7c00n);
    expect(encodeFloat('single', 3.5e38).bits).toBe(0x7f800000n);
  });

  it('encodes bfloat16 vectors', () => {
    expect(encodeFloat('bfloat16', 1).bits).toBe(0x3f80n);
    expect(encodeFloat('bfloat16', -2).bits).toBe(0xc000n);
    expect(encodeFloat('bfloat16', Math.PI).bits).toBe(0x4049n);
    expect(encodeFloat('bfloat16', Math.PI).value).toBe(3.140625);
  });

  it('keeps special values', () => {
    expect(encodeFloat('half', Infinity).bits).toBe(0x7c00n);
    expect(encodeFloat('half', -Infinity).bits).toBe(0xfc00n);
    expect(encodeFloat('half', -0).bits).toBe(0x8000n);
    expect(encodeFloat('half', 0).bits).toBe(0n);
    expect(encodeFloat('half', NaN).kind).toBe('nan');
    expect(encodeFloat('half', Infinity).error).toBe(null);
  });

  it('matches the platform float32 rounding (Math.fround / DataView)', () => {
    const dv = new DataView(new ArrayBuffer(8));
    const samples = [0, 1, -1, 0.1, 1 / 3, Math.PI, 3.4028234663852886e38, 1.1754943508222875e-38,
      1.401298464324817e-45, 1e-40, 16777217, 1e30, -2.5, 123456.789, 2 ** -149 * 3, 1e-46];
    for (const x of samples) {
      dv.setFloat32(0, x);
      expect(encodeFloat('single', x).bits, `single ${x}`).toBe(BigInt(dv.getUint32(0)));
    }
  });

  it('matches the platform float64 rounding', () => {
    const dv = new DataView(new ArrayBuffer(8));
    const samples = [0.1, Math.PI, Number.MAX_VALUE, Number.MIN_VALUE, 2.2250738585072014e-308, 1e300, -1e-300, 5e-324 * 7, 9007199254740993];
    for (const x of samples) {
      dv.setFloat64(0, x);
      expect(encodeFloat('double', x).bits, `double ${x}`).toBe(dv.getBigUint64(0));
    }
  });

  it('round-trips every non-NaN half and bfloat16 pattern exactly', () => {
    for (const key of ['half', 'bfloat16']) {
      for (let p = 0; p <= 0xffff; p++) {
        const d = decodeFloat(key, BigInt(p));
        if (d.kind === 'nan') continue;
        expect(encodeFloat(key, d.value).bits, `${key} 0x${p.toString(16)}`).toBe(BigInt(p));
      }
    }
  });
});

describe('parseDecimal', () => {
  it('parses numbers and special words', () => {
    expect(parseDecimal('0.1')).toEqual({ ok: true, value: 0.1 });
    expect(parseDecimal('-inf').value).toBe(-Infinity);
    expect(parseDecimal('NaN').value).toBeNaN();
    expect(parseDecimal('1e3').value).toBe(1000);
    expect(parseDecimal('').ok).toBe(false);
    expect(parseDecimal('abc').ok).toBe(false);
  });
});

describe('fixed-point Q format', () => {
  it('parses Qm.n, the Qn shorthand and unsigned UQm.n', () => {
    expect(parseQFormat('Q1.15')).toMatchObject({ ok: true, signed: true, intBits: 1, fracBits: 15, width: 16, label: 'Q1.15' });
    expect(parseQFormat('Q15')).toMatchObject({ ok: true, signed: true, intBits: 1, fracBits: 15, width: 16 });
    expect(parseQFormat('uq8.8')).toMatchObject({ ok: true, signed: false, width: 16, label: 'UQ8.8' });
    expect(parseQFormat('UQ8').ok).toBe(false);
    expect(parseQFormat('Q0.15').ok).toBe(false);
    expect(parseQFormat('Q1.70').ok).toBe(false);
    expect(parseQFormat('hello').ok).toBe(false);
  });

  it('gives the Q15 range and resolution', () => {
    const q = qInfo(parseQFormat('Q1.15'));
    expect(q.minValue).toBe(-1);
    expect(q.maxValue).toBe(1 - 2 ** -15);
    expect(q.resolution).toBe(2 ** -15);
    expect(q.minRaw).toBe(-32768n);
    expect(q.maxRaw).toBe(32767n);
  });

  it('converts Q15 real values to raw', () => {
    const q = parseQFormat('Q1.15');
    expect(qFromReal(q, 0.5)).toMatchObject({ raw: 0x4000n, rawHex: '0x4000', value: 0.5 });
    expect(qFromReal(q, -0.5)).toMatchObject({ raw: -16384n, rawHex: '0xC000' });
    expect(qFromReal(q, -1)).toMatchObject({ raw: -32768n, rawHex: '0x8000', overflowed: false });
    expect(qFromReal(q, 1)).toMatchObject({ raw: 32767n, rawHex: '0x7FFF', overflowed: true });
    expect(qFromReal(q, -1.5)).toMatchObject({ raw: -32768n, overflowed: true });
    expect(qFromReal(q, 1, { overflow: 'wrap' })).toMatchObject({ raw: -32768n, rawHex: '0x8000', overflowed: true });
    expect(qFromReal(q, NaN).ok).toBe(false);
  });

  it('rounds to nearest (ties to even) or truncates', () => {
    const q = parseQFormat('Q1.15');
    const half = 2 ** -16; // half an LSB
    expect(qFromReal(q, half).raw).toBe(0n);
    expect(qFromReal(q, 3 * half).raw).toBe(2n);
    expect(qFromReal(q, 0.99999, { rounding: 'truncate' }).raw).toBe(32767n);
    // Nearest rounds 32767.67 up to 32768, which saturates to the maximum.
    expect(qFromReal(q, 0.99999).raw).toBe(32767n);
    expect(qFromReal(q, 0.99, { rounding: 'truncate' }).raw).toBe(32440n);
    expect(qFromReal(q, 0.99, { rounding: 'nearest' }).raw).toBe(32440n);
  });

  it('reads raw patterns back to real values', () => {
    const q = parseQFormat('Q1.15');
    expect(qFromRaw(q, '0x7FFF').value).toBe(32767 / 32768);
    expect(qFromRaw(q, '0x8000').value).toBe(-1);
    expect(qFromRaw(q, '0xFFFF').value).toBe(-1 / 32768);
    expect(qFromRaw(q, '0x40000').outOfRange).toBe(true);
    expect(qFromRaw(q, 'bad').ok).toBe(false);
  });

  it('handles Q16.16 and unsigned UQ8.8', () => {
    const q16 = parseQFormat('Q16.16');
    expect(qFromRaw(q16, '0x00018000').value).toBe(1.5);
    expect(qFromReal(q16, -2).rawHex).toBe('0xFFFE0000');
    const uq = parseQFormat('UQ8.8');
    expect(qFromReal(uq, 1.5)).toMatchObject({ raw: 0x180n, rawHex: '0x0180' });
    expect(qInfo(uq).maxValue).toBe(255.99609375);
    expect(qFromReal(uq, -1)).toMatchObject({ raw: 0n, overflowed: true });
  });
});

describe('bitwise calculator', () => {
  it('does AND, OR, XOR and NOT at width', () => {
    expect(bitwiseOp('and', 0xf0, 0x3c, 8).result).toBe(0x30n);
    expect(bitwiseOp('or', 0xf0, 0x3c, 8).result).toBe(0xfcn);
    expect(bitwiseOp('xor', 0xf0, 0x3c, 8).result).toBe(0xccn);
    expect(bitwiseOp('not', 0x0f, 0, 8).result).toBe(0xf0n);
    expect(bitwiseOp('not', 0, 0, 64).result).toBe(2n ** 64n - 1n);
    expect(bitwiseOp('and', -1, 0x1ff, 8).result).toBe(0xffn);
  });

  it('shifts logically and arithmetically', () => {
    expect(bitwiseOp('shl', 0x81, 1, 8).result).toBe(0x02n);
    expect(bitwiseOp('shl', 1, 8, 8).result).toBe(0n);
    expect(bitwiseOp('shr', 0x80, 1, 8).result).toBe(0x40n);
    expect(bitwiseOp('sar', 0x80, 1, 8).result).toBe(0xc0n);
    expect(bitwiseOp('sar', 0x80, 9, 8).result).toBe(0xffn);
    expect(bitwiseOp('sar', 0x40, 9, 8).result).toBe(0n);
    expect(bitwiseOp('shl', 1, -1, 8).ok).toBe(false);
  });

  it('rotates left and right, including n equal to or larger than width', () => {
    expect(bitwiseOp('rol', 0x81, 1, 8).result).toBe(0x03n);
    expect(bitwiseOp('ror', 0x81, 1, 8).result).toBe(0xc0n);
    expect(bitwiseOp('ror', 0x81, 9, 8).result).toBe(0xc0n);
    expect(rotl(0x81, 4, 8)).toBe(0x18n);
    expect(rotr(0x81, 1, 8)).toBe(0xc0n);
    expect(rotl(0x80000001n, 1, 32)).toBe(0x00000003n);
    expect(rotl(0x81n, 0, 8)).toBe(0x81n);
    expect(rotl(0x81n, 8, 8)).toBe(0x81n);
    expect(rotl(0x81n, 9, 8)).toBe(0x03n);
    expect(rotl(0x8000000000000000n, 1, 64)).toBe(1n);
    expect(rotr(1n, 1, 64)).toBe(0x8000000000000000n);
    expect(rotr(0x12345678n, 32, 32)).toBe(0x12345678n);
  });
});

describe('byte input and data inspector', () => {
  it('parses hex bytes with separators and prefixes', () => {
    expect(parseHexBytes('DE AD,0xBE:EF')).toEqual({ ok: true, bytes: [0xde, 0xad, 0xbe, 0xef] });
    expect(parseHexBytes('').bytes).toEqual([]);
    expect(parseHexBytes('ABC').ok).toBe(false);
    expect(parseHexBytes('GG').ok).toBe(false);
  });

  it('shows integer views in both byte orders', () => {
    const rows = inspectBytes([0xde, 0xad, 0xbe, 0xef], 0);
    expect(row(rows, 'uint8').value).toBe('222');
    expect(row(rows, 'int8').value).toBe('-34');
    expect(row(rows, 'uint16 BE').value).toBe('57005');
    expect(row(rows, 'int16 BE').value).toBe('-8531');
    expect(row(rows, 'uint16 LE').value).toBe('44510');
    expect(row(rows, 'int32 BE').value).toBe('-559038737');
    expect(row(rows, 'uint32 LE').value).toBe(String((0xef << 24 >>> 0) + (0xbe << 16) + (0xad << 8) + 0xde));
    expect(row(rows, 'int64 BE').value).toBeNull();
    expect(row(rows, 'int64 BE').note).toContain('needs 8 bytes');
  });

  it('shows float views', () => {
    const rows = inspectBytes([0x3f, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 0);
    expect(row(rows, 'float32 BE').value).toBe('1');
    expect(row(rows, 'float32 LE').value).toBe(String(new DataView(Uint8Array.from([0x3f, 0x80, 0, 0]).buffer).getFloat32(0, true)));
    expect(row(rows, 'float64 BE').value).toBe('0.0078125');
    const half = inspectBytes([0x00, 0x3c], 0);
    expect(row(half, 'float16 LE').value).toBe('1');
  });

  it('decodes text, stopping at NUL and handling UTF-16', () => {
    const rows = inspectBytes([0x48, 0x69, 0x21, 0x00, 0x42], 0);
    expect(row(rows, 'UTF-8 text').value).toBe('Hi!');
    const nul = inspectBytes([0x41, 0x00, 0x42], 0);
    expect(row(nul, 'UTF-8 text').value).toBe('A');
    const le = inspectBytes([0x48, 0x00, 0x69, 0x00], 0);
    expect(row(le, 'UTF-16LE text').value).toBe('Hi');
    const be = inspectBytes([0x00, 0x48, 0x00, 0x69], 0);
    expect(row(be, 'UTF-16BE text').value).toBe('Hi');
  });

  it('renders Unix timestamps as UTC dates', () => {
    const be = inspectBytes([0x5f, 0x5e, 0x10, 0x00], 0);
    expect(row(be, 'unix s  u32 BE').value).toBe('2020-09-13T12:26:40.000Z');
    const le = inspectBytes([0, 0, 0, 0], 0);
    expect(row(le, 'unix s  u32 LE').value).toBe('1970-01-01T00:00:00.000Z');
    // 1600000000000 ms = 0x0000017487 6E8000
    const ms = inspectBytes([0, 0, 0x01, 0x74, 0x87, 0x6e, 0x80, 0], 0);
    expect(row(ms, 'unix ms u64 BE').value).toBe('2020-09-13T12:26:40.000Z');
    const huge = inspectBytes([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 0);
    expect(row(huge, 'unix ms u64 BE').value).toBe('out of range');
  });

  it('respects the offset and empty input', () => {
    const rows = inspectBytes([1, 2, 3, 4], 2);
    expect(row(rows, 'uint8').value).toBe('3');
    const empty = inspectBytes([], 0);
    expect(row(empty, 'uint8').value).toBeNull();
    expect(row(empty, 'uint8').note).toContain('0 left');
  });
});

import { reverseBits, toggleFloatBit, floatNeighbors, evalExpression } from '../src/utils/bitConverter.js';

describe('polish additions', () => {
  it('reverseBits', () => {
    expect(reverseBits(0x01n, 8)).toBe(0x80n);
    expect(reverseBits(0x0Fn, 8)).toBe(0xF0n);
    expect(reverseBits(0x1n, 32)).toBe(0x80000000n);
  });
  it('toggleFloatBit flips sign and checks range', () => {
    expect(toggleFloatBit('single', 0x3F800000n, 31)).toBe(0xBF800000n);
    expect(() => toggleFloatBit('half', 0n, 16)).toThrow();
  });
  it('floatNeighbors', () => {
    expect(floatNeighbors('single', 0x3F800000n)).toEqual({ up: 0x3F800001n, down: 0x3F7FFFFFn });
    expect(floatNeighbors('single', 0xBF800000n)).toEqual({ up: 0xBF7FFFFFn, down: 0xBF800001n });
    expect(floatNeighbors('half', 0n)).toEqual({ up: 1n, down: 0x8001n });
    expect(floatNeighbors('half', 0x7C00n).up).toBe(null);
    expect(floatNeighbors('half', 0xFC00n).down).toBe(null);
    expect(floatNeighbors('half', 0x7E00n)).toEqual({ up: null, down: null });
  });
  it('evalExpression precedence and radix', () => {
    expect(evalExpression('1 + 2 * 3').value).toBe(7n);
    expect(evalExpression('(1 + 2) * 3').value).toBe(9n);
    expect(evalExpression('0xFF & ~0x0F').value).toBe(0xF0n);
    expect(evalExpression('1 << 4 | 0b11').value).toBe(19n);
    expect(evalExpression('-1', 8).value).toBe(255n);
    expect(evalExpression('-1', 8).signed).toBe(-1n);
    expect(evalExpression('0xFFFFFFFF + 1', 32).value).toBe(0n);
    expect(evalExpression('0xFFFFFFFF + 1', 32).wrapped).toBe(true);
    expect(evalExpression('-7 / 2').signed).toBe(-3n);
    expect(evalExpression('2 ^ 3 & 1').value).toBe(3n);
  });
  it('evalExpression errors', () => {
    expect(evalExpression('1 / 0').ok).toBe(false);
    expect(evalExpression('(1 + 2').ok).toBe(false);
    expect(evalExpression('1 +').ok).toBe(false);
    expect(evalExpression('1 2').ok).toBe(false);
    expect(evalExpression('1 $ 2').ok).toBe(false);
    expect(evalExpression('1 << 999').ok).toBe(false);
    expect(evalExpression('').ok).toBe(false);
  });
});
