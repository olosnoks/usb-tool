import { describe, it, expect } from 'vitest';
import { buildPayload, bytesToHex, bytesToAscii, formatCaptureLog, buildAutopsyReport, totalBytes } from '../src/utils/usbRecon';

describe('buildPayload', () => {
  it('hex mode with line endings', () => {
    expect(Array.from(buildPayload('41 54', 'hex', 'crlf'))).toEqual([0x41, 0x54, 0x0d, 0x0a]);
    expect(Array.from(buildPayload('0x41', 'hex', 'lf'))).toEqual([0x41, 0x0a]);
  });
  it('text mode with escapes and UTF-8', () => {
    const BS = String.fromCharCode(92);
    expect(Array.from(buildPayload('AT' + BS + 'r' + BS + 'n', 'ascii'))).toEqual([0x41, 0x54, 0x0d, 0x0a]);
    expect(Array.from(buildPayload(BS + 'x7fA' + BS + BS, 'ascii', 'cr'))).toEqual([0x7f, 0x41, 0x5c, 0x0d]);
    expect(Array.from(buildPayload(String.fromCharCode(0xe9), 'ascii'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(buildPayload('a' + BS + 'q', 'ascii'))).toEqual([0x61, 0x5c, 0x71]);
  });
  it('rejects empty, malformed and unknown input', () => {
    expect(() => buildPayload('', 'ascii')).toThrow(/text/);
    expect(() => buildPayload('4', 'hex')).toThrow(/full hex byte/);
    expect(() => buildPayload('41', 'hex', 'bogus')).toThrow(/line ending/);
    expect(() => buildPayload('41', 'oct')).toThrow(/mode/);
  });
});

describe('capture and report formatting', () => {
  const bytes = Uint8Array.of(0x48, 0x69, 0x00, 0xff);
  it('hex and ascii views', () => {
    expect(bytesToHex(bytes)).toBe('48 69 00 FF');
    expect(bytesToAscii(bytes)).toBe('Hi..');
  });
  it('capture text is oldest first with totals', () => {
    const log = [
      { time: '10:00:02', len: 2, hex: '48 69', ascii: 'Hi' },
      { time: '10:00:01', len: 1, hex: '41', ascii: 'A' }
    ];
    expect(totalBytes(log)).toBe(3);
    const text = formatCaptureLog(log, '0x81 IN bulk');
    expect(text).toContain('# 2 packet(s), 3 byte(s)');
    expect(text.indexOf('10:00:01')).toBeLessThan(text.indexOf('10:00:02'));
  });
  it('autopsy report lists identifiers, interfaces and endpoints', () => {
    const info = {
      productName: 'Gadget', manufacturerName: 'Acme', vidHex: '0x1A86', pidHex: '0x7523', usbVersion: '2.0',
      serialNumber: 'No Serial Reported', deviceClass: 0xff, deviceSubclass: 0, deviceProtocol: 0,
      intel: { known: true, chip: 'CH340', notes: 'UART bridge' }
    };
    const ifaces = [{ interfaceNumber: 0, interfaceClass: 0xff, interfaceSubclass: 1, interfaceProtocol: 2, interfaceName: 'Interface #0',
      endpoints: [{ endpointNumber: 2, direction: 'out', type: 'bulk', packetSize: 32 }] }];
    const r = buildAutopsyReport(info, ifaces);
    expect(r).toContain('1A86:7523');
    expect(r).toContain('CH340');
    expect(r).toContain('#0  class 0xFF/0x01/0x02');
    expect(r).toContain('0x02 OUT bulk (32B)');
    expect(buildAutopsyReport(null)).toBe('');
    expect(buildAutopsyReport({ ...info, intel: { known: false } }, [])).toContain('none in the built-in database');
  });
});
