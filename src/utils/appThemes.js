/**
 * appThemes.js — whole-app colour themes.
 *
 * The UI is written with Tailwind colour classes (bg-slate-900, text-purple-300,
 * border-cyan-500/40 …). tailwind.config.js points every shade of the hues the
 * app uses at a CSS variable with Tailwind's own colour as the fallback, e.g.
 *   bg-slate-900  ->  rgb(var(--tw-slate-900, 15 23 42) / <alpha>)
 * so a theme only has to set those variables on <html>. The "default" theme
 * removes them and the original palette comes back.
 *
 * Each theme gives a slate ladder (page background → bright text) and one base
 * colour per accent family; the 11-shade Tailwind scale for each accent is
 * generated from that base by varying lightness.
 */

export const THEME_HUES = ['slate', 'purple', 'cyan', 'amber', 'emerald', 'rose', 'blue', 'pink', 'indigo', 'yellow', 'sky', 'teal', 'orange', 'violet'];
export const THEME_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

// Which theme accent each Tailwind hue follows.
const HUE_TO_ACCENT = {
  purple: 'purple', violet: 'purple', indigo: 'blue', blue: 'blue',
  cyan: 'cyan', sky: 'cyan', teal: 'cyan',
  emerald: 'green', amber: 'orange', orange: 'orange', yellow: 'yellow',
  rose: 'red', pink: 'pink'
};

// Lightness offsets (HSL, percentage points) from the base colour, which sits at shade 400.
const ACCENT_OFFSETS = { 50: 42, 100: 36, 200: 27, 300: 15, 400: 0, 500: -8, 600: -16, 700: -25, 800: -33, 900: -41, 950: -49 };

export const APP_THEMES = [
  { id: 'default', name: 'Skon default (slate)', vsCode: false },
  {
    id: 'dracula', name: 'Dracula',
    slate: { 950: '#191a21', 900: '#21222c', 800: '#282a36', 700: '#44475a', 500: '#6272a4', 300: '#bfc4d8', 100: '#f8f8f2' },
    accents: { purple: '#bd93f9', cyan: '#8be9fd', blue: '#8be9fd', green: '#50fa7b', orange: '#ffb86c', yellow: '#f1fa8c', red: '#ff5555', pink: '#ff79c6' }
  },
  {
    id: 'one-dark-pro', name: 'One Dark Pro',
    slate: { 950: '#1b1d23', 900: '#21252b', 800: '#282c34', 700: '#3e4451', 500: '#5c6370', 300: '#abb2bf', 100: '#e6e6e6' },
    accents: { purple: '#c678dd', cyan: '#56b6c2', blue: '#61afef', green: '#98c379', orange: '#d19a66', yellow: '#e5c07b', red: '#e06c75', pink: '#e06c75' }
  },
  {
    id: 'github-dark', name: 'GitHub Dark',
    slate: { 950: '#010409', 900: '#0d1117', 800: '#161b22', 700: '#30363d', 500: '#6e7681', 300: '#c9d1d9', 100: '#f0f6fc' },
    accents: { purple: '#bc8cff', cyan: '#39c5cf', blue: '#58a6ff', green: '#3fb950', orange: '#d29922', yellow: '#e3b341', red: '#f85149', pink: '#db61a2' }
  },
  {
    id: 'monokai-pro', name: 'Monokai Pro',
    slate: { 950: '#19181a', 900: '#221f22', 800: '#2d2a2e', 700: '#403e41', 500: '#727072', 300: '#c1c0c0', 100: '#fcfcfa' },
    accents: { purple: '#ab9df2', cyan: '#78dce8', blue: '#78dce8', green: '#a9dc76', orange: '#fc9867', yellow: '#ffd866', red: '#ff6188', pink: '#ff6188' }
  },
  {
    id: 'night-owl', name: 'Night Owl',
    slate: { 950: '#010e1a', 900: '#011627', 800: '#0b2942', 700: '#1d3b53', 500: '#637777', 300: '#b0bec5', 100: '#d6deeb' },
    accents: { purple: '#c792ea', cyan: '#7fdbca', blue: '#82aaff', green: '#addb67', orange: '#f78c6c', yellow: '#ecc48d', red: '#ef5350', pink: '#ff5874' }
  },
  {
    id: 'tokyo-night', name: 'Tokyo Night',
    slate: { 950: '#13131a', 900: '#16161e', 800: '#1a1b26', 700: '#292e42', 500: '#565f89', 300: '#a9b1d6', 100: '#c0caf5' },
    accents: { purple: '#bb9af7', cyan: '#7dcfff', blue: '#7aa2f7', green: '#9ece6a', orange: '#ff9e64', yellow: '#e0af68', red: '#f7768e', pink: '#f7768e' }
  },
  {
    id: 'nord', name: 'Nord',
    slate: { 950: '#242933', 900: '#2e3440', 800: '#3b4252', 700: '#434c5e', 500: '#4c566a', 300: '#d8dee9', 100: '#eceff4' },
    accents: { purple: '#b48ead', cyan: '#88c0d0', blue: '#81a1c1', green: '#a3be8c', orange: '#d08770', yellow: '#ebcb8b', red: '#bf616a', pink: '#b48ead' }
  },
  {
    id: 'solarized-dark', name: 'Solarized Dark',
    slate: { 950: '#00212b', 900: '#002b36', 800: '#073642', 700: '#1c4a56', 500: '#586e75', 300: '#93a1a1', 100: '#eee8d5' },
    accents: { purple: '#6c71c4', cyan: '#2aa198', blue: '#268bd2', green: '#859900', orange: '#cb4b16', yellow: '#b58900', red: '#dc322f', pink: '#d33682' }
  },
  {
    id: 'material-palenight', name: 'Material Palenight',
    slate: { 950: '#1b1e2b', 900: '#222436', 800: '#292d3e', 700: '#3a3f58', 500: '#676e95', 300: '#a6accd', 100: '#eeffff' },
    accents: { purple: '#c792ea', cyan: '#89ddff', blue: '#82aaff', green: '#c3e88d', orange: '#f78c6c', yellow: '#ffcb6b', red: '#f07178', pink: '#ff5370' }
  },
  {
    id: 'ayu-dark', name: 'Ayu Dark',
    slate: { 950: '#07090d', 900: '#0a0e14', 800: '#0d1017', 700: '#1c212b', 500: '#4d5566', 300: '#b3b1ad', 100: '#e6e1cf' },
    accents: { purple: '#d2a6ff', cyan: '#95e6cb', blue: '#59c2ff', green: '#c2d94c', orange: '#ff8f40', yellow: '#ffb454', red: '#f07178', pink: '#f07178' }
  },
  {
    id: 'synthwave-84', name: "SynthWave '84",
    slate: { 950: '#1a1626', 900: '#241b2f', 800: '#262335', 700: '#34294f', 500: '#848bbd', 300: '#d9d4ec', 100: '#ffffff' },
    accents: { purple: '#b893ce', cyan: '#36f9f6', blue: '#36f9f6', green: '#72f1b8', orange: '#ff8b39', yellow: '#fede5d', red: '#fe4450', pink: '#ff7edb' }
  },
  {
    id: 'catppuccin-mocha', name: 'Catppuccin Mocha',
    slate: { 950: '#11111b', 900: '#181825', 800: '#1e1e2e', 700: '#313244', 500: '#6c7086', 300: '#a6adc8', 100: '#cdd6f4' },
    accents: { purple: '#cba6f7', cyan: '#89dceb', blue: '#89b4fa', green: '#a6e3a1', orange: '#fab387', yellow: '#f9e2af', red: '#f38ba8', pink: '#f5c2e7' }
  }
];

export const DEFAULT_APP_THEME = 'default';
const STORAGE_KEY = 'skon-app-theme';

// ---- colour maths -----------------------------------------------------------

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]) {
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

/** 11-shade scale from one base colour (base = shade 400). Returns { shade: [r,g,b] }. */
export function accentScale(baseHex) {
  const [h, s, l] = rgbToHsl(hexToRgb(baseHex));
  const out = {};
  for (const shade of THEME_SHADES) {
    const off = ACCENT_OFFSETS[shade] / 100;
    const nl = Math.max(0.06, Math.min(0.97, l + off));
    // Ease saturation off at the very light / very dark ends so they stay readable.
    const ns = shade <= 100 ? s * 0.85 : shade >= 900 ? s * 0.9 : s;
    out[shade] = hslToRgb([h, ns, nl]);
  }
  return out;
}

/** Full slate ladder from the 7 anchors a theme provides. */
export function slateScale(anchors) {
  const a = Object.fromEntries(Object.entries(anchors).map(([k, v]) => [k, hexToRgb(v)]));
  return {
    950: a[950], 900: a[900], 800: a[800], 700: a[700],
    600: mix(a[700], a[500], 0.5), 500: a[500],
    400: mix(a[500], a[300], 0.5), 300: a[300],
    200: mix(a[300], a[100], 0.5), 100: a[100],
    50: mix(a[100], [255, 255, 255], 0.5)
  };
}

/** Every CSS variable a theme sets: { '--tw-slate-900': '15 23 42', … }, or null for the default. */
export function themeVariables(themeOrId) {
  const theme = typeof themeOrId === 'string' ? getAppTheme(themeOrId) : themeOrId;
  if (!theme || theme.id === DEFAULT_APP_THEME) return null;
  const vars = {};
  const slate = slateScale(theme.slate);
  for (const shade of THEME_SHADES) vars[`--tw-slate-${shade}`] = slate[shade].join(' ');
  const scales = {};
  for (const hue of THEME_HUES) {
    if (hue === 'slate') continue;
    const accent = HUE_TO_ACCENT[hue];
    const base = theme.accents[accent];
    if (!base) continue;
    scales[accent] = scales[accent] || accentScale(base);
    for (const shade of THEME_SHADES) vars[`--tw-${hue}-${shade}`] = scales[accent][shade].join(' ');
  }
  // Two in-between surfaces the header and scrollbar use.
  vars['--app-dark'] = mix(slate[950], slate[900], 0.45).join(' ');
  vars['--app-card'] = mix(slate[950], slate[900], 0.8).join(' ');
  return vars;
}

export function getAppTheme(id) {
  return APP_THEMES.find((t) => t.id === id) || APP_THEMES[0];
}

/** Apply a theme to the document (or any element with a .style). */
export function applyAppTheme(id, root = (typeof document !== 'undefined' ? document.documentElement : null)) {
  if (!root) return;
  const vars = themeVariables(id);
  const names = new Set(Object.keys(themeVariables(APP_THEMES[1])));   // every variable any theme sets
  for (const name of names) {
    if (vars && vars[name]) root.style.setProperty(name, vars[name]);
    else root.style.removeProperty(name);
  }
  root.dataset.appTheme = getAppTheme(id).id;
}

export function loadAppThemeId() {
  try {
    const v = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    return v && getAppTheme(v).id === v ? v : DEFAULT_APP_THEME;
  } catch (_) { return DEFAULT_APP_THEME; }
}

export function saveAppThemeId(id) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
}

/** Preview colours for a swatch: [page, surface, accent purple, accent cyan]. */
export function themeSwatch(themeOrId) {
  const theme = typeof themeOrId === 'string' ? getAppTheme(themeOrId) : themeOrId;
  if (theme.id === DEFAULT_APP_THEME) return ['#020617', '#0f172a', '#a855f7', '#22d3ee'];
  return [theme.slate[950], theme.slate[800], theme.accents.purple, theme.accents.cyan];
}
