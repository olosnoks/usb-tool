# DNS Toolkit

**Purpose**: One domain lookup, all the DNS info. A single **Look up** resolves
every record type and the email-authentication posture together; a subdomain
brute-force section sits at the bottom; everything exports to one Markdown file.
All over DNS-over-HTTPS (dns.google); set a proxy for networks that block DoH.

**Look up** (one pass):
- Records: A / AAAA / CNAME / MX / NS / SOA / CAA / TXT (with TTLs).
- Email auth: SPF (incl. `+all` warning and the 10-lookup limit), DMARC (policy
  + strength), DKIM (by selector).
- Mail servers (MX + resolved IPs) and a DNSBL reputation check of those IPs
  (Spamhaus ZEN, SpamCop, Barracuda, SORBS).
- TXT records, classified (SPF / DMARC / DKIM / verification / other).

**Subdomain brute-force** (bottom): load a SecLists subdomain list (or custom),
resolve `{word}.domain` concurrently over DoH, Stop any time. A **verbose** toggle
streams a live log of every attempt (`[+]` found / `[-]` miss / `[!]` error),
capped to the last 400 lines; the found table always shows hits.

**Export (.md)**: one Markdown file with the records table, email-auth summary,
mail servers, DNSBL results, TXT records and discovered subdomains for the
domain.

**Implementation**: `src/components/tools/DnsToolkitWorkbench.jsx`; SPF/DMARC/
DNSBL parsing in `src/utils/mailDns.js` (verified in `tests/webTools.test.js`).

**Notes**: The legacy ids `dns-enumerator` and `dns-mail-doctor` still open this
tool. Browsers can't do TCP AXFR zone transfers. Assess only domains you own or
are authorized to test.
