/**
 * Analysis & Protocol Lab Wiki Articles
 * Covering Packet Lab, Logic Analyzer, CAN Bus, I2C/SPI Explorer, Modbus RTU, Plotter, and MitM Bridge
 */

export const ANALYSIS_ARTICLES = [
  {
    id: 'packet-analyzer',
    toolId: 'packet-analyzer',
    category: 'analysis',
    title: 'Packet & Protocol Lab — 802.11 Dissector, PCAP & Framer',
    summary: 'Deep-dive into Wi-Fi 802.11 management frames, EAPOL 4-way handshakes, PCAP file export, and custom serial packet framing.',
    tags: ['Wi-Fi', '802.11', 'PCAP', 'Packet Framer', 'Hex Stream', 'Dissector'],
    readTime: '7 min read',
    content: `
# Packet & Protocol Lab — 802.11 Dissector & PCAP Lab

The **Packet & Protocol Lab** turns raw serial streams from sniffing firmwares (such as ESP32 Marauder, Wi-Fi Pen Tool, or custom promisc sniffers) into structured network packet dissections, Wireshark-compatible PCAP captures, and custom protocol decoders.

---

### How Promiscuous Sniffing Works
When an ESP32 or ESP8266 enters promiscuous mode (\`esp_wifi_set_promiscuous(true)\`), the radio baseband stops filtering packets addressed to other MAC addresses. Every raw frame floating through the air on the tuned channel is passed to the software callback with its Radio Information Header (RSSI, channel, rate).

The sniffing firmware prefixes these raw frames with a serial envelope (such as Marauder packet framing or SLIP delimiters) and streams them over UART at 115,200 or 921,600 bps.

---

### Key Capabilities

#### 1. 802.11 Frame Dissector
Incoming packets are parsed in real time into IEEE 802.11 standard structures:
- **Management Frames**:
  - **Beacons & Probe Responses**: Broadcasts announcing SSIDs, BSSIDs, supported rates, and encryption flags (WPA2-PSK, WPA3-SAE, Open).
  - **Deauthentication & Disassociation**: Reason codes (e.g. Code 7 = Class 3 frame received from nonassociated STA), identifying deauth attacks.
- **Control Frames**: RTS (Request to Send), CTS (Clear to Send), ACK (Acknowledgment).
- **Data Frames**: EAPOL 4-Way Handshakes and PMKID key exchanges.

#### 2. EAPOL & Handshake Detection
The lab continuously monitors for EAPOL frames (EtherType \`0x888E\`). When Messages 1, 2, 3, or 4 of a WPA/WPA2 4-way handshake are detected:
- The handshake indicator flashes green.
- The station and access point MAC addresses are locked.
- The raw handshake is queued for instant PCAP export for password audit via Hashcat or John the Ripper.

#### 3. Live Hex Stream Inspector
Toggle the Hex Stream view to see raw byte streams side-by-side with ASCII representations:
- 16-byte aligned rows with hex offsets.
- Highlights unprintable control characters and high-order ASCII.
- Freeze and search hex patterns or byte sequences.

#### 4. Custom Packet Framer
Test custom embedded protocols (such as COBS, SLIP, or Header-Length-Payload-CRC framing) by defining custom delimiters and verification algorithms.
`
  },
  {
    id: 'logic-analyzer',
    toolId: 'logic-analyzer',
    category: 'analysis',
    title: '24MHz Logic Analyzer — 8-Channel Waveforms & Decoders',
    summary: 'Hardware digital signal analysis up to 24 MSps, edge triggers, protocol decoders for UART/SPI/I2C, and VCD export for Sigrok.',
    tags: ['Logic Analyzer', '24MHz', 'Waveforms', 'Protocol Decoder', 'Sigrok', 'VCD'],
    readTime: '6 min read',
    content: `
# 24MHz Logic Analyzer — Digital Signal Workbench

The **Logic Analyzer** workbench interfaces with low-cost USB logic hardware (such as Cypress FX2LP CY7C68013A boards or RP2040-based PIO analyzers) to capture and decode high-speed digital logic signals directly in the browser.

---

### Hardware Specifications & Pinout

| Channel | Typical Assignment | Voltage Level |
| :--- | :--- | :--- |
| **CH0** | UART TX / I2C SCL / SPI SCK | 3.3V / 5V TTL Tolerant |
| **CH1** | UART RX / I2C SDA / SPI MOSI | 3.3V / 5V TTL Tolerant |
| **CH2** | SPI MISO | 3.3V / 5V TTL Tolerant |
| **CH3** | SPI Chip Select (CS) | 3.3V / 5V TTL Tolerant |
| **CH4 - CH7** | General Purpose Inputs / Interrupts | 3.3V / 5V TTL Tolerant |
| **GND** | Mandatory Common Ground | 0V Reference |

---

### Step-by-Step Usage

1. **Connect Ground**: Attach the logic analyzer's GND pin to the target board's GND before connecting any signal leads.
2. **Attach Probe Channels**: Connect CH0-CH7 to the lines of interest (e.g. SCL and SDA for I2C).
3. **Select Sample Rate**:
   - For 115,200 baud UART: 1 MSps to 2 MSps is ideal (10-20x oversampling).
   - For 400kHz Fast-Mode I2C: 4 MSps to 8 MSps.
   - For SPI up to 2MHz: 16 MSps to 24 MSps.
4. **Configure Trigger**:
   - Choose the trigger channel (e.g. CH3 for SPI CS falling edge).
   - Select trigger type: **Rising Edge**, **Falling Edge**, or **Level (HIGH/LOW)**.
5. **Start Capture**: Click **Capture**. Once the trigger condition is met, the circular buffer freezes and renders the digital waveform canvas.
6. **Apply Protocol Decoders**:
   - **UART Decoder**: Select channel, baud rate, data bits (8), parity (None), and stop bits (1) to decode ASCII and hex bytes directly over the waveform.
   - **I2C Decoder**: Assign SCL and SDA to decode START, 7-bit Address, READ/WRITE bit, ACK/NACK, and data bytes.
   - **SPI Decoder**: Assign SCK, MOSI, MISO, and CS to decode full-duplex SPI transactions.
7. **Export to VCD**: Click **Export VCD** to save the capture in standard Value Change Dump format for in-depth analysis in Sigrok / PulseView.
`
  },
  {
    id: 'can-bus',
    toolId: 'can-bus',
    category: 'analysis',
    title: 'CAN Bus & OBD-II Scanner — Vehicle Diagnostics & Sniffing',
    summary: 'Automotive bus reverse engineering, SLCAN packet monitor, standard 11-bit and extended 29-bit CAN IDs, and live OBD-II PID polling.',
    tags: ['CAN Bus', 'OBD-II', 'Automotive', 'SLCAN', 'TWAI', 'Vehicle Diagnostics'],
    readTime: '7 min read',
    content: `
# CAN Bus & OBD-II Scanner — Automotive Diagnostics

The **CAN Bus & OBD-II Scanner** interfaces with CAN-to-USB adapters (such as Lawicel SLCAN adapters, Candlelight / CANable, or ESP32 TWAI transceivers like the SN65HVD230) to sniff automotive networks, reverse engineer CAN IDs, and query vehicle engine telemetries.

---

### Physical Layer & Wiring Guide

CAN Bus uses a differential pair:
- **CAN_H (CAN High)**: Driven to ~3.5V during dominant bits; relaxes to 2.5V during recessive bits.
- **CAN_L (CAN Low)**: Driven to ~1.5V during dominant bits; relaxes to 2.5V during recessive bits.
- **Termination**: Both ends of the physical CAN bus MUST have **120-ohm termination resistors** between CAN_H and CAN_L (total bus resistance: 60 ohms).

---

### Standard vs Extended CAN Framing

| Frame Type | Identifier Length | Range | Use Case |
| :--- | :--- | :--- | :--- |
| **Standard (CAN 2.0A)** | 11 bits | \`0x000\` to \`0x7FF\` | Most passenger vehicle powertrain buses |
| **Extended (CAN 2.0B)** | 29 bits | \`0x00000000\` to \`0x1FFFFFFF\` | Heavy-duty trucks (J1939), EVs, marine NMEA 2000 |

---

### How to Use the Scanner

#### 1. Configure Bitrate
Select the vehicle bus bitrate from the dropdown:
- **500 kbps**: Standard high-speed OBD-II powertrain bus on virtually all modern vehicles (2008+).
- **250 kbps**: Common on older vehicles, J1939 trucks, and industrial CANopen.
- **125 kbps / 100 kbps**: Comfort / body interior CAN networks.

#### 2. Live Packet Sniffer & Filtering
- Watch the live packet table update with ID, DLC (Data Length Code 0-8), and hex payload bytes.
- **Delta Highlighting**: Bytes that change between frames flash red to instantly pinpoint controls (e.g., turning the steering wheel or pressing brake pedals).
- **Filter Masking**: Enter an ID filter (e.g. \`0x120\`) to isolate a single ECU.

#### 3. OBD-II Engine Telemetry Engine
Click **Query OBD-II** to automatically send diagnostic requests to standard functional address \`0x7DF\`:
- **PID 0x0C**: Engine RPM (Calculated as \`((A * 256) + B) / 4\`).
- **PID 0x0D**: Vehicle Speed (\`A\` in km/h).
- **PID 0x05**: Engine Coolant Temperature (\`A - 40\` in °C).
- **PID 0x11**: Throttle Position (\`A * 100 / 255\` in %).
- **Read DTCs (Mode 03)**: Queries stored Diagnostic Trouble Codes (e.g. \`P0300\` Random Cylinder Misfire).
`
  },
  {
    id: 'bus-explorer',
    toolId: 'bus-explorer',
    category: 'analysis',
    title: 'I2C & SPI Bus Explorer — 1-Click Chip Identification & Registers',
    summary: 'Hardware bus interrogation, 7-bit I2C scanner, known chip signature lookup, SPI mode 0-3 register watch, and memory dump.',
    tags: ['I2C', 'SPI', 'Bus Explorer', 'Chip Identification', 'Sensors', 'Registers'],
    readTime: '6 min read',
    content: `
# I2C & SPI Bus Explorer — Chip Identification

The **I2C & SPI Bus Explorer** enables interactive exploration, debugging, and reverse engineering of sensors, EEPROMs, displays, and peripheral chips connected to I2C or SPI buses via USB bridging hardware.

---

### 1-Click I2C Address Scanner

The scanner sweeps all valid 7-bit I2C addresses from \`0x08\` to \`0x77\` (addresses \`0x00\`-\`0x07\` and \`0x78\`-\`0x7F\` are reserved by the NXP I2C specification).

For each address:
1. Emits an I2C **START** condition.
2. Sends the 7-bit address with the **Write** bit (\`ADDR << 1 | 0\`).
3. Checks for the slave's **ACK** (pulling SDA low during the 9th clock pulse).
4. Emits a **STOP** condition.

#### Automatic Chip Signature Dictionary
When a slave responds with ACK, the address is cross-referenced against the embedded hardware database:
| I2C Address | Common Identified Silicon |
| :--- | :--- |
| **0x3C / 0x3D** | SSD1306 / SH1106 128x64 OLED Display |
| **0x48** | ADS1115 16-Bit ADC / TMP102 Temperature Sensor |
| **0x50 - 0x57** | AT24Cxx 24-Series I2C Serial EEPROM |
| **0x68** | MPU-6050 6-Axis IMU / DS3231 High-Precision RTC |
| **0x76 / 0x77** | Bosch BMP280 / BME280 Barometric Pressure Sensor |

---

### Interactive Register Read & Write
- **Read Register**: Specify 8-bit register address (e.g. \`0x75\` WHO_AM_I on MPU6050). The tool sends a repeated START and reads back the byte (expected: \`0x68\`).
- **Write Register**: Provide target register and new value (e.g. writing \`0x00\` to register \`0x6B\` to wake MPU6050 from deep sleep).
- **Continuous Register Watch**: Monitor changing registers (accelerometer X/Y/Z) with live numeric readouts.

---

### SPI Bus Interrogation
- **Mode Selection**: Configure CPOL (Clock Polarity) and CPHA (Clock Phase) for SPI Modes 0, 1, 2, or 3.
- **Full-Duplex Transfers**: Send hexadecimal byte strings (e.g. \`0x9F\` Read JEDEC ID) and inspect concurrent MISO response bytes.
`
  },
  {
    id: 'modbus-rtu',
    toolId: 'modbus-rtu',
    category: 'analysis',
    title: 'Modbus RTU & RS-485 — Industrial Telemetry & Holding Registers',
    summary: 'Industrial telemetry protocol manual, CRC-16 calculation, slave polling, function codes 01-16, and solar inverter/PLC diagnostics.',
    tags: ['Modbus', 'RS-485', 'Industrial', 'Holding Registers', 'PLC', 'CRC-16'],
    readTime: '6 min read',
    content: `
# Modbus RTU & RS-485 — Industrial Telemetry

The **Modbus RTU** workbench allows you to communicate with PLCs, industrial sensors, smart electricity meters, solar inverters, and HVAC controllers communicating over half-duplex RS-485 serial networks.

---

### Modbus RTU Packet Anatomy

A Modbus RTU frame has no text delimiters. Framing is governed by a **3.5 character silent interval** (t3.5) between packets:
\`\`\`
[Slave Address] [Function Code] [Data Bytes ...] [CRC-16 Low] [CRC-16 High]
    1 Byte          1 Byte          N Bytes           1 Byte        1 Byte
\`\`\`

The 16-bit CRC is calculated using the polynomial \`0xA001\` (CRC-16-IBM / Modbus reverse) with an initial value of \`0xFFFF\`. The tool automatically calculates and validates this checksum on every transmitted and received packet.

---

### Supported Function Codes

| Code | Name | Description |
| :--- | :--- | :--- |
| **0x01** | Read Coils | Reads discrete digital output states (ON/OFF) |
| **0x02** | Read Discrete Inputs | Reads physical binary input switches |
| **0x03** | Read Holding Registers | Reads 16-bit read/write configuration & sensor words |
| **0x04** | Read Input Registers | Reads 16-bit read-only analog measurements |
| **0x05** | Write Single Coil | Sets a single digital output bit |
| **0x06** | Write Single Register | Writes one 16-bit configuration word |
| **0x10** | Write Multiple Registers | Block writes multiple 16-bit values |

---

### Float32 & Multi-Word Endianness

Industrial sensors often store 32-bit floating-point numbers across two consecutive 16-bit holding registers. If values appear nonsensical (e.g., \`1.23e-38\`), switch endianness in the dropdown:
- **AB CD (Big-Endian)**: High byte first, high word first.
- **CD AB (Little-Endian)**: Low word first, high word second.
- **BA DC (Mid-Big / Byte Swap)**: High word first, but each word's bytes swapped.
- **DC BA (Mid-Little / Word Swap)**: Standard for many Modbus energy meters.
`
  },
  {
    id: 'plotter',
    toolId: 'plotter',
    category: 'analysis',
    title: 'Oscilloscope Plotter — Multi-Channel Real-Time Waveforms',
    summary: 'High-speed 60 FPS real-time serial waveform grapher, auto-scaling, CSV telemetry parsers, and data logging.',
    tags: ['Plotter', 'Oscilloscope', 'Waveforms', 'ADC', 'Telemetry', 'Sensors'],
    readTime: '4 min read',
    content: `
# Oscilloscope Plotter — Live Waveform Visualizer

The **Oscilloscope Plotter** transforms numeric serial streams from analog-to-digital converters (ADCs), IMUs, temperature probes, and current sensors into smooth, real-time multi-channel graphical waveforms.

---

### Supported Data Formats

The plotter automatically extracts numbers from any incoming text stream:
1. **Comma-Separated Values (CSV)**:
   \`\`\`text
   124.5, 88.2, 312.0
   \`\`\`
2. **Whitespace-Delimited**:
   \`\`\`text
   124.5 88.2 312.0
   \`\`\`
3. **Key-Value Pairs**:
   \`\`\`text
   voltage: 3.31 current: 0.42 temp: 24.8
   \`\`\`

---

### Controls & Customization
- **Channel Assignment**: Automatically assigns distinct neon colors (cyan, amber, emerald, purple, rose) to each comma-separated variable.
- **Auto-Scale vs Fixed Range**: Toggle auto-scaling to let the Y-axis continuously adjust to dynamic ranges, or set fixed bounds (e.g. \`0\` to \`4095\` for 12-bit ESP32 ADC reads).
- **Time Window Buffer**: Adjust the horizontal buffer length from 100 data points up to 5,000 points.
- **Pause & Inspect**: Click **Pause** to freeze the canvas and hover over historical data points with crosshairs to inspect precise numerical values.
- **Snapshot CSV Export**: Click **Export CSV** to save plotted session data for MATLAB, Python, or Excel.
`
  },
  {
    id: 'bridge',
    toolId: 'bridge',
    category: 'analysis',
    title: 'MitM Serial Bridge — Dual-Port Pass-Through & Sniffer',
    summary: 'Connect two WebSerial ports concurrently to inspect, log, filter, and inject traffic between a master controller and slave device.',
    tags: ['Serial Bridge', 'MitM', 'Sniffer', 'Dual Port', 'Pass-Through', 'Injection'],
    readTime: '5 min read',
    content: `
# MitM Serial Bridge — Dual-Port Interceptor

The **MitM Serial Bridge** enables Man-in-the-Middle (MitM) inspection by simultaneously managing two independent serial COM ports in your browser. It allows you to place your computer between two devices communicating over serial.

---

### Typical Hardware Interception Setup

\`\`\`
[Host PC / PLC / Controller] <---USB-UART A---> [Skon's USB Tool] <---USB-UART B---> [Device Under Test]
\`\`\`

1. Open **Port A** and set the baud rate matching the controller (e.g. 115,200).
2. Open **Port B** and set the baud rate matching the peripheral.
3. Toggle **Bridge Active**:
   - All bytes received from Port A are transparently forwarded to Port B.
   - All bytes received from Port B are transparently forwarded to Port A.

---

### Features & Capabilities

- **Direction-Coded Live Transcript**:
  - Blue arrows (\`A -> B\`) indicate commands originating from the master.
  - Green arrows (\`B -> A\`) indicate responses originating from the peripheral.
- **Live Byte-Stream Injection**: Inject custom packets into either stream at any time to test device resilience to malformed or unexpected commands.
- **Drop / Alter Rules**: Set matching rules to drop specific command bytes or replace strings on the fly.
`
  }
];
