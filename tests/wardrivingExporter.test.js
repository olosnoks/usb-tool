import { describe, it, expect } from 'vitest';
import { exportWigleCsv, formatWigleAuth, formatWigleTimestamp, calculateHaversineDistance } from '../src/utils/wardrivingExporter.js';

describe('Wardriving Wigle CSV Exporter', () => {
  it('formats Wigle AuthMode strings correctly', () => {
    expect(formatWigleAuth('WPA3')).toBe('[WPA3-SAE-CCMP][ESS]');
    expect(formatWigleAuth('WPA2')).toBe('[WPA2-PSK-CCMP][ESS]');
    expect(formatWigleAuth('WPA')).toBe('[WPA-PSK-TKIP][ESS]');
    expect(formatWigleAuth('WEP')).toBe('[WEP][ESS]');
    expect(formatWigleAuth('Open')).toBe('[ESS]');
  });

  it('formats timestamps into YYYY-MM-DD HH:MM:SS', () => {
    const formatted = formatWigleTimestamp('2026-10-24T12:30:45.000Z');
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('generates compliant Wigle CSV with correct headers and rows', () => {
    const devices = {
      '00:14:D1:88:99:AA': {
        bssid: '00:14:D1:88:99:AA',
        ssid: 'CoffeeShop_Free',
        security: 'Open',
        channel: 6,
        rssi: -55,
        firstSeen: '2026-10-24T05:00:00.000Z'
      },
      '80:86:F2:33:44:55': {
        bssid: '80:86:F2:33:44:55',
        ssid: 'Office_Corp,Inc',
        security: 'WPA2',
        channel: 36,
        rssi: -42,
        firstSeen: '2026-10-24T05:01:00.000Z'
      }
    };

    const csv = exportWigleCsv(devices);
    const lines = csv.trim().split('\r\n');

    expect(lines.length).toBe(4);
    // Header line 1
    expect(lines[0]).toBe('WigleWifi-1.4,appRelease=SkonUsbTool,model=WebUSB,release=1.0,device=Browser,display=Web,board=JS,brand=Skon');
    // Header line 2
    expect(lines[1]).toBe('MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type');

    // Row 1
    expect(lines[2]).toContain('00:14:D1:88:99:AA');
    expect(lines[2]).toContain('CoffeeShop_Free');
    expect(lines[2]).toContain('[ESS]');
    expect(lines[2]).toContain(',6,-55,0.0,0.0,0,0,WIFI');

    // Row 2 (with comma escaped)
    expect(lines[3]).toContain('80:86:F2:33:44:55');
    expect(lines[3]).toContain('"Office_Corp,Inc"');
    expect(lines[3]).toContain('[WPA2-PSK-CCMP][ESS]');
    expect(lines[3]).toContain(',36,-42,0.0,0.0,0,0,WIFI');
  });

  it('populates tagged GPS coordinates into CurrentLatitude, CurrentLongitude, and AccuracyMeters', () => {
    const devices = [
      {
        bssid: '24:A4:3C:11:22:33',
        ssid: 'GPS_Tagged_Net',
        security: 'WPA3',
        channel: 1,
        rssi: -48,
        latitude: 37.774929,
        longitude: -122.419416,
        altitude: 15.4,
        accuracy: 4.8
      }
    ];

    const csv = exportWigleCsv(devices);
    const lines = csv.trim().split('\r\n');
    expect(lines.length).toBe(3);
    expect(lines[2]).toContain('24:A4:3C:11:22:33');
    expect(lines[2]).toContain('GPS_Tagged_Net');
    expect(lines[2]).toContain('[WPA3-SAE-CCMP][ESS]');
    expect(lines[2]).toContain('37.774929,-122.419416,15,5,WIFI');
  });

  it('calculates Haversine distance correctly in meters', () => {
    // Distance from point to itself should be 0 meters
    expect(calculateHaversineDistance(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);

    // San Francisco (37.7749, -122.4194) to Oakland (37.8044, -122.2712) is ~13.4 - 13.5 km
    const dist = calculateHaversineDistance(37.7749, -122.4194, 37.8044, -122.2712);
    expect(dist).toBeGreaterThan(13000);
    expect(dist).toBeLessThan(14000);

    // Null or invalid coordinates should return null
    expect(calculateHaversineDistance(null, -122.4, 37.7, -122.4)).toBeNull();
    expect(calculateHaversineDistance(37.7, null, 37.7, -122.4)).toBeNull();
    expect(calculateHaversineDistance(37.7, -122.4, undefined, -122.4)).toBeNull();
    expect(calculateHaversineDistance('invalid', -122.4, 37.7, -122.4)).toBeNull();
  });

  it('skips empty/broadcast BSSIDs and handles empty objects', () => {
    const emptyCsv = exportWigleCsv({});
    const lines = emptyCsv.trim().split('\r\n');
    expect(lines.length).toBe(2); // Only the two header lines
  });
});
