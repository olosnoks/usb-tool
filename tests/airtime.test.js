import { describe, it, expect, beforeEach } from 'vitest';
import { extractDurationUs, calculateAirtime, AirtimeTracker } from '../src/utils/airtimeCalculator.js';
import { fastFilterPacket, parseMacToBytes, matchMacBytes } from '../src/utils/packetFilter.js';
import { queryHardwareIntrospection } from '../src/utils/alfaWifiDriver.js';

describe('Phase 17 — Airtime Utilization & Duration Calculation', () => {
  describe('extractDurationUs', () => {
    it('returns 0 for short or empty buffers', () => {
      expect(extractDurationUs(null)).toBe(0);
      expect(extractDurationUs(new Uint8Array([]))).toBe(0);
      expect(extractDurationUs(new Uint8Array([0x80, 0x00]))).toBe(0);
    });

    it('extracts 2-byte little-endian duration field at macOffset + 2', () => {
      // Frame Control: 0x80, 0x00 (Beacon)
      // Duration: 0x3A, 0x01 (0x013A = 314 microseconds)
      const buffer = new Uint8Array([0x80, 0x00, 0x3A, 0x01, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
      const duration = extractDurationUs(buffer, 0);
      expect(duration).toBe(314);
    });

    it('supports custom macOffset (e.g. after Radiotap header)', () => {
      // 8-byte Radiotap header followed by 802.11 header
      const radiotap = [0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00];
      const macHeader = [0x08, 0x01, 0xE8, 0x03]; // Duration: 0x03E8 = 1000 µs
      const buffer = new Uint8Array([...radiotap, ...macHeader]);
      
      const duration = extractDurationUs(buffer, 8);
      expect(duration).toBe(1000);
    });

    it('returns 0 for values where bit 15 is 1 (exceeding 32767 µs, e.g. AID values)', () => {
      // 0xC001 = 49153 (bit 15 set)
      const buffer = new Uint8Array([0x80, 0x00, 0x01, 0xC0]);
      const duration = extractDurationUs(buffer, 0);
      expect(duration).toBe(0);
    });

    it('supports boundary value of 32767 µs', () => {
      // 0x7FFF = 32767 µs
      const buffer = new Uint8Array([0x80, 0x00, 0xFF, 0x7F]);
      const duration = extractDurationUs(buffer, 0);
      expect(duration).toBe(32767);
    });
  });

  describe('calculateAirtime', () => {
    it('returns 0% and normal congestion for empty records', () => {
      const res = calculateAirtime([]);
      expect(res.airtimePercent).toBe(0);
      expect(res.totalDurationUs).toBe(0);
      expect(res.frameCount).toBe(0);
      expect(res.congestionLevel).toBe('normal');
    });

    it('calculates exact airtime percentage over a 1-second (1,000,000 µs) window', () => {
      const now = 100000;
      // 250,000 µs total duration in 1 second = 25.0%
      const records = [
        { timestamp: now - 800, duration: 100000 },
        { timestamp: now - 500, duration: 100000 },
        { timestamp: now - 200, duration: 50000 }
      ];

      const res = calculateAirtime(records, now, 1000);
      expect(res.totalDurationUs).toBe(250000);
      expect(res.frameCount).toBe(3);
      expect(res.airtimePercent).toBe(25.0);
      expect(res.congestionLevel).toBe('normal'); // < 40%
    });

    it('assigns "warning" congestion level for airtime between 40% and 70%', () => {
      const now = 200000;
      // 550,000 µs total duration = 55.0%
      const records = [
        { timestamp: now - 400, duration: 300000 },
        { timestamp: now - 100, duration: 250000 }
      ];

      const res = calculateAirtime(records, now, 1000);
      expect(res.airtimePercent).toBe(55.0);
      expect(res.congestionLevel).toBe('warning');
    });

    it('assigns "critical" congestion level for airtime > 70%', () => {
      const now = 300000;
      // 780,000 µs total duration = 78.0%
      const records = [
        { timestamp: now - 700, duration: 400000 },
        { timestamp: now - 300, duration: 380000 }
      ];

      const res = calculateAirtime(records, now, 1000);
      expect(res.airtimePercent).toBe(78.0);
      expect(res.congestionLevel).toBe('critical');
    });

    it('clamps airtime to 100% when cumulative duration exceeds 1,000,000 µs', () => {
      const now = 400000;
      const records = [
        { timestamp: now - 200, duration: 600000 },
        { timestamp: now - 100, duration: 700000 }
      ];

      const res = calculateAirtime(records, now, 1000);
      expect(res.airtimePercent).toBe(100);
      expect(res.congestionLevel).toBe('critical');
    });

    it('ignores records older than the 1000ms rolling window', () => {
      const now = 500000;
      const records = [
        { timestamp: now - 2500, duration: 800000 }, // Expired (> 1000ms ago)
        { timestamp: now - 1200, duration: 500000 }, // Expired
        { timestamp: now - 400, duration: 150000 }   // Valid
      ];

      const res = calculateAirtime(records, now, 1000);
      expect(res.totalDurationUs).toBe(150000);
      expect(res.frameCount).toBe(1);
      expect(res.airtimePercent).toBe(15.0);
    });
  });

  describe('AirtimeTracker class', () => {
    let tracker;

    beforeEach(() => {
      tracker = new AirtimeTracker(1000);
    });

    it('records frames and computes metrics', () => {
      const t0 = 1000;
      tracker.addFrame(200000, t0);
      tracker.addFrame(150000, t0 + 200);

      const stats = tracker.getAirtime(t0 + 500);
      expect(stats.totalDurationUs).toBe(350000);
      expect(stats.airtimePercent).toBe(35.0);
      expect(stats.congestionLevel).toBe('normal');
    });

    it('prunes expired frames as time progresses', () => {
      const t0 = 1000;
      tracker.addFrame(300000, t0);
      tracker.addFrame(200000, t0 + 500);

      // Advance time to t0 + 1200 -> t0 frame should be pruned
      tracker.prune(t0 + 1200);
      const stats = tracker.getAirtime(t0 + 1200);

      expect(stats.totalDurationUs).toBe(200000);
      expect(stats.airtimePercent).toBe(20.0);
    });

    it('clears all records on reset()', () => {
      tracker.addFrame(500000, 1000);
      expect(tracker.getAirtime(1000).airtimePercent).toBe(50.0);
      tracker.reset();
      expect(tracker.getAirtime(1000).airtimePercent).toBe(0);
    });
  });
});

describe('Phase 17 — Pre-Worker Dynamic Telemetry Filtering Pipeline', () => {
  describe('parseMacToBytes', () => {
    it('converts colon and hyphen delimited MAC strings to 6-byte arrays', () => {
      expect(parseMacToBytes('00:C0:CA:98:76:54')).toEqual([0x00, 0xC0, 0xCA, 0x98, 0x76, 0x54]);
      expect(parseMacToBytes('00-c0-ca-98-76-54')).toEqual([0x00, 0xC0, 0xCA, 0x98, 0x76, 0x54]);
    });

    it('returns null for invalid MAC strings', () => {
      expect(parseMacToBytes('')).toBeNull();
      expect(parseMacToBytes('invalid')).toBeNull();
      expect(parseMacToBytes('00:11:22:33:44')).toBeNull();
      expect(parseMacToBytes('00:11:22:33:44:ZZ')).toBeNull();
    });
  });

  describe('matchMacBytes', () => {
    const target = [0x00, 0x11, 0x22, 0x33, 0x44, 0x55];
    const buffer = new Uint8Array([0xAA, 0xBB, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0xCC]);

    it('matches target MAC at the given offset', () => {
      expect(matchMacBytes(buffer, 2, target)).toBe(true);
      expect(matchMacBytes(buffer, 0, target)).toBe(false);
    });
  });

  describe('fastFilterPacket', () => {
    // Construct a mock Management Beacon frame (Type 0, Subtype 8)
    // Frame Control: 0x80, 0x00
    // Duration: 0x00, 0x00
    // Addr1 (DA): FF:FF:FF:FF:FF:FF
    // Addr2 (SA): 00:C0:CA:11:22:33
    // Addr3 (BSSID): 00:C0:CA:11:22:33
    const beaconFrame = new Uint8Array([
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0xC0, 0xCA, 0x11, 0x22, 0x33,
      0x00, 0xC0, 0xCA, 0x11, 0x22, 0x33,
      0x00, 0x00
    ]);

    // Construct a mock Data QoS frame (Type 2, Subtype 8)
    // Frame Control: 0x88, 0x01 (To DS)
    const dataFrame = new Uint8Array([
      0x88, 0x01, 0x30, 0x00,
      0x00, 0xC0, 0xCA, 0x11, 0x22, 0x33,
      0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF,
      0x00, 0xC0, 0xCA, 0x11, 0x22, 0x33,
      0x10, 0x00
    ]);

    // Construct a mock Control ACK frame (Type 1, Subtype 13)
    // Frame Control: 0xD4, 0x00
    const ackFrame = new Uint8Array([
      0xD4, 0x00, 0x00, 0x00,
      0x00, 0xC0, 0xCA, 0x11, 0x22, 0x33
    ]);

    it('passes standard frames when no filters are active', () => {
      expect(fastFilterPacket(beaconFrame, {})).toBe(true);
      expect(fastFilterPacket(dataFrame, {})).toBe(true);
      expect(fastFilterPacket(ackFrame, {})).toBe(true);
    });

    it('filters out Management frames when ignoreManagement is true', () => {
      expect(fastFilterPacket(beaconFrame, { ignoreManagement: true })).toBe(false);
      expect(fastFilterPacket(dataFrame, { ignoreManagement: true })).toBe(true);
    });

    it('filters out Data frames when ignoreData is true', () => {
      expect(fastFilterPacket(dataFrame, { ignoreData: true })).toBe(false);
      expect(fastFilterPacket(beaconFrame, { ignoreData: true })).toBe(true);
    });

    it('filters out Control frames when ignoreControl is true', () => {
      expect(fastFilterPacket(ackFrame, { ignoreControl: true })).toBe(false);
      expect(fastFilterPacket(beaconFrame, { ignoreControl: true })).toBe(true);
    });

    it('filters frames by specific target MAC address', () => {
      // Matching MAC
      expect(fastFilterPacket(beaconFrame, { macFilter: '00:C0:CA:11:22:33' })).toBe(true);
      // Non-matching MAC
      expect(fastFilterPacket(beaconFrame, { macFilter: 'DE:AD:BE:EF:00:01' })).toBe(false);
    });
  });
});

describe('Phase 17 — Hardware Endpoint Introspection', () => {
  it('returns valid fallback introspection metadata when device or wasm is not connected', async () => {
    const info = await queryHardwareIntrospection(null, null);
    expect(info).toBeDefined();
    expect(info.adapterMac).toBe('00:C0:CA:98:76:54');
    expect(info.firmwareVersion).toContain('rtl8812au_fw');
    expect(info.chipsetModel).toContain('RTL8812AU');
    expect(info.status).toContain('Fallback Defaults');
  });

  it('queries simulated or mock driver methods when available', async () => {
    const mockRadio = {
      readThermalStatus: () => 46,
      adapterCapabilities: () => ({
        macAddress: '00:C0:CA:AB:CD:EF',
        firmware: 'v3.1.0-custom'
      })
    };

    const info = await queryHardwareIntrospection(mockRadio, null);
    expect(info.temperatureC).toBe(46);
    expect(info.adapterMac).toBe('00:C0:CA:AB:CD:EF');
    expect(info.firmwareVersion).toBe('v3.1.0-custom');
    expect(info.isIntrospected).toBe(true);
  });
});
