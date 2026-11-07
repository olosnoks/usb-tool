# Hash & HMAC Calculator

**Purpose**: Digest text or a file with MD5, SHA-1, SHA-256/384/512 and keyed
HMAC — fully client-side, nothing uploaded.

**Usage**: Type text to hash live, or load a file. Toggle HMAC mode and supply a
key to compute HMAC over the SHA family (MD5 is shown unkeyed).

**Implementation**: SHA + HMAC via the Web Crypto API; MD5 via a local
implementation in `src/utils/md5.js` (Web Crypto has no MD5). MD5 verified
against the RFC 1321 test vectors in `tests/browserTools.test.js`.

**Notes**: MD5 and SHA-1 are broken for security use — offered for
checksums/interop only.
