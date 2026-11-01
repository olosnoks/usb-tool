import { describe, it, expect } from 'vitest';
import {
  APP_THEMES, THEME_HUES, THEME_SHADES, themeVariables, accentScale, slateScale, applyAppTheme, getAppTheme, hexToRgb, loadAppThemeId
} from '../src/utils/appThemes';

const lum = (rgb) => rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114;
const parse = (s) => s.split(' ').map(Number);

describe('app themes', () => {
  it('lists the default plus the VS Code themes and Dracula', () => {
    expect(APP_THEMES[0].id).toBe('default');
    expect(APP_THEMES.map((t) => t.id)).toContain('dracula');
    expect(APP_THEMES.length).toBeGreaterThanOrEqual(11);
  });

  it('every theme sets every shade of every hue as "r g b"', () => {
    for (const t of APP_THEMES.slice(1)) {
      const vars = themeVariables(t);
      for (const hue of THEME_HUES) for (const shade of THEME_SHADES) {
        const v = vars[`--tw-${hue}-${shade}`];
        expect(v, `${t.id} ${hue}-${shade}`).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      }
      expect(vars['--app-dark']).toMatch(/^\d{1,3} \d{1,3} \d{1,3}$/);
      // Slate ladder gets lighter from 950 (page) to 50 (brightest text), so dark-on-light contrast survives.
      const l = THEME_SHADES.map((s) => lum(parse(vars[`--tw-slate-${s}`])));
      for (let i = 1; i < l.length; i++) expect(l[i], `${t.id} slate ${THEME_SHADES[i]}`).toBeLessThanOrEqual(l[i - 1] + 0.01);
      const page = l[l.length - 1];                      // shade 950
      expect(l[0] - page).toBeGreaterThan(80);
      // Accent 300 (text on dark) is readable against the page background.
      expect(lum(parse(vars['--tw-purple-300'])) - page).toBeGreaterThan(90);
    }
  });

  it('accent scales keep the hue and get lighter toward 50', () => {
    const s = accentScale('#bd93f9');
    expect(s[400]).toEqual(hexToRgb('#bd93f9'));
    expect(lum(s[50])).toBeGreaterThan(lum(s[400]));
    expect(lum(s[950])).toBeLessThan(lum(s[700]));
    const slate = slateScale(APP_THEMES[1].slate);
    expect(Object.keys(slate).length).toBe(11);
  });

  it('applies and removes variables on an element', () => {
    const set = {}, removed = [];
    const el = { style: { setProperty: (k, v) => { set[k] = v; }, removeProperty: (k) => { removed.push(k); delete set[k]; } }, dataset: {} };
    applyAppTheme('dracula', el);
    expect(set['--tw-slate-800']).toBe('40 42 54');       // #282a36
    expect(el.dataset.appTheme).toBe('dracula');
    applyAppTheme('default', el);
    expect(Object.keys(set).length).toBe(0);
    expect(removed).toContain('--tw-purple-300');
    expect(el.dataset.appTheme).toBe('default');
    expect(themeVariables('default')).toBe(null);
    expect(getAppTheme('nope').id).toBe('default');
    expect(loadAppThemeId()).toBe('default');
  });
});
