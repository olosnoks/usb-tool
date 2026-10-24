import { describe, it, expect } from 'vitest';
import { 
  parse80211Frame, 
  correlateHiddenAp, 
  detectSignatureRandomization 
} from '../src/utils/wifiParser.js';

describe('Phase 9: Undisclosed Identity Correlation & Signature Profiling', () => {
  describe('correlateHiddenAp', () => {
    it('unmasks hidden AP when receiving client probe request targeting its BSSID with cleartext SSID', () => {
      const devices = {
        '00:0C:E6:99:88:77': {
          bssid: '00:0C:E6:99:88:77',
          ssid: '<Hidden SSID>',
          security: 'WPA2',
          channel: 6,
          originalHidden: true
        }
      };

      const probeFrame = {
        type: 'Probe Req',
        sourceMac: '68:DB:CA:11:22:33',
        destinationMac: 'FF:FF:FF:FF:FF:FF',
        bssid: '00:0C:E6:99:88:77',
        ssid: 'Quantum_Skunkworks_Lab'
      };

      const result = correlateHiddenAp(devices, probeFrame);

      expect(result).not.toBeNull();
      expect(result.bssid).toBe('00:0C:E6:99:88:77');
      expect(result.ssid).toBe('Quantum_Skunkworks_Lab');
      expect(result.isUnmasked).toBe(true);
      expect(result.originalHidden).toBe(true);
      expect(devices['00:0C:E6:99:88:77'].ssid).toBe('Quantum_Skunkworks_Lab');
      expect(devices['00:0C:E6:99:88:77'].isUnmasked).toBe(true);
    });

    it('unmasks AP when destinationMac matches BSSID during association request', () => {
      const devices = {
        '00:11:22:33:44:55': {
          bssid: '00:11:22:33:44:55',
          ssid: '<Hidden SSID>',
          security: 'WPA3'
        }
      };

      const assocFrame = {
        type: 'Assoc Req',
        sourceMac: 'AA:BB:CC:DD:EE:01',
        destinationMac: '00:11:22:33:44:55',
        bssid: 'FF:FF:FF:FF:FF:FF',
        ssid: 'Secret_Corporate_Lab'
      };

      const result = correlateHiddenAp(devices, assocFrame);

      expect(result).not.toBeNull();
      expect(result.ssid).toBe('Secret_Corporate_Lab');
      expect(result.isUnmasked).toBe(true);
      expect(devices['00:11:22:33:44:55'].ssid).toBe('Secret_Corporate_Lab');
    });

    it('ignores wildcard probe requests and empty SSIDs', () => {
      const devices = {
        '00:0C:E6:99:88:77': {
          bssid: '00:0C:E6:99:88:77',
          ssid: '<Hidden SSID>',
          originalHidden: true
        }
      };

      const wildcardFrame = {
        type: 'Probe Req',
        bssid: '00:0C:E6:99:88:77',
        ssid: '<Wildcard Probe>'
      };

      const emptyFrame = {
        type: 'Probe Req',
        bssid: '00:0C:E6:99:88:77',
        ssid: ''
      };

      expect(correlateHiddenAp(devices, wildcardFrame)).toBeNull();
      expect(correlateHiddenAp(devices, emptyFrame)).toBeNull();
      expect(devices['00:0C:E6:99:88:77'].ssid).toBe('<Hidden SSID>');
      expect(devices['00:0C:E6:99:88:77'].isUnmasked).toBeUndefined();
    });

    it('does not alter already revealed non-hidden SSIDs', () => {
      const devices = {
        '00:0C:E6:99:88:77': {
          bssid: '00:0C:E6:99:88:77',
          ssid: 'Existing_Public_Wifi',
          originalHidden: false
        }
      };

      const frame = {
        type: 'Probe Req',
        bssid: '00:0C:E6:99:88:77',
        ssid: 'Other_Network'
      };

      const result = correlateHiddenAp(devices, frame);
      expect(result).toBeNull();
      expect(devices['00:0C:E6:99:88:77'].ssid).toBe('Existing_Public_Wifi');
    });
  });

  describe('parse80211Frame Tag Sequence & Signature Extraction', () => {
    it('extracts Information Element tag sequence and signature from Probe Request buffer', () => {
      // Build a minimal Probe Request with Radiotap header
      // Radiotap: 8 bytes (len=8)
      // 802.11 Header: Frame Control (0x40 0x00), Duration (0x00 0x00), Addr1 (FF:FF:FF:FF:FF:FF), Addr2 (3C:22:FB:44:55:66), Addr3 (FF:FF:FF:FF:FF:FF), Seq (0x00 0x00) -> 24 bytes
      // Body start at 8 + 24 = 32
      // Tag 0 (SSID, len=4, 'TEST') -> [0, 4, 84, 69, 83, 84]
      // Tag 1 (Rates, len=2, [0x02, 0x04]) -> [1, 2, 2, 4]
      // Tag 50 (Ext Rates, len=2, [0x0C, 0x12]) -> [50, 2, 12, 18]
      // Tag 3 (DS Channel, len=1, [6]) -> [3, 1, 6]
      const frameBuffer = new Uint8Array([
        // Radiotap (8 bytes)
        0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00,
        // MAC Header: Probe Request 0x0040 (24 bytes)
        0x40, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // Destination
        0x3C, 0x22, 0xFB, 0x44, 0x55, 0x66, // Source
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // BSSID
        0x10, 0x00, // Seq
        // Tag 0: SSID 'TEST'
        0x00, 0x04, 0x54, 0x45, 0x53, 0x54,
        // Tag 1: Supported Rates
        0x01, 0x02, 0x02, 0x04,
        // Tag 50: Extended Supported Rates
        0x32, 0x02, 0x0C, 0x12,
        // Tag 3: DS Channel 6
        0x03, 0x01, 0x06
      ]);

      const parsed = parse80211Frame(frameBuffer);
      expect(parsed).not.toBeNull();
      expect(parsed.type).toBe('Probe Req');
      expect(parsed.ssid).toBe('TEST');
      expect(parsed.stationMac).toBe('3C:22:FB:44:55:66');
      expect(parsed.tagSequence).toEqual([0, 1, 50, 3]);
      expect(parsed.signature).toBe('0,1,50,3');
    });
  });

  describe('detectSignatureRandomization', () => {
    it('flags multiple MACs broadcasting the identical signature within 10-minute window', () => {
      const now = Date.now();
      const clients = {
        '68:DB:CA:11:22:33': {
          clientMac: '68:DB:CA:11:22:33',
          signature: '0,1,50,3,45,127,191,221',
          lastSeenTs: now - 30000,
          vendor: 'Apple'
        },
        'DE:AD:BE:EF:00:01': {
          clientMac: 'DE:AD:BE:EF:00:01',
          signature: '0,1,50,3,45,127,191,221',
          lastSeenTs: now - 15000,
          vendor: 'Unknown'
        },
        '00:11:22:33:44:55': {
          clientMac: '00:11:22:33:44:55',
          signature: '0,1,3',
          lastSeenTs: now,
          vendor: 'Intel'
        }
      };

      const { randomizedMacs, clusters } = detectSignatureRandomization(clients, 600000);

      expect(randomizedMacs.has('68:DB:CA:11:22:33')).toBe(true);
      expect(randomizedMacs.has('DE:AD:BE:EF:00:01')).toBe(true);
      expect(randomizedMacs.has('00:11:22:33:44:55')).toBe(false);
      expect(clusters.length).toBe(1);
      expect(clusters[0].signature).toBe('0,1,50,3,45,127,191,221');
      expect(clusters[0].macs).toContain('68:DB:CA:11:22:33');
      expect(clusters[0].macs).toContain('DE:AD:BE:EF:00:01');
    });

    it('does not flag single client having a unique signature', () => {
      const clients = {
        'AA:BB:CC:11:22:33': {
          clientMac: 'AA:BB:CC:11:22:33',
          signature: '0,1,50,3,45',
          lastSeenTs: Date.now()
        }
      };

      const { randomizedMacs, clusters } = detectSignatureRandomization(clients);
      expect(randomizedMacs.size).toBe(0);
      expect(clusters.length).toBe(0);
    });

    it('does not flag clients outside the 10-minute temporal window', () => {
      const now = Date.now();
      const clients = {
        'AA:00:00:00:00:01': {
          clientMac: 'AA:00:00:00:00:01',
          signature: '1,50,3,45',
          lastSeenTs: now - (15 * 60 * 1000) // 15 mins ago
        },
        'AA:00:00:00:00:02': {
          clientMac: 'AA:00:00:00:00:02',
          signature: '1,50,3,45',
          lastSeenTs: now // now
        }
      };

      const { randomizedMacs } = detectSignatureRandomization(clients, 10 * 60 * 1000);
      expect(randomizedMacs.size).toBe(0);
    });
  });
});
