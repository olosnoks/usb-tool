/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        cyber: {
          darkest: '#020617', // slate-950
          dark: '#070c18',
          card: '#0c1322',
          border: '#1e293b',
          muted: '#64748b',
          amber: '#fbbf24', // Amber-400 primary accent
          amberGlow: 'rgba(251, 191, 36, 0.15)',
          cyan: '#22d3ee',  // Cyan-400 data telemetry
          cyanGlow: 'rgba(34, 211, 238, 0.15)',
          emerald: '#34d399', // Emerald-400 signal LEDs
          emeraldGlow: 'rgba(52, 211, 153, 0.2)',
          rose: '#f43f5e',    // Rose-500 alarms & interrupts
          violet: '#a78bfa',  // Violet-400 debug
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
