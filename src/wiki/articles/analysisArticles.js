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

The **Packet & Protocol Lab** turns raw serial streams from sniffing firmwares (such as ESP32 Marauder, Wi-Fi Pen Tool, or custom ESP-IDF promiscuous sniffers) into structured IEEE 802.11 network packet dissections, Wireshark-compatible PCAP captures, and custom embedded protocol decoders.

---

### 1. What Is This Tool & Why Do You Need It?

Normally, network cards filter out Wi-Fi frames that aren't addressed to your specific computer. In cybersecurity auditing and wireless protocol development, you need to see **everything** in the air: beacon frames announcing access points, probe requests from smartphones searching for known home Wi-Fi networks, deauthentication packets, and cryptographic key exchanges.

The **Packet & Protocol Lab** ingests raw promiscuous radio streams over serial, dissects the binary MAC headers in your browser, isolates WPA/WPA2 4-way handshakes, and lets you download standard \`.pcap\` files that open instantly in **Wireshark** or **Hashcat**.

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
<summary>Custom Protocol Framer: SLIP, COBS & Byte Stuffing Algorithms</summary>

When transmitting binary packets across raw serial channels without hardware flow control, embedded engineers use byte stuffing algorithms to prevent binary data from colliding with packet framing markers:

#### 1. SLIP (Serial Line Internet Protocol — RFC 1055)
- **Frame End**: \`0xC0\` (Octal \`0300\`).
- **Frame Escape**: \`0xDB\` (Octal \`0333\`).
- If data byte is \`0xC0\`, replace with \`0xDB 0xDC\`.
- If data byte is \`0xDB\`, replace with \`0xDB 0xDD\`.
- Widely used by ESP-IDF ROM bootloader and IP-over-serial stacks.

#### 2. COBS (Consistent Overhead Byte Stuffing)
- Encodes a packet of *N* bytes with at most $\lfloor N/254 \rfloor + 1$ bytes of overhead.
- Completely eliminates all zero (\`0x00\`) bytes from the payload.
- This allows \`0x00\` to serve as an infallible, self-synchronizing packet boundary delimiter in industrial telemetry and drone telemetry links.

</details>

---

### 3. Complete UI Control Mapping

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Parser Mode** | Dropdown | Selects active protocol dissector: 802.11 Wi-Fi, Raw Hex Stream, SLIP Framer, or COBS Framer. |
| **Clear Buffer** | Button | Resets packet capture table and frees internal memory buffers. |
| **Filter by MAC / SSID** | Text Input | Live search filter isolating packets matching specific BSSID, client MAC, or network name. |
| **Filter by Frame Type** | Dropdown | Isolates Management (Beacons, Probes, Deauths), Control (ACKs, RTS/CTS), or Data frames. |
| **Handshake Alert Banner**| Status Pill | Flashes green when a full or partial EAPOL 4-way handshake (or PMKID) is captured. |
| **Export PCAP** | Button | Generates standard Libpcap \`.pcap\` binary file containing all captured 802.11 frames with nanosecond timestamps. |
| **Packet Detail Drawer** | Drawer | Displays hierarchical tree decomposition of the selected packet down to individual bitfields. |

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Capturing a WPA2 Handshake with ESP32 Marauder
1. Connect your ESP32 running Marauder firmware to Skon's USB Tool.
2. Open the **Packet & Protocol Lab** and verify **Parser Mode** is set to **Wi-Fi 802.11**.
3. In the terminal drawer, send \`channel -s 6\` to lock onto your target AP's channel.
4. Send \`sniffraw\` or \`sniffpmkid\` to begin serial packet streaming.
5. In the workbench, observe incoming beacon frames confirming signal strength and SSID.
6. When a client reconnects, the green **Handshake Captured** banner illuminates.
7. Click **Export PCAP** to save the file as \`capture.pcap\`.
8. Open the PCAP file in Wireshark or pass it to \`aircrack-ng\` to verify cryptographic integrity!

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

#### 2. Kismet Daemon REST & WebSocket API Specification
Kismet functions as a headless multi-threaded C++ RF capture engine serving real-time JSON and WebSockets on port \`2501\`:
- \`GET /system/status.json\`: Server health, memory, thread pool, and total packets per second.
- \`GET /devices/views/all/devices.json\`: Master device catalog containing BSSID, SSID, channel frequency, signal RSSI (min/max/current), cryptography types, associated clients, and OUI vendors.
- \`GET /alerts/all_alerts.json\`: Wireless Intrusion Detection System (WIDS) alerts (Deauth floods, Rogue APs, Channel hop violations).
- \`GET /channels/channels.json\`: Channel utilization and RF congestion across 2.4GHz and 5GHz bands.
- \`GET /pcap/all.pcapng\`: Real-time streaming PCAP-NG capture file directly from monitor interfaces.
- \`ws://localhost:2501/devices/views/all/devices.ws\`: High-throughput binary WebSocket stream pushing delta device updates without polling overhead.

#### 3. WIDS Anomaly Detection Algorithms
1. **Deauthentication Flood Detection**: Measures moving rate of 802.11 Reason Code 1/2/3/7 management frames. If >50 deauth frames arrive per second directed at a single BSSID, a Critical WIDS alarm is generated.
2. **Rogue AP / Evil Twin Detection**: Flags when an established SSID suddenly broadcasts from an unfamiliar BSSID or with mismatched RSN/WPA capabilities.
3. **Null Probe Response**: Identifies rogue or misconfigured APs answering wildcard probe requests with malformed information elements.

</details>

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Capturing a WPA2 Handshake with ESP32 Marauder
1. Connect your ESP32 running Marauder firmware to Skon's USB Tool.
2. Open the **Packet & Protocol Lab** and verify **Parser Mode** is set to **Wi-Fi 802.11**.
3. In the terminal drawer, send \`channel -s 6\` to lock onto your target AP's channel.
4. Send \`sniffraw\` or \`sniffpmkid\` to begin serial packet streaming.
5. In the workbench, observe incoming beacon frames confirming signal strength and SSID.
6. When a client reconnects, the green **Handshake Captured** banner illuminates.
7. Click **Export PCAP** to save the file as \`capture.pcap\`.
8. Open the PCAP file in Wireshark or pass it to \`aircrack-ng\` to verify cryptographic integrity!

#### Walkthrough B: Dual-Band Auditing with Alfa AWUS036ACH & Kismet Studio
1. Plug your Alfa AWUS036ACH or AWUS1900 adapter into your workstation USB 3.0 port.
2. Open a terminal and put the Alfa adapter into monitor mode:
   \`\`\`bash
   sudo airmon-ng check kill && sudo airmon-ng start wlan1
   kismet -c wlan1mon
   \`\`\`
3. In Skon's USB Tool, switch to the **Kismet Studio (Alfa / 802.11)** tab.
4. Click **Connect Kismet** (or check **Simulate Alfa RF** if working offline).
5. The device catalog immediately populates with dual-band 2.4 GHz and 5 GHz Access Points and client stations.
6. Switch to **Channels & Congestion** to identify clear 5 GHz DFS channels or examine 2.4 GHz channel overlap on 1, 6, and 11.
7. Check the **WIDS Intrusion Alerts** tab to monitor for deauth floods, rogue APs, or beacon injection attacks in real time!
8. Click **WiGLE CSV** to export geolocated access points for wireless mapping submission.

---

### 5. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **No Packets Appearing in Table** | Firmware is not in raw packet streaming mode or wrong baud rate. | Ensure baud rate is 115200 or 921600. In Marauder, verify \`settings -s ForcePackets enable\`. |
| **Cannot Connect to Kismet (Port 2501)** | Kismet daemon is not running or blocked by local firewall. | Run \`kismet -c wlan1mon\` in terminal. Verify \`http://localhost:2501\` responds in browser. |
| **Alfa Adapter Not Entering Monitor Mode** | NetworkManager or wpa_supplicant reclaiming USB interface. | Run \`sudo airmon-ng check kill\` prior to starting monitor mode. Ensure correct DKMS driver is installed. |
| **FCS (Checksum) Errors on All Frames** | RF multipath interference or antenna impedance mismatch. | Attach external 2.4GHz/5GHz SMA antennas and keep adapter at least 1 meter away from USB 3.0 hubs. |
| **Missing Handshake Message 4** | Client was too far away for the sniffer to receive the low-power station ACK. | Move the sniffing antenna physically closer to the client laptop or smartphone. |

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
    title: '24MHz Logic Analyzer — 8-Channel Waveforms & Protocol Decoders',
    summary: 'Hardware digital signal analysis up to 24 MSps, edge triggers, protocol decoders for UART/SPI/I2C, sample buffers, and VCD export for Sigrok.',
    tags: ['Logic Analyzer', '24MHz', 'Waveforms', 'Protocol Decoder', 'Sigrok', 'VCD', 'SPI', 'I2C', 'UART'],
    readTime: '22 min read',
    content: `
# 24MHz Logic Analyzer — Digital Signal Workbench

The **Logic Analyzer** workbench transforms your browser into an 8-channel digital storage oscilloscope and protocol analyzer. Interfacing with low-cost USB logic hardware (such as Cypress FX2LP CY7C68013A boards or RP2040 PIO-based analyzers), it captures high-speed logic state transitions and decodes UART, SPI, and I2C packets directly over the waveform.

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
| **CH0** | Brown | 0V to 5.5V TTL | UART TX / I2C SCL / SPI SCK (Clock Line) |
| **CH1** | Red | 0V to 5.5V TTL | UART RX / I2C SDA / SPI MOSI (Data Master-Out) |
| **CH2** | Orange | 0V to 5.5V TTL | SPI MISO (Data Master-In) |
| **CH3** | Yellow | 0V to 5.5V TTL | SPI CS / SS (Chip Select Active-Low) |
| **CH4 - CH7**| Green/Blue/Violet/Grey | 0V to 5.5V TTL | Interrupt lines, PWM motor signals, GPIO triggers |
| **GND** | Black | **0V Reference** | **MANDATORY**: Must connect to target board ground! |

<details>
<summary>Hardware Architecture: Cypress FX2LP GPIF Engine & 24 MSps Nyquist Limits</summary>

#### Cypress FX2LP (CY7C68013A) Streaming Architecture
Low-cost $8 USB logic analyzers utilize the Cypress FX2LP microcontroller running custom open-source Sigrok firmware:
- **General Programmable Interface (GPIF)**: Bypasses the 8051 CPU core entirely. It latches Port B/D pins directly into internal FIFO buffers at 24 MHz driven by a 48 MHz crystal oscillator.
- **USB 2.0 High-Speed Bulk Streaming**: Pours uncompressed 8-bit samples across USB Bulk Endpoint 2 (512-byte packets) at up to **192 Mbps** ($24 \text{ MSps} \times 8 \text{ bits}$).
- **Host-Side Ring Buffer**: Skon's USB Tool ingests these bulk byte streams over WebUSB and queues them into a circular memory buffer rendered via an offscreen HTML5 canvas.

#### Nyquist-Shannon Sampling Constraints
To faithfully reconstruct digital square pulses without aliasing:
$$\text{Sample Rate} \ge 4 \times f_{\text{signal}}$$
- **115,200 baud UART**: Bit duration is $8.68\,\mu\text{s}$. At 2 MSps, each bit has 17 samples, providing excellent timing margin.
- **400 kHz Fast-Mode I2C**: Clock half-period is $1.25\,\mu\text{s}$. Requires at least 8 MSps (10 samples per half-period) to verify clock stretching and setup/hold times.
- **SPI at 4 MHz**: Requires the maximum 24 MSps rate (6 samples per clock cycle).

</details>

<details>
<summary>Sigrok / PulseView VCD File Format Specification</summary>

When clicking **Export VCD**, the analyzer generates standard IEEE 1364 **Value Change Dump** files compatible with Sigrok, PulseView, and GTKWave:

\`\`\`text
$date 2026-10-24 00:00:00 $end
$version Skon's USB Tool VCD Generator $end
$timescale 1ns $end
$scope module logic $end
$var wire 1 ! ch0 $end
$var wire 1 " ch1 $end
$var wire 1 # ch2 $end
$var wire 1 $ ch3 $end
$upscope $end
$enddefinitions $end
#0
0!
0"
1#
1$
#41
1!
#83
0!
\`\`\`
Every transition records the nanosecond timestamp (\`#41\`) followed by the logic state and channel token (\`1!\`), minimizing file sizes compared to raw CSV dumps.

</details>

---

### 3. Complete UI Control Mapping

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Connect Analyzer** | Button | Connects WebUSB device matching Cypress FX2LP VID \`0x04B4\` / PID \`0x8613\` or Sigrok VID \`0x0925\`. |
| **Sample Rate** | Dropdown | Selects acquisition sampling frequency from 20 kHz up to 24 MHz. |
| **Sample Depth** | Dropdown | Configures acquisition buffer size from 10k samples up to 10M samples. |
| **Trigger Channel** | Dropdown | Designates which channel initiates capture (None, CH0 through CH7). |
| **Trigger Type** | Dropdown | Selects trigger condition: Rising Edge (↑), Falling Edge (↓), or High/Low level. |
| **Start Capture** | Button | Arms the trigger and begins continuous or triggered data acquisition. |
| **Waveform Canvas** | Viewport | Interactive 8-channel timing diagram with zoom in/out (<kbd>+</kbd>/<kbd>-</kbd>) and pan controls. |
| **Decoder Selector** | Dropdown | Adds protocol decoders: I2C, SPI, or UART directly mapped to selected channels. |
| **Export VCD** | Button | Downloads capture session as an IEEE 1364 Value Change Dump for Sigrok/PulseView. |

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Decoding an I2C Sensor Bus
1. Connect **GND** to target board ground. Connect **CH0** to SCL (Clock) and **CH1** to SDA (Data).
2. Set **Sample Rate** to **8 MHz** and **Sample Depth** to **1M samples**.
3. Set **Trigger Channel** to **CH1** and **Trigger Type** to **Falling Edge** (catches the I2C START condition).
4. Click **Start Capture**.
5. Once data is captured, open the **Decoders** panel and select **I2C Decoder**.
6. Map SCL to CH0 and SDA to CH1.
7. The canvas instantly renders green START flags, hex address badges (e.g. \`0x68 [W]\`), ACK/NACK status, and hexadecimal register payloads!

---

### 5. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **\`USB Transfer Failed: Overflow\`** | Host computer USB bus cannot sustain 192 Mbps bulk transfer. | Lower sample rate from 24 MHz to 16 MHz or 12 MHz, or unplug other high-bandwidth USB 3 devices. |
| **Signals Always Read High (3.3V / 5V)** | Ground reference is not connected between analyzer and target. | Connect the black GND pin directly to the microcontroller or sensor ground plane. |
| **Decoded UART Characters are Gibberish** | Sample rate is too low or baud rate parameter in decoder is incorrect. | Ensure sample rate is at least 4x baud rate (e.g. at least 1 MHz sample rate for 115200 baud). |

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
    summary: 'Comprehensive vehicle network reverse engineering, SLCAN packet monitor, standard 11-bit and extended 29-bit CAN IDs, live OBD-II PID polling, and DTC clearing.',
    tags: ['CAN Bus', 'OBD-II', 'Automotive', 'SLCAN', 'TWAI', 'Vehicle Diagnostics', 'ECU', 'DTC', 'PID'],
    readTime: '24 min read',
    content: `
# CAN Bus & OBD-II Scanner — Automotive Workbench

The **CAN Bus & OBD-II Scanner** interfaces with CAN-to-USB adapters (such as Lawicel SLCAN adapters, CANable / Candlelight, or ESP32 TWAI transceivers like the SN65HVD230) to sniff automotive networks, reverse engineer CAN IDs, and query vehicle engine telemetries.

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

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Connect Adapter** | Button | Connects WebSerial to SLCAN hardware (CANable, Candlelight, ESP32 TWAI). |
| **CAN Bitrate** | Dropdown | Selects network baud rate: 125 kbps, 250 kbps, 500 kbps (Standard OBD-II), or 1 Mbps. |
| **Listen-Only Mode** | Toggle | Disables ACK generation, ensuring 100% passive sniffing without altering vehicle bus state. |
| **CAN Sniffer Table** | Table | Displays live IDs, period (ms), count, and payload bytes with byte-diff highlighting. |
| **Filter by CAN ID** | Input | Isolates specific 11-bit or 29-bit identifiers. |
| **Send CAN Frame** | Inputs + Button | Transmits custom arbitrary standard or extended frames onto the bus. |
| **OBD-II Telemetry Tab**| Tab | Switches to active diagnostic dashboard with virtual gauges (RPM, Speed, Temp). |
| **Read Fault Codes** | Button | Issues Mode 03 request to retrieve stored Diagnostic Trouble Codes (DTCs). |
| **Clear Fault Codes** | Button | Issues Mode 04 request to clear DTCs and extinguish the Check Engine MIL light. |

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Reverse Engineering Steering Wheel Controls
1. Connect your CANable adapter to the vehicle's OBD-II port (Pins 6 and 14).
2. Set **CAN Bitrate** to **500 kbps** and enable **Listen-Only Mode**.
3. Click **Connect Adapter**. Packets will begin streaming into the sniffer table.
4. Keep the vehicle idling and do not touch any controls. Let the packet counts stabilize.
5. Repeatedly press the **Volume Up** button on the steering wheel while watching the screen.
6. The byte-diff highlighter will flash red on the exact CAN ID and byte offset transmitting the button press!
7. Record the CAN ID (e.g. \`0x2C4\`) and payload byte pattern to integrate into your custom embedded steering wheel controller project!

---

### 5. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **\`SLCAN Error: Bus-Off (Flag 0x80)\`** | Bitrate mismatch or missing $120\Omega$ termination resistor. | Verify vehicle CAN speed (500 kbps for cars, 250 kbps for heavy trucks). Enable adapter termination jumper. |
| **No Packets on 2008+ Vehicle OBD-II Port**| Vehicle gateway ECU isolating OBD-II port from powertrain CAN. | Some modern vehicles require an active wakeup frame or direct tapping behind the gateway module. |
| **OBD-II PIDs Return No Response** | Ignition is off or vehicle uses non-standard diagnostic address. | Turn ignition to **ON / RUN** position (engine can be off). Ensure request is addressed to \`0x7DF\`. |

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

The **I2C & SPI Bus Explorer** enables interactive exploration, debugging, and reverse engineering of sensors, EEPROMs, displays, and peripheral chips connected to I2C or SPI buses via USB bridging hardware (such as Bus Pirate, CH341A, or ESP32 bus bridge firmware).

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

Serial Peripheral Interface (SPI) is a 4-wire full-duplex synchronous bus. Communication requires setting the matching **CPOL (Clock Polarity)** and **CPHA (Clock Phase)** mode:

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
| **Connect Bridge** | Button | Connects WebSerial to hardware adapter (Bus Pirate, ESP32 Bridge, or CH341A). |
| **Protocol Mode** | Selector | Toggles between I2C Mode and SPI Mode. |
| **I2C Clock Speed** | Dropdown | Selects bus frequency: Standard Mode (100 kHz) or Fast Mode (400 kHz). |
| **Scan I2C Bus** | Button | Sweeps all 120 possible 7-bit addresses (\`0x08\` to \`0x77\`) and marks responding nodes. |
| **Address Grid** | Hex Matrix | 16x8 visual matrix highlighting responding I2C addresses with chip identification badges. |
| **Register Address**| Input | Hexadecimal byte offset of target register to read or write. |
| **Read Register** | Button | Sends repeated START sequence to read target register value. |
| **Write Register** | Button | Transmits new byte value to target register. |
| **Live Register Watch**| Toggle | Periodically polls register at selectable intervals (50ms–1000ms) to display live changes. |

---

### 3. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Interrogating an Unknown I2C Sensor
1. Connect SDA, SCL, 3.3V, and GND from your bridge adapter to the sensor breakout.
2. Ensure pull-up resistors are installed (or enabled via software on the bridge).
3. In Skon's USB Tool, click **Connect Bridge** and set Mode to **I2C**.
4. Click **Scan I2C Bus**.
5. Address \`0x68\` responds with an ACK! The tool matches it against the built-in dictionary: *MPU-6050 6-Axis IMU or DS3231 RTC*.
6. In **Register Address**, enter \`0x75\` and click **Read Register**.
7. The sensor returns \`0x68\`. This confirms beyond doubt that the chip is an **InvenSense MPU-6050**!
8. Enter \`0x6B\` (Power Management 1) and write \`0x00\` to wake the accelerometer from sleep mode.

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
    summary: 'Master industrial RS-485 differential signaling, Modbus RTU framing, CRC-16 calculation, slave address polling, function codes 01-16, and endianness conversions.',
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
| **\`0x10\`** | Write Multiple Registers | Block writes multiple 16-bit setpoints simultaneously |

---

### 4. Float32 & Word Endianness Conversion

Modbus registers are strictly 16 bits wide. To transmit a 32-bit floating point number (like \`124.50 Volts\` or \`1520.40 kWh\`), the slave splits the 32 bits across two consecutive 16-bit registers (e.g. registers \`40001\` and \`40002\`).

Because the original 1979 Modbus specification didn't define 32-bit float order, manufacturers implemented four conflicting byte orders. If your reading displays as \`NaN\` or \`1.23e-38\`, switch the **Float Endianness** dropdown:
1. **Big-Endian (AB CD)**: High byte first, high word first (Standard for Schneider Electric).
2. **Little-Endian (CD AB)**: Low word first, high word second.
3. **Mid-Big / Byte Swap (BA DC)**: High word first, but bytes inside each word swapped.
4. **Mid-Little / Word Swap (DC BA)**: Standard for Eastron / Chint energy meters.

---

### 5. Complete UI Control Mapping

The workbench has two connection modes. **Live** talks to real hardware over a
USB-to-RS485 adapter; **Simulation** feeds synthetic inverter data so you can
explore the UI without hardware. A banner above the register table always states
which mode is active so you never mistake synthetic values for real ones.

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Connect Serial Port…** | Button | Shown when no serial port is open. Prompts the browser's port picker to attach your USB-RS485 adapter. |
| **Connect Live (RS-485)** | Button | Reopens the connected port at the selected baud (8-N-1) and polls the real slave. Responses are CRC-16 validated and Modbus exceptions are decoded; frames stream into the app's live terminal. |
| **Simulation** | Button | Connects a virtual inverter/energy-meter with synthetic (clearly labeled) holding registers — no hardware required. |
| **Slave ID Input** | Number | Target industrial node address ($1$ to $247$). |
| **Baud Rate** | Dropdown | 4800 / 9600 / 19200 / 38400 / 57600 / 115200 bps. The port is reopened at this rate in Live mode. |
| **Poll Once** | Button | Sends one Read Holding Registers (FC 0x03) request for registers 40001–40008 and renders the decoded table. |
| **Start Auto-Poll** | Toggle | Repeats the FC 0x03 read every ~1 second; toggles to "Auto-Polling (1s)" while active. |
| **Holding Registers Table** | Table | Live view of registers 40001–40008 with raw hex, uint16/int16, and scaled measurements (AC voltage, current, power, frequency, power factor, temperature, daily/lifetime energy). |
| **Write Single Register** | Form | Register Offset + Value (uint16) inputs and a **Write Register** button issuing FC 0x06; the echo response is CRC-validated before the write is reported as acknowledged. |

> The current build focuses on **Read Holding Registers (FC 0x03)** and **Write
> Single Register (FC 0x06)**. The driver (\`utils/modbusDriver.js\`) also builds
> frames for coils, discrete inputs, input registers, and multiple-register
> writes, and includes uint16/int16/uint32/float32 decoders used by the scaled
> table.

---

### 6. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Polling a Real RS-485 Energy Meter / Inverter (Live Mode)
1. Wire RS-485 **A (D-)** to the meter's **A/D-** and **B (D+)** to **B/D+**, with a common ground and $120\Omega$ termination at both ends of the run.
2. Click **Connect Serial Port…** and pick your USB-RS485 adapter in the browser prompt.
3. Set **Slave ID** to the meter's address (e.g. \`1\`) and **Baud Rate** to match the device (e.g. \`9600\`).
4. Click **Connect Live (RS-485)** — the port reopens at 9600 8-N-1 and an FC 0x03 read is issued automatically.
5. The Holding Registers table fills with CRC-validated values; the scaled column shows AC voltage, current, power, and frequency. Empty rows mean no/invalid response (check A/B polarity, baud, and slave ID).
6. Click **Start Auto-Poll** to watch the registers update once per second. Use **Write Single Register** (FC 0x06) to set a writable setpoint.

#### Walkthrough B: Exploring the UI Without Hardware (Simulation)
1. Click **Simulation** — a virtual solar inverter comes online with synthetic registers.
2. Poll and auto-poll behave exactly as in Live mode, but the banner reads **SIMULATION** and every log line is prefixed \`SIM:\` so the data is never mistaken for a real device.

---

### 7. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **\`Timeout: No response from slave\`** | Inverted A/B differential polarity or wrong slave address. | Swap wires A and B. Verify slave address configured in physical meter menu. |
| **\`Modbus CRC Mismatch\`** | RS-485 bus reflections or missing $120\Omega$ termination resistors. | Install a $120\Omega$ resistor across lines A and B at both physical ends of the cable run. |
| **Float Value Displays \`NaN\`** | Word endianness mismatch between master and slave PLC. | Toggle between Big-Endian, Mid-Little (Word Swap), and Little-Endian in the settings dropdown. |

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
    summary: 'High-speed 60 FPS real-time serial waveform grapher, auto-scaling, CSV telemetry parsers, multi-channel color assignment, and data logging.',
    tags: ['Plotter', 'Oscilloscope', 'Waveforms', 'ADC', 'Telemetry', 'Sensors', 'Graphing', 'CSV'],
    readTime: '18 min read',
    content: `
# Oscilloscope Plotter — Live Waveform Visualizer

The **Oscilloscope Plotter** transforms numeric serial streams from analog-to-digital converters (ADCs), IMU motion sensors, temperature probes, and power monitors into high-speed, real-time graphical waveforms rendered on an HTML5 canvas at 60 FPS.

---

### 1. What Is This Tool & Why Do You Need It?

Reading numerical numbers scrolling down a text terminal at 100 Hz is impossible for the human eye. If an analog sensor has noise spikes, if a PID temperature loop is oscillating, or if an accelerometer is vibrating, you need a visual graph to understand the signal over time.

The **Oscilloscope Plotter** reads numeric serial output from any microcontroller code without requiring specialized graphing libraries. It auto-scales the vertical voltage axis, tracks multi-channel variables with distinct neon colors, pauses for crosshair inspection, and exports clean CSV logs.

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
The plotter extracts the variable labels (\`voltage\`, \`current\`, \`temp\`) and automatically assigns them to the legend!

<details>
<summary>Advanced Real-Time Signal Processing: FFT & Rolling Statistics</summary>

The oscilloscope plotter computes dynamic statistics over the sliding sample window:
- **Peak-to-Peak ($V_{pp}$)**: $V_{\max} - V_{\min}$, highlighting power rail ripple voltage.
- **Root-Mean-Square ($V_{rms}$)**:
  $$V_{rms} = \sqrt{\frac{1}{N}\sum_{i=1}^N x_i^2}$$
- **Moving Average Filter**: Smooths high-frequency ADC quantization jitter over an adjustable 5 to 50 sample rolling window.
- **Frequency Counter**: Automatically measures signal cycle frequency by detecting upward zero/mean-crossing thresholds.

</details>

---

### 3. Complete UI Control Mapping

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Connect Serial** | Button | Connects WebSerial to microcontroller streaming numeric values. |
| **Canvas Viewport** | Canvas | Hardware-accelerated 60 FPS oscilloscope trace viewport with grid lines. |
| **Auto-Scale Y-Axis** | Toggle | Automatically adjusts minimum and maximum vertical bounds to fit signal peaks. |
| **Fixed Bounds Min/Max** | Inputs | Manually pins the vertical scale (e.g. \`0\` to \`4095\` for a 12-bit ADC). |
| **Time Window (Samples)**| Slider | Adjusts visible historical sample depth from 100 points up to 5,000 points. |
| **Pause / Inspect** | Button | Freezes canvas drawing and activates cursor inspection for delta voltage/time measurements. |
| **Export CSV** | Button | Downloads captured time-series buffer into a formatted CSV spreadsheet for Python/MATLAB. |

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
2. Open the **Oscilloscope Plotter** and connect at **115,200 baud**.
3. The canvas immediately starts plotting the analog value at 100 Hz.
4. Wave your hand over the photodiode and observe the immediate real-time voltage dip.
5. Click **Pause** and hover over the peak and trough to measure exact response rise time!

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
    summary: 'Connect two WebSerial ports concurrently to inspect, log, filter, and inject traffic between a master controller and slave device.',
    tags: ['Serial Bridge', 'MitM', 'Sniffer', 'Dual Port', 'Pass-Through', 'Injection', 'Reverse Engineering'],
    readTime: '18 min read',
    content: `
# MitM Serial Bridge — Dual-Port Interceptor

The **MitM Serial Bridge** enables hardware Man-in-the-Middle (MitM) inspection by managing two independent serial COM ports concurrently in your browser. It allows you to place your computer between two devices communicating over serial to inspect, modify, or inject packets on the fly.

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

#### Asynchronous Forwarding & Microsecond Latency
1. **Baud Rate Translation**: Port A and Port B do **not** need to operate at the same speed. You can bridge a legacy 9600 baud device on Port A to a 115200 baud modem on Port B.
2. **Buffer Overrun Protection**: When forwarding from a high-speed port to a low-speed port, the bridge implements FIFO backpressure to prevent packet loss.
3. **USB Frame Scheduling**: Modern USB host controllers poll bulk endpoints at 1 ms intervals. For high-speed packet exchanges, Skon's USB Tool utilizes zero-copy ArrayBuffer piping to minimize browser thread latency to under $1.5\,\text{ms}$.

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
| **Port A Connect** | Button + Dropdown | Connects first WebSerial port with independent baud rate and flow control options. |
| **Port B Connect** | Button + Dropdown | Connects second WebSerial port with independent baud rate and flow control options. |
| **Bridge Active Toggle** | Switch | Engages or disengages bidirectional automatic packet forwarding. |
| **Stream Viewer** | Viewport | Split-column traffic log color-coding packets as \`A -> B\` (Blue) or \`B -> A\` (Green). |
| **Inject to Port A** | Input + Button | Transmits custom hex or ASCII string towards Device A. |
| **Inject to Port B** | Input + Button | Transmits custom hex or ASCII string towards Device B. |
| **Packet Filter / Mangle**| Panel | Regex rules to drop specific packets or alter payload bytes on the fly. |

---

### 4. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Intercepting Scooter Dashboard Communications
1. Unplug the 4-wire waterproof connector between the scooter handlebar dashboard and motor controller.
2. Connect Adapter A to the dashboard harness and Adapter B to the controller harness.
3. In Skon's USB Tool, connect Port A at **115,200 baud** and Port B at **115,200 baud**.
4. Enable **Bridge Active**. The scooter powers on normally!
5. In the stream viewer, observe periodic 100ms packets flowing back and forth.
6. Pull the brake lever: observe which byte flips value in the \`A -> B\` stream.
7. Use the **Inject to Port B** bar to send modified speed limit bytes to unlock higher acceleration modes!

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

The **CyberChef Workbench** in Skon's USB Tool brings the full architectural power of GCHQ's CyberChef into a high-performance, asynchronous Web Worker pipeline. It enables reverse engineers, firmware auditors, and penetration testers to manipulate binary, hex, encrypted, and obfuscated payloads in real-time without stuttering the browser DOM.

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

All 80+ operations auto-register into \`registry\`, allowing case-insensitive lookup by canonical name or normalized snake_case ID.

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
  - Analysts can toggle Auto-Bake off when working with massive multi-megabyte payloads or CPU-intensive algorithms, switching to manual **"BAKE!"** triggers.
- **Multi-Tab Architecture**:
  - Open multiple concurrent analysis sessions across independent tabs.
  - Each tab preserves its own isolated Input payload, Recipe configuration, Output format, and debugging breakpoint state.
- **Chunked File Ingestion & Drag-and-Drop**:
  - Drop binary firmwares, PCAP slices, or memory dumps directly onto the input drop zone.
  - Files are read as zero-copy \`ArrayBuffer\` streams and piped cleanly into the Dish without UI freezing.
- **Output Views**:
  - Instant one-click toggling between **Raw Text**, **Hex Bytes**, **Base64 String**, and **Formatted Hexdump** (16-byte aligned with ASCII gutter).
  - Includes a **"Replace Input with Output"** button for iterative multi-stage deobfuscation.

---

### 6. The "Magic" Heuristic Engine v2 (\`magic.js\`)

When inspecting unfamiliar firmware chunks or network payloads, reverse engineers often don't know what encoding was applied. The **Magic Engine v2** solves this using multi-step chaining and a 3-stage heuristic diagnostic:

#### 1. Multi-Step Chaining (Depth ≤ 3)
Rather than testing single encodings in isolation, Magic v2 utilizes a breadth-first search (BFS) over high-yield deobfuscation paths:
- \`From Base64\` -> \`Gunzip\`
- \`From Hex\` -> \`From Base64\`
- \`From Base85\` -> \`Raw Inflate\`

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
Calculates the proportion of bytes falling within printable ranges ($[32..126, 9, 10, 13]$). If a trial transformation raises printable density above $75\\%$, or exposes recognized magic bytes, it generates a high-confidence recommendation with one-click recipe application.

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
   - Configurable rolling buffer window (2KB, 5KB, 10KB, or 50KB) prevents memory exhaustion and DOM freezing during high-baud transmissions.
   - Slices incoming byte buffers to continuously retain only the most recent $N$ bytes.
3. **Continuous Auto-Bake Pipeline**:
   - In combination with Auto-Bake, the Web Worker decodes the streaming telemetry buffer in the background at 300ms intervals, giving immediate live deciphering of checksums, decodings, or ciphers.

---

### 8. Interactive Hex Editor & Two-Way Synchronization

The Baked Output pane includes a native 16-bytes-per-line **Interactive Hex Editor**:

- **Dual-Pane Grid**:
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

### 10. Comprehensive Operation Suites Reference (80+ Operations)

| Module | Key Operations | Description & Underlying Engines |
| :--- | :--- | :--- |
| **Cryptography** | AES, DES, Triple DES, RC4, Blowfish, XOR Brute Force, RSA, Bcrypt, Scrypt | Symmetric ciphers (CBC, ECB, CTR, CFB, OFB) via \`crypto-js\`, key derivation, and automated single-byte XOR key brute-forcing. |
| **Compression** | Gzip, Gunzip, Raw Deflate, Raw Inflate, Zip, Unzip | RFC 1952 / 1951 Deflate via \`pako\` and full ZIP archive creation/extraction via \`JSZip\`. |
| **Parsing** | Parse JWT, Parse X.509, Parse ASN.1, Parse IPv6, Parse URI, Parse User Agent, JSON Beautify/Minify, XML Beautify | Token verification via \`jwt-decode\`, RFC 5952 IPv6 formatting, ASN.1 DER parser, and structural formatters. |
| **Extractors** | Extract IPs, Domains, URLs, Emails, MACs, Hashes, Base64 | High-performance regex scanners isolating indicators of compromise (IOCs) and encoded strings. |
| **Networking** | Change IP Format, Generate UUID, Parse MAC address | Hex, decimal, octal, dotted-quad IP conversions and RFC 4122 v4 UUID generators. |
| **Forensics** | Detect File Type, Extract EXIF, Identify Hash | Magic bytes file signature analyzer, EXIF metadata extractor, and hash format identifier. |
| **Flow Control** | Fork, Merge, Register, Subsection, Label, Jump | Multi-branch splitting, register persistence, regex sub-scoping, and controlled execution loops. |
| **Arithmetic / Logic** | Sum, Mean, Median, Bit-shift, Bitwise AND/OR/XOR | Multi-radix numeric computations, statistical aggregations, and bit-level logic operations. |
| **Date / Time** | From UNIX Timestamp, To UNIX Timestamp, Parse DateTime | Epoch seconds/milliseconds bidirectional conversions and ISO 8601 UTC timestamp parsing. |
| **Data Format** | To/From Base32, Base58, Base85, Hexdump, Decimal, Binary, Base64, Hex, URL | Radix converters, Bitcoin Base58, RFC 1924 Base85, and Wireshark-compatible hexdump formats. |
| **Hashing** | MD5, SHA-1, SHA-256, SHA-3, BLAKE2b, CRC-32, Adler-32 | Cryptographic digests including Keccak and RFC 7693 BigInt BLAKE2b-512. |
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
   - For tabular outputs (such as *Parse CSV*, TSV datasets, or regex extractor lists of IOCs).
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
    - **Reverse String**: \`return input.split('').reverse().join('');\`
    - **Uppercase**: \`return input.toUpperCase();\`
    - **Filter Lines**: \`return input.split('\\n').filter(l => l.trim()).join('\\n');\`
- **Error Handling**:
  - Runtime exceptions or syntax faults are trapped and surfaced as clear \`Custom Script Execution Error\` alerts without crashing the worker or browser.

---

### 13. Recipe Portability & Standalone HTML Session Export

Sharing and archiving multi-stage analysis workflows is supported through comprehensive portability features:

1. **Recipe Sharing (Import/Export)**:
   - **Save Recipe**: Serializes the current operation pipeline and parameter dictionary into a downloadable \`.cyberchef\` (or \`.json\`) file.
   - **Load Recipe**: Uploads an existing \`.cyberchef\` configuration file, automatically reconstructing the pipeline UI and triggering an immediate re-bake.
   - **Copy Recipe**: One-click clipboard export of clean JSON recipe arrays for sharing in team documentation, incident tickets, or chat channels.
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
- **Fuzzy Search**: Filter across all 80+ operations, saved recipes, and UI actions.
- **Immediate Execution**:
  - \`Ctrl+Enter\`: Force Bake current recipe.
  - \`Ctrl+S\`: Save recipe / download output.
  - \`Ctrl+Z\`: Revert the last recipe change with full undo history stack.
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
   - A **Clear History** button allows purging all snapshots at any time.

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
   - Choose between **Exact Match** (\`assert.strictEqual\`) and **Fuzzy Contains** assertions.
2. **Execution & Feedback**:
   - Click **Run All Tests** to execute the pipeline through the Chef engine in isolated dishes.
   - Passing tests display a green checkmark with execution latency in milliseconds.
   - Failing tests display a red X with a visual side-by-side diff comparing Expected vs. Actual output.
3. **Persistence**:
   - Test suites are persisted to browser \`localStorage\` keyed by recipe signature, ensuring regression suites are retained across sessions.

---

### 20. Presentation Mode & Dynamic Theming

Sharing technical findings with non-technical stakeholders or presenting during security reviews requires a clean, distraction-free interface:

1. **Presentation Mode**:
   - Located in the top action bar: click **Presentation Mode**.
   - Collapses the Operations library and Recipe pipeline columns, expanding the Input and Output decks across the entire 12-column viewport.
   - CodeMirror editors expand with line numbers and syntax highlighting, ideal for screenshots, reports, and live conference demonstrations.
2. **Multi-Palette Theming**:
   - **Cyberpunk Dark**: Sleek deep-slate and cyan interface designed for extended analytical sessions.
   - **Matrix Green**: High-contrast pure black background (\`#000000\`) with phosphor neon green accents (\`#00ff66\`) and monospace terminal aesthetics.
   - **Classic Light**: Clean light-gray and slate styling tailored for standard office environments, documentation, and high-visibility displays.
   - Theme selections persist across browser sessions via \`localStorage\`.
`
  }
];



