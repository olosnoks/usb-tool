# Lite DB Browser

**Purpose**: View SQLite database files and query databases exposed over HTTP,
without leaving the browser. Read-only and self-contained.

**SQLite file tab**:
- Open a `.sqlite` / `.sqlite3` / `.db` file. It is parsed entirely in the
  browser and never uploaded.
- Lists tables from `sqlite_master`, shows each `CREATE TABLE` statement, and
  pages through rows (100 per page) with a `rowid` column. `INTEGER PRIMARY KEY`
  columns alias the rowid (SQLite stores them as NULL in the record).
- Decodes the record format: integers, floats, text (honouring the database
  text encoding) and BLOBs (shown as length + leading hex). Large cells that
  spill onto overflow pages are reassembled.

**Endpoint tab**:
- Send an HTTP request (GET/POST/PUT/DELETE/HEAD) to a database or REST endpoint
  and render the JSON response as a table. Presets for PostgREST, CouchDB
  `_all_docs`, Elasticsearch `_search` and Datasette.
- Common envelope shapes are flattened automatically (`rows`, `results`,
  `data`, Elasticsearch `hits.hits[]._source`, CouchDB `rows[].doc`).
- Browsers enforce CORS, so for hosts without CORS headers set a proxy in the
  bar at the top (same proxy convention as the other network workbenches).

**Implementation Details**:
- `src/utils/sqlite.js` — dependency-free, read-only SQLite 3 reader (header,
  `sqlite_master`, table b-trees, record format, overflow chains). It does not
  execute SQL, read indexes, or write.
- The endpoint tab uses `src/utils/netClient.js` (`proxiedFetch`).

**Notes**:
- Verified in `tests/sqlite.test.js` against a `sqlite3`-generated fixture
  (type decoding, paging, overflow, schema parsing).
- WAL side files and encrypted databases are not supported.
- Test only endpoints you own or are authorized to access.
