# JWT Inspector

**Purpose**: Decode and verify JSON Web Tokens (jwt.io-style). Fully
client-side — the token, secret and keys never leave the browser.

**Usage**:
- Paste a JWT. The header and payload are decoded and shown as JSON, with the
  three segments colour-coded.
- Standard time claims (`exp`, `nbf`, `iat`) are rendered human-readable with a
  valid / expired / not-yet-active status.
- Verify the signature: for `HS256/384/512` provide the shared secret; for
  `RS*`, `PS*`, `ES*` provide the public key as PEM (SPKI) or JWK. An
  `"alg":"none"` token is flagged as unsigned.

**Implementation Details**:
- `src/utils/jwt.js` — base64url decode, structural decode, claim analysis and
  signature verification via the Web Crypto API (`crypto.subtle.verify`).
- Verified in `tests/webTools.test.js` (HS256 pass/fail, alg:none refusal,
  claim analysis, base64url round-trip).

**Notes**:
- This tool verifies signatures; it does not validate audience/issuer or trust
  chains. It does not support encrypted (JWE) tokens.
