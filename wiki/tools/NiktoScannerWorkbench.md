# Web Path Prober Workbench

**Purpose**: Content discovery — probe many URL paths on a target and flag
interesting responses, plus the server header.

**Wordlists (SecLists)**:
- Load a path list with the wordlist picker: curated SecLists entries (common,
  quickhits, API endpoints, RAFT, big), a custom URL, or an uploaded file.
- SecLists are fetched from the jsDelivr CDN (`cdn.jsdelivr.net/gh/danielmiessler/SecLists`),
  which is CORS-enabled, so loading works directly from the browser.
- With no list loaded, a small built-in list of ~16 common sensitive paths is used.

**Usage**:
- Optionally set a proxy (empty = direct).
- Load a path list, enter the target base URL, and click **Scan**. Scanning runs
  with bounded concurrency and a progress counter, and can be stopped.
- Only interesting responses are listed: 2xx/3xx and auth-gated (401/403). The
  summary shows total probed, interesting count, and blocked/unreachable count.

**Honest limitation**: a browser can only read a cross-origin response when the
target sends permissive CORS headers. Without a proxy, most responses are
unreadable and counted as "blocked". Configure a proxy to get real status codes.

**Implementation**: `src/utils/wordlists.js`, `src/components/tools/common/WordlistPicker.jsx`,
`src/utils/netClient.js`.
