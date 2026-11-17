# Audit: Crypto & Data, Reference & Setup

Scope: hash-calculator, pwned-passwords (passwords / email / catalog tabs), jwt-inspector, cert-inspect,
cyberchef, regex-tester, db-browser, hashcat-cracker (bugs and usability only), setup, pinouts-modal,
session-log and the wiki (`src/wiki`). Audit only, no code was changed. Read from the working tree on
`main` (uncommitted changes included). Effort: S under a day, M a few days, L a week or more.
Value: H/M/L for a typical user of a browser-only toolkit.

Legend for "Feasible": yes means doable client-side in a browser, with the reason where it is not obvious.

---

## 1. hash-calculator (`HashCalculatorWorkbench.jsx`, `utils/md5.js`)

### Does today
- Live-hashes a textarea, or one picked file, with MD5 (local JS), SHA-1/256/384/512 (Web Crypto).
- Optional HMAC for the four SHA variants with a text key. MD5 is shown unkeyed in HMAC mode, with a note.
- Per-row copy button. The whole file is read into memory with `arrayBuffer()`.

### Reference tools
`sha256sum`/`md5sum`/`openssl dgst`, HashCalc/HashTab (many algorithms, compare-to-expected), 7-Zip's CRC/SHA submenu.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Compare against an expected digest (paste a checksum or a `SHA256SUMS` line, auto-detect the algorithm by length, show match/mismatch) | yes | S | H |
| SHA-224, SHA-512/256, SHA-3 (224-512), RIPEMD-160, BLAKE2b/2s, CRC-32/CRC-16, Adler-32, MD4/NTLM. The CyberChef engine already has SHA-3, BLAKE2b, CRC-32 and Adler-32 in `utils/cyberchef/operations/hashing.js`, and `utils/md4.js` and `utils/checksums.js` exist. | yes: pure JS, no dependency needed (reuse the existing code) | M | H |
| Real HMAC for MD5 and the new algorithms (needs a JS HMAC wrapper because Web Crypto only keys SHA-1/2) | yes | S | M |
| HMAC key as hex/base64 (today text only, so binary keys cannot be tested) | yes | S | M |
| Large files: read in chunks with progress and cancel. Web Crypto has no incremental digest, so SHA-2 needs a JS incremental implementation, or the file is limited. | yes: incremental JS SHA-256/512, MD5 already incremental-able | M | M |
| Multiple files at once (drop 10 files, get a table, export `SHA256SUMS`) | yes | M | M |
| Output as base64 / uppercase | yes | S | L |
| Hash a folder / recursive tree | partly: needs the File System Access API (Chromium only) | M | L |

### Bugs / usability
1. Toggling HMAC mode or editing the key while a file is selected does not recompute. `compute()` runs only in `onFile`, and the live `useEffect` returns early when `fileInfo` is set, so the HMAC checkbox does nothing for files.
2. After "use text" the same file cannot be re-selected (the `<input type=file>` value is never reset), so choosing the same file twice does nothing.
3. In HMAC mode, MD5 is silently dropped from the results map (the "MD5 shown unkeyed" label is wrong: it is missing, not unkeyed).
4. A failed `importKey` is swallowed (`catch { /* skip */ }`), so the row just disappears with no message.
5. There is no unit test for this tool (`tests/` has `hashCrack`, not a hash-calculator test).

---

## 2. pwned-passwords (`PwnedPasswordsCheckerWorkbench.jsx`, `BreachTabs.jsx`, `utils/breachCheck.js`)

### Does today
- **Passwords tab**: SHA-1 each line locally, sends the 5-char prefix to `api.pwnedpasswords.com/range` through `proxiedFetch` with `Add-Padding`, and matches the suffix locally. Shows a masked result with a reveal toggle. Passwords are masked in the log.
- **Email tab**: up to 20 addresses, validated and de-duplicated, against XposedOrNot (no key) with an optional HIBP v3 `breachedaccount` call through the site's `/api/hibp` Worker relay with the user's own key. 1.6 s pacing for HIBP. Breach table with domain, date, data classes and verified flag. Masked in the log.
- **Catalog tab**: loads the full HIBP breach list, filters by name or domain, first 50 shown.
- Scope note says it only reports membership, not records.

### Reference tools
haveibeenpwned.com (account, domain search, pastes, Pwned Passwords with NTLM mode), Firefox Monitor, 1Password/Bitwarden "exposed passwords" report, `pwned-check` CLIs.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Import a password-manager CSV export (Bitwarden, 1Password, Chrome, Firefox) and audit all entries, showing which site/username is exposed (the passwords never leave the browser, only prefixes do) | yes | M | H |
| Cache range responses per prefix (identical prefixes are refetched today) and add a Cancel button (a 500-line list cannot be stopped) | yes | S | H |
| NTLM mode (`?mode=ntlm`) so Windows/AD NTLM hashes can be checked without knowing the password. `utils/md4.js` exists. | yes | S | M |
| Check a pre-computed SHA-1 hash directly | yes | S | M |
| Local strength meter / reuse detection (duplicates inside the list) alongside breach count | yes | S | M |
| HIBP pastes (`pasteaccount`) and per-breach detail view in the email tab; breached-domain search | yes (HIBP key; domain search needs a verified domain, so mostly no for ad-hoc use) | M | M |
| Export results as CSV (masked) | yes | S | L |
| Phone / username / name breach lookup | no: the note is correct, no reputable keyless API | n/a | n/a |
| Offline HIBP corpus (the 30+ GB file) | no: too big for the browser | n/a | L |

### Bugs / usability
1. Passwords tab: strictly sequential, no abort and no per-prefix cache. A network error produces a row with `count: -1` but the run keeps going and hammers the proxy.
2. A blank-after-trim password is a valid password, but `filter((l) => l.length > 0)` is correct. A trailing space is hashed as typed (correct), though users pasting from sheets may be surprised, and there is no "trim whitespace" toggle.
3. Catalog tab shows only the first 50 hits with no paging, and sorts nothing (HIBP order, not newest first).
4. The wiki article says the HIBP API is CORS-enabled "so this works directly", but the code routes through `proxiedFetch`. Both are fine, but the doc and code differ.
5. The email tab's HIBP call hits `/api/hibp` unconditionally. When the app is hosted elsewhere or in dev without the Worker the error text is clear, but the checkbox is not disabled up front.

---

## 3. jwt-inspector (`JwtInspectorWorkbench.jsx`, `utils/jwt.js`)

### Does today
- Decodes header and payload (base64url JSON), color-codes the three segments, shows time claims (`exp`, `nbf`, `iat`) with valid/expired state.
- Verifies HS256/384/512 (secret), RS/PS256-512 and ES256/384/512 (PEM SPKI or JWK public key) with Web Crypto. Warns on `alg: none`.
- Sample token preloaded, nothing leaves the browser.

### Reference tools
jwt.io (also encodes/signs, JWKS, claim checks), `jwt-cli`, Burp "JWT Editor", jwt_tool (attacks), `step crypto jwt`.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Encode/sign tab: edit header/payload JSON, sign with an HS secret or a private key (PEM PKCS8 / JWK) and produce a token | yes (Web Crypto) | M | H |
| Paste a JWKS (`{"keys":[...]}`) and auto-select the key by `kid` | yes | S | H |
| Fetch a JWKS from `iss`/`jku` URL through the proxy | yes (CORS or proxy) | S | M |
| Claim validation inputs: expected `iss`, `aud`, `sub`, clock skew leeway, and show failures | yes | S | H |
| EdDSA (Ed25519) verification (`alg: EdDSA`). Web Crypto Ed25519 is in current Chrome/Firefox/Safari. | yes with a runtime feature check | S | M |
| Secret input as hex/base64/base64url (HS keys from real systems are usually binary or base64) | yes | S | H |
| Security review hints: alg confusion (an HS token verified with an RSA public key text), weak HS secret check against a short common list, `kid` path traversal/SQLi hint, `jku`/`x5u` header warning | yes | M | M |
| JWE (5-part) decode of the protected header and structure, decryption with a key | partly: decode header yes, decryption M-L | M | L |
| Detect and show `typ`, `cty`, nested JWT | yes | S | L |
| Brute-force weak HS secrets | yes, but that belongs in the cracking tools (out of scope to propose) | n/a | n/a |

### Bugs / usability
1. `analyzeClaims` is memoized on the decoded token only, so "expires in Ns" never updates and goes stale on a long-open window.
2. The verify result is not cleared when the key text changes, only when the token changes, so a stale "Signature valid" can sit next to a different key.
3. `decodeJwt` throws for JWE (5 segments) and gives the generic "Expected 3 segments" message with no hint it may be a JWE.
4. `alg` with unusual casing (`hs256`, `None`) is neither flagged nor verified; `none` detection is exact-match only, and jwt.io-style attacks use `NoNe`.
5. `exp`/`nbf`/`iat` given as strings or floats are silently skipped (only `typeof number` handled) with no warning that the claim is malformed.
6. No test file for `utils/jwt.js` (tests exist for x509, breach, hashCrack, sessionLog, but none for jwt).

---

## 4. cert-inspect (`CertInspectWorkbench.jsx`, `utils/x509.js`)

### Does today
- Pure-JS DER/ASN.1 parser: subject, issuer, validity, serial, version, signature and key algorithm (RSA bits/exponent, EC curve), SAN, key usage, EKU, basic constraints, SKI/AKI, CRL DP, OCSP/CA Issuers, critical extensions, SHA-256/SHA-1 fingerprints, PEM download.
- Three sources: crt.sh CT-log lookup through the proxy (most recent 25 issued certs, not necessarily what is served), a PEM/DER file, pasted PEM (chains list each cert as a button). A "Live cert" button appears only if the optional TLS backend is configured.

### Reference tools
`openssl x509 -text`, `openssl s_client -showcerts`, SSL Labs, crt.sh page, Chrome's certificate viewer, `certigo`.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Chain view: order the pasted/loaded certs leaf to root, link by AKI/SKI and issuer, verify each signature against the next cert's public key (RSA PKCS1/PSS, ECDSA via Web Crypto), flag a missing intermediate or self-signed root | yes | M | H |
| Hostname match check (enter a hostname, test against SAN/CN with wildcard rules) | yes | S | H |
| File mode parses only the first certificate of a PEM bundle (pasting handles chains, file loading does not) | yes | S | H |
| SPKI SHA-256 pin (base64) and public key fingerprint; show SHA-512 and an MD5 for legacy comparisons | yes | S | M |
| Parse the CSR (PKCS#10), CRL and PKCS#7 (`.p7b`) certificate bundles; list PKCS#12 contents (needs a password and PBE crypto) | CSR/p7b yes, P12 partly (M-L) | M | M |
| Extensions not decoded: certificate policies, name constraints, SCT list (embedded CT proofs), TLS feature (must-staple), Netscape/MS OIDs | yes | M | M |
| Show unknown extensions as raw hex / OID instead of dropping them | yes | S | M |
| Live "what the server serves right now" without a backend | no: browsers cannot open raw TLS sockets, and a Worker `connect()` would require a TLS client implementation. The optional `tls-inspector` backend is the right answer; keep it and document the CT-vs-live difference. | n/a | n/a |
| Revocation check (OCSP / CRL fetch) | partly: OCSP/CRL servers usually send no CORS headers, so only through the proxy | M | M |
| Trust verdict against the system store ("is it trusted?") | no: the browser exposes no trust-store API; only an optional bundled Mozilla root list for chain building would work (L, ~200 KB) | L | M |
| Weakness hints (SHA-1 signature, RSA < 2048, validity > 398 days, missing SAN) | yes | S | M |

### Bugs / usability
1. File mode ignores bundle contents beyond the first certificate (see gaps).
2. `downloadPem` uses `String.fromCharCode(...der)`, which can throw "Maximum call stack size exceeded" for large DER inputs (PKCS#7 bundles loaded as a single cert, or malformed huge files). Chunk it.
3. `show()` handles a bad DER with an error but leaves a stale `certList` and chain buttons visible.
4. File accept list omits `.p7b`, `.csr`, `.key`, `.pub`.
5. The URL tab runs a crt.sh lookup and auto-loads the newest entry, so the displayed certificate can be a pre-certificate or a different issuer from what the site serves. The caption says so, but the result header ("Valid") reads like a statement about the live site.

---

## 5. cyberchef (`CyberChefWorkbench.jsx`, `utils/cyberchef/*`)

### Does today
Independent re-implementation of the CyberChef Operation/Dish/Chef/Recipe/Magic architecture, about 190 `name:` entries across 16 module files (counting arguments, roughly 100 real operations). Recipe builder with drag-reorder, per-step breakpoints, auto-bake, a Web Worker pipeline with main-thread fallback, localStorage-saved recipes, presets, a Magic heuristic modal, file drop input, history, entropy/byte-frequency analytics, and a "download standalone HTML" export. Operation set:
- **Encoding**: Base64/32/58/85, Hex, Hexdump, Decimal, Binary, URL encode/decode.
- **Crypto**: AES (modes), DES, 3DES, RC4, Blowfish, RSA encrypt/decrypt, Bcrypt, Scrypt, XOR, XOR brute force, ROT13, reverse.
- **Hash**: MD5, SHA-1, SHA-256, SHA-3, BLAKE2b, CRC-32, Adler-32, Identify Hash.
- **Compression**: Gzip/Gunzip, raw deflate/inflate, zip/unzip, untar.
- **Parsing**: JWT, X.509, ASN.1, RSA key, URI, IPv6, user agent, DNS/TCP/UDP/HTTP parsers, JSON/XML beautify and minify, datetime.
- **Extractors**: IPs, domains, URLs, emails, MACs, hashes, base64.
- **Forensics**: about 50 magic-number file-type detectors, EXIF extraction, entropy/frequency.
- **Flow**: Fork, Merge, Register, Subsection, Label, Jump, Custom Script (JS).

### Reference tools
GCHQ CyberChef (about 460 operations), CyberChef magic, `xxd`/`openssl enc`/`base64`, Ciphey, dcode.fr.

### Gaps (most used operations missing, by usage frequency in CyberChef)
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| **Find / Replace** and **Regular expression** (match list, capture groups, replace). Used in most real recipes. | yes | S | H |
| **HMAC**, **SHA-512 / SHA-384 / SHA-224 / SHA-512/256**, **RIPEMD-160**, **MD4/NTLM**, **MD2/MD6**, **Whirlpool**, **CRC-8/16/64 and parametrised CRC**, **Fletcher**, **BLAKE3/2s** | yes: SHA-2 via Web Crypto or JS, the rest pure JS (md4 already in repo) | M | H |
| **To / From Upper/Lower case**, **Sort**, **Unique**, **Head/Tail**, **Remove whitespace**, **Remove null bytes**, **Count occurrences**, **Filter/Drop bytes**, **Split/Merge lines**, **Strings** (extract printable strings), **Swap endianness**, **Reverse (bytes/lines)**, **Add line numbers** | yes | S | H |
| **AES-GCM / AES-CTR / AES-CBC with PKCS7 control**, **ChaCha20**, **Salsa20**, **Camellia**, **PBKDF2 / HKDF / Argon2 / EVP KDF**, **Derive key** (the current AES uses CryptoJS, no AEAD and no authenticated-decryption failures) | yes: AES-GCM/PBKDF2/HKDF/CTR via Web Crypto, ChaCha20 pure JS | M | H |
| **Caesar/ROT47/ROT-n brute**, **Vigenere** encode/decode, **Atbash**, **Affine**, **Bifid**, **Morse code**, **A1Z26**, **Substitute**, **Rail fence**, **Enigma/Bombe** | yes | S-M | M |
| **HTML entity encode/decode**, **Punycode**, **Quoted-printable**, **UTF-7/UTF-16/other charset conversion (Decode text / Encode text)**, **Base62**, **Base45**, **Base91**, **Base64 URL-safe alphabet option**, **Unicode escape / `\x` decoding**, **From/To Charcode**, **To/From Braille**, **Defang/Fang URL / IP** | yes (TextDecoder covers many charsets) | M | H |
| **Bzip2 decompress**, **LZMA/LZ4/LZNT1/Zlib header/Brotli decompress** (Gzip/deflate already present) | yes: `DecompressionStream` covers gzip/deflate/deflate-raw, bz2/xz/lz4 need small JS ports | M-L | M |
| **JSON <-> CSV**, **CSV to JSON**, **JPath / JQ-lite**, **XPath**, **CSS selector**, **Parse CSV**, **Generate QR / Parse QR code**, **Render Image**, **Parse ASN.1 hex**, **PEM to Hex / Hex to PEM / PEM to JWK**, **Parse SSH host key**, **Parse TLS record / Parse Protobuf / MessagePack / BSON / CBOR** | yes (parsers pure JS; QR needs a small library, QR decode needs canvas) | M-L | M |
| **Diff**, **Entropy** as a standalone op (exists in analytics only), **Frequency distribution**, **Magic** as a selectable operation (it is a UI button only), **Show on map**, **Pseudo-Random Number Generator**, **Generate Lorem Ipsum**, **Bit-shift** variants | yes | S | M |
| **Hash/crypto against files in a "Input from file" flow with large files** (output in the UI is capped by the text pane; check) | yes | M | M |
| **YARA rules**, **Bombe**, **Hash cracking ops (not proposed)** | YARA no (needs a WASM YARA, L) | L | L |
| Share a recipe via URL (`#recipe=...`, CyberChef-compatible format so recipes from the real tool can be pasted) | yes | M | H |
| Operation search and favourites | already has search and categories (verify discoverability) | S | L |

### Bugs / usability
1. The UI banner says "80+ operations". The real count differs by what is counted, so the number should be generated from `registry.getAll().length`.
2. Recipes are not shareable by URL and cannot be imported from real CyberChef's recipe string (`To_Base64('A-Za-z0-9+/=')`). This is the biggest compatibility gap for people following online write-ups.
3. SHA family is incomplete: there is SHA-1, SHA-256 and SHA-3 but no SHA-512, so common `sha512` recipes fail.
4. AES uses CryptoJS (unauthenticated modes only, no GCM), so decrypting real-world GCM/ChaCha-poly data is impossible.
5. At 2,306 lines, `CyberChefWorkbench.jsx` is one component with many `localStorage` effects. It is hard to test, and the existing `tests/cyberchef/` cover only the engine, not the UI.
6. Op args are read with `registry.get(step.op || step.name || step.id)` in several places (name vs id), a source of "operation not found" mismatches when recipes saved by name are loaded after a rename. Worth a normalization on load.

---

## 6. regex-tester (`RegexTesterWorkbench.jsx`)

### Does today
JavaScript `RegExp` only. Pattern input, a flag text box and toggle buttons (g i m s u y), live highlighting, a match list with numbered and named groups and indices, a replace preview (`$1`, `$<name>`), a copy-as-`/pattern/flags` button, a cheat sheet and a 10,000-match guard. No network.

### Reference tools
regex101 (PCRE2, ECMAScript, Python, Go, Java, .NET, Rust flavors; explanation tree; code generator; unit tests; quiz; permalinks), RegExr, Debuggex.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Run in a Web Worker with a timeout so catastrophic patterns (`(a+)+$`) cannot freeze the page (the real fix for bug 1 below) | yes | S | H |
| Plain-English explanation of the pattern (token tree with per-token description) | yes: a small regex parser | M | H |
| Permalink / share (state in the URL hash) and saved patterns | yes | S | M |
| Match info: `d` (indices) flag, `v` flag, named group list, group colors in the highlight | yes | S | M |
| Test cases: multiple strings with expected match/no-match | yes | M | M |
| Code generator (JS, Python, PHP, Go, C#) from the pattern | yes (pure text templates) | S | M |
| Split and `matchAll` modes, replace with function body, substitution list | yes | S | M |
| Other flavors (PCRE2, Python `re`, Go RE2, Java) | partly: PCRE2/RE2 would need a WASM build (~300 KB-1 MB). Python/Java differ enough from JS to mislead when emulated, so label as "JS only" until a WASM engine is added. | L | M |
| Common-pattern library (email, IPv4, MAC, hex, UUID) | yes | S | M |
| Step-through debugger | no for the native engine (no hooks); only with a custom engine (L) | L | L |

### Bugs / usability
1. Matching runs on the main thread. A backtracking pattern on a medium string hangs the whole app tab with no way to stop it. The 10,000-match guard does not help because the cost is inside one `exec`.
2. The highlighter prints an `∅` character into the displayed text for zero-width matches (`text.slice(start,end) || '∅'`), so the highlighted view no longer equals the input.
3. Typing duplicate flags (`gg`) makes `new RegExp` throw, and the toggle buttons do not de-duplicate typed input (`/[^gimsuy]/` filter only). The error message is shown but the previous results vanish.
4. The `d`, `v` flags (and sticky `y` semantics with the `g` loop) are not offered or explained.
5. The replace preview rebuilds a second `RegExp` from the same flags without checking it is global, so `replacement` only replaces the first match unless `g` is on, which is correct but not obvious. A note would help.
6. No test file for the regex tester (pure logic could be extracted and tested).

---

## 7. db-browser (`DbBrowserWorkbench.jsx`, `dbbrowser/*`, `utils/sqliteStudio.js`, `sqliteMerge.js`, `sqljs.js`)

### Does today
Two tabs. **SQLite studio** (about 2,600 lines in `dbbrowser/` plus 1,000 lines of `sqliteStudio.js`) on sql.js 1.12 (WASM): create/open databases (file picker, File System Access API handle for saving back), structure tab, schema editors (create/alter table with a rebuild fallback, indexes), browse with filter/sort/paging, inline edit with undo/redo (up to 200 steps), new/duplicate/delete records, BLOB preview and hex dump, pragma editor, Execute SQL (statement splitting, results), import CSV/JSON, export CSV/JSON/SQL dump, combine/merge databases, a plot of data, `.sqbpro` project files, display formats. **Endpoint tab** queries PostgREST, CouchDB, Elasticsearch or Datasette over HTTP and renders the JSON as a grid through the proxy.

### Reference tools
DB Browser for SQLite (the clear model), `sqlite3` CLI, SQLiteStudio, DBeaver, sqlite-viewer.com.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Forensic recovery: list freelist pages and carve deleted records from unallocated space / free cells (a common use for phone and browser databases) | yes: reading pages from the raw bytes is pure JS | M | H (for the USB/forensics audience) |
| Open a database together with its `-wal` / `-journal` file (WAL commonly holds the newest rows for Chrome, WhatsApp, Android databases) | partly: sql.js loads one file; a WAL checkpoint merge can be done in JS by applying frames before opening | M | H |
| `EXPLAIN QUERY PLAN` view and a query history / saved queries panel | yes | S | M |
| Schema diagram (ER view from foreign keys) | yes (SVG) | M | M |
| Large databases: files over about 500 MB exhaust memory because sql.js loads the whole file. Warn early, and optionally support read-only paging (`sql.js-httpvfs`-style needs a different build) | warn yes (S); streaming no (L) | S | M |
| SQLCipher (encrypted) databases | no: needs a SQLCipher WASM build and the key, which sql.js does not ship (L, not recommended) | L | M |
| FTS5 / JSON1 / R-Tree availability check | verify: the stock sql.js 1.12 build includes FTS5 and JSON1; show a capability line | S | L |
| Endpoint tab: auth presets (Bearer/Basic), pagination, export CSV | yes | S | L |
| Extensions (spatialite, sqlean) | no (no loadable extensions in WASM builds) | n/a | n/a |

### Bugs / usability
1. The studio is hidden with a CSS class (`tab === 'sqlite' ? '' : 'hidden'`) instead of unmounting, which is good for state but means the whole database stays resident while the Endpoint tab is open. Acceptable, but worth knowing for memory.
2. Both the Endpoint tab and the studio parse JSON/rows into memory with no row cap for the Endpoint response (a large response renders every row, with the grid not virtualized).
3. `utils/sqlite.js` and `utils/sqliteStudio.js` both exist (the tests cover `sqlite`, `sqliteMerge`, `sqliteStudio`); no functional issue found, but two overlapping helper layers are a maintenance trap.
4. No fatal bug found in the studio; it is the most complete tool in this group. Remaining risk is memory limits and absent WAL support.

---

## 8. hashcat-cracker (review only)

### Bugs / usability (no new cracking capability proposed)
1. **Plaintext secrets in the session log (privacy)**: every cracked password is passed to `onLogMessage` as `Cracked <hash16>… = "<password>"`. The session log is persisted in `sessionStorage` and exported to Markdown/JSON for "attaching to a ticket". Other tools in this group mask secrets (`maskPassword`, `maskEmail`), this one does not. Log only the hash prefix and a masked password.
2. Wordlist loop does `await hashOne(...)` per candidate on the main thread, yielding to the event loop only every 400 candidates. The page stays responsive, but throughput is low and the UI thread is shared with the rest of the workspace. A worker would be a pure performance fix.
3. Salted modes take a single shared salt typed in a box. Real-world hashes arrive as `hash:salt`, and a multi-line target list with different salts silently fails. Accept `hash:salt` lines.
4. Targets are normalized by lowercasing and stripping a leading `*` for every mode (MySQL only), so a pasted bcrypt/`$1$...` string is just treated as a hex target and will never match, with no "unsupported hash format" message.
5. `HASH_MODES.find` result `mode` is used without a guard if the state ever holds a stale id (not reachable today).
6. GPU path is MD5 + mask only; the eligibility note is shown. Fine.

---

## 9. setup (`tabs/HelpTroubleshootingTab.jsx`)

### Does today
Three collapsible sections: Linux permissions/udev (dialout group command, a universal udev rule), a list of six USB-UART bridge families (CH340/341/9102, CP210x, FTDI, PL2303, Espressif native USB, RP2040) with VID/PID, status and a driver link, and a troubleshooting checklist (access denied, "timed out waiting for packet header" with the EN capacitor tip, garbage output/baud mismatch and more).

### Reference
Arduino/ESP-IDF "Establish serial connection" docs, Espressif's driver pages, Adafruit and Sparkfun driver guides, the PlatformIO udev rules.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Safer udev rule: per-VID rules with `TAG+="uaccess"` or `GROUP="dialout"`, `MODE="0660"`, plus the `brltty` / ModemManager removal tip (the usual reason a CH340 port vanishes on Ubuntu) | yes | S | H |
| Per-OS tabs (Windows driver Device Manager flow, macOS CH34x kext/`/dev/cu.*` vs `/dev/tty.*`, Linux `uucp` group on Arch) and a link to the Web Serial/WebUSB browser support matrix (Chrome/Edge only, secure context) | yes | S | H |
| Live "detect my adapter" using `navigator.serial.getPorts()` / `getInfo()` and match the VID/PID against the table (the app already has `usbDatabase.js`) | yes | M | M |
| More bridges and boards: CH343/CH9102, GD32/STM32 DFU, Silicon Labs CP2105, Arduino CDC, ESP8266 boot modes, Raspberry Pi RP2350, WinUSB driver (Zadig) for DFU/ADB | yes | S | M |
| Copy-paste Windows `pnputil` / Zadig steps | yes | S | M |
| Make the driver table data-driven so Setup and the wiki do not drift | yes | S | M |

### Bugs / usability
1. **The universal udev rule is `SUBSYSTEM=="tty", ATTRS{idVendor}=="*", MODE="0666"`**: this makes every tty device on the machine world-readable and writable (including real serial consoles and modems), not just USB-UART adapters. The advice is unsafe as written. It should target the adapter VIDs and use `uaccess` or a group.
2. The displayed command (`... && sudo udevadm control --reload-rules`) and the copied text (two lines, no `&&`) differ, and neither runs `udevadm trigger`, so an already-plugged device still needs a replug.
3. The dialout instruction is Debian/Ubuntu/Fedora-specific. Arch uses `uucp`, and the page does not mention it or `lock`.
4. Section headers and content use emoji and decorative labels; the collapsible headers are `div role="button"` without `aria-expanded`.
5. The wiki also carries a `setup` and a `troubleshooting` article, so the same guidance exists in two places and can diverge (the unsafe rule may appear there too; check).

---

## 10. pinouts-modal (`components/PinoutModal.jsx`)

### Does today
A modal (not a tool window) with five hard-coded tabs: ESP32-WROOM (UART0 pins, EN/IO0 strapping, auto-reset note), ESP32-S3 (native USB D+/D- on GPIO19/20, UART0 on 43/44), Raspberry Pi Pico (UART0/1 default pins, 1200-baud BOOTSEL touch), a 6-pin FTDI/CP2102 header, and a 5V-to-3.3V resistor divider. Text cards only, no diagram.

### Reference
pinout.xyz (Raspberry Pi), the Pico datasheet pinout, ESP32 DevKit pinout charts, randomnerdtutorials, the Adafruit Learn pinout pages.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Real SVG pinout diagrams with colored pin functions and a hover/click description (power, GPIO, ADC, touch, strapping, flash pins GPIO6-11) | yes | M-L | H |
| More boards: ESP32-C3/C6, ESP8266 (NodeMCU/D1 mini), ESP32-CAM, STM32 Blue Pill, Arduino Uno/Nano/Pro Micro, RP2350, Raspberry Pi 40-pin, CH340 module, Bus Pirate, Flipper GPIO, JTAG/SWD (10/20-pin), SPI flash SOIC-8 clip | yes | M | H |
| Connector reference: USB-A/B/C pinout and CC resistors, micro-USB OTG, FPC | yes | S | M |
| Data-driven layout (one JSON per board) with search by GPIO number or function ("which pin is I2C SDA") | yes | M | H |
| Warnings for risky pins (ESP32 GPIO6-11 flash, GPIO12 strapping, input-only 34-39, ADC2 vs Wi-Fi) | yes | S | H |
| Link each board to the matching tool (Flasher, Console, JTAG) | yes | S | M |

### Bugs / usability
1. The ESP32 card says "EN (Chip Enable): Pin 3". That is the DevKit header position, which differs by board revision, and EN is not a GPIO. The text can mislead on a 30-pin vs 38-pin board.
2. Modal has no `role="dialog"`/`aria-modal`, no Esc-to-close and no focus trap (only the backdrop button).
3. "Touch baud 1200 bps will automatically trigger Pico into BOOTSEL" is true for Arduino-core boards, not MicroPython/CircuitPython images, so it should be qualified.
4. Not reachable from the tool window system: it is a modal, so it cannot be docked next to a terminal, which is where wiring help is wanted.

---

## 11. session-log (`SessionLogPanel.jsx`, `utils/sessionLog.js`)

### Does today
A live feed of every tool's log lines, picked devices (USB IDs), confirmed or declined destructive actions and errors, folded for repeats within 2 s, kept in `sessionStorage` (survives reload, not tab close), max 2,000 entries. Filter by tool/level/text, add notes, export Markdown or JSON (filtered view), copy report, open an exported JSON read-only, clear with a confirm. `tests/sessionLog.test.js` exists.

### Reference
Browser DevTools console, `script`/`tee` logs, Wireshark capture notes, bug-report bundles.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Redaction pass on export (mask secrets: API keys, passwords, tokens, MACs/SSIDs optionally) with a preview | yes | S | H |
| Pin/mark entries, collapse by tool, time range filter, sort | yes | S | M |
| Persist across tab close (opt-in IndexedDB) and cap by bytes, not only count | yes | M | M |
| Include the environment in the report (app version, browser, Web Serial/WebUSB support, device VID/PID table) | yes | S | M |
| Attach a tool-state snapshot (e.g. last flash plan) | yes | M | L |
| Copy a single line / a selection | yes | S | L |

### Bugs / usability
1. No redaction. Any tool that logs a secret leaks it into the exported "attach to a ticket" report. The cracker logs plaintext passwords (section 8), and the OSINT keys flow through the same logger in other tools. A central `redact()` in `record()` or `exportMarkdown()` would cover all of them.
2. `entries` is mutated through array copies on every record, plus a debounced `sessionStorage.setItem` of up to 2,000 entries. It is silent on quota failure (documented), so users may believe a persisted log exists when it does not.
3. Imported logs hide the live feed; new entries during that time are not signaled.

---

## 12. Wiki (`src/wiki`)

### Does today
A standalone page (`wiki/index.html`, `WikiApp.jsx`, 753 lines) with about 61 articles in 8 article files (about 8,200 lines), categories, search via the shared `searchTools` ranking, `?tool=` / `?article=` deep links from the sidebar's "Knowledge Base Wiki" item, per-article "open tool" links, and a `tests/wikiAndSearch.test.js`.

### Reference
Docs sites like docs.espressif.com, the Flipper docs, the Kali tools pages, tldr pages.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| **No articles for hash-calculator, jwt-inspector, regex-tester, db-browser (SQLite studio, the largest tool in the group).** Only cyberchef, cert, pwned-passwords, hash-cracker, setup, pinouts and session-log are covered. | yes | M | H |
| A coverage test: every tool in `SIDEBAR_SECTIONS` (except pure modals/external) must map to an article or be explicitly allow-listed | yes | S | H |
| "Related tools" and "see also" links, plus a "what changed" note per release | yes | S | M |
| A glossary and a recipe/how-to section (e.g. "check a downloaded file", "decode a leaked token") | yes | M | M |
| Link-check for internal references and `?tool=` ids | yes | S | M |
| Offline/PWA caching of the wiki page (manifest and icons were just added) | yes | S | L |

### Bugs / usability
1. The pwned-passwords article says the HIBP API "is CORS-enabled, so this works directly; a proxy is honored", but the code always calls `proxiedFetch`, which only goes through a proxy when one is configured. Reword.
2. The wiki and the app each hold copies of setup and troubleshooting guidance (see section 9), with no shared source.
3. Deep links use both `?article=`, `?tool=` and `#tool=`; `TOOL_TO_ARTICLE_MAP` is a hand-maintained map in `WikiApp.jsx` separate from the `toolId` fields on articles, so adding an article without updating both silently gives no link. No test guards it.

---

## Summary of bugs worth fixing first
1. Setup: the udev rule makes all tty devices world-writable (security) and the copied text differs from the displayed text. (DAT-8)
2. Hashcat cracker logs plaintext cracked passwords into the exportable session log. (DAT-9, and a redaction layer in session-log)
3. Regex tester can freeze the page on a backtracking pattern. (DAT-7)
4. Hash calculator ignores the HMAC toggle for files, and drops MD5 in HMAC mode. (DAT-1)
5. Cert inspector ignores all but the first cert of a PEM bundle loaded from a file. (DAT-3)
6. JWT verify result goes stale when the key changes, and time claims never refresh. (DAT-2)
7. Pwned Passwords has no cancel and no prefix cache. (DAT-4)

---

## Implementation tickets

Each ticket owns its files exclusively (no file appears in two tickets). Tests use the repo's existing runner (`npm run test`, vitest style as in `tests/*.test.js`).

### DAT-1: Hash calculator: more algorithms, verify-against-expected, file fixes
- **Value/Effort**: H / M
- **Files touched**: `src/components/tools/HashCalculatorWorkbench.jsx`, new `src/utils/hashSuite.js`, new `tests/hashCalculator.test.js`. (Reuse `src/utils/md5.js`, `md4.js`, `checksums.js` read-only; do not edit them or `utils/cyberchef/*`.)
- **Scope**: Add SHA-224, SHA-512/256, SHA-3 (224/256/384/512), RIPEMD-160, CRC-32, Adler-32 and MD4/NTLM via `hashSuite.js` (pure JS plus Web Crypto where available). Add HMAC for MD5 and the new SHA variants through a JS HMAC wrapper. Add HMAC key encoding choice (text / hex / base64). Add an "Expected digest" box that auto-detects the algorithm from length and shows match/mismatch against every computed row. Fix the four bugs listed in section 1 (file recompute on HMAC change, reset input value, MD5 row in HMAC mode, surfaced `importKey` errors). Multi-file drop producing a table with a "copy as SHA256SUMS" button.
- **Acceptance criteria**:
  1. Known vectors pass for every algorithm for the inputs `""`, `"abc"` and a 1 MB buffer.
  2. HMAC vectors from RFC 2202 (MD5, SHA-1) and RFC 4231 (SHA-2) pass.
  3. With a file selected, toggling HMAC or editing the key recomputes within one second.
  4. Selecting the same file twice works.
  5. Pasting a 64-hex string highlights the SHA-256 row as "match" or "no match" and ignores case and whitespace.
  6. No MD5 row disappears in HMAC mode, and a key import failure shows a visible message.
  7. Nothing is uploaded (no network calls).
- **Test plan**: `tests/hashCalculator.test.js` with the vectors above (NIST/RFC), expected-digest detection by length, and a component render test (jsdom) that toggles HMAC with a mocked `File`. Manually hash a 200 MB file and confirm the page stays responsive.

### DAT-2: JWT inspector: signing, JWKS, claim validation, correctness fixes
- **Value/Effort**: H / M
- **Files touched**: `src/components/tools/JwtInspectorWorkbench.jsx`, `src/utils/jwt.js`, new `tests/jwt.test.js`.
- **Scope**: Add an Encode/Sign tab (header and payload editors, HS secret or private key as PEM PKCS8 / JWK, produce a token). Accept a JWKS and choose the key by `kid`; optional fetch from `jku`/`iss` via the existing `proxiedFetch` (import it, do not edit `netClient`). Add expected `iss`/`aud`/`sub` inputs and a leeway field, with per-claim pass/fail. Accept HS secrets as text/hex/base64/base64url. Add EdDSA verify with a runtime feature check. Clear stale verify results when the key changes; recompute time claims on an interval; flag `alg` casing variants (`None`, `nOnE`) and a JWE 5-part token with a specific message; warn on `jku`/`x5u`/`kid` header risks and on an HS token verified against a PEM-looking key.
- **Acceptance criteria**:
  1. The sample token still decodes and verifies with secret `your-256-bit-secret`.
  2. A token signed in the Encode tab verifies in the Verify tab for HS256/384/512, RS256, PS256 and ES256 round-trips.
  3. A JWKS with two keys picks the right one by `kid`, and a missing `kid` gives a clear message.
  4. Expired, not-yet-valid and wrong-`iss`/`aud` tokens show failures independent of the signature result.
  5. The result badge clears when the key text changes, and "expires in" counts down live.
  6. A 5-part input says "looks like a JWE" instead of the generic error.
  7. Private keys and secrets are never logged (`onLogMessage` receives only alg and outcome).
- **Test plan**: `tests/jwt.test.js` with RFC 7515/7519 appendix vectors, sign-verify round trips for each alg family, `analyzeClaims` with a fixed `nowSec`, malformed-input cases (2 or 4 segments, bad base64, non-object payload, numeric strings in `exp`), and a check that `alg` variants are flagged.

### DAT-3: Certificate inspector: chain building, hostname check, bundles
- **Value/Effort**: H / M
- **Files touched**: `src/components/tools/CertInspectWorkbench.jsx`, `src/utils/x509.js`, `tests/x509.test.js` (extend the existing file; no other ticket edits it).
- **Scope**: File mode loads every certificate in a PEM bundle and in `.p7b` (PKCS#7 `SignedData` certificates field). Chain view orders leaf to root via AKI/SKI and issuer/subject, and verifies each link's signature with Web Crypto (RSA PKCS#1 v1.5, RSASSA-PSS, ECDSA P-256/384/521 including DER-to-raw signature conversion), flagging missing intermediates, self-signed roots, expired links and weak algorithms. Hostname input tested against SAN/CN with RFC 6125 wildcard rules. SPKI SHA-256 base64 pin and SHA-512 fingerprint. Decode additional extensions (certificate policies, name constraints, TLS feature/must-staple, embedded SCT list) and show unknown extensions as OID plus hex. Chunked `downloadPem`. Clear stale `certList`/`chain` when a parse fails. Weakness hints (SHA-1, RSA < 2048, validity > 398 days, no SAN).
- **Acceptance criteria**:
  1. Loading a 3-cert PEM bundle from a file lists all three and marks the chain valid when signatures verify.
  2. A bundle with the intermediate removed reports "issuer certificate not found".
  3. A tampered certificate (one flipped byte in the TBS) fails the signature check.
  4. `*.example.com` matches `a.example.com` but not `a.b.example.com` or `example.com`.
  5. The SPKI pin equals `openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | base64` for a fixture.
  6. Large input no longer risks a stack overflow when downloading PEM.
- **Test plan**: extend `tests/x509.test.js` with a generated 3-cert fixture (RSA and ECDSA), a tampered fixture, wildcard cases, SPKI pin and extension decoding assertions. Manual run on a real site chain pasted from `openssl s_client -showcerts`.

### DAT-4: Breach checker: password-manager import, prefix cache, cancel, NTLM
- **Value/Effort**: H / M
- **Files touched**: `src/components/tools/PwnedPasswordsCheckerWorkbench.jsx`, `src/components/tools/BreachTabs.jsx`, `src/utils/breachCheck.js`, `tests/breachCheck.test.js` (extend).
- **Scope**: Passwords tab: add a Cancel button (abort via `AbortController`), a per-run prefix cache keyed by the 5-char prefix, a "trim whitespace" toggle, duplicate and reuse detection, and CSV import of Bitwarden, 1Password, Chrome and Firefox exports. A report shows site, username and breach count, never the password, with CSV export of masked results. Add NTLM mode (`?mode=ntlm`) using `md4Hex` for plaintext and a direct hash input option. Catalog tab: sort newest first and add paging with "show more". Disable the HIBP checkbox with an explanation when `/api/hibp` is unavailable. Fix the wiki wording by editing only the article text through DAT-8 (do not edit the wiki here).
- **Acceptance criteria**:
  1. A 100-line list with 20 distinct prefixes triggers exactly 20 range requests.
  2. Cancel stops further requests within one request time.
  3. Importing a Bitwarden CSV with a known pwned password (`password`) flags that row and shows its site and username, and the plaintext never appears in logs, DOM (while masked) or exports.
  4. NTLM mode returns the same count as the HIBP site for a known NTLM hash.
  5. Catalog shows the newest breach first and pages beyond 50.
  6. Requests still send `Add-Padding: true`.
- **Test plan**: unit tests in `tests/breachCheck.test.js` for CSV parsers (quoted fields, BOM, each export header set), prefix-cache logic and the NTLM path with a mocked `fetch`. A render test with `proxiedFetch` mocked to assert request counts and cancel behavior. Manual check against the live API with a harmless known-weak password.

### DAT-5: CyberChef: hashing and cryptography operations
- **Value/Effort**: H / M
- **Files touched**: `src/utils/cyberchef/operations/hashing.js`, `src/utils/cyberchef/operations/cryptography.js`, new `tests/cyberchef/hashingCrypto.test.js`. (Do not edit `operations/index.js`; both files already export arrays that `index.js` spreads.)
- **Scope**: Add SHA-512, SHA-384, SHA-224, SHA-512/256, RIPEMD-160, MD4, NTLM hash, HMAC (selectable hash and key as text/hex/base64), CRC-8/16/64 and a generic CRC with polynomial/init/xorout, Fletcher-16/32, BLAKE2s. In crypto: AES-GCM and AES-CTR via Web Crypto (with authentication-tag handling and explicit failure on a bad tag), ChaCha20 (and ChaCha20-Poly1305 if time allows), PBKDF2, HKDF, and PKCS7 padding control for AES-CBC. All ops must follow the existing `Operation` class pattern (`id`, `module`, `inputType`, `args`).
- **Acceptance criteria**:
  1. Every new hash matches published test vectors.
  2. HMAC matches RFC 4231 and RFC 2202 vectors.
  3. AES-GCM matches the NIST GCM vectors, and a flipped tag byte yields a clear error rather than garbage output.
  4. PBKDF2 and HKDF match RFC 6070 and RFC 5869.
  5. Operations appear in the operation list under the right category with search keywords.
  6. Existing operations and recipes are unchanged (existing `tests/cyberchef/*` stay green).
- **Test plan**: new vitest file driving each op through `Chef`/`registry` with vectors, plus a round-trip test for each cipher. Run `npm run test` to confirm the existing CyberChef tests pass.

### DAT-6: CyberChef: text, encoding and data-format operations, and shareable recipes
- **Value/Effort**: H / M
- **Files touched**: new `src/utils/cyberchef/operations/textOps.js`, new `src/utils/cyberchef/operations/encodingOps.js`, `src/utils/cyberchef/operations/index.js`, `src/components/tools/CyberChefWorkbench.jsx`, new `src/utils/cyberchef/recipeUrl.js`, new `tests/cyberchef/textEncoding.test.js`.
- **Scope**: Add Find/Replace, Regular expression (list matches, groups, replace), To/From Upper/Lower case, Sort, Unique, Head/Tail, Remove whitespace, Remove null bytes, Count occurrences, Strings, Swap endianness, Reverse, Add line numbers, Diff; Caesar/ROT47/ROT-n, Vigenere, Atbash, Morse, A1Z26; HTML entities, Punycode, Quoted-printable, Decode/Encode text (charsets via `TextDecoder`), Base62/Base45, URL-safe Base64 alphabet option, Defang URL/IP; JSON<->CSV and Parse CSV; PEM to/from Hex. Register them in `index.js`. In the workbench: generate the "80+ operations" banner from `registry.getAll().length`, import and export a recipe via a URL hash and via real CyberChef's recipe string format (`To_Base64('A-Za-z0-9+/=')`) for the operations both tools share, and normalize saved recipe steps by op id on load.
- **Acceptance criteria**:
  1. Each new op has at least two vector tests and rejects bad arguments with a readable error.
  2. A recipe copied from CyberChef using only supported ops imports and bakes to the same output on a fixed input.
  3. Opening a `#recipe=...&input=...` URL restores the recipe and input.
  4. Unsupported ops in an imported recipe are listed rather than silently dropped.
  5. The banner count equals the registry size.
  6. The existing recipes saved in `localStorage` still load.
- **Test plan**: `tests/cyberchef/textEncoding.test.js` for ops and `recipeUrl.js` round trips (encode/decode, malformed input), plus the existing `tests/cyberchef/*` and `componentsRender.test.jsx` to guard against UI regressions. Manual import of three recipes from the public CyberChef gallery.

### DAT-7: Regex tester: worker with timeout, explanation, code generator, permalinks
- **Value/Effort**: H / M
- **Files touched**: `src/components/tools/RegexTesterWorkbench.jsx`, new `src/utils/regexTools.js`, new `src/workers/regexWorker.js`, new `tests/regexTools.test.js`.
- **Scope**: Move matching into a Web Worker with a configurable timeout (default 2 s) and a visible "timed out, likely catastrophic backtracking" message, falling back to a synchronous run for tiny inputs. Add `d` and `v` flags and de-duplicate typed flags. Fix the zero-width highlight so no synthetic `∅` is inserted into the text (use a zero-width marker element). Add a pattern explanation (tokenizer to a tree with per-token text), a code generator (JS, Python, PHP, Go, C#), a library of common patterns, multiple test strings with expected match/no-match, split and `matchAll` modes, and permalink state in the URL hash. Label the engine as "JavaScript (ECMAScript)" in the UI.
- **Acceptance criteria**:
  1. `(a+)+$` against `aaaaaaaaaaaaaaaaaaaaaaaa!` returns a timeout message within the limit and the page stays responsive.
  2. Typing `gg` as flags does not throw; flags are normalized.
  3. Zero-width matches (`\b`) highlight without changing the displayed text.
  4. The explanation covers groups, classes, quantifiers, anchors, lookarounds and named groups, and the output for `(?<year>\d{4})-\d{2}` is correct.
  5. Share links restore the pattern, flags, text and replacement.
  6. Generated code for each language is syntactically valid for a fixture pattern.
- **Test plan**: `tests/regexTools.test.js` covering tokenizer/explainer fixtures, flag normalization, the worker protocol function extracted as a pure function (match list shape), highlight segmentation for zero-width matches, and generator snapshots. Manual catastrophic-pattern check.

### DAT-8: Reference & Setup: safe udev guidance, data-driven pinouts, wiki coverage
- **Value/Effort**: H / M
- **Files touched**: `src/components/tabs/HelpTroubleshootingTab.jsx`, `src/components/PinoutModal.jsx`, new `src/data/pinouts.js`, new `src/wiki/articles/cryptoDataArticles.js`, `src/wiki/wikiArticles.js`, `src/wiki/articles/webappArticles.js` (the pwned-passwords wording fix only), `src/wiki/articles/referenceArticles.js` (setup/troubleshooting alignment), new `tests/wikiCoverage.test.js`, new `tests/pinouts.test.js`.
- **Scope**:
  - **Setup**: replace the world-writable rule with per-VID rules using `TAG+="uaccess"` (and a `GROUP="dialout"`, `MODE="0660"` alternative), add `udevadm trigger`, the `brltky`/ModemManager tip, Arch `uucp`, a macOS `cu`/`tty` note, a Web Serial support note, and make the displayed and copied commands identical. Add `aria-expanded` to the collapsible headers. Optionally match a connected port's VID/PID against the driver table.
  - **Pinouts**: move the five boards into `data/pinouts.js` (one object per board: pins, functions, warnings, links to tools), add ESP32-C3, ESP8266, ESP32-CAM, Pico/RP2350, Arduino Uno/Nano, STM32 Blue Pill, SWD/JTAG headers, SOIC-8 flash clip and USB connector pinouts, with search by GPIO or function. Add `role="dialog"`, `aria-modal`, Esc and focus handling.
  - **Wiki**: add articles for hash-calculator, jwt-inspector, regex-tester and db-browser (including how to open WAL/journal files and the memory-limit note) in the new article file, register them in `wikiArticles.js`, fix the pwned-passwords CORS sentence, and add a coverage test asserting every non-modal tool in `SIDEBAR_SECTIONS` maps to an article or an explicit allow-list.
- **Acceptance criteria**:
  1. No udev text anywhere in the app or the wiki contains `idVendor=="*"` with `MODE="0666"`.
  2. The copied text equals the displayed text.
  3. Every pinout board renders from data, and `tests/pinouts.test.js` asserts no duplicate pin numbers per board and every referenced tool id exists.
  4. Esc closes the pinout modal, and focus returns to the opener.
  5. `tests/wikiCoverage.test.js` passes with the four new articles and fails if a new tool is added with no article or allow-list entry.
  6. The wiki search finds the new articles by their tool names and keywords.
- **Test plan**: the two new tests, plus the existing `tests/wikiAndSearch.test.js` and `componentsRender.test.jsx`. Manual run of the udev rule on a Linux box with a CH340 and a CP2102.

### DAT-9: Hashcat cracker hygiene and session-log redaction (small)
- **Value/Effort**: M / S
- **Files touched**: `src/components/tools/HashcatCrackerWorkbench.jsx`, `src/utils/hashCrack.js`, `tests/hashCrack.test.js` (extend), `src/utils/sessionLog.js`, `tests/sessionLog.test.js` (extend), `src/components/tools/SessionLogPanel.jsx`.
- **Scope**: Stop logging cracked plaintext (log the hash prefix and a masked password only; the pot table and potfile export keep the full value). Accept `hash:salt` lines and per-line salts in the salted modes, and give an "unsupported hash format" message for bcrypt/`$id$` strings instead of treating them as hex. Add `redact()` to `sessionLog.js`, applied on Markdown/JSON export with a preview toggle in the panel, masking common secret shapes (`Bearer ...`, `api[_-]?key=`, `password=`, long hex/base64 tokens, optionally MAC/SSID). Add an environment header to the report (app version, user agent, Web Serial/WebUSB support).
- **Acceptance criteria**:
  1. After a crack, the session log and exports contain no plaintext password.
  2. `5f4dcc3b5aa765d61d8327deb882cf99:` style `hash:salt` lines work for salted modes, and an unsupported format shows a clear message.
  3. The export preview shows redacted content, and a "include unredacted" switch is off by default.
  4. Existing session-log tests stay green.
- **Test plan**: extend `tests/hashCrack.test.js` for `hash:salt` parsing and format detection, and `tests/sessionLog.test.js` for `redact()` fixtures (tokens, keys, passwords, benign text untouched). Manual crack of an MD5 test hash and inspection of the exported report.

---

## Not ticketed (and why)
- **db-browser forensic recovery / WAL support**: valuable (M effort, H value for forensics), but it touches the `dbbrowser/*` and `sqliteStudio.js` stack which is large and stable. Recommend a follow-up ticket DAT-10 after DAT-1 to DAT-9, with files `utils/sqliteRecover.js`, `dbbrowser/RecoverTab.jsx`, `SqliteStudio.jsx` and a new test.
- **Regex flavors beyond JS (PCRE2/RE2 via WASM)**, **SQLCipher**, **live TLS handshake**, **OS trust-store verdict**, **YARA in CyberChef**: not feasible, or not worth it, in a browser-only app (reasons in the gap tables).
- **Pinout diagram artwork** (SVG per board): left out of DAT-8 acceptance because it is design-heavy. The data-driven layout in DAT-8 makes it a follow-up.
