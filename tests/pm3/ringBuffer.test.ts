import { describe, it, expect } from 'vitest';
import {
  Pm3RingBuffer,
  packNgFrame,
  PM3_NG_MAGIC
} from '../../src/protocols/pm3';

describe('Proxmark3 NG Stream Ring Buffer (Reassembly)', () => {
  it('reassembles a packet split across multiple arbitrary chunks', () => {
    const ringBuffer = new Pm3RingBuffer();
    const payload = new Uint8Array([0x10, 0x20, 0x30, 0x40, 0x50]);
    const fullFrame = packNgFrame({
      cmd: 0x0101,
      arg0: 0x12345678,
      payload
    });

    // Split into 7-byte chunks
    const chunkSize = 7;
    for (let offset = 0; offset < fullFrame.length; offset += chunkSize) {
      const slice = fullFrame.slice(offset, offset + chunkSize);
      ringBuffer.append(slice);

      if (offset + chunkSize < fullFrame.length) {
        // Still incomplete
        expect(ringBuffer.nextPacket()).toBeNull();
      }
    }

    // Now complete frame should be yielded
    const packet = ringBuffer.nextPacket();
    expect(packet).not.toBeNull();
    expect(packet!.cmd).toBe(0x0101);
    expect(packet!.arg0).toBe(0x12345678);
    expect(packet!.payload).toEqual(payload);

    // Buffer should now be empty
    expect(ringBuffer.nextPacket()).toBeNull();
  });

  it('drops leading noise bytes and recovers valid packet synchronization', () => {
    const ringBuffer = new Pm3RingBuffer();
    const noise = new Uint8Array([0x99, 0x88, 0x77, 0x66, 0x55, 0x00, 0xff]);
    const validPacket = packNgFrame({
      cmd: 0x0300,
      arg1: 0xfeedbeef
    });

    const combined = new Uint8Array(noise.length + validPacket.length);
    combined.set(noise, 0);
    combined.set(validPacket, noise.length);

    ringBuffer.append(combined);

    const packet = ringBuffer.nextPacket();
    expect(packet).not.toBeNull();
    expect(packet!.cmd).toBe(0x0300);
    expect(packet!.arg1).toBe(0xfeedbeef);
    expect(ringBuffer.droppedNoiseCount).toBe(noise.length);
  });

  it('recovers from garbage interleaved between two valid packets', () => {
    const ringBuffer = new Pm3RingBuffer();

    const pkt1 = packNgFrame({ cmd: 0x0104 }); // CMD_PING
    const garbage = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);
    const pkt2 = packNgFrame({ cmd: 0x0106, arg0: 0x42 }); // CMD_STATUS

    const stream = new Uint8Array(pkt1.length + garbage.length + pkt2.length);
    stream.set(pkt1, 0);
    stream.set(garbage, pkt1.length);
    stream.set(pkt2, pkt1.length + garbage.length);

    ringBuffer.append(stream);

    const parsed1 = ringBuffer.nextPacket();
    expect(parsed1).not.toBeNull();
    expect(parsed1!.cmd).toBe(0x0104);

    const parsed2 = ringBuffer.nextPacket();
    expect(parsed2).not.toBeNull();
    expect(parsed2!.cmd).toBe(0x0106);
    expect(parsed2!.arg0).toBe(0x42);

    expect(ringBuffer.nextPacket()).toBeNull();
    expect(ringBuffer.droppedNoiseCount).toBe(garbage.length);
  });

  it('safely trims buffer upon reaching capacity overflow limit', () => {
    const ringBuffer = new Pm3RingBuffer({ maxBufferSize: 64 });
    const hugeNoise = new Uint8Array(128).fill(0xaa);

    ringBuffer.append(hugeNoise);
    expect(ringBuffer.length).toBeLessThanOrEqual(64);
    expect(ringBuffer.droppedNoiseCount).toBeGreaterThan(0);

    // Append valid packet now
    const validPacket = packNgFrame({ cmd: 0x0101 });
    ringBuffer.append(validPacket);

    const packet = ringBuffer.nextPacket();
    expect(packet).not.toBeNull();
    expect(packet!.cmd).toBe(0x0101);
  });

  it('drainAllPackets returns all complete packets in FIFO order', () => {
    const ringBuffer = new Pm3RingBuffer();
    ringBuffer.append(packNgFrame({ cmd: 0x0101 }));
    ringBuffer.append(packNgFrame({ cmd: 0x0102 }));
    ringBuffer.append(packNgFrame({ cmd: 0x0103 }));

    const packets = ringBuffer.drainAllPackets();
    expect(packets.length).toBe(3);
    expect(packets.map((p) => p.cmd)).toEqual([0x0101, 0x0102, 0x0103]);
    expect(ringBuffer.length).toBe(0);
  });
});
