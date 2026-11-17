import { describe, it, expect } from 'vitest';
import {
  exportWigleCsv,
  exportWigleCsvDetailed,
  formatWigleAuth,
  formatWigleTimestamp,
  channelToFrequency,
  calculateHaversineDistance
} from '../src/utils/wardrivingExporter.js';

const FIX = { latitude: 37.774929, longitude: -122.419416 };

describe('Wardriving Wigle CSV Exporter', () => {
  it('formats Wigle AuthMode strings correctly', () => {
    expect(formatWigleAuth('WPA3')).toBe('[WPA3-SAE-CCMP][ESS]');
    expect(formatWigleAuth('WPA2')).toBe('[WPA2-PSK-CCMP][ESS]');
    expect(formatWigleAuth('WPA')).toBe('[WPA-PSK-TKIP][ESS]');
    expect(formatWigleAuth('WEP')).toBe('[WEP][ESS]');
    expect(formatWigleAuth('Open')).toBe('[ESS]');
  });

  it('maps EAP, SAE, mixed and OWE, and leaves unknown empty', () => {
    expect(formatWigleAuth('WPA2-EAP')).toBe('[WPA2-EAP-CCMP][ESS]');
    expect(formatWigleAuth('WPA3-SAE')).toBe('[WPA3-SAE-CCMP][ESS]');
    expect(formatWigleAuth('WPA2/WPA3 Mixed')).toBe('[WPA2-PSK-CCMP][WPA3-SAE-CCMP][ESS]');
    expect(formatWigleAuth('WPA/WPA2')).toBe('[WPA-PSK-TKIP][WPA2-PSK-CCMP][ESS]');
    expect(formatWigleAuth('OWE')).toBe('[OWE-CCMP][ESS]');
    expect(formatWigleAuth('[WPA2-PSK-CCMP][ESS]')).toBe('[WPA2-PSK-CCMP][ESS]');
    expect(formatWigleAuth(undefined)).toBe('');
    expect(formatWigleAuth('')).toBe('');
  });

  it('formats timestamps as UTC YYYY-MM-DD HH:MM:SS', () => {
    expect(formatWigleTimestamp('2026-10-24T12:30:45.000Z')).toBe('2026-10-24 12:30:45');
    expect(formatWigleTimestamp(Date.UTC(2026, 9, 24, 23, 59, 1))).toBe('2026-10-24 23:59:01');
    // epoch seconds and zone-less WiGLE text are read as UTC
    expect(formatWigleTimestamp(Date.UTC(2026, 9, 24, 1, 2, 3) / 1000)).toBe('2026-10-24 01:02:03');
    expect(formatWigleTimestamp('2026-10-24 01:02:03')).toBe('2026-10-24 01:02:03');
    // an offset is converted to UTC
    expect(formatWigleTimestamp('2026-10-24T02:00:00+02:00')).toBe('2026-10-24 00:00:00');
  });

  it('derives frequency from channel', () => {
    expect(channelToFrequency(1)).toBe(2412);
    expect(channelToFrequency(6)).toBe(2437);
    expect(channelToFrequency(14)).toBe(2484);
    expect(channelToFrequency(36)).toBe(5180);
    expect(channelToFrequency(null)).toBeNull();
    expect(channelToFrequency(0)).toBeNull();
  });

  it('writes a WigleWifi-1.6 file with real values and no invented fields', () => {
    const devices = {
      a: {
        bssid: '00:14:D1:88:99:AA', ssid: 'CoffeeShop_Free', security: 'Open', channel: 6, rssi: -55,
        firstSeenTimestamp: Date.UTC(2026, 9, 24, 5, 0, 0), ...FIX, altitude: 15.4, accuracy: 4.8
      },
      b: {
        bssid: '80:86:F2:33:44:55', ssid: 'Office_Corp,Inc', security: 'WPA2', channel: 36, rssi: -42,
        firstSeenTimestamp: Date.UTC(2026, 9, 24, 5, 1, 0), ...FIX
      }
    };
    const lines = exportWigleCsv(devices).trim().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^WigleWifi-1\.6,appRelease=SkonUsbTool,/);
    expect(lines[1]).toBe('MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type');
    expect(lines[2]).toBe('00:14:D1:88:99:AA,CoffeeShop_Free,[ESS],2026-10-24 05:00:00,6,2437,-55,37.774929,-122.419416,15,5,,,WIFI');
    // no altitude / accuracy known: left empty, not 0
    expect(lines[3]).toBe('80:86:F2:33:44:55,"Office_Corp,Inc",[WPA2-PSK-CCMP][ESS],2026-10-24 05:01:00,36,5180,-42,37.774929,-122.419416,,,,,WIFI');
  });

  it('leaves RSSI and channel empty when unknown (no -60 / channel 1)', () => {
    const [, , row] = exportWigleCsv([{ bssid: 'AA:BB:CC:00:11:22', ssid: 'x', security: 'WPA2', ...FIX, firstSeenTimestamp: Date.UTC(2026, 0, 1) }]).trim().split('\r\n');
    const f = row.split(',');
    expect(f[4]).toBe(''); // channel
    expect(f[5]).toBe(''); // frequency
    expect(f[6]).toBe(''); // rssi
  });

  it('uses the real first-seen time, not export time', () => {
    const csv = exportWigleCsv([{ bssid: 'AA:BB:CC:00:11:22', ...FIX, firstSeenTimestamp: Date.UTC(2020, 1, 3, 4, 5, 6) }]);
    expect(csv).toContain(',2020-02-03 04:05:06,');
  });

  it('skips rows without a valid fix by default and reports the count', () => {
    const devices = [
      { bssid: 'AA:BB:CC:00:00:01', ssid: 'one', ...FIX },
      { bssid: 'AA:BB:CC:00:00:02', ssid: 'two', lat: 40.1, lon: -74.2 },
      { bssid: 'AA:BB:CC:00:00:03', ssid: 'untagged' },
      { bssid: 'AA:BB:CC:00:00:04', ssid: 'null island', latitude: 0, longitude: 0 },
      { bssid: 'AA:BB:CC:00:00:05', ssid: 'bad range', latitude: 123, longitude: 5 }
    ];
    const r = exportWigleCsvDetailed(devices);
    expect(r.written).toBe(2);
    expect(r.skippedNoFix).toBe(3);
    expect(r.csv.trim().split('\r\n')).toHaveLength(4);
    expect(r.csv).not.toContain(',0.0,0.0,');
    expect(r.csv).not.toContain('untagged');

    const all = exportWigleCsvDetailed(devices, { includeUnfixed: true });
    expect(all.written).toBe(5);
    const untagged = all.csv.split('\r\n').find((l) => l.includes('untagged')).split(',');
    expect(untagged[7]).toBe('');
    expect(untagged[8]).toBe('');
  });

  it('escapes SSIDs and neutralises formula injection', () => {
    const rows = exportWigleCsv([
      { bssid: 'AA:BB:CC:00:00:01', ssid: 'a,"b"', ...FIX },
      { bssid: 'AA:BB:CC:00:00:02', ssid: '=HYPERLINK("x")', ...FIX },
      { bssid: 'AA:BB:CC:00:00:03', ssid: '@cmd', ...FIX },
      { bssid: 'AA:BB:CC:00:00:04', ssid: '+1', ...FIX },
      { bssid: 'AA:BB:CC:00:00:05', ssid: '-2', ...FIX }
    ]);
    expect(rows).toContain('"a,""b"""');
    expect(rows).toContain("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(rows).toContain(",'@cmd,");
    expect(rows).toContain(",'+1,");
    expect(rows).toContain(",'-2,");
  });

  it('writes BLE type and no channel for BLE devices, hides hidden SSIDs', () => {
    const [, , ble, hidden] = exportWigleCsv([
      { bssid: 'AA:BB:CC:00:00:01', ssid: 'tag', deviceType: 'BLE', channel: 6, rssi: -70, ...FIX },
      { bssid: 'AA:BB:CC:00:00:02', ssid: '<Hidden SSID>', security: 'WPA2', channel: 1, ...FIX }
    ]).trim().split('\r\n');
    expect(ble.endsWith(',BLE')).toBe(true);
    expect(ble.split(',')[4]).toBe('');
    expect(hidden.split(',')[1]).toBe('');
  });

  it('calculates Haversine distance correctly in meters', () => {
    expect(calculateHaversineDistance(37.7749, -122.4194, 37.7749, -122.4194)).toBe(0);
    const dist = calculateHaversineDistance(37.7749, -122.4194, 37.8044, -122.2712);
    expect(dist).toBeGreaterThan(13000);
    expect(dist).toBeLessThan(14000);
    expect(calculateHaversineDistance(null, -122.4, 37.7, -122.4)).toBeNull();
    expect(calculateHaversineDistance(37.7, null, 37.7, -122.4)).toBeNull();
    expect(calculateHaversineDistance(37.7, -122.4, undefined, -122.4)).toBeNull();
    expect(calculateHaversineDistance('invalid', -122.4, 37.7, -122.4)).toBeNull();
  });

  it('handles empty objects and broadcast BSSIDs', () => {
    expect(exportWigleCsv({}).trim().split('\r\n')).toHaveLength(2);
    const r = exportWigleCsvDetailed([{ bssid: 'FF:FF:FF:FF:FF:FF', ...FIX }, { bssid: '00:00:00:00:00:00', ...FIX }]);
    expect(r.written).toBe(0);
  });
});
