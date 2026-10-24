import { describe, it, expect } from 'vitest';
import { generatePcapBuffer, generatePcap } from '../src/utils/pcapExporter';

describe('PCAP Exporter (pcapExporter.js)', () => {
  it('generates a valid 24-byte global PCAP header for empty packet list', () => {
    const buffer = generatePcapBuffer([]);
    expect(buffer.length).toBe(24);

    const view = new DataView(buffer.buffer);
    // Magic number: 0xa1b2c3d4 (little-endian)
    expect(view.getUint32(0, true)).toBe(0xa1b2c3d4);
    // Version: 2.4
    expect(view.getUint16(4, true)).toBe(2);
    expect(view.getUint16(6, true)).toBe(4);
    // Timezone & Sigfigs: 0
    expect(view.getInt32(8, true)).toBe(0);
    expect(view.getUint32(12, true)).toBe(0);
    // Snaplen: 65535
    expect(view.getUint32(16, true)).toBe(65535);
    // LinkType: 127 (IEEE 802.11 Radiotap)
    expect(view.getUint32(20, true)).toBe(127);
  });

  it('correctly appends 16-byte packet record headers and packet payloads', () => {
    const mockPacket1 = new Uint8Array([0x00, 0x00, 0x04, 0x00, 0x80, 0x00, 0x11, 0x22]); // 8 bytes
    const mockPacket2 = new Uint8Array([0x88, 0x01, 0xAA, 0xBB]); // 4 bytes

    const buffer = generatePcapBuffer([mockPacket1, mockPacket2]);
    // 24 (global) + (16 + 8) + (16 + 4) = 68 bytes
    expect(buffer.length).toBe(68);

    const view = new DataView(buffer.buffer);

    // First packet record header at offset 24
    const pkt1InclLen = view.getUint32(24 + 8, true);
    const pkt1OrigLen = view.getUint32(24 + 12, true);
    expect(pkt1InclLen).toBe(8);
    expect(pkt1OrigLen).toBe(8);
    // Payload of packet 1
    expect(buffer.slice(24 + 16, 24 + 16 + 8)).toEqual(mockPacket1);

    // Second packet record header at offset 48 (24 + 24)
    const pkt2InclLen = view.getUint32(48 + 8, true);
    const pkt2OrigLen = view.getUint32(48 + 12, true);
    expect(pkt2InclLen).toBe(4);
    expect(pkt2OrigLen).toBe(4);
    // Payload of packet 2
    expect(buffer.slice(48 + 16, 48 + 16 + 4)).toEqual(mockPacket2);
  });

  it('generates a downloadable PCAP Blob with correct MIME type', () => {
    const blob = generatePcap([new Uint8Array([0x01, 0x02, 0x03])]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('application/vnd.tcpdump.pcap');
    expect(blob.size).toBe(24 + 16 + 3);
  });
});
