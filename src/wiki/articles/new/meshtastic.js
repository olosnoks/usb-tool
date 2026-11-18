export default {
  id: 'meshtastic',
  toolId: 'meshtastic',
  category: 'rf',
  title: 'Meshtastic Client — Serial API sync, nodes, map, channels and messages',
  summary: 'Connects to a Meshtastic device over the shared serial port at 115200 baud, reads its node database, channels and config, plots nodes with GPS fixes, and sends and receives text messages. Read-only for configuration.',
  tags: ['Meshtastic', 'LoRa', 'Mesh', 'Protobuf', 'Serial API', 'Node Map', 'Mesh Chat', 'Telemetry', 'Long Fast', 'Channel PSK'],
  readTime: '8 min read',
  content: `
# Meshtastic Client

The **Meshtastic Client** talks to a Meshtastic radio over USB serial using the same binary API the official apps use. It starts a session, reads the device's node database, channels and configuration, and then keeps showing live node, message and telemetry traffic. You can send text messages to the broadcast channel or to a single node.

It runs entirely in the browser. Nothing is sent to a server. The only network request the tool itself makes is for map tiles when you open the **MAP** tab.

## What you need

- **A Chromium browser** (Chrome, Edge or Opera) on desktop. Web Serial is not available in Firefox or Safari.
- **A Meshtastic device** connected by USB and running Meshtastic firmware. The tool does not flash or install firmware.
- **The shared serial port.** Connect through the app's serial controls first, then use this tool's **CONNECT & SYNC** button. The tool expects the shared port at 115200 baud and does not change the baud rate itself.

## Session and sync

Press **CONNECT & SYNC**. If the port is not open, the browser asks you to pick it, and the sync starts once the port reports connected. The tool sends a random \`want_config_id\` and the device answers with, in order: its own node info, the node database, channels, config and module config. When the device echoes your id in \`config_complete_id\`, the session is marked **READY**. Anything the device sends before that is kept, but a stale completion from an older request is ignored.

**RE-SYNC CONFIG** repeats the handshake without reconnecting. **DISCONNECT** closes the port. The data stays visible, marked as coming from the last session, until you sync again.

While a session is ready the tool sends a heartbeat frame about once a minute to keep the link awake.

## The panels

- **Top strip.** Session state, your node (long name and firmware version), node count, channel count and packet counts. Encrypted packets are counted but not decoded.
- **NODES.** One row per node: long and short name, ID in \`!xxxxxxxx\` form, hardware model number and name, role, last heard, hops away (with an MQTT marker), SNR with a rough rating, battery, distance and compass direction from your node, and position. Battery values above 100 mean the node is on external power.
  - The filter box matches name, short name, ID, hardware and role. **has position** and **direct only** (0 hops) narrow the list further.
  - Click a column heading (Name, Last heard, Hops, SNR, Battery, Distance) to sort; click again to reverse. Rows with no value for that column always sort last.
  - Distance and direction use great-circle maths from your node's last known position to the other node's last known position. They show a dash if either node has no fix.
  - The SNR label is a rule of thumb, not a firmware value: good at 0 dB or more, fair down to -10 dB, weak below that. Usable SNR depends on the modem preset.
  - The speech-bubble button opens a direct message to that node. The copy button puts a \`meshtastic --traceroute '!id'\` command on the clipboard for the official Python CLI. This tool does not send traceroutes itself.
  - **CSV** saves the rows currently shown (after filtering and sorting). **JSON** saves all nodes.
- **MAP.** Plots every node that reports a real GPS fix, using Leaflet and OpenStreetMap tiles. Nodes reporting 0,0 are treated as having no fix.
- **CHANNELS.** Index, role (primary, secondary or disabled), name, uplink and downlink flags, and the **length** of each channel key. The key bytes are never shown and cannot be entered here.
- **MESSAGES.** Text messages received on any channel or directly to you, plus the messages you sent. Choose **Broadcast on channel** and a channel index, or pick a node for a direct message. Press Enter to send and Shift+Enter for a new line. The filter above the list shows all messages, direct messages only, or one channel, and **CSV** saves the messages currently shown.
- **TELEMETRY.** Device metrics for nodes that have sent them: battery, voltage, channel utilisation, air utilisation for transmit and uptime.
- **CONFIG (READ-ONLY).** The decoded device config and module config as JSON. Wi-Fi and MQTT passwords are shown as \`[redacted]\`. The security and key sections are not decoded at all, and the tool cannot write config.
- **DEVICE LOG.** Debug text the firmware prints on the serial port, plus structured log records. Use it to see what the device is doing when a sync stalls.

## Message delivery

A sent message starts as **sent**. It becomes **acked** only when the mesh returns a routing acknowledgement for that packet id. If the mesh reports a routing error, such as a timeout, no route, a too-large packet or a duty-cycle limit, the message shows **failed** with that reason. A broadcast message is not acknowledged the same way as a direct message, so it may stay **sent** even when it went out. Your own transmissions can be echoed back by the device; the tool keeps one copy of each.

Text is sent as UTF-8. A message whose encoded frame would exceed the 512-byte serial frame limit is refused before anything is written.

## How the protocol is handled

The serial framing is two sync bytes (0x94 0xC3), a 16-bit big-endian length and a protobuf payload. Bytes that do not form a valid frame are treated as debug console text. The parser handles frames split across chunks, console text between frames and UTF-8 characters split across chunks.

The protobuf codec is written by hand, with no third-party library. Field numbers come from the official meshtastic/protobufs definitions for the messages this tool reads and writes. Fields the tool does not describe are kept as unknown fields rather than causing a decode failure. The enum tables for hardware models, port numbers, device roles and routing errors are copied from the same definitions. The config view shows region and modem preset as their numbers.

## Limits

- **Read-only configuration.** The tool does not change device settings, channels, owner name, position or keys.
- **Text only.** It sends TEXT_MESSAGE_APP packets. It does not send positions, telemetry requests, traceroutes or admin messages.
- **No keys in the browser.** Encrypted packets stay encrypted. The device decrypts what it has keys for, and this tool only sees what the device passes to the serial API.
- **No firmware update, no Bluetooth, no Wi-Fi.** Only the USB serial API is used.
- **Not a full client.** There is no message history beyond this session, no store-and-forward retrieval and no MQTT view.
- **Hardware testing.** Parsing and encoding are covered by unit tests with known byte vectors. Check the sync on your own device before relying on it.

## Troubleshooting

- **Sync never reaches READY.** Look at the DEVICE LOG tab. If you see only console text and no frames, the firmware may not have its serial API enabled on this port, or another app holds the port. Close other Meshtastic apps and sync again.
- **"Undecodable frame" entries.** The device sent a frame this tool could not parse. Decode errors are counted at the bottom of the panel. These can occur when the firmware is newer than the field list in this tool.
- **No map points.** Nodes without a GPS fix are listed but not plotted. Check the MAP tab's count.
- **Messages stay "sent".** Broadcast traffic is often never acknowledged. Try a direct message to a node to see a real acknowledgement.
- **Battery shows "external power".** This is the firmware's convention for values above 100%, not an error.

## Similar tools

The features were chosen after comparing against the Meshtastic web client (client.meshtastic.org), the Android and Apple apps (sortable node list with distance, hops and signal), and the \`meshtastic\` Python CLI (\`--nodes\`, \`--traceroute\`, \`--export-config\`). Traceroute, channel QR sharing and config writing are not implemented here.

## Related tools

- **Terminal & Console** shows the raw serial traffic, including the console text this tool separates from frames.
- **Flipper Zero Suite** is another protobuf-over-serial client in the RF section, for a different device family.
`,
};
