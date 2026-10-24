import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  createPcapGlobalHeader, 
  createPcapPacketHeader, 
  LivePcapWriter,
  PCAP_MAGIC,
  PCAP_VERSION_MAJOR,
  PCAP_VERSION_MINOR,
  PCAP_LINKTYPE_RADIOTAP,
  PCAP_SNAPLEN
} from '../src/utils/livePcapWriter.js';

describe('Phase 15: Live PCAP Streaming Engine (livePcapWriter.js)', () => {
  describe('createPcapGlobalHeader', () => {
    it('constructs a valid 24-byte PCAP global header with Radiotap link type (127)', () => {
      const header = createPcapGlobalHeader();
      expect(header.length).toBe(24);

      const view = new DataView(header.buffer);
      // Magic number
      expect(view.getUint32(0, true)).toBe(PCAP_MAGIC);
      // Version 2.4
      expect(view.getUint16(4, true)).toBe(PCAP_VERSION_MAJOR);
      expect(view.getUint16(6, true)).toBe(PCAP_VERSION_MINOR);
      // Timezone & sigfigs
      expect(view.getInt32(8, true)).toBe(0);
      expect(view.getUint32(12, true)).toBe(0);
      // Snaplen (65535)
      expect(view.getUint32(16, true)).toBe(PCAP_SNAPLEN);
      // LinkType (127 = LINKTYPE_IEEE802_11_RADIOTAP)
      expect(view.getUint32(20, true)).toBe(PCAP_LINKTYPE_RADIOTAP);
    });
  });

  describe('createPcapPacketHeader', () => {
    it('constructs a valid 16-byte packet record header with timestamp and length fields', () => {
      const timestampMs = 1700000000123;
      const len = 128;
      const origLen = 128;
      const pktHeader = createPcapPacketHeader(len, origLen, timestampMs);

      expect(pktHeader.length).toBe(16);
      const view = new DataView(pktHeader.buffer);

      const expectedSec = Math.floor(timestampMs / 1000);
      const expectedUsec = (timestampMs % 1000) * 1000;

      expect(view.getUint32(0, true)).toBe(expectedSec);
      expect(view.getUint32(4, true)).toBe(expectedUsec);
      expect(view.getUint32(8, true)).toBe(len);
      expect(view.getUint32(12, true)).toBe(origLen);
    });
  });

  describe('LivePcapWriter Class with Mocked File System Access API', () => {
    let mockWritable;
    let mockFileHandle;
    let writtenChunks;

    beforeEach(() => {
      writtenChunks = [];
      mockWritable = {
        write: vi.fn(async (chunk) => {
          writtenChunks.push(chunk);
        }),
        close: vi.fn(async () => {})
      };

      mockFileHandle = {
        name: 'test_capture.pcap',
        createWritable: vi.fn(async () => mockWritable)
      };
    });

    it('opens file, writes global header, and tracks bytes written', async () => {
      const writer = new LivePcapWriter(mockFileHandle);
      await writer.open();

      expect(writer.isOpen).toBe(true);
      expect(mockFileHandle.createWritable).toHaveBeenCalledTimes(1);
      expect(mockWritable.write).toHaveBeenCalledTimes(1);

      // Verify first written chunk is the 24-byte global header
      const firstChunk = writtenChunks[0];
      expect(firstChunk.length).toBe(24);
      const view = new DataView(firstChunk.buffer);
      expect(view.getUint32(0, true)).toBe(PCAP_MAGIC);
      expect(writer.bytesWritten).toBe(24);

      await writer.close();
      expect(writer.isOpen).toBe(false);
      expect(mockWritable.close).toHaveBeenCalledTimes(1);
    });

    it('streams packet buffers directly to disk and serializes write operations', async () => {
      const writer = new LivePcapWriter(mockFileHandle);
      await writer.open();

      const frame1 = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
      const frame2 = new Uint8Array([0x10, 0x20, 0x30, 0x40]);

      await writer.writePacket(frame1, 1700000001000);
      await writer.writePacket(frame2, 1700000002000);

      // 1 global header chunk + 2 packet chunks = 3 writes
      expect(mockWritable.write).toHaveBeenCalledTimes(3);
      expect(writer.packetCount).toBe(2);

      // Check frame 1 write: 16-byte record header + 5 bytes payload = 21 bytes
      const chunk1 = writtenChunks[1];
      expect(chunk1.length).toBe(16 + 5);
      expect(Array.from(chunk1.slice(16))).toEqual([0x00, 0x01, 0x02, 0x03, 0x04]);

      // Check frame 2 write: 16-byte record header + 4 bytes payload = 20 bytes
      const chunk2 = writtenChunks[2];
      expect(chunk2.length).toBe(16 + 4);
      expect(Array.from(chunk2.slice(16))).toEqual([0x10, 0x20, 0x30, 0x40]);

      const result = await writer.close();
      expect(result.packetCount).toBe(2);
      expect(result.bytesWritten).toBe(24 + 21 + 20);
    });

    it('handles static requestFileAndOpen when window.showSaveFilePicker is available', async () => {
      const originalWindow = globalThis.window;
      globalThis.window = globalThis.window || {};
      globalThis.window.showSaveFilePicker = vi.fn(async () => mockFileHandle);

      expect(LivePcapWriter.isSupported()).toBe(true);

      const writer = await LivePcapWriter.requestFileAndOpen('custom_name.pcap');
      expect(globalThis.window.showSaveFilePicker).toHaveBeenCalled();
      expect(writer.isOpen).toBe(true);
      expect(writer.fileName).toBe('test_capture.pcap');

      await writer.close();
      if (originalWindow === undefined) {
        delete globalThis.window;
      } else {
        delete globalThis.window.showSaveFilePicker;
      }
    });

    it('gracefully handles missing raw bytes or uninitialized state', async () => {
      const writer = new LivePcapWriter(mockFileHandle);
      // Not opened yet
      await writer.writePacket(new Uint8Array([1, 2, 3]));
      expect(mockWritable.write).not.toHaveBeenCalled();

      await writer.open();
      // Empty packet
      await writer.writePacket(new Uint8Array(0));
      expect(writer.packetCount).toBe(0);

      await writer.close();
    });
  });
});
