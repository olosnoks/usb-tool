import { describe, it, expect } from 'vitest';
import {
  CHANNELS_24_PRIMARY,
  CHANNELS_5_PRIMARY,
  calculateChannelCongestion,
  getChannelRecommendations
} from '../src/utils/channelAdvisor.js';

describe('Channel Planning Advisor (channelAdvisor.js)', () => {
  describe('Primary Channel Sets', () => {
    it('defines standard non-overlapping 2.4 GHz channels (1, 6, 11)', () => {
      expect(CHANNELS_24_PRIMARY).toEqual([1, 6, 11]);
    });

    it('defines standard UNII-1 and UNII-3 5 GHz channels', () => {
      expect(CHANNELS_5_PRIMARY).toContain(36);
      expect(CHANNELS_5_PRIMARY).toContain(40);
      expect(CHANNELS_5_PRIMARY).toContain(149);
      expect(CHANNELS_5_PRIMARY).toContain(157);
    });
  });

  describe('calculateChannelCongestion', () => {
    it('returns 0 congestion for an empty channel', () => {
      const res = calculateChannelCongestion(6, {}, {});
      expect(res.channel).toBe(6);
      expect(res.congestionScore).toBe(0);
      expect(res.apCount).toBe(0);
      expect(res.reason).toContain('completely clear');
    });

    it('increases congestion score when multiple co-channel APs exist', () => {
      const mockDevices = {
        '00:11:22:33:44:55': { bssid: '00:11:22:33:44:55', channel: 1, rssi: -60 },
        '00:11:22:33:44:56': { bssid: '00:11:22:33:44:56', channel: 1, rssi: -65 },
        '00:11:22:33:44:57': { bssid: '00:11:22:33:44:57', channel: 1, rssi: -78 }
      };

      const res = calculateChannelCongestion(1, mockDevices, { 1: 500 });
      expect(res.apCount).toBe(3);
      expect(res.strongApCount).toBe(2);
      expect(res.congestionScore).toBeGreaterThan(40);
    });
  });

  describe('getChannelRecommendations', () => {
    it('recommends the least congested 2.4 GHz channel', () => {
      // Channel 1 heavily loaded, Channel 11 moderately loaded, Channel 6 completely clear
      const mockDevices = {
        'ap1': { bssid: 'ap1', channel: 1, rssi: -55 },
        'ap2': { bssid: 'ap2', channel: 1, rssi: -62 },
        'ap3': { bssid: 'ap3', channel: 1, rssi: -70 },
        'ap4': { bssid: 'ap4', channel: 11, rssi: -80 }
      };

      const mockStats = { 1: 1200, 11: 150, 6: 0 };
      const rec = getChannelRecommendations({
        devices: mockDevices,
        channelStats: mockStats
      });

      expect(rec.recommended24.channel).toBe(6);
      expect(rec.recommended24.congestionScore).toBe(0);
      expect(rec.recommended24.reason).toContain('Channel 6 has the lowest congestion');
      expect(rec.recommended24.reason).toContain('Channel 1');
    });

    it('recommends the top 3 least congested 5 GHz channels', () => {
      // 36 and 40 have APs, remaining channels 44, 48, 149, 153, 157, 161 are clear
      const mockDevices = {
        'ap_5g_1': { bssid: 'ap_5g_1', channel: 36, rssi: -50 },
        'ap_5g_2': { bssid: 'ap_5g_2', channel: 40, rssi: -58 }
      };

      const mockStats = { 36: 800, 40: 600 };
      const rec = getChannelRecommendations({
        devices: mockDevices,
        channelStats: mockStats
      });

      expect(rec.recommended5.length).toBe(3);
      const topChannels = rec.recommended5.map(c => c.channel);
      expect(topChannels).not.toContain(36);
      expect(topChannels).not.toContain(40);
      expect(rec.recommended5[0].congestionScore).toBe(0);
    });

    it('handles empty environments gracefully', () => {
      const rec = getChannelRecommendations();
      expect([1, 6, 11]).toContain(rec.recommended24.channel);
      expect(rec.recommended5.length).toBe(3);
    });
  });
});
