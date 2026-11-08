# Lite DB Browser

**Purpose**: A DB Browser for SQLite–style database studio that runs entirely
in the browser (sql.js / WASM — files never leave the machine), plus a client
for databases exposed over HTTP.

## SQLite

### Files and saving
- **New Database** creates an empty in-memory database. **Open Database** opens
  a `.sqlite` / `.db` file (or drop one on the tool).
- Edits happen in memory. **Write Changes** (Ctrl+S) saves them. In Chromium
  browsers (File System Access API) it writes **straight back to the file you
  opened**; otherwise it asks where to save, or downloads the file.
  **Revert Changes** goes back to the last written state; **Save As…** writes
  to a new file. The status bar shows unsaved changes, and the page warns
  before you close it with unwritten changes.
- **Open Database Read-Only** (enforced with `PRAGMA query_only`; writes fail
  and Write Changes is disabled). **Recent files** are listed in the Open
  menu when the browser keeps file handles (File System Access API).
- **Attach Database** adds another file under a schema name. Its tables show
  up in Database Structure (with "save copy" and "detach"), in Browse Data
  (browsable and editable), and in Execute SQL autocompletion as
  `schema.table`. Attached databases are saved separately and aren't part of
  Write Changes / Revert.
- **Projects**: Save/Open Project writes and reads `.sqbpro` files (the
  database name plus the SQL tabs), compatible with the desktop app.
- `PRAGMA foreign_keys` is on by default, as in DB4S.

### Database Structure
Tree of tables (expand to see columns, types and constraints, with row
counts), indices, views and triggers, plus each object's `CREATE` SQL.
- **Create Table / Modify Table**: a table designer with name, type, NN, PK
  (composite keys supported), AI, U, Default, Check, Collation and Foreign
  key per field; add / remove / reorder fields; table constraints; Without
  Rowid and Strict; and a live SQL preview. Renames use `ALTER TABLE RENAME`
  (indexes, triggers and views follow). Other changes use SQLite's
  table-rebuild procedure inside a savepoint, which is rolled back if anything
  fails, such as a CHECK that existing rows break. Dependent indexes and
  triggers that no longer apply are reported.
- **Create Index** (unique, column order ASC/DESC, partial `WHERE`),
  **Create View**, **Delete**, **Browse**, **Copy CREATE**.

### Browse Data
- Paged grid (50–1000 rows/page, go to row) for tables and views. Click a
  header to sort; Shift+click adds a sort column.
- **Per-column filters**: `text` (contains), `=x`, `<>x`, `>x`, `<x`, `>=x`,
  `<=x`, `a~b` (between), `/regex/`, `=NULL`, `<>NULL`, plus **Filter in any
  column**. **Save as view** stores the current filter and sort as a view;
  **CSV** exports every matching row.
- **Editing**: double-click or Enter to edit a cell inline, Esc to cancel.
  Arrow keys / Tab / PageUp / PageDown move between cells. Shift+click,
  Shift+arrows or drag selects a range; Ctrl+A selects the page. Click row
  numbers to select rows (Ctrl/Shift), then **Delete Record** (or Del).
  **New Record** inserts a row and fills NOT NULL columns. Rows are
  identified by rowid, or by primary key for WITHOUT ROWID tables; views are
  read-only.
- **Clipboard**: Ctrl+C copies the range as tab-separated text (Ctrl+Shift+C
  adds headers); Ctrl+V pastes a tab-separated block from the selected cell,
  or fills the whole selection with a single value. Del sets the range to
  NULL.
- **Undo / Redo** (Ctrl+Z / Ctrl+Y) for cell edits, pastes, new, duplicated
  and deleted records. Deleted rows come back with their original rowids. The
  history is cleared on revert, open and schema changes.
- **Right-click a cell**: Copy, Copy with Headers, Copy as SQL (INSERTs),
  Paste, Set as NULL, Use as filter, Jump to referenced row (foreign keys,
  also Ctrl+click; FK cells are underlined), Duplicate Record, Delete
  Record(s).
- **Right-click a header**: sort, hide column / show all, and **display
  formats**: decimal, exponent, hex, octal, hex blob, Unix epoch (UTC or
  local), Java epoch ms, Julian day, Apple NSDate, .NET ticks, lower/upper
  case. These change the display only.
- **Edit Database Cell** panel: Text / JSON / Binary (hex dump) / Image
  (PNG, JPEG, GIF, BMP, WebP, SVG) modes, Apply (Ctrl+Enter), Set as NULL,
  and import or export the cell to a file (for BLOBs).
- **Plot**: line, points or bars of numeric columns against the row number
  or any column; export as PNG or SVG.

### Edit Pragmas
auto_vacuum, automatic_index, cache_size, cell_size_check, foreign_keys,
ignore_check_constraints, journal_mode, max_page_count, page_size,
recursive_triggers, reverse_unordered_selects, secure_delete, synchronous,
temp_store, user_version and application_id, plus read-only encoding,
schema_version, page_count and freelist_count. Pragmas stored in the file are
marked; page_size and auto_vacuum run VACUUM.

### Execute SQL
- CodeMirror editor with SQLite highlighting and autocompletion of
  table/column names. Several editor tabs (double-click to rename) are kept in
  localStorage; you can open and save `.sql` files.
- **Execute all** (Ctrl+Enter / F5; runs the selection if there is one) and
  **Execute current** statement (Shift+F5 / Ctrl+Shift+Enter).
- A per-statement message log (rows returned or affected, timing). Errors show
  line and column, and the failing statement is selected in the editor. Click
  a statement to show its result set (capped at 50,000 rows). Results can be
  exported as CSV/JSON, saved as a view, or plotted.

### Import / Export / Tools
- **Import**: a table from CSV/TSV (separator, quote, text encoding —
  UTF-8/16, Windows-1252, ISO-8859-1/15, Shift-JIS, GBK, Big5, KOI8-R — header
  row, trim, empty fields as NULL, column type detection, preview; appends if
  the table exists), or a database from an SQL file.
- **Export**: an SQL dump (schema and/or data; selected tables; column names in
  INSERT; `IF NOT EXISTS`; `DROP TABLE`), tables or views as CSV or JSON (more
  than one is bundled into a .zip), or a copy of the `.sqlite` file.
- **Combine**: merge several SQLite files, optionally including the open one,
  into a single database. Same-named tables can be appended, renamed or kept
  first only. Duplicate keys can be kept, replaced, or given new IDs. An
  optional `_source` column records each row's file, and a per-table report
  is shown.
- **Tools**: Integrity Check, Quick Check, Foreign-Key Check, Optimize,
  Compact Database (VACUUM), Close Database.
- **SQL Log**: every statement the app or you ran, filterable by source.

## Endpoint
Query a database/REST endpoint over HTTP (PostgREST, CouchDB, Elasticsearch
`_search`, Datasette, or any JSON API) and render the JSON as a table. Presets
are included, common envelope shapes are flattened automatically, and requests
can go through the shared proxy for hosts without CORS.

**Implementation**: `src/components/tools/dbbrowser/` (UI: `SqliteStudio`,
`useDbSession`, `StructureTab`, `SchemaEditors`, `BrowseTab`, `EditCellPanel`, `PragmasTab`,
`ExecuteTab`, `ImportExport`, `CombinePanel`), `src/utils/sqliteStudio.js`
(SQL tokenizer/splitter, CREATE TABLE parser/generator, ALTER TABLE rebuild,
filters, CSV, dump, pragmas, script execution — `tests/sqliteStudio.test.js`),
`src/utils/sqliteMerge.js` (Combine — `tests/sqliteMerge.test.js`),
`src/utils/sqljs.js` (lazy sql.js loader).

**Not included** (compared with the desktop app): SQLCipher encryption,
loadable extensions, FTS5 (the bundled sql.js build has FTS3/4), and running
queries in the background — long queries block the page until they finish. Test only databases and
endpoints you own or are authorized to access.
