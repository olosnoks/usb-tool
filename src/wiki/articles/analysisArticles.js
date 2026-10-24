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

---

### 5. Complete Troubleshooting & Diagnostic Matrix

| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| **No Packets Appearing in Table** | Firmware is not in raw packet streaming mode or wrong baud rate. | Ensure baud rate is 115200 or 921600. In Marauder, verify \`settings -s ForcePackets enable\`. |
| **FCS (Checksum) Errors on All Frames** | RF multipath interference or antenna impedance mismatch. | Attach external 2.4GHz SMA antenna and keep sniffer at least 1 meter away from USB 3.0 cables. |
| **Missing Handshake Message 4** | Client was too far away for the sniffer to receive the low-power station ACK. | Move the sniffing antenna physically closer to the client laptop or smartphone. |

---

### 6. Upstream Standards & Engineering Attribution

| Standard / Component | Authoring Organization / Maintainers | Reference & Specification |
| :--- | :--- | :--- |
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

| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| **Connect RS-485** | Button | Connects WebSerial to USB-to-RS485 adapter at configured baud rate (e.g. 9600, 19200, 115200). |
| **Slave ID Input** | Number | Target industrial node address ($1$ to $247$). Address $0$ is broadcast. |
| **Function Code** | Dropdown | Selects active Modbus action (Read Holding Registers, Read Input Registers, Write Single/Multiple). |
| **Start Address** | Number | Memory register offset ($0$ to $65535$). |
| **Register Quantity** | Number | Number of contiguous 16-bit words to query ($1$ to $125$). |
| **Execute Query** | Button | Packages frame, computes CRC-16, transmits over RS-485, and parses response. |
| **Float Endianness** | Dropdown | Decodes 32-bit float pairs using AB CD, CD AB, BA DC, or DC BA word layouts. |
| **Poll Rate (ms)** | Slider | Sets automatic recurring query cycle from 100ms to 10,000ms. |

---

### 6. Step-by-Step Engineering Walkthroughs

#### Walkthrough A: Polling an Industrial 3-Phase Energy Meter
1. Connect RS-485 **A** to meter **A+** and RS-485 **B** to meter **B-**.
2. Connect your USB-RS485 adapter and click **Connect RS-485** at **9600 baud, 8-N-1**.
3. Set **Slave ID** to \`1\`. Set **Function Code** to \`0x04 (Read Input Registers)\`.
4. Set **Start Address** to \`0x0000\` and **Quantity** to \`2\` (reading Voltage across registers 0 and 1).
5. Set **Float Endianness** to **Big-Endian (AB CD)**.
6. Click **Execute Query**. The workbench unpacks the IEEE 754 float: \`230.45 Volts AC\`!
7. Engage **Auto-Poll** to monitor real-time mains line voltage fluctuations.

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
  }
];
