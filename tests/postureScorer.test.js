import { describe, it, expect } from 'vitest';
import { calculatePostureScore, isGenericSsid } from '../src/utils/postureScorer.js';
import { generateHTMLReport } from '../src/utils/reportGenerator.js';
import { extractCleartextMetadata } from '../src/utils/wifiParser.js';

describe('Phase 10: Posture Scoring, Cleartext Metadata, & Executive Reporting', () => {
  describe('calculatePostureScore', () => {
    it('returns a perfect score (100, Grade A+) when no devices are present', () => {
      const result = calculatePostureScore({});
      expect(result.score).toBe(100);
      expect(result.grade).toBe('A+');
      expect(result.level).toBe('secure');
      expect(result.penalties.length).toBe(0);
    });

    it('returns 100 (Grade A) for fully encrypted WPA2/WPA3 networks with unique SSIDs', () => {
      const devices = {
        '00:11:22:33:44:55': {
          bssid: '00:11:22:33:44:55',
          ssid: 'Engineering_Core_Secure',
          security: 'WPA3',
          rssi: -45
        },
        '00:11:22:33:44:56': {
          bssid: '00:11:22:33:44:56',
          ssid: 'Corporate_Mesh_HQ',
          security: 'WPA2',
          rssi: -60
        }
      };

      const result = calculatePostureScore(devices, []);
      expect(result.score).toBe(100);
      expect(result.grade).toBe('A');
      expect(result.level).toBe('secure');
      expect(result.penalties.length).toBe(0);
    });

    it('heavily penalizes open (unencrypted) networks (-15 pts each)', () => {
      const devices = {
        'AA:00:00:00:00:01': {
          bssid: 'AA:00:00:00:00:01',
          ssid: 'CoffeeShop_Free_Wifi',
          security: 'Open'
        },
        'AA:00:00:00:00:02': {
          bssid: 'AA:00:00:00:00:02',
          ssid: 'Guest_Unprotected',
          security: 'Open'
        }
      };

      const result = calculatePostureScore(devices, []);
      // 100 - (2 * 15) = 70
      expect(result.score).toBe(70);
      expect(result.level).toBe('warning');
      const openPenalty = result.penalties.find(p => p.type === 'open');
      expect(openPenalty).toBeDefined();
      expect(openPenalty.count).toBe(2);
      expect(openPenalty.deduction).toBe(30);
    });

    it('medium penalizes legacy WEP/WPA-TKIP encryption (-10 pts each)', () => {
      const devices = {
        'AA:00:00:00:00:01': {
          bssid: 'AA:00:00:00:00:01',
          ssid: 'Warehouse_Scanner_Legacy',
          security: 'WEP'
        }
      };

      const result = calculatePostureScore(devices, []);
      expect(result.score).toBe(90);
      const legacyPenalty = result.penalties.find(p => p.type === 'legacy');
      expect(legacyPenalty).toBeDefined();
      expect(legacyPenalty.deduction).toBe(10);
    });

    it('lightly penalizes factory default/generic SSIDs (-5 pts each)', () => {
      const devices = {
        'AA:00:00:00:00:01': {
          bssid: 'AA:00:00:00:00:01',
          ssid: 'NETGEAR-5G',
          security: 'WPA2'
        },
        'AA:00:00:00:00:02': {
          bssid: 'AA:00:00:00:00:02',
          ssid: 'linksys_setup',
          security: 'WPA2'
        }
      };

      const result = calculatePostureScore(devices, []);
      // 100 - (2 * 5) = 90
      expect(result.score).toBe(90);
      const genericPenalty = result.penalties.find(p => p.type === 'generic_ssid');
      expect(genericPenalty).toBeDefined();
      expect(genericPenalty.count).toBe(2);
      expect(genericPenalty.deduction).toBe(10);
    });

    it('penalizes detected threat & rogue anomalies (-10 pts each)', () => {
      const devices = {
        'AA:00:00:00:00:01': {
          bssid: 'AA:00:00:00:00:01',
          ssid: 'Office_Wifi',
          security: 'WPA2'
        }
      };

      const anomalies = [
        { id: 'ANOM-1', type: 'Identifier Rotation' },
        { id: 'ANOM-2', type: 'Evil Twin' }
      ];

      const result = calculatePostureScore(devices, anomalies);
      // 100 - (2 * 10) = 80
      expect(result.score).toBe(80);
      expect(result.level).toBe('warning');
    });

    it('clamps score at 0 in hostile/vulnerable environments', () => {
      const devices = {};
      for (let i = 0; i < 10; i++) {
        devices[`AA:00:00:00:00:0${i}`] = {
          bssid: `AA:00:00:00:00:0${i}`,
          ssid: 'netgear_guest',
          security: 'Open'
        };
      }
      const result = calculatePostureScore(devices, [1, 2, 3]);
      expect(result.score).toBe(0);
      expect(result.grade).toBe('F');
      expect(result.level).toBe('critical');
    });
  });

  describe('isGenericSsid', () => {
    it('identifies generic default SSIDs', () => {
      expect(isGenericSsid('linksys')).toBe(true);
      expect(isGenericSsid('NETGEAR_72')).toBe(true);
      expect(isGenericSsid('TP-Link_Guest')).toBe(true);
      expect(isGenericSsid('default')).toBe(true);
      expect(isGenericSsid('asus_router')).toBe(true);
      expect(isGenericSsid('Custom_Corporate_Corp')).toBe(false);
      expect(isGenericSsid('<Hidden SSID>')).toBe(false);
    });
  });

  describe('extractCleartextMetadata', () => {
    it('returns null for encrypted/protected frames', () => {
      // 802.11 Frame Control with bit 14 (0x4000) set
      const buffer = new Uint8Array([0x08, 0x40, 0x00, 0x00, ...new Array(30).fill(0)]);
      const meta = extractCleartextMetadata(buffer, 0, false);
      expect(meta).toBeNull();
    });

    it('extracts cleartext DNS query domain from unencrypted data frame buffer', () => {
      // Build a minimal unencrypted 802.11 Data frame with LLC/SNAP + IPv4 + UDP 53 + DNS Query
      // MAC header: 24 bytes (fc=0x0008 Data)
      // LLC/SNAP: 8 bytes (AA AA 03 00 00 00 08 00)
      // IPv4: 20 bytes (protocol 17 = UDP)
      // UDP: 8 bytes (dstPort = 53)
      // DNS Query: 12 bytes header + length-prefixed domain "api.weather.com"
      const domainLabels = [
        3, 0x61, 0x70, 0x69, // "api"
        7, 0x77, 0x65, 0x61, 0x74, 0x68, 0x65, 0x72, // "weather"
        3, 0x63, 0x6f, 0x6d, // "com"
        0 // end
      ];

      const frame = new Uint8Array([
        // 802.11 MAC header (24 bytes, unprotected data)
        0x08, 0x00, 0x00, 0x00,
        0x00, 0x0C, 0xE6, 0x99, 0x88, 0x77, // Addr1 (AP)
        0x68, 0xDB, 0xCA, 0x11, 0x22, 0x33, // Addr2 (STA)
        0x00, 0x0C, 0xE6, 0x99, 0x88, 0x77, // Addr3 (BSSID)
        0x00, 0x00, // Seq
        // LLC/SNAP (8 bytes)
        0xAA, 0xAA, 0x03, 0x00, 0x00, 0x00, 0x08, 0x00,
        // IPv4 Header (20 bytes)
        0x45, 0x00, 0x00, 0x50, // Ver 4, IHL 5
        0x12, 0x34, 0x00, 0x00,
        0x40, 0x11, 0x00, 0x00, // TTL 64, Protocol 17 (UDP)
        192, 168, 1, 100, // Src IP
        8, 8, 8, 8, // Dst IP
        // UDP Header (8 bytes)
        0xC0, 0x01, // Src Port 49153
        0x00, 0x35, // Dst Port 53 (DNS)
        0x00, 0x3C, // Length
        0x00, 0x00, // Checksum
        // DNS Header (12 bytes)
        0x12, 0x34, // ID
        0x01, 0x00, // Flags (Standard Query)
        0x00, 0x01, // QDCount: 1 Question
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        // Question Section
        ...domainLabels,
        0x00, 0x01, // Type A
        0x00, 0x01  // Class IN
      ]);

      const meta = extractCleartextMetadata(frame, 0, false);
      expect(meta).not.toBeNull();
      expect(meta.protocol).toBe('DNS');
      expect(meta.domain).toBe('api.weather.com');
      expect(meta.port).toBe(53);
    });

    it('extracts cleartext HTTP Host and endpoint from unencrypted data frame buffer', () => {
      const httpPayload = new TextEncoder().encode(
        'GET /hotspot-detect.html HTTP/1.1\r\nHost: captive.apple.com\r\nUser-Agent: CaptiveNetworkSupport\r\n\r\n'
      );

      const frame = new Uint8Array([
        // 802.11 MAC header (24 bytes)
        0x08, 0x00, 0x00, 0x00,
        0x00, 0x0C, 0xE6, 0x99, 0x88, 0x77,
        0x68, 0xDB, 0xCA, 0x11, 0x22, 0x33,
        0x00, 0x0C, 0xE6, 0x99, 0x88, 0x77,
        0x00, 0x00,
        // LLC/SNAP (8 bytes)
        0xAA, 0xAA, 0x03, 0x00, 0x00, 0x00, 0x08, 0x00,
        // IPv4 Header (20 bytes, protocol 6 TCP)
        0x45, 0x00, 0x00, 0x80,
        0x00, 0x00, 0x00, 0x00,
        0x40, 0x06, 0x00, 0x00, // Protocol 6 = TCP
        192, 168, 1, 100,
        17, 253, 144, 10,
        // TCP Header (20 bytes, Data offset = 5 words = 20 bytes)
        0xD0, 0x01, // Src Port
        0x00, 0x50, // Dst Port 80 (HTTP)
        0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x01,
        0x50, 0x18, 0x01, 0x00, // 0x50 = 5 * 4 = 20 bytes offset
        0x00, 0x00, 0x00, 0x00,
        // HTTP payload
        ...httpPayload
      ]);

      const meta = extractCleartextMetadata(frame, 0, false);
      expect(meta).not.toBeNull();
      expect(meta.protocol).toBe('HTTP');
      expect(meta.domain).toBe('captive.apple.com');
      expect(meta.endpoint).toBe('/hotspot-detect.html');
    });
  });

  describe('generateHTMLReport', () => {
    it('generates well-formed executive HTML report string containing score and top APs', () => {
      const devices = {
        '00:11:22:33:44:55': {
          bssid: '00:11:22:33:44:55',
          ssid: 'Target_Network',
          security: 'WPA2',
          channel: 6,
          rssi: -42,
          hasHandshake: true,
          vendor: 'Intel'
        }
      };

      const posture = { score: 95, grade: 'A', level: 'secure', penalties: [] };
      const anomalies = [{ id: 'ANOM-1', type: 'Identifier Rotation', probedSsids: ['Guest_Net'] }];
      const cleartext = [{ protocol: 'DNS', domain: 'example.org', clientMac: 'AA:BB:CC:DD:EE:FF' }];

      const html = generateHTMLReport(devices, posture, anomalies, {}, cleartext);

      expect(typeof html).toBe('string');
      expect(html).toContain('RF Environment Executive Summary');
      expect(html).toContain('95');
      expect(html).toContain('Grade: <span style="color: #10b981;">A</span>');
      expect(html).toContain('Target_Network');
      expect(html).toContain('00:11:22:33:44:55');
      expect(html).toContain('-42 dBm');
      expect(html).toContain('example.org');
    });
  });
});
