# IP / CIDR Calculator

**Purpose**: IPv4 and IPv6 subnet math, fully client-side (no network).

**Usage**: Enter an address with an optional `/prefix` (e.g. `192.168.1.10/24`
or `2001:db8::/48`). Shows network, broadcast (v4), netmask, wildcard, first/last
host, total address count and usable hosts, and flags private/reserved ranges.

**Implementation**: `src/utils/ipcalc.js` — uint32 math for IPv4, BigInt for
IPv6 (with `::` expansion, embedded IPv4, and canonical compression). Verified in
`tests/browserTools.test.js` (/24, /31, /32, /0, containment, v6 /64).
