import { describe, it, expect } from 'vitest';
import { parseWigleCsvFile, parseWardriveLine } from '../src/utils/nmeaParser.js';
import { exportWigleCsv } from '../src/utils/wardrivingExporter.js';

const PRE = 'WigleWifi-1.6,appRelease=1.0,model=ESP32,release=1.0,device=Warhog-CYD,display=TFT,board=ESP32,brand=Skons';
const HDR = 'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type';

describe('parseWigleCsvFile', () => {
  it('keeps the strongest-RSSI row per BSSID and the earliest first-seen', () => {
    const csv = [
      PRE, HDR,
      'AA:BB:CC:00:00:01,Net,[WPA2-PSK-CCMP][ESS],2026-05-01 10:00:10,6,2437,-80,40.0,-74.0,5,10,,,WIFI',
      'AA:BB:CC:00:00:01,Net,[WPA2-PSK-CCMP][ESS],2026-05-01 10:00:20,6,2437,-50,40.5,-74.5,5,3,,,WIFI',
      'AA:BB:CC:00:00:01,Net,[WPA2-PSK-CCMP][ESS],2026-05-01 10:00:30,6,2437,-70,40.9,-74.9,5,8,,,WIFI'
    ].join('\n');
    const { aps, metadata } = parseWigleCsvFile(csv);
    expect(metadata.device).toBe('Warhog-CYD');
    expect(aps).toHaveLength(1);
    expect(aps[0].rssi).toBe(-50);
    expect(aps[0].lat).toBe(40.5);
    expect(aps[0].accuracy).toBe(3);
    expect(aps[0].firstSeenTimestamp).toBe(Date.UTC(2026, 4, 1, 10, 0, 10));
  });

  it('handles quoted commas and quotes in SSIDs', () => {
    const csv = [PRE, HDR, 'AA:BB:CC:00:00:02,"My ""Home"", Net",[ESS],2026-05-01 10:00:00,1,2412,-60,40.0,-74.0,0,5,,,WIFI'].join('\r\n');
    const { aps } = parseWigleCsvFile(csv);
    expect(aps[0].ssid).toBe('My "Home", Net');
    expect(aps[0].channel).toBe(1);
    expect(aps[0].lat).toBe(40);
  });

  it('treats empty and zero fields as unknown, not as invented values', () => {
    const csv = [PRE, HDR, 'AA:BB:CC:00:00:03,x,[ESS],2026-05-01 10:00:00,,,,0.0,0.0,0,0,,,WIFI'].join('\n');
    const [ap] = parseWigleCsvFile(csv).aps;
    expect(ap.rssi).toBeNull();
    expect(ap.channel).toBeNull();
    expect(ap.lat).toBeNull();
    expect(ap.lon).toBeNull();
    expect(ap.accuracy).toBeNull();
  });

  it('reads WiGLE 1.4 (11 columns) rows', () => {
    const csv = ['WigleWifi-1.4,appRelease=x', 'MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type',
      'AA:BB:CC:00:00:04,old,[WEP][ESS],2025-01-02 03:04:05,11,-71,10.5,20.5,3,6,WIFI'].join('\n');
    const [ap] = parseWigleCsvFile(csv).aps;
    expect(ap.channel).toBe(11);
    expect(ap.rssi).toBe(-71);
    expect(ap.lat).toBe(10.5);
    expect(ap.firstSeenTimestamp).toBe(Date.UTC(2025, 0, 2, 3, 4, 5));
  });

  it('reads Warhog logs without a header line by column count', () => {
    const line = 'AA:BB:CC:00:00:05,Warhog Net,[WPA2-PSK-CCMP][ESS],2026-05-01 10:00:00,6,2437,-66,40.1,-74.1,12,4,,,WIFI';
    const ap = parseWardriveLine(line);
    expect(ap.rssi).toBe(-66);
    expect(ap.lat).toBe(40.1);
    expect(ap.frequency).toBe(2437);
  });

  it('round-trips SSIDs a,"b" and =HYP and the real first-seen through the exporter', () => {
    const devices = [
      { bssid: 'AA:BB:CC:00:00:06', ssid: 'a,"b"', security: 'WPA2', channel: 11, rssi: -61, latitude: 51.5, longitude: -0.12, accuracy: 7, firstSeenTimestamp: Date.UTC(2026, 6, 4, 9, 8, 7) },
      { bssid: 'AA:BB:CC:00:00:07', ssid: '=HYP', security: 'Open', channel: 36, rssi: -75, latitude: 51.6, longitude: -0.13, firstSeenTimestamp: Date.UTC(2026, 6, 4, 9, 9, 7) }
    ];
    const { aps } = parseWigleCsvFile(exportWigleCsv(devices));
    expect(aps).toHaveLength(2);
    const a = aps.find((x) => x.bssid === 'AA:BB:CC:00:00:06');
    const b = aps.find((x) => x.bssid === 'AA:BB:CC:00:00:07');
    expect(a.ssid).toBe('a,"b"');
    expect(a.firstSeenTimestamp).toBe(Date.UTC(2026, 6, 4, 9, 8, 7));
    expect(a.accuracy).toBe(7);
    expect(a.channel).toBe(11);
    expect(b.ssid).toBe('=HYP');
    expect(b.channel).toBe(36);
  });

  it('ignores a BOM and blank lines', () => {
    const csv = '﻿' + [PRE, HDR, '', 'AA:BB:CC:00:00:08,z,[ESS],2026-05-01 10:00:00,6,2437,-60,40,-74,0,5,,,WIFI', ''].join('\n');
    expect(parseWigleCsvFile(csv).aps).toHaveLength(1);
  });
});

describe('parseWardriveLine invents nothing', () => {
  it('returns null RSSI/channel/auth for a bare BSSID log line', () => {
    const ap = parseWardriveLine('[WARHOG] BSSID: AA:BB:CC:DD:EE:FF | SSID: Cafe');
    expect(ap.rssi).toBeNull();
    expect(ap.channel).toBeNull();
    expect(ap.auth).toBeNull();
    expect(ap.lat).toBeNull();
    expect(typeof ap.firstSeenTimestamp).toBe('number');
  });

  it('drops 0,0 positions in JSON telemetry', () => {
    const ap = parseWardriveLine('{"bssid":"AA:BB:CC:DD:EE:FF","ssid":"j","lat":0,"lon":0}');
    expect(ap.lat).toBeNull();
    expect(ap.rssi).toBeNull();
    expect(ap.channel).toBeNull();
  });
});
