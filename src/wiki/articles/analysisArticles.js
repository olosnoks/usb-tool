/**
 * Analysis & Protocol Lab Wiki Articles — Comprehensive Technical Manual
 * Covering Packet Lab, Logic Analyzer, CAN Bus, I2C/SPI Explorer, Modbus RTU, Plotter, and MitM Bridge
 */

export const ANALYSIS_ARTICLES = [
  {
    id: 'packet-analyzer',
    toolId: 'packet-analyzer',
    category: 'analysis',
    title: 'Packet & Protocol Lab — 802.11 Dissector, PCAP & Packet Framer',
    summary: 'Master raw 802.11 Wi-Fi promiscuous frame capture, EAPOL 4-way handshakes, PCAP export for Wireshark, hex stream slicing, and custom serial protocol framing.',
    tags: ['Wi-Fi', '802.11', 'PCAP', 'Packet Framer', 'Hex Stream', 'Dissector', 'EAPOL', 'Handshake', 'Wireshark'],
    readTime: '24 min read',
    content: `
# Packet & Protocol Lab — 802.11 Dissector & PCAP Studio

The **Packet & Protocol Lab** groups four packet-inspection views: a capture viewer that opens radiotap \`.pcap\` files (or follows a serial stream) and exports CSV / \`.pcap\`, a Kismet Studio client for Alfa-style Wi-Fi monitor setups, a live hex stream viewer and a custom serial packet framer (start/end bytes, fixed length or SLIP).

---

### 1. What Is This Tool & Why Do You Need It?

Normally, network cards filter out Wi-Fi frames that aren't addressed to your specific computer. In cybersecurity auditing and wireless protocol development, you need to see **everything** in the air: beacon frames announcing access points, probe requests from smartphones searching for known home Wi-Fi networks, deauthentication packets, and cryptographic key exchanges.

The **Packet & Protocol Lab** has four sub-tabs: a **Wi-Fi & PCAP Analyzer** that opens captures, a live **Kismet Studio** client for a real Kismet server, a **Hex Stream Viewer** for the shared serial stream, and a **Packet Framer** that slices that stream into packets. The analyzer starts empty: it does not capture raw 802.11 itself. You capture with a sniffer (Kismet, Wireshark, an ESP32 sniffer that writes a pcap) and **Open capture** the radiotap \`.pcap\` / \`.cap\` file, or tick **Follow serial stream** to turn serial lines into rows. The 802.11 background below explains the formats you will meet when using sniffers and Kismet.

---

### 2. How 802.11 Promiscuous Sniffing Works Under the Hood

When an ESP32 Wi-Fi radio enters promiscuous mode (\`esp_wifi_set_promiscuous(true)\`), the baseband MAC filter is bypassed. Every valid RF packet on the tuned 2.4GHz channel is captured and delivered to the software callback with an \`esp_wifi_promiscuous_pkt_t\` header containing:
- **RSSI (Received Signal Strength Indicator)**: Received power in dBm (e.g. \`-45 dBm\` is strong, \`-88 dBm\` is faint).
- **Secondary Channel / Channel Frequency**: Which 20MHz/40MHz channel the frame arrived on.
- **Timestamp & Noise Floor**: Internal microsecond hardware clock.

#### The IEEE 802.11 MAC Frame Structure
Every raw Wi-Fi frame conforms to this binary format:
\`\`\`
+--------------------+--------------+--------------+--------------+--------------+-------------+---------------+----------+
| Frame Control (2B) | Duration(2B) | Address 1(6B)| Address 2(6B)| Address 3(6B)| Seq Ctrl(2B)| Payload (N B) | FCS (4B) |
+--------------------+--------------+--------------+--------------+--------------+-------------+---------------+----------+
\`\`\`

<details>
<summary>Deep Dive: 802.11 Frame Control Bitmask & EAPOL 4-Way Handshake Cryptographic Math</summary>

#### 16-Bit Frame Control Field Bitmask
The first 2 bytes of every 802.11 packet dictate how the rest of the MAC header must be parsed:

| Bit Range | Field Name | Meaning & Common Values |
| :--- | :--- | :--- |
| **B0 - B1** | Protocol Version | Always \`00\` in modern 802.11 networks. |
| **B2 - B3** | Type | \`00\` = Management, \`01\` = Control, \`10\` = Data, \`11\` = Reserved. |
| **B4 - B7** | Subtype | Detailed frame action (e.g. \`1000\` = Beacon, \`0100\` = Probe Req, \`1100\` = Deauth). |
| **B8** | To DS | \`1\` if destination is the Distribution System (wired AP backbone). |
| **B9** | From DS | \`1\` if frame originated from the Distribution System. |
| **B10** | More Fragments | \`1\` if higher-layer packet was fragmented into multiple frames. |
| **B11** | Retry | \`1\` if frame is a retransmission due to missing 802.11 ACK. |
| **B12** | Power Mgmt | \`1\` if transmitter station is entering 802.11 Power Save mode. |
| **B13** | More Data | \`1\` if AP has buffered frames ready for power-saving station. |
| **B14** | Protected Frame | \`1\` if payload is encrypted (WEP, TKIP, CCMP AES, GCMP). |
| **B15** | Order | \`1\` if StrictlyOrdered transmission service is requested. |

#### EAPOL 4-Way Handshake Mathematical Key Derivation
To authenticate and generate the session encryption keys without transmitting passwords over the air, WPA/WPA2 utilizes the 4-way handshake:

1. **PMK (Pairwise Master Key)**: Derived from the WPA passphrase and SSID using PBKDF2:
   \`\`\`text
   PMK = PBKDF2(HMAC-SHA1, Passphrase, SSID, 4096 iterations, 256 bits)
   \`\`\`
2. **Message 1 (AP -> Station)**: The AP generates a 256-bit random number called the **ANonce** and transmits it with a Key Replay Counter.
3. **Message 2 (Station -> AP)**: The station generates its own 256-bit random number called the **SNonce**. The station now has all 5 inputs to derive the **PTK (Pairwise Transient Key)**:
   \`\`\`text
   PTK = PRF-512(PMK, "Pairwise key expansion", Min(AA,SPA) || Max(AA,SPA) || Min(ANonce,SNonce) || Max(ANonce,SNonce))
   \`\`\`
   - \`AA\`: Access Point MAC Address (6 bytes).
   - \`SPA\`: Station Supplicant MAC Address (6 bytes).
   - The station calculates a **MIC (Message Integrity Code)** using the KCK (Key Confirmation Key, bits 0-127 of PTK) and attaches it to Message 2.
4. **Message 3 (AP -> Station)**: The AP verifies the MIC, increments the replay counter, and transmits the **GTK (Group Temporal Key)** encrypted with the KEK (Key Encryption Key).
5. **Message 4 (Station -> AP)**: Final confirmation MIC from the station. Both sides now activate AES-CCMP encryption.

</details>

<details>
<summary>Custom Protocol Framer: SLIP & Byte Stuffing Background</summary>

The **Packet Framer** supports three framing modes: **Start / End Byte** (custom hex delimiters, default \`0xAA\` / \`0x55\`), **Fixed Length** (default 16 bytes) and **SLIP (0xC0)**. COBS is background only: it appears in the tab's name but the framer has no COBS mode.

#### SLIP (Serial Line Internet Protocol — RFC 1055)
- **Frame End**: \`0xC0\` (Octal \`0300\`).
- **Frame Escape**: \`0xDB\` (Octal \`0333\`).
- If data byte is \`0xC0\`, the sender replaces it with \`0xDB 0xDC\`.
- If data byte is \`0xDB\`, the sender replaces it with \`0xDB 0xDD\`.
- The tool's SLIP mode cuts the stream at \`0xC0\` boundaries. It does not un-escape the payload.

#### COBS (Consistent Overhead Byte Stuffing) — background
- Encodes a packet of *N* bytes with at most $\lfloor N/254 \rfloor + 1$ bytes of overhead.
- Removes all zero (\`0x00\`) bytes from the payload so \`0x00\` can serve as the packet delimiter.

</details>

---

### 3. Complete UI Control Mapping

**Lab sub-tabs**

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Wi-Fi & PCAP Analyzer** | Tab | Sample-frame viewer (802.11, EAPOL, NMEA, Modbus examples). |
| **Kismet Studio (Alfa / 802.11)** | Tab | Live client for a Kismet server. |
| **Hex Stream Viewer** | Tab | Live hex/ASCII view of the shared serial byte stream. |
| **Packet Framer (SLIP / COBS)** | Tab | Frames the byte stream by start/end bytes, fixed length or SLIP. |

**Wi-Fi & PCAP Analyzer**

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Open capture** | File button | Opens a radiotap \`.pcap\` / \`.cap\` file and dissects every packet (802.11 type/subtype, addresses, SSID, channel, RSSI). An unreadable file shows "Could not open ...". |
| **Clear** | Button | Empties the packet table. |
| **Load demo frames** | Button | Loads five built-in example frames (beacon, probe request, EAPOL message 1, NMEA sentence, Modbus response). They are not captured from anything: a **DEMO DATA** badge is shown while they are in the table. |
| **Export CSV** | Button | Downloads the table as \`skons_packet_capture.csv\`. |
| **Export .pcap** | Button | Writes the frames that came from an opened capture as a real radiotap \`skons_packet_capture.pcap\` for Wireshark. Disabled when no pcap-origin frames are loaded (serial and demo rows are not packets). |
| **Filter by MAC, SSID, protocol...** | Text Input | Live filter on protocol, source, destination or SSID. |
| **ALL / Management / Data / Serial** | Buttons | Filter by frame type. |
| **Follow serial stream** | Checkbox | Turns newly received serial lines (split at LF, or every 512 bytes) into "Serial" rows; NMEA sentences are labelled as such. It ignores data received before you ticked it, and removes demo frames. **Status** shows LIVE while data arrived in the last 5 seconds, otherwise IDLE. |
| **Frames** | Counter | Number of rows matching the filter. Only the first 1,000 are listed; narrow the filter to see the rest. |
| **Packet Capture Stream** | Table | Time, Protocol, Source, Destination / SSID and RSSI per frame. |
| **Frame Details & Hex Inspector** | Panel | Frame type, channel, addresses (Addr1-3 for 802.11), BSSID, payload length and raw hex of the selected row. |

**Hex Stream Viewer**

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **8-Byte / 16-Byte** | Toggle | Bytes per row. |
| **Search hex (e.g. 55 AA)...** | Text Input | Highlights matching byte sequences. |
| **Auto-scroll** | Icon button | Follows incoming bytes. |
| **HEX / C[]** | Buttons | Copy the visible bytes as a hex string or a C array. |
| **Clear Hex Stream Buffer** | Icon button | Clears the hex stream buffer. |

**Packet Framer**

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Start / End Byte, Fixed Length, SLIP (0xC0)** | Buttons | Framing mode. |
| **START / END / LENGTH** | Inputs | Frame delimiter bytes (hex) or fixed frame length. |
| **Pause / Resume** | Button | Pauses frame extraction. |
| **Search hex bytes or ASCII payload...** | Text Input | Filters the framed packets. |
| **Export JSON** | Button | Downloads the framed packets. |
| **Clear Packets** | Button | Empties the packet list. |

---

#### Walkthrough A: Framing a Binary Serial Stream
1. Connect your device from the header so bytes flow into the shared stream.
2. Open the **Packet Framer (SLIP / COBS)** sub-tab.
3. Pick **Start / End Byte** and enter the **START** / **END** bytes (e.g. \`0xAA\` and \`0x55\`), or choose **Fixed Length** (set **LENGTH**) or **SLIP (0xC0)**.
4. Each complete frame appears in the table with Time, Bytes, Opcode (the second byte), Hex Payload and ASCII. Use the search box to filter by hex or ASCII.
5. Click a row to open the **Packet Inspector**, which also shows its CRC-16/Modbus.
6. Click **Export JSON** to save the framed packets. Use the pause button to freeze capture.

#### Walkthrough C: Inspecting a Capture File
1. Open the **Wi-Fi & PCAP Analyzer** sub-tab. It starts empty.
2. Click **Open capture** and pick a radiotap \`.pcap\` / \`.cap\` file (for example one saved by Kismet or Wireshark).
3. Filter with the search box or the **ALL / Management / Data / Serial** buttons.
4. Click a row to see its addresses, BSSID, SSID, channel, length and raw hex in the details pane.
5. **Export CSV** saves the table; **Export .pcap** writes the opened packets back out as a radiotap \`.pcap\`.
6. No capture handy? **Load demo frames** shows five labelled example rows (a **DEMO DATA** badge is displayed) so you can try the filters.

<details>
<summary>Deep Dive: Alfa Network Wi-Fi Adapters & Kismet REST / WebSocket Architecture</summary>

#### 1. Alfa Wi-Fi Adapter Chipset Matrix
Alfa Network USB adapters are the global gold standard for 802.11 monitor mode, raw frame capture, and penetration auditing:

| Model | Silicon Chipset | Frequency Bands | Max Radiated Power | Linux Kernel Driver | Special Characteristics |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **AWUS036ACH** | Realtek RTL8812AU | 2.4 GHz & 5 GHz (802.11ac) | Up to 1000 mW (30 dBm) | \`rtl8812au-dkms\` | 2x2 MIMO dual-dipole. The most widely deployed dual-band 802.11ac audit card. |
| **AWUS1900** | Realtek RTL8814AU | 2.4 GHz & 5 GHz (802.11ac) | High Power (Quad Amp) | \`rtl8814au-dkms\` | 4T4R quad-antenna array for high-density enterprise 5GHz spectrum audits. |
| **AWUS036NHA** | Qualcomm Atheros AR9271 | 2.4 GHz (802.11b/g/n) | 28 dBm | \`ath9k_htc\` (In-Tree) | 100% open-source firmware. Legendary frame injection and low-level MAC stability. |
| **AWUS036AXM** | MediaTek MT7921AUN | 2.4, 5 & 6 GHz (Wi-Fi 6E) | Standard High Efficiency | \`mt7921u\` (Linux 5.18+) | Next-gen Wi-Fi 6E (802.11ax) capture supporting pristine 6GHz UNII-5 to UNII-8 channels. |
| **AWUS036NH** | Ralink RT3070 | 2.4 GHz (802.11b/g/n) | 2000 mW (Ultra-High) | \`rt2800usb\` (In-Tree) | Exceptional receiver sensitivity for long-range rural or perimeter auditing. |
| **Panda PAU09** | Ralink RT5572 | 2.4 GHz & 5 GHz (802.11a/b/g/n N600) | High Gain Dual-Band | \`rt2800usb\` (In-Tree) | Dual-band 2x2:2 MIMO (300Mbps + 300Mbps) with out-of-the-box monitor mode & frame injection. |

#### 2. Kismet Daemon REST & WebSocket API Specification
Kismet functions as a headless multi-threaded C++ RF capture engine serving real-time JSON and WebSockets on port \`2501\`:
- \`GET /system/status.json\`: Server health, memory, thread pool, and total packets per second.
- \`GET /devices/views/all/devices.json\`: Master device catalog containing BSSID, SSID, channel frequency, signal RSSI (min/max/current), cryptography types, associated clients, and OUI vendors.
- \`GET /alerts/all_alerts.json\`: Wireless Intrusion Detection System (WIDS) alerts (Deauth floods, Rogue APs, Channel hop violations).
- \`GET /channels/channels.json\`: Channel utilization and RF congestion across 2.4GHz and 5GHz bands.
- \`GET /pcap/all.pcapng\`: Real-time streaming PCAP-NG capture file directly from monitor interfaces.
- \`ws://localhost:2501/devices/views/all/devices.ws\`: High-throughput binary WebSocket stream pushing delta device updates without polling overhead.

#### 3. WIDS Alerts
The **WIDS Intrusion Alerts** tab lists the alerts Kismet itself raises (the tool polls the server's alert list and colors them by severity). Typical Kismet alerts cover deauthentication floods, suspected rogue / evil-twin access points and malformed probe responses. The detection thresholds belong to Kismet, not to this tool.

</details>

#### Walkthrough B: Dual-Band Auditing with Alfa AWUS036ACH & Kismet Studio
1. Plug your Alfa AWUS036ACH or AWUS1900 adapter into your workstation USB 3.0 port.
2. Open a terminal and put the Alfa adapter into monitor mode:
   \`\`\`bash
   sudo airmon-ng check kill && sudo airmon-ng start wlan1
   kismet -c wlan1mon
   \`\`\`
3. In Skon's USB Tool, switch to the **Kismet Studio (Alfa / 802.11)** tab.
4. Set the server URL (default \`http://localhost:2501\`) and, if Kismet needs a login, its API key or \`user:password\`, then click **Connect Kismet**.
5. If this page is served over https (or Kismet doesn't send CORS headers), the browser will block the direct call. Click **Docker backend** in the proxy bar, bring up the \`cors-proxy\` service, set it as the proxy, and connect again — requests then route through \`localhost:47101\` to Kismet. Kismet still does all the radio capture itself.
6. The device catalog populates with dual-band 2.4 GHz and 5 GHz Access Points and client stations from the live server.
7. Switch to **Channels & Congestion** to identify clear 5 GHz DFS channels or examine 2.4 GHz channel overlap on 1, 6, and 11.
8. Check the **WIDS Intrusion Alerts** tab to monitor for deauth floods, rogue APs, or beacon injection attacks in real time!
9. Click **WiGLE CSV** to export geolocated access points for wireless mapping submission.

---

### 5. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **Packets table is empty** | The Wi-Fi & PCAP Analyzer starts empty and after **Clear**. | Click **Open capture** to load a \`.pcap\`, tick **Follow serial stream**, or click **Load demo frames** for labelled examples. |
| **"Could not open ..." after Open capture** | The file is not a classic pcap in the radiotap (802.11) link type. | Re-save the capture as pcap with the IEEE 802.11 radiotap link type (pcapng files must be converted). |
| **Export .pcap is greyed out** | Only frames from an opened capture can be written back as a pcap. | Open a capture first; serial and demo rows are not packets. |
| **Hex Stream Viewer / Packet Framer show nothing** | No serial device is connected, or nothing is arriving. | Connect a board from the header, then check that the Terminal shows traffic. |
| **Packet Framer finds no packets** | Start/End bytes or length do not match the stream. | Check the **START** / **END** hex values (e.g. \`0xAA\`, \`0x55\`), the **LENGTH**, or switch to **SLIP (0xC0)**. Framing is paused if the pause button is active. |
| **Cannot Connect to Kismet (Port 2501)** | Kismet daemon is not running or blocked by local firewall. | Run \`kismet -c wlan1mon\` in terminal. Verify \`http://localhost:2501\` responds in browser. |
| **Connect fails only from the hosted (https) site** | Browser blocks a plain-http / non-CORS Kismet from an https page. | Run the \`cors-proxy\` Docker backend and set it as the proxy in Kismet Studio's proxy bar; requests then reach Kismet via \`localhost:47101\`. |
| **Kismet refused the login** | Kismet needs an API key or user:password. | Enter the API key (sent as the \`KISMET\` URL parameter) or \`user:password\` (sent as Basic auth) and connect again. |
| **Alfa Adapter Not Entering Monitor Mode** | NetworkManager or wpa_supplicant reclaiming USB interface. | Run \`sudo airmon-ng check kill\` prior to starting monitor mode. Ensure correct DKMS driver is installed. |

---

### Implementation & Architecture

- **Component:** [\`src/components/tools/ProtocolPacketLab.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/ProtocolPacketLab.jsx) is a thin tab router. The sub-tabs are **Wi-Fi & PCAP Analyzer** (\`PacketAnalyzerWorkbench\`), **Kismet Studio (Alfa / 802.11)** (\`KismetStudioWorkbench\`), **Hex Stream Viewer** (\`HexViewer\`) and **Packet Framer (SLIP / COBS)** (\`PacketFramer\`). The tool IDs \`packet-analyzer\`, \`hex\`, \`packets\` and \`kismet\` all open this same lab on the matching sub-tab.
- **Wi-Fi & PCAP Analyzer:** \`PacketAnalyzerWorkbench\` starts empty. **Open capture** reads a radiotap pcap with \`src/utils/pcapReader.js\` and turns each record into a row with \`src/utils/packetFrames.js\` (802.11 type/subtype, addresses, SSID, channel, RSSI); **Follow serial stream** adds LF-split serial lines from the shared \`hexByteStream\` (only bytes received after it is ticked). It ships five clearly labelled demo frames (**Load demo frames**, shown with a **DEMO DATA** badge). It does not detect handshakes. **Export CSV** writes the table and **Export .pcap** writes only the frames that came from an opened capture.
- **Hex stream:** \`HexViewer\` renders \`hexByteStream\` straight from the shared \`SerialContext\` (every RX/TX byte, color-coded by direction, newest 4096 bytes shown in the lab), so it reflects whatever the Terminal is connected to.
- **Framing:** \`PacketFramer\` slices that same byte stream into packets using Start / End byte, Fixed Length or SLIP (0xC0) framing, and shows a CRC-16/Modbus value for the selected packet.
- **Kismet:** \`KismetStudioWorkbench\` talks to a Kismet server's REST API through \`src/utils/kismetClient.js\` (optionally via the local \`cors-proxy\` Docker backend). Kismet does all the radio capture.

---

### 6. Upstream Standards & Engineering Attribution

| Standard / Component | Authoring Organization / Maintainers | Reference & Specification |
| :--- | :--- | :--- |
| **Kismet Wireless Network Detector & IDS** | Mike Kershaw (dragorn) & Kismet Wireless | [kismetwireless.net](https://www.kismetwireless.net) (GPL-2.0) |
| **Alfa Network High-Gain Wireless Hardware** | Alfa Network Inc. (Taiwan) | [alfa.com.tw](https://www.alfa.com.tw) (Hardware Specs) |
| **IEEE 802.11 Wireless LAN MAC Standard** | IEEE Computer Society LAN/MAN Standards Committee | [IEEE 802.11-2020](https://standards.ieee.org) |
| **Libpcap / PCAP File Format Specification** | The Tcpdump & Libpcap Project (Van Jacobson, Craig Leres, Steven McCanne) | [tcpdump.org](https://www.tcpdump.org) (BSD 3-Clause) |
| **Wireshark Packet Dissector Architecture** | The Wireshark Foundation & Gerald Combs | [wireshark.org](https://www.wireshark.org) (GPL-2.0) |
`
  },
  {
    id: 'logic-analyzer',
    toolId: 'logic-analyzer',
    category: 'analysis',
    title: '24MHz Logic Analyzer — Multi-Channel Waveforms & Protocol Decoders',
    summary: 'Hardware digital signal analysis up to 24 MSps, SUMP (channel count from the device, level and edge triggers, pre-trigger) and fx2lafw (8 or 16 channels) capture, protocol decoders (I2C, UART, SPI, 1-Wire, CAN, WS2812, IR, SWD) with stacked decoders, edge/pattern search, sessions, and VCD / PulseView .sr export and import.',
    tags: ['Logic Analyzer', '24MHz', 'Waveforms', 'Protocol Decoder', 'Sigrok', 'VCD', 'SPI', 'I2C', 'UART'],
    readTime: '22 min read',
    content: `
# 24MHz Logic Analyzer — Digital Signal Workbench

The **Logic Analyzer** workbench is a multi-channel digital logic analyzer (8 channels on most hardware; the count comes from the device) and protocol decoder in your browser. It captures from low-cost logic hardware (SUMP-protocol devices over Web Serial, such as Arduino / Raspberry Pi Pico sketches and the Open Bench Logic Sniffer, or Cypress FX2LP boards running sigrok's fx2lafw firmware over WebUSB), or opens existing \`.vcd\` / PulseView \`.sr\` files. It decodes I2C, UART, SPI, 1-Wire, CAN, WS2812, IR (NEC / RC-5) and SWD directly over the waveform.

---

### 1. What Is This Tool & Why Do You Need It?

When debugging communication between two chips (for example, an ESP32 talking to an OLED display or EEPROM), software serial print statements can't tell you if the clock line is glitching, if an acknowledgment bit was missed, or if timing setup/hold requirements were violated.

An oscilloscope displays analog voltages, but a **Logic Analyzer** records the digital states (\`0\` and \`1\`) across multiple parallel channels simultaneously. It allows you to:
- Verify exact clock frequencies.
- Measure microsecond pulse widths.
- Decode serial bytes right on top of the physical signal traces.
- Catch intermittent bus lockups with edge triggers.

---

### 2. Hardware Specifications & Pinout

| Channel | Function / Color | Voltage Tolerance | Recommended Use |
| :--- | :--- | :--- | :--- |
| **D0** | Brown | 0V to 5.5V TTL | Decoder defaults: I2C SCL |
| **D1** | Red | 0V to 5.5V TTL | I2C SDA |
| **D2** | Orange | 0V to 5.5V TTL | UART RX (default) |
| **D3** | Yellow | 0V to 5.5V TTL | Free; any role can be remapped |
| **D4 - D7**| Green/Blue/Violet/Grey | 0V to 5.5V TTL | SPI defaults: CS = D4, MOSI = D5, MISO = D6, CLK = D7 |
| **GND** | Black | **0V Reference** | **MANDATORY**: Must connect to target board ground! |

Wire colors vary by board (the colors shown are the usual 24 MHz 8-channel clone leads). The decoder defaults above can be changed with the role dropdowns in the Protocol Decoder bar.

<details>
<summary>Hardware Architecture: Cypress FX2LP GPIF Engine & 24 MSps Nyquist Limits</summary>

#### Cypress FX2LP (CY7C68013A) Streaming Architecture
Low-cost $8 USB logic analyzers utilize the Cypress FX2LP microcontroller running custom open-source Sigrok firmware:
- **General Programmable Interface (GPIF)**: Bypasses the 8051 CPU core entirely. It latches Port B/D pins directly into internal FIFO buffers at 24 MHz driven by a 48 MHz crystal oscillator.
- **USB 2.0 High-Speed Bulk Streaming**: Pours uncompressed 8-bit samples across USB Bulk Endpoint 2 (512-byte packets) at up to **192 Mbps** ($24 \text{ MSps} \times 8 \text{ bits}$).
- **Host-Side Buffer**: Skon's USB Tool reads the bulk byte stream over WebUSB into the packed sample buffer, which is then drawn on the waveform canvas.

#### Nyquist-Shannon Sampling Constraints
To faithfully reconstruct digital square pulses without aliasing:
$$\text{Sample Rate} \ge 4 \times f_{\text{signal}}$$
- **115,200 baud UART**: Bit duration is $8.68\,\mu\text{s}$. At 2 MSps, each bit has 17 samples, providing excellent timing margin.
- **400 kHz Fast-Mode I2C**: Clock half-period is $1.25\,\mu\text{s}$. Requires at least 8 MSps (10 samples per half-period) to verify clock stretching and setup/hold times.
- **SPI at 4 MHz**: Requires the maximum 24 MSps rate (6 samples per clock cycle).

</details>

<details>
<summary>Sigrok / PulseView VCD File Format Specification</summary>

When clicking **VCD**, the analyzer generates standard IEEE 1364 **Value Change Dump** files compatible with Sigrok, PulseView, and GTKWave:

\`\`\`text
$date 2026-10-24T00:00:00.000Z $end
$version Skon's USB Tool logic analyzer $end
$comment samplerate 24000000 $end
$timescale 1 ns $end
$scope module logic $end
$var wire 1 ! D0 $end
$var wire 1 " D1 $end
$var wire 1 # D2 $end
$var wire 1 $ D3 $end
...(eight signals, D0 to D7)
$upscope $end
$enddefinitions $end
#0
0!
0"
1#
1$
#42
1!
#83
0!
\`\`\`
Every value change records a timestamp (\`#41\`, in the file's timescale unit) followed by the logic state and channel token (\`1!\`), minimizing file sizes compared to raw CSV dumps. Signals are named after the channel names (default \`D0\`..\`D7\`). The \`.sr\` export is a PulseView/sigrok session file for the same data, and both formats can be re-opened with **OPEN .VCD / .SR**.

</details>

---

### 3. Complete UI Control Mapping

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **CONNECT SUMP (SERIAL)** | Button | Opens a SUMP device over Web Serial (115200 baud), checks its \`1ALS\` ID and reads its metadata. |
| **CONNECT FX2 (USB)** | Button | Opens an FX2 board over WebUSB (fx2lafw \`1D50:608C\`, Saleae-clone / USBee IDs or a blank Cypress FX2). A board without fx2lafw shows **LOAD FIRMWARE FILE** (\`.fw\`, \`.bin\`, \`.hex\`, \`.ihx\`), uploads it to RAM, and re-enumerates; on Windows it needs the WinUSB driver (Zadig). Needs Chrome or Edge. |
| **DISCONNECT** | Button | Closes the connected device. |
| **OPEN .VCD / .SR** | Button | Loads a VCD or PulseView \`.sr\` file into the buffer for decoding. |
| **CAPTURE SIGNAL** | Button | Acquires one buffer from the connected device (shows progress for FX2). Disabled without a device. |
| **RATE** | Dropdown | 20 kHz up to 24 MHz (the device may use a nearby achievable rate, shown as "capture is ..."). |
| **SAMPLES** | Dropdown | 1,024 up to 1M samples. For a SUMP device the list only offers depths up to the sample memory the device reports; a larger request is refused instead of returning a short or wrapped buffer. |
| **HW TRIGGER MASK / VALUE** | Hex inputs | SUMP only, level trigger: channels in the mask must match the value to start capture; mask \`00\` starts immediately. |
| **EDGE** | Dropdown | SUMP only: **none**, **rising** or **falling** on the masked channel. SUMP has no native edge trigger, so it is programmed as two trigger stages (old level, then new level); the device must support multi-stage triggers. |
| **PRE-TRIGGER** | Slider | SUMP only, 0–90 %: how much of the buffer is kept from before the trigger. The trigger point is drawn as a red dashed marker and cursor A is placed on it. |
| **16-bit wide mode** | Checkbox | FX2 (fx2lafw) only: captures 16 channels instead of 8. fx2lafw cannot report how many inputs a board has, so only tick it on 16-channel boards; on an 8-input board the upper channels are meaningless. |
| **Zoom out / Zoom in / Fit whole capture** | Buttons | Zoom the waveform; also mouse wheel pans and Ctrl+wheel zooms. |
| **Waveform canvas** | Viewport | Timing diagram with one row per channel: the channel count comes from the device (SUMP metadata reports up to 32 channels; FX2 gives 8, or 16 in wide mode), labelled **CHANNELS (D0 - Dn)**. Click sets cursor A, Shift-click cursor B; ΔT and 1/ΔT are shown. **TIMELINE PAN** slider scrolls. |
| **FIND** | Dropdown + PREV / NEXT | Searches from cursor A for a rising edge, falling edge, any edge, glitch (short pulse) or pattern (mask/value) on a channel. |
| **VCD / PULSEVIEW .SR** | Buttons | Export the capture as a Value Change Dump or a PulseView/sigrok session file. |
| **Protocol Decoder buttons** | Buttons | Pick I2C, UART, SPI, 1-Wire, CAN, WS2812, IR or SWD; role dropdowns map decoder signals to D0-D7 and parameter fields (baud, parity, SPI mode...) appear. |
| **AUTO-BAUD** | Button | UART only: estimates the baud rate from the shortest pulses. |
| **STACK** | Dropdown | Adds a second decoder on top of the protocol decoder's output, drawn in its own annotation lane and listed in the table: **SPI flash commands** (names JEDEC commands and identifies the chip from a JEDEC ID read, e.g. Winbond W25Q128), **EEPROM / register names** for I2C (with an address-bytes field), **NMEA 0183 (GPS)** for UART (with checksum check) and **UDS / OBD / J1939 names** for CAN. Commands cut off by the end of the capture are marked "cut short". |
| **CSV** | Button | Exports the decoded items. |
| **OPEN SESSION / SAVE SESSION** | Buttons | Save the capture, channel names, decoder and stack settings to a JSON session file and open it again later (wide captures included). |
| **Channel Measurements** | Table | Per channel name (editable), edges, frequency, duty and min/max pulse. |

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Decoding an I2C Sensor Bus
1. Connect **GND** to target board ground. Connect **D0** to SCL (Clock) and **D1** to SDA (Data).
2. Click **CONNECT SUMP (SERIAL)** or **CONNECT FX2 (USB)** and pick your device.
3. Set **RATE** to **8 MHz** and **SAMPLES** to a depth your device supports (e.g. **100k Samples**).
4. For a SUMP device, optionally set **HW TRIGGER MASK** / **VALUE** (hex, e.g. mask \`02\` value \`00\` to start when D1 is low). Mask \`00\` starts at once. FX2 captures start immediately.
5. Click **CAPTURE SIGNAL**.
6. In the **Protocol Decoder** bar choose **I2C** and make sure **SCL** is D0 and **SDA** is D1.
7. The canvas shows START/STOP flags, address badges (e.g. \`W 0x68 ACK\`), data bytes and NACKs, and a transaction summary lists each READ/WRITE with its bytes. Click a row in the table to jump to it.
8. Use **FIND** (rising edge, falling edge, any edge, glitch or pattern) with **PREV** / **NEXT** to hunt for events, and click the canvas for cursor A or Shift-click for cursor B to read ΔT and 1/ΔT.

---

### 5. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **\`USB transfer\` error / gaps in the capture** | Host computer USB bus cannot sustain the bulk transfer at 12 MS/s and above. | Lower sample rate to 8 MHz or less, or unplug other high-bandwidth USB devices. |
| **Access denied / cannot claim interface (Windows)** | The FX2 board is not using the WinUSB driver. | Install WinUSB for the board with Zadig. |
| **Device answered "...", not the SUMP ID "1ALS"** | The selected serial port is not a SUMP analyzer. | Pick the right port, or use **CONNECT FX2 (USB)** for FX2 boards. |
| **Signals Always Read High (3.3V / 5V)** | Ground reference is not connected between analyzer and target. | Connect the black GND pin directly to the microcontroller or sensor ground plane. |
| **Nothing decoded on these channels** | Wrong channel mapping or options in the Protocol Decoder bar. | Choose the right channel per role (SCL/SDA, RX, CLK/MOSI...) and check the parameters. |
| **Decoded UART Characters are Gibberish / "Sample rate too low"** | Sample rate is too low or baud rate parameter in decoder is incorrect. | Use at least 4x the baud rate as sample rate (the decoder refuses below 2 samples per bit), or press **AUTO-BAUD**. |

---

### Implementation & Architecture

> **Capture hardware.** SUMP devices over Web Serial (115200 baud): the tool reads the
> device metadata (channel count, sample memory), enables only the channel groups the device
> has, programs the divider, sample count, pre-trigger and trigger stages, then reads the
> buffer (newest sample first, reversed for display). FX2 boards over WebUSB with
> fx2lafw: samples stream from bulk endpoint 2 at up to 24 MS/s (USB gaps are
> possible above ~12 MS/s), 8 channels or 16 in wide mode. There is no demo / simulated capture mode in the tool; without hardware you can open a \`.vcd\` or PulseView \`.sr\` file instead.

- **Component:** [\`src/components/tools/LogicAnalyzerWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/LogicAnalyzerWorkbench.jsx) holds the sample rate (up to 24 MHz), the named channels (renameable in the Channel Measurements table), and a **packed digital sample buffer** with one bit per channel: a \`Uint8Array\` for up to 8 channels, \`Uint16Array\` for 16 and \`Uint32Array\` for up to 32.
- **Stacked decoders:** [\`src/utils/logicStacks.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/logicStacks.js) runs the second-level decoders (SPI flash, I2C EEPROM, UART NMEA, CAN UDS/OBD/J1939) on the protocol decoder's items; each entry in \`DECODERS\` declares which stacks it supports.
- **Decoders:** [\`src/utils/logicDecoders.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/logicDecoders.js) holds the edge-walking decoders (I2C, UART, SPI, 1-Wire, CAN, WS2812, IR NEC / RC-5, SWD), the trigger/pattern search, per-channel measurements and the VCD / \`.sr\` import and export. Decoded items are drawn as annotations under the waveforms and listed in a table (click a row to jump to it).
- **Capture:** [\`src/utils/logicAnalyzerDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/logicAnalyzerDriver.js) provides \`SumpAnalyzer\` (serial) and \`Fx2LogicAnalyzer\` (WebUSB, including firmware upload through the FX2's 0xA0 vendor request). Both fill the packed buffer; imported files fill it too.

---

### 6. Upstream Project & Engineering Attribution

| Project / Component | Author(s) / Organization | Repository & Reference | License |
| :--- | :--- | :--- | :--- |
| **The sigrok Project (libsigrok, PulseView)** | Uwe Hermann, Bert Vermeulen, and sigrok contributors | [sigrok.org](https://sigrok.org) | GPL-3.0 |
| **fx2lafw Open-Source Logic Analyzer Firmware** | The sigrok Project (Cypress FX2LP GPIF streaming engine) | [sigrok.org/wiki/Fx2lafw](https://sigrok.org/wiki/Fx2lafw) | GPL-2.0 |
| **Value Change Dump (VCD) Standard** | IEEE 1364-1995 / IEEE 1800 SystemVerilog specification | [IEEE Verilog Spec](https://standards.ieee.org) | Open IEEE Standard |
| **EZ-USB FX2LP Microcontroller Silicon** | Cypress Semiconductor / Infineon Technologies | [CY7C68013A Datasheet](https://www.infineon.com) | Hardware Silicon |
`
  },
  {
    id: 'can-bus',
    toolId: 'can-bus',
    category: 'analysis',
    title: 'CAN Bus & OBD-II Scanner — Automotive Diagnostics & Reverse Engineering',
    summary: 'SLCAN packet monitor for classic CAN and CAN FD (11-/29-bit IDs, RTR, hardware timestamps, listen-only, bit-rate auto-detect), OBD-II PIDs and DTCs, UDS diagnostics with confirmation-gated services, J1939 decoding, and candump record/replay.',
    tags: ['CAN Bus', 'CAN FD', 'OBD-II', 'UDS', 'J1939', 'Automotive', 'SLCAN', 'Vehicle Diagnostics', 'ECU', 'DTC', 'PID'],
    readTime: '24 min read',
    content: `
# CAN Bus & OBD-II Scanner — Automotive Workbench

The **CAN Bus & OBD-II Scanner** interfaces with CAN-to-USB adapters running SLCAN firmware (such as Lawicel SLCAN adapters or CANable / Candlelight) over Web Serial to sniff automotive networks, reverse engineer CAN IDs, query vehicle engine telemetries and talk UDS to an ECU.

---

### 1. What Is This Tool & Why Do You Need It?

Modern passenger vehicles contain between 30 and 100 electronic control units (ECUs) controlling the engine, transmission, anti-lock brakes (ABS), airbags, power steering, and infotainment. These computers communicate over a robust differential two-wire network called **CAN (Controller Area Network)**.

The **CAN Bus & OBD-II Scanner** allows you to:
- Connect directly to a vehicle's standard 16-pin OBD-II diagnostic port under the dashboard.
- Sniff raw packet traffic on high-speed powertrain and comfort CAN buses.
- Reverse engineer proprietary vehicle controls (steering wheel buttons, door locks, accelerator position).
- Send standard SAE J1979 OBD-II diagnostic requests to read live engine metrics (RPM, speed, coolant temp) and clear **Check Engine** trouble codes.

---

### 2. The Physical Layer & Termination Resistors

CAN communicates over a twisted pair of copper wires:
- **CAN_H (CAN High)**: Driven up to ~3.5V during dominant bits (\`0\`); relaxes to 2.5V during recessive bits (\`1\`).
- **CAN_L (CAN Low)**: Driven down to ~1.5V during dominant bits (\`0\`); relaxes to 2.5V during recessive bits (\`1\`).
- **Differential Voltage**: The receiver subtracts CAN_L from CAN_H:
  - Recessive (\`1\`): \`Vdiff = 2.5V - 2.5V = 0.0V\`.
  - Dominant (\`0\`): \`Vdiff = 3.5V - 1.5V = 2.0V\`.
  - This differential noise immunity is what allows CAN to operate in electrically noisy engine bays.

<details>
<summary>CAN 2.0A & 2.0B Frame Bitfield Specification (SOF, Arbitration, Control, CRC, ACK)</summary>

Every physical CAN frame transmitted across the wire contains strict synchronization and error checking fields:

#### Standard 11-Bit Frame (CAN 2.0A)
\`\`\`
+-----+----------------+-----+-----+----+---------+-------------+--------+-----+-----+------+
| SOF | Identifier(11) | RTR | IDE | r0 | DLC (4) | Data (0-8B) | CRC(15)| CDel| ACK | EOF  |
+-----+----------------+-----+-----+----+---------+-------------+--------+-----+-----+------+
\`\`\`

1. **SOF (Start of Frame)**: 1 dominant bit (\`0\`) that synchronizes all node oscillator PLLs.
2. **Arbitration Field**:
   - **Identifier (11 bits)**: Sets packet priority. Lower numerical values have higher priority! Because \`0\` is dominant, a transmitter outputting a \`0\` will override a transmitter outputting a \`1\` during simultaneous transmission (lossless non-destructive bitwise arbitration).
   - **RTR (Remote Transmission Request)**: \`0\` for data frames, \`1\` to request data from another ECU.
3. **Control Field**:
   - **IDE (Identifier Extension Bit)**: \`0\` specifies standard 11-bit ID; \`1\` specifies extended 29-bit ID (CAN 2.0B).
   - **r0 (Reserved Bit)**: Transmitted as dominant \`0\`.
   - **DLC (Data Length Code, 4 bits)**: Binary count of payload bytes ($0$ to $8$).
4. **Data Field**: 0 to 8 bytes of application payload.
5. **CRC Field**: 15-bit CRC calculation followed by a 1-bit recessive CRC Delimiter.
6. **ACK Field**:
   - **ACK Slot**: The transmitter outputs a recessive \`1\`. Any ECU on the bus that received the frame without a CRC error pulls this line down to dominant \`0\` to acknowledge!
   - **ACK Delimiter**: 1 recessive bit.
7. **EOF (End of Frame)**: 7 consecutive recessive bits (\`1111111\`).
8. **Bit Stuffing Rule**: To guarantee edge transitions for clock recovery, the hardware CAN controller automatically inserts 1 stuffed bit of opposite polarity after every 5 consecutive identical bits.

</details>

<details>
<summary>Complete SLCAN ASCII Command Protocol Reference</summary>

The Lawicel SLCAN protocol is the universal ASCII standard for serial CAN adapters:

| Command | Syntax | Meaning & Example |
| :--- | :--- | :--- |
| **Open Bus** | \`O\\r\` | Puts CAN controller in active operational mode. |
| **Close Bus** | \`C\\r\` | Puts CAN controller in standby/sleep mode. |
| **Set Baud** | \`S<0-8>\\r\` | \`S4\`=125k, \`S5\`=250k, \`S6\`=500k (Standard Car), \`S8\`=1000k. |
| **Tx Standard** | \`t<id><len><data>\\r\` | \`t123411223344\\r\` transmits 11-bit ID 0x123 with 4 bytes. |
| **Tx Extended** | \`T<id><len><data>\\r\` | \`T0000123481122334455667788\\r\` transmits 29-bit extended ID. |
| **Rx Frame** | \`t<id><len><data>\\r\` | Incoming frames formatted identically for client parsing. |
| **Read Flags** | \`F\\r\` | Returns error status flags (bit 0=RX FIFO full, bit 2=Error passive, bit 7=Bus-off). |
| **Version** | \`V\\r\` | Queries hardware and firmware build version. |

</details>

<details>
<summary>Standard SAE J1979 OBD-II Diagnostic PIDs Master Table</summary>

When communicating with vehicles on Mode 01 (Live Current Data), broadcast requests are addressed to ECU \`0x7DF\`. The engine computer answers from \`0x7E8\`:

| PID (Hex) | Parameter Name | Formula / Scaling | Units | Typical Normal Range |
| :--- | :--- | :--- | :--- | :--- |
| **\`0x04\`** | Calculated Engine Load | \`A * 100 / 255\` | % | 15% - 35% (Idle) |
| **\`0x05\`** | Engine Coolant Temp | \`A - 40\` | °C | 85°C - 105°C |
| **\`0x0C\`** | Engine RPM | \`((A * 256) + B) / 4\` | RPM | 650 - 850 (Idle) |
| **\`0x0D\`** | Vehicle Speed | \`A\` | km/h | 0 - 250 km/h |
| **\`0x0F\`** | Intake Air Temp (IAT) | \`A - 40\` | °C | Ambient + 5°C to 15°C |
| **\`0x11\`** | Absolute Throttle Position | \`A * 100 / 255\` | % | 10% - 15% (Closed) |
| **\`0x1F\`** | Run Time Since Engine Start | \`(A * 256) + B\` | Seconds | 0 - 65,535 s |
| **\`0x2F\`** | Fuel Tank Level Input | \`A * 100 / 255\` | % | 0% - 100% |
| **\`0x33\`** | Absolute Barometric Pressure | \`A\` | kPa | 90 - 105 kPa |
| **\`0x42\`** | Control Module Voltage | \`((A * 256) + B) / 1000\`| Volts | 13.8V - 14.6V (Alternator running) |

</details>

---

### 3. Complete UI Control Mapping

The CAN workbench rides on the app's **shared serial connection**: connect your
SLCAN adapter once from the top bar (**Connect**), then this deck frames and
transmits SLCAN ASCII over that port. All data is live; there is no simulation or demo mode.

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **(Top-bar Connect)** | Button | Attaches the SLCAN adapter via the shared Web Serial transport; the deck reads/writes through it. |
| **CAN Bus Sniffer / OBD-II Scanner & Gauges / UDS Diagnostics / J1939 / Record & Replay** | Mode buttons | Switch between the five views. |
| **CAN BAUD** | Dropdown | 100 kbps, 125 kbps (low-speed / body), 250 kbps, 500 kbps (standard automotive high-speed, default) or 1000 kbps. |
| **AUTO-DETECT** | Button | Tries each bit rate in listen-only mode and keeps the first one that receives valid frames without errors. |
| **Adapter** | Dropdown | **SLCAN (Lawicel / CANable 1.x)** or **CANable 2.0 (FD firmware)**. The two firmwares speak different dialects, so the options below change with it. |
| **listen-only** | Checkbox | The adapter receives but never transmits or ACKs, so it cannot disturb the bus. Lawicel adapters open with \`L\`; CANable 2.0 uses silent mode (\`M1\`, then \`O\`). AUTO-DETECT uses the same silent open. |
| **FD data rate** | Dropdown | CANable 2.0 only: **Classic CAN**, or a CAN FD data-phase rate. The canable2 firmware accepts only the \`Y2\` (2 Mbps) and \`Y5\` (5 Mbps) presets. |
| **HW timestamps** | Checkbox | Lawicel adapters only: asks the adapter to append its own receive timestamp to each frame (\`Z1\`); the sniffer shows it in the **HW time** column, unwrapped across the 60 s rollover. CANable 2.0 firmware does not send timestamps, so the option is hidden for it. |
| **START SNIFFER / PAUSE** | Button | Opens the SLCAN channel (\`C\`, \`S<n>\`, optional \`Y<n>\` / \`Z1\`, then \`O\` or \`L\`) and starts listening; PAUSE sends \`C\` to close it. |
| **Clear captured packets** | Icon button | Empties the sniffer table. |
| **LOAD DBC** | Button | Loads a \`.dbc\` file so known frames show their name and decoded signals (**×** unloads it). |
| **IDs: 1DC, 200-2FF, !7DF** | Input | Comma-separated IDs or ranges to show; prefix \`!\` to hide. |
| **changing only** | Checkbox | Hides frames whose data has not changed. |
| **CAN Sniffer Table** | Table | CAN ID (hex), Type (STD 11b / EXT 29b, plus an **FD** or **RTR** tag), DLC, data bytes (changed bytes highlighted), Delta (ms), **HW time** and Count. Malformed adapter lines are dropped instead of showing invented bytes. |
| **TRANSMIT CAN FRAME** | Inputs + Button | Hex ID, **29-bit**, **RTR**, **FD** and **BRS** checkboxes, data bytes and **SEND FRAME**; **PERIODIC** repeats it every N ms. A payload the frame type cannot carry (more than 8 bytes on classic CAN, or an FD length that is not a valid DLC size up to 64) is rejected before sending. |
| **START LIVE GAUGES (MODE 01)** | Button | Polls Mode 01 PIDs for RPM, speed, coolant, load, throttle and module voltage. |
| **READ VIN (09)** / **SCAN SUPPORTED PIDS** | Buttons | Read the VIN and list the PIDs the vehicle answers. |
| **READ CODES (03)** | Button | Sends a live Mode 03 request and lists stored DTCs with descriptions where known. |
| **CLEAR CODES (04)** | Button | Appears when codes are listed; asks for confirmation, then sends Mode 04 (clears codes and freeze-frame data). |
| **UDS Diagnostics** | Panel | REQUEST ID / RESPONSE ID, **29-bit IDs**, **TesterPresent keep-alive**, DEFAULT / EXTENDED SESSION, READ IDENTIFICATION, READ DTCs (19 02), CLEAR DTCs (14), ECU RESET (11 01), READ DID and a RAW REQUEST box. Negative responses are shown with their NRC name (e.g. \`0x31 requestOutOfRange\`). |
| **SERVICES THAT ACT ON THE ECU** | Panel | **ROUTINE (31)** start / stop / results, **WRITE DID (2E)**, **SECURITY ACCESS (27)** with **REQUEST SEED** and **SEND KEY**, **READ MEMORY (23)**, **COMM CONTROL (28)** **ENABLE (00)** / **DISABLE (03)** and **DTC SETTING (85)**. Every service that changes the ECU asks for confirmation first. The key for Security Access is one you supply (from the vehicle documentation); the tool only performs the standard seed/key exchange and never computes or guesses a key. |
| **J1939** | Tab | Decodes 29-bit J1939 IDs into priority, PGN, source and destination, names ~56 common PGNs and decodes signals for the common ones (engine speed from EEC1, vehicle speed from CCVS, DM1/DM2 diagnostic messages, Address Claimed, VIN). Values the sender marks "not available" or "error" are shown as text, not numbers. **REQUEST PGN** sends a PGN request to a destination address from a chosen source address. Multi-packet transport (BAM / RTS-CTS) is not reassembled. |
| **START RECORDING / STOP** | Button | Records frames; export as **CANDUMP .LOG** or **CSV**, or open a candump log with **OPEN CANDUMP LOG**. The candump format carries the RTR marker; FD flags are kept in recorded sessions but not in candump files. |
| **REPLAY ONTO BUS** | Button | Replays recorded frames with original timing (**REPLAY SPEED** 0.25x to 10x, optional **loop**), keeping RTR, FD and BRS flags; **VIEW IN SNIFFER TABLE** shows a loaded log. |

---

### 3b. Implementation & Architecture

- **Component:** [\`src/components/tools/CanBusWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/CanBusWorkbench.jsx) uses \`useSerial()\` for \`isConnected\`/\`sendString\`, keeps a \`messages\` map keyed by CAN ID (for the de-duplicated sniffer table with delta/count and per-byte change highlighting), and five modes: \`sniffer\`, \`obd2\`, \`uds\`, \`j1939\` and \`log\`.
- **Framing:** \`buildSlcanFrame\` and \`parseSlcanFrame\` in [\`src/utils/canBusDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/canBusDriver.js) handle the Lawicel ASCII forms: \`t\` / \`T\` (data, 11-/29-bit), \`r\` / \`R\` (remote / RTR), and the CAN FD letters \`d\` / \`D\` (FD) and \`b\` / \`B\` (FD with bit-rate switch), with an optional trailing 4-hex-digit timestamp. The parser validates every character and the DLC and returns nothing for a malformed line. \`buildSlcanOpenSequence\` produces the open sequence (\`C\`, \`S<n>\`, optional \`Y<n>\` and \`Z1\`, then \`O\` or \`L\`).
- **Diagnostics and tools:** \`src/utils/canTools.js\` provides the DBC parser, ID filter, candump/CSV logging, replay, the ISO-TP channel, the UDS client (including the confirmation-gated services above) and the J1939 decoder (\`decodeJ1939Id\`, \`decodeJ1939Frame\`, the PGN table). All traffic is real: there is no simulation mode, so a connected adapter and bus are required.
- **Adapter dialects:** checked against the canable2-fw source (\`src/slcan.c\`): CANable 2.0 accepts FD frames (\`d\` / \`D\` / \`b\` / \`B\`), the \`Y2\` / \`Y5\` data-rate presets and \`M1\` silent mode, and rejects \`L\`, \`l\` and \`Z\`. Lawicel-style adapters use \`L\` and \`Z1\` and have no FD. Classic CAN frames work on both.
- **Transport reuse:** because it shares \`SerialContext\`, the CAN deck inherits the same connection, RX loop, and byte-stats as the Terminal and other serial tools rather than opening its own port.

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Reverse Engineering Steering Wheel Controls
1. Connect your CANable (SLCAN firmware) adapter to the vehicle's OBD-II port (Pins 6 and 14), and connect it to the app from the top bar.
2. Open the **CAN Bus Sniffer** mode and set **CAN BAUD** to **500 kbps (Standard Automotive High-Speed)**.
3. Click **START SNIFFER**. Frames begin to fill the table (CAN ID, Type, DLC, Data Bytes, Delta, Count).
4. Keep the vehicle idling and do not touch any controls. Tick **changing only** to hide IDs whose bytes do not change.
5. Repeatedly press the **Volume Up** button on the steering wheel while watching the screen.
6. Bytes that just changed are highlighted in amber in the Data Bytes column, showing the exact CAN ID and byte offset carrying the button press.
7. Record the CAN ID (e.g. \`0x2C4\`) and payload byte pattern. Use the **IDs** filter (e.g. \`2C4\` or \`!7DF\`) to isolate or hide IDs, and optionally **LOAD DBC** to decode known signals.
8. In **Record & Replay**, **START RECORDING** to save a candump log or CSV and later **REPLAY ONTO BUS** (only on buses you own).

---

### 5. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **No frames / nothing after START SNIFFER** | No adapter connected, wrong CAN BAUD, or missing termination. | Connect the SLCAN adapter from the top bar first. Match **CAN BAUD** to the bus (500 kbps for most cars, 250 kbps for heavy trucks) and make sure the bus has two 120 Ω terminators. |
| **No Packets on 2008+ Vehicle OBD-II Port**| Vehicle gateway ECU isolating OBD-II port from powertrain CAN. | Some modern vehicles require an active wakeup frame or direct tapping behind the gateway module. |
| **OBD-II PIDs Return No Response / "--" or "n/a" gauges** | Ignition is off, or the ECU does not support that PID. | Turn ignition to **ON / RUN** position (engine can be off). Use **SCAN SUPPORTED PIDS** to see what the vehicle answers. |
| **UDS requests time out** | Wrong REQUEST ID / RESPONSE ID or the ECU needs a non-default session. | Use the ECU's physical IDs (engine ECU is usually 7E0 / 7E8), tick **29-bit IDs** if needed, and try **EXTENDED SESSION** with **TesterPresent keep-alive**. |

---

### 6. Upstream Standards & Engineering Attribution

| Standard / Protocol | Authoring Organization / Creator | Specification & Reference |
| :--- | :--- | :--- |
| **CAN Specification 2.0A / 2.0B & ISO 11898** | Robert Bosch GmbH & ISO Technical Committee | [Bosch CAN Specification](https://www.bosch-semiconductors.com) |
| **Lawicel SLCAN Serial Protocol** | Lars Wictorsson (Lawicel AB, Sweden) | [CAN232 / Lawicel ASCII Commands](https://www.can232.com) |
| **SAE J1979 / ISO 15031-5 OBD-II Standard** | SAE International (Society of Automotive Engineers) | [SAE J1979 Diagnostic Test Modes](https://www.sae.org) |
`
  },
  {
    id: 'bus-explorer',
    toolId: 'bus-explorer',
    category: 'analysis',
    title: 'I2C & SPI Bus Explorer — 1-Click Chip Identification & Registers',
    summary: 'Hardware bus interrogation, 7-bit I2C address scanner 0x08-0x77, known chip dictionary lookup, SPI mode 0-3 register watch, and memory dump.',
    tags: ['I2C', 'SPI', 'Bus Explorer', 'Chip Identification', 'Sensors', 'Registers', 'EEPROM', 'OLED'],
    readTime: '22 min read',
    content: `
# I2C & SPI Bus Explorer — Hardware Reverse Engineering

The **I2C & SPI Bus Explorer** is an interactive workbench for learning and
reverse-engineering I2C/SPI peripherals — sensors, EEPROMs, displays — through
address scanning, chip identification, and register read/write.

> **Hardware: Bus Pirate v3/v4.** "Connect Bus Pirate" opens it over Web
> Serial (115200 baud), switches it to binary (BBIO) mode and raw I2C, and every
> scan, read and write goes to the real bus. Power, pull-ups and I2C bus speed are
> set from the toolbar once connected; SPI transfers use the Bus Pirate's raw SPI mode. There is
> no demo or simulated bus: the tool needs a Bus Pirate.

---

### 1. I2C Bus Architecture & Protocol Basics

I2C (Inter-Integrated Circuit) is a synchronous, multi-master, multi-slave, packet-switched single-ended serial bus invented by Philips. It uses just two bidirectional lines:
- **SDA (Serial Data)**
- **SCL (Serial Clock)**

#### The Mandatory Pull-Up Resistors
Both SDA and SCL are **open-drain** lines. A connected chip can only pull a line LOW (0V); it can never drive a line HIGH.
- You **MUST** have pull-up resistors (typically **4.7kΩ** for 100kHz standard mode, or **2.2kΩ** for 400kHz fast mode) tied from SDA and SCL to +3.3V.
- Without pull-ups, the lines float near 0V and the bus locks permanently in a NACK state.

<details>
<summary>Complete 7-Bit I2C Address Register Map & Silicon Identifiers</summary>

When performing a bus sweep, cross-reference responding addresses against this silicon dictionary:

| Address Range | Common Silicon Identified | Description & Default WHO_AM_I Registers |
| :--- | :--- | :--- |
| **\`0x00\` - \`0x07\`** | **Reserved** | General Call (\`0x00\`), START byte (\`0x01\`), CBUS, High-speed master codes. |
| **\`0x18\` - \`0x1E\`** | LIS3DH / HMC5883L | 3-axis accelerometer (\`0x18\`/\`0x19\`) or 3-axis compass (\`0x1E\`). |
| **\`0x20\` - \`0x27\`** | PCF8574 / MCP23008 | 8-bit GPIO port expanders (often found driving 1602 LCD backboards). |
| **\`0x38\` - \`0x39\`** | AHT10 / AHT20 | High-precision digital temperature and humidity sensor. |
| **\`0x3C\` / \`0x3D\`** | SSD1306 / SH1106 | 128x64 or 128x32 Monochrome OLED Display controller. |
| **\`0x40\` - \`0x45\`** | INA219 / INA226 | High-side DC current and power sensor shunt monitor. |
| **\`0x48\` - \`0x4B\`** | ADS1115 / TMP102 | 16-Bit High Precision 4-Channel ADC or digital temperature sensor. |
| **\`0x50\` - \`0x57\`** | 24C02 - 24C512 | I2C Serial EEPROMs (Address set by A0, A1, A2 strapping pins). |
| **\`0x5C\`** | DHT12 / AM2320 | Digital temperature and humidity sensor. |
| **\`0x68\`** | MPU-6050 / DS3231 | 6-Axis Gyro/Accelerometer (\`WHO_AM_I\` reg \`0x75\` = \`0x68\`) or Precision RTC. |
| **\`0x76\` / \`0x77\`** | Bosch BMP280 / BME280 | Barometric pressure & humidity sensor (\`ID\` reg \`0xD0\` = \`0x58\` or \`0x60\`). |
| **\`0x78\` - \`0x7F\`** | **Reserved** | 10-bit slave addressing prefix bytes. |

</details>

<details>
<summary>SPI Protocol Timing & Mode Selection (Modes 0 to 3)</summary>

Serial Peripheral Interface (SPI) is a 4-wire full-duplex synchronous bus. Communication requires setting the matching **CPOL (Clock Polarity)** and **CPHA (Clock Phase)** mode. (The Bus Explorer's SPI transfer and flash dump use mode 0 only.)

| SPI Mode | CPOL (Idle State) | CPHA (Sample Edge) | Description & Typical Silicon |
| :--- | :--- | :--- | :--- |
| **Mode 0** | \`0\` (Idle Low) | \`0\` (Leading / Rising) | Standard for SD cards, Winbond NOR flash, ST7789 displays. |
| **Mode 1** | \`0\` (Idle Low) | \`1\` (Trailing / Falling) | Used by specialized ADCs and motor drivers. |
| **Mode 2** | \`1\` (Idle High) | \`0\` (Leading / Falling) | Inverted clock baseline. |
| **Mode 3** | \`1\` (Idle High) | \`1\` (Trailing / Rising) | Alternative mode supported by most SPI NOR flash memories. |

#### SPI Flash Memory Basic Opcode Commands
- **\`0x9F\`**: Read JEDEC Identification (Returns Manufacturer ID, Memory Type, Capacity).
- **\`0x06\`**: Write Enable (WREN - Must precede every write/erase operation).
- **\`0x05\`**: Read Status Register 1 (Bit 0 = \`WIP\` Write-In-Progress).
- **\`0x03\`**: Read Data Bytes at 24-bit address.
- **\`0x02\`**: Page Program (Writes up to 256 bytes to flash).

</details>

---

### 2. Complete UI Control Mapping

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **CONNECT BUS PIRATE (SERIAL)** | Button | Opens a Bus Pirate v3/v4 over Web Serial (115200 baud), enters binary mode and raw I2C. |
| **SCAN I2C BUS (7-BIT SWEEP)** | Button | Sends START + address for every address \`0x08\`–\`0x77\` and lists those that ACK. |
| **3.3V/5V power, pull-ups, speed** | Checkboxes + Dropdown | Shown once connected: switch the Bus Pirate's supply and pull-ups, and set the I2C speed (5 / 50 / 100 / 400 kHz). |
| **Address Grid** | Hex Matrix | Responding addresses with chip-identification badges from the built-in dictionary; click one to select it. |
| **Chip Intelligence** | Panel | Device name, category and description of the selected address. |
| **Quick Register Write (Hex)** | Inputs + **WRITE** | Writes one byte to a register, then reads the dump again. |
| **Register Dump (32 from start)** | Input + **READ REGISTERS** | Reads 32 registers from the start register you enter (write pointer, repeated START, read). |
| **SPI Transfer** | Input + **TRANSFER** | Sends hex bytes with CS held low (SPI mode 0) and shows the bytes clocked back as MISO (\`9F 00 00 00\` reads a flash JEDEC ID). |
| **Sensor Readout** | Panel | **IDENTIFY** matches the selected address to a built-in driver (BME280/BMP280, MPU-6050 family, DS3231, ADS1115, INA219, SSD1306); **READ** and **LIVE (1 s)** show values, and SSD1306 OLEDs get **CHECKER / FULL / CLEAR** test patterns. |
| **SPI Flash Dump** | Panel | **READ JEDEC ID** identifies the chip, then **DUMP** reads the entered number of bytes and **SAVE .BIN** downloads them. |
| **DISCONNECT** | Button | Turns the supplies off and returns the Bus Pirate to its text console. |

---

### 2b. Implementation & Architecture

- **Component:** [\`src/components/tools/BusExplorerWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/BusExplorerWorkbench.jsx) renders the header, scan bar, address grid, and register panel, and holds \`isConnected\`, \`detectedDevices\`, and scan state.
- **Driver:** [\`src/utils/busExplorerDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/busExplorerDriver.js) drives a real Bus Pirate through its binary protocol (\`BusPirate\` class: BBIO entry, I2C START/STOP/bulk write/read with ACK checking, SPI transfers). \`scanI2cBus()\` walks \`0x08\`–\`0x77\` and reports which addresses ACK; \`readRegisters(start, count)\` / \`writeRegister(reg, val)\` operate on the device at \`activeAddress\` (set from the address you select); \`spiTransfer()\` / \`spiFlashId()\` cover SPI. A device must be connected — there is no simulated bus.
- **Errors:** a missing ACK is reported as an error ("No ACK from 0x50") rather than read as zeros.

---

### 3. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Interrogating an Unknown I2C Sensor
1. Connect SDA, SCL, 3.3V, and GND from your Bus Pirate to the sensor breakout.
2. Ensure pull-up resistors are installed (or enable the Bus Pirate's **pull-ups** checkbox once connected).
3. In Skon's USB Tool, click **CONNECT BUS PIRATE (SERIAL)** and pick its port; tick **3.3V/5V power** and **pull-ups** if the breakout needs them, and pick the I2C speed.
4. Click **SCAN I2C BUS (7-BIT SWEEP)**.
5. Address \`0x68\` responds with an ACK and turns green. Click it: **Chip Intelligence** shows the dictionary match, *MPU-6050 / DS3231* (6-DoF IMU / precision RTC).
6. In the **Register Dump** panel set the start register to \`0x75\` and click **READ REGISTERS**. The first cell (\`R_0x75\`) is the WHO_AM_I register.
7. The sensor returns \`0x68\`. This confirms beyond doubt that the chip is an **InvenSense MPU-6050**! (**IDENTIFY** in the Sensor Readout panel can also match a built-in driver.)
8. In **Quick Register Write**, enter register \`0x6B\` (Power Management 1) and value \`0x00\`, then click **WRITE** to wake the accelerometer from sleep mode. The dump refreshes afterwards.

---

### 4. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **All Addresses Report ACK (Ghost Devices)** | SDA or SCL line shorted to GND or missing pull-up resistors. | Inspect wiring with a multimeter. Verify both lines sit at 3.3V when idle. |
| **No Addresses Respond to Scan** | Inverted SDA/SCL lines or chip powered by wrong voltage rail. | Swap SDA and SCL connections. Check VCC voltage with a voltmeter. |
| **Bus Hangs After Register Read** | Slave device performing clock stretching or master failed to issue STOP. | Send 9 manual clock pulses on SCL to clear slave shift register, then issue a clean STOP condition. |

---

### 5. Upstream Standards & Engineering Attribution

| Bus Architecture | Originator / Creator | Specification & Reference |
| :--- | :--- | :--- |
| **I2C (Inter-Integrated Circuit) Bus Specification** | Philips Semiconductors (now NXP Semiconductors) | [NXP UM10204 I2C Manual](https://www.nxp.com) |
| **SPI (Serial Peripheral Interface) Bus** | Motorola Semiconductor Products Sector (now NXP / Freescale) | [Motorola SPI Block Guide](https://www.nxp.com) |
| **i2c-tools / Bus Pirate Interrogation Architecture** | Linux i2c-tools maintainers & Dangerous Prototypes | [kernel.org i2c-tools](https://git.kernel.org/pub/scm/utils/i2c-tools/i2c-tools.git) |
`
  },
  {
    id: 'modbus-rtu',
    toolId: 'modbus-rtu',
    category: 'analysis',
    title: 'Modbus RTU & RS-485 — Industrial Telemetry & Holding Registers',
    summary: 'Master industrial RS-485 differential signaling, Modbus RTU framing, CRC-16 calculation, slave-ID scan, function codes 01-17 and 43/14, typed values and word-order conversions.',
    tags: ['Modbus', 'RS-485', 'Industrial', 'Holding Registers', 'PLC', 'CRC-16', 'Inverter', 'Telemetry'],
    readTime: '22 min read',
    content: `
# Modbus RTU & RS-485 — Industrial Diagnostics

The **Modbus RTU** workbench allows you to communicate with Programmable Logic Controllers (PLCs), industrial power meters, solar inverters, environmental sensors, and Variable Frequency Drives (VFDs) communicating over half-duplex RS-485 industrial networks.

---

### 1. What Is Modbus RTU & RS-485?

In factories, oil refineries, and solar farms, electrical noise from high-voltage motors destroys standard UART signals within a few feet. **RS-485** solves this using balanced differential signaling over twisted pair cabling spanning up to **1,200 meters (4,000 feet)**:
- **Line A (D-)**: Inverting pin.
- **Line B (D+)**: Non-inverting pin.
- **Half-Duplex Operation**: Devices share the same wire pair for transmit and receive. A direction control pin (**DE/RE** — Driver Enable / Receiver Enable) switches the transceiver from listening to driving.

**Modbus RTU** is the messaging protocol running on top of RS-485. It uses a Master/Slave (Client/Server) architecture where only the master can initiate requests.

---

### 2. Modbus RTU Packet Anatomy & CRC-16

A Modbus RTU frame has no text delimiters. Instead, message boundaries are delimited by **3.5 character times (t3.5) of silence** on the bus:
\`\`\`
+---------------------+-------------------+------------------+------------------+
| Slave Address (1 B) | Function Code (1B)| Data Payload (NB)| CRC-16 (2 Bytes) |
+---------------------+-------------------+------------------+------------------+
\`\`\`

<details>
<summary>Modbus RTU CRC-16 Calculation Algorithm (JavaScript & C Reference)</summary>

Every Modbus RTU packet must conclude with an inverted polynomial CRC-16-IBM checksum transmitted Little-Endian (Low-Byte First):

\`\`\`javascript
/**
 * Calculates Modbus RTU CRC-16
 * @param {Uint8Array} buffer - Frame bytes excluding last 2 CRC bytes
 * @returns {number} 16-bit CRC integer
 */
function calculateModbusCRC(buffer) {
  let crc = 0xFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = (crc >> 1) ^ 0xA001;
      } else {
        crc = crc >> 1;
      }
    }
  }
  return crc; // Low byte: crc & 0xFF, High byte: (crc >> 8) & 0xFF
}
\`\`\`
If a received response fails this mathematical check, the workbench drops the packet and warns of RS-485 bus noise or loose cabling.

</details>

<details>
<summary>Master Exception Response Codes & Troubleshooting</summary>

When a slave device cannot fulfill a master request, it returns the requested Function Code with the highest bit set (\`FunctionCode | 0x80\`) followed by an **Exception Code**:

| Exception Code | Name | Cause & Recovery Action |
| :--- | :--- | :--- |
| **\`0x01\`** | Illegal Function | The function code received is not supported by the slave (e.g. attempting to write registers on a read-only sensor). |
| **\`0x02\`** | Illegal Data Address | The register address queried does not exist on this device. Double check manual for 0-based vs 1-based indexing! |
| **\`0x03\`** | Illegal Data Value | The quantity of registers requested exceeds maximum (typically max 125 registers), or write data is out of bounds. |
| **\`0x04\`** | Slave Device Failure | An unrecoverable error occurred while the slave was attempting to perform the requested action. |
| **\`0x05\`** | Acknowledge | The slave accepted request but needs significant time to process (used in programming cycles). |
| **\`0x06\`** | Slave Device Busy | The slave is currently executing a long-duration command; retry request later. |
| **\`0x0A\`** | Gateway Path Unavailable | Misconfigured RS-485 to Ethernet gateway bridge. |

</details>

---

### 3. Master Function Code Reference

| Code | Function Name | Typical Real-World Application |
| :--- | :--- | :--- |
| **\`0x01\`** | Read Coils | Reads ON/OFF status of digital output relays (1 bit each) |
| **\`0x02\`** | Read Discrete Inputs | Reads state of optical safety barriers, limit switches |
| **\`0x03\`** | Read Holding Registers | Reads 16-bit configuration words, setpoints, inverter output |
| **\`0x04\`** | Read Input Registers | Reads 16-bit read-only analog sensor values (volts, current) |
| **\`0x05\`** | Write Single Coil | Sets or clears a single output relay bit |
| **\`0x06\`** | Write Single Register | Modifies a single 16-bit configuration parameter |
| **\`0x0F\`** | Write Multiple Coils | Sets or clears a block of output bits in one request |
| **\`0x10\`** | Write Multiple Registers | Block writes multiple 16-bit setpoints simultaneously |
| **\`0x11\`** | Report Server ID | Returns the device's identity string and run indicator |
| **\`0x2B\` / MEI \`0x0E\`** | Read Device Identification | Vendor, product code and revision objects |

---

### 4. Float32 & Word Endianness Conversion

Modbus registers are strictly 16 bits wide. To transmit a 32-bit floating point number (like \`124.50 Volts\` or \`1520.40 kWh\`), the slave splits the 32 bits across two consecutive 16-bit registers (e.g. registers \`40001\` and \`40002\`).

Because the original 1979 Modbus specification didn't define 32-bit float order, manufacturers implemented four conflicting byte orders. The workbench decodes multi-register values for you: in the **Register Map** (and in the write form) pick a type — \`u16\`, \`i16\`, \`u32\`, \`i32\`, \`f32\`, \`f64\` or \`ascii\` — and a word/byte order, with an optional scale and offset. The four orders are:
1. **ABCD (Big-Endian)**: High byte first, high word first (Standard for Schneider Electric).
2. **CDAB (Little-Endian word order)**: Low word first, high word second.
3. **BADC (Byte Swap)**: High word first, but bytes inside each word swapped.
4. **DCBA (fully reversed)**: Low byte first, low word first; seen on some Eastron / Chint energy meters.

If a value looks wrong, try the other orders; the raw hex column always shows the untouched register.

---

### 5. Complete UI Control Mapping

The workbench is **live only**: it talks to real hardware over a USB-to-RS485
adapter through the app's shared serial connection. There is no simulation mode.
After connecting, a banner states the slave and baud being polled.

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **CONNECT SERIAL PORT…** | Button | Shown when no serial port is open. Prompts the browser's port picker to attach your USB-RS485 adapter. |
| **CONNECT LIVE (RS-485)** | Button | Reopens the connected port with the selected baud, parity and stop bits and polls the real slave. Responses are CRC-16, slave-ID and function-code validated and Modbus exceptions are decoded; frames stream into the app's live terminal. |
| **Slave ID:** | Number | Target node address (1 to 247). |
| **Baud:** / **Parity:** / **Stop bits:** | Dropdowns | 1200 to 230400 bps; None / Even / Odd; 1 or 2 stop bits (8 data bits). |
| **Timeout:** / **Retries:** | Numbers | Per-request timeout in ms (default 800) and how many times a failed request is retried (default 0). |
| **Table:** | Dropdown | What to read: Holding registers (FC03), Input registers (FC04), Coils (FC01) or Discrete inputs (FC02). |
| **Start:** / **Qty:** | Numbers | Start address (0-based) and quantity (max 125 registers, 2000 bits). |
| **Interval:** | Number | Auto-poll delay in ms after each reply. |
| **POLL ONCE** | Button | Sends one read of the chosen table and shows the result. |
| **START AUTO-POLL** | Toggle | Repeats the read; reads "AUTO-POLLING (n ms after each reply)" while active. |
| **Result table** | Table | Registers: Address, Register, Label, Type, Raw Hex, UINT16, INT16 and Value. Coils / discrete inputs: Address, Number and ON/OFF state. Unmapped registers show generic "Register N" labels. |
| **Stats line** | Counters | Sent, OK, Timeouts, CRC, Exceptions, ID/FC mismatch and response min/avg/max time, with a **reset** button. |
| **Log polls to CSV / Download CSV / Clear** | Checkbox + buttons | Records every polled value with a timestamp and downloads it as CSV. |
| **REGISTER MAP** | Collapsible panel | Per range: start, type (u16 to f64, ascii), word order (ABCD / CDAB / BADC / DCBA), scale, offset, unit, label. **Load example: solar inverter**, **Clear map**, **Export JSON** and **Import JSON** manage maps. With no map the table is generic. |
| **WRITE (FC05 / FC06 / FC15 / FC16)** | Form | **Function:** single register, multiple registers, single coil or multiple coils; **Address:**; for multiple registers a **Type:** and **Order:** plus **Values**; coils take a state or bits like \`1 0 1\`. The **WRITE** button reports success only when the slave echoes correctly. |
| **Report Server ID (FC17)** / **Read Device ID (FC43/14)** | Buttons | Query the device's identity strings (not every slave supports them). |
| **SCAN SLAVE IDs / STOP SCAN** | Button | Probes a range of IDs (**Scan from:** / **to:**) with a one-register read; a valid exception reply also counts. Found IDs appear as buttons that set **Slave ID:**. Unanswered IDs wait up to 300 ms, so 1-247 can take over a minute. |
| **DISCONNECT** | Button | Stops polling and clears the table. |

---

### 6. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Polling a Real RS-485 Energy Meter / Inverter
1. Wire RS-485 **A (D-)** to the meter's **A/D-** and **B (D+)** to **B/D+**, with a common ground and $120\Omega$ termination at both ends of the run.
2. Click **CONNECT SERIAL PORT…** and pick your USB-RS485 adapter in the browser prompt.
3. Set **Slave ID:** to the meter's address (e.g. \`1\`) and **Baud:** / **Parity:** / **Stop bits:** to match the device (e.g. 9600, None, 1). Not sure of the address? Use **SCAN SLAVE IDs** after connecting and click the ID that answers.
4. Click **CONNECT LIVE (RS-485)**. The port reopens with those settings and a read of the chosen **Table:** / **Start:** / **Qty:** is issued automatically (default: 8 holding registers from address 0).
5. The table fills with CRC-validated values as generic "Register N" rows showing raw hex, UINT16 and INT16. Open the **REGISTER MAP** and give ranges a type (e.g. \`f32\`), word order, scale, unit and label (or **Load example: solar inverter** as a template) to see decoded values. Empty results mean no or invalid response (check A/B polarity, baud, and slave ID); the reason is shown under the table and written to the terminal log, and the stats line counts timeouts, CRC errors and exceptions.
6. Click **START AUTO-POLL** to keep polling (the **Interval:** is the delay after each reply), and tick **Log polls to CSV** to record the values. Use the **WRITE** form (FC05 / FC06 / FC15 / FC16) to set a writable setpoint. The tool reports success only when the slave echoes the write; a timeout, CRC failure, mismatched echo or Modbus exception (named, e.g. \`0x02: Illegal Data Address\`) is shown in red next to the form and logged to the terminal.
---

### 7. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **\`No response (timeout)\`** (in the terminal log) | Inverted A/B differential polarity, wrong baud/slave address, or missing termination. | Swap wires A and B. Verify the slave address and baud configured in the physical meter menu. The tool waits about 800 ms per request. |
| **\`CRC mismatch — frame rejected\`** (in the terminal log) | RS-485 bus reflections or missing $120\Omega$ termination resistors. | Install a $120\Omega$ resistor across lines A and B at both physical ends of the cable run. |
| **32-bit float / uint32 values look like nonsense** | Wrong type or word order in the register map (unmapped registers show as separate 16-bit values). | Map the range as \`u32\` / \`f32\` and try the word orders ABCD, CDAB, BADC, DCBA (see section 4). |

---

### 8. Upstream Standards & Engineering Attribution

| Standard / Organization | Role & Contribution | Reference & License |
| :--- | :--- | :--- |
| **Modbus Organization, Inc.** | Modbus Application Protocol Specification V1.1b3 and Modbus over Serial Line Specification V1.02. | [modbus.org](https://modbus.org) (Royalty-Free Open Standard) |
| **Modicon (Schneider Electric)** | Original creator of the Modbus industrial communication protocol (1979). | [Schneider Electric Industrial Automation](https://www.se.com) |
| **TIA/EIA-485-A (RS-485) Standard** | Telecommunications Industry Association differential balanced multi-point electrical standard. | [TIA Standards](https://global.ihs.com) |
`
  },
  {
    id: 'plotter',
    toolId: 'plotter',
    category: 'analysis',
    title: 'Oscilloscope Plotter — Multi-Channel Real-Time Waveforms',
    summary: 'Real-time serial waveform grapher with auto-scaling, CSV and key:value telemetry parsing, multi-channel colors, per-channel statistics, and CSV export.',
    tags: ['Plotter', 'Oscilloscope', 'Waveforms', 'ADC', 'Telemetry', 'Sensors', 'Graphing', 'CSV'],
    readTime: '18 min read',
    content: `
# Oscilloscope Plotter — Live Waveform Visualizer

The **Oscilloscope Plotter** transforms numeric serial streams from analog-to-digital converters (ADCs), IMU motion sensors, temperature probes, and power monitors into real-time graphical waveforms rendered on an HTML5 canvas.

---

### 1. What Is This Tool & Why Do You Need It?

Reading numerical numbers scrolling down a text terminal at 100 Hz is impossible for the human eye. If an analog sensor has noise spikes, if a PID temperature loop is oscillating, or if an accelerometer is vibrating, you need a visual graph to understand the signal over time.

The **Oscilloscope Plotter** reads numeric serial output from any microcontroller code without requiring specialized graphing libraries. It auto-scales the vertical axis, tracks multi-channel variables with distinct neon colors, lets you hide channels, zoom and pan the time axis, trigger on an edge, switch to an FFT or XY view, shows live min/mean/max/RMS per channel, and exports the data as CSV or the plot as a PNG.

---

### 2. Supported Serial Text Data Formats

The plotter's parsing engine automatically recognizes and splits numbers from any standard serial format:

#### Format 1: Comma-Separated Values (CSV)
\`\`\`text
124.5, 88.2, 312.0\r\n
\`\`\`

#### Format 2: Whitespace / Tab Delimited
\`\`\`text
124.5    88.2    312.0\r\n
\`\`\`

#### Format 3: Labeled Key-Value Pairs
\`\`\`text
voltage:3.31 current:0.42 temp:24.8\r\n
\`\`\`
The plotter extracts the variable labels (\`voltage\`, \`current\`, \`temp\`) and uses them as channel names on the cards. \`name=value\` also works. Unlabeled numeric lines are named **CH 0**, **CH 1**, and so on. Lines that do not parse as numbers (text, boot logs) are ignored. For other layouts use the **Delimiter** box (a custom separator; blank is auto) and the **Columns** box (e.g. \`0,2,3\`) to plot only some columns.

<details>
<summary>Statistics Shown Per Channel</summary>

Over the visible sample window the plotter shows, for each channel:
- **Current**: the latest value.
- **Min / Max**: the smallest and largest values in the window (peak-to-peak is $V_{\max} - V_{\min}$).
- **Mean**: the arithmetic mean of the window.
- **RMS**: $V_{rms} = \sqrt{\frac{1}{N}\sum_{i=1}^N x_i^2}$

By default the vertical axis is auto-scaled with 10% padding; untick **Auto-scale** to set a fixed Min/Max. Each channel card also has **scale**, **offset** and **unit** boxes (x1, +0, unit) that convert raw readings (for example ADC counts to volts) for the plot, statistics and exports. There is no moving-average filter or frequency counter; use the **FFT** view for frequency content.

</details>

---

### 3. Complete UI Control Mapping

The plotter has no connect button of its own: it plots whatever numeric text arrives on the app's shared serial connection.

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Firmware Sketches** | Button | Opens a modal with copy-ready Arduino C++ (ESP32 / Uno), MicroPython (ESP32 / Pico) and Key:Value Named Channels snippets (**Copy Code**). |
| **TIME / FFT / XY** | Buttons | View mode. TIME is the scrolling waveform with a real time axis; FFT shows the spectrum of one channel (pick **Channel**; **Rate Hz** defaults to the rate measured from the sample timestamps); XY plots one channel against another (pick **X** and **Y**). |
| **Window selector** | Dropdown | Visible history: 50, 100, 150, 300, 500, 1000 or 5000 Samples. The buffer itself holds up to 50,000 samples. |
| **Auto-scale / Min / Max** | Checkbox + number inputs | Auto-scale (on by default) fits the Y axis to the visible channels plus 10% padding. Untick it to enable the Min and Max inputs and fix the Y range. |
| **Pause / Resume** | Icon button | Freezes the display on a snapshot. Samples **keep being recorded** in the background, and Resume lets the display catch up. |
| **Trigger** | Checkbox + controls | Enables an edge trigger: **channel**, **rising / falling / either**, **level**, **pre** and **post** sample counts and **single** (one-shot). Click **Arm**; the status text shows armed, capturing or captured, and the captured window is displayed. |
| **Reset view (n.nnx)** | Button | Appears when zoomed or panned; double-clicking the canvas does the same. |
| **Export CSV** (icon) | Icon button | Downloads the samples as \`serial-plot-<timestamp>.csv\` with true per-sample timestamps and one column per channel. |
| **Export the plot as PNG** (icon) | Icon button | Saves the canvas as \`serial-plot-<timestamp>.png\`. |
| **Save plot config / Load plot config** (icons) | Icon buttons | Save or restore the window, scale, delimiter, columns, view, per-channel scale/offset/unit, hidden channels and trigger settings as \`plotter-config.json\`. |
| **Clear Waveform Data** | Icon button | Empties the buffer. |
| **Canvas viewport** | Canvas | Grid, dashed zero line when in range, one colored trace per channel, auto-scaled (or fixed Min/Max). Scroll the mouse wheel to zoom, drag to pan back through history, hover for a crosshair readout of every channel at that moment. |
| **Channel cards** | Cards | Per channel: label, current value, Min / Max / Mean / RMS over the window, **scale / offset / unit** inputs, and an eye button to hide or show its trace. |

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Visualizing an Analog Light Sensor on an ESP32
1. Flash your ESP32 with a simple loop:
   \`\`\`cpp
   void loop() {
     Serial.printf("%d\\n", analogRead(36));
     delay(10);
   }
   \`\`\`
2. Connect to the ESP32 from the app header at **115,200 baud** (the plotter uses the shared connection), then open the **Oscilloscope Plotter**.
3. The canvas starts plotting the analog value at 100 Hz as channel **CH 0**.
4. Wave your hand over the photodiode and watch the real-time dip; the CH 0 card shows the current, min, avg and max over the window.
5. Click the **Pause** button to freeze the trace for a closer look (recording continues behind it), zoom with the mouse wheel, then export the CSV or a PNG of the plot.

---

### Implementation & Architecture

- **Component:** [\`src/components/SerialPlotter.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/SerialPlotter.jsx) subscribes to the shared serial text stream (\`latestTextStream\` from \`SerialContext\`), so it plots **live data from the connected device** — no separate connection and no simulated data. Pausing only freezes the display; samples keep being recorded (up to 50,000) by the engine in \`src/utils/plotterCore.js\`.
- **Parsing:** \`parseLineTelemetry()\` splits each chunk into lines and auto-detects the format per line — key/value (\`temp:24.5 volt:3.3\` or \`temp=24.5\`, when the pairs cover at least 40% of the line), or lines made only of numbers separated by commas, semicolons, spaces or tabs. Common boot-log lines (\`rst:\`, \`boot:\`, \`=>\`, \`[SYS]\`, \`[WiFi]\`, ...) are ignored.
- **Rendering:** parsed values go into a rolling buffer; the last 50–5000 samples (the window selector, with zoom and pan) are drawn on an HTML5 canvas, redrawn whenever new data arrives. Auto-scaling is on by default (the vertical range follows the visible channels plus 10% padding); unticking it uses the Min/Max inputs instead. Max/Min labels are drawn either way. Each channel card shows current, min, max, mean and RMS over the window, and **CSV export** writes every buffered sample with its true arrival timestamp.

---

### 5. Upstream Standards & Engineering Attribution

| Standard / Component | Authoring Entity | Purpose & Reference |
| :--- | :--- | :--- |
| **W3C WebSerial API** | W3C Web Incubator Community Group (WICG) | Standardized browser streaming endpoint for real-time binary telemetry. [W3C Spec](https://wicg.github.io/serial/) |
| **HTML5 Canvas 2D Rendering Context** | W3C / WHATWG | High-performance 60 FPS hardware-accelerated immediate-mode waveform rendering pipeline. |
`
  },
  {
    id: 'bridge',
    toolId: 'bridge',
    category: 'analysis',
    title: 'MitM Serial Bridge — Dual-Port Pass-Through & Sniffer',
    summary: 'Relay traffic between two concurrently connected serial boards while logging, searching and exporting the conversation between a master controller and slave device.',
    tags: ['Serial Bridge', 'MitM', 'Sniffer', 'Dual Port', 'Pass-Through', 'Reverse Engineering'],
    readTime: '18 min read',
    content: `
# MitM Serial Bridge — Dual-Port Interceptor

The **MitM Serial Bridge** enables hardware Man-in-the-Middle (MitM) inspection by relaying between two serial boards connected concurrently in your browser. It lets you place your computer between two devices communicating over serial to watch and log their conversation.

---

### 1. What Is This Tool & Why Do You Need It?

When reverse engineering a proprietary system (such as an electric scooter motor controller talking to a dashboard, a 3D printer mainboard talking to a display, or a drone flight controller talking to a GPS), both sides are already exchanging messages.

If you unplug one device to talk to it from your PC, it may refuse to boot because it misses heartbeat packets from the other side.
The **MitM Serial Bridge** solves this by inserting your computer between them:
\`\`\`
[Device A: Controller] <---USB-UART A---> [Skon's USB Tool] <---USB-UART B---> [Device B: Display]
\`\`\`
Traffic from Device A is displayed in the browser and transparently forwarded to Device B, and vice versa.

<details>
<summary>Baud Rate Matching & Latency Tuning for Dual-Port Bridges</summary>

#### Baud Rates & Forwarding
1. **Independent Baud Rates**: Each board is connected at its own baud rate, so Port A and Port B do **not** need to match. The bridge just relays received bytes, so a 9600 baud device can be bridged to a 115200 baud one.
2. **No Flow Control Beyond the Ports**: Bytes are written to the other port as they arrive. When forwarding from a fast port to a slow port, make sure traffic is light enough for the slow side to keep up.
3. **Browser Latency**: Forwarding happens in the browser per received chunk, so it adds a small, non-deterministic delay (typically a few milliseconds). Very timing-sensitive protocols may not tolerate it.

</details>

---

### 2. Hardware Wiring Guide

You need **two** USB-UART adapters connected to your computer:
1. **Adapter A**: Connect TX to Device A RX, RX to Device A TX, GND to Device A GND.
2. **Adapter B**: Connect TX to Device B RX, RX to Device B TX, GND to Device B GND.
3. Common ground must be shared across all devices.

---

### 3. Complete UI Control Mapping

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **PORT A / PORT B** | Dropdowns | Pick which connected board is on each side (shown as name and baud). Locked while the bridge is active. |
| **+ Add serial port** | Button | Adds and connects another board via the browser serial picker. |
| **START MitM BRIDGE / BRIDGE ACTIVE (SNIFFING)** | Button | Starts or stops forwarding bytes between the two boards. Needs two distinct boards. |
| **Feed viewport** | Viewport | Log of each chunk: time, direction (cyan for A to B, amber for B to A), delta in ms, text and hex. |
| **Search dialogue text or hex...** | Input | Filters the feed. |
| **Export JSON** | Button | Downloads the feed as \`serial_bridge_capture_<timestamp>.json\`. |
| **Clear Feed** | Icon button | Empties the log. |

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Intercepting Scooter Dashboard Communications
1. Unplug the 4-wire waterproof connector between the scooter handlebar dashboard and motor controller.
2. Connect Adapter A to the dashboard harness and Adapter B to the controller harness.
3. Connect both adapters as boards in Skon's USB Tool (each at **115,200 baud** in this example).
4. Open the bridge, choose the two boards in **PORT A** and **PORT B**, and click **START MitM BRIDGE**. The scooter powers on normally; the button reads **BRIDGE ACTIVE (SNIFFING)**.
5. In the feed, observe periodic 100ms packets flowing back and forth (with the \`+ms\` delta since the previous chunk).
6. Pull the brake lever: observe which byte flips value in the \`A -> B\` stream. Use the search box to filter by text or hex.
7. Click **Export JSON** to save the capture for offline analysis. (The bridge only observes and relays; it cannot modify or inject bytes.)

---

### Implementation & Architecture

> **How it works.** The bridge relays between two boards in the app's multi-board session.
> Use **+ Add serial port** (next to **PORT A / PORT B**) to open the browser's serial picker and
> add another board, then pick its baud rate in the board status row (the rate is locked once the
> board is connected) and use **Connect** on any board that shows *disconnected*. Each board keeps
> its own baud rate. With fewer than two distinct boards, **START MitM BRIDGE** is disabled and an
> inline hint explains what to do.

- **Component:** [\`src/components/SerialBridgeDeck.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/SerialBridgeDeck.jsx) is built on the **multi-board** capability of \`SerialContext\`: two independently-connected boards (A and B) registered in the same provider.
- **Data flow:** while active, \`subscribeRx\` receives every chunk read from either board; a chunk from board A is written to board B with \`sendRawToBoard\` and vice-versa, and each chunk is logged with its direction (\`A->B\` / \`B->A\`), the delay since the previous chunk, hex and printable text. The log keeps the last 2000 entries. The relay forwards bytes unchanged: there is no injection, filtering or rewriting.

---

### 5. Upstream Architecture & Engineering Attribution

| Technique / Device Class | Historical Precedent & Tools | Reference |
| :--- | :--- | :--- |
| **Hardware Serial TAPs & MitM Bridges** | Bus Pirate (Dangerous Prototypes), GreatFET (Great Scott Gadgets), and hardware serial packet sniffers. | [Dangerous Prototypes Bus Pirate](http://dangerousprototypes.com/docs/Bus_Pirate) |
| **W3C Multi-Port WebSerial Implementation** | W3C WICG Serial API concurrent device claim specification. | [W3C WebSerial](https://wicg.github.io/serial/) |
`
  },
  {
    id: 'cyberchef-workbench',
    toolId: 'cyberchef',
    category: 'analysis',
    title: 'CyberChef Workbench — Modular Engine, Web Worker Pipeline & Magic Detection',
    summary: 'Master enterprise-grade data transformations, asynchronous Web Worker offload, dynamic Operation Registry, Shannon entropy calculations, and automated heuristic magic decoding.',
    tags: ['CyberChef', 'Web Worker', 'Magic Engine', 'Shannon Entropy', 'AES', 'Gzip', 'Cryptography', 'Deobfuscation'],
    readTime: '20 min read',
    content: `
# CyberChef Workbench — Multi-Threaded Data Engine & Magic Analysis

The **CyberChef Workbench** in Skon's USB Tool is an independent implementation modeled on GCHQ's CyberChef (Operation / Dish / Recipe architecture), running in a high-performance, asynchronous Web Worker pipeline. It enables reverse engineers, firmware auditors, and penetration testers to manipulate binary, hex, encrypted, and obfuscated payloads in real-time without stuttering the browser DOM.

---

### 1. What Is This Tool & Why Do You Need It?

During hardware security testing and firmware extraction, binary data rarely arrives in human-readable plain text:
- EEPROM memory dumps often contain **Gzip-compressed** or **Zlib-compressed** configuration tables.
- Web API tokens and IoT telemetry are frequently encoded as **JWTs (JSON Web Tokens)** or obfuscated through Base64 and custom XOR masks.
- Malicious USB keystroke payloads (BadUSB / DuckyScript) employ string-slicing and random delay jitter to evade heuristic endpoint detection.

The **CyberChef Workbench** provides a modular pipeline to compose sequences of operations ("Recipes"), analyze data entropy, inspect unknown file headers, and automatically discover decoding routines using the built-in **"Magic" Heuristic Engine**.

---

### 2. Under the Hood: The Modular Core Architecture

The transformation engine is built upon decoupled foundational classes in \`src/utils/cyberchef/core/\`:

\`\`\`
+------------------------------------------------------------------------+
|                                 CHEF                                   |
|                (Main Controller & Pipeline Executor)                   |
+-----------------------------------+------------------------------------+
                                    |
                                    v
+-----------------------------------+------------------------------------+
|                                RECIPE                                  |
|         (Step Execution, Fork/Merge, Registers & Breakpoints)          |
+-----------------------------------+------------------------------------+
                                    |
            +-----------------------+-----------------------+
            |                                               |
            v                                               v
+-----------+-----------+                       +-----------+-----------+
|      OPERATION        | <-------------------> |         DISH          |
| (AES, DES, Zip, ...)  |                       | (String / ArrayBuffer)|
+-----------------------+                       +-----------------------+
\`\`\`

#### 1. The Dish Container (\`Dish.js\`)
The \`Dish\` encapsulates raw data flowing between operations. Rather than forcing all data into strings (which corrupts binary null bytes and high-order UTF-8 characters), \`Dish\` maintains internal typing:
- **\`Dish.type\`**: Returns \`'string'\` or \`'ArrayBuffer'\`.
- **\`Dish.toString()\`**: Safely decodes buffers via \`TextDecoder('utf-8', { fatal: false })\`.
- **\`Dish.toArrayBuffer()\`**: Returns zero-copy typed byte views.
- **\`Dish.toHex(delimiter)\`**: Generates space-, comma-, or prefix-separated hexadecimal representations.
- **\`Dish.toBase64()\`**: Encodes binary streams using 8KB chunking to prevent browser call-stack overflow on large payloads.
- **\`Dish.toHexdump(bytesPerLine = 16)\`**: Produces standard Wireshark/xxd 16-bytes-per-line formatted dumps with byte offsets and an ASCII printable gutter.

#### 2. Abstract Operations (\`Operation.js\`) & Dynamic Registry (\`OperationRegistry.js\`)
Every transformation step is an isolated class inheriting from \`Operation\`, declaring:
- Metadata: \`name\`, \`module\`, \`description\`.
- Input & Output typing: \`'string'\`, \`'ArrayBuffer'\`, or \`'Dish'\`.
- Dynamic arguments schema: \`args\` with labels, types, and defaults.
- \`run(input, args, context)\`: Pure asynchronous or synchronous execution method with access to the execution context.

All 169 operations (the Operation Library search box shows the live count) auto-register into \`registry\`, allowing case-insensitive lookup by canonical name or normalized snake_case ID. The Operation Library's search box ("Search 169 operations...") matches an operation's name, id, description, keywords and module, so searching for \`windows\` finds NTLM Hash even though its name does not contain it; the category chips narrow the list further.

---

### 3. Flow Control Engine (\`flowControl.js\`)

Complex decoding routines often require multi-stream branch processing, conditional execution, or dynamic memory registers. The CyberChef Flow Control Engine provides five native control-flow primitives:

\`\`\`
                       Raw Stream
                           |
                           v
                    +--------------+
                    | Fork (\\n, ,) |
                    +------+-------+
                           |
           +---------------+---------------+
           |               |               |
           v               v               v
       Sub-Dish 1      Sub-Dish 2      Sub-Dish 3
       [From Hex]      [From Hex]      [From Hex]
           |               |               |
           +---------------+---------------+
                           |
                           v
                    +--------------+
                    | Merge (\\n, ,)|
                    +--------------+
                           |
                           v
                     Unified Stream
\`\`\`

1. **Fork (\`Fork\`)**:
   - Splits incoming data into sub-streams based on a delimiter (e.g., newline \`\\n\`, comma, or custom character).
   - Pushes an isolated fork frame onto the Recipe's \`forkStack\`.
   - All subsequent operations execute independently on each sub-branch until a \`Merge\` operation is encountered.
2. **Merge (\`Merge\`)**:
   - Closes the active fork frame and reconciles all branched sub-dishes back into a single unified \`Dish\` stream joined by the specified delimiter.
3. **Registers (\`Register\`)**:
   - Memory storage and variable persistence across recipe steps.
   - **Set**: Extracts a value (optionally via regular expression capture groups) and stores it under a key in the recipe's \`registers\` map.
   - **Get**: Retrieves the stored register value and replaces the active stream.
   - **Inject / Replace**: Replaces patterns or appends stored register values into the active stream.
4. **Subsection (\`Subsection\`)**:
   - Selectively applies subsequent transformations only to lines or tokens matching a specified regular expression, leaving non-matching segments unaltered.
5. **Label & Jump (\`Label\`, \`Jump\`)**:
   - Enables looping over payload transformations with deterministic loop counters to prevent infinite execution cycles.

---

### 4. Interactive Breakpoints & Step-Through Debugging

Auditing layered obfuscation (e.g. Base64 -> XOR -> Gzip -> Hex) requires inspecting intermediate states to verify that keys, offsets, or headers match expectations.

- **Breakpoint Toggles**: Every step in the Recipe editor features a Breakpoint indicator. Clicking the breakpoint icon arms a pause trigger on that step.
- **Worker Execution Pausing**: When the Web Worker encounters a step with an active breakpoint, execution pauses *immediately before* applying that operation.
- **Intermediate Inspection**: The engine returns the intermediate \`Dish\` state, allowing the analyst to inspect the payload in Raw Text, Hex, Base64, or Hexdump format.
- **Step & Continue**:
  - **Step**: Executes exactly one operation in the recipe, capturing the immediate output and advancing the pause cursor.
  - **Continue**: Resumes execution until the next breakpoint or recipe termination.

---

### 5. Auto-Bake Pipeline & Multi-Tab Workspace

- **Auto-Bake with 300ms Debounce**:
  - When enabled, editing any input character or modifying operation arguments automatically queues a background worker bake after 300ms of inactivity.
  - Stale worker requests are automatically cancelled via monotonic request correlation IDs, preventing race conditions.
  - Analysts can toggle Auto-Bake off when working with massive multi-megabyte payloads or CPU-intensive algorithms, switching to manual baking with <kbd>Ctrl</kbd>+<kbd>Enter</kbd> or the Command Palette's **Bake** action. The Auto-Bake on/off toggle also lives in the Command Palette.
- **Multi-Tab Architecture**:
  - Open multiple concurrent analysis sessions across independent tabs.
  - Each tab preserves its own isolated Input payload, Recipe configuration, Output format, and debugging breakpoint state.
- **Chunked File Ingestion & Drag-and-Drop**:
  - Drop binary firmwares, PCAP slices, or memory dumps directly onto the input drop zone, or use the **Upload** button.
  - Files are read as zero-copy \`ArrayBuffer\` streams and piped cleanly into the Dish without UI freezing.
- **Output Views**:
  - Instant one-click toggling between the **Text**, **Hex**, **Base64**, **Hexdump** (16-byte aligned with ASCII gutter), **Hex Editor**, **Charts**, **JSON Tree**, **Table** and **JWT** views.
  - Includes a **Use Output as Input** button for iterative multi-stage deobfuscation.

---

### 6. The "Magic" Heuristic Engine v2 (\`magic.js\`)

When inspecting unfamiliar firmware chunks or network payloads, reverse engineers often don't know what encoding was applied. The **Magic Engine v2** solves this using multi-step chaining and a 3-stage heuristic diagnostic:

#### 1. Multi-Step Chaining (Depth ≤ 3)
Rather than testing single encodings in isolation, Magic v2 runs a breadth-first search (BFS) over chains of four candidate steps (\`From Base64\`, \`From Hex\`, \`URL Decode\`, \`Gunzip\`), and checks for Gzip magic bytes and JWT structure directly. Example chains it can find:
- \`From Base64\` -> \`Gunzip\`
- \`From Hex\` -> \`From Base64\` -> \`Gunzip\`
- \`URL Decode\` -> \`From Base64\`

#### 2. Shannon Entropy Calculation ($H$)
Information entropy measures the unpredictability of byte distributions:
\`\`\`text
H = - \\sum_{i=0}^{255} p_i \\log_2(p_i)
\`\`\`
- Plain English ASCII text: $H \\approx 3.5 - 4.8$ bits/byte.
- Source code / JSON / Base64 text: $H \\approx 4.5 - 5.5$ bits/byte.
- Encrypted or compressed ciphertext: $H > 7.2$ bits/byte (maximum theoretical limit: $8.0$).

#### 3. File Signature (Magic Bytes) Detection
The engine matches leading byte headers against standard forensic databases:
- **Gzip**: \`1F 8B\`
- **ZIP**: \`50 4B 03 04\`
- **PDF**: \`25 50 44 46\` (\`%PDF\`)
- **PNG**: \`89 50 4E 47\`
- **ELF**: \`7F 45 4C 46\`
- **Windows PE**: \`4D 5A\` (\`MZ\`)

#### 4. Printable ASCII Ratio Scoring
Calculates the proportion of bytes falling within printable ranges ($[32..126, 9, 10, 13]$). If a trial transformation raises printable density above $70\\%$, or exposes recognized magic bytes (such as a Gzip header), it generates a recommendation with one-click recipe application.

---

### 7. Live Hardware Piping Pipeline

Analyzing hardware telemetry (such as serial debugging logs, GPS NMEA streams, sensor frames, and 802.11 monitor packets) typically requires tedious manual copy-pasting. The **Hardware Piping** engine bridges browser WebSerial and WebUSB streams directly into the CyberChef transformation pipeline:

\`\`\`
+-----------------------+      +-----------------------+      +-----------------------+
| WebSerial (COM Ports) |  or  | Alfa Wi-Fi (WebUSB)   |  or  | Hardware Telemetry    |
+-----------+-----------+      +-----------+-----------+      +-----------+-----------+
            |                              |                              |
            +------------------------------+------------------------------+
                                           | (Uint8Array Stream)
                                           v
                        +-------------------------------------+
                        | Rolling Capture Buffer (2KB - 50KB) |
                        +------------------+------------------+
                                           |
                                           v
                        +-------------------------------------+
                        | CyberChef Input Dish                |
                        +------------------+------------------+
                                           | (Debounced Auto-Bake)
                                           v
                        +-------------------------------------+
                        | Real-Time Decoded Output            |
                        +-------------------------------------+
\`\`\`

1. **Hardware Stream Ingestion**:
   - Analysts click **"Pipe Hardware"** in the Input Deck to open the source selection deck.
   - Sources include connected **WebSerial COM devices**, **Alfa Wi-Fi 802.11 monitor streams**, or realistic mock streams (**GPS NMEA 0183**, **ESP32 Firmware Telemetry**, **16-byte Binary Sensor Frames**).
2. **Rolling Buffer Memory Management**:
   - Configurable rolling buffer window (2KB, 5KB, 10KB (default), 50KB or Unlimited) prevents memory exhaustion and DOM freezing during high-baud transmissions.
   - Slices incoming byte buffers to continuously retain only the most recent $N$ bytes.
3. **Continuous Auto-Bake Pipeline**:
   - In combination with Auto-Bake, the Web Worker decodes the streaming telemetry buffer in the background at 300ms intervals, giving immediate live deciphering of checksums, decodings, or ciphers.

---

### 8. Interactive Hex Editor & Two-Way Synchronization

The Baked Output pane includes a native 16-bytes-per-line **Interactive Hex Editor**:

- **Paged Dual-Pane Grid** (512 bytes, 32 lines per page):
  - **Offset Address**: 8-digit hexadecimal memory offsets (\`00000000\`, \`00000010\`, ...).
  - **16 Hex Byte Cells**: Split into two 8-byte columns with subtle gutter separators.
  - **ASCII Column**: Simultaneous representation of printable characters and control points.
- **In-Place Two-Way Editing**:
  - Click any byte cell to edit its value in hexadecimal (\`00\` - \`FF\`) or click ASCII glyphs to edit characters.
  - Modified bytes are highlighted with a distinct rose accent and tracked in a modifications set.
- **Real-Time Search Highlighting**:
  - Integrated search box supporting both Hex byte sequences (e.g. \`1F 8B\` or \`AA 55\`) and ASCII strings (e.g. \`HTTP\`, \`flag{\`, \`MZ\`).
  - Matching cells are highlighted in vibrant amber with match count and step-through navigation.
- **Pipeline Synchronization**:
  - Click **"Pipe to Input"** to feed the edited binary payload straight back into the recipe input, enabling rapid iterative reverse-engineering.

---

### 9. Visual Analytics: Rolling Entropy & Byte Frequency

Clicking the **"Charts"** tab in the Output Deck exposes deep structural telemetry:

1. **Rolling Shannon Entropy Curve**:
   - Calculates the entropy profile across rolling blocks (default 256 bytes) to visualize boundary transitions between plaintext ($H < 4.5$), structured/code ($4.5 \\le H \\le 7.0$), and ciphertext/compression ($H > 7.2$).
   - Features an interactive SVG line chart with threshold guide lines, min/max metrics, and hover tooltips detailing block offsets.
2. **256-Bin Byte Frequency Histogram**:
   - Bins every byte from \`0x00\` to \`0xFF\` into an interactive bar histogram.
   - Color-coded by byte category:
     - **Null Bytes** (\`0x00\`): Blue
     - **Control Characters** (\`0x01\` - \`0x1F\`, \`0x7F\`): Amber
     - **Printable ASCII** (\`0x20\` - \`0x7E\`): Emerald
     - **High / Binary Bytes** (\`0x80\` - \`0xFF\`): Purple
   - Displays top 5 most frequent byte occurrences and relative payload percentages.

---

### 10. Comprehensive Operation Suites Reference (169 Operations)

| Module | Key Operations | Description & Underlying Engines |
| :--- | :--- | :--- |
| **Cryptography** | AES (CBC, CTR, GCM), DES, Triple DES, RC4, Blowfish, ChaCha20, ChaCha20-Poly1305, PBKDF2, HKDF, XOR Brute Force, RSA, Bcrypt, Scrypt, Frequency Analysis | Symmetric ciphers (CBC, ECB, CTR, CFB, OFB) via \`crypto-js\`, key derivation, and automated single-byte XOR key brute-forcing. |
| **Compression** | Gzip, Gunzip, Raw Deflate, Raw Inflate, Zip, Unzip | RFC 1952 / 1951 Deflate via \`pako\` and full ZIP archive creation/extraction via \`JSZip\`. |
| **Parsing** | Parse JWT, Parse X.509, Parse ASN.1, Parse IPv6, Parse URI, Parse User Agent, JSON Beautify/Minify, XML Beautify | Token verification via \`jwt-decode\`, RFC 5952 IPv6 formatting, ASN.1 DER parser, and structural formatters. |
| **Extractors** | Extract IPs, Domains, URLs, Emails, MACs, Hashes, Base64 | High-performance regex scanners isolating indicators of compromise (IOCs) and encoded strings. |
| **Networking** | Change IP Format, Generate UUID, Parse MAC address | Hex, decimal, octal, dotted-quad IP conversions and RFC 4122 v4 UUID generators. |
| **Forensics** | Detect File Type, Extract EXIF, Identify Hash | Magic bytes file signature analyzer, EXIF metadata extractor, and hash format identifier. |
| **Flow Control** | Fork, Merge, Register, Subsection, Label, Jump | Multi-branch splitting, register persistence, regex sub-scoping, and controlled execution loops. |
| **Arithmetic / Logic** | Sum, Mean, Median, Bit-shift, Bitwise AND/OR/XOR | Multi-radix numeric computations, statistical aggregations, and bit-level logic operations. |
| **Date / Time** | From UNIX Timestamp, To UNIX Timestamp, Parse DateTime | Epoch seconds/milliseconds bidirectional conversions and ISO 8601 UTC timestamp parsing. |
| **Data Format** | To/From Base32, Base45, Base58, Base62, Base85, Hexdump, Decimal, Binary, Base64, Hex, URL, CSV / JSON, PEM | Radix converters, Bitcoin Base58, RFC 1924 Base85, and Wireshark-compatible hexdump formats. |
| **Hashing** | MD4, MD5, SHA-1, SHA-2 (224/256/384/512/512-256), SHA-3, RIPEMD-160, NTLM Hash, HMAC, BLAKE2b, BLAKE2s, CRC-8/16/32/64, custom CRC, Fletcher-16/32, Adler-32 | Cryptographic digests including Keccak and RFC 7693 BigInt BLAKE2b-512, keyed HMAC, and checksums. |
| **Text** | Find / Replace, Regular expression, To Upper / Lower case, Sort, Unique, Head, Tail, Remove whitespace, Remove null bytes, Count occurrences, Strings, Swap endianness, Reverse, Add line numbers, Diff | Line- and string-level text processing. |
| **Encoding** | To / From HTML Entity, Punycode, Quoted Printable, Encode text / Decode text | Entity, IDN and character-set conversions (the character-set operations use CyberChef's code-page names). |
| **Obfuscation** | CharCode Array, Hex Escape, Unicode Escape, PowerShell Slicing, Ducky Jitter | Payload evasion, format scrambling, and keystroke rate-limiter evasion. |
| **User / Scripting** | Custom Script | Sandboxed user-defined JavaScript execution in strict mode for custom algorithms and ad-hoc transformations. |

---

### 11. Interactive Structured Data Visualizers

Raw text or hexdump outputs are often insufficient for deeply nested configurations, security tokens, or tabular reports. CyberChef Workbench features three dedicated structured viewers:

1. **Collapsible JSON Tree View**:
   - Automatically activates when output parses as valid JSON (or toggled via **"JSON Tree"**).
   - Renders a recursive tree showing keys, data types (string, number, boolean, object, array, null), and item counts.
   - Expand/collapse buttons for the whole tree or individual branches.
   - Built-in real-time filter search bar highlighting matching keys and values across the JSON hierarchy.

2. **JWT (JSON Web Token) Decoder View**:
   - Specialized inspector for RFC 7519 JSON Web Tokens (e.g. from the *Parse JWT* operation or pasted directly).
   - Deconstructs token into three distinct color-coded semantic blocks:
     - **Header** (Cyan): Algorithm (\`alg\`), token type (\`typ\`), key ID (\`kid\`).
     - **Payload / Claims** (Emerald): Subject (\`sub\`), issuer (\`iss\`), audience (\`aud\`), and human-readable expiration timestamp status (\`exp\` calculated with live validity checks).
     - **Signature** (Purple): Base64URL cryptographic verification block.

3. **HTML Table View**:
   - For tabular outputs (such as delimiter-separated text or regex extractor lists of IOCs).
   - Automatically parses delimiter-separated lines into structured columns with styled header rows.
   - Includes real-time row filtering and row-count telemetry.

---

### 12. User-Defined Custom Scripting Operation

For advanced analysts requiring custom string manipulation, binary transformations, or proprietary encoding schemes not covered by standard operations, the **Custom Script** operation (located under the **User** category) provides in-recipe JavaScript execution:

- **Strict Sandboxing**:
  - Code executes inside an isolated \`new Function('input', ...)\` wrapper running under ECMAScript \`"use strict"\` mode.
  - Global scope contamination is prevented, receiving only the current recipe pipeline \`input\` (as a string or binary ArrayBuffer).
- **Integrated Code Editor**:
  - Embedded monospace editor directly within the recipe step card.
  - Includes quick snippet insertion buttons:
    - **Reverse**: \`return input.split('').reverse().join('');\`
    - **Upper**: \`return input.toUpperCase();\`
    - **Filter**: \`return input.split('\\n').filter(l => l.trim()).join('\\n');\`
- **Error Handling**:
  - Runtime exceptions or syntax faults are trapped and surfaced as clear \`Custom Script Execution Error\` alerts without crashing the worker or browser.

---

### 13. Recipe Portability & Standalone HTML Session Export

Sharing and archiving multi-stage analysis workflows is supported through comprehensive portability features:

1. **Recipe Sharing (Import/Export)**:
   - **Save**: Serializes the current operation pipeline and parameter dictionary into a downloadable \`.cyberchef\` (or \`.json\`) file.
   - **Load**: Uploads an existing \`.cyberchef\` configuration file, automatically reconstructing the pipeline UI and triggering an immediate re-bake.
   - **Copy**: One-click clipboard export of clean JSON recipe arrays for sharing in team documentation, incident tickets, or chat channels.
   - **CyberChef**: copies the recipe in real CyberChef's recipe-string format, e.g. \`To_Base64('A-Za-z0-9+/=')\`. Only operations that exist in both tools can round-trip; the others are left out and a note under the recipe lists them ("Not included (no CyberChef equivalent): ...").
   - **Import CC**: opens a dialog to paste a CyberChef recipe string, a full CyberChef link, or a \`#recipe=\` fragment, then **Import** replaces the recipe (Undo restores the previous one). Operations or options this tool does not support are listed in the dialog instead of being dropped silently.
   - **\`#recipe=\` links**: the address bar is kept in sync (after a short pause) with a \`#recipe=...\` fragment holding the recipe in CyberChef string form and, unless a file is loaded or it is too long, the input. Opening such a link restores the recipe and input; anything that could not be restored is reported in the Import CC dialog.
2. **Standalone HTML Session Exporter**:
   - Clicking **"HTML"** in the Baked Output deck generates a completely self-contained, offline-compatible HTML5 document.
   - Embeds the full audit record: session metadata, generation timestamp, input data, each configured recipe step with arguments, and raw/hex/JSON output formats.
   - Includes embedded CSS and lightweight client-side JavaScript for copying and format switching—allowing external stakeholders to inspect forensic results without requiring any server, node environment, or internet connection.

---

### 14. Network Payload Parsers (Hardware Synergy)

When piping hardware streams from USB serial interfaces or 802.11 monitor feeds, analysts frequently need to decode raw Layer 3/4 datagrams and Layer 7 protocol messages directly. CyberChef provides four dedicated wire-format parsers:

1. **Parse DNS Query**:
   - Decodes DNS wire-format payloads into structured JSON.
   - Extracts Transaction ID (\`0x1234\`), Message Type (Query vs Response), standard flags (Opcode, Authoritative Answer, Truncated, Recursion Desired/Available, RCODE), record counts, and full domain queries (e.g. \`example.com\`, Type \`A\`, Class \`IN\`).
2. **Parse TCP Header**:
   - Extracts Source/Destination ports with service mapping (HTTP, HTTPS, SSH, DNS, etc.), 32-bit Sequence and Acknowledgment numbers, and Header Length.
   - Decodes control flags: \`SYN\`, \`ACK\`, \`RST\`, \`FIN\`, \`PSH\`, \`URG\`, \`ECE\`, \`CWR\`, \`NS\`.
   - Computes payload offset and remaining payload length for subsequent pipeline chaining.
3. **Parse UDP Header**:
   - Extracts 16-bit Source/Destination ports (with mDNS, DNS, DHCP, SNMP mappings), Length field, and Checksum.
   - Determines payload byte offset (\`offset + 8\`) and truncation state.
4. **Parse HTTP Request/Response**:
   - Decodes unencrypted Layer 7 HTTP/1.x traffic.
   - For Requests: extracts HTTP method (GET, POST, etc.), URI/Path, HTTP version, normalized header dictionary, and payload body.
   - For Responses: extracts status code (200, 404, etc.), status text, headers, and response body.
5. **Byte Offset Control**:
   - All network operations accept a \`Byte Offset\` parameter, allowing users to skip physical Ethernet frames or IP headers when dissecting encapsulated streams.

---

### 15. Archive & File System Forensics

Inspecting firmware packages, update drops, or memory dumps requires deep archive traversal and signature recognition:

1. **Unzip & Untar Operations**:
   - **Unzip**: Decompresses PKZip archives from binary, Hex, or Base64 streams. When given an empty filename, returns a structured JSON directory table of all contained files with paths, sizes, compressed sizes, and timestamps. When given a specific path, extracts that file's content directly into the pipeline.
   - **Untar**: Implements a zero-dependency POSIX USTAR / GNU TAR parser. Traverses 512-byte blocks, reading filenames, file modes, user/group IDs, octal file sizes, and file type flags (\`'0'\` normal file, \`'5'\` directory). Supports single-file extraction or JSON archive cataloging.
2. **50+ File Type Magic Signatures**:
   - The upgraded **Detect File Type** engine inspects binary headers across 50+ industry formats:
     - **Images**: PNG, JPEG, GIF87a/89a, WebP, BMP, TIFF (LE/BE), ICO, PSD.
     - **Documents**: PDF, PostScript, RTF, MS Office OLE2 (DOC/XLS/PPT).
     - **Executables**: ELF (Linux 32/64), Windows PE/MZ, Mach-O (32/64/Fat), WebAssembly (WASM), Java Class, Android DEX.
     - **Archives**: ZIP, Gzip, Bzip2, 7-Zip, TAR, XZ, RAR v4/v5, Zstandard, CPIO, ISO 9660.
     - **Databases & Telemetry**: SQLite 3, PCAP (LE/BE/Nanosecond), PCAPNG, Redis RDB, Git Packfile.
     - **Audio/Video**: MP3 (ID3/Sync), FLAC, Ogg, WAV, AVI, MIDI, MP4/MOV, WebM/MKV, FLV.
     - **Firmware & Security**: DER X.509, OpenPGP Keyrings, ESP32 ROM images, Device Tree Blobs (DTB).
   - Outputs rich JSON telemetry containing MIME type, extension, category, detected magic bytes, and formatted description.

---

### 16. Global Command Palette & Keyboard Navigation

For high-velocity operations, the CyberChef Workbench incorporates an overlay Command Palette:

- **Shortcut**: Press \`Ctrl+K\` (or \`Cmd+K\`) anywhere within the workbench.
- **Fuzzy Search**: Filter across all 169 operations, saved recipes, and UI actions.
- **Immediate Execution**:
  - \`Ctrl+Enter\`: Force Bake current recipe.
  - \`Ctrl+S\`: Save the recipe file.
  - \`Ctrl+Z\`: Revert the last recipe change with full undo history stack (ignored while typing in a text field).
  - \`Esc\`: Dismiss palette.
- **UI Shortcuts**:
  - Switch output formats (Text, Hex, Tree, Table, JWT, Hex Editor, Charts).
  - Toggle Auto-Bake, Clear Input, or Clear Recipe.
  - Pipe Hardware Data directly from the palette.

---

### 17. Time Machine (Session History Timeline)

Iterative reverse engineering requires tracking how data evolves across multiple transformations. The **Time Machine** provides an automated audit trail:

1. **Automated Bake Snapshots**:
   - Every manual or auto-bake execution captures an in-memory snapshot containing the input payload, full recipe configuration, output, duration, and timestamp.
   - Automatically avoids duplicate entries when consecutive debounced bakes produce identical states.
2. **Memory-Conscious Capping**:
   - History is strictly capped at 20 snapshots using a rolling FIFO eviction strategy, guaranteeing lightweight browser memory consumption.
3. **One-Click State Restoration**:
   - The left pane features a **History** tab alongside the Operations library.
   - Analysts can browse the chronological snapshot feed and click any entry to immediately restore the exact Input, Recipe, and Output state.
   - A **Clear** button above the list purges all snapshots at any time.

---

### 18. Deep Cryptanalysis Tools

Enterprise cryptanalysis often begins with unknown ciphertext or raw cryptographic material that requires algorithmic extraction and frequency profiling:

1. **XOR Brute Force**:
   - Iterates through all single-byte keys from \`0x00\` to \`0xFF\` (0 to 255).
   - Evaluates each candidate output against English unigram frequency distributions (weighting common vowels, consonants, and standard whitespace).
   - Ranks candidates by score and outputs the top 10 most likely plaintext strings alongside their hex keys, ASCII character representations, and printable ratios.
2. **Frequency Analysis**:
   - Computes statistical character distributions across the entire input buffer.
   - Outputs total character counts, unique symbol counts, individual frequencies, and percentages.
   - Generates a visual Unicode bar chart histogram for rapid inspection of plaintext language models or ciphertext entropy.
3. **X.509 Certificate Parser**:
   - Native browser-side ASN.1 DER and PEM parser for public-key certificates.
   - Extracts Subject, Issuer, Common Name (CN), Validity Dates (NotBefore / NotAfter), active validity status, detected Public Key Algorithm (RSA, ECDSA/Ed25519), and SHA-256 fingerprint.
4. **RSA Key Parser**:
   - Extracts Modulus ($N$), Public Exponent ($E$), and bit length (e.g. 512, 1024, 2048, 4096-bit) from standard PKCS#1 and PKCS#8 PEM or DER public keys.

---

### 19. Recipe Test Suites & Regression Validation

As recipes grow into complex multi-stage pipelines with custom scripts and flow controls, modifications can inadvertently break edge cases. The **Recipe Test Suite** introduces enterprise test-driven engineering to CyberChef:

1. **Test Case Modal**:
   - Click the **Test** button on the Recipe header bar or on any saved recipe in the Presets manager.
   - Define custom test cases with distinct **Input Strings** and **Expected Output Strings**.
   - Choose between an exact match and a **Contains Substring** assertion.
2. **Execution & Feedback**:
   - Click **Run All Tests** to execute the pipeline through the Chef engine in isolated dishes.
   - Passing tests display a green checkmark with execution latency in milliseconds.
   - Failing tests display a red X with a diff comparing Expected vs. Actual output.
3. **Persistence**:
   - Test suites are persisted to browser \`localStorage\` keyed by recipe signature, ensuring regression suites are retained across sessions.

---

### 20. Dynamic Theming

Three interface themes are available from the **Cyber / Matrix / Light** buttons at the top right of the workbench:

- **Cyberpunk Dark** (Cyber): Sleek deep-slate and cyan interface designed for extended analytical sessions.
- **Matrix Green** (Matrix): High-contrast pure black background (\`#000000\`) with phosphor neon green accents (\`#00ff66\`) and monospace terminal aesthetics.
- **Classic Light** (Light): Clean light-gray and slate styling tailored for standard office environments, documentation, and high-visibility displays.

The theme selection persists across browser sessions via \`localStorage\`.

### 21. Presentation Mode

The **Presentation mode** button in the toolbar (next to the theme buttons), or **Toggle Presentation Mode** in the Command Palette, hides the Operations/History sidebar and widens the input and output panes for focused analysis and clean screenshots. Click **Exit Presentation** in the purple banner (or the toolbar button again) to restore the layout.
`
  },
  {
    id: 'usbtmc',
    toolId: 'usbtmc',
    category: 'analysis',
    title: 'USBTMC Instrument Control — SCPI over WebUSB',
    summary: 'Drive oscilloscopes, DMMs, power supplies and signal generators from the browser with SCPI commands over the USB Test & Measurement Class — query values, change settings, and read waveform data.',
    tags: ['USBTMC', 'SCPI', 'Oscilloscope', 'DMM', 'Power Supply', 'Instrument', 'WebUSB', 'USB488', 'IEEE 488.2'],
    readTime: '12 min read',
    content: `
# USBTMC Instrument Control

The **USBTMC** workbench talks to bench test equipment the standard way: the **USB Test & Measurement Class** carrying **SCPI** text commands. Most modern oscilloscopes, digital multimeters, programmable power supplies and signal/function generators present a USBTMC interface, and they all answer \`*IDN?\`.

---

### 1. USBTMC framing

USBTMC wraps your SCPI text in small bulk-transfer messages with a 12-byte header:

- **DEV_DEP_MSG_OUT** — the host sends a command. Header: MsgID=1, a rolling \`bTag\` (1–255) and its complement, a 4-byte TransferSize, and a \`bmTransferAttributes\` byte whose bit 0 (**EOM**) marks the last fragment. The payload is padded to a 4-byte boundary.
- **REQUEST_DEV_DEP_MSG_IN** then **DEV_DEP_MSG_IN** — to read a response, the host first asks (MsgID=2, the max size it will accept), then reads back a DEV_DEP_MSG_IN with the data and an EOM flag; long responses arrive as several fragments reassembled until EOM.

Every transfer has a timeout, and the driver can recover a stuck instrument with the class control requests **INITIATE_ABORT_BULK_IN / OUT** (then the matching status check) and **INITIATE_CLEAR**. The **USB488** subclass adds **READ_STATUS_BYTE**, which the tool exposes as **STB?**.

SCPI itself is the familiar hierarchical text: \`*IDN?\`, \`MEAS:VOLT:DC?\`, \`SOUR:VOLT 5.0\`, \`SYST:ERR?\`.

---

### 2. UI control mapping

| UI Element | Purpose |
| :--- | :--- |
| **CONNECT INSTRUMENT (WEBUSB)** | Opens a USBTMC device (class FE / subclass 03) from the browser's device picker and reads \`*IDN?\`. Needs a Chromium browser (Chrome / Edge) over HTTPS or localhost. After connecting, the tool picks a starting tab by instrument type. **DISCONNECT** closes it. |
| **TIMEOUT (ms)** | Per-operation timeout (default 5000, minimum 100). Raise it for slow measurements such as long sweeps or averaged readings. Shown once connected. |
| **ABORT / CLEAR** | Aborts a stuck bulk transfer and clears the instrument's USBTMC buffers without waiting for its busy queue; the log says whether the instrument confirmed. If it was not confirmed and the instrument still does not answer, reconnect. |
| **STB?** | USB488 READ_STATUS_BYTE: shows the status byte and which of MAV, EAV, ESB and RQS/MSS are set (an error message if the instrument does not support it). |
| **CONSOLE tab** | A **SCPI** line (Enter or **SEND**, <kbd>Up</kbd>/<kbd>Down</kbd> for history); commands containing \`?\` are queries and the reply is shown. |
| **Preset buttons** | Common commands (\`*IDN?\`, \`*RST\`, \`*CLS\`, \`*OPC?\`, \`SYST:ERR?\`, \`*TST?\`) plus presets for the detected scope, DMM, power supply or signal generator and its brand's dialect. |
| **check SYST:ERR? after each command** | Checkbox: queries the error queue after every command and logs a non-zero result as an instrument error. |
| **SCOPE tab** | **CH1-CH4** checkboxes, **POINTS** (not shown for Rigol / Siglent), **FETCH WAVEFORM** (chart, Vpp / min / max / mean / RMS / frequency / sample rate per channel, CSV per channel), **SCREENSHOT** and **SAVE IMAGE**. Waveform and screenshot support depends on the instrument family. |
| **DMM / PSU LOGGER tab** | **LIMITS** (optional low / high): a line under the controls says whether the latest reading is out of limits and how many readings were below or above. **MEASURE** function (DC/AC voltage, DC/AC current, 2- and 4-wire resistance, frequency, capacitance, temperature) or a custom query, an interval in ms (min 50), **START / STOP**, **CLEAR**, **CSV**, with Now / Min / Max / Mean / Std Dev and a live chart. |
| **SCRIPT tab** | One command per line, \`wait <ms>\` to pause, \`#\` comments, and \`repeat <n>\` ... \`end\` loops (nestable; at most 5000 expanded steps; unbalanced blocks are reported before anything is sent). **RUN SCRIPT** stops at the first failing command. **EXPORT PYVISA** downloads the expanded script as a PyVISA Python file (not run here). |
| **Exchanges log** | Every command (») and response («), errors (✗), with a button to save the log as a text file. |
| **PYVISA (console)** | Downloads the console command history (oldest first) as a PyVISA Python file. It is an export for the Python tool; nothing runs in the browser. Edit the placeholder VISA resource string before use (the browser does not expose it). |

---

### 3. Implementation & Architecture

- **Driver:** [\`src/utils/usbtmcDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/usbtmcDriver.js) — \`buildMsgOut\`/\`buildRequestIn\`/\`parseMsgIn\` for the framing, \`UsbTmcDevice\` with a rolling bTag, \`write\`/\`read\`/\`query\`/\`queryBinary\`, and fragment reassembly until EOM.
- **Workbench:** [\`src/components/tools/UsbTmcWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/UsbTmcWorkbench.jsx).
- **Instrument profiles:** [\`src/utils/scpiTools.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/scpiTools.js) detects the maker and family (Rigol, Keysight / Agilent, Siglent, Tektronix or generic) from the \`*IDN?\` reply and supplies the preset commands, IEEE 488.2 binary-block parsing, waveform scaling, screenshot capture and DMM function list.
- **Tests:** [\`tests/usbtmc.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/usbtmc.test.js) checks the header building/parsing and runs \`*IDN?\` and measurement queries against a simulated instrument. [\`tests/usbtmcExtras.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/usbtmcExtras.test.js) covers script expansion, logger statistics, limits and the PyVISA export (\`src/utils/usbtmcExtras.js\`). The tool itself has no demo mode: it needs a real USBTMC device.

**Similar tools:** PyVISA-shell, NI-VISA Interactive Control, Keysight Connection Expert and Rigol Ultra Sigma. This tool is browser-only and does not use VISA resource strings.

---

### 4. References

| Resource | Source |
| :--- | :--- |
| USBTMC | USB-IF USBTMC 1.0 and USBTMC-USB488 1.0 |
| Command syntax | SCPI 1999 / IEEE 488.2 |
| WebUSB | W3C WebUSB specification |
`
  }
];
