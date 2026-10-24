import { describe, it, expect } from 'vitest';
import { detectEapolFrame, HandshakeTracker } from '../src/utils/handshakeDetector';

describe('WPA 4-Way Handshake (EAPOL) Detector Suite', () => {
  // Helper to generate mock EAPOL frames
  const createMockEapolFrame = ({
    fromAp = true,
    bssid = [0x80, 0x86, 0xf2, 0x33, 0x44, 0x55],
    client = [0x3c, 0x22, 0xfb, 0x44, 0x55, 0x66],
    keyInfo = 0x008a // M1 default: Pairwise + ACK
  }) => {
    const fc = fromAp ? [0x88, 0x02] : [0x88, 0x01]; // FromDS or ToDS
    const addr1 = fromAp ? client : bssid;
    const addr2 = fromAp ? bssid : client;
    const addr3 = bssid;

    const frame = [
      ...fc,
      0x00, 0x00, // Duration
      ...addr1,
      ...addr2,
      ...addr3,
      0x10, 0x00, // Seq
      0x00, 0x00, // QoS Ctrl
      // LLC / SNAP
      0xaa, 0xaa, 0x03, 0x00, 0x00, 0x00, 0x88, 0x8e,
      // EAPOL Header
      0x02, // Version
      0x03, // Type: Key
      0x00, 0x5f, // Length = 95
      // Key Descriptor
      0x02, // RSN
      (keyInfo >> 8) & 0xff, keyInfo & 0xff, // Key Info (2 bytes)
      0x00, 0x10, // Key Length = 16
      // Replay Counter (8 bytes)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
      // Nonce (32 bytes)
      ...new Array(32).fill(0x5a),
      // IV (16 bytes)
      ...new Array(16).fill(0x00),
      // RSC (8 bytes)
      ...new Array(8).fill(0x00),
      // ID (8 bytes)
      ...new Array(8).fill(0x00),
      // MIC (16 bytes)
      ...new Array(16).fill(0xab),
      // Key Data Length (2 bytes)
      0x00, 0x00
    ];

    return new Uint8Array(frame);
  };

  it('detects an EAPOL M1 frame (AP -> Client, ACK=1, MIC=0)', () => {
    // M1: Pairwise (bit 3 = 0x08), ACK (bit 7 = 0x80), Version 2 = 0x02 -> 0x008a
    const m1Buffer = createMockEapolFrame({
      fromAp: true,
      keyInfo: 0x008a
    });

    const result = detectEapolFrame(m1Buffer);
    expect(result).not.toBeNull();
    expect(result.isEapol).toBe(true);
    expect(result.message).toBe('M1');
    expect(result.messageNumber).toBe(1);
    expect(result.isPairwise).toBe(true);
    expect(result.bssid).toBe('80:86:F2:33:44:55');
    expect(result.clientMac).toBe('3C:22:FB:44:55:66');
    expect(result.descriptorType).toBe('RSN (WPA2/WPA3)');
  });

  it('detects an EAPOL M2 frame (Client -> AP, ACK=0, MIC=1)', () => {
    // M2: Pairwise (bit 3 = 0x08), MIC (bit 8 = 0x0100), Version 2 = 0x02 -> 0x010a
    const m2Buffer = createMockEapolFrame({
      fromAp: false,
      keyInfo: 0x010a
    });

    const result = detectEapolFrame(m2Buffer);
    expect(result).not.toBeNull();
    expect(result.isEapol).toBe(true);
    expect(result.message).toBe('M2');
    expect(result.messageNumber).toBe(2);
    expect(result.bssid).toBe('80:86:F2:33:44:55');
    expect(result.clientMac).toBe('3C:22:FB:44:55:66');
  });

  it('detects an EAPOL M3 frame (AP -> Client, ACK=1, MIC=1)', () => {
    // M3: Pairwise (0x08) | Install (0x40) | ACK (0x80) | MIC (0x100) | Version 2 (0x02) -> 0x01ca
    const m3Buffer = createMockEapolFrame({
      fromAp: true,
      keyInfo: 0x01ca
    });

    const result = detectEapolFrame(m3Buffer);
    expect(result).not.toBeNull();
    expect(result.message).toBe('M3');
    expect(result.messageNumber).toBe(3);
  });

  it('detects an EAPOL M4 frame (Client -> AP, ACK=0, MIC=1, Secure=1)', () => {
    // M4: Pairwise (0x08) | MIC (0x100) | Secure (0x200) | Version 2 (0x02) -> 0x030a
    const m4Buffer = createMockEapolFrame({
      fromAp: false,
      keyInfo: 0x030a
    });

    const result = detectEapolFrame(m4Buffer);
    expect(result).not.toBeNull();
    expect(result.message).toBe('M4');
    expect(result.messageNumber).toBe(4);
  });

  it('returns null for non-EAPOL data frames or short buffers', () => {
    expect(detectEapolFrame(null)).toBeNull();
    expect(detectEapolFrame(new Uint8Array([0x01, 0x02, 0x03]))).toBeNull();
    // Normal IP Data packet with 0x0800 instead of 0x888E
    const normalData = new Uint8Array([
      0x88, 0x01, 0x00, 0x00,
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
      0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
      0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
      0x00, 0x00, 0xaa, 0xaa, 0x03, 0x00, 0x00, 0x00, 0x08, 0x00, 0x45, 0x00
    ]);
    expect(detectEapolFrame(normalData)).toBeNull();
  });

  it('tracks handshakes across multiple frames and flags completeness on M1 + M2', () => {
    const tracker = new HandshakeTracker();
    const m1Buffer = createMockEapolFrame({ fromAp: true, keyInfo: 0x008a });
    const m2Buffer = createMockEapolFrame({ fromAp: false, keyInfo: 0x010a });

    // Step 1: Process M1
    const res1 = tracker.processPacket(m1Buffer);
    expect(res1).not.toBeNull();
    expect(res1.isComplete).toBe(false);
    expect(res1.isNewComplete).toBe(false);
    expect(tracker.hasHandshake('80:86:F2:33:44:55')).toBe(false);

    // Step 2: Process M2 (completes the 4-way handshake for cracking)
    const res2 = tracker.processPacket(m2Buffer);
    expect(res2).not.toBeNull();
    expect(res2.isComplete).toBe(true);
    expect(res2.isNewComplete).toBe(true);
    expect(res2.capturedMessages).toEqual(['M1', 'M2']);
    expect(tracker.hasHandshake('80:86:F2:33:44:55')).toBe(true);

    // Step 3: Verify records retrieval
    const bssidHandshakes = tracker.getHandshakesForBssid('80:86:F2:33:44:55');
    expect(bssidHandshakes.length).toBe(1);
    expect(bssidHandshakes[0].clientMac).toBe('3C:22:FB:44:55:66');
    expect(bssidHandshakes[0].isComplete).toBe(true);

    const all = tracker.getAllHandshakes();
    expect(all.length).toBe(1);

    // Step 4: Clear tracker
    tracker.clear();
    expect(tracker.hasHandshake('80:86:F2:33:44:55')).toBe(false);
  });
});
