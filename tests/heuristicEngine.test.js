import { describe, it, expect } from 'vitest';
import { 
  isDefaultSSID, 
  isWeakEncryption, 
  isOpenNetwork, 
  generateHeuristicReport 
} from '../src/utils/heuristicEngine.js';
import { clusterInfrastructure } from '../src/utils/wifiParser.js';

describe('Phase 14: Infrastructure Clustering, Sensitivity Tuning, & Heuristic Reporting', () => {
  describe('Heuristic Engine - Default SSID Detection', () => {
    it('detects common default manufacturer and ISP SSIDs', () => {
      const defaultSamples = [
        'linksys',
        'linksys-g',
        'NETGEAR',
        'NETGEAR_5G',
        'TP-LINK_A1B2',
        'tplink_guest',
        'dlink',
        'D-Link_Wireless',
        'ATT-WIFI-1234',
        'attwifi',
        'xfinitywifi',
        'spectrumwifi',
        'default',
        'belkin.4a2',
        'ASUS_Router',
        'Tenda_98FA',
        'ARRIS-5622'
      ];

      for (const ssid of defaultSamples) {
        expect(isDefaultSSID(ssid), `Expected "${ssid}" to be identified as default SSID`).toBe(true);
      }
    });

    it('does not flag custom, hidden, or non-default SSIDs', () => {
      const customSamples = [
        'Quantum_Skunkworks_Lab',
        'Alpha_Corp_5G',
        'Skons_Secure_Home',
        '<Hidden SSID>',
        '-',
        '',
        null,
        undefined
      ];

      for (const ssid of customSamples) {
        expect(isDefaultSSID(ssid), `Expected "${ssid}" to NOT be flagged as default SSID`).toBe(false);
      }
    });
  });

  describe('Heuristic Engine - Weak Encryption & Open Networks', () => {
    it('detects legacy WEP encryption across security and cipher descriptors', () => {
      expect(isWeakEncryption({ security: 'WEP-40' })).toBe(true);
      expect(isWeakEncryption({ security: 'WEP-104' })).toBe(true);
      expect(isWeakEncryption({ security: 'WEP', privacy: true })).toBe(true);
      expect(isWeakEncryption({ security: 'WPA', cipher: 'WEP' })).toBe(true);
    });

    it('detects legacy TKIP encryption across security and cipher descriptors', () => {
      expect(isWeakEncryption({ security: 'WPA-TKIP' })).toBe(true);
      expect(isWeakEncryption({ security: 'WPA2-TKIP' })).toBe(true);
      expect(isWeakEncryption({ security: 'WPA (TKIP)' })).toBe(true);
      expect(isWeakEncryption({ security: 'WPA2', ciphers: ['TKIP', 'CCMP'] })).toBe(true);
    });

    it('passes strong modern ciphers like WPA2-AES and WPA3-SAE', () => {
      expect(isWeakEncryption({ security: 'WPA2', cipher: 'CCMP' })).toBe(false);
      expect(isWeakEncryption({ security: 'WPA3', cipher: 'GCMP-256' })).toBe(false);
      expect(isWeakEncryption({ security: 'WPA2/WPA3' })).toBe(false);
    });

    it('detects open, unencrypted networks', () => {
      expect(isOpenNetwork({ security: 'Open' })).toBe(true);
      expect(isOpenNetwork({ security: 'None' })).toBe(true);
      expect(isOpenNetwork({ security: 'Unencrypted' })).toBe(true);
      expect(isOpenNetwork({ privacy: false })).toBe(true);
      expect(isOpenNetwork({ security: 'WPA2', privacy: true })).toBe(false);
    });
  });

  describe('generateHeuristicReport', () => {
    it('produces a comprehensive categorized heuristic report', () => {
      const devices = [
        {
          bssid: '00:14:D1:11:22:33',
          ssid: 'NETGEAR_Nighthawk',
          security: 'WPA2',
          channel: 6,
          rssi: -50
        },
        {
          bssid: '00:14:D1:11:22:34',
          ssid: 'linksys',
          security: 'WEP',
          channel: 1,
          rssi: -65
        },
        {
          bssid: '00:14:D1:11:22:35',
          ssid: 'CoffeeShop_Free_Wifi',
          security: 'Open',
          channel: 11,
          rssi: -70
        },
        {
          bssid: '80:86:F2:33:44:55',
          ssid: 'Enterprise_Secure_WPA3',
          security: 'WPA3',
          channel: 36,
          rssi: -45
        }
      ];

      const report = generateHeuristicReport(devices);

      expect(report.scannedCount).toBe(4);
      expect(report.totalVulnerabilities).toBe(4); // NETGEAR (default), linksys (default + WEP), CoffeeShop (Open)

      // Default SSIDs
      expect(report.defaultSSIDs).toHaveLength(2);
      expect(report.defaultSSIDs.map(d => d.ssid)).toContain('NETGEAR_Nighthawk');
      expect(report.defaultSSIDs.map(d => d.ssid)).toContain('linksys');

      // Weak Encryption
      expect(report.weakEncryption).toHaveLength(1);
      expect(report.weakEncryption[0].bssid).toBe('00:14:D1:11:22:34');
      expect(report.weakEncryption[0].security).toBe('WEP');

      // Open Networks
      expect(report.openNetworks).toHaveLength(1);
      expect(report.openNetworks[0].ssid).toBe('CoffeeShop_Free_Wifi');
    });

    it('handles empty input gracefully', () => {
      const report = generateHeuristicReport([]);
      expect(report.totalVulnerabilities).toBe(0);
      expect(report.defaultSSIDs).toHaveLength(0);
      expect(report.weakEncryption).toHaveLength(0);
      expect(report.openNetworks).toHaveLength(0);
      expect(report.scannedCount).toBe(0);
    });
  });

  describe('Infrastructure Clustering (clusterInfrastructure)', () => {
    it('clusters devices with identical first 5 bytes of MAC address', () => {
      const devices = [
        {
          bssid: '00:11:22:33:44:01',
          ssid: 'Campus_AP_1',
          vendor: 'Cisco',
          rssi: -50,
          channel: 1
        },
        {
          bssid: '00:11:22:33:44:FE', // Diff in 6th byte, first 5 identical
          ssid: 'Campus_AP_2',
          vendor: 'Cisco',
          rssi: -55,
          channel: 6
        },
        {
          bssid: 'AA:BB:CC:DD:EE:FF', // Unrelated AP
          ssid: 'Home_WiFi',
          vendor: 'Netgear',
          rssi: -60,
          channel: 11
        }
      ];

      const clusters = clusterInfrastructure(devices);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].count).toBe(2);
      expect(clusters[0].devices.map(d => d.bssid)).toContain('00:11:22:33:44:01');
      expect(clusters[0].devices.map(d => d.bssid)).toContain('00:11:22:33:44:FE');
      expect(clusters[0].name).toContain('Node Group');
    });

    it('clusters devices within sequential range (<= 5) sharing the same OUI', () => {
      const devices = [
        {
          bssid: '00:11:22:00:00:10',
          ssid: 'Warehouse_Mesh_A',
          vendor: 'Aruba',
          rssi: -48,
          channel: 36
        },
        {
          bssid: '00:11:22:00:00:12', // diff = 2, same OUI
          ssid: 'Warehouse_Mesh_B',
          vendor: 'Aruba',
          rssi: -52,
          channel: 40
        },
        {
          bssid: '00:11:22:00:00:15', // diff = 3 from B, connected
          ssid: 'Warehouse_Mesh_C',
          vendor: 'Aruba',
          rssi: -55,
          channel: 44
        },
        {
          bssid: '00:11:22:00:01:50', // diff > 5 and 5th byte differs (01 vs 00)
          ssid: 'Isolated_Node',
          vendor: 'Aruba',
          rssi: -70,
          channel: 48
        }
      ];

      const clusters = clusterInfrastructure(devices);
      expect(clusters).toHaveLength(1);
      expect(clusters[0].count).toBe(3);
      expect(clusters[0].devices.map(d => d.bssid)).not.toContain('00:11:22:00:01:50');
    });

    it('does not cluster sequential addresses with differing OUIs', () => {
      const devices = [
        {
          bssid: '00:11:22:33:44:01',
          ssid: 'AP_A',
          vendor: 'VendorA'
        },
        {
          bssid: '00:99:88:33:44:02', // different OUI
          ssid: 'AP_B',
          vendor: 'VendorB'
        }
      ];

      const clusters = clusterInfrastructure(devices);
      expect(clusters).toHaveLength(0);
    });
  });
});
