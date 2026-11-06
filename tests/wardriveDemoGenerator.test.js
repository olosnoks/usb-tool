import { describe, it, expect } from 'vitest';
import {
  generateDemoAps,
  generateWigleCsv,
  generateTestCsv,
  interpolateSegment,
  formatTimestamp,
  dateToLocalDatetimeString,
  localDatetimeStringToDate,
  parseSvgToNormalizedStrokes,
  parseSvgPathToStrokes,
  exportPythonScriptSource,
  SVG_PRESETS,
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

  it('controls AP density per km and per mile', () => {
    const resKm = generateDemoAps({
      text: 'TEST',
      densityUnit: 'km',
      apsPerUnit: 100, // 100 APs per km
      seed: 42
    });

    // Total path length in km multiplied by density
    const expectedFromLength = resKm.totalPathLengthKm * 100;
    expect(resKm.aps.length).toBeGreaterThanOrEqual(expectedFromLength * 0.95);
    expect(resKm.aps.length).toBeLessThanOrEqual(expectedFromLength * 1.05);

    // 100 APs per mile means fewer APs per km (~62.1 APs/km)
    const resMile = generateDemoAps({
      text: 'TEST',
      densityUnit: 'mile',
      apsPerUnit: 100, // 100 APs per mile
      seed: 42
    });

    expect(resKm.aps.length).toBeGreaterThan(resMile.aps.length * 1.4);
  });

  it('scales to high densities per km cleanly', () => {
    const highDensity = generateDemoAps({
      text: 'KEPLER',
      densityUnit: 'km',
      apsPerUnit: 1000, // 1,000 APs per km
      seed: 42
    });

    expect(highDensity.aps.length).toBeGreaterThan(20000);
    // Spot check a point in the middle
    const midPoint = highDensity.aps[Math.floor(highDensity.aps.length / 2)];
    expect(midPoint.mac).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/);
  });

  it('controls the target amount of APs accurately when targetApCount is set', () => {
    const res100 = generateDemoAps({
      text: 'TEST',
      targetApCount: 100,
      seed: 42
    });
    expect(res100.aps.length).toBeGreaterThanOrEqual(95);
    expect(res100.aps.length).toBeLessThanOrEqual(105);

    const res300 = generateDemoAps({
      text: 'TEST',
      targetApCount: 300,
      seed: 42
    });
    expect(res300.aps.length).toBeGreaterThanOrEqual(285);
    expect(res300.aps.length).toBeLessThanOrEqual(315);
  });

  it('controls the letter size and scale factor', () => {
    const small = generateDemoAps({
      text: 'A',
      letterScale: 0.5,
      seed: 42
    });

    const large = generateDemoAps({
      text: 'A',
      letterScale: 2.0,
      seed: 42
    });

    const smallSpanLat = small.bounds.maxLat - small.bounds.minLat;
    const largeSpanLat = large.bounds.maxLat - large.bounds.minLat;
    expect(largeSpanLat).toBeGreaterThan(smallSpanLat * 3.5);
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

  it('exports standalone Python script source with APs per km/mile controls', () => {
    const py = exportPythonScriptSource({
      text: 'DEFCON',
      latCenter: 36.11,
      lonCenter: -115.17,
      letterW: 0.05,
      letterH: 0.08,
      gap: 0.03,
      densityUnit: 'mile',
      apsPerUnit: 250,
      speedKmh: 65.0
    });

    expect(py).toContain('LAT_CENTER = 36.11');
    expect(py).toContain('LON_CENTER = -115.17');
    expect(py).toContain('LETTER_W = 0.05');
    expect(py).toContain('LETTER_H = 0.08');
    expect(py).toContain('DENSITY_UNIT = "mile"');
    expect(py).toContain('APS_PER_UNIT = 250');
    expect(py).toContain('SPEED_KMH = 65');
    expect(py).toContain('DEFCON');
  });

  it('starts wardrive at a custom specified startTime', () => {
    const customStart = new Date(2026, 5, 15, 10, 0, 0); // 2026-06-15 10:00:00
    const res = generateDemoAps({
      text: 'NOW',
      startTime: customStart,
      speedKmh: 60,
      seed: 42
    });

    expect(res.aps.length).toBeGreaterThan(0);
    expect(res.startTime).toEqual(customStart);
    expect(res.aps[0].first_seen).toBe('2026-06-15 10:00:00');
    expect(res.endTime.getTime()).toBeGreaterThan(customStart.getTime());
    // Subsequent AP has advanced timestamp
    const lastAp = res.aps[res.aps.length - 1];
    expect(lastAp.first_seen > '2026-06-15 10:00:00').toBe(true);
  });

  it('formats dateToLocalDatetimeString and parses localDatetimeStringToDate', () => {
    const d = new Date(2026, 10, 6, 8, 45, 0);
    const localStr = dateToLocalDatetimeString(d);
    expect(localStr).toBe('2026-11-06T08:45');

    const parsed = localDatetimeStringToDate(localStr);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(10);
    expect(parsed.getDate()).toBe(6);
    expect(parsed.getHours()).toBe(8);
    expect(parsed.getMinutes()).toBe(45);
  });

  it('scales letters up to 100x without degrading performance', () => {
    const startT = Date.now();
    const giant = generateDemoAps({
      text: 'BIG',
      letterScale: 100.0, // ~600 km wide
      apsPerUnit: 20,
      seed: 42
    });
    const elapsed = Date.now() - startT;

    expect(giant.aps.length).toBeGreaterThan(100);
    expect(giant.bounds.maxLon - giant.bounds.minLon).toBeGreaterThan(5.0); // Spans >5 degrees lon
    expect(elapsed).toBeLessThan(2000); // Finishes in < 2 seconds
  });

  it('parses SVG paths and shapes into normalized strokes', () => {
    const sampleSvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 10 10 L 90 90 Z" />
      <line x1="0" y1="50" x2="100" y2="50" />
      <polygon points="20,20 80,20 50,80" />
    </svg>`;

    const parsed = parseSvgToNormalizedStrokes(sampleSvg);
    expect(parsed.strokes.length).toBeGreaterThanOrEqual(3);
    expect(parsed.width).toBeGreaterThan(0);
    expect(parsed.height).toBeGreaterThan(0);

    // Verify coordinates are normalized within [0, 1]
    for (const stroke of parsed.strokes) {
      for (const [x, y] of stroke) {
        expect(x).toBeGreaterThanOrEqual(-0.01);
        expect(x).toBeLessThanOrEqual(1.01);
        expect(y).toBeGreaterThanOrEqual(-0.01);
        expect(y).toBeLessThanOrEqual(1.01);
      }
    }
  });

  it('generates demo APs in SVG mode from parsed strokes', () => {
    const defaultWifi = SVG_PRESETS.find(p => p.id === 'wifi');
    expect(defaultWifi).toBeDefined();

    const parsed = parseSvgToNormalizedStrokes(defaultWifi.svg);
    const res = generateDemoAps({
      text: 'WIFI_DEMO',
      mode: 'svg',
      svgStrokes: parsed.strokes,
      latCenter: 37.77,
      lonCenter: -122.41,
      apsPerUnit: 50,
      seed: 42
    });

    expect(res.aps.length).toBeGreaterThan(50);
    expect(res.aps[0].ssid).toMatch(/^WIFI_DEMO-000001$/);
    expect(res.bounds).not.toBeNull();
    expect(res.bounds.minLat).toBeLessThanOrEqual(37.77);
  });

  it('exports standalone Python script with SVG mode and custom startTime', () => {
    const py = exportPythonScriptSource({
      text: 'SKULL_AP',
      mode: 'svg',
      svgStrokes: [[[0, 0], [1, 1]], [[1, 0], [0, 1]]],
      latCenter: 32.25,
      lonCenter: -90.13,
      startTime: '2026-11-06 12:30:00'
    });

    expect(py).toContain('MODE = "svg"');
    expect(py).toContain('SVG_STROKES = [');
    expect(py).toContain('START_TIME_ISO = "2026-11-06 12:30:00"');
    expect(py).toContain('svg_span_lon');
  });

  it('rotates, scales, and flips SVG art accurately', () => {
    // Single horizontal stroke from (0.2, 0.5) to (0.8, 0.5)
    const testStrokes = [[ [0.2, 0.5], [0.8, 0.5] ]];

    // 0 deg rotation
    const resNormal = generateDemoAps({
      text: 'ROT_0',
      mode: 'svg',
      svgStrokes: testStrokes,
      latCenter: 30.0,
      lonCenter: -90.0,
      rotationDeg: 0,
      svgScale: 1.0,
      seed: 42
    });

    // 90 deg rotation turns horizontal stroke vertical
    const resRotated90 = generateDemoAps({
      text: 'ROT_90',
      mode: 'svg',
      svgStrokes: testStrokes,
      latCenter: 30.0,
      lonCenter: -90.0,
      rotationDeg: 90,
      svgScale: 1.0,
      seed: 42
    });

    const normalLonSpan = resNormal.bounds.maxLon - resNormal.bounds.minLon;
    const normalLatSpan = resNormal.bounds.maxLat - resNormal.bounds.minLat;

    const rotLonSpan = resRotated90.bounds.maxLon - resRotated90.bounds.minLon;
    const rotLatSpan = resRotated90.bounds.maxLat - resRotated90.bounds.minLat;

    // Normal was horizontal, so normalLonSpan >> normalLatSpan
    expect(normalLonSpan).toBeGreaterThan(normalLatSpan * 5);

    // Rotated 90 deg is vertical, so rotLatSpan >> rotLonSpan
    expect(rotLatSpan).toBeGreaterThan(rotLonSpan * 5);

    // Scaling by 2x doubles the footprint
    const resScaled = generateDemoAps({
      text: 'SCALE_2',
      mode: 'svg',
      svgStrokes: testStrokes,
      latCenter: 30.0,
      lonCenter: -90.0,
      svgScale: 2.0,
      seed: 42
    });
    const scaledLonSpan = resScaled.bounds.maxLon - resScaled.bounds.minLon;
    expect(scaledLonSpan).toBeGreaterThan(normalLonSpan * 1.8);

    // Flip H flips x coordinates
    const asymmetricStrokes = [[ [0.1, 0.5], [0.3, 0.5] ]];
    const resNoFlip = generateDemoAps({
      mode: 'svg',
      svgStrokes: asymmetricStrokes,
      latCenter: 30.0,
      lonCenter: -90.0,
      flipH: false,
      seed: 42
    });
    const resFlipped = generateDemoAps({
      mode: 'svg',
      svgStrokes: asymmetricStrokes,
      latCenter: 30.0,
      lonCenter: -90.0,
      flipH: true,
      seed: 42
    });

    // Since stroke was on the left [0.1, 0.3], flipped it's on the right [0.7, 0.9]
    expect(resFlipped.aps[0].lon).toBeGreaterThan(resNoFlip.aps[0].lon);
  });

  it('exports standalone Python script with rotation, scale, and flip variables', () => {
    const py = exportPythonScriptSource({
      text: 'TRANSFORM_PY',
      mode: 'svg',
      svgStrokes: [[[0, 0], [1, 1]]],
      latCenter: 32.25,
      lonCenter: -90.13,
      rotationDeg: 45,
      svgScale: 2.5,
      flipH: true,
      flipV: false
    });

    expect(py).toContain('ROTATION_DEG = 45');
    expect(py).toContain('SVG_SCALE = 2.5');
    expect(py).toContain('FLIP_H = True');
    expect(py).toContain('FLIP_V = False');
  });
});
