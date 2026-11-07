# HTTP Repeater Workbench

**Purpose**: Compose an HTTP request (method, headers, body) and inspect the full
response (status, headers, body).

**Network limitation**: A browser cannot act as a transparent MITM proxy. Direct
requests are CORS-limited; configure a proxy to reach arbitrary hosts and read
their responses.

**Usage**:
- Set an optional proxy in the proxy bar (empty = direct).
- Pick a method and enter the URL.
- Optionally add request headers (one `Key: Value` per line) and, for non-GET/HEAD
  methods, a request body.
- Click **Send**. The response status, headers, and body are displayed.

**Implementation Details**:
- Uses `proxiedFetch` from `src/utils/netClient.js`.
- Headers are parsed from the textarea; the body is attached for methods that allow
  one.

**Dependencies**: `src/utils/netClient.js`, `src/components/tools/common/ProxyConfig.jsx`.

**Notes**:
- Some request headers are forbidden by the browser's fetch implementation and
  cannot be overridden from a page.
