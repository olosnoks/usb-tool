# DNS Toolkit

**Purpose**: One DNS tool (merges the former DNS Enumerator and DNS/Mail
Doctor). A single domain field feeds three tabs, all over DNS-over-HTTPS
(dns.google); set a proxy for networks that block DoH.

**Tabs**:
- **Records** — resolve selected record types (A/AAAA/MX/TXT/NS/CNAME/SOA/CAA)
  with TTLs.
- **Email auth** — SPF (incl. `+all` warning and the 10-lookup limit), DMARC
  (policy + strength), DKIM (by selector), the mail/zone records, and a DNSBL
  reputation check of the mail-server IPs (Spamhaus ZEN, SpamCop, Barracuda,
  SORBS).
- **Subdomains** — wordlist brute-force resolving `{word}.domain` concurrently,
  with progress and a stop button (SecLists lists via the shared picker).

**Implementation**: `src/components/tools/DnsToolkitWorkbench.jsx`; SPF/DMARC/
DNSBL parsing in `src/utils/mailDns.js` (verified in `tests/webTools.test.js`).

**Notes**: The old `dns-enumerator` and `dns-mail-doctor` IDs still open this
tool (Records / Email tab respectively). Browsers can't do TCP AXFR zone
transfers. Assess only domains you own or are authorized to test.
