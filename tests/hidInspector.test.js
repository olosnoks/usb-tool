import { describe, it, expect } from 'vitest';
import {
  usagePageName, usageName, describeCollections, decodeReport, readBits, hexDump
} from '../src/utils/hidInspector';

const dv = (bytes) => new DataView(Uint8Array.from(bytes).buffer);

describe('HID usage naming', () => {
  it('names pages and usages', () => {
    expect(usagePageName(0x01)).toBe('Generic Desktop');
    expect(usagePageName(0xff12)).toBe('Vendor-defined');
    expect(usageName(0x01, 0x30)).toBe('X');
    expect(usageName(0x01, 0x02)).toBe('Mouse');
    expect(usageName(0x09, 2)).toBe('Button 2');
    expect(usageName(0x08, 0x02)).toBe('Caps Lock');
  });
});

describe('readBits', () => {
  it('reads LSB-first and sign-extends', () => {
    expect(readBits(dv([0b00000101]), 0, 3, false)).toBe(5);
    expect(readBits(dv([0b11111011]), 0, 8, true)).toBe(-5);
    expect(readBits(dv([0x00, 0x01]), 8, 8, false)).toBe(1);
  });
});

// A standard boot mouse: 3 buttons + 5 pad + signed X,Y.
const mouse = [{
  usagePage: 0x01, usage: 0x02,
  inputReports: [{
    reportId: 0,
    items: [
      { reportSize: 1, reportCount: 3, usagePage: 0x09, usageMinimum: 1, usageMaximum: 3, logicalMinimum: 0, logicalMaximum: 1 },
      { reportSize: 5, reportCount: 1, isConstant: true },
      { reportSize: 8, reportCount: 2, usagePage: 0x01, usages: [0x30, 0x31], logicalMinimum: -127, logicalMaximum: 127 }
    ]
  }],
  outputReports: [], featureReports: []
}];

// A boot keyboard: 8 modifier bits + reserved + 6-key array.
const keyboard = [{
  usagePage: 0x01, usage: 0x06,
  inputReports: [{
    reportId: 0,
    items: [
      { reportSize: 1, reportCount: 8, usagePage: 0x07, usageMinimum: 0xe0, usageMaximum: 0xe7, logicalMinimum: 0, logicalMaximum: 1 },
      { reportSize: 8, reportCount: 1, isConstant: true },
      { reportSize: 8, reportCount: 6, usagePage: 0x07, usageMinimum: 0, usageMaximum: 0xff, isArray: true, logicalMinimum: 0, logicalMaximum: 0xff }
    ]
  }],
  outputReports: [], featureReports: []
}];

describe('describeCollections', () => {
  it('summarizes a mouse collection', () => {
    const [col] = describeCollections(mouse);
    expect(col.name).toBe('Mouse');
    expect(col.inputReports[0].byteLength).toBe(3); // 3+5 bits + 2*8 bits = 24 bits
    expect(col.inputReports[0].fields[2].signed).toBe(true);
  });
});

describe('decodeReport', () => {
  it('decodes mouse buttons and signed motion', () => {
    const [col] = describeCollections(mouse);
    // buttons: left+middle (0b101), X=+5, Y=-5
    const fields = decodeReport(col.inputReports[0], dv([0b00000101, 0x05, 0xfb]));
    const byLabel = Object.fromEntries(fields.map((f) => [f.label, f]));
    expect(byLabel['Button 1'].value).toBe(1);
    expect(byLabel['Button 2'].value).toBe(0);
    expect(byLabel['Button 3'].value).toBe(1);
    expect(byLabel['X'].value).toBe(5);
    expect(byLabel['Y'].value).toBe(-5);
  });

  it('decodes a keyboard array as the set of keys currently down', () => {
    const [col] = describeCollections(keyboard);
    // Left Shift held (0xE1 => modifier bit 1), key 'a' (0x04) pressed.
    const fields = decodeReport(col.inputReports[0], dv([0b00000010, 0x00, 0x04, 0, 0, 0, 0, 0]));
    const shift = fields.find((f) => f.label === 'Key 0xe1');
    expect(shift.value).toBe(1);
    const keys = fields.find((f) => f.type === 'array');
    expect(keys.active).toContain('Key 0x4');
  });
});

describe('hexDump', () => {
  it('formats bytes', () => {
    expect(hexDump(Uint8Array.from([0x00, 0x1f, 0xff]))).toBe('00 1f ff');
  });
});
