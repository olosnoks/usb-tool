import { describe, it, expect } from 'vitest';
import { parseDescriptorHex, readBits } from '../src/utils/hidInspector';
import { decodeDescriptorText } from '../src/components/tools/hid/HidDescriptorDecoder';
import * as usbPd from '../src/utils/usbPdDriver';

// Same spec fixtures as tests/usbrea/hid.test.js (HID 1.11 appendix E).
const MOUSE = '05 01 09 02 A1 01 09 01 A1 00 05 09 19 01 29 03 15 00 25 01 95 03 75 01 81 02 95 01 75 05 81 01'
  + ' 05 01 09 30 09 31 15 81 25 7F 75 08 95 02 81 06 C0 C0';
const KEYBOARD = '05 01 09 06 A1 01 05 07 19 E0 29 E7 15 00 25 01 75 01 95 08 81 02 95 01 75 08 81 01'
  + ' 95 05 75 01 05 08 19 01 29 05 91 02 95 01 75 03 91 01'
  + ' 95 06 75 08 15 00 25 65 05 07 19 00 29 65 81 00 C0';
const GAMEPAD = '05 01 09 05 A1 01 05 09 19 01 29 10 15 00 25 01 75 01 95 10 81 02'
  + ' 05 01 09 30 09 31 15 81 25 7F 75 08 95 02 81 02 C0';

const asBytes = (hex) => Uint8Array.from(hex.split(' ').map((h) => parseInt(h, 16)));

describe('pasted descriptor text', () => {
  it('accepts space, comma, 0x and C-array forms and gives the same bytes', () => {
    const want = [0x05, 0x01, 0x09, 0x02, 0xa1, 0x01, 0xc0];
    expect(Array.from(parseDescriptorHex('05 01 09 02 A1 01 C0'))).toEqual(want);
    expect(Array.from(parseDescriptorHex('0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0xC0'))).toEqual(want);
    expect(Array.from(parseDescriptorHex('05010902A101C0'))).toEqual(want);
    expect(Array.from(parseDescriptorHex('const uint8_t d[] = {\n  0x05, 0x01, // usage page\n  0x09, 0x02, /* mouse */ 0xA1, 0x01,\n  0xC0 };'.replace('const uint8_t d[] = {', '{')))).toEqual(want);
  });

  it('accepts dump lines with offsets and skips prose headers', () => {
    const dump = 'Report Descriptor: (length is 7)\n0000: 05 01 09 02 A1 01\n0006: C0\n';
    expect(Array.from(parseDescriptorHex(dump))).toEqual([0x05, 0x01, 0x09, 0x02, 0xa1, 0x01, 0xc0]);
  });

  it('names the line and token of anything that is not a byte', () => {
    expect(() => parseDescriptorHex('05 01\n09 0G')).toThrow(/Line 2: "0G"/);
    expect(() => parseDescriptorHex('05 1')).toThrow(/Line 1: "1"/);
    expect(() => parseDescriptorHex('   \n  ')).toThrow(/No hex bytes/);
  });
});

describe('descriptor decoder reproduces the usb-rea fixtures', () => {
  it('boot mouse', () => {
    const { desc, listing } = decodeDescriptorText(MOUSE);
    expect(desc.top_usages).toEqual(['Generic Desktop: Mouse']);
    expect(desc.reports[0].title()).toBe('Input report (no id, 3 bytes, Button)');
    expect(listing).toMatch(/Usage Page \(Generic Desktop\)/);
    expect(listing).toMatch(/Collection/);
  });

  it('boot keyboard', () => {
    const { desc } = decodeDescriptorText(KEYBOARD);
    expect(desc.report('Input').length).toBe(8);
    expect(desc.report('Output').length).toBe(1);
  });

  it('gamepad with 16 buttons and two axes', () => {
    const { desc } = decodeDescriptorText(GAMEPAD);
    expect(desc.top_usages).toEqual(['Generic Desktop: Game Pad']);
    expect(desc.report('Input').length).toBe(4);
  });

  it('a truncated descriptor reports the byte offset', () => {
    // last item "75 08 95" is cut: 0x95 wants one data byte at offset 9 (0-based) that is missing
    const bad = '05 01 09 02 A1 01 75 08 95';
    expect(() => decodeDescriptorText(bad)).toThrow(/at byte 8/);
  });
});

describe('readBits with 32-bit and wider fields', () => {
  const dv = (bytes) => new DataView(Uint8Array.from(bytes).buffer);
  it('does not wrap at 32 bits', () => {
    expect(readBits(dv([0xff, 0xff, 0xff, 0xff]), 0, 32, false)).toBe(0xffffffff);
    expect(readBits(dv([0xff, 0xff, 0xff, 0xff]), 0, 32, true)).toBe(-1);
    expect(readBits(dv([0x00, 0x00, 0x00, 0x80]), 0, 32, true)).toBe(-(2 ** 31));
    expect(readBits(dv([0x01, 0, 0, 0, 0x01, 0, 0, 0]), 0, 40, false)).toBe(1 + 2 ** 32);
  });
});

describe('USB-PD dead simulation code is gone', () => {
  it('exports no sample cable data or fake profiles and the client has no fabricated state', () => {
    for (const name of ['SAMPLE_CABLE_EMARKERS', 'FIXED_PDO_PROFILES', 'PPS_PROFILE']) expect(usbPd[name]).toBeUndefined();
    const c = new usbPd.UsbPdClient();
    for (const key of ['cableInfo', 'accumulatedMah', 'accumulatedMwh', 'activeVoltageV', 'currentA']) expect(c).not.toHaveProperty(key);
    for (const fn of ['requestFixedPdo', 'requestPpsVoltage', 'resetEnergyCounter']) expect(c[fn]).toBeUndefined();
    expect(c.isConnected).toBe(false);
  });
});
