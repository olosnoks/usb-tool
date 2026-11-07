# crt.sh Subdomain Finder

**Purpose**: Passive subdomain enumeration from public Certificate Transparency
logs via crt.sh — never contacts the target.

**Usage**: Enter a domain; the tool queries crt.sh for all certificates issued
under it and lists the unique hostnames (wildcards marked). Filter and export to
`.txt`. A **proxy is required** (set it in the bar) because crt.sh does not send
CORS headers; no API key is needed.

**Implementation**: parsing/dedup/scoping in `src/utils/crtsh.js` (verified in
`tests/browserTools.test.js`); the component fetches crt.sh JSON via the proxy.

**Notes**: Use only on domains you own or are authorized to assess.
