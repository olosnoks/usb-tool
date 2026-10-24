/**
 * Pentesting & Payloads Wiki Articles
 * Covering RocketGod Suite, Bruce Multi-Tool, and BadUSB & DuckyScript Studio
 */

export const PAYLOAD_ARTICLES = [
  {
    id: 'rocketgod-suite',
    toolId: 'flasher',
    category: 'pentesting',
    title: 'RocketGod Pentesting Suite — 8 Wireless Security Toolkits',
    summary: 'Exhaustive guide to RocketGod’s pentesting tools: Evil Portal, HTMLSquash, Marauder WROOM, Minino C6, Wi-Fi Pen Tool, and Hash Monster.',
    tags: ['RocketGod', 'Evil Portal', 'HTMLSquash', 'Minino C6', 'Hash Monster', 'Deauther', 'WROOM'],
    readTime: '9 min read',
    content: `
# RocketGod Pentesting Suite — Technical Manual

The **RocketGod Pentesting Suite** bundles 8 offensive and auditing tools crafted by security researcher **RocketGod**. These firmwares cover captive portal generation, embedded web asset compression, miniature Marauder ports, PMKID harvesting, and frame injection.

---

### The 8 Specialized Toolkits

#### 1. Evil Portal ESP32 / C3 / C6
- **What It Does**: Creates rogue Wi-Fi access points that trigger captive network assistants (CNAs) on iOS, Android, macOS, and Windows.
- **Under the Hood**: Runs a lightweight HTTP server on port 80 and a DNS server on UDP port 53. All DNS queries resolve to the ESP32's local IP address (\`192.168.4.1\`), automatically opening the captive browser login page.
- **Storage**: Credentials captured from submitted forms are appended to an internal SPIFFS / LittleFS text file or written directly to an external microSD card.

#### 2. HTMLSquash
- **What It Does**: A client-side HTML, CSS, and JavaScript asset minifier and C++ header compressor.
- **Why It Matters**: Standard microcontrollers have limited flash space. HTMLSquash takes full web portals, strips comments/whitespace, inlines base64 images, and generates a PROGMEM-compressed C++ byte array ready to embed directly into ESP32 firmware source code.

#### 3. Marauder WROOM Edition
- **Target Silicon**: ESP32-WROOM-32 (Classic 30-pin & 38-pin modules).
- **Features**: Headless Marauder build tailored for standalone modules without touchscreens. Controlled completely over WebSerial terminal at 115,200 baud or paired with Android companion apps.

#### 4. Minino ESP32-C6
- **Target Silicon**: ESP32-C6 RISC-V SoC with integrated 2.4 GHz Wi-Fi 6, Bluetooth 5 (LE), and 802.15.4 (Zigbee / Thread).
- **Features**: Ultra-compact pentesting badge companion utilizing the C6's lower power consumption and enhanced radio sensitivity.

#### 5. Wi-Fi Pen Tool
- **What It Does**: Automated wireless reconnaissance and penetration testing automation firmware.
- **Workflow**: Boots up, scans channels, identifies weakest AP configurations (WPA-TKIP, WPS enabled, Open), initiates targeted deauth testing, and captures handshakes without manual terminal intervention.

#### 6. Hash Monster
- **What It Does**: Dedicated EAPOL and PMKID packet hunter.
- **Storage**: Converts captured handshakes into Hashcat-ready \`.22000\` hash files on microSD card storage for immediate brute-force auditing.

#### 7. ESP8266 Deauther
- **Target Silicon**: ESP8266 (NodeMCU, D1 Mini, ESP-01).
- **Features**: The classic Spacehuhn 802.11 deauthentication testing tool optimized and tuned by RocketGod for modern ESP8266 core toolchains.

#### 8. Flipper Zero Easy Marauder
- **What It Does**: Companion firmware for ESP32 Wi-Fi development boards wired directly to the Flipper Zero's 18-pin GPIO header.
- **Communication**: Speaks 115,200 baud UART over Flipper GPIO pins 13 (TX) and 14 (RX), allowing the Flipper screen and D-pad to navigate Marauder attacks portably.
`
  },
  {
    id: 'bruce-suite',
    toolId: 'flasher',
    category: 'pentesting',
    title: 'Bruce Multi-Tool — M5Stack & ESP32 Wireless Swiss-Army Knife',
    summary: 'Explore Bruce firmware: Sub-GHz RF, IR remotes, BLE spam (Apple/Android/Windows), Wi-Fi auditing, and BadUSB payload execution.',
    tags: ['Bruce', 'M5Stack', 'Cardputer', 'BLE Spam', 'Sub-GHz', 'IR Blaster', 'RFID'],
    readTime: '7 min read',
    content: `
# Bruce Multi-Tool — Wireless Auditing Firmware

**Bruce** is an all-in-one portable multi-tool firmware for M5Stack hardware (Core, StickC Plus, Plus2, Cardputer) and standard ESP32 boards. It combines wireless reconnaissance, physical testing, and RF manipulation in a single graphical interface.

---

### Core Functional Modules

#### 1. Bluetooth Low Energy (BLE) Spam
Bruce implements high-intensity BLE advertisement flooding targeting nearby mobile devices and workstations:
- **Apple Action Modal**: Transmits spoofed AirDrop, AirPods, and Apple TV pairing request packets, triggering pairing popups on nearby iOS devices.
- **Android Fast Pair**: Broadcasts Google Fast Pair Service (GFPS) frames prompting nearby Android devices to connect to nonexistent headphones.
- **Windows Swift Pair**: Sends Bluetooth device pairing prompts to Windows 10/11 desktops.

#### 2. Infrared (IR) Blaster & Learning
- Reads incoming IR signals via physical IR receivers (38kHz demodulators).
- Transmits universal TV-B-Gone codes to turn off televisions in public auditoriums.
- Replays learned codes for air conditioners, projectors, and audio receivers.

#### 3. Wi-Fi Attacks & Wardriving
- Scans for 802.11 b/g/n networks, generates beacon floods with custom SSID lists, and executes targeted deauthentication tests.
- Integrates with GPS hardware to log WiGLE CSV wardriving data.

#### 4. Sub-GHz RF Operations (with CC1101 module)
When paired with an external TI CC1101 transceiver over SPI:
- Transmits and receives signals across 315 MHz, 433.92 MHz, 868 MHz, and 915 MHz bands.
- Decodes fixed-code remote controls and doorbells.
`
  },
  {
    id: 'ducky',
    toolId: 'ducky',
    category: 'pentesting',
    title: 'BadUSB & DuckyScript Studio — Keystroke Injection & CyberChef',
    summary: 'Compile DuckyScript 1.0/2.0 payloads, simulate USB HID attacks, generate multi-OS dropper one-liners, and obfuscate scripts with CyberChef.',
    tags: ['BadUSB', 'DuckyScript', 'HID Injection', 'CyberChef', 'Obfuscation', 'PowerShell'],
    readTime: '7 min read',
    content: `
# BadUSB & DuckyScript Studio — Keystroke Injection

The **BadUSB & Payload Studio** is an in-browser development environment for writing, simulating, compiling, and obfuscating Human Interface Device (HID) keystroke injection attacks.

---

### How BadUSB Works
When a USB device connects to a computer, it presents its **USB Device Class**. Standard flash drives announce themselves as *Mass Storage Class* (0x08). Microcontrollers running BadUSB (such as Raspberry Pi Pico, ATmega32U4, ESP32-S2/S3, or Flipper Zero) announce themselves as a **USB HID Keyboard** (Class 0x03).

Operating systems implicitly trust keyboards. Without requiring administrator permissions, a BadUSB device can inject hundreds of keystrokes per second to open terminals, download payloads, and execute commands.

---

### DuckyScript Syntax Quick Reference

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

#### Essential Language Keywords
| Command | Action |
| :--- | :--- |
| \`REM <comment>\` | Remark / comment (ignored during execution) |
| \`DELAY <ms>\` | Pauses execution for specified milliseconds |
| \`STRING <text>\` | Types out the specified text string at high speed |
| \`STRING_DELAY <ms>\` | Adjusts inter-character typing delay for slow targets |
| \`GUI\` / \`WINDOWS\` | Presses Windows / Command key (e.g. \`GUI r\` for Run dialog) |
| \`ENTER\` / \`RETURN\` | Presses Enter |
| \`CTRL\`, \`ALT\`, \`SHIFT\` | Standard modifier keys (can be combined with other keys) |

---

### Built-in CyberChef Obfuscation Pipelines
Antivirus software and EDR solutions easily detect plain-text PowerShell strings. The integrated **CyberChef** workbench provides 1-click obfuscation filters:
- **Base64 Unicode Encoding**: Formats commands for PowerShell's \`-EncodedCommand\` parameter.
- **String Splitting & Concatenation**: Splits dangerous cmdlets (\`Invoke-Expression\` -> \`"Inv"+"oke"+"-Expr"+"ession"\`).
- **URL / Hex Encoding**: Prepares payloads for curl, wget, or bash one-liners.
`
  }
];
