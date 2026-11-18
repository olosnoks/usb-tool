import { describe, it, expect } from 'vitest';
import { generateGeoJson, generateGpx, generateKml, summarizeAps, firstSeenToIso } from '../src/utils/wardriveGeoExport';

const aps = [
  { mac: 'aa:bb:cc:00:00:01', ssid: 'A<&>', auth: '[WPA2-PSK-CCMP][ESS]', first_seen: '2025-01-02 03:04:05', channel: 6, frequency: 2437, rssi: -60, lat: 36.1, lon: -115.1, alt: 15 },
  { mac: 'aa:bb:cc:00:00:02', ssid: 'B', auth: '[ESS]', first_seen: '2025-01-02 03:04:06', channel: 36, frequency: 5180, rssi: -80, lat: 36.2, lon: -115.2, alt: 15 }
];
const path = [[-115.1, 36.1], [-115.2, 36.2]];

describe('wardrive geo exports', () => {
  it('GeoJSON has track and points, marked synthetic', () => {
    const g = JSON.parse(generateGeoJson(aps, path));
    expect(g.synthetic).toBe(true);
    expect(g.features).toHaveLength(3);
    expect(g.features[0].geometry.type).toBe('LineString');
    expect(g.features[1].geometry.coordinates).toEqual([-115.1, 36.1, 15]);
  });
  it('GPX and KML escape XML and mark synthetic', () => {
    const gpx = generateGpx(aps, path);
    expect(gpx).toContain('SYNTHETIC');
    expect(gpx).toContain('A&lt;&amp;&gt;');
    expect(gpx).toContain('<trkpt lat="36.1" lon="-115.1"/>');
    const kml = generateKml(aps, path);
    expect(kml).toContain('SYNTHETIC');
    expect(kml).toContain('-115.1,36.1,0 -115.2,36.2,0');
    expect(kml).toContain('A&lt;&amp;&gt;');
  });
  it('handles empty input', () => {
    expect(JSON.parse(generateGeoJson([], [])).features).toEqual([]);
    expect(generateGpx([], [])).not.toContain('<trk>');
    expect(firstSeenToIso('garbage')).toBe('');
  });
  it('summarises a run', () => {
    const s = summarizeAps(aps);
    expect(s).toMatchObject({ count: 2, uniqueSsids: 2, band24: 1, band5: 1, rssiMin: -80, rssiMax: -60, rssiAvg: -70 });
    expect(s.auth).toEqual({ 'WPA2/WPA': 1, Open: 1 });
    expect(summarizeAps([]).rssiAvg).toBeNull();
  });
});
