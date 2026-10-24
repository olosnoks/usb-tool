import { describe, it, expect } from 'vitest';
import {
  formatIpv4,
  formatMacAddress,
  parseArpPayload,
  parseDhcpPayload,
  extractLayer3Metadata
} from '../src/utils/layer3Parser.js';

describe('Layer 3 Telemetry Parser (ARP & DHCP)', () => {
  describe('Helper Formatters', () => {
    it('formats 4 bytes into IPv4 dot-decimal format', () => {
      const bytes = new Uint8Array([192, 168, 1, 105]);
      expect(formatIpv4(bytes, 0)).toBe('192.168.1.105');
      expect(formatIpv4(new Uint8Array([10, 0, 0, 1]))).toBe('10.0.0.1');
      expect(formatIpv4(new Uint8Array([0, 0]))).toBe('0.0.0.0');
    });

    it('formats 6 bytes into colon-separated MAC address string', () => {
      const bytes = new Uint8Array([0x00, 0x1A, 0x2B, 0x3C, 0x4D, 0x5E]);
      expect(formatMacAddress(bytes, 0)).toBe('00:1A:2B:3C:4D:5E');
      expect(formatMacAddress(new Uint8Array([0xAA, 0xBB]))).toBe('00:00:00:00:00:00');
    });
  });

  describe('ARP Parsing', () => {
    it('correctly parses an ARP Request payload', () => {
      // 28-byte ARP Request:
      // HW type: 0x0001 (Ethernet)
      // Proto type: 0x0800 (IPv4)
      // HW len: 6, Proto len: 4
      // Opcode: 0x0001 (Request)
      // Sender MAC: 00:11:22:33:44:55
      // Sender IP: 192.168.1.50
      // Target MAC: 00:00:00:00:00:00
      // Target IP: 192.168.1.1
      const arpBuf = new Uint8Array([
        0x00, 0x01, 0x08, 0x00, 0x06, 0x04, 0x00, 0x01,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        192, 168, 1, 50,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        192, 168, 1, 1
      ]);

      const parsed = parseArpPayload(arpBuf, 0);
      expect(parsed).not.toBeNull();
      expect(parsed.protocol).toBe('ARP');
      expect(parsed.op).toBe('Request');
      expect(parsed.mac).toBe('00:11:22:33:44:55');
      expect(parsed.ip).toBe('192.168.1.50');
      expect(parsed.targetIp).toBe('192.168.1.1');
    });

    it('correctly parses an ARP Reply payload', () => {
      // Opcode: 0x0002 (Reply)
      const arpBuf = new Uint8Array([
        0x00, 0x01, 0x08, 0x00, 0x06, 0x04, 0x00, 0x02,
        0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x01,
        10, 0, 0, 1,
        0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
        10, 0, 0, 200
      ]);

      const parsed = parseArpPayload(arpBuf, 0);
      expect(parsed).not.toBeNull();
      expect(parsed.protocol).toBe('ARP');
      expect(parsed.op).toBe('Reply');
      expect(parsed.mac).toBe('DE:AD:BE:EF:00:01');
      expect(parsed.ip).toBe('10.0.0.1');
    });

    it('returns null on invalid protocol or length', () => {
      const invalid = new Uint8Array([0x00, 0x01, 0x86, 0xDD]); // IPv6 proto type
      expect(parseArpPayload(invalid, 0)).toBeNull();
    });
  });

  describe('DHCP Parsing', () => {
    it('extracts client MAC, assigned IP, and Option 12 Hostname', () => {
      // 240+ byte BOOTP/DHCP buffer
      const dhcpBuf = new Uint8Array(300);
      dhcpBuf[0] = 2; // BOOTREPLY
      dhcpBuf[1] = 1; // Ethernet
      dhcpBuf[2] = 6; // MAC len 6

      // ciaddr (offset 12) = 0.0.0.0
      // yiaddr (offset 16) = 192.168.1.120
      dhcpBuf[16] = 192;
      dhcpBuf[17] = 168;
      dhcpBuf[18] = 1;
      dhcpBuf[19] = 120;

      // chaddr (offset 28) = AA:BB:CC:DD:EE:FF
      dhcpBuf[28] = 0xAA;
      dhcpBuf[29] = 0xBB;
      dhcpBuf[30] = 0xCC;
      dhcpBuf[31] = 0xDD;
      dhcpBuf[32] = 0xEE;
      dhcpBuf[33] = 0xFF;

      // DHCP Magic Cookie (offset 236): 0x63, 0x82, 0x53, 0x63
      dhcpBuf[236] = 0x63;
      dhcpBuf[237] = 0x82;
      dhcpBuf[238] = 0x53;
      dhcpBuf[239] = 0x63;

      // DHCP Options starting at 240:
      // Option 53: DHCP Message Type (ACK = 5)
      dhcpBuf[240] = 53;
      dhcpBuf[241] = 1;
      dhcpBuf[242] = 5;

      // Option 12: Host Name ("MacBook-Pro")
      const hostnameStr = 'MacBook-Pro';
      dhcpBuf[243] = 12;
      dhcpBuf[244] = hostnameStr.length;
      for (let i = 0; i < hostnameStr.length; i++) {
        dhcpBuf[245 + i] = hostnameStr.charCodeAt(i);
      }

      // End Option: 255
      dhcpBuf[245 + hostnameStr.length] = 255;

      const parsed = parseDhcpPayload(dhcpBuf, 0);
      expect(parsed).not.toBeNull();
      expect(parsed.protocol).toBe('DHCP');
      expect(parsed.mac).toBe('AA:BB:CC:DD:EE:FF');
      expect(parsed.ip).toBe('192.168.1.120');
      expect(parsed.hostname).toBe('MacBook-Pro');
      expect(parsed.messageType).toBe('ACK');
    });

    it('returns null if magic cookie is missing', () => {
      const dhcpBuf = new Uint8Array(250);
      dhcpBuf[0] = 1;
      dhcpBuf[1] = 1;
      dhcpBuf[2] = 6;
      expect(parseDhcpPayload(dhcpBuf, 0)).toBeNull();
    });
  });

  describe('extractLayer3Metadata', () => {
    it('extracts ARP from full 802.11 Data frame with LLC/SNAP header', () => {
      // 802.11 Data Frame:
      // MAC Header (24 bytes): Frame Control 0x08 0x00 (Data, unencrypted)
      // LLC/SNAP (8 bytes): AA AA 03 00 00 00 08 06 (EtherType 0x0806 ARP)
      // ARP Payload (28 bytes)
      const frame = new Uint8Array(24 + 8 + 28);
      // Frame Control: Subtype Data (0x08)
      frame[0] = 0x08;
      frame[1] = 0x00;

      // Receiver, Transmitter, BSSID (dummy MACs)
      frame[4] = 0x11;
      frame[10] = 0x22;
      frame[16] = 0x33;

      // LLC/SNAP header at offset 24
      frame[24] = 0xAA;
      frame[25] = 0xAA;
      frame[26] = 0x03;
      frame[27] = 0x00;
      frame[28] = 0x00;
      frame[29] = 0x00;
      frame[30] = 0x08; // EtherType ARP (0x0806)
      frame[31] = 0x06;

      // ARP Payload at offset 32:
      // HW type 1, Proto 0x0800, HW len 6, Proto len 4, Op 1
      const arpStart = 32;
      frame[arpStart] = 0x00;
      frame[arpStart + 1] = 0x01;
      frame[arpStart + 2] = 0x08;
      frame[arpStart + 3] = 0x00;
      frame[arpStart + 4] = 0x06;
      frame[arpStart + 5] = 0x04;
      frame[arpStart + 6] = 0x00;
      frame[arpStart + 7] = 0x01;

      // Sender MAC: 12:34:56:78:9A:BC
      frame.set([0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC], arpStart + 8);
      // Sender IP: 192.168.1.155
      frame.set([192, 168, 1, 155], arpStart + 14);
      // Target MAC: FF:FF:FF:FF:FF:FF
      frame.set([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF], arpStart + 18);
      // Target IP: 192.168.1.1
      frame.set([192, 168, 1, 1], arpStart + 24);

      const result = extractLayer3Metadata(frame, 0, false);
      expect(result).not.toBeNull();
      expect(result.protocol).toBe('ARP');
      expect(result.mac).toBe('12:34:56:78:9A:BC');
      expect(result.ip).toBe('192.168.1.155');
    });

    it('returns null if frame is encrypted (bit 14 of Frame Control is set)', () => {
      const frame = new Uint8Array(60);
      frame[0] = 0x08;
      frame[1] = 0x40; // Protected bit set (0x4000)

      const result = extractLayer3Metadata(frame, 0, false);
      expect(result).toBeNull();
    });
  });
});
