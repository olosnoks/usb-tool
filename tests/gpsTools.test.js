import { describe, it, expect } from 'vitest';
import {
  nmeaChecksum, buildNmeaSentence, decodeNmeaSentence, parseHexBytes, bytesToHex, decodeUbxFrames,
  hzToMeasRateMs, buildCfgMsgRate, buildUbxPoll, parseCoordinate, toDms, toDdm, toMaidenhead,
  haversineMeters, initialBearing, compassPoint
} from '../src/utils/gpsTools';
import { buildCfgRate } from '../src/utils/ubxProtocol';

describe('NMEA tools', () => {
  const gga = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';
  it('computes the standard checksum', () => {
    expect(nmeaChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,')).toBe('47');
  });
  it('decodes and validates', () => {
    const r = decodeNmeaSentence(gga);
    expect(r.ok && r.checksumOk && r.type === 'GGA' && r.talker === 'GP').toBe(true);
    expect(r.fields[0]).toEqual({ name: 'Time (UTC)', value: '123519' });
    expect(decodeNmeaSentence(gga.replace('*47', '*48')).checksumOk).toBe(false);
    expect(decodeNmeaSentence('GPGGA').ok).toBe(false);
  });
  it('rebuilds a corrupt checksum', () => {
    expect(buildNmeaSentence(gga.replace('*47', '*00'))).toBe(gga);
    expect(buildNmeaSentence('GPGGA,1')).toMatch(/^\$GPGGA,1\*[0-9A-F]{2}$/);
  });
});

describe('UBX tools', () => {
  it('parses hex in several formats', () => {
    expect(Array.from(parseHexBytes('B5 62'))).toEqual([0xb5, 0x62]);
    expect(Array.from(parseHexBytes('0xB5,0x62'))).toEqual([0xb5, 0x62]);
    expect(parseHexBytes('xyz')).toBeNull();
    expect(parseHexBytes('abc')).toBeNull();
  });
  it('decodes a CFG-RATE frame and rejects bad checksums', () => {
    const f = buildCfgRate(100);
    const [d] = decodeUbxFrames(f);
    expect(d.name).toBe('CFG-RATE');
    expect(d.checksumOk).toBe(true);
    expect(d.summary).toContain('100 ms (10.00 Hz)');
    const bad = Uint8Array.from(f); bad[bad.length - 1] ^= 0xff;
    expect(decodeUbxFrames(bad)[0].checksumOk).toBe(false);
  });
  it('skips NMEA text between frames', () => {
    const a = buildUbxPoll(0x0a, 0x04);
    const text = new TextEncoder().encode('$GPGGA,1*00\r\n');
    const all = new Uint8Array([...text, ...a, ...a]);
    expect(decodeUbxFrames(all).map((x) => x.name)).toEqual(['MON-VER', 'MON-VER']);
    expect(bytesToHex(a).startsWith('B5 62 0A 04 00 00')).toBe(true);
  });
  it('maps Hz to ms and builds CFG-MSG', () => {
    expect(hzToMeasRateMs(10)).toBe(100);
    expect(hzToMeasRateMs(1)).toBe(1000);
    expect(hzToMeasRateMs(1000)).toBe(25);
    expect(hzToMeasRateMs(0)).toBeNull();
    const m = buildCfgMsgRate(0xf0, 0x03, 0);
    expect(Array.from(m.slice(2, 10))).toEqual([0x06, 0x01, 3, 0, 0xf0, 0x03, 0, m[9]]);
    expect(decodeUbxFrames(m)[0].summary).toBe('message 0xF0 0x03 rate 0');
  });
});

describe('coordinates', () => {
  it('parses formats', () => {
    expect(parseCoordinate('48.1173')).toBeCloseTo(48.1173);
    expect(parseCoordinate('48 07.038 N')).toBeCloseTo(48.1173, 4);
    expect(parseCoordinate('11d31\'00"W')).toBeCloseTo(-11.516667, 5);
    expect(parseCoordinate('-0.5')).toBe(-0.5);
    expect(parseCoordinate('abc')).toBeNull();
    expect(parseCoordinate('10 75 N')).toBeNull();
  });
  it('formats DMS/DDM', () => {
    expect(toDms(48.1173, true)).toBe('48\u00b007\'02.28"N');
    expect(toDdm(-11.516667, false)).toBe('11\u00b031.0000\'W');
  });
  it('computes Maidenhead', () => {
    expect(toMaidenhead(48.14666, 11.60833)).toBe('JN58td');
    expect(toMaidenhead(91, 0)).toBeNull();
  });
  it('computes distance and bearing', () => {
    const d = haversineMeters(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111000); expect(d).toBeLessThan(111400);
    expect(initialBearing(0, 0, 1, 0)).toBeCloseTo(0);
    expect(initialBearing(0, 0, 0, 1)).toBeCloseTo(90);
    expect(compassPoint(91)).toBe('E');
    expect(compassPoint(359)).toBe('N');
  });
});
