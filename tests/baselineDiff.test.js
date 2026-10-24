import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  saveBaselineSnapshot, 
  loadBaselineSnapshot, 
  clearBaselineSnapshot, 
  filterNewSinceBaseline 
} from '../src/utils/localDataStore.js';
import { parse80211Frame } from '../src/utils/wifiParser.js';

describe('Phase 12: Event Notifications, Roaming Profiling, & Baseline Diffing', () => {
  // In-memory localStorage mock for node/vitest environment
  let storageMap = {};

  beforeEach(() => {
    storageMap = {};
    vi.stubGlobal('localStorage', {
      getItem: (key) => storageMap[key] || null,
      setItem: (key, val) => { storageMap[key] = String(val); },
      removeItem: (key) => { delete storageMap[key]; },
      clear: () => { storageMap = {}; }
    });

    // Mock native Notification API
    class MockNotification {
      static permission = 'default';
      static requestPermission = vi.fn().mockResolvedValue('granted');
      constructor(title, options) {
        this.title = title;
        this.options = options;
        MockNotification.instances.push({ title, options });
      }
    }
    MockNotification.instances = [];
    vi.stubGlobal('Notification', MockNotification);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Baseline Snapshot Storage & Filtering (localDataStore.js)', () => {
    it('saves a baseline reference snapshot with device & client metadata', () => {
      const devices = {
        '00:11:22:33:44:55': { bssid: '00:11:22:33:44:55', ssid: 'Office_WLAN', rssi: -50 }
      };
      const clients = {
        'AA:BB:CC:DD:EE:01': { clientMac: 'AA:BB:CC:DD:EE:01', bssid: '00:11:22:33:44:55', rssi: -65 }
      };

      const snapshot = saveBaselineSnapshot(devices, clients);
      expect(snapshot).toBeDefined();
      expect(snapshot.deviceCount).toBe(1);
      expect(snapshot.clientCount).toBe(1);
      expect(snapshot.knownBssids).toContain('00:11:22:33:44:55');
      expect(snapshot.knownClientMacs).toContain('AA:BB:CC:DD:EE:01');
      expect(typeof snapshot.timestamp).toBe('number');

      // Verify loaded snapshot from localStorage
      const loaded = loadBaselineSnapshot();
      expect(loaded).not.toBeNull();
      expect(loaded.timestamp).toBe(snapshot.timestamp);
      expect(loaded.knownBssids).toEqual(['00:11:22:33:44:55']);
    });

    it('clears baseline snapshot when requested', () => {
      saveBaselineSnapshot({ '00:11:22:33:44:55': { bssid: '00:11:22:33:44:55' } });
      expect(loadBaselineSnapshot()).not.toBeNull();

      const cleared = clearBaselineSnapshot();
      expect(cleared).toBe(true);
      expect(loadBaselineSnapshot()).toBeNull();
    });

    it('filters out old devices and keeps only new ones based on timestamps and identifiers', () => {
      const baselineTime = 1700000000000;
      const baseline = {
        timestamp: baselineTime,
        knownBssids: ['00:11:22:33:44:55', '00:11:22:33:44:56'],
        knownClientMacs: ['AA:BB:CC:DD:EE:01']
      };

      const currentDevices = [
        // 1. Old device present in baseline, firstSeen before baseline
        {
          bssid: '00:11:22:33:44:55',
          ssid: 'Existing_AP',
          firstSeenTimestamp: baselineTime - 10000
        },
        // 2. Old device in baseline, but firstSeen is before baseline
        {
          bssid: '00:11:22:33:44:56',
          ssid: 'Old_AP_2',
          firstSeenTimestamp: baselineTime - 5000
        },
        // 3. Brand new device not present in baseline snapshot
        {
          bssid: '66:77:88:99:AA:BB',
          ssid: 'Rogue_New_AP',
          firstSeenTimestamp: baselineTime + 2000
        },
        // 4. Device in baseline, but newly re-detected after baseline reset
        {
          bssid: '00:11:22:33:44:55',
          ssid: 'Existing_AP_New_Visit',
          firstSeenTimestamp: baselineTime + 50000
        }
      ];

      const newDevices = filterNewSinceBaseline(currentDevices, baseline);
      expect(newDevices.length).toBe(2);
      expect(newDevices.map(d => d.ssid)).toEqual(['Rogue_New_AP', 'Existing_AP_New_Visit']);
    });

    it('returns all items if baseline is null or empty', () => {
      const items = [{ bssid: '00:11:22:33:44:55' }, { bssid: 'AA:BB:CC:DD:EE:FF' }];
      expect(filterNewSinceBaseline(items, null)).toEqual(items);
    });
  });

  describe('Roaming Capabilities Profiling (802.11k/v/r)', () => {
    it('detects 802.11r Fast BSS Transition from Tag 54 (Mobility Domain)', () => {
      // Beacon frame with Tag 54 (Length 3)
      const buffer = new Uint8Array([
        0x80, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x64, 0x00, 0x11, 0x00,
        // Tag 0 (SSID)
        0x00, 0x04, 0x54, 0x65, 0x73, 0x74,
        // Tag 54 (Mobility Domain, 802.11r)
        0x36, 0x03, 0x01, 0x02, 0x00
      ]);

      const parsed = parse80211Frame(buffer);
      expect(parsed).not.toBeNull();
      expect(parsed.roaming).toBeDefined();
      expect(parsed.roaming.r).toBe(true);
      expect(parsed.roaming.k).toBe(false);
      expect(parsed.roaming.v).toBe(false);
    });

    it('detects 802.11k Radio Measurement from Tag 70', () => {
      // Beacon with Tag 70 (RM Enabled Capabilities)
      const buffer = new Uint8Array([
        0x80, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x64, 0x00, 0x11, 0x00,
        // Tag 0 (SSID)
        0x00, 0x04, 0x54, 0x65, 0x73, 0x74,
        // Tag 70 (RM Capabilities, 802.11k)
        0x46, 0x05, 0x01, 0x00, 0x00, 0x00, 0x00
      ]);

      const parsed = parse80211Frame(buffer);
      expect(parsed).not.toBeNull();
      expect(parsed.roaming.k).toBe(true);
      expect(parsed.roaming.v).toBe(false);
      expect(parsed.roaming.r).toBe(false);
    });

    it('detects 802.11v BSS Transition Management from Tag 127', () => {
      // Beacon with Tag 127 (Extended Capabilities, Octet 3 bit 3 = BSS Transition)
      const buffer = new Uint8Array([
        0x80, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x64, 0x00, 0x11, 0x00,
        // Tag 0 (SSID)
        0x00, 0x04, 0x54, 0x65, 0x73, 0x74,
        // Tag 127 (Extended Capabilities, length 4, byte 2 has bit 3 (0x08) set)
        0x7F, 0x04, 0x00, 0x00, 0x08, 0x00
      ]);

      const parsed = parse80211Frame(buffer);
      expect(parsed).not.toBeNull();
      expect(parsed.roaming.v).toBe(true);
      expect(parsed.roaming.k).toBe(false);
      expect(parsed.roaming.r).toBe(false);
    });

    it('identifies full enterprise roaming suite (k, v, and r together)', () => {
      const buffer = new Uint8Array([
        0x80, 0x00, 0x00, 0x00,
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x64, 0x00, 0x11, 0x00,
        // Tag 0 (SSID)
        0x00, 0x04, 0x54, 0x65, 0x73, 0x74,
        // Tag 54 (802.11r)
        0x36, 0x02, 0x12, 0x34,
        // Tag 70 (802.11k)
        0x46, 0x01, 0x01,
        // Tag 127 (802.11v)
        0x7F, 0x03, 0x00, 0x00, 0x08
      ]);

      const parsed = parse80211Frame(buffer);
      expect(parsed).not.toBeNull();
      expect(parsed.roaming).toEqual({
        k: true,
        v: true,
        r: true
      });
    });
  });

  describe('Browser Notification API Integration & Throttling Logic', () => {
    it('requests notification permission cleanly without throwing exceptions', async () => {
      const perm = await Notification.requestPermission();
      expect(perm).toBe('granted');
      expect(Notification.requestPermission).toHaveBeenCalled();
    });

    it('dispatches desktop notification instance with proper title and body', () => {
      const n = new Notification('Device Missing', {
        body: 'Watchlist device 00:11:22:33:44:55 is no longer in range.'
      });
      expect(n.title).toBe('Device Missing');
      expect(n.options.body).toContain('00:11:22:33:44:55');
      expect(Notification.instances.length).toBe(1);
    });

    it('enforces 60-second cooldown per event/key to prevent spamming', () => {
      const cooldownMap = {};
      const dispatchThrottled = (key, title, body) => {
        const now = Date.now();
        const lastSent = cooldownMap[key] || 0;
        if (now - lastSent < 60000) {
          return false; // Throttled
        }
        cooldownMap[key] = now;
        new Notification(title, { body });
        return true;
      };

      const key = 'missing_AA:BB:CC:DD:EE:FF';
      // 1st dispatch succeeds
      expect(dispatchThrottled(key, 'Device Missing', 'Target out of range')).toBe(true);
      expect(Notification.instances.length).toBe(1);

      // 2nd immediate dispatch throttled
      expect(dispatchThrottled(key, 'Device Missing', 'Target out of range')).toBe(false);
      expect(Notification.instances.length).toBe(1);

      // Different key succeeds
      const widsKey = 'wids_link_state_anomaly';
      expect(dispatchThrottled(widsKey, 'Anomaly Detected', 'Link state flood')).toBe(true);
      expect(Notification.instances.length).toBe(2);
    });
  });
});
