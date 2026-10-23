import { PM3_COMMAND_PREAMBLE_SIZE, Pm3Packet } from './types';
import { unpackNgFrame, peekNgFrameLength } from './packet';

export interface RingBufferOptions {
  /**
   * Maximum stream buffer capacity in bytes before overflow trimming occurs.
   * Default: 65,536 bytes (64 KB).
   */
  maxBufferSize?: number;
}

/**
 * Robust stream reassembly buffer for arbitrary Web Serial chunks.
 *
 * Handles:
 * - Arbitrary chunk fragmentation and frame boundaries
 * - 32-bit synchronization magic detection ('PM3a' / 'PM3b')
 * - Leading and interleaving garbage/noise discarding
 * - Strict payload length validation
 * - Buffer overflow protection
 */
export class Pm3RingBuffer {
  private buffer: Uint8Array = new Uint8Array(0);
  private readonly maxBufferSize: number;
  private droppedNoiseBytes: number = 0;

  // Expected magic sequence in Little-Endian byte order: 0x50, 0x4D, 0x33, 0x61|0x62 ('PM3a'/'PM3b')
  private static readonly MAGIC_BYTES = [0x50, 0x4d, 0x33, 0x62];

  constructor(options: RingBufferOptions = {}) {
    this.maxBufferSize = options.maxBufferSize ?? 64 * 1024;
  }

  /**
   * Current number of unconsumed bytes held in the reassembly buffer.
   */
  public get length(): number {
    return this.buffer.byteLength;
  }

  /**
   * Total count of leading/invalid noise bytes discarded so far.
   */
  public get droppedNoiseCount(): number {
    return this.droppedNoiseBytes;
  }

  /**
   * Clears the internal stream buffer and resets dropped byte metrics.
   */
  public clear(): void {
    this.buffer = new Uint8Array(0);
    this.droppedNoiseBytes = 0;
  }

  /**
   * Appends an incoming chunk from the Web Serial stream into the reassembly buffer.
   * Discards stale bytes if the buffer exceeds maximum configured capacity.
   */
  public append(chunk: Uint8Array): void {
    if (!chunk || chunk.byteLength === 0) {
      return;
    }

    const currentLen = this.buffer.byteLength;
    const incomingLen = chunk.byteLength;
    const newTotalLen = currentLen + incomingLen;

    if (newTotalLen > this.maxBufferSize) {
      if (incomingLen >= this.maxBufferSize) {
        // Incoming chunk alone exceeds or meets max capacity: drop entire prior buffer and leading chunk excess
        const excessInChunk = incomingLen - this.maxBufferSize;
        this.droppedNoiseBytes += currentLen + excessInChunk;
        this.buffer = chunk.slice(excessInChunk);
        return;
      }

      // Buffer overflow protection: retain only the most recent (maxBufferSize - incomingLen) bytes from current buffer
      const retainFromCurrent = this.maxBufferSize - incomingLen;
      const dropped = currentLen - retainFromCurrent;
      this.droppedNoiseBytes += dropped;

      const trimmedBuffer = this.buffer.slice(currentLen - retainFromCurrent);
      const combined = new Uint8Array(this.maxBufferSize);
      combined.set(trimmedBuffer, 0);
      combined.set(chunk, trimmedBuffer.byteLength);
      this.buffer = combined;
      return;
    }

    const nextBuffer = new Uint8Array(newTotalLen);
    nextBuffer.set(this.buffer, 0);
    nextBuffer.set(chunk, currentLen);
    this.buffer = nextBuffer;
  }

  /**
   * Pulls the next complete, valid Proxmark NG packet from the stream buffer.
   * Drops any noise preceding the next valid magic header.
   * Returns null if no complete packet is currently available.
   */
  public nextPacket(): Pm3Packet | null {
    while (this.buffer.byteLength >= PM3_COMMAND_PREAMBLE_SIZE) {
      const magicIdx = this.findMagicIndex();

      if (magicIdx === -1) {
        const keepCount = Math.min(3, this.buffer.byteLength);
        const dropCount = this.buffer.byteLength - keepCount;
        if (dropCount > 0) {
          this.droppedNoiseBytes += dropCount;
          this.buffer = this.buffer.slice(dropCount);
        }
        return null;
      }

      if (magicIdx > 0) {
        this.droppedNoiseBytes += magicIdx;
        this.buffer = this.buffer.slice(magicIdx);
      }

      if (this.buffer.byteLength < PM3_COMMAND_PREAMBLE_SIZE) {
        return null;
      }

      const total = peekNgFrameLength(this.buffer);
      if (total === null) {
        // False-positive magic or absurd length: resync one byte forward
        this.droppedNoiseBytes += 1;
        this.buffer = this.buffer.slice(1);
        continue;
      }

      if (this.buffer.byteLength < total) {
        return null; // wait for the rest of the frame
      }

      const frameBytes = this.buffer.slice(0, total);
      this.buffer = this.buffer.slice(total);

      try {
        return unpackNgFrame(frameBytes);
      } catch {
        this.droppedNoiseBytes += 1;
        this.buffer = this.buffer.slice(1);
      }
    }

    return null;
  }

  /**
   * Drains and returns all available complete packets currently in the buffer.
   */
  public drainAllPackets(): Pm3Packet[] {
    const packets: Pm3Packet[] = [];
    let pkt: Pm3Packet | null = null;
    while ((pkt = this.nextPacket()) !== null) {
      packets.push(pkt);
    }
    return packets;
  }

  /**
   * Helper scanning for the 4-byte magic sequence [0x50, 0x4D, 0x33, 0x43]
   */
  private findMagicIndex(): number {
    const len = this.buffer.byteLength;
    if (len < 4) return -1;

    const b = this.buffer;
    for (let i = 0; i <= len - 4; i++) {
      if (
        b[i] === 0x50 && // 'P'
        b[i + 1] === 0x4d && // 'M'
        b[i + 2] === 0x33 && // '3'
        (b[i + 3] === 0x62 || b[i + 3] === 0x61) // 'b' (response), 'a' (command)
      ) {
        return i;
      }
    }

    return -1;
  }
}
