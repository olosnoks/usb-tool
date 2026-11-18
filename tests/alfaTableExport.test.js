import { describe, it, expect } from 'vitest';
import { bandOfChannel, rssiToQuality, csvField, apsToCsv, clientsToCsv, summarizeAps } from '../src/utils/alfaTableExport';

describe('alfaTableExport', () => {
  it('maps channels and frequencies to bands', () => {
    expect(bandOfChannel(6)).toBe('2.4 GHz');
    expect(bandOfChannel(36)).toBe('5 GHz');
    expect(bandOfChannel(1, 5955)).toBe('6 GHz');
    expect(bandOfChannel(null)).toBe('Unknown');
  });
  it('converts RSSI to quality', () => {
    expect(rssiToQuality(-50)).toBe(100);
    expect(rssiToQuality(-75)).toBe(50);
    expect(rssiToQuality(-120)).toBe(0);
    expect(rssiToQuality(undefined)).toBeNull();
  });
  it('quotes fields and blocks formula injection', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvField(-60)).toBe('-60');
    expect(csvField(null)).toBe('');
  });
  it('writes APs strongest first', () => {
    const csv = apsToCsv({
      a: { ssid: 'Weak', bssid: 'AA', channel: 1, rssi: -80, security: 'WPA2' },
      b: { ssid: 'Strong', bssid: 'BB', channel: 36, rssi: -40, isMfpRequired: true }
    });
    const lines = csv.trim().split('\r\n');
    expect(lines[0].startsWith('SSID,BSSID')).toBe(true);
    expect(lines[1].startsWith('Strong,BB')).toBe(true);
    expect(lines[1]).toContain('5 GHz');
    expect(lines[1]).toContain('Open');
    expect(lines[1]).toContain('required');
    expect(lines).toHaveLength(3);
  });
  it('writes clients with probed SSIDs', () => {
    const csv = clientsToCsv({ x: { clientMac: 'CC', rssi: -60, probedSsids: ['Home', 'Cafe'] } });
    expect(csv).toContain('Home | Cafe');
  });
  it('summarises the survey', () => {
    const s = summarizeAps({
      a: { ssid: 'x', channel: 1, security: 'Open' },
      b: { ssid: '<Unknown>', channel: 44, security: 'WPA3' },
      c: { ssid: 'y', channel: 6, security: 'WEP' }
    });
    expect(s).toMatchObject({ total: 3, open: 1, wep: 1, wpa3: 1, hidden: 1 });
    expect(s.bands['2.4 GHz']).toBe(2);
    expect(s.bands['5 GHz']).toBe(1);
  });
});
