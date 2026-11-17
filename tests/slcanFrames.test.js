import { describe, it, expect } from 'vitest';
import {
  CAN_FD_DATA_RATES, parseSlcanFrame, buildSlcanFrame, SlcanLineReader, buildSlcanOpenSequence, createSlcanClock,
  autoDetectBitrate, isSlcanError, COMMON_DTCS, CAN_FD_LENGTHS
} from '../src/utils/canBusDriver';

const noNaN = (f) => Array.from(f.data).every((b) => Number.isInteger(b) && b >= 0 && b <= 255);

describe('parseSlcanFrame: valid lines', () => {
  const valid = [
    ['t12381122334455667788', { id: 0x123, isExtended: false, dlc: 8, rtr: false, fd: false, brs: false, timestamp: null, bytes: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88] }],
    ['t7DF0', { id: 0x7df, isExtended: false, dlc: 0, rtr: false, fd: false, brs: false, timestamp: null, bytes: [] }],
    ['T18DAF11081122334455667788', { id: 0x18daf110, isExtended: true, dlc: 8, rtr: false, fd: false, brs: false, timestamp: null, bytes: [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88] }],
    ['T18FEF1000', { id: 0x18fef100, isExtended: true, dlc: 0, rtr: false, fd: false, brs: false, timestamp: null, bytes: [] }],
    ['r1238', { id: 0x123, isExtended: false, dlc: 8, rtr: true, fd: false, brs: false, timestamp: null, bytes: [] }],
    ['R18DAF1103', { id: 0x18daf110, isExtended: true, dlc: 3, rtr: true, fd: false, brs: false, timestamp: null, bytes: [] }],
    ['d1232AABB', { id: 0x123, isExtended: false, dlc: 2, rtr: false, fd: true, brs: false, timestamp: null, bytes: [0xaa, 0xbb] }],
    ['b1239' + '00'.repeat(12), { id: 0x123, isExtended: false, dlc: 12, rtr: false, fd: true, brs: true, timestamp: null, bytes: Array(12).fill(0) }],
    ['D18DAF110F' + 'AB'.repeat(64), { id: 0x18daf110, isExtended: true, dlc: 64, rtr: false, fd: true, brs: false, timestamp: null, bytes: Array(64).fill(0xab) }],
    ['B18DAF110D' + '01'.repeat(32), { id: 0x18daf110, isExtended: true, dlc: 32, rtr: false, fd: true, brs: true, timestamp: null, bytes: Array(32).fill(1) }],
    ['t1232AABB1234', { id: 0x123, isExtended: false, dlc: 2, rtr: false, fd: false, brs: false, timestamp: 0x1234, bytes: [0xaa, 0xbb] }],
    ['r1230EA5F', { id: 0x123, isExtended: false, dlc: 0, rtr: true, fd: false, brs: false, timestamp: 0xea5f, bytes: [] }],
    ['t1232aabb\r', { id: 0x123, isExtended: false, dlc: 2, rtr: false, fd: false, brs: false, timestamp: null, bytes: [0xaa, 0xbb] }]
  ];
  it.each(valid)('%s', (line, want) => {
    const f = parseSlcanFrame(line);
    expect(f).not.toBeNull();
    expect(f).toMatchObject({ id: want.id, isExtended: want.isExtended, dlc: want.dlc, rtr: want.rtr, fd: want.fd, brs: want.brs, timestamp: want.timestamp });
    expect(Array.from(f.data)).toEqual(want.bytes);
    expect(noNaN(f)).toBe(true);
  });
});

describe('parseSlcanFrame: invalid lines return null, never NaN data', () => {
  const invalid = [
    ['', 'empty'],
    ['t', 'type only'],
    ['t123', 'no DLC'],
    ['t1239' + '00'.repeat(9), 'classic DLC 9'],
    ['t123A' + '00'.repeat(10), 'classic DLC hex letter'],
    ['t1232AAB', 'odd hex length'],
    ['t1232AA', 'short data'],
    ['t1232AABBC', 'one stray character after data'],
    ['t1232AABBCCDDEE', 'surplus data / bad timestamp length'],
    ['t1232AAXX', 'non-hex data'],
    ['t12G2AABB', 'non-hex id'],
    ['T18DAF1108112233', 'short extended frame'],
    ['TZZDAF110011', 'non-hex extended id'],
    ['r1239', 'RTR DLC 9'],
    ['r1232AA', 'RTR with data'],
    ['d1233AABB', 'FD short data'],
    ['bX23002', 'bad id'],
    ['b1239' + '00'.repeat(11), 'FD DLC 9 needs 12 bytes'],
    ['z', 'adapter ack'],
    ['\x07', 'bell'],
    ['O', 'plain command echo'],
    ['t1232AABB12', 'timestamp too short'],
    ['t1232AABB12ZZ', 'timestamp not hex']
  ];
  it.each(invalid)('%j (%s)', (line) => {
    expect(parseSlcanFrame(line)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseSlcanFrame(null)).toBeNull();
    expect(parseSlcanFrame(undefined)).toBeNull();
    expect(parseSlcanFrame(42)).toBeNull();
  });

  it('a malformed line never yields a frame with NaN or zero-filled bytes', () => {
    for (const line of ['t123' + '8' + 'ZZZZZZZZZZZZZZZZ', 't1238112233', 'T12345678' + '2' + 'GG11']) {
      const f = parseSlcanFrame(line);
      expect(f).toBeNull();
    }
  });
});

describe('buildSlcanFrame', () => {
  it('builds classic data frames', () => {
    expect(buildSlcanFrame(0x123, [0x11, 0x22])).toBe('t123211' + '22\r');
    expect(buildSlcanFrame(0x18daf110, [1], true)).toBe('T18DAF110101\r');
    expect(buildSlcanFrame(0x7df, [])).toBe('t7DF0\r');
  });

  it('builds RTR frames with the requested length', () => {
    expect(buildSlcanFrame(0x123, [], false, { rtr: true, dlc: 4 })).toBe('r1234\r');
    expect(buildSlcanFrame(0x18daf110, [], true, { rtr: true, dlc: 8 })).toBe('R18DAF1108\r');
    expect(() => buildSlcanFrame(0x123, [], false, { rtr: true, dlc: 9 })).toThrow(RangeError);
  });

  it('builds CAN FD frames with and without BRS and maps length to DLC code', () => {
    const d = buildSlcanFrame(0x123, new Uint8Array(12), false, { fd: true });
    expect(d).toBe('d1239' + '00'.repeat(12) + '\r');
    expect(buildSlcanFrame(0x123, new Uint8Array(64), true, { fd: true, brs: true })).toBe('B00000123F' + '00'.repeat(64) + '\r');
    expect(buildSlcanFrame(0x123, [1, 2], false, { fd: true, brs: true })).toBe('b1232' + '0102\r');
  });

  it('refuses payloads the frame type cannot carry', () => {
    expect(() => buildSlcanFrame(0x123, new Uint8Array(9))).toThrow(RangeError);
    expect(() => buildSlcanFrame(0x123, new Uint8Array(9), false, { fd: true })).toThrow(RangeError);
    expect(() => buildSlcanFrame(0x123, new Uint8Array(65), false, { fd: true })).toThrow(RangeError);
    expect(() => buildSlcanFrame(0x123, [], false, { rtr: true, fd: true })).toThrow(RangeError);
  });

  it('round-trips through the parser', () => {
    const cases = [
      [0x1ff, [1, 2, 3], false, {}],
      [0x1fffffff, [255, 0, 128], true, {}],
      [0x100, [], false, { rtr: true, dlc: 5 }],
      [0x200, Array.from({ length: 20 }, (_, i) => i), false, { fd: true }],
      [0x1abcdef0, Array.from({ length: 48 }, (_, i) => 255 - i), true, { fd: true, brs: true }]
    ];
    for (const [id, data, ext, opts] of cases) {
      const f = parseSlcanFrame(buildSlcanFrame(id, data, ext, opts));
      expect(f).toMatchObject({ id, isExtended: ext, rtr: !!opts.rtr, fd: !!opts.fd, brs: !!opts.brs });
      expect(Array.from(f.data)).toEqual(data);
      expect(f.dlc).toBe(opts.rtr ? opts.dlc : data.length);
    }
  });

  it('CAN_FD_LENGTHS has the 16 DLC codes', () => {
    expect(CAN_FD_LENGTHS).toHaveLength(16);
    expect(CAN_FD_LENGTHS[15]).toBe(64);
  });
});

describe('SlcanLineReader and error replies', () => {
  it('keeps its behaviour and carries partial lines', () => {
    const r = new SlcanLineReader();
    expect(r.push('t1232AA')).toEqual([]);
    expect(r.push('BB\rr1234\r')).toEqual(['t1232AABB', 'r1234']);
    expect(isSlcanError('\x07')).toBe(true);
    expect(isSlcanError('t1230')).toBe(false);
  });
});

describe('open sequence, clock and bitrate detection', () => {
  it('builds the open command sequence', () => {
    expect(buildSlcanOpenSequence()).toEqual(['C', 'S6', 'O']);
    expect(buildSlcanOpenSequence({ baudCode: 'S4', mode: 'listen', timestamps: true })).toEqual(['C', 'S4', 'Z1', 'L']);
    expect(buildSlcanOpenSequence({ baudCode: 'S6', fdRateCode: 'Y2' })).toEqual(['C', 'S6', 'Y2', 'O']);
    expect(buildSlcanOpenSequence({ baudCode: 'S6', mode: 'silent' })).toEqual(['C', 'S6', 'M1', 'O']);
    expect(() => buildSlcanOpenSequence({ mode: 'bogus' })).toThrow(RangeError);
  });

  it('offers only the FD data rates the CANable 2.0 firmware accepts (Y2, Y5)', () => {
    expect(CAN_FD_DATA_RATES.map((r) => r.code)).toEqual(['Y2', 'Y5']);
    expect(CAN_FD_DATA_RATES.map((r) => r.baud)).toEqual([2000000, 5000000]);
  });

  it('unwraps the 60000 ms timestamp counter', () => {
    const clock = createSlcanClock();
    expect(clock(null)).toBeNull();
    expect(clock(100)).toBe(100);
    expect(clock(59990)).toBe(59990);
    expect(clock(30)).toBe(60030);
    expect(clock(500)).toBe(60500);
  });

  it('picks the first bit rate that hears clean frames', async () => {
    const heard = { S6: { frames: 0, errors: 3 }, S5: { frames: 12, errors: 0 }, S8: { frames: 5, errors: 0 } };
    const tried = [];
    const r = await autoDetectBitrate(async (code) => { tried.push(code); return heard[code] || { frames: 0, errors: 0 }; });
    expect(r.code).toBe('S5');
    expect(tried).toEqual(['S6', 'S5']);
  });

  it('returns null when the bus is silent', async () => {
    const r = await autoDetectBitrate(async () => ({ frames: 0, errors: 0 }));
    expect(r.code).toBeNull();
    expect(r.results).toHaveLength(5);
  });
});

describe('DTC table', () => {
  it('has a broad set of descriptions', () => {
    expect(Object.keys(COMMON_DTCS).length).toBeGreaterThan(60);
    expect(COMMON_DTCS.P0300).toMatch(/Misfire/);
    expect(COMMON_DTCS.U0100).toMatch(/ECM/);
  });
});
