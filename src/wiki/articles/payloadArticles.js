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
    readTime: '18 min read',
    content: `
# RocketGod Pentesting Suite — Technical Manual

The **RocketGod Pentesting Suite** bundles 8 offensive and auditing tools created by security researcher **RocketGod**. These firmwares cover rogue captive portal generation, embedded web asset compression, miniature Marauder ports, PMKID harvesting, and frame injection.

---

### 1. Evil Portal ESP32 / C3 / C6

#### How It Works Under the Hood
1. **Rogue Access Point**: Spawns an open 802.11 AP (e.g. \`Free_Public_WiFi\`).
2. **DNS Hijacking (DNS Spoofing)**: Runs an embedded DNS server on UDP port 53. Whenever a connected device sends a DNS query (e.g. \`captive.apple.com\`, \`connectivitycheck.gstatic.com\`, or \`www.google.com\`), the DNS server intercepts the query and responds with the ESP's own IP address (\`192.168.4.1\`).
3. **Captive Network Assistant (CNA) Trigger**: Mobile operating systems (iOS, Android, Windows) immediately detect that the internet is walled off and launch their built-in modal captive login screen.
4. **Credential Harvesting**: When a user inputs credentials into the phishing form and submits, the HTTP POST request is captured by the microcontroller and appended to \`/credentials.txt\` on internal SPIFFS / LittleFS flash storage or an external MicroSD card.

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

### 6. Hash Monster (PMKID & EAPOL Hunter)

Traditional WPA handshake cracking requires waiting for an active user to connect to the router so you can capture the 4-way handshake.
**Hash Monster** focuses heavily on the **PMKID (Pairwise Master Key Identifier) Attack**:
- The PMKID is included in the very first EAPOL frame (Message 1) sent by many modern routers supporting 802.11i/p/r.
- **No Client Station Needed**: Hash Monster communicates directly with the Access Point to elicit the PMKID without needing any real users connected!
- Converts captured packets into standard Hashcat **\`mode 22000\`** hash lines ready for instant GPU brute-force auditing.

---

### 7. ESP8266 Deauther

The classic 802.11 deauthentication testing tool designed for the low-cost ESP8266 (NodeMCU, D1 Mini):
- Transmits raw 802.11 management frames on 2.4GHz channels.
- Demonstrates vulnerabilities in legacy 802.11b/g/n networks that do not implement **802.11w Protected Management Frames (PMF)**.

---

### 8. Flipper Zero Easy Marauder

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
    readTime: '15 min read',
    content: `
# Bruce Multi-Tool — Wireless Auditing Firmware

**Bruce** is an all-in-one open-source firmware suite designed for M5Stack hardware (M5Stack Core, StickC Plus, Plus2, Cardputer) and standard ESP32 development boards. It transforms compact pocket hardware into a versatile wireless auditing and hardware testing instrument.

---

### 1. Bluetooth Low Energy (BLE) Advertisement Flooding

Modern smartphones and operating systems continuously listen for background BLE advertisements to simplify pairing with accessories. Bruce implements high-intensity advertisement flooding:

#### The Protocols Targeted
- **Apple Action Modal**:
  - Broadcasts spoofed Apple proximity pairing beacons formatted with Apple's Company Identifier (\`0x004C\`).
  - Mimics AirPods, AirPods Pro, Apple Watch setup prompts, and Apple TV keyboards, causing nearby iPhones to continuously pop up connection modals.
- **Android Fast Pair (GFPS)**:
  - Broadcasts Google Fast Pair Service packets (\`0xFE2C\`) prompting Android devices to connect to nonexistent smart headphones.
- **Windows Swift Pair**:
  - Broadcasts Microsoft Swift Pair announcements, displaying device setup toasts in the bottom right corner of Windows 10/11 desktops.

---

### 2. Infrared (IR) Blaster & Learning Lab

For hardware equipped with an IR LED and 38kHz demodulator receiver (like M5StickC-Plus2 and Cardputer):
- **Universal TV-B-Gone**: Rapidly cycles through hundreds of known power-off codes for Samsung, LG, Sony, Vizio, and Panasonic televisions.
- **Signal Learning & Replay**: Point any standard remote (air conditioner, projector, soundbar) at the receiver. Bruce samples the pulse-width modulated carrier frequency (typically 38 kHz NEC or RC-5 protocol) and saves it to internal flash storage for instant replay.

---

### 3. Sub-GHz Radio Transceiver (with CC1101 SPI Module)

When paired with a Texas Instruments **CC1101** transceiver module:
- Communicates across 300-348 MHz, 387-464 MHz, and 779-928 MHz bands.
- Sniffs, decodes, and replays fixed-code doorbells, garage doors, and wireless gate openers.
- Jamming / Noise generator for testing RF circuit shielding and interference immunity.

---

### 4. Flashing Bruce via Skon's Web Flasher

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
    readTime: '16 min read',
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

#### Master Command Table
| Command | Action / Behavior | Example |
| :--- | :--- | :--- |
| \`REM <text>\` | Remark / comment (ignored during execution) | \`REM Set volume to 0\` |
| \`DELAY <ms>\` | Pauses execution for specified milliseconds | \`DELAY 500\` |
| \`STRING <text>\` | Types the specified text string at full USB speed | \`STRING calc.exe\` |
| \`STRING_DELAY <ms>\` | Adds delay between individual keystrokes | \`STRING_DELAY 20\` |
| \`GUI\` / \`WINDOWS\` | Presses Windows / Command key | \`GUI r\` (Opens Run box) |
| \`ENTER\` / \`RETURN\` | Presses Enter key | \`ENTER\` |
| \`CTRL\`, \`ALT\`, \`SHIFT\`| Modifier keys (can be combined with other keys) | \`CTRL SHIFT ESC\` |
| \`CAPSLOCK\`, \`TAB\` | Standard keyboard control keys | \`TAB\` |

---

### 3. Built-in CyberChef Obfuscation Pipelines

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

---

### 4. Interactive Simulation & Deployment

- **Live Syntax Validator**: Highlights syntax errors, unclosed strings, and missing delays in real time.
- **Keystroke Simulator**: Visualizes the keystroke playback speed on screen before flashing to hardware.
- **1-Click Hardware Export**:
  - Download as standard \`payload.txt\` for Hak5 USB Rubber Ducky.
  - Deploy directly to **Flipper Zero** (\`/ext/badusb/\`).
  - Compile to C++ header for direct flashing onto **ESP32-S2 / S3** native USB boards!
`
  }
];
