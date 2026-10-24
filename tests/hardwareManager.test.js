import { describe, it, expect, vi } from 'vitest';
import {
  DEVICE_REGISTRY,
  GENERIC_DEVICE_PROFILE,
  CAPABILITIES,
  getDeviceProfile,
  hasCapability,
  getSupportedDeviceFilters,
  createRadioDriverInstance
} from '../src/utils/hardwareManager.js';

describe('Hardware Abstraction Layer (HAL) & Device Registry', () => {
  describe('Device Registry Definitions', () => {
    it('contains profiles for Realtek and MediaTek chipsets', () => {
      expect(Array.isArray(DEVICE_REGISTRY)).toBe(true);
      expect(DEVICE_REGISTRY.length).toBeGreaterThanOrEqual(4);

      // Verify Realtek RTL8812AU
      const rtl8812 = DEVICE_REGISTRY.find(d => d.vendorId === 0x0BDA && d.productId === 0x8812);
      expect(rtl8812).toBeDefined();
      expect(rtl8812.chipsetName).toContain('RTL8812AU');
      expect(rtl8812.capabilities).toContain(CAPABILITIES.MONITOR_MODE);
      expect(rtl8812.capabilities).toContain(CAPABILITIES.TX_SUPPORT);
      expect(rtl8812.capabilities).toContain(CAPABILITIES.DUAL_BAND);

      // Verify MediaTek MT7921AU
      const mt7921 = DEVICE_REGISTRY.find(d => d.vendorId === 0x0E8D && d.productId === 0x7961);
      expect(mt7921).toBeDefined();
      expect(mt7921.chipsetName).toContain('MT7921AU');
      expect(mt7921.capabilities).toContain(CAPABILITIES.MONITOR_MODE);
      expect(mt7921.capabilities).toContain(CAPABILITIES.HE_WIFI6);
      expect(mt7921.capabilities).not.toContain(CAPABILITIES.TX_SUPPORT);

      // Verify Realtek RTL8814AU
      const rtl8814 = DEVICE_REGISTRY.find(d => d.vendorId === 0x0BDA && d.productId === 0x8813);
      expect(rtl8814).toBeDefined();
      expect(rtl8814.chipsetName).toContain('RTL8814AU');
    });

    it('ensures all registry entries have valid fields and capabilities', () => {
      for (const entry of DEVICE_REGISTRY) {
        expect(typeof entry.vendorId).toBe('number');
        expect(typeof entry.productId).toBe('number');
        expect(typeof entry.chipsetName).toBe('string');
        expect(Array.isArray(entry.capabilities)).toBe(true);
        expect(entry.capabilities).toContain(CAPABILITIES.MONITOR_MODE);
      }
    });
  });

  describe('Profile Identification (getDeviceProfile)', () => {
    it('accurately resolves exact VID:PID matches', () => {
      const p1 = getDeviceProfile(0x0BDA, 0x8812);
      expect(p1.chipsetName).toBe('Realtek RTL8812AU');
      expect(p1.family).toBe('RTL8812AU');

      const p2 = getDeviceProfile(0x0E8D, 0x7961);
      expect(p2.chipsetName).toBe('MediaTek MT7921AU');
      expect(p2.family).toBe('MT7921AU');
    });

    it('falls back to vendor family when PID is unknown or missing', () => {
      const p = getDeviceProfile(0x0E8D, 0xFFFF);
      expect(p.vendorId).toBe(0x0E8D);
      expect(p.family).toBe('MT7921AU');
    });

    it('returns generic profile for unknown VID or null arguments', () => {
      const pUnknown = getDeviceProfile(0x1234, 0x5678);
      expect(pUnknown.chipsetName).toBe(GENERIC_DEVICE_PROFILE.chipsetName);
      expect(pUnknown.capabilities).toEqual(GENERIC_DEVICE_PROFILE.capabilities);

      const pNull = getDeviceProfile(null);
      expect(pNull).toEqual(GENERIC_DEVICE_PROFILE);
    });
  });

  describe('Capability Querying (hasCapability)', () => {
    it('returns true when capability exists on profile', () => {
      const rtl8812 = getDeviceProfile(0x0BDA, 0x8812);
      expect(hasCapability(rtl8812, CAPABILITIES.TX_SUPPORT)).toBe(true);
      expect(hasCapability(rtl8812, CAPABILITIES.DUAL_BAND)).toBe(true);
      expect(hasCapability(rtl8812, CAPABILITIES.MONITOR_MODE)).toBe(true);
    });

    it('returns false when capability is absent on profile', () => {
      const mt7921 = getDeviceProfile(0x0E8D, 0x7961);
      expect(hasCapability(mt7921, CAPABILITIES.TX_SUPPORT)).toBe(false);
      expect(hasCapability(mt7921, CAPABILITIES.HE_WIFI6)).toBe(true);
    });

    it('handles null, undefined, or empty inputs gracefully without throwing', () => {
      expect(hasCapability(null, CAPABILITIES.TX_SUPPORT)).toBe(false);
      expect(hasCapability({}, CAPABILITIES.TX_SUPPORT)).toBe(false);
      expect(hasCapability({ capabilities: null }, CAPABILITIES.TX_SUPPORT)).toBe(false);
    });
  });

  describe('WebUSB Filter Generation (getSupportedDeviceFilters)', () => {
    it('generates a deduplicated list of WebUSB filters for requestDevice', () => {
      const filters = getSupportedDeviceFilters();
      expect(Array.isArray(filters)).toBe(true);
      expect(filters.length).toBeGreaterThanOrEqual(4);

      const realtekFilter = filters.find(f => f.vendorId === 0x0BDA && f.productId === 0x8812);
      expect(realtekFilter).toBeDefined();

      const mediatekFilter = filters.find(f => f.vendorId === 0x0E8D && f.productId === 0x7961);
      expect(mediatekFilter).toBeDefined();
    });
  });

  describe('Driver Factory (createRadioDriverInstance)', () => {
    it('instantiates generic/MediaTek wrapper with uniform radio interface', async () => {
      const mockRawUsb = {
        vendorId: 0x0E8D,
        productId: 0x7961,
        productName: 'Alfa AWUS036AXML Wi-Fi 6',
        manufacturerName: 'Alfa Network',
        transferOut: vi.fn().mockResolvedValue({ status: 'ok' })
      };

      const driver = await createRadioDriverInstance(mockRawUsb);
      expect(driver).toBeDefined();
      expect(driver.chipsetModel).toBe('MediaTek MT7921AU');
      expect(driver.vendorId).toBe(0x0E8D);
      expect(driver.productId).toBe(0x7961);

      // Verify uniform API methods
      expect(typeof driver.initializeMonitor).toBe('function');
      expect(typeof driver.retune).toBe('function');
      expect(typeof driver.shutdownMonitor).toBe('function');
      expect(typeof driver.write).toBe('function');
      expect(typeof driver.hasCapability).toBe('function');

      // Capabilities
      expect(driver.hasCapability(CAPABILITIES.MONITOR_MODE)).toBe(true);
      expect(driver.hasCapability(CAPABILITIES.HE_WIFI6)).toBe(true);
      expect(driver.hasCapability(CAPABILITIES.TX_SUPPORT)).toBe(false);

      // Verify write rejects for chipsets without TX_SUPPORT
      await expect(driver.write(new Uint8Array(16))).rejects.toThrow(
        /Transmit not supported by MediaTek MT7921AU/
      );
    });

    it('allows write when chipset profile supports TX_SUPPORT', async () => {
      const mockTransferOut = vi.fn().mockResolvedValue({ status: 'ok' });
      const mockRawUsb = {
        vendorId: 0x0E8D,
        productId: 0x7612, // MT7612U has TX_SUPPORT
        productName: 'Alfa AWUS036ACM',
        manufacturerName: 'Alfa Network',
        transferOut: mockTransferOut
      };

      const driver = await createRadioDriverInstance(mockRawUsb);
      expect(driver.hasCapability(CAPABILITIES.TX_SUPPORT)).toBe(true);

      const payload = new Uint8Array([1, 2, 3, 4]);
      await driver.write(payload);
      expect(mockTransferOut).toHaveBeenCalledWith(2, payload);
    });

    it('throws error when no device is provided', async () => {
      await expect(createRadioDriverInstance(null)).rejects.toThrow(
        'No WebUSB device supplied to driver factory'
      );
    });
  });
});
