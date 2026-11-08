// Stands in for the sql.js package in the embeddable studio build
// (vite.dbstudio.config.js aliases 'sql.js' here): the host page supplies the
// engine with setSqlJsLoader(), so the package and its wasm are never bundled.
export default function initSqlJs() {
  throw new Error('sql.js is not bundled with the studio: call WarHogDbStudio.setSqlJsLoader() first');
}
