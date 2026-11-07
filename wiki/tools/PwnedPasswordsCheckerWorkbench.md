# Pwned Passwords Checker Workbench

**Purpose**: Check passwords against the HaveIBeenPwned breach corpus using the
k-anonymity range API. Fully functional client-side.

**Privacy model**:
- Each password is SHA-1 hashed in the browser.
- Only the first 5 hex characters of the hash (the prefix) are sent to the API.
- The API returns all hash suffixes sharing that prefix; the match is found
  locally. The password and full hash never leave the browser.
- The `Add-Padding: true` header is sent so the response size does not reveal how
  many matches the prefix had.

**Usage**:
- Paste one password per line.
- Click **Check Passwords**. Each row shows the breach count: a red count means
  the password appears in known breaches, green means not found.

**Implementation Details**:
- SHA-1 via `crypto.subtle.digest`.
- Requests go through `proxiedFetch` (`src/utils/netClient.js`). The HIBP API is
  CORS-enabled, so direct mode works; a configured proxy is also honored.

**Dependencies**: `src/utils/netClient.js`.

**Notes**:
- A non-zero count means the password is compromised and should never be used.
