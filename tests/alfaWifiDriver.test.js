import { describe, it, expect } from 'vitest';
import { 
  bytesToHex, 
  parse80211Frame, 
  MOCK_WIFI_FRAMES, 
  initDriver,
  initWifiAdapter,
  connectAlfaDevice,
  startMonitorMode,
  retuneChannel
} from '../src/utils/alfaWifiDriver';

describe('Alfa Wi-Fi Driver & 802.11 Frame Parser Suite', () => {
  it('exports required driver functions and mock dataset', () => {
    expect(typeof initDriver).toBe('function');
    expect(typeof initWifiAdapter).toBe('function');
    expect(typeof connectAlfaDevice).toBe('function');
    expect(typeof startMonitorMode).toBe('function');
    expect(typeof retuneChannel).toBe('function');
    expect(Array.isArray(MOCK_WIFI_FRAMES)).toBe(true);
    expect(MOCK_WIFI_FRAMES.length).toBeGreaterThanOrEqual(2);
  });

  it('converts byte array to formatted hex string', () => {
    const bytes = new Uint8Array([0x00, 0x11, 0x22, 0xAA, 0xFF]);
    expect(bytesToHex(bytes)).toBe('00 11 22 aa ff');
  });

  it('gracefully handles malformed or short buffers', () => {
    const shortBuffer = new Uint8Array([0x01, 0x02, 0x03]);
    const parsed = parse80211Frame(shortBuffer, 36);
    expect(parsed.type).toBe('Unknown');
    expect(parsed.channel).toBe(36);
    expect(parsed.length).toBe(3);
  });

  it('parses an 802.11 Beacon management frame', () => {
    // 802.11 Beacon: FC = 0x0080 (type 0 mgmt, subtype 8 beacon)
    const frame = new Uint8Array([
      0x80, 0x00, // Frame Control (Beacon)
      0x00, 0x00, // Duration
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // Dest (Broadcast)
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // Source
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // BSSID
      0x00, 0x00  // Sequence Control
    ]);

    const parsed = parse80211Frame(frame, 36);
    expect(parsed.type).toBe('Beacon');
    expect(parsed.frameCategory).toBe('Management');
    expect(parsed.destination).toBe('FF:FF:FF:FF:FF:FF');
    expect(parsed.source).toBe('00:11:22:33:44:55');
    expect(parsed.bssid).toBe('00:11:22:33:44:55');
    expect(parsed.channel).toBe(36);
  });

  it('parses an 802.11 Probe Request frame', () => {
    // 802.11 Probe Req: FC = 0x0040 (type 0 mgmt, subtype 4 probe req)
    const frame = new Uint8Array([
      0x40, 0x00, // Frame Control
      0x00, 0x00, // Duration
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // Dest
      0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, // Source
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF  // BSSID
    ]);

    const parsed = parse80211Frame(frame, 44);
    expect(parsed.type).toBe('Probe Req');
    expect(parsed.frameCategory).toBe('Management');
    expect(parsed.source).toBe('AA:BB:CC:DD:EE:FF');
    expect(parsed.channel).toBe(44);
  });

  it('parses frames preceded by a Radiotap header', () => {
    // Radiotap header: version 0, pad 0, len 8 (0x0008), present mask with dBm signal (bit 5 = 0x20)
    const radiotapAndBeacon = new Uint8Array([
      0x00, 0x00, // Radiotap version & pad
      0x08, 0x00, // Header length = 8 bytes
      0x20, 0x00, 0x00, 0x00, // Present flags (bit 5)
      // 802.11 Beacon follows
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC,
      0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC
    ]);

    const parsed = parse80211Frame(radiotapAndBeacon, 6);
    expect(parsed.type).toBe('Beacon');
    expect(parsed.source).toBe('12:34:56:78:9A:BC');
    expect(parsed.channel).toBe(6);
  });

  it('parses Data frames (QoS Data)', () => {
    // 802.11 QoS Data: FC = 0x0188 (type 2 data, subtype 8 QoS Data)
    const frame = new Uint8Array([
      0x88, 0x01,
      0x00, 0x00,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55
    ]);

    const parsed = parse80211Frame(frame, 149);
    expect(parsed.type).toBe('QoS Data');
    expect(parsed.frameCategory).toBe('Data');
    expect(parsed.source).toBe('AA:BB:CC:DD:EE:FF');
    expect(parsed.channel).toBe(149);
  });

  it('validates all MOCK_WIFI_FRAMES contain valid fields', () => {
    MOCK_WIFI_FRAMES.forEach(frame => {
      expect(frame.timestamp).toBeDefined();
      expect(frame.type).toBeDefined();
      expect(frame.source).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i);
      expect(frame.sourceMac).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i);
      expect(frame.bssid).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i);
      expect(frame.ssid).toBeDefined();
      expect(frame.rssi).toBeLessThan(0);
      expect(frame.channel).toBeGreaterThan(0);
    });
  });
});
