import { describe, it, expect } from 'vitest';
import {
  PM3_NG_MAGIC,
  PM3_NG_HEADER_SIZE,
  PM3_MAX_PAYLOAD_SIZE,
  packNgFrame,
  unpackNgFrame,
  peekNgFrameLength,
  Pm3MagicMismatchError,
  Pm3PayloadLengthError,
  Pm3TruncatedFrameError
} from '../../src/protocols/pm3';

describe('Proxmark3 NG Packet Layer', () => {
  it('correctly serializes a packet into Little-Endian NG binary frame', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const frame = packNgFrame({
      cmd: 0x0101, // CMD_VERSION
      flags: 0x0002,
      arg0: 0x11223344,
      arg1: 0x55667788,
      arg2: 0x99aabbcc,
      payload
    });

    expect(frame.byteLength).toBe(PM3_NG_HEADER_SIZE + 4);

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    // Magic: 0x43334D50 -> bytes [0x50, 0x4D, 0x33, 0x43]
    expect(view.getUint32(0, true)).toBe(PM3_NG_MAGIC);
    expect(frame[0]).toBe(0x50); // 'P'
    expect(frame[1]).toBe(0x4d); // 'M'
    expect(frame[2]).toBe(0x33); // '3'
    expect(frame[3]).toBe(0x43); // 'C'

    expect(view.getUint16(4, true)).toBe(0x0101);
    expect(view.getUint16(6, true)).toBe(4); // length
    expect(view.getUint16(8, true)).toBe(0x0002); // flags
    expect(view.getUint32(10, true)).toBe(0x11223344);
    expect(view.getUint32(14, true)).toBe(0x55667788);
    expect(view.getUint32(18, true)).toBe(0x99aabbcc);

    // Payload verification
    expect(frame.slice(22)).toEqual(payload);
  });

  it('performs lossless round-trip packing and unpacking', () => {
    const originalPayload = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]);
    const packed = packNgFrame({
      cmd: 0x0300,
      flags: 0x0001,
      arg0: 0x01020304,
      arg1: 0x05060708,
      arg2: 0x0a0b0c0d,
      payload: originalPayload
    });

    const unpacked = unpackNgFrame(packed);

    expect(unpacked.magic).toBe(PM3_NG_MAGIC);
    expect(unpacked.cmd).toBe(0x0300);
    expect(unpacked.length).toBe(originalPayload.length);
    expect(unpacked.flags).toBe(0x0001);
    expect(unpacked.arg0).toBe(0x01020304);
    expect(unpacked.arg1).toBe(0x05060708);
    expect(unpacked.arg2).toBe(0x0a0b0c0d);
    expect(unpacked.payload).toEqual(originalPayload);
  });

  it('handles empty payload gracefully', () => {
    const packed = packNgFrame({ cmd: 0x0104 }); // CMD_PING
    expect(packed.byteLength).toBe(PM3_NG_HEADER_SIZE);

    const unpacked = unpackNgFrame(packed);
    expect(unpacked.cmd).toBe(0x0104);
    expect(unpacked.length).toBe(0);
    expect(unpacked.payload.byteLength).toBe(0);
  });

  it('rejects frame shorter than PM3_NG_HEADER_SIZE (fail-closed)', () => {
    const truncatedHeader = new Uint8Array([0x50, 0x4d, 0x33, 0x43, 0x01, 0x01]);
    expect(() => unpackNgFrame(truncatedHeader)).toThrow(Pm3TruncatedFrameError);
  });

  it('rejects frame with magic mismatch (fail-closed)', () => {
    const corruptedMagic = new Uint8Array(22);
    // Fill with non-magic bytes
    corruptedMagic[0] = 0x12;
    corruptedMagic[1] = 0x34;
    expect(() => unpackNgFrame(corruptedMagic)).toThrow(Pm3MagicMismatchError);
  });

  it('rejects frame where payload is truncated according to header length', () => {
    const packed = packNgFrame({
      cmd: 0x0200,
      payload: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    });
    // Slice off the last 2 bytes of payload
    const truncatedPayload = packed.slice(0, packed.length - 2);
    expect(() => unpackNgFrame(truncatedPayload)).toThrow(Pm3TruncatedFrameError);
  });

  it('rejects packing payload exceeding maximum limit of 512 bytes', () => {
    const oversizedPayload = new Uint8Array(PM3_MAX_PAYLOAD_SIZE + 1);
    expect(() => packNgFrame({ cmd: 0x0100, payload: oversizedPayload })).toThrow(
      Pm3PayloadLengthError
    );
  });

  it('peekNgFrameLength returns exact expected length or null on partial/corrupted data', () => {
    const validFrame = packNgFrame({
      cmd: 0x0101,
      payload: new Uint8Array([0xaa, 0xbb])
    });
    expect(peekNgFrameLength(validFrame)).toBe(PM3_NG_HEADER_SIZE + 2);

    // Header incomplete
    expect(peekNgFrameLength(validFrame.slice(0, 10))).toBeNull();

    // Magic corrupted
    const corrupted = new Uint8Array(validFrame);
    corrupted[0] = 0x00;
    expect(peekNgFrameLength(corrupted)).toBeNull();
  });
});
