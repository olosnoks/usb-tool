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
    readTime: '15 min read',
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
1. **Frame Control (2 Bytes)**:
   - **Type (2 bits)**: \`00\` = Management, \`01\` = Control, \`10\` = Data.
   - **Subtype (4 bits)**: Identifies the exact packet:
     - \`0x80\` (Type 00, Subtype 1000): **Beacon Frame**.
     - \`0x40\` (Type 00, Subtype 0100): **Probe Request**.
     - \`0x50\` (Type 00, Subtype 0101): **Probe Response**.
     - \`0xC0\` (Type 00, Subtype 1100): **Deauthentication Frame**.
     - \`0x08\` (Type 10, Subtype 0000): **Data Frame**.
2. **Address Fields (6 Bytes each)**:
   - **Address 1**: Receiver MAC Address (RA / Destination).
   - **Address 2**: Transmitter MAC Address (TA / Source AP or Client).
   - **Address 3**: BSSID (Basic Service Set Identifier / AP hardware address).

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

---

### 5. Custom Packet Framer (Embedded Serial Protocols)

Switch to the **Packet Framer** tab to test custom binary micro-controller protocols (such as drones, telemetry links, or medical sensors):
- **SLIP (Serial Line Internet Protocol)**: Delimits packets with \`0xC0\` and escapes collisions with \`0xDB 0xDC\`.
- **COBS (Consistent Overhead Byte Stuffing)**: Removes all \`0x00\` bytes from the payload, using \`0x00\` as an unambiguous packet delimiter.
- **Header-Length-Payload-CRC**: Define custom sync bytes (e.g. \`0xAA 0x55\`), payload length offsets, and CRC-16 / CRC-32 verification algorithms.
`
  },
  {
    id: 'logic-analyzer',
    toolId: 'logic-analyzer',
    category: 'analysis',
    title: '24MHz Logic Analyzer — 8-Channel Waveforms & Protocol Decoders',
    summary: 'Hardware digital signal analysis up to 24 MSps, edge triggers, protocol decoders for UART/SPI/I2C, sample buffers, and VCD export for Sigrok.',
    tags: ['Logic Analyzer', '24MHz', 'Waveforms', 'Protocol Decoder', 'Sigrok', 'VCD', 'SPI', 'I2C', 'UART'],
    readTime: '14 min read',
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

> **Nyquist Sampling Theorem Rule**:
> To reliably reconstruct a digital square wave, you must sample at least **4x to 10x faster** than the signal frequency:
> - For **115,200 baud UART**: Use at least **1 MSps** or **2 MSps**.
> - For **400 kHz Fast-Mode I2C**: Use at least **4 MSps** or **8 MSps**.
> - For **2 MHz SPI**: Use the maximum **16 MSps** or **24 MSps**.

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
7. **Export to VCD**: Click **Export VCD** to save the capture in standard Value Change Dump format for deep analysis in **PulseView / Sigrok**.
`
  },
  {
    id: 'can-bus',
    toolId: 'can-bus',
    category: 'analysis',
    title: 'CAN Bus & OBD-II Scanner — Automotive Diagnostics & Reverse Engineering',
    summary: 'Comprehensive vehicle network reverse engineering, SLCAN packet monitor, standard 11-bit and extended 29-bit CAN IDs, live OBD-II PID polling, and DTC clearing.',
    tags: ['CAN Bus', 'OBD-II', 'Automotive', 'SLCAN', 'TWAI', 'Vehicle Diagnostics', 'ECU', 'DTC', 'PID'],
    readTime: '16 min read',
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

#### Termination Resistors (60 Ohms Total)
Both ends of the physical CAN bus MUST terminate with a **120-ohm resistor** placed across CAN_H and CAN_L:
- \`120 ohms // 120 ohms = 60 ohms total bus resistance\`.
- If bench testing with a standalone ECU or gauge cluster, you MUST enable or wire a 120-ohm resistor, or signal reflections will corrupt the bus and trigger passive error frames.

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
2. Click **Scan Supported PIDs**. The tool broadcasts a request to functional address \`0x7DF\`:
   - \`0x02 0x01 0x00\`: Mode 01, PID 00 (Requests supported PIDs bitmap).
3. The engine ECU responds with its capability bitmap.
4. The scanner automatically polls:
   - **Engine RPM (PID 0x0C)**: Computed as \`((A * 256) + B) / 4\`.
   - **Vehicle Speed (PID 0x0D)**: Value of \`A\` in km/h.
   - **Coolant Temperature (PID 0x05)**: \`A - 40\` in °C.
   - **Throttle Position (PID 0x11)**: \`A * 100 / 255\` in %.
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
    readTime: '13 min read',
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

---

### 2. 1-Click I2C Address Scanner

When you click **Scan I2C Bus**, the tool sweeps all valid 7-bit addresses from \`0x08\` to \`0x77\`:
1. Emits an I2C **START** condition (SDA pulled LOW while SCL is HIGH).
2. Sends the 7-bit address followed by the **Write** bit (\`ADDR << 1 | 0\`).
3. Releases SDA and pulses SCL to sample the 9th clock bit:
   - If the slave pulls SDA LOW: **ACK (Acknowledge)** — Device is physically present!
   - If SDA remains HIGH: **NACK (No Acknowledge)** — No device at this address.
4. Emits an I2C **STOP** condition (SDA rising while SCL is HIGH).

#### The Embedded Chip Signature Dictionary
When an ACK is received, the tool cross-references the address against its silicon database:
| I2C Address | Common Silicon Identified | Description |
| :--- | :--- | :--- |
| **\`0x3C\` / \`0x3D\`** | SSD1306 / SH1106 | 128x64 or 128x32 Monochrome OLED Display |
| **\`0x48\` - \`0x4B\`** | ADS1115 / TMP102 | 16-Bit High Precision ADC or Temperature Sensor |
| **\`0x50\` - \`0x57\`** | AT24Cxx Series | 24-Series I2C Serial EEPROM (24C02 to 24C512) |
| **\`0x68\`** | MPU-6050 / DS3231 | 6-Axis Gyro/Accelerometer or Real-Time Clock |
| **\`0x76\` / \`0x77\`** | Bosch BMP280 / BME280 | Digital Barometric Pressure & Humidity Sensor |

---

### 3. Interactive Register Read & Write

Once a chip is located:
1. Select the discovered device address.
2. **Read Register**: Enter register offset in hex (e.g. \`0x75\` on address \`0x68\`).
   - The tool sends a Write with register \`0x75\`, issues a repeated START, and reads 1 byte.
   - For an MPU-6050, it returns \`0x68\` (**WHO_AM_I** verification confirmed!).
3. **Write Register**: Enter target register and new byte value (e.g. writing \`0x00\` to register \`0x6B\` clears the sleep bit and wakes up the sensor).
4. **Live Register Watch**: Set up periodic polling (50ms to 1000ms) on data registers (such as Accelerometer X-axis high/low bytes at \`0x3B\` and \`0x3C\`) to see real-time sensor measurements update live on the screen!

---

### 4. SPI Bus Mode Explorer (Modes 0, 1, 2, 3)

For SPI devices (flash chips, SD cards, RF transceivers):
Configure **CPOL (Clock Polarity)** and **CPHA (Clock Phase)**:
- **Mode 0 (CPOL=0, CPHA=0)**: Clock idle LOW, data sampled on rising edge (Standard for SD cards & flash).
- **Mode 1 (CPOL=0, CPHA=1)**: Clock idle LOW, data sampled on falling edge.
- **Mode 2 (CPOL=1, CPHA=0)**: Clock idle HIGH, data sampled on falling edge.
- **Mode 3 (CPOL=1, CPHA=1)**: Clock idle HIGH, data sampled on rising edge.

Send hex byte strings (e.g. \`0x9F 0x00 0x00 0x00\`) to read JEDEC IDs or dump SPI flash memory.
`
  },
  {
    id: 'modbus-rtu',
    toolId: 'modbus-rtu',
    category: 'analysis',
    title: 'Modbus RTU & RS-485 — Industrial Telemetry & Holding Registers',
    summary: 'Master industrial RS-485 differential signaling, Modbus RTU framing, CRC-16 calculation, slave address polling, function codes 01-16, and endianness conversions.',
    tags: ['Modbus', 'RS-485', 'Industrial', 'Holding Registers', 'PLC', 'CRC-16', 'Inverter', 'Telemetry'],
    readTime: '14 min read',
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

#### The CRC-16-IBM Checksum
Every packet concludes with a 16-bit Cyclic Redundancy Check:
- Calculated with polynomial \`0xA001\` and initial value \`0xFFFF\`.
- Transmitted **Low-Byte First (Little-Endian)**.
- The workbench automatically computes and verifies this checksum on every transmitted and received packet.

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

### 5. Step-by-Step Usage Guide

1. **Connect Hardware**: Plug your USB-to-RS485 dongle into your PC. Connect **A** to slave **A (D+)**, **B** to slave **B (D-)**, and **GND** to slave ground.
2. **Scan for Slaves**: If you don't know the unit's slave ID, click **Scan Slave IDs (1-247)**. The tool pings each address with a Read Holding Register command until a device responds.
3. **Poll Registers**: Enter the starting register address (e.g. \`0x0000\`) and quantity of registers to read (e.g. \`10\`).
4. **Inspect Live Table**: The results table displays Register Offset, Hex Value, Signed 16-bit Int, Unsigned 16-bit Int, and Converted Float32.
`
  },
  {
    id: 'plotter',
    toolId: 'plotter',
    category: 'analysis',
    title: 'Oscilloscope Plotter — Multi-Channel Real-Time Waveforms',
    summary: 'High-speed 60 FPS real-time serial waveform grapher, auto-scaling, CSV telemetry parsers, multi-channel color assignment, and data logging.',
    tags: ['Plotter', 'Oscilloscope', 'Waveforms', 'ADC', 'Telemetry', 'Sensors', 'Graphing', 'CSV'],
    readTime: '10 min read',
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
    readTime: '11 min read',
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
