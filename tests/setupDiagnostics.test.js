import { describe, it, expect } from 'vitest';
import { parseVidPid, findBridge, detectCapabilities, adviceFor, filterEntries, TROUBLE_ENTRIES, hex4 } from '../src/utils/setupDiagnostics.js';

describe('setupDiagnostics', () => {
  it('parses VID:PID in several formats', () => {
    expect(parseVidPid('1a86:7523')).toEqual({ vid: 0x1a86, pid: 0x7523 });
    expect(parseVidPid('0x10C4 0xEA60')).toEqual({ vid: 0x10c4, pid: 0xea60 });
    expect(parseVidPid('USB\VID_0403&PID_6001\A1')).toEqual({ vid: 0x0403, pid: 0x6001 });
    expect(parseVidPid('303a')).toEqual({ vid: 0x303a, pid: null });
    expect(parseVidPid('zz')).toBeNull();
    expect(parseVidPid('')).toBeNull();
    expect(parseVidPid('1:2:3')).toBeNull();
  });
  it('finds bridges and advice', () => {
    expect(findBridge(0x1a86).name).toMatch(/CH340/);
    expect(findBridge(0xffff)).toBeNull();
    expect(adviceFor(0x1a86, 'windows')).toMatch(/CH341SER/);
    expect(adviceFor(0xffff, 'linux')).toMatch(/not in the built-in list/);
    expect(hex4(0xab)).toBe('00ab');
  });
  it('reports capabilities', () => {
    const r = detectCapabilities({ secure: false, ua: 'Mozilla Firefox/120', serial: false, usb: false, hid: false, bluetooth: false });
    expect(r.rows.every((x) => !x.ok)).toBe(true);
    expect(r.notes.join(' ')).toMatch(/Firefox/);
    const ok = detectCapabilities({ secure: true, ua: 'Chrome/120', serial: true, usb: true, hid: true, bluetooth: true });
    expect(ok.rows.every((x) => x.ok)).toBe(true);
    expect(ok.notes).toEqual([]);
  });
  it('filters entries', () => {
    expect(filterEntries(TROUBLE_ENTRIES, '')).toHaveLength(TROUBLE_ENTRIES.length);
    expect(filterEntries(TROUBLE_ENTRIES, 'zadig').map((e) => e.id)).toContain('winusb');
    expect(filterEntries(TROUBLE_ENTRIES, 'qqqq')).toEqual([]);
  });
});
