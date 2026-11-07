# Web Request Toolkit Workbench

**Purpose**: A Burp-style web request toolkit with four panels: Repeater, Intruder,
Comparer, and Decoder.

**Network limitation**: A browser cannot act as a transparent intercepting proxy.
Requests go through `fetch` and are CORS-limited; configure a proxy (the proxy bar)
to reach arbitrary hosts and read their full responses.

## Import

- Both Repeater and Intruder have an **Import request** box: paste a `curl` command
  or a raw HTTP request and parse it into the method, URL, headers, and body.

## Repeater

- Works over HTTP and HTTPS. A URL with no scheme defaults to `https://`.
- Choose a method, enter a URL, add headers (one `Key: Value` per line) and a body.
- **Send** shows the response with switchable views: **Pretty** (JSON formatted),
  **Raw**, **Hex** dump, and **Render** (sandboxed HTML preview), plus a response
  search box that highlights matches.
- **Copy as curl** copies the request; **→ Comparer A/B** sends the response to the
  Comparer. Every send is kept in **History**; click to restore.

## Intruder

- Mark fuzz positions with `{{value}}` in the URL, headers, or body.
- Attack types:
  - **Sniper** — one position at a time (positions × payloads).
  - **Battering ram** — the same payload in every position.
  - **Pitchfork** — parallel payload sets, one per position, advanced together.
  - **Cluster bomb** — every combination across positions' sets.
- **grep-match** flags responses containing a given string (highlighted column).
- Results table is sortable (click a header), filterable, and each row can be sent
  to the Comparer. Runs with bounded concurrency and can be stopped.

## Comparer

- Paste or send two responses/texts into A and B and **Compare** for a line-level
  diff (added / removed / unchanged) with counts.

## Decoder

- Encode/decode **Base64**, **URL**, **Hex**, **HTML** (UTF-8 safe).
- **JWT decode** (header + payload, signature not verified), **Smart decode**
  (auto-detect), and **MD5 / SHA-1 / SHA-256** hashing. "output → input" chains steps.

**Implementation**: `src/utils/intruder.js`, `src/utils/codec.js`,
`src/utils/httpImport.js` (curl/raw parsing, copy-as-curl), `src/utils/diff.js`
(LCS line diff), `src/utils/netClient.js` (proxy).

**Notes**:
- Some request headers (Host, Content-Length, etc.) are controlled by the browser
  and cannot be overridden from a page.
- The Render view runs the response in a sandboxed iframe with scripts disabled.
