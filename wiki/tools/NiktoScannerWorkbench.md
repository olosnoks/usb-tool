# Web Path Prober Workbench

**Purpose**: Probe a web server for a list of commonly sensitive paths and report
the HTTP status of each, plus the server header.

**Network limitation**: A browser can only read a cross-origin response when the
target sends permissive CORS headers. Without a proxy, most responses are
unreadable: the request may reach the server, but the status is hidden and shown as
`blocked`. Configure a proxy to get real status codes against any host.

**Usage**:
- Set an optional proxy in the proxy bar (empty = direct).
- Enter the target base URL.
- Click **Scan**. Each path row shows its status; interesting statuses (200, 301,
  401, 403, 500, etc.) are highlighted. The server header is shown separately.

**Implementation Details**:
- Probes a built-in list of paths (`.git/HEAD`, `.env`, `admin`, `wp-login.php`,
  `server-status`, and others) with `proxiedFetch`.
- A `HEAD` request reads the `Server` response header when permitted.

**Dependencies**: `src/utils/netClient.js`, `src/components/tools/common/ProxyConfig.jsx`.

**Notes**:
- This is a lightweight path prober, not a full Nikto signature engine.
