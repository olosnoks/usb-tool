/**
 * RF, Wireless & Badges Wiki Articles — Comprehensive Technical Manual
 * Covering Flipper Zero, Proxmark3/PM5, PortaPack Mayhem, GPS Wardrive, Piglet Suite, and Marauder CLI
 */

export const RF_ARTICLES = [
  {
    id: 'flipper',
    toolId: 'flipper',
    category: 'rf',
    title: 'Flipper Zero Suite — WebSerial RPC Bridge, Screen Stream & BadUSB',
    summary: 'Master the Flipper Zero Protobuf RPC protocol, real-time 128x64 monochrome LCD framebuffer streaming, virtual D-pad, BadUSB payload execution, and Sub-GHz replay.',
    tags: ['Flipper Zero', 'RPC', 'Protobuf', 'Screen Streaming', 'BadUSB', 'Sub-GHz', 'qFlipper', 'NFC', 'RFID'],
    readTime: '15 min read',
    content: `
# Flipper Zero Suite — RPC Bridge & Screen Stream

The **Flipper Zero Suite** communicates directly with your Flipper Zero device over USB CDC serial. It provides real-time 128x64 LCD display mirroring, a virtual remote control, SD card file browsing, Sub-GHz replay triggers, and BadUSB payload execution without needing the official qFlipper desktop client.

---

### 1. What Is This Tool & Why Do You Need It?

The **Flipper Zero** is a portable multi-tool for geeks and penetration testers. While it has an onboard 1.4-inch monochrome LCD and navigation buttons, using it on a test bench often requires streaming the screen to a computer, controlling it with keyboard shortcuts, or rapidly editing and uploading BadUSB scripts from your local disk.

The **Flipper Zero Suite** speaks the native binary protocol used by the official Flipper desktop apps, implementing direct screen streaming, virtual D-pad keystrokes, storage operations, and Sub-GHz remote triggers directly in your web browser.

---

### 2. How the Flipper Protobuf RPC Protocol Works

When plugged into USB, the Flipper Zero's STM32WB55 microcontroller enumerates as a USB Communication Device Class (CDC) virtual COM port.

By default, the serial port runs a human-readable text CLI shell (\`>: \`).
To switch into high-speed binary control mode, the browser sends:
\`\`\`text
start_rpc_session\r\n
\`\`\`
The Flipper acknowledges and immediately transitions the serial port to **Google Protocol Buffers (Protobuf)** framing. Every message exchanged adheres to this structure:
1. **Varint Length Header**: A 1-to-4 byte Google Protocol Buffer Varint indicating the byte size of the following payload.
2. **PB_Main Envelope**: A serialized Protocol Buffer message containing:
   - \`command_id\`: Monotonically incrementing request ID.
   - \`has_next\`: Boolean flag for multi-packet streaming.
   - Specific sub-message payload:
     - \`gui_start_screen_stream_request\`
     - \`gui_send_input_event_request\`
     - \`storage_list_request\`
     - \`storage_read_request\` / \`storage_write_request\`

---

### 3. Display Streaming & Framebuffer Rendering

When you toggle **Screen Streaming**:
1. The tool sends \`gui_start_screen_stream_request\`.
2. The Flipper firmware captures its physical display buffer and streams \`gui_screen_frame\` packets at 15 to 30 FPS.
3. **The Raw Framebuffer (1024 Bytes)**:
   - The Flipper display is \`128 pixels wide x 64 pixels tall\`.
   - Each pixel is 1 bit (monochrome: ON or OFF).
   - \`128 * 64 / 8 = 1024 bytes total\`.
   - The bits are formatted in vertical 8-pixel columns across pages.
4. The tool's JavaScript engine unpacks each byte, converts the 1-bit values into RGBA pixel buffers, and renders them onto an HTML5 canvas with the authentic Flipper orange backlight and subtle pixel grid glow!

---

### 4. Interactive Virtual D-Pad & Keyboard Controls

You can control the Flipper directly using on-screen buttons or keyboard shortcuts:
| Action | Keyboard Key | RPC Event Sent |
| :--- | :--- | :--- |
| **Up** | Arrow Up / W | \`InputKey.UP, InputType.SHORT\` |
| **Down** | Arrow Down / S | \`InputKey.DOWN, InputType.SHORT\` |
| **Left** | Arrow Left / A | \`InputKey.LEFT, InputType.SHORT\` |
| **Right** | Arrow Right / D | \`InputKey.RIGHT, InputType.SHORT\` |
| **OK / Enter** | Enter / Space | \`InputKey.OK, InputType.SHORT\` |
| **Back** | Backspace / Esc | \`InputKey.BACK, InputType.SHORT\` |
| **Long Press** | Shift + Key | Sends \`InputType.LONG\` (holds button for 1 second) |

---

### 5. BadUSB Payload Studio Integration

1. Write or import a DuckyScript payload in the **BadUSB & Payload Studio**.
2. Click **Deploy to Flipper**.
3. The tool opens an RPC storage stream, creates the file at \`/ext/badusb/payload.txt\` on the Flipper's microSD card, and issues the CLI command to launch BadUSB mode immediately!

---

### 6. Sub-GHz & RFID Triggering
- Browse the Flipper's \`/ext/subghz/\` folder directly from the workbench.
- Select any recorded \`.sub\` file (such as a 433.92MHz gate or garage remote).
- Click **Transmit** to trigger the Flipper's CC1101 transceiver chip to retransmit the radio signal into the air!
`
  },
  {
    id: 'proxmark',
    toolId: 'proxmark',
    category: 'rf',
    title: 'Proxmark3 / PM5 Suite — RFID & NFC Cloning Laboratory',
    summary: 'Comprehensive RFID laboratory guide: 13.56MHz Mifare Classic nested attacks, darkside cracking, 125kHz T5577 card cloning, and standalone PM3 recovery flashing.',
    tags: ['Proxmark3', 'RFID', 'NFC', 'Mifare', '125kHz', '13.56MHz', 'T5577', 'EM4100', 'Iceman'],
    readTime: '16 min read',
    content: `
# Proxmark3 / PM5 Suite — RFID & NFC Laboratory

The **Proxmark3 Suite** is a browser-based client and flashing workbench for Proxmark3 Easy, RDV4, and PM5 hardware. It enables reading, analyzing, cracking, and cloning both 125kHz Low Frequency (LF) and 13.56MHz High Frequency (HF) RFID transponders.

---

### 1. What Is This Tool & Why Do You Need It?

RFID (Radio Frequency Identification) and NFC (Near Field Communication) badges are used everywhere: building door access, transit cards, hotel keycards, and parking gates.

Auditing and testing these cards traditionally required compiling the extensive Proxmark3 client from source code in Linux or setting up virtual machines.
The **Proxmark3 Suite** communicates with the PM3 microcontroller over WebSerial at **115,200** or **460,800 baud**, parses binary responses, and provides 1-click workflows for cloning badges and recovering encryption keys.

---

### 2. Frequency Bands & Card Technologies

| Band | Operating Frequency | Coupling Type | Typical Range | Common Chip Standards |
| :--- | :--- | :--- | :--- | :--- |
| **LF (Low Frequency)** | 125 kHz / 134 kHz | Magnetic Inductive | 1 to 10 cm | **EM4100**, **HID Prox II**, **Indala**, **AWID**, **T5577** (Rewriteable clone chip) |
| **HF (High Frequency)** | 13.56 MHz | Electromagnetic Resonance | 1 to 5 cm | **ISO 14443A** (Mifare Classic, Ultralight), **ISO 15693** (iCode), **FeliCa** |

---

### 3. Step-by-Step Low Frequency (125kHz) Cloning Guide

#### How to Clone an Office Access Badge to a T5577 Chip:
1. Place the target badge onto the Proxmark3's LF antenna coil (the circular coil on the board).
2. Click **Scan LF Badge** (or send \`lf search\` in the PM3 terminal).
3. The PM3 analyzes the modulation (ASK, FSK, or PSK).
   - If it detects an **EM4100** badge, it outputs a 10-hex-digit ID (e.g. \`0102030405\`).
   - If it detects an **HID Prox II** badge, it decodes the 26-bit Wiegand format, displaying the **Facility Code** and **Card Number**.
4. Remove the source badge and place a blank **T5577 rewriteable card / blue keyfob** onto the coil.
5. Click **Clone to T5577** (or run \`lf em 410x clone --id 0102030405\`).
6. The PM3 programs the T5577's internal EEPROM blocks to mimic the source card's modulation. You now have a working clone!

---

### 4. Step-by-Step High Frequency (13.56MHz) Mifare Classic Cracking

Mifare Classic 1K cards (used in hotel keys and transit systems) divide memory into **16 sectors**, each protected by two cryptographic keys: **Key A** and **Key B**.

#### The Nested Attack (Weak PRNG Exploitation)
1. Place the 13.56MHz card onto the HF antenna coil (the rectangular printed trace).
2. Click **Identify 14443A Card** (\`hf 14a info\`).
   - Records the card's **UID** (4-byte or 7-byte Unique Identifier), **ATQA**, and **SAK**.
3. Click **Recover Keys (Nested Attack)** (\`hf mf nested --1k\`).
   - The PM3 exploits vulnerabilities in the card's Crypto-1 pseudo-random number generator (PRNG).
   - By capturing encrypted nonces across multiple authentication attempts, it mathematically derives all 32 Sector Keys (Key A and Key B) in under 60 seconds!
4. Click **Dump Card Memory** (\`hf mf dump --1k\`).
   - Downloads a complete 1024-byte binary memory dump (\`dump.bin\`).
5. Click **Clone to Magic Card** (\`hf mf cload -f dump.bin\`).
   - Writes the entire memory dump, including the normally read-only **Block 0 (UID)**, onto a Gen1A or Gen2 "Magic Chinese" rewriteable card.

---

### 5. Standalone Web Flasher (Unbricking PM3)
If your Proxmark3 is unresponsive or has both the red and green LEDs stuck solid:
1. Hold down the hardware push-button on the PM3 board while plugging the USB cable into your computer.
2. The board boots into its recovery bootloader.
3. Open the **Proxmark Web Flasher** in Skon's USB Tool.
4. Select the official Iceman bootrom and fullimage binaries.
5. Click **Flash Proxmark3** to re-burn flash memory and restore the device!
`
  },
  {
    id: 'mayhem',
    toolId: 'mayhem',
    category: 'rf',
    title: 'PortaPack Mayhem SDR — HackRF Sub-GHz Deck & FREQMAN',
    summary: 'PortaPack companion guide: remote control terminal, live HackRF Sub-GHz frequency lists, capture-replay IQ management, and FREQMAN file editor.',
    tags: ['PortaPack', 'Mayhem', 'HackRF', 'SDR', 'FREQMAN', 'Sub-GHz', 'IQ Capture', 'Replay Attack'],
    readTime: '13 min read',
    content: `
# PortaPack Mayhem SDR — HackRF Sub-GHz Deck

The **PortaPack Mayhem SDR** workbench is a browser companion for the HackRF One software-defined radio equipped with a PortaPack H1/H2 running Mayhem firmware.

---

### 1. What Is HackRF & PortaPack Mayhem?

The **HackRF One** by Great Scott Gadgets is an open-source Software Defined Radio (SDR) capable of transmitting and receiving radio signals from **1 MHz to 6 GHz** with up to 20 MHz of bandwidth.

The **PortaPack** attaches to the top of the HackRF, adding an LCD screen, navigation wheel, audio jack, and microSD card slot to make it a standalone portable RF laboratory. **Mayhem** is the premier open-source firmware for PortaPack, adding tools for Sub-GHz remotes, ADS-B airplane tracking, AIS boat tracking, and replay attacks.

The **PortaPack Mayhem Workbench** bridges your browser to the PortaPack over USB serial, providing a large-screen command console, visual frequency list manager (FREQMAN), and IQ replay library.

---

### 2. The FREQMAN Frequency File Format

Mayhem stores lists of radio frequencies in plain text files inside the \`/FREQMAN/\` folder on its microSD card.

#### Anatomy of a FREQMAN File
\`\`\`text
f=433920000,m=AM,s=2500,d=Garage Remote
f=315000000,m=NFM,s=10000,d=Car Keyfob
f=868300000,m=SPEC,s=50000,d=Smart Meter
\`\`\`
- \`f=\`: Center frequency in Hertz (Hz).
- \`m=\`: Modulation type (\`AM\`, \`NFM\` Narrowband FM, \`WFM\` Wideband FM, \`SPEC\` Spectrum).
- \`s=\`: Step bandwidth in Hertz.
- \`d=\`: Descriptive text label displayed on the PortaPack LCD screen.

The workbench includes a visual **FREQMAN Editor**:
- Add, edit, or delete frequency entries in a clean table.
- Convert frequency units automatically (MHz to Hz).
- Download completed \`.TXT\` files ready to copy onto the microSD card.

---

### 3. Sub-GHz Signal Capture & Replay Attacks

In RF security auditing, a **Replay Attack** involves capturing the raw radio frequency transmission of a remote control and playing it back at a later time.

#### How It Works:
1. In Mayhem, open **Capture** mode and set center frequency to **433.92 MHz** (or **315 MHz** in North America).
2. Press the button on the target remote (e.g. a gate or ceiling fan remote).
3. The HackRF samples the raw in-phase and quadrature analog radio waves and writes them to the microSD card as an **IQ file**:
   - **.C8**: 8-bit signed complex samples (\`I\` byte, \`Q\` byte).
   - **.C16**: 16-bit signed complex samples.
4. Open the **Replay Manager** in the workbench to inspect the IQ file, verify bandwidth, and trigger playback over serial commands.

> **Rolling Code Warning**:
> Modern cars and security alarms use rolling codes (e.g. Keeloq). Replaying a captured transmission will not work because the receiver expects the counter to increment. Replay attacks only work on fixed-code systems (gates, doorbells, wireless plugs).

---

### 4. Remote Serial Control Commands

| Command | Action | Example |
| :--- | :--- | :--- |
| \`freq <Hz>\` | Tunes HackRF synthesizer directly | \`freq 433920000\` |
| \`lna <0-40>\` | Sets Low Noise Amplifier gain in 8dB steps | \`lna 32\` |
| \`vga <0-62>\` | Sets Variable Gain Amplifier in 2dB steps | \`vga 20\` |
| \`amp <0|1>\` | Toggles the 14dB internal RF front-end preamplifier | \`amp 1\` |
`
  },
  {
    id: 'wardrive',
    toolId: 'wardrive',
    category: 'rf',
    title: 'GPS & Wardrive Suite — NMEA Sentences, UBX Config & Live Map',
    summary: 'Master GPS/GNSS receiver integration, decode NMEA 0183 sentences ($GPGGA, $GPRMC), configure u-blox binary rates, and visualize real-time coordinates on OpenStreetMap.',
    tags: ['GPS', 'Wardrive', 'NMEA', 'u-blox', 'UBX', 'Leaflet Map', 'WiGLE', 'Satellites', 'GNSS'],
    readTime: '15 min read',
    content: `
# GPS & Wardrive Suite — NMEA Sentences & UBX

The **GPS & Wardrive Suite** connects directly to standard GPS/GNSS receiver modules (u-blox NEO-6M, NEO-7M, NEO-8M, M10, ATGM336H) to decode satellite constellations, compute real-time geographic position, and configure receiver hardware registers.

---

### 1. What Is Wardriving & Why Is GPS Essential?

**Wardriving** is the practice of mapping wireless networks (Wi-Fi, Bluetooth beacons, cellular towers) while traveling. To map an access point, a wardriving rig must pair the network's BSSID and signal strength (RSSI) with an exact geographic coordinate (Latitude, Longitude, Altitude).

The **GPS & Wardrive Suite** provides:
- Live NMEA sentence decoding.
- Satellite constellation health monitoring (GPS, GLONASS, Galileo, BeiDou).
- An interactive OpenStreetMap tracking canvas with breadcrumb trail.
- A binary **UBX Configuration Engine** to boost receiver update rates from 1Hz up to 10Hz for high-speed vehicle tracking.

---

### 2. NMEA 0183 Protocol Deep-Dive

GPS modules stream comma-delimited ASCII sentences starting with \`$\` and ending with \`*<checksum>\\r\\n\`:

#### Sentence 1: $GPGGA (Fix Data)
\`\`\`text
$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
\`\`\`
1. \`123519\`: UTC Time (\`12:35:19\`).
2. \`4807.038,N\`: Latitude \`48° 07.038'\` North.
3. \`01131.000,E\`: Longitude \`011° 31.000'\` East.
4. \`1\`: Fix Quality (\`0\` = Invalid/Searching, \`1\` = GPS Fix, \`2\` = DGPS, \`4\` = RTK Fixed).
5. \`08\`: Number of active satellites tracked.
6. \`0.9\`: Horizontal Dilution of Precision (HDOP — lower is better).
7. \`545.4,M\`: Altitude above sea level in meters.

#### Sentence 2: $GPRMC (Recommended Minimum Data)
\`\`\`text
$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230324,,,A*6D
\`\`\`
- \`022.4\`: Ground speed in knots.
- \`084.4\`: True course heading in degrees.
- \`230324\`: Date (\`23 March 2024\`).

---

### 3. Hardware Wiring Guide (u-blox NEO-6M / NEO-8M)

| GPS Pin | ESP32 / USB-UART Pin | Function |
| :--- | :--- | :--- |
| **VCC** | **3.3V or 5V** | Power (Most NEO modules include a 3.3V low-dropout regulator). |
| **GND** | **GND** | Ground reference (Mandatory). |
| **TX** | **Target RX** | GPS transmits NMEA data to microcontroller / PC. |
| **RX** | **Target TX** | GPS receives binary UBX configuration commands. |

> **Outdoor Clear View Requirement**:
> GPS signals transmit from satellites 20,000 km in space with signal strength weaker than -130 dBm. A GPS module **cannot** get a fix indoors! Place the antenna next to an open window or outside with a clear view of the open sky.

---

### 4. u-blox UBX Binary Configuration Engine

Standard NMEA only outputs 1 position update per second (1 Hz / 1000ms). When wardriving in a car at 60 mph (100 km/h), your vehicle travels 27 meters between updates!

The workbench includes a binary UBX encoder to reconfigure u-blox receivers:
1. **UBX-CFG-RATE**:
   - Change measurement period from \`1000ms\` (1Hz) down to \`200ms\` (**5Hz**) or \`100ms\` (**10Hz**).
2. **UBX-CFG-PRT**:
   - Increase UART baud rate from 9600 to **115200 bps** to prevent high-speed NMEA sentences from overflowing the serial buffer.
3. **UBX-CFG-NAV5 (Dynamic Platform Model)**:
   - Switch from *Portable* to **Automotive** (enables velocity filtering for cars) or **Pedestrian**.
`
  },
  {
    id: 'piglet-suite',
    toolId: 'flasher',
    category: 'rf',
    title: 'Piglet Wardriver Suite — Full Setup Guide for All 7 Boards',
    summary: 'The ultimate guide to configuring, flashing, and running Piglet Wardriver across all 7 supported boards with GPS wiring, C5 stub bypass, and WiGLE CSV.',
    tags: ['Piglet', 'Wardriver', 'ESP32-S3', 'ESP32-C5', 'WiGLE', 'GPS', 'NEO-6M', 'CYD', 'T-Display', 'M5StickC'],
    readTime: '18 min read',
    content: `
# Piglet Wardriver Suite — Complete Hardware & Firmware Guide

The **Piglet Wardriver Suite** turns compact ESP32 development boards into high-efficiency Wi-Fi, Bluetooth, and cellular wardriving devices that log geolocated network data into standard WiGLE CSV format.

---

### 1. All 7 Supported Hardware Targets

| Board Model | CPU Architecture | Supported Bands | GPS UART Pins | Storage / Screen |
| :--- | :--- | :--- | :--- | :--- |
| **ESP32-S3 Zero** | S3 Dual-Core LX7 | 2.4 GHz | TX: GPIO43, RX: GPIO44 | MicroSD via SPI / External I2C OLED |
| **ESP32-C3 SuperMini** | C3 RISC-V 32-bit | 2.4 GHz | TX: GPIO20, RX: GPIO21 | MicroSD via SPI (GPIO4-7) |
| **ESP32-C5 Beta** | C5 RISC-V 32-bit | **Dual-Band 2.4 & 5 GHz** | TX: GPIO2, RX: GPIO3 | MicroSD SPI / Internal Flash |
| **ESP32-C6 DevBoard** | C6 RISC-V 32-bit | 2.4 GHz Wi-Fi 6 + Zigbee | TX: GPIO16, RX: GPIO17 | MicroSD SPI |
| **LilyGO T-Display S3** | S3 Dual-Core LX7 | 2.4 GHz | Dedicated Grove Connector | Integrated 1.9" ST7789 Color LCD |
| **M5StickC-Plus2** | ESP32-PICO-V3-02 | 2.4 GHz | Top Hat Connector | Built-in 1.14" TFT + LiPo Battery |
| **CYD Cheap Yellow Display**| ESP32 Classic | 2.4 GHz | Extended IO Port | 2.8" Resistive Touchscreen + SD |

---

### 2. The ESP32-C5 Dual-Band Flashing Fix
> **Critical Silicon Notice for ESP32-C5 Users**:
> ESP32-C5 is Espressif's first dual-band 2.4 GHz and 5 GHz RISC-V processor. Because it is early engineering silicon, standard \`esptool\` flasher stubs fail with memory allocation crashes when writing to C5 flash memory.
> **The Automatic Fix**: Skon's Web Flasher automatically identifies C5 chips from their eFuse MAC registers and forces **Direct ROM Mode (No-Stub)** at 115,200 baud, bypassing the stub and successfully burning firmware every time!

---

### 3. Step-by-Step Hardware Assembly Guide

#### Parts Needed:
1. One of the 7 supported ESP32 boards listed above.
2. A GPS module with external ceramic patch antenna (e.g. u-blox NEO-6M, NEO-8M, or ATGM336H).
3. A MicroSD card SPI breakout board (unless using CYD or LilyGO with built-in slot).
4. MicroSD card (32GB or smaller, formatted as **FAT32**).

#### General Wiring Diagram:
\`\`\`
GPS Module       Target ESP32 Board
VCC -------------> 3.3V or 5V (Check if board has 5V pin)
GND -------------> GND
TX  -------------> ESP RX (See table above for board-specific RX pin)
RX  -------------> ESP TX (See table above for board-specific TX pin)
\`\`\`

---

### 4. Step-by-Step Flashing Procedure

1. Open the **Firmware Flasher** tab in Skon's USB Tool.
2. Select **Piglet Wardriver Suite** from the curated presets dropdown.
3. Select your exact board model from the Board selector.
4. Plug in your board via USB.
5. Click **Connect & Flash**. Select your serial port in the browser prompt.
6. Once flashing finishes (100%), the board automatically restarts and launches Piglet Wardriver!

---

### 5. WiGLE CSV File Format & Uploading

Piglet generates logs conforming to the official **WiGLE CSV Format v2**:
\`\`\`text
WigleWifi-1.4,appRelease=Piglet-1.0,model=ESP32S3,osVersion=1.0.0,device=ESP32
MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type
AA:BB:CC:DD:EE:FF,CoffeeShop,[WPA2-PSK-CCMP],2024-03-23 12:45:10,6,-68,48.123456,11.654321,520.4,3.5,WIFI
\`\`\`

#### How to Upload to WiGLE:
1. Power down your board and remove the MicroSD card (or connect to the Terminal and download the log).
2. Log into your account on [WiGLE.net](https://wigle.net).
3. Click **Uploads** -> **Upload a file**.
4. Select your \`piglet_wardrive_YYYYMMDD.csv\` file.
5. Your discovered access points will be added to the global wireless map and your user rank will increase!
`
  },
  {
    id: 'marauder',
    toolId: 'terminal',
    category: 'rf',
    title: 'ESP32 Marauder CLI Manual — Wi-Fi & Bluetooth Auditing',
    summary: 'Complete command manual for JustCallMeKoko’s ESP32 Marauder: target discovery, raw promiscuous sniffing, beacon flooding, deauth testing, and pcap save.',
    tags: ['Marauder', 'CLI', 'Wi-Fi Audit', 'Beacon', 'Deauth', 'PMKID', 'pcap', 'Bluetooth', 'Sniffing'],
    readTime: '16 min read',
    content: `
# ESP32 Marauder CLI Manual

**ESP32 Marauder** is a portable firmware suite created by security researcher **JustCallMeKoko** for offensive and defensive Wi-Fi and Bluetooth analysis. When connected to Skon's USB Tool, you can control Marauder via the integrated WebSerial terminal or stream live packets into the Packet Lab.

---

### 1. Connecting to Marauder

1. Flash official Marauder using the **Firmware Flasher** or plug in a pre-flashed Marauder board.
2. Open the **Terminal & Console**.
3. Select **115200 baud** and click **Connect**.
4. Press Enter. Marauder will display its startup banner and \`> \` prompt.

---

### 2. Scanning & Target Discovery Commands

| Command | Description | Example Usage |
| :--- | :--- | :--- |
| \`scanap\` | Scans for nearby 802.11 Access Points across all channels | \`scanap\` |
| \`scansta\` | Scans for client devices (phones, laptops) | \`scansta\` |
| \`sniffraw\` | Streams all raw promiscuous frames over serial | \`sniffraw\` |
| \`sniffbeacon\` | Sniffs only AP beacon frames | \`sniffbeacon\` |
| \`sniffdeauth\` | Detects rogue deauthentication attacks | \`sniffdeauth\` |
| \`sniffpmkid\` | Captures PMKID key material from routers | \`sniffpmkid\` |
| \`stopscan\` | **Halts any active scanning or attack loop** | \`stopscan\` |

---

### 3. Target Selection & Management

After running \`scanap\`:
- \`list -a\`: Prints the numbered table of discovered Access Points:
  \`\`\`text
  [0] -62dBm ch: 6  CoffeeShop_Guest [WPA2] 00:11:22:33:44:55
  [1] -78dBm ch: 11 Home_Network     [WPA3] 66:77:88:99:AA:BB
  \`\`\`
- \`select -a <index>\`: Selects a specific target (e.g. \`select -a 0\`).
- \`select -a all\`: Selects all discovered APs.
- \`clearlist -a\`: Clears the internal AP cache to start fresh.

---

### 4. Active Transmission & Attack Commands
> **Legal Notice**: Only test networks and devices that you own or have explicit written authorization to audit.

- \`attack -t beacon -l\`: Generates beacon frames mimicking a list of random SSIDs.
- \`attack -t beacon -a\`: Clones SSIDs of all selected APs and broadcasts duplicate beacon floods.
- \`attack -t deauth\`: Transmits standard IEEE 802.11 deauthentication management frames to test client reconnection and capture WPA 4-way handshakes.
- \`attack -t probe\`: Floods probe requests to map hidden networks.

---

### 5. Settings, Channels & PCAP Capture
- \`channel\`: Displays the current 2.4GHz Wi-Fi channel.
- \`channel -s <1-14>\`: Locks the radio to a specific channel (e.g. \`channel -s 6\`).
- \`settings\`: Displays all internal settings (auto-save PCAP, LED color, force packets).
- \`settings -s ForcePackets enable\`: Forces raw packet streaming over UART into Skon's Packet Lab!
`
  }
];
