import { describe, it, expect } from 'vitest';
import { compute, width, CHECKSUMS } from '../../src/utils/usbrea/checksums.js';
import { ascii } from '../../src/utils/usbrea/bytes.js';

// standard "check" values from the CRC catalogue (reveng) for b"123456789"
describe('checksums', () => {
  it.each([
    ['crc8', 0xF4], ['crc8_maxim', 0xA1], ['crc16_ccitt_false', 0x29B1],
    ['crc16_xmodem', 0x31C3], ['crc16_modbus', 0x4B37], ['crc16_kermit', 0x2189],
  ])('catalogue check value %s', (algo, check) => {
    expect(compute(algo, ascii('123456789'))).toBe(check);
  });

  it('simple sums', () => {
    const d = Uint8Array.from([0xAA, 0x01, 0xFF, 0x00]);
    expect(compute('sum8', d)).toBe(0xAA);
    expect(compute('sum16', d)).toBe(0x1AA);
    expect(compute('neg_sum8', d)).toBe(0x56);
    expect(compute('inv_sum8', d)).toBe(0x55);
    expect(compute('xor8', d)).toBe(0x54);
    expect(width('crc16_modbus')).toBe(2);
    expect(Object.keys(CHECKSUMS).length).toBe(11);
  });
});
