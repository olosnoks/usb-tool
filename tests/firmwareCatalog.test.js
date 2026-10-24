import { describe, it, expect, vi } from 'vitest';
import { 
  BUNDLED_FALLBACK_PRESETS, 
  fetchFirmwareCatalog, 
  downloadFirmwareBinary 
} from '../src/services/firmwareCatalogService';

describe('Piglet and Firmware Catalog Presets', () => {
  it('includes both skon forks and Hamspiced official Piglet firmwares in bundled presets', () => {
    const pigletPresets = BUNDLED_FALLBACK_PRESETS.filter(p => p.type === 'piglet');
    expect(pigletPresets.length).toBe(9);

    const skonForks = pigletPresets.filter(p => p.name.includes("skon's fork"));
    const hamOfficial = pigletPresets.filter(p => p.name.includes("Ham's Official"));

    expect(skonForks.length).toBe(6);
    expect(hamOfficial.length).toBe(3);
  });

  it('all Piglet presets are configured as merged 0x0 binaries with valid download URLs', () => {
    const pigletPresets = BUNDLED_FALLBACK_PRESETS.filter(p => p.type === 'piglet');
    
    pigletPresets.forEach(preset => {
      expect(preset.isMergedBinary).toBe(true);
      expect(preset.files[0].address).toBe('0x0');
      expect(preset.downloadUrl).toMatch(/^https:\/\//);
      if (preset.name.includes("skon's fork")) {
        expect(preset.downloadUrl).toContain('olosnoks.github.io/piglet/firmware/');
      } else {
        expect(preset.downloadUrl).toContain('github.com/Hamspiced/piglet/releases/');
      }
    });
  });

  it('covers the expected target chips for Piglet (ESP32-S3, ESP32-C3, ESP32-C5, ESP32-C6)', () => {
    const pigletPresets = BUNDLED_FALLBACK_PRESETS.filter(p => p.type === 'piglet');
    const chips = new Set(pigletPresets.map(p => p.device));
    
    expect(chips.has('ESP32-S3')).toBe(true);
    expect(chips.has('ESP32-C3')).toBe(true);
    expect(chips.has('ESP32-C5')).toBe(true);
    expect(chips.has('ESP32-C6')).toBe(true);
  });

  it('merges bundled Piglet presets with remote manifest options', async () => {
    // Mock global fetch
    const mockRemote = {
      options: [
        { name: 'Some Random Remote Preset', device: 'ESP32', type: 'other' }
      ]
    };
    
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockRemote
    });

    try {
      const res = await fetchFirmwareCatalog(true);
      expect(res.options.length).toBeGreaterThanOrEqual(10);
      // Ensure Piglet is preserved at the top
      expect(res.options[0].type).toBe('piglet');
      expect(res.options.some(o => o.name === 'Some Random Remote Preset')).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
