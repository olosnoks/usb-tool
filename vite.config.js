import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { configDefaults } from 'vitest/config';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [wasm(), react()],
  base: './', // Crucial for GitHub Pages static relative hosting
  server: {
    port: 3000,
    open: true,
    // Dev-time stand-in for worker/index.js: the deployed site relays /api/shodan*
    // to Shodan from the Worker (no CORS); here Vite does the same. Keep the
    // longer prefix first — Vite matches keys by prefix in order.
    proxy: {
      '/api/crtsh': { target: 'https://crt.sh', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/crtsh/, '/') },
      '/api/hibp': { target: 'https://haveibeenpwned.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/hibp/, '/api/v3') },
      '/api/shodan-exploits': { target: 'https://exploits.shodan.io', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/shodan-exploits/, '/api') },
      '/api/shodan': { target: 'https://api.shodan.io', changeOrigin: true, rewrite: (p) => p.replace(/^\/api\/shodan/, '') },
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: false, // do not ship source maps; they reconstruct original source in dev tools
    chunkSizeWarningLimit: 1000,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // strip console.* from production
        drop_debugger: true,
        passes: 2
      },
      mangle: {
        toplevel: true // also mangle top-level names, not just locals
      },
      format: {
        comments: false // remove all comments from output
      }
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        wiki: resolve(__dirname, 'wiki/index.html')
      }
    }
  },
  test: {
    // The WASM toolchain checkouts (emsdk, aircrack-*) carry their own *.test.js; never ours.
    exclude: [...configDefaults.exclude, 'emsdk/**', 'aircrack-ng/**', 'aircrack-js/**']
  }

});
