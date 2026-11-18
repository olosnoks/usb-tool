import { describe, it, expect } from 'vitest';
import {
  MSP,
  crc8DvbS2,
  xorChecksum,
  encodeV1,
  encodeV2,
  encodeRequest,
  MspDecoder,
  MspClient,
  MspTimeoutError,
  MspRejectedError,
  decodeApiVersion,
  decodeFcVariant,
  decodeFcVersion,
  decodeBoardInfo,
  decodeBuildInfo,
  decodeStatusEx,
  decodeAttitude,
  decodeRawImu,
  decodeChannels,
  decodeAnalog,
  cliLineBytes,
  endsWithCliPrompt,
  isRebootingCommand,
  CLI_ENTER_BYTES,
} from '../src/utils/mspProtocol.js';

const bytes = (...xs) => Uint8Array.from(xs);
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe('CRC-8 DVB-S2', () => {
  it('matches the published check value for "123456789"', () => {
    expect(crc8DvbS2(ascii('123456789'))).toBe(0xbc);
  });

  it('is zero for empty input and honours a sub-range', () => {
    expect(crc8DvbS2(new Uint8Array(0))).toBe(0);
    const data = bytes(0xff, 0x00, 0x01, 0x00, 0x00, 0x00);
    expect(crc8DvbS2(data, 1, 5)).toBe(crc8DvbS2(bytes(0x00, 0x01, 0x00, 0x00)));
  });
});

describe('MSP v1 checksum', () => {
  it('is the XOR of size, command and payload', () => {
    expect(xorChecksum(bytes(0x00, 0x01))).toBe(0x01); // empty payload, cmd 1
    expect(xorChecksum(bytes(0x01, 0x01, 0x12))).toBe(0x12 ^ 0x01 ^ 0x01);
  });
});

describe('encodeV1', () => {
  it('encodes MSP_API_VERSION with no payload as $M< 00 01 01', () => {
    expect(hex(encodeV1(MSP.API_VERSION))).toBe('24 4d 3c 00 01 01');
  });

  it('encodes MSP_RC (105) with no payload', () => {
    expect(hex(encodeV1(105))).toBe('24 4d 3c 00 69 69');
  });

  it('includes the payload and its checksum', () => {
    expect(hex(encodeV1(1, bytes(0x12)))).toBe('24 4d 3c 01 01 12 12');
  });

  it('rejects out-of-range commands and oversized payloads', () => {
    expect(() => encodeV1(256)).toThrow(RangeError);
    expect(() => encodeV1(1, new Uint8Array(256))).toThrow(RangeError);
  });
});

describe('encodeV2', () => {
  it('encodes MSP_API_VERSION with the CRC-8 DVB-S2 trailer', () => {
    // flag 00, cmd 01 00, size 00 00, crc 0x45 (verified against a table-driven CRC)
    expect(hex(encodeV2(1))).toBe('24 58 3c 00 01 00 00 00 45');
  });

  it('encodes MSP_FC_VARIANT (2) with crc 0x8a', () => {
    expect(hex(encodeV2(2))).toBe('24 58 3c 00 02 00 00 00 8a');
  });

  it('encodes a 16-bit command and payload length little-endian', () => {
    const payload = bytes(0x12);
    const out = encodeV2(0x0102, payload, 0);
    expect(out.slice(0, 8)).toEqual(bytes(0x24, 0x58, 0x3c, 0x00, 0x02, 0x01, 0x01, 0x00));
    expect(out[8]).toBe(0x12);
    expect(out[9]).toBe(crc8DvbS2(out, 3, 9));
    expect(out.length).toBe(10);
  });

  it('encodeRequest picks the protocol version', () => {
    expect(encodeRequest(1, { version: 1 })).toEqual(encodeV1(1));
    expect(encodeRequest(1, { version: 2 })).toEqual(encodeV2(1));
  });
});

describe('MspDecoder', () => {
  // MSP_API_VERSION response from a flight controller: protocol 0, API 1.46
  const V1_API_RESPONSE = bytes(0x24, 0x4d, 0x3e, 0x03, 0x01, 0x00, 0x01, 0x2e, 0x2d);
  // Same answer as an MSP v2 frame
  const V2_API_RESPONSE = bytes(0x24, 0x58, 0x3e, 0x00, 0x01, 0x00, 0x03, 0x00, 0x00, 0x01, 0x2e, 0x9c);

  it('decodes a whole MSP v1 response', () => {
    const frames = new MspDecoder().feed(V1_API_RESPONSE);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ kind: 'response', version: 1, cmd: 1, flag: 0 });
    expect(Array.from(frames[0].payload)).toEqual([0x00, 0x01, 0x2e]);
  });

  it('decodes a whole MSP v2 response with its flag and CRC', () => {
    const frames = new MspDecoder().feed(V2_API_RESPONSE);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ kind: 'response', version: 2, cmd: 1, flag: 0 });
    expect(Array.from(frames[0].payload)).toEqual([0x00, 0x01, 0x2e]);
  });

  it('assembles a frame that arrives one byte at a time', () => {
    const dec = new MspDecoder();
    const got = [];
    for (const b of V1_API_RESPONSE) got.push(...dec.feed(bytes(b)));
    expect(got).toHaveLength(1);
    expect(got[0].cmd).toBe(1);
  });

  it('assembles a frame split across two chunks mid-payload', () => {
    const dec = new MspDecoder();
    expect(dec.feed(V2_API_RESPONSE.slice(0, 9))).toHaveLength(0);
    const frames = dec.feed(V2_API_RESPONSE.slice(9));
    expect(frames).toHaveLength(1);
    expect(frames[0].version).toBe(2);
  });

  it('returns several frames from one chunk and skips leading text', () => {
    const text = new TextEncoder().encode('CLI banner\r\n');
    const chunk = new Uint8Array([...text, ...V1_API_RESPONSE, ...V2_API_RESPONSE]);
    const dec = new MspDecoder();
    const frames = dec.feed(chunk);
    expect(frames.map((f) => f.version)).toEqual([1, 2]);
    expect(dec.stats.skipped).toBe(text.length);
  });

  it('reports an MSP v1 error frame ($M!) as kind error', () => {
    // MSP_RC answered with '!' (not supported): size 0, cmd 105, checksum 0x69
    const frames = new MspDecoder().feed(bytes(0x24, 0x4d, 0x21, 0x00, 0x69, 0x69));
    expect(frames[0]).toMatchObject({ kind: 'error', version: 1, cmd: 105 });
  });

  it('reports an MSP v2 error frame ($X!) as kind error', () => {
    const frames = new MspDecoder().feed(encodeV2(2).map((b, i) => (i === 2 ? 0x21 : b)));
    expect(frames[0]).toMatchObject({ kind: 'error', version: 2, cmd: 2 });
  });

  it('flags a bad v1 checksum and resynchronises on the next good frame', () => {
    const corrupt = Uint8Array.from(V1_API_RESPONSE);
    corrupt[corrupt.length - 1] ^= 0xff;
    const dec = new MspDecoder();
    const frames = dec.feed(new Uint8Array([...corrupt, ...V2_API_RESPONSE]));
    expect(frames[0]).toMatchObject({ kind: 'corrupt' });
    expect(frames.find((f) => f.kind === 'response' && f.version === 2)).toBeTruthy();
    expect(dec.stats.corrupt).toBeGreaterThan(0);
  });

  it('flags a bad v2 CRC', () => {
    const corrupt = Uint8Array.from(V2_API_RESPONSE);
    corrupt[corrupt.length - 1] ^= 0x01;
    const frames = new MspDecoder().feed(corrupt);
    expect(frames.some((f) => f.kind === 'corrupt' && /CRC-8/.test(f.reason))).toBe(true);
  });

  it('drops pure noise without emitting frames', () => {
    const dec = new MspDecoder();
    expect(dec.feed(bytes(0x01, 0x02, 0x03))).toEqual([]);
    expect(dec.stats.skipped).toBe(3);
  });
});

describe('payload decoders', () => {
  it('decodes MSP_API_VERSION', () => {
    expect(decodeApiVersion(bytes(0x00, 0x01, 0x2e))).toEqual({
      protocolVersion: 0, apiMajor: 1, apiMinor: 46, apiVersion: '1.46',
    });
    expect(decodeApiVersion(bytes(0x00, 0x01))).toBeNull();
  });

  it('decodes MSP_FC_VARIANT and names known variants', () => {
    expect(decodeFcVariant(ascii('BTFL'))).toEqual({ identifier: 'BTFL', name: 'Betaflight' });
    expect(decodeFcVariant(ascii('INAV'))).toEqual({ identifier: 'INAV', name: 'INAV' });
    expect(decodeFcVariant(ascii('XYZ1')).name).toBe('Unknown variant');
    expect(decodeFcVariant(ascii('BTF'))).toBeNull();
  });

  it('decodes MSP_FC_VERSION', () => {
    expect(decodeFcVersion(bytes(4, 5, 2))).toMatchObject({ version: '4.5.2' });
  });

  it('decodes MSP_BOARD_INFO with length-prefixed names', () => {
    const payload = [
      ...ascii('S405'), 0x02, 0x00, 0x00, 0x00,
      4, ...ascii('S405'),
      7, ...ascii('STM32F4'),
      3, ...ascii('ABC'),
    ];
    const info = decodeBoardInfo(Uint8Array.from(payload));
    expect(info).toMatchObject({
      identifier: 'S405',
      hardwareRevision: 2,
      osdSupport: 0,
      commCapabilities: 0,
      targetName: 'S405',
      boardName: 'STM32F4',
      manufacturerId: 'ABC',
    });
  });

  it('keeps board info names undefined when the firmware sends none', () => {
    const info = decodeBoardInfo(bytes(...ascii('MATE'), 1, 0, 0, 0));
    expect(info.identifier).toBe('MATE');
    expect(info.targetName).toBeUndefined();
  });

  it('decodes MSP_BUILD_INFO as date(11) time(8) revision(7)', () => {
    const payload = [...ascii('Jan 02 2025'), ...ascii('10:11:12'), ...ascii('abc1234')];
    expect(decodeBuildInfo(Uint8Array.from(payload))).toEqual({
      buildDate: 'Jan 02 2025', buildTime: '10:11:12', gitRevision: 'abc1234',
    });
    expect(decodeBuildInfo(bytes(1, 2, 3))).toBeNull();
  });

  it('decodes MSP_STATUS_EX fixed prefix: cycle time, errors, sensors, flags', () => {
    // cycle 125 us (8 kHz), i2c errors 3, sensors ACC|BARO|MAG (0x07), flags 0x00000401, profile 2
    const p = bytes(0x7d, 0x00, 0x03, 0x00, 0x07, 0x00, 0x01, 0x04, 0x00, 0x00, 0x02);
    const s = decodeStatusEx(p);
    expect(s.cycleTimeUs).toBe(125);
    expect(s.sampleRateHz).toBeCloseTo(8000, 6);
    expect(s.i2cErrors).toBe(3);
    expect(s.sensors.filter((x) => x.present).map((x) => x.name)).toEqual(['ACC', 'BARO', 'MAG']);
    expect(s.flightModeFlagsRaw).toBe(0x401);
    expect(s.pidProfile).toBe(2);
    expect(decodeStatusEx(bytes(1, 2, 3))).toBeNull();
  });

  it('decodes MSP_ATTITUDE with signed tenths of a degree for roll and pitch', () => {
    // roll -12.5 deg (-125), pitch +3.0 deg (30), yaw -90 deg
    const p = new Uint8Array(6);
    const v = new DataView(p.buffer);
    v.setInt16(0, -125, true);
    v.setInt16(2, 30, true);
    v.setInt16(4, -90, true);
    expect(decodeAttitude(p)).toEqual({ rollDeg: -12.5, pitchDeg: 3, yawDeg: -90 });
  });

  it('decodes MSP_RAW_IMU into acc, gyro and mag triples', () => {
    const p = new Uint8Array(18);
    const v = new DataView(p.buffer);
    [512, -256, 100, 1, -2, 3, 10, 20, -30].forEach((x, i) => v.setInt16(i * 2, x, true));
    expect(decodeRawImu(p)).toEqual({ acc: [512, -256, 100], gyro: [1, -2, 3], mag: [10, 20, -30] });
  });

  it('decodes MSP_RC and MSP_MOTOR as u16 arrays', () => {
    const p = new Uint8Array([0xe8, 0x03, 0xd0, 0x07, 0xdc, 0x05]);
    expect(decodeChannels(p)).toEqual([1000, 2000, 1500]);
  });

  it('decodes MSP_ANALOG: 0.1 V, mAh, raw RSSI and 0.01 A', () => {
    const p = new Uint8Array(7);
    const v = new DataView(p.buffer);
    p[0] = 168; // 16.8 V
    v.setUint16(1, 250, true);
    v.setUint16(3, 512, true);
    v.setInt16(5, -150, true);
    expect(decodeAnalog(p)).toEqual({ voltageV: 16.8, mahDrawn: 250, rssiRaw: 512, currentA: -1.5 });
    expect(decodeAnalog(bytes(1, 2))).toBeNull();
  });
});

describe('MspClient', () => {
  it('resolves with the matching response and writes the encoded request', async () => {
    const sent = [];
    const client = new MspClient({ send: (b) => sent.push(b), timeoutMs: 200 });
    const pending = client.request(MSP.API_VERSION);
    expect(hex(sent[0])).toBe('24 4d 3c 00 01 01');
    client.feed(bytes(0x24, 0x4d, 0x3e, 0x03, 0x01, 0x00, 0x01, 0x2e, 0x2d));
    const frame = await pending;
    expect(decodeApiVersion(frame.payload).apiVersion).toBe('1.46');
    expect(client.counts).toMatchObject({ requests: 1, responses: 1, timeouts: 0 });
  });

  it('rejects with MspTimeoutError when the flight controller is silent', async () => {
    const client = new MspClient({ send: () => {}, timeoutMs: 20 });
    await expect(client.request(MSP.RC)).rejects.toBeInstanceOf(MspTimeoutError);
    expect(client.counts.timeouts).toBe(1);
  });

  it('rejects with MspRejectedError on a $M! reply', async () => {
    const client = new MspClient({ send: () => {}, timeoutMs: 200 });
    const pending = client.request(MSP.RC);
    client.feed(bytes(0x24, 0x4d, 0x21, 0x00, 0x69, 0x69));
    await expect(pending).rejects.toBeInstanceOf(MspRejectedError);
    expect(client.counts.rejected).toBe(1);
  });

  it('runs one request at a time, in order', async () => {
    const sent = [];
    const client = new MspClient({ send: (b) => sent.push(b[4]), timeoutMs: 200 });
    const a = client.request(MSP.ATTITUDE);
    const b = client.request(MSP.RC);
    expect(sent).toEqual([108]); // RC waits until ATTITUDE is answered
    client.feed(bytes(0x24, 0x4d, 0x3e, 0x06, 108, 0, 0, 0, 0, 0, 0, 0x06 ^ 108));
    await a;
    expect(sent).toEqual([108, 105]);
    client.feed(bytes(0x24, 0x4d, 0x3e, 0x00, 105, 105));
    await expect(b).resolves.toMatchObject({ cmd: 105 });
  });

  it('counts a frame for another command as stray and keeps waiting', async () => {
    const client = new MspClient({ send: () => {}, timeoutMs: 200 });
    const pending = client.request(MSP.RC);
    client.feed(bytes(0x24, 0x4d, 0x3e, 0x00, 108, 108)); // ATTITUDE answer, but no ATTITUDE request
    expect(client.counts.stray).toBe(1);
    client.feed(bytes(0x24, 0x4d, 0x3e, 0x00, 105, 105));
    await expect(pending).resolves.toMatchObject({ cmd: 105 });
  });

  it('fails the request when the transport send() rejects', async () => {
    const client = new MspClient({ send: () => Promise.reject(new Error('port closed')), timeoutMs: 200 });
    await expect(client.request(MSP.API_VERSION)).rejects.toThrow('port closed');
  });

  it('close() rejects the in-flight and queued requests', async () => {
    const client = new MspClient({ send: () => {}, timeoutMs: 1000 });
    const a = client.request(MSP.ATTITUDE);
    const b = client.request(MSP.RC);
    client.close();
    await expect(a).rejects.toThrow('closed');
    await expect(b).rejects.toThrow('closed');
    await expect(client.request(MSP.RC)).rejects.toThrow('closed');
  });
});

describe('CLI helpers', () => {
  it('uses # to enter the CLI and CRLF to end a command', () => {
    expect(Array.from(CLI_ENTER_BYTES)).toEqual([0x23]);
    expect(Array.from(cliLineBytes('diff all'))).toEqual(Array.from(new TextEncoder().encode('diff all\r\n')));
    expect(Array.from(cliLineBytes('exit\n'))).toEqual(Array.from(new TextEncoder().encode('exit\r\n')));
  });

  it('detects the bare # prompt as the end of CLI output', () => {
    expect(endsWithCliPrompt('diff all\r\n# battery\r\nset x = 1\r\n#')).toBe(true);
    expect(endsWithCliPrompt('diff all\r\n#\r\n\r\n#  \r\n')).toBe(true);
    // a section header like "# battery" is not the prompt
    expect(endsWithCliPrompt('# battery_profile\r\nset a = 1')).toBe(false);
    expect(endsWithCliPrompt('diff all\r\n')).toBe(false);
  });

  it('recognises exit as the reboot command', () => {
    expect(isRebootingCommand('exit')).toBe(true);
    expect(isRebootingCommand('  EXIT ')).toBe(true);
    expect(isRebootingCommand('exit now')).toBe(false);
  });
});
