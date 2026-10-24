/**
 * RF, Wireless & Badges Wiki Articles
 * Covering Flipper Zero, Proxmark3/PM5, PortaPack Mayhem, GPS Wardrive, Piglet Suite, and Marauder CLI
 */

export const RF_ARTICLES = [
  {
    id: 'flipper',
    toolId: 'flipper',
    category: 'rf',
    title: 'Flipper Zero Suite — WebSerial RPC Bridge, Screen Stream & BadUSB',
    summary: 'Full companion guide: 128x64 LCD screen streaming, virtual D-pad, BadUSB runner, Sub-GHz replay, and Protobuf RPC protocol.',
    tags: ['Flipper Zero', 'RPC', 'Protobuf', 'Screen Streaming', 'BadUSB', 'Sub-GHz'],
    readTime: '8 min read',
    content: `
# Flipper Zero Suite — RPC Bridge & Screen Stream

The **Flipper Zero Suite** communicates directly with your Flipper Zero device over USB CDC serial. It provides real-time LCD streaming, virtual remote control, SD card file browsing, and BadUSB payload execution without needing the native qFlipper desktop client.

---

### How the Flipper RPC Protocol Works

When connected via USB, the Flipper Zero exposes two virtual COM ports:
- **CLI Shell**: Text-based interactive command prompt.
- **Protobuf RPC**: Binary command protocol implementing Google Protocol Buffers (\`PB_Main\` envelope).

To enter RPC mode, the tool sends:
\`\`\`text
start_rpc_session\r\n
\`\`\`
The Flipper replies with a binary acknowledgment, switching the USB serial port into binary Protobuf framing. Every message contains:
1. A **Varint** length header.
2. A serialized \`PB_Main\` message containing \`command_id\`, \`has_next\` flag, and specialized sub-messages (\`gui_start_screen_stream_request\`, \`storage_read_request\`, etc.).

---

### Features & Capabilities

#### 1. Live Screen Streaming (128x64 LCD)
- Sends \`gui_start_screen_stream_request\` to mirror the Flipper's physical display.
- Frames are delivered at 15-30 FPS as 1024-byte monochrome bit arrays (\`128 * 64 / 8 bytes\`).
- Rendered in browser on an HTML5 canvas styled with authentic Flipper orange backlight and pixel glow.

#### 2. Virtual D-Pad & Key Injection
Injects simulated button presses directly into the Flipper operating system:
- **Buttons**: \`UP\`, \`DOWN\`, \`LEFT\`, \`RIGHT\`, \`OK\`, \`BACK\`.
- **Event Types**: \`SHORT\` (click), \`LONG\` (hold), and \`RELEASE\`.
- Use on-screen arrow controls or standard keyboard keys (Arrow keys + Enter + Backspace).

#### 3. BadUSB Payload Studio
- Browse and select DuckyScript \`.txt\` payload files stored on your computer or generated in the BadUSB Studio.
- The tool uploads the script into \`/ext/badusb/\` on the Flipper microSD card and triggers execution via RPC commands.

#### 4. Sub-GHz & RFID Triggering
- List files stored under \`/ext/subghz/\`, \`/ext/nfc/\`, and \`/ext/lfrfid/\`.
- Send playback commands to retransmit saved 433.92MHz / 315MHz / 868MHz gate and garage remote signals.
`
  },
  {
    id: 'proxmark',
    toolId: 'proxmark',
    category: 'rf',
    title: 'Proxmark3 / PM5 Suite — RFID & NFC Cloning Laboratory',
    summary: 'High Frequency (13.56MHz) and Low Frequency (125kHz) RFID auditing, Mifare Classic nested attacks, T5577 cloning, and PM3 flashing.',
    tags: ['Proxmark3', 'RFID', 'NFC', 'Mifare', '125kHz', '13.56MHz', 'T5577'],
    readTime: '8 min read',
    content: `
# Proxmark3 / PM5 Suite — RFID & NFC Laboratory

The **Proxmark3 Suite** provides a browser-based client and flashing workbench for Proxmark3 Easy, RDV4, and PM5 hardware. It supports reading, cracking, cloning, and emulating both 125kHz Low Frequency (LF) and 13.56MHz High Frequency (HF) transponders.

---

### Frequency & Card Standard Breakdown

| Band | Frequency | Standards & Chips | Typical Real-World Applications |
| :--- | :--- | :--- | :--- |
| **LF** | 125 kHz / 134 kHz | EM4100, HID Prox, Indala, T5577, EM4305 | Building access badges, pet microchips, parking gates |
| **HF** | 13.56 MHz | ISO 14443A (Mifare Classic, Ultralight), ISO 15693, FeliCa | Transit cards, hotel room keys, NFC phone tags, passports |

---

### Core Operations Manual

#### 1. Low Frequency (125kHz) Operations
- **Search for any LF tag**:
  \`\`\`text
  lf search
  \`\`\`
- **Read EM4100 / EM4200 badge**:
  \`\`\`text
  lf em 410x read
  \`\`\`
- **Clone to T5577 Rewriteable Card**:
  \`\`\`text
  lf em 410x clone --id 0102030405
  \`\`\`
- **Read HID Prox II (26-bit Wiegand)**:
  \`\`\`text
  lf hid read
  \`\`\`

#### 2. High Frequency (13.56MHz) Operations
- **Search for ISO 14443A tag**:
  \`\`\`text
  hf search
  \`\`\`
- **Read Card UID & ATQA/SAK**:
  \`\`\`text
  hf 14a info
  \`\`\`
- **Mifare Classic Key Recovery (Nested / Darkside Attack)**:
  \`\`\`text
  hf mf chk --1k
  hf mf nested --1k -d dump.bin
  \`\`\`
- **Dump Full Card Memory**:
  \`\`\`text
  hf mf dump --1k
  \`\`\`
- **Restore / Clone to "Magic" Chinese Gen1A / Gen2 Card**:
  \`\`\`text
  hf mf cload -f dump.bin
  \`\`\`

---

### Hardware Recovery & Web Flashing
If your Proxmark3 is bricked or stuck in bootloader mode (red and green LEDs solid):
1. Hold down the physical button on the PM3 while plugging in the USB cable.
2. Open the **Proxmark Web Flasher** section.
3. Select the latest official Iceman firmware binary.
4. Click **Flash Bootrom & Fullimage** to restore full functionality.
`
  },
  {
    id: 'mayhem',
    toolId: 'mayhem',
    category: 'rf',
    title: 'PortaPack Mayhem SDR — HackRF Sub-GHz Deck & FREQMAN',
    summary: 'PortaPack companion: remote control terminal, live HackRF Sub-GHz frequency lists, capture-replay IQ management, and FREQMAN file editor.',
    tags: ['PortaPack', 'Mayhem', 'HackRF', 'SDR', 'FREQMAN', 'Sub-GHz'],
    readTime: '6 min read',
    content: `
# PortaPack Mayhem SDR — HackRF Sub-GHz Deck

The **PortaPack Mayhem SDR** workbench is a browser companion for the HackRF One software-defined radio equipped with a PortaPack H1/H2 running Mayhem firmware.

---

### Hardware Overview & Capabilities

- **Frequency Range**: 1 MHz to 6 GHz (continuous coverage).
- **Bandwidth**: Up to 20 MHz sampling rate.
- **Half-Duplex Transceiver**: Capable of receiving and transmitting digital and analog radio modulations (ASK, FSK, OOK, PSK, FM, AM).

---

### Key Workbench Tools

#### 1. FREQMAN Frequency List Editor
The PortaPack organizes monitored frequencies in simple text files located in \`/FREQMAN/\` on the microSD card. The workbench provides an interactive visual editor:
- **Parse & Edit**: Modify frequency labels, center frequencies (Hz), modulation (AM, NFM, WFM, SPEC), and step bandwidth.
- **Export**: Generates compliant \`.TXT\` lists for direct placement onto the SD card.

#### 2. Replay Attack IQ File Manager
- Organize raw IQ capture files (\`.C8\` 8-bit signed complex and \`.C16\` 16-bit signed complex).
- Inspect capture parameters: Center frequency, sample rate, LNA gain, and VGA gain settings.
- Preview frequency spectrum waterfalls.

#### 3. Serial Control Terminal
Connect over USB to issue direct PortaPack Mayhem CLI commands:
- \`freq <Hz>\`: Tune frequency immediately.
- \`lna <0-40>\`: Adjust Low Noise Amplifier gain in 8dB steps.
- \`vga <0-62>\`: Adjust Variable Gain Amplifier in 2dB steps.
- \`amp <0|1>\`: Toggle the internal 14dB RF preamp.
`
  },
  {
    id: 'wardrive',
    toolId: 'wardrive',
    category: 'rf',
    title: 'GPS & Wardrive Suite — NMEA Sentences, UBX Config & Live Map',
    summary: 'Decode NMEA 0183 sentences, track GPS/GLONASS constellations, configure u-blox binary rates, and visualize real-time coordinates.',
    tags: ['GPS', 'Wardrive', 'NMEA', 'u-blox', 'UBX', 'Leaflet Map', 'WiGLE'],
    readTime: '7 min read',
    content: `
# GPS & Wardrive Suite — NMEA Sentences & UBX

The **GPS & Wardrive Suite** connects directly to standard GPS/GNSS receiver modules (u-blox NEO-6M, NEO-7M, NEO-8M, M10, ATGM336H) to decode satellite constellations, compute real-time geographic position, and configure receiver hardware registers.

---

### NMEA 0183 Sentence Breakdown

GNSS modules output comma-delimited ASCII sentences starting with \`$\`:
1. **$GPGGA (Global Positioning System Fix Data)**:
   \`\`\`text
   $GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
   \`\`\`
   - UTC time (\`12:35:19\`).
   - Latitude (\`48° 07.038' N\`) & Longitude (\`011° 31.000' E\`).
   - Fix Quality (\`0\` = Invalid, \`1\` = GPS Fix, \`2\` = DGPS, \`4\` = RTK Fixed).
   - Number of Satellites in view (\`08\`).
   - Horizontal Dilution of Precision / HDOP (\`0.9\`).
   - Altitude above sea level (\`545.4 meters\`).

2. **$GPRMC (Recommended Minimum Navigation Information)**:
   - Provides ground speed (knots), true course heading (degrees), and UTC date.

3. **$GPGSV (Satellites in View)**:
   - Elevation, azimuth, and SNR (Signal-to-Noise Ratio in dB-Hz) for each satellite in sky view.

---

### Live Interactive OpenStreetMap
- Incoming coordinates are parsed and projected onto an interactive Leaflet map.
- Real-time breadcrumb trail tracking vehicle or foot wardriving paths.
- Speedometer, altitude dial, and satellite count indicators.

---

### u-blox UBX Binary Configuration Engine
Standard NMEA is limited to 1Hz update rates. The workbench includes a binary UBX encoder to reconfigure u-blox receivers:
- **UBX-CFG-RATE**: Switch navigation rate from 1Hz (1000ms) to 5Hz (200ms) or 10Hz (100ms) for high-speed vehicle wardriving.
- **UBX-CFG-PRT**: Change UART port baud rate from 9600 to 115,200 bps.
- **UBX-CFG-NAV5**: Set dynamic platform model (Pedestrian, Automotive, Airborne <1g).
`
  },
  {
    id: 'piglet-suite',
    toolId: 'flasher',
    category: 'rf',
    title: 'Piglet Wardriver Suite — Full Setup Guide for All 7 Boards',
    summary: 'The ultimate guide to configuring, flashing, and running Piglet Wardriver across all 7 supported boards with GPS wiring, C5 fix, and WiGLE CSV.',
    tags: ['Piglet', 'Wardriver', 'ESP32-S3', 'ESP32-C5', 'WiGLE', 'GPS', 'NEO-6M'],
    readTime: '9 min read',
    content: `
# Piglet Wardriver Suite — Hardware & Firmware Guide

The **Piglet Wardriver Suite** turns compact ESP32 development boards into high-efficiency Wi-Fi, Bluetooth, and cellular wardriving devices that log geolocated network data into standard WiGLE CSV format.

---

### All 7 Supported Hardware Targets

| Board Model | Chip / Arch | Supported Bands | GPS Interface | Display / Storage |
| :--- | :--- | :--- | :--- | :--- |
| **ESP32-S3 Zero** | S3 Dual-Core LX7 | 2.4 GHz | UART1 (TX: GPIO43, RX: GPIO44) | MicroSD SPI / External OLED |
| **ESP32-C3 SuperMini** | C3 RISC-V | 2.4 GHz | UART1 (TX: GPIO20, RX: GPIO21) | MicroSD SPI (GPIO4-7) |
| **ESP32-C5 Beta** | C5 RISC-V | **Dual-Band 2.4 & 5 GHz** | UART1 (TX: GPIO2, RX: GPIO3) | MicroSD SPI / Direct Flash |
| **ESP32-C6 DevBoard** | C6 RISC-V | 2.4 GHz Wi-Fi 6 + Zigbee | UART1 (TX: GPIO16, RX: GPIO17) | MicroSD SPI |
| **LilyGO T-Display S3** | S3 Dual-Core | 2.4 GHz | Dedicated Grove UART | Integrated 1.9" ST7789 Color LCD |
| **M5StickC-Plus2** | ESP32-PICO-V3-02 | 2.4 GHz | Hat Connector UART | Built-in 1.14" TFT + LiPo Battery |
| **CYD Cheap Yellow Display**| ESP32 Classic | 2.4 GHz | Extended IO Port | 2.8" Resistive Touchscreen + SD |

---

### ESP32-C5 Dual-Band Flashing Fix
> **Important Note for ESP32-C5 Users**:
> ESP32-C5 is early engineering silicon. Standard \`esptool\` flasher stubs fail on C5 because of memory layout differences in the new RISC-V core.
> **The Fix**: Skon's Web Flasher automatically detects C5 chips and forces **Direct ROM Mode (No-Stub)** at 115,200 baud, bypassing the stub and successfully burning firmware every time.

---

### External GPS Wiring Diagram (NEO-6M / NEO-8M / ATGM336H)

\`\`\`
GPS Module       Target ESP32 Board
VCC -------------> 3.3V or 5V (Check GPS regulator)
GND -------------> GND
TX  -------------> ESP RX (UART1 RX pin listed in table above)
RX  -------------> ESP TX (UART1 TX pin listed in table above)
\`\`\`

---

### WiGLE CSV Export & Upload
1. Ensure your MicroSD card is formatted as **FAT32** with a standard MBR partition.
2. After a drive, power down the board and insert the SD card into your computer, or read the logs via the WebSerial terminal.
3. Locate the generated file: \`/piglet_wardrive_YYYYMMDD.csv\`.
4. Log into [WiGLE.net](https://wigle.net) -> **Uploads** -> upload your CSV file to contribute to the global wireless map.
`
  },
  {
    id: 'marauder',
    toolId: 'terminal',
    category: 'rf',
    title: 'ESP32 Marauder CLI Manual — Wi-Fi & Bluetooth Auditing',
    summary: 'Complete command reference for JustCallMeKoko’s ESP32 Marauder: scanning, sniffing, attacks, pcap capture, and channel hopping.',
    tags: ['Marauder', 'CLI', 'Wi-Fi Audit', 'Beacon', 'Deauth', 'PMKID', 'pcap'],
    readTime: '8 min read',
    content: `
# ESP32 Marauder CLI Manual

**ESP32 Marauder** is a portable firmware suite for offensive and defensive Wi-Fi and Bluetooth analysis. When connected to Skon's USB Tool, you can control Marauder via the integrated WebSerial terminal or stream packets into the Packet Lab.

---

### Essential Marauder Commands

#### 1. Target Discovery & Scanning
- \`scanap\`: Scans for nearby 802.11 Access Points across all channels (1-14).
- \`scansta\`: Scans for client stations connected to targeted APs.
- \`list -a\`: Prints the table of discovered APs with index numbers, SSIDs, and RSSI.
- \`list -c\`: Prints discovered client stations.
- \`select -a <index>\`: Selects a specific target AP for focused auditing.
- \`select -a all\`: Selects all discovered APs.

#### 2. Sniffing & Capture
- \`sniffraw\`: Streams all raw promiscuous frames over the serial port.
- \`sniffbeacon\`: Captures only 802.11 beacon frames.
- \`sniffdeauth\`: Detects rogue deauthentication attacks in your immediate environment.
- \`sniffpmkid\`: Focuses on capturing PMKID key material from routers supporting 802.11i/WPA2/WPA3.
- \`stopscan\`: Immediately halts any running scan or sniffer loop.

#### 3. Active Transmission & Beacon Flooding
- \`attack -t beacon -l\`: Generates beacon frames from a list of randomly generated SSIDs.
- \`attack -t beacon -a\`: Generates beacon frames mimicking targeted APs.
- \`attack -t deauth\`: Sends 802.11 deauthentication frames to disconnect stations from selected APs to capture 4-way handshakes.
- \`attack -t probe\`: Floods probe requests to map responding APs.

#### 4. Settings & Channel Configuration
- \`channel\`: Displays the current radio channel.
- \`channel -s <1-14>\`: Forces the radio to lock onto a specific 2.4GHz channel.
- \`settings\`: Displays hardware configuration (SD card detection, LED mode, auto-save pcap).
- \`settings -s ForcePackets enable\`: Forces raw packet streaming over UART.
`
  }
];
