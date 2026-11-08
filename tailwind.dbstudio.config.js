// Tailwind for the standalone studio build: the app's theme, scanning only the
// files that end up in dist-dbstudio/dbstudio.js.
import base from './tailwind.config.js';

export default {
  ...base,
  content: ['./src/dbstudio.jsx', './src/components/tools/dbbrowser/**/*.{js,jsx}'],
};
