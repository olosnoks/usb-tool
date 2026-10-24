/**
 * Pentesting & Payloads Wiki Articles — Comprehensive Technical Manual
 * Covering RocketGod Suite, Bruce Multi-Tool, and BadUSB & DuckyScript Studio
 */

export const PAYLOAD_ARTICLES = [
  {
    id: 'rocketgod-suite',
    toolId: 'flasher',
    category: 'pentesting',
    title: 'RocketGod Pentesting Suite — 8 Wireless Security Toolkits',
    summary: 'Comprehensive technical manual for RocketGod’s wireless security toolkits: Evil Portal, HTMLSquash, Marauder WROOM, Minino C6, Wi-Fi Pen Tool, and Hash Monster.',
    tags: ['RocketGod', 'Evil Portal', 'HTMLSquash', 'Minino C6', 'Hash Monster', 'Deauther', 'WROOM', 'Pentesting'],
    readTime: '20 min read',
    content: `
# RocketGod Pentesting Suite — Technical Manual

The **RocketGod Pentesting Suite** bundles 8 offensive and auditing toolkits created by security researcher **RocketGod**. These firmwares cover rogue captive portal generation, embedded web asset compression, miniature Marauder ports, PMKID harvesting, and frame injection.

---

### 1. Evil Portal ESP32 / C3 / C6

#### How It Works Under the Hood
1. **Rogue Access Point**: Spawns an open 802.11 AP (e.g. \`Free_Public_WiFi\`).
2. **DNS Hijacking (DNS Spoofing)**: Runs an embedded DNS server on UDP port 53. Whenever a connected device sends a DNS query, the DNS server intercepts the query and responds with the ESP's own IP address (\`192.168.4.1\`).
3. **Captive Network Assistant (CNA) Trigger**: Mobile operating systems (iOS, Android, Windows) immediately detect that the internet is walled off and launch their built-in modal captive login screen.
4. **Credential Harvesting**: When a user inputs credentials into the phishing form and submits, the HTTP POST request is captured by the microcontroller and appended to \`/credentials.txt\` on internal SPIFFS / LittleFS flash storage or an external MicroSD card.

<details>
<summary>Deep Dive: Captive Network Assistant (CNA) Bypass & OS Probing Endpoints</summary>

Operating systems perform automatic connectivity checks upon associating with any Wi-Fi network:

| Operating System | Probing Endpoint URL | Expected Non-Captive Response | Evil Portal Interception Action |
| :--- | :--- | :--- | :--- |
| **Apple iOS / macOS** | \`http://captive.apple.com/hotspot-detect.html\` | \`<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>\` | DNS maps to \`192.168.4.1\`; HTTP server returns 302 redirect or login HTML, forcing modal CNA. |
| **Android / ChromeOS** | \`http://connectivitycheck.gstatic.com/generate_204\` | HTTP \`204 No Content\` | Returns HTTP \`200 OK\` with login portal body, triggering "Sign in to Wi-Fi network" notification. |
| **Windows 10 / 11** | \`http://www.msftconnecttest.com/connecttest.txt\` | Text string: \`Microsoft Connect Test\` | Returns HTML page; NCSI service detects response mismatch and launches Edge browser. |
| **Mozilla Firefox** | \`http://detectportal.firefox.com/success.txt\` | Text string: \`success\\n\` | Returns login portal page. |

</details>

<details>
<summary>PMKID & Hashcat Mode 22000 Hash Extraction Details</summary>

Traditional WPA handshake cracking requires waiting for an active user to connect to the router to capture the 4-way handshake. **Hash Monster** and **RocketGod Wi-Fi Pen Tool** execute the clientless **PMKID Attack**:

#### PMKID Cryptographic Derivation
Modern APs implementing 802.11i/r transmit the Pairwise Master Key Identifier (PMKID) inside the RSN Information Element (IE 48) of Message 1 of the EAPOL handshake:
$$\text{PMKID} = \text{HMAC-SHA1-128}\left(\text{PMK}, \text{"PMK Name"} \,\|\, \text{MAC}_{\text{AP}} \,\|\, \text{MAC}_{\text{STA}}\right)$$

#### Hashcat Mode 22000 Format
Captured PMKID lines are formatted for instant GPU cracking in Hashcat:
\`\`\`text
WPA*02*<PMKID_HEX>*<MAC_AP_HEX>*<MAC_STA_HEX>*<ESSID_HEX>***
\`\`\`
- \`WPA*02*\`: Specifies EAPOL / PMKID format v2.
- No client interaction is required — you can capture PMKIDs from any vulnerable access point within 500ms of association!

</details>

---

### 2. HTMLSquash — Embedded Web Minifier

Microcontrollers have extremely limited RAM and flash memory (typically only 4MB flash and 520KB SRAM). Storing rich HTML pages with CSS styling and JavaScript logic directly in C++ source code is tedious and memory-heavy.

#### What HTMLSquash Does:
- **Minification**: Strips all HTML/CSS/JS comments, whitespace, and line breaks.
- **Inlining**: Automatically converts external CSS, JS, and image assets (PNG, SVG, JPG) into base64 data URIs embedded directly inside the single HTML payload.
- **PROGMEM Header Generation**: Compresses the minified HTML and emits a C/C++ header file containing a \`const uint8_t portal_html[] PROGMEM\` byte array ready to compile directly into your Arduino IDE or ESP-IDF projects!

---

### 3. Marauder WROOM Edition

The **ESP32-WROOM-32** is the most widely sold 30-pin and 38-pin ESP32 development board on the market.
- **Headless Architecture**: Unlike Marauder builds designed for CYD or LilyGO displays, the WROOM edition runs headless without requiring an expensive SPI display.
- **WebSerial Control**: Connects directly to Skon's USB Tool terminal at **115,200 baud**.
- **Android Companion Ready**: Compatible with Bluetooth / Serial USB OTG Android companion applications for discreet field wardriving.

---

### 4. Minino ESP32-C6

The **ESP32-C6** is Espressif’s RISC-V SoC featuring integrated 2.4 GHz Wi-Fi 6 (802.11ax), Bluetooth 5 (LE), and IEEE 802.15.4 (Zigbee / Thread).
- **Lower Power Draw**: Consumes up to 40% less current than the original Xtensa ESP32 during continuous scanning loops.
- **Wi-Fi 6 Detection**: Maps Wi-Fi 6 OFDMA channels and modern BSS Coloring features in enterprise environments.

---

### 5. Wi-Fi Pen Tool

The **Wi-Fi Pen Tool** is designed for automated penetration testing and rapid physical security assessments.
- **Zero-Interaction Autonomous Mode**: Once powered on via a USB power bank, the device begins an automated assessment loop:
  1. Cycles all channels to identify target APs with weak encryption (WPA-TKIP, Open, WPS enabled).
  2. Sends targeted deauthentication pulses to connected stations.
  3. Listens for returning 4-way handshakes and saves them to internal flash storage.
  4. Blinks an LED confirmation when a handshake is secured.

---

### 6. Flipper Zero Easy Marauder

A dedicated companion firmware for ESP32 Wi-Fi development boards wired directly to the Flipper Zero's 18-pin GPIO header:
\`\`\`
ESP32 Board       Flipper Zero GPIO Header
3.3V -----------> Pin 9 (3.3V)
GND ------------> Pin 18 (GND)
TX (GPIO 1) ----> Pin 14 (USART RX)
RX (GPIO 3) ----> Pin 13 (USART TX)
\`\`\`
Controlled entirely using the Flipper Zero's physical screen and D-pad through the Flipper Marauder companion application!
`
  },
  {
    id: 'bruce-suite',
    toolId: 'flasher',
    category: 'pentesting',
    title: 'Bruce Multi-Tool — M5Stack & ESP32 Wireless Swiss-Army Knife',
    summary: 'Comprehensive guide to Bruce firmware: Sub-GHz RF, IR remote cloning, BLE spamming (Apple/Android/Windows), Wi-Fi auditing, and BadUSB payloads.',
    tags: ['Bruce', 'M5Stack', 'Cardputer', 'BLE Spam', 'Sub-GHz', 'IR Blaster', 'RFID', 'BadUSB'],
    readTime: '18 min read',
    content: `
# Bruce Multi-Tool — Wireless Auditing Firmware

**Bruce** is an all-in-one open-source firmware suite designed for M5Stack hardware (M5Stack Core, StickC Plus, Plus2, Cardputer) and standard ESP32 development boards. It transforms compact pocket hardware into a versatile wireless auditing and hardware testing instrument.

---

### 1. Bluetooth Low Energy (BLE) Advertisement Flooding

Modern smartphones and operating systems continuously listen for background BLE advertisements to simplify pairing with accessories. Bruce implements high-intensity advertisement flooding:

<details>
<summary>BLE Advertisement Protocol Breakdown (Apple Continuity, GFPS, Swift Pair)</summary>

#### 1. Apple Action Modal (Continuity Protocol)
Apple devices continuously scan for BLE packets with Apple's Company Identifier \`0x004C\`:
- **Header**: Length byte, \`0xFF\` (Manufacturer Specific Data), \`0x4C 0x00\` (Apple Inc).
- **Type Byte**: \`0x07\` (AirDrop), \`0x09\` (AirPods / Beats Proximity Pairing), \`0x10\` (Nearby Action / Setup Modal).
- **Model ID**: 16-bit code identifying device (e.g. \`0x02 0x20\` for AirPods Pro, \`0x05 0x20\` for AirPods Max).
- When spammed at 20ms intervals across channels 37, 38, and 39, iOS displays continuous modal dialogues.

#### 2. Android Fast Pair (GFPS — Google Fast Pair Service)
- **Service UUID**: \`0xFE2C\` registered to Google LLC.
- **Payload**: Contains a 3-byte Model ID (e.g. Pixel Buds, Sony WH-1000XM5).
- Android devices with Google Play Services enabled intercept the beacon and display a notification asking if the user wishes to link the device to their Google Account.

#### 3. Windows Swift Pair
- **Header**: \`0xFF\`, Microsoft Vendor ID \`0x06 0x00\`.
- **Beacon Flag**: \`0x03\` (Swift Pair Sub-scenario).
- Windows 10/11 computers display a desktop toast in the lower right notification tray prompting instant Bluetooth pairing.

</details>

<details>
<summary>Sub-GHz CC1101 Register Configuration & Frequency Registers</summary>

When paired with a Texas Instruments **CC1101** SPI transceiver module, Bruce calculates carrier frequencies using the on-board crystal oscillator ($f_{\text{XOSC}} = 26\,\text{MHz}$):

$$f_{\text{carrier}} = \frac{f_{\text{XOSC}}}{2^{16}} \times \left(\text{FREQ}[23:0] + \text{CHAN} \times \text{CHANSPC}\right)$$

- **315 MHz Band**: \`FREQ2=0x0C\`, \`FREQ1=0x1D\`, \`FREQ0=0x89\` (Automotive TPMS & garage remotes).
- **433.92 MHz Band**: \`FREQ2=0x10\`, \`FREQ1=0xB1\`, \`FREQ0=0x3B\` (ISM band gate openers & weather stations).
- **868.3 MHz Band**: \`FREQ2=0x21\`, \`FREQ1=0x62\`, \`FREQ0=0x76\` (European smart meters & security systems).
- **915 MHz Band**: \`FREQ2=0x23\`, \`FREQ1=0x31\`, \`FREQ0=0x3B\` (North American ISM band).

</details>

---

### 2. Infrared (IR) Blaster & Learning Lab

For hardware equipped with an IR LED and 38kHz demodulator receiver (like M5StickC-Plus2 and Cardputer):
- **Universal TV-B-Gone**: Rapidly cycles through hundreds of known power-off codes for Samsung, LG, Sony, Vizio, and Panasonic televisions.
- **Signal Learning & Replay**: Point any standard remote (air conditioner, projector, soundbar) at the receiver. Bruce samples the pulse-width modulated carrier frequency (typically 38 kHz NEC or RC-5 protocol) and saves it to internal flash storage for instant replay.

---

### 3. Flashing Bruce via Skon's Web Flasher

1. Open the **Firmware Flasher** tab in Skon's USB Tool.
2. Select **Bruce Multi-Tool** from the curated preset dropdown.
3. Select your exact device (e.g. *M5StickC-Plus2* or *M5Stack Cardputer*).
4. Connect via USB and click **Connect & Flash**.
5. Once completed, your device reboots into Bruce's interactive graphical menu!
`
  },
  {
    id: 'ducky',
    toolId: 'ducky',
    category: 'pentesting',
    title: 'BadUSB & DuckyScript Studio — Keystroke Injection & CyberChef',
    summary: 'Compile DuckyScript 1.0/2.0 payloads, simulate USB HID keystroke injection, generate multi-OS dropper one-liners, and obfuscate scripts with CyberChef.',
    tags: ['BadUSB', 'DuckyScript', 'HID Injection', 'CyberChef', 'Obfuscation', 'PowerShell', 'Rubber Ducky'],
    readTime: '18 min read',
    content: `
# BadUSB & DuckyScript Studio — Keystroke Injection

The **BadUSB & Payload Studio** is an in-browser development environment for writing, simulating, compiling, and obfuscating Human Interface Device (HID) keystroke injection attacks.

---

### 1. What Is BadUSB & Why Does It Work?

When you plug in a standard USB flash drive, your computer recognizes it as a *Mass Storage Device* and may prevent executables from running if administrative restrictions or USB blocklists are enabled.

However, operating systems implicitly trust **keyboards**. If a USB device identifies itself as a **USB HID Keyboard (Class 0x03)**, the operating system accepts its keystrokes without asking for administrator permissions or prompting the user with security dialogs.

A microcontroller running BadUSB (such as an ESP32-S2/S3, Raspberry Pi Pico, ATmega32U4, or Flipper Zero) can type at superhuman speeds (**over 1,000 words per minute**), opening terminals, executing PowerShell scripts, and establishing reverse shells in under 3 seconds!

---

### 2. DuckyScript Language Syntax Reference

\`\`\`text
REM ===================================
REM Windows Quick Information Gathering
REM ===================================
DELAY 1000
GUI r
DELAY 300
STRING powershell -NoP -NonI -W Hidden -Exec Bypass
ENTER
DELAY 500
STRING whoami; ipconfig /all; Get-NetIPAddress
ENTER
\`\`\`

<details>
<summary>USB HID Keyboard 8-Byte Input Report Format & Scancode Table</summary>

According to the USB Implementations Forum HID Usage Tables (HUT v1.12), every keyboard transmits 8-byte input reports:

\`\`\`
+----------------+----------+--------+--------+--------+--------+--------+--------+
| Modifier (1 B) | Reserved | Key 1  | Key 2  | Key 3  | Key 4  | Key 5  | Key 6  |
+----------------+----------+--------+--------+--------+--------+--------+--------+
\`\`\`

#### Byte 0: Modifier Keys Bitmask
- **Bit 0 (0x01)**: Left Ctrl
- **Bit 1 (0x02)**: Left Shift
- **Bit 2 (0x04)**: Left Alt
- **Bit 3 (0x08)**: Left GUI (Windows / Command key)
- **Bit 4 (0x10)**: Right Ctrl
- **Bit 5 (0x20)**: Right Shift
- **Bit 6 (0x40)**: Right Alt (AltGr)
- **Bit 7 (0x80)**: Right GUI

#### Bytes 2 - 7: Key Usage Codes (Scancodes)
| Key | Hex Code | Key | Hex Code | Key | Hex Code |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **A - Z** | \`0x04\` - \`0x1D\` | **1 - 0** | \`0x1E\` - \`0x27\` | **Enter** | \`0x28\` |
| **Escape**| \`0x29\` | **Backspace** | \`0x2A\` | **Tab** | \`0x2B\` |
| **Space** | \`0x2C\` | **F1 - F12** | \`0x3A\` - \`0x45\` | **CapLock** | \`0x39\` |

To type a capital \`A\`, the BadUSB device transmits \`[0x02, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00]\` followed by an all-zero release report \`[0x00, ...]\`.

</details>

<details>
<summary>Built-in CyberChef Obfuscation Pipelines (Bypass Windows Defender & EDR)</summary>

Endpoint Detection and Response (EDR) software and Windows Defender easily detect plain-text malicious commands (such as \`powershell -nop -w hidden -c "IEX(New-Object Net.WebClient)..."\`).

The integrated **CyberChef** workbench provides 1-click obfuscation pipelines:
1. **Base64 Unicode Encoding**:
   - Converts commands into UTF-16LE Base64 strings compatible with PowerShell's \`-EncodedCommand\` parameter:
     \`\`\`powershell
     powershell.exe -EncodedCommand SQBFAFgAKABOAGUAdwAtAE8AYgBqAGUAYwB0AC4ALgAuACkA
     \`\`\`
2. **String Splitting & Concatenation**:
   - Automatically breaks flagged cmdlets into concatenated strings:
     \`\`\`powershell
     & ("In"+"vo"+"ke-Exp"+"ression")
     \`\`\`
3. **Environment Variable Expansion**:
   - Uses system variable substrings (e.g. \`$env:ComSpec[4,15,25]\`) to assemble commands without writing words to disk.

</details>

---

### 3. Interactive Simulation & Deployment

- **Live Syntax Validator**: Highlights syntax errors, unclosed strings, and missing delays in real time.
- **Keystroke Simulator**: Visualizes the keystroke playback speed on screen before flashing to hardware.
- **1-Click Hardware Export**:
  - Download as standard \`payload.txt\` for Hak5 USB Rubber Ducky.
  - Deploy directly to **Flipper Zero** (\`/ext/badusb/\`).
  - Compile to C++ header for direct flashing onto **ESP32-S2 / S3** native USB boards!
`
  }
];

