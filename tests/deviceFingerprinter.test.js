import { describe, it, expect } from 'vitest';
import {
  OS_SIGNATURES,
  normalizeSignature,
  identifyOS,
  getOsPresentation
} from '../src/utils/deviceFingerprinter.js';

describe('Device OS Fingerprinting Engine (deviceFingerprinter.js)', () => {
  describe('Signature Normalization', () => {
    it('normalizes string and array formats', () => {
      expect(normalizeSignature('0, 1, 50, 45, 127')).toBe('0,1,50,45,127');
      expect(normalizeSignature('[0, 1, 50, 45]')).toBe('0,1,50,45');
      expect(normalizeSignature([0, 1, 50, 45, 127])).toBe('0,1,50,45,127');
      expect(normalizeSignature('')).toBe('');
      expect(normalizeSignature(null)).toBe('');
    });
  });

  describe('Direct Signature Matching', () => {
    it('identifies iOS probe signatures', () => {
      expect(identifyOS('0,1,50,45,127,221,221')).toBe('iOS');
      expect(identifyOS([0, 1, 50, 45, 127, 221])).toBe('iOS');
    });

    it('identifies macOS probe signatures with VHT capability (Tag 191)', () => {
      expect(identifyOS('0,1,50,45,61,127,191,221')).toBe('macOS');
      expect(identifyOS([0, 1, 50, 45, 127, 191, 221])).toBe('macOS');
    });

    it('identifies Android probe signatures with Interworking capability (Tag 107)', () => {
      expect(identifyOS('0,1,50,45,127,107,221')).toBe('Android');
      expect(identifyOS([0, 1, 50, 45, 107, 127, 221])).toBe('Android');
    });

    it('identifies Windows probe signatures with Microsoft WPS tags', () => {
      expect(identifyOS('0,1,50,3,45,127,221')).toBe('Windows');
      expect(identifyOS([0, 1, 3, 45, 127, 221])).toBe('Windows');
    });

    it('identifies generic Linux / wpa_supplicant signatures', () => {
      expect(identifyOS('0,1,50,45,127')).toBe('Linux');
      expect(identifyOS([0, 1, 3, 50, 45, 127])).toBe('Linux');
    });

    it('identifies IoT / Embedded microcontroller minimal signatures', () => {
      expect(identifyOS('0,1,50,221')).toBe('IoT / Embedded');
      expect(identifyOS('0,1,50')).toBe('IoT / Embedded');
      expect(identifyOS([0, 1, 45])).toBe('IoT / Embedded');
    });

    it('returns Unknown for empty or unrecognized signatures without metadata', () => {
      expect(identifyOS('')).toBe('Unknown');
      expect(identifyOS('999,888,777')).toBe('Unknown');
      expect(identifyOS(null)).toBe('Unknown');
    });
  });

  describe('Metadata & Heuristic Fallbacks', () => {
    it('uses DHCP hostname hints to resolve OS', () => {
      expect(identifyOS('', { dhcpHostname: "Johns-iPhone-14" })).toBe('iOS');
      expect(identifyOS('', { dhcpHostname: "Galaxy-S23-Ultra" })).toBe('Android');
      expect(identifyOS('', { dhcpHostname: "DESKTOP-8K39FM" })).toBe('Windows');
      expect(identifyOS('', { dhcpHostname: "MacBook-Pro.local" })).toBe('macOS');
      expect(identifyOS('', { dhcpHostname: "raspberrypi" })).toBe('Linux');
      expect(identifyOS('', { dhcpHostname: "tasmota-plug-42" })).toBe('IoT / Embedded');
    });

    it('uses Vendor OUI patterns to identify OS family', () => {
      expect(identifyOS('0,1,50,221', { vendor: 'Espressif Inc.' })).toBe('IoT / Embedded');
      expect(identifyOS('', { vendorOuis: '00:50:f2:04' })).toBe('Windows');
      expect(identifyOS('', { vendorOuis: '00:17:f2:0a' })).toBe('iOS');
    });
  });

  describe('OS Presentation & UI Badges', () => {
    it('returns correct icons and styles for each OS family', () => {
      expect(getOsPresentation('iOS').icon).toBe('Smartphone');
      expect(getOsPresentation('macOS').icon).toBe('Laptop');
      expect(getOsPresentation('Android').icon).toBe('Smartphone');
      expect(getOsPresentation('Windows').icon).toBe('Monitor');
      expect(getOsPresentation('Linux').icon).toBe('Terminal');
      expect(getOsPresentation('IoT / Embedded').icon).toBe('Cpu');
      expect(getOsPresentation('Unknown').icon).toBe('HelpCircle');
    });
  });
});
