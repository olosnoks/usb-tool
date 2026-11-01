import { describe, it, expect } from 'vitest';
import { WATERFALL_THEMES, buildLut, getTheme, themeGradient, loadThemeId, DEFAULT_WATERFALL_THEME } from '../src/utils/waterfallThemes';

describe('waterfall themes', () => {
  it('every theme builds a full 256-entry RGB table that runs dark to bright', () => {
    for (const t of WATERFALL_THEMES) {
      const lut = buildLut(t.id);
      expect(lut.length).toBe(768);
      const lum = (i) => lut[i * 3] * 0.3 + lut[i * 3 + 1] * 0.59 + lut[i * 3 + 2] * 0.11;
      // Starts dark and reaches a bright region somewhere (rainbow maps end in deep red).
      let maxLum = 0;
      for (let i = 0; i < 256; i++) maxLum = Math.max(maxLum, lum(i));
      expect(lum(0)).toBeLessThan(60);
      expect(maxLum).toBeGreaterThan(lum(0) + 100);
      // Ends match the first and last stops exactly.
      expect([lut[0], lut[1], lut[2]]).toEqual(t.stops[0].slice(1));
      expect([lut[765], lut[766], lut[767]]).toEqual(t.stops[t.stops.length - 1].slice(1));
    }
  });

  it('interpolates between stops', () => {
    const lut = buildLut({ stops: [[0, 0, 0, 0], [1, 200, 100, 50]] });
    expect([lut[128 * 3], lut[128 * 3 + 1], lut[128 * 3 + 2]]).toEqual([100, 50, 25]);
  });

  it('falls back to the default for unknown ids and builds a CSS gradient', () => {
    expect(getTheme('nope').id).toBe(DEFAULT_WATERFALL_THEME);
    expect(loadThemeId()).toBe(DEFAULT_WATERFALL_THEME);
    expect(themeGradient('gray')).toBe('linear-gradient(90deg, rgb(0,0,0) 0%, rgb(255,255,255) 100%)');
  });
});
