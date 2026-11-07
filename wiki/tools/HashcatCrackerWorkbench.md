# Hash Cracker Workbench

**Purpose**: Client-side dictionary attack against a hash. Runs entirely in the
browser; no backend, no WASM.

**Usage**:
- Choose an algorithm: MD5, SHA-1, SHA-256, SHA-384, or SHA-512.
- Paste the target hash (hex).
- Enter a wordlist, one candidate per line.
- Click **Crack**. Progress is shown as a percentage and the run can be stopped.
  On success the matching candidate is displayed.

**Implementation Details**:
- SHA-1/256/384/512 use the Web Crypto API (`crypto.subtle.digest`).
- MD5 is implemented locally in `src/utils/md5.js` because Web Crypto omits it.
  The implementation is verified against the RFC 1321 test vectors.
- The loop yields to the event loop every 500 candidates so the UI stays responsive.

**Dependencies**: `src/utils/md5.js`.

**Wordlists**: load a SecLists password list with the wordlist picker (via the
jsDelivr CDN), or paste/upload your own.

**Notes**:
- This is a dictionary (wordlist) attack, not brute force over a keyspace.
- Throughput is JavaScript-bound; it suits testing and small lists, not large
  cracking jobs.
