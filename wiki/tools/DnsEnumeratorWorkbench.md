# DNS Enumerator Workbench

**Purpose**: Resolve DNS records for a domain over DNS-over-HTTPS. Functional
client-side.

**Usage**:
- Enter a domain.
- Select record types to query: A, AAAA, MX, TXT, NS, CNAME, SOA, CAA.
- Click **Resolve**. Results list the type, name, data, and TTL for each answer.

**Implementation Details**:
- Queries Google's DoH endpoint (`https://dns.google/resolve`) with the
  `application/dns-json` accept header.
- Requests go through `proxiedFetch` (`src/utils/netClient.js`). DoH is
  CORS-enabled, so direct mode works; a configured proxy is also honored.

**Dependencies**: `src/utils/netClient.js`, `src/components/tools/common/ProxyConfig.jsx`.

**Subdomain brute-force**:
- Load a subdomain wordlist (SecLists, via the picker), enter a domain, and click
  **Brute subdomains**. Each `word.domain` is resolved over DoH with bounded
  concurrency; subdomains that resolve are listed with their A records.

**Notes**:
- True AXFR zone transfers require a TCP connection to the authoritative server
  and cannot be performed from a browser.
- Wordlists load from the SecLists jsDelivr CDN (CORS-enabled).
