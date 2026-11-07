# OSINT API Clients

**Purpose**: In-app front-ends for Shodan, urlscan.io and HackerTarget. The app
has no dataset of its own — these call each vendor's API with **your own API
key** and render the reply.

**Usage**:
- **Shodan**: save your API key, enter an IP, get host/org/ports/services.
- **urlscan.io**: public search (`domain:example.com`, `page.url:"login"`); a key
  is only needed to submit scans (not performed here).
- **HackerTarget**: DNS lookup, reverse IP, host search, AS lookup, HTTP headers,
  page links. Free tier works keyless (IP-rate-limited); a key raises limits.

**Implementation**: `src/components/tools/OsintClientsWorkbench.jsx`. Keys are
stored in `localStorage` and sent only to their vendor. Most vendor APIs block
cross-origin browser calls, so the shared proxy is usually required.

**Notes**: Assess only hosts/domains you own or are authorized to test.
