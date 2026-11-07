# DNS / Mail Doctor

**Purpose**: Resolve a domain's DNS records and audit its email configuration
(MXToolbox-style), over DNS-over-HTTPS, from the browser.

**Usage**:
- Enter a domain (optionally set a DKIM selector, default `default`).
- Resolves A / AAAA / MX / NS / SOA / CAA / TXT via `dns.google` DoH.
- Parses **SPF** (the `all` qualifier, with a warning on `+all`, and the
  10-lookup limit), **DMARC** (`_dmarc` policy and strength), and **DKIM**
  (`<selector>._domainkey`).
- Checks each resolved mail-server IP against public DNSBLs (Spamhaus ZEN,
  SpamCop, Barracuda, SORBS).

**Implementation Details**:
- Pure parsing/helpers in `src/utils/mailDns.js` (SPF/DMARC parse, TXT
  classification, reverse-IP, DNSBL name construction), verified in
  `tests/webTools.test.js`. The component performs the DoH fetches.
- DoH is CORS-enabled so it works directly; a proxy can be configured for
  networks that block it.

**Notes**:
- AXFR zone transfers need a raw TCP socket and are not possible from a browser.
- Check only domains you own or are authorized to assess.
