import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [wasm(), react()],
  base: './', // Crucial for GitHub Pages static relative hosting
  server: {
    port: 3000,
    open: true
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        wiki: resolve(__dirname, 'wiki/index.html')
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Separate large vendor libs
            if (id.includes('react')) return 'react';
            if (id.includes('react-dom')) return 'react-dom';
            if (id.includes('cyberchef')) return 'cyberchef';
            return 'vendor';
          }
        }
      }
    }
  }
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        wiki: resolve(__dirname, 'wiki/index.html')
      }
    }
  }
});
