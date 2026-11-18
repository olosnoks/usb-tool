/**
 * Crypto & Data Tools Wiki Articles
 * Hash & HMAC Calculator, JWT Inspector, Regex Tester and DB Browser.
 *
 * Written against the current tools: everything here runs client-side in the
 * browser. Where a tool has a limit, the article says so.
 */

export const CRYPTO_DATA_ARTICLES = [
  {
    id: 'hash-calculator',
    toolId: 'hash-calculator',
    category: 'webapp',
    title: 'Hash & HMAC Calculator — MD5, SHA-1/2/3, RIPEMD, CRC, HMAC and digest verify',
    summary: 'Digest text or several files with MD5, the SHA-1/2/3 families, RIPEMD-160, CRC-32 and more, compute HMAC with a text/hex/base64 key, verify against an expected digest, and copy a SHA256SUMS-style list. Runs in the browser.',
    tags: ['Hash', 'HMAC', 'MD5', 'SHA-1', 'SHA-256', 'SHA-3', 'RIPEMD-160', 'CRC-32', 'NTLM', 'Checksum', 'SHA256SUMS', 'Hash Calculator'],
    readTime: '5 min read',
    content: `
# Hash & HMAC Calculator

The **Hash Calculator** computes message digests for text you type or for one or more files you pick, entirely in your browser. Nothing is uploaded.

## Algorithms

| Output | Notes |
|---|---|
| **MD5, MD4, SHA-1** | Legacy; checksums and interoperability only |
| **SHA-224, SHA-256, SHA-384, SHA-512, SHA-512/256** | SHA-2 family |
| **SHA3-224, SHA3-256, SHA3-384, SHA3-512** | SHA-3 family |
| **RIPEMD-160** | |
| **CRC-32, Adler-32** | Error-detection checksums, not security hashes |
| **NTLM** | Shown for **text** input only (MD4 of the UTF-16LE text) |

Each row has a copy button for the hex digest.

## Using it

1. **Text:** type or paste in the box. Digests update live and are computed over the UTF-8 bytes; a trailing newline changes every digest.
2. **Files:** click **Hash file(s)** and pick one or many. The box is replaced by the file name and size; **use text** returns to text. Each file is read fully into memory.
3. **HMAC:** tick **HMAC mode (keyed)**, enter a key and choose its encoding (**text**, **hex** or **base64**). The rows become \`HMAC-<algorithm>\`. HMAC is offered for the hash families only, not for CRC-32, Adler-32 or MD4. An invalid hex or base64 key shows a "Key error".

## Verify against an expected digest

Paste a known hash into **Expected digest (verify)**. Case and spaces are ignored. The tool lists which algorithms fit that length, marks the matching row **match** or **no match**, and shows an overall result. A non-hex entry is reported as "Not a hex string". With several files it checks the first file and the table shows each file's result.

## Several files and SHA256SUMS

With more than one file, results appear as a table. Choose an algorithm in the selector and press **Copy as SHA256SUMS** (the button name follows the algorithm, for example SHA512SUMS) to copy \`digest  filename\` lines you can save and check with \`sha256sum -c\`.

## Which algorithm to trust

- **MD5, MD4, SHA-1** are broken for collision resistance: fine for catching accidental corruption or matching a legacy checksum, not for signatures or security decisions.
- **SHA-256 / SHA-512 / SHA-3** are the normal choices.
- A plain hash is not a safe way to store passwords; use a slow, salted password hash (Argon2, scrypt, bcrypt, PBKDF2) on the server.
- A matching digest proves authenticity only if you got the published hash over a channel you trust.

## Limits

- Large files are read fully into memory and may be slow or fail on low-memory devices.
- For hash *cracking* use the Hash Cracker; for other encodings and algorithms use CyberChef.
`,
  },
  {
    id: 'jwt-inspector',
    toolId: 'jwt-inspector',
    category: 'webapp',
    title: 'JWT Inspector — decode, claim checks, signature verification, JWKS and signing',
    summary: 'Decode a JSON Web Token, check exp/nbf/iat and expected iss/aud/sub with leeway, verify HS/RS/PS/ES/EdDSA signatures (secret, PEM, certificate, JWK or JWKS), flag risky header fields, and build signed test tokens. Client-side.',
    tags: ['JWT', 'JSON Web Token', 'HS256', 'RS256', 'ES256', 'PS256', 'EdDSA', 'JWKS', 'JWK', 'Token', 'Signature', 'JWT Inspector'],
    readTime: '6 min read',
    content: `
# JWT Inspector

A jwt.io-style tool that runs in your browser. The token, secrets and keys stay on the page; the only network access is a JWKS fetch you request explicitly. It has two tabs, **Decode / Verify** and **Encode / Sign**.

## Decode / Verify tab

### Decoding
Paste a token (\`header.payload.signature\`) into **Encoded token**. The three parts are colour-coded and the header and payload are decoded from base64url and pretty-printed. A malformed token shows an error. The page opens with the jwt.io sample token (HS256, secret \`your-256-bit-secret\`).

> Decoding is not verification. Anyone can read a JWT payload; it is trustworthy only after the signature is verified with the right key and the claims are checked.

### Copy buttons
Under the encoded token: **Token**, **Payload** (decoded JSON), **curl** (a \`curl -H 'Authorization: Bearer ...' URL\` command; edit the URL box next to the buttons) and **jwt-cli** (an export command for the separate jwt-cli tool, \`jwt decode ...\`, to run in your terminal; it includes the verify-box secret when the token is HS* and the secret is typed as Text, so check it before sharing). The tool does not send requests itself.

### Header warnings
Amber warnings flag risky header content: \`alg: none\` and case variants of it or of a real algorithm name, \`jku\`, \`x5u\`, an embedded \`jwk\` or \`x5c\` (the token telling the verifier which key to trust), and a \`kid\` with path, quote, SQL or shell characters. These describe how a verifier could be misled; a server should pin the algorithm and allow-list key sources.

### Claim checks
Chips show \`exp\`, \`nbf\` and \`iat\` against your computer's clock (live "expires in" countdown). Optional boxes **expected iss**, **expected aud** and **expected sub** compare those claims to your expected values, and **leeway** (seconds) tolerates clock skew. These checks are independent of the signature: a token can be validly signed and expired, or unexpired and forged.

A **lifetime bar** appears when the token has \`exp\` and a start (\`nbf\`, otherwise \`iat\`): it shows the start and expiry times, the total lifetime and the percentage used (green while valid, amber before \`nbf\`, red once expired). **Explain claims** lists every payload claim with a plain-English meaning for the standard ones (iss, sub, aud, exp, nbf, iat, jti, OIDC claims such as azp, nonce, auth_time, amr, plus scope, roles, groups and similar); other claims are labelled custom. Time claims also show as UTC dates.

### Verifying the signature
Put the key in the verify box and press **Verify**:

| Algorithm | What to paste |
|---|---|
| **HS256 / HS384 / HS512** | The shared secret, with encoding **Text**, **Hex**, **Base64** or **Base64url** (or an \`oct\` JWK) |
| **RS / PS / ES 256, 384, 512** and **EdDSA** | The **public** key as PEM (SPKI), a certificate, a JWK, or a whole **JWKS** (the key is chosen by the token's \`kid\`) |

The result says valid, not matching, or what is wrong with the key, and clears whenever the token, key or encoding changes. Verification uses Web Crypto; EdDSA needs a browser that supports Ed25519, otherwise the tool says so. ES signatures must be the raw r||s form JWS requires; a DER-encoded one is reported. An \`HS*\` token checked against a PEM-looking key triggers an algorithm-confusion warning. An \`alg: none\` token is never reported as valid.

### JWKS
- **Fetch JWKS from jku (untrusted)** appears when the header has a \`jku\`. The URL comes from the token itself, so treat it as untrusted.
- **Fetch JWKS from iss** appears when \`iss\` is an \`https://\` URL; it tries OIDC discovery (\`/.well-known/openid-configuration\`, then \`jwks_uri\`) and falls back to \`/.well-known/jwks.json\`.

Both fetches go through the proxy bar settings (direct when empty) and load the key set into the verify box.

## Encode / Sign tab
Choose an algorithm (HS, RS, PS, ES, EdDSA, or **none (unsigned, testing only)**), edit the header (the \`alg\` comes from the selector) and payload JSON, supply the secret or a PKCS#8 PEM / JWK **private** key, and press **Sign**. **Copy** copies the token and **Open in decoder** loads it in the first tab. Use it for test tokens against systems you own, for example to confirm your server rejects unsigned or wrongly signed tokens. Signing happens locally and keys are never logged.

## Common pitfalls
- HS tokens verify with the same secret that signed them; RS/PS/ES/EdDSA verify with the public key only.
- A trailing newline in a secret makes a valid HS token fail; check the encoding setting too.
- Certificates and bare public keys are accepted; private keys are the wrong input for verification.

## Similar tools
jwt.io (debugger and key handling), mike-engel's jwt-cli (terminal decode/encode), and browser decoders that load a JWKS. This tool adds the claim explanations, lifetime bar and copy-as-command buttons in one client-side page.
`,
  },
  {
    id: 'regex-tester',
    toolId: 'regex-tester',
    category: 'webapp',
    title: 'Regex Tester — live JavaScript regex with timeout, explainer, code generator and test cases',
    summary: 'Build a JavaScript regular expression with live highlighting, groups, replace and split, a worker-based timeout against catastrophic backtracking, a pattern explanation, code generation for other languages, shareable links and test cases.',
    tags: ['Regex', 'Regular Expression', 'RegExp', 'JavaScript', 'Match', 'Capture Groups', 'Replace', 'ReDoS', 'Permalink', 'Regex Tester'],
    readTime: '5 min read',
    content: `
# Regex Tester

A regex101-style tester using the **browser's own JavaScript \`RegExp\` engine** (the toolbar shows the engine). Nothing is sent anywhere.

## Matching runs with a timeout
Matching runs in a **Web Worker**. If a pattern backtracks catastrophically (for example \`(a+)+$\` on a long non-matching string), the **Timeout** selector (0.5 s, 2 s default, 5 s or 10 s) ends the run and shows a message instead of freezing the tab. Matching stops at 10,000 matches and says so.

## Pattern row
Type the pattern between the slashes; the flags box sits to the right. The copy button copies \`/pattern/flags\`. An invalid pattern shows the engine's error. **Common patterns…** loads a ready example (email, URL, IPv4, MAC, UUID, hex colour, ISO date with named groups, semantic version, hex bytes, duplicate words).

### Flags
Click a flag button to toggle it:

| Flag | Name | Effect |
|---|---|---|
| \`g\` | global | Find all matches |
| \`i\` | ignore case | Case-insensitive |
| \`m\` | multiline | \`^\` and \`$\` match at line breaks |
| \`s\` | dotall | \`.\` matches newlines |
| \`u\` | unicode | Full Unicode matching |
| \`v\` | unicodeSets | Unicode with set notation (replaces \`u\`) |
| \`y\` | sticky | Match from \`lastIndex\` |
| \`d\` | indices | Report group start/end positions |

## Modes and results
The mode selector offers **Matches**, **matchAll (all)** and **Split**.

- **Highlighted** shows matches in the test string with a count; an empty match is drawn as a thin marker.
- **Match details** lists each match's position and text, numbered groups (\`—\` if a group did not participate), named groups, and group indices when \`d\` is on. Split mode lists the parts.
- **Replace** takes \`$1\`, \`$<name>\` and the other JavaScript replacement tokens and shows the result.

## Explanation
The **Explanation** section breaks the pattern into a tree of tokens with a plain-language description and quantifier. It says "Cannot explain" with a reason for patterns it cannot parse.

## Test cases
Under **Test cases**, **+ Add test case** adds a line of text with an expectation (**any**, **should match**, **should not match**). Each shows match / no match with a check or cross against its expectation, or \`timeout\`.

## Code generator
Choose **JavaScript**, **Python**, **PHP**, **Go** or **C#** to get code with the current pattern, flags, test string and replacement, then **Copy**. Other engines differ from JavaScript (lookbehind, named-group syntax, Unicode classes), so test the result in the target language.

## Share link
**Share link** copies a URL that restores the pattern, flags, test string, replacement, mode and test cases from the page hash. The state is in the link itself; avoid putting secrets in the test string before sharing it.

## Tips
- Escape literal dots, brackets and parentheses with a backslash.
- \`(?:…)\` does not capture; \`(?=…)\` and \`(?<=…)\` are lookahead and lookbehind.
- Add \`?\` to a quantifier (\`.*?\`) to match as little as possible.

## Limits
This is the **JavaScript** flavour only; PCRE, Python \`re\`, .NET and RE2 differ in details.
`,
  },
  {
    id: 'db-browser',
    toolId: 'db-browser',
    category: 'webapp',
    title: 'DB Browser — SQLite Studio and HTTP Database Endpoints',
    summary: 'Open, design, browse, edit and query SQLite files in the browser (sql.js / WebAssembly), or query a database exposed over HTTP and view the JSON as a table.',
    tags: ['SQLite', 'Database', 'SQL', 'DB Browser', 'sql.js', 'Forensics', 'CSV', 'PostgREST', 'CouchDB', 'Elasticsearch', 'Datasette', 'WAL'],
    readTime: '10 min read',
    content: `
# DB Browser

The **DB Browser** has two tabs: **SQLite**, a studio in the style of "DB Browser for SQLite", and **Endpoint**, a viewer for databases exposed over HTTP.

## SQLite tab

The SQLite engine is **sql.js** (SQLite compiled to WebAssembly). The database lives in browser memory, and files are never uploaded.

### Opening files

- **New Database** creates an empty in-memory database.
- **Open Database** (menu) offers: *Open Database*, *Open Database Read-Only*, *Attach Database* (as a named schema you can query as \`schema.table\`), *Open / Save Project (.sqbpro)*, and a list of recent files.
- You can also drop a file onto the window. Recognised extensions: \`.sqlite\`, \`.sqlite3\`, \`.db\`, \`.db3\`, \`.s3db\`, \`.sl3\`.
- In browsers with the File System Access API (Chrome, Edge) the tool keeps a handle to the file so **Write Changes** (Ctrl+S) saves back to it. Elsewhere, use **Save As** or **Download a copy**.

### The four tabs

| Tab | What it does |
|---|---|
| **Database Structure** | Lists tables, views, indexes and triggers. Create, modify and delete tables and columns, with browse links |
| **Browse Data** | Page through a table or view, filter, sort, edit cells (text, number, NULL, blob) and add or delete rows |
| **Edit Pragmas** | Read and set SQLite PRAGMAs (for example \`foreign_keys\`, \`user_version\`, \`page_size\`) |
| **Execute SQL** | Multi-tab SQL editor with results grid. Saved tabs are remembered in your browser |

### Write Changes, Revert and undo

Edits are applied to the in-memory copy. Nothing reaches your file until you click **Write Changes**. The toolbar highlights the button when there are unwritten changes, and the page warns before you leave with unwritten changes. Revert discards them. Changes to an *attached* database are not part of Write Changes / Revert; use the "save copy" action next to it.

### Import and export

- **Import**: a table from a CSV file; a database from a SQL file.
- **Export**: the database to a SQL file, tables as CSV, tables as JSON, or **Download a copy (.sqlite)**.
- **Combine databases** merges several database files into one.

### Tools menu

Integrity Check, Quick Integrity Check, Foreign-Key Check, Optimize, Compact Database (VACUUM) and Close Database.

## Forensic use: WAL, journals and memory

SQLite databases in the wild often come with sidecar files:

- \`name.db-wal\` (write-ahead log) holds recent committed changes that have **not yet been merged** into the main file.
- \`name.db-journal\` (rollback journal) holds the pre-change pages of an interrupted transaction.
- \`name.db-shm\` is only a shared-memory index.

**This tool opens a single file.** It does not read or replay the \`-wal\` or \`-journal\` sidecars, so rows that exist only in the WAL will be missing. To include them:

1. Copy the \`.db\` **and** its \`-wal\` (and \`-shm\`) into one folder, keeping the same base name.
2. Open the copy with the command-line \`sqlite3\` (which replays the WAL on open) and run \`PRAGMA wal_checkpoint(TRUNCATE);\`, or simply \`VACUUM INTO 'merged.db';\`.
3. Open \`merged.db\` here.

Always work on a copy of evidence, never the original. Opening a WAL-mode database with a normal SQLite client can modify the files.

The whole file is read into browser memory, so very large databases (hundreds of MB or more) can exhaust the tab's memory. If a large file fails to open, use the command-line client, or export just the tables you need. The *journal_mode* pragma here only affects the in-memory copy.

Encrypted databases (SQLCipher) cannot be opened: they are not readable by stock SQLite.

## Endpoint tab

Queries a database or REST service over HTTP and shows the JSON response as a table.

- **Proxy bar**: leave empty for direct browser requests (works only when the server sends CORS headers), or set a local proxy (the Docker CORS proxy button fills in a ready value).
- **Presets**: PostgREST, CouchDB \`_all_docs\`, Elasticsearch \`_search\` and Datasette JSON. Replace \`host\` in the URL with your server.
- **Request**: choose GET, POST, PUT, DELETE or HEAD; add headers (one \`Name: value\` per line) and a body for POST/PUT.
- **Response**: status, size and time. If the response is JSON it is flattened into a grid (it understands plain arrays, \`{rows}\`, \`{results}\`, \`{data}\`, Elasticsearch \`hits.hits[]._source\` and CouchDB \`rows[].doc\`). Otherwise the raw text is shown. **Show raw / Show table** switches the view and **JSON** downloads the response.

> Only query endpoints you own or are authorised to access. Anything you put in headers (for example an API key) is sent to the target, and to your proxy if you use one.
`,
  },
];
