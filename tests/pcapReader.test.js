import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  parsePcap, 
  readPcapFile, 
  PcapReplayer, 
  PCAP_MAGIC_LE, 
  PCAP_MAGIC_BE, 
  PCAP_LINKTYPE_RADIOTAP 
} from '../src/utils/pcapReader.js';
import { createPcapGlobalHeader, createPcapPacketHeader } from '../src/utils/livePcapWriter.js';

describe('Phase 16: PCAP Reader & Forensic Ingestion (pcapReader.js)', () => {
  describe('parsePcap Header Validation', () => {
    it('successfully parses a standard 24-byte Radiotap global header', () => {
      const globalHeader = createPcapGlobalHeader();
      const result = parsePcap(globalHeader);

      expect(result.header).toBeDefined();
      expect(result.header.magic).toBe(PCAP_MAGIC_LE);
      expect(result.header.versionMajor).toBe(2);
      expect(result.header.versionMinor).toBe(4);
      expect(result.header.linkType).toBe(PCAP_LINKTYPE_RADIOTAP);
      expect(result.header.snaplen).toBe(65535);
      expect(result.header.isLittleEndian).toBe(true);
      expect(result.packets).toEqual([]);
      expect(result.packetRecords).toEqual([]);
    });

    it('throws when the input is less than 24 bytes', () => {
      const shortBuffer = new Uint8Array([0xd4, 0xc3, 0xb2, 0xa1]);
      expect(() => parsePcap(shortBuffer)).toThrow(/less than the 24-byte PCAP header/);
    });

    it('throws when the magic number is invalid', () => {
      const corruptedHeader = new Uint8Array(24);
      corruptedHeader[0] = 0xDE;
      corruptedHeader[1] = 0xAD;
      corruptedHeader[2] = 0xBE;
      corruptedHeader[3] = 0xEF;
      expect(() => parsePcap(corruptedHeader)).toThrow(/Invalid PCAP magic number/);
    });

    it('throws when the link type is not 127 (Radiotap)', () => {
      const ethHeader = new Uint8Array(24);
      const view = new DataView(ethHeader.buffer);
      view.setUint32(0, PCAP_MAGIC_LE, true); // Magic LE
      view.setUint16(4, 2, true);
      view.setUint16(6, 4, true);
      view.setUint32(16, 65535, true);
      view.setUint32(20, 1, true); // LinkType 1 = Ethernet (not Radiotap)

      expect(() => parsePcap(ethHeader)).toThrow(/Expected 127 \(LINKTYPE_IEEE802_11_RADIOTAP\)/);
    });

    it('correctly detects big-endian PCAP headers', () => {
      const beHeader = new Uint8Array(24);
      const view = new DataView(beHeader.buffer);
      // Write big-endian magic (0xa1b2c3d4 in big-endian bytes = A1 B2 C3 D4)
      view.setUint32(0, 0xa1b2c3d4, false);
      view.setUint16(4, 2, false);
      view.setUint16(6, 4, false);
      view.setUint32(16, 65535, false);
      view.setUint32(20, 127, false); // LinkType 127 in big-endian

      const result = parsePcap(beHeader);
      expect(result.header.isLittleEndian).toBe(false);
      expect(result.header.linkType).toBe(127);
    });
  });

  describe('parsePcap Packet Record Iteration', () => {
    it('correctly parses multiple packet records and extracts raw payloads', () => {
      const globalHeader = createPcapGlobalHeader();

      const pkt1Payload = new Uint8Array([0x00, 0x00, 0x04, 0x00, 0x80, 0x00, 0x11, 0x22]);
      const pkt1Header = createPcapPacketHeader(pkt1Payload.length, pkt1Payload.length, 1700000000000);

      const pkt2Payload = new Uint8Array([0x00, 0x00, 0x04, 0x00, 0x88, 0x01, 0x33, 0x44, 0x55, 0x66]);
      const pkt2Header = createPcapPacketHeader(pkt2Payload.length, pkt2Payload.length, 1700000001500);

      const combined = new Uint8Array(
        globalHeader.length + pkt1Header.length + pkt1Payload.length + pkt2Header.length + pkt2Payload.length
      );
      let offset = 0;
      combined.set(globalHeader, offset); offset += globalHeader.length;
      combined.set(pkt1Header, offset); offset += pkt1Header.length;
      combined.set(pkt1Payload, offset); offset += pkt1Payload.length;
      combined.set(pkt2Header, offset); offset += pkt2Header.length;
      combined.set(pkt2Payload, offset); offset += pkt2Payload.length;

      const parsed = parsePcap(combined);
      expect(parsed.packets.length).toBe(2);
      expect(parsed.packetRecords.length).toBe(2);

      // Verify packet 1
      expect(parsed.packetRecords[0].inclLen).toBe(pkt1Payload.length);
      expect(Array.from(parsed.packets[0])).toEqual(Array.from(pkt1Payload));
      expect(parsed.packetRecords[0].timestamp.sec).toBe(1700000000);

      // Verify packet 2
      expect(parsed.packetRecords[1].inclLen).toBe(pkt2Payload.length);
      expect(Array.from(parsed.packets[1])).toEqual(Array.from(pkt2Payload));
      expect(parsed.packetRecords[1].timestamp.sec).toBe(1700000001);
    });

    it('gracefully handles truncated packets at end of file without crashing', () => {
      const globalHeader = createPcapGlobalHeader();
      const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
      // Claims 100 bytes length, but only 4 bytes provided
      const truncatedPktHeader = createPcapPacketHeader(100, 100, 1700000000000);

      const fileWithTruncation = new Uint8Array(globalHeader.length + truncatedPktHeader.length + payload.length);
      fileWithTruncation.set(globalHeader, 0);
      fileWithTruncation.set(truncatedPktHeader, globalHeader.length);
      fileWithTruncation.set(payload, globalHeader.length + truncatedPktHeader.length);

      const result = parsePcap(fileWithTruncation);
      expect(result.packets.length).toBe(0); // Truncated packet skipped
    });
  });

  describe('PcapReplayer Streaming Controller', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('throttles packet playback and invokes onBatch and onComplete callbacks', () => {
      const mockPackets = [
        new Uint8Array([1]),
        new Uint8Array([2]),
        new Uint8Array([3]),
        new Uint8Array([4]),
        new Uint8Array([5])
      ];

      const onBatch = vi.fn();
      const onProgress = vi.fn();
      const onComplete = vi.fn();

      const replayer = new PcapReplayer(mockPackets, {
        rate: 10,
        batchSize: 2,
        onBatch,
        onProgress,
        onComplete
      });

      replayer.start();
      expect(replayer.isPlaying).toBe(true);

      // First tick (batch 1: packets 0, 1)
      vi.advanceTimersByTime(200);
      expect(onBatch).toHaveBeenCalledTimes(1);
      expect(onBatch).toHaveBeenLastCalledWith([mockPackets[0], mockPackets[1]], 0, 5);
      expect(onProgress).toHaveBeenCalledWith({ current: 2, total: 5, percent: 40 });

      // Second tick (batch 2: packets 2, 3)
      vi.advanceTimersByTime(200);
      expect(onBatch).toHaveBeenCalledTimes(2);
      expect(onBatch).toHaveBeenLastCalledWith([mockPackets[2], mockPackets[3]], 2, 5);

      // Third tick (batch 3: packet 4)
      vi.advanceTimersByTime(200);
      expect(onBatch).toHaveBeenCalledTimes(3);
      expect(onBatch).toHaveBeenLastCalledWith([mockPackets[4]], 4, 5);

      // Completion tick
      vi.advanceTimersByTime(200);
      expect(onComplete).toHaveBeenCalledWith({ total: 5 });
      expect(replayer.isPlaying).toBe(false);
      expect(replayer.isFinished).toBe(true);
    });

    it('allows pausing, resuming, and stopping replay', () => {
      const mockPackets = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
      const onBatch = vi.fn();

      const replayer = new PcapReplayer(mockPackets, {
        rate: 10,
        batchSize: 1,
        onBatch
      });

      replayer.start();
      vi.advanceTimersByTime(100);
      expect(onBatch).toHaveBeenCalledTimes(1);

      replayer.pause();
      expect(replayer.isPaused).toBe(true);
      vi.advanceTimersByTime(500);
      expect(onBatch).toHaveBeenCalledTimes(1); // No new packets while paused

      replayer.resume();
      expect(replayer.isPaused).toBe(false);
      vi.advanceTimersByTime(100);
      expect(onBatch).toHaveBeenCalledTimes(2);

      replayer.stop();
      expect(replayer.isPlaying).toBe(false);
      vi.advanceTimersByTime(500);
      expect(onBatch).toHaveBeenCalledTimes(2);
    });
  });
});
