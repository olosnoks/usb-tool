import { describe, it, expect } from 'vitest';
import { detectRogueAps } from '../src/utils/widsRogueAp.js';

describe('WIDS Rogue AP (Evil Twin) Detector', () => {
  it('detects rogue AP with encryption mismatch on identical SSID', () => {
    const devices = {
      '00:14:D1:88:99:AA': {
        bssid: '00:14:D1:88:99:AA',
        ssid: 'Company_Office',
        security: 'WPA2',
        vendor: 'TP-Link',
        channel: 6
      },
      '24:6F:28:11:22:33': {
        bssid: '24:6F:28:11:22:33',
        ssid: 'Company_Office',
        security: 'Open',
        vendor: 'TP-Link',
        channel: 6
      }
    };

    const { rogueSuspects, flaggedBssids } = detectRogueAps(devices);

    expect(rogueSuspects.length).toBe(1);
    expect(rogueSuspects[0].ssid).toBe('Company_Office');
    expect(rogueSuspects[0].reason).toContain('Encryption mismatch');
    expect(flaggedBssids['00:14:D1:88:99:AA']).toBeDefined();
    expect(flaggedBssids['24:6F:28:11:22:33']).toBeDefined();
    expect(flaggedBssids['24:6F:28:11:22:33'].isRogueSuspect).toBe(true);
  });

  it('detects rogue AP with vendor OUI mismatch on identical SSID', () => {
    const devices = {
      '00:40:96:11:22:33': {
        bssid: '00:40:96:11:22:33',
        ssid: 'SecureHQ',
        security: 'WPA2',
        vendor: 'Cisco',
        channel: 1
      },
      '24:6F:28:44:55:66': {
        bssid: '24:6F:28:44:55:66',
        ssid: 'SecureHQ',
        security: 'WPA2',
        vendor: 'Espressif',
        channel: 1
      }
    };

    const { rogueSuspects } = detectRogueAps(devices);

    expect(rogueSuspects.length).toBe(1);
    expect(rogueSuspects[0].ssid).toBe('SecureHQ');
    expect(rogueSuspects[0].reason).toContain('Vendor OUI mismatch');
    expect(rogueSuspects[0].reason).toContain('Cisco vs Espressif');
  });

  it('does NOT flag legitimate mesh/roaming APs with identical security and vendor', () => {
    const devices = {
      '00:40:96:11:22:33': {
        bssid: '00:40:96:11:22:33',
        ssid: 'Campus_Wi-Fi',
        security: 'WPA2',
        vendor: 'Cisco',
        channel: 1
      },
      '00:40:96:44:55:66': {
        bssid: '00:40:96:44:55:66',
        ssid: 'Campus_Wi-Fi',
        security: 'WPA2',
        vendor: 'Cisco',
        channel: 6
      },
      '00:40:96:77:88:99': {
        bssid: '00:40:96:77:88:99',
        ssid: 'Campus_Wi-Fi',
        security: 'WPA2',
        vendor: 'Cisco',
        channel: 11
      }
    };

    const { rogueSuspects } = detectRogueAps(devices);
    expect(rogueSuspects.length).toBe(0);
  });

  it('ignores placeholder and hidden SSIDs', () => {
    const devices = {
      '00:11:22:33:44:55': {
        bssid: '00:11:22:33:44:55',
        ssid: '<Hidden SSID>',
        security: 'WPA2',
        vendor: 'Netgear'
      },
      'AA:BB:CC:DD:EE:FF': {
        bssid: 'AA:BB:CC:DD:EE:FF',
        ssid: '<Hidden SSID>',
        security: 'Open',
        vendor: 'Espressif'
      }
    };

    const { rogueSuspects } = detectRogueAps(devices);
    expect(rogueSuspects.length).toBe(0);
  });

  it('handles empty or null inputs gracefully', () => {
    expect(detectRogueAps(null)).toEqual({ rogueSuspects: [], flaggedBssids: {} });
    expect(detectRogueAps({})).toEqual({ rogueSuspects: [], flaggedBssids: {} });
  });
});
