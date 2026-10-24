import { describe, it, expect } from 'vitest';
import { parse80211Frame, formatMac, freqToChannel, lookupVendor } from '../src/utils/wifiParser';

describe('Wi-Fi Frame Parser (wifiParser.js)', () => {
  it('correctly maps frequencies to 802.11 channels', () => {
    expect(freqToChannel(2412)).toBe(1);
    expect(freqToChannel(2437)).toBe(6);
    expect(freqToChannel(2462)).toBe(11);
    expect(freqToChannel(2484)).toBe(14);
    expect(freqToChannel(5180)).toBe(36);
    expect(freqToChannel(5200)).toBe(40);
    expect(freqToChannel(5500)).toBe(100);
  });

  it('formats 6-byte MAC addresses and resolves OUI vendor', () => {
    const bytes = new Uint8Array([0x00, 0x0a, 0x95, 0x9d, 0x68, 0x16]);
    expect(formatMac(bytes, 0)).toBe('00:0A:95:9D:68:16');
    expect(lookupVendor('00:17:F2:11:22:33')).toBe('Apple');
    expect(lookupVendor('24:6F:28:AA:BB:CC')).toBe('Espressif');
    expect(lookupVendor('00:C0:CA:99:88:77')).toBe('Alfa Network');
    expect(lookupVendor('FF:FF:FF:FF:FF:FF')).toBe('Unknown OUI');
  });

  it('parses a Beacon frame with Radiotap header and WPA2 RSN security', () => {
    // 1. Radiotap Header: 9 bytes, present = 0x20 (bit 5: dBm antenna signal)
    const radiotap = [
      0x00, 0x00,             // version 0, pad 0
      0x09, 0x00,             // it_len = 9 bytes
      0x20, 0x00, 0x00, 0x00, // present mask bit 5 (dBm signal)
      0xD3                    // -45 dBm
    ];

    // 2. 802.11 MAC Header: 24 bytes (FC Beacon 0x0080)
    const macHeader = [
      0x80, 0x00,                         // Frame Control: Subtype 8 (Beacon), Type 0 (Mgmt)
      0x00, 0x00,                         // Duration / ID
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // Destination (Broadcast)
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // Source MAC (00:11:22:33:44:55)
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // BSSID (00:11:22:33:44:55)
      0x10, 0x00                          // Sequence control
    ];

    // 3. Fixed Management Parameters: 12 bytes with Privacy bit set (0x31 0x04)
    const fixedParams = [
      0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, // Timestamp (8 bytes)
      0x64, 0x00,                                     // Beacon Interval (100 TU)
      0x11, 0x00                                      // Capability info (Privacy bit 4 set = 0x0010)
    ];

    // 4. Tagged Parameters (IEs):
    // Tag 0 (SSID): "Corp_Net"
    const tagSsid = [0x00, 0x08, 0x43, 0x6f, 0x72, 0x70, 0x5f, 0x4e, 0x65, 0x74];
    // Tag 3 (DS Parameter / Channel): 36
    const tagChannel = [0x03, 0x01, 0x24];
    // Tag 48 (RSN IE for WPA2): tag 48, len 18 (0x12)
    const tagRsnWpa2 = [
      0x30, 0x12,
      0x01, 0x00,                         // Version 1
      0x00, 0x0F, 0xAC, 0x04,             // Group cipher: CCMP
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x04, // Pairwise: 1 suite (CCMP)
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x02  // AKM: 1 suite (PSK = WPA2)
    ];

    const rawBuffer = new Uint8Array([
      ...radiotap,
      ...macHeader,
      ...fixedParams,
      ...tagSsid,
      ...tagChannel,
      ...tagRsnWpa2
    ]);

    const result = parse80211Frame(rawBuffer);

    expect(result).not.toBeNull();
    expect(result.type).toBe('Beacon');
    expect(result.sourceMac).toBe('00:11:22:33:44:55');
    expect(result.bssid).toBe('00:11:22:33:44:55');
    expect(result.ssid).toBe('Corp_Net');
    expect(result.security).toBe('WPA2');
    expect(result.channel).toBe(36);
    expect(result.rssi).toBe(-45);
  });

  it('parses WPA3 Beacon with SAE AKM suite', () => {
    const macHeader = [
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x20, 0x00
    ];
    const fixedParams = new Array(12).fill(0);
    fixedParams[10] = 0x10; // Privacy bit set

    const tagSsid = [0x00, 0x05, 0x57, 0x50, 0x41, 0x33, 0x5f];
    // Tag 48 with AKM Suite Type 8 (SAE -> WPA3, len 18 bytes)
    const tagRsnWpa3 = [
      0x30, 0x12,
      0x01, 0x00,
      0x00, 0x0F, 0xAC, 0x04,
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x04,
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x08  // AKM 8 = SAE (WPA3)
    ];

    const rawBuffer = new Uint8Array([
      ...macHeader,
      ...fixedParams,
      ...tagSsid,
      ...tagRsnWpa3
    ]);

    const result = parse80211Frame(rawBuffer);
    expect(result).not.toBeNull();
    expect(result.security).toBe('WPA3');
    expect(result.isMixedMode).toBe(false);
  });

  it('detects Mixed-Mode encryption (WPA2/WPA3) when both PSK and SAE are advertised', () => {
    const macHeader = [
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x20, 0x00
    ];
    const fixedParams = new Array(12).fill(0);
    fixedParams[10] = 0x10; // Privacy bit set

    const tagSsid = [0x00, 0x0A, ...Array.from(new TextEncoder().encode('Mixed_Mesh'))];
    // Tag 48 with 2 AKM suites: AKM 2 (PSK) and AKM 8 (SAE) -> 22 bytes total
    const tagRsnMixed = [
      0x30, 0x16,                         // Tag 48, len 22
      0x01, 0x00,                         // Version 1
      0x00, 0x0F, 0xAC, 0x04,             // Group cipher: CCMP
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x04, // Pairwise: 1 suite (CCMP)
      0x02, 0x00,                         // AKM Count = 2
      0x00, 0x0F, 0xAC, 0x02,             // AKM 1: PSK (WPA2)
      0x00, 0x0F, 0xAC, 0x08              // AKM 2: SAE (WPA3)
    ];

    const rawBuffer = new Uint8Array([
      ...macHeader,
      ...fixedParams,
      ...tagSsid,
      ...tagRsnMixed
    ]);

    const result = parse80211Frame(rawBuffer);
    expect(result).not.toBeNull();
    expect(result.isMixedMode).toBe(true);
    expect(result.security).toBe('WPA2/WPA3 Mixed');
  });

  it('parses an Open network when privacy bit is cleared', () => {
    const macHeader = [
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x30, 0x00
    ];
    const fixedParams = new Array(12).fill(0); // Privacy bit is 0
    const tagSsid = [0x00, 0x04, 0x4f, 0x70, 0x65, 0x6e];

    const result = parse80211Frame(new Uint8Array([...macHeader, ...fixedParams, ...tagSsid]));
    expect(result).not.toBeNull();
    expect(result.security).toBe('Open');
  });

  it('parses Data frames and extracts client station MAC and traffic direction', () => {
    // QoS Data Frame (Type 2, Subtype 8)
    // ToDS = 1, FromDS = 0 (Client -> AP): FC = 0x0188
    const dataFrame = new Uint8Array([
      0x88, 0x01,                         // FC: ToDS=1, FromDS=0
      0x00, 0x00,                         // Duration
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // Addr1 = AP BSSID
      0x3C, 0x22, 0xFB, 0x44, 0x55, 0x66, // Addr2 = Client STA (Apple)
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // Addr3 = DA
      0x40, 0x00                          // Seq
    ]);

    const result = parse80211Frame(dataFrame);
    expect(result).not.toBeNull();
    expect(result.frameCategory).toBe('Data');
    expect(result.type).toBe('QoS Data');
    expect(result.direction).toBe('Client -> AP');
    expect(result.stationMac).toBe('3C:22:FB:44:55:66');
    expect(result.bssid).toBe('00:11:22:33:44:55');
    expect(result.vendor).toBe('Apple');
  });

  it('parses Deauthentication frames and extracts reason code', () => {
    // Deauth frame: Type 0 (Mgmt), Subtype 12 (0x0C) -> FC = 0x00C0
    const deauthFrame = new Uint8Array([
      0xC0, 0x00,                         // FC Deauth
      0x00, 0x00,                         // Duration
      0x3C, 0x22, 0xFB, 0x44, 0x55, 0x66, // Dest = Target STA
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // Source = AP
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, // BSSID
      0x50, 0x00,                         // Seq
      0x07, 0x00                          // Reason Code: 7 (Class 3 from non-assoc STA)
    ]);

    const result = parse80211Frame(deauthFrame);
    expect(result).not.toBeNull();
    expect(result.type).toBe('Deauth');
    expect(result.isDeauth).toBe(true);
    expect(result.reasonCode).toBe(7);
    expect(result.reasonDescription).toContain('Class 3');
    expect(result.stationMac).toBe('3C:22:FB:44:55:66');
  });

  it('returns null for control frames and invalid buffers', () => {
    // Control ACK Frame (Type 1, Subtype 13)
    const ackFrame = new Uint8Array([0xd4, 0x00, 0x00, 0x00, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55]);
    expect(parse80211Frame(ackFrame)).toBeNull();
    expect(parse80211Frame(null)).toBeNull();
    expect(parse80211Frame(new Uint8Array([0x01, 0x02]))).toBeNull();
  });

  it('parses Radiotap Antenna Noise Floor and calculates Signal-to-Noise Ratio (SNR = RSSI - NoiseFloor)', () => {
    // Radiotap header: 10 bytes
    // present = 0x60 (bit 5: dBm Antenna Signal, bit 6: dBm Antenna Noise)
    const radiotap = [
      0x00, 0x00,             // version 0, pad 0
      0x0A, 0x00,             // it_len = 10 bytes
      0x60, 0x00, 0x00, 0x00, // present mask: bit 5 (0x20) + bit 6 (0x40)
      0xD3,                   // -45 dBm Antenna Signal (256 - 45 = 211 = 0xD3)
      0xA1                    // -95 dBm Antenna Noise Floor (256 - 95 = 161 = 0xA1)
    ];

    const macHeader = [
      0x80, 0x00,                         // FC Beacon
      0x00, 0x00,                         // Duration
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, // DA
      0x00, 0xC0, 0xCA, 0x11, 0x22, 0x33, // SA
      0x00, 0xC0, 0xCA, 0x11, 0x22, 0x33, // BSSID
      0x00, 0x00                          // Seq
    ];

    const fixedParams = new Array(12).fill(0);
    fixedParams[10] = 0x10; // Privacy bit

    const tagSsid = [0x00, 0x09, ...Array.from(new TextEncoder().encode('Alfa_SNR95'))];

    const rawBuffer = new Uint8Array([
      ...radiotap,
      ...macHeader,
      ...fixedParams,
      ...tagSsid
    ]);

    const result = parse80211Frame(rawBuffer);
    expect(result).not.toBeNull();
    expect(result.rssi).toBe(-45);
    expect(result.noiseFloor).toBe(-95);
    expect(result.snr).toBe(50); // -45 - (-95) = 50 dB (excellent)
  });

  it('parses 802.11w Management Frame Protection (MFP) capabilities in Tag 48 (Supported vs Required)', () => {
    const macHeader = [
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x20, 0x00
    ];
    const fixedParams = new Array(12).fill(0);
    fixedParams[10] = 0x10; // Privacy bit

    const tagSsid = [0x00, 0x08, ...Array.from(new TextEncoder().encode('MFP_Test'))];

    // Case 1: MFP Capable only (RSN Cap Bit 6 = 0x0040)
    const tagRsnMfpSupported = [
      0x30, 0x14,                         // Tag 48, len 20
      0x01, 0x00,                         // Version 1
      0x00, 0x0F, 0xAC, 0x04,             // Group cipher: CCMP
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x04, // Pairwise: 1 suite (CCMP)
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x08, // AKM: 1 suite (SAE / WPA3)
      0x40, 0x00                          // RSN Capabilities: 0x0040 (Bit 6 MFPC = 1, Bit 7 MFPR = 0)
    ];

    const resSupported = parse80211Frame(new Uint8Array([...macHeader, ...fixedParams, ...tagSsid, ...tagRsnMfpSupported]));
    expect(resSupported).not.toBeNull();
    expect(resSupported.isMfpCapable).toBe(true);
    expect(resSupported.isMfpRequired).toBe(false);
    expect(resSupported.mfp).toBe('supported');

    // Case 2: MFP Required (RSN Cap Bit 6 + Bit 7 = 0x00C0)
    const tagRsnMfpRequired = [
      0x30, 0x14,
      0x01, 0x00,
      0x00, 0x0F, 0xAC, 0x04,
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x04,
      0x01, 0x00, 0x00, 0x0F, 0xAC, 0x08,
      0xC0, 0x00                          // RSN Capabilities: 0x00C0 (Bit 6 MFPC = 1, Bit 7 MFPR = 1)
    ];

    const resRequired = parse80211Frame(new Uint8Array([...macHeader, ...fixedParams, ...tagSsid, ...tagRsnMfpRequired]));
    expect(resRequired).not.toBeNull();
    expect(resRequired.isMfpCapable).toBe(true);
    expect(resRequired.isMfpRequired).toBe(true);
    expect(resRequired.mfp).toBe('required');
  });

  it('detects Wi-Fi 6 (802.11ax) HE Capabilities (Ext 35) and HE Operation BSS Color (Ext 36) in Tag 255', () => {
    const macHeader = [
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0x27, 0x22, 0x88, 0x99, 0xAA,
      0x00, 0x27, 0x22, 0x88, 0x99, 0xAA,
      0x30, 0x00
    ];
    const fixedParams = new Array(12).fill(0);
    fixedParams[10] = 0x10; // Privacy bit
    const tagSsid = [0x00, 0x0A, ...Array.from(new TextEncoder().encode('WiFi6_Corp'))];

    // Tag 255 Ext 35: HE Capabilities
    // Length: 21 bytes (Ext ID 35 + 6 bytes MAC Cap + 11 bytes PHY Cap + 3 bytes MCS)
    const tagHeCap = [
      0xFF, 0x15, // Tag 255, length 21
      0x23,       // Ext ID 35 (HE Capabilities)
      0x08, 0x00, 0x04, 0x00, 0x00, 0x00, // MAC Cap (6 bytes)
      0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // PHY Cap (11 bytes)
      0xFF, 0xFF, 0xFF // Supported MCS
    ];

    // Tag 255 Ext 36: HE Operation
    // Length: 6 bytes (Ext ID 36 + 3 bytes Op Params + 2 bytes BSS Color)
    // Op Params Byte 0: 0x0C (BSS Color = 12, bits 0-5)
    const tagHeOp = [
      0xFF, 0x06, // Tag 255, length 6
      0x24,       // Ext ID 36 (HE Operation)
      0x0C, 0x00, 0x00, // Op Params (Byte 0 = 0x0C -> BSS Color 12)
      0xFF, 0xFF  // Basic MCS
    ];

    const frameBuffer = new Uint8Array([
      ...macHeader,
      ...fixedParams,
      ...tagSsid,
      ...tagHeCap,
      ...tagHeOp
    ]);

    const result = parse80211Frame(frameBuffer);
    expect(result).not.toBeNull();
    expect(result.ssid).toBe('WiFi6_Corp');
    expect(result.isWifi6).toBe(true);
    expect(result.heCapabilities).not.toBeNull();
    expect(result.heCapabilities.macCap).toBe('080004000000');
    expect(result.heCapabilities.phyCap).toBe('0400000000000000000000');
    expect(result.bssColor).toBe(12);
    expect(result.bssColorDisabled).toBe(false);
  });
});
