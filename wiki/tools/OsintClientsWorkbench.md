# OSINT API Clients

**Purpose**: In-app front-ends for Shodan, urlscan.io and HackerTarget. The app
has no dataset of its own — these call each vendor's API with **your own API
key** and render the reply.

**Usage**:
- **Shodan** — save your API key once, then pick a mode. No proxy is needed on the
  hosted site: Shodan blocks direct browser calls (no CORS), so the client's default
  *Route: auto* sends requests to the site's own `/api/shodan` relay (a few lines of
  Cloudflare Worker in `worker/index.js`; the Vite dev server proxies the same path).
  If the relay is not served where you run the app, it falls back to the Proxy bar.
  Your key goes straight through to Shodan; the relay stores nothing.
  - *Search*: a query builder with one row per filter (port, country, org,
    net, hostname, product, http.title, ssl.cert.*, vuln, tag, …), a `−` toggle
    to exclude, free-text rows, and the raw query string editable alongside
    (rows and text stay in sync). Add facets (`country:10`, `org:5`, …), set the
    page and `minify`, then **Search** (1 query credit per page when filters
    are used) or **Count only** (free). Results show as a table (click a row
    for the full banner), facet values are clickable to narrow the query, and
    you can export CSV/JSON or copy the IPs. The HTTP status, round-trip time
    and the exact request URL (key redacted) are shown under the buttons.
  - *Host*: everything Shodan has on one IP (with `history` / `minify`), plus
    the honeypot score.
  - *DNS*: domain records (type filter, history, paging — 1 credit), resolve
    hostnames, reverse-lookup IPs.
  - *Exploits*: Exploit-DB / Metasploit / CVE search (`cve:`, `platform:`,
    `type:`, `port:`).
  - *Account & tools*: plan and remaining credits, your public IP and headers,
    crawled ports, crawler protocols, the server-side filter and facet lists,
    popular query tags and community-shared queries.
- **urlscan.io**: public search (`domain:example.com`, `page.url:"login"`); a key
  is only needed to submit scans (not performed here).
- **HackerTarget**: DNS lookup, reverse IP, host search, AS lookup, HTTP headers,
  page links. Free tier works keyless (IP-rate-limited); a key raises limits.

**Implementation**: `src/components/tools/OsintClientsWorkbench.jsx` (tabs,
urlscan, HackerTarget), `src/components/tools/osint/ShodanClient.jsx` (Shodan
UI) and `src/utils/shodan.js` (filter catalogue, query ⇄ token parser, URL
builder, defensive response parsing — an HTML 404 or proxy error page is
reported with its status instead of crashing on `JSON.parse`). Keys are stored
in `localStorage` and sent only to their vendor. Most vendor APIs block
cross-origin browser calls, so the shared proxy is usually required.

**Notes**: Assess only hosts/domains you own or are authorized to test. The
client never calls Shodan's on-demand scan or alert endpoints.
