export default {
  id: 'bt-hci-log',
  toolId: 'bt-hci-log',
  category: 'analysis',
  title: 'Bluetooth HCI Log Viewer — btsnoop, pcap and GATT decoding',
  summary: 'Offline decoder for Android btsnoop_hci.log files and pcap/pcapng captures (link type 201). Shows HCI commands and events, ACL/L2CAP traffic with fragment reassembly, ATT and SMP PDUs, advertising reports, connections, and a GATT view of services, characteristics and per-handle reads, writes and notifications.',
  tags: ['Bluetooth', 'HCI', 'btsnoop', 'btsnoop_hci.log', 'BLE', 'GATT', 'ATT', 'L2CAP', 'SMP', 'pcap', 'pcapng', 'HCI snoop', 'Android bug report'],
  readTime: '7 min read',
  content: `
# Bluetooth HCI Log Viewer

The **Bluetooth HCI Log Viewer** opens a Bluetooth host-controller log and decodes it in your browser. It reads the file you pick and nothing else: no Bluetooth hardware is used, nothing is captured, and the file is not uploaded.

## Supported input

| Format | How it is recognised | Notes |
|---|---|---|
| **btsnoop v1** (Android \`btsnoop_hci.log\`) | "btsnoop" magic | Datalink 1002 (H4, indicator byte present) and 1001 (H1). H1 has no indicator byte, so the packet type is rebuilt from the record flags. Data records without the command/event bit are assumed to be ACL. |
| **pcap** | Classic pcap magic, microsecond or nanosecond, either byte order | Only link type 201 (LINKTYPE_BLUETOOTH_HCI_H4_WITH_PHDR). Other link types are refused with a message. |
| **pcapng** | Section header block | Interfaces with link type 201 are read. Other interfaces are skipped and counted in the warnings. |

Any other file is rejected with "Not a btsnoop, pcap or pcapng file". Btsnoop datalinks other than 1001 and 1002 (for example the Monitor format) are not supported.

## How to get a log from Android

Enable Developer options, turn on "Bluetooth HCI snoop log", reproduce the problem, then collect the file. It is usually named \`btsnoop_hci.log\`. Depending on the Android version it is copied into a bug report or is only readable with root. Open it here with **Open capture file**.

## Packets tab

- Every H4 packet is listed with its number, time in seconds from the first packet, direction (TX means host to controller, RX means controller to host), type, and a one-line summary.
- **Type** filters commands, events, ACL, SCO and ISO packets. **Handle** (for example 0x0040) limits the list to one ACL connection. **Text** searches the summary and the decoded fields.
- Selecting a row opens the decoded field list, any advertising data structures, the L2CAP details, and a hex dump of the H4 bytes.
- **Direction** limits the list to TX or RX packets. The **Delta ms** column is the time since the previous packet in the file.
- **CSV** writes the packets that match the current filters (not only the visible rows) as CSV.
- **btsnoop** writes the matching packets to a new btsnoop v1 (H4) file, so you can share a trimmed log. Original timestamps are kept when the source file had them.

## What is decoded

- **HCI commands**: about 50 common opcodes are named (Reset, Read BD_ADDR, LE Set Scan Parameters, LE Set Scan Enable, LE Create Connection, Disconnect, LE Set Advertising Data, LE Connection Update, LE Set Data Length and others). Key parameters are shown with units.
- **HCI events**: Command Complete and Command Status (with the command name), Disconnection Complete, BR/EDR Connection Complete, Encryption Change, Number of Completed Packets, and LE Meta subevents for connection complete (legacy and enhanced), advertising reports, connection update, long-term key request, data length change and PHY update.
- **Advertising reports**: each report shows its event type, address, RSSI and every AD structure: flags, local names, 16/32/128-bit service UUIDs, TX power, appearance, service data and manufacturer data. The company name comes from a short built-in list of Bluetooth SIG company identifiers. Unknown IDs are shown as numbers.
- **ACL and L2CAP**: the handle, PB and BC flags and length are shown. Fragments are reassembled per handle. The complete SDU is attached to the packet that finishes it, with the number of fragments. Orphan continuations and an incomplete SDU replaced by a new start are reported as warnings.
- **ATT**: the common opcodes are decoded (MTU, Find Information, Find By Type Value, Read By Type, Read By Group Type, Read, Read Blob, Read Multiple, Write Request and Command, Prepare and Execute Write, Handle Value Notification and Indication, and Error Response with the error name).
- **SMP** (on CIDs 0x0006 and 0x0007): opcodes are named, and Pairing Request and Response show IO capability, bonding, MITM, Secure Connections and key distribution. Pairing Failed shows its reason.

## GATT tab

Choose a connection (or open one from the Connections tab). The view rebuilds the attribute database from the responses it can see:

- **Services** come from Read By Group Type responses (primary and secondary service ranges).
- **Characteristics** come from Read By Type responses for the Characteristic declaration (0x2803), with their properties and value handles.
- **Descriptors** are inferred from the handle range after each characteristic value, and are named if a Find Information response listed them.
- **Per-handle access** lists the reads, writes, notifications, indications and ATT errors for each handle, with the last value in hex and as UTF-8 text. Click a row to see every event with its packet number. A write shows its status (ok, error, or no response for a Write Command).

Requests and responses are paired in order, one outstanding request per connection, which is how ATT works on a single bearer.

## Connections tab

Lists each connection with its transport (LE or BR/EDR), handle, role, peer address, start and end packet numbers, connection interval, packet count, ATT PDU count, ACL payload bytes sent and received, average rates and end reason. The reason comes from the Disconnection Complete event. Rates are averaged between the first and last ACL packet of the connection, so they describe the capture, not the radio link speed.

## Issues tab

A short list of things worth checking first. Each row can be clicked to open that packet.

- **Commands**: every HCI command is paired with the first Command Complete or Command Status that names the same opcode. A non-zero status is an error. A command with no response in the file is a warning. A response that took 500 ms or more is noted as slow.
- **Connections**: failed connection attempts, and disconnects with a reason other than the normal ones (remote user terminated, low resources, power off, local host terminated).
- **ATT errors**, **encryption change failures**, **controller hardware errors** and parser warnings.

This is a rule-based summary of what is in the file. A clean list does not prove the link was healthy.

## Limits

- **Encryption**: once a link is encrypted, ATT and SMP payloads cannot be read from the capture. Those packets are shown with their headers only.
- **Not decoded in detail**: extended advertising reports, periodic advertising, isochronous (ISO) payloads, SCO audio, and L2CAP channels other than ATT, SMP and signalling. Their packets are listed and their headers are shown.
- **BR/EDR profiles** (SDP, RFCOMM, AVDTP and similar) are not decoded.
- **Wall-clock time** depends on the btsnoop epoch used by the logger. Relative times (seconds from the first packet) are exact.
- **Size**: the whole file is parsed in memory. Very large logs take a while, and the packet list shows the first 400 matches, with a "Show more" button.
- **No live capture**: this tool only reads files you open.

## Troubleshooting

- **"Unsupported btsnoop datalink"**: the log uses a format other than H4 or H1 (for example Monitor format). Export it as H4 if your tool can, or use a different viewer.
- **Few or no services**: the capture may not contain the discovery exchange, or it started after discovery finished. Look for Read By Group Type Request packets with UUID 0x2800.
- **Fragment warnings**: the file may have been truncated (for example by a partial bug-report copy). The packet list still shows everything that was read; check the warnings list.
- **Values look like random bytes**: the connection was encrypted, or the attribute is not text. The hex column is always correct.

## Similar tools

Wireshark (Bluetooth HCI dissectors), BlueZ btmon, the Python btsnoop-parser and the btsnoop-extcap Wireshark plugin were looked at for comparison. They decode more protocols; this viewer adds a command/response check, a per-connection traffic summary and trimmed btsnoop export in the browser.

## Related tools in this app

- **Packet Lab** and **Logic Analyzer** (Analysis & Protocols) for other captures.
- **Hex and file viewers** in the Device Utilities section for inspecting raw bytes.
`,
};
