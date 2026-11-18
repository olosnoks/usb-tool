import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  crc8, buildFrame, buildDevicePing, buildParamRead, buildParamWrite, createCrsfParser,
  decodeRcChannels, toMicroseconds, decodeLinkStatistics, decodeBattery, decodeGps,
  decodeAttitude, decodeFlightMode, decodeDeviceInfo, decodeTelemetry, decodeParamBody,
  decodeParamEntry, encodeParamValue, createParamClient, toHex, FRAME_TYPE, PARAM_TYPE,
} from '../src/utils/crsfProtocol.js';

// Independent bitwise reference for CRC-8 poly 0xD5 (no reflection, init 0, xorout 0).
function crcRef(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 0x80 ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

// Reference RC packer: 16 x 11-bit values, LSB-first bit stream.
function packRc(values) {
  const out = new Uint8Array(22);
  let bit = 0;
  for (const v of values) {
    for (let b = 0; b < 11; b++, bit++) {
      if ((v >> b) & 1) out[bit >> 3] |= 1 << (bit & 7);
    }
  }
  return out;
}

const be = (value, size, signed = true) => {
  const b = Buffer.alloc(size);
  if (size === 1) signed ? b.writeInt8(value) : b.writeUInt8(value);
  else if (size === 2) signed ? b.writeInt16BE(value) : b.writeUInt16BE(value);
  else if (size === 4) signed ? b.writeInt32BE(value) : b.writeUInt32BE(value);
  return b;
};

const cstr = (s) => Buffer.from(`${s}\0`, 'latin1');

/** Parse one frame out of built bytes using the streaming parser. */
function oneFrame(bytes) {
  const frames = createCrsfParser().push(bytes);
  expect(frames).toHaveLength(1);
  return frames[0];
}

describe('CRC-8 (poly 0xD5)', () => {
  it('matches the published CRC-8/DVB-S2 check value for "123456789"', () => {
    const ascii = Buffer.from('123456789', 'ascii');
    expect(crc8(ascii)).toBe(0xbc);
  });

  it('agrees with the bitwise reference on every single byte and on a sample', () => {
    for (let b = 0; b < 256; b++) expect(crc8([b])).toBe(crcRef([b]));
    const sample = [0x16, 0x00, 0xff, 0x80, 0x3e, 0x1f, 0x7c];
    expect(crc8(sample)).toBe(crcRef(sample));
  });
});

describe('frame building', () => {
  it('builds a device ping with the expected layout and CRC', () => {
    const f = buildDevicePing();
    // sync 0xEE (TX module), len 4 (type + 2 address bytes + crc), type 0x28, dest 0x00, origin 0xEA
    expect(f[0]).toBe(0xee);
    expect(f[1]).toBe(4);
    expect(Array.from(f.subarray(2, 5))).toEqual([0x28, 0x00, 0xea]);
    expect(f[5]).toBe(crcRef([0x28, 0x00, 0xea]));
    expect(f).toHaveLength(6);
  });

  it('builds a parameter read request', () => {
    const f = buildParamRead(0xee, 7, 2);
    expect(Array.from(f)).toEqual([0xee, 0x06, 0x2c, 0xee, 0xea, 0x07, 0x02, crcRef([0x2c, 0xee, 0xea, 0x07, 0x02])]);
  });

  it('builds a parameter write request with value bytes', () => {
    const f = buildParamWrite(0xee, 3, [0x00, 0x2a]);
    const body = [0x2d, 0xee, 0xea, 0x03, 0x00, 0x2a];
    expect(f[1]).toBe(body.length + 1);
    expect(Array.from(f.subarray(2, 2 + body.length))).toEqual(body);
    expect(f[f.length - 1]).toBe(crcRef(body));
  });

  it('refuses a frame that would exceed the length limit', () => {
    expect(() => buildFrame(0x2d, new Array(70).fill(0))).toThrow(RangeError);
  });
});

describe('streaming parser', () => {
  it('returns the same frame when bytes arrive one at a time', () => {
    const bytes = buildDevicePing();
    const parser = createCrsfParser();
    const out = [];
    for (const b of bytes) out.push(...parser.push(Uint8Array.of(b)));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe(0x28);
    expect(Array.from(out[0].payload)).toEqual([0x00, 0xea]);
    expect(Array.from(out[0].raw)).toEqual(Array.from(bytes));
    expect(parser.stats.frames).toBe(1);
  });

  it('skips leading garbage and resynchronises', () => {
    const parser = createCrsfParser();
    const junk = Uint8Array.of(0x00, 0x13, 0x77, 0x01);
    const frames = parser.push(new Uint8Array([...junk, ...buildDevicePing()]));
    expect(frames).toHaveLength(1);
    expect(parser.stats.skipped).toBeGreaterThan(0);
  });

  it('drops a frame with a bad CRC and still finds the next good one', () => {
    const good = buildDevicePing();
    const bad = Uint8Array.from(good);
    bad[bad.length - 1] ^= 0xff;
    const parser = createCrsfParser();
    const frames = parser.push(new Uint8Array([...bad, ...good]));
    expect(frames).toHaveLength(1);
    expect(parser.stats.badCrc).toBe(1);
  });

  it('waits for the rest of a split frame', () => {
    const bytes = buildParamRead(0xee, 1, 0);
    const parser = createCrsfParser();
    expect(parser.push(bytes.subarray(0, 4))).toHaveLength(0);
    expect(parser.push(bytes.subarray(4))).toHaveLength(1);
  });

  it('accepts all four CRSF sync bytes', () => {
    for (const sync of [0xc8, 0xea, 0xee, 0xec]) {
      const frames = createCrsfParser().push(buildFrame(0x21, Array.from(Buffer.from('ACRO\0')), sync));
      expect(frames[0].sync).toBe(sync);
    }
  });
});

describe('RC channels (0x16)', () => {
  it('unpacks all-ones to 2047 on every channel', () => {
    const rc = decodeRcChannels(new Uint8Array(22).fill(0xff));
    expect(rc.raw.every((v) => v === 2047)).toBe(true);
  });

  it('round-trips 16 arbitrary 11-bit values through an independent packer', () => {
    const values = [0, 1, 172, 992, 1811, 2047, 500, 1500 & 0x7ff, 3, 77, 1024, 1023, 640, 1400, 300, 1999 & 0x7ff];
    const rc = decodeRcChannels(packRc(values));
    expect(rc.raw).toEqual(values);
  });

  it('maps the centre and the end points to microseconds', () => {
    expect(toMicroseconds(992)).toBe(1500);
    expect(toMicroseconds(172)).toBe(988);
    expect(toMicroseconds(1811)).toBe(2012);
    const rc = decodeRcChannels(packRc(new Array(16).fill(992)));
    expect(rc.us.every((v) => v === 1500)).toBe(true);
  });

  it('returns null for a short payload', () => {
    expect(decodeRcChannels(new Uint8Array(21))).toBeNull();
  });
});

describe('telemetry decoders', () => {
  it('decodes link statistics (0x14)', () => {
    const ls = decodeLinkStatistics(Uint8Array.of(70, 72, 100, 0xf6, 1, 2, 4, 80, 99, 7));
    expect(ls).toEqual({
      upRssi1: -70, upRssi2: -72, upLq: 100, upSnr: -10, antenna: 1, rfMode: 2,
      upPowerIndex: 4, upPowerMw: 1000, downRssi: -80, downLq: 99, downSnr: 7,
    });
  });

  it('decodes battery (0x08)', () => {
    const b = decodeBattery(Uint8Array.of(0x00, 0xa8, 0x00, 0x7b, 0x00, 0x05, 0xdc, 75));
    expect(b).toEqual({ voltageV: 16.8, currentA: 12.3, capacityMah: 1500, remainingPct: 75 });
  });

  it('decodes GPS (0x02) including negative longitude', () => {
    const payload = Buffer.concat([be(377749000, 4), be(-1224194000, 4), be(523, 2, false), be(9050, 2, false), be(1000 + 245, 2, false), Buffer.from([12])]);
    const g = decodeGps(payload);
    expect(g.lat).toBeCloseTo(37.7749, 6);
    expect(g.lon).toBeCloseTo(-122.4194, 6);
    expect(g.groundspeedKmh).toBeCloseTo(52.3, 6);
    expect(g.headingDeg).toBeCloseTo(90.5, 6);
    expect(g.altitudeM).toBe(245);
    expect(g.satellites).toBe(12);
  });

  it('decodes attitude (0x1E) from 1/10000 rad', () => {
    const a = decodeAttitude(Buffer.concat([be(1000, 2), be(-1000, 2), be(0, 2)]));
    expect(a.pitchDeg).toBeCloseTo((0.1 * 180) / Math.PI, 9);
    expect(a.rollDeg).toBeCloseTo(-(0.1 * 180) / Math.PI, 9);
    expect(a.yawDeg).toBe(0);
  });

  it('decodes flight mode (0x21) text', () => {
    expect(decodeFlightMode(Buffer.from('ACRO\0', 'ascii'))).toBe('ACRO');
    expect(decodeFlightMode(Buffer.from('ANGLE', 'ascii'))).toBe('ANGLE');
  });

  it('decodes device info (0x29)', () => {
    const payload = Buffer.concat([
      Buffer.from([0xea, 0xee]), cstr('ELRS TX'), be(0x01020304, 4, false), be(0x0a0b0c0d, 4, false),
      be(0x11223344, 4, false), Buffer.from([40, 3]),
    ]);
    expect(decodeDeviceInfo(payload)).toEqual({
      dest: 0xea, address: 0xee, name: 'ELRS TX', serial: 0x01020304,
      hardwareId: 0x0a0b0c0d, firmwareId: 0x11223344, paramCount: 40, paramVersion: 3,
    });
  });

  it('returns null for truncated payloads instead of throwing', () => {
    expect(decodeBattery(Uint8Array.of(1, 2))).toBeNull();
    expect(decodeGps(Uint8Array.of(1))).toBeNull();
    expect(decodeLinkStatistics(new Uint8Array(3))).toBeNull();
  });

  it('dispatches a parsed frame by type', () => {
    const frame = oneFrame(buildFrame(FRAME_TYPE.FLIGHT_MODE, Array.from(cstr('HORIZON'))));
    expect(decodeTelemetry(frame)).toEqual({ kind: 'flightMode', data: 'HORIZON' });
    expect(decodeTelemetry(oneFrame(buildDevicePing()))).toBeNull();
  });
});

describe('parameter body decoding', () => {
  it('decodes a UINT8 with range, default and unit', () => {
    const body = Buffer.concat([Buffer.from([0, PARAM_TYPE.UINT8]), cstr('Rate'), Buffer.from([3, 0, 5, 1]), cstr('Hz')]);
    expect(decodeParamBody(body)).toMatchObject({
      name: 'Rate', type: 0, typeName: 'UINT8', hidden: false, value: 3, min: 0, max: 5, default: 1, unit: 'Hz', writable: true,
    });
  });

  it('reads the hidden flag from bit 7 of the type byte', () => {
    const body = Buffer.concat([Buffer.from([4, 0x80 | PARAM_TYPE.INT8]), cstr('Offset'), be(-3, 1), be(-10, 1), be(10, 1), be(0, 1), cstr('')]);
    const p = decodeParamBody(body);
    expect(p.hidden).toBe(true);
    expect(p.type).toBe(PARAM_TYPE.INT8);
    expect(p.value).toBe(-3);
    expect(p.min).toBe(-10);
  });

  it('decodes an INT16 and a UINT32 with big-endian values', () => {
    const i16 = decodeParamBody(Buffer.concat([Buffer.from([0, PARAM_TYPE.INT16]), cstr('Trim'), be(-300, 2), be(-500, 2), be(500, 2), be(0, 2), cstr('us')]));
    expect(i16.value).toBe(-300);
    const u32 = decodeParamBody(Buffer.concat([Buffer.from([0, PARAM_TYPE.UINT32]), cstr('Count'), be(70000, 4, false), be(0, 4, false), be(100000, 4, false), be(1, 4, false), cstr('')]));
    expect(u32.value).toBe(70000);
    expect(u32.max).toBe(100000);
  });

  it('decodes a FLOAT scaled by its decimal places', () => {
    const body = Buffer.concat([
      Buffer.from([0, PARAM_TYPE.FLOAT]), cstr('Power'),
      be(25, 4), be(0, 4), be(100, 4), be(10, 4), Buffer.from([1]), be(1, 4), cstr('W'),
    ]);
    const p = decodeParamBody(body);
    expect(p.value).toBeCloseTo(2.5, 9);
    expect(p.min).toBe(0);
    expect(p.max).toBeCloseTo(10, 9);
    expect(p.decimals).toBe(1);
    expect(p.unit).toBe('W');
  });

  it('decodes a text selection into its options', () => {
    const body = Buffer.concat([Buffer.from([2, PARAM_TYPE.TEXT_SELECTION]), cstr('Mode'), cstr('Off;On;Auto'), Buffer.from([1, 0, 2, 0]), cstr('')]);
    const p = decodeParamBody(body);
    expect(p.options).toEqual(['Off', 'On', 'Auto']);
    expect(p.value).toBe(1);
    expect(p.writable).toBe(true);
  });

  it('decodes folders, info, commands and strings', () => {
    const folder = decodeParamBody(Buffer.concat([Buffer.from([0, PARAM_TYPE.FOLDER]), cstr('Bind'), Buffer.from([5, 6, 7, 0xff])]));
    expect(folder.children).toEqual([5, 6, 7]);
    expect(folder.writable).toBe(false);

    const info = decodeParamBody(Buffer.concat([Buffer.from([0, PARAM_TYPE.INFO]), cstr('Version'), cstr('1.2.3')]));
    expect(info.value).toBe('1.2.3');

    const cmd = decodeParamBody(Buffer.concat([Buffer.from([0, PARAM_TYPE.COMMAND]), cstr('Bind'), Buffer.from([0, 200]), cstr('Ready')]));
    expect(cmd).toMatchObject({ status: 0, timeout: 200, info: 'Ready', writable: true });

    const str = decodeParamBody(Buffer.concat([Buffer.from([0, PARAM_TYPE.STRING]), cstr('Name'), cstr('TX1')]));
    expect(str.value).toBe('TX1');
    expect(str.writable).toBe(false);
  });

  it('keeps raw bytes for a type it does not decode', () => {
    const p = decodeParamBody(Buffer.concat([Buffer.from([0, PARAM_TYPE.UINT64]), cstr('Big'), Buffer.from([1, 2])]));
    expect(p.raw).toEqual([1, 2]);
    expect(p.writable).toBe(false);
  });

  it('throws on a truncated body', () => {
    expect(() => decodeParamBody(Buffer.from([0, 0, 0x52]))).toThrow(RangeError);
  });

  it('splits a parameter entry frame into its header and data', () => {
    const e = decodeParamEntry(Uint8Array.of(0xea, 0xee, 9, 1, 0xaa, 0xbb));
    expect(e).toEqual({ dest: 0xea, origin: 0xee, paramNum: 9, chunksRemaining: 1, data: Uint8Array.of(0xaa, 0xbb) });
    expect(decodeParamEntry(Uint8Array.of(1, 2))).toBeNull();
  });
});

describe('parameter value encoding', () => {
  const uint8 = { type: PARAM_TYPE.UINT8, typeName: 'UINT8', writable: true, min: 0, max: 5 };
  const int16 = { type: PARAM_TYPE.INT16, typeName: 'INT16', writable: true, min: -500, max: 500 };
  const flt = { type: PARAM_TYPE.FLOAT, typeName: 'FLOAT', writable: true, decimals: 1, min: 0, max: 10, rawMin: 0, rawMax: 100 };
  const sel = { type: PARAM_TYPE.TEXT_SELECTION, typeName: 'TEXT SELECT', writable: true, min: 0, max: 2 };

  it('encodes integers and refuses out-of-range values', () => {
    expect(encodeParamValue(uint8, 4)).toEqual([4]);
    expect(() => encodeParamValue(uint8, 6)).toThrow(/between 0 and 5/);
    expect(() => encodeParamValue(uint8, 1.5)).toThrow(/whole number/);
  });

  it('encodes negative INT16 as two-complement big-endian', () => {
    expect(encodeParamValue(int16, -2)).toEqual([0xff, 0xfe]);
    expect(encodeParamValue(int16, 300)).toEqual([0x01, 0x2c]);
  });

  it('encodes a FLOAT as a scaled int32', () => {
    expect(encodeParamValue(flt, 2.5)).toEqual([0, 0, 0, 25]);
    expect(() => encodeParamValue(flt, 10.5)).toThrow();
  });

  it('encodes a text selection index and refuses non-writable types', () => {
    expect(encodeParamValue(sel, 2)).toEqual([2]);
    expect(() => encodeParamValue(sel, 3)).toThrow();
    expect(() => encodeParamValue({ typeName: 'STRING', writable: false }, 'x')).toThrow(/not writable/);
  });
});

describe('parameter client', () => {
  afterEach(() => { vi.useRealTimers(); });

  const entry = (paramNum, remaining, data, origin = 0xee) =>
    createCrsfParser().push(buildFrame(FRAME_TYPE.PARAMETER_SETTINGS_ENTRY, [0xea, origin, paramNum, remaining, ...data], 0xee))[0];

  it('assembles a multi-chunk parameter and resolves with the decoded value', async () => {
    const body = Buffer.concat([Buffer.from([0, PARAM_TYPE.UINT8]), cstr('Rate'), Buffer.from([3, 0, 5, 1]), cstr('Hz')]);
    const send = vi.fn();
    const client = createParamClient({ send, dest: 0xee, timeoutMs: 100, retries: 1 });
    const promise = client.readParam(9);
    expect(Array.from(send.mock.calls[0][0])).toEqual(Array.from(buildParamRead(0xee, 9, 0)));

    expect(client.feed(entry(9, 1, body.subarray(0, 5)))).toBe(true);
    expect(Array.from(send.mock.calls[1][0])).toEqual(Array.from(buildParamRead(0xee, 9, 1)));

    expect(client.feed(entry(9, 0, body.subarray(5)))).toBe(true);
    const p = await promise;
    expect(p).toMatchObject({ paramNum: 9, name: 'Rate', value: 3, unit: 'Hz', device: 0xee });
    expect(client.busy).toBe(false);
  });

  it('ignores entries from another device or for a parameter that was not requested', () => {
    const body = Buffer.from([0, PARAM_TYPE.INFO, 0x41, 0, 0x42, 0]);
    const client = createParamClient({ send: vi.fn(), dest: 0xee, timeoutMs: 100 });
    client.readParam(2).catch(() => {});
    expect(client.feed(entry(2, 0, body, 0xc8))).toBe(false);
    expect(client.feed(entry(5, 0, body))).toBe(false);
    client.reset();
  });

  it('retries on timeout and rejects once the retries are used up', async () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const client = createParamClient({ send, dest: 0xee, timeoutMs: 100, retries: 1 });
    const result = client.readParam(4).then(() => 'resolved', (err) => err.message);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(100);
    expect(await result).toMatch(/No response for parameter 4 after 2 attempts/);
  });

  it('writes a value and reads it back', async () => {
    const body = Buffer.concat([Buffer.from([0, PARAM_TYPE.UINT8]), cstr('Rate'), Buffer.from([2, 0, 5, 1]), cstr('Hz')]);
    const send = vi.fn();
    const client = createParamClient({ send, dest: 0xee, timeoutMs: 100, retries: 0 });
    const param = { paramNum: 9, type: PARAM_TYPE.UINT8, typeName: 'UINT8', writable: true, min: 0, max: 5 };
    const promise = client.writeParam(param, 2);
    expect(Array.from(send.mock.calls[0][0])).toEqual(Array.from(buildParamWrite(0xee, 9, [2])));
    expect(Array.from(send.mock.calls[1][0])).toEqual(Array.from(buildParamRead(0xee, 9, 0)));
    client.feed(entry(9, 0, body));
    expect((await promise).value).toBe(2);
  });

  it('rejects an invalid parameter number without sending anything', async () => {
    const send = vi.fn();
    const client = createParamClient({ send, dest: 0xee });
    await expect(client.readParam(0)).rejects.toThrow(/1\.\.255/);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects outstanding reads on reset', async () => {
    const client = createParamClient({ send: vi.fn(), dest: 0xee, timeoutMs: 1000 });
    const promise = client.readParam(1);
    client.reset('Port closed.');
    await expect(promise).rejects.toThrow('Port closed.');
  });
});

describe('helpers', () => {
  it('formats hex bytes', () => {
    expect(toHex(Uint8Array.of(0xc8, 0x0a, 0xff))).toBe('C8 0A FF');
  });
});
