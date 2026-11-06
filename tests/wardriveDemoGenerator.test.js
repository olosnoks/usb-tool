import { describe, it, expect } from 'vitest';
import {
  generateDemoAps,
  generateWigleCsv,
  generateTestCsv,
  interpolateSegment,
  formatTimestamp,
  exportPythonScriptSource,
  VECTOR_FONTS
} from '../src/utils/wardriveDemoGenerator';

describe('Wardrive Demo Generator', () => {
  it('interpolates line segments properly', () => {
    const pts = interpolateSegment([0, 0], [1, 0], 0.25);
    expect(pts.length).toBeGreaterThanOrEqual(4);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1][0]).toBeCloseTo(1, 4);
    expect(pts[pts.length - 1][1]).toBeCloseTo(0, 4);
  });

  it('handles zero-length segment in interpolateSegment', () => {
    const pts = interpolateSegment([10, 20], [10, 20]);
    expect(pts).toEqual([[10, 20]]);
  });

  it('formats timestamp to YYYY-MM-DD HH:MM:SS', () => {
    const d = new Date(2026, 10, 5, 14, 30, 45); // Month is 0-indexed (10 = Nov)
    const formatted = formatTimestamp(d);
    expect(formatted).toBe('2026-11-05 14:30:45');
  });

  it('generates demo APs for word "HI"', () => {
    const res = generateDemoAps({
      text: 'HI',
      latCenter: 32.25,
      lonCenter: -90.13,
      seed: 42
    });

    expect(res.aps.length).toBeGreaterThan(0);
    expect(res.masterPath.length).toBeGreaterThan(0);
    expect(res.bounds).not.toBeNull();
    expect(res.bounds.minLat).toBeLessThanOrEqual(32.25);
    expect(res.bounds.minLon).toBeGreaterThanOrEqual(-90.15);

    const first = res.aps[0];
    expect(first).toHaveProperty('mac');
    expect(first).toHaveProperty('ssid');
    expect(first.ssid).toMatch(/^HI-000001$/);
    expect(first).toHaveProperty('auth');
    expect(first).toHaveProperty('rssi');
    expect(first).toHaveProperty('lat');
    expect(first).toHaveProperty('lon');
    expect(first.mac).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);

    // Verify unicast (bit 0 = 0) and globally administered (bit 1 = 0)
    const firstByte = parseInt(first.mac.split(':')[0], 16);
    expect(firstByte & 0x01).toBe(0); // Multicast bit 0
    expect(firstByte & 0x02).toBe(0); // Locally administered bit 0
  });

  it('handles empty text gracefully', () => {
    const res = generateDemoAps({ text: '' });
    expect(res.aps).toEqual([]);
    expect(res.masterPath).toEqual([]);
    expect(res.bounds).toBeNull();
  });

  it('generates standard WiGLE Wifi 1.4 CSV', () => {
    const res = generateDemoAps({ text: 'A', latCenter: 32.0, lonCenter: -90.0, seed: 1 });
    const csvWithPreheader = generateWigleCsv(res.aps, true);
    expect(csvWithPreheader).toContain('WigleWifi-1.4');
    expect(csvWithPreheader).toContain('MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type');
    expect(csvWithPreheader).toContain('WIFI');

    const csvWithoutPreheader = generateWigleCsv(res.aps, false);
    expect(csvWithoutPreheader.startsWith('MAC,SSID')).toBe(true);
  });

  it('generates Kepler / test CSV format', () => {
    const res = generateDemoAps({ text: 'TEST', latCenter: 32.0, lonCenter: -90.0, seed: 1 });
    const csv = generateTestCsv(res.aps);
    expect(csv.startsWith('mac,ssid,auth,first_seen,channel,rssi,lat,lon')).toBe(true);
    const lines = csv.trim().split('\n');
    expect(lines.length).toBe(res.aps.length + 1);
  });

  it('exports standalone Python script source with user settings', () => {
    const py = exportPythonScriptSource({
      text: 'DEFCON',
      latCenter: 36.11,
      lonCenter: -115.17,
      letterW: 0.05,
      letterH: 0.08,
      gap: 0.03
    });

    expect(py).toContain('LAT_CENTER, LON_CENTER = 36.11, -115.17');
    expect(py).toContain('LETTER_W, LETTER_H = 0.05, 0.08');
    expect(py).toContain('GAP = 0.03');
    expect(py).toContain('DEFCON');
  });
});

