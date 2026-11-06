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
  splitApsIntoFileChunks,
  fetchOsrmRoadRoute,
  channelToFrequency,
  WIGLE_PREHEADER,
  WIGLE_HEADER,
  SSID_PROFILES,
  XFINITY_OUIS,
  ATT_OUIS,
  generateApIdentity,
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

  it('generates standard WiGLE Wifi 1.6 CSV with Biscuit Pro header', () => {
    const res = generateDemoAps({ text: 'A', latCenter: 32.0, lonCenter: -90.0, seed: 1 });
    const csvWithPreheader = generateWigleCsv(res.aps, true);
    expect(csvWithPreheader).toContain('WigleWifi-1.6');
    expect(csvWithPreheader).toContain('model=Biscuit Pro');
    expect(csvWithPreheader).toContain('brand=Biscuit Shop');
    expect(csvWithPreheader).toContain('MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type');
    expect(csvWithPreheader).toContain(',,,WIFI');

    const csvWithoutPreheader = generateWigleCsv(res.aps, false);
    expect(csvWithoutPreheader.startsWith('MAC,SSID,AuthMode,FirstSeen,Channel,Frequency')).toBe(true);
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
    expect(elapsed).toBeLessThan(5000); // Finishes comfortably even under parallel test suite load
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
    const customSvg = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 20 20 L 80 80 M 80 20 L 20 80" />
      <circle cx="50" cy="50" r="25" />
    </svg>`;

    const parsed = parseSvgToNormalizedStrokes(customSvg);
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
    expect(py).toContain('Inspired by OSINTIAL');
  });

  it('splits APs into smaller standalone files to meet file size limits', () => {
    const res = generateDemoAps({ text: 'SPLIT_TEST', apsPerUnit: 200, seed: 42 });
    expect(res.aps.length).toBeGreaterThan(100);

    // 1. No split limit -> 1 file
    const noLimit = splitApsIntoFileChunks(res.aps, {
      format: 'wigle',
      maxSizeBytes: 0,
      baseName: 'demo'
    });
    expect(noLimit.length).toBe(1);
    expect(noLimit[0].filename).toBe('demo_wigle.csv');
    expect(noLimit[0].part).toBe(1);
    expect(noLimit[0].totalParts).toBe(1);
    expect(noLimit[0].content).toContain('WigleWifi-1.6');
    expect(noLimit[0].content).toContain('model=Biscuit Pro');

    // 2. Small size limit -> breaks into multiple files, each under limit
    const smallLimit = 5000; // 5KB limit
    const chunks = splitApsIntoFileChunks(res.aps, {
      format: 'wigle',
      maxSizeBytes: smallLimit,
      baseName: 'test'
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].filename).toMatch(/^test_wigle_part01_of_\d+\.csv$/);

    for (const chunk of chunks) {
      expect(chunk.byteSize).toBeLessThanOrEqual(smallLimit + 150); // within limit (+ at most 1 row tolerance)
      expect(chunk.content).toContain('WigleWifi-1.6'); // Each chunk is a valid WiGLE file!
      expect(chunk.content).toContain('MAC,SSID,AuthMode');
      expect(chunk.content).toContain('Frequency');
    }

    // Sum of apCounts equals total AP count
    const totalAps = chunks.reduce((sum, c) => sum + c.apCount, 0);
    expect(totalAps).toBe(res.aps.length);
  });

  it('generates demo APs with Xfinity ISP router defaults and authentic OUIs', () => {
    const res = generateDemoAps({
      text: 'XF',
      ssidMode: 'xfinity',
      apsPerUnit: 100,
      seed: 99
    });
    expect(res.aps.length).toBeGreaterThan(10);

    const ssids = res.aps.map(a => a.ssid);
    // Should have authentic Xfinity SSIDs: xfinitywifi, XFINITY, Xfinity-XXXX, or HOME-XXXX
    const hasXfinityWifi = ssids.some(s => s === 'xfinitywifi' || s === 'xfinitywifi-5G');
    const hasXfinityOrHome = ssids.some(s => s.startsWith('Xfinity-') || s.startsWith('HOME-') || s === 'XFINITY');
    expect(hasXfinityWifi || hasXfinityOrHome).toBe(true);

    // Verify OUIs match Xfinity vendors (Arris, Technicolor, Cisco, CommScope, Humax)
    const validXfinityOuis = new Set(XFINITY_OUIS);
    for (const ap of res.aps) {
      const oui = ap.mac.slice(0, 8);
      expect(validXfinityOuis.has(oui)).toBe(true);
      // Open hotspot must have [ESS] auth
      if (ap.ssid === 'xfinitywifi' || ap.ssid === 'xfinitywifi-5G') {
        expect(ap.auth).toBe('[ESS]');
      }
    }
  });

  it('generates demo APs with AT&T ISP router defaults and authentic OUIs', () => {
    const res = generateDemoAps({
      text: 'AT',
      ssidMode: 'att',
      apsPerUnit: 100,
      seed: 123
    });
    expect(res.aps.length).toBeGreaterThan(10);

    const ssids = res.aps.map(a => a.ssid);
    // Should have authentic AT&T SSIDs: ATTXXX, ATT-WIFI-XXXX, attwifi, ATT-Fiber-XXXX
    const hasAtt = ssids.some(s => s.startsWith('ATT') || s === 'attwifi');
    expect(hasAtt).toBe(true);

    // Verify OUIs match AT&T vendors (Pace, Arris, Humax, Nokia, Cisco)
    const validAttOuis = new Set(ATT_OUIS);
    for (const ap of res.aps) {
      const oui = ap.mac.slice(0, 8);
      expect(validAttOuis.has(oui)).toBe(true);
      if (ap.ssid === 'attwifi') {
        expect(ap.auth).toBe('[ESS]');
      }
    }
  });

  it('generates demo APs with realistic ISP mix (Xfinity, AT&T, Spectrum, Common)', () => {
    const res = generateDemoAps({
      text: 'MIX',
      ssidMode: 'isp_mix',
      apsPerUnit: 200,
      seed: 456
    });
    expect(res.aps.length).toBeGreaterThan(30);

    const ssids = res.aps.map(a => a.ssid);
    const hasXfinity = ssids.some(s => s.includes('xfinity') || s.includes('Xfinity') || s.startsWith('HOME-') || s === 'XFINITY');
    const hasAtt = ssids.some(s => s.startsWith('ATT') || s === 'attwifi');

    expect(hasXfinity).toBe(true);
    expect(hasAtt).toBe(true);
  });

  it('rotates and flips text mode properly', () => {
    const unrotated = generateDemoAps({
      text: 'L',
      rotationDeg: 0,
      flipH: false,
      flipV: false,
      seed: 42
    });
    const rotated = generateDemoAps({
      text: 'L',
      rotationDeg: 90,
      flipH: false,
      flipV: false,
      seed: 42
    });
    expect(rotated.aps.length).toBeGreaterThan(0);
    expect(rotated.aps[0].lat).not.toBeCloseTo(unrotated.aps[0].lat, 3);
  });

  it('calculates 802.11 channel frequencies accurately', () => {
    expect(channelToFrequency(1)).toBe(2412);
    expect(channelToFrequency(6)).toBe(2437);
    expect(channelToFrequency(11)).toBe(2462);
    expect(channelToFrequency(14)).toBe(2484);
    expect(channelToFrequency(36)).toBe(5180);
    expect(channelToFrequency(149)).toBe(5745);
    expect(channelToFrequency(165)).toBe(5825);
  });

  it('generates demo APs along a real road route path', () => {
    // Simulated road route coordinates (e.g. 4 road vertices along a street)
    const roadCoords = [
      [-115.1728, 36.1147],
      [-115.1700, 36.1200],
      [-115.1660, 36.1280],
      [-115.1600, 36.1350]
    ];

    const res = generateDemoAps({
      mode: 'route',
      routeCoordinates: roadCoords,
      text: 'STRIP_DRIVE',
      apsPerUnit: 150,
      densityUnit: 'km',
      speedKmh: 45.0,
      seed: 777
    });

    expect(res.aps.length).toBeGreaterThan(20);
    expect(res.totalPathLengthKm).toBeGreaterThan(1.0);
    expect(res.masterPath.length).toBe(4);
    expect(res.aps[0].frequency).toBeGreaterThan(2400);

    const wigleCsv = generateWigleCsv(res.aps);
    expect(wigleCsv).toContain(WIGLE_PREHEADER.trim());
    expect(wigleCsv).toContain(WIGLE_HEADER.trim());
    // APs should carry STRIP_DRIVE prefix or ISP SSID
    expect(res.aps.some(ap => ap.ssid.startsWith('STRIP_DRIVE-'))).toBe(true);

    // Python export for route mode
    const py = exportPythonScriptSource({
      mode: 'route',
      routeCoordinates: roadCoords,
      text: 'STRIP_DRIVE',
      apsPerUnit: 150
    });
    expect(py).toContain('MODE = "route"');
    expect(py).toContain('ROUTE_COORDINATES = [');
  });

  it('validates fetchOsrmRoadRoute error handling and fallback', async () => {
    // Less than 2 waypoints
    const invalidRes = await fetchOsrmRoadRoute([{ lat: 36.1, lon: -115.1 }]);
    expect(invalidRes.success).toBe(false);
    expect(invalidRes.error).toContain('At least 2 waypoints');

    // Network timeout / fallback test
    const fallbackRes = await fetchOsrmRoadRoute([
      { lat: 36.11, lon: -115.17 },
      { lat: 36.12, lon: -115.16 }
    ], { timeoutMs: 1 }); // 1ms timeout guarantees fallback
    expect(fallbackRes.coordinates.length).toBe(2);
    expect(fallbackRes.coordinates[0]).toEqual([-115.17, 36.11]);
  });
});
