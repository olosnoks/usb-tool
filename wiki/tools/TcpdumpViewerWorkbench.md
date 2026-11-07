# PCAP Viewer Workbench

**Purpose**: Parse and browse a packet capture file. Fully client-side.

**Usage**:
- Upload a classic libpcap file (`.pcap` or `.cap`).
- The tool shows link type and packet count, then a table of packets: index, time,
  source and destination (with ports), protocol, info, and length.
- Use the filter box to narrow by protocol, port, or address (e.g. `TCP`, `443`,
  `192.168`).

**Implementation Details**:
- Parser in `src/utils/pcap.js`. Reads the pcap global header (both byte orders and
  the nanosecond magic variants) and per-packet records.
- Decodes Ethernet II, Raw IP, and BSD loopback link types, then IPv4/IPv6 and
  TCP/UDP/ICMP/ICMPv6, including TCP flags.
- Parses up to 5000 packets by default.

**Dependencies**: `src/utils/pcap.js`.

**Notes**:
- pcapng (`.pcapng`) is detected and reported as unsupported; convert first with
  `editcap -F pcap in.pcapng out.pcap`.
