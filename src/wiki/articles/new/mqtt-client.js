export default {
  id: 'mqtt-client',
  toolId: 'mqtt-client',
  category: 'webapp',
  title: 'MQTT Client — MQTT 3.1.1 over WebSocket, subscriptions, topic tree and publish',
  summary: 'A browser MQTT 3.1.1 client that talks to a broker over WebSocket (ws:// or wss://). Connect with profiles, subscribe with QoS, browse a live topic tree, view payloads as text, JSON or hex, and publish at QoS 0, 1 or 2 with retain. No install and no native driver.',
  tags: ['MQTT', 'MQTT 3.1.1', 'WebSocket', 'WSS', 'Mosquitto', 'HiveMQ', 'Home Assistant', 'Tasmota', 'zigbee2mqtt', 'IoT', 'Topic tree', 'QoS'],
  readTime: '8 min read',
  content: `
# MQTT Client

The **MQTT Client** is a publish/subscribe client for MQTT **3.1.1**, running entirely in your browser. Browsers cannot open raw TCP sockets, so this tool connects through the **WebSocket** transport that MQTT brokers provide. It needs no install, no native driver and no server of its own.

## What you need from the broker

The broker must have a WebSocket listener, and the browser can only reach it if the address is one it is allowed to open:

- **Plain WebSocket:** \`ws://host:port\`. Use this for a broker on your own network.
- **Secure WebSocket:** \`wss://host:port/path\`. Use this for any broker on the internet, and for this tool when the app is served over \`https://\`. A page served over https is not allowed to open a \`ws://\` connection (mixed content), and the tool shows a warning when that happens.

The tool asks for the subprotocol \`mqtt\`. The broker must answer with it, or the browser refuses the socket. Only binary frames are accepted.

### Example: Mosquitto with a WebSocket listener

\`\`\`
listener 1883
protocol mqtt

listener 9001
protocol websockets
allow_anonymous true
\`\`\`

The \`allow_anonymous true\` line is for testing only; use a \`password_file\` for real use. Then connect to \`ws://<broker-ip>:9001\`. For \`wss://\`, add a TLS listener on another port with \`certfile\` and \`keyfile\` set, using a certificate the browser trusts. For a self-signed certificate, open \`https://<broker-ip>:<port>\` in a browser tab and accept the warning first.

### Public test brokers

The presets in the **Connection** card point at public brokers:

| Preset | URL |
|---|---|
| HiveMQ public | \`wss://broker.hivemq.com:8884/mqtt\` |
| Mosquitto test | \`wss://test.mosquitto.org:8081\` |

Anyone can subscribe to \`#\` on a public broker and read what you publish. Use long, unique topic names and never send passwords or private data. The tool shows a notice when a public broker is selected.

## Connecting

1. Pick a preset or type the **Broker URL**.
2. Set a **Client id**. The default is random per form; keep a fixed id if you want the broker to remember your session.
3. Enter a **User name** and **Password** if the broker needs them.
4. Leave **Clean session** ticked unless you know you need persistent sessions (see the limits below).
5. Click **Connect**. The status badge moves from DISCONNECTED to CONNECTING to CONNECTED. A refused connection shows the broker's reason, such as "bad user name or password" or "not authorized".

Keep-alive is sent as PINGREQ when the link is idle. If the broker stops answering within the keep-alive period, the tool closes the connection and reports it.

**Last will** (optional) is a topic, message, QoS and retain flag that the broker publishes if this client drops without a clean DISCONNECT.

## Profiles

**Save** stores the current connection fields under a name in this browser's localStorage. The **password is saved only when "Remember password" is ticked**, and then it is stored in plain text in localStorage. Anyone with access to this browser profile can read it. Profiles are never sent anywhere.

## Subscriptions

Type a topic filter and pick a QoS (0, 1 or 2), then click **Subscribe**. Filters support \`+\` (one level) and \`#\` (all remaining levels, last position only). The chips add common filters such as \`#\`, \`tele/#\` and \`$SYS/#\`.

- Each row shows the **requested** QoS and the **granted** QoS from the broker's SUBACK. A refused filter is marked **refused**.
- Subscriptions are kept in the list while you are disconnected. They are sent again automatically after every connect.
- Topics beginning with \`$\` (such as \`$SYS/broker/uptime\`) are not matched by filters that start with \`#\` or \`+\`. Subscribe to \`$SYS/#\` explicitly to see them.

## Message log and topic tree

Incoming messages appear in the **Log** with time, direction, topic, QoS, a **RET** marker for retained messages, and a preview. Click a row to open the full payload. The payload view applies to every row:

- **text** shows the payload as UTF-8 (invalid bytes are replaced).
- **JSON** pretty-prints valid JSON and falls back to text with a note.
- **hex** shows a hex dump with ASCII, up to 4 KB.

The **Topic tree** groups topics by \`/\` levels. Each topic shows how many messages arrived and the **last payload**. Click a topic name to copy it into the publish form. Only incoming messages build the tree.

The **filter** box narrows both views by topic or payload text. **Pause** holds incoming messages in a queue and applies them on **Resume**; the count of queued and dropped messages is shown. **Export JSON** saves the messages currently in the log with text and base64 payloads. Passwords are never included.

The browser keeps the most recent 1000 messages. The topic tree holds up to 5000 distinct topics; later new topics are not added.

## Publishing

Enter a topic (no \`+\` or \`#\`), a payload, and choose:

- **text** or **hex** payload format (hex accepts spaces, colons and an optional \`0x\`);
- **QoS 0** (fire and forget), **QoS 1** (PUBACK) or **QoS 2** (PUBREC, PUBREL, PUBCOMP, exactly once);
- **retain**, so the broker keeps the message for future subscribers.

Outgoing messages appear in the log marked **OUT**. The result line reports success, or the reason the publish failed. Publishing needs a connection.

## Home Assistant, Tasmota and zigbee2mqtt

The **Hints** card explains the common topic layouts and gives one-click subscribe buttons:

- **Home Assistant:** \`homeassistant/#\` shows discovery configs; device states are on the topics those configs name.
- **Tasmota:** \`tele/<topic>/SENSOR\` and \`tele/<topic>/LWT\` (Online or Offline) are telemetry; \`stat/<topic>/RESULT\` holds command results. Commands go to \`cmnd/<topic>/POWER\` with \`ON\`, \`OFF\` or \`TOGGLE\`.
- **zigbee2mqtt:** \`zigbee2mqtt/<friendly name>\` carries state as JSON; \`zigbee2mqtt/bridge/#\` carries bridge information. Control a device by publishing \`{"state":"ON"}\` to \`zigbee2mqtt/<friendly name>/set\`.

## Troubleshooting

- **"Connection closed (code 1006)" right away:** the address or port is wrong, the broker has no WebSocket listener on that port, the TLS certificate was rejected, or the broker refused the \`mqtt\` subprotocol. Browsers hide the exact reason, so check the broker's log.
- **Blocked with a mixed-content warning:** use \`wss://\` when the app is on \`https://\`.
- **"Refused: bad user name or password" or "not authorized":** check the credentials and the broker's ACL.
- **"Timed out waiting for CONNACK":** the URL reaches a host that does not speak MQTT, or the broker is overloaded.
- **"No PINGRESP ... closing":** the network dropped during an idle period. Connect again.

## Limits and what it does not do

- **MQTT 3.1.1 only.** MQTT 5.0 properties, reason codes and shared subscriptions are not implemented. Most brokers still accept 3.1.1.
- **WebSocket only.** Plain TCP brokers on port 1883 cannot be reached from a browser. Enable a WebSocket listener on the broker.
- **No automatic reconnect.** After a drop, press **Connect** again. Subscriptions are then re-sent.
- **No session resumption.** Messages in flight at QoS 1 or 2 when the connection drops fail with an error and are not retried. Clean session is the safe default.
- **No client certificates.** TLS uses the browser's trust store; the tool does not accept a client certificate.
- **Public payload visibility.** Topics and payloads are visible to anyone with access to the broker. The tool does not encrypt payloads beyond TLS.
- **No broker administration.** The tool does not create users or ACLs. A retained message can be cleared by publishing an empty payload with retain ticked.

## Related tools

For checksums of files or text used alongside MQTT payloads, see the **Hash & HMAC Calculator** (\`hash-calculator\`). For sizing resistors, pull-ups and UART baud rates, see the **Electronics Calculators** (\`electronics-calc\`).
`,
};
