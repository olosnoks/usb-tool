import { describe, it, expect } from 'vitest';
import { getVendor, OUI_DATABASE } from '../src/utils/ouiLookup';

describe('Local OUI Vendor Lookup Suite', () => {
  it('exports getVendor function and OUI_DATABASE dictionary', () => {
    expect(typeof getVendor).toBe('function');
    expect(typeof OUI_DATABASE).toBe('object');
    expect(Object.keys(OUI_DATABASE).length).toBeGreaterThan(50);
    expect(Object.keys(OUI_DATABASE).length).toBeLessThan(150);
  });

  it('correctly maps known MAC prefixes with colons', () => {
    expect(getVendor('00:1A:11:11:22:33')).toBe('Google');
    expect(getVendor('3C:22:FB:44:55:66')).toBe('Apple');
    expect(getVendor('24:6F:28:12:34:56')).toBe('Espressif');
    expect(getVendor('00:40:96:AA:BB:CC')).toBe('Cisco');
    expect(getVendor('00:14:D1:11:22:33')).toBe('TP-Link');
    expect(getVendor('00:27:22:33:44:55')).toBe('Ubiquiti');
    expect(getVendor('B8:27:EB:00:11:22')).toBe('Raspberry Pi');
  });

  it('handles lowercase, dashes, spaces, and dot delimiters', () => {
    expect(getVendor('00-1a-11-aa-bb-cc')).toBe('Google');
    expect(getVendor('3c22fb445566')).toBe('Apple');
    expect(getVendor('00.14.d1.00.11.22')).toBe('TP-Link');
    expect(getVendor('00 40 96 11 22 33')).toBe('Cisco');
  });

  it('returns Unknown for unknown or malformed MACs', () => {
    expect(getVendor('FF:FF:FF:FF:FF:FF')).toBe('Unknown');
    expect(getVendor('00:00:00:00:00:00')).toBe('Unknown');
    expect(getVendor('12:34')).toBe('Unknown');
    expect(getVendor('')).toBe('Unknown');
    expect(getVendor(null)).toBe('Unknown');
    expect(getVendor(undefined)).toBe('Unknown');
    expect(getVendor(123456)).toBe('Unknown');
  });
});
