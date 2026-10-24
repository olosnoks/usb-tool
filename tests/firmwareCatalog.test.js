import { describe, it, expect, vi } from 'vitest';
import { 
  BUNDLED_FALLBACK_PRESETS, 
  PIGLET_VARIANTS,
  fetchFirmwareCatalog, 
  downloadFirmwareBinary 
} from '../src/services/firmwareCatalogService';

describe('Piglet and Firmware Catalog Presets', () => {
  it('provides structured Piglet variants for skon forks and Hamspiced official releases', () => {
    expect(PIGLET_VARIANTS.skon.length).toBe(6);
    expect(PIGLET_VARIANTS.ham.length).toBe(3);

    const allVariants = [...PIGLET_VARIANTS.skon, ...PIGLET_VARIANTS.ham];
    expect(allVariants.length).toBe(9);
  });

  it('contains exactly 1 unified Piglet card in BUNDLED_FALLBACK_PRESETS', () => {
    const pigletCards = BUNDLED_FALLBACK_PRESETS.filter(p => p.type === 'piglet');
    expect(pigletCards.length).toBe(1);

    const unifiedCard = pigletCards[0];
    expect(unifiedCard.isPigletSuite).toBe(true);
    expect(unifiedCard.name).toBe('Piglet Wardriver Suite');
    expect(unifiedCard.supportedChips).toContain('ESP32-S3');
    expect(unifiedCard.supportedChips).toContain('ESP32-C5');
  });

  it('all Piglet variant entries are configured as merged 0x0 binaries with valid download URLs', () => {
    const allVariants = [...PIGLET_VARIANTS.skon, ...PIGLET_VARIANTS.ham];
    
    allVariants.forEach(variant => {
      expect(variant.isMergedBinary).toBe(true);
      expect(variant.files[0].address).toBe('0x0');
      expect(variant.downloadUrl).toMatch(/^https:\/\//);
      if (variant.source === 'skon') {
        expect(variant.downloadUrl).toContain('olosnoks.github.io/piglet/firmware/');
      } else {
        expect(variant.downloadUrl).toContain('github.com/Hamspiced/piglet/releases/');
      }
    });
  });

  it('covers the expected target chips for Piglet (ESP32-S3, ESP32-C3, ESP32-C5, ESP32-C6)', () => {
    const allVariants = [...PIGLET_VARIANTS.skon, ...PIGLET_VARIANTS.ham];
    const chips = new Set(allVariants.map(p => p.device));
    
    expect(chips.has('ESP32-S3')).toBe(true);
    expect(chips.has('ESP32-C3')).toBe(true);
    expect(chips.has('ESP32-C5')).toBe(true);
    expect(chips.has('ESP32-C6')).toBe(true);
  });

  it('merges bundled Piglet suite preset with remote manifest options', async () => {
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
      expect(res.options.length).toBeGreaterThanOrEqual(2);
      // Ensure Piglet is preserved at the top as 1 unified suite card
      expect(res.options[0].type).toBe('piglet');
      expect(res.options[0].isPigletSuite).toBe(true);
      expect(res.options.some(o => o.name === 'Some Random Remote Preset')).toBe(true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
