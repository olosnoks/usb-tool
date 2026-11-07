# Lite DB Browser

**Purpose**: Open SQLite database files and query databases over HTTP — all in
the browser; local files never leave the machine.

## SQLite file
Open a `.sqlite` / `.db` file, then switch between three modes:

- **Browse Data** — table list + paginated rows (100/page) with a `rowid`
  column, a per-page filter, and CSV export of the current page. Read-only,
  dependency-free (parsed by `src/utils/sqlite.js`).
- **Structure** — database info (page size, encoding, page count, size) and,
  per table, its columns (name, type, PK 🔑, NOT NULL, default) with row counts,
  plus indexes, views and triggers with their `CREATE` SQL. Dependency-free.
- **Execute SQL** — run arbitrary SQL against an in-memory copy via the sql.js
  WASM engine (`public/sql/sql-wasm.wasm`): multiple result sets, errors
  surfaced, sample queries, Ctrl/Cmd+Enter to run, and CSV export of results.
  The engine loads lazily on first use; if it can't load, Browse and Structure
  still work. **The original file on disk is never modified.**

**Export database (.sqlite)**: a header button serializes the in-memory database
— including any inserts/updates/DDL run in Execute SQL — to a downloadable
`.sqlite` file (`db.export()`), giving you a write-back path. (Browse & Structure
read the originally opened bytes, so they don't reflect in-session SQL edits;
the export does.)

## Endpoint
Query a database/REST endpoint over HTTP (PostgREST, CouchDB, Elasticsearch
`_search`, Datasette, or any JSON API) and render the JSON as a table. Presets
included; common envelope shapes auto-flattened; routed through the shared proxy
for non-CORS hosts.

**Implementation**: `src/utils/sqlite.js` (read-only reader + `parseColumnDefs`,
verified in `tests/sqlite.test.js`), `src/utils/sqljs.js` (lazy sql.js loader),
`src/components/tools/DbBrowserWorkbench.jsx`.

**Notes**: sql.js runs on an in-memory copy, so writes/DDL affect only that copy
for the session — there is no write-back to the file. Test only databases and
endpoints you own or are authorized to access.
