/**
 * waterfallThemes.js — colour maps for the spectrum waterfall.
 *
 * Each theme is a list of [position 0..1, r, g, b] stops; buildLut() turns it
 * into a 256-entry RGB table (Uint8Array of 768) by linear interpolation.
 * `trace` is the spectrum line colour that reads well on that map.
 */

export const WATERFALL_THEMES = [
  { id: 'inferno', name: 'Inferno', trace: '#34d399',
    stops: [[0, 0, 0, 4], [0.25, 87, 16, 110], [0.5, 188, 55, 84], [0.75, 249, 142, 9], [1, 252, 255, 164]] },
  { id: 'viridis', name: 'Viridis', trace: '#f59e0b',
    stops: [[0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37]] },
  { id: 'plasma', name: 'Plasma', trace: '#67e8f9',
    stops: [[0, 13, 8, 135], [0.25, 126, 3, 168], [0.5, 204, 71, 120], [0.75, 248, 149, 64], [1, 240, 249, 33]] },
  { id: 'magma', name: 'Magma', trace: '#34d399',
    stops: [[0, 0, 0, 4], [0.25, 81, 18, 124], [0.5, 183, 55, 121], [0.75, 251, 136, 97], [1, 252, 253, 191]] },
  { id: 'turbo', name: 'Turbo (rainbow)', trace: '#ffffff',
    stops: [[0, 48, 18, 59], [0.15, 65, 90, 220], [0.3, 30, 170, 230], [0.45, 60, 230, 150], [0.6, 180, 240, 60], [0.75, 250, 180, 40], [0.9, 230, 80, 20], [1, 122, 4, 3]] },
  { id: 'sdr-classic', name: 'Classic SDR (blue → red)', trace: '#ffffff',
    stops: [[0, 0, 0, 32], [0.2, 0, 0, 140], [0.4, 0, 110, 255], [0.55, 0, 220, 220], [0.7, 255, 255, 0], [0.85, 255, 80, 0], [1, 255, 255, 255]] },
  { id: 'gqrx', name: 'GQRX', trace: '#ffffff',
    stops: [[0, 0, 0, 0], [0.2, 0, 0, 128], [0.4, 0, 128, 255], [0.6, 0, 255, 255], [0.8, 255, 255, 0], [1, 255, 0, 0]] },
  { id: 'phosphor', name: 'Green phosphor', trace: '#f59e0b',
    stops: [[0, 0, 8, 0], [0.5, 0, 120, 30], [0.8, 60, 255, 80], [1, 230, 255, 230]] },
  { id: 'cool', name: 'Cool (ice)', trace: '#f59e0b',
    stops: [[0, 2, 6, 23], [0.4, 14, 60, 140], [0.7, 56, 189, 248], [1, 240, 253, 255]] },
  { id: 'gray', name: 'Grayscale', trace: '#34d399',
    stops: [[0, 0, 0, 0], [1, 255, 255, 255]] }
];

export const DEFAULT_WATERFALL_THEME = 'inferno';
const STORAGE_KEY = 'skon-waterfall-theme';

export function getTheme(id) {
  return WATERFALL_THEMES.find((t) => t.id === id) || WATERFALL_THEMES[0];
}

/** 256 x RGB lookup table for a theme (or theme id). */
export function buildLut(themeOrId) {
  const theme = typeof themeOrId === 'string' ? getTheme(themeOrId) : themeOrId;
  const stops = theme.stops;
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const a = stops[k], b = stops[k + 1];
    const span = b[0] - a[0] || 1;
    const f = Math.max(0, Math.min(1, (t - a[0]) / span));
    lut[i * 3] = Math.round(a[1] + (b[1] - a[1]) * f);
    lut[i * 3 + 1] = Math.round(a[2] + (b[2] - a[2]) * f);
    lut[i * 3 + 2] = Math.round(a[3] + (b[3] - a[3]) * f);
  }
  return lut;
}

/** CSS gradient string for a theme swatch. */
export function themeGradient(themeOrId) {
  const theme = typeof themeOrId === 'string' ? getTheme(themeOrId) : themeOrId;
  return `linear-gradient(90deg, ${theme.stops.map((s) => `rgb(${s[1]},${s[2]},${s[3]}) ${Math.round(s[0] * 100)}%`).join(', ')})`;
}

export function loadThemeId() {
  try { const v = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY); return v && getTheme(v).id === v ? v : DEFAULT_WATERFALL_THEME; }
  catch (_) { return DEFAULT_WATERFALL_THEME; }
}

export function saveThemeId(id) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
}
