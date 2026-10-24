import { describe, it, expect, vi } from 'vitest';
import { 
  BUNDLED_FALLBACK_PRESETS, 
  PIGLET_VARIANTS,
  fetchFirmwareCatalog, 
  groupFirmwareCatalog 
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

  it('every firmware in bundled presets points to an official repo and release binary', () => {
    const officialHosts = [
      'github.com/justcallmekoko/ESP32Marauder',
      'github.com/pr3y/Bruce',
      'github.com/Aircoookie/WLED',
      'micropython.org',
      'github.com/Hamspiced/piglet',
      'olosnoks.github.io/piglet'
    ];

    BUNDLED_FALLBACK_PRESETS.forEach(preset => {
      expect(preset.downloadUrl).toMatch(/^https:\/\//);
      const isOfficial = officialHosts.some(host => 
        preset.downloadUrl.includes(host) || preset.websiteUrl?.includes(host)
      );
      expect(isOfficial).toBe(true);
    });
  });

  it('groups multiple board entries into unified suites with dropdowns', () => {
    const suites = groupFirmwareCatalog(BUNDLED_FALLBACK_PRESETS);
    // Piglet, Marauder, Bruce, WLED, MicroPython
    expect(suites.length).toBe(5);

    const marauderSuite = suites.find(s => s.id === 'marauder');
    expect(marauderSuite).toBeDefined();
    expect(marauderSuite.boards.length).toBe(5); // Flipper WiFi, S3 Multiboard, CYD, Generic, Dual Mini C5

    const bruceSuite = suites.find(s => s.id === 'bruce');
    expect(bruceSuite).toBeDefined();
    expect(bruceSuite.boards.length).toBe(4); // CYD, AWOK Mini, Cardputer, ESP32-C5

    const wledSuite = suites.find(s => s.id === 'wled');
    expect(wledSuite).toBeDefined();
    expect(wledSuite.boards.length).toBe(3); // ESP32 Standard, ESP32-S3, ESP32-C3

    const microPythonSuite = suites.find(s => s.id === 'micropython');
    expect(microPythonSuite).toBeDefined();
    expect(microPythonSuite.boards.length).toBe(2); // ESP32 Generic, ESP32-S3
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

  it('guarantees 0 duplicate suite cards and 0 duplicate suite names across catalog', () => {
    // Simulate catalog containing duplicate piglet entries, duplicate board names, and mixed case types
    const mockCatalog = [
      ...BUNDLED_FALLBACK_PRESETS,
      { name: 'Piglet Mesh Node (ESP32-C5)', device: 'ESP32-C5', type: 'piglet' },
      { name: 'Piglet Wardriver (T-Dongle C5)', device: 'ESP32-C5', type: 'piglet' },
      { name: 'CYD 2432S028 (Bruce)', device: 'ESP32', type: 'bruce' },
      { name: 'M5Cardputer (M5PORKCHOP)', device: 'ESP32-S3', type: 'm5porkchop' }
    ];

    const grouped = groupFirmwareCatalog(mockCatalog);
    const suiteNames = grouped.map(g => g.familyName);
    const suiteIds = grouped.map(g => g.id);

    // Assert strictly no duplicates
    expect(new Set(suiteNames).size).toBe(suiteNames.length);
    expect(new Set(suiteIds).size).toBe(suiteIds.length);

    // Piglet suite must be exactly 1 card
    const pigletCards = grouped.filter(g => g.familyName.includes('Piglet') || g.id.includes('piglet'));
    expect(pigletCards.length).toBe(1);

    // Board entries inside Bruce must be deduplicated
    const bruceGroup = grouped.find(g => g.id === 'bruce');
    const cydBoards = bruceGroup.boards.filter(b => b.name === 'CYD 2432S028 (Bruce)');
    expect(cydBoards.length).toBe(1);
  });
});

