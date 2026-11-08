// The Lite DB Browser's SQLite studio on its own, for embedding in another page.
// The WarHog web flasher's Drive database view mounts it under its own panel
// (SD card bridge, WiGLE log import, hand-off to Wardrive Compare).
//
// Built by `npm run build:dbstudio` (vite.dbstudio.config.js) into
// dist-dbstudio/dbstudio.js + dbstudio.css: one script with React, CodeMirror
// and the studio inside, exposed as window.WarHogDbStudio. sql.js is NOT
// bundled; the host supplies its own (the flasher pins and hash-checks it):
//
//   WarHogDbStudio.setSqlJsLoader(() => initSqlJs({ wasmBinary }));
//   const h = WarHogDbStudio.mount(el, { log, onApi, onChange, onDrop });   // SqliteStudio props
//   h.update(props); h.unmount();
import React from 'react';
import { createRoot } from 'react-dom/client';
import SqliteStudio from './components/tools/dbbrowser/SqliteStudio.jsx';
import { setSqlJsLoader } from './utils/sqljs.js';
import './dbstudio.css';

export { setSqlJsLoader };
export const version = __DBSTUDIO_VERSION__;

export function mount(el, props = {}) {
  const root = createRoot(el);
  const render = (p) => root.render(<div className="dbstudio text-gray-200 text-sm antialiased"><SqliteStudio {...p} /></div>);
  render(props);
  return { update: render, unmount: () => root.unmount() };
}
