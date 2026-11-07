# HTTP Basic Auth Tester Workbench

**Purpose**: Try username/password lists against an HTTP Basic-auth endpoint.

**Network limitation**: Direct from the browser this works only against
CORS-permissive targets. Configure a proxy (see below) to test arbitrary hosts.

**Usage**:
- Set an optional proxy in the proxy bar (empty = direct).
- Enter the target URL.
- Enter usernames and passwords, one per line each.
- Click **Start**. The tool tries each pair and reports the first HTTP 2xx. The run
  shows a counter and can be stopped.

**Implementation Details**:
- Sends `Authorization: Basic base64(user:pass)` via `proxiedFetch`.
- Proxy routing and honest error messaging come from `src/utils/netClient.js`.

**Dependencies**: `src/utils/netClient.js`, `src/components/tools/common/ProxyConfig.jsx`.

**Notes**:
- A browser cannot distinguish a CORS rejection from a connection failure; both
  appear as a failed request. The tool says so rather than guessing.
- Only HTTP Basic auth is supported (not form logins or other protocols).
