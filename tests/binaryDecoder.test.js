import { describe, it, expect } from 'vitest';
import {
  decodeAs, detectFormats, detectTextEncodings, resolveInput, encodeJson, parseHex, toHex,
  cobsEncode, cobsDecode, cobsrEncode, cobsrDecode, slipEncode, slipSplit, hdlcEncode, hdlcSplit, splitFrames,
} from '../src/utils/binaryDecoder.js';
import { decodeProtobuf } from '../src/utils/binaryDecoder/protobuf.js';
import { decodeCbor, encodeCbor } from '../src/utils/binaryDecoder/cbor.js';
import { decodeMsgpack, encodeMsgpack } from '../src/utils/binaryDecoder/msgpack.js';
import { decodeBson } from '../src/utils/binaryDecoder/bson.js';

const H = parseHex;

/** Deterministic pseudo-random bytes (xorshift); zeroEvery > 0 puts a zero every N bytes. */
function prng(seed, n, zeroEvery = 0) {
  let x = seed >>> 0 || 1;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    out[i] = zeroEvery && i % zeroEvery === 0 ? 0 : (x & 0xff);
  }
  return out;
}

describe('protobuf raw decoder', () => {
  it('decodes 08 96 01 as field 1 = 150', () => {
    const r = decodeProtobuf(H('089601'));
    expect(r.root.children).toHaveLength(1);
    const f = r.root.children[0];
    expect(f.label).toBe('1');
    expect(f.type).toBe('varint');
    expect(f.value).toContain('uint 150');
    expect(f.value).toContain('sint 75');
    expect(f.offset).toBe(0);
    expect(f.length).toBe(3);
  });

  it('shows zigzag sint and bool for varints', () => {
    const f = decodeProtobuf(H('0801')).root.children[0];
    expect(f.value).toContain('sint -1');
    expect(f.value).toContain('bool true');
  });

  it('treats printable length-delimited data as a string', () => {
    const hex = `1207${toHex(new TextEncoder().encode('testing'))}`;
    const f = decodeProtobuf(H(hex)).root.children[0];
    expect(f.type).toBe('string');
    expect(f.value).toBe('string "testing"');
    expect(f.meta.options).toContain('string');
    expect(f.meta.options).not.toContain('message');
  });

  it('parses nested messages with absolute offsets', () => {
    const f = decodeProtobuf(H('1a03089601')).root.children[0];
    expect(f.type).toBe('message');
    expect(f.children[0].label).toBe('1');
    expect(f.children[0].value).toContain('uint 150');
    expect(f.children[0].offset).toBe(2);
  });

  it('decodes deprecated groups', () => {
    const f = decodeProtobuf(H('0b0896010c')).root.children[0];
    expect(f.type).toBe('group');
    expect(f.children[0].label).toBe('1');
    expect(f.children[0].value).toContain('uint 150');
    expect(f.length).toBe(5);
  });

  it('shows packed varints as packed when the bytes are not a valid message', () => {
    const f = decodeProtobuf(H('2206038e029ea705')).root.children[0];
    expect(f.type).toBe('packed');
    expect(f.children.map((c) => c.value.split(' ')[1])).toEqual(['3', '270', '86942']);
    expect(f.meta.options).toContain('packed');
  });

  it('lets the caller override a length-delimited interpretation by offset', () => {
    const bytes = H('1203089601');
    const auto = decodeProtobuf(bytes).root.children[0];
    expect(auto.type).toBe('message');
    const bytesMode = decodeProtobuf(bytes, { overrides: { 0: 'bytes' } }).root.children[0];
    expect(bytesMode.type).toBe('bytes');
    expect(bytesMode.value).toContain('bytes[3]');
  });

  it('decodes fixed32 as float and fixed64 as double', () => {
    expect(decodeProtobuf(H('1d0000803f')).root.children[0].value).toContain('float 1');
    expect(decodeProtobuf(H('21000000000000f03f')).root.children[0].value).toContain('double 1');
  });

  it('reports truncation and invalid field numbers', () => {
    expect(() => decodeProtobuf(H('08'))).toThrow(/truncated varint/);
    expect(() => decodeProtobuf(H('0001'))).toThrow(/invalid field number 0/);
    expect(() => decodeProtobuf(H('0a05aa'))).toThrow(/exceeds/);
  });
});

describe('CBOR decoder (RFC 8949 appendix A vectors)', () => {
  const vectors = [
    ['00', '0'], ['01', '1'], ['0a', '10'], ['17', '23'], ['1818', '24'], ['1864', '100'],
    ['1903e8', '1000'], ['1a000f4240', '1000000'], ['1b000000e8d4a51000', '1000000000000'],
    ['1bffffffffffffffff', '18446744073709551615'], ['c249010000000000000000', "2(h'010000000000000000')"],
    ['3bffffffffffffffff', '-18446744073709551616'], ['c349010000000000000000', "3(h'010000000000000000')"],
    ['20', '-1'], ['29', '-10'], ['3863', '-100'], ['3903e7', '-1000'],
    ['f90000', '0.0'], ['f98000', '-0.0'], ['f93c00', '1.0'], ['fb3ff199999999999a', '1.1'],
    ['f93e00', '1.5'], ['f97bff', '65504.0'], ['fa47c35000', '100000.0'], ['fa7f800000', 'Infinity'],
    ['f97c00', 'Infinity'], ['f9fc00', '-Infinity'], ['fa7fc00000', 'NaN'], ['f97e00', 'NaN'],
    ['fb7e37e43c8800759c', '1.0e+300'], ['f90001', '5.960464477539063e-8'],
    ['f4', 'false'], ['f5', 'true'], ['f6', 'null'], ['f7', 'undefined'],
    ['f0', 'simple(16)'], ['f820', 'simple(32)'], ['f8ff', 'simple(255)'],
    ['c11a514b67b0', '1(1363896240)'], ['c1fb41d452d9ec200000', '1(1363896240.5)'],
    ['d74401020304', "23(h'01020304')"], ['d818456449455446', "24(h'6449455446')"],
    ['40', "h''"], ['4401020304', "h'01020304'"],
    ['60', '""'], ['6161', '"a"'], ['6449455446', '"IETF"'], ['62225c', '"\\"\\\\"'], ['63e6b0b4', '"水"'],
    ['80', '[]'], ['83010203', '[1, 2, 3]'], ['8301820203820405', '[1, [2, 3], [4, 5]]'],
    ['a0', '{}'], ['a201020304', '{1: 2, 3: 4}'], ['a26161016162820203', '{"a": 1, "b": [2, 3]}'],
    ['826161a161626163', '["a", {"b": "c"}]'],
    ['a5' + '6161' + '6141' + '6162' + '6142' + '6163' + '6143' + '6164' + '6144' + '6165' + '6145',
      '{"a": "A", "b": "B", "c": "C", "d": "D", "e": "E"}'],
    ['5f42010243030405ff', "(_ h'0102', h'030405')"],
    ['7f657374726561646d696e67ff', '(_ "strea", "ming")'],
    ['9fff', '[_ ]'], ['9f0102ff', '[_ 1, 2]'], ['9f018202039f0405ffff', '[_ 1, [2, 3], [_ 4, 5]]'],
    ['bf61610161629f0203ffff', '{_ "a": 1, "b": [_ 2, 3]}'],
    ['d9d9f700', '55799(0)'],
  ];
  for (const [hex, diag] of vectors) {
    it(`${hex} -> ${diag}`, () => {
      expect(decodeCbor(H(hex)).root.value).toBe(diag);
    });
  }

  it('gives bignums as BigInt values', () => {
    expect(decodeCbor(H('c249010000000000000000')).value).toBe(18446744073709551616n);
    expect(decodeCbor(H('c349010000000000000000')).value).toBe(-18446744073709551617n);
  });

  it('marks embedded CBOR (tag 24) with a decoded child at the right offset', () => {
    const r = decodeCbor(H('d8184101'));
    expect(r.root.type).toBe('embedded');
    expect(r.root.children[0].value).toBe('1');
    expect(r.root.children[0].offset).toBe(3);
  });

  it('exports JSON that encodes back to the same bytes', () => {
    const bytes = H('a26161016162d8184401020304');
    const r = decodeAs(bytes, 'cbor');
    expect(r.json.a).toBe(1);
    expect(r.json.b).toEqual({ $tag: 24, $value: { $hex: '01020304' } });
    expect(toHex(encodeCbor(r.json))).toBe('a26161016162d8184401020304');
  });

  it('reports malformed input', () => {
    expect(() => decodeCbor(H('1c'))).toThrow(/reserved additional information 28/);
    expect(() => decodeCbor(H('1f'))).toThrow(/indefinite length not allowed/);
    expect(() => decodeCbor(H('ff'))).toThrow(/unexpected break/);
    expect(() => decodeCbor(H('61ff'))).toThrow(/UTF-8/);
    expect(() => decodeCbor(H('1a0001'))).toThrow(/truncated/);
    expect(() => decodeCbor(H('f81f'))).toThrow(/simple value 31/);
  });

  it('encodes preferred serialization matching the appendix', () => {
    expect(toHex(encodeCbor(1))).toBe('01');
    expect(toHex(encodeCbor(-1))).toBe('20');
    expect(toHex(encodeCbor(1000000))).toBe('1a000f4240');
    expect(toHex(encodeCbor('IETF'))).toBe('6449455446');
    expect(toHex(encodeCbor([1, 2, 3]))).toBe('83010203');
    expect(toHex(encodeCbor({ a: 1 }))).toBe('a1616101');
    expect(toHex(encodeCbor(1.5))).toBe('f93e00');
    expect(toHex(encodeCbor(1.1))).toBe('fb3ff199999999999a');
    expect(toHex(encodeCbor({ $hex: '0102' }))).toBe('420102');
    expect(toHex(encodeCbor({ $int: '18446744073709551616' }))).toBe('c249010000000000000000');
    expect(toHex(encodeCbor({ $tag: 1, $value: 1363896240 }))).toBe('c11a514b67b0');
    expect(toHex(encodeCbor(null))).toBe('f6');
    expect(toHex(encodeCbor({ $simple: 16 }))).toBe('f0');
  });

  it('round-trips a nested structure through encode and decode', () => {
    const v = { name: 'probe', list: [1, -5, 2.5, true, null], raw: { $hex: 'deadbeef' }, big: { $int: '-18446744073709551617' } };
    expect(decodeAs(encodeCbor(v), 'cbor').json).toEqual(v);
  });
});

describe('MessagePack decoder and encoder', () => {
  const vectors = [
    ['00', '0'], ['7f', '127'], ['e0', '-32'], ['cc80', '128'], ['cd0100', '256'], ['ce00010000', '65536'],
    ['cfffffffffffffffff', '18446744073709551615'], ['d080', '-128'], ['d18000', '-32768'],
    ['d280000000', '-2147483648'], ['d38000000000000000', '-9223372036854775808'],
    ['c0', 'nil'], ['c2', 'false'], ['c3', 'true'],
  ];
  for (const [hex, diag] of vectors) {
    it(`${hex} -> ${diag}`, () => {
      expect(decodeMsgpack(H(hex)).root.value).toBe(diag);
    });
  }

  it('decodes strings, arrays, maps, bin and floats', () => {
    expect(decodeMsgpack(H('a3616263')).value).toBe('abc');
    expect(decodeMsgpack(H('d903616263')).value).toBe('abc');
    expect(decodeMsgpack(H('93010203')).value).toEqual([1, 2, 3]);
    expect(decodeMsgpack(H('82a16101a16202')).value).toEqual({ a: 1, b: 2 });
    expect(decodeMsgpack(H('ca3f800000')).value).toBe(1);
    expect(decodeMsgpack(H('cb3ff199999999999a')).value).toBe(1.1);
    expect(decodeMsgpack(H('c403010203')).value).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('decodes ext values and the timestamp extension (-1)', () => {
    expect(decodeMsgpack(H('d405ff')).root.value).toBe("ext 5 h'ff'");
    expect(decodeMsgpack(H('d405ff')).value).toEqual({ $ext: 5, $hex: 'ff' });
    expect(decodeMsgpack(H('d6ff00000001')).root.value).toBe('timestamp 1970-01-01T00:00:01.000Z');
    expect(decodeMsgpack(H(`d7ff${'0000000000000001'}`)).root.value).toBe('timestamp 1970-01-01T00:00:01.000Z');
    expect(decodeMsgpack(H(`c70cff${'1dcd6500'}${'0000000000000001'}`)).root.value).toBe('timestamp 1970-01-01T00:00:01.500Z');
  });

  it('reports errors', () => {
    expect(() => decodeMsgpack(H('c1'))).toThrow(/never used/);
    expect(() => decodeMsgpack(H('a261'))).toThrow(/exceeds/);
  });

  it('encodes minimal forms', () => {
    expect(toHex(encodeMsgpack({ a: 1, b: [2, 3] }))).toBe('82a16101a162920203');
    expect(toHex(encodeMsgpack(300))).toBe('cd012c');
    expect(toHex(encodeMsgpack(-200))).toBe('d1ff38');
    expect(toHex(encodeMsgpack({ $ext: 5, $hex: '0102' }))).toBe('d5050102');
    expect(toHex(encodeMsgpack({ $ext: 5, $hex: '010203' }))).toBe('c70305010203');
    expect(() => encodeMsgpack({ $tag: 1, $value: 2 })).toThrow(/no tags/);
  });

  it('round-trips through encode and decode', () => {
    const v = { s: 'héllo', n: [1, -2, 3.5, null, false], b: { $hex: '00ff' } };
    expect(decodeAs(encodeMsgpack(v), 'msgpack').json).toEqual(v);
  });
});

describe('BSON decoder', () => {
  it('decodes the spec hello/world example', () => {
    const r = decodeBson(H('16000000' + '02' + '68656c6c6f00' + '06000000' + '776f726c6400' + '00'));
    expect(r.value).toEqual({ hello: 'world' });
    expect(r.root.children[0].type).toBe('string');
    expect(r.root.children[0].offset).toBe(4);
  });

  it('decodes int32 and double elements', () => {
    expect(decodeBson(H('0c000000' + '10' + '6100' + '01000000' + '00')).value).toEqual({ a: 1 });
    expect(decodeBson(H('10000000' + '01' + '7800' + '000000000000f03f' + '00')).value).toEqual({ x: 1 });
  });

  it('rejects a bad length prefix and trailing bytes', () => {
    expect(() => decodeBson(H('0b000000' + '10' + '6100' + '01000000' + '00'))).toThrow();
    expect(() => decodeBson(H('0c000000' + '10' + '6100' + '01000000' + '00' + '00'))).toThrow(/trailing/);
  });
});

describe('framing: COBS and COBS/R', () => {
  const cases = [
    ['', '01'],
    ['00', '0101'],
    ['0000', '010101'],
    ['11220033', '0311220233'],
    ['11223344', '0511223344'],
    ['11000000', '0211010101'],
  ];
  for (const [input, enc] of cases) {
    it(`COBS ${input || '(empty)'} -> ${enc}`, () => {
      expect(toHex(cobsEncode(H(input)))).toBe(enc);
      expect(toHex(cobsDecode(H(enc)))).toBe(input);
    });
  }

  it('encodes a 254-byte nonzero block with the FF code', () => {
    const data = Uint8Array.from({ length: 254 }, (_, i) => i + 1);
    const enc = cobsEncode(data);
    expect(enc[0]).toBe(0xff);
    expect(enc.length).toBe(256);
    expect(cobsDecode(enc)).toEqual(data);
  });

  it('round-trips random data with zeros for COBS and COBS/R', () => {
    for (const [seed, n, z] of [[1, 1, 0], [7, 50, 3], [9, 253, 0], [11, 254, 0], [13, 255, 5], [17, 1000, 7], [19, 600, 2]]) {
      const data = prng(seed, n, z);
      expect(cobsDecode(cobsEncode(data))).toEqual(data);
      expect(cobsrDecode(cobsrEncode(data))).toEqual(data);
    }
  });

  it('COBS/R matches the worked example from the COBS/R description', () => {
    const input = H('2fa200927326');
    expect(toHex(cobsEncode(input))).toBe('032fa204927326');
    expect(toHex(cobsrEncode(input))).toBe('032fa2269273');
    expect(cobsrDecode(H('032fa2269273'))).toEqual(input);
    const input2 = H('2fa200927302');
    expect(toHex(cobsrEncode(input2))).toBe('032fa204927302');
  });

  it('COBS/R equals COBS for inputs ending in zero', () => {
    expect(toHex(cobsrEncode(H('00')))).toBe('0101');
    expect(toHex(cobsrEncode(H('11000000')))).toBe(toHex(cobsEncode(H('11000000'))));
  });

  it('COBS/R saves the final byte when the last data byte is large', () => {
    expect(toHex(cobsrEncode(H('11223344')))).toBe('44112233');
    expect(cobsrDecode(H('44112233'))).toEqual(H('11223344'));
    expect(cobsrDecode(H('03112233'))).toEqual(H('11220033'));
  });

  it('rejects zero bytes inside a frame and truncated blocks', () => {
    expect(() => cobsDecode(H('0105'))).toThrow();
    expect(() => cobsDecode(H('0301'))).toThrow(/truncated|zero/);
  });
});

describe('framing: SLIP and HDLC', () => {
  it('encodes SLIP with END/ESC escapes', () => {
    expect(toHex(slipEncode(H('01c0db02')))).toBe('c001dbdcdbdd02c0');
  });

  it('splits a SLIP stream into frames and reports bad escapes', () => {
    const f = slipSplit(H('c001dbdcdbdd02c0c003c0'));
    expect(f.map((x) => toHex(x.payload))).toEqual(['01c0db02', '03']);
    const bad = slipSplit(H('c0db00c0'));
    expect(bad[0].error).toMatch(/invalid escape/);
  });

  it('encodes and splits HDLC-style frames', () => {
    expect(toHex(hdlcEncode(H('017e027d')))).toBe('7e017d5e027d5d7e');
    const f = hdlcSplit(H('7e017d5e027e7e037e'));
    expect(f.map((x) => toHex(x.payload))).toEqual(['017e02', '03']);
  });

  it('splitFrames splits COBS streams on zero delimiters and decodes each run', () => {
    const f = splitFrames(H('0311220233' + '00' + '0101' + '00'), 'cobs');
    expect(f).toHaveLength(2);
    expect(toHex(f[0].payload)).toBe('11220033');
    expect(toHex(f[1].payload)).toBe('00');
  });
});

describe('detection and input handling', () => {
  it('finds hex, base64 and base32 candidates', () => {
    expect(detectTextEncodings('089601')[0].encoding).toBe('hex');
    expect(detectTextEncodings('SGVsbG8gd29ybGQ=')[0].encoding).toBe('base64');
    expect(detectTextEncodings('JBSWY3DPEBLW64TMMQ======').some((c) => c.encoding === 'base32')).toBe(true);
  });

  it('auto-unwraps confident base64 but keeps plain words as text', () => {
    const r = resolveInput({ text: 'SGVsbG8gd29ybGQ=', encoding: 'auto' });
    expect(r.encoding).toBe('base64');
    expect(new TextDecoder().decode(r.bytes)).toBe('Hello world');
    expect(resolveInput({ text: 'test' }).encoding).toBe('raw');
  });

  it('forces an encoding when asked', () => {
    expect(toHex(resolveInput({ text: '0x08 96 01', encoding: 'hex' }).bytes)).toBe('089601');
    expect(() => resolveInput({ text: 'zz', encoding: 'hex' })).toThrow();
  });

  it('detects the format of known payloads', () => {
    expect(detectFormats(H('089601'))[0].format).toBe('protobuf');
    expect(detectFormats(H('16000000' + '02' + '68656c6c6f00' + '06000000' + '776f726c6400' + '00'))[0].format).toBe('bson');
    expect(detectFormats(H('c249010000000000000000'))[0].format).toBe('cbor');
  });

  it('encodes JSON with a decode check', () => {
    const r = encodeJson('{"a":1,"b":"x"}', 'msgpack');
    expect(r.hex).toBe('82a16101a162a178');
    expect(r.roundTrip.json).toEqual({ a: 1, b: 'x' });
    expect(() => encodeJson('{bad', 'cbor')).toThrow(/not valid/);
  });
});
