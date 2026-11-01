import colors from 'tailwindcss/colors';

// App-wide themes (src/utils/appThemes.js) swap the palette by setting CSS
// variables on <html>; every shade of these hues reads its variable with
// Tailwind's own colour as the fallback, so with no theme nothing changes.
const THEMED_HUES = ['slate', 'purple', 'cyan', 'amber', 'emerald', 'rose', 'blue', 'pink', 'indigo', 'yellow', 'sky', 'teal', 'orange', 'violet'];
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
const themedScale = (hue) => Object.fromEntries(
  SHADES.map((s) => [s, `rgb(var(--tw-${hue}-${s}, ${rgbOf(colors[hue][s])}) / <alpha-value>)`])
);
const themedColors = Object.fromEntries(THEMED_HUES.map((h) => [h, themedScale(h)]));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./wiki/index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ...themedColors,
        cyber: {
          darkest: 'rgb(var(--tw-slate-950, 2 6 23) / <alpha-value>)',   // slate-950
          dark: 'rgb(var(--app-dark, 7 12 24) / <alpha-value>)',
          card: 'rgb(var(--app-card, 12 19 34) / <alpha-value>)',
          border: 'rgb(var(--tw-slate-800, 30 41 59) / <alpha-value>)',
          muted: 'rgb(var(--tw-slate-500, 100 116 139) / <alpha-value>)',
          amber: 'rgb(var(--tw-amber-400, 251 191 36) / <alpha-value>)',     // Amber-400 primary accent
          amberGlow: 'rgba(251, 191, 36, 0.15)',
          cyan: 'rgb(var(--tw-cyan-400, 34 211 238) / <alpha-value>)',       // Cyan-400 data telemetry
          cyanGlow: 'rgba(34, 211, 238, 0.15)',
          emerald: 'rgb(var(--tw-emerald-400, 52 211 153) / <alpha-value>)', // Emerald-400 signal LEDs
          emeraldGlow: 'rgba(52, 211, 153, 0.2)',
          rose: 'rgb(var(--tw-rose-500, 244 63 94) / <alpha-value>)',        // Rose-500 alarms & interrupts
          violet: 'rgb(var(--tw-violet-400, 167 139 250) / <alpha-value>)',  // Violet-400 debug
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
        display: ['"Rajdhani"', '"Orbitron"', 'sans-serif'],
      },
      boxShadow: {
        'amber-glow': '0 0 15px -3px rgba(251, 191, 36, 0.3)',
        'cyan-glow': '0 0 15px -3px rgba(34, 211, 238, 0.3)',
        'emerald-glow': '0 0 12px 1px rgba(52, 211, 153, 0.4)',
        'rose-glow': '0 0 15px -3px rgba(244, 63, 94, 0.3)',
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scanline': 'scanline 8s linear infinite',
      },
      keyframes: {
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(1000%)' },
        }
      }
    },
  },
  plugins: [],
}
