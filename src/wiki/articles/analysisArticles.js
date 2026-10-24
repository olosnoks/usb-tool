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
    readTime: '18 min read',
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

### 3. Hardware Setup & Connection Guide

1. **Hardware Required**: Any ESP32 or ESP8266 flashed with a sniffer firmware (e.g. **ESP32 Marauder**, **Wi-Fi Pen Tool**, or the **ESP-IDF Sniffer Example**).
2. **Wiring**: Connect via USB directly. Ensure baud rate is set to **115200** (or **921600** for high-volume promiscuous captures).
3. **Antenna Positioning**: For maximum packet range, use an ESP32 board equipped with an external SMA antenna connector (like the ESP32-WROVER-IB or LilyGO T-Display S3) rather than an onboard PCB trace antenna.

---

### 4. Step-by-Step Walkthrough in Skon's USB Tool

1. Connect to your sniffer board in the **Terminal** or open the **Packet & Protocol Lab** directly.
2. In the Packet Lab toolbar, ensure the **Parser Mode** is set to **Wi-Fi 802.11**.
3. Issue a sniffing command in your firmware (e.g. \`sniffraw\` or \`sniffpmkid\` in Marauder).
4. Watch the packet table populate with real-time rows showing:
   - Packet Index.
   - Signal Strength (RSSI badge with green/amber/red indicator).
   - Frame Type & Subtype.
   - Source MAC & Destination MAC (with vendor OUI manufacturer lookup).
   - SSID Name (for Beacons and Probes).
5. **EAPOL Handshake Alert**: When a client connects or reconnects to an AP, the tool isolates the EAPOL 4-way handshake frames (Messages 1, 2, 3, and 4) and flashes a green **Handshake Captured** banner.
6. **Export PCAP**: Click **Export PCAP** to download a standard Libpcap \`.pcap\` file. Open this file in **Wireshark** to inspect full decryptable payloads.
`
  },
  {
    id: 'logic-analyzer',
    toolId: 'logic-analyzer',
    category: 'analysis',
    title: '24MHz Logic Analyzer — 8-Channel Waveforms & Protocol Decoders',
    summary: 'Hardware digital signal analysis up to 24 MSps, edge triggers, protocol decoders for UART/SPI/I2C, sample buffers, and VCD export for Sigrok.',
    tags: ['Logic Analyzer', '24MHz', 'Waveforms', 'Protocol Decoder', 'Sigrok', 'VCD', 'SPI', 'I2C', 'UART'],
    readTime: '16 min read',
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

### 3. Step-by-Step Usage Guide

1. **Connect Ground First**: Always connect the analyzer's GND pin to the target board's GND before plugging in any channel leads to avoid static discharge damage.
2. **Attach Probe Leads**: Connect CH0 to your clock line (e.g. SCL) and CH1 to your data line (e.g. SDA).
3. **Select Sample Rate & Depth**:
   - Choose **Sample Rate** from 20 kHz up to 24 MHz.
   - Choose **Sample Depth** (e.g. 100k to 1M samples).
4. **Configure Trigger**:
   - Without a trigger, the analyzer captures immediately when you click start.
   - To catch a specific event, set **Trigger Channel** to CH3 (SPI Chip Select) and select **Falling Edge**. The analyzer will idle silently until the chip select line drops low to initiate a transfer!
5. **Click Capture**: The canvas renders all 8 channels with timing grid lines, pan/zoom controls, and delta time measurement cursors.
6. **Activate Protocol Decoders**:
   - **I2C Decoder**: Assign SCL to CH0, SDA to CH1. The tool overlays green START markers, 7-bit hex addresses, ACK/NACK badges, and data payload bytes.
   - **UART Decoder**: Assign RX to CH1, set 115200 baud, 8-N-1. The tool renders ASCII characters directly inside the waveform pulses.
`
  },
  {
    id: 'can-bus',
    toolId: 'can-bus',
    category: 'analysis',
    title: 'CAN Bus & OBD-II Scanner — Automotive Diagnostics & Reverse Engineering',
    summary: 'Comprehensive vehicle network reverse engineering, SLCAN packet monitor, standard 11-bit and extended 29-bit CAN IDs, live OBD-II PID polling, and DTC clearing.',
    tags: ['CAN Bus', 'OBD-II', 'Automotive', 'SLCAN', 'TWAI', 'Vehicle Diagnostics', 'ECU', 'DTC', 'PID'],
    readTime: '18 min read',
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

### 3. OBD-II Port Pinout Guide

Under the steering wheel of any 2008+ car:
- **Pin 4**: Chassis Ground.
- **Pin 5**: Signal Ground.
- **Pin 6**: **CAN High (CAN_H)** (ISO 15765-4 High Speed).
- **Pin 14**: **CAN Low (CAN_L)** (ISO 15765-4 High Speed).
- **Pin 16**: **Battery Power (+12V DC)**.

---

### 4. Step-by-Step Usage Guide

#### A. Live CAN Packet Sniffer & Reverse Engineering
1. Connect your CAN adapter to the OBD-II port and select the baud rate (usually **500 kbps** for modern cars, **250 kbps** for trucks/older cars).
2. Click **Start Sniffing**.
3. Watch hundreds of packets stream in.
4. **Delta Highlighting**: Bytes that change value flash orange/red. To find a steering wheel control or door lock ID:
   - Keep the car still.
   - Press the steering wheel volume button or lock the doors.
   - Observe which ID flashes in the table!
5. **ID Masking**: Enter the discovered ID (e.g. \`0x1E5\`) in the filter bar to isolate that specific computer.

#### B. Live OBD-II Engine Diagnostics
1. Click the **OBD-II Telemetry** tab.
2. Click **Scan Supported PIDs**. The tool broadcasts a request to functional address \`0x7DF\`.
3. The engine ECU responds with its capability bitmap.
4. The scanner automatically polls Engine RPM, Vehicle Speed, Coolant Temperature, and Throttle Position.
5. **Read Trouble Codes (Mode 03)**: Queries stored Diagnostic Trouble Codes (e.g. \`P0171\` System Too Lean).
6. **Clear Trouble Codes (Mode 04)**: Sends \`0x01 0x04\` to clear DTCs and turn off the Check Engine light.
`
  },
  {
    id: 'bus-explorer',
    toolId: 'bus-explorer',
    category: 'analysis',
    title: 'I2C & SPI Bus Explorer — 1-Click Chip Identification & Registers',
    summary: 'Hardware bus interrogation, 7-bit I2C address scanner 0x08-0x77, known chip dictionary lookup, SPI mode 0-3 register watch, and memory dump.',
    tags: ['I2C', 'SPI', 'Bus Explorer', 'Chip Identification', 'Sensors', 'Registers', 'EEPROM', 'OLED'],
    readTime: '15 min read',
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

### 2. Interactive Register Read & Write

Once a chip is located:
1. Select the discovered device address.
2. **Read Register**: Enter register offset in hex (e.g. \`0x75\` on address \`0x68\`).
   - The tool sends a Write with register \`0x75\`, issues a repeated START, and reads 1 byte.
   - For an MPU-6050, it returns \`0x68\` (**WHO_AM_I** verification confirmed!).
3. **Write Register**: Enter target register and new byte value (e.g. writing \`0x00\` to register \`0x6B\` clears the sleep bit and wakes up the sensor).
4. **Live Register Watch**: Set up periodic polling (50ms to 1000ms) on data registers (such as Accelerometer X-axis high/low bytes at \`0x3B\` and \`0x3C\`) to see real-time sensor measurements update live on the screen!
`
  },
  {
    id: 'modbus-rtu',
    toolId: 'modbus-rtu',
    category: 'analysis',
    title: 'Modbus RTU & RS-485 — Industrial Telemetry & Holding Registers',
    summary: 'Master industrial RS-485 differential signaling, Modbus RTU framing, CRC-16 calculation, slave address polling, function codes 01-16, and endianness conversions.',
    tags: ['Modbus', 'RS-485', 'Industrial', 'Holding Registers', 'PLC', 'CRC-16', 'Inverter', 'Telemetry'],
    readTime: '16 min read',
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
`
  },
  {
    id: 'plotter',
    toolId: 'plotter',
    category: 'analysis',
    title: 'Oscilloscope Plotter — Multi-Channel Real-Time Waveforms',
    summary: 'High-speed 60 FPS real-time serial waveform grapher, auto-scaling, CSV telemetry parsers, multi-channel color assignment, and data logging.',
    tags: ['Plotter', 'Oscilloscope', 'Waveforms', 'ADC', 'Telemetry', 'Sensors', 'Graphing', 'CSV'],
    readTime: '12 min read',
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

### 3. Interactive Controls & Features

- **Channel Palette**: Automatically color-codes channels using high-contrast neon cyber colors (Cyan, Amber, Emerald, Rose, Purple).
- **Auto-Scale vs Fixed Range**:
  - **Auto-Scale**: Continuously expands and contracts the Y-axis to fit incoming data peaks.
  - **Fixed Range**: Lock the Y-axis bounds (e.g. \`0\` to \`4095\` for a 12-bit ESP32 ADC, or \`-16.0\` to \`+16.0\` for a ±16g accelerometer).
- **Buffer Depth Slider**: Adjust the horizontal time window from 100 historical points up to 5,000 points.
- **Freeze & Crosshair Inspection**: Click **Pause** to freeze the waveform. Hovering your mouse over the canvas displays exact time offsets and numeric values.
- **Export CSV**: Download the captured buffer as a \`.csv\` spreadsheet ready for MATLAB, Python pandas, or Excel.
`
  },
  {
    id: 'bridge',
    toolId: 'bridge',
    category: 'analysis',
    title: 'MitM Serial Bridge — Dual-Port Pass-Through & Sniffer',
    summary: 'Connect two WebSerial ports concurrently to inspect, log, filter, and inject traffic between a master controller and slave device.',
    tags: ['Serial Bridge', 'MitM', 'Sniffer', 'Dual Port', 'Pass-Through', 'Injection', 'Reverse Engineering'],
    readTime: '13 min read',
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

### 3. Step-by-Step Usage Guide

1. Open **Port A** and set the baud rate matching Device A (e.g. 115,200).
2. Open **Port B** and set the baud rate matching Device B.
3. Toggle **Bridge Active**:
   - Packets arriving on Port A are displayed with a blue **A -> B** arrow and immediately forwarded to Port B.
   - Packets arriving on Port B are displayed with a green **B -> A** arrow and immediately forwarded to Port A.
4. **Packet Injection**: Type a custom command into the injection bar and select whether to inject it towards Device A or Device B.
5. **Drop / Mangle Rules**: Define pattern match rules to drop specific packets (e.g. dropping speed limit commands) or replace bytes on the fly.
`
  }
];

