// Builds the Lite DB Browser's SQLite studio on its own (src/dbstudio.jsx) as
// one script + one stylesheet for embedding in another page, e.g. the WarHog
// web flasher's Drive database view:  npm run build:dbstudio  ->  dist-dbstudio/
//   dbstudio.js    IIFE exposing window.WarHogDbStudio { mount, setSqlJsLoader, version }
//                  with React, ReactDOM, CodeMirror, lucide and JSZip inside
//   dbstudio.css   Tailwind for the studio's components (preflight included)
// sql.js is deliberately left out (see src/dbstudio-sqljs-stub.js).
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
const sha = (() => { try { return execSync('git rev-parse --short HEAD', { cwd: __dirname }).toString().trim(); } catch { return 'unknown'; } })();

export default defineConfig({
  plugins: [react()],
  publicDir: false,   // nothing from public/ belongs in this build
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    __DBSTUDIO_VERSION__: JSON.stringify(`${pkg.version}+${sha}`),
  },
  resolve: { alias: { 'sql.js': resolve(__dirname, 'src/dbstudio-sqljs-stub.js') } },
  css: { postcss: { plugins: [tailwindcss({ config: resolve(__dirname, 'tailwind.dbstudio.config.js') }), autoprefixer()] } },
  build: {
    outDir: 'dist-dbstudio',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: false,
    minify: 'terser',
    terserOptions: { format: { comments: false } },
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, 'src/dbstudio.jsx'), name: 'WarHogDbStudio', formats: ['iife'], fileName: () => 'dbstudio.js' },
    rollupOptions: { output: { assetFileNames: 'dbstudio.[ext]', inlineDynamicImports: true } },
  },
});
