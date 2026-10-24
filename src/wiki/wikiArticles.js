/**
 * Comprehensive Knowledge Base & Wiki Articles
 * Covering all firmware suites, hardware targets, companion tools, and protocols
 */

export const WIKI_CATEGORIES = [
  { id: 'all', name: 'All Guides' },
  { id: 'getting-started', name: 'Getting Started' },
  { id: 'piglet', name: 'Piglet Wardriver' },
  { id: 'rocketgod', name: 'RocketGod Toolkits' },
  { id: 'marauder', name: 'ESP32 Marauder' },
  { id: 'bruce', name: 'Bruce Multi-Tool' },
  { id: 'flipper', name: 'Flipper Zero Workbench' },
  { id: 'proxmark', name: 'Proxmark3 RFID/NFC' },
  { id: 'hardware', name: 'Diagnostic & Flashers' },
  { id: 'troubleshooting', name: 'Troubleshooting' }
];

export const WIKI_ARTICLES = [
  {
    id: 'webserial-setup',
    category: 'getting-started',
    title: 'WebSerial Browser Setup & USB Driver Guide',
    summary: 'How WebSerial interacts with USB-UART bridges (CP2102, CH340, FTDI, CDC) across Chrome, Edge, Linux, macOS, and Windows.',
    tags: ['WebSerial', 'Drivers', 'CH340', 'CP2102', 'Baud Rates', 'Linux udev'],
    readTime: '4 min read',
    content: `
# WebSerial Browser Setup & USB Driver Guide

Skon's USB Tool utilizes the **Web Serial API** to communicate directly with hardware from modern Chromium-based browsers without native client installations.

---

### Browser Compatibility
- **Google Chrome**: Version 89+ (Desktop: Windows, macOS, Linux, ChromeOS)
- **Microsoft Edge**: Version 89+
- **Opera / Brave**: Supported (Ensure *Brave Shields* does not block WebSerial port prompts)
- **Firefox / Safari**: Not supported (WebSerial API is rejected by Mozilla and Apple)

---

### Operating System Driver Requirements

#### 1. Windows (10 / 11)
- **CH340 / CH341**: Requires WCH CH341SER driver if port is unrecognized.
- **CP2102 / CP2104 / CP2108**: Requires Silicon Labs CP210x VCP driver.
- **FTDI FT232R**: Built-in or FTDI Virtual COM Port (VCP) driver.
- **Native ESP32-S2 / S3 / C3 / C6 USB CDC**: Automatically recognized as *USB Serial Device* via standard Microsoft \`usbser.sys\`.

#### 2. Linux (Ubuntu, Debian, Fedora, Arch)
Linux automatically loads \`ch341\`, \`cp210x\`, and \`cdc_acm\` kernel modules. However, normal users do not have permissions to access \`/dev/ttyUSB*\` or \`/dev/ttyACM*\` by default.

**Grant User Serial Permissions:**
\`\`\`bash
# Add current user to dialout and plugdev groups
sudo usermod -aG dialout,plugdev $USER

# On Arch / Manjaro (uucp group):
sudo usermod -aG uucp $USER

# Reload udev rules & reboot or relog:
sudo udevadm control --reload-rules && sudo udevadm trigger
\`\`\`

#### 3. macOS (Sonoma, Ventura, Monterey)
- macOS 12+ includes native drivers for CP210x and standard USB CDC.
- CH340 may require the signed WCH macOS package.
- If serial drops when flashing high bauds, drop baud rate to **115200 bps**.

---

### USB Cable Warning
> **Warning**: Over 40% of connection failures are caused by **charge-only USB cables** that lack D+/D- data lines. Verify that your USB cable exposes a serial COM port in Device Manager or \`ls /dev/tty*\`.
`
  },

  {
    id: 'web-flasher-guide',
    category: 'getting-started',
    title: 'Web Flasher & Memory Partition Architecture',
    summary: 'Hex offsets, bootloaders, partition tables, merged binaries, and baud rate strategies.',
    tags: ['ESP-IDF', 'Flash', 'Hex Offsets', 'Bootloader', 'esptool', 'ROM'],
    readTime: '6 min read',
    content: `
# Web Flasher & Memory Partition Architecture

The Web Flasher engine communicates directly with the ROM bootloader inside Espressif microcontrollers using the ESP-IDF serial protocol.

---

### Partition Address Map

| Partition Name | Typical Hex Offset | Purpose |
| :--- | :--- | :--- |
| **Bootloader** | \`0x1000\` (ESP32) / \`0x0\` (S3/C3/C6/C5) | First stage boot code initialized by ROM. |
| **Partition Table** | \`0x8000\` | Binary map describing flash layout (\`partitions.bin\`). |
| **Boot App0 / OTA Data** | \`0xe000\` | OTA selection structure (\`boot_app0.bin\`). |
| **Main Application** | \`0x10000\` | Compiled firmware code (\`app.bin\`). |
| **Merged Factory Binary** | \`0x0000\` | Single all-in-one image containing bootloader, table, and app pre-baked. |

---

### Hardware Bootloader Strapping
Espressif chips check strapping pins on power-up to determine whether to boot from SPI flash or enter ROM Download Mode:
- **GPIO0 (IO0)**: Must be pulled **LOW** while toggling **EN / RESET** to enter bootloader.
- **EN / RST**: Reset pin triggered by DTR / RTS lines.

#### Automatic DTR / RTS Reset Circuit
The flasher automatically drives DTR and RTS through a dual NPN transistor circuit (NodeMCU style). If your board does not automatically enter flash mode:
1. Press and hold the physical **BOOT / IO0** button on the device.
2. Click **FLASH PARTITIONS** or **Load Preset**.
3. Release the **BOOT** button once "Connecting..." progress begins.

---

### Flashing Baud Rate Recommendations
- **921600 bps**: Fastest reliable speed for ESP32, ESP32-S3, and short quality cables.
- **460800 bps**: Default stable speed for ESP32-C3, C6, and CYD boards.
- **115200 bps**: Mandatory for **ESP32-C5** (due to stub loader disconnect), ESP8266, and noisy long cables.
`
  },

  {
    id: 'piglet-wardriver-suite',
    category: 'piglet',
    title: 'Piglet Wardriver Suite — Full Setup & Board Matrix',
    summary: 'The ultimate guide to configuring, flashing, and running Piglet Wardriver across all 7 supported boards.',
    tags: ['Piglet', 'Wardriving', 'WiGLE', 'GPS', 'ESP32-S3', 'ESP32-C5', 'ESP-Now', 'Mesh'],
    readTime: '8 min read',
    content: `
# Piglet Wardriver Suite — Full Setup & Board Matrix

Piglet Wardriver is a high-performance open-source Wi-Fi and Bluetooth reconnaissance platform designed for geospatial mapping, WiGLE CSV generation, and autonomous ESP-Now mesh synchronization.

---

### Authoritative Board Support Matrix

| Hardware Board | Chip | Flash Size | Display | Default Baud | Key Features |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Freenove S3 CYD** | ESP32-S3 | 16 MB | 2.4" Touch | 921600 | HAM UI4 touch interface, SD logging, GPS, high-speed 2.4GHz scan. |
| **Guition JC8048W550** | ESP32-S3 | 16 MB | 5.0" RGB IPS | 921600 | 800x480 capacitive touch, real-time AP waterfall visualizer, SD logging. |
| **Seeed Studio XIAO C5** | ESP32-C5 | 8 MB | Headless | 115200 | Dual-band 2.4GHz & 5GHz Wi-Fi 6, Wi-Fi mesh client, ultra-compact. |
| **PigletNode C5** | ESP32-C5 | 4 MB | Headless | 115200 | Dual-band Wi-Fi 6 sensor node, mesh repeater, autonomous boot. |
| **LilyGo T-Dongle C5** | ESP32-C5 | 4 MB | 0.96" IPS | 115200 | USB-A dongle form factor, live network statistics, Wi-Fi 6 scanning. |
| **PigletNode C3** | ESP32-C3 | 4 MB | 0.42" OLED | 460800 | Minimal mesh satellite node, boots straight into ESP-Now broadcast. |
| **Waveshare C6 Mini** | ESP32-C6 | 4 MB | 1.47" ST7789 | 460800 | RISC-V Wi-Fi 6 + Zigbee/Thread capability, handheld color screen. |

---

### skon's Fork vs Hamspiced Upstream Releases
In the unified Piglet card, you can toggle between firmware variants:
- **skon's fork (\`main+fe55704\`)**: Custom fork optimized with custom GPS parse pipelines, expanded C5/C6 driver support, and HAM UI4 enhancements ([github.com/olosnoks/piglet](https://github.com/olosnoks/piglet)).
- **Ham's official (\`v2.7\`)**: Upstream releases verified from [github.com/Hamspiced/piglet](https://github.com/Hamspiced/piglet).

---

### Critical ESP32-C5 Flashing Workaround
> **Important Note for C5 Boards**: The ESP32-C5 USB-Serial/JTAG hardware drops USB connection when esptool runs its secondary RAM stub loader in WebSerial.
> - Always flash ESP32-C5 at **115200 baud**.
> - If your browser disconnects during the stub phase, flash in your terminal with the \`--no-stub\` flag:
\`\`\`bash
esptool.py --chip esp32c5 --baud 115200 --no-stub write_flash 0x0 xiao_c5.bin
\`\`\`

---

### WiGLE Logging & GPS Setup
1. Format your microSD card as **FAT32** (exFAT is not supported by ESP-IDF SPI drivers).
2. Insert GPS module (NMEA 9600 bps standard, e.g. ATGM336H or NEO-6M).
3. Connect GPS TX to Board RX (typically GPIO 18/19 or as defined per board).
4. Power up; logs are saved under \`/wigle/YYYY-MM-DD.csv\` ready for direct upload to [wigle.net](https://wigle.net).
`
  },

  {
    id: 'rocketgod-toolkits',
    category: 'rocketgod',
    title: 'RocketGod Pentesting Toolkits & Firmware Guides',
    summary: 'Evil Portal, HTMLSquash, Marauder WROOM, Minino C6, and Wi-Fi Pen Tool instructions.',
    tags: ['RocketGod', 'Evil Portal', 'HTMLSquash', 'Marauder', 'Minino', 'ESP32-C6', 'Pentesting'],
    readTime: '7 min read',
    content: `
# RocketGod Pentesting Toolkits & Firmware Guides

Developer **RocketGod** ([github.com/RocketGod-git](https://github.com/RocketGod-git)) maintains some of the most widely used offensive security utilities and firmware distributions for the Flipper Zero WiFi Dev Board and generic ESP32 modules.

---

### 1. Evil Portal for Flipper Zero WiFi Dev Board & WROOM
Evil Portal turns an ESP32 into a rogue captive portal access point. When victims connect, they are served a phishing or authentication template, forwarding submitted credentials over UART back to the Flipper Zero screen or SD card.

#### Firmware Binaries (Pre-merged 0x0)
- **Flipper WiFi Dev Board (ESP32-S2)**: Single-file merged binary compiled for Flipper GPIO serial.
- **ESP32-WROOM Generic**: Standalone version for standard 30-pin / 38-pin ESP32 dev boards.

#### Quick Flash Guide:
1. Connect board to USB.
2. Select **Evil Portal (RocketGod)** from the Web Flasher catalog.
3. Choose your hardware target (**WiFi Dev Board** or **WROOM**).
4. Click **Flash Preset** (flashes at offset \`0x0\`).

---

### 2. Evil Portal HTMLSquash Tool (\`evilportal-htmlsquash\`)
The ESP32 Evil Portal web server enforces a strict **20 KB single-file HTML constraint** to prevent heap exhaustion.

#### How to Use:
1. Save any webpage using Chrome's **SingleFile** extension.
2. Run the squash script:
\`\`\`bash
python htmlsquash.py input_page.html -o portal.html
\`\`\`
3. The script strips unnecessary SVG metadata, minifies inline CSS and JavaScript, and compresses images to produce a standalone file under 20KB ready for the Flipper SD card under \`/apps_data/evil_portal/portals/\`.

---

### 3. Marauder WROOM (RocketGod Pack)
Derived from the official FZ Marauder Flasher suite, this edition includes pin mappings and pre-tuned baud rates for ESP32-WROOM boards with external SD breakout boards and WS2812 status LEDs.

---

### 4. Minino Multi-Protocol IoT Device (ESP32-C6)
Minino is a Swiss-army knife for IoT security research:
- **Radio Support**: 2.4GHz Wi-Fi 6 (802.11ax), Bluetooth 5.3 LE, and IEEE 802.15.4 (Zigbee / Thread / Matter).
- **Onboard Peripherals**: High-gain ceramic GPS patch antenna, I2C OLED display, and microSD logging.
- **Auditing Features**: Sniff and analyze Zigbee packets, capture BLE advertisements, and track mobile IoT devices.

---

### 5. ESP32 Wi-Fi Penetration Tool (RocketGod Edition)
A comprehensive web-driven pentesting engine:
- Hosts a responsive web portal allowing target network selection, automated beacon spoofing, deauthentication attacks, and PMKID capture.
- RocketGod's \`flipper\` branch adds critical macOS serial port fixes and Flipper Dev Board pin compatibility.
`
  },

  {
    id: 'esp32-marauder-guide',
    category: 'marauder',
    title: 'ESP32 Marauder Field Manual & CLI Reference',
    summary: 'Wi-Fi attacks, deauth detection, PMKID capture, BLE spamming, and serial terminal commands.',
    tags: ['Marauder', 'justcallmekoko', 'Deauth', 'PMKID', 'Beacon Flood', 'BLE Spam', 'PCAP'],
    readTime: '6 min read',
    content: `
# ESP32 Marauder Field Manual & CLI Reference

Created by **justcallmekoko** ([github.com/justcallmekoko/ESP32Marauder](https://github.com/justcallmekoko/ESP32Marauder)), Marauder is the premier open-source wireless auditing tool for the ESP32.

---

### Supported Hardware Targets
- **Flipper WiFi Dev Board**: ESP32-S2 module interfacing over UART with Flipper Marauder companion app.
- **ESP32-S3 Multiboard**: Dual-core accelerated scanning with RGB status indicators.
- **CYD 2432S028**: Cheap Yellow Display with full touchscreen menu.
- **Generic ESP32-WROOM**: Standard NodeMCU / DevKit boards.
- **Dual Mini C5**: Dual-band 2.4/5GHz Wi-Fi 6 target.

---

### Core Serial CLI Commands

Connect via the built-in **Diagnostic Terminal** at **115200 baud** and issue commands:

\`\`\`text
# Scan Commands
scanap                  - Scan for nearby 2.4GHz Access Points
scanstation             - Scan for active Wi-Fi clients (stations)
sniffpmkid              - Sniff PMKID 4-way handshakes
sniffdeauth             - Detect active deauthentication attacks in area
sniffbeacon             - Capture Wi-Fi beacon frames

# Attack Commands (Authorized Testing Only)
attack -t beacon -l     - Flood beacon frames using random SSIDs
attack -t deauth -a <N> - Transmit deauthentication frames to AP index N
attack -t probe         - Probe request flood

# Bluetooth LE Commands
sniffbt                 - Scan and list active BLE devices
attack -t sourapple     - Broadcast iOS crash/lockup BLE advertisements
attack -t swiftpair     - Broadcast Windows SwiftPair spam notifications
attack -t samsung       - Broadcast Samsung Galaxy Buds pairing prompts

# General & SD Controls
list -a                 - List scanned Access Points
stopscan                - Stop any currently active sniffer or attack
savepcap                - Save captured packets to SD card
reboot                  - Software reboot the ESP32
\`\`\`
`
  },

  {
    id: 'bruce-multi-tool-guide',
    category: 'bruce',
    title: 'Bruce Multi-Tool Guide & Features',
    summary: 'RF sub-GHz, BadUSB, Wi-Fi auditing, and keyboard navigation on M5 Cardputer and CYD.',
    tags: ['Bruce', 'M5Stack', 'Cardputer', 'CYD', 'Sub-GHz', 'BadUSB', 'RF'],
    readTime: '5 min read',
    content: `
# Bruce Multi-Tool Guide & Features

Bruce ([github.com/BruceDevices/firmware](https://github.com/BruceDevices/firmware)) is a multi-purpose firmware inspired by Flipper Zero and Marauder, specifically tailored for devices with integrated displays and keyboards such as the **M5Stack Cardputer** and **Cheap Yellow Display (CYD)**.

---

### Key Capabilities
1. **RF / Sub-GHz Signal Replay**: Compatible with CC1101 transceivers connected via SPI for 315/433/868/915 MHz capture and replay.
2. **BadUSB / DuckyScript Execution**: Inject keystrokes over native USB-C on ESP32-S3.
3. **Wi-Fi Pentesting**: Beacon flooding, deauth detection, probe sniffing, and captive portals.
4. **BLE Jamming & Spoofing**: Multi-platform BLE notification flood (iOS, Android, Windows).
5. **Infrared Transceiver**: Send and receive TV-B-Gone and consumer IR codes.
`
  },

  {
    id: 'flipper-workbench-guide',
    category: 'flipper',
    title: 'Flipper Zero USB Workbench & Driver Documentation',
    summary: 'How the WebSerial RPC driver interacts with Flipper Zero: screen streaming, virtual keypad, CLI, and storage.',
    tags: ['Flipper Zero', 'RPC', 'protobuf', 'ST7567', 'Screen Stream', 'Virtual Keypad'],
    readTime: '6 min read',
    content: `
# Flipper Zero USB Workbench & Driver Documentation

The **Flipper Workbench** module provides a complete browser-based implementation of qFlipper, communicating over USB Virtual COM port using Google Protocol Buffers (protobuf) RPC.

---

### Hardware Architecture
- **MCU**: STM32WB55RG dual-core ARM Cortex-M4 / Cortex-M0+.
- **Serial Interface**: Exposes a dual CDC ACM USB interface:
  - **CLI Console Channel**: Plain ASCII terminal interface (baud agnostic, 115200 standard).
  - **RPC Channel**: Protobuf binary command protocol (\`PB_Main\` packet framing).

---

### Key Features
1. **Live LCD Canvas Streaming**: Streams raw 1024-byte framebuffer chunks from the 128x64 monochrome ST7567 display at 30 FPS onto an HTML5 canvas.
2. **Virtual D-Pad & Keyboard**: Send Up, Down, Left, Right, OK, and Back button events with PC arrow keys.
3. **Storage & File Explorer**: Browse \`/ext\` (microSD) and \`/int\` (internal flash), download captured \`.sub\` and \`.nfc\` files, and upload firmware updates.
4. **Hardware Diagnostic Controls**: Trigger vibration motor, cycle RGB notification LED, and inspect battery charge status.
`
  },

  {
    id: 'proxmark3-guide',
    category: 'proxmark',
    title: 'Proxmark3 RFID & NFC Workbench Field Guide',
    summary: 'Operating LF (125kHz) and HF (13.56MHz) cards, Mifare Classic key attacks, and ring buffer packet framing.',
    tags: ['Proxmark3', 'RFID', 'NFC', 'Mifare', 'T5577', 'EM4100', 'LF', 'HF'],
    readTime: '5 min read',
    content: `
# Proxmark3 RFID & NFC Workbench Field Guide

The **Proxmark3 Workbench** integrates directly with the Proxmark3 Easy and RDV4 over WebSerial without requiring local Python or client compiling.

---

### Supported Frequency Bands

#### 1. Low Frequency (LF: 125 kHz – 134 kHz)
- **EM4100 / EM4102**: Read, search, and clone 40-bit factory IDs.
- **T5577**: Re-writeable transponder chip used to emulate EM4100, HID Prox, and Indala cards.
- **HID Prox**: 26-bit to 37-bit Wiegand access control fobs.

#### 2. High Frequency (HF: 13.56 MHz)
- **Mifare Classic (1K / 4K)**: DarkSide, nested, and hardnested key recovery attacks.
- **Mifare Ultralight / NTAG**: Read and dump OTP and memory pages.
- **ISO 14443-A**: Read UID, ATQA, and SAK.

---

### Common Terminal Commands
\`\`\`text
# Low Frequency
lf search               - Automatically identify LF tags
lf em 410x read         - Read EM4100 transponder
lf em 410x clone <UID>  - Clone UID onto T5577 card

# High Frequency
hf search               - Automatically identify 13.56MHz cards
hf mf chk *1 ? t        - Check default keys on all sectors
hf mf dump              - Dump sectors with known keys to .bin
\`\`\`
`
  },

  {
    id: 'hardware-diagnostic-suites',
    category: 'hardware',
    title: 'Diagnostic Workbenches: CH341A, Logic Analyzer & CAN Bus',
    summary: 'Guide to specialized SPI EEPROM programming, CAN bus frame sniffing, CMSIS-DAP debugging, and USB-PD inspection.',
    tags: ['CH341A', 'Logic Analyzer', 'CAN Bus', 'Modbus', 'CMSIS-DAP', 'USB-PD'],
    readTime: '6 min read',
    content: `
# Diagnostic Workbenches: CH341A, Logic Analyzer & CAN Bus

Skon's USB Tool embeds multiple dedicated hardware reverse-engineering decks:

---

### 1. CH341A SPI / I2C Flash Programmer
- **Supported Chips**: 24CXX EEPROMs and 25LXX / 25QXX SPI NOR flash (W25Q64, W25Q128, etc.).
- **Capabilities**: Read JEDEC Manufacturer ID, dump flash contents, verify checksums, and write binary images directly via WebUSB.

---

### 2. Logic Analyzer Workbench
- **Channels**: 8-channel digital capture at sampling rates up to 24 MHz.
- **Protocol Decoders**: Integrated I2C, SPI, UART, and 1-Wire protocol analyzers.

---

### 3. CAN Bus Workbench
- **Protocol**: ISO 11898 standard & extended (11-bit / 29-bit CAN IDs).
- **Supported Speeds**: 125 kbps, 250 kbps, 500 kbps, 1 Mbps.
- **Tools**: Live frame sniffing, ID mask filtering, and packet transmission engine.
`
  },

  {
    id: 'troubleshooting-matrix',
    category: 'troubleshooting',
    title: 'Comprehensive Troubleshooting & Error Matrix',
    summary: 'Solutions for "Timed out waiting for packet header", baud rate mismatch, port access errors, and chip resets.',
    tags: ['Troubleshooting', 'Errors', 'Packet Header', 'Port In Use', 'Baud Rate'],
    readTime: '5 min read',
    content: `
# Comprehensive Troubleshooting & Error Matrix

| Symptom / Error Message | Likely Root Cause | Verified Solution |
| :--- | :--- | :--- |
| **"Timed out waiting for packet header"** | Device is not in ROM bootloader download mode. | Hold the physical **BOOT / IO0** button on the device, click **Flash**, then release after 2 seconds. |
| **"Failed to open serial port" / "Port in use"** | Another software (Arduino IDE, Cura, PuTTY, or another browser tab) has claimed the serial port lock. | Close other terminal windows, slicers, and background serial monitors. Unplug and replug the USB cable. |
| **Serial terminal displays garbled characters / inverted question marks** | Baud rate mismatch. | Click the **Baud Hunter** button in the Diagnostic Terminal to automatically probe and match the incoming baud rate. |
| **ESP32-C5 disconnects during stub loader** | C5 USB-Serial/JTAG hardware drops when RAM stub executes. | Set flashing baud rate to **115200 bps** or flash in terminal using \`--no-stub\`. |
| **"Failed to execute 'requestPort' on 'Serial'"** | Browser permission blocked or non-HTTPS environment. | WebSerial requires secure contexts (\`https://\` or \`localhost\`). Ensure browser permissions allow serial access. |
| **MicroSD card not recognized in Piglet / Marauder** | SD formatted as exFAT or capacity exceeds FAT32 cluster size. | Reformat microSD card using **FAT32** with 32KB allocation cluster size. |
`
  }
];
